import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PenTool, Loader2, Palette, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { STATIONS, type StationDef } from "@/lib/stations";
import { useColors } from "@/hooks/use-colors";
import type { StationCode } from "@/lib/db-types";
import { restoreArchivedBySuffix } from "@/lib/restore-archived";

export const Route = createFileRoute("/manual-entry")({
  head: () => ({ meta: [{ title: "Manual Entry — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

const STATIONS_FOR_ENTRY = STATIONS.filter(s => s.code !== "warehouse" && s.code !== "line_feeding");

const nextStationMap: Partial<Record<StationCode, StationCode>> = {
  wbs: "paint",
  paint: "tcf",
  pbs: "tcf",
  tcf: "waiting_repair",
  waiting_repair: "repair",
  repair: "cs",
  cs: "pdi",
  body_shop: "wbs",
};

function Page() {
  const { isStaff, isSuperuser } = useAuth();
  const nav = useNavigate();
  if (!isStaff && !isSuperuser) return <p className="text-muted-foreground">Access restricted.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Manual Entry</h1>
        <p className="text-muted-foreground text-sm">Bulk VIN paste for station IN/OUT and color assignment. Skips duplicates, processes valid entries.</p>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <BulkStationEntry />
        <ColorAssignment />
      </div>
    </div>
  );
}

/* ── Bulk Station IN/OUT ── */
function BulkStationEntry() {
  const [station, setStation] = useState<StationCode>("body_shop");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ processed: string[]; skipped: string[]; notFound: string[] } | null>(null);

  const vinList = useMemo(() =>
    paste.split(/[\s\n]+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 4),
    [paste]
  );

  const submit = async () => {
    if (vinList.length === 0) return toast.error("Paste VIN suffixes first");
    setBusy(true);
    setResults(null);

    const processed: string[] = [];
    const skipped: string[] = [];
    const notFound: string[] = [];

    // Batch lookup all suffixes
    const { data: vehicles } = await supabase.from("vehicles")
      .select("id, vin, vin_suffix, current_station, completed_at")
      .in("vin_suffix", vinList.map(v => v.slice(-5)))
      .is("completed_at", null);

    const user = (await supabase.auth.getUser()).data.user;

    for (const suffix of vinList) {
      const s5 = suffix.slice(-5);
      let match = (vehicles ?? []).find(v => v.vin_suffix === s5);

      // Archive-pull-on-scan: if not live, pull from archive (restores vehicle + history)
      if (!match) {
        try {
          const pulled = await restoreArchivedBySuffix(s5);
          if (pulled) match = { id: pulled.id, vin: pulled.vin, vin_suffix: pulled.vin_suffix, current_station: pulled.current_station as any, completed_at: null } as any;
        } catch { /* fall through to notFound */ }
      }

      if (!match) {
        notFound.push(s5);
        continue;
      }

      if (direction === "in") {
        if (match.current_station === station) {
          skipped.push(s5);
          continue;
        }
        // Process IN
        await supabase.from("station_events").insert({
          vehicle_id: match.id, station, kind: "in",
          recorded_by: user?.id ?? null, source: "manual", meta: null,
        });
        await supabase.from("vehicles").update({ current_station: station }).eq("id", match.id);
        processed.push(s5);
      } else {
        // OUT
        if (match.current_station !== station) {
          skipped.push(s5);
          continue;
        }
        const next = nextStationMap[station] ?? station;
        await supabase.from("station_events").insert({
          vehicle_id: match.id, station, kind: "out",
          recorded_by: user?.id ?? null, source: "manual", meta: null,
        });
        await supabase.from("vehicles").update({ current_station: next }).eq("id", match.id);
        processed.push(s5);
      }
    }

    setResults({ processed, skipped, notFound });

    const parts: string[] = [];
    if (processed.length > 0) parts.push(`${processed.length} ${direction === "in" ? "entered" : "released"}`);
    if (skipped.length > 0) parts.push(`${skipped.length} skipped (${direction === "in" ? "already in station" : "already exited"})`);
    if (notFound.length > 0) parts.push(`${notFound.length} not found`);

    if (processed.length > 0) toast.success(parts.join(", "));
    else toast.warning(parts.join(", "));

    setBusy(false);
  };

  const stDef = STATIONS.find(s => s.code === station);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4" /> Bulk Station IN/OUT
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Station</Label>
            <Select value={station} onValueChange={v => setStation(v as StationCode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATIONS_FOR_ENTRY.map(s => (
                  <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Direction</Label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDirection("in")}
                className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${direction === "in" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                IN
              </button>
              <button type="button" onClick={() => setDirection("out")}
                className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${direction === "out" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                OUT
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>VIN suffixes (paste from Excel, one per line or space-separated)</Label>
          <Textarea
            value={paste} onChange={e => setPaste(e.target.value)}
            className="font-mono text-xs" rows={6}
            placeholder="Paste VIN suffixes here...&#10;12345&#10;67890&#10;..."
          />
        </div>
        {vinList.length > 0 && (
          <p className="text-xs text-muted-foreground">{vinList.length} VIN(s) detected → {direction === "in" ? stDef?.label : `${stDef?.label} → ${nextStationMap[station] ?? station}`}</p>
        )}
        <Button disabled={busy || vinList.length === 0} onClick={submit} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PenTool className="h-4 w-4 mr-2" />}
          Process {direction.toUpperCase()} ({vinList.length})
        </Button>

        {results && (
          <div className="space-y-2 border rounded-md p-3 text-xs">
            {results.processed.length > 0 && (
              <div>
                <span className="font-medium text-success">Processed ({results.processed.length}):</span>{" "}
                <span className="font-mono">{results.processed.join(", ")}</span>
              </div>
            )}
            {results.skipped.length > 0 && (
              <div>
                <span className="font-medium text-warning">Skipped ({results.skipped.length}):</span>{" "}
                <span className="font-mono">{results.skipped.join(", ")}</span>
              </div>
            )}
            {results.notFound.length > 0 && (
              <div>
                <span className="font-medium text-destructive">Not found ({results.notFound.length}):</span>{" "}
                <span className="font-mono">{results.notFound.join(", ")}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Color Assignment ── */
function ColorAssignment() {
  const { activeList } = useColors();
  const [suffix, setSuffix] = useState("");
  const [pickedVin, setPickedVin] = useState<{ id: string; vin: string; vin_suffix: string; planned_color_id: string | null; actual_color_id: string | null } | null>(null);
  const [colorId, setColorId] = useState("");
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    const s = suffix.trim().toUpperCase();
    if (s.length < 4) return;
    const { data } = await supabase.from("vehicles")
      .select("id, vin, vin_suffix, planned_color_id, actual_color_id")
      .ilike("vin_suffix", `%${s.slice(-5)}`)
      .limit(5);
    if (data && data.length > 0) {
      setPickedVin(data[0]);
    } else {
      setPickedVin(null);
      toast.warning("No vehicle found");
    }
  };

  const assign = async () => {
    if (!pickedVin || !colorId) return;
    setBusy(true);
    const { error } = await supabase.from("vehicles")
      .update({ actual_color_id: colorId })
      .eq("id", pickedVin.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Color assigned to ${pickedVin.vin_suffix}`);
      setPickedVin({ ...pickedVin, actual_color_id: colorId });
    }
  };

  const getCode = (id: string | null) => {
    if (!id) return "—";
    const c = activeList.find(c => c.id === id);
    return c ? `${c.code} ${c.name}` : "—";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Palette className="h-4 w-4" /> Color Assignment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>VIN suffix (last 4-5 digits)</Label>
          <div className="flex gap-2">
            <input
              value={suffix} onChange={e => setSuffix(e.target.value)}
              className="flex-1 border rounded-md px-3 py-2 text-sm font-mono bg-background"
              placeholder="e.g. 12345"
              onKeyDown={e => { if (e.key === "Enter") lookup(); }}
            />
            <Button variant="outline" onClick={lookup} disabled={suffix.trim().length < 4}>Find</Button>
          </div>
        </div>

        {pickedVin && (
          <div className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-medium">{pickedVin.vin}</span>
              <Badge variant="secondary">{pickedVin.vin_suffix}</Badge>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Planned: <span className="font-medium">{getCode(pickedVin.planned_color_id)}</span></div>
              <div>Current: <span className="font-medium">{getCode(pickedVin.actual_color_id)}</span></div>
            </div>
            <div className="space-y-1.5">
              <Label>Assign color</Label>
              <select
                value={colorId} onChange={e => setColorId(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="">Select color...</option>
                {activeList.map(c => (
                  <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <Button disabled={busy || !colorId} onClick={assign} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Palette className="h-4 w-4 mr-2" />}
              Assign Color
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
