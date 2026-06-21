import { supabase } from "@/integrations/supabase/client";

/**
 * Archive-pull-on-scan: pull an archived vehicle back to live tables by VIN suffix.
 * Calls the `restore_archived_vehicle_by_suffix` RPC, which restores the vehicle +
 * its station_events/shortages/issues from the archive and deletes the archive row.
 * Returns a minimal live-vehicle object, or null if not found in the archive.
 */
export async function restoreArchivedBySuffix(suffix: string | null | undefined): Promise<{
  id: string;
  vin: string;
  vin_suffix: string;
  current_station: string | null;
  lot_id: string | null;
  actual_color_id: string | null;
  completed_at: null;
} | null> {
  const s = (suffix ?? "").trim().toUpperCase();
  if (s.length < 3) return null;
  // RPC name is created via migration; cast to bypass the generated-type allowlist.
  const { data, error } = await (supabase.rpc as any)("restore_archived_vehicle_by_suffix", { p_suffix: s });
  if (error) throw error;
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return null;
  return {
    id: row.o_id as string,
    vin: row.o_vin as string,
    vin_suffix: row.o_vin_suffix as string,
    current_station: (row.o_current_station as string | null) ?? null,
    lot_id: (row.o_lot_id as string | null) ?? null,
    actual_color_id: (row.o_actual_color_id as string | null) ?? null,
    completed_at: null,
  };
}
