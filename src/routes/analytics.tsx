import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATIONS, stationByCode } from "@/lib/stations";
import { StatCard } from "@/components/StatCard";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell } from "recharts";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Nexus-Flow" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { isSuperuser } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!isSuperuser) nav({ to: "/" }); }, [isSuperuser, nav]);

  const [stationCounts, setStationCounts] = useState<{ name: string; count: number }[]>([]);
  const [colorVariance, setColorVariance] = useState<{ color: string; planned: number; actual: number; variance: number }[]>([]);
  const [openShortages, setOpenShortages] = useState(0);
  const [vehicleTotal, setVehicleTotal] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: vs } = await supabase.from("vehicles").select("current_station, planned_color, actual_color");
      setVehicleTotal(vs?.length ?? 0);

      const counts = STATIONS.map(s => ({ name: s.short, count: (vs ?? []).filter(v => v.current_station === s.code).length }));
      setStationCounts(counts);

      const planned: Record<string, number> = {}; const actual: Record<string, number> = {};
      (vs ?? []).forEach(v => {
        if (v.planned_color) planned[v.planned_color] = (planned[v.planned_color] ?? 0) + 1;
        if (v.actual_color) actual[v.actual_color] = (actual[v.actual_color] ?? 0) + 1;
      });
      const colors = Array.from(new Set([...Object.keys(planned), ...Object.keys(actual)]));
      setColorVariance(colors.map(c => ({ color: c, planned: planned[c] ?? 0, actual: actual[c] ?? 0, variance: (actual[c] ?? 0) - (planned[c] ?? 0) })));

      const { count } = await supabase.from("shortages").select("id", { count: "exact", head: true }).eq("status","open");
      setOpenShortages(count ?? 0);
    })();
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Analytics</h1>

      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard label="Total vehicles" value={vehicleTotal} />
        <StatCard label="Open shortages" value={openShortages} tone={openShortages > 0 ? "warning" : "success"} />
        <StatCard label="In production" value={stationCounts.reduce((a,b) => a + (b.name === "WH" || b.name === "PDI" ? 0 : b.count), 0)} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Vehicles per station</CardTitle></CardHeader>
        <CardContent style={{ height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={stationCounts}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="name" stroke="currentColor" fontSize={12} />
              <YAxis stroke="currentColor" fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--color-primary)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Color variance (actual − planned)</CardTitle></CardHeader>
        <CardContent style={{ height: 240 }}>
          {colorVariance.length === 0 ? <p className="text-xs text-muted-foreground">No color data yet.</p> : (
            <ResponsiveContainer>
              <BarChart data={colorVariance}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="color" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="variance" radius={[4,4,4,4]}>
                  {colorVariance.map((c, i) => <Cell key={i} fill={c.variance === 0 ? "var(--color-success)" : c.variance > 0 ? "var(--color-warning)" : "var(--color-destructive)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
