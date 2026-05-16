import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { stationByCode } from "@/lib/stations";
import { ClipboardList } from "lucide-react";
import type { StationAccessRequest } from "@/lib/db-types";

export const Route = createFileRoute("/requests")({
  head: () => ({ meta: [{ title: "My Requests — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { user } = useAuth();
  const [reqs, setReqs] = useState<StationAccessRequest[]>([]);
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from("station_access_requests").select("id,station,status,created_at").eq("user_id", user.id).order("created_at", { ascending: false });
      setReqs(data ?? []);
    };
    load();
    const ch = supabase.channel("my-req").on("postgres_changes", { event: "*", schema: "public", table: "station_access_requests", filter: `user_id=eq.${user.id}` }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">My access requests</h1>
      <Card><CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader><CardContent>
        {reqs.length === 0 ? <EmptyState icon={ClipboardList} title="No requests" description="You haven't requested access to any stations yet." /> : (
          <ul className="divide-y text-sm">
            {reqs.map(r => (
              <li key={r.id} className="py-2 flex justify-between items-center">
                <span>{stationByCode(r.station)?.label}</span>
                <Badge variant={r.status === "approved" ? "success" : r.status === "denied" ? "destructive" : "warning"}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>
    </div>
  );
}
