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
import { ArrowLeft, CheckCircle2, Loader2, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { findBySuffix } from "@/lib/vin";
import { exportToCSV } from "@/lib/export";
import type { ShortageWithVehicle, VehicleSearchResult } from "@/lib/db-types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { EmptyState } from "@/components/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/shortages")({
  head: () => ({ meta: [{ title: "Shortages — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { hasStation, isStaff, isSuperuser } = useAuth();
  const nav = useNavigate();
  const allowed = hasStation("shortage") || isStaff || isSuperuser;
  useEffect(() => { if (!allowed) { toast.error("No access"); nav({ to: "/" }); } }, [allowed, nav]);

  const [open, setOpen] = useState<(ShortageWithVehicle & { part_type?: string | null; responsibility?: string | null; received_by?: string | null; released_by?: string | null })[]>([]);
  const reload = async () => {
    const { data } = await supabase.from("shortages").select("*, vehicle:vehicles(vin, current_station)").eq("status","open").order("created_at",{ascending:false});
    setOpen(data ?? []);
  };
  useEffect(() => { reload(); const ch = supabase.channel("sh").on("postgres_changes",{event:"*",schema:"public",table:"shortages"},reload).subscribe(); return () => { supabase.removeChannel(ch); }; }, []);

  const clearShortage = async (id: string, releasedBy: string) => {
    const user = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from("shortages").update({
      status: "cleared", cleared_by: user?.id, cleared_at: new Date().toISOString(),
      released_by: releasedBy || null,
    }).eq("id", id);
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
                      <div className="font-mono">…{s.vehicle?.vin?.slice(-6)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {(s.parts as string[]).join(", ")}
                        {s.notes ? ` · ${s.notes}` : ""}
                      </div>
                      <div className="flex gap-1.5 mt-1">
                        <Badge variant={s.part_type === "ckd" ? "info" : "secondary"} className="text-[10px] px-1.5">{s.part_type === "ckd" ? "CKD" : "Local"}</Badge>
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
  const [partType, setPartType] = useState<"ckd" | "local">("ckd");
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
                <button type="button" key={m.id} onClick={() => setPicked(m)} className="w-full text-left px-3 py-2 hover:bg-muted text-sm font-mono">…{m.vin.slice(-8)}</button>
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
            <Select value={shortageReason} onValueChange={v => { setShortageReason(v); setPartType(v === "ckd" ? "ckd" : "local"); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ckd">CKD</SelectItem>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="unavailable_factory">Unavailable in Factory</SelectItem>
                <SelectItem value="missing_plastics">Missing (Plastics Paint Shop)</SelectItem>
                <SelectItem value="missing_paint_miscolored">Missing (Paint Shop — Miscolored)</SelectItem>
                <SelectItem value="general_missing">General Missing</SelectItem>
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
