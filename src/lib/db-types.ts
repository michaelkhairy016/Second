import type { Database, Enums, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

// Engine types
export type Engine = Tables<"engines">;
export type EngineStatus = Enums<"engine_status">;
export type EngineSearchResult = Pick<Engine, "id" | "engine_number" | "engine_suffix" | "lot_id" | "job_order_id" | "status"> & {
  lot: { lot_code: string; model: string } | null;
};

// Row types
export type Vehicle = Tables<"vehicles">;
export type StationEvent = Tables<"station_events">;
export type Shortage = Tables<"shortages">;
export type Lot = Tables<"lots">;
export type JobOrder = Tables<"job_orders">;
export type Profile = Tables<"profiles">;
export type UserRole = Tables<"user_roles">;
export type StationAssignment = Tables<"station_assignments">;
export type StationAccessRequest = Tables<"station_access_requests">;
export type Issue = Tables<"issues">;
export type StandardColor = Tables<"standard_colors">;
export type Model = Tables<"models">;
export type ModelTrim = Tables<"model_trims">;
export type FactorySnapshot = Tables<"factory_snapshots">;
export type AppSetting = Tables<"app_settings">;
export type ProductionPlan = Tables<"production_plans">;
export type VehicleRestriction = Tables<"vehicle_restrictions">;

// Insert types
export type VehicleInsert = TablesInsert<"vehicles">;
export type StationEventInsert = TablesInsert<"station_events">;
export type ShortageInsert = TablesInsert<"shortages">;
export type IssueInsert = TablesInsert<"issues">;

// Update types
export type VehicleUpdate = TablesUpdate<"vehicles">;
export type StationEventUpdate = TablesUpdate<"station_events">;

// Enum types
export type StationCode = Enums<"station_code">;
export type AppRole = Enums<"app_role">;
export type EventKind = Enums<"event_kind">;
export type ShortageStatus = Enums<"shortage_status">;
export type AccessRequestStatus = Enums<"access_request_status">;
export type LotStatus = Enums<"lot_status">;
export type IssueSeverity = Enums<"issue_severity">;
export type IssueStatus = Enums<"issue_status">;

// Joined types used across routes
export type ShortageWithVehicle = Shortage & {
  vehicle: Pick<Vehicle, "vin" | "current_station"> | null;
};

export type StationEventWithVehicle = Pick<StationEvent, "id" | "kind" | "color_used_id" | "recorded_at" | "meta"> & {
  vehicle: { vin: string } | null;
};

export type VehicleSearchResult = Pick<
  Vehicle,
  "id" | "vin" | "vin_suffix" | "planned_color_id" | "actual_color_id" | "current_station" | "lot_id" | "job_order_id" | "is_lot_tail" | "tail_note"
>;

export type AccessRequestWithProfile = StationAccessRequest & {
  profile: { display_name: string } | null;
};

export type IssueWithVehicle = Issue & {
  vehicle: Pick<Vehicle, "vin" | "current_station"> | null;
  reporter: { display_name: string } | null;
};

export type ModelWithTrims = Model & { trims: ModelTrim[] };
