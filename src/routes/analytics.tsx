import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATIONS, stationByCode } from "@/lib/stations";
import { StatCard } from "@/components/StatCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell, LineChart, Line, Legend } from "recharts";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [{ title: "Analytics — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

type TimeRange = "today" | "week" | "month";

function getRangeStart(range: TimeRange): Date {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === "week") {
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  } else if (range === "month") {
    start.setDate(1);
  }
  return start;
}

function Page() {
  const { isSuperuser } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!isSuperuser) nav({ to: "/" }); }, [isSuperuser, nav]);

  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [stationCounts, setStationCounts] = useState<{ name: string; count: number }[]>([]);
  const [colorVariance, setColorVariance] = useState<{ color: string; planned: number; actual: number; variance: number }[]>([]);
  const [openShortages, setOpenShortages] = useState(0);
  const [vehicleTotal, setVehicleTotal] = useState(0);
  const [vehiclesMoved, setVehiclesMoved] = useState(0);
  const [issuesResolved, setIssuesResolved] = useState(0);
  const [openIssues, setOpenIssues] = useState(0);
  const [trendData, setTrendData] = useState<{ date: string; moved: number }[]>([]);
  const [stationFlow, setStationFlow] = useState<{ station: string; ins: number; outs: number }[]>([]);
  const [modelCounts, setModelCounts] = useState<{ model: string; total: number; inProd: number; completed: number }[]>([]);
  const [wipRows, setWipRows] = useState<{ station: string; count: number; openIssues: number; openShortages: number }[]>([]);

  const load = useCallback(async () => {
    const rangeStart = getRangeStart(timeRange);

    const [vsRes, shortagesRes, issuesRes, eventsRes, resolvedRes, lotsRes, issuesByVehicleRes, shortagesByVehicleRes] = await Promise.all([
      supabase.from("vehicles").select("current_station, planned_color_id, actual_color_id, job_order_id"),
      supabase.from("shortages").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("issues").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
      supabase.from("station_events").select("station, kind, recorded_at").gte("recorded_at", rangeStart.toISOString()),
      supabase.from("issues").select("id", { count: "exact", head: true }).gte("resolved_at", rangeStart.toISOString()),
      supabase.from("lots").select("id, model"),
      supabase.from("issues").select("id, vehicle_id").in("status", ["open", "in_progress"]),
      supabase.from("shortages").select("id, vehicle_id").eq("status", "open"),
    ]);

    const vs = vsRes.data ?? [];
    setVehicleTotal(vs.length);
    setOpenShortages(shortagesRes.count ?? 0);
    setOpenIssues(issuesRes.count ?? 0);
    setIssuesResolved(resolvedRes.count ?? 0);

    const counts = STATIONS.map(s => ({ name: s.short, count: vs.filter(v => v.current_station === s.code).length }));
    setStationCounts(counts);

    const planned: Record<string, number> = {}; const actual: Record<string, number> = {};
    vs.forEach(v => {
      if (v.planned_color_id) planned[v.planned_color_id] = (planned[v.planned_color_id] ?? 0) + 1;
      if (v.actual_color_id) actual[v.actual_color_id] = (actual[v.actual_color_id] ?? 0) + 1;
    });
    const colors = Array.from(new Set([...Object.keys(planned), ...Object.keys(actual)]));
    setColorVariance(colors.map(c => ({ color: c, planned: planned[c] ?? 0, actual: actual[c] ?? 0, variance: (actual[c] ?? 0) - (planned[c] ?? 0) })));

    // Vehicles moved (events with kind="out" in range)
    const events = eventsRes.data ?? [];
    setVehiclesMoved(events.filter(e => e.kind === "out").length);

    // Station flow table
    const flowMap: Record<string, { ins: number; outs: number }> = {};
    STATIONS.forEach(s => { flowMap[s.code] = { ins: 0, outs: 0 }; });
    events.forEach(e => {
      if (flowMap[e.station]) {
        if (e.kind === "in") flowMap[e.station].ins++;
        else flowMap[e.station].outs++;
      }
    });
    setStationFlow(STATIONS.map(s => ({ station: s.label, ins: flowMap[s.code].ins, outs: flowMap[s.code].outs })));

    // Trend data — last 7 days
    const trendDays: { date: string; moved: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
      const dayLabel = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      const dayEvents = events.filter(e => {
        const t = new Date(e.recorded_at);
        return t >= dayStart && t <= dayEnd && e.kind === "out";
      });
      trendDays.push({ date: dayLabel, moved: dayEvents.length });
    }
    setTrendData(trendDays);

    // Model counts — join vehicles to lots via job_orders
    const lots = lotsRes.data ?? [];
    const lotMap = Object.fromEntries(lots.map(l => [l.id, l.model]));
    // We need vehicles with lot_id to resolve model
    const { data: vsWithLot } = await supabase.from("vehicles").select("id, lot_id, current_station");
    const vLot = vsWithLot ?? [];
    const modelMap: Record<string, { total: number; inProd: number; completed: number }> = {};
    vLot.forEach(v => {
      const model = (v.lot_id && lotMap[v.lot_id]) ?? "Unknown";
      if (!modelMap[model]) modelMap[model] = { total: 0, inProd: 0, completed: 0 };
      modelMap[model].total++;
      if (v.current_station && v.current_station !== "warehouse" && v.current_station !== "pdi") modelMap[model].inProd++;
      if (v.current_station === "pdi") modelMap[model].completed++;
    });
    setModelCounts(Object.entries(modelMap).map(([model, counts]) => ({ model, ...counts })));

    // WIP table — vehicles per station (excluding warehouse and PDI) with issues and shortages
    const issueVehicleSet = new Set((issuesByVehicleRes.data ?? []).map(i => i.vehicle_id).filter(Boolean) as string[]);
    const shortageVehicleSet = new Set((shortagesByVehicleRes.data ?? []).map(s => s.vehicle_id).filter(Boolean) as string[]);
    const wipStations = STATIONS.filter(s => s.code !== "warehouse" && s.code !== "pdi");
    setWipRows(wipStations.map(s => {
      const stationVehicles = vLot.filter(v => v.current_station === s.code);
      const openIssues = stationVehicles.filter(v => issueVehicleSet.has(v.id)).length;
      const openShortages = stationVehicles.filter(v => shortageVehicleSet.has(v.id)).length;
      return { station: s.label, count: stationVehicles.length, openIssues, openShortages };
    }));
  }, [timeRange]);

  useEffect(() => { load(); }, [load]);

  const inProduction = stationCounts.reduce((a, b) => a + (b.name === "WH" || b.name === "PDI" ? 0 : b.count), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Overview Stats */}
      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard label="Total vehicles" value={vehicleTotal} />
        <StatCard label="Open shortages" value={openShortages} tone={openShortages > 0 ? "warning" : "success"} />
        <StatCard label="In production" value={inProduction} />
      </div>

      {/* Throughput Stats */}
      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard label={`Vehicles moved (${timeRange})`} value={vehiclesMoved} tone={vehiclesMoved > 0 ? "success" : undefined} />
        <StatCard label={`Issues resolved (${timeRange})`} value={issuesResolved} />
        <StatCard label="Open issues" value={openIssues} tone={openIssues > 0 ? "warning" : "success"} />
      </div>

      {/* Vehicles per station */}
      <Card>
        <CardHeader><CardTitle className="text-base">Vehicles per station</CardTitle></CardHeader>
        <CardContent style={{ height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={stationCounts}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="name" stroke="currentColor" fontSize={12} />
              <YAxis stroke="currentColor" fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Trend line */}
      <Card>
        <CardHeader><CardTitle className="text-base">Daily throughput (last 7 days)</CardTitle></CardHeader>
        <CardContent style={{ height: 240 }}>
          {trendData.every(d => d.moved === 0) ? <p className="text-xs text-muted-foreground">No movement data yet.</p> : (
            <ResponsiveContainer>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" stroke="currentColor" fontSize={12} />
                <YAxis stroke="currentColor" fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="moved" stroke="var(--color-primary)" strokeWidth={2} dot={{ fill: "var(--color-primary)" }} name="Vehicles moved" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Color variance */}
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
                <Bar dataKey="variance" radius={[4, 4, 4, 4]}>
                  {colorVariance.map((c, i) => <Cell key={i} fill={c.variance === 0 ? "var(--color-success)" : c.variance > 0 ? "var(--color-warning)" : "var(--color-destructive)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Factory status table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Factory station flow ({timeRange})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Station</TableHead>
                <TableHead className="text-right">Vehicles In</TableHead>
                <TableHead className="text-right">Vehicles Out</TableHead>
                <TableHead className="text-right">Net Flow</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stationFlow.map(row => (
                <TableRow key={row.station}>
                  <TableCell className="font-medium">{row.station}</TableCell>
                  <TableCell className="text-right">{row.ins}</TableCell>
                  <TableCell className="text-right">{row.outs}</TableCell>
                  <TableCell className="text-right font-mono">{row.ins - row.outs > 0 ? `+${row.ins - row.outs}` : row.ins - row.outs}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Models breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-base">Models breakdown</CardTitle></CardHeader>
        <CardContent>
          {modelCounts.length === 0 ? <p className="text-xs text-muted-foreground">No model data yet.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">In Production</TableHead>
                  <TableHead className="text-right">Completed (PDI)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelCounts.map(row => (
                  <TableRow key={row.model}>
                    <TableCell className="font-medium">{row.model}</TableCell>
                    <TableCell className="text-right">{row.total}</TableCell>
                    <TableCell className="text-right">{row.inProd}</TableCell>
                    <TableCell className="text-right">{row.completed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* WIP table */}
      <Card>
        <CardHeader><CardTitle className="text-base">WIP — Work In Progress</CardTitle></CardHeader>
        <CardContent>
          {wipRows.every(r => r.count === 0) ? <p className="text-xs text-muted-foreground">No vehicles in production.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Station</TableHead>
                  <TableHead className="text-right">Vehicles</TableHead>
                  <TableHead className="text-right">Open Issues</TableHead>
                  <TableHead className="text-right">Open Shortages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wipRows.map(row => (
                  <TableRow key={row.station}>
                    <TableCell className="font-medium">{row.station}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right">{row.openIssues > 0 ? <span className="text-warning">{row.openIssues}</span> : row.openIssues}</TableCell>
                    <TableCell className="text-right">{row.openShortages > 0 ? <span className="text-warning">{row.openShortages}</span> : row.openShortages}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold border-t-2">
                  <TableCell>Total WIP</TableCell>
                  <TableCell className="text-right">{wipRows.reduce((a, b) => a + b.count, 0)}</TableCell>
                  <TableCell className="text-right">{wipRows.reduce((a, b) => a + b.openIssues, 0)}</TableCell>
                  <TableCell className="text-right">{wipRows.reduce((a, b) => a + b.openShortages, 0)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
