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
  pbs: { title: "PBS WIP Status Report", stations: ["pbs"], color: [39, 174, 96] },
  wbs: { title: "WBS WIP Status Report", stations: ["wbs"], color: [41, 128, 185] },
  colors: { title: "Color Tracking Report", stations: [], color: [139, 92, 246] },
};

const REASON_MAP: Record<string, string> = {
  ckd: "CKD",
  local: "Local",
  plastics: "PLASTICS PART",
  missing_plastics: "PLASTICS PART",
  missing_paint_miscolored: "Scratches",
  unavailable_factory: "Scratches",
  general_missing: "Local",
  damage: "Damage",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  // Deno runs in UTC — force Cairo so PDF Entry Time matches factory clock.
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Cairo" }) +
    ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Africa/Cairo" });
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Cairo" });
}

function getCategoryForShortage(s: any): string {
  // part_type is authoritative for CKD cars (e.g. a CKD car with a paint issue is still CKD).
  if (s.part_type === "ckd") return "CKD";
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
  // Donut = thick stroked arcs, one per slice. Stroked arcs render reliably;
  // filled-wedge polygons (doc.lines style "F") do not in this jsPDF version.
  const ring = Math.max(6, r * 0.4);
  data.forEach((d) => {
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    if (sliceAngle > 0) drawArc(doc, cx, cy, r, angle, angle + sliceAngle, ring, d.color);
    angle += sliceAngle;
  });

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
  // jsPDF.lines(lines, x, y, scale, style, closed) — style must be 'F', closed boolean.
  const arcPts = points.map(([x, y]) => [x - points[0][0], y - points[0][1]]);
  if (arcPts.length >= 2) doc.lines(arcPts, cx, cy, [1, 1], "F", true);
}

// Stroked arc (clean curved line) — used for ring gauges. style 'S' = stroke.
function drawArc(doc: any, cx: number, cy: number, r: number, a1: number, a2: number, lineWidth: number, color: number[]) {
  const steps = Math.max(Math.ceil(Math.abs(a2 - a1) / 0.05), 4);
  const abs: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (i / steps) * (a2 - a1);
    abs.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const shifts: number[][] = abs.slice(1).map((p, i) => [p[0] - abs[i][0], p[1] - abs[i][1]]);
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(lineWidth);
  try { doc.setLineCap("round"); } catch (e) { }
  if (shifts.length >= 1) doc.lines(shifts, abs[0][0], abs[0][1], [1, 1], "S", false);
  try { doc.setLineCap("butt"); } catch (e) { }
}

function drawLineChart(doc: any, x: number, y: number, w: number, h: number, data: { day: string; in: number; out: number }[]) {
  if (data.length === 0) return;
  const maxVal = Math.max(...data.map(d => Math.max(d.in, d.out)), 1);
  const padding = { t: 5, r: 5, b: 15, l: 25 };
  const plotW = w - padding.l - padding.r;
  const plotH = h - padding.t - padding.b;
  const stepX = plotW / (data.length - 1 || 1);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(x + padding.l, y + padding.t, x + padding.l, y + h - padding.b);
  doc.line(x + padding.l, y + h - padding.b, x + w - padding.r, y + h - padding.b);

  doc.setFontSize(6);
  doc.setTextColor(100, 116, 139);
  data.forEach((d, i) => {
    if (i % Math.ceil(data.length / 6) === 0) {
      const dx = x + padding.l + i * stepX;
      doc.text(d.day.slice(5), dx, y + h - padding.b + 3, { align: "center" });
    }
  });

  const yVal = (v: number) => y + h - padding.b - (v / maxVal) * plotH;

  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.8);
  try { doc.setLineCap("round"); } catch (e) { }
  const inPts: number[][] = data.map((d, i) => [x + padding.l + i * stepX, yVal(d.in)]);
  if (inPts.length >= 2) {
    const inShifts = inPts.slice(1).map((p, i) => [p[0] - inPts[i][0], p[1] - inPts[i][1]]);
    doc.lines(inShifts, inPts[0][0], inPts[0][1], [1, 1], "S", false);
  }

  doc.setDrawColor(16, 185, 129);
  const outPts: number[][] = data.map((d, i) => [x + padding.l + i * stepX, yVal(d.out)]);
  if (outPts.length >= 2) {
    const outShifts = outPts.slice(1).map((p, i) => [p[0] - outPts[i][0], p[1] - outPts[i][1]]);
    doc.lines(outShifts, outPts[0][0], outPts[0][1], [1, 1], "S", false);
  }
  try { doc.setLineCap("butt"); } catch (e) { }

  doc.setFontSize(6);
  doc.setTextColor(59, 130, 246);
  doc.text("In", x + w - padding.r - 10, y + padding.t, { align: "right" });
  doc.setTextColor(16, 185, 129);
  doc.text("Out", x + w - padding.r, y + padding.t, { align: "right" });
}

function drawGauge(doc: any, cx: number, cy: number, r: number, pct: number, label: string, valueText: string, color: number[]) {
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const totalAngle = endAngle - startAngle;
  const clampedPct = Math.min(Math.max(pct, 0), 1);
  const fillAngle = startAngle + totalAngle * clampedPct;

  // Background ring (light gray, stroked)
  drawArc(doc, cx, cy, r, startAngle, endAngle, 4, [226, 232, 240]);
  // Value ring (colored, stroked)
  if (clampedPct > 0) drawArc(doc, cx, cy, r, startAngle, fillAngle, 4, color);

  // Center value
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text(valueText, cx, cy, { align: "center", baseline: "middle" });

  // Label below
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(label, cx, cy + r + 5, { align: "center", baseline: "middle" });
}

const COLORS_PALETTE: number[][] = [
  [59, 130, 246], [16, 185, 129], [245, 158, 11], [239, 68, 68],
  [139, 92, 246], [14, 165, 233], [236, 72, 153], [20, 184, 166],
  [249, 115, 22], [99, 102, 241], [132, 204, 22], [168, 85, 247],
];
const POST_PAINT_STATIONS = ["paint", "pbs", "tcf", "waiting_repair", "repair", "cs", "pdi", "shortage"];

async function buildColorsReport(opts: {
  sb: any; reportDate: string; isMonthly: boolean;
  dayStart: string; dayEnd: string; monthStart: string; monthEnd: string;
  lotMap: Record<string, string>; joModelMap: Record<string, string>;
  colorMap: Record<string, string>; colorNameMap: Record<string, string>;
  rangeLabel: string;
}): Promise<Response> {
  const { sb, reportDate, isMonthly, dayStart, dayEnd, monthStart, monthEnd, lotMap, joModelMap, colorMap, colorNameMap, rangeLabel } = opts;

  const [vRes, jRes, todayRes, monthRes] = await Promise.all([
    sb.from("vehicles").select("id, vin, vin_suffix, contract_model, lot_id, job_order_id, actual_color_id, planned_color_id, current_station, completed_at"),
    sb.from("job_orders").select("id, job_code, color_plan, units, status"),
    sb.from("station_events").select("vehicle_id, color_used_id, recorded_at").eq("station", "paint").not("color_used_id", "is", null).gte("recorded_at", dayStart).lte("recorded_at", dayEnd).order("recorded_at", { ascending: false }),
    sb.from("station_events").select("color_used_id").eq("station", "paint").not("color_used_id", "is", null).gte("recorded_at", monthStart).lte("recorded_at", monthEnd),
  ]);

  const vehicles: any[] = vRes.data ?? [];
  const jobs: any[] = jRes.data ?? [];
  const todayEvents: any[] = todayRes.data ?? [];
  const monthEvents: any[] = monthRes.data ?? [];

  const modelOf = (v: any): string => v.contract_model || (v.lot_id && lotMap[v.lot_id]) || (v.job_order_id && joModelMap[v.job_order_id]) || "Unknown";
  const vehById: Record<string, any> = {};
  vehicles.forEach((v: any) => { vehById[v.id] = v; });

  const totalPainted = vehicles.filter((v: any) => v.actual_color_id).length;
  const activeColors = new Set(vehicles.filter((v: any) => v.actual_color_id).map((v: any) => v.actual_color_id)).size;
  const backlog = vehicles.filter((v: any) => !v.actual_color_id && POST_PAINT_STATIONS.includes(v.current_station ?? "")).length;

  // Monthly color distribution
  const monthCounts: Record<string, number> = {};
  monthEvents.forEach((e: any) => { if (e.color_used_id) monthCounts[e.color_used_id] = (monthCounts[e.color_used_id] ?? 0) + 1; });
  const monthColorRows = Object.entries(monthCounts)
    .map(([cid, cnt]) => ({ id: cid, code: colorMap[cid] ?? cid.slice(0, 6), name: colorNameMap[cid] ?? cid.slice(0, 6), count: cnt }))
    .sort((a, b) => b.count - a.count);
  const monthPaintedTotal = monthColorRows.reduce((s, r) => s + r.count, 0);

  // Per-job planned vs actual
  const jobRows = jobs.map((j: any) => {
    const plan = (j.color_plan && typeof j.color_plan === "object") ? j.color_plan as Record<string, number> : {};
    const actualByColor: Record<string, number> = {};
    let actualTotal = 0;
    vehicles.filter((v: any) => v.job_order_id === j.id && v.actual_color_id).forEach((v: any) => {
      actualByColor[v.actual_color_id] = (actualByColor[v.actual_color_id] ?? 0) + 1; actualTotal++;
    });
    const plannedTotal = Object.values(plan).reduce((a, b) => a + (Number(b) || 0), 0);
    const ids = Array.from(new Set([...Object.keys(plan), ...Object.keys(actualByColor)]));
    const perColor = ids.map(cid => `${colorMap[cid] ?? cid.slice(0,6)}:${Number(plan[cid])||0}/${actualByColor[cid] ?? 0}`).join("  ");
    const compliance = plannedTotal > 0 ? Math.round((actualTotal / plannedTotal) * 100) : (actualTotal > 0 ? 100 : 0);
    return { jobCode: j.job_code, planned: plannedTotal, actual: actualTotal, compliance, perColor };
  }).filter((r: any) => r.planned > 0 || r.actual > 0).sort((a: any, b: any) => b.actual - a.actual);
  const plannedAll = jobRows.reduce((s: number, r: any) => s + r.planned, 0);
  const actualAll = jobRows.reduce((s: number, r: any) => s + r.actual, 0);
  const overallCompliance = plannedAll > 0 ? Math.round((actualAll / plannedAll) * 100) : 0;

  // === PDF ===
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const hasArabicFont = await loadArabicFont(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const ACCENT = [139, 92, 246];
  const ts = new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" });

  // Header
  doc.setFillColor(30, 41, 59); doc.rect(0, 0, pageWidth, 22, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text("AFA Shopfloor — Color Tracking Report", 14, 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(203, 213, 225);
  doc.text(`${rangeLabel}  ·  Generated ${ts}`, 14, 17);

  let y = 30;
  // KPI cards
  const kpis = [
    { label: "Total Painted", value: String(totalPainted), color: [59, 130, 246] },
    { label: "Overall Compliance", value: `${overallCompliance}%`, color: [16, 185, 129] },
    { label: "Pending Unpainted", value: String(backlog), color: [245, 158, 11] },
    { label: "Active Colors", value: String(activeColors), color: ACCENT },
    { label: "Painted This Month", value: String(monthPaintedTotal), color: [236, 72, 153] },
  ];
  const cardW = (pageWidth - 28 - (kpis.length - 1) * 4) / kpis.length;
  kpis.forEach((k, i) => {
    const cx = 14 + i * (cardW + 4);
    doc.setFillColor(245, 247, 250); doc.roundedRect(cx, y, cardW, 18, 2, 2, "F");
    doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.setFont("helvetica", "normal");
    doc.text(k.label.toUpperCase(), cx + 3, y + 5);
    doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(k.color[0], k.color[1], k.color[2]);
    doc.text(k.value, cx + 3, y + 14);
  });
  y += 26;

  // Colors today table (day report only)
  if (!isMonthly) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 41, 59);
    doc.text(`Colors Assigned Today (${todayEvents.length})`, 14, y);
    y += 3;
    const rows = todayEvents.map((e: any) => {
      const v = vehById[e.vehicle_id];
      return [formatDateTime(e.recorded_at), v?.vin ?? "—", v ? modelOf(v) : "Unknown", `${colorNameMap[e.color_used_id] ?? "—"} (${colorMap[e.color_used_id] ?? "—"})`];
    });
    (autotable as any)(doc, {
      startY: y,
      head: [["Time", "VIN", "Model", "Color"]],
      body: rows.length ? rows : [["—", "No colors assigned today", "", ""]],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: ACCENT, textColor: 255 },
      columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: 60 } },
      didParseCell: (data: any) => {
        if (hasArabicFont && data.section === "body" && data.column.index === 2) {
          const t = data.cell.raw; if (t && hasArabic(String(t))) data.cell.styles.font = "Amiri";
        }
      },
    });
    // @ts-ignore lastAutoTable
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Monthly color distribution bar chart
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 41, 59);
  doc.text(`Color Distribution — ${reportDate.slice(0, 7)}`, 14, y);
  y += 3;
  const chartData = monthColorRows.map((r, i) => ({ label: `${r.code} (${r.name})`, value: r.count, color: COLORS_PALETTE[i % COLORS_PALETTE.length] }));
  if (chartData.length > 0) drawBarChart(doc, 14, y, pageWidth - 28, Math.min(8 * chartData.length + 6, 70), chartData);
  y += Math.min(8 * chartData.length + 6, 70) + 4;
  if (y > pageHeight - 40) { doc.addPage(); y = 20; }

  // Per-job compliance table
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 41, 59);
  doc.text("Planned vs Actual per Job Order", 14, y);
  y += 3;
  (autotable as any)(doc, {
    startY: y,
    head: [["Job Code", "Planned", "Actual", "Compliance %", "Per Color (planned/actual)"]],
    body: jobRows.length ? jobRows.map((r: any) => [r.jobCode, String(r.planned), String(r.actual), `${r.compliance}%`, r.perColor]) : [["—", "No job orders with color plans", "", "", ""]],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: ACCENT, textColor: 255 },
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 22, halign: "center" }, 2: { cellWidth: 22, halign: "center" }, 3: { cellWidth: 30, halign: "center" } },
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
    doc.text(`AFA Shopfloor — Color Tracking Report — Generated ${ts}`, 14, pageHeight - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: "right" });
    doc.text("Created By Michael Amgad Khairy - Planning Section", pageWidth / 2, pageHeight - 3, { align: "center" });
  }

  const pdfBytes = doc.output("arraybuffer");
  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="colors-report-${reportDate}.pdf"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
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
    const reportDate = date ?? new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
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

    // === SHARED LOOKUPS ===
    const { data: lotsData } = await sb.from("lots").select("id, model");
    const lotMap: Record<string, string> = {};
    (lotsData ?? []).forEach((l: any) => { lotMap[l.id] = l.model; });

    const { data: jolData } = await sb.from("job_order_lots").select("job_order_id, lot_id");
    const joModelMap: Record<string, string> = {};
    (jolData ?? []).forEach((jol: any) => {
      if (!joModelMap[jol.job_order_id] && lotMap[jol.lot_id]) joModelMap[jol.job_order_id] = lotMap[jol.lot_id];
    });

    const { data: colorsData } = await sb.from("standard_colors").select("id, code, name");
    const colorMap: Record<string, string> = {};
    const colorNameMap: Record<string, string> = {};
    (colorsData ?? []).forEach((c: any) => { colorMap[c.id] = c.code; colorNameMap[c.id] = c.name; });

    // === DEDICATED COLORS REPORT (early return — does not run WIP assembly) ===
    if (m === "colors") {
      return await buildColorsReport({ sb, reportDate, isMonthly, dayStart, dayEnd, monthStart, monthEnd, lotMap, joModelMap, colorMap, colorNameMap, rangeLabel });
    }
    // === BRANCH: DAY vs MONTHLY data assembly ===
    let wipVehicles: WipVehicle[] = [];
    let categories: { name: string; vehicles: typeof wipVehicles }[] = [];
    let issueMap: Record<string, string[]> = {};
    let shortageMap: Record<string, any[]> = {};
    let carsIn = 0, carsOut = 0;
    let delayedCount = 0;
    let avgStayHours = 0;
    let dailyBreakdown: Record<string, { in: number; out: number }> = {};
    let monthlyStays: { vin: string; model: string; station: string; entered: string; exited: string | null; working_hours: number; working_days: number; status: string; details: string }[] = [];
    let issuePct: { category: string; count: number; pct: number }[] = [];

    if (!isMonthly) {
      // === DAY PATH: snapshot (existing logic, unchanged) ===
      const { data: wipData } = await sb
        .from("vehicles")
        .select("id, vin, vin_suffix, current_station, actual_color_id, lot_id, job_order_id, contract_model")
        .in("current_station", config.stations)
        .is("completed_at", null);
      wipVehicles = (wipData ?? []).map((v: any) => ({ ...v, lot_model: "", entry_time: null }));

      const vehicleIds = wipVehicles.map(v => v.id);
      wipVehicles.forEach((v: any) => {
        if (v.lot_id && lotMap[v.lot_id]) v.lot_model = lotMap[v.lot_id];
        else if (v.job_order_id && joModelMap[v.job_order_id]) v.lot_model = joModelMap[v.job_order_id];
        else if (v.contract_model) v.lot_model = v.contract_model;
      });

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

      const { data: rpcEvents } = await sb.rpc("get_production_events", { p_from: rangeStart, p_to: rangeEnd });
      const todayEvents = (rpcEvents ?? []) as any[];
      carsIn = todayEvents.filter((e: any) => e.kind === "in" && config.stations.includes(e.station)).length;
      carsOut = todayEvents.filter((e: any) => e.kind === "out" && config.stations.includes(e.station)).length;

      const now = new Date();
      delayedCount = wipVehicles.filter(v => {
        if (!v.entry_time) return false;
        const hours = (now.getTime() - new Date(v.entry_time).getTime()) / 3600000;
        return hours > 24;
      }).length;

    } else {
      // === MONTHLY PATH ===
      // Counts + daily via aggregation RPC (small result; avoids the ~1000-row PostgREST cap on raw event pulls).
      const { data: dailyRows } = await sb.rpc("get_month_station_daily", { station_codes: config.stations, p_from: rangeStart, p_to: rangeEnd });
      (dailyRows ?? []).forEach((r: any) => {
        carsIn += Number(r.ins);
        carsOut += Number(r.outs);
        if (!dailyBreakdown[r.day]) dailyBreakdown[r.day] = { in: 0, out: 0 };
        dailyBreakdown[r.day].in += Number(r.ins);
        dailyBreakdown[r.day].out += Number(r.outs);
      });

      // Per-VIN flashback rows from get_station_stays (live cars: entry/exit/stay/model).
      const { data: staysData } = await sb.rpc("get_station_stays", { station_codes: config.stations, p_from: rangeStart, p_to: rangeEnd });
      const stays = (staysData ?? []) as Array<{ vin: string; station: string; model: string; entered_at: string; exited_at: string | null; working_hours: number; working_days: number }>;

      // Issues + shortages via RPC (server-side join over live + archived; POST body, no URL limit).
      const { data: isRows } = await sb.rpc("get_station_issues_shortages", { station_codes: config.stations, p_from: rangeStart, p_to: rangeEnd });
      const vinIssues: Record<string, string[]> = {};
      const vinShortages: Record<string, any[]> = {};
      (isRows ?? []).forEach((r: any) => {
        const vin = r.out_vin;
        if (!vin) return;
        if (r.kind === "issue") {
          if (!vinIssues[vin]) vinIssues[vin] = [];
          if (r.title) vinIssues[vin].push(r.title);
        } else {
          if (!vinShortages[vin]) vinShortages[vin] = [];
          vinShortages[vin].push({ shortage_reason: r.shortage_reason, part_type: r.part_type, parts: r.title ? r.title.split(",") : [] });
        }
      });

      const { data: delayedVehicles } = await sb.rpc("get_delayed_vehicles", { threshold_days: 2 });
      const delayedSet = new Set<string>();
      (delayedVehicles ?? []).forEach((dv: any) => {
        if (dv.current_station && config.stations.includes(dv.current_station)) delayedSet.add(dv.vin);
      });

      const allStayHours: number[] = [];
      stays.forEach((s: any) => {
        const wh = s.working_hours ?? 0;
        const wd = s.working_days ?? 0;
        if (wh > 0) allStayHours.push(wh);
        const vin = s.vin;
        const status = delayedSet.has(vin) && wd >= 2 ? "Delayed" : (vinIssues[vin]?.length ? "Issue" : (vinShortages[vin]?.length ? "Shortage" : "OK"));
        const dParts: string[] = [];
        (vinIssues[vin] || []).forEach((t: string) => dParts.push(t));
        (vinShortages[vin] || []).forEach((sh: any) => dParts.push((sh.parts || []).join(", ") + (sh.shortage_reason ? ` [${sh.shortage_reason}]` : "")));
        monthlyStays.push({ vin, model: s.model || "—", station: s.station, entered: s.entered_at || "", exited: s.exited_at, working_hours: wh, working_days: wd, status, details: dParts.join(" | ") });
      });
      avgStayHours = allStayHours.length ? allStayHours.reduce((a, b) => a + b, 0) / allStayHours.length : 0;
      delayedCount = stays.filter((s: any) => (s.working_days ?? 0) >= 2).length;

      const allIssuesCats: Record<string, number> = {};
      Object.values(vinIssues).flat().forEach((title: string) => {
        const t = title.toLowerCase();
        if (t.includes("ckd")) allIssuesCats.CKD = (allIssuesCats.CKD || 0) + 1;
        else if (t.includes("plastic") || t.includes("سبيلر")) allIssuesCats.PLASTICS = (allIssuesCats.PLASTICS || 0) + 1;
        else if (t.includes("damage") || t.includes("خدش")) allIssuesCats.Damage = (allIssuesCats.Damage || 0) + 1;
        else allIssuesCats.Local = (allIssuesCats.Local || 0) + 1;
      });
      Object.values(vinShortages).flat().forEach((s: any) => {
        const cat = getCategoryForShortage(s);
        allIssuesCats[cat] = (allIssuesCats[cat] || 0) + 1;
      });
      const totalIssues = Object.values(allIssuesCats).reduce((a, b) => a + b, 0) || 1;
      issuePct = Object.entries(allIssuesCats).map(([cat, cnt]) => ({ category: cat, count: cnt, pct: Math.round((cnt / totalIssues) * 100) }))
        .sort((a, b) => b.count - a.count);

      wipVehicles = [];
      categories = [];
    }

    // === DAY PATH: categorize vehicles (only if !isMonthly) ===
    if (!isMonthly) {

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

    const reportTitle = isMonthly ? config.title.replace("WIP Status Report", "Monthly Flow Report") : config.title;
    doc.text(reportTitle, 14, y);
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
    const ts = now2.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Cairo" }) +
      " " + now2.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "Africa/Cairo" });
    doc.text(`Report Generated: ${ts} | Period: ${rangeLabel}`, pageWidth / 2, y, { align: "center" });
    y += 8;

    const kpis = isMonthly ? [
      { label: "Total In", value: carsIn, color: [59, 130, 246] },
      { label: "Total Out", value: carsOut, color: [16, 185, 129] },
      { label: "Avg Stay", value: avgStayHours > 0 ? `${Math.round(avgStayHours)}h` : "—", color: [245, 158, 11] },
      { label: "% Delayed", value: carsIn > 0 ? `${Math.round((delayedCount / carsIn) * 100)}%` : "—", color: [239, 68, 68] },
    ] : [
      { label: "Total WIP", value: wipVehicles.length, color: [245, 158, 11] },
      { label: "Delayed WIP", value: delayedCount, color: [239, 68, 68] },
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

    // === SUMMARY TABLE (day only; monthly uses Flashback) ===
    if (!isMonthly) {
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
    }

    // === BAR CHART + PIE CHART (day only) ===
    if (!isMonthly) {
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
      try { drawBarChart(doc, 14, y, pageWidth / 2 - 25, 45, chartData); } catch (e) { console.error("bar chart failed:", e); }

      if (chartData.length > 0) {
        const pieCx = pageWidth / 2 + 30;
        const pieCy = y + 22;
        try {
          drawPieChart(doc, pieCx, pieCy, 20, chartData);
          drawPieLegend(doc, pieCx + 30, pieCy - chartData.length * 4, chartData);
        } catch (e) { console.error("pie chart failed:", e); }
      }
      y += Math.max(categories.length * 15 + 5, 45);
    }

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
        let cumulative = 0;
        const dailyHeaders = ["Date", "Cars In", "Cars Out", "Net", "Cumulative WIP"];
        const dailyRows = days.map(d => {
          const net = dailyBreakdown[d].in - dailyBreakdown[d].out;
          cumulative += net;
          return [
            d, String(dailyBreakdown[d].in), String(dailyBreakdown[d].out), String(net), String(cumulative)
          ];
        });
        const totalIn = days.reduce((s, d) => s + dailyBreakdown[d].in, 0);
        const totalOut = days.reduce((s, d) => s + dailyBreakdown[d].out, 0);
        dailyRows.push(["TOTAL", String(totalIn), String(totalOut), String(totalIn - totalOut), String(cumulative)]);
        (autotable as any)(doc, {
          startY: y,
          head: [dailyHeaders],
          body: dailyRows,
          theme: "grid",
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: config.color, textColor: 255 },
          columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 22 }, 2: { cellWidth: 22 }, 3: { cellWidth: 20 }, 4: { cellWidth: 30 } },
          didParseCell: (data: any) => {
            if (data.section === "body" && data.row.index === dailyRows.length - 1) data.cell.styles.fontStyle = "bold";
          },
        });
        y = (doc as any).lastAutoTable.finalY + 8;

        needSpace(35);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 41, 59);
        doc.text("In/Out Trend", 14, y);
        y += 3;
        const lineData = days.map(d => ({ day: d, ...dailyBreakdown[d] }));
        try { drawLineChart(doc, 14, y, pageWidth - 28, 30, lineData); } catch (e) { console.error("line chart failed:", e); }
        y += 35;
      }
    }

    // === MODEL DISTRIBUTION CHART (day only) ===
    if (!isMonthly) {
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
        const chartColors = [
          [211, 84, 0], [59, 130, 246], [16, 185, 129], [245, 158, 11],
          [139, 92, 246], [239, 68, 68], [20, 184, 166], [249, 115, 22],
        ];
        const modelChartData = modelEntries.map((e, i) => ({
          label: e[0] || "Unknown",
          value: e[1],
          color: chartColors[i % chartColors.length],
        }));
        try { drawBarChart(doc, 14, y, pageWidth / 2 - 20, 40, modelChartData); } catch (e) { console.error("model bar chart failed:", e); }

        if (modelChartData.length > 0) {
          const mpCx = pageWidth / 2 + 30;
          const mpCy = y + 22;
          try {
            drawPieChart(doc, mpCx, mpCy, 20, modelChartData);
            drawPieLegend(doc, mpCx + 30, mpCy - modelChartData.length * 4, modelChartData);
          } catch (e) { console.error("model pie chart failed:", e); }
        }
        y += Math.max(modelEntries.length * 15 + 5, 40);
      }
    }

    // === MONTHLY-ONLY SECTIONS ===
    if (isMonthly) {
      // Flashback table
      if (monthlyStays.length > 0) {
        needSpace(30);
        doc.addPage();
        y = 15;
        doc.setFontSize(13);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 58, 138);
        doc.text(`Monthly Flow Flashback — ${rangeLabel}`, 14, y);
        y += 5;
        const fbHeaders = ["VIN", "Model", "Station", "Entry", "Exit", "Stay", "Days", "Status"];
        const fbRows = monthlyStays.map(s => [
          s.vin, s.model, s.station,
          formatDateOnly(s.entered),
          formatDateOnly(s.exited),
          s.working_hours > 0 ? `${Math.round(s.working_hours)}h` : "—",
          s.working_days > 0 ? String(s.working_days) : "—",
          s.status
        ]);
        (autotable as any)(doc, {
          startY: y,
          head: [fbHeaders],
          body: fbRows,
          theme: "grid",
          styles: { fontSize: 6, cellPadding: 1.5, overflow: "truncate" },
          headStyles: { fillColor: config.color, textColor: 255 },
          columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 28 }, 2: { cellWidth: 18 }, 3: { cellWidth: 22 }, 4: { cellWidth: 22 }, 5: { cellWidth: 14 }, 6: { cellWidth: 10 }, 7: { cellWidth: 18 } },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      // Issue % table
      if (issuePct.length > 0) {
        needSpace(25);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 41, 59);
        doc.text("Issues & Shortages by Category", 14, y);
        y += 3;
        const pctHeaders = ["Category", "Count", "%"];
        const pctRows = issuePct.map(x => [x.category, String(x.count), `${x.pct}%`]);
        (autotable as any)(doc, {
          startY: y,
          head: [pctHeaders],
          body: pctRows,
          theme: "grid",
          styles: { fontSize: 9, cellPadding: 3 },
          headStyles: { fillColor: config.color, textColor: 255 },
          columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 30 }, 2: { cellWidth: 30 } },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      // Per-VIN issue/shortage details (mirrors the daily WIP Details tables).
      const detailVins = monthlyStays.filter(s => s.details);
      if (detailVins.length > 0) {
        needSpace(30);
        doc.addPage();
        y = 15;
        doc.setFontSize(13);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 58, 138);
        doc.text(`Monthly Details (Issues & Shortages) — ${rangeLabel}`, 14, y);
        y += 5;
        const dHeaders = ["VIN", "Model", "Station", "Issue / Shortage", "Entry", "Exit"];
        const dRows = detailVins.map(s => [s.vin, s.model, s.station, s.details, formatDateOnly(s.entered), formatDateOnly(s.exited)]);
        (autotable as any)(doc, {
          startY: y,
          head: [dHeaders],
          body: dRows,
          theme: "grid",
          styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
          headStyles: { fillColor: config.color, textColor: 255, fontSize: 8 },
          columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: 28 }, 2: { cellWidth: 18 }, 3: { cellWidth: 90 }, 4: { cellWidth: 24 }, 5: { cellWidth: 24 } },
          didParseCell: (data: any) => {
            if (hasArabicFont && data.section === "body" && data.column.index === 3) {
              const cellText = data.cell.raw;
              if (cellText && hasArabic(cellText)) data.cell.styles.font = "Amiri";
            }
          },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      // Delay summary
      needSpace(20);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("Delay Summary", 14, y);
      y += 5;
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      const delayedVehicles = monthlyStays.filter(s => s.working_days >= 2);
      const avgDelayDays = delayedVehicles.length > 0
        ? (delayedVehicles.reduce((sum, s) => sum + s.working_days, 0) / delayedVehicles.length).toFixed(1)
        : "—";
      const maxDelayDays = delayedVehicles.length > 0
        ? Math.max(...delayedVehicles.map(s => s.working_days))
        : 0;
      doc.text(`% Delayed: ${carsIn > 0 ? Math.round((delayedCount / carsIn) * 100) : 0}% | Avg over-threshold: ${avgDelayDays} days | Longest delay: ${maxDelayDays} days`, 14, y);
      y += 10;
    }

    // === DETAILED BREAKDOWN (day only) ===
    if (!isMonthly) {
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
    }

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
