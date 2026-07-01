-- Restore RPC: clear ALL vehicle_archive rows for the restored VIN (not just the
-- newest one), so repeated archive/restore cycles can't leave stale duplicate
-- rows that re-inflate get_production_events counts. Same change applied in the
-- "already live" early-return path.
CREATE OR REPLACE FUNCTION public.restore_archived_vehicle_by_suffix(p_suffix text)
RETURNS TABLE(o_id uuid, o_vin text, o_vin_suffix text, o_current_station station_code, o_lot_id uuid, o_actual_color_id uuid, o_completed_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_aid uuid;
  v_vid uuid;
  v_vin text;
  v_key text;
BEGIN
  v_key := right(regexp_replace(coalesce(p_suffix, ''), '[^0-9A-Za-z]', '', 'g'), 5);
  IF length(v_key) < 3 THEN
    RETURN;
  END IF;

  SELECT a.id, (a.vehicle_data->>'id')::uuid, a.vin
  INTO v_aid, v_vid, v_vin
  FROM public.vehicle_archive a
  WHERE a.vin_suffix ILIKE '%' || v_key
  ORDER BY a.archived_at DESC NULLS LAST
  LIMIT 1;

  IF v_aid IS NULL OR v_vid IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.vehicles vv WHERE vv.id = v_vid) THEN
    -- Already live: any archive rows for this VIN are stale -> clear them all.
    DELETE FROM public.vehicle_archive WHERE vin = v_vin;
    RETURN QUERY
      SELECT vv.id, vv.vin, vv.vin_suffix, vv.current_station, vv.lot_id, vv.actual_color_id, vv.completed_at
      FROM public.vehicles vv WHERE vv.id = v_vid;
    RETURN;
  END IF;

  INSERT INTO public.vehicles
    (id, vin, vin_suffix, current_station, lot_id, job_order_id, is_lot_tail, tail_note,
     created_at, updated_at, planned_color_id, actual_color_id, completed_at, contract_model)
  SELECT
    v_vid,
    a.vehicle_data->>'vin',
    a.vehicle_data->>'vin_suffix',
    NULLIF(a.vehicle_data->>'current_station','')::public.station_code,
    NULLIF(a.vehicle_data->>'lot_id','')::uuid,
    NULLIF(a.vehicle_data->>'job_order_id','')::uuid,
    COALESCE((a.vehicle_data->>'is_lot_tail')::boolean, false),
    a.vehicle_data->>'tail_note',
    COALESCE(NULLIF(a.vehicle_data->>'created_at','')::timestamptz, now()),
    now(),
    NULLIF(a.vehicle_data->>'planned_color_id','')::uuid,
    NULLIF(a.vehicle_data->>'actual_color_id','')::uuid,
    NULL,
    NULLIF(a.vehicle_data->>'contract_model','')
  FROM public.vehicle_archive a WHERE a.id = v_aid;

  INSERT INTO public.station_events
    (id, vehicle_id, station, kind, source, meta, recorded_by, recorded_at, color_used_id)
  SELECT (sub.rec).id, (sub.rec).vehicle_id, (sub.rec).station, (sub.rec).kind, (sub.rec).source,
         (sub.rec).meta, (sub.rec).recorded_by, (sub.rec).recorded_at, (sub.rec).color_used_id
  FROM (
    SELECT jsonb_populate_record(null::public.station_events, e) AS rec
    FROM public.vehicle_archive a,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(a.events_data)='array' THEN a.events_data ELSE '[]'::jsonb END) e
    WHERE a.id = v_aid AND e->>'id' IS NOT NULL AND e->>'recorded_at' IS NOT NULL
  ) sub
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.shortages
    (id, vehicle_id, parts, status, notes, created_by, cleared_by, cleared_at, created_at,
     part_type, responsibility, received_by, released_by, shortage_reason)
  SELECT (sub.rec).id, (sub.rec).vehicle_id, (sub.rec).parts, (sub.rec).status, (sub.rec).notes,
         (sub.rec).created_by, (sub.rec).cleared_by, (sub.rec).cleared_at, (sub.rec).created_at,
         (sub.rec).part_type, (sub.rec).responsibility, (sub.rec).received_by, (sub.rec).released_by,
         (sub.rec).shortage_reason
  FROM (
    SELECT jsonb_populate_record(null::public.shortages, s) AS rec
    FROM public.vehicle_archive a,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(a.shortages_data)='array' THEN a.shortages_data ELSE '[]'::jsonb END) s
    WHERE a.id = v_aid AND s->>'id' IS NOT NULL
  ) sub
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.issues
    (id, title, description, severity, status, station, vehicle_id, reported_by, assigned_to,
     resolved_by, resolved_at, created_at, updated_at)
  SELECT (sub.rec).title, (sub.rec).description, (sub.rec).severity, (sub.rec).status,
         (sub.rec).station, (sub.rec).vehicle_id, (sub.rec).reported_by, (sub.rec).assigned_to,
         (sub.rec).resolved_by, (sub.rec).resolved_at, (sub.rec).created_at, (sub.rec).updated_at
  FROM (
    SELECT jsonb_populate_record(null::public.issues, i) AS rec
    FROM public.vehicle_archive a,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(a.issues_data)='array' THEN a.issues_data ELSE '[]'::jsonb END) i
    WHERE a.id = v_aid AND i->>'id' IS NOT NULL
  ) sub
  ON CONFLICT (id) DO NOTHING;

  -- Clear ALL archive rows for this VIN (not just the one restored from).
  DELETE FROM public.vehicle_archive WHERE vin = v_vin;

  RETURN QUERY
    SELECT vv.id, vv.vin, vv.vin_suffix, vv.current_station, vv.lot_id, vv.actual_color_id, vv.completed_at
    FROM public.vehicles vv WHERE vv.id = v_vid;
END;
$function$;
