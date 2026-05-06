
-- Vehicles by lot_id (lot->vehicle joins in warehouse, analytics, flow page)
CREATE INDEX idx_vehicles_lot_id ON public.vehicles(lot_id);

-- Vehicles by job_order_id (job order -> vehicle lookups, color plan enforcement)
CREATE INDEX idx_vehicles_job_order_id ON public.vehicles(job_order_id);

-- Access requests by status (filtering pending in admin)
CREATE INDEX idx_access_req_status ON public.station_access_requests(status);

-- Shortages by status (open shortage counts on dashboard)
CREATE INDEX idx_shortages_status ON public.shortages(status);
