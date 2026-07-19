import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, AlertTriangle, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { stationByCode, STATIONS } from "@/lib/stations";
import { EmptyState } from "@/components/EmptyState";
import type { VehicleRestriction, StationCode } from "@/lib/db-types";

export const Route = createFileRoute("/restrictions")({
  head: () => ({ meta: [{ title: "Restrictions — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

interface JobOrderOption {
  id: string;
  job_code: string;
  model: string | null;
}

interface VehicleOption {
  id: string;
  vin: string;
  vin_suffix: string;
}

interface RestrictionWithVehicle extends VehicleRestriction {
  vehicle: { vin: string; vin_suffix: string; job_order_id: string | null } | null;
}

function Page() {
  const { isStaff, isSuperuser } = useAuth();
  const nav = useNavigate();
  const allowed = isStaff || isSuperuser;
  useEffect(() => {
    if (!allowed) { toast.error("No access"); nav({ to: "/" }); }
  }, [allowed, nav]);

  // Job orders
  const [jobOrders, setJobOrders] = useState<JobOrderOption[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string>>(new Set());

  // Form
  const [restriction, setRestriction] = useState("");
  const [stopAtStation, setStopAtStation] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Active restrictions list
  const [activeRestrictions, setActiveRestrictions] = useState<RestrictionWithVehicle[]>([]);

  // Load job orders
  useEffect(() => {
    supabase.from("job_orders").select("id, job_code, lots(model)").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => {
        const mapped = (data ?? []).map((d: any) => ({
          id: d.id,
          job_code: d.job_code,
          model: d.lots?.model ?? null,
        }));
        setJobOrders(mapped);
      });
  }, []);

  // Load vehicles when job order selected
  useEffect(() => {
    if (!selectedJobId) { setVehicles([]); return; }
    supabase.from("vehicles").select("id, vin, vin_suffix").eq("job_order_id", selectedJobId).is("completed_at", null)
      .then(({ data }) => {
        setVehicles((data as VehicleOption[]) ?? []);
        setSelectedVehicleIds(new Set());
      });
  }, [selectedJobId]);

  // Load active restrictions
  const loadActive = async () => {
    const { data } = await supabase.from("vehicle_restrictions")
      .select("*, vehicle:vehicles(vin, vin_suffix, job_order_id)")
      .eq("status", "active")
      .order("created_at", { ascending: false });
    setActiveRestrictions((data as RestrictionWithVehicle[]) ?? []);
  };
  useEffect(() => { loadActive(); }, []);
  useEffect(() => {
    const ch = supabase.channel("restrictions-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_restrictions" }, loadActive)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const toggleVehicle = (id: string) => {
    setSelectedVehicleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedVehicleIds.size === vehicles.length) {
      setSelectedVehicleIds(new Set());
    } else {
      setSelectedVehicleIds(new Set(vehicles.map(v => v.id)));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVehicleIds.size === 0) return toast.error("Select at least one vehicle");
    if (!restriction.trim()) return toast.error("Enter restriction text");
    if (!stopAtStation) return toast.error("Select a stop-at station");
    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const rows = Array.from(selectedVehicleIds).map(vehicleId => ({
        vehicle_id: vehicleId,
        restriction: restriction.trim(),
        stop_at_station: stopAtStation as StationCode,
        job_order_id: selectedJobId || null,
        notes: notes.trim() || null,
        created_by: user?.id ?? null,
        status: "active",
      }));
      const { error } = await supabase.from("vehicle_restrictions").insert(rows);
      if (error) throw error;
      toast.success(`Restriction applied to ${rows.length} vehicle(s)`);
      setRestriction("");
      setStopAtStation("");
      setNotes("");
      setSelectedVehicleIds(new Set());
      loadActive();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clearRestriction = async (id: string) => {
    const user = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from("vehicle_restrictions").update({
      status: "cleared",
      cleared_at: new Date().toISOString(),
      cleared_by: user?.id ?? null,
    }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Restriction cleared");
    loadActive();
  };

  // Group active restrictions by job order
  const groupedByJob = new Map<string, RestrictionWithVehicle[]>();
  activeRestrictions.forEach(r => {
    const key = r.job_order_id ?? "no-job";
    if (!groupedByJob.has(key)) groupedByJob.set(key, []);
    groupedByJob.get(key)!.push(r);
  });

  const stationOptions = STATIONS.map(s => ({ value: s.code, label: s.label }));

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Stations
      </button>
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldOff className="h-6 w-6" /> Vehicle Restrictions
        </h1>
        <p className="text-muted-foreground text-sm">
          Apply restrictions to vehicles and manage stop-at-station warnings.
        </p>
      </div>

      {/* Add restriction form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add restriction</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Job Order</Label>
              <select
                value={selectedJobId}
                onChange={e => setSelectedJobId(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="">Select job order...</option>
                {jobOrders.map(jo => (
                  <option key={jo.id} value={jo.id}>
                    {jo.job_code}{jo.model ? ` — ${jo.model}` : ""}
                  </option>
                ))}
              </select>
            </div>

            {selectedJobId && vehicles.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Vehicles ({selectedVehicleIds.size}/{vehicles.length} selected)</Label>
                  <button type="button" onClick={selectAll} className="text-xs text-primary hover:underline">
                    {selectedVehicleIds.size === vehicles.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                  {vehicles.map(v => (
                    <label key={v.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={selectedVehicleIds.has(v.id)}
                        onChange={() => toggleVehicle(v.id)}
                        className="rounded"
                      />
                      <span className="font-mono">{v.vin}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {selectedJobId && vehicles.length === 0 && (
              <p className="text-xs text-muted-foreground">No active vehicles found in this job order.</p>
            )}

            <div className="space-y-1.5">
              <Label>Restriction</Label>
              <Input
                value={restriction}
                onChange={e => setRestriction(e.target.value)}
                placeholder="e.g. No exhaust, No door garnish"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Stop at station</Label>
              <select
                value={stopAtStation}
                onChange={e => setStopAtStation(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="">Select station...</option>
                {stationOptions.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Additional details / تفاصيل إضافية"
              />
            </div>

            <Button disabled={busy || selectedVehicleIds.size === 0} type="submit" className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Apply restriction to ${selectedVehicleIds.size} vehicle(s)`}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Active restrictions list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active restrictions ({activeRestrictions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {activeRestrictions.length === 0 ? (
            <EmptyState icon={ShieldOff} title="No active restrictions" description="All clear. No vehicles are currently restricted." />
          ) : (
            <div className="space-y-4">
              {Array.from(groupedByJob.entries()).map(([jobId, restrictions]) => {
                const jobLabel = restrictions[0]?.job_order_id
                  ? jobOrders.find(j => j.id === jobId)?.job_code ?? "Unknown"
                  : "No job order";
                return (
                  <div key={jobId}>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      {jobLabel}
                    </div>
                    <ul className="divide-y border rounded-md">
                      {restrictions.map(r => (
                        <li key={r.id} className="px-3 py-2.5 flex items-start justify-between gap-2">
                          <div className="min-w-0 text-sm">
                            <div className="font-mono text-xs">
                              {r.vehicle?.vin ?? "—"}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                              <span className="truncate">{r.restriction}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Stop at: {stationByCode(r.stop_at_station)?.label ?? r.stop_at_station}
                              {r.notes && <span className="ml-1">· {r.notes}</span>}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {r.created_at_cairo ?? ""}
                            </div>
                          </div>
                          <Button size="sm" variant="outline" className="shrink-0" onClick={() => clearRestriction(r.id)}>
                            Clear
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
