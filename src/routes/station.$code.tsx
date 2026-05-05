import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { stationByCode, COLOR_CODES, type StationCode } from "@/lib/stations";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { findBySuffix } from "@/lib/vin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react";
import type { StationEventWithVehicle } from "@/lib/db-types";

export const Route = createFileRoute("/station/$code")({
  head: ({ params }) => ({ meta: [{ title: `${stationByCode(params.code)?.label ?? "Station"} — Nexus-Flow` }] }),
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

  useEffect(() => {
    if (debouncedSuffix.trim().length < 3) { setMatches([]); return; }
    let cancel = false;
    findBySuffix(debouncedSuffix).then(d => { if (!cancel) setMatches(d); }).catch(e => toast.error(e.message));
    return () => { cancel = true; };
  }, [debouncedSuffix]);

  useEffect(() => { setPicked(null); setColor(""); }, [debouncedSuffix]);

  const submit = async (kind: "in" | "out") => {
    if (!picked) return toast.error("Pick a VIN first");
    if (station === "paint" && kind === "in" && !color) return toast.error("Color required");
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
            const ok = window.confirm(`⚠️ Color ${color} already used ${count}/${limit} for this job. Override and continue?`);
            if (!ok) { setBusy(false); return; }
          }
        }
      }

      const user = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase.from("station_events").insert({
        vehicle_id: picked.id, station, kind, color_used: color || null, recorded_by: user?.id, source: "manual",
      });
      if (error) throw error;

      const update: Record<string, string> = { current_station: station };
      if (station === "paint" && kind === "in" && color) update.actual_color = color;
      await supabase.from("vehicles").update(update).eq("id", picked.id);

      if (picked.is_lot_tail) toast.warning(`⚠️ Lot-tail vehicle: ${picked.tail_note ?? "Flagged"}`);
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
            {picked.is_lot_tail && (
              <div className="flex items-center gap-1 text-warning text-xs"><AlertTriangle className="h-3 w-3" /> Lot-tail flag: {picked.tail_note}</div>
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
        .select("id, kind, color_used, recorded_at, vehicle:vehicles(vin)")
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
            {rows.map(r => (
              <li key={r.id} className="py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={r.kind === "in" ? "info" : "success"}>{r.kind.toUpperCase()}</Badge>
                  <span className="font-mono text-xs">…{r.vehicle?.vin?.slice(-6)}</span>
                  {r.color_used && <span className="text-xs text-muted-foreground">{r.color_used}</span>}
                </div>
                <span className="text-xs text-muted-foreground">{new Date(r.recorded_at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
