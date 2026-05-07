import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { StationCode } from "@/lib/stations";

export type AppRole = "superuser" | "technician" | "staff" | "status";

interface AuthState {
  ready: boolean;
  user: User | null;
  session: Session | null;
  displayName: string | null;
  roles: AppRole[];
  stations: StationCode[];
  isSuperuser: boolean;
  isStaff: boolean;
  isTechnician: boolean;
  isStatus: boolean;
  hasStation: (s: StationCode) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [stations, setStations] = useState<StationCode[]>([]);
  const [ready, setReady] = useState(false);

  const loadProfile = async (uid: string) => {
    const [{ data: prof }, { data: rs }, { data: st }] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("station_assignments").select("station").eq("user_id", uid),
    ]);
    setDisplayName(prof?.display_name ?? null);
    setRoles((rs?.map(r => r.role as AppRole)) ?? []);
    setStations((st?.map(r => r.station as StationCode)) ?? []);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s); setUser(s?.user ?? null);
      if (s?.user) setTimeout(() => loadProfile(s.user.id), 0);
      else { setRoles([]); setStations([]); setDisplayName(null); }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session); setUser(data.session?.user ?? null);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    ready, user, session, displayName, roles, stations,
    isSuperuser: roles.includes("superuser"),
    isStaff: roles.includes("staff"),
    isTechnician: roles.includes("technician"),
    isStatus: roles.includes("status"),
    hasStation: (s) => roles.includes("superuser") || stations.includes(s),
    refresh: async () => { if (user) await loadProfile(user.id); },
    signOut: async () => { await supabase.auth.signOut(); },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
