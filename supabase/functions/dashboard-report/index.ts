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

function drawBarChart(doc: any, x: number, y: number, w: number, h: number, data: { label: string; value: number; color: number[] }[]) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barHeight = Math.min(12, (h - 10) / data.length);
  const labelWidth = 40;
  const barMaxWidth = w - labelWidth - 15;

  data.forEach((d, i) => {
    const barY = y + i * (barHeight + 3);
    const barW = (d.value / maxVal) * barMaxWidth;

    // Label
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    doc.text(d.label, x, barY + barHeight / 2 + 1, { baseline: "middle" });

    // Bar
    doc.setFillColor(d.color[0], d.color[1], d.color[2]);
    doc.roundedRect(x + labelWidth, barY + 1, barW, barHeight - 2, 1.5, 1.5, "F");

    // Value
    doc.setTextColor(50, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.text(String(d.value), x + labelWidth + barW + 2, barY + barHeight / 2 + 1, { baseline: "middle" });
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
    const { date, module: mod }: { date?: string; module?: string } = await req.json().catch(() => ({}));
    const reportDate = date ?? new Date().toISOString().slice(0, 10);
    const m = mod ?? "pbs";
    const config = MODULE_CONFIG[m] ?? MODULE_CONFIG.pbs;

    const env = Deno.env.toObject() as Env;
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    const dayStart = `${reportDate}T00:00:00`;
    const dayEnd = `${reportDate}T23:59:59`;

    // 1. Fetch WIP vehicles at relevant stations
    const { data: wipData } = await sb
      .from("vehicles")
      .select("id, vin, vin_suffix, current_station, actual_color_id, lot_id, job_order_id")
      .in("current_station", config.stations)
      .is("completed_at", null);
    const wipVehicles: WipVehicle[] = (wipData ?? []).map((v: any) => ({ ...v, lot_model: "", entry_time: null }));

    // 2. Lot model map
    const { data: lotsData } = await sb.from("lots").select("id, model");
    const lotMap: Record<string, string> = {};
    (lotsData ?? []).forEach((l: any) => { lotMap[l.id] = l.model; });

    // 2b. Job order → model fallback (for multi-lot job orders where vehicle.lot_id is null)
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
    });

    // 5. Entry times — earliest IN event at current station
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

    // 7. Today's events for KPI
    const { data: todayEvents } = await sb
      .from("station_events")
      .select("station, kind")
      .gte("recorded_at", dayStart)
      .lte("recorded_at", dayEnd);
    const carsIn = (todayEvents ?? []).filter((e: any) => e.kind === "in" && config.stations.includes(e.station)).length;
    const carsOut = (todayEvents ?? []).filter((e: any) => e.kind === "out" && config.stations.includes(e.station)).length;

    // 8. Delayed WIP (entry > 24h ago)
    const now = new Date();
    const delayedWip = wipVehicles.filter(v => {
      if (!v.entry_time) return false;
      const hours = (now.getTime() - new Date(v.entry_time).getTime()) / 3600000;
      return hours > 24;
    }).length;

    // 9. Categorize vehicles
    let categories: { name: string; vehicles: typeof wipVehicles }[] = [];

    if (m === "shortage") {
      // Shortages: fetch open shortage records
      const { data: shortagesData } = await sb
        .from("shortages")
        .select("id, vehicle_id, parts, shortage_reason, part_type, notes, status, created_at")
        .eq("status", "open");
      const shortages = shortagesData ?? [];

      // Build category map
      const catMap: Record<string, typeof wipVehicles> = {};
      const catOrder = ["PLASTICS PART", "Local", "CKD", "Scratches"];
      catOrder.forEach(c => { catMap[c] = []; });

      shortages.forEach((s: any) => {
        const cat = getCategoryForShortage(s);
        const v = wipVehicles.find(wv => wv.id === s.vehicle_id);
        if (v) {
          (v as any).issue = (s.parts as string[] || []).join(", ") || s.notes || "";
          (v as any).entry_time = s.created_at;
          if (!catMap[cat]) catMap[cat] = [];
          catMap[cat].push(v);
        }
      });
      catOrder.forEach(c => {
        if (catMap[c] && catMap[c].length > 0) categories.push({ name: c, vehicles: catMap[c] });
      });
    } else if (m === "pbs") {
      // PBS: categorize by issue type
      const catMap: Record<string, typeof wipVehicles> = {};
      const catOrder = ["No Issue", "CKD", "Local", "Plastics", "Dismantled"];
      catOrder.forEach(c => { catMap[c] = []; });

      wipVehicles.forEach(v => {
        const issues = issueMap[v.id] || [];
        if (issues.length === 0) {
          catMap["No Issue"].push(v);
        } else {
          const issueText = issues.join(" ").toLowerCase();
          if (issueText.includes("ckd")) catMap["CKD"].push(v);
          else if (issueText.includes("plastic") || issueText.includes("سبيلر")) catMap["Plastics"].push(v);
          else if (issueText.includes("dismant") || issueText.includes("فك") || issueText.includes("تجميع")) catMap["Dismantled"].push(v);
          else catMap["Local"].push(v);
        }
        (v as any).issue = issues.join("; ") || "";
      });
      catOrder.forEach(c => {
        if (catMap[c] && catMap[c].length > 0) categories.push({ name: c, vehicles: catMap[c] });
      });
    } else {
      // WBS: Issue vs OK
      const catMap: Record<string, typeof wipVehicles> = { "Issue": [], "OK": [] };
      wipVehicles.forEach(v => {
        const issues = issueMap[v.id] || [];
        if (issues.length > 0) catMap["Issue"].push(v);
        else catMap["OK"].push(v);
        (v as any).issue = issues.join("; ") || "";
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

    // Helper: check page break
    const needSpace = (mm: number) => {
      if (y + mm > pageHeight - 15) { doc.addPage(); y = 15; }
    };

    // === HEADER ===
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(config.title, pageWidth / 2, y, { align: "center" });
    y += 7;
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text("Aboul Fotouh Automotive — MPC Department", pageWidth / 2, y, { align: "center" });
    y += 5;
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const now2 = new Date();
    const ts = now2.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " " + now2.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    doc.text(`Report Generated: ${ts} | Data: Live`, pageWidth / 2, y, { align: "center" });
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
      // Border left
      doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
      doc.rect(cx, y, 2, 20, "F");
      // Background
      doc.setFillColor(248, 250, 252);
      doc.rect(cx + 2, y, cardW - 2, 20, "F");
      // Label
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(71, 85, 105);
      doc.text(kpi.label.toUpperCase(), cx + 6, y + 7);
      // Value
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

    // === BAR CHART ===
    needSpace(45);
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
    drawBarChart(doc, 14, y, pageWidth / 2 - 20, 40, chartData);
    y += Math.max(categories.length * 15 + 5, 30);

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

      const detailHeaders = ["VIN", "Model", "Color", "Issue", "Entry Time"];
      const detailRows = cat.vehicles.map(v => [
        v.vin,
        v.lot_model || "—",
        v.actual_color_id ? (colorMap[v.actual_color_id] || "—") : "—",
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
          0: { cellWidth: 50 },   // VIN
          1: { cellWidth: 25 },   // Model
          2: { cellWidth: 15 },   // Color
          3: { cellWidth: 120 },  // Issue
          4: { cellWidth: 38 },   // Entry Time
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
      doc.text("Created By Eng. Waleed Mohamed - Planning Section", pageWidth / 2, pageHeight - 3, { align: "center" });
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
