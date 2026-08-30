-- The tag becomes a drawn badge, and an officer becomes a chief (board request).
--
-- Two changes to the same feature, in one file because the order between them matters: the
-- messages backfill below reads `factions.tag`, and the last statement here drops it.
--
-- ## Why `factions` is altered in place and `faction_members` is rebuilt
--
-- `factions` is a *parent*: `faction_members` and `faction_invites` both reference it with
-- ON DELETE CASCADE. Rebuilding it the usual way (create new, copy, DROP TABLE old, rename) fires
-- that cascade on the DROP and empties both children: every membership and every open invitation in
-- the game, silently, inside a migration that looks like a rename. Verified rather than assumed.
-- So the parent gets ADD COLUMN / DROP COLUMN, which touches no other table.
--
-- `faction_members` has to be rebuilt because the thing being changed is a CHECK constraint, and a
-- CHECK cannot be altered: UPDATE ... SET rank = 'chief' against the old table is rejected by the
-- very constraint being replaced. It is a child of `factions` and `users` and nothing references
-- it, so dropping it cascades to nothing.

-- Every faction that exists gets a badge. One value for all of them: there is nothing in a
-- five-letter tag to derive a shape or a colour from, and a badge nobody chose should look like a
-- badge nobody chose. `DEFAULT_BADGE` in `factions/badge.ts` is this exact object.
ALTER TABLE factions
ADD COLUMN badge TEXT NOT NULL DEFAULT '{"shape":"shield","ground":"soot","field":"plain","fieldColor":"brass","prop":"skull","ink":"brass"}';

-- A message carried the sender's tag; it now carries the sender's faction name. Backfilled by
-- joining the tag back to the faction that wore it, which is only possible before the drop below.
-- A sender whose faction has since been disbanded keeps NULL, which is what the column already
-- means: "was in no faction".
ALTER TABLE messages
RENAME COLUMN sender_tag TO sender_faction;

UPDATE messages
SET
  sender_faction = (
    SELECT f.name
    FROM factions f
    WHERE f.tag = messages.sender_faction COLLATE NOCASE
  )
WHERE
  sender_faction IS NOT NULL;

-- An invitation delivered to the inbox. Deliberately *not* a foreign key: answering an invitation
-- deletes its row, and the message announcing it has to survive that as a spent note rather than
-- being deleted with it or blocking the delete. The join in `repos/social.ts` finding nothing is
-- exactly how a message learns its invitation is closed.
ALTER TABLE messages
ADD COLUMN invite_id TEXT;

-- ...and which faction it was to, kept separately for the same reason. Once the invitation row is
-- gone there is nothing left to join a name or a badge from, and an answered invitation still has
-- to draw as "The Ninth Circle asked you" rather than as a blank card.
ALTER TABLE messages
ADD COLUMN invite_faction_id TEXT;

DROP INDEX idx_factions_tag;

ALTER TABLE factions
DROP COLUMN tag;

-- Ranks: leader / chief / member.
CREATE TABLE faction_members_new (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  faction_id TEXT NOT NULL REFERENCES factions (id) ON DELETE CASCADE,
  rank TEXT NOT NULL CHECK (rank IN ('leader', 'chief', 'member')),
  joined_at TEXT NOT NULL
);

INSERT INTO
  faction_members_new (user_id, faction_id, rank, joined_at)
SELECT
  user_id,
  faction_id,
  CASE rank
    WHEN 'officer' THEN 'chief'
    ELSE rank
  END,
  joined_at
FROM
  faction_members;

DROP TABLE faction_members;

ALTER TABLE faction_members_new
RENAME TO faction_members;

CREATE INDEX idx_faction_members_faction ON faction_members (faction_id);
