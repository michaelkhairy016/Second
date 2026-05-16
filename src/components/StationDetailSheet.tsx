import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { STATIONS } from "@/lib/stations";
import { Link2, Clock } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { useColors } from "@/hooks/use-colors";
import type { Vehicle, Issue } from "@/lib/db-types";

interface Props {
  stationKey: string;
  vehicles: Array<Vehicle & {
    activeIssues: Issue[];
    resolvedIssues: Issue[];
    enteredAt: string | null;
    lots: { lot_code: string; model: string } | null;
    job_orders: { model_year: string | null } | null;
  }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "warning"> = {
  low: "secondary",
  medium: "warning",
  high: "destructive",
  critical: "destructive",
};

function ColorBadge({ colorId }: { colorId: string }) {
  const { getCode, getName } = useColors();
  const code = getCode(colorId);
  const name = getName(colorId);
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground" title={name}>
      {code}
    </span>
  );
}

export function StationDetailSheet({ stationKey, vehicles, open, onOpenChange }: Props) {
  const isVirtual = stationKey === "line_feeding";
  const station = STATIONS.find(s => s.code === stationKey);
  const label = isVirtual ? "Line Feeding" : station?.label ?? stationKey;
  const Icon = isVirtual ? Link2 : station?.icon ?? Link2;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <SheetTitle>{label}</SheetTitle>
              <SheetDescription>{vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""}</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-10rem)] mt-4">
          {vehicles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No vehicles at this station.</p>
          ) : (
            <ul className="divide-y">
              {vehicles.map(v => (
                <li key={v.id} className="py-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{v.lots?.lot_code ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{v.lots?.model ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {v.job_orders?.model_year && <span>{v.job_orders.model_year}</span>}
                    {v.planned_color_id && <ColorBadge colorId={v.planned_color_id} />}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">{v.vin}</span>
                  {v.enteredAt && (
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Entered {new Date(v.enteredAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <span>·</span>
                      <span className="font-medium">{formatDuration(v.enteredAt)}</span>
                    </div>
                  )}
                  {v.activeIssues.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {v.activeIssues.map(issue => (
                        <Badge key={issue.id} variant={SEVERITY_VARIANT[issue.severity] ?? "secondary"} className="text-[10px]">
                          {issue.title}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {v.resolvedIssues.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{v.resolvedIssues.length} resolved issue{v.resolvedIssues.length !== 1 ? "s" : ""}</span>
                  )}
                  {v.activeIssues.length === 0 && v.resolvedIssues.length === 0 && !v.enteredAt && (
                    <span className="text-[10px] text-muted-foreground">No issues</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
