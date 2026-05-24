import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STATIONS, stationByCode } from "@/lib/stations";
import { CheckCircle2, FileSpreadsheet, FileDown, Loader2 } from "lucide-react";
import { exportToCSV } from "@/lib/export";
import type { StationCode } from "@/lib/db-types";

export const Route = createFileRoute("/delayed")({
  head: () => ({ meta: [{ title: "Delayed — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><DelayedPage /></AppShell></RequireAuth>,
});

interface DelayedVehicle {
  vehicle_id: string;
  vin: string;
  vin_suffix: string;
  current_station: string;
  entered_at: string;
  working_hours_at_station: number;
  working_days_at_station: number;
  lot_code: string | null;
  lot_model: string | null;
  job_order_id: string | null;
}

interface VehicleDetail {
  vin: string;
  current_station: string | null;
  lot_code: string | null;
  lot_model: string | null;
  job_order_name: string | null;
  actual_color_id: string | null;
  issues: { title: string; status: string; station: string; created_at: string }[];
  shortages: { parts: string[]; status: string; shortage_reason: string | null; created_at: string }[];
}

function DelayedPage() {
  const { isSuperuser, isStaff } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!isSuperuser && !isStaff) nav({ to: "/" });
  }, [isSuperuser, isStaff, nav]);

  const [globalThreshold, setGlobalThreshold] = useState(2);
  const [localThreshold, setLocalThreshold] = useState(2);
  const [vehicles, setVehicles] = useState<DelayedVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [vehicleIssues, setVehicleIssues] = useState<Map<string, string[]>>(new Map());
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const generatePdfReport = async () => {
    setGeneratingPdf(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/timely-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) }),
      });
      if (!res.ok) throw new Error("Failed to generate report");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `timely-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("PDF generation error:", e);
    } finally {
      setGeneratingPdf(false);
    }
  };

  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", "delay_threshold").single().then(({ data }) => {
      if (data?.value && typeof data.value === "object") {
        const days = (data.value as any).days ?? 2;
        setGlobalThreshold(days);
        setLocalThreshold(days);
      }
    });
  }, []);

  const loadDelayed = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_delayed_vehicles", { threshold_days: localThreshold });
    if (error) {
      console.error("Error loading delayed vehicles:", error);
      setVehicles([]);
    } else {
      const delayed = (data as unknown) as DelayedVehicle[];
      setVehicles(delayed);

      // Batch fetch open issues for delayed vehicles (single query)
      if (delayed.length > 0) {
        const ids = delayed.map(v => v.vehicle_id);
        const { data: issuesData } = await supabase
          .from("issues")
          .select("vehicle_id, title")
          .in("vehicle_id", ids)
          .in("status", ["open", "in_progress"]);
        const m = new Map<string, string[]>();
        (issuesData ?? []).forEach((i: any) => {
          if (!m.has(i.vehicle_id)) m.set(i.vehicle_id, []);
          m.get(i.vehicle_id)!.push(i.title);
        });
        setVehicleIssues(m);
      }
    }
    setLoading(false);
  }, [localThreshold]);

  useEffect(() => {
    loadDelayed();
    const ch = supabase.channel("delayed-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, loadDelayed)
      .on("postgres_changes", { event: "*", schema: "public", table: "station_events" }, loadDelayed)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadDelayed]);

  const loadDetail = async (v: DelayedVehicle) => {
    setDetailLoading(true);
    setDetail(null);
    const [vRes, issRes, shRes, joRes] = await Promise.all([
      supabase.from("vehicles").select("vin, current_station, lot_id, actual_color_id, job_order_id").eq("id", v.vehicle_id).maybeSingle(),
      supabase.from("issues").select("title, status, station, created_at").eq("vehicle_id", v.vehicle_id).order("created_at", { ascending: false }).limit(10),
      supabase.from("shortages").select("parts, status, shortage_reason, created_at").eq("vehicle_id", v.vehicle_id).order("created_at", { ascending: false }).limit(5),
      v.job_order_id
        ? supabase.from("job_orders").select("name").eq("id", v.job_order_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const vehicle = vRes.data as any;
    let lotCode = v.lot_code;
    let lotModel = v.lot_model;
    if (vehicle?.lot_id) {
      const { data: lot } = await supabase.from("lots").select("lot_code, model").eq("id", vehicle.lot_id).maybeSingle();
      if (lot) { lotCode = lot.lot_code; lotModel = lot.model; }
    } else if (vehicle?.job_order_id) {
      const { data: jol } = await supabase.from("job_order_lots").select("lot_id").eq("job_order_id", vehicle.job_order_id).limit(1).maybeSingle();
      if (jol?.lot_id) {
        const { data: lot } = await supabase.from("lots").select("lot_code, model").eq("id", jol.lot_id).maybeSingle();
        if (lot) { lotCode = lot.lot_code; lotModel = lot.model; }
      }
    }
    setDetail({
      vin: vehicle?.vin ?? v.vin,
      current_station: vehicle?.current_station ?? v.current_station,
      lot_code: lotCode ?? null,
      lot_model: lotModel ?? null,
      job_order_name: (joRes.data as any)?.name ?? null,
      actual_color_id: vehicle?.actual_color_id ?? null,
      issues: (issRes.data ?? []) as any[],
      shortages: (shRes.data ?? []) as any[],
    });
    setDetailLoading(false);
  };

  const handleExport = () => {
    const flatRows = vehicles.map(v => ({
      "VIN": v.vin,
      "VIN Suffix": v.vin_suffix,
      "Station": stationByCode(v.current_station as StationCode)?.label ?? v.current_station,
      "Entered At": v.entered_at,
      "Working Days": v.working_days_at_station,
      "Days Over Threshold": v.working_days_at_station - localThreshold,
      "Lot Code": v.lot_code ?? "",
      "Model": v.lot_model ?? "",
      "State": (vehicleIssues.get(v.vehicle_id)?.length ?? 0) > 0 ? "Has Issue" : "OK",
    }));
    if (flatRows.length > 0) {
      exportToCSV(flatRows, `delayed-vehicles-${new Date().toISOString().slice(0, 10)}`);
    }
  };

  const getRowClass = (days: number) => {
    const overThreshold = days - localThreshold;
    if (overThreshold >= 3) return "bg-destructive/10";
    if (overThreshold >= 1) return "bg-yellow-500/10";
    return "";
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Delayed Vehicles</h1>
        <p className="text-muted-foreground text-sm">Vehicles exceeding the delay threshold at their current station.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Delayed Report</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="threshold" className="text-sm text-muted-foreground">Threshold:</label>
                <Input
                  id="threshold"
                  type="number"
                  min={0}
                  max={30}
                  value={localThreshold}
                  onChange={e => setLocalThreshold(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-16 h-8"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={vehicles.length === 0}>
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Export CSV
              </Button>
              {isSuperuser && (
                <Button variant="outline" size="sm" onClick={generatePdfReport} disabled={generatingPdf}>
                  {generatingPdf ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileDown className="h-4 w-4 mr-1" />} PDF Report
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading delayed vehicles...</p>
          ) : vehicles.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-2" />
              <p className="text-muted-foreground">No delayed vehicles</p>
              <p className="text-xs text-muted-foreground">All vehicles are within the {localThreshold}-day threshold.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VIN</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Station</TableHead>
                    <TableHead>Entered</TableHead>
                    <TableHead>Working Hours</TableHead>
                    <TableHead>Working Days</TableHead>
                    <TableHead>Over Threshold</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Model</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map(v => {
                    const issues = vehicleIssues.get(v.vehicle_id) ?? [];
                    const hasIssue = issues.length > 0;
                    return (
                      <TableRow key={v.vehicle_id} className={getRowClass(v.working_days_at_station)}>
                        <TableCell className="font-mono text-xs">
                          <button onClick={() => loadDetail(v)} className="text-blue-600 hover:underline cursor-pointer text-left">{v.vin}</button>
                        </TableCell>
                        <TableCell>
                          {hasIssue
                            ? <Badge variant="destructive" className="text-[10px] px-1.5">Issue ({issues.length})</Badge>
                            : <Badge variant="success" className="text-[10px] px-1.5">OK</Badge>
                          }
                        </TableCell>
                        <TableCell className="text-xs">
                          {stationByCode(v.current_station as StationCode)?.label ?? v.current_station}
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(v.entered_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-medium">
                          {Math.round(v.working_hours_at_station)}h
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          <Badge variant={v.working_days_at_station - localThreshold >= 3 ? "destructive" : "secondary"}>
                            {v.working_days_at_station}d
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-medium text-destructive">
                          +{v.working_days_at_station - localThreshold}d
                        </TableCell>
                        <TableCell className="text-xs">{v.lot_code ?? "—"}</TableCell>
                        <TableCell className="text-xs">{v.lot_model ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vehicle Detail Dialog */}
      <Dialog open={!!detail || detailLoading} onOpenChange={() => { setDetail(null); setDetailLoading(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{detail?.vin ?? "Loading..."}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : detail ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Current Station</div>
                  <div className="font-medium">{stationByCode(detail.current_station ?? "")?.label ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Lot Code</div>
                  <div className="font-mono">{detail.lot_code ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Model</div>
                  <div>{detail.lot_model ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Job Order</div>
                  <div>{detail.job_order_name ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Color</div>
                  <div className="font-mono">{detail.actual_color_id ?? "—"}</div>
                </div>
              </div>

              {detail.issues.length > 0 && (
                <div>
                  <h4 className="font-medium text-xs text-muted-foreground mb-1">Issues ({detail.issues.length})</h4>
                  <ul className="divide-y border rounded-md">
                    {detail.issues.map((iss, i) => (
                      <li key={i} className="px-3 py-1.5 flex items-center justify-between text-xs">
                        <span>{iss.title}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">{stationByCode(iss.station)?.label ?? iss.station}</span>
                          <Badge variant={iss.status === "open" ? "destructive" : "success"} className="text-[10px] px-1">{iss.status}</Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.shortages.length > 0 && (
                <div>
                  <h4 className="font-medium text-xs text-muted-foreground mb-1">Shortages ({detail.shortages.length})</h4>
                  <ul className="divide-y border rounded-md">
                    {detail.shortages.map((s, i) => (
                      <li key={i} className="px-3 py-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span>{(s.parts as string[]).join(", ")}</span>
                          <Badge variant={s.status === "open" ? "destructive" : "success"} className="text-[10px] px-1">{s.status}</Badge>
                        </div>
                        <div className="text-muted-foreground mt-0.5">{s.shortage_reason ?? ""} · {new Date(s.created_at).toLocaleDateString("en-GB")}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.issues.length === 0 && detail.shortages.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">No issues or shortages recorded.</p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
