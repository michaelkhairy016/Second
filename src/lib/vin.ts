import { supabase } from "@/integrations/supabase/client";

/** Look up vehicles by last-N digits (typically last 5). */
export async function findBySuffix(suffix: string) {
  const s = suffix.trim().toUpperCase();
  if (s.length < 3) return [];
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, vin, vin_suffix, planned_color, actual_color, current_station, lot_id, job_order_id, is_lot_tail, tail_note")
    .ilike("vin_suffix", `%${s}`)
    .limit(10);
  if (error) throw error;
  return data ?? [];
}
