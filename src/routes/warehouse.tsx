import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Boxes, ClipboardList, Loader2, Plus, Printer, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { COLOR_CODES } from "@/lib/stations";
import { exportToCSV } from "@/lib/export";
import { JobOrderPrintView } from "@/components/JobOrderPrintView";
import type { Lot, JobOrder } from "@/lib/db-types";
import { useColors } from "@/hooks/use-colors";

export const Route = createFileRoute("/warehouse")({
  head: () => ({ meta: [{ title: "Warehouse — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { hasStation } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!hasStation("warehouse")) { toast.error("No access"); nav({ to: "/" }); } }, [hasStation, nav]);

  const [lots, setLots] = useState<Lot[]>([]);
  const [jobs, setJobs] = useState<JobOrder[]>([]);
  const [printJob, setPrintJob] = useState<JobOrder | null>(null);
  const [printLot, setPrintLot] = useState<Lot | null>(null);

  const handlePrint = async (job: JobOrder) => {
    const { data: lot } = await supabase.from("lots").select("*").eq("id", job.lot_id).maybeSingle();
    setPrintJob(job);
    setPrintLot(lot);
    setTimeout(() => window.print(), 150);
  };
  const reload = async () => {
    const [{ data: l }, { data: j }] = await Promise.all([
      supabase.from("lots").select("*").order("created_at", { ascending: false }),
      supabase.from("job_orders").select("*").order("created_at", { ascending: false }),
    ]);
    setLots(l ?? []); setJobs(j ?? []);
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

      <div className="grid md:grid-cols-2 gap-4">
        <NewLot onDone={reload} />
        <NewJobOrder lots={lots} onDone={reload} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Lots</CardTitle>
            {lots.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExportLots}>
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Export
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {lots.length === 0 ? <EmptyState icon={Boxes} title="No lots" description="Create your first lot to start receiving vehicles." /> : (
            <ul className="divide-y text-sm">
              {lots.map(l => <li key={l.id} className="py-2 flex justify-between"><span><b>{l.lot_code}</b>{l.chinese_number ? <span className="text-muted-foreground"> / {l.chinese_number}</span> : null} · {l.model}</span><span className="text-muted-foreground">{l.total_units} units · {l.status}</span></li>)}
            </ul>
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
                  <span><b>{j.job_code}</b> · {j.units} cars</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">{Object.entries(j.color_plan ?? {}).map(([k,v]) => `${k}:${v}`).join(" ")}</span>
                    <Button variant="outline" size="sm" className="h-7 no-print" onClick={() => handlePrint(j)}><Printer className="h-3.5 w-3.5 mr-1" />Print</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Print area — hidden on screen, visible only when printing */}
      {printJob && <JobOrderPrintView jobOrder={printJob} lot={printLot} />}
    </div>
  );
}

function NewLot({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState(""); const [chineseNumber, setChineseNumber] = useState(""); const [model, setModel] = useState(""); const [units, setUnits] = useState(50); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const user = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from("lots").insert({ lot_code: code.trim(), chinese_number: chineseNumber.trim() || null, model: model.trim(), total_units: units, status: "active", created_by: user?.id });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Lot created"); setCode(""); setChineseNumber(""); setModel(""); setUnits(50); onDone(); }
  };
  return (
    <Card><CardHeader><CardTitle className="text-base">New lot</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>LOT No (internal)</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="LOT-2026-001" required /></div>
          <div className="space-y-1.5"><Label>Chinese number (optional)</Label><Input value={chineseNumber} onChange={e => setChineseNumber(e.target.value)} placeholder="e.g. CN-2026-001" /></div>
          <div className="space-y-1.5"><Label>Model</Label><Input value={model} onChange={e => setModel(e.target.value)} placeholder="Sedan A" required /></div>
          <div className="space-y-1.5"><Label>Total units</Label><Input type="number" min={1} value={units} onChange={e => setUnits(+e.target.value)} required /></div>
          <Button disabled={busy} type="submit" className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Create lot</>}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NewJobOrder({ lots, onDone }: { lots: Lot[]; onDone: () => void }) {
  const { activeList } = useColors();
  const [lotId, setLotId] = useState(""); const [code, setCode] = useState(""); const [units, setUnits] = useState(25); const [modelYear, setModelYear] = useState("2026");
  const [vins, setVins] = useState(""); const [engines, setEngines] = useState(""); const [colorPlan, setColorPlan] = useState("11U:10\n55U:15"); const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const plan: Record<string, number> = {};
      colorPlan.split("\n").map(s => s.trim()).filter(Boolean).forEach(line => {
        const [k, v] = line.split(":").map(s => s.trim());
        if (k && !isNaN(+v)) plan[k.toUpperCase()] = +v;
      });
      const vinList = vins.split(/\s+/).map(s => s.trim().toUpperCase()).filter(s => s.length === 17);
      if (vinList.length !== units) throw new Error(`VIN count (${vinList.length}) must equal units (${units})`);

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
        vin, vin_suffix: vin.slice(-5), lot_id: lotId, job_order_id: jo.id, planned_color_id: planFlat[i] ?? null, current_station: "warehouse" as const,
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
                <SelectItem value="2026">2026</SelectItem>
                <SelectItem value="2027">2027</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Color plan (CODE:count per line)</Label><Textarea value={colorPlan} onChange={e => setColorPlan(e.target.value)} className="font-mono text-xs" rows={4} /></div>
          <div className="space-y-1.5"><Label>VINs (one per line, 17 chars)</Label><Textarea value={vins} onChange={e => setVins(e.target.value)} className="font-mono text-xs" rows={4} /></div>
          <div className="space-y-1.5"><Label>Engine numbers (one per line, from Excel)</Label><Textarea value={engines} onChange={e => setEngines(e.target.value)} className="font-mono text-xs" rows={3} placeholder="Paste engine numbers, one per line" /></div>
          <Button disabled={busy} type="submit" className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create job order"}</Button>
          <p className="text-xs text-muted-foreground">Codes: {Object.entries(COLOR_CODES).map(([k,v]) => `${k}=${v}`).join(", ")}</p>
        </form>
      </CardContent>
    </Card>
  );
}
