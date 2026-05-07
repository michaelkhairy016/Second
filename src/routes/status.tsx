import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProductionFlowDiagram } from "@/components/ProductionFlowDiagram";
import { StationDetailSheet } from "@/components/StationDetailSheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATIONS, stationByCode } from "@/lib/stations";
import { StatCard } from "@/components/StatCard";
import { Search, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { findBySuffix } from "@/lib/vin";
import type { Vehicle, Issue, StationCode } from "@/lib/db-types";

export const Route = createFileRoute("/status")({
  head: () => ({ meta: [{ title: "Status — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><StatusPage /></AppShell></RequireAuth>,
});

function StatusPage() {
  const { isStatus } = useAuth();

  if (!isStatus) return <p className="text-muted-foreground">Access restricted to status users.</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Factory Status</h1>
        <p className="text-muted-foreground text-sm">Read-only overview — production flow, WIP, and VIN lookup.</p>
      </div>

      <Tabs defaultValue="flow">
        <TabsList>
          <TabsTrigger value="flow">Production Flow</TabsTrigger>
          <TabsTrigger value="wip">Work In Progress</TabsTrigger>
          <TabsTrigger value="lookup">VIN Lookup</TabsTrigger>
        </TabsList>

        <TabsContent value="flow" className="mt-4">
          <FlowTab />
        </TabsContent>
        <TabsContent value="wip" className="mt-4">
          <WIPTab />
        </TabsContent>
        <TabsContent value="lookup" className="mt-4">
          <LookupTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FlowTab() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeIssues, setActiveIssues] = useState<Record<string, Issue[]>>({});
  const [resolvedIssues, setResolvedIssues] = useState<Record<string, Issue[]>>({});
  const [activeJobOrderIds, setActiveJobOrderIds] = useState<Set<string>>(new Set());
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: vs }, { data: ai }, { data: ri }, { data: jos }] = await Promise.all([
      supabase.from("vehicles").select("*"),
      supabase.from("issues").select("*").in("status", ["open", "in_progress"]),
      supabase.from("issues").select("*").in("status", ["resolved", "closed"]),
      supabase.from("job_orders").select("id").eq("status", "active"),
    ]);
    setVehicles(vs ?? []);
    setActiveJobOrderIds(new Set((jos ?? []).map(j => j.id)));

    const aiMap: Record<string, Issue[]> = {};
    (ai ?? []).forEach(i => { if (i.vehicle_id) (aiMap[i.vehicle_id] ??= []).push(i); });
    setActiveIssues(aiMap);

    const riMap: Record<string, Issue[]> = {};
    (ri ?? []).forEach(i => { if (i.vehicle_id) (riMap[i.vehicle_id] ??= []).push(i); });
    setResolvedIssues(riMap);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("status-flow")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_orders" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    vehicles.forEach(v => { if (v.current_station) c[v.current_station] = (c[v.current_station] ?? 0) + 1; });
    return c;
  }, [vehicles]);

  const lineFeedingCount = useMemo(() =>
    vehicles.filter(v => v.current_station === "warehouse" && v.job_order_id && activeJobOrderIds.has(v.job_order_id)).length,
    [vehicles, activeJobOrderIds]
  );

  const stationVehicles = useMemo(() => {
    if (!selectedStation) return [];
    if (selectedStation === "line_feeding") {
      return vehicles
        .filter(v => v.current_station === "warehouse" && v.job_order_id && activeJobOrderIds.has(v.job_order_id))
        .map(v => ({ ...v, activeIssues: activeIssues[v.id] ?? [], resolvedIssues: resolvedIssues[v.id] ?? [] }));
    }
    return vehicles
      .filter(v => v.current_station === selectedStation)
      .map(v => ({ ...v, activeIssues: activeIssues[v.id] ?? [], resolvedIssues: resolvedIssues[v.id] ?? [] }));
  }, [selectedStation, vehicles, activeJobOrderIds, activeIssues, resolvedIssues]);

  return (
    <>
      <ProductionFlowDiagram counts={counts} lineFeedingCount={lineFeedingCount} onStationClick={setSelectedStation} />
      <StationDetailSheet
        stationKey={selectedStation ?? ""}
        vehicles={stationVehicles}
        open={!!selectedStation}
        onOpenChange={(open) => { if (!open) setSelectedStation(null); }}
      />
    </>
  );
}

function WIPTab() {
  const [rows, setRows] = useState<{ station: string; count: number; vins: { vin: string; planned_color: string | null; actual_color: string | null; issues: { title: string; severity: string; status: string }[] }[] }[]>([]);
  const [openShortages, setOpenShortages] = useState(0);
  const [openIssues, setOpenIssues] = useState(0);

  useEffect(() => {
    const load = async () => {
      const [vsRes, issuesRes, shortagesRes] = await Promise.all([
        supabase.from("vehicles").select("id, vin, current_station, planned_color, actual_color"),
        supabase.from("issues").select("id, vehicle_id, title, severity, status").in("status", ["open", "in_progress"]),
        supabase.from("shortages").select("id", { count: "exact", head: true }).eq("status", "open"),
      ]);
      const vs = vsRes.data ?? [];
      setOpenShortages(shortagesRes.count ?? 0);
      setOpenIssues(issuesRes.count ?? 0);

      const issueMap: Record<string, { title: string; severity: string; status: string }[]> = {};
      (issuesRes.data ?? []).forEach(i => {
        if (i.vehicle_id) (issueMap[i.vehicle_id] ??= []).push({ title: i.title, severity: i.severity, status: i.status });
      });

      const wipStations = STATIONS.filter(s => s.code !== "warehouse" && s.code !== "pdi");
      setRows(wipStations.map(s => {
        const stationVehicles = vs.filter(v => v.current_station === s.code);
        return {
          station: s.label,
          count: stationVehicles.length,
          vins: stationVehicles.map(v => ({
            vin: v.vin,
            planned_color: v.planned_color,
            actual_color: v.actual_color,
            issues: issueMap[v.id] ?? [],
          })),
        };
      }));
    };
    load();
    const ch = supabase.channel("status-wip")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard label="Open issues" value={openIssues} tone={openIssues > 0 ? "warning" : "success"} />
        <StatCard label="Open shortages" value={openShortages} tone={openShortages > 0 ? "warning" : "success"} />
        <StatCard label="Stations in production" value={rows.filter(r => r.count > 0).length} />
      </div>

      {rows.map(r => (
        <Card key={r.station}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{r.station}</span>
              <Badge variant="secondary">{r.count} vehicle{r.count !== 1 ? "s" : ""}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {r.count === 0 ? (
              <p className="text-xs text-muted-foreground">No vehicles at this station.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VIN</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Issues</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.vins.map(v => (
                    <TableRow key={v.vin}>
                      <TableCell className="font-mono text-xs">{v.vin.length > 10 ? `…${v.vin.slice(-8)}` : v.vin}</TableCell>
                      <TableCell className="text-xs">{v.planned_color ?? "—"}</TableCell>
                      <TableCell className="text-xs">{v.actual_color ?? "—"}</TableCell>
                      <TableCell>
                        {v.issues.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {v.issues.map((iss, i) => (
                              <span key={i} className="flex items-center gap-1 text-xs">
                                {iss.status === "open" ? <AlertCircle className="h-3 w-3 text-warning" /> : <AlertCircle className="h-3 w-3 text-info" />}
                                <span>{iss.title}</span>
                                <Badge variant={iss.severity === "critical" ? "destructive" : iss.severity === "high" ? "warning" : "muted"} className="text-[10px] px-1 py-0">{iss.severity}</Badge>
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LookupTab() {
  const [suffix, setSuffix] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof findBySuffix>>>([]);
  const [vehicleDetails, setVehicleDetails] = useState<Record<string, { issues: { title: string; severity: string; status: string }[]; events: { station: string; kind: string; recorded_at: string }[] }>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const search = async (s: string) => {
    if (s.trim().length < 3) { setResults([]); return; }
    const data = await findBySuffix(s);
    setResults(data);
  };

  const expand = async (vehicleId: string, vin: string) => {
    if (expanded === vehicleId) { setExpanded(null); return; }
    setExpanded(vehicleId);
    if (vehicleDetails[vehicleId]) return;

    const [issRes, evRes] = await Promise.all([
      supabase.from("issues").select("title, severity, status").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }),
      supabase.from("station_events").select("station, kind, recorded_at").eq("vehicle_id", vehicleId).order("recorded_at", { ascending: false }).limit(20),
    ]);
    setVehicleDetails(prev => ({
      ...prev,
      [vehicleId]: {
        issues: (issRes.data ?? []) as { title: string; severity: string; status: string }[],
        events: (evRes.data ?? []) as { station: string; kind: string; recorded_at: string }[],
      },
    }));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">VIN Lookup</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={suffix}
              onChange={e => { setSuffix(e.target.value); search(e.target.value); }}
              placeholder="Last 4–5 digits of VIN"
              className="font-mono text-lg tracking-widest"
              inputMode="numeric"
            />
          </div>

          {results.length === 0 && suffix.trim().length >= 3 && (
            <p className="text-xs text-muted-foreground">No vehicles found.</p>
          )}

          {results.map(v => (
            <div key={v.id} className="border rounded-md">
              <button
                onClick={() => expand(v.id, v.vin)}
                className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono">{v.vin}</span>
                  <Badge variant="secondary">{v.current_station ?? "—"}</Badge>
                  {v.planned_color && <span className="text-xs text-muted-foreground">Plan: {v.planned_color}</span>}
                  {v.actual_color && <span className="text-xs text-muted-foreground">Actual: {v.actual_color}</span>}
                </div>
                <Search className="h-3 w-3 text-muted-foreground" />
              </button>

              {expanded === v.id && vehicleDetails[v.id] && (
                <div className="border-t px-3 py-2 space-y-2">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Station History</div>
                    <div className="flex flex-wrap gap-1">
                      {vehicleDetails[v.id].events.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No events recorded.</span>
                      ) : (
                        vehicleDetails[v.id].events.map((e, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5">
                            <Badge variant={e.kind === "in" ? "info" : "success"} className="text-[10px] px-1 py-0">{e.kind.toUpperCase()}</Badge>
                            {stationByCode(e.station)?.short ?? e.station}
                            <span className="text-muted-foreground">{new Date(e.recorded_at).toLocaleDateString()}</span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Issues ({vehicleDetails[v.id].issues.length})
                    </div>
                    {vehicleDetails[v.id].issues.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No issues recorded.</span>
                    ) : (
                      <div className="space-y-1">
                        {vehicleDetails[v.id].issues.map((iss, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            {iss.status === "open" || iss.status === "in_progress" ? (
                              <XCircle className="h-3 w-3 text-warning" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 text-success" />
                            )}
                            <span>{iss.title}</span>
                            <Badge variant={iss.severity === "critical" ? "destructive" : iss.severity === "high" ? "warning" : "muted"} className="text-[10px] px-1 py-0">{iss.severity}</Badge>
                            <Badge variant={iss.status === "open" ? "warning" : "success"} className="text-[10px] px-1 py-0">{iss.status}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
