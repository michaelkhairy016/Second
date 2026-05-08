import { STATIONS, type StationDef } from "@/lib/stations";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChevronRight, Link2 } from "lucide-react";
import type { StationCode } from "@/lib/db-types";

export interface FlowStep {
  key: string;
  label: string;
  short: string;
  icon: StationDef["icon"];
  count: number;
  isVirtual?: boolean;
  onClick: () => void;
}

interface Props {
  counts: Record<string, number>;
  lineFeedingCount: number;
  onStationClick: (key: string) => void;
}

// Stations that belong to the main production flow line
const MAIN_FLOW_CODES = ["warehouse", "body_shop", "wbs", "paint", "pbs", "tcf", "waiting_repair", "repair", "cs", "pdi"];
// Stations shown beside the flow (overflow/buffer)
const OVERFLOW_CODES = ["shortage", "tcf_offline"];

export function ProductionFlowDiagram({ counts, lineFeedingCount, onStationClick }: Props) {
  const mainSteps: FlowStep[] = [];
  const overflowSteps: FlowStep[] = [];

  // Warehouse
  const wh = STATIONS.find(s => s.code === "warehouse")!;
  mainSteps.push({ key: "warehouse", label: wh.label, short: wh.short, icon: wh.icon, count: counts["warehouse"] ?? 0, onClick: () => onStationClick("warehouse") });

  // Line Feeding (virtual step)
  mainSteps.push({ key: "line_feeding", label: "Line Feeding", short: "LF", icon: Link2, count: lineFeedingCount, isVirtual: true, onClick: () => onStationClick("line_feeding") });

  // Main flow stations (skip warehouse, already added)
  STATIONS.filter(s => MAIN_FLOW_CODES.includes(s.code) && s.code !== "warehouse").forEach(s => {
    mainSteps.push({ key: s.code, label: s.label, short: s.short, icon: s.icon, count: counts[s.code] ?? 0, onClick: () => onStationClick(s.code) });
  });

  // Overflow stations (beside the flow)
  STATIONS.filter(s => OVERFLOW_CODES.includes(s.code)).forEach(s => {
    overflowSteps.push({ key: s.code, label: s.label, short: s.short, icon: s.icon, count: counts[s.code] ?? 0, onClick: () => onStationClick(s.code) });
  });

  return (
    <div className="space-y-3">
      {/* Main production flow line */}
      <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
        {mainSteps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-2 md:gap-3">
            <StationFlowCard step={step} />
            {i < mainSteps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 hidden md:block" />}
          </div>
        ))}
      </div>

      {/* Overflow / beside-flow stations */}
      {overflowSteps.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3 pt-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mr-1">Beside flow</span>
          {overflowSteps.map(step => (
            <StationFlowCard key={step.key} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function StationFlowCard({ step }: { step: FlowStep }) {
  const Icon = step.icon;
  return (
    <Card
      className={`relative cursor-pointer hover:border-primary/50 transition-all w-24 md:w-28 py-4 px-2 flex flex-col items-center gap-1.5 ${step.isVirtual ? "border-dashed" : ""}`}
      onClick={step.onClick}
    >
      {step.count > 0 && (
        <Badge variant={step.isVirtual ? "secondary" : "default"} className="absolute -top-2 -right-2 text-xs h-5 min-w-[1.25rem] flex items-center justify-center">
          {step.count}
        </Badge>
      )}
      <div className={`h-9 w-9 rounded-lg grid place-items-center ${step.isVirtual ? "bg-secondary text-secondary-foreground" : "bg-primary/10 text-primary"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-xs font-medium text-center leading-tight">{step.label}</span>
      <span className="text-[10px] text-muted-foreground">{step.short}</span>
    </Card>
  );
}
