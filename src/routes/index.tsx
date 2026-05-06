import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { STATIONS } from "@/lib/stations";
import { Lock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Stations — Nexus-Flow" },
    { name: "description", content: "Tap your station to start recording. Locked stations need superuser approval." },
  ]}),
  component: () => <RequireAuth><AppShell><Home /></AppShell></RequireAuth>,
});

function Home() {
  const { displayName, hasStation, isSuperuser, isStaff } = useAuth();
  const nav = useNavigate();
  const [requesting, setRequesting] = useState<string | null>(null);

  const [stats, setStats] = useState<{ total: number; inProduction: number; openShortages: number; openIssues: number } | null>(null);
  const [stationCounts, setStationCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const [{ data: vs }, { count: shortageCount }, { count: issueCount }] = await Promise.all([
        supabase.from("vehicles").select("current_station"),
        supabase.from("shortages").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("issues").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
      ]);
      const vehicles = vs ?? [];
      const counts: Record<string, number> = {};
      vehicles.forEach(v => {
        if (v.current_station) counts[v.current_station] = (counts[v.current_station] ?? 0) + 1;
      });
      setStationCounts(counts);
      setStats({
        total: vehicles.length,
        inProduction: vehicles.filter(v => v.current_station && v.current_station !== "warehouse" && v.current_station !== "pdi").length,
        openShortages: shortageCount ?? 0,
        openIssues: issueCount ?? 0,
      });
    })();
  }, []);

  const requestAccess = async (station: string) => {
    setRequesting(station);
    const { error } = await supabase.from("station_access_requests").insert({
      user_id: (await supabase.auth.getUser()).data.user!.id,
      station: station as "warehouse" | "wbs" | "paint" | "pbs" | "shortage" | "repair" | "cs" | "pdi",
    });
    setRequesting(null);
    if (error) toast.error(error.message); else toast.success("Request sent for approval");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hi {displayName?.split(" ")[0] ?? "there"}</h1>
        <p className="text-muted-foreground text-sm">Pick a station. Locked icons need approval.</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total vehicles" value={stats.total} />
          <StatCard label="In production" value={stats.inProduction} />
          <StatCard label="Open shortages" value={stats.openShortages} tone={stats.openShortages > 0 ? "warning" : "success"} />
          <StatCard label="Open issues" value={stats.openIssues} tone={stats.openIssues > 0 ? "warning" : "success"} />
        </div>
      )}

      <section>
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Data-entry stations</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {STATIONS.filter(s => s.module === "data-entry").map(s => {
            const unlocked = hasStation(s.code);
            const count = stationCounts[s.code] ?? 0;
            return (
              <button key={s.code}
                onClick={() => unlocked ? nav({ to: "/station/$code", params: { code: s.code } }) : requestAccess(s.code)}
                disabled={!!requesting}
                className={`group relative text-left rounded-xl border p-4 transition-all ${unlocked ? "bg-card hover:border-primary/40 hover:shadow-[var(--shadow-pop)]" : "bg-muted/40 hover:bg-muted"}`}>
                {count > 0 && unlocked && (
                  <Badge variant="secondary" className="absolute top-2 right-2 text-[10px] px-1.5">{count}</Badge>
                )}
                <div className="flex items-start justify-between">
                  <div className={`h-10 w-10 rounded-lg grid place-items-center ${unlocked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <s.icon className="h-5 w-5" />
                  </div>
                  {!unlocked && <Lock className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="mt-3">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.description}</div>
                </div>
                {unlocked
                  ? <div className="text-xs text-primary mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">Open <ChevronRight className="h-3 w-3" /></div>
                  : <div className="text-xs text-muted-foreground mt-2">Tap to request access</div>}
              </button>
            );
          })}
        </div>
      </section>

      {(isStaff || isSuperuser) && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Bulk-paste stations (Staff)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {STATIONS.filter(s => s.module === "bulk").map(s => {
              const count = stationCounts[s.code] ?? 0;
              return (
                <Link key={s.code} to="/bulk/$code" params={{ code: s.code }}
                  className="relative rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-[var(--shadow-pop)] transition-all">
                  {count > 0 && <Badge variant="secondary" className="absolute top-2 right-2 text-[10px] px-1.5">{count}</Badge>}
                  <div className="h-10 w-10 rounded-lg bg-info/10 text-info grid place-items-center"><s.icon className="h-5 w-5" /></div>
                  <div className="mt-3 font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.description}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {isSuperuser && (
        <section className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Superuser tools</div>
              <div className="text-xs text-muted-foreground">Approve requests, assign stations, view analytics.</div>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm"><Link to="/admin">Admin</Link></Button>
              <Button asChild size="sm"><Link to="/analytics">Analytics</Link></Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
