import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import jsPDF from "https://esm.sh/jspdf@2.5.2";
import autotable from "https://esm.sh/jspdf-autotable@3.8.4";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface WipVehicle {
  id: string;
  vin: string;
  vin_suffix: string;
  current_station: string | null;
  actual_color_id: string | null;
  lot_id: string | null;
  lot_model: string;
  entry_time: string | null;
}

const MODULE_CONFIG: Record<string, { title: string; stations: string[]; color: number[] }> = {
  shortage: { title: "Shortages WIP Status Report", stations: ["shortage"], color: [211, 84, 0] },
  pbs: { title: "PBS WIP Status Report", stations: ["pbs", "tcf", "cs", "pdi"], color: [39, 174, 96] },
  wbs: { title: "WBS + Paint WIP Status Report", stations: ["wbs", "paint", "body_shop", "line_feeding"], color: [41, 128, 185] },
};

const REASON_MAP: Record<string, string> = {
  ckd: "CKD",
  local: "Local",
  plastics: "PLASTICS PART",
  missing_plastics: "PLASTICS PART",
  missing_paint_miscolored: "Scratches",
  unavailable_factory: "Scratches",
  general_missing: "Local",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function getCategoryForShortage(s: any): string {
  if (s.shortage_reason && REASON_MAP[s.shortage_reason]) return REASON_MAP[s.shortage_reason];
  return s.part_type === "ckd" ? "CKD" : "Local";
}

// --- Arabic font support ---
let cachedFontBase64: string | null = null;

function hasArabic(text: string): boolean {
  return /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(text);
}

async function loadArabicFont(doc: any): Promise<boolean> {
  if (cachedFontBase64 !== null) {
    if (cachedFontBase64 === "") return false;
    doc.addFileToVFS("Amiri.ttf", cachedFontBase64);
    doc.addFont("Amiri.ttf", "Amiri", "normal");
    return true;
  }
  try {
    const fontRes = await fetch("https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Regular.ttf");
    if (!fontRes.ok) { cachedFontBase64 = ""; return false; }
    const fontBuffer = await fontRes.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(fontBuffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    cachedFontBase64 = btoa(binary);
    doc.addFileToVFS("Amiri.ttf", cachedFontBase64);
    doc.addFont("Amiri.ttf", "Amiri", "normal");
    return true;
  } catch (e) {
    console.error("Font load error:", e);
    cachedFontBase64 = "";
    return false;
  }
}

// Arabic text passthrough — rely on PDF viewer bidi for RTL
// jsPDF can't do OpenType shaping, so letters render disconnected
// but modern viewers (Chrome, Acrobat) handle bidi automatically

// --- End Arabic support ---

function drawBarChart(doc: any, x: number, y: number, w: number, h: number, data: { label: string; value: number; color: number[] }[]) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barHeight = Math.min(12, (h - 10) / data.length);
  const labelWidth = 40;
  const barMaxWidth = w - labelWidth - 15;

  data.forEach((d, i) => {
    const barY = y + i * (barHeight + 3);
    const barW = (d.value / maxVal) * barMaxWidth;

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    doc.text(d.label, x, barY + barHeight / 2 + 1, { baseline: "middle" });

    doc.setFillColor(d.color[0], d.color[1], d.color[2]);
    doc.roundedRect(x + labelWidth, barY + 1, barW, barHeight - 2, 1.5, 1.5, "F");

    doc.setTextColor(50, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.text(String(d.value), x + labelWidth + barW + 2, barY + barHeight / 2 + 1, { baseline: "middle" });
  });
}

function drawPieChart(doc: any, cx: number, cy: number, r: number, data: { label: string; value: number; color: number[] }[]) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return;
  let angle = -Math.PI / 2;

  data.forEach((d) => {
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    doc.setFillColor(d.color[0], d.color[1], d.color[2]);
    // Draw pie slice as filled polygon
    const steps = Math.max(Math.ceil(sliceAngle / 0.05), 4);
    const points: number[][] = [[cx, cy]];
    for (let i = 0; i <= steps; i++) {
      const a = angle + (i / steps) * sliceAngle;
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    // Draw filled polygon using path
    doc.setDrawColor(d.color[0], d.color[1], d.color[2]);
    doc.lines(points.map(([x, y]) => [x - points[0][0], y - points[0][1]]), cx, cy, undefined, true, "F");
    angle += sliceAngle;
  });

  // White center for donut
  doc.setFillColor(255, 255, 255);
  doc.ellipse(cx, cy, r * 0.5, r * 0.5, "F");

  // Center text
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text(String(total), cx, cy + 1, { align: "center", baseline: "middle" });
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("Total", cx, cy + 5, { align: "center", baseline: "middle" });
}

function drawPieLegend(doc: any, x: number, y: number, data: { label: string; value: number; color: number[] }[]) {
  const total = data.reduce((s, d) => s + d.value, 0);
  data.forEach((d, i) => {
    const ly = y + i * 8;
    doc.setFillColor(d.color[0], d.color[1], d.color[2]);
    doc.rect(x, ly, 4, 4, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`${d.label} (${d.value})`, x + 6, ly + 3, { baseline: "middle" });
    if (total > 0) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text(`${((d.value / total) * 100).toFixed(0)}%`, x + 55, ly + 3, { baseline: "middle" });
    }
  });
}

function drawArcSlice(doc: any, cx: number, cy: number, r: number, a1: number, a2: number, color: number[]) {
  doc.setFillColor(color[0], color[1], color[2]);
  doc.setDrawColor(color[0], color[1], color[2]);
  const steps = Math.max(Math.ceil(Math.abs(a2 - a1) / 0.05), 3);
  const points: number[][] = [[cx, cy]];
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (i / steps) * (a2 - a1);
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  doc.lines(points.map(([x, y]) => [x - points[0][0], y - points[0][1]]), cx, cy, undefined, true, "F");
}

function drawGauge(doc: any, cx: number, cy: number, r: number, pct: number, label: string, valueText: string, color: number[]) {
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const totalAngle = endAngle - startAngle;
  const fillAngle = startAngle + totalAngle * Math.min(pct, 1);

  // Background arc segments
  const bgSteps = 12;
  for (let i = 0; i < bgSteps; i++) {
    const a1 = startAngle + (i / bgSteps) * totalAngle;
    const a2 = startAngle + ((i + 1) / bgSteps) * totalAngle;
    drawArcSlice(doc, cx, cy, r, a1, a2, [226, 232, 240]);
  }

  // Filled arc segments
  if (pct > 0) {
    const fillSteps = Math.max(Math.ceil(pct * bgSteps), 2);
    for (let i = 0; i < fillSteps; i++) {
      const a1 = startAngle + (i / fillSteps) * (fillAngle - startAngle);
      const a2 = startAngle + ((i + 1) / fillSteps) * (fillAngle - startAngle);
      drawArcSlice(doc, cx, cy, r, a1, a2, color);
    }
  }

  // White center
  doc.setFillColor(255, 255, 255);
  doc.ellipse(cx, cy, r * 0.6, r * 0.6, "F");

  // Center value
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text(valueText, cx, cy, { align: "center", baseline: "middle" });

  // Label below
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(label, cx, cy + r + 4, { align: "center", baseline: "middle" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  try {
    const { date, module: mod, period }: { date?: string; module?: string; period?: "day" | "month" } = await req.json().catch(() => ({}));
    const reportDate = date ?? new Date().toISOString().slice(0, 10);
    const m = mod ?? "pbs";
    const config = MODULE_CONFIG[m] ?? MODULE_CONFIG.pbs;
    const isMonthly = period === "month";

    const env = Deno.env.toObject() as Env;
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    const dayStart = `${reportDate}T00:00:00`;
    const dayEnd = `${reportDate}T23:59:59`;
    // Monthly range: first day of month to last day of month
    const [ry, rm] = reportDate.split("-").map(Number);
    const lastDay = new Date(ry, rm, 0).getDate();
    const monthStart = `${ry}-${String(rm).padStart(2, "0")}-01T00:00:00`;
    const monthEnd = `${ry}-${String(rm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59`;
    const rangeStart = isMonthly ? monthStart : dayStart;
    const rangeEnd = isMonthly ? monthEnd : dayEnd;
    const rangeLabel = isMonthly
      ? `${reportDate.slice(0, 7)} (Monthly)`
      : reportDate;

    // 1. Fetch WIP vehicles at relevant stations
    const { data: wipData } = await sb
      .from("vehicles")
      .select("id, vin, vin_suffix, current_station, actual_color_id, lot_id, job_order_id, contract_model")
      .in("current_station", config.stations)
      .is("completed_at", null);
    const wipVehicles: WipVehicle[] = (wipData ?? []).map((v: any) => ({ ...v, lot_model: "", entry_time: null }));

    // 2. Lot model map
    const { data: lotsData } = await sb.from("lots").select("id, model");
    const lotMap: Record<string, string> = {};
    (lotsData ?? []).forEach((l: any) => { lotMap[l.id] = l.model; });

    // 2b. Job order → model fallback
    const { data: jolData } = await sb.from("job_order_lots").select("job_order_id, lot_id");
    const joModelMap: Record<string, string> = {};
    (jolData ?? []).forEach((jol: any) => {
      if (!joModelMap[jol.job_order_id] && lotMap[jol.lot_id]) {
        joModelMap[jol.job_order_id] = lotMap[jol.lot_id];
      }
    });

    // 3. Color code map
    const { data: colorsData } = await sb.from("standard_colors").select("id, code");
    const colorMap: Record<string, string> = {};
    (colorsData ?? []).forEach((c: any) => { colorMap[c.id] = c.code; });

    // 4. Assign models to WIP vehicles
    const vehicleIds = wipVehicles.map(v => v.id);
    wipVehicles.forEach((v: any) => {
      if (v.lot_id && lotMap[v.lot_id]) v.lot_model = lotMap[v.lot_id];
      else if (v.job_order_id && joModelMap[v.job_order_id]) v.lot_model = joModelMap[v.job_order_id];
      else if (v.contract_model) v.lot_model = v.contract_model;
    });

    // 5. Entry times
    if (vehicleIds.length > 0) {
      const { data: entryEvents } = await sb
        .from("station_events")
        .select("vehicle_id, recorded_at, station, kind")
        .in("vehicle_id", vehicleIds)
        .eq("kind", "in")
        .order("recorded_at", { ascending: true });
      const entryMap = new Map<string, string>();
      (entryEvents ?? []).forEach((e: any) => {
        if (!entryMap.has(e.vehicle_id)) entryMap.set(e.vehicle_id, e.recorded_at);
      });
      wipVehicles.forEach(v => { v.entry_time = entryMap.get(v.id) ?? null; });
    }

    // 6. Open issues for WIP vehicles
    let issueMap: Record<string, string[]> = {};
    if (vehicleIds.length > 0) {
      const { data: issuesData } = await sb
        .from("issues")
        .select("vehicle_id, title")
        .in("vehicle_id", vehicleIds)
        .in("status", ["open", "in_progress"]);
      (issuesData ?? []).forEach((i: any) => {
        if (!issueMap[i.vehicle_id]) issueMap[i.vehicle_id] = [];
        issueMap[i.vehicle_id].push(i.title);
      });
    }

    // 7. Events for KPI (day or month range) — uses unified RPC so archived
    // vehicles (hard-deleted from vehicles/station_events) are still counted.
    const { data: rpcEvents } = await sb.rpc("get_production_events", { p_from: rangeStart, p_to: rangeEnd });
    const todayEvents = (rpcEvents ?? []) as any[];
    const carsIn = todayEvents.filter((e: any) => e.kind === "in" && config.stations.includes(e.station)).length;
    const carsOut = todayEvents.filter((e: any) => e.kind === "out" && config.stations.includes(e.station)).length;

    // For monthly: build daily breakdown
    const dailyBreakdown: Record<string, { in: number; out: number }> = {};
    if (isMonthly) {
      todayEvents.forEach((e: any) => {
        const day = (typeof e.recorded_at === "string" ? e.recorded_at : new Date(e.recorded_at).toISOString()).slice(0, 10);
        if (!dailyBreakdown[day]) dailyBreakdown[day] = { in: 0, out: 0 };
        if (e.kind === "in") dailyBreakdown[day].in++;
        else dailyBreakdown[day].out++;
      });
    }

    // 8. Delayed WIP
    const now = new Date();
    const delayedWip = wipVehicles.filter(v => {
      if (!v.entry_time) return false;
      const hours = (now.getTime() - new Date(v.entry_time).getTime()) / 3600000;
      return hours > 24;
    }).length;

    // 9. Categorize vehicles
    let categories: { name: string; vehicles: typeof wipVehicles }[] = [];

    if (m === "shortage") {
      const { data: shortagesData } = await sb
        .from("shortages")
        .select("id, vehicle_id, parts, shortage_reason, part_type, notes, status, created_at")
        .eq("status", "open");
      const shortages = shortagesData ?? [];

      const catMap: Record<string, typeof wipVehicles> = {};
      const catOrder = ["PLASTICS PART", "Local", "CKD", "Scratches"];
      catOrder.forEach(c => { catMap[c] = []; });

      // Deduplicate: one shortage per vehicle to prevent double-counting
      const vShortageMap = new Map<string, any>();
      shortages.forEach((s: any) => {
        if (!vShortageMap.has(s.vehicle_id)) vShortageMap.set(s.vehicle_id, s);
      });
      wipVehicles.forEach(v => {
        const s = vShortageMap.get(v.id);
        if (s) {
          const cat = getCategoryForShortage(s);
          (v as any).issue = (s.parts as string[] || []).join(", ") || s.notes || "";
          (v as any).category = cat;
          (v as any).entry_time = s.created_at;
          if (!catMap[cat]) catMap[cat] = [];
          catMap[cat].push(v);
        }
      });
      catOrder.forEach(c => {
        if (catMap[c] && catMap[c].length > 0) categories.push({ name: c, vehicles: catMap[c] });
      });
    } else if (m === "pbs") {
      const catMap: Record<string, typeof wipVehicles> = {};
      const catOrder = ["No Issue", "CKD", "Local", "Plastics", "Dismantled"];
      catOrder.forEach(c => { catMap[c] = []; });

      wipVehicles.forEach(v => {
        const issues = issueMap[v.id] || [];
        let cat = "No Issue";
        if (issues.length === 0) {
          catMap["No Issue"].push(v);
        } else {
          const issueText = issues.join(" ").toLowerCase();
          if (issueText.includes("ckd")) { cat = "CKD"; catMap["CKD"].push(v); }
          else if (issueText.includes("plastic") || issueText.includes("سبيلر")) { cat = "Plastics"; catMap["Plastics"].push(v); }
          else if (issueText.includes("dismant") || issueText.includes("فك") || issueText.includes("تجميع")) { cat = "Dismantled"; catMap["Dismantled"].push(v); }
          else { cat = "Local"; catMap["Local"].push(v); }
        }
        (v as any).issue = issues.join("; ") || "";
        (v as any).category = cat;
      });
      catOrder.forEach(c => {
        if (catMap[c] && catMap[c].length > 0) categories.push({ name: c, vehicles: catMap[c] });
      });
    } else {
      const catMap: Record<string, typeof wipVehicles> = { "Issue": [], "OK": [] };
      wipVehicles.forEach(v => {
        const issues = issueMap[v.id] || [];
        const cat = issues.length > 0 ? "Issue" : "OK";
        catMap[cat].push(v);
        (v as any).issue = issues.join("; ") || "";
        (v as any).category = cat;
      });
      ["Issue", "OK"].forEach(c => {
        if (catMap[c] && catMap[c].length > 0) categories.push({ name: c, vehicles: catMap[c] });
      });
    }

    // === Generate PDF ===
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = 15;

    // Load Arabic font
    const hasArabicFont = await loadArabicFont(doc);

    const needSpace = (mm: number) => {
      if (y + mm > pageHeight - 15) { doc.addPage(); y = 15; }
    };

    // === HEADER ===
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(config.title, 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text("Aboul Fotouh Automotive", 14, y);
    y += 5;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 138);
    doc.text("MPC Department", pageWidth - 14, y - 11, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text("Production Planning Section", pageWidth - 14, y - 6, { align: "right" });
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(14, y, pageWidth - 14, y);
    y += 5;
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const now2 = new Date();
    const ts = now2.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " " + now2.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    doc.text(`Report Generated: ${ts} | Period: ${rangeLabel}`, pageWidth / 2, y, { align: "center" });
    y += 8;

    // === KPI CARDS ===
    const kpis = [
      { label: "Total WIP", value: wipVehicles.length, color: [245, 158, 11] },
      { label: "Delayed WIP", value: delayedWip, color: [239, 68, 68] },
      { label: "Cars In", value: carsIn, color: [59, 130, 246] },
      { label: "Cars Out", value: carsOut, color: [16, 185, 129] },
    ];
    const cardW = (pageWidth - 40) / 4;
    kpis.forEach((kpi, i) => {
      const cx = 14 + i * (cardW + 4);
      doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
      doc.rect(cx, y, 2, 20, "F");
      doc.setFillColor(248, 250, 252);
      doc.rect(cx + 2, y, cardW - 2, 20, "F");
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(71, 85, 105);
      doc.text(kpi.label.toUpperCase(), cx + 6, y + 7);
      doc.setFontSize(18);
      doc.setTextColor(30, 41, 59);
      doc.text(String(kpi.value), cx + 6, y + 16);
    });
    y += 28;

    // === SUMMARY TABLE ===
    needSpace(25);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("WIP Summary by Category", 14, y);
    y += 3;
    const summaryHeaders = ["Category", ...categories.map(c => c.name), "Total"];
    const stockRow = ["Stock", ...categories.map(c => String(c.vehicles.length)), String(wipVehicles.length)];
    (autotable as any)(doc, {
      startY: y,
      head: [summaryHeaders],
      body: [stockRow],
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 3, fontStyle: "bold" },
      headStyles: { fillColor: config.color, textColor: 255 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // === BAR CHART + PIE CHART ===
    needSpace(55);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Category Distribution", 14, y);
    y += 3;
    const chartColors = [
      [211, 84, 0], [59, 130, 246], [16, 185, 129], [245, 158, 11],
      [139, 92, 246], [239, 68, 68], [20, 184, 166], [249, 115, 22],
    ];
    const chartData = categories.map((c, i) => ({
      label: c.name,
      value: c.vehicles.length,
      color: chartColors[i % chartColors.length],
    }));
    // Bar chart on left half
    drawBarChart(doc, 14, y, pageWidth / 2 - 25, 45, chartData);

    // Pie/donut chart on right half
    if (chartData.length > 0) {
      const pieCx = pageWidth / 2 + 30;
      const pieCy = y + 22;
      drawPieChart(doc, pieCx, pieCy, 20, chartData);
      drawPieLegend(doc, pieCx + 30, pieCy - chartData.length * 4, chartData);
    }

    y += Math.max(categories.length * 15 + 5, 45);

    // === KPI GAUGES ===
    needSpace(35);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Performance Gauges", 14, y);
    y += 5;

    const delayPct = wipVehicles.length > 0 ? delayedWip / wipVehicles.length : 0;
    const gaugeY = y + 12;
    const gaugeSpacing = (pageWidth - 28) / 3;
    const gaugeColor = (pct: number) => pct > 0.5 ? [239, 68, 68] : pct > 0.2 ? [245, 158, 11] : [16, 185, 129];

    drawGauge(doc, 14 + gaugeSpacing * 0.5, gaugeY, 14, wipVehicles.length > 0 ? 1 : 0, "WIP Utilization", `${wipVehicles.length}`, [59, 130, 246]);
    drawGauge(doc, 14 + gaugeSpacing * 1.5, gaugeY, 14, delayPct, "Delayed WIP %", `${(delayPct * 100).toFixed(0)}%`, gaugeColor(delayPct));
    const okPct = wipVehicles.length > 0
      ? categories.filter(c => c.name === "No Issue" || c.name === "OK").reduce((s, c) => s + c.vehicles.length, 0) / wipVehicles.length
      : 0;
    drawGauge(doc, 14 + gaugeSpacing * 2.5, gaugeY, 14, okPct, "OK Rate", `${(okPct * 100).toFixed(0)}%`, gaugeColor(1 - okPct));
    y = gaugeY + 22;

    // === DAILY BREAKDOWN (monthly reports only) ===
    if (isMonthly) {
      const days = Object.keys(dailyBreakdown).sort();
      if (days.length > 0) {
        needSpace(30);
        doc.addPage();
        y = 15;
        doc.setFontSize(13);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 58, 138);
        doc.text(`Daily In/Out Breakdown — ${rangeLabel}`, 14, y);
        y += 5;
        const dailyHeaders = ["Date", "Cars In", "Cars Out", "Net"];
        const dailyRows = days.map(d => [
          d,
          String(dailyBreakdown[d].in),
          String(dailyBreakdown[d].out),
          String(dailyBreakdown[d].in - dailyBreakdown[d].out),
        ]);
        // Totals row
        const totalIn = days.reduce((s, d) => s + dailyBreakdown[d].in, 0);
        const totalOut = days.reduce((s, d) => s + dailyBreakdown[d].out, 0);
        dailyRows.push(["TOTAL", String(totalIn), String(totalOut), String(totalIn - totalOut)]);
        (autotable as any)(doc, {
          startY: y,
          head: [dailyHeaders],
          body: dailyRows,
          theme: "grid",
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: config.color, textColor: 255 },
          columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 25 }, 2: { cellWidth: 25 }, 3: { cellWidth: 25 } },
          // Bold the totals row
          didParseCell: (data: any) => {
            if (data.section === "body" && data.row.index === dailyRows.length - 1) {
              data.cell.styles.fontStyle = "bold";
            }
          },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }
    }

    // === MODEL DISTRIBUTION CHART ===
    const modelCounts: Record<string, number> = {};
    wipVehicles.forEach(v => {
      const model = v.lot_model || "Unknown";
      modelCounts[model] = (modelCounts[model] ?? 0) + 1;
    });
    const modelEntries = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (modelEntries.length > 0) {
      needSpace(35);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("WIP by Model", 14, y);
      y += 3;
      const modelChartData = modelEntries.map((e, i) => ({
        label: e[0] || "Unknown",
        value: e[1],
        color: chartColors[i % chartColors.length],
      }));
      drawBarChart(doc, 14, y, pageWidth / 2 - 20, 40, modelChartData);

      // Pie chart for models on right
      if (modelChartData.length > 0) {
        const mpCx = pageWidth / 2 + 30;
        const mpCy = y + 22;
        drawPieChart(doc, mpCx, mpCy, 20, modelChartData);
        drawPieLegend(doc, mpCx + 30, mpCy - modelChartData.length * 4, modelChartData);
      }
      y += Math.max(modelEntries.length * 15 + 5, 40);
    }

    // === DETAILED BREAKDOWN ===
    categories.forEach(cat => {
      needSpace(30);
      doc.addPage();
      y = 15;

      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 58, 138);
      doc.text(`WIP Details: ${cat.name} (${cat.vehicles.length} Cars)`, 14, y);
      y += 5;

      const detailHeaders = ["VIN", "Model", "Color", "Category", "Issue", "Entry Time"];
      const detailRows = cat.vehicles.map(v => [
        v.vin,
        v.lot_model || "—",
        v.actual_color_id ? (colorMap[v.actual_color_id] || "—") : "—",
        (v as any).category || cat.name,
        (v as any).issue || "—",
        formatDateTime(v.entry_time),
      ]);

      (autotable as any)(doc, {
        startY: y,
        head: [detailHeaders],
        body: detailRows,
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
        headStyles: { fillColor: config.color, textColor: 255, fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 25 },
          2: { cellWidth: 15 },
          3: { cellWidth: 22 },
          4: { cellWidth: 98 },
          5: { cellWidth: 38 },
        },
        didParseCell: (data: any) => {
          if (hasArabicFont && data.section === "body" && data.column.index === 4) {
            const cellText = data.cell.raw;
            if (cellText && hasArabic(cellText)) {
              data.cell.styles.font = "Amiri";
            }
          }
        },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    });

    // === FOOTER ===
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(148, 163, 184);
      doc.text(`AFA Shopfloor — ${config.title} — Generated ${ts}`, 14, pageHeight - 7);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: "right" });
      doc.text("Created By Michael Amgad Khairy - Planning Section", pageWidth / 2, pageHeight - 3, { align: "center" });
    }

    const pdfBytes = doc.output("arraybuffer");
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${m}-wip-report-${reportDate}.pdf"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error("Dashboard report error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
