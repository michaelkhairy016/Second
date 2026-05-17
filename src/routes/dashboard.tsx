import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { LayoutDashboard, FileDown, Send, Loader2, AlertTriangle, Clock, CalendarDays, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/export";
import { STATIONS, stationByCode } from "@/lib/stations";
import { useColors } from "@/hooks/use-colors";
import { formatDuration } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { isSuperuser, isStaff, isStatus } = useAuth();
  if (!isSuperuser && !isStaff && !isStatus) return <p className="text-muted-foreground">Access restricted.</p>;

  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Production analytics, WIP, wait times, and reporting.</p>
        </div>
        <div className="flex items-center gap-3">
          <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)} className="w-40" />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="wip">WIP Details</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="waittimes">Wait Times</TabsTrigger>
          <TabsTrigger value="shortage">Shortage Entry</TabsTrigger>
          <TabsTrigger value="reports">PDF Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab date={selectedDate} />
        </TabsContent>
        <TabsContent value="wip" className="mt-4">
          <WIPTab />
        </TabsContent>
        <TabsContent value="movements" className="mt-4">
          <MovementsTab date={selectedDate} />
        </TabsContent>
        <TabsContent value="waittimes" className="mt-4">
          <WaitTimesTab date={selectedDate} />
        </TabsContent>
        <TabsContent value="shortage" className="mt-4">
          <ShortageEntryTab />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsTab date={selectedDate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Overview: Daily In/Out per Model ── */
function OverviewTab({ date }: { date: string }) {
  const [models, setModels] = useState<string[]>([]);
  const [pbsData, setPbsData] = useState<{ model: string; ins: number; outs: number }[]>([]);
  const [wbsData, setWbsData] = useState<{ model: string; ins: number; outs: number }[]>([]);
  const [shortageData, setShortageData] = useState<{ reason: string; count: number }[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const dayStart = new Date(date + "T00:00:00").toISOString();
    const dayEnd = new Date(date + "T23:59:59").toISOString();

    const [evRes, lotsRes, shortRes] = await Promise.all([
      supabase.from("station_events").select("station, kind, vehicle_id, recorded_at")
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd),
      supabase.from("lots").select("id, model"),
      supabase.from("shortages").select("shortage_reason, part_type")
        .gte("created_at", dayStart).lte("created_at", dayEnd),
    ]);

    const events = evRes.data ?? [];
    const lots = lotsRes.data ?? [];
    const lotMap = Object.fromEntries(lots.map(l => [l.id, l.model]));

    // Get vehicle->lot mapping
    const vehicleIds = [...new Set(events.map(e => e.vehicle_id))];
    const { data: vWithLot } = await supabase.from("vehicles").select("id, lot_id").in("id", vehicleIds);
    const vLotMap = Object.fromEntries((vWithLot ?? []).map(v => [v.id, v.lot_id]));

    const getModel = (vehicleId: string) => {
      const lotId = vLotMap[vehicleId];
      return (lotId && lotMap[lotId]) ?? "Unknown";
    };

    // Build model set
    const modelSet = new Set<string>();
    events.forEach(e => modelSet.add(getModel(e.vehicle_id)));
    lots.forEach(l => modelSet.add(l.model));
    const modelList = Array.from(modelSet).sort();
    setModels(modelList);

    // PBS data
    const pbsEvents = events.filter(e => e.station === "pbs");
    const pbsByModel: Record<string, { ins: number; outs: number }> = {};
    modelList.forEach(m => pbsByModel[m] = { ins: 0, outs: 0 });
    pbsEvents.forEach(e => {
      const m = getModel(e.vehicle_id);
      if (pbsByModel[m]) {
        if (e.kind === "in") pbsByModel[m].ins++;
        else pbsByModel[m].outs++;
      }
    });
    setPbsData(modelList.map(m => ({ model: m, ...pbsByModel[m] })));

    // WBS data
    const wbsEvents = events.filter(e => e.station === "wbs" || e.station === "paint");
    const wbsByModel: Record<string, { ins: number; outs: number }> = {};
    modelList.forEach(m => wbsByModel[m] = { ins: 0, outs: 0 });
    wbsEvents.forEach(e => {
      const m = getModel(e.vehicle_id);
      if (wbsByModel[m]) {
        if (e.kind === "in") wbsByModel[m].ins++;
        else wbsByModel[m].outs++;
      }
    });
    setWbsData(modelList.map(m => ({ model: m, ...wbsByModel[m] })));

    // Shortage data
    const reasons: Record<string, number> = {};
    const reasonLabels: Record<string, string> = {
      ckd: "CKD", local: "Local", unavailable_factory: "Unavailable in Factory",
      missing_plastics: "Missing (Plastics)", missing_paint_miscolored: "Missing (Paint/Miscolored)",
      general_missing: "General Missing",
    };
    (shortRes.data ?? []).forEach((s: any) => {
      const reason = s.shortage_reason ?? (s.part_type === "ckd" ? "ckd" : "local");
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    });
    setShortageData(Object.entries(reasons).map(([r, c]) => ({ reason: reasonLabels[r] ?? r, count: c })));

    setTotalIn(events.filter(e => e.kind === "in").length);
    setTotalOut(events.filter(e => e.kind === "out").length);
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading overview...</p>;

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard label="Total IN" value={totalIn} tone={totalIn > 0 ? "success" : undefined} />
        <StatCard label="Total OUT" value={totalOut} tone={totalOut > 0 ? "success" : undefined} />
        <StatCard label="Shortages" value={shortageData.reduce((s, d) => s + d.count, 0)} tone={shortageData.length > 0 ? "warning" : "success"} />
      </div>

      {/* PBS In/Out */}
      <Card>
        <CardHeader><CardTitle className="text-base">PBS — Daily In/Out by Model</CardTitle></CardHeader>
        <CardContent>
          {pbsData.length === 0 ? <p className="text-xs text-muted-foreground">No data.</p> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Model</TableHead><TableHead className="text-right">IN</TableHead><TableHead className="text-right">OUT</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {pbsData.map(r => (
                  <TableRow key={r.model}>
                    <TableCell className="font-medium">{r.model}</TableCell>
                    <TableCell className="text-right">{r.ins}</TableCell>
                    <TableCell className="text-right">{r.outs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* WBS + Paint In/Out */}
      <Card>
        <CardHeader><CardTitle className="text-base">WBS + Paint — Daily In/Out by Model</CardTitle></CardHeader>
        <CardContent>
          {wbsData.length === 0 ? <p className="text-xs text-muted-foreground">No data.</p> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Model</TableHead><TableHead className="text-right">IN</TableHead><TableHead className="text-right">OUT</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {wbsData.map(r => (
                  <TableRow key={r.model}>
                    <TableCell className="font-medium">{r.model}</TableCell>
                    <TableCell className="text-right">{r.ins}</TableCell>
                    <TableCell className="text-right">{r.outs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Shortage breakdown */}
      {shortageData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Shortages by Reason</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Reason</TableHead><TableHead className="text-right">Count</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {shortageData.map(r => (
                  <TableRow key={r.reason}>
                    <TableCell>{r.reason}</TableCell>
                    <TableCell className="text-right font-semibold">{r.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── WIP with VIN Details ── */
function WIPTab() {
  const { getCode } = useColors();
  const [rows, setRows] = useState<{ station: string; count: number; vins: WIPVehicle[] }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  interface WIPVehicle {
    vin: string; vin_suffix: string; model: string;
    planned_color: string; actual_color: string;
    entered_at: string | null; issues: { title: string; severity: string }[];
  }

  useEffect(() => {
    const load = async () => {
      const [vsRes, evRes, issRes, lotsRes] = await Promise.all([
        supabase.from("vehicles").select("id, vin, vin_suffix, current_station, planned_color_id, actual_color_id, lot_id").is("completed_at", null),
        supabase.from("station_events").select("vehicle_id, station, recorded_at").eq("kind", "in").order("recorded_at", { ascending: false }),
        supabase.from("issues").select("vehicle_id, title, severity").in("status", ["open", "in_progress"]),
        supabase.from("lots").select("id, model"),
      ]);

      const vs = vsRes.data ?? [];
      const lots = lotsRes.data ?? [];
      const lotMap = Object.fromEntries(lots.map(l => [l.id, l.model]));

      const entryMap: Record<string, string> = {};
      for (const e of (evRes.data ?? [])) {
        const v = vs.find(v => v.id === e.vehicle_id);
        if (v && e.station === v.current_station && !entryMap[e.vehicle_id]) {
          entryMap[e.vehicle_id] = e.recorded_at;
        }
      }

      const issueMap: Record<string, { title: string; severity: string }[]> = {};
      (issRes.data ?? []).forEach(i => {
        if (i.vehicle_id) (issueMap[i.vehicle_id] ??= []).push({ title: i.title, severity: i.severity });
      });

      const wipOrder = [
        { code: "line_feeding", label: "Line Feeding" },
        { code: "body_shop", label: "Body" },
        { code: "wbs", label: "WBS" },
        { code: "paint", label: "Paint" },
        { code: "pbs", label: "PBS" },
        { code: "tcf", label: "T.C.F" },
        { code: "shortage", label: "Shortage" },
        { code: "waiting_repair", label: "Waiting Repair" },
        { code: "repair", label: "Repair" },
        { code: "cs", label: "C.S" },
        { code: "pdi", label: "PDI" },
      ];

      setRows(wipOrder.map(s => {
        const stationVehicles = vs.filter(v => v.current_station === s.code);
        return {
          station: s.label,
          count: stationVehicles.length,
          vins: stationVehicles.map(v => ({
            vin: v.vin,
            vin_suffix: v.vin_suffix,
            model: (v.lot_id && lotMap[v.lot_id]) ?? "Unknown",
            planned_color: getCode(v.planned_color_id),
            actual_color: getCode(v.actual_color_id),
            entered_at: entryMap[v.id] ?? null,
            issues: issueMap[v.id] ?? [],
          })),
        };
      }));
    };
    load();
    const ch = supabase.channel("dash-wip")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [getCode]);

  const handleExport = () => {
    const flat: Record<string, unknown>[] = [];
    rows.forEach(r => r.vins.forEach(v => flat.push({
      Station: r.station, VIN: v.vin, Model: v.model,
      "Planned Color": v.planned_color, "Actual Color": v.actual_color,
      Entered: v.entered_at ?? "", Duration: v.entered_at ? formatDuration(v.entered_at) : "",
      Issues: v.issues.map(i => `${i.title} (${i.severity})`).join("; ") || "OK",
    })));
    if (flat.length === 0) return;
    exportToCSV(flat, `wip-detail-${new Date().toISOString().slice(0, 10)}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}><FileDown className="h-4 w-4 mr-1" /> Export All</Button>
      </div>
      {rows.map(r => (
        <Card key={r.station}>
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(expanded === r.station ? null : r.station)}>
            <CardTitle className="text-base flex items-center justify-between">
              <span>{r.station}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{r.count}</Badge>
                <span className="text-xs text-muted-foreground">{expanded === r.station ? "▲" : "▼"}</span>
              </div>
            </CardTitle>
          </CardHeader>
          {expanded === r.station && r.count > 0 && (
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>VIN</TableHead><TableHead>Model</TableHead><TableHead>Plan</TableHead>
                      <TableHead>Actual</TableHead><TableHead>Entered</TableHead><TableHead>Duration</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.vins.map(v => (
                      <TableRow key={v.vin}>
                        <TableCell className="font-mono text-xs">{v.vin_suffix}</TableCell>
                        <TableCell className="text-xs">{v.model}</TableCell>
                        <TableCell className="text-xs">{v.planned_color}</TableCell>
                        <TableCell className="text-xs">{v.actual_color}</TableCell>
                        <TableCell className="text-xs">{v.entered_at ? new Date(v.entered_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</TableCell>
                        <TableCell className="text-xs font-medium">{v.entered_at ? formatDuration(v.entered_at) : "—"}</TableCell>
                        <TableCell>
                          {v.issues.length === 0 ? <Badge variant="success" className="text-[10px]">OK</Badge> :
                            v.issues.map((iss, i) => <Badge key={i} variant="warning" className="text-[10px] mr-1">{iss.title}</Badge>)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ── Movements Tab ── */
function MovementsTab({ date }: { date: string }) {
  const [movements, setMovements] = useState<{ time: string; vin: string; vin_suffix: string; station: string; kind: string; model: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const dayStart = new Date(date + "T00:00:00").toISOString();
      const dayEnd = new Date(date + "T23:59:59").toISOString();

      const [evRes, lotsRes] = await Promise.all([
        supabase.from("station_events").select("vehicle_id, station, kind, recorded_at")
          .gte("recorded_at", dayStart).lte("recorded_at", dayEnd).order("recorded_at", { ascending: true }),
        supabase.from("lots").select("id, model"),
      ]);

      const events = evRes.data ?? [];
      const lots = lotsRes.data ?? [];
      const lotMap = Object.fromEntries(lots.map(l => [l.id, l.model]));

      const vehicleIds = [...new Set(events.map(e => e.vehicle_id))];
      const { data: vData } = await supabase.from("vehicles").select("id, vin, vin_suffix, lot_id").in("id", vehicleIds);
      const vMap = Object.fromEntries((vData ?? []).map(v => [v.id, v]));

      setMovements(events.map(e => ({
        time: e.recorded_at,
        vin: vMap[e.vehicle_id]?.vin ?? "—",
        vin_suffix: vMap[e.vehicle_id]?.vin_suffix ?? "—",
        station: stationByCode(e.station as any)?.label ?? e.station,
        kind: e.kind.toUpperCase(),
        model: (() => { const v = vMap[e.vehicle_id]; return v?.lot_id ? (lotMap[v.lot_id] ?? "Unknown") : "Unknown"; })(),
      })));
      setLoading(false);
    };
    load();
  }, [date]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading movements...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Car Movements — {date}</CardTitle>
      </CardHeader>
      <CardContent>
        {movements.length === 0 ? <EmptyState icon={Clock} title="No movements" description="No vehicle movements recorded on this date." /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead><TableHead>VIN</TableHead><TableHead>Model</TableHead><TableHead>Station</TableHead><TableHead>Direction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{new Date(m.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</TableCell>
                    <TableCell className="font-mono text-xs">{m.vin_suffix}</TableCell>
                    <TableCell className="text-xs">{m.model}</TableCell>
                    <TableCell className="text-xs">{m.station}</TableCell>
                    <TableCell><Badge variant={m.kind === "IN" ? "info" : "success"} className="text-[10px]">{m.kind}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Wait Times Tab ── */
function WaitTimesTab({ date }: { date: string }) {
  const [waitData, setWaitData] = useState<{ station: string; avgHours: number; maxHours: number; maxVin: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const dayStart = new Date(date + "T00:00:00").toISOString();
      const dayEnd = new Date(date + "T23:59:59").toISOString();

      // Get OUT events for the day
      const { data: outEvents } = await supabase.from("station_events")
        .select("vehicle_id, station, recorded_at")
        .eq("kind", "out")
        .gte("recorded_at", dayStart).lte("recorded_at", dayEnd);

      if (!outEvents || outEvents.length === 0) { setWaitData([]); setLoading(false); return; }

      const vehicleIds = [...new Set(outEvents.map(e => e.vehicle_id))];

      // Get corresponding IN events
      const { data: inEvents } = await supabase.from("station_events")
        .select("vehicle_id, station, recorded_at")
        .eq("kind", "in")
        .in("vehicle_id", vehicleIds);

      // Get VINs
      const { data: vData } = await supabase.from("vehicles").select("id, vin_suffix").in("id", vehicleIds);
      const vMap = Object.fromEntries((vData ?? []).map(v => [v.id, v.vin_suffix]));

      // Pair IN→OUT by vehicle+station
      const inMap = new Map<string, string>(); // "vehicleId:station" → recorded_at
      (inEvents ?? []).forEach(e => {
        const key = `${e.vehicle_id}:${e.station}`;
        if (!inMap.has(key)) inMap.set(key, e.recorded_at);
      });

      const stationWaits: Record<string, number[]> = {};
      const stationMaxVin: Record<string, { hours: number; vin: string }> = {};

      outEvents.forEach(e => {
        const key = `${e.vehicle_id}:${e.station}`;
        const inTime = inMap.get(key);
        if (!inTime) return;

        const hours = (new Date(e.recorded_at).getTime() - new Date(inTime).getTime()) / (1000 * 60 * 60);
        if (hours < 0 || hours > 720) return; // skip unreasonable values

        if (!stationWaits[e.station]) stationWaits[e.station] = [];
        stationWaits[e.station].push(hours);

        const stLabel = stationByCode(e.station as any)?.label ?? e.station;
        if (!stationMaxVin[stLabel] || hours > stationMaxVin[stLabel].hours) {
          stationMaxVin[stLabel] = { hours, vin: vMap[e.vehicle_id] ?? "—" };
        }
      });

      setWaitData(Object.entries(stationWaits).map(([code, waits]) => {
        const label = stationByCode(code as any)?.label ?? code;
        const avg = waits.reduce((a, b) => a + b, 0) / waits.length;
        const max = Math.max(...waits);
        return { station: label, avgHours: Math.round(avg * 10) / 10, maxHours: Math.round(max * 10) / 10, maxVin: stationMaxVin[label]?.vin ?? "—" };
      }));
      setLoading(false);
    };
    load();
  }, [date]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading wait times...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Station Wait Times — {date}</CardTitle>
      </CardHeader>
      <CardContent>
        {waitData.length === 0 ? <EmptyState icon={Clock} title="No data" description="No completed OUT events on this date to calculate wait times." /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Station</TableHead>
                <TableHead className="text-right">Avg Wait (hrs)</TableHead>
                <TableHead className="text-right">Max Wait (hrs)</TableHead>
                <TableHead>Max Wait VIN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waitData.map(r => (
                <TableRow key={r.station}>
                  <TableCell className="font-medium">{r.station}</TableCell>
                  <TableCell className="text-right">{r.avgHours}</TableCell>
                  <TableCell className="text-right font-semibold text-warning">{r.maxHours}</TableCell>
                  <TableCell className="font-mono text-xs">{r.maxVin}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Shortage Entry Tab (Enhanced) ── */
const SHORTAGE_REASONS = [
  { value: "ckd", label: "CKD" },
  { value: "local", label: "Local" },
  { value: "unavailable_factory", label: "Unavailable in Factory" },
  { value: "missing_plastics", label: "Missing (Plastics Paint Shop)" },
  { value: "missing_paint_miscolored", label: "Missing (Paint Shop — Miscolored)" },
  { value: "general_missing", label: "General Missing" },
];

function ShortageEntryTab() {
  const [suffix, setSuffix] = useState("");
  const [picked, setPicked] = useState<{ id: string; vin: string } | null>(null);
  const [parts, setParts] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("ckd");
  const [receivedBy, setReceivedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [recentShortages, setRecentShortages] = useState<any[]>([]);

  const loadRecent = async () => {
    const { data } = await supabase.from("shortages").select("*, vehicle:vehicles(vin, current_station)").order("created_at", { ascending: false }).limit(20);
    setRecentShortages(data ?? []);
  };
  useEffect(() => { loadRecent(); }, []);

  const lookup = async (s: string) => {
    const trimmed = s.trim().toUpperCase();
    if (trimmed.length < 4) { setPicked(null); return; }
    const { data } = await supabase.from("vehicles")
      .select("id, vin").ilike("vin_suffix", `%${trimmed.slice(-5)}`).limit(5);
    if (data && data.length > 0) setPicked(data[0]);
    else { setPicked(null); toast.warning("No vehicle found"); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return toast.error("Find a VIN first");
    const partList = parts.split(",").map(s => s.trim()).filter(Boolean);
    if (partList.length === 0) return toast.error("List at least one part");
    setBusy(true);
    const user = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from("shortages").insert({
      vehicle_id: picked.id, parts: partList, notes: notes || null,
      created_by: user?.id, part_type: reason === "ckd" ? "ckd" : "local",
      responsibility: "afa", received_by: receivedBy || null,
      shortage_reason: reason,
    });
    await supabase.from("vehicles").update({ current_station: "shortage" }).eq("id", picked.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Shortage logged");
      setSuffix(""); setPicked(null); setParts(""); setNotes(""); setReceivedBy("");
      loadRecent();
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle className="text-base">Log Shortage (Enhanced)</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>VIN suffix</Label>
              <Input value={suffix} onChange={e => { setSuffix(e.target.value); lookup(e.target.value); }} className="font-mono" />
            </div>
            {picked && <div className="rounded-md border bg-muted/40 p-2 font-mono text-sm">{picked.vin}</div>}
            <div className="space-y-1.5">
              <Label>Missing parts (comma-separated)</Label>
              <Input value={parts} onChange={e => setParts(e.target.value)} placeholder="exhaust pipe, rear wiper" />
            </div>
            <div className="space-y-1.5">
              <Label>Shortage Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHORTAGE_REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Received by</Label>
              <Input value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="Name" />
            </div>
            <Button disabled={busy || !picked} type="submit" className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log shortage"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Shortages</CardTitle></CardHeader>
        <CardContent>
          {recentShortages.length === 0 ? <p className="text-xs text-muted-foreground">No shortages.</p> : (
            <ul className="divide-y text-sm">
              {recentShortages.map(s => (
                <li key={s.id} className="py-2 flex items-center justify-between">
                  <div>
                    <span className="font-mono">…{s.vehicle?.vin?.slice(-6)}</span>
                    <span className="text-xs text-muted-foreground ml-2">{(s.parts as string[]).join(", ")}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge variant={s.shortage_reason === "ckd" ? "info" : "secondary"} className="text-[10px]">
                      {SHORTAGE_REASONS.find(r => r.value === s.shortage_reason)?.label ?? s.shortage_reason ?? s.part_type}
                    </Badge>
                    <Badge variant={s.status === "open" ? "warning" : "success"} className="text-[10px]">{s.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── PDF Reports Tab ── */
function ReportsTab({ date }: { date: string }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const downloadReport = async (module: string) => {
    setDownloading(module);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${url}/functions/v1/dashboard-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ date, module }),
      });
      if (!res.ok) throw new Error("Failed to generate report");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${module}-report-${date}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${module.toUpperCase()} report downloaded`);
    } catch (e) {
      toast.error(`Failed to download ${module} report`);
    } finally { setDownloading(null); }
  };

  const sendAll = async () => {
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${url}/functions/v1/send-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ date, modules: ["pbs", "wbs", "shortage"] }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Reports sent via email");
    } catch (e) {
      toast.error("Failed to send reports");
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate PDF Reports — {date}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Button variant="outline" onClick={() => downloadReport("pbs")} disabled={!!downloading}>
              {downloading === "pbs" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              PBS Report
            </Button>
            <Button variant="outline" onClick={() => downloadReport("wbs")} disabled={!!downloading}>
              {downloading === "wbs" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              WBS Report
            </Button>
            <Button variant="outline" onClick={() => downloadReport("shortage")} disabled={!!downloading}>
              {downloading === "shortage" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              Shortage Report
            </Button>
          </div>
          <div className="border-t pt-3">
            <Button onClick={sendAll} disabled={sending} className="w-full">
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send All 3 Reports via Email
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
