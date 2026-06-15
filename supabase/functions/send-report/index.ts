import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import jsPDF from "https://esm.sh/jspdf@2.5.2";
import autotable from "https://esm.sh/jspdf-autotable@3.8.4";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
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
    const body = await req.json().catch(() => ({}));
    const reportDate = (body as any).date ?? new Date().toISOString().slice(0, 10);
    const requestedModules = (body as any).modules ?? ["timely"];

    const env = Deno.env.toObject() as Env;
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Load email settings
    const { data: emailSettings } = await supabase.from("app_settings").select("value").eq("key", "report_emails").single();
    const emails = (emailSettings?.value as any)?.emails ?? [];
    // Prefer edge-function secret; fall back to app_settings during migration
    const resendApiKey = (env.RESEND_API_KEY || (emailSettings?.value as any)?.resend_api_key) ?? "";

    if (!resendApiKey || emails.length === 0) {
      return new Response(JSON.stringify({ error: "No Resend API key or emails configured" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const monthStart = reportDate.slice(0, 8) + "01";

    // Fetch data (events via unified RPC so archived vehicles are counted)
    const [vehiclesRes, eventsRes, plansRes, lotsRes, mtdRes] = await Promise.all([
      supabase.from("vehicles").select("id, current_station, lot_id").is("completed_at", null),
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

    const modelSet = new Set<string>();
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

    const planMap: Record<string, { monthly: number; daily: number; jph: number }> = {};
    plans.forEach((p: any) => {
      if (p.model?.name) planMap[p.model.name] = { monthly: p.monthly_plan, daily: p.daily_target, jph: p.jph_target };
    });

    // Generate PDF
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 10;

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

    // Monthly Plan
    if (models.length > 0) {
      doc.setFontSize(11);
      doc.text("Monthly Plan Summary", 14, y);
      y += 2;
      const planHeaders = ["Model", "Monthly Plan", "Daily Target", "JPH Target", "Total Actual", "Achieved %"];
      const planRows = models.map(m => {
        const p = planMap[m] ?? { monthly: 0, daily: 0, jph: 0 };
        const totalOut = stations.reduce((s, st) => s + (outsPerStationModel[st.code]?.[m] ?? 0), 0);
        return [m, String(p.monthly), String(p.daily), String(p.jph), String(totalOut), p.monthly > 0 ? ((totalOut / p.monthly) * 100).toFixed(1) + "%" : "-"];
      });
      (autotable as any)(doc, { startY: y, head: [planHeaders], body: planRows, theme: "grid", styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [41, 128, 185], textColor: 255 } });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // Station Activity
    if (y > 170) { doc.addPage(); y = 10; }
    doc.setFontSize(11);
    doc.text("Daily Station Outs", 14, y);
    y += 2;
    const stHeaders = ["Station", ...models, "Total"];
    const stRows = stations.map(st => {
      const total = models.reduce((s, m) => s + (outsPerStationModel[st.code]?.[m] ?? 0), 0);
      return [st.label, ...models.map(m => String(outsPerStationModel[st.code]?.[m] ?? 0)), String(total)];
    });
    (autotable as any)(doc, { startY: y, head: [stHeaders], body: stRows, theme: "grid", styles: { fontSize: 7, cellPadding: 1.5 }, headStyles: { fillColor: [39, 174, 96], textColor: 255 } });
    y = (doc as any).lastAutoTable.finalY + 8;

    // JPH
    if (y > 170) { doc.addPage(); y = 10; }
    doc.setFontSize(11);
    doc.text("JPH Summary", 14, y);
    y += 2;
    const elapsedHours = Math.max((Date.now() - new Date(`${reportDate}T00:00:00`).getTime()) / 3600000, 1);
    const jphRows = stations.map(st => {
      const total = models.reduce((s, m) => s + (outsPerStationModel[st.code]?.[m] ?? 0), 0);
      return [st.label, String(total), (total / elapsedHours).toFixed(1)];
    });
    (autotable as any)(doc, { startY: y, head: [["Station", "Total Out", "JPH"]], body: jphRows, theme: "grid", styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [211, 84, 0], textColor: 255 } });

    const pageCount = doc.getNumberOfPages();
    const pageHeight = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text("Created By Michael Amgad Khairy - Planning Section", pageWidth / 2, pageHeight - 3, { align: "center" });
    }

    const pdfBase64 = doc.output("datauristring").split(",")[1];

    // Build attachments list
    const attachments = [{ filename: `timely-report-${reportDate}.pdf`, content: pdfBase64 }];

    // If dashboard modules requested, generate those PDFs too
    if (requestedModules.length > 0 && requestedModules[0] !== "timely") {
      const dashboardUrl = `${env.SUPABASE_URL}/functions/v1/dashboard-report`;
      for (const mod of requestedModules) {
        try {
          const modRes = await fetch(dashboardUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ date: reportDate, module: mod }),
          });
          if (modRes.ok) {
            const modBuffer = await modRes.arrayBuffer();
            const modBase64 = btoa(String.fromCharCode(...new Uint8Array(modBuffer)));
            attachments.push({ filename: `${mod}-report-${reportDate}.pdf`, content: modBase64 });
          }
        } catch (e) { console.error(`Failed to generate ${mod} report:`, e); }
      }
    }

    // Build summary HTML table
    let summaryHtml = `<h2>Production Report — ${reportDate}</h2><p>See attached PDFs.</p>`;
    summaryHtml += `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:12px">`;
    summaryHtml += `<tr style="background:#2980b9;color:white"><th>Station</th>`;
    models.forEach(m => { summaryHtml += `<th>${m}</th>`; });
    summaryHtml += `<th>Total OUT</th></tr>`;
    stations.forEach(st => {
      const total = models.reduce((s, m) => s + (outsPerStationModel[st.code]?.[m] ?? 0), 0);
      summaryHtml += `<tr><td>${st.label}</td>`;
      models.forEach(m => { summaryHtml += `<td style="text-align:center">${outsPerStationModel[st.code]?.[m] ?? 0}</td>`; });
      summaryHtml += `<td style="text-align:center;font-weight:bold">${total}</td></tr>`;
    });
    summaryHtml += `</table>`;

    // Send via Resend
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "AFA Shopfloor <reports@resend.dev>",
        to: emails,
        subject: `Production Report — ${reportDate}`,
        html: summaryHtml,
        attachments,
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("Resend error:", errText);
      return new Response(JSON.stringify({ error: "Failed to send email", details: errText }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response(JSON.stringify({ success: true, sentTo: emails }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: any) {
    console.error("send-report error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
