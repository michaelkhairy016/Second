import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Search } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { findBySuffix, stripVinStars } from "@/lib/vin";
import { findEngineBySuffix } from "@/lib/engine";
import type { VehicleSearchResult, EngineSearchResult, Model, ModelTrim } from "@/lib/db-types";
import { supabase } from "@/integrations/supabase/client";
import { stationByCode, STATIONS } from "@/lib/stations";

export const Route = createFileRoute("/lookup")({
  head: () => ({ meta: [{ title: "Lookup — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const nav = useNavigate();

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Stations</button>
      <div>
        <h1 className="text-2xl font-semibold">Lookup</h1>
        <p className="text-muted-foreground text-sm">Search vehicles by VIN or engines by number.</p>
      </div>

      <Tabs defaultValue="vehicle">
        <TabsList className="w-full">
          <TabsTrigger value="vehicle" className="flex-1">Vehicle</TabsTrigger>
          <TabsTrigger value="engine" className="flex-1">Engine</TabsTrigger>
          <TabsTrigger value="model" className="flex-1">Model</TabsTrigger>
        </TabsList>
        <TabsContent value="vehicle">
          <VehicleLookup />
        </TabsContent>
        <TabsContent value="engine">
          <EngineLookup />
        </TabsContent>
        <TabsContent value="model">
          <ModelLookup />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function VehicleLookup() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VehicleSearchResult[]>([]);
  const [selected, setSelected] = useState<VehicleSearchResult | null>(null);
  const [events, setEvents] = useState<{ id: string; station: string; kind: string; color_used_id: string | null; recorded_at: string }[]>([]);
  const [shortageHistory, setShortageHistory] = useState<{ id: string; parts: string[]; shortage_reason: string | null; status: string; created_at: string; cleared_at: string | null }[]>([]);
  const [issueHistory, setIssueHistory] = useState<{ id: string; title: string; status: string; station: string; created_at: string }[]>([]);

  const handleSearch = async () => {
    const q = query.trim();
    if (q.length < 3) return;
    const data = await findBySuffix(q);
    setResults(data);
    setSelected(null);
    setEvents([]);
    setShortageHistory([]);
    setIssueHistory([]);
  };

  const selectVehicle = async (v: VehicleSearchResult) => {
    setSelected(v);
    const [evRes, shRes, issRes] = await Promise.all([
      supabase
        .from("station_events")
        .select("id, station, kind, color_used_id, recorded_at")
        .eq("vehicle_id", v.id)
        .order("recorded_at", { ascending: true }),
      supabase
        .from("shortages")
        .select("id, parts, shortage_reason, status, created_at, cleared_at")
        .eq("vehicle_id", v.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("issues")
        .select("id, title, status, station, created_at")
        .eq("vehicle_id", v.id)
        .order("created_at", { ascending: true }),
    ]);
    setEvents((evRes.data ?? []) as typeof events);
    setShortageHistory((shRes.data ?? []) as typeof shortageHistory);
    setIssueHistory((issRes.data ?? []) as typeof issueHistory);
  };

  // Group events by station, pair IN/OUT
  const stationTimeline = useMemo(() => {
    const stations: { station: string; inTime: string | null; outTime: string | null; color: string | null }[] = [];
    const stationMap = new Map<string, { station: string; inTime: string | null; outTime: string | null; color: string | null }>();

    events.forEach(e => {
      const key = e.station;
      if (!stationMap.has(key)) {
        const entry = { station: e.station, inTime: null as string | null, outTime: null as string | null, color: e.color_used_id };
        stationMap.set(key, entry);
        stations.push(entry);
      }
      const entry = stationMap.get(key)!;
      if (e.kind === "in") entry.inTime = e.recorded_at;
      if (e.kind === "out") entry.outTime = e.recorded_at;
    });
    return stations;
  }, [events]);

  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const fmtDuration = (inTime: string | null, outTime: string | null) => {
    if (!inTime) return "—";
    const end = outTime ? new Date(outTime).getTime() : Date.now();
    const ms = end - new Date(inTime).getTime();
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 24) return `${(hours / 24).toFixed(1)}d`;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mt-4">
        <div className="flex-1">
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Enter VIN or suffix..." className="font-mono" onKeyDown={e => e.key === "Enter" && handleSearch()} />
        </div>
        <button onClick={handleSearch} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 flex items-center gap-2">
          <Search className="h-4 w-4" /> Search
        </button>
      </div>

      {results.length > 0 && !selected && (
        <Card>
          <CardHeader><CardTitle className="text-base">{results.length} result{results.length !== 1 ? "s" : ""}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {results.map(v => (
                <li key={v.id}>
                  <button onClick={() => selectVehicle(v)} className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm">
                    <span className="font-mono">{v.vin}</span>
                    <span className="text-xs text-muted-foreground">{(v as any).is_archived ? "Archived" : (v as any).completed_at ? "Completed" : (stationByCode(v.current_station ?? "")?.label ?? v.current_station ?? "—")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {results.length === 0 && query.length >= 3 && (
        <p className="text-sm text-muted-foreground text-center py-4">No vehicles found for "{query}"</p>
      )}

      {selected && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base font-mono">{selected.vin}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Current Station</div>
                  <div className="font-medium">{(selected as any).is_archived ? "Archived" : (selected as any).completed_at ? "Completed" : (stationByCode(selected.current_station ?? "")?.label ?? "—")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Lot tail</div>
                  <div>{selected.is_lot_tail ? <Badge variant="warning">Yes — {selected.tail_note ?? "Flagged"}</Badge> : <Badge variant="muted">No</Badge>}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Planned color</div>
                  <div className="font-mono">{selected.planned_color_id ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Actual color</div>
                  <div className="font-mono">{selected.actual_color_id ?? "—"}</div>
                </div>
              </div>

              {/* Production Timeline */}
              <div>
                <h3 className="text-sm font-medium mb-2">Production Timeline ({stationTimeline.length} stations)</h3>
                {stationTimeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No events recorded.</p>
                ) : (
                  <div className="border rounded-md divide-y">
                    {stationTimeline.map((s, i) => (
                      <div key={i} className="px-3 py-2 grid grid-cols-4 gap-2 text-xs items-center">
                        <div className="font-medium">{stationByCode(s.station)?.label ?? s.station}</div>
                        <div className="text-muted-foreground">
                          <span className="text-blue-600">IN</span> {fmtTime(s.inTime)}
                        </div>
                        <div className="text-muted-foreground">
                          <span className="text-green-600">OUT</span> {fmtTime(s.outTime) ?? "—"}
                        </div>
                        <div className="font-medium text-right">
                          {fmtDuration(s.inTime, s.outTime)}
                          {!s.outTime && s.inTime && <span className="text-amber-600 ml-1">(current)</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={() => { setSelected(null); setEvents([]); setShortageHistory([]); setIssueHistory([]); }} className="text-sm text-muted-foreground hover:text-foreground">Back to results</button>
            </CardContent>
          </Card>

          {/* Issue History */}
          {issueHistory.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Issues ({issueHistory.length})</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-xs">
                  {issueHistory.map(i => (
                    <li key={i.id} className="py-2 flex items-center justify-between">
                      <div>
                        <span className="font-medium">{i.title}</span>
                        <span className="text-muted-foreground ml-2">at {stationByCode(i.station)?.label ?? i.station}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={i.status === "open" ? "destructive" : "success"} className="text-[10px] px-1.5">{i.status}</Badge>
                        <span className="text-muted-foreground">{new Date(i.created_at).toLocaleDateString("en-GB")}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Shortage History */}
          {shortageHistory.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Shortages ({shortageHistory.length})</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-xs">
                  {shortageHistory.map(s => (
                    <li key={s.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{(s.parts as string[]).join(", ")}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={s.status === "open" ? "destructive" : "success"} className="text-[10px] px-1.5">{s.status}</Badge>
                        </div>
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {s.shortage_reason ?? "—"} · Logged {new Date(s.created_at).toLocaleDateString("en-GB")}
                        {s.cleared_at && ` · Cleared ${new Date(s.cleared_at).toLocaleDateString("en-GB")}`}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function EngineLookup() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EngineSearchResult[]>([]);

  const handleSearch = async () => {
    const q = query.trim();
    if (q.length < 3) return;
    const data = await findEngineBySuffix(q);
    setResults(data as EngineSearchResult[]);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 mt-4">
        <Label>Engine number or last 4+ digits</Label>
        <div className="flex gap-2">
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. 4567" className="font-mono" onKeyDown={e => e.key === "Enter" && handleSearch()} />
          <button onClick={handleSearch} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 flex items-center gap-2">
            <Search className="h-4 w-4" /> Search
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{results.length} engine{results.length !== 1 ? "s" : ""} found</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {results.map(e => (
                <li key={e.id} className="py-3 flex items-center justify-between text-sm">
                  <div className="space-y-1">
                    <div className="font-mono font-medium">{e.engine_number}</div>
                    <div className="text-xs text-muted-foreground">
                      Lot: <b>{(e as any).lot?.lot_code ?? "—"}</b>
                      {(e as any).lot?.model && <span> · {(e as any).lot.model}</span>}
                    </div>
                  </div>
                  <Badge variant={e.status === "available" ? "success" : e.status === "assigned" ? "info" : "muted"}>
                    {e.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {results.length === 0 && query.length >= 3 && (
        <p className="text-sm text-muted-foreground text-center py-4">No engines found for "{query}"</p>
      )}
    </div>
  );
}

function ModelLookup() {
  const [models, setModels] = useState<Model[]>([]);
  const [trims, setTrims] = useState<ModelTrim[]>([]);
  const [modelName, setModelName] = useState("");
  const [trimName, setTrimName] = useState("");
  const [results, setResults] = useState<{ vin: string; current_station: string | null; lot_code: string | null }[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("models").select("id,name,active").eq("active", true).order("name"),
      supabase.from("model_trims").select("id,name,model_id,active,sort_order").eq("active", true).order("sort_order"),
    ]).then(([{ data: m }, { data: t }]) => {
      setModels(m ?? []);
      setTrims(t ?? []);
    });
  }, []);

  const selectedModel = models.find(m => m.name === modelName);
  const modelTrims = selectedModel ? trims.filter(t => t.model_id === selectedModel.id) : [];

  const handleSearch = async () => {
    if (!modelName) return;
    setSearched(true);

    // Build model string patterns to match in lots.model
    const patterns: string[] = [modelName];
    if (trimName) patterns.push(`${modelName} — ${trimName}`);

    // Get matching lots
    const { data: lots } = await supabase.from("lots").select("id, lot_code, model");
    const matchingLots = (lots ?? []).filter(l =>
      patterns.some(p => l.model === p) || (!trimName && l.model.startsWith(modelName))
    );

    if (matchingLots.length === 0) { setResults([]); return; }

    const lotIds = matchingLots.map(l => l.id);
    const lotMap = Object.fromEntries(matchingLots.map(l => [l.id, l.lot_code]));

    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("vin, current_station, lot_id")
      .in("lot_id", lotIds)
      .is("completed_at", null)
      .order("vin");

    setResults((vehicles ?? []).map(v => ({
      vin: v.vin,
      current_station: (v as any).current_station,
      lot_code: lotMap[v.lot_id ?? ""] ?? null,
    })));
  };

  // Group results by station
  const grouped = results.reduce<Record<string, typeof results>>((acc, v) => {
    const station = v.current_station ?? "unknown";
    acc[station] = acc[station] ?? [];
    acc[station].push(v);
    return acc;
  }, {});

  const stationOrder = STATIONS.map(s => s.code);
  const sortedStations = Object.keys(grouped).sort((a, b) => {
    const ai = stationOrder.indexOf(a as any);
    const bi = stationOrder.indexOf(b as any);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div className="space-y-4">
      <div className="space-y-3 mt-4">
        <div className="space-y-1.5">
          <Label>Model</Label>
          <Select value={modelName} onValueChange={v => { setModelName(v); setTrimName(""); setSearched(false); }}>
            <SelectTrigger><SelectValue placeholder="Select model..." /></SelectTrigger>
            <SelectContent>
              {models.map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {modelTrims.length > 0 && (
          <div className="space-y-1.5">
            <Label>Trim level</Label>
            <Select value={trimName} onValueChange={v => { setTrimName(v); setSearched(false); }}>
              <SelectTrigger><SelectValue placeholder="All trims" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All trims</SelectItem>
                {modelTrims.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <button onClick={handleSearch} disabled={!modelName} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50">
          <Search className="h-4 w-4" /> Search
        </button>
      </div>

      {searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No vehicles found for this model{trimName ? "/trim" : ""}.</p>
      )}

      {sortedStations.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{results.length} vehicle{results.length !== 1 ? "s" : ""} across {sortedStations.length} station{sortedStations.length !== 1 ? "s" : ""}</p>
          {sortedStations.map(station => (
            <Card key={station}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{stationByCode(station as any)?.label ?? station}</span>
                  <Badge variant="secondary">{grouped[station].length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y text-sm font-mono">
                  {grouped[station].map((v, i) => (
                    <li key={i} className="py-1.5 flex justify-between">
                      <span>{v.vin}</span>
                      <span className="text-xs text-muted-foreground">{v.lot_code}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
