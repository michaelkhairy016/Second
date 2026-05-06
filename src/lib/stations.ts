import { Boxes, Frame, PaintBucket, ParkingSquare, AlertTriangle, Wrench, ClipboardCheck, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { StationCode } from "@/lib/db-types";

export type { StationCode };

export interface StationDef {
  code: StationCode;
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
  module: "data-entry" | "bulk";
}

export const STATIONS: StationDef[] = [
  { code: "warehouse", label: "Warehouse", short: "WH",  description: "Lots & job orders", icon: Boxes, module: "data-entry" },
  { code: "wbs",       label: "WBS",       short: "WBS", description: "White body in/out", icon: Frame, module: "data-entry" },
  { code: "paint",     label: "Paint",     short: "PT",  description: "Color application", icon: PaintBucket, module: "data-entry" },
  { code: "pbs",       label: "PBS",       short: "PBS", description: "Painted body buffer", icon: ParkingSquare, module: "data-entry" },
  { code: "shortage",  label: "Shortage",  short: "SH",  description: "Missing parts", icon: AlertTriangle, module: "data-entry" },
  { code: "repair",    label: "Repair",    short: "RP",  description: "Bulk paste", icon: Wrench, module: "bulk" },
  { code: "cs",        label: "CS / QC",   short: "CS",  description: "Quality inspection", icon: ClipboardCheck, module: "bulk" },
  { code: "pdi",       label: "PDI",       short: "PDI", description: "Pre-delivery", icon: Truck, module: "bulk" },
];

export const stationByCode = (c: string) => STATIONS.find(s => s.code === c);

export const COLOR_CODES: Record<string, string> = {
  "11U": "White",
  "22U": "Silver",
  "33U": "Black",
  "44U": "Blue",
  "55U": "Red",
  "66U": "Grey",
};

export async function loadColorCodes(): Promise<Record<string, string>> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.from("standard_colors").select("code, name").eq("active", true).order("sort_order");
  if (data && data.length > 0) return Object.fromEntries(data.map(c => [c.code, c.name]));
  return COLOR_CODES;
}
