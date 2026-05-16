import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MailCheck, ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";
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
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

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
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin, data: { display_name: name || email.split("@")[0] } }
        });
        if (error) throw error;
        setSignupDone(true);
        return;
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setForgotSent(true);
        return;
      }
      nav({ to: "/" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed";
      toast.error(message);
    } finally { setBusy(false); }
  };

  if (forgotSent) {
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
          <Card className="bg-white/[0.04] border-white/10 backdrop-blur-sm">
            <CardContent className="pt-6 pb-6 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-amber-500/20 grid place-items-center">
                <KeyRound className="h-7 w-7 text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white/90">Reset link sent</h2>
                <p className="text-sm text-white/60 mt-1">
                  We sent a password reset link to <span className="text-white/80 font-medium">{email}</span>.
                </p>
              </div>
              <Button variant="outline" onClick={() => { setForgotSent(false); setMode("signin"); }} className="w-full border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white">
                Back to sign in
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (signupDone) {
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
          <Card className="bg-white/[0.04] border-white/10 backdrop-blur-sm">
            <CardContent className="pt-6 pb-6 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-green-500/20 grid place-items-center">
                <MailCheck className="h-7 w-7 text-green-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white/90">Check your email</h2>
                <p className="text-sm text-white/60 mt-1">
                  We sent a confirmation link to <span className="text-white/80 font-medium">{email}</span>.
                  Please check your inbox and click the link to verify your account.
                </p>
              </div>
              <div className="bg-white/[0.04] border border-white/10 rounded-md px-3 py-2 text-xs text-white/40 w-full">
                After verifying your email, a <span className="text-white/60 font-medium">super admin</span> must approve your access before you can use the system.
              </div>
              <Button variant="outline" onClick={() => { setSignupDone(false); setMode("signin"); }} className="w-full border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white">
                Back to sign in
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* GIF background with overlay */}
      <div className="absolute inset-0 z-0">
        <img
          src="/ezgif.com-video-to-gif.gif"
          alt=""
          className="w-full h-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-black/50" />
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
            <CardTitle className="text-base text-white/90">{mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password"}</CardTitle>
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
              {mode !== "forgot" && (
                <div className="space-y-1.5">
                  <Label htmlFor="pw" className="text-white/60">Password</Label>
                  <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} className="bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus:border-white/30" />
                  {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                </div>
              )}
              <Button type="submit" disabled={busy} className="w-full bg-white text-black hover:bg-white/90 font-medium">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {mode === "signin" ? "Sign in" : mode === "signup" ? "Sign up" : "Send reset link"}
              </Button>
              {mode === "signin" && (
                <button type="button" onClick={() => { setMode("forgot"); setErrors({}); }} className="text-xs text-white/40 hover:text-white/70 w-full text-center pt-1 transition-colors">
                  Forgot password?
                </button>
              )}
              <button type="button" onClick={() => { setMode(mode === "signin" || mode === "forgot" ? "signup" : "signin"); setErrors({}); }} className="text-xs text-white/40 hover:text-white/70 w-full text-center pt-1 transition-colors">
                {mode === "signup" ? "Have an account? Sign in" : "No account? Create one"}
              </button>
            </form>
          </CardContent>
        </Card>
        <p className="text-xs text-white/30 text-center mt-4">
          New accounts require <span className="font-medium text-white/50">admin approval</span> before access is granted.
        </p>
      </div>
    </div>
  );
}
