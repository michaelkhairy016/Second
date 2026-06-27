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

type EventRow = { station: string; kind: string; recorded_at: string; vehicle_id: string; model?: string | null; vin?: string | null; archived?: boolean };
type ShortageRow = {
  id: string; vehicle_id: string; parts: string[]; shortage_reason: string | null; part_type: string | null;
  status: string; created_at: string; cleared_at?: string | null; vehicle: { vin: string; vin_suffix: string } | null;
};
type VehicleRow = { id: string; current_station: string | null; lot_id: string | null; vin: string; vin_suffix: string; updated_at: string; contract_model: string | null; completed_at: string | null };
type LotRow = { id: string; model: string };
type IssueRow = { id: string; vehicle_id: string | null; status: string; title: string };

const DEPARTMENTS = ["overview", "shortages", "pbs", "wbs", "delayed"] as const;
type Dept = typeof DEPARTMENTS[number];

const DEPT_STATION: Record<string, string> = { overview: "", shortages: "shortage", pbs: "pbs", wbs: "wbs", delayed: "" };
const DEPT_LABEL: Record<string, string> = { overview: "Overview", shortages: "Shortages", pbs: "PBS", wbs: "WBS", delayed: "Delayed" };

const SHORTAGE_CATEGORIES = ["PLASTICS PART", "Local", "CKD", "Scratches"] as const;
const PBS_CATEGORIES = ["No Issue", "CKD", "Local", "Dismantled"] as const;
const WBS_CATEGORIES = ["Issue", "OK"] as const;

function mapShortageCategory(s: { shortage_reason: string | null; part_type?: string | null }): string {
  // part_type is authoritative for CKD cars (e.g. a CKD car with a paint/miscolor issue is still CKD).
  if (s.part_type === "ckd") return "CKD";
  const raw = s.shortage_reason;
  if (raw === "missing_plastics" || raw === "plastics") return "PLASTICS PART";
  if (raw === "local") return "Local";
  if (raw === "ckd") return "CKD";
  if (raw && (raw.includes("scratch") || raw === "missing_paint_miscolored")) return "Scratches";
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
  const [cellDialog, setCellDialog] = useState<{ title: string; rows: { vin: string; model: string; station: string | null; issue: string; category?: string; enteredAt?: string | null }[] } | null>(null);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [shortages, setShortages] = useState<ShortageRow[]>([]);
  const [allOpenShortages, setAllOpenShortages] = useState<ShortageRow[]>([]);
  const [shortagesClearedToday, setShortagesClearedToday] = useState<ShortageRow[]>([]);
  const [allVehicles, setAllVehicles] = useState<VehicleRow[]>([]);
  const [allHistoryEvents, setAllHistoryEvents] = useState<EventRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [workingHoursMap, setWorkingHoursMap] = useState<Map<string, { entered_at: string; working_hours: number; working_days: number }>>(new Map());
  const [monthlyEvents, setMonthlyEvents] = useState<EventRow[]>([]);
  const [monthlyShortages, setMonthlyShortages] = useState<ShortageRow[]>([]);

  const monthStart = selectedDate.slice(0, 8) + "01";
  const isToday = selectedDate === (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
  // Monthly range: full month of the selected date
  const monthEndDate = (() => { const [y, m] = selectedDate.split("-").map(Number); const last = new Date(y, m, 0); return `${y}-${String(m).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}T23:59:59`; })();
  const lotMap = useMemo(() => Object.fromEntries(lots.map(l => [l.id, l.model])), [lots]);
  const vModel = useMemo(() => {
    const m = new Map<string, string>();
    allVehicles.forEach(v => { m.set(v.id, v.contract_model || (v.lot_id && lotMap[v.lot_id]) || "Unknown"); });
    return m;
  }, [allVehicles, lotMap]);
  // WIP = active (non-completed) vehicles. Derived from allVehicles so it is always populated
  // regardless of the selected date — fixes PBS/WBS WIP summary showing empty on any date.
  const vehicles = useMemo(() => allVehicles.filter(v => !v.completed_at), [allVehicles]);

  // Search filter: matching vehicle IDs
  const searchVidSet = useMemo(() => {
    if (!vinSearch.trim()) return null;
    const q = vinSearch.toLowerCase();
    const ids = new Set<string>();
    vehicles.forEach(v => {
      if (v.vin.toLowerCase().includes(q)) ids.add(v.id);
      const model = vModel.get(v.id) ?? "";
      if (model.toLowerCase().includes(q)) ids.add(v.id);
    });
    return ids;
  }, [vinSearch, vehicles, vModel]);

  const load = async () => {
    setLoading(true);
    const dayStart = `${selectedDate}T00:00:00`;
    const dayEnd = `${selectedDate}T23:59:59`;

    const [evRes, shRes, lRes, iRes, mEvRes, mShRes, osRes, clRes, avRes] = await Promise.all([
      // Today's events via unified RPC (carries vin/model/archived — no map dependency, no dashes)
      supabase.rpc("get_production_events", { p_from: dayStart, p_to: dayEnd }),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at, vehicle:vehicles(vin, vin_suffix)").gte("created_at", dayStart).lte("created_at", dayEnd),
      supabase.from("lots").select("id, model"),
      supabase.from("issues").select("id, vehicle_id, status, title").in("status", ["open", "in_progress"]),
      // Monthly events: full month range via unified RPC (includes archived vehicles)
      supabase.rpc("get_production_events", { p_from: `${monthStart}T00:00:00`, p_to: monthEndDate }),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at, cleared_at, vehicle:vehicles(vin, vin_suffix)").gte("created_at", `${monthStart}T00:00:00`).lte("created_at", monthEndDate),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at").eq("status", "open"),
      supabase.from("shortages").select("id, vehicle_id, parts, shortage_reason, part_type, status, created_at, cleared_at, vehicle:vehicles(vin, vin_suffix)").eq("status", "cleared").gte("cleared_at", dayStart).lte("cleared_at", dayEnd),
      // ALL vehicles (incl. completed) — single source for WIP + model resolution
      supabase.from("vehicles").select("id, current_station, lot_id, vin, vin_suffix, updated_at, contract_model, completed_at"),
    ]);

    if (avRes.error) console.error("[dashboard] vehicles query error:", avRes.error);

    setEvents(((evRes.data ?? []) as unknown) as EventRow[]);
    setShortages((shRes.data ?? []) as unknown as ShortageRow[]);
    setAllVehicles((avRes.data ?? []) as VehicleRow[]);
    setLots((lRes.data ?? []) as LotRow[]);
    setIssues((iRes.data ?? []) as IssueRow[]);
    setAllOpenShortages((osRes.data ?? []) as unknown as ShortageRow[]);
    setShortagesClearedToday((clRes.data ?? []) as unknown as ShortageRow[]);

    // Fetch entry times + working hours from calendar RPC for EVERY selected date.
    // (entered_at is always valid historically; working_hours is relative-to-now, which is
    // acceptable/secondary — showing an entry date matters more than precise historical hours.)
    const allStations = ["body_shop", "wbs", "paint", "pbs", "shortage", "repair", "cs", "pdi", "tcf", "tcf_offline"];
    const { data: whData } = await supabase.rpc("get_wip_working_hours", { station_codes: allStations });
    const whMap = new Map<string, { entered_at: string; working_hours: number; working_days: number }>();
    (whData as any[] ?? []).forEach((r: any) => {
      whMap.set(r.vehicle_id, { entered_at: r.entered_at, working_hours: Number(r.working_hours ?? 0) || 0, working_days: Number(r.working_days ?? 0) || 0 });
    });
    setWorkingHoursMap(whMap);
    setMonthlyEvents(((mEvRes.data ?? []) as unknown) as EventRow[]);
    setMonthlyShortages((mShRes.data ?? []) as unknown as ShortageRow[]);

    setLoading(false);
  };

  useEffect(() => { load(); }, [selectedDate]);
  // All-history events for Vehicle Tracing (every movement, every date — not just today).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_production_events", { p_from: "2024-01-01T00:00:00", p_to: "2030-12-31T23:59:59" });
      if (error) { console.error("[dashboard] history events error:", error); return; }
      if (!cancelled) setAllHistoryEvents(((data ?? []) as unknown) as EventRow[]);
    })();
    return () => { cancelled = true; };
  }, []);
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
  const monthEvents = useMemo(() => monthlyEvents, [monthlyEvents]);
  const monthDayEvents = useMemo(() => monthEvents.filter(e => e.station === station), [monthEvents, station]);

  const carsInToday = useMemo(() => activeDept === "shortages" ? shortages.length : dayEvents.filter(e => e.kind === "in").length, [activeDept, shortages, dayEvents]);
  const carsOutToday = useMemo(() => activeDept === "shortages" ? shortagesClearedToday.length : dayEvents.filter(e => e.kind === "out").length, [activeDept, shortagesClearedToday, dayEvents]);
  const carsInMonth = useMemo(() => monthDayEvents.filter(e => e.kind === "in").length, [monthDayEvents]);
  const carsOutMonth = useMemo(() => monthDayEvents.filter(e => e.kind === "out").length, [monthDayEvents]);
  const wipVehicles = useMemo(() => vehicles.filter(v => v.current_station === station), [vehicles, station]);

  const avgTimeHours = useMemo(() => {
    if (wipVehicles.length === 0) return 0;
    const total = wipVehicles.reduce((sum, v) => {
      const wh = workingHoursMap.get(v.id);
      return sum + (wh?.working_hours ?? 0);
    }, 0);
    return total / wipVehicles.length;
  }, [wipVehicles, workingHoursMap]);

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
    allOpenShortages.forEach(s => { if (s.vehicle_id) m.set(s.vehicle_id, mapShortageCategory(s)); });
    return m;
  }, [allOpenShortages]);

  const classifyPbs = useCallback((vId: string) => {
    const issueList = vehicleIssues.get(vId);
    if (!issueList || issueList.length === 0) return "No Issue";
    const text = issueList.join(" ").toLowerCase();
    if (text.includes("ckd")) return "CKD";
    if (text.includes("dismant") || text.includes("فك") || text.includes("تجميع")) return "Dismantled";
    return "Local";
  }, [vehicleIssues]);

  const classifyWbs = useCallback((vId: string) => vehicleIssues.has(vId) ? "Issue" : "OK", [vehicleIssues]);

  // Build a WIP row for a vehicle at a given station
  const buildWipRow = useCallback((v: VehicleRow, station: string) => {
    const wh = workingHoursMap.get(v.id);
    const hours = wh?.working_hours ?? 0;
    const workingDays = wh?.working_days ?? 0;
    const enteredAt = wh?.entered_at ?? null;
    const model = v.contract_model || (v.lot_id && lotMap[v.lot_id]) || "—";
    let category = "OK";
    if (station === "shortage") category = vehicleShortageCategory.get(v.id) ?? "CKD";
    else if (station === "pbs") category = classifyPbs(v.id);
    else if (station === "wbs") category = classifyWbs(v.id);
    let issueText = "";
    if (station === "shortage") {
      const openSh = allOpenShortages.find(s => s.vehicle_id === v.id);
      issueText = openSh
        ? [(openSh.parts || []).join(", "), openSh.shortage_reason].filter(Boolean).join(" — ")
        : "Parts shortage";
    } else {
      issueText = (vehicleIssues.get(v.id) ?? []).join("; ");
    }
    return { vin: v.vin, model, category, hours, workingDays, enteredAt, issue: issueText, vehicleId: v.id, station };
  }, [workingHoursMap, lotMap, vehicleShortageCategory, classifyPbs, classifyWbs, allOpenShortages, vehicleIssues]);

  // Live WIP for current station tab — ALL vehicles, no delay filter
  const liveWip = useMemo(() => {
    return wipVehicles
      .map(v => buildWipRow(v, station))
      .filter(v => !searchVidSet || searchVidSet.has(v.vehicleId))
      .sort((a, b) => b.hours - a.hours);
  }, [wipVehicles, buildWipRow, station, searchVidSet]);

  // Delayed WIP across all 3 stations for Delayed tab
  const delayedWip = useMemo(() => {
    const delayStations = ["shortage", "pbs", "wbs"];
    return vehicles
      .filter(v => delayStations.includes(v.current_station ?? "") && (delayThreshold <= 0 || (() => { const wh = workingHoursMap.get(v.id); return (wh?.working_hours ?? 0) > delayThreshold; })()))
      .filter(v => !searchVidSet || searchVidSet.has(v.id))
      .map(v => buildWipRow(v, v.current_station ?? ""))
      .sort((a, b) => b.hours - a.hours);
  }, [vehicles, workingHoursMap, delayThreshold, buildWipRow, searchVidSet]);

  const buildReportTable = useMemo(() => {
    if (activeDept === "shortages") {
      const cats = SHORTAGE_CATEGORIES;
      const dayMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
      cats.forEach(c => { dayMap.In[c] = 0; dayMap.Out[c] = 0; });
      // In: all shortages created today (regardless of current status)
      shortages.forEach(s => {
        const cat = mapShortageCategory(s);
        dayMap.In[cat] = (dayMap.In[cat] ?? 0) + 1;
      });
      // Out: shortages cleared today (cleared_at within selected date)
      shortagesClearedToday.forEach(s => {
        const cat = mapShortageCategory(s);
        dayMap.Out[cat] = (dayMap.Out[cat] ?? 0) + 1;
      });
      const monthSh = monthlyShortages;
      const monthMap: Record<string, Record<string, number>> = { In: {}, Out: {} };
      cats.forEach(c => { monthMap.In[c] = 0; monthMap.Out[c] = 0; });
      monthSh.forEach(s => {
        const cat = mapShortageCategory(s);
        monthMap.In[cat] = (monthMap.In[cat] ?? 0) + 1;
      });
      monthSh.filter(s => s.status === "cleared").forEach(s => {
        const cat = mapShortageCategory(s);
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
  }, [activeDept, dayEvents, monthDayEvents, wipVehicles, vehicleIssues, vehicleShortageCategory, shortages, shortagesClearedToday, monthlyShortages, classifyPbs, classifyWbs]);

  const modelAnalysis = useMemo(() => {
    const models = new Map<string, { inToday: number; outToday: number; wip: number; vinIds: string[] }>();
    dayEvents.filter(e => e.kind === "in").forEach(e => {
      const m = e.model || vModel.get(e.vehicle_id);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0, vinIds: [] }); models.get(m)!.inToday++; models.get(m)!.vinIds.push(e.vehicle_id); }
    });
    dayEvents.filter(e => e.kind === "out").forEach(e => {
      const m = e.model || vModel.get(e.vehicle_id);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0, vinIds: [] }); models.get(m)!.outToday++; }
    });
    wipVehicles.forEach(v => {
      const m = v.contract_model || (v.lot_id && lotMap[v.lot_id]);
      if (m) { if (!models.has(m)) models.set(m, { inToday: 0, outToday: 0, wip: 0, vinIds: [] }); models.get(m)!.wip++; models.get(m)!.vinIds.push(v.id); }
    });
    return Array.from(models.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dayEvents, wipVehicles, vModel, lotMap]);

  // Per-station model distribution (for chart in station tabs)
  const stationModelChart = useMemo(() => {
    const counts: Record<string, number> = {};
    wipVehicles.forEach(v => {
      const model = vModel.get(v.id) ?? "Unknown";
      counts[model] = (counts[model] ?? 0) + 1;
    });
    return Object.entries(counts).map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [wipVehicles, vModel]);

  const vehicleTracing = useMemo(() => {
    // All-history movements for the current station tab (every date, not just today).
    // Events come from the RPC so vin/model are embedded — no map lookup, no dashes.
    let rows = allHistoryEvents
      .filter(e => e.station === station)
      .map(e => ({
        vin: e.vin || "—",
        model: e.model || "—",
        kind: e.kind,
        recorded_at: e.recorded_at,
        vehicle_id: e.vehicle_id ?? "",
        issue: e.archived ? "" : ((vehicleIssues.get(e.vehicle_id ?? "") ?? []).join("; ")),
        shortage: e.archived ? "" : (vehicleShortageCategory.get(e.vehicle_id ?? "") ?? ""),
      }));
    if (vinSearch.trim()) {
      const q = vinSearch.toLowerCase();
      rows = rows.filter(r => r.vin.toLowerCase().includes(q) || r.model.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  }, [allHistoryEvents, station, vinSearch, vehicleIssues, vehicleShortageCategory]);

  // Latest "in" timestamp per vehicle+station — used to resolve the entry date for OUT rows.
  // (For an out event, the entry is the most recent in at that same station.)
  const stationEntryMap = useMemo(() => {
    const latest = new Map<string, string>();
    allHistoryEvents.forEach(e => {
      if (e.kind !== "in" || !e.vehicle_id) return;
      const key = `${e.vehicle_id}|${e.station}`;
      const prev = latest.get(key);
      if (!prev || new Date(e.recorded_at).getTime() > new Date(prev).getTime()) latest.set(key, e.recorded_at);
    });
    return latest;
  }, [allHistoryEvents]);

  // Build vehicle detail rows for cell dialog
  const buildCellRows = useCallback((category: string, direction: "in" | "out" | "wip", period: "today" | "month" = "today"): { vin: string; model: string; station: string | null; issue: string; enteredAt?: string | null }[] => {
    const vinMap = new Map<string, string>();
    allVehicles.forEach(v => vinMap.set(v.id, v.vin));

    if (direction === "wip") {
      return wipVehicles
        .filter(v => {
          let cat = "OK";
          if (activeDept === "shortages") cat = vehicleShortageCategory.get(v.id) ?? "CKD";
          else if (activeDept === "pbs") cat = classifyPbs(v.id);
          else if (activeDept === "wbs") cat = classifyWbs(v.id);
          return cat === category;
        })
        .map(v => {
          // For shortage: show shortage parts/reason as issue
          let issueText = (vehicleIssues.get(v.id) ?? []).join("; ");
          if (activeDept === "shortages") {
            const openShortage = allOpenShortages.find(s => s.vehicle_id === v.id);
            issueText = openShortage
              ? [(openShortage.parts || []).join(", "), openShortage.shortage_reason].filter(Boolean).join(" — ")
              : "Parts shortage";
          }
          const wh = workingHoursMap.get(v.id);
          return {
            vin: v.vin,
            model: v.contract_model || (v.lot_id && lotMap[v.lot_id]) || "—",
            station: v.current_station,
            issue: issueText,
            category,
            enteredAt: wh?.entered_at ?? null,
          };
        });
    }

    // For shortages tab: use shortages table directly
    if (activeDept === "shortages") {
      let sourceShortages: ShortageRow[];
      if (period === "month") {
        sourceShortages = direction === "in"
          ? monthlyShortages
          : monthlyShortages.filter(s => s.status === "cleared");
      } else {
        sourceShortages = direction === "in"
          ? shortages
          : shortagesClearedToday;
      }
      return sourceShortages
        .filter(s => mapShortageCategory(s) === category)
        .map(s => ({
          vin: s.vehicle?.vin ?? vinMap.get(s.vehicle_id) ?? "—",
          model: vModel.get(s.vehicle_id) || "—",
          station: null,
          issue: (s.parts || []).join(", ") || (s as any).notes || "",
          // In = when shortage was logged (created_at); Out = when cleared (cleared_at)
          enteredAt: direction === "out" ? (s.cleared_at ?? s.created_at) : s.created_at,
        }));
    }

    // For PBS/WBS: use station_events
    const evts = period === "month" ? monthDayEvents : dayEvents;
    const sourceEvents = direction === "in" ? evts.filter(e => e.kind === "in") : evts.filter(e => e.kind === "out");
    return sourceEvents
      .filter(e => {
        if (e.archived) return category === "No Issue" || category === "OK"; // archived rows carry no live issue/category
        if (activeDept === "pbs") return classifyPbs(e.vehicle_id) === category;
        return classifyWbs(e.vehicle_id) === category;
      })
      .map(e => ({
        vin: e.vin || vinMap.get(e.vehicle_id) || "—",
        model: e.model || vModel.get(e.vehicle_id) || "—",
        station: null,
        issue: (vehicleIssues.get(e.vehicle_id) ?? []).join("; "),
        // For an IN row the event timestamp IS the entry. For an OUT row, resolve the
        // matching prior "in" at the same station; fall back to the out timestamp itself.
        enteredAt: direction === "out"
          ? (e.vehicle_id ? (stationEntryMap.get(`${e.vehicle_id}|${e.station}`) ?? e.recorded_at) : e.recorded_at)
          : e.recorded_at,
      }));
  }, [wipVehicles, dayEvents, monthDayEvents, activeDept, vehicleIssues, vehicleShortageCategory, vModel, lotMap, allVehicles, classifyPbs, classifyWbs, shortages, shortagesClearedToday, monthlyShortages, stationEntryMap]);

  const downloadReport = async (period: "day" | "month" = "day") => {
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
        body: JSON.stringify({ date: selectedDate, module: activeDept === "shortages" ? "shortage" : activeDept, period }),
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
      a.download = `${activeDept}-${period === "month" ? "monthly" : "daily"}-report-${selectedDate}.pdf`;
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
          {!isToday && <Badge variant="outline" className="text-amber-600 border-amber-500/50 text-xs">Historical view — In/Out for {selectedDate} + live WIP</Badge>}
          <div className="flex-1 min-w-[180px] max-w-md">
            <div className="relative">
              <Input placeholder="Global VIN / Model Search..." value={vinSearch} onChange={e => setVinSearch(e.target.value)} className="pl-9" />
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" onClick={() => downloadReport("day")} disabled={reportBusy} className="gap-2 bg-teal-600 hover:bg-teal-700">
            {reportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Daily Report
          </Button>
          <Button size="sm" onClick={() => downloadReport("month")} disabled={reportBusy} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            {reportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Monthly Report
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
                events={events} vehicles={vehicles} allVehicles={allVehicles} issues={issues} shortages={shortages} allOpenShortages={allOpenShortages}
                lots={lots} vModel={vModel} selectedDate={selectedDate}
                classifyPbs={classifyPbs} classifyWbs={classifyWbs}
                monthStart={monthStart} vehicleIssues={vehicleIssues} vehicleShortageCategory={vehicleShortageCategory}
                workingHoursMap={workingHoursMap}
              />
            ) : d === "delayed" ? (
              <DelayedSection delayThreshold={delayThreshold} setDelayThreshold={setDelayThreshold} delayedWip={delayedWip} />
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

                {/* Live WIP Table — Always Visible, All Vehicles */}
                <div className="bg-card rounded-lg border p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-foreground">
                      {DEPT_LABEL[d]} — Live WIP ({liveWip.length} cars)
                    </h3>
                  </div>
                  {liveWip.length > 0 ? (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-card">
                          <tr className="bg-muted">
                            <th className="p-2 font-semibold">VIN</th>
                            <th className="p-2 font-semibold">Model</th>
                            <th className="p-2 font-semibold">Category</th>
                            <th className="p-2 font-semibold">Issue / Shortage Details</th>
                            <th className="p-2 font-semibold">Entry Date/Time</th>
                            <th className="p-2 font-semibold">Working Hours</th>
                            <th className="p-2 font-semibold">Working Days</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {liveWip.map((r, i) => (
                            <tr key={i} className={r.hours > 24 ? "bg-red-50 dark:bg-red-950/20" : ""}>
                              <td className="p-2 font-mono text-xs">{r.vin}</td>
                              <td className="p-2">{r.model}</td>
                              <td className="p-2"><Badge variant="secondary" className="text-[10px]">{r.category}</Badge></td>
                              <td className="p-2 text-xs">
                                {r.issue ? <span className="text-foreground">{r.issue}</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="p-2 text-xs text-muted-foreground">{r.enteredAt ? new Date(r.enteredAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Cairo" }) + " " + new Date(r.enteredAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Cairo" }) : "—"}</td>
                              <td className={`p-2 font-bold ${r.hours > 24 ? "text-destructive" : "text-foreground"}`}>{r.hours.toFixed(1)}h</td>
                              <td className="p-2">{r.workingDays}d</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">No vehicles in WIP at this station.</p>
                  )}
                </div>

                {/* Report Tables Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-3">Today's Report</h3>
                    <ReportTable cats={cats} data={dayMap} onCellClick={(cat, dir) => setCellDialog({ title: `${cat} — ${dir === "in" ? "In Today" : "Out Today"}`, rows: buildCellRows(cat, dir, "today") })} />
                  </div>
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-3">Monthly Report</h3>
                    <ReportTable cats={cats} data={monthMap} onCellClick={(cat, dir) => setCellDialog({ title: `${cat} — ${dir === "in" ? "In Month" : "Out Month"}`, rows: buildCellRows(cat, dir, "month") })} />
                  </div>
                  <div className="bg-card rounded-lg border p-4 lg:col-span-2 xl:col-span-1">
                    <h3 className="font-bold text-lg text-center mb-3">WIP Summary</h3>
                    <WipTable cats={cats} data={wipMap} onCellClick={(cat) => setCellDialog({ title: `${cat} — WIP`, rows: buildCellRows(cat, "wip") })} />
                  </div>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* In/Out by Category */}
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-center mb-4">In vs Out by Category (Today)</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={cats.map(c => ({ category: c, "Cars In": dayMap.In[c] ?? 0, "Cars Out": dayMap.Out[c] ?? 0 }))} barGap={4}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="category" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="Cars In" fill="#2980b9" radius={[4,4,0,0]} />
                        <Bar dataKey="Cars Out" fill="#27ae60" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* WIP Donut */}
                  {chartData.length > 0 && (
                    <div className="bg-card rounded-lg border p-4">
                      <h3 className="font-bold text-center mb-4">WIP Category Distribution</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={chartData} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={80} innerRadius={45} paddingAngle={2} label={({ name, value }) => `${name}: ${value}`}>
                            {chartData.map((_, i) => <RechartsCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Horizontal bar fallback */}
                {chartData.length > 0 && (
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-lg text-center mb-4">Category Summary</h3>
                    <div className="space-y-2 max-w-lg mx-auto">
                      {chartData.map((d, i) => {
                        const colors = [
                          "bg-orange-500 dark:bg-gray-500",
                          "bg-blue-500 dark:bg-gray-400",
                          "bg-green-500 dark:bg-gray-600",
                          "bg-amber-500 dark:bg-gray-500",
                          "bg-purple-500 dark:bg-gray-400",
                          "bg-red-500 dark:bg-gray-600",
                        ];
                        const pct = (d.value / chartMaxVal) * 100;
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs w-28 text-right shrink-0">{d.label}</span>
                            <div className="flex-1 bg-muted rounded h-6 overflow-hidden">
                              <div className={`h-full rounded ${colors[i % colors.length]} flex items-center pl-2`} style={{ width: `${Math.max(pct, 8)}%` }}>
                                <span className="text-[10px] font-bold text-white dark:text-gray-100">{d.value}</span>
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
                                                <td className="p-1">{(vehicleIssues.get(v.id) ?? []).join("; ") || (d === "shortages" ? <span className="text-muted-foreground">—</span> : <Badge variant="success" className="text-[10px]">OK</Badge>)}</td>
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

                {/* Station Model Chart */}
                {stationModelChart.length > 0 && (
                  <div className="bg-card rounded-lg border p-4">
                    <h3 className="font-bold text-center mb-4">WIP by Model at {DEPT_LABEL[d]}</h3>
                    <ResponsiveContainer width="100%" height={Math.min(stationModelChart.length * 35 + 40, 300)}>
                      <BarChart data={stationModelChart} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="model" tick={{ fontSize: 10 }} width={90} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[0,4,4,0]}>
                          {stationModelChart.map((_, i) => <RechartsCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
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
                            <th className="p-2 font-semibold text-left">Date / Time</th>
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
                              <td className="p-2 whitespace-nowrap">{new Date(r.recorded_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Cairo" }) + " " + new Date(r.recorded_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Cairo" })}</td>
                              <td className="p-2 font-mono text-xs">{r.vin}</td>
                              <td className="p-2">{r.model}</td>
                              <td className="p-2 text-xs">{r.issue ? <Badge variant="destructive" className="text-[10px]">{r.issue}</Badge> : (d === "shortages" ? <span className="text-muted-foreground">—</span> : <Badge variant="success" className="text-[10px]">OK</Badge>)}</td>
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
        <DialogContent className="max-w-3xl max-h-[80vh]">
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
                    <th className="p-2 text-left font-semibold">Category</th>
                    <th className="p-2 text-left font-semibold">Issue / Details</th>
                    <th className="p-2 text-left font-semibold">Entry Date/Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cellDialog.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="p-2 font-mono text-xs">{r.vin}</td>
                      <td className="p-2">{r.model}</td>
                      <td className="p-2"><Badge variant="secondary" className="text-[10px]">{r.category || (activeDept === "shortages" ? "—" : "OK")}</Badge></td>
                      <td className="p-2 text-xs">{r.issue ? <Badge variant="destructive" className="text-[10px]">{r.issue}</Badge> : (activeDept === "shortages" ? <span className="text-muted-foreground">—</span> : <Badge variant="success" className="text-[10px]">OK</Badge>)}</td>
                      <td className="p-2 text-xs text-muted-foreground">{r.enteredAt ? new Date(r.enteredAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Cairo" }) + " " + new Date(r.enteredAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Cairo" }) : "—"}</td>
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
  events: EventRow[]; vehicles: VehicleRow[]; allVehicles: VehicleRow[]; issues: IssueRow[]; shortages: ShortageRow[];
  allOpenShortages: ShortageRow[]; lots: LotRow[]; vModel: Map<string, string>; selectedDate: string;
  classifyPbs: (vId: string) => string; classifyWbs: (vId: string) => string;
  monthStart: string; vehicleIssues: Map<string, string[]>; vehicleShortageCategory: Map<string, string>;
  workingHoursMap: Map<string, { entered_at: string; working_hours: number; working_days: number }>;
};

function OverviewSection({ events, vehicles, allVehicles, issues, shortages, allOpenShortages, lots, vModel, selectedDate, classifyPbs, classifyWbs, monthStart, vehicleIssues, vehicleShortageCategory, workingHoursMap }: OverviewProps) {
  const [overviewDialog, setOverviewDialog] = useState<{ title: string; rows: { vin: string; model: string; station: string | null; issue: string }[] } | null>(null);
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

  // Average working hours across all dashboard-station vehicles
  const avgWorkingHours = useMemo(() => {
    const dashboardStations = new Set(["shortage", "pbs", "wbs", "tcf", "repair", "cs", "pdi", "waiting_repair", "tcf_offline"]);
    const scopedVehicles = vehicles.filter(v => dashboardStations.has(v.current_station ?? ""));
    if (scopedVehicles.length === 0) return "—";
    const total = scopedVehicles.reduce((sum, v) => {
      const wh = workingHoursMap.get(v.id);
      return sum + (wh?.working_hours ?? 0);
    }, 0);
    return (total / scopedVehicles.length).toFixed(1);
  }, [vehicles, workingHoursMap]);

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
      const cat = mapShortageCategory(s);
      counts[cat] = (counts[cat] ?? 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allOpenShortages]);

  // Model distribution — scoped to dashboard stations only
  const modelData = useMemo(() => {
    const dashboardStations = new Set(["shortage", "pbs", "wbs", "tcf", "repair", "cs", "pdi", "waiting_repair", "tcf_offline"]);
    const counts: Record<string, number> = {};
    vehicles.forEach(v => {
      if (!dashboardStations.has(v.current_station ?? "")) return;
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
        <StatBox label="Avg Time (h)" value={avgWorkingHours} color="purple" />
        <StatBox label="OK" value={totalOk} color="green" />
        <StatBox label="Not OK" value={totalNotOk} color="red" />
        <StatBox label="Open Shortages" value={openShortages} color="amber" />
        <StatBox label="Open Issues" value={openIssues} color="red" />
      </div>

      {/* Per-Station Report Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {stationReports.map(sr => {
          const classify = (vId: string) => {
            if (sr.station === "shortage") return vehicleShortageCategory.get(vId) ?? "CKD";
            if (sr.station === "pbs") return classifyPbs(vId);
            return classifyWbs(vId);
          };
          const buildRows = (cat: string, dir: "in" | "out" | "wip") => {
            const vinMap = new Map<string, string>();
            allVehicles.forEach(v => vinMap.set(v.id, v.vin));
            if (dir === "wip") {
              return vehicles.filter(v => v.current_station === sr.station && classify(v.id) === cat)
                .map(v => ({ vin: v.vin, model: vModel.get(v.id) || "—", station: v.current_station, issue: (vehicleIssues.get(v.id) ?? []).join("; ") }));
            }
            const dayEvts = events.filter(e => e.station === sr.station);
            const evts = dir === "in" ? dayEvts.filter(e => e.kind === "in") : dayEvts.filter(e => e.kind === "out");
            return evts.filter(e => {
                if (e.archived) return cat === "No Issue" || cat === "OK";
                return classify(e.vehicle_id) === cat;
              })
              .map(e => ({ vin: e.vin || (vinMap.get(e.vehicle_id) ?? "—"), model: e.model || vModel.get(e.vehicle_id) || "—", station: null, issue: e.archived ? "" : ((vehicleIssues.get(e.vehicle_id) ?? []).join("; ")) }));
          };
          return (
            <div key={sr.station} className="bg-card rounded-lg border p-4">
              <h3 className="font-bold text-center mb-3" style={{ color: stationColors[sr.station] }}>{sr.label}</h3>
              <h4 className="text-xs font-semibold text-muted-foreground text-center mb-2">Today's Report</h4>
              <ReportTable cats={sr.cats} data={sr.dayMap} onCellClick={(cat, dir) => setOverviewDialog({ title: `${sr.label} — ${cat} — ${dir === "in" ? "In Today" : "Out Today"}`, rows: buildRows(cat, dir) })} />
              <h4 className="text-xs font-semibold text-muted-foreground text-center mt-3 mb-2">WIP Summary</h4>
              <WipTable cats={sr.cats} data={sr.wipMap} onCellClick={(cat) => setOverviewDialog({ title: `${sr.label} — ${cat} — WIP`, rows: buildRows(cat, "wip") })} />
            </div>
          );
        })}
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

      {/* Overview Drilldown Dialog */}
      <Dialog open={!!overviewDialog} onOpenChange={() => setOverviewDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{overviewDialog?.title ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh]">
            {overviewDialog && overviewDialog.rows.length > 0 ? (
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
                  {overviewDialog.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="p-2 font-mono text-xs">{r.vin}</td>
                      <td className="p-2">{r.model}</td>
                      <td className="p-2">{stationByCode(r.station ?? "")?.label ?? "—"}</td>
                      <td className="p-2 text-xs">{r.issue || <span className="text-muted-foreground">—</span>}</td>
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

type DelayedRow = { vin: string; model: string; category: string; hours: number; workingDays: number; enteredAt: string | null; issue: string; vehicleId: string; station: string };
function DelayedSection({ delayThreshold, setDelayThreshold, delayedWip }: { delayThreshold: number; setDelayThreshold: (v: number) => void; delayedWip: DelayedRow[] }) {
  const stationLabels: Record<string, string> = { shortage: "Shortages", pbs: "PBS", wbs: "WBS" };
  const stationColors: Record<string, string> = { shortage: "#d35400", pbs: "#27ae60", wbs: "#2980b9" };
  const delayStations = ["shortage", "pbs", "wbs"] as const;

  const grouped = useMemo(() => {
    const map = new Map<string, DelayedRow[]>();
    delayStations.forEach(st => map.set(st, []));
    delayedWip.forEach(r => {
      const list = map.get(r.station);
      if (list) list.push(r);
    });
    return map;
  }, [delayedWip]);

  const totalDelayed = delayedWip.length;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-card rounded-lg border p-4 flex items-center gap-4 flex-wrap">
        <h3 className="font-bold text-lg text-destructive">Delayed WIP Monitor</h3>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Threshold (hours):</label>
          <Input type="number" value={delayThreshold} onChange={e => setDelayThreshold(Number(e.target.value) || 24)} className="w-24" />
        </div>
        <Badge variant="destructive">{totalDelayed} vehicles delayed &gt; {delayThreshold}h</Badge>
      </div>

      {/* Sub-tables per station */}
      {delayStations.map(st => {
        const rows = grouped.get(st) ?? [];
        return (
          <div key={st} className="bg-card rounded-lg border p-4">
            <h3 className="font-bold text-center mb-3" style={{ color: stationColors[st] }}>
              {stationLabels[st]} — {rows.length} delayed car{rows.length !== 1 ? "s" : ""}
            </h3>
            {rows.length > 0 ? (
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="bg-muted">
                      <th className="p-2 font-semibold">VIN</th>
                      <th className="p-2 font-semibold">Model</th>
                      <th className="p-2 font-semibold">Category</th>
                      <th className="p-2 font-semibold">Issue / Shortage Details</th>
                      <th className="p-2 font-semibold">Entry Date/Time</th>
                      <th className="p-2 font-semibold">Working Hours</th>
                      <th className="p-2 font-semibold">Working Days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r, i) => (
                      <tr key={i} className="bg-red-50 dark:bg-red-950/20">
                        <td className="p-2 font-mono text-xs">{r.vin}</td>
                        <td className="p-2">{r.model}</td>
                        <td className="p-2"><Badge variant="secondary" className="text-[10px]">{r.category}</Badge></td>
                        <td className="p-2 text-xs">{r.issue ? <span className="text-foreground">{r.issue}</span> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="p-2 text-xs text-muted-foreground">{r.enteredAt ? new Date(r.enteredAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Cairo" }) + " " + new Date(r.enteredAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Cairo" }) : "—"}</td>
                        <td className="p-2 font-bold text-destructive">{r.hours.toFixed(1)}h</td>
                        <td className="p-2">{r.workingDays}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">No delayed vehicles at {stationLabels[st]}.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: "blue" | "green" | "amber" | "purple" | "red" }) {
  const cls = color === "blue" ? "text-blue-600 dark:text-gray-300" : color === "green" ? "text-green-600 dark:text-gray-300" : color === "amber" ? "text-amber-600 dark:text-gray-300" : color === "red" ? "text-red-600 dark:text-gray-300" : "text-purple-600 dark:text-gray-300";
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
                      className="text-blue-600 dark:text-gray-300 hover:text-blue-800 dark:hover:text-gray-100 hover:underline font-bold cursor-pointer"
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
