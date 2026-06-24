-- archive_completed_vehicles(): store current_station + planned/actual color so restores
-- (e.g. the 2026-06-18 cleanup restore, commit f40c007) no longer lose them. Previously
-- vehicle_rec selected only id/vin/vin_suffix/lot_id/completed_at/lot_model/lot_code, so
-- to_jsonb(vehicle_rec) dropped current_station & color ids -> restore guessed station from
-- last 'in' event (resurrecting cleared cars to the shortage bay) and lost color.
-- issues_data / shortages_data / events_data were already archived; unchanged.

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
           v.current_station, v.planned_color_id, v.actual_color_id,
           v.job_order_id, v.is_lot_tail, v.tail_note, v.contract_model, v.created_at, v.updated_at,
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
