-- The card each member sits at, set by the faction's leader (maintainer, 2026-10-02). Null until
-- the leader seats them; the deal fills unset seats by rank and then by who joined first, so a
-- card no longer passes to somebody else because an army marched out of a home district.
ALTER TABLE faction_members ADD COLUMN seat TEXT;
