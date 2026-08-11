import { supabase } from "@/integrations/supabase/client";
import type {
  StationCode,
  StockCount,
  StockCountItemWithVehicle,
  StockCountWithProfiles,
} from "@/lib/db-types";

export type ScanResult = { kind: "matched" | "new" | "duplicate"; vehicleId: string };

/** Minimal vehicle shape needed to record a scan (matches findBySuffix output). */
export interface ScanVehicle {
  id: string;
  vin: string;
  vin_suffix: string;
  current_station: string | null;
  is_archived?: boolean;
}

async function currentUser(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error("Not authenticated");
  return data.user.id;
}

// NOTE: stock_counts.{requested,started,completed}_by reference auth.users, and PostgREST
// cannot embed profiles through that FK (the bridge is unsupported on this instance). So we
// fetch display_name separately and attach client-side.
async function fetchProfilesMap(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  if (error) throw error;
  return new Map((data ?? []).map(p => [p.id, p.display_name]));
}

function attachProfiles(c: StockCount, pm: Map<string, string>): StockCountWithProfiles {
  return {
    ...c,
    requester: c.requested_by ? { display_name: pm.get(c.requested_by) ?? null } : null,
    starter: c.started_by ? { display_name: pm.get(c.started_by) ?? null } : null,
    completer: c.completed_by ? { display_name: pm.get(c.completed_by) ?? null } : null,
  };
}

/** Request a new stock count for a buffer area. Returns the new count id. */
export async function requestStockCount(station: StationCode): Promise<string> {
  const { data, error } = await supabase.rpc("request_stock_count", { p_station: station });
  if (error) throw error;
  return data as string;
}

/** Active (requested or in_progress) count for a station, if any. */
export async function getActiveCountForStation(station: StationCode): Promise<StockCountWithProfiles | null> {
  const { data, error } = await supabase
    .from("stock_counts")
    .select("*")
    .eq("station", station)
    .in("status", ["requested", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as StockCount | null;
  if (!row) return null;
  const pm = await fetchProfilesMap([row.requested_by, row.started_by, row.completed_by]);
  return attachProfiles(row, pm);
}

/** Claim a requested count. Race-safe: only transitions status='requested' rows. */
export async function startCount(countId: string): Promise<boolean> {
  const userId = await currentUser();
  const { data, error } = await supabase
    .from("stock_counts")
    .update({ status: "in_progress", started_by: userId, started_at: new Date().toISOString() })
    .eq("id", countId)
    .eq("status", "requested")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * Record a scanned vehicle against a count.
 * - Vehicle in snapshot & unscanned -> 'matched'.
 * - Vehicle already matched/new     -> 'duplicate' (no-op).
 * - Vehicle not in snapshot         -> 'new': registers a station 'in' event (if not already
 *   at the station, mirroring ScanForm submit('in')) then inserts an outcome='new' item.
 */
export async function recordScan(countId: string, station: StationCode, vehicle: ScanVehicle): Promise<ScanResult> {
  if (vehicle.is_archived || vehicle.id.startsWith("archived-")) {
    throw new Error("Archived vehicles cannot be counted");
  }
  const userId = await currentUser();
  const now = new Date().toISOString();

  const { data: existing, error: fe } = await supabase
    .from("stock_count_items")
    .select("id, outcome")
    .eq("stock_count_id", countId)
    .eq("vehicle_id", vehicle.id)
    .maybeSingle();
  if (fe) throw fe;

  if (existing) {
    if (existing.outcome === "expected") {
      const { error } = await supabase
        .from("stock_count_items")
        .update({ outcome: "matched", scanned_at: now, scanned_by: userId })
        .eq("id", existing.id);
      if (error) throw error;
      return { kind: "matched", vehicleId: vehicle.id };
    }
    return { kind: "duplicate", vehicleId: vehicle.id };
  }

  // New find: register IN if not already at this station.
  if (vehicle.current_station !== station) {
    const { error: evErr } = await supabase.from("station_events").insert({
      vehicle_id: vehicle.id,
      station,
      kind: "in",
      recorded_by: userId,
      source: "stock_count",
      meta: { stock_count_id: countId },
    });
    if (evErr) throw evErr;
    const { error: vErr } = await supabase.from("vehicles").update({ current_station: station }).eq("id", vehicle.id);
    if (vErr) throw vErr;
  }

  const { error: insErr } = await supabase.from("stock_count_items").insert({
    stock_count_id: countId,
    vehicle_id: vehicle.id,
    vin_snapshot: vehicle.vin,
    vin_suffix_snapshot: vehicle.vin_suffix,
    station_snapshot: station,
    outcome: "new",
    scanned_at: now,
    scanned_by: userId,
  });
  if (insErr) throw insErr;

  return { kind: "new", vehicleId: vehicle.id };
}

/** Finalize a count: auto-advance unscanned expected vehicles, tally, close. Server-side RPC. */
export async function completeCount(countId: string): Promise<void> {
  const { error } = await supabase.rpc("complete_stock_count", { p_count_id: countId });
  if (error) throw error;
}

/** Cancel an open count (no vehicle writes performed). */
export async function cancelCount(countId: string): Promise<void> {
  const userId = await currentUser();
  const { error } = await supabase
    .from("stock_counts")
    .update({ status: "cancelled", cancelled_by: userId, cancelled_at: new Date().toISOString() })
    .eq("id", countId)
    .in("status", ["requested", "in_progress"]);
  if (error) throw error;
}

/** Recent counts (all statuses) with requester/starter/completer names. */
export async function getRecentCounts(limit = 50): Promise<StockCountWithProfiles[]> {
  const { data, error } = await supabase
    .from("stock_counts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data as unknown as StockCount[]) ?? [];
  const pm = await fetchProfilesMap(rows.flatMap(r => [r.requested_by, r.started_by, r.completed_by]));
  return rows.map(r => attachProfiles(r, pm));
}

/** One count with profile names + all items (with vehicle vin). */
export async function getCountDetail(countId: string): Promise<StockCountWithProfiles | null> {
  const { data, error } = await supabase
    .from("stock_counts")
    .select("*, items:stock_count_items(*, vehicle:vehicles(vin, current_station))")
    .eq("id", countId)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as (StockCount & { items: StockCountItemWithVehicle[] }) | null;
  if (!row) return null;
  const pm = await fetchProfilesMap([row.requested_by, row.started_by, row.completed_by]);
  return { ...attachProfiles(row, pm), items: row.items };
}

/** Live items for a count (used for progress + summary while scanning). */
export async function getCountItems(countId: string): Promise<StockCountItemWithVehicle[]> {
  const { data, error } = await supabase
    .from("stock_count_items")
    .select("*, vehicle:vehicles(vin, current_station)")
    .eq("stock_count_id", countId);
  if (error) throw error;
  return (data as unknown as StockCountItemWithVehicle[]) ?? [];
}
