import { supabase } from "@/integrations/supabase/client";

/** Strip leading/trailing asterisks from a VIN for matching */
export const stripVinStars = (v: string) => v.replace(/^\*|\*$/g, "");

/** Look up vehicles by last-N digits (typically last 5). Also searches archive. */
export async function findBySuffix(suffix: string) {
  const s = stripVinStars(suffix.trim().toUpperCase());
  if (s.length < 3) return [];
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, vin, vin_suffix, planned_color_id, actual_color_id, current_station, lot_id, job_order_id, is_lot_tail, tail_note, contract_model, completed_at")
    .ilike("vin_suffix", `%${s.slice(-5)}`)
    .limit(10);
  if (error) throw error;

  // Also search archive for completed vehicles
  const { data: archived } = await supabase
    .from("vehicle_archive")
    .select("vin, vin_suffix, lot_model, archived_at")
    .ilike("vin_suffix", `%${s.slice(-5)}`)
    .limit(5);

  const activeResults = (data ?? []).map(v => ({
    ...v,
    is_archived: false,
  }));

  const archiveResults = (archived ?? []).map(a => ({
    id: `archived-${a.vin}`,
    vin: a.vin,
    vin_suffix: a.vin_suffix,
    planned_color_id: null,
    actual_color_id: null,
    current_station: null,
    lot_id: null,
    job_order_id: null,
    is_lot_tail: false,
    tail_note: null,
    contract_model: null as string | null,
    completed_at: a.archived_at,
    is_archived: true,
    lot_model: a.lot_model,
  }));

  return [...activeResults, ...archiveResults];
}
