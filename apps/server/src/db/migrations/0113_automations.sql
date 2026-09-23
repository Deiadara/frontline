-- The Right Hand's standing orders (2026-09-22).
--
-- One row per slot per base. `kind` is what the slot has been told to do, and the server looks up
-- a runner by it, so a second kind of standing order is a new runner and no schema change.
--
-- Deliberately not a column per instruction: `force_json` and `unit_slots` are the two ways to
-- name a party and exactly one is set, which a CHECK would have to know about and which the Zod
-- schema already states. The table's job is to hold the row.
CREATE TABLE automations (
  id              TEXT    PRIMARY KEY,
  base_id         TEXT    NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  slot            INTEGER NOT NULL,
  kind            TEXT    NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 0,
  order_kind      TEXT    NOT NULL DEFAULT 'missions',
  step            INTEGER NOT NULL DEFAULT 0,
  force_json      TEXT    NOT NULL DEFAULT '{}',
  officer_id      TEXT,
  unit_slots      INTEGER,
  optimise_for    TEXT,
  mission_id      TEXT,
  resting_since   TEXT,
  stalled         TEXT,
  UNIQUE (base_id, slot)
);

-- The world clock asks "whose slots are on" every tick, so that lookup gets an index, not a scan.
CREATE INDEX idx_automations_enabled ON automations (enabled, base_id);
