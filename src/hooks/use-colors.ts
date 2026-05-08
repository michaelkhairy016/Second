import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface StandardColor {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sort_order: number;
}

export function useColors() {
  const [colors, setColors] = useState<Map<string, StandardColor>>(new Map());

  useEffect(() => {
    supabase
      .from("standard_colors")
      .select("*")
      .order("sort_order")
      .then(({ data }) => {
        if (data) setColors(new Map(data.map(c => [c.id, c])));
      });
  }, []);

  return {
    colors,
    list: Array.from(colors.values()),
    activeList: Array.from(colors.values()).filter(c => c.active),
    getName: (id: string | null) => id ? colors.get(id)?.name ?? "Unknown" : "—",
    getCode: (id: string | null) => id ? colors.get(id)?.code ?? "N/A" : "—",
    getById: (id: string | null) => id ? colors.get(id) ?? null : null,
  };
}
