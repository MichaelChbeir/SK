/*
# KAIA Internal Operations Portal — Full Schema

## Summary
Creates all tables for the KAIA video-ad agency operations portal.

## New Tables
1. clients — agency clients with platform, purchase targets, active flag
2. products — client products with doc URLs and flags
3. people — staff members with roles, pay model, level, score, warnings
4. batches — core work unit tracking the full production pipeline
5. status_events — immutable log of every batch status transition (written by trigger)
6. time_entries — start/stop timer records for creator/editor work
7. pay_records — monthly pay computation results per person
8. levels — config: level thresholds and pay rates (seeded)
9. format_weights — config: per-format scoring weights (seeded)
10. quality_factors — config: quality score → multiplier mapping (seeded)
11. settings — config: app-wide key/value settings (seeded)

## Trigger
- `handle_batch_status_change` — fires BEFORE UPDATE on batches; when status changes:
  - Inserts a row into status_events
  - Stamps current_status_since = now()
  - Sets updated_at = now()
  - Sets approved_at = now() when transitioning into 'approved'

## Security
- RLS enabled on all tables
- All 4 CRUD policies scoped TO authenticated (USING true / WITH CHECK true)
  — This is an internal staff-only portal; all authenticated users are trusted staff
- Config tables (levels, format_weights, quality_factors, settings) also use authenticated

## Seed Data
- settings: discard_days=2, bonus amounts, usd_to_pkr=278
- levels: 6 levels from Starter ($300) to Elite ($1600)
- format_weights: ugc_30, ugc_60, scripted_30, scripted_60, slideshow, animation
- quality_factors: scores 1–5 mapped to multipliers 0.6–1.5
- people: initial admin record for mike@trykaia.com (role=admin)
*/

-- ─── TABLES ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  platform        text,
  we_script       boolean DEFAULT false,
  monthly_purchase numeric DEFAULT 0,
  weekly_target   integer DEFAULT 0,
  active          boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid REFERENCES clients(id) ON DELETE CASCADE,
  name            text NOT NULL,
  copy_doc_url    text,
  has_pdp         boolean DEFAULT false,
  has_advertorial boolean DEFAULT false,
  broll_ready     boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS people (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text UNIQUE NOT NULL,
  role            text NOT NULL,
  pay_model       text,
  base_rate       numeric DEFAULT 0,
  current_level   integer DEFAULT 1,
  current_score   numeric DEFAULT 0,
  warnings        integer DEFAULT 0,
  status          text DEFAULT 'active',
  active          boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid REFERENCES clients(id),
  product_id           uuid REFERENCES products(id),
  name                 text NOT NULL,
  format               text,
  status               text DEFAULT 'new',
  current_status_since timestamptz DEFAULT now(),
  scriptwriter_id      uuid REFERENCES people(id),
  creator_id           uuid REFERENCES people(id),
  editor_id            uuid REFERENCES people(id),
  qc_id                uuid REFERENCES people(id),
  media_buyer_id       uuid REFERENCES people(id),
  brief_url            text,
  creative_url         text,
  lander_urls          text[],
  ad_name_in_platform  text,
  hooks                integer,
  minutes              numeric DEFAULT 0,
  quality              numeric,
  internal_revisions   integer DEFAULT 0,
  client_revisions     integer DEFAULT 0,
  outcome              text,
  spend                numeric,
  roas                 numeric,
  hook_rate            numeric,
  purchases            integer,
  pay_status           text DEFAULT 'pending',
  created_at           timestamptz DEFAULT now(),
  approved_at          timestamptz,
  updated_at           timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid REFERENCES batches(id) ON DELETE CASCADE,
  from_status text,
  to_status   text,
  changed_by  uuid REFERENCES people(id),
  changed_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid REFERENCES batches(id) ON DELETE CASCADE,
  person_id   uuid REFERENCES people(id),
  stage       text,
  started_at  timestamptz DEFAULT now(),
  stopped_at  timestamptz
);

CREATE TABLE IF NOT EXISTS pay_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             uuid REFERENCES people(id),
  period                text NOT NULL,
  level                 integer,
  score                 numeric DEFAULT 0,
  base_usd              numeric DEFAULT 0,
  top3_bonus_usd        numeric DEFAULT 0,
  winner_bonus_usd      numeric DEFAULT 0,
  super_winner_bonus_usd numeric DEFAULT 0,
  total_usd             numeric DEFAULT 0,
  total_pkr             numeric DEFAULT 0,
  status                text DEFAULT 'pending',
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS levels (
  level           integer PRIMARY KEY,
  name            text NOT NULL,
  min_score       numeric NOT NULL,
  max_score       numeric NOT NULL,
  monthly_pay_usd numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS format_weights (
  format text PRIMARY KEY,
  weight numeric NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS quality_factors (
  score  numeric PRIMARY KEY,
  factor numeric NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL,
  note  text
);

-- ─── INDEXES ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_products_client ON products(client_id);
CREATE INDEX IF NOT EXISTS idx_batches_client ON batches(client_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_editor ON batches(editor_id);
CREATE INDEX IF NOT EXISTS idx_batches_creator ON batches(creator_id);
CREATE INDEX IF NOT EXISTS idx_batches_scriptwriter ON batches(scriptwriter_id);
CREATE INDEX IF NOT EXISTS idx_status_events_batch ON status_events(batch_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_person ON time_entries(person_id);
CREATE INDEX IF NOT EXISTS idx_pay_records_person ON pay_records(person_id);

-- ─── TRIGGER ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_batch_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO status_events (batch_id, from_status, to_status, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, now());

    NEW.current_status_since := now();
    NEW.updated_at := now();

    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status <> 'approved') THEN
      NEW.approved_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS batch_status_change ON batches;
CREATE TRIGGER batch_status_change
  BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION handle_batch_status_change();

-- ─── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE format_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- clients
DROP POLICY IF EXISTS "staff_select_clients" ON clients;
CREATE POLICY "staff_select_clients" ON clients FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_clients" ON clients;
CREATE POLICY "staff_insert_clients" ON clients FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_clients" ON clients;
CREATE POLICY "staff_update_clients" ON clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_delete_clients" ON clients;
CREATE POLICY "staff_delete_clients" ON clients FOR DELETE TO authenticated USING (true);

-- products
DROP POLICY IF EXISTS "staff_select_products" ON products;
CREATE POLICY "staff_select_products" ON products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_products" ON products;
CREATE POLICY "staff_insert_products" ON products FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_products" ON products;
CREATE POLICY "staff_update_products" ON products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_delete_products" ON products;
CREATE POLICY "staff_delete_products" ON products FOR DELETE TO authenticated USING (true);

-- people
DROP POLICY IF EXISTS "staff_select_people" ON people;
CREATE POLICY "staff_select_people" ON people FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_people" ON people;
CREATE POLICY "staff_insert_people" ON people FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_people" ON people;
CREATE POLICY "staff_update_people" ON people FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_delete_people" ON people;
CREATE POLICY "staff_delete_people" ON people FOR DELETE TO authenticated USING (true);

-- batches
DROP POLICY IF EXISTS "staff_select_batches" ON batches;
CREATE POLICY "staff_select_batches" ON batches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_batches" ON batches;
CREATE POLICY "staff_insert_batches" ON batches FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_batches" ON batches;
CREATE POLICY "staff_update_batches" ON batches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_delete_batches" ON batches;
CREATE POLICY "staff_delete_batches" ON batches FOR DELETE TO authenticated USING (true);

-- status_events
DROP POLICY IF EXISTS "staff_select_status_events" ON status_events;
CREATE POLICY "staff_select_status_events" ON status_events FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_status_events" ON status_events;
CREATE POLICY "staff_insert_status_events" ON status_events FOR INSERT TO authenticated WITH CHECK (true);

-- time_entries
DROP POLICY IF EXISTS "staff_select_time_entries" ON time_entries;
CREATE POLICY "staff_select_time_entries" ON time_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_time_entries" ON time_entries;
CREATE POLICY "staff_insert_time_entries" ON time_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_time_entries" ON time_entries;
CREATE POLICY "staff_update_time_entries" ON time_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- pay_records
DROP POLICY IF EXISTS "staff_select_pay_records" ON pay_records;
CREATE POLICY "staff_select_pay_records" ON pay_records FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_pay_records" ON pay_records;
CREATE POLICY "staff_insert_pay_records" ON pay_records FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_pay_records" ON pay_records;
CREATE POLICY "staff_update_pay_records" ON pay_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- config tables (read-only for non-admin, but we enforce in frontend)
DROP POLICY IF EXISTS "staff_select_levels" ON levels;
CREATE POLICY "staff_select_levels" ON levels FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_levels" ON levels;
CREATE POLICY "staff_insert_levels" ON levels FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_levels" ON levels;
CREATE POLICY "staff_update_levels" ON levels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_delete_levels" ON levels;
CREATE POLICY "staff_delete_levels" ON levels FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "staff_select_format_weights" ON format_weights;
CREATE POLICY "staff_select_format_weights" ON format_weights FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_format_weights" ON format_weights;
CREATE POLICY "staff_insert_format_weights" ON format_weights FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_format_weights" ON format_weights;
CREATE POLICY "staff_update_format_weights" ON format_weights FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_delete_format_weights" ON format_weights;
CREATE POLICY "staff_delete_format_weights" ON format_weights FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "staff_select_quality_factors" ON quality_factors;
CREATE POLICY "staff_select_quality_factors" ON quality_factors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_quality_factors" ON quality_factors;
CREATE POLICY "staff_insert_quality_factors" ON quality_factors FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_quality_factors" ON quality_factors;
CREATE POLICY "staff_update_quality_factors" ON quality_factors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff_delete_quality_factors" ON quality_factors;
CREATE POLICY "staff_delete_quality_factors" ON quality_factors FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "staff_select_settings" ON settings;
CREATE POLICY "staff_select_settings" ON settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff_insert_settings" ON settings;
CREATE POLICY "staff_insert_settings" ON settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "staff_update_settings" ON settings;
CREATE POLICY "staff_update_settings" ON settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ─── SEED CONFIG ───────────────────────────────────────────────────────────────

INSERT INTO settings (key, value, note) VALUES
  ('discard_days', '2', 'Days before a needs_edits batch is auto-discarded'),
  ('top3_bonus_usd', '20', 'Bonus USD for top-3 monthly score'),
  ('winner_bonus_usd', '30', 'Bonus USD per winner batch'),
  ('super_winner_bonus_usd', '100', 'Bonus USD per super_winner batch'),
  ('usd_to_pkr', '278', 'USD to PKR exchange rate')
ON CONFLICT (key) DO NOTHING;

INSERT INTO levels (level, name, min_score, max_score, monthly_pay_usd) VALUES
  (1, 'Starter',  0,    99,    300),
  (2, 'Junior',   100,  249,   450),
  (3, 'Mid',      250,  499,   650),
  (4, 'Senior',   500,  899,   900),
  (5, 'Expert',   900,  1499,  1200),
  (6, 'Elite',    1500, 99999, 1600)
ON CONFLICT (level) DO NOTHING;

INSERT INTO format_weights (format, weight) VALUES
  ('ugc_30',     1.0),
  ('ugc_60',     1.5),
  ('scripted_30',1.2),
  ('scripted_60',1.8),
  ('slideshow',  0.7),
  ('animation',  2.0)
ON CONFLICT (format) DO NOTHING;

INSERT INTO quality_factors (score, factor) VALUES
  (1, 0.6),
  (2, 0.8),
  (3, 1.0),
  (4, 1.2),
  (5, 1.5)
ON CONFLICT (score) DO NOTHING;

-- Seed initial admin
INSERT INTO people (name, email, role, status, active)
VALUES ('Mike', 'mike@trykaia.com', 'admin', 'active', true)
ON CONFLICT (email) DO NOTHING;
