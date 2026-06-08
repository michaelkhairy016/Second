-- RPC: get_wip_working_hours
-- Returns working hours/days for vehicles at given stations using factory_calendar
-- Depends on: factory_calendar table, station_events table, vehicles table

CREATE OR REPLACE FUNCTION public.get_wip_working_hours(station_codes text[])
RETURNS TABLE (
  vehicle_id uuid,
  entered_at timestamptz,
  working_hours numeric,
  working_days bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH latest_in AS (
    SELECT DISTINCT ON (se.vehicle_id)
      se.vehicle_id,
      se.recorded_at AS entered_at,
      se.station
    FROM public.station_events se
    INNER JOIN public.vehicles v ON v.id = se.vehicle_id
    WHERE se.kind = 'in'
      AND v.current_station::text = ANY(station_codes)
      AND se.station::text = v.current_station::text
      AND v.completed_at IS NULL
    ORDER BY se.vehicle_id, se.recorded_at DESC
  ),
  calendar_calc AS (
    SELECT
      li.vehicle_id,
      li.entered_at,
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
  SELECT
    cc.vehicle_id,
    cc.entered_at,
    ROUND(cc.working_hours, 1) AS working_hours,
    cc.working_days
  FROM calendar_calc cc;
END;
$$;

-- RPC: get_delayed_vehicles
CREATE OR REPLACE FUNCTION public.get_delayed_vehicles(threshold_days int DEFAULT 2)
RETURNS TABLE (
  vehicle_id uuid,
  vin text,
  vin_suffix text,
  current_station text,
  entered_at timestamptz,
  working_hours numeric,
  working_days bigint,
  lot_code text,
  lot_model text,
  job_order_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id AS vehicle_id,
    v.vin,
    v.vin_suffix,
    v.current_station::text,
    wh.entered_at,
    wh.working_hours,
    wh.working_days,
    l.lot_code,
    l.model AS lot_model,
    v.job_order_id
  FROM public.get_wip_working_hours(
    ARRAY['shortage','pbs','wbs','tcf','repair','cs','pdi','waiting_repair','tcf_offline']::text[]
  ) wh
  INNER JOIN public.vehicles v ON v.id = wh.vehicle_id
  LEFT JOIN public.lots l ON l.id = v.lot_id
  WHERE wh.working_days >= threshold_days;
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.get_wip_working_hours(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_delayed_vehicles(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_wip_working_hours(text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_delayed_vehicles(int) FROM PUBLIC, anon;
