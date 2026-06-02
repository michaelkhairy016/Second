import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { stationByCode, COLOR_CODES, loadColorMap, LAUNCH_MODE_STATIONS } from "@/lib/stations";
import { useProductionMode } from "@/hooks/use-production-mode";
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
import { findBySuffix, stripVinStars } from "@/lib/vin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, AlertTriangle, CheckCircle2, ClipboardList, ClipboardCheck, FileSpreadsheet, Plus, X, Package, ClipboardPenLine, PaintBucket } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { StationEventWithVehicle, StationCode, VehicleSearchResult } from "@/lib/db-types";
import { archiveContractVehicle } from "@/lib/contract-archive";
import { useColors } from "@/hooks/use-colors";

export const Route = createFileRoute("/station/$code")({
  head: ({ params }) => ({ meta: [{ title: `${stationByCode(params.code)?.label ?? "Station"} — AFA Shopfloor` }] }),
  component: () => <RequireAuth><AppShell><StationPage /></AppShell></RequireAuth>,
});

function StationPage() {
  const { code } = Route.useParams();
  const station = stationByCode(code);
  const { hasStation, isStaff, isSuperuser, stations } = useAuth();
  const { isLaunchMode } = useProductionMode();
  const nav = useNavigate();
  const [autoPicked, setAutoPicked] = useState<VehicleSearchResult | null>(null);

  useEffect(() => {
    if (station && !hasStation(station.code) && !isStaff && !(station.code === "shortage" && stations.length > 0)) { toast.error("You do not have access to this station"); nav({ to: "/" }); }
    if (station?.code === "warehouse") nav({ to: "/warehouse" });
    if (isLaunchMode && !LAUNCH_MODE_STATIONS.includes(code as StationCode)) {
      toast.error("This station is not available in Launch Mode");
      nav({ to: "/" });
    }
  }, [station, hasStation, isStaff, isLaunchMode, code, nav]);

  if (!station || station.code === "warehouse") return null;

  const handlePickFromWip = (v: VehicleSearchResult) => setAutoPicked(v);

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

      {station.code === "shortage" && <ShortageStationView autoPicked={autoPicked} onAutoPickedConsumed={() => setAutoPicked(null)} />}
      <StationWipSummary station={station.code} onPickVehicle={handlePickFromWip} />
      {station.code !== "shortage" && <ScanForm station={station.code} autoPicked={autoPicked} onAutoPickedConsumed={() => setAutoPicked(null)} />}
      {(isStaff || isSuperuser) && <BulkPasteSection station={station.code as StationCode} />}
      {station.code === "pbs" && <PBSLotSummary />}
      {station.code === "paint" && <PaintWaitingVehicles />}
      {station.code !== "paint" && station.code !== "shortage" && <RecentEvents station={station.code} />}
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
      .select("id,title,severity,status,created_at,resolved_at,resolved_by,reported_by,station")
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

function ScanForm({ station, autoPicked, onAutoPickedConsumed }: { station: StationCode; autoPicked?: VehicleSearchResult | null; onAutoPickedConsumed?: () => void }) {
  const [suffix, setSuffix] = useState("");
  const debouncedSuffix = useDebouncedValue(suffix, 300);
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof findBySuffix>>>([]);
  const [picked, setPicked] = useState<typeof matches[number] | null>(null);
  const [color, setColor] = useState("");
  const [busy, setBusy] = useState(false);
  const [lotCode, setLotCode] = useState<string | null>(null);

  const [lotShortageWarning, setLotShortageWarning] = useState<string | null>(null);
  const [issueText, setIssueText] = useState("");
  const [condition, setCondition] = useState<"ok" | "not_ok">("ok");
  const [shift, setShift] = useState<"day" | "night">("day");

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

  useEffect(() => { setPicked(null); setColor(""); setLotShortageWarning(null); setRestrictions([]); setIssueText(""); setCondition("ok"); }, [debouncedSuffix]);

  // Consume auto-picked vehicle from WIP summary
  useEffect(() => {
    if (autoPicked) {
      setPicked(autoPicked as any);
      setSuffix(autoPicked.vin_suffix);
      setMatches([]);
      onAutoPickedConsumed?.();
    }
  }, [autoPicked]);

  const createContractVehicle = async (model: string) => {
    const s = stripVinStars(suffix.trim().toUpperCase());
    if (s.length < 3) return toast.error("Enter at least 3 digits");
    setBusy(true);
    try {
      const vin = `CONTRACT-${s}`;
      const { data, error } = await supabase.from("vehicles").insert({
        vin, vin_suffix: s.slice(-5), lot_id: null, job_order_id: null,
        current_station: "wbs", planned_color_id: null, is_lot_tail: false,
        tail_note: `${model} — Contract`, contract_model: model,
      }).select("id, vin, vin_suffix, planned_color_id, actual_color_id, current_station, lot_id, job_order_id, is_lot_tail, tail_note, contract_model, completed_at").single();
      if (error) throw error;
      setPicked({ ...data, is_archived: false });
      setMatches([]);
      toast.success(`Created: ${model} — ${s}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const postPaintStations = ["pbs", "tcf", "waiting_repair", "repair", "cs", "pdi"];

  const submit = async (kind: "in" | "out") => {
    if (!picked) return toast.error("Pick a VIN first");
    // Duplicate prevention: block IN if already at station, block OUT if not at station
    if (kind === "in" && picked.current_station === station) {
      toast.warning(`${picked.vin} already at ${stationByCode(station)?.label ?? station}. Dismiss (OUT) first.`);
      setBusy(false); return;
    }
    if (kind === "out" && picked.current_station !== station && !["paint"].includes(station)) {
      toast.warning(`${picked.vin} is not at ${stationByCode(station)?.label ?? station} (at ${stationByCode(picked.current_station ?? "")?.label ?? picked.current_station ?? "—"}).`);
      setBusy(false); return;
    }
    if (station === "paint" && !color && !picked.actual_color_id) return toast.error("Color required");
    setBusy(true);
    try {
      // Paint station: smart color assignment + pull/push logic
      if (station === "paint") {
        const prePaintStations = ["warehouse", "line_feeding", "body_shop", "wbs"];
        const vehicleStation = picked.current_station;

        // Color already assigned on vehicle — only assign if no actual_color_id
        if (!picked.actual_color_id && color) {
          // Color plan limit check
          if (picked.job_order_id) {
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
          await supabase.from("vehicles").update({ actual_color_id: color }).eq("id", picked.id);
        }

        const user = (await supabase.auth.getUser()).data.user;

        // Pre-paint: assign color + pull to paint
        if (vehicleStation && prePaintStations.includes(vehicleStation)) {
          await supabase.from("station_events").insert({
            vehicle_id: picked.id, station: "paint", kind: "in", color_used_id: color || null, recorded_by: user?.id, source: "manual",
            meta: { shift },
          });
          await supabase.from("vehicles").update({ current_station: "paint" }).eq("id", picked.id);
          toast.success(`Color assigned + pulled to paint: ${picked.vin}`);
          setSuffix(""); setPicked(null); setColor("");
          setBusy(false);
          return;
        }

        // Post-paint: just assign color if missing, don't move
        if (vehicleStation && postPaintStations.includes(vehicleStation)) {
          toast.success(`Color assigned: ${picked.vin} (stays at ${vehicleStation})`);
          setSuffix(""); setPicked(null); setColor("");
          setBusy(false);
          return;
        }

        // At paint: normal IN/OUT flow
        const { error } = await supabase.from("station_events").insert({
          vehicle_id: picked.id, station, kind, color_used_id: color || null, recorded_by: user?.id, source: "manual",
          meta: { shift },
        });
        if (error) throw error;
        if (kind === "out") {
          // Contract vehicles: archive directly (exit factory)
          if (picked.vin.startsWith("CONTRACT-")) {
            await archiveContractVehicle(supabase, picked.id, "paint");
            toast.success(`Archived: ${picked.contract_model ?? "Contract"} — ${picked.vin_suffix}`);
            setSuffix(""); setPicked(null); setColor("");
            setBusy(false);
            return;
          }
          // Regular vehicles: advance to TCF (not PBS)
          await supabase.from("vehicles").update({ current_station: "tcf" }).eq("id", picked.id);
        }
        toast.success(`${kind.toUpperCase()} ${shift}: ${picked.vin}`);
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

      // Post-paint color assignment: save color if selected and vehicle has none
      if (color && !picked.actual_color_id && (postPaintStations.includes(station) || (isLaunchMode && station === "shortage"))) {
        await supabase.from("vehicles").update({ actual_color_id: color }).eq("id", picked.id);
      }

      // Create issue if issueText provided
      if (issueText.trim()) {
        const { error: ie } = await supabase.from("issues").insert({
          vehicle_id: picked.id, station, title: issueText.trim(),
          severity: "medium", status: "open", reported_by: user?.id ?? null,
        });
        if (ie) toast.warning(`Issue save failed: ${ie.message}`);
      }

      const { error } = await supabase.from("station_events").insert({
        vehicle_id: picked.id, station, kind, color_used_id: color || null, recorded_by: user?.id, source: "manual",
        meta: null,
      });
      if (error) throw error;

      // WBS OUT: Quik 300 contract vehicles auto-archive (electro deposition only)
      if (kind === "out" && station === "wbs" && picked.vin.startsWith("CONTRACT-") && picked.contract_model === "Quik 300") {
        await archiveContractVehicle(supabase, picked.id, "wbs");
        toast.success(`Archived: Quik 300 — ${picked.vin_suffix}`);
        setSuffix(""); setPicked(null); setColor(""); setIssueText("");
        setBusy(false);
        return;
      }

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
      toast.success(`Recorded: ${picked.vin} ${kind.toUpperCase()}`);
      setSuffix(""); setPicked(null); setColor(""); setIssueText("");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const { isStaff: isStaffLocal, isSuperuser: isSuperLocal } = useAuth();
  const { isLaunchMode } = useProductionMode();
  const needsColor = station === "paint" && !picked?.actual_color_id;
  const canAssignColor = (postPaintStations.includes(station) || (isLaunchMode && station === "shortage")) && picked && !picked.actual_color_id && station !== "paint";
  const canReassignColor = postPaintStations.includes(station) && picked?.actual_color_id && (isStaffLocal || isSuperLocal) && station !== "paint";

  // Simplified paint for Launch Mode: just record color
  const submitPaintColor = async () => {
    if (!picked) return toast.error("Pick a VIN first");
    if (!color) return toast.error("Select a color");
    setBusy(true);
    try {
      await supabase.from("vehicles").update({ actual_color_id: color }).eq("id", picked.id);
      toast.success(`Color recorded: ${picked.vin}`);
      setSuffix(""); setPicked(null); setColor("");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

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
                <span className="font-mono">{m.vin}</span>
                <span className="text-xs text-muted-foreground">
                  {m.current_station ?? "—"}
                </span>
              </button>
            ))}
          </div>
        )}

        {matches.length === 0 && debouncedSuffix.trim().length >= 3 && !picked && (station === "wbs" || station === "paint") && (
          <div className="border rounded-lg p-3 space-y-2">
            <p className="text-sm text-muted-foreground">No vehicle found. Create contract vehicle?</p>
            <div className="flex gap-2 flex-wrap">
              {(["Proton MC2", "Zemex", "Quik 300"] as const).map(model => (
                <Button key={model} variant="outline" size="sm" disabled={busy} onClick={() => createContractVehicle(model)}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : model}
                </Button>
              ))}
            </div>
          </div>
        )}

        {picked && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="font-mono text-base">{picked.vin}</div>
            {picked.contract_model && (
              <div className="flex items-center gap-1.5 text-xs mt-1">
                <Badge variant="info">{picked.contract_model}</Badge>
                <span className="text-muted-foreground">Contract Vehicle</span>
              </div>
            )}
            <VehicleColorDisplay vehicle={picked} />
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

        {canAssignColor && (
          <div className="border rounded-md p-3 space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-1"><Package className="h-3 w-3" /> Assign Color</Label>
            <ColorPicker color={color} setColor={setColor} />
          </div>
        )}

        {canReassignColor && (
          <div className="border rounded-md p-3 space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> Reassign Color (staff only)</Label>
            <ColorPicker color={color} setColor={setColor} />
            {color && color !== picked?.actual_color_id && (
              <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                setBusy(true);
                await supabase.from("vehicles").update({ actual_color_id: color }).eq("id", picked!.id);
                toast.success("Color updated");
                setBusy(false);
                setColor("");
              }}>Update Color</Button>
            )}
          </div>
        )}

        {station !== "paint" && station !== "shortage" && picked && (
          <VehicleConditionSection vehicleId={picked.id} station={station} />
        )}

        {station !== "paint" && station !== "shortage" && picked && (
          <div className="space-y-2 border rounded-md p-3">
            <div className="space-y-1.5">
              <Label>Condition</Label>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setCondition("ok"); setIssueText(""); }} className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${condition === "ok" ? "bg-success/20 border-success text-success" : "bg-muted border-border"}`}>OK</button>
                <button type="button" onClick={() => setCondition("not_ok")} className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${condition === "not_ok" ? "bg-warning/20 border-warning text-warning" : "bg-muted border-border"}`}>Not OK</button>
              </div>
            </div>
            {condition === "not_ok" && (
              <div className="space-y-1.5">
                <Label>Describe issue</Label>
                <Input value={issueText} onChange={e => setIssueText(e.target.value)} placeholder="Describe the issue (English / العربية)" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit("in"); } }} />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {station === "paint" && isLaunchMode ? (
            <Button disabled={!picked || busy || !color} className="flex-1" onClick={submitPaintColor}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><PaintBucket className="h-4 w-4 mr-1" /> Record Color</>}
            </Button>
          ) : station === "paint" ? (
            <>
              <div className="flex items-center gap-1.5 mr-2">
                <Label className="text-xs whitespace-nowrap">Shift:</Label>
                <button onClick={() => setShift("day")} className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors ${shift === "day" ? "bg-amber-100 border-amber-400 text-amber-800" : "bg-muted border-muted text-muted-foreground"}`}>Day</button>
                <button onClick={() => setShift("night")} className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors ${shift === "night" ? "bg-indigo-100 border-indigo-400 text-indigo-800" : "bg-muted border-muted text-muted-foreground"}`}>Night</button>
              </div>
              <Button variant="outline" disabled={!picked || busy || !color} className="flex-1" onClick={() => submit("in")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" /> IN ({shift})</>}
              </Button>
              <Button disabled={!picked || busy} className="flex-1" onClick={() => submit("out")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>OUT ({shift}) <ArrowRight className="h-4 w-4 ml-1" /></>}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={!picked || busy || (condition === "not_ok" && !issueText.trim())} className="flex-1" onClick={() => submit("in")}>
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

interface WipVehicle {
  id: string; vin: string; vin_suffix: string; current_station: string | null;
  planned_color_id: string | null; actual_color_id: string | null;
  lot_id: string | null; is_lot_tail: boolean; tail_note: string | null; job_order_id: string | null; contract_model: string | null;
  lot: { lot_code: string; model: string } | null;
  hasOpenIssue: boolean;
}

function StationWipSummary({ station, onPickVehicle }: { station: StationCode; onPickVehicle: (v: VehicleSearchResult) => void }) {
  const { isStaff, isSuperuser } = useAuth();
  const [vehicles, setVehicles] = useState<WipVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogFilter, setDialogFilter] = useState<"all" | "ok" | "issue">("all");
  const [dialogModel, setDialogModel] = useState<string | null>(null);
  const { getCode } = useColors();

  const load = async () => {
    setLoading(true);
    const stations = [station];
    const [vRes, iRes] = await Promise.all([
      supabase.from("vehicles").select("id, vin, vin_suffix, current_station, planned_color_id, actual_color_id, lot_id, is_lot_tail, tail_note, job_order_id, contract_model, lot:lots(lot_code, model)").in("current_station", stations),
      supabase.from("issues").select("vehicle_id").in("status", ["open", "in_progress"]),
    ]);
    const issueSet = new Set((iRes.data ?? []).map(i => i.vehicle_id));
    const raw: any[] = vRes.data ?? [];

    // Fallback model for multi-lot job orders (lot_id null but job_order_id set)
    const needModel = raw.filter(v => !v.lot?.model && v.job_order_id);
    if (needModel.length > 0) {
      const joIds = [...new Set(needModel.map(v => v.job_order_id))];
      const { data: jols } = await supabase.from("job_order_lots").select("job_order_id, lot_id").in("job_order_id", joIds);
      const { data: lots } = await supabase.from("lots").select("id, model").in("id", [...new Set((jols ?? []).map((j: any) => j.lot_id))]);
      const lotModel = new Map((lots ?? []).map((l: any) => [l.id, l.model]));
      const joModel = new Map<string, string>();
      (jols ?? []).forEach((j: any) => { if (!joModel.has(j.job_order_id) && lotModel.has(j.lot_id)) joModel.set(j.job_order_id, lotModel.get(j.lot_id)!); });
      needModel.forEach(v => {
        const model = joModel.get(v.job_order_id);
        if (model) v.lot = { lot_code: "", model };
      });
    }

    const enriched: WipVehicle[] = raw.map((v: any) => ({ ...v, hasOpenIssue: issueSet.has(v.id) }));
    setVehicles(enriched);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel(`wip-${station}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [station]);

  if (loading) return <Card><CardContent className="py-4"><Skeleton className="h-20 w-full" /></CardContent></Card>;
  if (vehicles.length === 0) return null;

  const grouped = new Map<string, { ok: WipVehicle[]; issue: WipVehicle[]; lotCodes: Set<string> }>();
  vehicles.forEach(v => {
    const model = v.contract_model ?? v.lot?.model ?? "Unknown";
    if (!grouped.has(model)) grouped.set(model, { ok: [], issue: [], lotCodes: new Set() });
    if (v.lot?.lot_code) grouped.get(model)!.lotCodes.add(v.lot.lot_code);
    if (v.hasOpenIssue) grouped.get(model)!.issue.push(v); else grouped.get(model)!.ok.push(v);
  });

  const totalOk = vehicles.filter(v => !v.hasOpenIssue).length;
  const totalIssue = vehicles.filter(v => v.hasOpenIssue).length;
  const models = Array.from(grouped.entries()).sort((a, b) => (b[1].ok.length + b[1].issue.length) - (a[1].ok.length + a[1].issue.length));

  const openDialog = (filter: "all" | "ok" | "issue", model: string | null) => {
    setDialogFilter(filter);
    setDialogModel(model);
    setDialogOpen(true);
  };

  const getFilteredVehicles = () => {
    let list = dialogModel ? (grouped.get(dialogModel)?.ok.concat(grouped.get(dialogModel)?.issue ?? []) ?? []) : vehicles;
    if (dialogFilter === "ok") list = list.filter(v => !v.hasOpenIssue);
    if (dialogFilter === "issue") list = list.filter(v => v.hasOpenIssue);
    return list;
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Station WIP ({vehicles.length})</CardTitle>
        <StockCountButton vehicles={vehicles} getCode={getCode} />
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              <th className="text-left py-1.5 font-medium">Model</th>
              <th className="text-center py-1.5 font-medium">OK</th>
              <th className="text-center py-1.5 font-medium">Issue</th>
              <th className="text-center py-1.5 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {models.map(([model, data]) => (
              <tr key={model} className="border-b last:border-0">
                <td className="py-1.5 font-medium">{model}
                  {data.lotCodes.size > 0 && <span className="text-xs text-muted-foreground ml-1">({Array.from(data.lotCodes).sort().join(" & ")})</span>}
                </td>
                <td className="py-1.5 text-center">
                  <button onClick={() => openDialog("ok", model)} className="text-success hover:underline font-semibold">{data.ok.length}</button>
                </td>
                <td className="py-1.5 text-center">
                  <button onClick={() => data.issue.length > 0 && openDialog("issue", model)} className={`font-semibold ${data.issue.length > 0 ? "text-warning hover:underline" : "text-muted-foreground"}`}>{data.issue.length}</button>
                </td>
                <td className="py-1.5 text-center">
                  <button onClick={() => openDialog("all", model)} className="font-semibold hover:underline">{data.ok.length + data.issue.length}</button>
                </td>
              </tr>
            ))}
            {models.length > 1 && (
              <tr className="font-bold">
                <td className="py-1.5">Total</td>
                <td className="py-1.5 text-center">
                  <button onClick={() => openDialog("ok", null)} className="text-success hover:underline">{totalOk}</button>
                </td>
                <td className="py-1.5 text-center">
                  <button onClick={() => totalIssue > 0 && openDialog("issue", null)} className={`text-warning hover:underline`}>{totalIssue}</button>
                </td>
                <td className="py-1.5 text-center">
                  <button onClick={() => openDialog("all", null)} className="hover:underline">{vehicles.length}</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialogFilter === "ok" ? "OK" : dialogFilter === "issue" ? "Issue" : "All"} Vehicles
              {dialogModel ? ` — ${dialogModel}` : ""}
            </DialogTitle>
          </DialogHeader>
          <ul className="divide-y">
            {getFilteredVehicles().map(v => (
              <li key={v.id}>
                <button onClick={() => { onPickVehicle(v as unknown as VehicleSearchResult); setDialogOpen(false); }}
                  className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs">{v.vin}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {v.contract_model ?? v.lot?.model ?? "—"} · {getCode(v.actual_color_id ?? v.planned_color_id) ?? "No color"}
                      {station === "paint" && v.current_station !== "paint" && (
                        <span className="ml-1 text-warning">({stationByCode(v.current_station as StationCode)?.label ?? v.current_station})</span>
                      )}
                    </div>
                  </div>
                  <Badge variant={v.hasOpenIssue ? "warning" : "success"} className="text-[10px] px-1.5 shrink-0">
                    {v.hasOpenIssue ? "Issue" : "OK"}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StockCountButton({ vehicles, getCode }: { vehicles: WipVehicle[]; getCode: (id: string | null) => string }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Map<string, boolean>>(new Map());
  const [verified, setVerified] = useState(false);

  const handleVerify = () => setVerified(true);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setChecked(new Map()); setVerified(false); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ClipboardPenLine className="h-4 w-4" /> Stock Count
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Stock Count Verification ({vehicles.length} vehicles)</DialogTitle>
        </DialogHeader>
        {!verified ? (
          <>
            <ul className="divide-y">
              {vehicles.map(v => (
                <li key={v.id} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    checked={checked.get(v.id) ?? false}
                    onCheckedChange={(c) => {
                      const next = new Map(checked);
                      next.set(v.id, !!c);
                      setChecked(next);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs">{v.vin}</div>
                    <div className="text-xs text-muted-foreground">{v.contract_model ?? v.lot?.model ?? "—"} · {getCode(v.actual_color_id ?? v.planned_color_id) ?? "No color"}</div>
                  </div>
                </li>
              ))}
            </ul>
            <Button className="w-full mt-3" onClick={handleVerify}>
              Verify ({Array.from(checked.values()).filter(Boolean).length} / {vehicles.length} checked)
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-success/10 border border-success/30 p-3">
                <div className="text-2xl font-bold text-success">{Array.from(checked.values()).filter(Boolean).length}</div>
                <div className="text-xs text-muted-foreground">Verified</div>
              </div>
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3">
                <div className="text-2xl font-bold text-destructive">{vehicles.length - Array.from(checked.values()).filter(Boolean).length}</div>
                <div className="text-xs text-muted-foreground">Unchecked</div>
              </div>
              <div className="rounded-md bg-muted border p-3">
                <div className="text-2xl font-bold">{vehicles.length}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
            </div>
            {vehicles.filter(v => !checked.get(v.id)).length > 0 && (
              <div>
                <p className="text-xs font-medium text-destructive mb-2">Unchecked vehicles (potentially missing):</p>
                <ul className="divide-y border rounded-md">
                  {vehicles.filter(v => !checked.get(v.id)).map(v => (
                    <li key={v.id} className="px-3 py-1.5 text-xs font-mono">{v.vin} <span className="text-muted-foreground font-sans">— {v.contract_model ?? v.lot?.model ?? "Unknown"}</span></li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="outline" className="w-full" onClick={() => { setVerified(false); setChecked(new Map()); }}>Recount</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
                    <span className="font-mono text-xs">{r.vehicle?.vin ?? "—"}</span>
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
  const [matchedVins, setMatchedVins] = useState<string[]>([]);
  const [report, setReport] = useState<{ matched: number; missing: string[] } | null>(null);
  const stationLabel = stationByCode(station)?.label ?? station;
  const [showBulk, setShowBulk] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [shift, setShift] = useState<"day" | "night">("day");

  const nextStationMap: Partial<Record<StationCode, StationCode>> = {
    wbs: "paint", pbs: "tcf", tcf: "waiting_repair", waiting_repair: "repair", repair: "cs",
    paint: "pbs",
  };

  const run = async () => {
    setBusy(true); setReport(null); setMatchedVins([]);
    try {
      const tokens = text.split(/\s+|[,;]/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (tokens.length === 0) throw new Error("Paste at least one VIN or suffix");

      const matched: { id: string; vin: string }[] = [];
      const missing: string[] = [];
      for (const raw of tokens) {
        const clean = stripVinStars(raw);
        const q = clean.length === 17
          ? supabase.from("vehicles").select("id, vin").in("vin", [clean, `*${clean}*`]).is("completed_at", null).maybeSingle()
          : supabase.from("vehicles").select("id, vin").ilike("vin_suffix", `%${clean.slice(-5)}`).is("completed_at", null).limit(1).maybeSingle();
        const { data } = await q;
        if (data) matched.push(data); else missing.push(raw);
      }
      if (matched.length === 0) throw new Error("No vehicles found");

      const user = (await supabase.auth.getUser()).data.user;
      const events = matched.map(m => ({
        vehicle_id: m.id,
        station,
        kind,
        recorded_by: user?.id,
        source: "bulk",
        ...(station === "paint" ? { meta: JSON.stringify({ shift }) } : {}),
      }));
      const { error: ee } = await supabase.from("station_events").insert(events);
      if (ee) throw ee;

      const targetStation = (kind === "out" && nextStationMap[station]) ? nextStationMap[station]! : station;
      await supabase.from("vehicles").update({ current_station: targetStation }).in("id", matched.map(m => m.id));

      if (kind === "out" && station === "pdi") {
        await supabase.from("vehicles").update({ completed_at: new Date().toISOString() }).in("id", matched.map(m => m.id));
      }

      setMatchedVins(matched.map(m => m.vin));
      setReport({ matched: matched.length, missing });
      toast.success(`Updated ${matched.length} vehicles`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (showPrint && matchedVins.length > 0) {
    return <VinPrintSheet vins={matchedVins} stationLabel={stationLabel} kind={kind} onClose={() => setShowPrint(false)} />;
  }

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
        <Textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Paste one VIN per line — full VINs or last 4-5 digits" className="font-mono text-xs" />
        <div className="flex gap-2 items-center">
          <Label className="text-sm">Direction</Label>
          <select value={kind} onChange={e => setKind(e.target.value as "in" | "out")} className="border rounded-md px-2 py-1 text-sm bg-background">
            <option value="in">IN to {stationLabel}</option>
            <option value="out">OUT of {stationLabel}</option>
          </select>
          {station === "paint" && (
            <div className="flex gap-2 items-center">
              <Label className="text-sm">Shift</Label>
              <button
                type="button"
                onClick={() => setShift("day")}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${shift === "day" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}
              >Day</button>
              <button
                type="button"
                onClick={() => setShift("night")}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${shift === "night" ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300" : "bg-muted text-muted-foreground"}`}
              >Night</button>
            </div>
          )}
          <Button className="ml-auto" disabled={busy} onClick={run}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply to all"}</Button>
        </div>
        {report && (
          <div className="text-sm space-y-1 pt-2 border-t">
            <div className="text-success">Matched: {report.matched}</div>
            {report.missing.length > 0 && <details><summary className="text-warning text-xs cursor-pointer">Not found: {report.missing.length}</summary><div className="font-mono text-xs mt-1">{report.missing.join("\n")}</div></details>}
            {matchedVins.length > 0 && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setShowPrint(true)}>
                <ClipboardCheck className="h-4 w-4 mr-1" /> Print VIN sheet
              </Button>
            )}
          </div>
        )}
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setShowBulk(false); setText(""); setReport(null); setMatchedVins([]); }}>Close</Button>
      </CardContent>
    </Card>
  );
}

const VINS_PER_PAGE = 45;
const VINS_PER_COL = 15;

function VinPrintSheet({ vins, stationLabel, kind, onClose }: { vins: string[]; stationLabel: string; kind: "in" | "out"; onClose: () => void }) {
  const pages: string[][] = [];
  for (let i = 0; i < vins.length; i += VINS_PER_PAGE) pages.push(vins.slice(i, i + VINS_PER_PAGE));
  const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const column = (col: string[], offset: number) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8pt" }}>
      <thead>
        <tr style={{ borderBottom: "1.5px solid #000" }}>
          <th style={{ padding: "2px", width: "14pt", fontSize: "7pt" }}>✓</th>
          <th style={{ padding: "2px", width: "14pt", fontSize: "7pt" }}>#</th>
          <th style={{ padding: "2px", textAlign: "left", fontSize: "7pt" }}>VIN</th>
        </tr>
      </thead>
      <tbody>
        {col.map((vin, i) => (
          <tr key={i} style={{ borderBottom: "0.5px solid #ccc" }}>
            <td style={{ padding: "1px 2px", textAlign: "center", fontSize: "10pt" }}>☐</td>
            <td style={{ padding: "1px 2px", textAlign: "center", fontSize: "7pt" }}>{offset + i + 1}</td>
            <td style={{ padding: "1px 2px", fontFamily: "monospace", fontSize: "7.5pt", whiteSpace: "nowrap" }}>{vin}</td>
          </tr>
        ))}
        {Array.from({ length: VINS_PER_COL - col.length }).map((_, i) => (
          <tr key={`empty-${i}`} style={{ borderBottom: "0.5px solid #eee" }}>
            <td style={{ padding: "1px 2px", textAlign: "center", fontSize: "10pt" }}>☐</td>
            <td style={{ padding: "1px 2px" }}></td>
            <td style={{ padding: "1px 2px" }}></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div>
      <div className="no-print flex items-center gap-2 mb-2">
        <Button variant="outline" size="sm" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        <Button size="sm" onClick={() => window.print()}>Print</Button>
      </div>
      <div className="print-area">
        {pages.map((page, pi) => (
          <div key={pi} className="print-page" style={{ minHeight: "100vh", padding: "0.8cm", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1.5px solid #000", paddingBottom: "4px", marginBottom: "6px" }}>
              <div>
                <div style={{ fontSize: "11pt", fontWeight: 700 }}>{stationLabel} — {kind.toUpperCase()} Sheet</div>
                <div style={{ fontSize: "8pt" }}>{date} | Total: {vins.length} | Page {pi + 1}/{pages.length}</div>
              </div>
              <div style={{ fontSize: "9pt", fontWeight: 700 }}>MPC</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4cm" }}>
              {column(page.slice(0, VINS_PER_COL), pi * VINS_PER_PAGE)}
              {column(page.slice(VINS_PER_COL, VINS_PER_COL * 2), pi * VINS_PER_PAGE + VINS_PER_COL)}
              {column(page.slice(VINS_PER_COL * 2, VINS_PER_COL * 3), pi * VINS_PER_PAGE + VINS_PER_COL * 2)}
            </div>
            <div style={{ position: "absolute", bottom: "0.5cm", right: "0.8cm", fontSize: "7pt", color: "#999" }}>
              {pi + 1} / {pages.length}
            </div>
          </div>
        ))}
      </div>
    </div>
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

function ShortageStationView({ autoPicked, onAutoPickedConsumed }: { autoPicked?: VehicleSearchResult | null; onAutoPickedConsumed?: () => void }) {
  const [suffix, setSuffix] = useState("");
  const debouncedSuffix = useDebouncedValue(suffix, 300);
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof findBySuffix>>>([]);
  const [picked, setPicked] = useState<typeof matches[number] | null>(null);
  const [mode, setMode] = useState<"in" | "out">("in");
  const [parts, setParts] = useState("");
  const [notes, setNotes] = useState("");
  const [partType, setPartType] = useState<"ckd" | "local" | "plastics">("ckd");
  const [responsibility, setResponsibility] = useState<"afa" | "supplier">("supplier");
  const [shortageReason, setShortageReason] = useState("ckd");
  const [receivedBy, setReceivedBy] = useState("");
  const [shortages, setShortages] = useState<ShortageRecord[]>([]);
  const [stationVehicles, setStationVehicles] = useState<Array<{ vin: string; vin_suffix: string; id: string }>>([]);
  const [busy, setBusy] = useState(false);

  // Consume auto-picked vehicle from WIP summary
  useEffect(() => {
    if (autoPicked) {
      setPicked(autoPicked as any);
      setSuffix(autoPicked.vin_suffix);
      setMatches([]);
      // Auto-detect mode based on current station
      if (autoPicked.current_station === "shortage") setMode("out");
      else setMode("in");
      onAutoPickedConsumed?.();
    }
  }, [autoPicked]);

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

  const loadStationVehicles = async () => {
    const { data } = await supabase.from("vehicles").select("id, vin, vin_suffix").eq("current_station", "shortage").order("created_at", { ascending: true });
    setStationVehicles(data ?? []);
  };
  useEffect(() => { loadStationVehicles(); }, []);

  const resetScan = () => { setSuffix(""); setPicked(null); setMatches([]); setParts(""); setNotes(""); setPartType("ckd"); setResponsibility("supplier"); setReceivedBy(""); setShortageReason("ckd"); };

  const submitIn = async () => {
    if (!picked) return toast.error("Pick a VIN first");
    const partList = parts.split(",").map(s => s.trim()).filter(Boolean);
    if (partList.length === 0) return toast.error("List at least one part");
      // Check for existing open shortage
      const { data: existingShortage } = await supabase.from("shortages")
        .select("id").eq("vehicle_id", picked.id).eq("status", "open").maybeSingle();
      if (existingShortage) {
        toast.warning(`${picked.vin} already has an open shortage. Update it instead.`);
        return;
      }
    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const { error: se } = await supabase.from("shortages").insert({ vehicle_id: picked.id, parts: partList, notes: notes || null, created_by: user?.id, part_type: partType, responsibility, received_by: receivedBy || null, shortage_reason: shortageReason });
      if (se) throw se;
      const { error: ev } = await supabase.from("station_events").insert({ vehicle_id: picked.id, station: "shortage", kind: "in", recorded_by: user?.id, source: "manual" });
      if (ev) throw ev;
      await supabase.from("vehicles").update({ current_station: "shortage" } as any).eq("id", picked.id);
      toast.success(`Shortage logged: ${picked.vin}`);
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
      // Move vehicle out of shortage station back to PBS flow
      await supabase.from("vehicles").update({ current_station: "waiting_repair" }).eq("id", picked.id).eq("current_station", "shortage");
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
              {matches.map(m => (<button key={m.id} onClick={() => setPicked(m)} className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm"><span className="font-mono">{m.vin}</span><span className="text-xs text-muted-foreground">{m.current_station ?? "—"}</span></button>))}
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
                <div className="space-y-1.5"><Label>Shortage Reason</Label>
                  <select value={shortageReason} onChange={e => { setShortageReason(e.target.value); setPartType(e.target.value === "plastics" || e.target.value === "missing_plastics" ? "plastics" : e.target.value === "local" || e.target.value === "general_missing" || e.target.value === "unavailable_factory" ? "local" : "ckd"); }} className="w-full border rounded-md px-2 py-1.5 text-sm bg-background">
                    <option value="ckd">CKD</option>
                    <option value="local">Local</option>
                    <option value="unavailable_factory">Unavailable in Factory</option>
                    <option value="missing_plastics">Missing (Plastics Paint Shop)</option>
                    <option value="missing_paint_miscolored">Scratches (Paint Shop)</option>
                    <option value="general_missing">General Missing</option>
                    <option value="plastics">Plastics</option>
                  </select>
                </div>
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
              <CardHeader><CardTitle className="text-sm">Shortage history ({shortages.length} {shortages.length > 1 ? "cycles" : "cycle"})</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-xs">
                  {shortages.map((s, idx) => {
                    const cycleNum = shortages.length - idx;
                    const prevParts = idx < shortages.length - 1 ? (shortages[idx + 1].parts as string[]) : [];
                    const currentParts = (s.parts as string[]);
                    const added = currentParts.filter(p => !prevParts.includes(p));
                    const removed = prevParts.filter(p => !currentParts.includes(p));
                    return (
                      <li key={s.id} className="py-2">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-muted-foreground">Cycle {cycleNum}</span>
                            <Badge variant={s.status === "open" ? "destructive" : "success"} className="text-[10px] px-1.5">{s.status === "open" ? "OPEN" : "CLEARED"}</Badge>
                          </div>
                          <span className="text-muted-foreground">{new Date(s.created_at).toLocaleDateString("en-GB")} {s.cleared_at ? `→ ${new Date(s.cleared_at).toLocaleDateString("en-GB")}` : "(current)"}</span>
                        </div>
                        <div className="font-mono">{currentParts.join(", ")}</div>
                        {(added.length > 0 || removed.length > 0) && (
                          <div className="flex gap-2 mt-0.5">
                            {added.length > 0 && <span className="text-red-600">+{added.join(", ")}</span>}
                            {removed.length > 0 && <span className="text-green-600">-{removed.join(", ")}</span>}
                          </div>
                        )}
                        <div className="text-muted-foreground mt-0.5">{s.part_type === "ckd" ? "CKD" : "Local"} · {s.responsibility === "afa" ? "AFA" : "Supplier"}{s.received_by ? ` · Rec: ${s.received_by}` : ""}{s.released_by ? ` · Rel: ${s.released_by}` : ""}</div>
                      </li>
                    );
                  })}
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
        <ul className="divide-y text-sm">{vehicles.map(v => (<li key={v.id} className="py-2 flex items-center justify-between"><span className="font-mono text-xs">{v.vin}</span><Badge variant="secondary" className="text-[10px]">shortage</Badge></li>))}</ul>
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
  const { getCode } = useColors();
  const [vehicles, setVehicles] = useState<Array<{ vin: string; vin_suffix: string; planned_color_id: string | null; id: string }>>([]);

  const load = async () => {
    const { data } = await supabase
      .from("vehicles")
      .select("id, vin, vin_suffix, planned_color_id")
      .eq("current_station", "paint")
      .is("actual_color_id", null)
      .order("created_at", { ascending: true });
    setVehicles(data ?? []);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("paint-waiting-color")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "vehicles" }, payload => {
        const n = payload.new as any;
        if (n?.actual_color_id) setVehicles(prev => prev.filter(v => v.id !== n.id));
        else load();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "vehicles" }, () => { load(); })
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
              <span>{v.vin}</span>
              <span className="text-muted-foreground">Plan: {getCode(v.planned_color_id)}</span>
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
