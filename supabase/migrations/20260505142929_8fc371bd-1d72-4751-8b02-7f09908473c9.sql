
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('superuser', 'technician', 'staff');
CREATE TYPE public.station_code AS ENUM ('warehouse', 'wbs', 'paint', 'pbs', 'shortage', 'repair', 'cs', 'pdi');
CREATE TYPE public.lot_status AS ENUM ('pending', 'active', 'completed');
CREATE TYPE public.access_request_status AS ENUM ('pending', 'approved', 'denied');
CREATE TYPE public.event_kind AS ENUM ('in', 'out');
CREATE TYPE public.shortage_status AS ENUM ('open', 'cleared');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  employee_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ STATION ASSIGNMENTS ============
CREATE TABLE public.station_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  station public.station_code NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES auth.users(id),
  UNIQUE(user_id, station)
);
ALTER TABLE public.station_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_station_access(_user_id uuid, _station public.station_code)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.station_assignments WHERE user_id = _user_id AND station = _station)
     OR public.has_role(_user_id, 'superuser')
$$;

-- ============ ACCESS REQUESTS ============
CREATE TABLE public.station_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  station public.station_code NOT NULL,
  status public.access_request_status NOT NULL DEFAULT 'pending',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.station_access_requests ENABLE ROW LEVEL SECURITY;

-- ============ LOTS ============
CREATE TABLE public.lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_code text NOT NULL UNIQUE,
  model text NOT NULL,
  total_units int NOT NULL CHECK (total_units > 0),
  status public.lot_status NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;

-- ============ JOB ORDERS ============
CREATE TABLE public.job_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
  job_code text NOT NULL UNIQUE,
  units int NOT NULL CHECK (units > 0),
  color_plan jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"11U":10,"55U":15}
  vin_sequence text[] NOT NULL DEFAULT '{}',
  status public.lot_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_orders ENABLE ROW LEVEL SECURITY;

-- ============ VEHICLES ============
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin text NOT NULL UNIQUE CHECK (length(vin) = 17),
  vin_suffix text NOT NULL, -- last 5
  lot_id uuid REFERENCES public.lots(id),
  job_order_id uuid REFERENCES public.job_orders(id),
  planned_color text,
  actual_color text,
  current_station public.station_code,
  is_lot_tail boolean NOT NULL DEFAULT false,
  tail_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_suffix_idx ON public.vehicles(vin_suffix);
CREATE INDEX vehicles_station_idx ON public.vehicles(current_station);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- ============ STATION EVENTS ============
CREATE TABLE public.station_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  station public.station_code NOT NULL,
  kind public.event_kind NOT NULL,
  color_used text,
  recorded_by uuid REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual', -- manual | bulk
  meta jsonb
);
CREATE INDEX events_vehicle_idx ON public.station_events(vehicle_id);
CREATE INDEX events_station_time_idx ON public.station_events(station, recorded_at DESC);
ALTER TABLE public.station_events ENABLE ROW LEVEL SECURITY;

-- ============ SHORTAGES ============
CREATE TABLE public.shortages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  parts text[] NOT NULL,
  status public.shortage_status NOT NULL DEFAULT 'open',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_by uuid REFERENCES auth.users(id),
  cleared_at timestamptz
);
ALTER TABLE public.shortages ENABLE ROW LEVEL SECURITY;

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER vehicles_updated BEFORE UPDATE ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Profile auto-create ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  -- default to technician
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'technician');
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ RLS POLICIES ============

-- Profiles
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_super_all" ON public.profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'superuser')) WITH CHECK (public.has_role(auth.uid(),'superuser'));

-- User roles (only superusers manage; users can see their own)
CREATE POLICY "roles_self_read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'superuser'));
CREATE POLICY "roles_super_write" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'superuser')) WITH CHECK (public.has_role(auth.uid(),'superuser'));

-- Station assignments
CREATE POLICY "assign_read" ON public.station_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "assign_super_write" ON public.station_assignments FOR ALL TO authenticated USING (public.has_role(auth.uid(),'superuser')) WITH CHECK (public.has_role(auth.uid(),'superuser'));

-- Access requests
CREATE POLICY "req_read" ON public.station_access_requests FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'superuser'));
CREATE POLICY "req_insert_self" ON public.station_access_requests FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "req_super_update" ON public.station_access_requests FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'superuser'));

-- Lots
CREATE POLICY "lots_read" ON public.lots FOR SELECT TO authenticated USING (true);
CREATE POLICY "lots_super_write" ON public.lots FOR ALL TO authenticated USING (public.has_role(auth.uid(),'superuser') OR public.has_station_access(auth.uid(),'warehouse')) WITH CHECK (public.has_role(auth.uid(),'superuser') OR public.has_station_access(auth.uid(),'warehouse'));

-- Job orders
CREATE POLICY "jo_read" ON public.job_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "jo_write" ON public.job_orders FOR ALL TO authenticated USING (public.has_role(auth.uid(),'superuser') OR public.has_station_access(auth.uid(),'warehouse')) WITH CHECK (public.has_role(auth.uid(),'superuser') OR public.has_station_access(auth.uid(),'warehouse'));

-- Vehicles
CREATE POLICY "veh_read" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "veh_insert" ON public.vehicles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'superuser') OR public.has_station_access(auth.uid(),'warehouse') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY "veh_update" ON public.vehicles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'staff') OR public.has_station_access(auth.uid(), current_station));

-- Station events
CREATE POLICY "ev_read" ON public.station_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "ev_insert" ON public.station_events FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'superuser')
  OR public.has_role(auth.uid(),'staff')
  OR public.has_station_access(auth.uid(), station)
);

-- Shortages
CREATE POLICY "sh_read" ON public.shortages FOR SELECT TO authenticated USING (true);
CREATE POLICY "sh_insert" ON public.shortages FOR INSERT TO authenticated WITH CHECK (public.has_station_access(auth.uid(),'shortage') OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY "sh_update" ON public.shortages FOR UPDATE TO authenticated USING (public.has_station_access(auth.uid(),'shortage') OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'staff'));
