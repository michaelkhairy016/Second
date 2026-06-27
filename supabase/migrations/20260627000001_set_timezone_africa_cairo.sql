-- Bucket production counts by Africa/Cairo (factory local; UTC+2 winter / UTC+3
-- summer with DST -- the Africa/Cairo zone handles the switch automatically).
--
-- Why: the app + edge functions pass NAIVE day-boundary strings like
-- '2026-06-22T00:00:00' (no offset) into the get_production_events RPC and into
-- direct gte/lte filters on created_at / cleared_at. Postgres casts a naive
-- timestamp -> timestamptz using the session TimeZone GUC, which was UTC, so the
-- factory day was being cut at UTC midnight and overnight (Cairo) scans landed in
-- the previous day -- daily counts disagreed with other departments.
--
-- Setting the GUC at the DATABASE + every login role means every connection
-- (anon/authenticated dashboard, service_role edge functions, postgres) interprets
-- those naive strings as Cairo wall-clock, so the bucketing aligns with the
-- browser-selected Cairo date.
--
-- Stored values are untouched: recorded_at / created_at are timestamptz = absolute
-- UTC instants. Only the cast of naive inputs and text display change.
-- Reversible: ALTER ROLE ... RESET timezone; ALTER DATABASE ... RESET timezone.

ALTER DATABASE postgres SET timezone = 'Africa/Cairo';

-- supabase_admin / supabase_auth_admin are reserved roles (superuser-only); skipped.
ALTER ROLE postgres         SET timezone = 'Africa/Cairo';
ALTER ROLE anon             SET timezone = 'Africa/Cairo';
ALTER ROLE authenticated    SET timezone = 'Africa/Cairo';
ALTER ROLE service_role     SET timezone = 'Africa/Cairo';
