import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "warning" | "destructive";
}

export function StatCard({ label, value, tone = "default" }: StatCardProps) {
  const colorClass =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "destructive" ? "text-destructive" : "";

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${colorClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
