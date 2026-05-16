import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { stationByCode } from "@/lib/stations";
import { stripVinStars } from "@/lib/vin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { StationCode } from "@/lib/db-types";

// Direction constraints per station
const DIRECTION_CONSTRAINTS: Partial<Record<StationCode, "in" | "out" | "both">> = {
  tcf: "out",
  waiting_repair: "both",
  tcf_offline: "in",
  repair: "both",
  cs: "both",
  pdi: "both",
  line_feeding: "both",
};

interface PendingVin {
  raw: string;
  id: string;
  vin: string;
  currentStation: string | null;
  model: string;
  found: boolean;
  editing: boolean;
}

export const Route = createFileRoute("/bulk/$code")({
  head: ({ params }) => ({ meta: [{ title: `Bulk ${stationByCode(params.code)?.label} — AFA Shopfloor` }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { code } = Route.useParams();
  const station = stationByCode(code);
  const { isStaff, isSuperuser } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!(isStaff || isSuperuser)) { toast.error("Staff only"); nav({ to: "/" }); } }, [isStaff, isSuperuser, nav]);

  const [text, setText] = useState("");
  const [kind, setKind] = useState<"in" | "out">("in");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ matched: number; missing: string[] } | null>(null);
  const [pendingVins, setPendingVins] = useState<PendingVin[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editValue, setEditValue] = useState("");

  if (!station) return null;

  const allowedDir = DIRECTION_CONSTRAINTS[station.code as StationCode] ?? "both";
  const effectiveKind = allowedDir !== "both" ? allowedDir : kind;

  const lookupVins = async () => {
    setBusy(true);
    try {
      const tokens = text.split(/\s+|[,;]/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (tokens.length === 0) throw new Error("Paste at least one VIN or suffix");

      // Classify tokens by length for batch lookups
      const fullVins: string[] = [];
      const fullVinVariants: string[] = [];
      const suffixes5: string[] = [];
      const suffixes4: string[] = [];
      const tokenInfo: Array<{ raw: string; clean: string; kind: "full" | "suf5" | "suf4"; idx: number }> = [];

      tokens.forEach((raw, idx) => {
        const clean = stripVinStars(raw);
        if (clean.length === 17 || clean.length === 19) {
          fullVins.push(clean);
          fullVinVariants.push(clean, `*${clean}*`);
          tokenInfo.push({ raw, clean, kind: "full", idx });
        } else if (clean.length === 5) {
          suffixes5.push(clean);
          tokenInfo.push({ raw, clean, kind: "suf5", idx });
        } else {
          suffixes4.push(clean.slice(-4));
          tokenInfo.push({ raw, clean, kind: "suf4", idx });
        }
      });

      // Batch queries — map vehicle id → {vin, current_station, lot_id}
      const vehicleMap = new Map<string, { id: string; vin: string; current_station: string | null; lot_id: string | null }>();

      if (fullVins.length > 0) {
        const { data } = await supabase.from("vehicles").select("id,vin,current_station,lot_id").in("vin", fullVinVariants).is("completed_at", null);
        (data ?? []).forEach(v => vehicleMap.set(v.id, v));
        // Map each full VIN token to its vehicle
      }
      if (suffixes5.length > 0) {
        const { data } = await supabase.from("vehicles").select("id,vin,current_station,lot_id").in("vin_suffix", suffixes5).is("completed_at", null);
        (data ?? []).forEach(v => { if (!vehicleMap.has(v.id)) vehicleMap.set(v.id, v); });
      }

      // For full VINs: build lookup by vin value
      const vinLookup = new Map<string, typeof vehicleMap extends Map<string, infer V> ? V : never>();
      for (const v of vehicleMap.values()) {
        vinLookup.set(v.vin, v);
      }

      // Build results in original token order
      const results: PendingVin[] = [];
      const lotIds = new Set<string>();

      for (const info of tokenInfo) {
        let data: { id: string; vin: string; current_station: string | null; lot_id: string | null } | null = null;

        if (info.kind === "full") {
          data = vinLookup.get(info.clean) ?? vinLookup.get(`*${info.clean}*`) ?? null;
        } else if (info.kind === "suf5") {
          for (const v of vehicleMap.values()) {
            if (v.vin?.slice(-5) === info.clean) { data = v; break; }
          }
        } else {
          // 4-char suffix: individual ilike query (can't batch pattern matching)
          const { data: d } = await supabase.from("vehicles").select("id,vin,current_station,lot_id").ilike("vin_suffix", `%${info.clean.slice(-4)}`).is("completed_at", null).limit(1).maybeSingle();
          data = d;
        }

        if (data) {
          lotIds.add(data.lot_id ?? "");
          results.push({ raw: info.raw, id: data.id, vin: data.vin, currentStation: data.current_station, model: "", found: true, editing: false });
        } else {
          results.push({ raw: info.raw, id: "", vin: "", currentStation: null, model: "", found: false, editing: false });
        }
      }

      // Batch fetch lot models (single query)
      if (lotIds.size > 0 && !lotIds.has("")) {
        const { data: lots } = await supabase.from("lots").select("id, model").in("id", [...lotIds].filter(Boolean));
        const lotModelMap = new Map((lots ?? []).map(l => [l.id, l.model]));
        // vehicleMap already has lot_id per vehicle — use it directly
        for (const r of results) {
          if (!r.found) continue;
          const v = vehicleMap.get(r.id);
          if (v?.lot_id) r.model = lotModelMap.get(v.lot_id) ?? "—";
        }
      }

      const foundCount = results.filter(r => r.found).length;
      if (foundCount === 0) throw new Error("No vehicles found");

      setPendingVins(results);
      setDialogOpen(true);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const startEdit = (idx: number) => {
    setEditValue(pendingVins[idx].raw);
    setPendingVins(prev => prev.map((v, i) => i === idx ? { ...v, editing: true } : v));
  };

  const cancelEdit = (idx: number) => {
    setPendingVins(prev => prev.map((v, i) => i === idx ? { ...v, editing: false } : v));
  };

  const confirmEdit = async (idx: number) => {
    const raw = editValue.trim().toUpperCase();
    if (!raw) { cancelEdit(idx); return; }
    const clean = stripVinStars(raw);
    const q = clean.length === 17 || clean.length === 19
      ? supabase.from("vehicles").select("id, vin, current_station, lot_id").in("vin", [clean, `*${clean}*`]).is("completed_at", null).maybeSingle()
      : supabase.from("vehicles").select("id, vin, current_station, lot_id").ilike("vin_suffix", `%${clean.slice(-4)}`).is("completed_at", null).limit(1).maybeSingle();
    const { data } = await q;

    setPendingVins(prev => prev.map((v, i) => {
      if (i !== idx) return v;
      if (data) {
        let model = "—";
        if (data.lot_id) {
          supabase.from("lots").select("model").eq("id", data.lot_id).maybeSingle()
            .then(({ data: lot }) => {
              if (lot) setPendingVins(p => p.map((vv, ii) => ii === idx ? { ...vv, model: lot.model } : vv));
            });
        }
        return { raw, id: data.id, vin: data.vin, currentStation: data.current_station, model, found: true, editing: false };
      }
      return { raw, id: "", vin: "", currentStation: null, model: "", found: false, editing: false };
    }));
  };

  const executeBulk = async () => {
    const matched = pendingVins.filter(v => v.found);
    if (matched.length === 0) { toast.error("No valid vehicles"); return; }
    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const events = matched.map(m => ({ vehicle_id: m.id, station: station.code as StationCode, kind: effectiveKind as "in" | "out", recorded_by: user?.id, source: "bulk" }));
      const { error: ee } = await supabase.from("station_events").insert(events);
      if (ee) throw ee;
      await supabase.from("vehicles").update({ current_station: station.code }).in("id", matched.map(m => m.id));

      // For OUT events, advance station per flow rules
      if (effectiveKind === "out") {
        const nextStationMap: Partial<Record<StationCode, StationCode>> = {
          wbs: "paint", pbs: "tcf", tcf: "waiting_repair", waiting_repair: "repair", repair: "cs",
        };
        const nextStation = nextStationMap[station.code as StationCode];
        if (nextStation) {
          await supabase.from("vehicles").update({ current_station: nextStation }).in("id", matched.map(m => m.id));
        }
      }

      // Mark vehicles as completed when they exit PDI
      if (effectiveKind === "out" && station.code === "pdi") {
        await supabase.from("vehicles").update({ completed_at: new Date().toISOString() }).in("id", matched.map(m => m.id));
      }

      const missing = pendingVins.filter(v => !v.found);
      setReport({ matched: matched.length, missing: missing.map(v => v.raw) });
      setDialogOpen(false);
      toast.success(`Updated ${matched.length} vehicles`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const foundCount = pendingVins.filter(v => v.found).length;
  const missingCount = pendingVins.filter(v => !v.found).length;

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Stations</button>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-lg bg-info/10 text-info grid place-items-center"><station.icon className="h-6 w-6" /></div>
        <div><h1 className="text-xl font-semibold">Bulk: {station.label}</h1><p className="text-sm text-muted-foreground">Paste from Excel or manual sheets — full VINs, last 4 or last 5 digits.</p></div>
      </div>

      <Card><CardContent className="pt-6 space-y-3">
        <div className="space-y-1.5"><Label>VIN list</Label>
          <Textarea rows={10} value={text} onChange={e => setText(e.target.value)} placeholder="Paste VINs — full 17 chars, last 4, or last 5 digits" className="font-mono text-xs" />
        </div>
        <div className="flex gap-2 items-center">
          <Label className="text-sm">Direction</Label>
          {allowedDir === "both" ? (
            <Select value={kind} onValueChange={(v) => setKind(v as "in" | "out")}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">IN to {station.label}</SelectItem>
                <SelectItem value="out">OUT of {station.label}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm font-medium px-2 py-1 rounded border bg-muted">
              {allowedDir === "in" ? "IN" : "OUT"} — {station.label}
            </span>
          )}
          <Button className="ml-auto" disabled={busy} onClick={lookupVins}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & Apply"}</Button>
        </div>
        {report && (
          <div className="text-sm space-y-1 pt-2 border-t">
            <div className="text-success">✓ Matched: {report.matched}</div>
            {report.missing.length > 0 && <details><summary className="text-warning text-xs cursor-pointer">Not found: {report.missing.length}</summary><div className="font-mono text-xs mt-1">{report.missing.join("\n")}</div></details>}
          </div>
        )}
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Verify VINs — {effectiveKind === "in" ? "IN to" : "OUT of"} {station.label}</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground mb-2">{foundCount} found, {missingCount} not found. Click <Pencil className="h-3 w-3 inline" /> to edit a VIN.</div>
          <div className="flex-1 overflow-y-auto space-y-1 text-sm">
            {pendingVins.map((v, idx) => (
              <div key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-md border ${v.found ? "bg-card" : "bg-destructive/5 border-destructive/30"}`}>
                <span className="text-xs text-muted-foreground w-6 text-right">{idx + 1}</span>
                {v.editing ? (
                  <Input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") confirmEdit(idx); if (e.key === "Escape") cancelEdit(idx); }}
                    className="font-mono text-xs flex-1 h-7"
                    autoFocus
                  />
                ) : (
                  <span className="font-mono text-xs flex-1 truncate">{v.found ? v.vin.slice(-8) : v.raw}</span>
                )}
                {v.found && !v.editing && (
                  <>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{stationByCode(v.currentStation ?? "")?.label ?? v.currentStation ?? "?"}</Badge>
                    <span className="text-xs text-muted-foreground shrink-0 max-w-[120px] truncate">{v.model}</span>
                  </>
                )}
                {!v.found && !v.editing && <Badge variant="destructive" className="text-[10px] shrink-0">Not found</Badge>}
                {v.editing ? (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => confirmEdit(idx)} className="p-1 rounded hover:bg-success/20 text-success"><Check className="h-3.5 w-3.5" /></button>
                    <button onClick={() => cancelEdit(idx)} className="p-1 rounded hover:bg-destructive/20 text-destructive"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <button onClick={() => startEdit(idx)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"><Pencil className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={busy || foundCount === 0} onClick={executeBulk}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm ${foundCount} vehicle${foundCount !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
