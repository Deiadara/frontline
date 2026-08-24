-- The city: places, who holds them, and who has seen them (GDD §A4, §A5).
--
-- Number allocated under INTERFACES.md R6/R9: do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- Three new pieces of state, and they live in three different places for three different reasons.
--
-- `place_control` is **world state**. A place is held by exactly one party and every crew sees the
-- same answer, so it cannot live inside a base: two crews reading their own copy of who holds the
-- Bonefield is how a shared map stops being shared. Rows are created lazily on first read rather
-- than seeded here: the place catalogue is authored in TypeScript and a migration that enumerated
-- it would be a second copy of the map, guaranteed to drift the first time a place is renamed.
--
-- `district_intel` is **per-crew knowledge**, which is exactly what fog of war is. A district is
-- unscouted until this table says otherwise, and it says so per base.
--
-- The army and the training queue go on `bases` alongside the build queue, because they are the
-- crew's own and settle on the same read. Note what is *not* here: garrisoned units. Those live on
-- `place_control.garrison_json`, because a garrison belongs to the ground. It is what changes
-- hands, or dies, when the place does.

CREATE TABLE place_control (
  place_id TEXT PRIMARY KEY,
  -- 'unoccupied' | 'government' | 'looters' | 'faction'
  holder_kind TEXT NOT NULL CHECK (
    holder_kind IN ('unoccupied', 'government', 'looters', 'faction')
  ),
  -- Set only when holder_kind = 'faction'. Not a foreign key on purpose: a base that is deleted
  -- should leave its ground standing, to be walked into by whoever gets there next.
  holder_base_id TEXT,
  fortification INTEGER NOT NULL DEFAULT 0,
  fortifying_until TEXT,
  garrison_json TEXT NOT NULL DEFAULT '{}',
  CHECK ((holder_kind = 'faction') = (holder_base_id IS NOT NULL))
);

CREATE INDEX idx_place_control_holder ON place_control (holder_base_id);

CREATE TABLE district_intel (
  base_id TEXT NOT NULL REFERENCES bases (id),
  district_id TEXT NOT NULL,
  scouted_at TEXT NOT NULL,
  PRIMARY KEY (base_id, district_id)
);

ALTER TABLE bases ADD COLUMN army_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE bases ADD COLUMN training_queue_json TEXT NOT NULL DEFAULT '[]';

-- A battle row can now name a place as well as a district. Nullable, because a raid on a home
-- district names only the district. There is no place to name.
ALTER TABLE battles ADD COLUMN target_place_id TEXT;
