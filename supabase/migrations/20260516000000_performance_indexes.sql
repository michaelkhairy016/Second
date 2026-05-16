-- Active vehicles filter (used on every page)
CREATE INDEX IF NOT EXISTS idx_vehicles_active ON vehicles (completed_at) WHERE completed_at IS NULL;

-- Station events date range (daily status reports)
CREATE INDEX IF NOT EXISTS idx_events_recorded_date ON station_events (recorded_at DESC);

-- Paint station waiting list
CREATE INDEX IF NOT EXISTS idx_vehicles_paint ON vehicles (current_station) WHERE current_station = 'paint';

-- Active lots filter
CREATE INDEX IF NOT EXISTS idx_lots_active ON lots (status) WHERE status = 'active';

-- Job order lot lookup
CREATE INDEX IF NOT EXISTS idx_joborders_lot ON job_orders (lot_id);

-- Shortages open filter
CREATE INDEX IF NOT EXISTS idx_shortages_open ON shortages (status) WHERE status = 'open';
