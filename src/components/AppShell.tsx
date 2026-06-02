import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/hooks/use-notifications";
import { useTheme } from "@/hooks/use-theme";
import { useProductionMode } from "@/hooks/use-production-mode";
import {
  LayoutGrid, ClipboardList, BarChart3, Users, LogOut, Search, AlertCircle,
  Settings, GitBranch, Eye, Sun, Moon, CalendarDays, ShieldCheck, Clock,
  ShieldOff, LayoutDashboard, PenTool, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { displayName, roles, signOut, isSuperuser, isStaff, isStatus, dashboardAllowed } = useAuth();
  const { isLaunchMode } = useProductionMode();
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

  const navItems = [
    { to: "/", label: "Stations", icon: LayoutGrid, show: !(roles.length === 1 && isStatus) },
    { to: "/flow", label: "Production Flow", icon: GitBranch, show: true },
    { to: "/lookup", label: "Lookup", icon: Search, show: true },
    { to: "/requests", label: "My Requests", icon: ClipboardList, show: !(roles.length === 1 && isStatus) },
    { to: "/issues", label: "Issues", icon: AlertCircle, show: !(roles.length === 1 && isStatus) },
    { to: "/restrictions", label: "Restrictions", icon: ShieldOff, show: isSuperuser || isStaff },
    { to: "/status", label: "Status", icon: Eye, show: isStatus },
    { to: "/delayed", label: "Delayed", icon: Clock, show: isSuperuser || isStaff },
    { to: "/analytics", label: "Analytics", icon: BarChart3, show: isSuperuser || isStaff || isStatus },
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: (isSuperuser || isStaff || isStatus) && dashboardAllowed },
    { to: "/manual-entry", label: "Manual Entry", icon: PenTool, show: (isStaff || isSuperuser) && !isLaunchMode },
    { to: "/admin", label: "Admin", icon: Users, show: isSuperuser },
    { to: "/settings", label: "Settings", icon: Settings, show: isSuperuser },
    { to: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
  ];

  return (
    <SidebarProvider defaultOpen>
      <Sidebar side="left" variant="sidebar" collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="AFA" className="h-7 w-auto brightness-0 invert opacity-70 shrink-0" />
            <span className="font-semibold text-sm tracking-tight group-data-[collapsible=icon]:hidden">AFA Shopfloor</span>
          </Link>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.filter(n => n.show).map(item => {
                  const active = loc.pathname === item.to || (item.to !== "/" && loc.pathname.startsWith(item.to));
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link to={item.to}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarSeparator />
          <div className="flex flex-col gap-1">
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
              <span className="group-data-[collapsible=icon]:hidden">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            </button>
            <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
              <div className="font-medium text-xs truncate">{displayName ?? "—"}</div>
              <div className="text-[10px] text-sidebar-foreground/50 capitalize">{roles[0] ?? "no role"}</div>
            </div>
            <button
              onClick={async () => { await signOut(); nav({ to: "/login" }); }}
              className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
            </button>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-background/80 backdrop-blur-md px-4">
          <SidebarTrigger />
          <div className="md:hidden flex items-center gap-2">
            <img src="/logo.png" alt="AFA" className="h-5 w-auto brightness-0 invert opacity-70" />
            <span className="font-semibold text-xs tracking-tight">AFA Shopfloor</span>
          </div>
          <div className="ml-auto flex items-center gap-2 md:hidden">
            <button onClick={toggleTheme} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={async () => { await signOut(); nav({ to: "/login" }); }} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
