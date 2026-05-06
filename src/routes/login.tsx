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
  head: () => ({ meta: [{ title: "Sign in — Nexus-Flow" }] }),
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
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          <img src="/ezgif.com-video-to-gif.gif" alt="Production process" className="w-full max-w-xs rounded-lg" />
          <h1 className="text-2xl font-bold text-center">Aboulfotouh Shopfloor System</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{mode === "signin" ? "Sign in" : "Create account"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Ahmed S." />
                  {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} />
                {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {mode === "signin" ? "Sign in" : "Sign up"}
              </Button>
              <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErrors({}); }} className="text-xs text-muted-foreground hover:text-foreground w-full text-center pt-1">
                {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
              </button>
            </form>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground text-center mt-4">
          New accounts default to <span className="font-medium">Technician</span>. A superuser will assign your station.
        </p>
      </div>
    </div>
  );
}
