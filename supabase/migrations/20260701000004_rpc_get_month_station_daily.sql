-- RPC: get_month_station_daily
-- Per-day per-station in/out counts (live + archived), small aggregated result.
-- Avoids the ~1000-row PostgREST cap that hits when pulling raw events client-side.
CREATE OR REPLACE FUNCTION public.get_month_station_daily(
  station_codes text[],
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  day text,
  station text,
  ins bigint,
  outs bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH ev AS (
    SELECT se.recorded_at AS recorded_at, se.station::text AS station, se.kind::text AS kind
    FROM public.station_events se
    WHERE se.station::text = ANY(station_codes)
      AND se.recorded_at >= p_from AND se.recorded_at <= p_to
    UNION ALL
    SELECT (e->>'recorded_at')::timestamptz AS recorded_at,
           (e->>'station')::text AS station,
           (e->>'kind')::text AS kind
    FROM public.vehicle_archive ae
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ae.events_data) = 'array' THEN ae.events_data ELSE '[]'::jsonb END
    ) AS e
    WHERE (e->>'station') = ANY(station_codes)
      AND (e->>'recorded_at') IS NOT NULL
      AND (e->>'recorded_at')::timestamptz >= p_from
      AND (e->>'recorded_at')::timestamptz <= p_to
  )
  SELECT to_char(date_trunc('day', ev.recorded_at), 'YYYY-MM-DD') AS day,
         ev.station,
         COUNT(*) FILTER (WHERE ev.kind = 'in') AS ins,
         COUNT(*) FILTER (WHERE ev.kind = 'out') AS outs
  FROM ev
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_month_station_daily(text[], timestamptz, timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_month_station_daily(text[], timestamptz, timestamptz) FROM PUBLIC, anon;
