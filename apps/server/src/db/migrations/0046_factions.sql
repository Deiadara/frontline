-- Factions: up to five players who fight together (GDD, board request).
--
-- The word had three other meanings in this codebase and all three were moved out of the way first
-- (`0044`, plus the `DistrictName*` and `Allegiance` renames), because this is the one players mean.
--
-- Membership is its own table rather than a column on `users`, for the reason membership tables
-- usually are: the rank lives on the relationship, not on either end of it. It also means the
-- five-person cap is a COUNT rather than a nullable column somebody has to remember to clear.

CREATE TABLE factions (
  id TEXT PRIMARY KEY,
  -- Compared case- and whitespace-insensitively in `sameFactionName`; the UNIQUE index below is the
  -- database's own cruder guarantee, and the route does the real check before it gets here.
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  blurb TEXT NOT NULL DEFAULT '',
  founded_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_factions_name ON factions (name COLLATE NOCASE);
CREATE UNIQUE INDEX idx_factions_tag ON factions (tag COLLATE NOCASE);

CREATE TABLE faction_members (
  -- One faction per player, enforced by the primary key rather than by a check at each door.
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  faction_id TEXT NOT NULL REFERENCES factions (id) ON DELETE CASCADE,
  rank TEXT NOT NULL CHECK (rank IN ('leader', 'officer', 'member')),
  joined_at TEXT NOT NULL
);

CREATE INDEX idx_faction_members_faction ON faction_members (faction_id);

-- Invitations are the only way in. An open invite is a row; accepting, declining or the faction
-- filling up all delete it.
CREATE TABLE faction_invites (
  id TEXT PRIMARY KEY,
  faction_id TEXT NOT NULL REFERENCES factions (id) ON DELETE CASCADE,
  invited_user_id TEXT NOT NULL REFERENCES users (id),
  invited_by_user_id TEXT NOT NULL REFERENCES users (id),
  sent_at TEXT NOT NULL,
  -- One open invitation per faction per player: a second is not a second chance, it is a duplicate
  -- row in somebody's list.
  UNIQUE (faction_id, invited_user_id)
);

CREATE INDEX idx_faction_invites_user ON faction_invites (invited_user_id);
