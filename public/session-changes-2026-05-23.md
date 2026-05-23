# Session Changes — 23/05/2026

## Files Modified (uncommitted, not pushed)

### src/routes/station.$code.tsx
- **Paint search fix**: Removed `.filter(m => station === "paint" ? m.current_station === "paint" : true)` — paint now finds ALL vehicles
- **Paint submit smart logic**: Pre-paint vehicles (warehouse/line_feeding/body_shop/wbs) get color assigned + pulled to paint. Post-paint vehicles get color only, don't move
- **PBS color bug fix**: Non-paint submit path now saves `actual_color_id` to vehicles table + passes `color_used_id` in station_events. Previously color was never persisted for PBS/TCF/CS/PDI stations
- **PaintWaitingVehicles**: Now fetches uncolored vehicles from paint + wbs + line_feeding + body_shop (not just paint). Added `.is("actual_color_id", null)` filter. Shows station badge per vehicle. Realtime subscription to auto-remove when color assigned
- **StationWipSummary at paint**: Includes pre-paint vehicles (wbs, line_feeding, body_shop) with station labels in dialog. Shows lot codes alongside model: `Tiggo 4 — Comfort (80 & 87)`
- **WIP model fallback**: When vehicle.lot_id is null but job_order_id exists, resolves model via job_order_lots → lots
- **Contract vehicle quick-create**: At WBS/paint, when no match found, shows 3 buttons: Proton MC2 / Zemex / Quik 300. Creates vehicle with `vin: CONTRACT-{suffix}`, `current_station: wbs`, no lot/job_order
- **Color plan display removed**: Removed ColorPlanTracking from paint color assignment UI (it was showing plan quantities not per-VIN)
- **OK/Not-OK dropdown**: Unified register flow with condition dropdown (default OK). If Not OK, shows issue text input. One button to register
- **Stock count verification**: WIP summary has stock count button → checkbox dialog → verify shows checked vs unchecked
- **`postPaintStations` unified**: Moved to function scope before submit, removed duplicate definitions

### src/routes/flow.tsx
- **Model fallback for multi-lot job orders**: When vehicle.lot_id is null but job_order_id exists, fetches model via job_order_lots → lots. Fixes "—" showing for model in production flow station click

### src/routes/delayed.tsx
- **Full VIN**: Changed `v.vin_suffix` → `v.vin` in table display (line 193)

### src/routes/status.tsx
- **Full VIN**: Changed `v.vin.slice(-8)` → `v.vin` in station details (line 566)
- **Full VIN**: Changed `v.vin_suffix` → `v.vin` in delayed vehicles table (line 728)

### src/routes/shortages.tsx
- **Full VIN**: Changed `m.vin.slice(-8)` → `m.vin` in VIN search dropdown (line 180)

### src/routes/bulk.$code.tsx
- **Full VIN**: Changed `v.vin.slice(-8)` → `v.vin` in bulk operations display (line 288)

### src/routes/warehouse.tsx
- **Color plan UUID fallback**: Edit job form now shows `?` instead of raw UUID when color not found (line 823)

### supabase/functions/dashboard-report/index.ts
- **Full rewrite**: Replaced station-activity PDF with WIP status report matching the HTML format:
  - Header with department title, company name, timestamp
  - KPI cards: Total WIP, Delayed WIP, Cars In, Cars Out
  - WIP Summary table by category (Shortages: PLASTICS PART/Local/CKD/Scratches, PBS: No Issue/CKD/Local/Plastics/Dismantled, WBS: Issue/OK)
  - Bar charts using jsPDF drawing (category distribution)
  - Detailed Breakdown: per-category tables with VIN, Model, Color, Issue, Entry Time
  - Footer with page numbers and generation timestamp
  - Model fallback via job_order_lots for vehicles without lot_id
- **Deployed** to Supabase edge function

## Database Changes (via SQL)
- **Backfilled lot_id** for 120 vehicles in job order `T4C 20/2&21/1`:
  - First 30 VINs → Lot 80 (10c4cbbc-4d5c-415e-a61d-d117fa0e902e)
  - Next 90 VINs → Lot 87 (a978874b-920e-412f-b483-8c457c6ef0d7)

## Git Status
- Branch: main
- Last commit: `09a69d8` (already pushed to origin + second)
- All above changes are **uncommitted** in working tree
- Ready to commit + push when user says go
