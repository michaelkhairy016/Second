-- RPC: get_station_stays
-- Pairs station_events in/out per (vehicle, station) within [p_from, p_to],
-- sums factory_calendar.working_hours between entered_at and COALESCE(exited_at, now()).
-- Powers monthly flashback stay + delay columns (entry->exit, not just entry->today).
-- Includes model (lot -> contract_model fallback).
CREATE OR REPLACE FUNCTION public.get_station_stays(
  station_codes text[],
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  vehicle_id uuid,
  vin text,
  station text,
  model text,
  entered_at timestamptz,
  exited_at timestamptz,
  working_hours numeric,
  working_days bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH rng AS (
    SELECT COALESCE(p_from, '1900-01-01'::timestamptz) AS f,
           COALESCE(p_to,   now()::timestamptz)        AS t
  ),
  ins AS (
    SELECT DISTINCT ON (se.vehicle_id, se.station)
           se.vehicle_id, se.station::text AS station, se.recorded_at AS entered_at
    FROM public.station_events se
    JOIN public.vehicles v ON v.id = se.vehicle_id
    WHERE se.kind = 'in'
      AND se.station::text = ANY(station_codes)
      AND se.recorded_at >= (SELECT f FROM rng)
      AND se.recorded_at <= (SELECT t FROM rng)
    ORDER BY se.vehicle_id, se.station, se.recorded_at ASC
  ),
  outs AS (
    SELECT DISTINCT ON (se.vehicle_id, se.station)
           se.vehicle_id, se.station::text AS station, se.recorded_at AS exited_at
    FROM public.station_events se
    WHERE se.kind = 'out'
    ORDER BY se.vehicle_id, se.station, se.recorded_at ASC
  ),
  pairs AS (
    SELECT i.vehicle_id, i.station, i.entered_at, o.exited_at,
           COALESCE(o.exited_at, CURRENT_TIMESTAMP) AS stay_end
    FROM ins i
    LEFT JOIN outs o
      ON o.vehicle_id = i.vehicle_id
     AND o.station = i.station
     AND o.exited_at > i.entered_at
  ),
  cal AS (
    SELECT
      p.vehicle_id, p.station, p.entered_at, p.exited_at, p.stay_end,
      COALESCE(SUM(
        CASE
          WHEN p.entered_at::date < fc.date AND fc.date < p.stay_end::date THEN fc.working_hours
          WHEN p.entered_at::date = fc.date AND fc.date < p.stay_end::date THEN
            LEAST(fc.working_hours, GREATEST(0,
              fc.working_hours - EXTRACT(HOUR FROM p.entered_at::time) - (EXTRACT(MINUTE FROM p.entered_at::time)/60.0)))
          WHEN fc.date = p.stay_end::date AND p.entered_at::date < fc.date THEN
            LEAST(fc.working_hours, GREATEST(0,
              EXTRACT(HOUR FROM p.stay_end::time) + (EXTRACT(MINUTE FROM p.stay_end::time)/60.0)))
          WHEN p.entered_at::date = p.stay_end::date THEN
            GREATEST(0, EXTRACT(EPOCH FROM (p.stay_end - p.entered_at))/3600.0)
          ELSE 0
        END
      ), 0) AS working_hours,
      COUNT(*) FILTER (WHERE fc.is_working_day = true) AS working_days
    FROM pairs p
    LEFT JOIN public.factory_calendar fc
      ON fc.date BETWEEN p.entered_at::date AND p.stay_end::date
    GROUP BY p.vehicle_id, p.station, p.entered_at, p.exited_at, p.stay_end
  )
  SELECT
    c.vehicle_id,
    v.vin,
    c.station,
    COALESCE(l.model, v.contract_model, '') AS model,
    c.entered_at,
    c.exited_at,
    ROUND(c.working_hours, 1) AS working_hours,
    c.working_days
  FROM cal c
  JOIN public.vehicles v ON v.id = c.vehicle_id
  LEFT JOIN public.lots l ON l.id = v.lot_id
  ORDER BY c.station, c.entered_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_station_stays(text[], timestamptz, timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_station_stays(text[], timestamptz, timestamptz) FROM PUBLIC, anon;
