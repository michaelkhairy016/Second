import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { loginSchema, signupSchema } from "@/lib/schemas";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Aboul Fotouh Shopfloor" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { user, ready } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ready && user) nav({ to: "/" }); }, [ready, user, nav]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const schema = mode === "signin" ? loginSchema : signupSchema;
    const input = mode === "signin" ? { email, password } : { email, password, name };
    const result = schema.safeParse(input);

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach(issue => {
        const key = String(issue.path[0]);
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin, data: { display_name: name || email.split("@")[0] } }
        });
        if (error) throw error;
        toast.success("Account created");
      }
      nav({ to: "/" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed";
      toast.error(message);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* GIF background with dark overlay — matching website hero */}
      <div className="absolute inset-0 z-0">
        <img
          src="/ezgif.com-video-to-gif.gif"
          alt=""
          className="w-full h-full object-cover opacity-30 grayscale"
        />
        <div className="absolute inset-0 bg-black/80" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm px-4">
        {/* Branding */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <img src="/logo.png" alt="Aboul Fotouh Automotive" className="h-16 w-auto brightness-0 invert" />
          <div className="text-center">
            <h1 className="text-xl font-bold text-white tracking-tight">ABOUL FOTOUH AUTOMOTIVE</h1>
            <p className="text-sm text-white/50 mt-1">The Partner of Choice — Since 1978</p>
          </div>
          <p className="text-xs uppercase tracking-widest text-white/30 font-medium">Shopfloor System</p>
        </div>

        {/* Auth card */}
        <Card className="bg-white/[0.04] border-white/10 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white/90">{mode === "signin" ? "Sign in" : "Create account"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-white/60">Display name</Label>
                  <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Ahmed S." className="bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus:border-white/30" />
                  {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-white/60">Email</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus:border-white/30" />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw" className="text-white/60">Password</Label>
                <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} className="bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus:border-white/30" />
                {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              </div>
              <Button type="submit" disabled={busy} className="w-full bg-white text-black hover:bg-white/90 font-medium">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {mode === "signin" ? "Sign in" : "Sign up"}
              </Button>
              <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErrors({}); }} className="text-xs text-white/40 hover:text-white/70 w-full text-center pt-1 transition-colors">
                {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
              </button>
            </form>
          </CardContent>
        </Card>
        <p className="text-xs text-white/30 text-center mt-4">
          New accounts default to <span className="font-medium text-white/50">Technician</span>. An admin will assign your station.
        </p>
      </div>
    </div>
  );
}
