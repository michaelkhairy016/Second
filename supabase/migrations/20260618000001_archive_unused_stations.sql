-- Archive + delete stale vehicles at stations no longer used (dashboard + paint only now).
-- Reuses archive_completed_vehicles() (migration 20260615000002): copies each vehicle +
-- its station_events/shortages/issues into vehicle_archive JSON (dedup by vin), then deletes
-- the live rows. Recoverable via vehicle_archive. Station enum/code unchanged for future use.
-- Stations cleared: tcf, cs, pdi, repair, waiting_repair, tcf_offline (~1145 vehicles).
-- Kept: warehouse, line_feeding, paint, shortage, pbs, wbs.

UPDATE public.vehicles
SET completed_at = now()
WHERE completed_at IS NULL
  AND current_station::text IN ('tcf', 'cs', 'pdi', 'repair', 'waiting_repair', 'tcf_offline');

SELECT public.archive_completed_vehicles();
