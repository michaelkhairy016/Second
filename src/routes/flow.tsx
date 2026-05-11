import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { ProductionFlowDiagram } from "@/components/ProductionFlowDiagram";
import { StationDetailSheet } from "@/components/StationDetailSheet";
import { useFlowData } from "@/hooks/use-flow-data";

export const Route = createFileRoute("/flow")({
  head: () => ({ meta: [{ title: "Production Flow — AFA Shopfloor" }] }),
  component: () => <RequireAuth><AppShell><Page /></AppShell></RequireAuth>,
});

function Page() {
  const { counts, lineFeedingCount, stationVehicles, selectedStation, setSelectedStation } = useFlowData("flow-realtime");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Production Flow</h1>
        <p className="text-muted-foreground text-sm">Live view of the production floor — click a station to see vehicles.</p>
      </div>
      <ProductionFlowDiagram counts={counts} lineFeedingCount={lineFeedingCount} onStationClick={setSelectedStation} />
      <StationDetailSheet
        stationKey={selectedStation ?? ""}
        vehicles={stationVehicles}
        open={!!selectedStation}
        onOpenChange={(open) => { if (!open) setSelectedStation(null); }}
      />
    </div>
  );
}
