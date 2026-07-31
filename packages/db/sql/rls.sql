-- =====================================================================
-- Baraat — Row-Level Security policies
-- Role separation is enforced at the DB layer, not just middleware.
--
-- Context model:
--   The API sets, per request (inside a transaction):
--     SET LOCAL app.user_id = '<user cuid>';
--     SET LOCAL app.role    = 'ADMIN' | 'DRIVER' | 'GUEST';
--   System processes (dispatch worker, migrations, seed) run with NO
--   app context -> treated as system: full access.
--   On Supabase these same policies can be keyed off auth.jwt() claims
--   instead of session settings; the shape is identical.
-- =====================================================================

-- Helper predicates -----------------------------------------------------
CREATE OR REPLACE FUNCTION app_role() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'SYSTEM')
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_system_or_admin() RETURNS boolean AS $$
  SELECT app_role() IN ('SYSTEM', 'ADMIN')
$$ LANGUAGE sql STABLE;

-- Enable + force RLS (force = applies even to table owner) --------------
ALTER TABLE "Driver"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Driver"        FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Guest"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Guest"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "Trip"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trip"          FORCE  ROW LEVEL SECURITY;
ALTER TABLE "TripGuest"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TripGuest"     FORCE  ROW LEVEL SECURITY;
ALTER TABLE "RideRequest"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RideRequest"   FORCE  ROW LEVEL SECURITY;

-- Driver: sees ONLY their own row; admin/system see all -----------------
DROP POLICY IF EXISTS driver_select ON "Driver";
CREATE POLICY driver_select ON "Driver"
  FOR SELECT USING (
    is_system_or_admin()
    OR ("userId" = app_user_id())
  );

DROP POLICY IF EXISTS driver_update ON "Driver";
CREATE POLICY driver_update ON "Driver"
  FOR UPDATE USING (
    is_system_or_admin()
    OR ("userId" = app_user_id())
  );

DROP POLICY IF EXISTS driver_write_admin ON "Driver";
CREATE POLICY driver_write_admin ON "Driver"
  FOR INSERT WITH CHECK (is_system_or_admin());

DROP POLICY IF EXISTS driver_delete_admin ON "Driver";
CREATE POLICY driver_delete_admin ON "Driver"
  FOR DELETE USING (is_system_or_admin());

-- Trip: driver sees only THEIR trips; guest sees trips they are on ------
DROP POLICY IF EXISTS trip_select ON "Trip";
CREATE POLICY trip_select ON "Trip"
  FOR SELECT USING (
    is_system_or_admin()
    OR EXISTS (
      SELECT 1 FROM "Driver" d
      WHERE d.id = "Trip"."driverId" AND d."userId" = app_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM "TripGuest" tg
      JOIN "Guest" g ON g.id = tg."guestId"
      WHERE tg."tripId" = "Trip".id AND g."userId" = app_user_id()
    )
  );

DROP POLICY IF EXISTS trip_update ON "Trip";
CREATE POLICY trip_update ON "Trip"
  FOR UPDATE USING (
    is_system_or_admin()
    OR EXISTS (
      SELECT 1 FROM "Driver" d
      WHERE d.id = "Trip"."driverId" AND d."userId" = app_user_id()
    )
  );

DROP POLICY IF EXISTS trip_write_system ON "Trip";
CREATE POLICY trip_write_system ON "Trip"
  FOR INSERT WITH CHECK (is_system_or_admin());

-- TripGuest --------------------------------------------------------------
DROP POLICY IF EXISTS tripguest_select ON "TripGuest";
CREATE POLICY tripguest_select ON "TripGuest"
  FOR SELECT USING (
    is_system_or_admin()
    OR EXISTS (
      SELECT 1 FROM "Trip" t JOIN "Driver" d ON d.id = t."driverId"
      WHERE t.id = "TripGuest"."tripId" AND d."userId" = app_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM "Guest" g
      WHERE g.id = "TripGuest"."guestId" AND g."userId" = app_user_id()
    )
  );

DROP POLICY IF EXISTS tripguest_write_system ON "TripGuest";
CREATE POLICY tripguest_write_system ON "TripGuest"
  FOR ALL USING (is_system_or_admin()) WITH CHECK (is_system_or_admin());

-- Guest: guest sees own row; driver sees guests riding on their trips ---
DROP POLICY IF EXISTS guest_select ON "Guest";
CREATE POLICY guest_select ON "Guest"
  FOR SELECT USING (
    is_system_or_admin()
    OR ("userId" = app_user_id())
    OR EXISTS (
      SELECT 1
      FROM "TripGuest" tg
      JOIN "Trip" t ON t.id = tg."tripId"
      JOIN "Driver" d ON d.id = t."driverId"
      WHERE tg."guestId" = "Guest".id
        AND d."userId" = app_user_id()
        AND t.status IN ('ASSIGNED','ACCEPTED','ARRIVED_PICKUP','BOARDED')
    )
  );

DROP POLICY IF EXISTS guest_update ON "Guest";
CREATE POLICY guest_update ON "Guest"
  FOR UPDATE USING (
    is_system_or_admin() OR ("userId" = app_user_id())
  );

DROP POLICY IF EXISTS guest_write_admin ON "Guest";
CREATE POLICY guest_write_admin ON "Guest"
  FOR INSERT WITH CHECK (is_system_or_admin());

-- RideRequest: guest sees/creates own; admin decides --------------------
DROP POLICY IF EXISTS riderequest_select ON "RideRequest";
CREATE POLICY riderequest_select ON "RideRequest"
  FOR SELECT USING (
    is_system_or_admin()
    OR EXISTS (
      SELECT 1 FROM "Guest" g
      WHERE g.id = "RideRequest"."guestId" AND g."userId" = app_user_id()
    )
  );

DROP POLICY IF EXISTS riderequest_insert ON "RideRequest";
CREATE POLICY riderequest_insert ON "RideRequest"
  FOR INSERT WITH CHECK (
    is_system_or_admin()
    OR EXISTS (
      SELECT 1 FROM "Guest" g
      WHERE g.id = "RideRequest"."guestId" AND g."userId" = app_user_id()
    )
  );

DROP POLICY IF EXISTS riderequest_update_admin ON "RideRequest";
CREATE POLICY riderequest_update_admin ON "RideRequest"
  FOR UPDATE USING (is_system_or_admin());
