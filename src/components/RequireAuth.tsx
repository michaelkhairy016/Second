import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (ready && !user) nav({ to: "/login" });
  }, [ready, user, nav]);
  if (!ready || !user) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
