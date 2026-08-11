-- Stock Count (physical reconciliation) feature.
-- A superuser/staff requests an instant physical count on a buffer area
-- (shortage/pbs/wbs). Controllers scan vehicles on the floor; the system
-- reconciles against a snapshot taken at request time:
--   - scanned & in snapshot  -> 'matched'
--   - scanned & not in snapshot (here but system didn't know) -> 'new' (registered IN)
--   - in snapshot but never scanned (physically out) -> 'checked_out' (advanced OUT)
--   - shortage buffer has no next station -> unscanned become 'skipped' (flagged for review)
-- Mirrors the issues workflow (20260506000000_add_issues_table.sql).

CREATE TYPE public.stock_count_status  AS ENUM ('requested', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.stock_count_outcome AS ENUM ('expected', 'matched', 'new', 'checked_out', 'skipped');

CREATE TABLE public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station public.station_code NOT NULL,
  status public.stock_count_status NOT NULL DEFAULT 'requested',
  requested_by uuid REFERENCES auth.users(id),
  started_by uuid REFERENCES auth.users(id),
  started_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  cancelled_at timestamptz,
  expected_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  checked_out_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_counts_station_chk CHECK (station IN ('shortage', 'pbs', 'wbs'))
);

CREATE TABLE public.stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vin_snapshot text NOT NULL,
  vin_suffix_snapshot text,
  station_snapshot public.station_code,
  outcome public.stock_count_outcome NOT NULL DEFAULT 'expected',
  scanned_at timestamptz,
  scanned_by uuid REFERENCES auth.users(id),
  advanced_to public.station_code,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_counts_station_status ON public.stock_counts(station, status);
CREATE INDEX idx_stock_counts_status ON public.stock_counts(status);
CREATE INDEX idx_stock_count_items_count ON public.stock_count_items(stock_count_id);
CREATE INDEX idx_stock_count_items_vehicle ON public.stock_count_items(vehicle_id);
-- One outcome row per (count, vehicle); NULL vehicle_id (deleted) allowed to repeat.
CREATE UNIQUE INDEX uq_stock_count_items_count_vehicle
  ON public.stock_count_items(stock_count_id, vehicle_id) WHERE vehicle_id IS NOT NULL;

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated user (controllers must see the alert; everyone sees reports).
CREATE POLICY "Stock counts: read" ON public.stock_counts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Stock count items: read" ON public.stock_count_items
  FOR SELECT TO authenticated USING (true);

-- INSERT header: superuser or staff only (the requesters).
CREATE POLICY "Stock counts: insert" ON public.stock_counts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superuser') OR public.has_role(auth.uid(), 'staff'));

-- UPDATE header: supervisors, the requester, the starter, or any station-assigned controller.
CREATE POLICY "Stock counts: update" ON public.stock_counts
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superuser')
    OR public.has_role(auth.uid(), 'staff')
    OR requested_by = auth.uid()
    OR started_by = auth.uid()
    OR public.has_station_access(auth.uid(), station)
  );

-- Items: gated by the parent count's station access (supervisors/staff or station-assigned).
CREATE POLICY "Stock count items: insert" ON public.stock_count_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stock_counts sc
      WHERE sc.id = stock_count_id
        AND (
          public.has_role(auth.uid(), 'superuser')
          OR public.has_role(auth.uid(), 'staff')
          OR public.has_station_access(auth.uid(), sc.station)
        )
    )
  );

CREATE POLICY "Stock count items: update" ON public.stock_count_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stock_counts sc
      WHERE sc.id = stock_count_id
        AND (
          public.has_role(auth.uid(), 'superuser')
          OR public.has_role(auth.uid(), 'staff')
          OR public.has_station_access(auth.uid(), sc.station)
        )
    )
  );

-- updated_at triggers (mirror touch_issue_updated).
CREATE OR REPLACE FUNCTION public.touch_stock_count_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_counts_updated
  BEFORE UPDATE ON public.stock_counts
  FOR EACH ROW EXECUTE FUNCTION public.touch_stock_count_updated();

CREATE OR REPLACE FUNCTION public.touch_stock_count_item_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_count_items_updated
  BEFORE UPDATE ON public.stock_count_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_stock_count_item_updated();

-- request_stock_count(station): atomically create the count header + snapshot all
-- vehicles currently at the station as 'expected' items. Actor resolved via auth.uid().
CREATE OR REPLACE FUNCTION public.request_stock_count(p_station public.station_code)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_actor, 'superuser') OR public.has_role(v_actor, 'staff')) THEN
    RAISE EXCEPTION 'Only supervisors or staff can request a stock count';
  END IF;
  IF p_station NOT IN ('shortage', 'pbs', 'wbs') THEN
    RAISE EXCEPTION 'Stock counts only apply to shortage / pbs / wbs';
  END IF;

  INSERT INTO stock_counts (station, requested_by, status, expected_count)
  VALUES (p_station, v_actor, 'requested',
          (SELECT count(*) FROM vehicles WHERE current_station = p_station))
  RETURNING id INTO v_id;

  INSERT INTO stock_count_items (stock_count_id, vehicle_id, vin_snapshot, vin_suffix_snapshot, station_snapshot, outcome)
  SELECT v_id, v.id, v.vin, v.vin_suffix, v.current_station, 'expected'
  FROM vehicles v
  WHERE v.current_station = p_station;

  RETURN v_id;
END;
$$;

-- complete_stock_count(count_id): finalize a count. Each 'expected' item that was
-- never scanned is auto-advanced to its next station (wbs->paint, pbs->tcf) with a
-- station_events 'out' row; shortage items become 'skipped' (no next station).
-- Items whose vehicle already left mid-count are marked 'checked_out' without a
-- duplicate out-event. Idempotent: no-op unless status='in_progress'.
-- KEEP IN SYNC with the TS nextStationMap at station.$code.tsx (~489-496).
CREATE OR REPLACE FUNCTION public.complete_stock_count(p_count_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station public.station_code;
  v_actor uuid := auth.uid();
  rec record;
  v_next public.station_code;
  v_cur public.station_code;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT station INTO v_station FROM stock_counts WHERE id = p_count_id;
  IF v_station IS NULL THEN
    RAISE EXCEPTION 'Stock count not found';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'superuser')
    OR public.has_role(v_actor, 'staff')
    OR public.has_station_access(v_actor, v_station)
  ) THEN
    RAISE EXCEPTION 'Not authorized to complete this stock count';
  END IF;

  -- Idempotency guard: only act on in_progress counts.
  UPDATE stock_counts SET status = status WHERE id = p_count_id AND status = 'in_progress';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT i.id, i.vehicle_id, i.station_snapshot
    FROM stock_count_items i
    WHERE i.stock_count_id = p_count_id AND i.outcome = 'expected'
  LOOP
    -- Deleted vehicle, or shortage buffer (parts area, no next station): cannot infer destination.
    IF rec.vehicle_id IS NULL OR rec.station_snapshot = 'shortage' THEN
      UPDATE stock_count_items SET outcome = 'skipped', updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    SELECT current_station INTO v_cur FROM vehicles WHERE id = rec.vehicle_id;

    -- Next-station map (mirror station.$code.tsx nextStationMap).
    v_next := CASE rec.station_snapshot
                WHEN 'wbs' THEN 'paint'::public.station_code
                WHEN 'pbs' THEN 'tcf'::public.station_code
                ELSE rec.station_snapshot
              END;

    -- Vehicle already moved out normally mid-count: mark checked_out, skip duplicate out-event.
    IF v_cur IS NULL OR v_cur <> rec.station_snapshot THEN
      UPDATE stock_count_items
        SET outcome = 'checked_out', advanced_to = COALESCE(v_cur, v_next), updated_at = now()
        WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO station_events (vehicle_id, station, kind, recorded_by, source, meta)
    VALUES (rec.vehicle_id, rec.station_snapshot, 'out', v_actor, 'stock_count',
            jsonb_build_object('stock_count_id', p_count_id, 'auto_advance', true));

    UPDATE vehicles SET current_station = v_next WHERE id = rec.vehicle_id;

    UPDATE stock_count_items
      SET outcome = 'checked_out', advanced_to = v_next, updated_at = now()
      WHERE id = rec.id;
  END LOOP;

  UPDATE stock_counts SET
    status = 'completed',
    completed_by = v_actor,
    completed_at = now(),
    matched_count     = (SELECT count(*) FROM stock_count_items WHERE stock_count_id = p_count_id AND outcome = 'matched'),
    new_count         = (SELECT count(*) FROM stock_count_items WHERE stock_count_id = p_count_id AND outcome = 'new'),
    checked_out_count = (SELECT count(*) FROM stock_count_items WHERE stock_count_id = p_count_id AND outcome = 'checked_out')
  WHERE id = p_count_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_stock_count(public.station_code) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_stock_count(public.station_code) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_stock_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_stock_count(uuid) TO authenticated;
