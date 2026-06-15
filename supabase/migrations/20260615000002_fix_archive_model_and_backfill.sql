-- Backfill existing archive rows: populate lot_model from contract_model when missing
UPDATE public.vehicle_archive
SET lot_model = vehicle_data->>'contract_model'
WHERE lot_model IS NULL
  AND vehicle_data->>'contract_model' IS NOT NULL;

-- Fix the archive RPC: populate lot_model with contract_model fallback + dedup by vin
CREATE OR REPLACE FUNCTION public.archive_completed_vehicles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  vehicle_rec RECORD;
BEGIN
  FOR vehicle_rec IN
    SELECT v.id, v.vin, v.vin_suffix, v.lot_id, v.completed_at,
           COALESCE(l.model, v.contract_model) AS lot_model, l.lot_code
    FROM public.vehicles v
    LEFT JOIN public.lots l ON l.id = v.lot_id
    WHERE v.completed_at IS NOT NULL
  LOOP
    -- Insert into archive with all related data (only if not already archived by vin)
    INSERT INTO public.vehicle_archive (vin, vin_suffix, lot_model, lot_code, vehicle_data, events_data, issues_data, shortages_data)
    SELECT
      vehicle_rec.vin,
      vehicle_rec.vin_suffix,
      vehicle_rec.lot_model,
      vehicle_rec.lot_code,
      to_jsonb(vehicle_rec),
      (SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) FROM public.station_events e WHERE e.vehicle_id = vehicle_rec.id),
      (SELECT coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) FROM public.issues i WHERE i.vehicle_id = vehicle_rec.id),
      (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM public.shortages s WHERE s.vehicle_id = vehicle_rec.id)
    WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_archive a WHERE a.vin = vehicle_rec.vin);

    -- Delete related records (order matters for FK constraints)
    DELETE FROM public.shortages WHERE vehicle_id = vehicle_rec.id;
    DELETE FROM public.issues WHERE vehicle_id = vehicle_rec.id;
    DELETE FROM public.station_events WHERE vehicle_id = vehicle_rec.id;
    DELETE FROM public.vehicles WHERE id = vehicle_rec.id;
  END LOOP;
END;
$function$;
