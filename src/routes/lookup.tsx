import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Search } from "lucide-react";
import { useState } from "react";
import { findBySuffix } from "@/lib/vin";
import type { VehicleSearchResult } from "@/lib/db-types";
import { supabase } from "@/integrations/supabase/client";
import { stationByCode } from "@/lib/stations";

export const Route = createFileRoute("/lookup")({
  head: () => ({ meta: [{ title: "Vehicle Lookup — Nexus-Flow" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VehicleSearchResult[]>([]);
  const [selected, setSelected] = useState<VehicleSearchResult | null>(null);
  const [events, setEvents] = useState<{ id: string; station: string; kind: string; color_used: string | null; recorded_at: string }[]>([]);

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
      .select("id, station, kind, color_used, recorded_at")
      .eq("vehicle_id", v.id)
      .order("recorded_at", { ascending: false })
      .limit(20);
    setEvents(data ?? []);
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Stations</button>
      <div>
        <h1 className="text-2xl font-semibold">Vehicle Lookup</h1>
        <p className="text-muted-foreground text-sm">Search by VIN or last 5 digits.</p>
      </div>

      <div className="flex gap-2">
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
                    <span className="text-xs text-muted-foreground">{stationByCode(v.current_station ?? "")?.label ?? v.current_station ?? "—"}</span>
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
                <div className="font-medium">{stationByCode(selected.current_station ?? "")?.label ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Lot tail</div>
                <div>{selected.is_lot_tail ? <Badge variant="warning">Yes — {selected.tail_note ?? "Flagged"}</Badge> : <Badge variant="muted">No</Badge>}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Planned color</div>
                <div className="font-mono">{selected.planned_color ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Actual color</div>
                <div className="font-mono">{selected.actual_color ?? "—"}</div>
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
                        {e.color_used && <Badge variant="secondary">{e.color_used}</Badge>}
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
