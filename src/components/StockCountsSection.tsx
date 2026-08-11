import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, ClipboardCheck, ChevronRight, ChevronDown, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { stationByCode } from "@/lib/stations";
import { exportToCSV } from "@/lib/export";
import { EmptyState } from "@/components/EmptyState";
import {
  getActiveCountForStation, getCountDetail, getRecentCounts, requestStockCount,
} from "@/lib/stock-count";
import { StockCountSession } from "@/components/StockCountSession";
import type {
  StationCode, StockCountItemWithVehicle, StockCountStatus, StockCountWithProfiles,
} from "@/lib/db-types";

const STATUS_VARIANT: Record<StockCountStatus, "info" | "warning" | "success" | "muted"> = {
  requested: "info",
  in_progress: "warning",
  completed: "success",
  cancelled: "muted",
};
const STATUS_LABEL: Record<StockCountStatus, string> = {
  requested: "Requested",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const OUTCOME_VARIANT: Record<string, "muted" | "success" | "info" | "warning" | "destructive"> = {
  expected: "muted",
  matched: "success",
  new: "info",
  checked_out: "warning",
  skipped: "destructive",
};

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", hour12: false }) : "—";

/** Request button shown on buffer-area tabs (supervisor/staff only). */
export function RequestStockCountButton({ station }: { station: StationCode }) {
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<StockCountWithProfiles | null>(null);

  const refreshActive = async () => {
    try { setActive(await getActiveCountForStation(station)); } catch { /* ignore */ }
  };
  useEffect(() => { refreshActive(); }, [station]);

  const onClick = async () => {
    setBusy(true);
    try {
      await requestStockCount(station);
      toast.success(`Stock count requested for ${stationByCode(station)?.label ?? station} — controllers alerted`);
      await refreshActive();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Button size="sm" variant="outline" className="gap-2" disabled={busy || !!active} onClick={onClick}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
      {active ? "Count in progress" : "Request Stock Count"}
    </Button>
  );
}

/** Dashboard tab content: list of stock counts (active + history) with reports. */
export function StockCountsSection() {
  const [counts, setCounts] = useState<StockCountWithProfiles[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCountId, setOpenCountId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [itemsCache, setItemsCache] = useState<Record<string, StockCountItemWithVehicle[]>>({});

  const load = async () => {
    try { setCounts(await getRecentCounts()); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("stock-counts-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_counts" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const openCount = counts.find(c => c.id === openCountId) ?? null;

  const toggleDetail = async (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (!itemsCache[id]) {
      try {
        const d = await getCountDetail(id);
        setItemsCache(prev => ({ ...prev, [id]: d?.items ?? [] }));
      } catch (e: any) { toast.error(e.message); }
    }
  };

  const handleExport = () => {
    if (counts.length === 0) return toast.error("No stock counts to export");
    exportToCSV(
      counts.map(c => ({
        station: c.station,
        status: c.status,
        expected: c.expected_count,
        matched: c.matched_count,
        new: c.new_count,
        checked_out: c.checked_out_count,
        requested_by: c.requester?.display_name ?? "",
        started_by: c.starter?.display_name ?? "",
        completed_by: c.completer?.display_name ?? "",
        created_at: c.created_at,
        completed_at: c.completed_at ?? "",
      })),
      `stock-counts-${new Date().toISOString().slice(0, 10)}`,
    );
  };

  const active = counts.filter(c => c.status === "requested" || c.status === "in_progress");
  const history = counts.filter(c => c.status === "completed" || c.status === "cancelled");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Physical reconciliation counts across buffer areas. {active.length} active.
        </p>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={counts.length === 0} className="gap-2">
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : counts.length === 0 ? (
        <Card><CardContent><EmptyState icon={AlertCircle} title="No stock counts yet" description="Request a count from a buffer-area tab (Shortages / PBS / WBS)." /></CardContent></Card>
      ) : (
        <>
          {active.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Active</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {active.map(c => <CountRow key={c.id} count={c} onOpen={() => setOpenCountId(c.id)} />)}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">History ({history.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No completed counts yet.</p>
              ) : history.map(c => (
                <div key={c.id} className="space-y-1.5">
                  <CountRow count={c} onToggleDetail={() => toggleDetail(c.id)} expanded={expanded.has(c.id)} />
                  {expanded.has(c.id) && (
                    <ItemBreakdown items={itemsCache[c.id]} loading={!itemsCache[c.id]} />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {openCount && (
        <StockCountSession
          count={openCount}
          station={openCount.station}
          open={!!openCountId}
          onOpenChange={o => !o && setOpenCountId(null)}
          onMutated={load}
        />
      )}
    </div>
  );
}

function CountRow({
  count, onOpen, onToggleDetail, expanded,
}: {
  count: StockCountWithProfiles;
  onOpen?: () => void;
  onToggleDetail?: () => void;
  expanded?: boolean;
}) {
  const isActive = count.status === "requested" || count.status === "in_progress";
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{stationByCode(count.station)?.label ?? count.station}</span>
            <Badge variant={STATUS_VARIANT[count.status]}>{STATUS_LABEL[count.status]}</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span>Expected: <span className="font-medium text-foreground">{count.expected_count}</span></span>
            <span>Matched: <span className="font-medium text-success">{count.matched_count}</span></span>
            <span>New: <span className="font-medium text-info">{count.new_count}</span></span>
            <span>Out: <span className="font-medium text-warning">{count.checked_out_count}</span></span>
          </div>
          <div className="text-xs text-muted-foreground">
            Requested by {count.requester?.display_name ?? "—"} · {fmt(count.created_at)}
            {count.completed_at && <> · completed {fmt(count.completed_at)}</>}
            {count.completed_by && <> by {count.completer?.display_name ?? "—"}</>}
          </div>
        </div>
        <div className="shrink-0">
          {isActive ? (
            <Button size="sm" variant="destructive" onClick={onOpen} className="gap-1">
              <ClipboardCheck className="h-4 w-4" /> {count.status === "requested" ? "Start" : "Open"}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onToggleDetail} className="gap-1 text-xs h-7">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Details
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemBreakdown({ items, loading }: { items?: StockCountItemWithVehicle[]; loading: boolean }) {
  if (loading) return <div className="pl-3 text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> loading…</div>;
  if (!items || items.length === 0) return <p className="pl-3 text-xs text-muted-foreground">No vehicles in snapshot.</p>;
  const groups: Record<string, StockCountItemWithVehicle[]> = {};
  for (const it of items) (groups[it.outcome] ??= []).push(it);
  const order = ["matched", "new", "checked_out", "skipped", "expected"];
  return (
    <div className="pl-3 space-y-1.5">
      {order.filter(g => groups[g]).map(g => (
        <div key={g} className="space-y-0.5">
          <div className="text-xs font-medium capitalize">{g.replace("_", " ")} ({groups[g].length})</div>
          <div className="flex flex-wrap gap-1">
            {groups[g].map(it => (
              <Badge key={it.id} variant={OUTCOME_VARIANT[it.outcome] ?? "muted"} className="font-mono text-[10px]">
                {it.vehicle?.vin ?? it.vin_snapshot}
                {it.advanced_to && ` → ${stationByCode(it.advanced_to)?.short ?? it.advanced_to}`}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
