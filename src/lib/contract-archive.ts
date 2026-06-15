import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function archiveContractVehicle(
  supabase: SupabaseClient<Database>,
  vehicleId: string,
  releasedFrom: "wbs" | "paint",
) {
  const now = new Date().toISOString();
  const user = (await supabase.auth.getUser()).data.user;

  // Fetch vehicle
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("*, lots(lot_code, model)")
    .eq("id", vehicleId)
    .single();
  if (!vehicle) throw new Error("Vehicle not found");

  // Fetch related data
  const [{ data: events }, { data: issues }, { data: shortages }] = await Promise.all([
    supabase.from("station_events").select("*").eq("vehicle_id", vehicleId).order("recorded_at"),
    supabase.from("issues").select("*").eq("vehicle_id", vehicleId),
    supabase.from("shortages").select("*").eq("vehicle_id", vehicleId),
  ]);

  // Insert into vehicle_archive
  await supabase.from("vehicle_archive").insert({
    vin: vehicle.vin,
    vin_suffix: vehicle.vin_suffix,
    lot_code: (vehicle.lots as any)?.lot_code ?? null,
    lot_model: (vehicle.lots as any)?.model ?? (vehicle as any).contract_model ?? null,
    vehicle_data: vehicle as any,
    events_data: events ?? [],
    issues_data: issues ?? [],
    shortages_data: shortages ?? [],
    archived_at: now,
  });

  // Insert into contract_vehicle_log
  if (vehicle.contract_model) {
    await supabase.from("contract_vehicle_log").insert({
      vin: vehicle.vin,
      vin_suffix: vehicle.vin_suffix,
      contract_model: vehicle.contract_model,
      released_from: releasedFrom,
      released_at: now,
      released_by: user?.id ?? null,
    });
  }

  // Mark vehicle completed
  await supabase
    .from("vehicles")
    .update({ current_station: "completed", completed_at: now })
    .eq("id", vehicleId);
}
