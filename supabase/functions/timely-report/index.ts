import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import jsPDF from "https://esm.sh/jspdf@2.5.2";
import autotable from "https://esm.sh/jspdf-autotable@3.8.4";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// --- Chart helpers (shared with dashboard-report) ---
const CHART_COLORS = [
  [211, 84, 0], [59, 130, 246], [16, 185, 129], [245, 158, 11],
  [139, 92, 246], [239, 68, 68], [20, 184, 166], [249, 115, 22],
];

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

function drawArcSlice(doc: any, cx: number, cy: number, r: number, a1: number, a2: number, color: number[]) {
  doc.setFillColor(color[0], color[1], color[2]);
  doc.setDrawColor(color[0], color[1], color[2]);
  const steps = Math.max(Math.ceil(Math.abs(a2 - a1) / 0.05), 3);
  const points: number[][] = [[cx, cy]];
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (i / steps) * (a2 - a1);
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  // jsPDF.lines(lines, x, y, scale, style, closed) — style must be 'S'|'F'|'DF'|null, closed boolean.
  const arcPts = points.map(([x, y]) => [x - points[0][0], y - points[0][1]]);
  if (arcPts.length >= 2) doc.lines(arcPts, cx, cy, [1, 1], "F", true);
}

function drawPieChart(doc: any, cx: number, cy: number, r: number, data: { label: string; value: number; color: number[] }[]) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return;
  let angle = -Math.PI / 2;
  // Donut = thick stroked arcs, one per slice (reliable; filled wedges are not).
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
  try { doc.setLineCap("round"); } catch (e) { /* older jsPDF */ }
  if (shifts.length >= 1) doc.lines(shifts, abs[0][0], abs[0][1], [1, 1], "S", false);
  try { doc.setLineCap("butt"); } catch (e) { /* reset */ }
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

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text(valueText, cx, cy, { align: "center", baseline: "middle" });

  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(label, cx, cy + r + 5, { align: "center", baseline: "middle" });
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
    const { date }: { date?: string } = await req.json().catch(() => ({}));
    const reportDate = date ?? new Date().toISOString().slice(0, 10);

    const env = Deno.env.toObject() as Env;
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    const monthStart = reportDate.slice(0, 8) + "01";
    const [vehiclesRes, eventsRes, plansRes, lotsRes, mtdRes] = await Promise.all([
      supabase.from("vehicles").select("id, current_station, lot_id").is("completed_at", null),
      // Unified events RPC: active + archived vehicles (so archived contract
      // vehicles are still counted). Each event row carries its resolved model.
      supabase.rpc("get_production_events", { p_from: `${reportDate}T00:00:00`, p_to: `${reportDate}T23:59:59` }),
      supabase.from("production_plans").select("monthly_plan, daily_target, jph_target, model:models(name)").eq("month", monthStart),
      supabase.from("lots").select("id, model"),
      supabase.from("factory_calendar").select("working_hours").gte("date", monthStart).lte("date", reportDate).eq("is_working_day", true),
    ]);

    const vehicles = vehiclesRes.data ?? [];
    const events = (eventsRes.data ?? []) as any[];
    const plans = plansRes.data ?? [];
    const lots = lotsRes.data ?? [];
    const lotMap = Object.fromEntries(lots.map((l: any) => [l.id, l.model]));

    // WIP vehicles → model map (for WIP station counts only)
    const vModel = new Map<string, string>();
    vehicles.forEach((v: any) => {
      const model = (v.lot_id && lotMap[v.lot_id]);
      if (model) vModel.set(v.id, model);
    });

    const modelSet = new Set<string>();
    vModel.forEach(m => modelSet.add(m));
    events.forEach((e: any) => { if (e.model) modelSet.add(e.model); });
    plans.forEach((p: any) => { if (p.model?.name) modelSet.add(p.model.name); });
    const models = Array.from(modelSet).sort();

    const stations = [
      { code: "body_shop", label: "Body" },
      { code: "wbs", label: "WBS" },
      { code: "paint", label: "Paint" },
      { code: "pbs", label: "PBS" },
      { code: "shortage", label: "Shortage" },
      { code: "repair", label: "Repair" },
      { code: "cs", label: "C.S" },
      { code: "pdi", label: "PDI" },
    ];

    const outsPerStationModel: Record<string, Record<string, number>> = {};
    stations.forEach(s => { outsPerStationModel[s.code] = {}; models.forEach(m => { outsPerStationModel[s.code][m] = 0; }); });
    events.filter((e: any) => e.kind === "out").forEach((e: any) => {
      const model = e.model;
      if (model && outsPerStationModel[e.station]) {
        outsPerStationModel[e.station][model] = (outsPerStationModel[e.station][model] ?? 0) + 1;
      }
    });

    const insPerStationModel: Record<string, Record<string, number>> = {};
    stations.forEach(s => { insPerStationModel[s.code] = {}; models.forEach(m => { insPerStationModel[s.code][m] = 0; }); });
    events.filter((e: any) => e.kind === "in").forEach((e: any) => {
      const model = e.model;
      if (model && insPerStationModel[e.station]) {
        insPerStationModel[e.station][model] = (insPerStationModel[e.station][model] ?? 0) + 1;
      }
    });

    const wipPerStationModel: Record<string, Record<string, number>> = {};
    stations.forEach(s => { wipPerStationModel[s.code] = {}; models.forEach(m => { wipPerStationModel[s.code][m] = 0; }); });
    vehicles.forEach((v: any) => {
      const model = vModel.get(v.id);
      if (model && v.current_station && wipPerStationModel[v.current_station]) {
        wipPerStationModel[v.current_station][model] = (wipPerStationModel[v.current_station][model] ?? 0) + 1;
      }
    });

    const planMap: Record<string, { monthly: number; daily: number; jph: number }> = {};
    plans.forEach((p: any) => {
      if (p.model?.name) planMap[p.model.name] = { monthly: p.monthly_plan, daily: p.daily_target, jph: p.jph_target };
    });

    // Generate PDF
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = 15;

    const needSpace = (mm: number) => {
      if (y + mm > pageHeight - 15) { doc.addPage(); y = 15; }
    };

    // === HEADER ===
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Timely Production Report", 14, y);
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
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Date: ${reportDate}`, 14, y);
    const mtdHours = (mtdRes.data ?? []).reduce((sum: number, r: any) => sum + (r.working_hours ?? 0), 0);
    doc.text(`Month-to-Date Working Hours: ${mtdHours}h`, pageWidth / 2, y, { align: "center" });
    const nowTs = new Date();
    const ts = nowTs.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " " + nowTs.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    doc.text(`Generated: ${ts}`, pageWidth - 14, y, { align: "right" });
    y += 10;

    // === MONTHLY PLAN SUMMARY ===
    if (models.length > 0) {
      needSpace(25);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("Monthly Plan Summary", 14, y);
      y += 2;

      const planHeaders = ["Model", "Monthly Plan", "Daily Target", "JPH Target", "Total Actual", "Achieved %"];
      const planRows = models.map(m => {
        const p = planMap[m] ?? { monthly: 0, daily: 0, jph: 0 };
        const totalOut = stations.reduce((s, st) => s + (outsPerStationModel[st.code]?.[m] ?? 0), 0);
        const achieved = p.monthly > 0 ? ((totalOut / p.monthly) * 100).toFixed(1) + "%" : "—";
        return [m, String(p.monthly), String(p.daily), String(p.jph), String(totalOut), achieved];
      });

      (autotable as any)(doc, {
        startY: y,
        head: [planHeaders],
        body: planRows,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
      });

      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // === DAILY STATION ACTIVITY ===
    needSpace(25);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Daily Station Activity", 14, y);
    y += 2;

    const stationHeaders = ["Station", ...models, "Total"];
    const stationRows = stations.map(st => {
      const totalIns = models.reduce((s, m) => s + (insPerStationModel[st.code]?.[m] ?? 0), 0);
      const totalOuts = models.reduce((s, m) => s + (outsPerStationModel[st.code]?.[m] ?? 0), 0);
      const inRow = [`IN: ${st.label}`, ...models.map(m => String(insPerStationModel[st.code]?.[m] ?? 0)), String(totalIns)];
      const outRow = [`OUT: ${st.label}`, ...models.map(m => String(outsPerStationModel[st.code]?.[m] ?? 0)), String(totalOuts)];
      return [inRow, outRow];
    }).flat();

    (autotable as any)(doc, {
      startY: y,
      head: [stationHeaders],
      body: stationRows,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [39, 174, 96], textColor: 255 },
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    // === STATION THROUGHPUT BAR CHART ===
    needSpace(45);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Station Throughput (Today)", 14, y);
    y += 3;

    const throughputData = stations.map((st, i) => {
      const totalOut = models.reduce((s, m) => s + (outsPerStationModel[st.code]?.[m] ?? 0), 0);
      const totalIn = models.reduce((s, m) => s + (insPerStationModel[st.code]?.[m] ?? 0), 0);
      return {
        label: st.label,
        value: totalOut,
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    }).filter(d => d.value > 0);

    if (throughputData.length > 0) {
      try { drawBarChart(doc, 14, y, pageWidth / 2 - 25, 40, throughputData); } catch (e) { console.error("bar failed:", e); }

      // Station throughput pie chart
      const pieCx = pageWidth / 2 + 30;
      const pieCy = y + 22;
      try {
        drawPieChart(doc, pieCx, pieCy, 20, throughputData);
        drawPieLegend(doc, pieCx + 30, pieCy - throughputData.length * 4, throughputData);
      } catch (e) { console.error("pie failed:", e); }
    }
    y += Math.max(throughputData.length * 15 + 5, 40);

    // === WIP SUMMARY ===
    needSpace(25);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("WIP Status", 14, y);
    y += 2;

    const wipHeaders = ["Station", ...models, "Total"];
    const wipRows = stations.map(st => {
      const total = models.reduce((s, m) => s + (wipPerStationModel[st.code]?.[m] ?? 0), 0);
      return [st.label, ...models.map(m => String(wipPerStationModel[st.code]?.[m] ?? 0)), String(total)];
    });

    (autotable as any)(doc, {
      startY: y,
      head: [wipHeaders],
      body: wipRows,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [142, 68, 173], textColor: 255 },
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    // === MODEL DISTRIBUTION PIE CHART ===
    const modelOutCounts: Record<string, number> = {};
    events.filter((e: any) => e.kind === "out").forEach((e: any) => {
      const model = e.model;
      if (model) modelOutCounts[model] = (modelOutCounts[model] ?? 0) + 1;
    });
    const modelPieData = Object.entries(modelOutCounts).map(([name, value], i) => ({
      label: name, value, color: CHART_COLORS[i % CHART_COLORS.length],
    })).sort((a, b) => b.value - a.value);

    if (modelPieData.length > 0) {
      needSpace(50);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("Production by Model", 14, y);
      y += 3;

      const mpCx = pageWidth / 4 + 10;
      const mpCy = y + 22;
      try {
        drawPieChart(doc, mpCx, mpCy, 22, modelPieData);
        drawPieLegend(doc, mpCx + 35, mpCy - modelPieData.length * 4, modelPieData);
      } catch (e) { console.error("model pie failed:", e); }

      // WIP by station bar chart on right
      const wipChartData = stations.map((st, i) => {
        const total = models.reduce((s, m) => s + (wipPerStationModel[st.code]?.[m] ?? 0), 0);
        return { label: st.label, value: total, color: CHART_COLORS[i % CHART_COLORS.length] };
      }).filter(d => d.value > 0);

      if (wipChartData.length > 0) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 41, 59);
        doc.text("WIP by Station", pageWidth / 2 + 10, y - 3);
        try { drawBarChart(doc, pageWidth / 2 + 10, y, pageWidth / 2 - 24, 40, wipChartData); } catch (e) { console.error("wip bar failed:", e); }
      }
      y += Math.max(modelPieData.length * 8 + 15, 45);
    }

    // === JPH SUMMARY ===
    needSpace(25);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("JPH Summary", 14, y);
    y += 2;

    const now = new Date();
    const dayStart = new Date(`${reportDate}T00:00:00`);
    const elapsedHours = Math.max((now.getTime() - dayStart.getTime()) / (1000 * 60 * 60), 1);

    const jphHeaders = ["Station", ...models, "Total Out", "JPH"];
    const jphRows = stations.map(st => {
      const totalOuts = models.reduce((s, m) => s + (outsPerStationModel[st.code]?.[m] ?? 0), 0);
      const jph = (totalOuts / elapsedHours).toFixed(1);
      return [st.label, ...models.map(m => String(outsPerStationModel[st.code]?.[m] ?? 0)), String(totalOuts), jph];
    });

    (autotable as any)(doc, {
      startY: y,
      head: [jphHeaders],
      body: jphRows,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [211, 84, 0], textColor: 255 },
    });

    // === FOOTER ===
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(148, 163, 184);
      doc.text(`AFA Shopfloor — Timely Production Report — Generated ${ts}`, 14, pageHeight - 7);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: "right" });
      doc.text("Created By Michael Amgad Khairy - Planning Section", pageWidth / 2, pageHeight - 3, { align: "center" });
    }

    const pdfBytes = doc.output("arraybuffer");
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="timely-report-${reportDate}.pdf"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error("Report generation error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
