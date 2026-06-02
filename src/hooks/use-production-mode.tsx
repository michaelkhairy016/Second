import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ProductionMode = "launch" | "detailed";

interface ProductionModeState {
  mode: ProductionMode;
  isLaunchMode: boolean;
  loading: boolean;
}

const ProductionModeContext = createContext<ProductionModeState>({
  mode: "detailed",
  isLaunchMode: false,
  loading: true,
});

export function useProductionMode() {
  return useContext(ProductionModeContext);
}

export function ProductionModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ProductionMode>("detailed");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "production_mode")
        .maybeSingle();
      if (data?.value && typeof data.value === "object") {
        setMode((data.value as { mode: ProductionMode }).mode ?? "detailed");
      }
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel("production-mode")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings", filter: "key=eq.production_mode" },
        (payload) => {
          const val = payload.new as { value: { mode: ProductionMode } } | null;
          if (val?.value?.mode) setMode(val.value.mode);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <ProductionModeContext.Provider value={{ mode, isLaunchMode: mode === "launch", loading }}>
      {children}
    </ProductionModeContext.Provider>
  );
}
