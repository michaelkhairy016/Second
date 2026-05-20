import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import jsPDF from "https://esm.sh/jspdf@2.5.2";
import autotable from "https://esm.sh/jspdf-autotable@3.8.4";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const MODULE_CONFIG: Record<string, { title: string; stations: string[]; color: number[] }> = {
  pbs: { title: "PBS Report", stations: ["pbs", "tcf", "cs", "pdi"], color: [39, 174, 96] },
  wbs: { title: "WBS + Paint Report", stations: ["wbs", "paint", "body_shop"], color: [41, 128, 185] },
  shortage: { title: "Shortage Report", stations: ["shortage"], color: [211, 84, 0] },
};

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
    const { date, module }: { date?: string; module?: string } = await req.json().catch(() => ({}));
    const reportDate = date ?? new Date().toISOString().slice(0, 10);
    const mod = module ?? "pbs";
    const config = MODULE_CONFIG[mod] ?? MODULE_CONFIG.pbs;

    const env = Deno.env.toObject() as Env;
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    const dayStart = `${reportDate}T00:00:00`;
    const dayEnd = `${reportDate}T23:59:59`;

    const [eventsRes, lotsRes, shortagesRes] = await Promise.all([
      supabase.from("station_events").select("station, kind, recorded_at, vehicle_id").gte("recorded_at", dayStart).lte("recorded_at", dayEnd),
      supabase.from("lots").select("id, model"),
      mod === "shortage" ? supabase.from("shortages").select("*, vehicle:vehicles(vin, vin_suffix)").gte("created_at", dayStart).lte("created_at", dayEnd).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ]);

    const events = eventsRes.data ?? [];
    const lots = lotsRes.data ?? [];
    const lotMap = Object.fromEntries(lots.map((l: any) => [l.id, l.model]));

    // Build vehicle model map
    const vehicleIds = [...new Set(events.map((e: any) => e.vehicle_id))];
    const { data: vData } = await supabase.from("vehicles").select("id, lot_id").in("id", vehicleIds);
    const vModel = new Map<string, string>();
    (vData ?? []).forEach((v: any) => {
      if (v.lot_id && lotMap[v.lot_id]) vModel.set(v.id, lotMap[v.lot_id]);
    });

    const modelSet = new Set<string>();
    vModel.forEach(m => modelSet.add(m));
    lots.forEach((l: any) => modelSet.add(l.model));
    const models = Array.from(modelSet).sort();

    // Generate PDF
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 10;

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(config.title, pageWidth / 2, y, { align: "center" });
    y += 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${reportDate}`, pageWidth / 2, y, { align: "center" });
    y += 8;

    if (mod === "shortage") {
      // Shortage-specific report
      const shortages = (shortagesRes as any).data ?? [];
      const reasonLabels: Record<string, string> = {
        ckd: "CKD", local: "Local", unavailable_factory: "Unavailable in Factory",
        missing_plastics: "Missing (Plastics)", missing_paint_miscolored: "Missing (Paint/Miscolored)",
        general_missing: "General Missing",
      };

      // Summary by reason
      const byReason: Record<string, number> = {};
      shortages.forEach((s: any) => {
        const r = s.shortage_reason ?? (s.part_type === "ckd" ? "ckd" : "local");
        byReason[r] = (byReason[r] ?? 0) + 1;
      });

      doc.setFontSize(11);
      doc.text("Shortages by Reason", 14, y);
      y += 2;
      (autotable as any)(doc, {
        startY: y,
        head: [["Reason", "Count"]],
        body: Object.entries(byReason).map(([r, c]) => [reasonLabels[r] ?? r, String(c)]),
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: config.color, textColor: 255 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      // Detail table
      if (y > 170) { doc.addPage(); y = 10; }
      doc.setFontSize(11);
      doc.text("Shortage Details", 14, y);
      y += 2;
      (autotable as any)(doc, {
        startY: y,
        head: [["VIN", "Parts", "Reason", "Status", "Notes"]],
        body: shortages.map((s: any) => [
          (s.vehicle as any)?.vin ?? "—",
          (s.parts as string[]).join(", "),
          reasonLabels[s.shortage_reason] ?? s.shortage_reason ?? s.part_type ?? "—",
          s.status,
          s.notes ?? "",
        ]),
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: config.color, textColor: 255 },
      });
    } else {
      // PBS / WBS station activity report
      const stationLabels: Record<string, string> = {
        body_shop: "Body", wbs: "WBS", paint: "Paint", pbs: "PBS",
        tcf: "TCF", cs: "C.S", pdi: "PDI",
      };

      const stationIns: Record<string, Record<string, number>> = {};
      const stationOuts: Record<string, Record<string, number>> = {};
      config.stations.forEach(code => {
        stationIns[code] = {};
        stationOuts[code] = {};
        models.forEach(m => { stationIns[code][m] = 0; stationOuts[code][m] = 0; });
      });

      events.forEach((e: any) => {
        const model = vModel.get(e.vehicle_id);
        if (!model) return;
        if (e.kind === "in" && stationIns[e.station]) stationIns[e.station][model] = (stationIns[e.station][model] ?? 0) + 1;
        if (e.kind === "out" && stationOuts[e.station]) stationOuts[e.station][model] = (stationOuts[e.station][model] ?? 0) + 1;
      });

      // IN table
      doc.setFontSize(11);
      doc.text("Vehicles IN by Station & Model", 14, y);
      y += 2;
      const inHeaders = ["Station", ...models, "Total"];
      const inRows = config.stations.map(code => {
        const total = models.reduce((s, m) => s + (stationIns[code][m] ?? 0), 0);
        return [stationLabels[code] ?? code, ...models.map(m => String(stationIns[code][m] ?? 0)), String(total)];
      });
      (autotable as any)(doc, {
        startY: y, head: [inHeaders], body: inRows,
        theme: "grid", styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: config.color, textColor: 255 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      // OUT table
      if (y > 170) { doc.addPage(); y = 10; }
      doc.setFontSize(11);
      doc.text("Vehicles OUT by Station & Model", 14, y);
      y += 2;
      const outHeaders = ["Station", ...models, "Total"];
      const outRows = config.stations.map(code => {
        const total = models.reduce((s, m) => s + (stationOuts[code][m] ?? 0), 0);
        return [stationLabels[code] ?? code, ...models.map(m => String(stationOuts[code][m] ?? 0)), String(total)];
      });
      (autotable as any)(doc, {
        startY: y, head: [outHeaders], body: outRows,
        theme: "grid", styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: config.color, textColor: 255 },
      });
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(`AFA Shopfloor — ${config.title} — Generated ${new Date().toISOString()}`, 14, doc.internal.pageSize.getHeight() - 5);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 5, { align: "right" });
    }

    const pdfBytes = doc.output("arraybuffer");
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${mod}-report-${reportDate}.pdf"`,
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
