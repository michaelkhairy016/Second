import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { stationByCode, COLOR_CODES } from "@/lib/stations";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { findBySuffix } from "@/lib/vin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, AlertTriangle, CheckCircle2, ClipboardList, FileSpreadsheet } from "lucide-react";
import type { StationEventWithVehicle, StationCode } from "@/lib/db-types";

export const Route = createFileRoute("/station/$code")({
  head: ({ params }) => ({ meta: [{ title: `${stationByCode(params.code)?.label ?? "Station"} — AFA Shopfloor` }] }),
  component: () => <RequireAuth><AppShell><StationPage /></AppShell></RequireAuth>,
});

function StationPage() {
  const { code } = Route.useParams();
  const station = stationByCode(code);
  const { hasStation } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (station && !hasStation(station.code)) { toast.error("You do not have access to this station"); nav({ to: "/" }); }
    if (station?.code === "warehouse") nav({ to: "/warehouse" });
    if (station?.code === "shortage") nav({ to: "/shortages" });
  }, [station, hasStation, nav]);

  if (!station || station.code === "warehouse" || station.code === "shortage") return null;

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Stations</button>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-lg bg-primary/10 text-primary grid place-items-center"><station.icon className="h-6 w-6" /></div>
        <div>
          <h1 className="text-xl font-semibold">{station.label}</h1>
          <p className="text-sm text-muted-foreground">{station.description}</p>
        </div>
      </div>

      <ScanForm station={station.code} />
      {station.code === "wbs" && <BulkPasteSection station="wbs" />}
      {station.code === "pbs" && <PBSLotSummary />}
      <RecentEvents station={station.code} />
    </div>
  );
}

function ScanForm({ station }: { station: StationCode }) {
  const [suffix, setSuffix] = useState("");
  const debouncedSuffix = useDebouncedValue(suffix, 300);
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof findBySuffix>>>([]);
  const [picked, setPicked] = useState<typeof matches[number] | null>(null);
  const [color, setColor] = useState("");
  const [busy, setBusy] = useState(false);
  const [lotCode, setLotCode] = useState<string | null>(null);

  // Quality check fields
  const [qualityStatus, setQualityStatus] = useState<"ok" | "issue">("ok");
  const [issueText, setIssueText] = useState("");
  const [pbsCondition, setPbsCondition] = useState<"ok" | "damaged" | "dismantled" | "missing_part">("ok");
  const [pbsNotes, setPbsNotes] = useState("");
  const [lotShortageWarning, setLotShortageWarning] = useState<string | null>(null);

  useEffect(() => {
    if (picked?.lot_id && station === "pbs") {
      supabase.from("lots").select("lot_code").eq("id", picked.lot_id).maybeSingle()
        .then(({ data }) => setLotCode(data?.lot_code ?? null));
    } else { setLotCode(null); }
  }, [picked?.lot_id, station]);

  // PBS lot-shortage check: if any vehicle in the same lot has open shortage, warn
  useEffect(() => {
    if (station !== "pbs" || !picked?.lot_id) { setLotShortageWarning(null); return; }
    let cancel = false;
    (async () => {
      const { data: lotVehicles } = await supabase.from("vehicles").select("id").eq("lot_id", picked.lot_id);
      if (!lotVehicles || cancel) return;
      const { count } = await supabase.from("shortages").select("id", { count: "exact", head: true })
        .eq("status", "open").in("vehicle_id", lotVehicles.map(v => v.id));
      if (!cancel) setLotShortageWarning(count && count > 0 ? `${count} open shortage(s) in this lot — DO NOT proceed to general assembly` : null);
    })();
    return () => { cancel = true; };
  }, [picked?.lot_id, station, picked?.id]);

  useEffect(() => {
    if (debouncedSuffix.trim().length < 3) { setMatches([]); return; }
    let cancel = false;
    findBySuffix(debouncedSuffix).then(d => { if (!cancel) setMatches(d); }).catch(e => toast.error(e.message));
    return () => { cancel = true; };
  }, [debouncedSuffix]);

  useEffect(() => { setPicked(null); setColor(""); setQualityStatus("ok"); setIssueText(""); setPbsCondition("ok"); setPbsNotes(""); setLotShortageWarning(null); }, [debouncedSuffix]);

  const submit = async (kind: "in" | "out") => {
    if (!picked) return toast.error("Pick a VIN first");
    if (station === "paint" && kind === "in" && !color) return toast.error("Color required");
    if (station === "wbs" && kind === "in" && qualityStatus === "issue" && !issueText.trim()) return toast.error("Describe the issue");
    if (station === "pbs" && kind === "in" && pbsCondition !== "ok" && !pbsNotes.trim()) return toast.error("Add notes about the condition");
    setBusy(true);
    try {
      // Paint warning: count actual color usages in same job_order
      if (station === "paint" && kind === "in" && picked.job_order_id) {
        const { data: jo } = await supabase.from("job_orders").select("color_plan").eq("id", picked.job_order_id).maybeSingle();
        const plan = (jo?.color_plan as Record<string, number>) ?? {};
        const limit = plan[color];
        if (typeof limit === "number") {
          const { count } = await supabase.from("station_events").select("id", { count: "exact", head: true })
            .eq("station", "paint").eq("kind", "in").eq("color_used", color)
            .in("vehicle_id", (await supabase.from("vehicles").select("id").eq("job_order_id", picked.job_order_id)).data?.map(v => v.id) ?? []);
          if ((count ?? 0) >= limit) {
            const ok = window.confirm(`Color ${color} already used ${count}/${limit} for this job. Override and continue?`);
            if (!ok) { setBusy(false); return; }
          }
        }
      }

      // PBS lot-shortage block
      if (station === "pbs" && kind === "out" && lotShortageWarning) {
        const ok = window.confirm(`⚠️ ${lotShortageWarning}\n\nOverride and allow vehicle to leave PBS?`);
        if (!ok) { setBusy(false); return; }
      }

      // Build meta JSON for quality checks
      const meta: Record<string, string> = {};
      if (station === "wbs" && kind === "in") {
        meta.quality = qualityStatus;
        if (qualityStatus === "issue") meta.issue = issueText.trim();
      }
      if (station === "pbs" && kind === "in") {
        meta.condition = pbsCondition;
        if (pbsNotes.trim()) meta.notes = pbsNotes.trim();
      }

      const user = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase.from("station_events").insert({
        vehicle_id: picked.id, station, kind, color_used: color || null, recorded_by: user?.id, source: "manual",
        meta: Object.keys(meta).length > 0 ? meta : null,
      });
      if (error) throw error;

      // Create issue record for WBS issues
      if (station === "wbs" && kind === "in" && qualityStatus === "issue") {
        await supabase.from("issues").insert({
          vehicle_id: picked.id, station: "wbs", title: issueText.trim(),
          severity: "medium", status: "open",
        });
      }

      // Create issue record for PBS problems
      if (station === "pbs" && kind === "in" && pbsCondition !== "ok") {
        const condLabel = pbsCondition === "damaged" ? "Damaged" : pbsCondition === "dismantled" ? "Dismantled" : "Missing part";
        await supabase.from("issues").insert({
          vehicle_id: picked.id, station: "pbs", title: `${condLabel}: ${pbsNotes.trim()}`,
          severity: pbsCondition === "missing_part" ? "high" : "medium", status: "open",
        });
      }

      const update: { current_station: typeof station; actual_color?: string } = { current_station: station };
      if (station === "paint" && kind === "in" && color) update.actual_color = color;
      await supabase.from("vehicles").update(update).eq("id", picked.id);

      if (picked.is_lot_tail) toast.warning(`⚠️ Lot-tail vehicle: ${picked.tail_note ?? "Flagged"}`);
      if (lotShortageWarning && kind === "out") toast.warning(`⚠️ Vehicle released despite lot shortages`);
      toast.success(`Recorded: ${picked.vin.slice(-5)} ${kind.toUpperCase()}`);
      setSuffix(""); setPicked(null); setColor(""); setQualityStatus("ok"); setIssueText(""); setPbsCondition("ok"); setPbsNotes("");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const needsColor = station === "paint";
  const needsWbsCheck = station === "wbs";
  const needsPbsCheck = station === "pbs";

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Scan VIN suffix</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="vin">Last 4–5 digits</Label>
          <Input id="vin" autoFocus value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="e.g. 12345" inputMode="numeric" className="text-lg font-mono tracking-widest" />
        </div>

        {matches.length > 0 && !picked && (
          <div className="border rounded-md divide-y">
            {matches.map(m => (
              <button key={m.id} onClick={() => setPicked(m)} className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm">
                <span className="font-mono">…{m.vin.slice(-8)}</span>
                <span className="text-xs text-muted-foreground">
                  {m.current_station ?? "—"} · plan {m.planned_color ?? "—"}
                </span>
              </button>
            ))}
          </div>
        )}

        {picked && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="font-mono text-base">{picked.vin}</div>
            <div className="text-xs text-muted-foreground">
              At <b>{picked.current_station ?? "—"}</b> · Plan: {picked.planned_color ?? "—"} · Actual: {picked.actual_color ?? "—"}
            </div>
            {lotCode && (
              <div className="flex items-center gap-1.5 text-xs mt-1">
                <Badge variant="info">Lot: {lotCode}</Badge>
              </div>
            )}
            {picked.is_lot_tail && (
              <div className="flex items-center gap-1 text-warning text-xs"><AlertTriangle className="h-3 w-3" /> Lot-tail flag: {picked.tail_note}</div>
            )}
            {lotShortageWarning && (
              <div className="flex items-center gap-1 text-destructive text-xs mt-1"><AlertTriangle className="h-3 w-3" /> {lotShortageWarning}</div>
            )}
          </div>
        )}

        {needsColor && picked && (
          <div className="space-y-1.5">
            <Label htmlFor="col">Color code</Label>
            <Input id="col" value={color} onChange={e => setColor(e.target.value.toUpperCase())} placeholder="11U" className="font-mono" />
            <div className="text-xs text-muted-foreground">{COLOR_CODES[color] ? `→ ${COLOR_CODES[color]}` : "Codes: 11U white · 22U silver · 33U black · 44U blue · 55U red"}</div>
          </div>
        )}

        {/* WBS quality check */}
        {needsWbsCheck && picked && (
          <div className="border rounded-md p-3 space-y-2">
            <Label className="text-sm font-medium">Vehicle condition</Label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setQualityStatus("ok")} className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${qualityStatus === "ok" ? "bg-success/20 border-success text-success" : "bg-muted border-border hover:bg-muted/80"}`}>
                <CheckCircle2 className="h-4 w-4 inline mr-1" /> OK
              </button>
              <button type="button" onClick={() => setQualityStatus("issue")} className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${qualityStatus === "issue" ? "bg-warning/20 border-warning text-warning" : "bg-muted border-border hover:bg-muted/80"}`}>
                <AlertTriangle className="h-4 w-4 inline mr-1" /> Issue
              </button>
            </div>
            {qualityStatus === "issue" && (
              <Textarea rows={2} value={issueText} onChange={e => setIssueText(e.target.value)} placeholder="Describe the issue (English / العربية)" />
            )}
          </div>
        )}

        {/* PBS condition check */}
        {needsPbsCheck && picked && (
          <div className="border rounded-md p-3 space-y-2">
            <Label className="text-sm font-medium">Body condition</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["ok", "damaged", "dismantled", "missing_part"] as const).map(c => (
                <button key={c} type="button" onClick={() => setPbsCondition(c)} className={`py-2 rounded-md border text-xs font-medium transition-colors ${pbsCondition === c ? (c === "ok" ? "bg-success/20 border-success text-success" : c === "damaged" ? "bg-warning/20 border-warning text-warning" : c === "dismantled" ? "bg-destructive/20 border-destructive text-destructive" : "bg-info/20 border-info text-info") : "bg-muted border-border hover:bg-muted/80"}`}>
                  {c === "ok" ? "OK ✓" : c === "damaged" ? "Damaged" : c === "dismantled" ? "Dismantled" : "Missing Part"}
                </button>
              ))}
            </div>
            {pbsCondition !== "ok" && (
              <Textarea rows={2} value={pbsNotes} onChange={e => setPbsNotes(e.target.value)} placeholder="Describe the condition (English / العربية)" />
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" disabled={!picked || busy} className="flex-1" onClick={() => submit("in")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" /> IN</>}
          </Button>
          <Button disabled={!picked || busy} className="flex-1" onClick={() => submit("out")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>OUT <ArrowRight className="h-4 w-4 ml-1" /></>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentEvents({ station }: { station: StationCode }) {
  const [rows, setRows] = useState<StationEventWithVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase.from("station_events")
        .select("id, kind, color_used, recorded_at, meta, vehicle:vehicles(vin)")
        .eq("station", station).order("recorded_at", { ascending: false }).limit(8);
      if (!cancelled) { setRows(data ?? []); setLoading(false); }
    };
    load();
    const ch = supabase.channel(`ev-${station}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "station_events", filter: `station=eq.${station}` }, load).subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [station]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-8 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No events yet" description="Events will appear here as vehicles are scanned in or out of this station." />
        ) : (
          <ul className="divide-y">
            {rows.map(r => {
              const meta = r.meta as Record<string, string> | null;
              return (
                <li key={r.id} className="py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant={r.kind === "in" ? "info" : "success"}>{r.kind.toUpperCase()}</Badge>
                    <span className="font-mono text-xs">…{r.vehicle?.vin?.slice(-6)}</span>
                    {r.color_used && <span className="text-xs text-muted-foreground">{r.color_used}</span>}
                    {meta?.quality === "issue" && <Badge variant="warning" className="text-[10px] px-1">Issue</Badge>}
                    {meta?.condition && meta.condition !== "ok" && <Badge variant="warning" className="text-[10px] px-1">{meta.condition}</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(r.recorded_at).toLocaleTimeString()}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BulkPasteSection({ station }: { station: StationCode }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"in" | "out">("in");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ matched: number; missing: string[] } | null>(null);
  const [showBulk, setShowBulk] = useState(false);

  const run = async () => {
    setBusy(true); setReport(null);
    try {
      const tokens = text.split(/\s+|[,;]/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (tokens.length === 0) throw new Error("Paste at least one VIN or suffix");

      const matched: { id: string; vin: string }[] = [];
      const missing: string[] = [];
      for (const t of tokens) {
        const q = t.length === 17
          ? supabase.from("vehicles").select("id, vin").eq("vin", t).maybeSingle()
          : supabase.from("vehicles").select("id, vin").ilike("vin_suffix", `%${t.slice(-5)}`).limit(1).maybeSingle();
        const { data } = await q;
        if (data) matched.push(data); else missing.push(t);
      }
      if (matched.length === 0) throw new Error("No vehicles found");

      const user = (await supabase.auth.getUser()).data.user;
      const events = matched.map(m => ({ vehicle_id: m.id, station, kind, recorded_by: user?.id, source: "bulk" }));
      const { error: ee } = await supabase.from("station_events").insert(events);
      if (ee) throw ee;
      await supabase.from("vehicles").update({ current_station: station }).in("id", matched.map(m => m.id));
      setReport({ matched: matched.length, missing });
      toast.success(`Updated ${matched.length} vehicles`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!showBulk) {
    return (
      <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setShowBulk(true)}>
        <CardContent className="py-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-info/10 text-info grid place-items-center"><FileSpreadsheet className="h-5 w-5" /></div>
          <div><div className="text-sm font-medium">Bulk paste from Excel</div><div className="text-xs text-muted-foreground">Paste multiple VINs at once</div></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" />Bulk paste from Excel</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Paste one VIN per line — full VINs or suffixes" className="font-mono text-xs" />
        <div className="flex gap-2 items-center">
          <Label className="text-sm">Direction</Label>
          <select value={kind} onChange={e => setKind(e.target.value as "in" | "out")} className="border rounded-md px-2 py-1 text-sm bg-background">
            <option value="in">IN to WBS (Body)</option>
            <option value="out">OUT of WBS (Body)</option>
          </select>
          <Button className="ml-auto" disabled={busy} onClick={run}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply to all"}</Button>
        </div>
        {report && (
          <div className="text-sm space-y-1 pt-2 border-t">
            <div className="text-success">Matched: {report.matched}</div>
            {report.missing.length > 0 && <details><summary className="text-warning text-xs cursor-pointer">Not found: {report.missing.length}</summary><div className="font-mono text-xs mt-1">{report.missing.join("\n")}</div></details>}
          </div>
        )}
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setShowBulk(false); setText(""); setReport(null); }}>Close</Button>
      </CardContent>
    </Card>
  );
}

function PBSLotSummary() {
  const [groups, setGroups] = useState<{ lot_code: string; model: string; count: number }[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, lot:lots(lot_code, model)")
        .eq("current_station", "pbs");
      const map = new Map<string, { lot_code: string; model: string; count: number }>();
      (data ?? []).forEach((v: any) => {
        const key = v.lot?.lot_code ?? "Unassigned";
        const existing = map.get(key);
        if (existing) existing.count++;
        else map.set(key, { lot_code: key, model: v.lot?.model ?? "—", count: 1 });
      });
      setGroups(Array.from(map.values()).sort((a, b) => b.count - a.count));
    };
    load();
    const ch = supabase.channel("pbs-lots")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles", filter: "current_station=eq.pbs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">PBS by Lot</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {groups.map(g => (
            <li key={g.lot_code} className="py-2 flex items-center justify-between">
              <div>
                <span className="font-medium">{g.lot_code}</span>
                <span className="text-muted-foreground"> · {g.model}</span>
              </div>
              <Badge variant="secondary">{g.count} bod{g.count !== 1 ? "ies" : "y"}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
