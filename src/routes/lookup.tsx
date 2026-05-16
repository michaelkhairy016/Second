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
import { useState, useEffect } from "react";
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

  const handleSearch = async () => {
    const q = query.trim();
    if (q.length < 3) return;
    const data = await findBySuffix(q);
    setResults(data);
    setSelected(null);
    setEvents([]);
  };

  const selectVehicle = async (v: VehicleSearchResult) => {
    setSelected(v);
    const { data } = await supabase
      .from("station_events")
      .select("id, station, kind, color_used_id, recorded_at")
      .eq("vehicle_id", v.id)
      .order("recorded_at", { ascending: false })
      .limit(20);
    setEvents(data ?? []);
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

            <div>
              <h3 className="text-sm font-medium mb-2">Event history ({events.length})</h3>
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events recorded.</p>
              ) : (
                <ul className="divide-y border rounded-md">
                  {events.map(e => (
                    <li key={e.id} className="px-3 py-2 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant={e.kind === "in" ? "info" : "success"}>{e.kind.toUpperCase()}</Badge>
                        <span className="text-muted-foreground">{stationByCode(e.station)?.label ?? e.station}</span>
                        {e.color_used_id && <Badge variant="secondary">{e.color_used_id}</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(e.recorded_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button onClick={() => { setSelected(null); setEvents([]); }} className="text-sm text-muted-foreground hover:text-foreground">Back to results</button>
          </CardContent>
        </Card>
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
