import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import jsPDF from "https://esm.sh/jspdf@2.5.2";
import autotable from "https://esm.sh/jspdf-autotable@3.8.4";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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

    // Fetch data
    const monthStart = reportDate.slice(0, 8) + "01";
    const [vehiclesRes, eventsRes, plansRes, lotsRes, mtdRes] = await Promise.all([
      supabase.from("vehicles").select("id, current_station, lot_id").is("completed_at", null),
      supabase.from("station_events").select("station, kind, recorded_at, vehicle_id").gte("recorded_at", `${reportDate}T00:00:00`).lte("recorded_at", `${reportDate}T23:59:59`),
      supabase.from("production_plans").select("monthly_plan, daily_target, jph_target, model:models(name)").eq("month", monthStart),
      supabase.from("lots").select("id, model"),
      supabase.from("factory_calendar").select("working_hours").gte("date", monthStart).lte("date", reportDate).eq("is_working_day", true),
    ]);

    const vehicles = vehiclesRes.data ?? [];
    const events = eventsRes.data ?? [];
    const plans = plansRes.data ?? [];
    const lots = lotsRes.data ?? [];
    const lotMap = Object.fromEntries(lots.map((l: any) => [l.id, l.model]));

    // Build vehicle model map
    const vModel = new Map<string, string>();
    vehicles.forEach((v: any) => {
      if (v.lot_id && lotMap[v.lot_id]) vModel.set(v.id, lotMap[v.lot_id]);
    });

    // Get unique models
    const modelSet = new Set<string>();
    vehicles.forEach((v: any) => { if (vModel.has(v.id)) modelSet.add(vModel.get(v.id)!); });
    plans.forEach((p: any) => { if (p.model?.name) modelSet.add(p.model.name); });
    const models = Array.from(modelSet).sort();

    // Station definitions
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

    // Count outs per station per model
    const outsPerStationModel: Record<string, Record<string, number>> = {};
    stations.forEach(s => { outsPerStationModel[s.code] = {}; models.forEach(m => { outsPerStationModel[s.code][m] = 0; }); });
    events.filter((e: any) => e.kind === "out").forEach((e: any) => {
      const model = vModel.get(e.vehicle_id);
      if (model && outsPerStationModel[e.station]) {
        outsPerStationModel[e.station][model] = (outsPerStationModel[e.station][model] ?? 0) + 1;
      }
    });

    // Count ins per station per model
    const insPerStationModel: Record<string, Record<string, number>> = {};
    stations.forEach(s => { insPerStationModel[s.code] = {}; models.forEach(m => { insPerStationModel[s.code][m] = 0; }); });
    events.filter((e: any) => e.kind === "in").forEach((e: any) => {
      const model = vModel.get(e.vehicle_id);
      if (model && insPerStationModel[e.station]) {
        insPerStationModel[e.station][model] = (insPerStationModel[e.station][model] ?? 0) + 1;
      }
    });

    // WIP per station per model
    const wipPerStationModel: Record<string, Record<string, number>> = {};
    stations.forEach(s => { wipPerStationModel[s.code] = {}; models.forEach(m => { wipPerStationModel[s.code][m] = 0; }); });
    vehicles.forEach((v: any) => {
      const model = vModel.get(v.id);
      if (model && v.current_station && wipPerStationModel[v.current_station]) {
        wipPerStationModel[v.current_station][model] = (wipPerStationModel[v.current_station][model] ?? 0) + 1;
      }
    });

    // Plan map
    const planMap: Record<string, { monthly: number; daily: number; jph: number }> = {};
    plans.forEach((p: any) => {
      if (p.model?.name) planMap[p.model.name] = { monthly: p.monthly_plan, daily: p.daily_target, jph: p.jph_target };
    });

    // Generate PDF
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 10;

    // Title
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Timely Production Report", pageWidth / 2, y, { align: "center" });
    y += 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${reportDate}`, pageWidth / 2, y, { align: "center" });
    y += 5;
    const mtdHours = (mtdRes.data ?? []).reduce((sum: number, r: any) => sum + (r.working_hours ?? 0), 0);
    doc.setFontSize(8);
    doc.text(`Month-to-Date Working Hours: ${mtdHours}h`, pageWidth / 2, y, { align: "center" });
    y += 8;

    // Monthly Plan Summary
    if (models.length > 0) {
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
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

    // Daily Station Activity
    if (y > 170) { doc.addPage(); y = 10; }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
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

    // WIP Summary
    if (y > 170) { doc.addPage(); y = 10; }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
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

    // JPH Summary
    if (y > 170) { doc.addPage(); y = 10; }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
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

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(`AFA Shopfloor — Generated ${new Date().toISOString()}`, 14, doc.internal.pageSize.getHeight() - 5);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 5, { align: "right" });
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
