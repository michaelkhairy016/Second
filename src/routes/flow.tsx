import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProductionFlowDiagram } from "@/components/ProductionFlowDiagram";
import { StationDetailSheet } from "@/components/StationDetailSheet";
import type { Vehicle, Issue, StationCode } from "@/lib/db-types";

export const Route = createFileRoute("/flow")({
  head: () => ({ meta: [{ title: "Production Flow — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

type VehicleWithJoins = Vehicle & {
  lots: { lot_code: string; model: string } | null;
  job_orders: { model_year: string | null } | null;
};

function Page() {
  const [vehicles, setVehicles] = useState<VehicleWithJoins[]>([]);
  const [entryMap, setEntryMap] = useState<Record<string, string>>({});
  const [activeIssues, setActiveIssues] = useState<Record<string, Issue[]>>({});
  const [resolvedIssues, setResolvedIssues] = useState<Record<string, Issue[]>>({});
  const [activeJobOrderIds, setActiveJobOrderIds] = useState<Set<string>>(new Set());
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: vs }, { data: ev }, { data: ai }, { data: ri }, { data: jos }] = await Promise.all([
      supabase.from("vehicles").select("id, vin, vin_suffix, current_station, lot_id, job_order_id, planned_color_id, actual_color_id, is_lot_tail, tail_note, lots(lot_code, model), job_orders(model_year)").is("completed_at", null),
      supabase.from("station_events").select("vehicle_id, station, recorded_at").eq("kind", "in").order("recorded_at", { ascending: false }),
      supabase.from("issues").select("id,title,severity,status,created_at,resolved_at,vehicle_id,station").in("status", ["open", "in_progress"]),
      supabase.from("issues").select("id,title,severity,status,created_at,resolved_at,vehicle_id,station").in("status", ["resolved", "closed"]),
      supabase.from("job_orders").select("id").eq("status", "active"),
    ]);
    const vehicles = (vs ?? []) as VehicleWithJoins[];
    setVehicles(vehicles);
    setActiveJobOrderIds(new Set((jos ?? []).map(j => j.id)));

    // Build entry time map
    const map: Record<string, string> = {};
    for (const e of (ev ?? [])) {
      const v = vehicles.find(v => v.id === e.vehicle_id);
      if (v && e.station === v.current_station && !map[e.vehicle_id]) {
        map[e.vehicle_id] = e.recorded_at;
      }
    }
    setEntryMap(map);

    const aiMap: Record<string, Issue[]> = {};
    (ai ?? []).forEach(issue => {
      if (issue.vehicle_id) {
        (aiMap[issue.vehicle_id] ??= []).push(issue);
      }
    });
    setActiveIssues(aiMap);

    const riMap: Record<string, Issue[]> = {};
    (ri ?? []).forEach(issue => {
      if (issue.vehicle_id) {
        (riMap[issue.vehicle_id] ??= []).push(issue);
      }
    });
    setResolvedIssues(riMap);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("flow-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_orders" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    vehicles.forEach(v => {
      if (v.current_station) c[v.current_station] = (c[v.current_station] ?? 0) + 1;
    });
    return c;
  }, [vehicles]);

  const lineFeedingCount = useMemo(() =>
    vehicles.filter(v => v.current_station === "warehouse" && v.job_order_id && activeJobOrderIds.has(v.job_order_id)).length,
    [vehicles, activeJobOrderIds]
  );

  const stationVehicles = useMemo(() => {
    if (!selectedStation) return [];
    if (selectedStation === "line_feeding") {
      return vehicles
        .filter(v => v.current_station === "warehouse" && v.job_order_id && activeJobOrderIds.has(v.job_order_id))
        .map(v => ({ ...v, activeIssues: activeIssues[v.id] ?? [], resolvedIssues: resolvedIssues[v.id] ?? [], enteredAt: entryMap[v.id] ?? null, lots: v.lots ?? null, job_orders: v.job_orders ?? null }));
    }
    return vehicles
      .filter(v => v.current_station === selectedStation)
      .map(v => ({ ...v, activeIssues: activeIssues[v.id] ?? [], resolvedIssues: resolvedIssues[v.id] ?? [], enteredAt: entryMap[v.id] ?? null, lots: v.lots ?? null, job_orders: v.job_orders ?? null }));
  }, [selectedStation, vehicles, activeJobOrderIds, activeIssues, resolvedIssues, entryMap]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Production Flow</h1>
        <p className="text-muted-foreground text-sm">Live view of the production floor — click a station to see vehicles.</p>
      </div>
      <ProductionFlowDiagram counts={counts} lineFeedingCount={lineFeedingCount} onStationClick={setSelectedStation} />
      <StationDetailSheet
        stationKey={selectedStation ?? ""}
        vehicles={stationVehicles}
        open={!!selectedStation}
        onOpenChange={(open) => { if (!open) setSelectedStation(null); }}
      />
    </div>
  );
}
