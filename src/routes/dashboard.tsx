import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { LayoutDashboard, Download, Search, Loader2, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { STATIONS } from "@/lib/stations";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

type EventRow = { station: string; kind: string; recorded_at: string; vehicle_id: string };
type ShortageRow = {
  id: string; vehicle_id: string; parts: string[]; shortage_reason: string | null; part_type: string | null;
  status: string; created_at: string; vehicle: { vin: string; vin_suffix: string } | null;
};
type VehicleRow = { id: string; current_station: string | null; lot_id: string | null; vin: string; vin_suffix: string; updated_at: string };
type LotRow = { id: string; model: string };
type IssueRow = { id: string; vehicle_id: string | null; status: string; title: string };

const DEPARTMENTS = ["shortages", "pbs", "wbs"] as const;
type Dept = typeof DEPARTMENTS[number];

const DEPT_STATION: Record<Dept, string> = { shortages: "shortage", pbs: "pbs", wbs: "wbs" };
const DEPT_LABEL: Record<Dept, string> = { shortages: "Shortages", pbs: "PBS", wbs: "WBS" };
const DEPT_TITLE: Record<Dept, string> = {
  shortages: "Shortages Department Analytics",
  pbs: "PBS Department Analytics",
  wbs: "WBS Department Analytics",
};

const SHORTAGE_CATEGORIES = ["PLASTICS PART", "Local", "CKD", "Scratches"] as const;
const PBS_CATEGORIES = ["No Issue", "CKD", "Local", "Plastics", "Dismantled"] as const;
const WBS_CATEGORIES = ["Issue", "OK"] as const;

function mapShortageReason(raw: string | null): string {
  if (!raw) return "CKD";
  if (raw === "missing_plastics") return "PLASTICS PART";
  if (raw === "local") return "Local";
  if (raw === "ckd") return "CKD";
  if (raw.includes("scratch") || raw === "missing_paint_miscolored") return "Scratches";
  return "Local";
}

function Page() {
  const { isSuperuser, isStaff, isStatus } = useAuth();
  if (!isSuperuser && !isStaff && !isStatus) return <p className="text-muted-foreground p-8">Access restricted.</p>;

  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [delayThreshold, setDelayThreshold] = useState(24);
  const [activeDept, setActiveDept] = useState<Dept>("shortages");
  const [vinSearch, setVinSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [calOpen, setCalOpen] = useState(false);
  const [live, setLive] = useState(true);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [shortages, setShortages] = useState<ShortageRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);

  const monthStart = selectedDate.slice(0, 8) + "01";
  const lotMap = useMemo(() => Object.fromEntries(lots.map(l => [l.id, l.model])), [lots]);
  const vModel = useMemo(() => {
    const m = new Map<string, string>();
    vehicles.forEach(v => { if (v.lot_id && lotMap[v.lot_id]) m.set(v.id, lotMap[v.lot_id]); });
    return m;
  }, [vehicles, lotMap]);

  const load = async () => {
    setLoading(true);
    const dayStart = `${selectedDate}T00:00:00`;
    const dayEnd = `${selectedDate}T23:59:59`;
    const monthEnd = dayEnd;

    const [evRes, shRes, vRes, lRes, iRes, mEvRes, mShRes] = await Promise.all([
      supabase.from("station_events").select("station, kind, recorded_at, vehicle_id").gte("recorded_at", dayStart).lte("recorded_at", dayEnd),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at, vehicle:vehicles(vin, vin_suffix)").gte("created_at", dayStart).lte("created_at", dayEnd),
      supabase.from("vehicles").select("id, current_station, lot_id, vin, vin_suffix, updated_at").is("completed_at", null),
      supabase.from("lots").select("id, model"),
      supabase.from("issues").select("id, vehicle_id, status, title").in("status", ["open", "in_progress"]),
      supabase.from("station_events").select("station, kind, recorded_at, vehicle_id").gte("recorded_at", `${monthStart}T00:00:00`).lte("recorded_at", monthEnd),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at, vehicle:vehicles(vin, vin_suffix)").gte("created_at", `${monthStart}T00:00:00`).lte("created_at", monthEnd),
    ]);

    setEvents((evRes.data ?? []) as EventRow[]);
    setShortages((shRes.data ?? []) as unknown as ShortageRow[]);
    setVehicles((vRes.data ?? []) as VehicleRow[]);
    setLots((lRes.data ?? []) as LotRow[]);
    setIssues((iRes.data ?? []) as IssueRow[]);
    setLoading(false);

    // Store monthly data for monthly reports
    (window as any).__monthlyEvents = (mEvRes.data ?? []) as EventRow[];
    (window as any).__monthlyShortages = (mShRes.data ?? []) as unknown as ShortageRow[];
  };

  useEffect(() => { load(); }, [selectedDate]);
  useEffect(() => {
    if (!live) return;
    const ch = supabase.channel("dash").on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [live, selectedDate]);

  const station = DEPT_STATION[activeDept];
  const dayEvents = useMemo(() => events.filter(e => e.station === station), [events, station]);
  const monthEvents = useMemo(() => ((window as any).__monthlyEvents ?? []) as EventRow[], []);
  const monthDayEvents = useMemo(() => monthEvents.filter(e => e.station === station), [monthEvents, station]);

  const carsInToday = useMemo(() => dayEvents.filter(e => e.kind === "in").length, [dayEvents]);
  const carsOutToday = useMemo(() => dayEvents.filter(e => e.kind === "out").length, [dayEvents]);
  const carsInMonth = useMemo(() => monthDayEvents.filter(e => e.kind === "in").length, [monthDayEvents]);
  const carsOutMonth = useMemo(() => monthDayEvents.filter(e => e.kind === "out").length, [monthDayEvents]);
  const wipVehicles = useMemo(() => vehicles.filter(v => v.current_station === station), [vehicles, station]);

  const avgTimeHours = useMemo(() => {
    if (wipVehicles.length === 0) return 0;
    const now = Date.now();
    const inEvents = events.filter(e => e.station === station && e.kind === "in");
    const total = wipVehicles.reduce((sum, v) => {
      const inEv = inEvents.find(e => e.vehicle_id === v.id);
      if (!inEv) return sum;
      return sum + (now - new Date(inEv.recorded_at).getTime()) / 3600000;
    }, 0);
    return total / wipVehicles.length;
  }, [wipVehicles, events, station]);

  const vehicleIssues = useMemo(() => {
    const m = new Map<string, boolean>();
    issues.forEach(i => { if (i.vehicle_id) m.set(i.vehicle_id, true); });
    return m;
  }, [issues]);

  const vehicleShortageCategory = useMemo(() => {
    const m = new Map<string, string>();
    shortages.forEach(s => { if (s.vehicle_id) m.set(s.vehicle_id, mapShortageReason(s.shortage_reason)); });
    return m;
  }, [shortages]);

  const delayedWip = useMemo(() => {
    const inEventsMap = new Map<string, string>();
    events.filter(e => e.station === station && e.kind === "in").forEach(e => inEventsMap.set(e.vehicle_id, e.recorded_at));
    const now = Date.now();
    return wipVehicles
      .map(v => {
        const inAt = inEventsMap.get(v.id) || v.updated_at;
        const hours = (now - new Date(inAt).getTime()) / 3600000;
        const model = vModel.get(v.id) ?? "—";
        let category = "OK";
        if (activeDept === "shortages") category = vehicleShortageCategory.get(v.id) ?? "CKD";
        else if (activeDept === "pbs") category = vehicleIssues.has(v.id) ? "Dismantled" : "No Issue";
        else if (activeDept === "wbs") category = vehicleIssues.has(v.id) ? "Issue" : "OK";
        return { vin: v.vin, model, category, hours };
      })
      .filter(v => v.hours > delayThreshold)
      .sort((a, b) => b.hours - a.hours);
  }, [wipVehicles, events, station, delayThreshold, activeDept, vModel, vehicleIssues, vehicleShortageCategory]);

  const buildReportTable = useMemo(() => {
    if (activeDept === "shortages") {
      const cats = SHORTAGE_CATEGORIES;
      const dayMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
      cats.forEach(c => { dayMap.In[c] = 0; dayMap.Out[c] = 0; });
      shortages.filter(s => s.status === "open").forEach(s => {
        const cat = mapShortageReason(s.shortage_reason);
        dayMap.In[cat] = (dayMap.In[cat] ?? 0) + 1;
      });
      shortages.filter(s => s.status === "cleared").forEach(s => {
        const cat = mapShortageReason(s.shortage_reason);
        dayMap.Out[cat] = (dayMap.Out[cat] ?? 0) + 1;
      });
      const monthSh = ((window as any).__monthlyShortages ?? []) as ShortageRow[];
      const monthMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
      cats.forEach(c => { monthMap.In[c] = 0; monthMap.Out[c] = 0; });
      monthSh.filter(s => s.status === "open").forEach(s => {
        const cat = mapShortageReason(s.shortage_reason);
        monthMap.In[cat] = (monthMap.In[cat] ?? 0) + 1;
      });
      monthSh.filter(s => s.status === "cleared").forEach(s => {
        const cat = mapShortageReason(s.shortage_reason);
        monthMap.Out[cat] = (monthMap.Out[cat] ?? 0) + 1;
      });
      const wipMap: Record<string, number> = {};
      cats.forEach(c => wipMap[c] = 0);
      wipVehicles.forEach(v => {
        const cat = vehicleShortageCategory.get(v.id) ?? "CKD";
        wipMap[cat] = (wipMap[cat] ?? 0) + 1;
      });
      return { cats, dayMap, monthMap, wipMap };
    }
    if (activeDept === "pbs") {
      const cats = PBS_CATEGORIES;
      const classify = (vId: string) => vehicleIssues.has(vId) ? "Dismantled" : "No Issue";
      const dayMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
      cats.forEach(c => { dayMap.In[c] = 0; dayMap.Out[c] = 0; });
      dayEvents.filter(e => e.kind === "in").forEach(e => {
        const c = classify(e.vehicle_id);
        dayMap.In[c] = (dayMap.In[c] ?? 0) + 1;
      });
      dayEvents.filter(e => e.kind === "out").forEach(e => {
        const c = classify(e.vehicle_id);
        dayMap.Out[c] = (dayMap.Out[c] ?? 0) + 1;
      });
      const monthMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
      cats.forEach(c => { monthMap.In[c] = 0; monthMap.Out[c] = 0; });
      monthDayEvents.filter(e => e.kind === "in").forEach(e => {
        const c = classify(e.vehicle_id);
        monthMap.In[c] = (monthMap.In[c] ?? 0) + 1;
      });
      monthDayEvents.filter(e => e.kind === "out").forEach(e => {
        const c = classify(e.vehicle_id);
        monthMap.Out[c] = (monthMap.Out[c] ?? 0) + 1;
      });
      const wipMap: Record<string, number> = {};
      cats.forEach(c => wipMap[c] = 0);
      wipVehicles.forEach(v => {
        const c = classify(v.id);
        wipMap[c] = (wipMap[c] ?? 0) + 1;
      });
      return { cats, dayMap, monthMap, wipMap };
    }
    // WBS
    const cats = WBS_CATEGORIES;
    const classify = (vId: string) => vehicleIssues.has(vId) ? "Issue" : "OK";
    const dayMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
    cats.forEach(c => { dayMap.In[c] = 0; dayMap.Out[c] = 0; });
    dayEvents.filter(e => e.kind === "in").forEach(e => {
      const c = classify(e.vehicle_id);
      dayMap.In[c] = (dayMap.In[c] ?? 0) + 1;
    });
    dayEvents.filter(e => e.kind === "out").forEach(e => {
      const c = classify(e.vehicle_id);
      dayMap.Out[c] = (dayMap.Out[c] ?? 0) + 1;
    });
    const monthMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
    cats.forEach(c => { monthMap.In[c] = 0; monthMap.Out[c] = 0; });
    monthDayEvents.filter(e => e.kind === "in").forEach(e => {
      const c = classify(e.vehicle_id);
      monthMap.In[c] = (monthMap.In[c] ?? 0) + 1;
    });
    monthDayEvents.filter(e => e.kind === "out").forEach(e => {
      const c = classify(e.vehicle_id);
      monthMap.Out[c] = (monthMap.Out[c] ?? 0) + 1;
    });
    const wipMap: Record<string, number> = {};
    cats.forEach(c => wipMap[c] = 0);
    wipVehicles.forEach(v => {
      const c = classify(v.id);
      wipMap[c] = (wipMap[c] ?? 0) + 1;
    });
    return { cats, dayMap, monthMap, wipMap };
  }, [activeDept, dayEvents, monthDayEvents, wipVehicles, vehicleIssues, vehicleShortageCategory, shortages]);

  const modelAnalysis = useMemo(() => {
    const models = new Map<string, { inToday: number; outToday: number; wip: number }>();
    dayEvents.filter(e => e.kind === "in").forEach(e => {
      const m = vModel.get(e.vehicle_id);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0 }); models.get(m)!.inToday++; }
    });
    dayEvents.filter(e => e.kind === "out").forEach(e => {
      const m = vModel.get(e.vehicle_id);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0 }); models.get(m)!.outToday++; }
    });
    wipVehicles.forEach(v => {
      const m = vModel.get(v.id);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0 }); models.get(m)!.wip++; }
    });
    return Array.from(models.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dayEvents, wipVehicles, vModel]);

  const vehicleTracing = useMemo(() => {
    let rows = dayEvents.map(e => ({
      vin: "—",
      model: vModel.get(e.vehicle_id) ?? "—",
      kind: e.kind,
      recorded_at: e.recorded_at,
      vehicle_id: e.vehicle_id,
    }));
    // Resolve VINs
    const vinMap = new Map<string, string>();
    vehicles.forEach(v => vinMap.set(v.id, v.vin));
    rows.forEach(r => { r.vin = vinMap.get(r.vehicle_id) ?? "—"; });
    if (vinSearch.trim()) {
      const q = vinSearch.toLowerCase();
      rows = rows.filter(r => r.vin.toLowerCase().includes(q) || r.model.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  }, [dayEvents, vModel, vehicles, vinSearch]);

  const downloadReport = async () => {
    const projectUrl = (await supabase.functions.invoke("dashboard-report", {
      body: { date: selectedDate, module: activeDept === "shortages" ? "shortage" : activeDept },
    }));
    // @ts-ignore
    if (projectUrl instanceof Blob || (projectUrl as any)?.data) {
      // @ts-ignore
      const blob = projectUrl instanceof Blob ? projectUrl : new Blob([projectUrl.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeDept}-report-${selectedDate}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      toast.error("Failed to generate report");
    }
  };

  const { cats, dayMap, monthMap, wipMap } = buildReportTable;

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="bg-card p-4 rounded-lg shadow-sm border flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium">View Data for:</label>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 w-44 justify-start text-sm font-normal">
                <CalendarDays className="h-4 w-4" />
                {selectedDate}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={new Date(selectedDate + "T00:00:00")}
                onSelect={d => { if (d) { setSelectedDate(d.toISOString().slice(0, 10)); setCalOpen(false); } }}
                disabled={d => d > new Date()}
              />
            </PopoverContent>
          </Popover>
          <Button size="sm" variant={live ? "destructive" : "outline"} onClick={() => setLive(!live)} className="gap-2">
            {live && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-white" /></span>}
            {live ? "Go Live" : "Live Off"}
          </Button>
        </div>
        <div className="flex-grow mx-4 max-w-md">
          <div className="relative">
            <Input placeholder="Global VIN Search..." value={vinSearch} onChange={e => setVinSearch(e.target.value)} className="pl-9" />
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium">Delay Threshold (Hours):</label>
          <Input type="number" value={delayThreshold} onChange={e => setDelayThreshold(Number(e.target.value) || 24)} className="w-20" />
          <Button size="sm" onClick={downloadReport} className="gap-2 bg-teal-600 hover:bg-teal-700">
            <Download className="h-4 w-4" /> Download Report
          </Button>
        </div>
      </div>

      {/* Department Tabs */}
      <Tabs value={activeDept} onValueChange={v => setActiveDept(v as Dept)}>
        <TabsList>
          {DEPARTMENTS.map(d => (
            <TabsTrigger key={d} value={d}>{DEPT_LABEL[d]}</TabsTrigger>
          ))}
        </TabsList>

        {DEPARTMENTS.map(d => (
          <TabsContent key={d} value={d} className="space-y-6">
            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                {/* Stat Boxes */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatBox label="Cars In (Today)" value={d === activeDept ? carsInToday : 0} color="blue" />
                  <StatBox label="Cars Out (Today)" value={d === activeDept ? carsOutToday : 0} color="green" />
                  <StatBox label="Current WIP" value={d === activeDept ? wipVehicles.length : 0} color="amber" />
                  <StatBox label="Avg. Time (Hours)" value={d === activeDept ? avgTimeHours.toFixed(1) : "0"} color="purple" />
                </div>

                {/* Delayed WIP */}
                {delayedWip.length > 0 && (
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-destructive text-center mb-4">
                      Delayed WIP Cars (&gt; {delayThreshold} hours)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="bg-muted">
                            <th className="p-2 font-semibold">VIN</th>
                            <th className="p-2 font-semibold">Model</th>
                            <th className="p-2 font-semibold">Category</th>
                            <th className="p-2 font-semibold">Time in WIP (Hours)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {delayedWip.map((r, i) => (
                            <tr key={i}>
                              <td className="p-2">{r.vin}</td>
                              <td className="p-2">{r.model}</td>
                              <td className="p-2">{r.category}</td>
                              <td className="p-2 font-bold text-destructive">{r.hours.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Report Tables Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  {/* Today's Report */}
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-3">Today's Report</h3>
                    <ReportTable cats={cats} data={dayMap} />
                  </div>
                  {/* Monthly Report */}
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-3">Monthly Report</h3>
                    <ReportTable cats={cats} data={monthMap} />
                  </div>
                  {/* WIP Summary */}
                  <div className="bg-card rounded-lg border p-4 lg:col-span-2 xl:col-span-1">
                    <h3 className="font-bold text-lg text-center mb-3">WIP Summary</h3>
                    <WipTable cats={cats} data={wipMap} />
                  </div>
                </div>

                {/* Model Analysis */}
                {modelAnalysis.length > 0 && (
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-3">Model Analysis</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-center text-sm">
                        <thead>
                          <tr className="bg-muted">
                            <th className="p-2 font-semibold">Model</th>
                            <th className="p-2 font-semibold">In (Today)</th>
                            <th className="p-2 font-semibold">Out (Today)</th>
                            <th className="p-2 font-semibold">Current WIP</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {modelAnalysis.map(([model, data]) => (
                            <tr key={model}>
                              <td className="p-2 font-bold">{model}</td>
                              <td className="p-2">{data.inToday}</td>
                              <td className="p-2">{data.outToday}</td>
                              <td className="p-2">{data.wip}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Vehicle Tracing */}
                <div className="bg-card rounded-lg border p-4">
                  <h2 className="text-xl font-bold mb-4">Vehicle Tracing ({DEPT_LABEL[d]})</h2>
                  {vehicleTracing.length === 0 ? (
                    <EmptyState icon={LayoutDashboard} title="No movements" description={`No vehicle movements at ${DEPT_LABEL[d]} on ${selectedDate}.`} />
                  ) : (
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card">
                          <tr className="bg-muted">
                            <th className="p-2 font-semibold text-left">Time</th>
                            <th className="p-2 font-semibold text-left">VIN</th>
                            <th className="p-2 font-semibold text-left">Model</th>
                            <th className="p-2 font-semibold">Direction</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {vehicleTracing.map((r, i) => (
                            <tr key={i}>
                              <td className="p-2">{new Date(r.recorded_at).toLocaleTimeString()}</td>
                              <td className="p-2 font-mono text-xs">{r.vin}</td>
                              <td className="p-2">{r.model}</td>
                              <td className="p-2 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${r.kind === "in" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                                  {r.kind === "in" ? "IN" : "OUT"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: "blue" | "green" | "amber" | "purple" }) {
  const cls = color === "blue" ? "text-blue-600" : color === "green" ? "text-green-600" : color === "amber" ? "text-amber-600" : "text-purple-600";
  return (
    <div className="bg-card rounded-lg border p-4 text-center">
      <h4 className="text-xs font-bold uppercase text-muted-foreground">{label}</h4>
      <p className={`text-3xl font-bold mt-1 ${cls}`}>{value}</p>
    </div>
  );
}

function ReportTable({ cats, data }: { cats: readonly string[]; data: Record<string, Record<string, number>> }) {
  return (
    <table className="w-full text-center text-sm">
      <thead>
        <tr className="bg-muted">
          <th className="p-2 font-semibold">Status</th>
          {cats.map(c => <th key={c} className="p-2 font-semibold text-xs">{c}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y">
        {["In", "Out"].map(status => (
          <tr key={status}>
            <td className="font-bold p-2">{status}</td>
            {cats.map(c => <td key={c} className="p-2">{data[status]?.[c] ?? 0}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WipTable({ cats, data }: { cats: readonly string[]; data: Record<string, number> }) {
  return (
    <table className="w-full text-center text-sm">
      <thead>
        <tr className="bg-muted">
          <th className="p-2 font-semibold">Status</th>
          {cats.map(c => <th key={c} className="p-2 font-semibold text-xs">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="font-bold p-2">WIP</td>
          {cats.map(c => <td key={c} className="p-2">{data[c] ?? 0}</td>)}
        </tr>
      </tbody>
    </table>
  );
}
