import { supabase } from "@/integrations/supabase/client";

export async function findEngineBySuffix(suffix: string) {
  const s = suffix.trim().toUpperCase();
  if (s.length < 3) return [];
  const { data, error } = await supabase
    .from("engines")
    .select("id, engine_number, engine_suffix, lot_id, job_order_id, status, lot:lots(lot_code, model)")
    .ilike("engine_suffix", `%${s}`)
    .limit(10);
  if (error) throw error;
  return data ?? [];
}
