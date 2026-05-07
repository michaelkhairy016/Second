import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function RequireApproved({ children }: { children: ReactNode }) {
  const { ready, user, roles } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (ready && !user) nav({ to: "/login" });
  }, [ready, user, nav]);

  if (!ready || !user) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  if (roles.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img src="/ezgif.com-video-to-gif.gif" alt="" className="w-full h-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-black/50" />
        </div>
        <div className="relative z-10 w-full max-w-sm px-4">
          <div className="flex flex-col items-center gap-4 mb-8">
            <img src="/logo.png" alt="Aboul Fotouh Automotive" className="h-16 w-auto brightness-0 invert" />
          </div>
          <div className="bg-white/[0.04] border border-white/10 backdrop-blur-sm rounded-lg p-6 flex flex-col items-center gap-4 text-center">
            <div className="h-14 w-14 rounded-full bg-amber-500/20 grid place-items-center">
              <ShieldCheck className="h-7 w-7 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white/90">Email confirmed</h2>
              <p className="text-sm text-white/60 mt-1">
                Your email has been verified successfully. A <span className="text-white/80 font-medium">super admin</span> must now approve your account and assign your role and station access.
              </p>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-md px-3 py-2 text-xs text-white/40 w-full">
              You will receive access once an administrator assigns you a role. This typically happens within 24 hours. Please contact your supervisor if you need expedited access.
            </div>
            <Button variant="outline" onClick={async () => {
              const { supabase } = await import("@/integrations/supabase/client");
              await supabase.auth.signOut();
              nav({ to: "/login" });
            }} className="w-full border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white">
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <ErrorBoundary>{children}</ErrorBoundary>;
}
