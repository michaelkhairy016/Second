import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/EmptyState";
import { STATIONS, stationByCode } from "@/lib/stations";
import { toast } from "sonner";
import { Check, Inbox, Loader2, X, History, ArrowLeft, LayoutDashboard, Truck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccessRequestWithProfile, StationCode, AppRole } from "@/lib/db-types";

interface AdminUser {
  id: string;
  display_name: string;
  roles: AppRole[];
  stations: StationCode[];
  dashboard_allowed: boolean;
}

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { isSuperuser, isStaff } = useAuth();
  const nav = useNavigate();
  const isAdmin = isSuperuser || isStaff;
  useEffect(() => { if (!isAdmin) nav({ to: "/" }); }, [isAdmin, nav]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users & Access</TabsTrigger>
          <TabsTrigger value="presence">Online Presence</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          {isSuperuser && <TabsTrigger value="contracts">Contract Production</TabsTrigger>}
        </TabsList>
        <TabsContent value="users"><UsersPanel isSuperuser={isSuperuser} /></TabsContent>
        <TabsContent value="presence"><PresencePanel /></TabsContent>
        <TabsContent value="activity"><ActivityLog /></TabsContent>
        {isSuperuser && <TabsContent value="contracts"><ContractProductionPanel /></TabsContent>}
      </Tabs>
    </div>
  );
}

function UsersPanel({ isSuperuser }: { isSuperuser: boolean }) {
  const [reqs, setReqs] = useState<(AccessRequestWithProfile & { profile: { display_name: string } | null })[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const reload = async () => {
    const [{ data: r }, { data: p }, { data: ro }, { data: as }] = await Promise.all([
      supabase.from("station_access_requests").select("id,user_id,station,status,created_at").eq("status","pending").order("created_at"),
      supabase.from("profiles").select("id, display_name, dashboard_allowed"),
      supabase.from("user_roles").select("id,user_id,role"),
      supabase.from("station_assignments").select("id,user_id,station"),
    ]);
    const profileMap = new Map((p ?? []).map(x => [x.id, { display_name: x.display_name, dashboard_allowed: x.dashboard_allowed }]));
    setReqs((r ?? []).map(req => ({ ...req, profile: { display_name: profileMap.get(req.user_id)?.display_name ?? "User" } })));
    setUsers((p ?? []).map(u => ({
      ...u,
      display_name: u.display_name,
      roles: (ro ?? []).filter(x => x.user_id === u.id).map(x => x.role),
      stations: (as ?? []).filter(x => x.user_id === u.id).map(x => x.station),
      dashboard_allowed: u.dashboard_allowed,
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

  const setRole = async (uid: string, role: "superuser" | "technician" | "staff" | "status", on: boolean) => {
    if (on) await supabase.from("user_roles").upsert({ user_id: uid, role }, { onConflict: "user_id,role" });
    else await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", role);
    reload();
  };

  const toggleDashboard = async (uid: string, on: boolean) => {
    await supabase.from("profiles").update({ dashboard_allowed: on }).eq("id", uid);
    reload();
  };

  return (
    <div className="space-y-5">
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
                  {(["superuser","technician","staff","status"] as const).map(r => {
                    const on = u.roles.includes(r);
                    return <button key={r} onClick={() => setRole(u.id, r, !on)}><Badge variant={on ? "info" : "muted"}>{r}</Badge></button>;
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {STATIONS.map(s => {
                    const on = u.stations.includes(s.code);
                    return <button key={s.code} onClick={() => toggleStation(u.id, s.code, !on)}><Badge variant={on ? "success" : "muted"}>{s.short}</Badge></button>;
                  })}
                  <button onClick={() => toggleDashboard(u.id, !u.dashboard_allowed)} title="Dashboard access">
                    <Badge variant={u.dashboard_allowed ? "info" : "muted"}><LayoutDashboard className="h-3 w-3 mr-1 inline" />Dashboard</Badge>
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type ActivityEvent = {
  id: string;
  station: string;
  kind: string;
  recorded_at: string;
  source: string | null;
  vehicle: { vin: string } | null;
  recorder: { display_name: string } | null;
  color: { code: string; name: string } | null;
};

type ActivityShortage = {
  id: string;
  parts: string[];
  status: string;
  shortage_reason: string | null;
  created_at: string;
  cleared_at: string | null;
  vehicle: { vin: string } | null;
  creator: { display_name: string } | null;
  clearer: { display_name: string } | null;
};

function ActivityLog() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [shortages, setShortages] = useState<ActivityShortage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"events" | "shortages">("events");

  // Only fetch last 3 days of data to save quota
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();

  const reload = async () => {
    setLoading(true);
    const [evRes, shRes] = await Promise.all([
      supabase.from("station_events")
        .select("id, station, kind, recorded_at, source, vehicle:vehicles(vin), recorder:profiles!station_events_profiles_recorded_by_fkey(display_name), color:standard_colors!station_events_color_used_id_fkey(code, name)")
        .gte("recorded_at", threeDaysAgo)
        .order("recorded_at", { ascending: false })
        .limit(150),
      supabase.from("shortages")
        .select("id, parts, status, shortage_reason, created_at, cleared_at, vehicle:vehicles(vin), creator:profiles!shortages_profiles_created_by_fkey(display_name), clearer:profiles!shortages_profiles_cleared_by_fkey(display_name)")
        .gte("created_at", threeDaysAgo)
        .order("created_at", { ascending: false })
        .limit(80),
    ]);
    setEvents((evRes.data ?? []) as unknown as ActivityEvent[]);
    setShortages((shRes.data ?? []) as unknown as ActivityShortage[]);
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const q = filter.toLowerCase();
  const filteredEvents = filter
    ? events.filter(e => (e.vehicle?.vin ?? "").toLowerCase().includes(q) || (e.recorder?.display_name ?? "").toLowerCase().includes(q) || e.station.includes(q))
    : events;
  const filteredShortages = filter
    ? shortages.filter(s => (s.vehicle?.vin ?? "").toLowerCase().includes(q) || (s.creator?.display_name ?? "").toLowerCase().includes(q) || (s.parts as string[]).join(" ").toLowerCase().includes(q))
    : shortages;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Input placeholder="Filter by VIN, person, station..." value={filter} onChange={e => setFilter(e.target.value)} className="font-mono text-xs" />
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="events">Station Events ({filteredEvents.length})</TabsTrigger>
          <TabsTrigger value="shortages">Shortages ({filteredShortages.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
            <div className="border rounded-md overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="bg-muted">
                    <th className="p-2 text-left font-semibold">Time</th>
                    <th className="p-2 text-left font-semibold">VIN</th>
                    <th className="p-2 text-left font-semibold">Station</th>
                    <th className="p-2 text-left font-semibold">Dir</th>
                    <th className="p-2 text-left font-semibold">Color</th>
                    <th className="p-2 text-left font-semibold">By</th>
                    <th className="p-2 text-left font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredEvents.map(e => (
                    <tr key={e.id}>
                      <td className="p-2 whitespace-nowrap">{new Date(e.recorded_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="p-2 font-mono">{e.vehicle?.vin ?? "—"}</td>
                      <td className="p-2">{stationByCode(e.station)?.label ?? e.station}</td>
                      <td className="p-2"><Badge variant={e.kind === "in" ? "info" : "success"} className="text-[10px] px-1">{e.kind.toUpperCase()}</Badge></td>
                      <td className="p-2">{e.color ? <Badge variant="secondary" className="text-[10px] px-1">{e.color.code}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-2 font-medium">{e.recorder?.display_name ?? "—"}</td>
                      <td className="p-2 text-muted-foreground">{e.source ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="shortages">
          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
            <div className="border rounded-md overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="bg-muted">
                    <th className="p-2 text-left font-semibold">Created</th>
                    <th className="p-2 text-left font-semibold">VIN</th>
                    <th className="p-2 text-left font-semibold">Parts</th>
                    <th className="p-2 text-left font-semibold">Reason</th>
                    <th className="p-2 text-left font-semibold">Status</th>
                    <th className="p-2 text-left font-semibold">Logged By</th>
                    <th className="p-2 text-left font-semibold">Cleared By</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredShortages.map(s => (
                    <tr key={s.id}>
                      <td className="p-2 whitespace-nowrap">{new Date(s.created_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="p-2 font-mono">{s.vehicle?.vin ?? "—"}</td>
                      <td className="p-2 max-w-[200px] truncate">{(s.parts as string[]).join(", ")}</td>
                      <td className="p-2">{s.shortage_reason ?? "—"}</td>
                      <td className="p-2"><Badge variant={s.status === "open" ? "destructive" : "success"} className="text-[10px] px-1">{s.status}</Badge></td>
                      <td className="p-2 font-medium">{s.creator?.display_name ?? "—"}</td>
                      <td className="p-2 font-medium">{s.clearer?.display_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Online Presence Panel ---
interface PresenceRow {
  user_id: string;
  is_online: boolean;
  last_heartbeat: string;
  first_seen_today: string | null;
  total_active_seconds: number;
  profile: { display_name: string } | null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return "just now";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Online status derived from heartbeat recency (social-media style).
function presenceStatus(iso: string | null, isOnline: boolean): { label: string; tone: "online" | "idle" | "offline" } {
  if (!iso) return { label: "Never", tone: "offline" };
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isOnline && s < 120) return { label: "Active now", tone: "online" };
  if (s < 300) return { label: `Active ${Math.floor(s / 60)}m ago`, tone: "idle" };
  return { label: "Offline", tone: "offline" };
}

type ActivitySummary = {
  lastAt: string | null;
  lastLabel: string;
  eventsToday: number;
  shortagesToday: number;
  issuesToday: number;
};

function PresencePanel() {
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [activity, setActivity] = useState<Record<string, ActivitySummary>>({});
  const [avgDaily, setAvgDaily] = useState<Record<string, { avg: number; days: number }>>({});
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    await supabase.rpc("mark_stale_offline");
    const since3d = new Date(Date.now() - 3 * 86400000).toISOString();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const [presRes, evRes, shRes, issRes, avgRes] = await Promise.all([
      supabase.from("user_presence")
        .select("user_id, is_online, last_heartbeat, first_seen_today, total_active_seconds, profile:profiles(display_name)")
        .order("is_online", { ascending: false }),
      supabase.from("station_events")
        .select("recorded_by, recorded_at, station, vehicle:vehicles(vin)")
        .gte("recorded_at", since3d).order("recorded_at", { ascending: false }).limit(500),
      supabase.from("shortages")
        .select("created_by, created_at").gte("created_at", since3d).order("created_at", { ascending: false }).limit(300),
      supabase.from("issues")
        .select("reported_by, created_at").gte("created_at", since3d).order("created_at", { ascending: false }).limit(300),
      supabase.rpc("get_presence_daily_avg", { days_back: 30 }),
    ]);

    if (!presRes.error) setRows((presRes.data ?? []) as unknown as PresenceRow[]);

    // Build per-user activity summary
    const map: Record<string, ActivitySummary> = {};
    const ensure = (uid: string | null): ActivitySummary | null => {
      if (!uid) return null;
      if (!map[uid]) map[uid] = { lastAt: null, lastLabel: "—", eventsToday: 0, shortagesToday: 0, issuesToday: 0 };
      return map[uid];
    };
    (evRes.data ?? []).forEach((e: any) => {
      const a = ensure(e.recorded_by); if (!a) return;
      if (e.recorded_at >= todayISO) a.eventsToday++;
      if (!a.lastAt || e.recorded_at > a.lastAt) {
        a.lastAt = e.recorded_at;
        const st = stationByCode(e.station)?.label ?? e.station;
        a.lastLabel = e.station === "paint" ? `Painted (${st})` : `Scanned ${st}`;
      }
    });
    (shRes.data ?? []).forEach((s: any) => {
      const a = ensure(s.created_by); if (!a) return;
      if (s.created_at >= todayISO) a.shortagesToday++;
      if (!a.lastAt || s.created_at > a.lastAt) { a.lastAt = s.created_at; a.lastLabel = "Logged shortage"; }
    });
    (issRes.data ?? []).forEach((i: any) => {
      const a = ensure(i.reported_by); if (!a) return;
      if (i.created_at >= todayISO) a.issuesToday++;
      if (!a.lastAt || i.created_at > a.lastAt) { a.lastAt = i.created_at; a.lastLabel = "Reported issue"; }
    });
    setActivity(map);

    const avgMap: Record<string, { avg: number; days: number }> = {};
    (avgRes.data ?? []).forEach((r: any) => { avgMap[r.user_id] = { avg: Number(r.avg_seconds) || 0, days: Number(r.days_active) || 0 }; });
    setAvgDaily(avgMap);

    setLoading(false);
  };

  useEffect(() => {
    reload();
    const ch = supabase.channel("presence-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, reload)
      .subscribe();
    const tick = setInterval(reload, 30_000); // keep "Active Xm ago" fresh
    return () => { supabase.removeChannel(ch); clearInterval(tick); };
  }, []);

  const onlineCount = rows.filter(r => presenceStatus(r.last_heartbeat, r.is_online).tone === "online").length;
  const dotClass = (tone: "online" | "idle" | "offline") =>
    tone === "online" ? "bg-green-500" : tone === "idle" ? "bg-amber-500" : "bg-gray-400";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="success" className="gap-1">
          <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span>
          {onlineCount} active now
        </Badge>
        <span className="text-sm text-muted-foreground">{rows.length} total users</span>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="No presence data" description="User activity will appear here once users log in." />
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="bg-muted">
                <th className="p-2 text-left font-semibold">Status</th>
                <th className="p-2 text-left font-semibold">User</th>
                <th className="p-2 text-left font-semibold">Last Seen</th>
                <th className="p-2 text-left font-semibold">Last Activity</th>
                <th className="p-2 text-left font-semibold">Active Today</th>
                <th className="p-2 text-left font-semibold">Avg Daily (30d)</th>
                <th className="p-2 text-left font-semibold">Today</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => {
                const st = presenceStatus(r.last_heartbeat, r.is_online);
                const act = activity[r.user_id];
                const avg = avgDaily[r.user_id];
                return (
                  <tr key={r.user_id} className={st.tone === "offline" ? "opacity-60" : ""}>
                    <td className="p-2 whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        {st.tone === "online" ? (
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                          </span>
                        ) : (
                          <span className={`inline-flex rounded-full h-2.5 w-2.5 ${dotClass(st.tone)}`} />
                        )}
                        <span className="text-xs font-medium">{st.label}</span>
                      </span>
                    </td>
                    <td className="p-2 font-medium">{r.profile?.display_name ?? "Unknown"}</td>
                    <td className="p-2 text-xs text-muted-foreground" title={r.last_heartbeat ?? ""}>{formatRelative(r.last_heartbeat)}</td>
                    <td className="p-2 text-xs">
                      {act?.lastAt ? (
                        <span><span className="text-muted-foreground">{act.lastLabel}</span> · {formatRelative(act.lastAt)}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2">
                      <Badge variant={r.total_active_seconds > 3600 ? "success" : r.total_active_seconds > 0 ? "info" : "muted"} className="text-[10px]">
                        {formatDuration(r.total_active_seconds)}
                      </Badge>
                    </td>
                    <td className="p-2 text-xs">
                      {avg ? (
                        <span>{formatDuration(avg.avg)} <span className="text-muted-foreground">({avg.days}d)</span></span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                      {act ? `${act.eventsToday} ev · ${act.shortagesToday} sh · ${act.issuesToday} iss` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type ContractLogEntry = {
  id: string;
  vin: string;
  vin_suffix: string | null;
  contract_model: string;
  released_from: string;
  released_at: string;
  released_by: string | null;
  releaser: { display_name: string } | null;
};

function ContractProductionPanel() {
  const [logs, setLogs] = useState<ContractLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("contract_vehicle_log")
      .select("id, vin, vin_suffix, contract_model, released_from, released_at, released_by, releaser:profiles(display_name)")
      .gte("released_at", `${monthFilter}-01T00:00:00`)
      .lt("released_at", (() => { const [y, m] = monthFilter.split("-").map(Number); const next = new Date(y, m, 1); return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01T00:00:00`; })())
      .order("released_at", { ascending: false });
    if (error) { toast.error(error.message); setLoading(false); return; }
    setLogs((data ?? []) as unknown as ContractLogEntry[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [monthFilter]);

  const summary = useMemo(() => {
    const m = new Map<string, { model: string; count: number; fromWbs: number; fromPaint: number }>();
    logs.forEach(l => {
      const e = m.get(l.contract_model) ?? { model: l.contract_model, count: 0, fromWbs: 0, fromPaint: 0 };
      e.count++;
      if (l.released_from === "wbs") e.fromWbs++;
      if (l.released_from === "paint") e.fromPaint++;
      m.set(l.contract_model, e);
    });
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [logs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="text-sm">Month</Label>
        <Input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="w-40" />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {summary.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Monthly Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {summary.map(s => (
                <div key={s.model} className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{s.count}</div>
                  <div className="text-sm font-medium">{s.model}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.fromWbs > 0 && `${s.fromWbs} from WBS`} {s.fromPaint > 0 && `${s.fromWbs > 0 ? "· " : ""}${s.fromPaint} from Paint`}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Contract Vehicles Released ({logs.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : logs.length === 0 ? (
            <EmptyState icon={Truck} title="No contract vehicles" description={`No contract vehicles released in ${monthFilter}.`} />
          ) : (
            <div className="border rounded-md overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="bg-muted">
                    <th className="p-2 text-left font-semibold">Date</th>
                    <th className="p-2 text-left font-semibold">VIN</th>
                    <th className="p-2 text-left font-semibold">Model</th>
                    <th className="p-2 text-left font-semibold">Released From</th>
                    <th className="p-2 text-left font-semibold">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td className="p-2 whitespace-nowrap">{new Date(l.released_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="p-2 font-mono">{l.vin}</td>
                      <td className="p-2"><Badge variant="info" className="text-[10px] px-1">{l.contract_model}</Badge></td>
                      <td className="p-2 capitalize">{l.released_from}</td>
                      <td className="p-2 font-medium">{l.releaser?.display_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
