import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProductionFlowDiagram } from "@/components/ProductionFlowDiagram";
import { StationDetailSheet } from "@/components/StationDetailSheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATIONS, stationByCode } from "@/lib/stations";
import { StatCard } from "@/components/StatCard";
import { Search, AlertCircle, CheckCircle2, XCircle, FileSpreadsheet, Download, Clock } from "lucide-react";
import { findBySuffix } from "@/lib/vin";
import { exportToCSV } from "@/lib/export";
import { formatDuration } from "@/lib/utils";
import type { Vehicle, Issue, StationCode } from "@/lib/db-types";
import { useColors } from "@/hooks/use-colors";

export const Route = createFileRoute("/status")({
  head: () => ({ meta: [{ title: "Status — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><StatusPage /></AppShell></RequireAuth>,
});

function StatusPage() {
  const { isStatus } = useAuth();

  if (!isStatus) return <p className="text-muted-foreground">Access restricted to status users.</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Factory Status</h1>
        <p className="text-muted-foreground text-sm">Read-only overview — production flow, WIP, and VIN lookup.</p>
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily Status</TabsTrigger>
          <TabsTrigger value="flow">Production Flow</TabsTrigger>
          <TabsTrigger value="wip">Work In Progress</TabsTrigger>
          <TabsTrigger value="delayed">Delayed</TabsTrigger>
          <TabsTrigger value="lookup">VIN Lookup</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-4">
          <DailyStatusTab />
        </TabsContent>
        <TabsContent value="flow" className="mt-4">
          <FlowTab />
        </TabsContent>
        <TabsContent value="wip" className="mt-4">
          <WIPTab />
        </TabsContent>
        <TabsContent value="lookup" className="mt-4">
          <LookupTab />
        </TabsContent>
        <TabsContent value="delayed" className="mt-4">
          <DelayedTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================================================
   Daily Status Tab — mirrors the factory Excel daily report
   ============================================================ */

type ModelRow = Record<string, number>;

interface ShopSection {
  name: string;
  rows: { label: string; data: ModelRow; total: number; highlight?: boolean }[];
}

function DailyStatusTab() {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [monthStart] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString();
  });

  const [models, setModels] = useState<string[]>([]);
  const [dailyShops, setDailyShops] = useState<ShopSection[]>([]);
  const [monthlyShops, setMonthlyShops] = useState<ShopSection[]>([]);
  const [wipRows, setWipRows] = useState<{ label: string; data: ModelRow; total: number }[]>([]);
  const [totalWip, setTotalWip] = useState(0);
  const [mtdWorkingHours, setMtdWorkingHours] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      setLoading(true);

      // Single RPC call + MTD working hours
      const [{ data: rpcData }, { data: mtdData }] = await Promise.all([
        supabase.rpc("get_daily_status_data"),
        supabase.from("factory_calendar").select("working_hours").gte("date", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)).lte("date", new Date().toISOString().slice(0, 10)).eq("is_working_day", true),
      ]);
      if (cancel) return;

      setMtdWorkingHours((mtdData ?? []).reduce((sum: number, r: any) => sum + (r.working_hours ?? 0), 0));

      const vehicles: any[] = rpcData?.vehicles ?? [];
      const allEvents: any[] = rpcData?.events ?? [];

      // Determine unique models
      const modelSet = new Set<string>();
      vehicles.forEach((v: any) => { if (v.model) modelSet.add(v.model); });
      allEvents.forEach((e: any) => { if (e.model) modelSet.add(e.model); });
      const modelList = Array.from(modelSet).sort();
      setModels(modelList);

      const sum = (m: ModelRow) => modelList.reduce((s, k) => s + (m[k] ?? 0), 0);
      const empty = (): ModelRow => { const o: ModelRow = {}; modelList.forEach(k => o[k] = 0); return o; };

      // Build vehicle model map
      const vModel = new Map<string, string>();
      vehicles.forEach((v: any) => { if (v.model) vModel.set(v.id, v.model); });

      // --- Daily events ---
      const dayStart = new Date(selectedDate + "T00:00:00");
      const dayEnd = new Date(selectedDate + "T23:59:59");
      const dailyEvents = allEvents.filter(e => {
        const t = new Date(e.recorded_at);
        return t >= dayStart && t <= dayEnd;
      });

      const buildSections = (evts: any[]): ShopSection[] => {
        const stations = [
          { code: "body_shop", label: "Body Shop" },
          { code: "wbs", label: "WBS" },
          { code: "paint", label: "Paint" },
          { code: "shortage", label: "Shortage" },
          { code: "tcf", label: "TCF" },
          { code: "waiting_repair", label: "Waiting Repair" },
          { code: "repair", label: "Repair" },
          { code: "cs", label: "C.S" },
          { code: "pdi", label: "PDI" },
          { code: "tcf_offline", label: "TCF Offline" },
        ];
        return stations.map(st => {
          const stationEvts = evts.filter(e => e.station === st.code);
          const inRow = empty();
          const outRow = empty();
          stationEvts.forEach(e => {
            const model = e.model;
            if (!model) return;
            if (e.kind === "in") inRow[model] = (inRow[model] ?? 0) + 1;
            else outRow[model] = (outRow[model] ?? 0) + 1;
          });
          const rows: { label: string; data: ModelRow; total: number; highlight?: boolean }[] = [{ label: "IN", data: inRow, total: sum(inRow) }, { label: "Out", data: outRow, total: sum(outRow) }];
          if (st.code === "paint") {
            const totalOut: ModelRow = {};
            modelList.forEach(k => totalOut[k] = outRow[k] ?? 0);
            rows.push({ label: "Total Out", data: totalOut, total: sum(totalOut), highlight: true });
          }
          return { name: st.label, rows };
        });
      };

      setDailyShops(buildSections(dailyEvents));
      setMonthlyShops(buildSections(allEvents.filter(e => new Date(e.recorded_at) >= new Date(monthStart))));

      // --- WIP per station per model ---
      const wipStations = [
        { code: "warehouse", label: "Line Feeding" },
        { code: "body_shop", label: "Body Shop" },
        { code: "wbs", label: "WBS" },
        { code: "paint", label: "Paint" },
        { code: "pbs", label: "PBS" },
        { code: "tcf", label: "TCF" },
        { code: "waiting_repair", label: "Waiting Repair" },
        { code: "shortage", label: "Shortage" },
        { code: "repair", label: "Repair" },
        { code: "cs", label: "C.S" },
        { code: "tcf_offline", label: "TCF Offline" },
      ];
      const wipData = wipStations.map(st => {
        const row = empty();
        vehicles.filter((v: any) => v.current_station === st.code).forEach((v: any) => {
          const model = v.model;
          if (model) row[model] = (row[model] ?? 0) + 1;
        });
        return { label: st.label, data: row, total: sum(row) };
      });
      // Add total row
      const totalRow = empty();
      wipData.forEach(r => modelList.forEach(k => totalRow[k] = (totalRow[k] ?? 0) + (r.data[k] ?? 0)));
      wipData.push({ label: "Total WIP", data: totalRow, total: sum(totalRow) });
      setWipRows(wipData);
      setTotalWip(sum(totalRow));
      setLoading(false);
    };
    load();
    const ch = supabase.channel("status-daily")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, load)
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [monthStart, selectedDate]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading daily status...</p>;

  const isToday = selectedDate === new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Daily Production Status — All Models</h2>
          <p className="text-xs text-muted-foreground">{selectedDate}{isToday ? " · Updated in real-time" : " · Historical view"}</p>
        </div>
        <div className="flex items-center gap-3">
          <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} className="w-40" />
          <StatCard label="MTD Hours" value={`${mtdWorkingHours}h`} />
          <StatCard label="Total WIP" value={totalWip} />
        </div>
      </div>

      {/* Daily Shops Productivity */}
      <ShopTable title={`Daily Shops Productivity — ${selectedDate}`} models={models} sections={dailyShops} />

      {/* Monthly Shops Productivity */}
      <ShopTable title="Monthly Shops Productivity" models={models} sections={monthlyShops} />

      {/* Daily WIP Status */}
      <Card>
        <CardHeader><CardTitle className="text-base">Daily WIP Status — All Models</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1.5 px-2 font-medium text-muted-foreground w-28">Station</th>
                {models.map(m => <th key={m} className="text-center py-1.5 px-1.5 font-medium text-muted-foreground whitespace-nowrap">{m}</th>)}
                <th className="text-center py-1.5 px-2 font-bold">TTL</th>
              </tr>
            </thead>
            <tbody>
              {wipRows.map((r, i) => (
                <tr key={r.label} className={`border-b ${i === wipRows.length - 1 ? "bg-accent font-bold" : ""}`}>
                  <td className="py-1.5 px-2 font-medium">{r.label}</td>
                  {models.map(m => <td key={m} className="text-center py-1.5 px-1.5">{r.data[m] || ""}</td>)}
                  <td className="text-center py-1.5 px-2 font-bold">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function ShopTable({ title, models, sections }: { title: string; models: string[]; sections: ShopSection[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1.5 px-2 font-medium text-muted-foreground w-20">Shop</th>
              <th className="text-left py-1.5 px-2 font-medium text-muted-foreground w-16">Dir</th>
              {models.map(m => <th key={m} className="text-center py-1.5 px-1.5 font-medium text-muted-foreground whitespace-nowrap">{m}</th>)}
              <th className="text-center py-1.5 px-2 font-bold">TTL</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(section => (
              section.rows.map((row, ri) => (
                <tr key={`${section.name}-${row.label}`} className={`border-b ${row.highlight ? "bg-accent font-bold" : ri % 2 === 0 ? "bg-muted/30" : ""}`}>
                  {ri === 0 ? (
                    <td rowSpan={section.rows.length} className="py-1.5 px-2 font-semibold align-top border-r">{section.name}</td>
                  ) : null}
                  <td className="py-1.5 px-2 text-muted-foreground">{row.label}</td>
                  {models.map(m => <td key={m} className="text-center py-1.5 px-1.5">{row.data[m] || ""}</td>)}
                  <td className="text-center py-1.5 px-2 font-bold">{row.total}</td>
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function FlowTab() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [entryMap, setEntryMap] = useState<Record<string, string>>({});
  const [activeIssues, setActiveIssues] = useState<Record<string, Issue[]>>({});
  const [resolvedIssues, setResolvedIssues] = useState<Record<string, Issue[]>>({});
  const [activeJobOrderIds, setActiveJobOrderIds] = useState<Set<string>>(new Set());
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: vs }, { data: ev }, { data: ai }, { data: ri }, { data: jos }] = await Promise.all([
      supabase.from("vehicles").select("id, vin, vin_suffix, current_station, lot_id, job_order_id, planned_color_id, actual_color_id, is_lot_tail, tail_note").is("completed_at", null),
      supabase.from("station_events").select("vehicle_id, station, recorded_at").eq("kind", "in").order("recorded_at", { ascending: false }),
      supabase.from("issues").select("*").in("status", ["open", "in_progress"]),
      supabase.from("issues").select("*").in("status", ["resolved", "closed"]),
      supabase.from("job_orders").select("id").eq("status", "active"),
    ]);
    const vehicles = vs ?? [];
    setVehicles(vehicles);
    setActiveJobOrderIds(new Set((jos ?? []).map(j => j.id)));

    // Build entry time map
    const map: Record<string, string> = {};
    for (const e of (ev ?? [])) {
      const v = vehicles.find(v => v.id === e.vehicle_id);
      if (v && e.station === v.current_station && !map[e.vehicle_id]) {
        map[e.vehicle_id] = e.recorded_at;
      }
    }
    setEntryMap(map);

    const aiMap: Record<string, Issue[]> = {};
    (ai ?? []).forEach(i => { if (i.vehicle_id) (aiMap[i.vehicle_id] ??= []).push(i); });
    setActiveIssues(aiMap);

    const riMap: Record<string, Issue[]> = {};
    (ri ?? []).forEach(i => { if (i.vehicle_id) (riMap[i.vehicle_id] ??= []).push(i); });
    setResolvedIssues(riMap);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("status-flow")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_orders" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    vehicles.forEach(v => { if (v.current_station) c[v.current_station] = (c[v.current_station] ?? 0) + 1; });
    return c;
  }, [vehicles]);

  const lineFeedingCount = useMemo(() =>
    vehicles.filter(v => v.current_station === "warehouse" && v.job_order_id && activeJobOrderIds.has(v.job_order_id)).length,
    [vehicles, activeJobOrderIds]
  );

  const stationVehicles = useMemo(() => {
    if (!selectedStation) return [];
    if (selectedStation === "line_feeding") {
      return vehicles
        .filter(v => v.current_station === "warehouse" && v.job_order_id && activeJobOrderIds.has(v.job_order_id))
        .map(v => ({ ...v, activeIssues: activeIssues[v.id] ?? [], resolvedIssues: resolvedIssues[v.id] ?? [], enteredAt: entryMap[v.id] ?? null }));
    }
    return vehicles
      .filter(v => v.current_station === selectedStation)
      .map(v => ({ ...v, activeIssues: activeIssues[v.id] ?? [], resolvedIssues: resolvedIssues[v.id] ?? [], enteredAt: entryMap[v.id] ?? null }));
  }, [selectedStation, vehicles, activeJobOrderIds, activeIssues, resolvedIssues, entryMap]);

  return (
    <>
      <ProductionFlowDiagram counts={counts} lineFeedingCount={lineFeedingCount} onStationClick={setSelectedStation} />
      <StationDetailSheet
        stationKey={selectedStation ?? ""}
        vehicles={stationVehicles}
        open={!!selectedStation}
        onOpenChange={(open) => { if (!open) setSelectedStation(null); }}
      />
    </>
  );
}

function WIPTab() {
  const { getCode } = useColors();
  const [rows, setRows] = useState<{ station: string; count: number; vins: { vin: string; planned_color_id: string | null; actual_color_id: string | null; issues: { title: string; severity: string; status: string }[]; entered_at: string | null }[] }[]>([]);
  const [openShortages, setOpenShortages] = useState(0);
  const [openIssues, setOpenIssues] = useState(0);

  const handleExportAll = () => {
    const flatRows: Record<string, unknown>[] = [];
    rows.forEach(r => {
      r.vins.forEach(v => {
        flatRows.push({
          "Station": r.station,
          "VIN": v.vin,
          "Planned Color": getCode(v.planned_color_id),
          "Actual Color": getCode(v.actual_color_id),
          "Entered": v.entered_at ?? "",
          "Duration": v.entered_at ? formatDuration(v.entered_at) : "",
          "Issues": v.issues.map(i => `${i.title} (${i.severity})`).join("; ") || "",
        });
      });
    });
    if (flatRows.length === 0) return;
    exportToCSV(flatRows, `wip-export-${new Date().toISOString().slice(0, 10)}`);
  };

  useEffect(() => {
    const load = async () => {
      const [vsRes, issuesRes, shortagesRes, evRes] = await Promise.all([
        supabase.from("vehicles").select("id, vin, current_station, planned_color_id, actual_color_id").is("completed_at", null),
        supabase.from("issues").select("id, vehicle_id, title, severity, status").in("status", ["open", "in_progress"]),
        supabase.from("shortages").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("station_events").select("vehicle_id, station, recorded_at").eq("kind", "in").order("recorded_at", { ascending: false }),
      ]);
      const vs = vsRes.data ?? [];
      setOpenShortages(shortagesRes.count ?? 0);
      setOpenIssues(issuesRes.count ?? 0);

      const issueMap: Record<string, { title: string; severity: string; status: string }[]> = {};
      (issuesRes.data ?? []).forEach(i => {
        if (i.vehicle_id) (issueMap[i.vehicle_id] ??= []).push({ title: i.title, severity: i.severity, status: i.status });
      });

      // Build a map of vehicle_id -> latest "in" event recorded_at for its current station
      const entryMap: Record<string, string> = {};
      for (const ev of (evRes.data ?? [])) {
        const v = vs.find(v => v.id === ev.vehicle_id);
        if (v && ev.station === v.current_station && !entryMap[ev.vehicle_id]) {
          entryMap[ev.vehicle_id] = ev.recorded_at;
        }
      }

      const wipStations = STATIONS.filter(s => s.code !== "warehouse" && s.code !== "pdi");
      setRows(wipStations.map(s => {
        const stationVehicles = vs.filter(v => v.current_station === s.code);
        return {
          station: s.label,
          count: stationVehicles.length,
          vins: stationVehicles.map(v => ({
            vin: v.vin,
            planned_color_id: v.planned_color_id,
            actual_color_id: v.actual_color_id,
            issues: issueMap[v.id] ?? [],
            entered_at: entryMap[v.id] ?? null,
          })),
        };
      }));
    };
    load();
    const ch = supabase.channel("status-wip")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [getCode]);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard label="Open issues" value={openIssues} tone={openIssues > 0 ? "warning" : "success"} />
        <StatCard label="Open shortages" value={openShortages} tone={openShortages > 0 ? "warning" : "success"} />
        <StatCard label="Stations in production" value={rows.filter(r => r.count > 0).length} />
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExportAll} disabled={rows.length === 0 || rows.every(r => r.count === 0)}>
          <FileSpreadsheet className="h-4 w-4 mr-1" /> Export All WIP
        </Button>
      </div>

      {rows.map(r => (
        <Card key={r.station}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{r.station}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{r.count} vehicle{r.count !== 1 ? "s" : ""}</Badge>
                {r.count > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      const flatRows = r.vins.map(v => ({
                        "Station": r.station,
                        "VIN": v.vin,
                        "Planned Color": getCode(v.planned_color_id),
                        "Actual Color": getCode(v.actual_color_id),
                        "Entered": v.entered_at ?? "",
                        "Duration": v.entered_at ? formatDuration(v.entered_at) : "",
                        "Issues": v.issues.map(i => `${i.title} (${i.severity})`).join("; ") || "",
                      }));
                      exportToCSV(flatRows, `${r.station.toLowerCase().replace(/\s+/g, "-")}-export-${new Date().toISOString().slice(0, 10)}`);
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {r.count === 0 ? (
              <p className="text-xs text-muted-foreground">No vehicles at this station.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VIN</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Entered</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Issues</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.vins.map(v => (
                    <TableRow key={v.vin}>
                      <TableCell className="font-mono text-xs">{v.vin.length > 10 ? `…${v.vin.slice(-8)}` : v.vin}</TableCell>
                      <TableCell className="text-xs">{getCode(v.planned_color_id)}</TableCell>
                      <TableCell className="text-xs">{getCode(v.actual_color_id)}</TableCell>
                      <TableCell className="text-xs">
                        {v.entered_at ? new Date(v.entered_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {v.entered_at ? formatDuration(v.entered_at) : "—"}
                      </TableCell>
                      <TableCell>
                        {v.issues.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {v.issues.map((iss, i) => (
                              <span key={i} className="flex items-center gap-1 text-xs">
                                {iss.status === "open" ? <AlertCircle className="h-3 w-3 text-warning" /> : <AlertCircle className="h-3 w-3 text-info" />}
                                <span>{iss.title}</span>
                                <Badge variant={iss.severity === "critical" ? "destructive" : iss.severity === "high" ? "warning" : "muted"} className="text-[10px] px-1 py-0">{iss.severity}</Badge>
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface DelayedVehicle {
  vehicle_id: string;
  vin: string;
  vin_suffix: string;
  current_station: string;
  entered_at: string;
  working_days_at_station: number;
  lot_code: string | null;
  lot_model: string | null;
  job_order_id: string | null;
}

function DelayedTab() {
  const { getName } = useColors();
  const [threshold, setThreshold] = useState(2);
  const [vehicles, setVehicles] = useState<DelayedVehicle[]>([]);
  const [loading, setLoading] = useState(false);

  // Load global threshold from app_settings
  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", "delay_threshold").single().then(({ data }) => {
      if (data?.value && typeof data.value === "object") {
        setThreshold((data.value as any).days ?? 2);
      }
    });
  }, []);

  const loadDelayed = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_delayed_vehicles", { threshold_days: threshold });
    if (error) {
      console.error("Error loading delayed vehicles:", error);
      setVehicles([]);
    } else {
      setVehicles((data as unknown) as DelayedVehicle[]);
    }
    setLoading(false);
  }, [threshold]);

  useEffect(() => {
    loadDelayed();
    const ch = supabase.channel("status-delayed")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, loadDelayed)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, loadDelayed)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadDelayed]);

  const handleExport = () => {
    const flatRows = vehicles.map(v => ({
      "VIN": v.vin,
      "VIN Suffix": v.vin_suffix,
      "Station": stationByCode(v.current_station as StationCode)?.label ?? v.current_station,
      "Entered At": v.entered_at,
      "Working Days": v.working_days_at_station,
      "Lot Code": v.lot_code ?? "",
      "Model": v.lot_model ?? "",
    }));
    if (flatRows.length > 0) {
      exportToCSV(flatRows, `delayed-vehicles-${new Date().toISOString().slice(0, 10)}`);
    }
  };

  const getRowClass = (days: number) => {
    const overThreshold = days - threshold;
    if (overThreshold >= 3) return "bg-destructive/10";
    if (overThreshold >= 1) return "bg-yellow-500/10";
    return "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Delayed Vehicles</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="threshold" className="text-sm text-muted-foreground">Threshold:</label>
                <Input
                  id="threshold"
                  type="number"
                  min={0}
                  max={30}
                  value={threshold}
                  onChange={e => setThreshold(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-16 h-8"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={vehicles.length === 0}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading delayed vehicles...</p>
          ) : vehicles.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-2" />
              <p className="text-muted-foreground">No delayed vehicles</p>
              <p className="text-xs text-muted-foreground">All vehicles are within the {threshold}-day threshold.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VIN Suffix</TableHead>
                    <TableHead>Station</TableHead>
                    <TableHead>Entered</TableHead>
                    <TableHead>Working Days</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Model</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map(v => (
                    <TableRow key={v.vehicle_id} className={getRowClass(v.working_days_at_station)}>
                      <TableCell className="font-mono text-xs">{v.vin_suffix}</TableCell>
                      <TableCell className="text-xs">
                        {stationByCode(v.current_station as StationCode)?.label ?? v.current_station}
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(v.entered_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        <Badge variant={v.working_days_at_station - threshold >= 3 ? "destructive" : "secondary"}>
                          {v.working_days_at_station} days
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{v.lot_code ?? "—"}</TableCell>
                      <TableCell className="text-xs">{v.lot_model ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LookupTab() {
  const { getCode } = useColors();
  const [suffix, setSuffix] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof findBySuffix>>>([]);
  const [vehicleDetails, setVehicleDetails] = useState<Record<string, { issues: { title: string; severity: string; status: string }[]; events: { station: string; kind: string; recorded_at: string }[] }>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const search = async (s: string) => {
    if (s.trim().length < 3) { setResults([]); return; }
    const data = await findBySuffix(s);
    setResults(data);
  };

  const expand = async (vehicleId: string, vin: string) => {
    if (expanded === vehicleId) { setExpanded(null); return; }
    setExpanded(vehicleId);
    if (vehicleDetails[vehicleId]) return;

    const [issRes, evRes] = await Promise.all([
      supabase.from("issues").select("title, severity, status").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }),
      supabase.from("station_events").select("station, kind, recorded_at").eq("vehicle_id", vehicleId).order("recorded_at", { ascending: false }).limit(20),
    ]);
    setVehicleDetails(prev => ({
      ...prev,
      [vehicleId]: {
        issues: (issRes.data ?? []) as { title: string; severity: string; status: string }[],
        events: (evRes.data ?? []) as { station: string; kind: string; recorded_at: string }[],
      },
    }));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">VIN Lookup</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={suffix}
              onChange={e => { setSuffix(e.target.value); search(e.target.value); }}
              placeholder="Last 4–5 digits of VIN"
              className="font-mono text-lg tracking-widest"
              inputMode="numeric"
            />
          </div>

          {results.length === 0 && suffix.trim().length >= 3 && (
            <p className="text-xs text-muted-foreground">No vehicles found.</p>
          )}

          {results.map(v => (
            <div key={v.id} className="border rounded-md">
              <button
                onClick={() => expand(v.id, v.vin)}
                className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono">{v.vin}</span>
                  <Badge variant={(v as any).is_archived ? "muted" : (v as any).completed_at ? "success" : "secondary"}>{(v as any).is_archived ? "Archived" : (v as any).completed_at ? "Completed" : (v.current_station ?? "—")}</Badge>
                  {v.planned_color_id && <span className="text-xs text-muted-foreground">Plan: {getCode(v.planned_color_id)}</span>}
                  {v.actual_color_id && <span className="text-xs text-muted-foreground">Actual: {getCode(v.actual_color_id)}</span>}
                </div>
                <Search className="h-3 w-3 text-muted-foreground" />
              </button>

              {expanded === v.id && vehicleDetails[v.id] && (
                <div className="border-t px-3 py-2 space-y-2">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Station History</div>
                    <div className="flex flex-wrap gap-1">
                      {vehicleDetails[v.id].events.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No events recorded.</span>
                      ) : (
                        vehicleDetails[v.id].events.map((e, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5">
                            <Badge variant={e.kind === "in" ? "info" : "success"} className="text-[10px] px-1 py-0">{e.kind.toUpperCase()}</Badge>
                            {stationByCode(e.station)?.short ?? e.station}
                            <span className="text-muted-foreground">{new Date(e.recorded_at).toLocaleDateString()}</span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Issues ({vehicleDetails[v.id].issues.length})
                    </div>
                    {vehicleDetails[v.id].issues.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No issues recorded.</span>
                    ) : (
                      <div className="space-y-1">
                        {vehicleDetails[v.id].issues.map((iss, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            {iss.status === "open" || iss.status === "in_progress" ? (
                              <XCircle className="h-3 w-3 text-warning" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 text-success" />
                            )}
                            <span>{iss.title}</span>
                            <Badge variant={iss.severity === "critical" ? "destructive" : iss.severity === "high" ? "warning" : "muted"} className="text-[10px] px-1 py-0">{iss.severity}</Badge>
                            <Badge variant={iss.status === "open" ? "warning" : "success"} className="text-[10px] px-1 py-0">{iss.status}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
