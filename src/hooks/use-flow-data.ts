import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Vehicle, Issue } from "@/lib/db-types";

export interface FlowVehicle extends Pick<Vehicle, "id" | "vin" | "vin_suffix" | "current_station" | "lot_id" | "job_order_id" | "planned_color_id" | "actual_color_id" | "is_lot_tail" | "tail_note"> {
  activeIssues: Issue[];
  resolvedIssues: Issue[];
  enteredAt: string | null;
}

export function useFlowData(channelName: string) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [entryMap, setEntryMap] = useState<Record<string, string>>({});
  const [activeIssues, setActiveIssues] = useState<Record<string, Issue[]>>({});
  const [resolvedIssues, setResolvedIssues] = useState<Record<string, Issue[]>>({});
  const [activeJobOrderIds, setActiveJobOrderIds] = useState<Set<string>>(new Set());
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: vs }, { data: ev }, { data: ai }, { data: ri }, { data: jos }] = await Promise.all([
      supabase.from("vehicles").select("id, vin, vin_suffix, current_station, lot_id, job_order_id, planned_color_id, actual_color_id, is_lot_tail, tail_note").is("completed_at", null),
      supabase.from("station_events").select("vehicle_id, station, recorded_at").eq("kind", "in").order("recorded_at", { ascending: false }),
      supabase.from("issues").select("*").in("status", ["open", "in_progress"]),
      supabase.from("issues").select("*").in("status", ["resolved", "closed"]),
      supabase.from("job_orders").select("id").eq("status", "active"),
    ]);
    const vehicles = (vs ?? []) as Vehicle[];
    setVehicles(vehicles);
    setActiveJobOrderIds(new Set((jos ?? []).map(j => j.id)));

    const map: Record<string, string> = {};
    for (const e of (ev ?? [])) {
      const v = vehicles.find(v => v.id === e.vehicle_id);
      if (v && e.station === v.current_station && !map[e.vehicle_id]) {
        map[e.vehicle_id] = e.recorded_at;
      }
    }
    setEntryMap(map);

    const aiMap: Record<string, Issue[]> = {};
    (ai ?? []).forEach(i => { if (i.vehicle_id) (aiMap[i.vehicle_id] ??= []).push(i); });
    setActiveIssues(aiMap);

    const riMap: Record<string, Issue[]> = {};
    (ri ?? []).forEach(i => { if (i.vehicle_id) (riMap[i.vehicle_id] ??= []).push(i); });
    setResolvedIssues(riMap);
    setLoading(false);
  }, []);

  // Debounced load — accumulate realtime events, reload once after 500ms silence
  const loadRef = useRef(load);
  loadRef.current = load;
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const debouncedLoad = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => loadRef.current(), 500);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_orders" }, debouncedLoad)
      .subscribe();
    return () => {
      clearTimeout(timerRef.current);
      supabase.removeChannel(ch);
    };
  }, [channelName, load, debouncedLoad]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    vehicles.forEach(v => { if (v.current_station) c[v.current_station] = (c[v.current_station] ?? 0) + 1; });
    return c;
  }, [vehicles]);

  const lineFeedingCount = useMemo(() =>
    vehicles.filter(v => v.current_station === "warehouse" && v.job_order_id && activeJobOrderIds.has(v.job_order_id)).length,
    [vehicles, activeJobOrderIds]
  );

  const stationVehicles = useMemo((): FlowVehicle[] => {
    if (!selectedStation) return [];
    const source = selectedStation === "line_feeding"
      ? vehicles.filter(v => v.current_station === "warehouse" && v.job_order_id && activeJobOrderIds.has(v.job_order_id))
      : vehicles.filter(v => v.current_station === selectedStation);
    return source.map(v => ({
      id: v.id, vin: v.vin, vin_suffix: v.vin_suffix, current_station: v.current_station,
      lot_id: v.lot_id, job_order_id: v.job_order_id, planned_color_id: v.planned_color_id,
      actual_color_id: v.actual_color_id, is_lot_tail: v.is_lot_tail, tail_note: v.tail_note,
      activeIssues: activeIssues[v.id] ?? [],
      resolvedIssues: resolvedIssues[v.id] ?? [],
      enteredAt: entryMap[v.id] ?? null,
    }));
  }, [selectedStation, vehicles, activeJobOrderIds, activeIssues, resolvedIssues, entryMap]);

  return { counts, lineFeedingCount, stationVehicles, selectedStation, setSelectedStation, loading };
}
