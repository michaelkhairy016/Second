-- User presence tracking for online activity monitoring
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online boolean NOT NULL DEFAULT false,
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  first_seen_today timestamptz,
  total_active_seconds bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Users can read their own row
CREATE POLICY "Users read own presence" ON public.user_presence
  FOR SELECT USING (auth.uid() = user_id);

-- Superusers can read all presence rows
CREATE POLICY "Superusers read all presence" ON public.user_presence
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'superuser')
  );

-- Users can update own row (heartbeat)
CREATE POLICY "Users update own presence" ON public.user_presence
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can insert own row
CREATE POLICY "Users insert own presence" ON public.user_presence
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Function to auto-mark stale users offline (call periodically or on read)
CREATE OR REPLACE FUNCTION public.mark_stale_offline()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.user_presence
  SET is_online = false
  WHERE is_online = true
    AND last_heartbeat < now() - interval '5 minutes';
END;
$$;

-- Function to reset daily active time on new day
CREATE OR REPLACE FUNCTION public.touch_presence_heartbeat(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_existing_first timestamptz;
BEGIN
  -- Mark stale users offline first
  PERFORM public.mark_stale_offline();

  INSERT INTO public.user_presence (user_id, is_online, last_heartbeat, first_seen_today, total_active_seconds, updated_at)
  VALUES (p_user_id, true, now(), now(), 60, now())
  ON CONFLICT (user_id) DO UPDATE SET
    is_online = true,
    last_heartbeat = now(),
    total_active_seconds = CASE
      WHEN user_presence.first_seen_today IS NULL OR user_presence.first_seen_today::date < v_today
      THEN 60  -- New day, reset
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

-- Function to set user offline
CREATE OR REPLACE FUNCTION public.set_user_offline(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.user_presence
  SET is_online = false, updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.mark_stale_offline() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_presence_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_offline(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_stale_offline() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_presence_heartbeat(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_user_offline(uuid) FROM PUBLIC, anon;
