import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset Password — AFA Shopfloor" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        toast.error("Invalid or expired reset link");
        nav({ to: "/login" });
      }
    });
  }, [nav]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setDone(true);
  };

  if (done) {
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
                <CheckCircle2 className="h-7 w-7 text-green-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white/90">Password updated</h2>
                <p className="text-sm text-white/60 mt-1">You can now sign in with your new password.</p>
              </div>
              <Button variant="outline" onClick={() => nav({ to: "/login" })} className="w-full border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white">
                Go to sign in
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white/90">Set new password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pw" className="text-white/60">New password</Label>
                <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} className="bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus:border-white/30" minLength={6} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm" className="text-white/60">Confirm password</Label>
                <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className="bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus:border-white/30" required />
              </div>
              <Button type="submit" disabled={busy} className="w-full bg-white text-black hover:bg-white/90 font-medium">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Update password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
