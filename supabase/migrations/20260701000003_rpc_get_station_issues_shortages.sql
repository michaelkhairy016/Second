-- RPC: get_station_issues_shortages
-- Issues + shortages for a station/month, live + archived, server-side (POST body, no URL limit).
-- out_vin alias avoids PL/pgSQL ambiguous-column error vs table .vin.
CREATE OR REPLACE FUNCTION public.get_station_issues_shortages(
  station_codes text[],
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  out_vin text,
  kind text,
  title text,
  shortage_reason text,
  part_type text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH live_vids AS (
    SELECT DISTINCT se.vehicle_id AS vid
    FROM public.station_events se
    WHERE se.station::text = ANY(station_codes)
      AND se.recorded_at >= p_from AND se.recorded_at <= p_to
      AND se.vehicle_id IS NOT NULL
  ),
  arch_vins AS (
    SELECT DISTINCT ae.vin AS avin
    FROM public.vehicle_archive ae
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ae.events_data) = 'array' THEN ae.events_data ELSE '[]'::jsonb END
    ) AS e
    WHERE (e->>'station') = ANY(station_codes)
      AND (e->>'recorded_at') IS NOT NULL
      AND (e->>'recorded_at')::timestamptz >= p_from
      AND (e->>'recorded_at')::timestamptz <= p_to
  )
  SELECT v.vin, 'issue'::text, i.title, NULL::text, NULL::text
  FROM public.issues i
  JOIN public.vehicles v ON v.id = i.vehicle_id
  WHERE i.vehicle_id IN (SELECT lv.vid FROM live_vids lv)
  UNION ALL
  SELECT ae.vin, 'issue'::text, COALESCE(e->>'title',''), NULL::text, NULL::text
  FROM public.vehicle_archive ae
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(ae.issues_data) = 'array' THEN ae.issues_data ELSE '[]'::jsonb END
  ) AS e
  WHERE ae.vin IN (SELECT av.avin FROM arch_vins av)
    AND (e->>'title') IS NOT NULL
  UNION ALL
  SELECT v.vin, 'shortage'::text,
         array_to_string(s.parts, ', '),
         s.shortage_reason, s.part_type
  FROM public.shortages s
  JOIN public.vehicles v ON v.id = s.vehicle_id
  WHERE s.vehicle_id IN (SELECT lv.vid FROM live_vids lv)
  UNION ALL
  SELECT ae.vin, 'shortage'::text,
         CASE WHEN jsonb_typeof(e->'parts') = 'array'
              THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(e->'parts')), ', ')
              ELSE COALESCE(e->>'parts','') END,
         e->>'shortage_reason', e->>'part_type'
  FROM public.vehicle_archive ae
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(ae.shortages_data) = 'array' THEN ae.shortages_data ELSE '[]'::jsonb END
  ) AS e
  WHERE ae.vin IN (SELECT av.avin FROM arch_vins av)
    AND ((e->>'shortage_reason') IS NOT NULL OR (e->>'parts') IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_station_issues_shortages(text[], timestamptz, timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_station_issues_shortages(text[], timestamptz, timestamptz) FROM PUBLIC, anon;
