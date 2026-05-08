import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { stationByCode } from "@/lib/stations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { StationCode } from "@/lib/db-types";

export const Route = createFileRoute("/bulk/$code")({
  head: ({ params }) => ({ meta: [{ title: `Bulk ${stationByCode(params.code)?.label} — AFA Shopfloor` }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { code } = Route.useParams();
  const station = stationByCode(code);
  const { isStaff, isSuperuser } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!(isStaff || isSuperuser)) { toast.error("Staff only"); nav({ to: "/" }); } }, [isStaff, isSuperuser, nav]);

  const [text, setText] = useState("");
  const [kind, setKind] = useState<"in" | "out">("in");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ matched: number; missing: string[] } | null>(null);

  if (!station) return null;

  const run = async () => {
    setBusy(true); setReport(null);
    try {
      const tokens = text.split(/\s+|[,;]/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (tokens.length === 0) throw new Error("Paste at least one VIN or suffix");

      // Look them up: support full VIN or suffix — exclude completed vehicles
      const matched: { id: string; vin: string }[] = [];
      const missing: string[] = [];
      for (const t of tokens) {
        const q = t.length === 17
          ? supabase.from("vehicles").select("id, vin").eq("vin", t).is("completed_at", null).maybeSingle()
          : supabase.from("vehicles").select("id, vin").ilike("vin_suffix", `%${t.slice(-5)}`).is("completed_at", null).limit(1).maybeSingle();
        const { data } = await q;
        if (data) matched.push(data); else missing.push(t);
      }
      if (matched.length === 0) throw new Error("No vehicles found");

      const user = (await supabase.auth.getUser()).data.user;
      const events = matched.map(m => ({ vehicle_id: m.id, station: station.code as StationCode, kind, recorded_by: user?.id, source: "bulk" }));
      const { error: ee } = await supabase.from("station_events").insert(events);
      if (ee) throw ee;
      await supabase.from("vehicles").update({ current_station: station.code }).in("id", matched.map(m => m.id));
      // Mark vehicles as completed when they exit PDI
      if (kind === "out" && station.code === "pdi") {
        await supabase.from("vehicles").update({ completed_at: new Date().toISOString() }).in("id", matched.map(m => m.id));
      }
      setReport({ matched: matched.length, missing });
      toast.success(`Updated ${matched.length} vehicles`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Stations</button>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-lg bg-info/10 text-info grid place-items-center"><station.icon className="h-6 w-6" /></div>
        <div><h1 className="text-xl font-semibold">Bulk: {station.label}</h1><p className="text-sm text-muted-foreground">Paste a column from Excel — full VINs or suffixes.</p></div>
      </div>

      <Card><CardContent className="pt-6 space-y-3">
        <div className="space-y-1.5"><Label>VIN list</Label>
          <Textarea rows={10} value={text} onChange={e => setText(e.target.value)} placeholder="Paste one VIN per line" className="font-mono text-xs" />
        </div>
        <div className="flex gap-2 items-center">
          <Label className="text-sm">Direction</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "in" | "out")}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="in">IN to {station.label}</SelectItem>
              <SelectItem value="out">OUT of {station.label}</SelectItem>
            </SelectContent>
          </Select>
          <Button className="ml-auto" disabled={busy} onClick={run}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply to all"}</Button>
        </div>
        {report && (
          <div className="text-sm space-y-1 pt-2 border-t">
            <div className="text-success">✓ Matched: {report.matched}</div>
            {report.missing.length > 0 && <details><summary className="text-warning text-xs cursor-pointer">Not found: {report.missing.length}</summary><div className="font-mono text-xs mt-1">{report.missing.join("\n")}</div></details>}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
