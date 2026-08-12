-- Frontline initial schema.
-- Conventions: TEXT ids (uuid), ISO-8601 TEXT timestamps, JSON payloads in *_json TEXT columns
-- validated against @frontline/shared Zod schemas at the application boundary.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  overseer_id TEXT REFERENCES overseers (id),
  created_at TEXT NOT NULL
);

CREATE TABLE overseers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  preset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  archetype TEXT NOT NULL CHECK (archetype IN ('enforcer', 'netrunner', 'fixer', 'technocrat')),
  portrait_id TEXT NOT NULL,
  bio TEXT NOT NULL,
  skills_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE bases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id),
  name TEXT NOT NULL,
  district_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  resources_json TEXT NOT NULL,
  buildings_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE battles (
  id TEXT PRIMARY KEY,
  attacker_base_id TEXT NOT NULL REFERENCES bases (id),
  target_district_id TEXT NOT NULL,
  winner TEXT NOT NULL CHECK (winner IN ('attacker', 'defender')),
  log_json TEXT NOT NULL,
  rewards_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_overseers_user ON overseers (user_id);
CREATE INDEX idx_bases_owner ON bases (owner_id);
CREATE INDEX idx_bases_district ON bases (district_id);
CREATE INDEX idx_battles_attacker ON battles (attacker_base_id);
