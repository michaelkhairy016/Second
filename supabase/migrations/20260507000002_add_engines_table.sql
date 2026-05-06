
-- Engine status enum
CREATE TYPE public.engine_status AS ENUM ('available', 'assigned', 'installed');

-- Engines table
CREATE TABLE public.engines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_number text NOT NULL UNIQUE CHECK (length(engine_number) >= 4),
  engine_suffix text NOT NULL,
  lot_id uuid REFERENCES public.lots(id),
  job_order_id uuid REFERENCES public.job_orders(id),
  status public.engine_status NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX engines_suffix_idx ON public.engines(engine_suffix);
CREATE INDEX engines_lot_idx ON public.engines(lot_id);

ALTER TABLE public.engines ENABLE ROW LEVEL SECURITY;

-- RLS: all authenticated users can read
CREATE POLICY "eng_read" ON public.engines
  FOR SELECT TO authenticated USING (true);

-- RLS: warehouse users, superusers, staff can insert
CREATE POLICY "eng_insert" ON public.engines
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'superuser')
    OR public.has_role(auth.uid(),'staff')
    OR public.has_station_access(auth.uid(),'warehouse')
  );

-- RLS: superusers and staff can update
CREATE POLICY "eng_update" ON public.engines
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'superuser')
    OR public.has_role(auth.uid(),'staff')
  );
