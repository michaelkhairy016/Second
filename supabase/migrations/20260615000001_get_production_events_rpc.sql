-- Unified production events: active station_events + archived events (from vehicle_archive.events_data).
-- Returns each event with resolved model + vin so archived vehicles count in historical in/out reports.
CREATE OR REPLACE FUNCTION public.get_production_events(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  recorded_at timestamptz,
  station public.station_code,
  kind public.event_kind,
  vehicle_id uuid,
  vin text,
  vin_suffix text,
  model text,
  archived boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  -- Active events (vehicle still in vehicles table)
  SELECT e.recorded_at,
         e.station,
         e.kind,
         e.vehicle_id,
         v.vin,
         v.vin_suffix,
         COALESCE(l.model, v.contract_model, 'Unknown') AS model,
         false AS archived
  FROM public.station_events e
  JOIN public.vehicles v ON v.id = e.vehicle_id
  LEFT JOIN public.lots l ON l.id = v.lot_id
  WHERE e.recorded_at >= p_from AND e.recorded_at <= p_to
  UNION ALL
  -- Archived events (vehicle hard-deleted; events preserved in archive JSON)
  SELECT (ev->>'recorded_at')::timestamptz AS recorded_at,
         (ev->>'station')::public.station_code AS station,
         (ev->>'kind')::public.event_kind AS kind,
         NULL::uuid AS vehicle_id,
         ae.vin,
         ae.vin_suffix,
         COALESCE(ae.lot_model, (ae.vehicle_data->>'contract_model'), 'Unknown') AS model,
         true AS archived
  FROM public.vehicle_archive ae
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(ae.events_data) = 'array' THEN ae.events_data ELSE '[]'::jsonb END) AS ev
  WHERE (ev->>'recorded_at') IS NOT NULL
    AND (ev->>'recorded_at')::timestamptz >= p_from
    AND (ev->>'recorded_at')::timestamptz <= p_to;
$$;
