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

function Page() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeIssues, setActiveIssues] = useState<Record<string, Issue[]>>({});
  const [resolvedIssues, setResolvedIssues] = useState<Record<string, Issue[]>>({});
  const [activeJobOrderIds, setActiveJobOrderIds] = useState<Set<string>>(new Set());
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: vs }, { data: ai }, { data: ri }, { data: jos }] = await Promise.all([
      supabase.from("vehicles").select("*"),
      supabase.from("issues").select("*").in("status", ["open", "in_progress"]),
      supabase.from("issues").select("*").in("status", ["resolved", "closed"]),
      supabase.from("job_orders").select("id").eq("status", "active"),
    ]);
    setVehicles(vs ?? []);
    setActiveJobOrderIds(new Set((jos ?? []).map(j => j.id)));

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
        .map(v => ({ ...v, activeIssues: activeIssues[v.id] ?? [], resolvedIssues: resolvedIssues[v.id] ?? [] }));
    }
    return vehicles
      .filter(v => v.current_station === selectedStation)
      .map(v => ({ ...v, activeIssues: activeIssues[v.id] ?? [], resolvedIssues: resolvedIssues[v.id] ?? [] }));
  }, [selectedStation, vehicles, activeJobOrderIds, activeIssues, resolvedIssues]);

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
