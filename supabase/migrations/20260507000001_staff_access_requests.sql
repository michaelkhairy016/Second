
-- Allow staff to read and update station_access_requests (not just superusers)
DROP POLICY IF EXISTS "req_read" ON public.station_access_requests;
DROP POLICY IF EXISTS "req_super_update" ON public.station_access_requests;

CREATE POLICY "req_read" ON public.station_access_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'staff'));

CREATE POLICY "req_super_update" ON public.station_access_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'staff'));
