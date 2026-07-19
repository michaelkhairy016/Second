-- Single source of truth for displayed times: Postgres formats every timestamp
-- as a Cairo text string (YYYY-MM-DD HH24:MI, 24h, no seconds). Frontend prints
-- these raw — no new Date(), no browser tz-DB, no PC clock. Postgres tz-DB is
-- maintained by Supabase (always fresh, DST-correct), unlike viewer PCs whose
-- IANA tz-DB can be stale (missing Egypt post-2023 DST → Cairo computed +2 not +3).
--
-- Also adds server_now_ms() RPC so "now"-relative math (durations, fetch windows,
-- relative labels) uses the server clock instead of the viewer's Date.now().
--
-- Reversible: DROP COLUMN ..._cairo + DROP FUNCTION server_now_ms + revert RPCs.
-- No historical data rewritten; generated columns recompute from timestamptz source.

-- ---------------------------------------------------------------------------
-- 1. Generated *_cairo text columns on displayed tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.station_events
  ADD COLUMN IF NOT EXISTS recorded_at_cairo text
    GENERATED ALWAYS AS (to_char(recorded_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI')) STORED;

ALTER TABLE public.shortages
  ADD COLUMN IF NOT EXISTS created_at_cairo text
    GENERATED ALWAYS AS (to_char(created_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI')) STORED,
  ADD COLUMN IF NOT EXISTS cleared_at_cairo text
    GENERATED ALWAYS AS (to_char(cleared_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI')) STORED;

ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS created_at_cairo text
    GENERATED ALWAYS AS (to_char(created_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI')) STORED,
  ADD COLUMN IF NOT EXISTS resolved_at_cairo text
    GENERATED ALWAYS AS (to_char(resolved_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI')) STORED;

ALTER TABLE public.restrictions
  ADD COLUMN IF NOT EXISTS created_at_cairo text
    GENERATED ALWAYS AS (to_char(created_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI')) STORED;

ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS released_at_cairo text
    GENERATED ALWAYS AS (to_char(released_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI')) STORED;

ALTER TABLE public.contract_vehicle_log
  ADD COLUMN IF NOT EXISTS released_at_cairo text
    GENERATED ALWAYS AS (to_char(released_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI')) STORED;

-- ---------------------------------------------------------------------------
-- 2. server_now_ms() — server-authoritative clock for frontend "now" math
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_now_ms()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (EXTRACT(EPOCH FROM now())::bigint) * 1000;
$$;
GRANT EXECUTE ON FUNCTION public.server_now_ms() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.server_now_ms() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3. RPCs: append *_cairo text return columns
-- ---------------------------------------------------------------------------

-- get_production_events — add recorded_at_cairo in both UNION branches
CREATE OR REPLACE FUNCTION public.get_production_events(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  recorded_at timestamptz,
  recorded_at_cairo text,
  station public.station_code,
  kind public.event_kind,
  vehicle_id uuid,
  vin text,
  vin_suffix text,
  model text,
  archived boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path TO public AS $$
  SELECT e.recorded_at,
         to_char(e.recorded_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') AS recorded_at_cairo,
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
  SELECT (ev->>'recorded_at')::timestamptz AS recorded_at,
         to_char((ev->>'recorded_at')::timestamptz AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') AS recorded_at_cairo,
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

-- get_wip_working_hours — broadened entry resolution (from 20260617000001) + entered_at_cairo
CREATE OR REPLACE FUNCTION public.get_wip_working_hours(station_codes text[])
RETURNS TABLE (
  vehicle_id uuid,
  entered_at timestamptz,
  entered_at_cairo text,
  working_hours numeric,
  working_days bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH exact_in AS (
    SELECT DISTINCT ON (se.vehicle_id)
      se.vehicle_id, se.recorded_at AS entered_at
    FROM public.station_events se
    INNER JOIN public.vehicles v ON v.id = se.vehicle_id
    WHERE se.kind = 'in'
      AND v.current_station::text = ANY(station_codes)
      AND se.station::text = v.current_station::text
      AND v.completed_at IS NULL
    ORDER BY se.vehicle_id, se.recorded_at DESC
  ),
  any_in AS (
    SELECT DISTINCT ON (se.vehicle_id)
      se.vehicle_id, se.recorded_at AS entered_at
    FROM public.station_events se
    INNER JOIN public.vehicles v ON v.id = se.vehicle_id
    WHERE se.kind = 'in'
      AND v.current_station::text = ANY(station_codes)
      AND v.completed_at IS NULL
    ORDER BY se.vehicle_id, se.recorded_at DESC
  ),
  latest_in AS (
    SELECT v.id AS vehicle_id,
      COALESCE(e.entered_at, a.entered_at, v.updated_at) AS entered_at
    FROM public.vehicles v
    LEFT JOIN exact_in e ON e.vehicle_id = v.id
    LEFT JOIN any_in a ON a.vehicle_id = v.id
    WHERE v.current_station::text = ANY(station_codes)
      AND v.completed_at IS NULL
  ),
  calendar_calc AS (
    SELECT li.vehicle_id, li.entered_at,
      COALESCE(SUM(
        CASE
          WHEN li.entered_at::date < fc.date AND fc.date < CURRENT_DATE THEN fc.working_hours
          WHEN li.entered_at::date = fc.date THEN
            LEAST(fc.working_hours, GREATEST(0,
              fc.working_hours - EXTRACT(HOUR FROM li.entered_at::time) -
              (EXTRACT(MINUTE FROM li.entered_at::time) / 60.0)
            ))
          WHEN fc.date = CURRENT_DATE THEN
            LEAST(fc.working_hours, GREATEST(0,
              EXTRACT(HOUR FROM CURRENT_TIMESTAMP::time) +
              (EXTRACT(MINUTE FROM CURRENT_TIMESTAMP::time) / 60.0)
            ))
          ELSE 0
        END
      ), 0) AS working_hours,
      COUNT(*) FILTER (WHERE fc.is_working_day = true) AS working_days
    FROM latest_in li
    LEFT JOIN public.factory_calendar fc
      ON fc.date BETWEEN li.entered_at::date AND CURRENT_DATE
    GROUP BY li.vehicle_id, li.entered_at
  )
  SELECT cc.vehicle_id, cc.entered_at,
    to_char(cc.entered_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') AS entered_at_cairo,
    ROUND(cc.working_hours, 1) AS working_hours,
    cc.working_days
  FROM calendar_calc cc;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_wip_working_hours(text[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_wip_working_hours(text[]) FROM PUBLIC, anon;

-- get_delayed_vehicles — add entered_at_cairo (sourced from wh)
CREATE OR REPLACE FUNCTION public.get_delayed_vehicles(threshold_days int DEFAULT 2)
RETURNS TABLE (
  vehicle_id uuid,
  vin text,
  vin_suffix text,
  current_station text,
  entered_at timestamptz,
  entered_at_cairo text,
  working_hours numeric,
  working_days bigint,
  lot_code text,
  lot_model text,
  job_order_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT v.id AS vehicle_id, v.vin, v.vin_suffix, v.current_station::text,
    wh.entered_at, wh.entered_at_cairo,
    wh.working_hours, wh.working_days,
    l.lot_code, l.model AS lot_model, v.job_order_id
  FROM public.get_wip_working_hours(
    ARRAY['shortage','pbs','wbs','tcf','repair','cs','pdi','waiting_repair','tcf_offline']::text[]
  ) wh
  INNER JOIN public.vehicles v ON v.id = wh.vehicle_id
  LEFT JOIN public.lots l ON l.id = v.lot_id
  WHERE wh.working_days >= threshold_days;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_delayed_vehicles(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_delayed_vehicles(int) FROM PUBLIC, anon;

-- get_station_stays — add entered_at_cairo + exited_at_cairo
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
  entered_at_cairo text,
  exited_at timestamptz,
  exited_at_cairo text,
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
    SELECT p.vehicle_id, p.station, p.entered_at, p.exited_at, p.stay_end,
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
  SELECT c.vehicle_id, v.vin, c.station,
    COALESCE(l.model, v.contract_model, '') AS model,
    c.entered_at,
    to_char(c.entered_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') AS entered_at_cairo,
    c.exited_at,
    to_char(c.exited_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') AS exited_at_cairo,
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
