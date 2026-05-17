export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: { key: string; updated_at: string | null; value: Json }
        Insert: { key: string; updated_at?: string | null; value?: Json }
        Update: { key?: string; updated_at?: string | null; value?: Json }
        Relationships: []
      }
      engines: {
        Row: { created_at: string; engine_number: string; engine_suffix: string; id: string; job_order_id: string | null; lot_id: string | null; status: Database["public"]["Enums"]["engine_status"] }
        Insert: { created_at?: string; engine_number: string; engine_suffix: string; id?: string; job_order_id?: string | null; lot_id?: string | null; status?: Database["public"]["Enums"]["engine_status"] }
        Update: { created_at?: string; engine_number?: string; engine_suffix?: string; id?: string; job_order_id?: string | null; lot_id?: string | null; status?: Database["public"]["Enums"]["engine_status"] }
        Relationships: [{ foreignKeyName: "engines_job_order_id_fkey"; columns: ["job_order_id"]; isOneToOne: false; referencedRelation: "job_orders"; referencedColumns: ["id"] }, { foreignKeyName: "engines_lot_id_fkey"; columns: ["lot_id"]; isOneToOne: false; referencedRelation: "lots"; referencedColumns: ["id"] }]
      }
      factory_calendar: {
        Row: { created_at: string; date: string; id: string; is_working_day: boolean; notes: string | null; working_hours: number | null }
        Insert: { created_at?: string; date: string; id?: string; is_working_day?: boolean; notes?: string | null; working_hours?: number | null }
        Update: { created_at?: string; date?: string; id?: string; is_working_day?: boolean; notes?: string | null; working_hours?: number | null }
        Relationships: []
      }
      factory_snapshots: {
        Row: { created_at: string; id: string; open_issues: number; open_shortages: number; snapshot_date: string; snapshot_hour: number; station_counts: Json; total_vehicles: number }
        Insert: { created_at?: string; id?: string; open_issues?: number; open_shortages?: number; snapshot_date?: string; snapshot_hour?: number; station_counts?: Json; total_vehicles?: number }
        Update: { created_at?: string; id?: string; open_issues?: number; open_shortages?: number; snapshot_date?: string; snapshot_hour?: number; station_counts?: Json; total_vehicles?: number }
        Relationships: []
      }
      issues: {
        Row: { assigned_to: string | null; created_at: string; description: string | null; id: string; reported_by: string | null; resolved_at: string | null; resolved_by: string | null; severity: Database["public"]["Enums"]["issue_severity"]; station: Database["public"]["Enums"]["station_code"]; status: Database["public"]["Enums"]["issue_status"]; title: string; updated_at: string; vehicle_id: string | null }
        Insert: { assigned_to?: string | null; created_at?: string; description?: string | null; id?: string; reported_by?: string | null; resolved_at?: string | null; resolved_by?: string | null; severity?: Database["public"]["Enums"]["issue_severity"]; station: Database["public"]["Enums"]["station_code"]; status?: Database["public"]["Enums"]["issue_status"]; title: string; updated_at?: string; vehicle_id?: string | null }
        Update: { assigned_to?: string | null; created_at?: string; description?: string | null; id?: string; reported_by?: string | null; resolved_at?: string | null; resolved_by?: string | null; severity?: Database["public"]["Enums"]["issue_severity"]; station?: Database["public"]["Enums"]["station_code"]; status?: Database["public"]["Enums"]["issue_status"]; title?: string; updated_at?: string; vehicle_id?: string | null }
        Relationships: [{ foreignKeyName: "issues_vehicle_id_fkey"; columns: ["vehicle_id"]; isOneToOne: false; referencedRelation: "vehicles"; referencedColumns: ["id"] }]
      }
      job_order_lots: {
        Row: { created_at: string | null; id: string; job_order_id: string; lot_id: string; vehicle_count: number }
        Insert: { created_at?: string | null; id?: string; job_order_id: string; lot_id: string; vehicle_count?: number }
        Update: { created_at?: string | null; id?: string; job_order_id?: string; lot_id?: string; vehicle_count?: number }
        Relationships: [{ foreignKeyName: "job_order_lots_job_order_id_fkey"; columns: ["job_order_id"]; isOneToOne: false; referencedRelation: "job_orders"; referencedColumns: ["id"] }, { foreignKeyName: "job_order_lots_lot_id_fkey"; columns: ["lot_id"]; isOneToOne: false; referencedRelation: "lots"; referencedColumns: ["id"] }]
      }
      job_orders: {
        Row: { color_plan: Json | null; contract_company: string | null; created_at: string; id: string; is_contract: boolean; job_code: string; lot_id: string | null; model_year: string | null; released_at: string | null; status: Database["public"]["Enums"]["lot_status"]; units: number; vin_sequence: string[] | null }
        Insert: { color_plan?: Json | null; contract_company?: string | null; created_at?: string; id?: string; is_contract?: boolean; job_code: string; lot_id?: string | null; model_year?: string | null; released_at?: string | null; status?: Database["public"]["Enums"]["lot_status"]; units: number; vin_sequence?: string[] | null }
        Update: { color_plan?: Json | null; contract_company?: string | null; created_at?: string; id?: string; is_contract?: boolean; job_code?: string; lot_id?: string | null; model_year?: string | null; released_at?: string | null; status?: Database["public"]["Enums"]["lot_status"]; units?: number; vin_sequence?: string[] | null }
        Relationships: [{ foreignKeyName: "job_orders_lot_id_fkey"; columns: ["lot_id"]; isOneToOne: false; referencedRelation: "lots"; referencedColumns: ["id"] }]
      }
      lots: {
        Row: { chinese_number: string | null; created_at: string; created_by: string | null; id: string; lot_code: string; model: string; producible_units: number | null; status: Database["public"]["Enums"]["lot_status"]; total_units: number }
        Insert: { chinese_number?: string | null; created_at?: string; created_by?: string | null; id?: string; lot_code: string; model: string; producible_units?: number | null; status?: Database["public"]["Enums"]["lot_status"]; total_units: number }
        Update: { chinese_number?: string | null; created_at?: string; created_by?: string | null; id?: string; lot_code?: string; model?: string; producible_units?: number | null; status?: Database["public"]["Enums"]["lot_status"]; total_units?: number }
        Relationships: []
      }
      model_trims: {
        Row: { active: boolean; created_at: string; id: string; model_id: string; name: string; sort_order: number }
        Insert: { active?: boolean; created_at?: string; id?: string; model_id: string; name: string; sort_order?: number }
        Update: { active?: boolean; created_at?: string; id?: string; model_id?: string; name?: string; sort_order?: number }
        Relationships: [{ foreignKeyName: "model_trims_model_id_fkey"; columns: ["model_id"]; isOneToOne: false; referencedRelation: "models"; referencedColumns: ["id"] }]
      }
      models: {
        Row: { active: boolean; created_at: string; id: string; name: string }
        Insert: { active?: boolean; created_at?: string; id?: string; name: string }
        Update: { active?: boolean; created_at?: string; id?: string; name?: string }
        Relationships: []
      }
      production_plans: {
        Row: { created_at: string | null; daily_target: number; id: string; jph_target: number; model_id: string | null; month: string; monthly_plan: number; updated_at: string | null }
        Insert: { created_at?: string | null; daily_target?: number; id?: string; jph_target?: number; model_id?: string | null; month: string; monthly_plan?: number; updated_at?: string | null }
        Update: { created_at?: string | null; daily_target?: number; id?: string; jph_target?: number; model_id?: string | null; month?: string; monthly_plan?: number; updated_at?: string | null }
        Relationships: [{ foreignKeyName: "production_plans_model_id_fkey"; columns: ["model_id"]; isOneToOne: false; referencedRelation: "models"; referencedColumns: ["id"] }]
      }
      profiles: {
        Row: { created_at: string; display_name: string; employee_code: string | null; id: string }
        Insert: { created_at?: string; display_name: string; employee_code?: string | null; id: string }
        Update: { created_at?: string; display_name?: string; employee_code?: string | null; id?: string }
        Relationships: []
      }
      shortages: {
        Row: { cleared_at: string | null; cleared_by: string | null; created_at: string; created_by: string | null; id: string; notes: string | null; part_type: string | null; parts: string[]; received_by: string | null; released_by: string | null; responsibility: string | null; shortage_reason: string | null; status: Database["public"]["Enums"]["shortage_status"]; vehicle_id: string }
        Insert: { cleared_at?: string | null; cleared_by?: string | null; created_at?: string; created_by?: string | null; id?: string; notes?: string | null; part_type?: string | null; parts: string[]; received_by?: string | null; released_by?: string | null; responsibility?: string | null; shortage_reason?: string | null; status?: Database["public"]["Enums"]["shortage_status"]; vehicle_id: string }
        Update: { cleared_at?: string | null; cleared_by?: string | null; created_at?: string; created_by?: string | null; id?: string; notes?: string | null; part_type?: string | null; parts?: string[]; received_by?: string | null; released_by?: string | null; responsibility?: string | null; shortage_reason?: string | null; status?: Database["public"]["Enums"]["shortage_status"]; vehicle_id?: string }
        Relationships: [{ foreignKeyName: "shortages_vehicle_id_fkey"; columns: ["vehicle_id"]; isOneToOne: false; referencedRelation: "vehicles"; referencedColumns: ["id"] }]
      }
      standard_colors: {
        Row: { active: boolean; code: string; created_at: string; id: string; name: string; sort_order: number }
        Insert: { active?: boolean; code: string; created_at?: string; id?: string; name: string; sort_order?: number }
        Update: { active?: boolean; code?: string; created_at?: string; id?: string; name?: string; sort_order?: number }
        Relationships: []
      }
      station_access_requests: {
        Row: { created_at: string; id: string; note: string | null; resolved_at: string | null; resolved_by: string | null; station: Database["public"]["Enums"]["station_code"]; status: Database["public"]["Enums"]["access_request_status"]; user_id: string }
        Insert: { created_at?: string; id?: string; note?: string | null; resolved_at?: string | null; resolved_by?: string | null; station: Database["public"]["Enums"]["station_code"]; status?: Database["public"]["Enums"]["access_request_status"]; user_id: string }
        Update: { created_at?: string; id?: string; note?: string | null; resolved_at?: string | null; resolved_by?: string | null; station?: Database["public"]["Enums"]["station_code"]; status?: Database["public"]["Enums"]["access_request_status"]; user_id?: string }
        Relationships: []
      }
      station_assignments: {
        Row: { assigned_at: string; assigned_by: string | null; id: string; station: Database["public"]["Enums"]["station_code"]; user_id: string }
        Insert: { assigned_at?: string; assigned_by?: string | null; id?: string; station: Database["public"]["Enums"]["station_code"]; user_id: string }
        Update: { assigned_at?: string; assigned_by?: string | null; id?: string; station?: Database["public"]["Enums"]["station_code"]; user_id?: string }
        Relationships: []
      }
      station_events: {
        Row: { color_used_id: string | null; id: string; kind: Database["public"]["Enums"]["event_kind"]; meta: Json | null; recorded_at: string; recorded_by: string | null; source: string; station: Database["public"]["Enums"]["station_code"]; vehicle_id: string }
        Insert: { color_used_id?: string | null; id?: string; kind: Database["public"]["Enums"]["event_kind"]; meta?: Json | null; recorded_at?: string; recorded_by?: string | null; source?: string; station: Database["public"]["Enums"]["station_code"]; vehicle_id: string }
        Update: { color_used_id?: string | null; id?: string; kind?: Database["public"]["Enums"]["event_kind"]; meta?: Json | null; recorded_at?: string; recorded_by?: string | null; source?: string; station?: Database["public"]["Enums"]["station_code"]; vehicle_id?: string }
        Relationships: [{ foreignKeyName: "station_events_color_used_id_fkey"; columns: ["color_used_id"]; isOneToOne: false; referencedRelation: "standard_colors"; referencedColumns: ["id"] }, { foreignKeyName: "station_events_vehicle_id_fkey"; columns: ["vehicle_id"]; isOneToOne: false; referencedRelation: "vehicles"; referencedColumns: ["id"] }]
      }
      user_roles: {
        Row: { created_at: string; id: string; role: Database["public"]["Enums"]["app_role"]; user_id: string }
        Insert: { created_at?: string; id?: string; role: Database["public"]["Enums"]["app_role"]; user_id: string }
        Update: { created_at?: string; id?: string; role?: Database["public"]["Enums"]["app_role"]; user_id?: string }
        Relationships: []
      }
      vehicle_archive: {
        Row: { archived_at: string | null; events_data: Json | null; id: string; issues_data: Json | null; lot_code: string | null; lot_model: string | null; shortages_data: Json | null; vehicle_data: Json; vin: string; vin_suffix: string | null }
        Insert: { archived_at?: string | null; events_data?: Json | null; id?: string; issues_data?: Json | null; lot_code?: string | null; lot_model?: string | null; shortages_data?: Json | null; vehicle_data: Json; vin: string; vin_suffix?: string | null }
        Update: { archived_at?: string | null; events_data?: Json | null; id?: string; issues_data?: Json | null; lot_code?: string | null; lot_model?: string | null; shortages_data?: Json | null; vehicle_data?: Json; vin?: string; vin_suffix?: string | null }
        Relationships: []
      }
      vehicle_restrictions: {
        Row: { cleared_at: string | null; cleared_by: string | null; created_at: string | null; created_by: string | null; id: string; job_order_id: string | null; notes: string | null; restriction: string; status: string; stop_at_station: Database["public"]["Enums"]["station_code"]; vehicle_id: string }
        Insert: { cleared_at?: string | null; cleared_by?: string | null; created_at?: string | null; created_by?: string | null; id?: string; job_order_id?: string | null; notes?: string | null; restriction: string; status?: string; stop_at_station: Database["public"]["Enums"]["station_code"]; vehicle_id: string }
        Update: { cleared_at?: string | null; cleared_by?: string | null; created_at?: string | null; created_by?: string | null; id?: string; job_order_id?: string | null; notes?: string | null; restriction?: string; status?: string; stop_at_station?: Database["public"]["Enums"]["station_code"]; vehicle_id?: string }
        Relationships: [{ foreignKeyName: "vehicle_restrictions_job_order_id_fkey"; columns: ["job_order_id"]; isOneToOne: false; referencedRelation: "job_orders"; referencedColumns: ["id"] }, { foreignKeyName: "vehicle_restrictions_vehicle_id_fkey"; columns: ["vehicle_id"]; isOneToOne: false; referencedRelation: "vehicles"; referencedColumns: ["id"] }]
      }
      vehicles: {
        Row: { actual_color_id: string | null; completed_at: string | null; created_at: string; current_station: Database["public"]["Enums"]["station_code"] | null; id: string; is_lot_tail: boolean; job_order_id: string | null; lot_id: string | null; planned_color_id: string | null; tail_note: string | null; updated_at: string; vin: string; vin_suffix: string }
        Insert: { actual_color_id?: string | null; completed_at?: string | null; created_at?: string; current_station?: Database["public"]["Enums"]["station_code"] | null; id?: string; is_lot_tail?: boolean; job_order_id?: string | null; lot_id?: string | null; planned_color_id?: string | null; tail_note?: string | null; updated_at?: string; vin: string; vin_suffix: string }
        Update: { actual_color_id?: string | null; completed_at?: string | null; created_at?: string; current_station?: Database["public"]["Enums"]["station_code"] | null; id?: string; is_lot_tail?: boolean; job_order_id?: string | null; lot_id?: string | null; planned_color_id?: string | null; tail_note?: string | null; updated_at?: string; vin?: string; vin_suffix?: string }
        Relationships: [{ foreignKeyName: "vehicles_actual_color_id_fkey"; columns: ["actual_color_id"]; isOneToOne: false; referencedRelation: "standard_colors"; referencedColumns: ["id"] }, { foreignKeyName: "vehicles_job_order_id_fkey"; columns: ["job_order_id"]; isOneToOne: false; referencedRelation: "job_orders"; referencedColumns: ["id"] }, { foreignKeyName: "vehicles_lot_id_fkey"; columns: ["lot_id"]; isOneToOne: false; referencedRelation: "lots"; referencedColumns: ["id"] }, { foreignKeyName: "vehicles_planned_color_id_fkey"; columns: ["planned_color_id"]; isOneToOne: false; referencedRelation: "standard_colors"; referencedColumns: ["id"] }]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      archive_completed_vehicles: { Args: never; Returns: undefined }
      decrease_producible: { Args: { count_input: number; lot_id_input: string }; Returns: undefined }
      get_daily_status_data: { Args: never; Returns: Json }
      get_delayed_vehicles: { Args: { threshold_days?: number }; Returns: { current_station: string; entered_at: string; job_order_id: string; lot_code: string; lot_model: string; vehicle_id: string; vin: string; vin_suffix: string; working_days_at_station: number; working_hours_at_station: number }[] }
      get_home_stats: { Args: never; Returns: Json }
      has_role: { Args: { _role: Database["public"]["Enums"]["app_role"]; _user_id: string }; Returns: boolean }
      has_station_access: { Args: { _station: Database["public"]["Enums"]["station_code"]; _user_id: string }; Returns: boolean }
    }
    Enums: {
      access_request_status: "pending" | "approved" | "denied"
      app_role: "superuser" | "technician" | "staff" | "status"
      engine_status: "available" | "assigned" | "installed"
      event_kind: "in" | "out"
      issue_severity: "low" | "medium" | "high" | "critical"
      issue_status: "open" | "in_progress" | "resolved" | "closed"
      lot_status: "pending" | "active" | "completed"
      shortage_status: "open" | "cleared"
      station_code: "warehouse" | "line_feeding" | "body_shop" | "wbs" | "paint" | "pbs" | "shortage" | "repair" | "cs" | "pdi" | "tcf" | "waiting_repair" | "tcf_offline"
    }
    CompositeTypes: { [_ in never]: never }
  }
}
