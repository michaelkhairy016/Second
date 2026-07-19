// Single source of truth for displayed times + "now" math.
//
// Display text comes from Postgres (*_cairo generated columns / RPC return cols),
// formatted as 'YYYY-MM-DD HH24:MI' in Africa/Cairo. This module just renders
// that string null-safe — no new Date(), no browser tz-DB, so a viewer PC with a
// stale IANA tz-database (missing Egypt post-2023 DST) or a wrong clock cannot
// corrupt what is shown.
//
// "Now" comes from the server via the server_now_ms() RPC. We fetch it once at
// boot and keep a running offset; serverNowMs() returns the server's current
// epoch-ms regardless of the viewer's PC clock.

import { supabase } from "@/integrations/supabase/client";

/** Render a Postgres-produced Cairo text string, falling back to "—" when null. */
export function cairoText(s: string | null | undefined): string {
  return s ?? "—";
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Build a "DD MMM YYYY" label from a Postgres-produced Cairo text string
 * ("YYYY-MM-DD HH24:MI"), without any browser tz math. Returns null if the
 * input is missing/malformed so callers can fall back.
 */
export function cairoDateLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const label = MONTHS_SHORT[Number(mo) - 1];
  return label ? `${d} ${label} ${y}` : null;
}

let offsetMs = 0; // serverNow - clientNow (ms)
let loaded = false;
let inflight: Promise<void> | null = null;

/** True once the server clock has been sampled at least once. */
export function isServerClockLoaded(): boolean {
  return loaded;
}

/** Current epoch-ms according to the server (compensates for viewer PC clock skew). */
export function serverNowMs(): number {
  return Date.now() + offsetMs;
}

/** Sample the server clock once and cache the offset. Idempotent + race-safe. */
export async function loadServerClock(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc("server_now_ms");
      if (error) throw error;
      const serverMs = Number(data);
      if (Number.isFinite(serverMs) && serverMs > 0) {
        offsetMs = serverMs - Date.now();
        loaded = true;
      }
    } catch {
      // Network/RPC failure: fall back to client clock (offset stays 0).
      // PC-independence guarantee degrades gracefully instead of crashing.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
