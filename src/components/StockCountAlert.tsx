import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getActiveCountForStation } from "@/lib/stock-count";
import { StockCountSession } from "@/components/StockCountSession";
import { stationByCode } from "@/lib/stations";
import type { StationCode, StockCountWithProfiles } from "@/lib/db-types";

/**
 * Persistent red banner shown at a buffer station (shortage/pbs/wbs) while a stock
 * count for that station is open. Non-blocking — normal scanning still works underneath.
 * Realtime-subscribed so it appears/disappears the instant a count is requested/finished.
 */
export function StockCountAlert({ station }: { station: StationCode }) {
  const [count, setCount] = useState<StockCountWithProfiles | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);

  const load = async () => {
    try {
      setCount(await getActiveCountForStation(station));
    } catch {
      /* background poll — stay silent */
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`stock-counts-${station}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_counts", filter: `station=eq.${station}` },
        load,
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  if (!count) return null;

  const stationLabel = stationByCode(station)?.label ?? station;
  const isRequested = count.status === "requested";

  return (
    <>
      <div className="sticky top-0 z-30 -mx-1 flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-destructive shadow-sm">
        <AlertTriangle className="h-5 w-5 shrink-0 animate-pulse" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">
            Stock count required — {stationLabel}
          </p>
          <p className="text-xs text-destructive/80 truncate">
            {isRequested ? "Awaiting start" : "In progress"} · requested by {count.requester?.display_name ?? "—"}
            . Scan every vehicle physically present, then finish to sync the system.
          </p>
        </div>
        <Button size="sm" variant="destructive" onClick={() => setSessionOpen(true)} className="shrink-0">
          <ClipboardCheck className="h-4 w-4" />
          {isRequested ? "Start count" : "Open count"}
        </Button>
      </div>

      <StockCountSession
        count={count}
        station={station}
        open={sessionOpen}
        onOpenChange={setSessionOpen}
        onMutated={load}
      />
    </>
  );
}
