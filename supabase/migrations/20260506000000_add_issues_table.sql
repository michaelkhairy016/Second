-- Issue severity & status enums
CREATE TYPE public.issue_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.issue_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- Issues table — quality/production issues logged at stations
CREATE TABLE public.issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  station public.station_code NOT NULL,
  title text NOT NULL,
  description text,
  severity public.issue_severity NOT NULL DEFAULT 'medium',
  status public.issue_status NOT NULL DEFAULT 'open',
  reported_by uuid REFERENCES auth.users(id),
  assigned_to uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

-- RLS: any authenticated user can view issues
CREATE POLICY "Issues: read" ON public.issues
  FOR SELECT TO authenticated USING (true);

-- RLS: users with station access can insert issues
CREATE POLICY "Issues: insert" ON public.issues
  FOR INSERT TO authenticated
  WITH CHECK (public.has_station_access(auth.uid(), station) OR public.has_role(auth.uid(), 'staff'));

-- RLS: superusers and assignees can update issues
CREATE POLICY "Issues: update" ON public.issues
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superuser')
    OR reported_by = auth.uid()
    OR assigned_to = auth.uid()
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_issue_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_issues_updated
  BEFORE UPDATE ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.touch_issue_updated();

-- Index for common queries
CREATE INDEX idx_issues_status ON public.issues(status);
CREATE INDEX idx_issues_station ON public.issues(station);
CREATE INDEX idx_issues_vehicle ON public.issues(vehicle_id);
