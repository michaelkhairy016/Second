-- Repair archive / de-archive duplication that inflated dashboard IN/OUT (June).
-- Safe: never touches station_events/vehicles/issues/shortages except to RESCUE
-- 6 orphan events first. Only redundant vehicle_archive rows/JSON are removed.
-- After this, get_production_events (used by dashboard) yields clean single-pass counts.

BEGIN;

-- 1) Rescue orphan events that exist ONLY in stale archive rows (live car, event not in station_events).
--    Maps to the live vehicle by VIN. Idempotent via ON CONFLICT.
INSERT INTO public.station_events
  (id, vehicle_id, station, kind, source, meta, recorded_by, recorded_at, color_used_id)
SELECT (e->>'id')::uuid,
       v.id,
       (e->>'station')::public.station_code,
       (e->>'kind')::public.event_kind,
       COALESCE(e->>'source', 'manual'),
       NULLIF(e->>'meta', '')::jsonb,
       NULLIF(e->>'recorded_by', '')::uuid,
       (e->>'recorded_at')::timestamptz,
       NULLIF(e->>'color_used_id', '')::uuid
FROM public.vehicle_archive a
JOIN public.vehicles v ON v.vin = a.vin,
     LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(a.events_data) = 'array' THEN a.events_data ELSE '[]'::jsonb END
     ) AS e
WHERE e->>'id' IS NOT NULL
  AND (e->>'id')::uuid NOT IN (SELECT id FROM public.station_events)
ON CONFLICT (id) DO NOTHING;

-- 2) Delete stale archive rows for cars that are back LIVE (events now live in station_events).
DELETE FROM public.vehicle_archive a
WHERE EXISTS (SELECT 1 FROM public.vehicles v WHERE v.vin = a.vin);

-- 3) Collapse duplicate archive rows per VIN -> keep the most-complete one.
DELETE FROM public.vehicle_archive a
WHERE a.id NOT IN (
  SELECT DISTINCT ON (vin) id
  FROM public.vehicle_archive
  ORDER BY vin,
           jsonb_array_length(
             CASE WHEN jsonb_typeof(events_data) = 'array' THEN events_data ELSE '[]'::jsonb END
           ) DESC,
           archived_at DESC NULLS LAST
);

-- 4) Within each remaining archive row, keep first IN / first OUT per station
--    (drops re-scan echoes baked in when a car was re-archived after a restore + rescan).
UPDATE public.vehicle_archive a
SET events_data = COALESCE((
  SELECT jsonb_agg(d.e ORDER BY (d.e->>'recorded_at'))
  FROM (
    SELECT DISTINCT ON ((e->>'station'), (e->>'kind')) e
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(a.events_data) = 'array' THEN a.events_data ELSE '[]'::jsonb END
    ) AS e
    WHERE e->>'recorded_at' IS NOT NULL
      AND e->>'station'  IS NOT NULL
      AND e->>'kind'     IS NOT NULL
    ORDER BY (e->>'station'), (e->>'kind'), (e->>'recorded_at')
  ) d
), '[]'::jsonb)
WHERE jsonb_typeof(a.events_data) = 'array';

COMMIT;
