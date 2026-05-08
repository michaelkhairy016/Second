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
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell, LineChart, Line, Legend } from "recharts";
import { useColors } from "@/hooks/use-colors";
import type { ProductionPlan } from "@/lib/db-types";
import { FileDown, Send, Loader2 } from "lucide-react";

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

  const { getCode } = useColors();

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
  const [jphData, setJphData] = useState<{ station: string; jph: number; outs: number; hours: number }[]>([]);
  const [planData, setPlanData] = useState<{ model: string; monthly_plan: number; daily_target: number; jph_target: number; actual: number }[]>([]);
  const [reportModels, setReportModels] = useState<string[]>([]);
  const [outsByStationModel, setOutsByStationModel] = useState<Record<string, Record<string, number>>>({});
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    const rangeStart = getRangeStart(timeRange);

    const [vsRes, shortagesRes, issuesRes, eventsRes, resolvedRes, lotsRes, issuesByVehicleRes, shortagesByVehicleRes, plansRes] = await Promise.all([
      supabase.from("vehicles").select("current_station, planned_color_id, actual_color_id, job_order_id").is("completed_at", null),
      supabase.from("shortages").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("issues").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
      supabase.from("station_events").select("station, kind, recorded_at, vehicle_id").gte("recorded_at", rangeStart.toISOString()),
      supabase.from("issues").select("id", { count: "exact", head: true }).gte("resolved_at", rangeStart.toISOString()),
      supabase.from("lots").select("id, model"),
      supabase.from("issues").select("id, vehicle_id").in("status", ["open", "in_progress"]),
      supabase.from("shortages").select("id, vehicle_id").eq("status", "open"),
      supabase.from("production_plans").select("*, model:models(name)").eq("month", new Date().toISOString().slice(0, 8) + "01"),
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
    const colorIds = Array.from(new Set([...Object.keys(planned), ...Object.keys(actual)]));
    setColorVariance(colorIds.map(id => ({ color: getCode(id), planned: planned[id] ?? 0, actual: actual[id] ?? 0, variance: (actual[id] ?? 0) - (planned[id] ?? 0) })));

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

    // JPH per station
    const rangeStart_time = rangeStart.getTime();
    const now_time = Date.now();
    const elapsedHours = Math.max((now_time - rangeStart_time) / (1000 * 60 * 60), 1);
    const jphStations = STATIONS.filter(s => s.code !== "warehouse");
    setJphData(jphStations.map(s => {
      const outs = flowMap[s.code]?.outs ?? 0;
      return { station: s.label, jph: Math.round((outs / elapsedHours) * 10) / 10, outs, hours: Math.round(elapsedHours * 10) / 10 };
    }));

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

    // Model counts
    const lots = lotsRes.data ?? [];
    const lotMap = Object.fromEntries(lots.map(l => [l.id, l.model]));
    const { data: vsWithLot } = await supabase.from("vehicles").select("id, lot_id, current_station").is("completed_at", null);
    const vLot = vsWithLot ?? [];
    const modelMap: Record<string, { total: number; inProd: number; completed: number }> = {};
    const vModelMap = new Map<string, string>();
    vLot.forEach(v => {
      const model = (v.lot_id && lotMap[v.lot_id]) ?? "Unknown";
      vModelMap.set(v.id, model);
      if (!modelMap[model]) modelMap[model] = { total: 0, inProd: 0, completed: 0 };
      modelMap[model].total++;
      if (v.current_station && v.current_station !== "warehouse" && v.current_station !== "pdi") modelMap[model].inProd++;
      if (v.current_station === "pdi") modelMap[model].completed++;
    });
    setModelCounts(Object.entries(modelMap).map(([model, c]) => ({ model, ...c })));

    // Report: station outs by model
    const rModels = Array.from(new Set([...Object.keys(modelMap), ...plansRes.data?.map((p: any) => p.model?.name).filter(Boolean) ?? []])).sort();
    setReportModels(rModels);
    const obm: Record<string, Record<string, number>> = {};
    STATIONS.forEach(s => { obm[s.code] = {}; rModels.forEach(m => { obm[s.code][m] = 0; }); });
    events.filter(e => e.kind === "out").forEach(e => {
      const model = vModelMap.get(e.vehicle_id);
      if (model && obm[e.station]) obm[e.station][model] = (obm[e.station][model] ?? 0) + 1;
    });
    setOutsByStationModel(obm);

    // Production plan data
    const plans = (plansRes.data ?? []) as any[];
    setPlanData(plans.map((p: any) => ({
      model: p.model?.name ?? "Unknown",
      monthly_plan: p.monthly_plan,
      daily_target: p.daily_target,
      jph_target: p.jph_target,
      actual: modelMap[p.model?.name]?.completed ?? 0,
    })));

    // WIP table
    const issueVehicleSet = new Set((issuesByVehicleRes.data ?? []).map(i => i.vehicle_id).filter(Boolean) as string[]);
    const shortageVehicleSet = new Set((shortagesByVehicleRes.data ?? []).map(s => s.vehicle_id).filter(Boolean) as string[]);
    const wipStations = STATIONS.filter(s => s.code !== "warehouse" && s.code !== "pdi");
    setWipRows(wipStations.map(s => {
      const stationVehicles = vLot.filter(v => v.current_station === s.code);
      const openIssues = stationVehicles.filter(v => issueVehicleSet.has(v.id)).length;
      const openShortages = stationVehicles.filter(v => shortageVehicleSet.has(v.id)).length;
      return { station: s.label, count: stationVehicles.length, openIssues, openShortages };
    }));
  }, [timeRange, getCode]);

  useEffect(() => { load(); }, [load]);

  const inProduction = stationCounts.reduce((a, b) => a + (b.name === "WH" || b.name === "PDI" ? 0 : b.count), 0);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${url}/functions/v1/timely-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) }),
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `timely-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { console.error("PDF download error:", e); }
    finally { setDownloading(false); }
  };

  const sendReport = async () => {
    setSending(true);
    try {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${url}/functions/v1/send-report`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed"); }
      alert("Report sent successfully!");
    } catch (e: any) { console.error("Send error:", e); alert("Failed to send: " + (e.message || "Unknown error")); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-5">
      {/* Timely Report Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Timely Report Preview — {new Date().toISOString().slice(0, 10)}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={downloadPdf} disabled={downloading}>
                {downloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileDown className="h-4 w-4 mr-1" />} Download PDF
              </Button>
              <Button size="sm" onClick={sendReport} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Send via Email
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Monthly Plan Summary */}
          {planData.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-1">Monthly Plan Summary</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Monthly Plan</TableHead>
                    <TableHead className="text-right">Daily Target</TableHead>
                    <TableHead className="text-right">JPH Target</TableHead>
                    <TableHead className="text-right">Total Actual</TableHead>
                    <TableHead className="text-right">Achieved %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planData.map(r => {
                    const totalOut = STATIONS.reduce((s, st) => s + (outsByStationModel[st.code]?.[r.model] ?? 0), 0);
                    return (
                      <TableRow key={r.model}>
                        <TableCell className="font-medium">{r.model}</TableCell>
                        <TableCell className="text-right">{r.monthly_plan}</TableCell>
                        <TableCell className="text-right">{r.daily_target}</TableCell>
                        <TableCell className="text-right">{r.jph_target}</TableCell>
                        <TableCell className="text-right">{totalOut}</TableCell>
                        <TableCell className="text-right font-semibold">{r.monthly_plan > 0 ? ((totalOut / r.monthly_plan) * 100).toFixed(1) + "%" : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Daily Station Outs by Model */}
          {reportModels.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-1">Daily Station Outs</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Station</TableHead>
                      {reportModels.map(m => <TableHead key={m} className="text-right">{m}</TableHead>)}
                      <TableHead className="text-right font-semibold">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {STATIONS.map(st => {
                      const total = reportModels.reduce((s, m) => s + (outsByStationModel[st.code]?.[m] ?? 0), 0);
                      return (
                        <TableRow key={st.code}>
                          <TableCell className="font-medium">{st.label}</TableCell>
                          {reportModels.map(m => <TableCell key={m} className="text-right">{outsByStationModel[st.code]?.[m] ?? 0}</TableCell>)}
                          <TableCell className="text-right font-semibold">{total}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* JPH Summary */}
          {jphData.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-1">JPH Summary</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Station</TableHead>
                    <TableHead className="text-right">Total Out</TableHead>
                    <TableHead className="text-right">JPH</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jphData.map(row => (
                    <TableRow key={row.station}>
                      <TableCell className="font-medium">{row.station}</TableCell>
                      <TableCell className="text-right">{row.outs}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{row.jph}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* JPH per station */}
      <Card>
        <CardHeader><CardTitle className="text-base">JPH — Jobs Per Hour ({timeRange})</CardTitle></CardHeader>
        <CardContent>
          {jphData.length === 0 ? <p className="text-xs text-muted-foreground">No JPH data yet.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Station</TableHead>
                  <TableHead className="text-right">Vehicles Out</TableHead>
                  <TableHead className="text-right">Elapsed Hours</TableHead>
                  <TableHead className="text-right">JPH</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jphData.map(row => (
                  <TableRow key={row.station}>
                    <TableCell className="font-medium">{row.station}</TableCell>
                    <TableCell className="text-right">{row.outs}</TableCell>
                    <TableCell className="text-right">{row.hours}h</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{row.jph}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

      {/* Production Plan vs Actual */}
      {planData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Production Plan vs Actual (this month)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Monthly Plan</TableHead>
                  <TableHead className="text-right">Daily Target</TableHead>
                  <TableHead className="text-right">JPH Target</TableHead>
                  <TableHead className="text-right">Actual (PDI)</TableHead>
                  <TableHead className="text-right">Achieved %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planData.map(row => (
                  <TableRow key={row.model}>
                    <TableCell className="font-medium">{row.model}</TableCell>
                    <TableCell className="text-right">{row.monthly_plan}</TableCell>
                    <TableCell className="text-right">{row.daily_target}</TableCell>
                    <TableCell className="text-right">{row.jph_target}</TableCell>
                    <TableCell className="text-right">{row.actual}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {row.monthly_plan > 0 ? `${((row.actual / row.monthly_plan) * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
