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

function DelayedPage() {
  const { isSuperuser, isStaff, isStatus } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!isSuperuser && !isStaff && !isStatus) nav({ to: "/" });
  }, [isSuperuser, isStaff, isStatus, nav]);

  const [globalThreshold, setGlobalThreshold] = useState(2);
  const [localThreshold, setLocalThreshold] = useState(2);
  const [vehicles, setVehicles] = useState<DelayedVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

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
      setVehicles((data as unknown) as DelayedVehicle[]);
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
                    <TableHead>VIN Suffix</TableHead>
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
                  {vehicles.map(v => (
                    <TableRow key={v.vehicle_id} className={getRowClass(v.working_days_at_station)}>
                      <TableCell className="font-mono text-xs">{v.vin_suffix}</TableCell>
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
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
