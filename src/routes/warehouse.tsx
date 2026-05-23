import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Boxes, ClipboardList, Loader2, Plus, Printer, FileSpreadsheet, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/export";
import { stripVinStars } from "@/lib/vin";
import { JobOrderPrintView } from "@/components/JobOrderPrintView";
import type { Lot, JobOrder, Engine, Model, ModelTrim } from "@/lib/db-types";
import { useColors } from "@/hooks/use-colors";

export const Route = createFileRoute("/warehouse")({
  head: () => ({ meta: [{ title: "Warehouse — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { hasStation, isSuperuser } = useAuth();
  const nav = useNavigate();
  const { getCode, list: allColors } = useColors();
  useEffect(() => { if (!hasStation("warehouse")) { toast.error("No access"); nav({ to: "/" }); } }, [hasStation, nav]);

  const [lots, setLots] = useState<Lot[]>([]);
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [trims, setTrims] = useState<ModelTrim[]>([]);
  const [modelYears, setModelYears] = useState<string[]>(["2026", "2027"]);
  const [printJob, setPrintJob] = useState<JobOrder | null>(null);
  const [printLots, setPrintLots] = useState<{ lot: Lot; count: number }[]>([]);
  const [printEngines, setPrintEngines] = useState<Engine[]>([]);
  const [lotVehicleCounts, setLotVehicleCounts] = useState<Record<string, number>>({});
  const [canEditLots, setCanEditLots] = useState<Record<string, boolean>>({});
  const [canEditJobs, setCanEditJobs] = useState<Record<string, boolean>>({});
  const [editLot, setEditLot] = useState<Lot | null>(null);
  const [editJob, setEditJob] = useState<JobOrder | null>(null);

  const handlePrint = async (job: JobOrder) => {
    let resolvedLots: { lot: Lot; count: number }[] = [];
    // Check if multi-lot
    const { data: jol } = await supabase.from("job_order_lots")
      .select("lot_id, vehicle_count, lots(id, lot_code, chinese_number, model, total_units, producible_units, status, created_at)")
      .eq("job_order_id", job.id);
    if (jol && jol.length > 0) {
      resolvedLots = jol.map((j: any) => ({ lot: j.lots as Lot, count: j.vehicle_count }));
    } else if (job.lot_id) {
      const { data: lot } = await supabase.from("lots").select("id,lot_code,chinese_number,model,total_units,producible_units,status,created_at").eq("id", job.lot_id).maybeSingle();
      if (lot) resolvedLots = [{ lot: lot as Lot, count: job.units }];
    }
    const { data: engines } = await supabase.from("engines").select("id,engine_number,engine_suffix,lot_id,job_order_id,status").eq("job_order_id", job.id);
    setPrintJob(job);
    setPrintLots(resolvedLots);
    setPrintEngines((engines ?? []) as Engine[]);
    setTimeout(() => window.print(), 150);
  };

  const handleDeleteJob = async (job: JobOrder) => {
    if (!confirm(`Delete job order ${job.job_code} and all its vehicles?`)) return;
    await supabase.from("vehicles").delete().eq("job_order_id", job.id);
    const { error } = await supabase.from("job_orders").delete().eq("id", job.id);
    if (error) toast.error(error.message); else { toast.success("Job order deleted"); reload(); }
  };

  const handleDeleteLot = async (lot: Lot) => {
    if (!confirm(`Delete lot ${lot.lot_code} and all its job orders and vehicles?`)) return;
    const { data: lotJobs } = await supabase.from("job_orders").select("id").eq("lot_id", lot.id);
    for (const j of lotJobs ?? []) await supabase.from("vehicles").delete().eq("job_order_id", j.id);
    await supabase.from("job_orders").delete().eq("lot_id", lot.id);
    await supabase.from("vehicles").delete().eq("lot_id", lot.id);
    const { error } = await supabase.from("lots").delete().eq("id", lot.id);
    if (error) toast.error(error.message); else { toast.success("Lot deleted"); reload(); }
  };

  const handleRelease = async (job: JobOrder) => {
    if (!confirm(`Release job order ${job.job_code}? Vehicles will move to Line Feeding.`)) return;
    const { data: vehicles } = await supabase.from("vehicles")
      .select("id, lot_id")
      .eq("job_order_id", job.id)
      .eq("current_station", "warehouse");
    if (!vehicles || vehicles.length === 0) {
      toast.error("No vehicles at warehouse to release");
      return;
    }
    await supabase.from("job_orders")
      .update({ released_at: new Date().toISOString() })
      .eq("id", job.id);
    await supabase.from("vehicles")
      .update({ current_station: "line_feeding" })
      .in("id", vehicles.map(v => v.id));
    const user = (await supabase.auth.getUser()).data.user;
    const events = vehicles.map(v => ({
      vehicle_id: v.id,
      station: "line_feeding" as const,
      kind: "in" as const,
      recorded_by: user?.id ?? null,
    }));
    await supabase.from("station_events").insert(events);
    // Decrease producible_units per affected lot
    const lotCounts: Record<string, number> = {};
    vehicles.forEach(v => { if (v.lot_id) lotCounts[v.lot_id] = (lotCounts[v.lot_id] ?? 0) + 1; });
    for (const [lotId, count] of Object.entries(lotCounts)) {
      await supabase.rpc("decrease_producible", { lot_id_input: lotId, count_input: count });
    }
    toast.success(`Released ${vehicles.length} vehicles to Line Feeding`);
    reload();
  };

  const reload = async () => {
    const [{ data: l }, { data: j }, { data: vc }, { data: m }, { data: t }, { data: s }] = await Promise.all([
      supabase.from("lots").select("id,lot_code,chinese_number,model,total_units,producible_units,status,created_at").order("created_at", { ascending: false }),
      supabase.from("job_orders").select("id,lot_id,job_code,units,color_plan,vin_sequence,status,model_year,is_contract,contract_company,released_at,created_at").order("created_at", { ascending: false }),
      supabase.from("vehicles").select("lot_id, job_order_id, current_station").is("completed_at", null).limit(2000),
      supabase.from("models").select("id,name,active").eq("active", true).order("name"),
      supabase.from("model_trims").select("id,name,model_id,active,sort_order").eq("active", true).order("sort_order"),
      supabase.from("app_settings").select("value").eq("key", "model_years").maybeSingle(),
    ]);
    setLots((l ?? []) as Lot[]); setJobs(j ?? []); setModels((m ?? []) as Model[]); setTrims((t ?? []) as ModelTrim[]);
    if (s?.value && Array.isArray(s.value)) setModelYears(s.value as string[]);
    const vehicles = (vc ?? []) as { lot_id: string | null; job_order_id: string | null; current_station: string | null }[];
    // Count vehicles per lot
    const counts: Record<string, number> = {};
    vehicles.forEach(v => { if (v.lot_id) counts[v.lot_id] = (counts[v.lot_id] ?? 0) + 1; });
    setLotVehicleCounts(counts);
    // Compute canEdit: only if ALL vehicles still at warehouse
    const lotAllWarehouse: Record<string, boolean> = {};
    const jobAllWarehouse: Record<string, boolean> = {};
    const lotVehicleStations: Record<string, Set<string>> = {};
    const jobVehicleStations: Record<string, Set<string>> = {};
    vehicles.forEach(v => {
      if (v.lot_id) {
        lotVehicleStations[v.lot_id] = lotVehicleStations[v.lot_id] ?? new Set();
        lotVehicleStations[v.lot_id].add(v.current_station ?? "");
      }
      if (v.job_order_id) {
        jobVehicleStations[v.job_order_id] = jobVehicleStations[v.job_order_id] ?? new Set();
        jobVehicleStations[v.job_order_id].add(v.current_station ?? "");
      }
    });
    (l ?? []).forEach(lot => {
      const stations = lotVehicleStations[lot.id];
      lotAllWarehouse[lot.id] = !stations || stations.size === 0 || (stations.size === 1 && stations.has("warehouse"));
    });
    (j ?? []).forEach(job => {
      const stations = jobVehicleStations[job.id];
      jobAllWarehouse[job.id] = !stations || stations.size === 0 || (stations.size === 1 && stations.has("warehouse"));
    });
    setCanEditLots(lotAllWarehouse);
    setCanEditJobs(jobAllWarehouse);
  };

  const handleExportLots = () => {
    if (lots.length === 0) return toast.error("No lots to export");
    exportToCSV(
      lots.map(l => ({
        "Lot Code": l.lot_code,
        "Chinese Number": l.chinese_number ?? "",
        "Model": l.model,
        "Total Units": l.total_units,
        "Status": l.status,
      })),
      `lots-export-${new Date().toISOString().slice(0, 10)}`
    );
  };
  useEffect(() => { reload(); }, []);

  return (
    <div className="space-y-5">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Stations</button>
      <div>
        <h1 className="text-2xl font-semibold">Warehouse</h1>
        <p className="text-muted-foreground text-sm">Receive lots and split into job orders.</p>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <NewLot models={models} trims={trims} onDone={reload} />
        <NewJobOrder lots={lots} modelYears={modelYears} onDone={reload} />
        <NewPaintJobOrder modelYears={modelYears} onDone={reload} />
        <NewMultiLotJobOrder lots={lots} modelYears={modelYears} onDone={reload} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Lot Inventory</CardTitle>
            {lots.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExportLots}>
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Export
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {lots.length === 0 ? <EmptyState icon={Boxes} title="No lots" description="Create your first lot to start receiving vehicles." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Lot</th>
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Model</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">Total</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">In WIP</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">Available</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">Producible</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-center py-2 px-2 font-medium text-muted-foreground w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map(l => {
                    const inWip = lotVehicleCounts[l.id] ?? 0;
                    const available = l.total_units - inWip;
                    return (
                      <tr key={l.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-2 font-medium">{l.lot_code}{l.chinese_number ? <span className="text-muted-foreground text-xs"> / {l.chinese_number}</span> : null}</td>
                        <td className="py-2 px-2">{l.model}</td>
                        <td className="py-2 px-2 text-center">{l.total_units}</td>
                        <td className="py-2 px-2 text-center">{inWip}</td>
                        <td className="py-2 px-2 text-center">{available}</td>
                        <td className="py-2 px-2 text-center">
                          <Input
                            type="number"
                            min={0}
                            max={l.total_units}
                            value={(l as any).producible_units ?? l.total_units}
                            onChange={e => {
                              const val = parseInt(e.target.value) || 0;
                              setLots(prev => prev.map(lot => lot.id === l.id ? { ...lot, producible_units: val } as any : lot));
                            }}
                            onBlur={async () => {
                              await supabase.from("lots").update({ producible_units: (l as any).producible_units ?? l.total_units }).eq("id", l.id);
                            }}
                            className="w-16 h-7 text-center text-xs mx-auto"
                          />
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Badge variant={l.status === "active" ? "default" : "secondary"}>{l.status}</Badge>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {canEditLots[l.id] && <button onClick={() => setEditLot(l)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
                            {isSuperuser && <button onClick={() => handleDeleteLot(l)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Job orders</CardTitle></CardHeader>
        <CardContent>
          {jobs.length === 0 ? <EmptyState icon={ClipboardList} title="No job orders" description="Create a job order to split a lot into production runs." /> : (
            <ul className="divide-y text-sm">
              {jobs.map(j => (
                <li key={j.id} className="py-2 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span><b>{j.job_code}</b> · {j.units} cars</span>
                    {(j as any).is_contract && <Badge variant="outline" className="text-xs">Contract: {(j as any).contract_company || "—"}</Badge>}
                    {(j as any).released_at && <Badge variant="secondary" className="text-[10px]">Released</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">{Object.entries(j.color_plan ?? {}).map(([k,v]) => `${getCode(k)}:${v}`).join(" ")}</span>
                    {canEditJobs[j.id] && j.status === "active" && !(j as any).released_at && <Button variant="outline" size="sm" className="h-7 no-print" onClick={() => handleRelease(j)}><ArrowRight className="h-3.5 w-3.5 mr-1" />Release</Button>}
                    {canEditJobs[j.id] && <button onClick={() => setEditJob(j)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
                    {isSuperuser && <button onClick={() => handleDeleteJob(j)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
                    <Button variant="outline" size="sm" className="h-7 no-print" onClick={() => handlePrint(j)}><Printer className="h-3.5 w-3.5 mr-1" />Print</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {editLot && <EditLotDialog lot={editLot} models={models} trims={trims} onSave={async (updates) => {
        const { error } = await supabase.from("lots").update(updates as any).eq("id", editLot.id);
        if (error) toast.error(error.message); else { toast.success("Lot updated"); setEditLot(null); reload(); }
      }} onClose={() => setEditLot(null)} />}

      {editJob && <EditJobDialog job={editJob} colors={allColors} modelYears={modelYears} onSave={async (updates, newVins, newColorPlan) => {
        try {
          await supabase.from("vehicles").delete().eq("job_order_id", editJob.id);
          const { error: uj } = await supabase.from("job_orders").update(updates as any).eq("id", editJob.id);
          if (uj) throw uj;
          if (newVins.length > 0) {
            const planFlat: string[] = [];
            Object.entries(newColorPlan).forEach(([uuid, n]) => { for (let i = 0; i < n; i++) planFlat.push(uuid); });
            while (planFlat.length < newVins.length) planFlat.push(Object.keys(newColorPlan)[0]);
            const rows = newVins.map((vin: string, i: number) => ({
              vin, vin_suffix: stripVinStars(vin).slice(-5), lot_id: (editJob as any).lot_id ?? null, job_order_id: editJob.id, planned_color_id: planFlat[i] ?? null, current_station: "warehouse" as const,
            }));
            const { error: iv } = await supabase.from("vehicles").insert(rows);
            if (iv) throw iv;
          }
          toast.success("Job order updated"); setEditJob(null); reload();
        } catch (e: any) { toast.error(e.message); }
      }} onClose={() => setEditJob(null)} />}

      {/* Print area — hidden on screen, visible only when printing */}
      {printJob && <JobOrderPrintView jobOrder={printJob} lots={printLots} engines={printEngines} colors={allColors} isContract={(printJob as any).is_contract} contractCompany={(printJob as any).contract_company} />}
    </div>
  );
}

function NewLot({ models, trims, onDone }: { models: Model[]; trims: ModelTrim[]; onDone: () => void }) {
  const [code, setCode] = useState(""); const [chineseNumber, setChineseNumber] = useState("");
  const [modelName, setModelName] = useState(""); const [trimName, setTrimName] = useState("");
  const [units, setUnits] = useState(50); const [busy, setBusy] = useState(false);

  const selectedModel = models.find(m => m.name === modelName);
  const modelTrims = selectedModel ? trims.filter(t => t.model_id === selectedModel.id) : [];

  const modelValue = trimName ? `${modelName} — ${trimName}` : modelName;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const user = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from("lots").insert({ lot_code: code.trim(), chinese_number: chineseNumber.trim() || null, model: modelValue.trim(), total_units: units, producible_units: units, status: "active", created_by: user?.id });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Lot created"); setCode(""); setChineseNumber(""); setModelName(""); setTrimName(""); setUnits(50); onDone(); }
  };
  return (
    <Card><CardHeader><CardTitle className="text-base">New lot</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>LOT No (internal)</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="LOT-2026-001" required /></div>
          <div className="space-y-1.5"><Label>Chinese number (optional)</Label><Input value={chineseNumber} onChange={e => setChineseNumber(e.target.value)} placeholder="e.g. CN-2026-001" /></div>
          <div className="space-y-1.5"><Label>Model</Label>
            {models.length > 0 ? (
              <Select value={modelName} onValueChange={v => { setModelName(v); setTrimName(""); }}>
                <SelectTrigger><SelectValue placeholder="Select model..." /></SelectTrigger>
                <SelectContent>
                  {models.map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input value={modelName} onChange={e => setModelName(e.target.value)} placeholder="Sedan A" required />
            )}
          </div>
          {modelTrims.length > 0 && (
            <div className="space-y-1.5"><Label>Trim level</Label>
              <Select value={trimName} onValueChange={setTrimName}>
                <SelectTrigger><SelectValue placeholder="Select trim..." /></SelectTrigger>
                <SelectContent>
                  {modelTrims.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5"><Label>Total units</Label><Input type="number" min={1} value={units} onChange={e => setUnits(+e.target.value)} required /></div>
          <Button disabled={busy || !modelName} type="submit" className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create lot"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NewJobOrder({ lots, modelYears, onDone }: { lots: Lot[]; modelYears: string[]; onDone: () => void }) {
  const { activeList } = useColors();
  const [lotId, setLotId] = useState(""); const [code, setCode] = useState(""); const [units, setUnits] = useState(25); const [modelYear, setModelYear] = useState(modelYears[0] ?? "2026");
  const [vins, setVins] = useState(""); const [engines, setEngines] = useState(""); const [colorPlan, setColorPlan] = useState("11U:10\n55U:15"); const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const plan: Record<string, number> = {};
      colorPlan.split("\n").map(s => s.trim()).filter(Boolean).forEach(line => {
        const [k, v] = line.split(":").map(s => s.trim());
        if (k && !isNaN(+v)) plan[k.toUpperCase()] = +v;
      });
      const vinList = vins.split(/\s+/).map(s => s.trim().toUpperCase()).filter(s => s.length === 17 || s.length === 19);
      if (vinList.length !== units) throw new Error(`VIN count (${vinList.length}) must equal units (${units})`);

      // Check for suffix collisions with completed vehicles
      const suffixes = vinList.map(v => v.slice(-5));
      const { data: completed } = await supabase.from("vehicles").select("vin_suffix").not("completed_at", "is", null).in("vin_suffix", suffixes);
      if (completed && completed.length > 0) {
        const colliding = completed.map(c => c.vin_suffix).join(", ");
        toast.warning(`VIN suffix collision with completed vehicles: ${colliding}. Proceeding anyway.`);
      }

      // Map color codes to UUIDs for job_order.color_plan
      const planWithUuids: Record<string, number> = {};
      for (const [code, qty] of Object.entries(plan)) {
        const color = activeList.find(c => c.code === code);
        if (color) planWithUuids[color.id] = qty;
        else toast.warning(`Color code ${code} not found, skipping`);
      }
      if (Object.keys(planWithUuids).length === 0) throw new Error("No valid color codes found");

      const { data: jo, error } = await supabase.from("job_orders").insert({
        lot_id: lotId, job_code: code.trim(), units, color_plan: planWithUuids, vin_sequence: vinList, status: "active", model_year: modelYear,
      }).select().single();
      if (error) throw error;

      // create vehicles, distributing planned colors round-robin from plan
      const planFlat: string[] = [];
      Object.entries(planWithUuids).forEach(([uuid, n]) => { for (let i = 0; i < n; i++) planFlat.push(uuid); });
      while (planFlat.length < units) planFlat.push(Object.keys(planWithUuids)[0]);

      const rows = vinList.map((vin, i) => ({
        vin, vin_suffix: stripVinStars(vin).slice(-5), lot_id: lotId, job_order_id: jo.id, planned_color_id: planFlat[i] ?? null, current_station: "warehouse" as const,
      }));
      const { error: ve } = await supabase.from("vehicles").insert(rows);
      if (ve) throw ve;

      // Create engines if provided
      const engineList = engines.split(/\s+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 4);
      if (engineList.length > 0) {
        const engineRows = engineList.map(en => ({
          engine_number: en,
          engine_suffix: en.slice(-4),
          lot_id: lotId,
          job_order_id: jo.id,
          status: "available" as const,
        }));
        const { error: ee } = await supabase.from("engines").insert(engineRows);
        if (ee) throw ee;
      }

      toast.success(`Job order + ${vinList.length} vehicles${engineList.length > 0 ? ` + ${engineList.length} engines` : ""} created`);
      setCode(""); setVins(""); setEngines(""); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Card><CardHeader><CardTitle className="text-base">New job order</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>Lot</Label>
            <Select value={lotId} onValueChange={setLotId}>
              <SelectTrigger><SelectValue placeholder="Select lot..." /></SelectTrigger>
              <SelectContent>
                {lots.map(l => <SelectItem key={l.id} value={l.id}>{l.lot_code} — {l.model}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Job code</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="JO-001-A" required /></div>
          <div className="space-y-1.5"><Label>Units</Label><Input type="number" min={1} value={units} onChange={e => setUnits(+e.target.value)} required /></div>
          <div className="space-y-1.5"><Label>Model year</Label>
            <Select value={modelYear} onValueChange={setModelYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {modelYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Color plan (CODE:count per line)</Label><Textarea value={colorPlan} onChange={e => setColorPlan(e.target.value)} className="font-mono text-xs" rows={4} /></div>
          <div className="space-y-1.5"><Label>VINs (one per line, 17 or 19 chars)</Label><Textarea value={vins} onChange={e => setVins(e.target.value)} className="font-mono text-xs" rows={4} /></div>
          <div className="space-y-1.5"><Label>Engine numbers (one per line, from Excel)</Label><Textarea value={engines} onChange={e => setEngines(e.target.value)} className="font-mono text-xs" rows={3} placeholder="Paste engine numbers, one per line" /></div>
          <Button disabled={busy} type="submit" className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create job order"}</Button>
          <p className="text-xs text-muted-foreground">Codes: {activeList.map(c => `${c.code}=${c.name}`).join(", ")}</p>
        </form>
      </CardContent>
    </Card>
  );
}

function NewPaintJobOrder({ modelYears, onDone }: { modelYears: string[]; onDone: () => void }) {
  const { activeList } = useColors();
  const [company, setCompany] = useState("");
  const [code, setCode] = useState("");
  const [units, setUnits] = useState(25);
  const [modelYear, setModelYear] = useState(modelYears[0] ?? "2026");
  const [vins, setVins] = useState("");
  const [colorPlan, setColorPlan] = useState("11U:10\n55U:15");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const plan: Record<string, number> = {};
      colorPlan.split("\n").map(s => s.trim()).filter(Boolean).forEach(line => {
        const [k, v] = line.split(":").map(s => s.trim());
        if (k && !isNaN(+v)) plan[k.toUpperCase()] = +v;
      });
      const vinList = vins.split(/\s+/).map(s => s.trim().toUpperCase()).filter(s => s.length === 17 || s.length === 19);
      if (vinList.length !== units) throw new Error(`VIN count (${vinList.length}) must equal units (${units})`);

      // Check for suffix collisions with completed vehicles
      const suffixes = vinList.map(v => v.slice(-5));
      const { data: completed } = await supabase.from("vehicles").select("vin_suffix").not("completed_at", "is", null).in("vin_suffix", suffixes);
      if (completed && completed.length > 0) {
        const colliding = completed.map(c => c.vin_suffix).join(", ");
        toast.warning(`VIN suffix collision with completed vehicles: ${colliding}. Proceeding anyway.`);
      }

      // Map color codes to UUIDs for job_order.color_plan
      const planWithUuids: Record<string, number> = {};
      for (const [code, qty] of Object.entries(plan)) {
        const color = activeList.find(c => c.code === code);
        if (color) planWithUuids[color.id] = qty;
        else toast.warning(`Color code ${code} not found, skipping`);
      }
      if (Object.keys(planWithUuids).length === 0) throw new Error("No valid color codes found");

      const { data: jo, error } = await supabase.from("job_orders").insert({
        lot_id: null,
        is_contract: true,
        contract_company: company.trim(),
        job_code: code.trim(),
        units,
        color_plan: planWithUuids,
        vin_sequence: vinList,
        status: "active",
        model_year: modelYear,
      }).select().single();
      if (error) throw error;

      // Create vehicles with current_station = "wbs" and lot_id = null
      const planFlat: string[] = [];
      Object.entries(planWithUuids).forEach(([uuid, n]) => { for (let i = 0; i < n; i++) planFlat.push(uuid); });
      while (planFlat.length < units) planFlat.push(Object.keys(planWithUuids)[0]);

      const rows = vinList.map((vin, i) => ({
        vin,
        vin_suffix: stripVinStars(vin).slice(-5),
        lot_id: null,
        job_order_id: jo.id,
        planned_color_id: planFlat[i] ?? null,
        current_station: "wbs" as const,
      }));
      const { error: ve } = await supabase.from("vehicles").insert(rows);
      if (ve) throw ve;

      toast.success(`Paint Job Order + ${vinList.length} vehicles created`);
      setCompany(""); setCode(""); setVins(""); onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">New Paint Job Order (Contract)</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>Company name</Label><Input value={company} onChange={e => setCompany(e.target.value)} placeholder="External Company Ltd" required /></div>
          <div className="space-y-1.5"><Label>Job code</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="PJ-001-A" required /></div>
          <div className="space-y-1.5"><Label>Units</Label><Input type="number" min={1} value={units} onChange={e => setUnits(+e.target.value)} required /></div>
          <div className="space-y-1.5"><Label>Model year</Label>
            <Select value={modelYear} onValueChange={setModelYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {modelYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Color plan (CODE:count per line)</Label><Textarea value={colorPlan} onChange={e => setColorPlan(e.target.value)} className="font-mono text-xs" rows={4} /></div>
          <div className="space-y-1.5"><Label>VINs (one per line, 17 or 19 chars)</Label><Textarea value={vins} onChange={e => setVins(e.target.value)} className="font-mono text-xs" rows={4} /></div>
          <Button disabled={busy} type="submit" className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Create Paint Job Order</>}</Button>
          <p className="text-xs text-muted-foreground">Contract vehicles arrive at WBS, get painted, then leave. No lot assignment needed.</p>
        </form>
      </CardContent>
    </Card>
  );
}

function NewMultiLotJobOrder({ lots, modelYears, onDone }: { lots: Lot[]; modelYears: string[]; onDone: () => void }) {
  const { activeList } = useColors();
  const activeLots = lots.filter(l => l.status === "active");
  const [code, setCode] = useState("");
  const [modelYear, setModelYear] = useState(modelYears[0] ?? "2026");
  const [colorPlan, setColorPlan] = useState("11U:10\n55U:15");
  const [lotRows, setLotRows] = useState<{ lotId: string; count: number; vins: string; engines: string }[]>([{ lotId: "", count: 10, vins: "", engines: "" }]);
  const [busy, setBusy] = useState(false);

  const totalUnits = lotRows.reduce((s, r) => s + r.count, 0);

  const addLotRow = () => setLotRows(prev => [...prev, { lotId: "", count: 10, vins: "", engines: "" }]);
  const removeLotRow = (idx: number) => {
    if (lotRows.length <= 1) return;
    setLotRows(prev => prev.filter((_, i) => i !== idx));
  };
  const updateLotRow = (idx: number, field: "lotId" | "count" | "vins" | "engines", value: string | number) => {
    setLotRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Validate at least 2 lots with valid lotId
      const validRows = lotRows.filter(r => r.lotId);
      if (validRows.length < 2) throw new Error("Select at least 2 lots for a multi-lot order");

      // Parse color plan
      const plan: Record<string, number> = {};
      colorPlan.split("\n").map(s => s.trim()).filter(Boolean).forEach(line => {
        const [k, v] = line.split(":").map(s => s.trim());
        if (k && !isNaN(+v)) plan[k.toUpperCase()] = +v;
      });
      const planWithUuids: Record<string, number> = {};
      for (const [code, qty] of Object.entries(plan)) {
        const color = activeList.find(c => c.code === code);
        if (color) planWithUuids[color.id] = qty;
        else toast.warning(`Color code ${code} not found, skipping`);
      }
      if (Object.keys(planWithUuids).length === 0) throw new Error("No valid color codes found");

      // Validate total VINs = sum of lot counts
      const allVins: string[] = [];
      const allEngines: string[] = [];
      const lotVinMap: { lotId: string; vins: string[]; engines: string[]; count: number }[] = [];

      for (const row of validRows) {
        const vinList = row.vins.split(/\s+/).map(s => s.trim().toUpperCase()).filter(s => s.length === 17 || s.length === 19);
        if (vinList.length !== row.count) throw new Error(`Lot row has ${vinList.length} VINs but count is ${row.count}`);
        allVins.push(...vinList);

        const engineList = row.engines.split(/\s+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 4);
        allEngines.push(...engineList);

        lotVinMap.push({ lotId: row.lotId, vins: vinList, engines: engineList, count: row.count });
      }

      if (allVins.length !== totalUnits) throw new Error(`Total VINs (${allVins.length}) must equal total units (${totalUnits})`);

      // Check suffix collisions
      const suffixes = allVins.map(v => v.slice(-5));
      const { data: completed } = await supabase.from("vehicles").select("vin_suffix").not("completed_at", "is", null).in("vin_suffix", suffixes);
      if (completed && completed.length > 0) {
        const colliding = completed.map(c => c.vin_suffix).join(", ");
        toast.warning(`VIN suffix collision with completed vehicles: ${colliding}. Proceeding anyway.`);
      }

      // Create job_order with lot_id: null (multi-lot)
      const { data: jo, error } = await supabase.from("job_orders").insert({
        lot_id: null,
        job_code: code.trim(),
        units: totalUnits,
        color_plan: planWithUuids,
        vin_sequence: allVins,
        status: "active",
        model_year: modelYear,
      }).select().single();
      if (error) throw error;

      // Build flat plan for distributing colors
      const planFlat: string[] = [];
      Object.entries(planWithUuids).forEach(([uuid, n]) => { for (let i = 0; i < n; i++) planFlat.push(uuid); });
      while (planFlat.length < totalUnits) planFlat.push(Object.keys(planWithUuids)[0]);

      let vehicleOffset = 0;
      for (const entry of lotVinMap) {
        // Insert into job_order_lots
        await supabase.from("job_order_lots").insert({
          job_order_id: jo.id,
          lot_id: entry.lotId,
          vehicle_count: entry.count,
        });

        // Create vehicles with this lot_id
        const rows = entry.vins.map((vin, i) => ({
          vin,
          vin_suffix: stripVinStars(vin).slice(-5),
          lot_id: entry.lotId,
          job_order_id: jo.id,
          planned_color_id: planFlat[vehicleOffset + i] ?? null,
          current_station: "warehouse" as const,
        }));
        const { error: ve } = await supabase.from("vehicles").insert(rows);
        if (ve) throw ve;

        // Create engines if provided
        if (entry.engines.length > 0) {
          const engineRows = entry.engines.map(en => ({
            engine_number: en,
            engine_suffix: en.slice(-4),
            lot_id: entry.lotId,
            job_order_id: jo.id,
            status: "available" as const,
          }));
          const { error: ee } = await supabase.from("engines").insert(engineRows);
          if (ee) throw ee;
        }

        vehicleOffset += entry.count;
      }

      toast.success(`Multi-lot job order + ${allVins.length} vehicles${allEngines.length > 0 ? ` + ${allEngines.length} engines` : ""} created`);
      setCode(""); setColorPlan("11U:10\n55U:15");
      setLotRows([{ lotId: "", count: 10, vins: "", engines: "" }]);
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Card><CardHeader><CardTitle className="text-base">New Multi-Lot Job Order</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>Job code</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="ML-JO-001" required /></div>
          {lotRows.map((row, idx) => (
            <div key={idx} className="space-y-2 border rounded-md p-2 relative">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Lot #{idx + 1}</Label>
                {lotRows.length > 1 && <button type="button" onClick={() => removeLotRow(idx)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>}
              </div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <Select value={row.lotId} onValueChange={v => updateLotRow(idx, "lotId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select lot..." /></SelectTrigger>
                    <SelectContent>
                      {activeLots.map(l => <SelectItem key={l.id} value={l.id}>{l.lot_code} — {l.model}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-20 space-y-1">
                  <Input type="number" min={1} value={row.count} onChange={e => updateLotRow(idx, "count", +e.target.value)} placeholder="Count" />
                </div>
              </div>
              <div className="space-y-1"><Label className="text-xs">VINs for this lot ({row.count} needed)</Label><Textarea value={row.vins} onChange={e => updateLotRow(idx, "vins", e.target.value)} className="font-mono text-xs" rows={3} placeholder="Paste VINs, one per line" /></div>
              <div className="space-y-1"><Label className="text-xs">Engine numbers (optional)</Label><Textarea value={row.engines} onChange={e => updateLotRow(idx, "engines", e.target.value)} className="font-mono text-xs" rows={2} placeholder="Paste engine numbers" /></div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addLotRow} className="w-full"><Plus className="h-3.5 w-3.5 mr-1" />Add another lot</Button>
          <div className="text-xs text-muted-foreground">Total units: <b>{totalUnits}</b></div>
          <div className="space-y-1.5"><Label>Model year</Label>
            <Select value={modelYear} onValueChange={setModelYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {modelYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Color plan (CODE:count per line)</Label><Textarea value={colorPlan} onChange={e => setColorPlan(e.target.value)} className="font-mono text-xs" rows={3} /></div>
          <Button disabled={busy} type="submit" className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Multi-Lot Job Order"}</Button>
          <p className="text-xs text-muted-foreground">Codes: {activeList.map(c => `${c.code}=${c.name}`).join(", ")}</p>
        </form>
      </CardContent>
    </Card>
  );
}

function EditLotDialog({ lot, models, trims, onSave, onClose }: {
  lot: Lot; models: Model[]; trims: ModelTrim[]; onSave: (updates: Record<string, any>) => void; onClose: () => void;
}) {
  const [code, setCode] = useState(lot.lot_code);
  const [chineseNumber, setChineseNumber] = useState(lot.chinese_number ?? "");
  const [modelName, setModelName] = useState(lot.model.includes(" — ") ? lot.model.split(" — ")[0] : lot.model);
  const [trimName, setTrimName] = useState(lot.model.includes(" — ") ? lot.model.split(" — ")[1] : "");
  const [units, setUnits] = useState(lot.total_units);
  const [busy, setBusy] = useState(false);

  const selectedModel = models.find(m => m.name === modelName);
  const modelTrims = selectedModel ? trims.filter(t => t.model_id === selectedModel.id) : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const modelValue = trimName ? `${modelName} — ${trimName}` : modelName;
    onSave({ lot_code: code.trim(), chinese_number: chineseNumber.trim() || null, model: modelValue.trim(), total_units: units, producible_units: Math.min((lot as any).producible_units ?? units, units) });
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Lot: {lot.lot_code}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>LOT No</Label><Input value={code} onChange={e => setCode(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label>Chinese number</Label><Input value={chineseNumber} onChange={e => setChineseNumber(e.target.value)} placeholder="Optional" /></div>
          <div className="space-y-1.5"><Label>Model</Label>
            {models.length > 0 ? (
              <Select value={modelName} onValueChange={v => { setModelName(v); setTrimName(""); }}>
                <SelectTrigger><SelectValue placeholder="Select model..." /></SelectTrigger>
                <SelectContent>
                  {models.map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input value={modelName} onChange={e => setModelName(e.target.value)} required />
            )}
          </div>
          {modelTrims.length > 0 && (
            <div className="space-y-1.5"><Label>Trim level</Label>
              <Select value={trimName} onValueChange={setTrimName}>
                <SelectTrigger><SelectValue placeholder="Select trim..." /></SelectTrigger>
                <SelectContent>
                  {modelTrims.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5"><Label>Total units</Label><Input type="number" min={1} value={units} onChange={e => setUnits(+e.target.value)} required /></div>
          {units !== lot.total_units && <p className="text-xs text-warning">Changing units will add/remove vehicles at warehouse.</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditJobDialog({ job, colors, modelYears, onSave, onClose }: {
  job: JobOrder; colors: { id: string; code: string; name: string; active: boolean }[]; modelYears: string[];
  onSave: (updates: Record<string, any>, newVins: string[], newColorPlan: Record<string, number>) => void; onClose: () => void;
}) {
  const activeList = colors.filter(c => c.active);
  // Convert UUID color_plan back to CODE:count format
  const initialColorText = Object.entries((job.color_plan as Record<string, number>) ?? {}).map(([uuid, qty]) => {
    const c = activeList.find(cl => cl.id === uuid);
    return c ? `${c.code}:${qty}` : `?${qty}`;
  }).join("\n");

  const [code, setCode] = useState(job.job_code);
  const [modelYear, setModelYear] = useState(job.model_year ?? modelYears[0] ?? "2026");
  const [units, setUnits] = useState(job.units);
  const [colorPlan, setColorPlan] = useState(initialColorText);
  const [vins, setVins] = useState((job.vin_sequence ?? []).join("\n"));
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const vinList = vins.split(/\s+/).map(s => s.trim().toUpperCase()).filter(s => s.length === 17 || s.length === 19);
      if (vinList.length !== units) throw new Error(`VIN count (${vinList.length}) must equal units (${units})`);

      // Parse color plan
      const planWithUuids: Record<string, number> = {};
      colorPlan.split("\n").map(s => s.trim()).filter(Boolean).forEach(line => {
        const [k, v] = line.split(":").map(s => s.trim());
        if (k && !isNaN(+v)) {
          const color = activeList.find(c => c.code === k.toUpperCase());
          if (color) planWithUuids[color.id] = +v;
        }
      });
      if (Object.keys(planWithUuids).length === 0) throw new Error("No valid color codes found");

      onSave(
        { job_code: code.trim(), units, color_plan: planWithUuids, vin_sequence: vinList, model_year: modelYear },
        vinList,
        planWithUuids,
      );
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit Job Order: {job.job_code}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>Job code</Label><Input value={code} onChange={e => setCode(e.target.value)} required /></div>
          <div className="flex gap-3">
            <div className="space-y-1.5 flex-1"><Label>Units</Label><Input type="number" min={1} value={units} onChange={e => setUnits(+e.target.value)} required /></div>
            <div className="space-y-1.5 flex-1"><Label>Model year</Label>
              <Select value={modelYear} onValueChange={setModelYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modelYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Color plan (CODE:count per line)</Label><Textarea value={colorPlan} onChange={e => setColorPlan(e.target.value)} className="font-mono text-xs" rows={3} /></div>
          <div className="space-y-1.5"><Label>VINs (one per line, 17 or 19 chars)</Label><Textarea value={vins} onChange={e => setVins(e.target.value)} className="font-mono text-xs" rows={5} /></div>
          <p className="text-xs text-warning">Saving will replace all vehicles in this job order.</p>
          <p className="text-xs text-muted-foreground">Codes: {activeList.map(c => `${c.code}=${c.name}`).join(", ")}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
