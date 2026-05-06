import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/hooks/use-notifications";
import { LayoutGrid, ClipboardList, BarChart3, Users, LogOut, Workflow, Search, Menu, AlertCircle, Settings } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { displayName, roles, signOut, isSuperuser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  useNotifications();

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
      {link("/", "Stations", LayoutGrid)}
      {link("/flow", "Production Flow", Workflow)}
      {link("/lookup", "Lookup", Search)}
      {link("/requests", "My Requests", ClipboardList)}
      {link("/issues", "Issues", AlertCircle)}
      {isSuperuser && link("/analytics", "Analytics", BarChart3)}
      {isSuperuser && link("/admin", "Admin", Users)}
      {isSuperuser && link("/settings", "Settings", Settings)}
    </>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card sticky top-0 z-30">
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
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground grid place-items-center"><Workflow className="h-4 w-4" /></div>
              <span>Nexus-Flow</span>
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
            <button onClick={async () => { await signOut(); nav({ to: "/login" }); }} className="p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="md:hidden border-t flex overflow-x-auto px-2 gap-1 py-1.5">
          {link("/", "Stations", LayoutGrid)}
          {link("/flow", "Flow", Workflow)}
          {link("/lookup", "Lookup", Search)}
          {link("/requests", "Requests", ClipboardList)}
          {link("/issues", "Issues", AlertCircle)}
          {isSuperuser && link("/analytics", "Analytics", BarChart3)}
          {isSuperuser && link("/admin", "Admin", Users)}
          {isSuperuser && link("/settings", "Settings", Settings)}
        </nav>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
