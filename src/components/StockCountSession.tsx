import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertTriangle, PackageCheck, ArrowLeft, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { findBySuffix } from "@/lib/vin";
import {
  completeCount, getCountItems, recordScan, startCount, cancelCount, type ScanVehicle,
} from "@/lib/stock-count";
import { stationByCode } from "@/lib/stations";
import type {
  StationCode, StockCountItemWithVehicle, StockCountOutcome, StockCountWithProfiles,
} from "@/lib/db-types";

type Phase = "idle" | "scanning" | "summary";

const OUTCOME_BADGE: Record<StockCountOutcome, "success" | "info" | "warning" | "destructive" | "muted"> = {
  expected: "muted",
  matched: "success",
  new: "info",
  checked_out: "warning",
  skipped: "destructive",
};
const OUTCOME_LABEL: Record<StockCountOutcome, string> = {
  expected: "Unscanned",
  matched: "Matched",
  new: "New — registered IN",
  checked_out: "Advanced OUT",
  skipped: "Flagged for review",
};

/** Next station for auto-advance, mirrors complete_stock_count RPC / nextStationMap. */
function nextStationFor(station: StationCode): StationCode | null {
  if (station === "wbs") return "paint";
  if (station === "pbs") return "tcf";
  return null;
}

interface Props {
  count: StockCountWithProfiles;
  station: StationCode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
}

export function StockCountSession({ count, station, open, onOpenChange, onMutated }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<StockCountItemWithVehicle[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [suffix, setSuffix] = useState("");
  const debouncedSuffix = useDebouncedValue(suffix, 300);
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof findBySuffix>>>([]);
  const [busy, setBusy] = useState(false);

  const loadItems = async () => {
    setLoadingItems(true);
    try {
      setItems(await getCountItems(count.id));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    if (open) {
      setPhase(count.status === "in_progress" ? "scanning" : "idle");
      setSuffix(""); setMatches([]);
      loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, count.id, count.status]);

  useEffect(() => {
    if (!open || phase !== "scanning") return;
    if (debouncedSuffix.trim().length < 3) { setMatches([]); return; }
    let cancel = false;
    findBySuffix(debouncedSuffix).then(d => { if (!cancel) setMatches(d); }).catch(e => toast.error(e.message));
    return () => { cancel = true; };
  }, [debouncedSuffix, open, phase]);

  const matched = items.filter(i => i.outcome === "matched").length;
  const newCount = items.filter(i => i.outcome === "new").length;
  const remaining = items.filter(i => i.outcome === "expected");
  const nextLabel = nextStationFor(station) ? stationByCode(nextStationFor(station)!)?.label : null;

  const handleStart = async () => {
    setBusy(true);
    try {
      const ok = await startCount(count.id);
      if (!ok) { toast.warning("Already started by someone else"); }
      setPhase("scanning");
      onMutated();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const handlePick = async (v: ScanVehicle) => {
    setBusy(true);
    try {
      const res = await recordScan(count.id, station, v);
      if (res.kind === "matched") toast.success(`✓ Counted — ${v.vin_suffix} (matched)`);
      else if (res.kind === "new") toast.message(`⚠ Registered IN — ${v.vin_suffix} (was not in this area)`);
      else toast.info(`${v.vin_suffix} already counted`);
      setSuffix(""); setMatches([]);
      await loadItems();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await completeCount(count.id);
      const advanced = remaining.filter(r => r.station_snapshot !== "shortage").length;
      const flagged = remaining.filter(r => r.station_snapshot === "shortage").length;
      toast.success(`Stock count complete — ${matched} matched, ${newCount} new, ${advanced} advanced${flagged ? `, ${flagged} flagged` : ""}`);
      onOpenChange(false);
      onMutated();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelCount(count.id);
      toast.message("Stock count cancelled — no vehicle data changed");
      onOpenChange(false);
      onMutated();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const stationLabel = stationByCode(station)?.label ?? station;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" /> Stock Count — {stationLabel}
          </DialogTitle>
          <DialogDescription>
            Requested by {count.requester?.display_name ?? "—"}. Scan every vehicle physically present in this area.
          </DialogDescription>
        </DialogHeader>

        {/* Progress strip */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <ProgressStat label="Expected" value={count.expected_count} variant="muted" />
          <ProgressStat label="Matched" value={matched} variant="success" />
          <ProgressStat label="New (IN)" value={newCount} variant="info" />
          <ProgressStat label="Unscanned" value={remaining.length} variant={remaining.length ? "destructive" : "muted"} />
        </div>

        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {count.expected_count} vehicle{count.expected_count !== 1 ? "s" : ""} in the system snapshot for {stationLabel}.
              Click Start to begin scanning the floor.
            </p>
            <div className="flex gap-2">
              <Button onClick={handleStart} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />} Start count
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" disabled={busy}>Cancel count</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this stock count?</AlertDialogTitle>
                    <AlertDialogDescription>The count is discarded. No vehicle data is changed.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancel}>Cancel count</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {phase === "scanning" && (
          <div className="space-y-3">
            <Input
              autoFocus
              value={suffix}
              onChange={e => setSuffix(e.target.value)}
              placeholder="Scan VIN suffix (last 5)…"
              inputMode="numeric"
              className="text-lg font-mono tracking-widest"
              disabled={busy}
            />
            {matches.length > 0 && (
              <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                {matches.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handlePick(m as ScanVehicle)}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-sm font-mono flex items-center justify-between"
                  >
                    <span>{m.vin}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.is_archived ? "archived" : (stationByCode(m.current_station ?? "")?.short ?? "—")}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {loadingItems && <div className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> syncing…</div>}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPhase("idle")} disabled={busy}>
                <ArrowLeft className="h-4 w-4" /> Pause
              </Button>
              <Button className="flex-1" onClick={() => setPhase("summary")} disabled={busy}>
                Finish & review
              </Button>
            </div>
          </div>
        )}

        {phase === "summary" && (
          <div className="space-y-4">
            <SummaryGroup
              icon={CheckCircle2} color="text-success"
              title={`Matched (${matched})`}
              rows={items.filter(i => i.outcome === "matched")}
              empty="None."
            />
            <SummaryGroup
              icon={PackageCheck} color="text-info"
              title={`New — registered IN (${newCount})`}
              rows={items.filter(i => i.outcome === "new")}
              empty="None."
            />
            {remaining.length > 0 && (
              <SummaryGroup
                icon={AlertTriangle} color="text-destructive"
                title={station === "shortage"
                  ? `Unscanned — flagged for review (${remaining.length})`
                  : `Will be advanced OUT to ${nextLabel} (${remaining.length})`}
                rows={remaining}
                empty="None."
              />
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setPhase("scanning")} disabled={busy}>
                <ArrowLeft className="h-4 w-4" /> Back to scanning
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Confirm & update system
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Update the system with this count?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {station === "shortage"
                        ? `Unscanned vehicles will be flagged for review. ${matched} matched, ${newCount} registered IN.`
                        : `${remaining.length} unscanned vehicle(s) will be advanced to ${nextLabel} and recorded as OUT. This cannot be undone.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirm}>Confirm</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProgressStat({ label, value, variant }: { label: string; value: number; variant: "muted" | "success" | "info" | "destructive" }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="text-2xl font-bold leading-none">{value}</div>
      <Badge variant={variant} className="mt-1">{label}</Badge>
    </div>
  );
}

function SummaryGroup({
  icon: Icon, color, title, rows, empty,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  title: string;
  rows: StockCountItemWithVehicle[];
  empty: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className={`flex items-center gap-2 text-sm font-semibold ${color}`}>
        <Icon className="h-4 w-4" /> {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-6">{empty}</p>
      ) : (
        <ul className="pl-6 text-xs font-mono space-y-0.5 max-h-32 overflow-y-auto">
          {rows.map(r => (
            <li key={r.id} className="flex items-center justify-between">
              <span>{r.vehicle?.vin ?? r.vin_snapshot}</span>
              {r.advanced_to && <Badge variant="warning" className="text-[10px]">→ {stationByCode(r.advanced_to)?.short ?? r.advanced_to}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
