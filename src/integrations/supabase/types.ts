export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      engines: {
        Row: {
          created_at: string
          engine_number: string
          engine_suffix: string
          id: string
          job_order_id: string | null
          lot_id: string | null
          status: Database["public"]["Enums"]["engine_status"]
        }
        Insert: {
          created_at?: string
          engine_number: string
          engine_suffix: string
          id?: string
          job_order_id?: string | null
          lot_id?: string | null
          status?: Database["public"]["Enums"]["engine_status"]
        }
        Update: {
          created_at?: string
          engine_number?: string
          engine_suffix?: string
          id?: string
          job_order_id?: string | null
          lot_id?: string | null
          status?: Database["public"]["Enums"]["engine_status"]
        }
        Relationships: [
          {
            foreignKeyName: "engines_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
        ]
      }
      factory_snapshots: {
        Row: {
          created_at: string
          id: string
          open_issues: number
          open_shortages: number
          snapshot_date: string
          snapshot_hour: number
          station_counts: Json
          total_vehicles: number
        }
        Insert: {
          created_at?: string
          id?: string
          open_issues?: number
          open_shortages?: number
          snapshot_date?: string
          snapshot_hour?: number
          station_counts?: Json
          total_vehicles?: number
        }
        Update: {
          created_at?: string
          id?: string
          open_issues?: number
          open_shortages?: number
          snapshot_date?: string
          snapshot_hour?: number
          station_counts?: Json
          total_vehicles?: number
        }
        Relationships: []
      }
      issues: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          id: string
          reported_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["issue_severity"]
          station: Database["public"]["Enums"]["station_code"]
          status: Database["public"]["Enums"]["issue_status"]
          title: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reported_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["issue_severity"]
          station: Database["public"]["Enums"]["station_code"]
          status?: Database["public"]["Enums"]["issue_status"]
          title: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reported_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["issue_severity"]
          station?: Database["public"]["Enums"]["station_code"]
          status?: Database["public"]["Enums"]["issue_status"]
          title?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issues_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_orders: {
        Row: {
          color_plan: Json | null
          created_at: string
          id: string
          job_code: string
          lot_id: string
          status: Database["public"]["Enums"]["lot_status"]
          units: number
          vin_sequence: string[] | null
        }
        Insert: {
          color_plan?: Json | null
          created_at?: string
          id?: string
          job_code: string
          lot_id: string
          status?: Database["public"]["Enums"]["lot_status"]
          units: number
          vin_sequence?: string[] | null
        }
        Update: {
          color_plan?: Json | null
          created_at?: string
          id?: string
          job_code?: string
          lot_id?: string
          status?: Database["public"]["Enums"]["lot_status"]
          units?: number
          vin_sequence?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
        ]
      }
      lots: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lot_code: string
          model: string
          status: Database["public"]["Enums"]["lot_status"]
          total_units: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lot_code: string
          model: string
          status?: Database["public"]["Enums"]["lot_status"]
          total_units: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lot_code?: string
          model?: string
          status?: Database["public"]["Enums"]["lot_status"]
          total_units?: number
        }
        Relationships: []
      }
      model_trims: {
        Row: {
          active: boolean
          created_at: string
          id: string
          model_id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          model_id: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          model_id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "model_trims_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      models: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          employee_code: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          employee_code?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          employee_code?: string | null
          id?: string
        }
        Relationships: []
      }
      shortages: {
        Row: {
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          parts: string[]
          status: Database["public"]["Enums"]["shortage_status"]
          vehicle_id: string
        }
        Insert: {
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          parts: string[]
          status?: Database["public"]["Enums"]["shortage_status"]
          vehicle_id: string
        }
        Update: {
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          parts?: string[]
          status?: Database["public"]["Enums"]["shortage_status"]
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortages_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      standard_colors: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      station_access_requests: {
        Row: {
          created_at: string
          id: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          station: Database["public"]["Enums"]["station_code"]
          status: Database["public"]["Enums"]["access_request_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          station: Database["public"]["Enums"]["station_code"]
          status?: Database["public"]["Enums"]["access_request_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          station?: Database["public"]["Enums"]["station_code"]
          status?: Database["public"]["Enums"]["access_request_status"]
          user_id?: string
        }
        Relationships: []
      }
      station_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          station: Database["public"]["Enums"]["station_code"]
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          station: Database["public"]["Enums"]["station_code"]
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          station?: Database["public"]["Enums"]["station_code"]
          user_id?: string
        }
        Relationships: []
      }
      station_events: {
        Row: {
          color_used: string | null
          id: string
          kind: Database["public"]["Enums"]["event_kind"]
          meta: Json | null
          recorded_at: string
          recorded_by: string | null
          source: string
          station: Database["public"]["Enums"]["station_code"]
          vehicle_id: string
        }
        Insert: {
          color_used?: string | null
          id?: string
          kind: Database["public"]["Enums"]["event_kind"]
          meta?: Json | null
          recorded_at?: string
          recorded_by?: string | null
          source?: string
          station: Database["public"]["Enums"]["station_code"]
          vehicle_id: string
        }
        Update: {
          color_used?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["event_kind"]
          meta?: Json | null
          recorded_at?: string
          recorded_by?: string | null
          source?: string
          station?: Database["public"]["Enums"]["station_code"]
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "station_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          actual_color: string | null
          created_at: string
          current_station: Database["public"]["Enums"]["station_code"] | null
          id: string
          is_lot_tail: boolean
          job_order_id: string | null
          lot_id: string | null
          planned_color: string | null
          tail_note: string | null
          updated_at: string
          vin: string
          vin_suffix: string
        }
        Insert: {
          actual_color?: string | null
          created_at?: string
          current_station?: Database["public"]["Enums"]["station_code"] | null
          id?: string
          is_lot_tail?: boolean
          job_order_id?: string | null
          lot_id?: string | null
          planned_color?: string | null
          tail_note?: string | null
          updated_at?: string
          vin: string
          vin_suffix: string
        }
        Update: {
          actual_color?: string | null
          created_at?: string
          current_station?: Database["public"]["Enums"]["station_code"] | null
          id?: string
          is_lot_tail?: boolean
          job_order_id?: string | null
          lot_id?: string | null
          planned_color?: string | null
          tail_note?: string | null
          updated_at?: string
          vin?: string
          vin_suffix?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_station_access: {
        Args: {
          _station: Database["public"]["Enums"]["station_code"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      access_request_status: "pending" | "approved" | "denied"
      app_role: "superuser" | "technician" | "staff"
      engine_status: "available" | "assigned" | "installed"
      event_kind: "in" | "out"
      issue_severity: "low" | "medium" | "high" | "critical"
      issue_status: "open" | "in_progress" | "resolved" | "closed"
      lot_status: "pending" | "active" | "completed"
      shortage_status: "open" | "cleared"
      station_code:
        | "warehouse"
        | "wbs"
        | "paint"
        | "pbs"
        | "shortage"
        | "repair"
        | "cs"
        | "pdi"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_request_status: ["pending", "approved", "denied"],
      app_role: ["superuser", "technician", "staff"],
      engine_status: ["available", "assigned", "installed"],
      event_kind: ["in", "out"],
      issue_severity: ["low", "medium", "high", "critical"],
      issue_status: ["open", "in_progress", "resolved", "closed"],
      lot_status: ["pending", "active", "completed"],
      shortage_status: ["open", "cleared"],
      station_code: [
        "warehouse",
        "wbs",
        "paint",
        "pbs",
        "shortage",
        "repair",
        "cs",
        "pdi",
      ],
    },
  },
} as const
