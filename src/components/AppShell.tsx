import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/hooks/use-notifications";
import { useTheme } from "@/hooks/use-theme";
import { LayoutGrid, ClipboardList, BarChart3, Users, LogOut, Search, Menu, AlertCircle, Settings, GitBranch, Eye, Sun, Moon, CalendarDays, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { displayName, roles, signOut, isSuperuser, isStaff, isStatus } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { theme, toggleTheme } = useTheme();

  useNotifications();

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
            <Button variant="outline" onClick={async () => { await signOut(); nav({ to: "/login" }); }} className="w-full border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white">
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const link = (to: string, label: string, Icon: React.ComponentType<{ className?: string }>) => {
    const active = loc.pathname === to || (to !== "/" && loc.pathname.startsWith(to));
    return (
      <Link to={to} className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted"}`}>
        <Icon className="h-4 w-4" /> <span>{label}</span>
      </Link>
    );
  };

  const navLinks = (
    <>
      {!isStatus && link("/", "Stations", LayoutGrid)}
      {link("/flow", "Production Flow", GitBranch)}
      {link("/lookup", "Lookup", Search)}
      {!isStatus && link("/requests", "My Requests", ClipboardList)}
      {!isStatus && link("/issues", "Issues", AlertCircle)}
      {isStatus && link("/status", "Status", Eye)}
      {isSuperuser && link("/analytics", "Analytics", BarChart3)}
      {(isSuperuser || isStaff) && link("/admin", "Admin", Users)}
      {isSuperuser && link("/settings", "Settings", Settings)}
      {link("/calendar", "Calendar", CalendarDays)}
    </>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-white/[0.08] bg-black/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <button className="md:hidden p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label="Menu">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="flex flex-col gap-1 mt-6">
                  <div className="px-3 pb-3 mb-3 border-b">
                    <div className="font-medium">{displayName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground capitalize">{roles[0] ?? "no role"}</div>
                  </div>
                  {navLinks}
                  <button
                    onClick={async () => { await signOut(); nav({ to: "/login" }); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted mt-4"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </SheetContent>
            </Sheet>
            <Link to="/" className="flex items-center gap-2">
              <img src="/logo.png" alt="AFA" className="h-6 w-auto brightness-0 invert opacity-70" />
              <span className="font-semibold text-sm tracking-tight">AFA Shopfloor</span>
            </Link>
          </div>
          <div className="hidden md:flex items-center gap-1">
            {navLinks}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right hidden sm:block leading-tight">
              <div className="font-medium">{displayName ?? "—"}</div>
              <div className="text-xs text-muted-foreground capitalize">{roles[0] ?? "no role"}</div>
            </div>
            <button onClick={toggleTheme} className="p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={async () => { await signOut(); nav({ to: "/login" }); }} className="p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="md:hidden border-t flex overflow-x-auto px-2 gap-1 py-1.5">
          {!isStatus && link("/", "Stations", LayoutGrid)}
          {link("/flow", "Flow", GitBranch)}
          {link("/lookup", "Lookup", Search)}
          {!isStatus && link("/requests", "Requests", ClipboardList)}
          {!isStatus && link("/issues", "Issues", AlertCircle)}
          {isStatus && link("/status", "Status", Eye)}
          {isSuperuser && link("/analytics", "Analytics", BarChart3)}
          {(isSuperuser || isStaff) && link("/admin", "Admin", Users)}
          {isSuperuser && link("/settings", "Settings", Settings)}
          {link("/calendar", "Calendar", CalendarDays)}
        </nav>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
