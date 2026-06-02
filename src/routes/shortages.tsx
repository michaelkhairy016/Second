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
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, CheckCircle2, Loader2, Download, AlertTriangle, Plus, X, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { findBySuffix } from "@/lib/vin";
import { exportToCSV } from "@/lib/export";
import type { ShortageWithVehicle, VehicleSearchResult } from "@/lib/db-types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useProductionMode } from "@/hooks/use-production-mode";
import { EmptyState } from "@/components/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/shortages")({
  head: () => ({ meta: [{ title: "Shortages — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { hasStation, isStaff, isSuperuser, stations } = useAuth();
  const { isLaunchMode } = useProductionMode();
  const nav = useNavigate();
  const allowed = isStaff || isSuperuser || hasStation("shortage") || stations.length > 0;
  useEffect(() => { if (!allowed) { toast.error("No access"); nav({ to: "/" }); } }, [allowed, nav]);

  const [open, setOpen] = useState<(ShortageWithVehicle & { part_type?: string | null; responsibility?: string | null; received_by?: string | null; released_by?: string | null })[]>([]);
  const reload = async () => {
    const { data } = await supabase.from("shortages").select("*, vehicle:vehicles(vin, current_station)").eq("status","open").order("created_at",{ascending:false});
    setOpen(data ?? []);
  };
  useEffect(() => { reload(); const ch = supabase.channel("sh").on("postgres_changes",{event:"*",schema:"public",table:"shortages"},reload).subscribe(); return () => { supabase.removeChannel(ch); }; }, []);

  const clearShortage = async (id: string, releasedBy: string) => {
    const user = (await supabase.auth.getUser()).data.user;
    // Get the vehicle_id before clearing
    const { data: sh } = await supabase.from("shortages").select("vehicle_id").eq("id", id).single();
    const { error } = await supabase.from("shortages").update({
      status: "cleared", cleared_by: user?.id, cleared_at: new Date().toISOString(),
      released_by: releasedBy || null,
    }).eq("id", id);
    // Move vehicle out of shortage station
    if (!error && sh?.vehicle_id) {
      await supabase.from("vehicles").update({ current_station: "waiting_repair" }).eq("id", sh.vehicle_id).eq("current_station", "shortage");
    }
    if (error) toast.error(error.message); else toast.success("Cleared");
  };

  const handleExport = async () => {
    const { data } = await supabase.from("shortages").select("*, vehicle:vehicles(vin)").order("created_at", { ascending: false });
    if (!data || data.length === 0) return toast.error("No data to export");
    exportToCSV(data.map(s => ({
      vin: (s.vehicle as { vin: string } | null)?.vin ?? "",
      parts: (s.parts as string[]).join("; "),
      part_type: s.part_type ?? "",
      responsibility: s.responsibility ?? "",
      status: s.status,
      notes: s.notes ?? "",
      received_by: s.received_by ?? "",
      released_by: s.released_by ?? "",
      created_at: s.created_at,
    })), `shortages-${new Date().toISOString().slice(0, 10)}`);
  };

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Stations</button>
      <div className="flex items-start justify-between">
        <div><h1 className="text-2xl font-semibold">Shortages</h1><p className="text-muted-foreground text-sm">Log missing parts; clear when received.</p></div>
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" /> Export</Button>
      </div>

      <NewShortage onDone={reload} />

      {isLaunchMode && (isStaff || isSuperuser) && (
        <ShortageBufferSection />
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Open shortages ({open.length})</CardTitle></CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="All clear" description="No open shortages at the moment." />
          ) : (
            <ul className="divide-y">
              {open.map(s => (
                <li key={s.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <div className="font-mono">{s.vehicle?.vin ?? ""}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {(s.parts as string[]).join(", ")}
                        {s.notes ? ` · ${s.notes}` : ""}
                      </div>
                      <div className="flex gap-1.5 mt-1">
                        <Badge variant={s.part_type === "ckd" ? "info" : s.part_type === "plastics" ? "warning" : "secondary"} className="text-[10px] px-1.5">{s.part_type === "ckd" ? "CKD" : s.part_type === "plastics" ? "Plastics" : "Local"}</Badge>
                        <Badge variant={s.responsibility === "afa" ? "warning" : "muted"} className="text-[10px] px-1.5">{s.responsibility === "afa" ? "Against AFA" : "Against Supplier"}</Badge>
                      </div>
                      {s.received_by && <div className="text-xs text-muted-foreground mt-1">Received by: {s.received_by}</div>}
                    </div>
                    <ClearButton onClear={(sig) => clearShortage(s.id, sig)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClearButton({ onClear }: { onClear: (signature: string) => void }) {
  const [signature, setSignature] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline"><CheckCircle2 className="h-4 w-4 mr-1" /> Clear</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear this shortage?</AlertDialogTitle>
          <AlertDialogDescription>Mark the shortage as received and release the vehicle.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-sm">Released by (name / signature)</Label>
          <Input value={signature} onChange={e => setSignature(e.target.value)} placeholder="اسم السائق / Driver name" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setSignature("")}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => { onClear(signature); setSignature(""); setOpen(false); }}>Clear shortage</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function NewShortage({ onDone }: { onDone: () => void }) {
  const [suffix, setSuffix] = useState("");
  const debouncedSuffix = useDebouncedValue(suffix, 300);
  const [picked, setPicked] = useState<VehicleSearchResult | null>(null);
  const [matches, setMatches] = useState<VehicleSearchResult[]>([]);
  const [parts, setParts] = useState("");
  const [notes, setNotes] = useState("");
  const [partType, setPartType] = useState<"ckd" | "local" | "plastics">("ckd");
  const [responsibility, setResponsibility] = useState<"afa" | "supplier">("supplier");
  const [shortageReason, setShortageReason] = useState("ckd");
  const [receivedBy, setReceivedBy] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (debouncedSuffix.trim().length < 3) { setMatches([]); return; }
    findBySuffix(debouncedSuffix).then(setMatches).catch(e => toast.error(e.message));
    setPicked(null);
  }, [debouncedSuffix]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return toast.error("Pick a VIN");
    const partList = parts.split(",").map(s => s.trim()).filter(Boolean);
    if (partList.length === 0) return toast.error("List at least one part");
    // Duplicate check: already has open shortage
    const { data: existing } = await supabase.from("shortages")
      .select("id").eq("vehicle_id", picked.id).eq("status", "open").maybeSingle();
    if (existing) { toast.warning("This vehicle already has an open shortage."); return; }
    setBusy(true);
    const user = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from("shortages").insert({
      vehicle_id: picked.id, parts: partList, notes: notes || null,
      created_by: user?.id, part_type: partType, responsibility,
      received_by: receivedBy || null, shortage_reason: shortageReason,
    });
    await supabase.from("vehicles").update({ current_station: "shortage" }).eq("id", picked.id);
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Shortage logged"); setSuffix(""); setPicked(null); setParts(""); setNotes(""); setPartType("ckd"); setResponsibility("supplier"); setReceivedBy(""); onDone(); }
  };

  return (
    <Card><CardHeader><CardTitle className="text-base">Log shortage</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5"><Label>VIN suffix</Label><Input value={suffix} onChange={e => setSuffix(e.target.value)} className="font-mono" /></div>
          {matches.length > 0 && !picked && (
            <div className="border rounded-md divide-y">
              {matches.map(m => (
                <button type="button" key={m.id} onClick={() => setPicked(m)} className="w-full text-left px-3 py-2 hover:bg-muted text-sm font-mono">{m.vin}</button>
              ))}
            </div>
          )}
          {picked && <div className="rounded-md border bg-muted/40 p-2 font-mono text-sm">{picked.vin}</div>}
          <div className="space-y-1.5">
            <Label>Missing parts (comma-separated, English / العربية)</Label>
            <Input value={parts} onChange={e => setParts(e.target.value)} placeholder="exhaust pipe, rear wiper / قطعة غيار" />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional details / تفاصيل إضافية" />
          </div>
          <div className="space-y-1.5">
            <Label>Shortage Reason</Label>
            <Select value={shortageReason} onValueChange={v => { setShortageReason(v); setPartType(v === "ckd" ? "ckd" : v === "plastics" ? "plastics" : "local"); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ckd">CKD</SelectItem>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="unavailable_factory">Unavailable in Factory</SelectItem>
                <SelectItem value="missing_plastics">Missing (Plastics Paint Shop)</SelectItem>
                <SelectItem value="missing_paint_miscolored">Scratches (Paint Shop)</SelectItem>
                <SelectItem value="general_missing">General Missing</SelectItem>
                <SelectItem value="plastics">Plastics</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Responsibility</Label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setResponsibility("afa")} className={`flex-1 py-2 rounded-md border text-xs font-medium ${responsibility === "afa" ? "bg-warning/20 border-warning text-warning" : "bg-muted border-border"}`}>Against AFA</button>
              <button type="button" onClick={() => setResponsibility("supplier")} className={`flex-1 py-2 rounded-md border text-xs font-medium ${responsibility === "supplier" ? "bg-info/20 border-info text-info" : "bg-muted border-border"}`}>Against Supplier</button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Received by (name / signature)</Label>
            <Input value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="اسم المستلم / Person who delivered" />
          </div>
          <Button disabled={busy || !picked} type="submit" className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log shortage"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ─── Shortage Buffer (Launch Mode) ─── */

interface BufferRecord {
  id: string;
  name: string;
  description: string | null;
  buffer_date: string;
  vehicle_ids: string[];
  status: string;
  created_at: string;
}

function ShortageBufferSection() {
  const [buffers, setBuffers] = useState<BufferRecord[]>([]);
  const [vehicles, setVehicles] = useState<Record<string, { vin: string }[]>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addVinSuffix, setAddVinSuffix] = useState("");
  const [addBufferId, setAddBufferId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("shortage_buffers")
      .select("*").eq("status", "active").order("created_at", { ascending: false });
    const bufferData = (data ?? []) as BufferRecord[];
    setBuffers(bufferData);
    // Load vehicle VINs for each buffer
    const vMap: Record<string, { vin: string }[]> = {};
    for (const b of bufferData) {
      if (b.vehicle_ids && b.vehicle_ids.length > 0) {
        const { data: vData } = await supabase.from("vehicles").select("vin").in("id", b.vehicle_ids);
        vMap[b.id] = (vData ?? []) as { vin: string }[];
      } else {
        vMap[b.id] = [];
      }
    }
    setVehicles(vMap);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("shortage-buffers")
      .on("postgres_changes", { event: "*", schema: "public", table: "shortage_buffers" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const createBuffer = async () => {
    if (!newName.trim()) return toast.error("Name required");
    setBusy(true);
    const user = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from("shortage_buffers").insert({
      name: newName.trim(), description: newDesc || null,
      buffer_date: newDate, created_by: user?.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Buffer created");
      setNewName(""); setNewDesc(""); setShowCreate(false);
      load();
    }
  };

  const closeBuffer = async (id: string) => {
    await supabase.from("shortage_buffers").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", id);
    toast.success("Buffer closed");
  };

  const addVehicleToBuffer = async (bufferId: string) => {
    if (addVinSuffix.trim().length < 3) return toast.error("Enter at least 3 digits");
    setBusy(true);
    const matches = await findBySuffix(addVinSuffix);
    if (matches.length === 0) { toast.error("No vehicle found"); setBusy(false); return; }
    const v = matches[0];
    const buffer = buffers.find(b => b.id === bufferId);
    if (!buffer) { setBusy(false); return; }
    if (buffer.vehicle_ids.includes(v.id)) { toast.warning("Already in buffer"); setBusy(false); return; }
    const newIds = [...buffer.vehicle_ids, v.id];
    const { error } = await supabase.from("shortage_buffers").update({ vehicle_ids: newIds }).eq("id", bufferId);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Added ${v.vin}`);
      setAddVinSuffix(""); setAddBufferId(null);
      load();
    }
  };

  const removeVehicleFromBuffer = async (bufferId: string, vehicleId: string) => {
    const buffer = buffers.find(b => b.id === bufferId);
    if (!buffer) return;
    const newIds = buffer.vehicle_ids.filter(id => id !== vehicleId);
    await supabase.from("shortage_buffers").update({ vehicle_ids: newIds }).eq("id", bufferId);
    toast.success("Removed");
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> Shortage Buffers</span>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" /> New Buffer</Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {showCreate && (
          <div className="border rounded-md p-3 space-y-2">
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Buffer name (e.g. Missing sensor batch)" />
            <Input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)" />
            <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={createBuffer}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}</Button>
              <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {buffers.length === 0 && !showCreate && (
          <p className="text-sm text-muted-foreground">No active buffers. Create one to group vehicles by shortage issue.</p>
        )}

        {buffers.map(b => (
          <div key={b.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-sm">{b.name}</div>
                <div className="text-xs text-muted-foreground">
                  {b.buffer_date} · {b.vehicle_ids.length} vehicle(s)
                </div>
                {b.description && <div className="text-xs text-muted-foreground mt-1">{b.description}</div>}
              </div>
              <Button size="sm" variant="outline" onClick={() => closeBuffer(b.id)}>Close</Button>
            </div>

            {/* Vehicle list */}
            {vehicles[b.id]?.length > 0 && (
              <ul className="space-y-1">
                {vehicles[b.id].map((v, i) => (
                  <li key={i} className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1">
                    <span className="font-mono">{v.vin}</span>
                    <button onClick={() => removeVehicleFromBuffer(b.id, b.vehicle_ids[i])} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add vehicle */}
            {addBufferId === b.id ? (
              <div className="flex gap-2">
                <Input value={addVinSuffix} onChange={e => setAddVinSuffix(e.target.value)} placeholder="VIN suffix" className="font-mono text-sm" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addVehicleToBuffer(b.id); } }} />
                <Button size="sm" disabled={busy} onClick={() => addVehicleToBuffer(b.id)}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAddBufferId(null); setAddVinSuffix(""); }}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setAddBufferId(b.id)}><Plus className="h-3 w-3 mr-1" /> Add vehicle</Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
