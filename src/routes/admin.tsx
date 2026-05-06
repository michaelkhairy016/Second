import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { STATIONS, stationByCode } from "@/lib/stations";
import { toast } from "sonner";
import { Check, Inbox, Loader2, X } from "lucide-react";
import type { AccessRequestWithProfile, StationCode, AppRole } from "@/lib/db-types";

interface AdminUser {
  id: string;
  display_name: string;
  roles: AppRole[];
  stations: StationCode[];
}

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Nexus-Flow" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { isSuperuser, isStaff } = useAuth();
  const nav = useNavigate();
  const isAdmin = isSuperuser || isStaff;
  useEffect(() => { if (!isAdmin) nav({ to: "/" }); }, [isAdmin, nav]);

  const [reqs, setReqs] = useState<AccessRequestWithProfile[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const reload = async () => {
    const [{ data: r }, { data: p }, { data: ro }, { data: as }] = await Promise.all([
      supabase.from("station_access_requests").select("*, profile:profiles!station_access_requests_user_id_fkey(display_name)").eq("status","pending").order("created_at"),
      supabase.from("profiles").select("id, display_name"),
      supabase.from("user_roles").select("*"),
      supabase.from("station_assignments").select("*"),
    ]);
    setReqs(r ?? []);
    setUsers((p ?? []).map(u => ({
      ...u,
      roles: (ro ?? []).filter(x => x.user_id === u.id).map(x => x.role),
      stations: (as ?? []).filter(x => x.user_id === u.id).map(x => x.station),
    })));
  };
  useEffect(() => { reload(); const ch = supabase.channel("admin").on("postgres_changes",{event:"*",schema:"public",table:"station_access_requests"},reload).subscribe(); return () => { supabase.removeChannel(ch); }; }, []);

  const decide = async (r: AccessRequestWithProfile, status: "approved" | "denied") => {
    const me = (await supabase.auth.getUser()).data.user;
    await supabase.from("station_access_requests").update({ status, resolved_at: new Date().toISOString(), resolved_by: me?.id }).eq("id", r.id);
    if (status === "approved") {
      await supabase.from("station_assignments").upsert({ user_id: r.user_id, station: r.station, assigned_by: me?.id }, { onConflict: "user_id,station" });
    }
    toast.success(`Request ${status}`);
  };

  const toggleStation = async (uid: string, station: string, on: boolean) => {
    const me = (await supabase.auth.getUser()).data.user;
    if (on) await supabase.from("station_assignments").upsert({ user_id: uid, station: station as StationCode, assigned_by: me?.id }, { onConflict: "user_id,station" });
    else await supabase.from("station_assignments").delete().eq("user_id", uid).eq("station", station as StationCode);
    reload();
  };

  const setRole = async (uid: string, role: "superuser" | "technician" | "staff", on: boolean) => {
    if (on) await supabase.from("user_roles").upsert({ user_id: uid, role }, { onConflict: "user_id,role" });
    else await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", role);
    reload();
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">Pending access requests ({reqs.length})</CardTitle></CardHeader>
        <CardContent>
          {reqs.length === 0 ? <EmptyState icon={Inbox} title="No pending requests" description="All access requests have been resolved." /> : (
            <ul className="divide-y">
              {reqs.map(r => (
                <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                  <div><b>{r.profile?.display_name ?? "User"}</b> → {stationByCode(r.station)?.label}</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => decide(r, "denied")}><X className="h-4 w-4" /></Button>
                    <Button size="sm" onClick={() => decide(r, "approved")}><Check className="h-4 w-4" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isSuperuser && (
        <Card>
          <CardHeader><CardTitle className="text-base">Users ({users.length})</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {users.length === 0 ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : users.map(u => (
              <div key={u.id} className="border rounded-md p-3 space-y-2">
                <div className="font-medium text-sm">{u.display_name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(["superuser","technician","staff"] as const).map(r => {
                    const on = u.roles.includes(r);
                    return <button key={r} onClick={() => setRole(u.id, r, !on)}><Badge variant={on ? "info" : "muted"}>{r}</Badge></button>;
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {STATIONS.map(s => {
                    const on = u.stations.includes(s.code);
                    return <button key={s.code} onClick={() => toggleStation(u.id, s.code, !on)}><Badge variant={on ? "success" : "muted"}>{s.short}</Badge></button>;
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
