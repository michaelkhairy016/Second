import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sends heartbeat to user_presence every 60s.
 * Sets online on mount, offline on unmount/beforeunload.
 */
export function usePresence(userId: string | undefined) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userIdRef = useRef<string>(userId ?? "");
  userIdRef.current = userId ?? "";

  useEffect(() => {
    if (!userId) return;

    const heartbeat = async () => {
      await supabase.rpc("touch_presence_heartbeat", { p_user_id: userIdRef.current });
    };

    const goOffline = async () => {
      const uid = userIdRef.current;
      if (uid) {
        await supabase.rpc("set_user_offline", { p_user_id: uid });
      }
    };

    // Initial heartbeat — set online
    heartbeat();

    // Repeat every 60s
    intervalRef.current = setInterval(heartbeat, 60_000);

    // On tab close / navigate away
    const handleUnload = () => {
      goOffline();
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("beforeunload", handleUnload);
      goOffline();
    };
  }, [userId]);
}
