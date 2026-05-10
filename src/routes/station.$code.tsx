import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { stationByCode, COLOR_CODES, loadColorMap } from "@/lib/stations";
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
import { ArrowLeft, ArrowRight, Loader2, AlertTriangle, CheckCircle2, ClipboardList, FileSpreadsheet, Plus, X, Package } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { StationEventWithVehicle, StationCode } from "@/lib/db-types";
import { useColors } from "@/hooks/use-colors";

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
  }, [station, hasStation, nav]);

  if (!station || station.code === "warehouse") return null;

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
      {["wbs", "body_shop"].includes(station.code) && <BulkPasteSection station={station.code as "wbs" | "body_shop"} />}
      {station.code === "pbs" && <PBSLotSummary />}
      {station.code === "paint" && <PaintWaitingVehicles />}
      {station.code !== "paint" && station.code !== "shortage" && <RecentEvents station={station.code} />}
      {station.code === "shortage" && <ShortageStationView />}
    </div>
  );
}

interface IssueRow {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  reported_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

function VehicleConditionSection({ vehicleId, station }: { vehicleId: string; station: StationCode }) {
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReportForm, setShowReportForm] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const loadIssues = async () => {
    const { data } = await supabase
      .from("issues")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("created_at", { ascending: false });
    setIssues((data as IssueRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    loadIssues();
    const ch = supabase.channel(`issues-${vehicleId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues", filter: `vehicle_id=eq.${vehicleId}` }, loadIssues)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [vehicleId]);

  const openIssues = issues.filter(i => i.status === "open" || i.status === "in_progress");
  const resolvedIssues = issues.filter(i => i.status === "resolved" || i.status === "closed");
  const hasOpenIssues = openIssues.length > 0;

  const handleReportIssue = async () => {
    const title = newIssueTitle.trim();
    if (!title) return toast.error("Describe the issue");
    setSubmitting(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase.from("issues").insert({
        vehicle_id: vehicleId,
        station,
        title,
        severity: "medium",
        status: "open",
        reported_by: user?.id ?? null,
      });
      if (error) throw error;
      setNewIssueTitle("");
      setShowReportForm(false);
      toast.success("Issue reported");
      loadIssues();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (issueId: string) => {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase.from("issues").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id ?? null,
      }).eq("id", issueId);
      if (error) throw error;
      toast.success("Issue resolved");
      loadIssues();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) {
    return (
      <div className="border rounded-md p-3">
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {hasOpenIssues ? (
            <>
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-warning">Issue ({openIssues.length} open)</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-success">OK</span>
            </>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowReportForm(!showReportForm)}>
          {showReportForm ? "Cancel" : "Report New Issue"}
        </Button>
      </div>

      {showReportForm && (
        <div className="space-y-2 pt-1">
          <Input
            value={newIssueTitle}
            onChange={e => setNewIssueTitle(e.target.value)}
            placeholder="Describe the issue (English / العربية)"
            onKeyDown={e => { if (e.key === "Enter") handleReportIssue(); }}
          />
          <Button size="sm" disabled={submitting || !newIssueTitle.trim()} onClick={handleReportIssue}>
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Submit Issue"}
          </Button>
        </div>
      )}

      {openIssues.length > 0 && (
        <ul className="divide-y border rounded-md">
          {openIssues.map(issue => (
            <li key={issue.id} className="px-3 py-2 flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Badge variant="warning" className="text-[10px] px-1">{issue.severity}</Badge>
                  <span className="truncate">{issue.title}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(issue.created_at).toLocaleString()}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => handleResolve(issue.id)}>
                Resolve
              </Button>
            </li>
          ))}
        </ul>
      )}

      {resolvedIssues.length > 0 && (
        <details open={showResolved} onToggle={e => setShowResolved((e.target as HTMLDetailsElement).open)}>
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            {resolvedIssues.length} resolved issue{resolvedIssues.length !== 1 ? "s" : ""}
          </summary>
          <ul className="divide-y border rounded-md mt-1">
            {resolvedIssues.map(issue => (
              <li key={issue.id} className="px-3 py-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{issue.title}</span>
                <span className="shrink-0 ml-2">
                  {issue.resolved_at ? new Date(issue.resolved_at).toLocaleTimeString() : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
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

  const [lotShortageWarning, setLotShortageWarning] = useState<string | null>(null);

  // Vehicle restrictions
  const [restrictions, setRestrictions] = useState<Array<{ id: string; restriction: string; stop_at_station: string; status: string }>>([]);

  useEffect(() => {
    if (!picked?.id) { setRestrictions([]); return; }
    let cancel = false;
    (async () => {
      const { data } = await supabase.from("vehicle_restrictions")
        .select("id, restriction, stop_at_station, status")
        .eq("vehicle_id", picked.id)
        .eq("status", "active");
      if (!cancel) setRestrictions((data ?? []) as typeof restrictions);
    })();
    return () => { cancel = true; };
  }, [picked?.id]);

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
      const { data: lotVehicles } = await supabase.from("vehicles").select("id").eq("lot_id", picked.lot_id!);
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

  useEffect(() => { setPicked(null); setColor(""); setLotShortageWarning(null); setRestrictions([]); }, [debouncedSuffix]);

  const submit = async (kind: "in" | "out") => {
    if (!picked) return toast.error("Pick a VIN first");
    if (station === "paint" && !color) return toast.error("Color required");
    setBusy(true);
    try {
      // Paint station: special handling - no station_events, only update vehicle
      if (station === "paint") {
        // Paint warning: count actual color usages in same job_order
        if (picked.job_order_id && color) {
          const { data: jo } = await supabase.from("job_orders").select("color_plan").eq("id", picked.job_order_id).maybeSingle();
          const plan = (jo?.color_plan as Record<string, number>) ?? {};
          const limit = plan[color];
          if (typeof limit === "number") {
            const { count } = await supabase.from("vehicles").select("id", { count: "exact", head: true })
              .eq("job_order_id", picked.job_order_id).eq("actual_color_id", color);
            if ((count ?? 0) >= limit) {
              const colorMap = await loadColorMap();
              const colorName = colorMap.get(color)?.name ?? color;
              const ok = window.confirm(`Color ${colorName} already used ${count}/${limit} for this job. Override and continue?`);
              if (!ok) { setBusy(false); return; }
            }
          }
        }
        // Only update vehicle, no station_events for paint
        await supabase.from("vehicles").update({ actual_color_id: color }).eq("id", picked.id);
        toast.success(`Color assigned: ${picked.vin.slice(-5)}`);
        setSuffix(""); setPicked(null); setColor("");
        setBusy(false);
        return;
      }

      // Restriction confirmation: if vehicle has active restrictions matching this station, confirm before proceeding
      const matchingRestrictions = restrictions.filter(r => r.stop_at_station === station);
      if (matchingRestrictions.length > 0) {
        const ok = window.confirm(
          `⚠️ This vehicle has restrictions at this station:\n${matchingRestrictions.map(r => r.restriction).join('\n')}\n\nProceed anyway?`
        );
        if (!ok) { setBusy(false); return; }
      }

      // PBS lot-shortage block
      if (station === "pbs" && kind === "out" && lotShortageWarning) {
        const ok = window.confirm(`⚠️ ${lotShortageWarning}\n\nOverride and allow vehicle to leave PBS?`);
        if (!ok) { setBusy(false); return; }
      }

      const user = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase.from("station_events").insert({
        vehicle_id: picked.id, station, kind, color_used_id: null, recorded_by: user?.id, source: "manual",
        meta: null,
      });
      if (error) throw error;

      // Determine next station: only advance for specific OUT flows
      const nextStationMap: Partial<Record<StationCode, StationCode>> = {
        wbs: "paint",
        pbs: "tcf",
        tcf: "waiting_repair",
        waiting_repair: "repair",
        repair: "cs",
      };
      const nextStation = (kind === "out" && nextStationMap[station]) ? nextStationMap[station]! : station;

      await supabase.from("vehicles").update({ current_station: nextStation }).eq("id", picked.id);

      if (picked.is_lot_tail) toast.warning(`⚠️ Lot-tail vehicle: ${picked.tail_note ?? "Flagged"}`);
      if (lotShortageWarning && kind === "out") toast.warning(`⚠️ Vehicle released despite lot shortages`);
      toast.success(`Recorded: ${picked.vin.slice(-5)} ${kind.toUpperCase()}`);
      setSuffix(""); setPicked(null); setColor("");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const needsColor = station === "paint";

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
            {matches
              .filter(m => station === "paint" ? m.current_station === "paint" : true)
              .map(m => (
              <button key={m.id} onClick={() => setPicked(m)} className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm">
                <span className="font-mono">…{m.vin.slice(-8)}</span>
                <span className="text-xs text-muted-foreground">
                  {m.current_station ?? "—"}
                </span>
              </button>
            ))}
          </div>
        )}

        {picked && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="font-mono text-base">{picked.vin}</div>
            <VehicleColorDisplay vehicle={picked} />
            {station === "paint" && picked.job_order_id && (
              <ColorPlanTracking jobId={picked.job_order_id} selectedColorId={color} />
            )}
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
            {restrictions.length > 0 && (
              <div className="mt-2 rounded-md border-2 border-destructive bg-destructive/10 p-2">
                <div className="flex items-center gap-1 text-destructive text-xs font-bold">
                  <AlertTriangle className="h-4 w-4" /> RESTRICTED VEHICLE
                </div>
                <ul className="mt-1 text-xs space-y-0.5">
                  {restrictions.map(r => (
                    <li key={r.id}>• {r.restriction} → Stop at {stationByCode(r.stop_at_station)?.label ?? r.stop_at_station}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {needsColor && picked && (
          <ColorPicker color={color} setColor={setColor} />
        )}

        {station !== "paint" && picked && (
          <VehicleConditionSection vehicleId={picked.id} station={station} />
        )}

        <div className="flex gap-2 pt-1">
          {station === "paint" ? (
            <Button disabled={!picked || busy} className="w-full" onClick={() => submit("in")}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>IN to {stationByCode(station)?.label ?? station}</>}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={!picked || busy} className="flex-1" onClick={() => submit("in")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" /> IN to {stationByCode(station)?.label ?? station}</>}
              </Button>
              <Button disabled={!picked || busy} className="flex-1" onClick={() => submit("out")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>OUT of {stationByCode(station)?.label ?? station} <ArrowRight className="h-4 w-4 ml-1" /></>}
              </Button>
            </>
          )}
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
        .select("id, kind, color_used_id, recorded_at, meta, vehicle:vehicles(vin)")
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
                    {r.color_used_id && <EventColorDisplay colorId={r.color_used_id} />}
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
  const stationLabel = stationByCode(station)?.label ?? station;
  const [showBulk, setShowBulk] = useState(false);

  const run = async () => {
    setBusy(true); setReport(null);
    try {
      const tokens = text.split(/\s+|[,;]/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (tokens.length === 0) throw new Error("Paste at least one VIN or suffix");

      const matched: { id: string; vin: string }[] = [];
      const missing: string[] = [];
      for (const t of tokens) {
        const q = t.length === 17 || t.length === 19
          ? supabase.from("vehicles").select("id, vin").eq("vin", t).is("completed_at", null).maybeSingle()
          : supabase.from("vehicles").select("id, vin").ilike("vin_suffix", `%${t.slice(-5)}`).is("completed_at", null).limit(1).maybeSingle();
        const { data } = await q;
        if (data) matched.push(data); else missing.push(t);
      }
      if (matched.length === 0) throw new Error("No vehicles found");

      const user = (await supabase.auth.getUser()).data.user;
      const events = matched.map(m => ({ vehicle_id: m.id, station, kind, recorded_by: user?.id, source: "bulk" }));
      const { error: ee } = await supabase.from("station_events").insert(events);
      if (ee) throw ee;
      await supabase.from("vehicles").update({ current_station: station }).in("id", matched.map(m => m.id));
      // Mark vehicles as completed when they exit PDI
      if (kind === "out" && station === "pdi") {
        await supabase.from("vehicles").update({ completed_at: new Date().toISOString() }).in("id", matched.map(m => m.id));
      }
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
            <option value="in">IN to {stationLabel}</option>
            <option value="out">OUT of {stationLabel}</option>
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

// Shortage station types
interface ShortageRecord {
  id: string;
  parts: string[];
  part_type: string | null;
  responsibility: string | null;
  received_by: string | null;
  released_by: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  cleared_at: string | null;
}

function ShortageStationView() {
  const [suffix, setSuffix] = useState("");
  const debouncedSuffix = useDebouncedValue(suffix, 300);
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof findBySuffix>>>([]);
  const [picked, setPicked] = useState<typeof matches[number] | null>(null);
  const [mode, setMode] = useState<"in" | "out">("in");
  const [parts, setParts] = useState("");
  const [notes, setNotes] = useState("");
  const [partType, setPartType] = useState<"ckd" | "local">("ckd");
  const [responsibility, setResponsibility] = useState<"afa" | "supplier">("supplier");
  const [receivedBy, setReceivedBy] = useState("");
  const [shortages, setShortages] = useState<ShortageRecord[]>([]);
  const [stationVehicles, setStationVehicles] = useState<Array<{ vin: string; vin_suffix: string; id: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (debouncedSuffix.trim().length < 3) { setMatches([]); return; }
    let cancel = false;
    findBySuffix(debouncedSuffix).then(d => { if (!cancel) setMatches(d); }).catch(e => toast.error(e.message));
    return () => { cancel = true; };
  }, [debouncedSuffix]);

  useEffect(() => {
    setPicked(null); setParts(""); setNotes(""); setPartType("ckd"); setResponsibility("supplier"); setReceivedBy(""); setShortages([]);
  }, [debouncedSuffix]);

  useEffect(() => {
    if (!picked) { setShortages([]); return; }
    let cancel = false;
    const load = async () => {
      const { data } = await supabase.from("shortages")
        .select("id, parts, part_type, responsibility, received_by, released_by, status, notes, created_at, cleared_at")
        .eq("vehicle_id", picked.id)
        .order("created_at", { ascending: false });
      if (!cancel) setShortages((data ?? []) as unknown as ShortageRecord[]);
    };
    load();
    const ch = supabase.channel(`shortages-${picked.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shortages", filter: `vehicle_id=eq.${picked.id}` }, load)
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [picked]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("vehicles").select("id, vin, vin_suffix").eq("current_station", "shortage").order("created_at", { ascending: true });
      setStationVehicles(data ?? []);
    };
    load();
    const ch = supabase.channel("shortage-station-vehicles")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles", filter: "current_station=eq.shortage" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const resetScan = () => { setSuffix(""); setPicked(null); setMatches([]); setParts(""); setNotes(""); setPartType("ckd"); setResponsibility("supplier"); setReceivedBy(""); };

  const submitIn = async () => {
    if (!picked) return toast.error("Pick a VIN first");
    const partList = parts.split(",").map(s => s.trim()).filter(Boolean);
    if (partList.length === 0) return toast.error("List at least one part");
    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const { error: se } = await supabase.from("shortages").insert({ vehicle_id: picked.id, parts: partList, notes: notes || null, created_by: user?.id, part_type: partType, responsibility, received_by: receivedBy || null });
      if (se) throw se;
      const { error: ev } = await supabase.from("station_events").insert({ vehicle_id: picked.id, station: "shortage", kind: "in", recorded_by: user?.id, source: "manual" });
      if (ev) throw ev;
      await supabase.from("vehicles").update({ current_station: "shortage" } as any).eq("id", picked.id);
      toast.success(`Shortage logged: ${picked.vin.slice(-5)}`);
      resetScan();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const clearShortage = async (shortageId: string, releasedBy: string) => {
    if (!picked) return;
    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const { error: se } = await supabase.from("shortages").update({ status: "cleared" as any, cleared_at: new Date().toISOString(), released_by: releasedBy || null, cleared_by: user?.id ?? null } as any).eq("id", shortageId);
      if (se) throw se;
      const { error: ev } = await supabase.from("station_events").insert({ vehicle_id: picked.id, station: "shortage", kind: "out", recorded_by: user?.id, source: "manual" });
      if (ev) throw ev;
      toast.success("Shortage cleared");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const openShortages = shortages.filter(s => s.status === "open");

  return (
    <div className="space-y-4">
      <ShortageStationSummary vehicles={stationVehicles} />
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" /> Scan VIN suffix</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="shortage-vin">Last 4–5 digits</Label><Input id="shortage-vin" autoFocus value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="e.g. 12345" inputMode="numeric" className="text-lg font-mono tracking-widest" /></div>
          {matches.length > 0 && !picked && (
            <div className="border rounded-md divide-y">
              {matches.map(m => (<button key={m.id} onClick={() => setPicked(m)} className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm"><span className="font-mono">…{m.vin.slice(-8)}</span><span className="text-xs text-muted-foreground">{m.current_station ?? "—"}</span></button>))}
            </div>
          )}
          {picked && (<div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1"><div className="font-mono text-base">{picked.vin}</div><div className="text-xs text-muted-foreground">At <b>{picked.current_station ?? "—"}</b></div></div>)}
          {picked && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode("in")} className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${mode === "in" ? "bg-info/20 border-info text-info" : "bg-muted border-border hover:bg-muted/80"}`}><Plus className="h-4 w-4 inline mr-1" /> Log Shortage (IN)</button>
              <button type="button" onClick={() => setMode("out")} className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${mode === "out" ? "bg-success/20 border-success text-success" : "bg-muted border-border hover:bg-muted/80"}`}><CheckCircle2 className="h-4 w-4 inline mr-1" /> Clear & Release (OUT)</button>
            </div>
          )}
          {picked && mode === "in" && (
            <div className="border rounded-md p-3 space-y-3">
              <Label className="text-sm font-medium">Log new shortage</Label>
              <div className="space-y-1.5"><Label>Missing parts (comma-separated)</Label><Input value={parts} onChange={e => setParts(e.target.value)} placeholder="exhaust pipe, rear wiper / قطعة غيار" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Part type</Label><div className="flex gap-2"><button type="button" onClick={() => setPartType("ckd")} className={`flex-1 py-2 rounded-md border text-sm font-medium ${partType === "ckd" ? "bg-info/20 border-info text-info" : "bg-muted border-border"}`}>CKD</button><button type="button" onClick={() => setPartType("local")} className={`flex-1 py-2 rounded-md border text-sm font-medium ${partType === "local" ? "bg-info/20 border-info text-info" : "bg-muted border-border"}`}>Local</button></div></div>
                <div className="space-y-1.5"><Label>Responsibility</Label><div className="flex gap-2"><button type="button" onClick={() => setResponsibility("afa")} className={`flex-1 py-2 rounded-md border text-xs font-medium ${responsibility === "afa" ? "bg-warning/20 border-warning text-warning" : "bg-muted border-border"}`}>Against AFA</button><button type="button" onClick={() => setResponsibility("supplier")} className={`flex-1 py-2 rounded-md border text-xs font-medium ${responsibility === "supplier" ? "bg-info/20 border-info text-info" : "bg-muted border-border"}`}>Against Supplier</button></div></div>
              </div>
              <div className="space-y-1.5"><Label>Received by (name)</Label><Input value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="اسم المستلم / Person who delivered" /></div>
              <div className="space-y-1.5"><Label>Notes (optional)</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional details / تفاصيل إضافية" /></div>
              <Button disabled={busy} className="w-full" onClick={submitIn}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Log Shortage</>}</Button>
            </div>
          )}
          {picked && mode === "out" && (
            <div className="border rounded-md p-3 space-y-3">
              <Label className="text-sm font-medium">Open shortages for this vehicle</Label>
              {openShortages.length === 0 ? (<p className="text-sm text-muted-foreground py-2">No open shortages. Use IN tab to log one.</p>) : (
                <ul className="divide-y">
                  {openShortages.map(s => (
                    <li key={s.id} className="py-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm space-y-1">
                          <div className="font-mono text-xs">{(s.parts as string[]).join(", ")}</div>
                          <div className="flex gap-1.5"><Badge variant={s.part_type === "ckd" ? "info" : "secondary"} className="text-[10px] px-1.5">{s.part_type === "ckd" ? "CKD" : "Local"}</Badge><Badge variant={s.responsibility === "afa" ? "warning" : "muted"} className="text-[10px] px-1.5">{s.responsibility === "afa" ? "Against AFA" : "Against Supplier"}</Badge></div>
                          {s.received_by && <div className="text-xs text-muted-foreground">Received by: {s.received_by}</div>}
                          {s.notes && <div className="text-xs text-muted-foreground">{s.notes}</div>}
                          <div className="text-[10px] text-muted-foreground">{new Date(s.created_at).toLocaleString()}</div>
                        </div>
                        <ShortageClearButton onClear={(sig) => clearShortage(s.id, sig)} disabled={busy} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {picked && shortages.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Shortage history ({shortages.length})</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-xs">
                  {shortages.map(s => (
                    <li key={s.id} className="py-2 flex items-center justify-between">
                      <div className="min-w-0"><div className="font-mono">{(s.parts as string[]).join(", ")}</div><div className="text-muted-foreground mt-0.5">{s.part_type === "ckd" ? "CKD" : "Local"} · {s.responsibility === "afa" ? "AFA" : "Supplier"}{s.received_by ? ` · Rec: ${s.received_by}` : ""}{s.released_by ? ` · Rel: ${s.released_by}` : ""}</div></div>
                      <div className="shrink-0 ml-2"><Badge variant={s.status === "open" ? "destructive" : "success"} className="text-[10px] px-1.5">{s.status === "open" ? "OPEN" : "CLEARED"}</Badge></div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {picked && (<Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetScan}><X className="h-4 w-4 mr-1" /> Reset scan</Button>)}
        </CardContent>
      </Card>
    </div>
  );
}

function ShortageClearButton({ onClear, disabled }: { onClear: (signature: string) => void; disabled: boolean }) {
  const [signature, setSignature] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={disabled}><CheckCircle2 className="h-4 w-4 mr-1" /> Clear & Release</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Clear this shortage?</AlertDialogTitle><AlertDialogDescription>Mark as cleared and release the vehicle.</AlertDialogDescription></AlertDialogHeader>
        <div className="space-y-2 py-2"><Label className="text-sm">Released by (name / signature)</Label><Input value={signature} onChange={e => setSignature(e.target.value)} placeholder="اسم السائق / Driver name" /></div>
        <AlertDialogFooter><AlertDialogCancel onClick={() => setSignature("")}>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { onClear(signature); setSignature(""); setOpen(false); }}>Clear shortage</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ShortageStationSummary({ vehicles }: { vehicles: Array<{ vin: string; vin_suffix: string; id: string }> }) {
  if (vehicles.length === 0) {
    return (<Card><CardContent className="py-4"><EmptyState icon={Package} title="No vehicles at shortage" description="Vehicles will appear here when they have open shortages." /></CardContent></Card>);
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">At Shortage Station ({vehicles.length})</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">{vehicles.map(v => (<li key={v.id} className="py-2 flex items-center justify-between"><span className="font-mono text-xs">…{v.vin.slice(-6)}</span><Badge variant="secondary" className="text-[10px]">shortage</Badge></li>))}</ul>
      </CardContent>
    </Card>
  );
}

// Helper components for color display
function VehicleColorDisplay({ vehicle }: { vehicle: { planned_color_id: string | null; actual_color_id: string | null; current_station: string | null } }) {
  const { getName, getCode } = useColors();
  return (
    <div className="text-xs text-muted-foreground">
      At <b>{vehicle.current_station ?? "—"}</b> · Plan: {getCode(vehicle.planned_color_id)} · Actual: {getCode(vehicle.actual_color_id)}
    </div>
  );
}

function EventColorDisplay({ colorId }: { colorId: string }) {
  const { getCode } = useColors();
  const code = getCode(colorId);
  return <span className="text-xs text-muted-foreground">{code}</span>;
}

function ColorPicker({ color, setColor }: { color: string; setColor: (v: string) => void }) {
  const { activeList } = useColors();
  return (
    <div className="space-y-1.5">
      <Label htmlFor="col">Color</Label>
      <select
        id="col"
        value={color}
        onChange={e => setColor(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
      >
        <option value="">Select color...</option>
        {activeList.map(c => (
          <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
        ))}
      </select>
    </div>
  );
}

function PaintWaitingVehicles() {
  const [vehicles, setVehicles] = useState<Array<{ vin: string; vin_suffix: string; planned_color_id: string | null; id: string }>>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, vin, vin_suffix, planned_color_id")
        .eq("current_station", "paint")
        .order("created_at", { ascending: true });
      setVehicles(data ?? []);
    };
    load();
    const ch = supabase.channel("paint-waiting")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles", filter: "current_station=eq.paint" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (vehicles.length === 0) return null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Waiting for Color ({vehicles.length})</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {vehicles.map(v => (
            <li key={v.id} className="py-2 flex justify-between font-mono text-xs">
              <span>…{v.vin.slice(-6)}</span>
              <span className="text-muted-foreground">Plan: {v.planned_color_id ? "—" : "—"}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ColorPlanTracking({ jobId, selectedColorId }: { jobId: string; selectedColorId: string }) {
  const { getCode, activeList } = useColors();
  const [plan, setPlan] = useState<Record<string, number>>({});
  const [usage, setUsage] = useState<Record<string, number>>({});

  useEffect(() => {
    const load = async () => {
      const [{ data: jo }, { data: vehicles }] = await Promise.all([
        supabase.from("job_orders").select("color_plan").eq("id", jobId).maybeSingle(),
        supabase.from("vehicles").select("actual_color_id").eq("job_order_id", jobId).not("actual_color_id", "is", null),
      ]);
      if (jo?.color_plan) setPlan(jo.color_plan as Record<string, number>);
      const counts: Record<string, number> = {};
      (vehicles ?? []).forEach(v => {
        if (v.actual_color_id) counts[v.actual_color_id] = (counts[v.actual_color_id] ?? 0) + 1;
      });
      setUsage(counts);
    };
    load();
  }, [jobId]);

  if (!selectedColorId) return null;

  const planned = plan[selectedColorId] ?? 0;
  const used = usage[selectedColorId] ?? 0;
  const remaining = planned - used;

  let variant: "default" | "success" | "warning" | "destructive" = "default";
  let label = `${used}/${planned}`;
  if (planned === 0) {
    variant = "default";
  } else if (remaining < 0) {
    variant = "destructive";
    label = `OVER PLAN (${used}/${planned})`;
  } else if (remaining <= 2) {
    variant = "warning";
    label = `NEAR LIMIT (${used}/${planned})`;
  } else {
    variant = "success";
  }

  return (
    <div className="flex items-center gap-1.5 text-xs mt-1">
      <Badge variant={variant}>{label}</Badge>
      <span className="text-muted-foreground">{getCode(selectedColorId)}</span>
    </div>
  );
}
