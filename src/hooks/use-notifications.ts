import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export function useNotifications() {
  const { user, isSuperuser, hasStation } = useAuth();

  useEffect(() => {
    if (!user) return;

    const channels: ReturnType<typeof supabase.channel>[] = [];

    // Superuser: notify on new access requests
    if (isSuperuser) {
      const ch = supabase.channel("notif-requests")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "station_access_requests" }, () => {
          toast.info("New access request received");
        })
        .subscribe();
      channels.push(ch);
    }

    // All users: notify when their access request is resolved
    const ch2 = supabase.channel("notif-my-requests")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "station_access_requests",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const status = payload.new.status;
        if (status === "approved") toast.success("Your station access was approved!");
        else if (status === "denied") toast.error("Your station access request was denied.");
      })
      .subscribe();
    channels.push(ch2);

    // Users with shortage access: notify on new shortages
    if (hasStation("shortage") || isSuperuser) {
      const ch3 = supabase.channel("notif-shortages")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "shortages" }, () => {
          toast.warning("New shortage logged on the floor");
        })
        .subscribe();
      channels.push(ch3);
    }

    return () => {
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [user, isSuperuser, hasStation]);
}
