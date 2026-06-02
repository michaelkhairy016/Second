import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { LayoutDashboard, Download, Search, Loader2, CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell as RechartsCell, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { STATIONS, stationByCode } from "@/lib/stations";

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

const DEPARTMENTS = ["overview", "shortages", "pbs", "wbs"] as const;
type Dept = typeof DEPARTMENTS[number];

const DEPT_STATION: Record<string, string> = { overview: "", shortages: "shortage", pbs: "pbs", wbs: "wbs" };
const DEPT_LABEL: Record<string, string> = { overview: "Overview", shortages: "Shortages", pbs: "PBS", wbs: "WBS" };

const SHORTAGE_CATEGORIES = ["PLASTICS PART", "Local", "CKD", "Scratches"] as const;
const PBS_CATEGORIES = ["No Issue", "CKD", "Local", "Plastics", "Dismantled"] as const;
const WBS_CATEGORIES = ["Issue", "OK"] as const;

function mapShortageReason(raw: string | null): string {
  if (!raw) return "CKD";
  if (raw === "missing_plastics") return "PLASTICS PART";
  if (raw === "plastics") return "PLASTICS PART";
  if (raw === "local") return "Local";
  if (raw === "ckd") return "CKD";
  if (raw.includes("scratch") || raw === "missing_paint_miscolored") return "Scratches";
  return "Local";
}

function Page() {
  const { isSuperuser, isStaff, isStatus, dashboardAllowed } = useAuth();
  if (!isSuperuser && !isStaff && !isStatus) return <p className="text-muted-foreground p-8">Access restricted.</p>;
  if (!dashboardAllowed) return <p className="text-muted-foreground p-8">Dashboard access disabled for your account.</p>;

  const [selectedDate, setSelectedDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; });
  const [delayThreshold, setDelayThreshold] = useState(24);
  const [activeDept, setActiveDept] = useState<Dept>("shortages");
  const [vinSearch, setVinSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [calOpen, setCalOpen] = useState(false);
  const [live, setLive] = useState(true);
  const [reportBusy, setReportBusy] = useState(false);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [cellDialog, setCellDialog] = useState<{ title: string; rows: { vin: string; model: string; station: string | null; issue: string }[] } | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [shortages, setShortages] = useState<ShortageRow[]>([]);
  const [allOpenShortages, setAllOpenShortages] = useState<ShortageRow[]>([]);
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

  // Search filter: matching vehicle IDs
  const searchVidSet = useMemo(() => {
    if (!vinSearch.trim()) return null;
    const q = vinSearch.toLowerCase();
    const ids = new Set<string>();
    vehicles.forEach(v => {
      if (v.vin.toLowerCase().includes(q)) ids.add(v.id);
    });
    events.forEach(e => {
      const model = vModel.get(e.vehicle_id) ?? "";
      if (model.toLowerCase().includes(q)) ids.add(e.vehicle_id);
    });
    return ids;
  }, [vinSearch, vehicles, vModel, events]);

  const load = async () => {
    setLoading(true);
    const dayStart = `${selectedDate}T00:00:00`;
    const dayEnd = `${selectedDate}T23:59:59`;
    const monthEnd = dayEnd;

    const [evRes, shRes, vRes, lRes, iRes, mEvRes, mShRes, osRes] = await Promise.all([
      supabase.from("station_events").select("station, kind, recorded_at, vehicle_id").gte("recorded_at", dayStart).lte("recorded_at", dayEnd),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at, vehicle:vehicles(vin, vin_suffix)").gte("created_at", dayStart).lte("created_at", dayEnd),
      supabase.from("vehicles").select("id, current_station, lot_id, vin, vin_suffix, updated_at").is("completed_at", null),
      supabase.from("lots").select("id, model"),
      supabase.from("issues").select("id, vehicle_id, status, title").in("status", ["open", "in_progress"]),
      supabase.from("station_events").select("station, kind, recorded_at, vehicle_id").gte("recorded_at", `${monthStart}T00:00:00`).lte("recorded_at", monthEnd),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at, vehicle:vehicles(vin, vin_suffix)").gte("created_at", `${monthStart}T00:00:00`).lte("created_at", monthEnd),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at").eq("status", "open"),
    ]);

    setEvents((evRes.data ?? []) as EventRow[]);
    setShortages((shRes.data ?? []) as unknown as ShortageRow[]);
    setVehicles((vRes.data ?? []) as VehicleRow[]);
    setLots((lRes.data ?? []) as LotRow[]);
    setIssues((iRes.data ?? []) as IssueRow[]);
    setAllOpenShortages((osRes.data ?? []) as unknown as ShortageRow[]);
    setLoading(false);

    (window as any).__monthlyEvents = (mEvRes.data ?? []) as EventRow[];
    (window as any).__monthlyShortages = (mShRes.data ?? []) as unknown as ShortageRow[];
  };

  useEffect(() => { load(); }, [selectedDate]);
  useEffect(() => {
    if (!live) return;
    const ch = supabase.channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "shortages" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, load)
      .subscribe();
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
    const m = new Map<string, string[]>();
    issues.forEach(i => {
      if (!i.vehicle_id) return;
      if (!m.has(i.vehicle_id)) m.set(i.vehicle_id, []);
      m.get(i.vehicle_id)!.push(i.title);
    });
    return m;
  }, [issues]);

  const vehicleShortageCategory = useMemo(() => {
    const m = new Map<string, string>();
    allOpenShortages.forEach(s => { if (s.vehicle_id) m.set(s.vehicle_id, mapShortageReason(s.shortage_reason)); });
    return m;
  }, [allOpenShortages]);

  const classifyPbs = useCallback((vId: string) => {
    const issueList = vehicleIssues.get(vId);
    if (!issueList || issueList.length === 0) return "No Issue";
    const text = issueList.join(" ").toLowerCase();
    if (text.includes("ckd")) return "CKD";
    if (text.includes("plastic") || text.includes("سبيلر")) return "Plastics";
    if (text.includes("dismant") || text.includes("فك") || text.includes("تجميع")) return "Dismantled";
    return "Local";
  }, [vehicleIssues]);

  const classifyWbs = useCallback((vId: string) => vehicleIssues.has(vId) ? "Issue" : "OK", [vehicleIssues]);

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
        else if (activeDept === "pbs") category = classifyPbs(v.id);
        else if (activeDept === "wbs") category = classifyWbs(v.id);
        const issueList = vehicleIssues.get(v.id) ?? [];
        return { vin: v.vin, model, category, hours, issue: issueList.join("; "), vehicleId: v.id };
      })
      .filter(v => v.hours > delayThreshold)
      .filter(v => !searchVidSet || searchVidSet.has(v.vehicleId))
      .sort((a, b) => b.hours - a.hours);
  }, [wipVehicles, events, station, delayThreshold, activeDept, vModel, vehicleIssues, vehicleShortageCategory, searchVidSet, classifyPbs, classifyWbs]);

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
      const classify = classifyPbs;
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
    const classify = classifyWbs;
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
  }, [activeDept, dayEvents, monthDayEvents, wipVehicles, vehicleIssues, vehicleShortageCategory, shortages, classifyPbs, classifyWbs]);

  const modelAnalysis = useMemo(() => {
    const models = new Map<string, { inToday: number; outToday: number; wip: number; vinIds: string[] }>();
    dayEvents.filter(e => e.kind === "in").forEach(e => {
      const m = vModel.get(e.vehicle_id);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0, vinIds: [] }); models.get(m)!.inToday++; models.get(m)!.vinIds.push(e.vehicle_id); }
    });
    dayEvents.filter(e => e.kind === "out").forEach(e => {
      const m = vModel.get(e.vehicle_id);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0, vinIds: [] }); models.get(m)!.outToday++; }
    });
    wipVehicles.forEach(v => {
      const m = vModel.get(v.id);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0, vinIds: [] }); models.get(m)!.wip++; models.get(m)!.vinIds.push(v.id); }
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
      issue: (vehicleIssues.get(e.vehicle_id) ?? []).join("; "),
      shortage: vehicleShortageCategory.get(e.vehicle_id) ?? "",
    }));
    const vinMap = new Map<string, string>();
    vehicles.forEach(v => vinMap.set(v.id, v.vin));
    rows.forEach(r => { r.vin = vinMap.get(r.vehicle_id) ?? "—"; });
    if (vinSearch.trim()) {
      const q = vinSearch.toLowerCase();
      rows = rows.filter(r => r.vin.toLowerCase().includes(q) || r.model.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  }, [dayEvents, vModel, vehicles, vinSearch, vehicleIssues, vehicleShortageCategory]);

  // Build vehicle detail rows for cell dialog
  const buildCellRows = useCallback((category: string, direction: "in" | "out" | "wip"): { vin: string; model: string; station: string | null; issue: string }[] => {
    const vinMap = new Map<string, string>();
    vehicles.forEach(v => vinMap.set(v.id, v.vin));

    if (direction === "wip") {
      return wipVehicles
        .filter(v => {
          let cat = "OK";
          if (activeDept === "shortages") cat = vehicleShortageCategory.get(v.id) ?? "CKD";
          else if (activeDept === "pbs") cat = classifyPbs(v.id);
          else if (activeDept === "wbs") cat = classifyWbs(v.id);
          return cat === category;
        })
        .map(v => ({
          vin: v.vin,
          model: vModel.get(v.id) ?? "—",
          station: v.current_station,
          issue: (vehicleIssues.get(v.id) ?? []).join("; "),
        }));
    }

    const sourceEvents = direction === "in" ? dayEvents.filter(e => e.kind === "in") : dayEvents.filter(e => e.kind === "out");
    return sourceEvents
      .filter(e => {
        if (activeDept === "shortages") return (vehicleShortageCategory.get(e.vehicle_id) ?? "CKD") === category;
        if (activeDept === "pbs") return classifyPbs(e.vehicle_id) === category;
        return classifyWbs(e.vehicle_id) === category;
      })
      .map(e => ({
        vin: vinMap.get(e.vehicle_id) ?? "—",
        model: vModel.get(e.vehicle_id) ?? "—",
        station: null,
        issue: (vehicleIssues.get(e.vehicle_id) ?? []).join("; "),
      }));
  }, [wipVehicles, dayEvents, activeDept, vehicleIssues, vehicleShortageCategory, vModel, vehicles, classifyPbs, classifyWbs]);

  const downloadReport = async () => {
    setReportBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "";
      const supabaseKey = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY || "";
      if (!supabaseUrl) throw new Error("Supabase URL not configured");
      const res = await fetch(`${supabaseUrl}/functions/v1/dashboard-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": supabaseKey,
        },
        body: JSON.stringify({ date: selectedDate, module: activeDept === "shortages" ? "shortage" : activeDept }),
      });
      if (!res.ok) {
        let errMsg = `Server error ${res.status}`;
        try { const t = await res.text(); if (t) errMsg = t; } catch {}
        throw new Error(errMsg);
      }
      const blob = await res.blob();
      if (blob.size < 100) throw new Error("Report too small — generation may have failed");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeDept}-report-${selectedDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Report downloaded");
    } catch (e: any) {
      toast.error(e.message || "Failed to download report");
    } finally {
      setReportBusy(false);
    }
  };

  const { cats, dayMap, monthMap, wipMap } = buildReportTable;

  // Chart data for category distribution
  const chartData = useMemo(() => {
    return cats.map(c => ({ label: c, value: wipMap[c] ?? 0 })).filter(d => d.value > 0);
  }, [cats, wipMap]);

  const chartMaxVal = Math.max(...chartData.map(d => d.value), 1);

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="bg-card p-4 rounded-lg shadow-sm border space-y-3">
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
                onSelect={d => { if (d) { setSelectedDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`); setCalOpen(false); } }}
                disabled={d => d > new Date()}
              />
            </PopoverContent>
          </Popover>
          <Button size="sm" variant={live ? "destructive" : "outline"} onClick={() => setLive(!live)} className="gap-2">
            {live && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-white" /></span>}
            {live ? "Go Live" : "Live Off"}
          </Button>
          <div className="flex-1 min-w-[180px] max-w-md">
            <div className="relative">
              <Input placeholder="Global VIN / Model Search..." value={vinSearch} onChange={e => setVinSearch(e.target.value)} className="pl-9" />
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium">Delay (h):</label>
          <Input type="number" value={delayThreshold} onChange={e => setDelayThreshold(Number(e.target.value) || 24)} className="w-20" />
          <Button size="sm" onClick={downloadReport} disabled={reportBusy} className="gap-2 bg-teal-600 hover:bg-teal-700">
            {reportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download Report
          </Button>
        </div>
      </div>

      {/* Department Tabs */}
      <Tabs value={activeDept} onValueChange={v => { setActiveDept(v as Dept); setExpandedModel(null); }}>
        <TabsList>
          {DEPARTMENTS.map(d => (
            <TabsTrigger key={d} value={d}>{DEPT_LABEL[d]}</TabsTrigger>
          ))}
        </TabsList>

        {DEPARTMENTS.map(d => (
          <TabsContent key={d} value={d} className="space-y-6">
            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : d === "overview" ? (
              <OverviewSection
                events={events} vehicles={vehicles} issues={issues} shortages={shortages} allOpenShortages={allOpenShortages}
                lots={lots} vModel={vModel} selectedDate={selectedDate}
                classifyPbs={classifyPbs} classifyWbs={classifyWbs}
                monthStart={monthStart} vehicleIssues={vehicleIssues} vehicleShortageCategory={vehicleShortageCategory}
              />
            ) : (
              <>
                {/* Stat Boxes */}
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                  <StatBox label="Cars In (Today)" value={d === activeDept ? carsInToday : 0} color="blue" />
                  <StatBox label="Cars Out (Today)" value={d === activeDept ? carsOutToday : 0} color="green" />
                  <StatBox label="Current WIP" value={d === activeDept ? wipVehicles.length : 0} color="amber" />
                  <StatBox label="Avg. Time (Hours)" value={d === activeDept ? avgTimeHours.toFixed(1) : "0"} color="purple" />
                  <StatBox label={d === "shortages" ? "Total Shortage Cars" : "OK"} value={d === activeDept ? (d === "shortages" ? wipVehicles.length : wipVehicles.filter(v => !vehicleIssues.has(v.id)).length) : 0} color={d === "shortages" ? "amber" : "green"} />
                  <StatBox label={d === "shortages" ? "Open Shortages" : "Not OK (Issues)"} value={d === activeDept ? (d === "shortages" ? allOpenShortages.length : wipVehicles.filter(v => vehicleIssues.has(v.id)).length) : 0} color="red" />
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
                            <th className="p-2 font-semibold">Issue</th>
                            <th className="p-2 font-semibold">Time in WIP (Hours)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {delayedWip.map((r, i) => (
                            <tr key={i}>
                              <td className="p-2 font-mono text-xs">{r.vin}</td>
                              <td className="p-2">{r.model}</td>
                              <td className="p-2"><Badge variant="secondary" className="text-[10px]">{r.category}</Badge></td>
                              <td className="p-2 text-xs text-muted-foreground">{r.issue ? <Badge variant="destructive" className="text-[10px]">{r.issue}</Badge> : <Badge variant={activeDept === "shortages" ? "warning" : "success"} className="text-[10px]">{activeDept === "shortages" ? r.category : "OK"}</Badge>}</td>
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
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-3">Today's Report</h3>
                    <ReportTable cats={cats} data={dayMap} onCellClick={(cat, dir) => setCellDialog({ title: `${cat} — ${dir === "in" ? "In Today" : "Out Today"}`, rows: buildCellRows(cat, dir) })} />
                  </div>
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-3">Monthly Report</h3>
                    <ReportTable cats={cats} data={monthMap} onCellClick={() => {}} />
                  </div>
                  <div className="bg-card rounded-lg border p-4 lg:col-span-2 xl:col-span-1">
                    <h3 className="font-bold text-lg text-center mb-3">WIP Summary</h3>
                    <WipTable cats={cats} data={wipMap} onCellClick={(cat) => setCellDialog({ title: `${cat} — WIP`, rows: buildCellRows(cat, "wip") })} />
                  </div>
                </div>

                {/* Charts */}
                {chartData.length > 0 && (
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-4">Category Distribution</h3>
                    <div className="space-y-2 max-w-lg mx-auto">
                      {chartData.map((d, i) => {
                        const colors = ["bg-orange-500", "bg-blue-500", "bg-green-500", "bg-amber-500", "bg-purple-500", "bg-red-500"];
                        const pct = (d.value / chartMaxVal) * 100;
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs w-28 text-right shrink-0">{d.label}</span>
                            <div className="flex-1 bg-muted rounded h-6 overflow-hidden">
                              <div className={`h-full rounded ${colors[i % colors.length]} flex items-center pl-2`} style={{ width: `${Math.max(pct, 8)}%` }}>
                                <span className="text-[10px] font-bold text-white">{d.value}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Model Analysis */}
                {modelAnalysis.length > 0 && (
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-3">Model Analysis</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-center text-sm">
                        <thead>
                          <tr className="bg-muted">
                            <th className="p-2 font-semibold"></th>
                            <th className="p-2 font-semibold">Model</th>
                            <th className="p-2 font-semibold">In (Today)</th>
                            <th className="p-2 font-semibold">Out (Today)</th>
                            <th className="p-2 font-semibold">Current WIP</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {modelAnalysis.map(([model, data]) => (
                            <>
                              <tr key={model} className="hover:bg-muted/50 cursor-pointer" onClick={() => setExpandedModel(expandedModel === model ? null : model)}>
                                <td className="p-2">{expandedModel === model ? <ChevronDown className="h-4 w-4 mx-auto" /> : <ChevronRight className="h-4 w-4 mx-auto" />}</td>
                                <td className="p-2 font-bold">{model}</td>
                                <td className="p-2">{data.inToday}</td>
                                <td className="p-2">{data.outToday}</td>
                                <td className="p-2">{data.wip}</td>
                              </tr>
                              {expandedModel === model && (
                                <tr key={`${model}-detail`}>
                                  <td colSpan={5} className="p-0">
                                    <div className="bg-muted/30 p-3">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-muted-foreground">
                                            <th className="text-left p-1">VIN</th>
                                            <th className="text-left p-1">Station</th>
                                            <th className="text-left p-1">Issue</th>
                                            <th className="text-left p-1">Shortage</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {wipVehicles
                                            .filter(v => vModel.get(v.id) === model)
                                            .slice(0, 20)
                                            .map(v => (
                                              <tr key={v.id}>
                                                <td className="p-1 font-mono">{v.vin}</td>
                                                <td className="p-1">{stationByCode(v.current_station ?? "")?.label ?? "—"}</td>
                                                <td className="p-1">{(vehicleIssues.get(v.id) ?? []).join("; ") || <Badge variant="success" className="text-[10px]">OK</Badge>}</td>
                                                <td className="p-1">{vehicleShortageCategory.get(v.id) ?? "—"}</td>
                                              </tr>
                                            ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Vehicle Tracing */}
                <div className="bg-card rounded-lg border p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold">Vehicle Tracing ({DEPT_LABEL[d]})</h2>
                    <div className="relative w-64">
                      <Input placeholder="Search VIN / model..." value={vinSearch} onChange={e => setVinSearch(e.target.value)} className="pl-9 text-sm" />
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
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
                            <th className="p-2 font-semibold text-left">Issue</th>
                            <th className="p-2 font-semibold text-left">Shortage</th>
                            <th className="p-2 font-semibold">Direction</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {vehicleTracing.map((r, i) => (
                            <tr key={i}>
                              <td className="p-2">{new Date(r.recorded_at).toLocaleTimeString()}</td>
                              <td className="p-2 font-mono text-xs">{r.vin}</td>
                              <td className="p-2">{r.model}</td>
                              <td className="p-2 text-xs">{r.issue ? <Badge variant="destructive" className="text-[10px]">{r.issue}</Badge> : <Badge variant="success" className="text-[10px]">OK</Badge>}</td>
                              <td className="p-2 text-xs">{r.shortage ? <Badge variant="warning" className="text-[10px]">{r.shortage}</Badge> : "—"}</td>
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

      {/* Cell Detail Dialog */}
      <Dialog open={!!cellDialog} onOpenChange={() => setCellDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{cellDialog?.title ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh]">
            {cellDialog && cellDialog.rows.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="bg-muted">
                    <th className="p-2 text-left font-semibold">VIN</th>
                    <th className="p-2 text-left font-semibold">Model</th>
                    <th className="p-2 text-left font-semibold">Station</th>
                    <th className="p-2 text-left font-semibold">Issue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cellDialog.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="p-2 font-mono text-xs">{r.vin}</td>
                      <td className="p-2">{r.model}</td>
                      <td className="p-2">{stationByCode(r.station ?? "")?.label ?? "—"}</td>
                      <td className="p-2 text-xs">{r.issue ? <Badge variant="destructive" className="text-[10px]">{r.issue}</Badge> : <Badge variant="success" className="text-[10px]">OK</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No vehicles found.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CHART_COLORS = ["#d35400", "#27ae60", "#2980b9", "#f39c12", "#8e44ad", "#e74c3c", "#16a085", "#f97316"];

type OverviewProps = {
  events: EventRow[]; vehicles: VehicleRow[]; issues: IssueRow[]; shortages: ShortageRow[];
  allOpenShortages: ShortageRow[]; lots: LotRow[]; vModel: Map<string, string>; selectedDate: string;
  classifyPbs: (vId: string) => string; classifyWbs: (vId: string) => string;
  monthStart: string; vehicleIssues: Map<string, string[]>; vehicleShortageCategory: Map<string, string>;
};

function OverviewSection({ events, vehicles, issues, shortages, allOpenShortages, lots, vModel, selectedDate, classifyPbs, classifyWbs, monthStart, vehicleIssues, vehicleShortageCategory }: OverviewProps) {
  const toLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const today = toLocal(new Date());
  const dayStart = `${selectedDate}T00:00:00`;
  const dayEnd = `${selectedDate}T23:59:59`;

  const stations = ["shortage", "pbs", "wbs"] as const;
  const stationLabels: Record<string, string> = { shortage: "Shortages", pbs: "PBS", wbs: "WBS" };
  const stationColors: Record<string, string> = { shortage: "#d35400", pbs: "#27ae60", wbs: "#2980b9" };

  // Per-station data
  const stationData = useMemo(() => {
    return stations.map(st => {
      const dayEvts = events.filter(e => e.station === st);
      const carsIn = dayEvts.filter(e => e.kind === "in").length;
      const carsOut = dayEvts.filter(e => e.kind === "out").length;
      const wip = vehicles.filter(v => v.current_station === st);
      const okCount = wip.filter(v => !vehicleIssues.has(v.id)).length;
      const notOkCount = wip.filter(v => vehicleIssues.has(v.id)).length;
      return { station: st, label: stationLabels[st], color: stationColors[st], carsIn, carsOut, wip: wip.length, ok: okCount, notOk: notOkCount };
    });
  }, [events, vehicles, vehicleIssues]);

  // Aggregated KPIs
  const totalIn = stationData.reduce((s, d) => s + d.carsIn, 0);
  const totalOut = stationData.reduce((s, d) => s + d.carsOut, 0);
  const totalWip = stationData.reduce((s, d) => s + d.wip, 0);
  const totalOk = stationData.reduce((s, d) => s + d.ok, 0);
  const totalNotOk = stationData.reduce((s, d) => s + d.notOk, 0);
  const openShortages = allOpenShortages.length;
  const openIssues = issues.length;

  // In/Out comparison chart
  const ioChartData = stationData.map(d => ({ station: d.label, "Cars In": d.carsIn, "Cars Out": d.carsOut }));

  // WIP by category per station
  const wipCategoryData = useMemo(() => {
    return stations.map(st => {
      const wip = vehicles.filter(v => v.current_station === st);
      const cats: Record<string, number> = {};
      wip.forEach(v => {
        let cat = "OK";
        if (st === "shortage") cat = vehicleShortageCategory.get(v.id) ?? "CKD";
        else if (st === "pbs") cat = classifyPbs(v.id);
        else cat = classifyWbs(v.id);
        cats[cat] = (cats[cat] ?? 0) + 1;
      });
      return { station: stationLabels[st], ...cats };
    });
  }, [vehicles, vehicleShortageCategory, classifyPbs, classifyWbs]);

  // Shortage donut data
  const shortageDonut = useMemo(() => {
    const counts: Record<string, number> = {};
    allOpenShortages.forEach(s => {
      const cat = mapShortageReason(s.shortage_reason);
      counts[cat] = (counts[cat] ?? 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allOpenShortages]);

  // Model distribution
  const modelData = useMemo(() => {
    const counts: Record<string, number> = {};
    vehicles.forEach(v => {
      const model = vModel.get(v.id) ?? "Unknown";
      counts[model] = (counts[model] ?? 0) + 1;
    });
    return Object.entries(counts).map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [vehicles, vModel]);

  // Per-station report tables (today)
  const stationReports = useMemo(() => {
    return stations.map(st => {
      const dayEvts = events.filter(e => e.station === st);
      const cats = st === "shortage" ? SHORTAGE_CATEGORIES : st === "pbs" ? PBS_CATEGORIES : WBS_CATEGORIES;
      const classify = (vId: string) => {
        if (st === "shortage") return vehicleShortageCategory.get(vId) ?? "CKD";
        if (st === "pbs") return classifyPbs(vId);
        return classifyWbs(vId);
      };
      const dayMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
      cats.forEach(c => { dayMap.In[c] = 0; dayMap.Out[c] = 0; });
      dayEvts.filter(e => e.kind === "in").forEach(e => { const c = classify(e.vehicle_id); dayMap.In[c] = (dayMap.In[c] ?? 0) + 1; });
      dayEvts.filter(e => e.kind === "out").forEach(e => { const c = classify(e.vehicle_id); dayMap.Out[c] = (dayMap.Out[c] ?? 0) + 1; });
      const wipMap: Record<string, number> = {};
      cats.forEach(c => wipMap[c] = 0);
      vehicles.filter(v => v.current_station === st).forEach(v => { const c = classify(v.id); wipMap[c] = (wipMap[c] ?? 0) + 1; });
      return { station: st, label: stationLabels[st], cats, dayMap, wipMap };
    });
  }, [events, vehicles, vehicleShortageCategory, classifyPbs, classifyWbs]);

  // All WIP categories stacked
  const allCats = Array.from(new Set(wipCategoryData.flatMap(d => Object.keys(d).filter(k => k !== "station"))));

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatBox label="Total Cars In" value={totalIn} color="blue" />
        <StatBox label="Total Cars Out" value={totalOut} color="green" />
        <StatBox label="Total WIP" value={totalWip} color="amber" />
        <StatBox label="Avg Time (h)" value="—" color="purple" />
        <StatBox label="OK" value={totalOk} color="green" />
        <StatBox label="Not OK" value={totalNotOk} color="red" />
        <StatBox label="Open Shortages" value={openShortages} color="amber" />
        <StatBox label="Open Issues" value={openIssues} color="red" />
      </div>

      {/* Per-Station Report Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {stationReports.map(sr => (
          <div key={sr.station} className="bg-card rounded-lg border p-4">
            <h3 className="font-bold text-center mb-3" style={{ color: stationColors[sr.station] }}>{sr.label}</h3>
            <h4 className="text-xs font-semibold text-muted-foreground text-center mb-2">Today's Report</h4>
            <ReportTable cats={sr.cats} data={sr.dayMap} onCellClick={() => {}} />
            <h4 className="text-xs font-semibold text-muted-foreground text-center mt-3 mb-2">WIP Summary</h4>
            <WipTable cats={sr.cats} data={sr.wipMap} onCellClick={() => {}} />
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* In/Out by Station */}
        <div className="bg-card rounded-lg border p-4">
          <h3 className="font-bold text-center mb-4">Cars In vs Out by Station</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={ioChartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="station" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Cars In" fill="#2980b9" radius={[4,4,0,0]} />
              <Bar dataKey="Cars Out" fill="#27ae60" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* WIP by Category (Stacked) */}
        <div className="bg-card rounded-lg border p-4">
          <h3 className="font-bold text-center mb-4">WIP Distribution by Category</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={wipCategoryData} layout="vertical" barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="station" tick={{ fontSize: 12 }} width={80} />
              <Tooltip />
              <Legend />
              {allCats.map((cat, i) => (
                <Bar key={cat} dataKey={cat} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Shortage Donut */}
        <div className="bg-card rounded-lg border p-4">
          <h3 className="font-bold text-center mb-4">Shortage Distribution</h3>
          {shortageDonut.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={shortageDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2} label={({ name, value }) => `${name}: ${value}`}>
                  {shortageDonut.map((_, i) => <RechartsCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-muted-foreground py-10">No open shortages</p>
          )}
        </div>

        {/* Model Distribution */}
        <div className="bg-card rounded-lg border p-4">
          <h3 className="font-bold text-center mb-4">WIP by Model (Top 10)</h3>
          {modelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={modelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="model" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" fill="#8e44ad" radius={[0,4,4,0]}>
                  {modelData.map((_, i) => <RechartsCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-muted-foreground py-10">No vehicles in production</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: "blue" | "green" | "amber" | "purple" | "red" }) {
  const cls = color === "blue" ? "text-blue-600" : color === "green" ? "text-green-600" : color === "amber" ? "text-amber-600" : color === "red" ? "text-red-600" : "text-purple-600";
  return (
    <div className="bg-card rounded-lg border p-4 text-center">
      <h4 className="text-xs font-bold uppercase text-muted-foreground">{label}</h4>
      <p className={`text-3xl font-bold mt-1 ${cls}`}>{value}</p>
    </div>
  );
}

function ReportTable({ cats, data, onCellClick }: { cats: readonly string[]; data: Record<string, Record<string, number>>; onCellClick: (cat: string, dir: "in" | "out") => void }) {
  return (
    <table className="w-full text-center text-sm">
      <thead>
        <tr className="bg-muted">
          <th className="p-2 font-semibold">Status</th>
          {cats.map(c => <th key={c} className="p-2 font-semibold text-xs">{c}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y">
        {(["In", "Out"] as const).map(status => (
          <tr key={status}>
            <td className="font-bold p-2">{status}</td>
            {cats.map(c => {
              const val = data[status]?.[c] ?? 0;
              return (
                <td key={c} className="p-2">
                  {val > 0 ? (
                    <button
                      onClick={() => onCellClick(c, status.toLowerCase() as "in" | "out")}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-bold cursor-pointer"
                    >
                      {val}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{val}</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WipTable({ cats, data, onCellClick }: { cats: readonly string[]; data: Record<string, number>; onCellClick: (cat: string) => void }) {
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
          {cats.map(c => {
            const val = data[c] ?? 0;
            return (
              <td key={c} className="p-2">
                {val > 0 ? (
                  <button
                    onClick={() => onCellClick(c)}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-bold cursor-pointer"
                  >
                    {val}
                  </button>
                ) : (
                  <span className="text-muted-foreground">{val}</span>
                )}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}
