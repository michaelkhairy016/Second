-- RPC: get_monthly_flow
-- Monthly in/out counts per station over last N months, merging live station_events + archived vehicle_archive.events_data.
CREATE OR REPLACE FUNCTION public.get_monthly_flow(
  months_back int DEFAULT 6,
  station_codes text[] DEFAULT NULL
)
RETURNS TABLE (
  month text,
  station text,
  ins bigint,
  outs bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  start_month timestamptz;
BEGIN
  start_month := date_trunc('month', CURRENT_DATE - make_interval(months => LEAST(months_back, 24)));
  RETURN QUERY
  WITH ev AS (
    SELECT se.recorded_at AS recorded_at, se.station::text AS station, se.kind::text AS kind
    FROM public.station_events se
    WHERE se.recorded_at >= start_month
      AND (station_codes IS NULL OR se.station::text = ANY(station_codes))
    UNION ALL
    SELECT (e->>'recorded_at')::timestamptz AS recorded_at,
           (e->>'station')::text AS station,
           (e->>'kind')::text AS kind
    FROM public.vehicle_archive ae
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ae.events_data) = 'array' THEN ae.events_data ELSE '[]'::jsonb END
    ) AS e
    WHERE (e->>'recorded_at') IS NOT NULL
      AND (e->>'recorded_at')::timestamptz >= start_month
      AND (station_codes IS NULL OR (e->>'station') = ANY(station_codes))
  )
  SELECT to_char(date_trunc('month', ev.recorded_at), 'YYYY-MM') AS month,
         ev.station,
         COUNT(*) FILTER (WHERE ev.kind = 'in') AS ins,
         COUNT(*) FILTER (WHERE ev.kind = 'out') AS outs
  FROM ev
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_flow(int, text[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_monthly_flow(int, text[]) FROM PUBLIC, anon;
