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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Loader2, AlertCircle, Download } from "lucide-react";
import { toast } from "sonner";
import { findBySuffix } from "@/lib/vin";
import { exportToCSV } from "@/lib/export";
import { stationByCode, STATIONS } from "@/lib/stations";
import type { IssueWithVehicle, VehicleSearchResult, IssueSeverity, IssueStatus } from "@/lib/db-types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { EmptyState } from "@/components/EmptyState";

export const Route = createFileRoute("/issues")({
  head: () => ({ meta: [{ title: "Issues — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

const SEVERITY_VARIANT: Record<IssueSeverity, "success" | "warning" | "destructive" | "default"> = {
  low: "success",
  medium: "warning",
  high: "destructive",
  critical: "default",
};

const STATUS_VARIANT: Record<IssueStatus, "info" | "warning" | "success" | "muted"> = {
  open: "info",
  in_progress: "warning",
  resolved: "success",
  closed: "muted",
};

function Page() {
  const nav = useNavigate();
  const [issues, setIssues] = useState<IssueWithVehicle[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<IssueStatus | "all">("all");
  const [filterStation, setFilterStation] = useState<string>("all");

  const loadIssues = async () => {
    let query = supabase
      .from("issues")
      .select("*, vehicle:vehicles(vin, current_station), reporter:profiles!issues_reported_by_fkey(display_name)")
      .order("created_at", { ascending: false });

    if (filterStatus !== "all") query = query.eq("status", filterStatus);
    if (filterStation !== "all") query = query.eq("station", filterStation as any);

    const { data } = await query;
    setIssues((data as unknown as IssueWithVehicle[]) ?? []);
  };

  useEffect(() => { loadIssues(); }, [filterStatus, filterStation]);

  useEffect(() => {
    const ch = supabase.channel("issues-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, loadIssues)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleExport = () => {
    if (issues.length === 0) return toast.error("No issues to export");
    exportToCSV(
      issues.map(i => ({
        title: i.title,
        station: i.station,
        severity: i.severity,
        status: i.status,
        vin: i.vehicle?.vin ?? "",
        description: i.description ?? "",
        reported_by: i.reporter?.display_name ?? "",
        created_at: i.created_at,
      })),
      `issues-${new Date().toISOString().slice(0, 10)}`
    );
  };

  const updateStatus = async (id: string, status: IssueStatus) => {
    const user = (await supabase.auth.getUser()).data.user;
    const update: Record<string, unknown> = { status };
    if (status === "resolved" || status === "closed") {
      update.resolved_at = new Date().toISOString();
      update.resolved_by = user?.id;
    }
    const { error } = await supabase.from("issues").update(update as any).eq("id", id);
    if (error) toast.error(error.message); else toast.success(`Issue marked as ${status.replace("_", " ")}`);
  };

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <button onClick={() => nav({ to: "/" })} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Stations</button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Issues</h1>
          <p className="text-muted-foreground text-sm">Track quality and production issues across all stations.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" /> Export</Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4 mr-1" /> New Issue</Button>
        </div>
      </div>

      {showForm && <NewIssueForm onDone={() => { setShowForm(false); loadIssues(); }} />}

      <div className="flex gap-2 flex-wrap">
        <Select value={filterStatus} onValueChange={v => setFilterStatus(v as IssueStatus | "all")}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStation} onValueChange={setFilterStation}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stations</SelectItem>
            {STATIONS.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{issues.length} issue{issues.length !== 1 ? "s" : ""}</CardTitle></CardHeader>
        <CardContent>
          {issues.length === 0 ? (
            <EmptyState icon={AlertCircle} title="No issues" description="All clear across the production line." />
          ) : (
            <ul className="divide-y">
              {issues.map(issue => (
                <li key={issue.id} className="py-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{issue.title}</span>
                        <Badge variant={SEVERITY_VARIANT[issue.severity]}>{issue.severity}</Badge>
                        <Badge variant={STATUS_VARIANT[issue.status]}>{issue.status.replace("_", " ")}</Badge>
                      </div>
                      {issue.description && <p className="text-xs text-muted-foreground line-clamp-2">{issue.description}</p>}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{stationByCode(issue.station)?.label ?? issue.station}</span>
                        {issue.vehicle?.vin && <span className="font-mono text-xs">{issue.vehicle.vin}</span>}
                        {issue.reporter?.display_name && <span>by {issue.reporter.display_name}</span>}
                        <span>{new Date(issue.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {issue.status === "open" && (
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => updateStatus(issue.id, "in_progress")}>Start</Button>
                      )}
                      {(issue.status === "open" || issue.status === "in_progress") && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="text-xs h-7">Resolve</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Resolve this issue?</AlertDialogTitle>
                              <AlertDialogDescription>"{issue.title}" will be marked as resolved.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => updateStatus(issue.id, "resolved")}>Resolve</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      {issue.status === "resolved" && (
                        <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => updateStatus(issue.id, "closed")}>Close</Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewIssueForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [station, setStation] = useState("");
  const [suffix, setSuffix] = useState("");
  const debouncedSuffix = useDebouncedValue(suffix, 300);
  const [matches, setMatches] = useState<VehicleSearchResult[]>([]);
  const [picked, setPicked] = useState<VehicleSearchResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (debouncedSuffix.trim().length < 3) { setMatches([]); return; }
    findBySuffix(debouncedSuffix).then(setMatches).catch(e => toast.error(e.message));
    setPicked(null);
  }, [debouncedSuffix]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Title is required");
    if (!station) return toast.error("Select a station");
    setBusy(true);
    const currentUser = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from("issues").insert({
      title: title.trim(),
      description: description.trim() || null,
      severity,
      station: station as "warehouse" | "wbs" | "paint" | "pbs" | "shortage" | "repair" | "cs" | "pdi",
      vehicle_id: picked?.id ?? null,
      reported_by: currentUser?.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Issue logged"); setTitle(""); setDescription(""); setSuffix(""); setPicked(null); setStation(""); onDone(); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Log new issue</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Paint scratch on driver door" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Station</Label>
              <Select value={station} onValueChange={setStation}>
                <SelectTrigger><SelectValue placeholder="Pick station..." /></SelectTrigger>
                <SelectContent>
                  {STATIONS.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={v => setSeverity(v as IssueSeverity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Vehicle (optional)</Label>
            <Input value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="VIN suffix (last 5)" className="font-mono" />
            {matches.length > 0 && !picked && (
              <div className="border rounded-md divide-y">
                {matches.map(m => (
                  <button type="button" key={m.id} onClick={() => setPicked(m)} className="w-full text-left px-3 py-2 hover:bg-muted text-sm font-mono">{m.vin}</button>
                ))}
              </div>
            )}
            {picked && (
              <div className="rounded-md border bg-muted/40 p-2 flex items-center justify-between">
                <span className="font-mono text-sm">{picked.vin}</span>
                <button type="button" onClick={() => setPicked(null)} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the issue in detail..." />
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => { setTitle(""); setDescription(""); onDone(); }} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={busy} className="flex-1">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log issue"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
