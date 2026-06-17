-- Broaden get_wip_working_hours entry resolution so vehicles without an exact-station
-- "in" event (common for contract/CKD cars that enter without a capture, or moved
-- through without a scanned in) still get a non-null entered_at.
--
-- Fallback chain per vehicle: latest exact-station "in" → latest any-station "in" → vehicles.updated_at.
-- Working-hours math is unchanged; only entered_at now always resolves for display.

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
  WITH exact_in AS (
    -- Latest "in" event logged AT the vehicle's current station (preferred entry source)
    SELECT DISTINCT ON (se.vehicle_id)
      se.vehicle_id,
      se.recorded_at AS entered_at
    FROM public.station_events se
    INNER JOIN public.vehicles v ON v.id = se.vehicle_id
    WHERE se.kind = 'in'
      AND v.current_station::text = ANY(station_codes)
      AND se.station::text = v.current_station::text
      AND v.completed_at IS NULL
    ORDER BY se.vehicle_id, se.recorded_at DESC
  ),
  any_in AS (
    -- Latest "in" event anywhere, for vehicles lacking an exact-station in
    SELECT DISTINCT ON (se.vehicle_id)
      se.vehicle_id,
      se.recorded_at AS entered_at
    FROM public.station_events se
    INNER JOIN public.vehicles v ON v.id = se.vehicle_id
    WHERE se.kind = 'in'
      AND v.current_station::text = ANY(station_codes)
      AND v.completed_at IS NULL
    ORDER BY se.vehicle_id, se.recorded_at DESC
  ),
  latest_in AS (
    -- Every vehicle at the requested stations, with an entered_at that always resolves
    SELECT v.id AS vehicle_id,
      COALESCE(e.entered_at, a.entered_at, v.updated_at) AS entered_at
    FROM public.vehicles v
    LEFT JOIN exact_in e ON e.vehicle_id = v.id
    LEFT JOIN any_in a ON a.vehicle_id = v.id
    WHERE v.current_station::text = ANY(station_codes)
      AND v.completed_at IS NULL
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

-- Permissions (re-establish after REPLACE)
GRANT EXECUTE ON FUNCTION public.get_wip_working_hours(text[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_wip_working_hours(text[]) FROM PUBLIC, anon;
