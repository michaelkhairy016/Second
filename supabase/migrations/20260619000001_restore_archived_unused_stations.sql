-- Restore the ~1145 vehicles archived during the 2026-06-18 unused-station cleanup.
-- archive_completed_vehicles() did not store current_station, so it's derived from each
-- car's last 'in' event. Color/contract_model/job_order_id were not archived -> stay NULL.
-- After restore, delete those rows from vehicle_archive so get_production_events (active
-- UNION archive) doesn't double-count them.

CREATE TEMP TABLE _restore AS
SELECT id AS aid, vehicle_data AS vd, events_data AS ed, shortages_data AS sd, issues_data AS idd
FROM public.vehicle_archive
WHERE archived_at >= '2026-06-18';

CREATE TEMP TABLE _lastin AS
SELECT DISTINCT ON (r.aid) r.aid, (ev->>'station') AS station
FROM _restore r, jsonb_array_elements(COALESCE(r.ed, '[]'::jsonb)) AS ev
WHERE (ev->>'kind') = 'in'
ORDER BY r.aid, ((ev->>'recorded_at')::timestamptz) DESC NULLS LAST;

-- vehicles: override current_station (from last in-event) + completed_at=NULL + updated_at=now
INSERT INTO public.vehicles
  (id, vin, vin_suffix, current_station, lot_id, job_order_id, is_lot_tail, tail_note, created_at, updated_at, planned_color_id, actual_color_id, completed_at, contract_model)
SELECT v.id, v.vin, v.vin_suffix, l.station::public.station_code, v.lot_id, v.job_order_id,
       COALESCE(v.is_lot_tail, false), v.tail_note, COALESCE(v.created_at, now()), now(), v.planned_color_id,
       v.actual_color_id, NULL, v.contract_model
FROM (SELECT (jsonb_populate_record(NULL::public.vehicles, r.vd)).*, r.aid FROM _restore r) v
LEFT JOIN _lastin l ON l.aid = v.aid
ON CONFLICT (id) DO NOTHING;

-- station_events / shortages / issues: full row round-trip via jsonb_populate_record
INSERT INTO public.station_events
SELECT (jsonb_populate_record(NULL::public.station_events, ev)).*
FROM _restore r, jsonb_array_elements(COALESCE(r.ed, '[]'::jsonb)) AS ev
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shortages
SELECT (jsonb_populate_record(NULL::public.shortages, s)).*
FROM _restore r, jsonb_array_elements(COALESCE(r.sd, '[]'::jsonb)) AS s
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.issues
SELECT (jsonb_populate_record(NULL::public.issues, i)).*
FROM _restore r, jsonb_array_elements(COALESCE(r.idd, '[]'::jsonb)) AS i
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.vehicle_archive WHERE archived_at >= '2026-06-18';

DROP TABLE _restore;
DROP TABLE _lastin;
