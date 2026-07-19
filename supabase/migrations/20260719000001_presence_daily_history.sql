-- Daily presence history so average logged-in time can be computed across days.
CREATE TABLE IF NOT EXISTS public.presence_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  active_seconds bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.presence_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superusers read all presence_daily" ON public.presence_daily;
CREATE POLICY "Superusers read all presence_daily" ON public.presence_daily
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superuser')
  );

DROP POLICY IF EXISTS "Users read own presence_daily" ON public.presence_daily;
CREATE POLICY "Users read own presence_daily" ON public.presence_daily
  FOR SELECT USING (auth.uid() = user_id);

GRANT SELECT ON public.presence_daily TO authenticated;

-- Updated heartbeat: snapshot the previous day's active seconds into presence_daily
-- before the new-day reset, so history is preserved.
CREATE OR REPLACE FUNCTION public.touch_presence_heartbeat(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_existing_first timestamptz;
  v_existing_total bigint;
  v_existing_day date;
BEGIN
  PERFORM public.mark_stale_offline();

  SELECT first_seen_today, total_active_seconds
    INTO v_existing_first, v_existing_total
  FROM public.user_presence WHERE user_id = p_user_id;

  IF v_existing_first IS NOT NULL THEN
    v_existing_day := v_existing_first::date;
    IF v_existing_day < v_today AND v_existing_total > 0 THEN
      INSERT INTO public.presence_daily (user_id, day, active_seconds)
      VALUES (p_user_id, v_existing_day, v_existing_total)
      ON CONFLICT (user_id, day) DO UPDATE SET active_seconds = EXCLUDED.active_seconds;
    END IF;
  END IF;

  INSERT INTO public.user_presence (user_id, is_online, last_heartbeat, first_seen_today, total_active_seconds, updated_at)
  VALUES (p_user_id, true, now(), now(), 60, now())
  ON CONFLICT (user_id) DO UPDATE SET
    is_online = true,
    last_heartbeat = now(),
    total_active_seconds = CASE
      WHEN user_presence.first_seen_today IS NULL OR user_presence.first_seen_today::date < v_today
      THEN 60
      ELSE user_presence.total_active_seconds + 60
    END,
    first_seen_today = CASE
      WHEN user_presence.first_seen_today IS NULL OR user_presence.first_seen_today::date < v_today
      THEN now()
      ELSE user_presence.first_seen_today
    END,
    updated_at = now();
END;
$$;

-- Average daily logged-in seconds over the last N days for each user (superuser only).
CREATE OR REPLACE FUNCTION public.get_presence_daily_avg(days_back int DEFAULT 30)
RETURNS TABLE (user_id uuid, avg_seconds numeric, days_active bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id,
         ROUND(AVG(active_seconds), 0) AS avg_seconds,
         COUNT(*) AS days_active
  FROM public.presence_daily
  WHERE day >= CURRENT_DATE - (days_back - 1)
  GROUP BY user_id;
$$;

GRANT EXECUTE ON FUNCTION public.touch_presence_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_presence_daily_avg(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_presence_daily_avg(int) FROM PUBLIC, anon;
