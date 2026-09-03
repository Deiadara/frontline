-- One base per account, and one overseer per account, said by the database rather than by a guard.
--
-- The rule was enforced in exactly one place: `routes/overseer.ts` reads `request.currentUser
-- .overseerId` and refuses when it is not null. That value is written by the `authenticate`
-- preHandler, which awaits `jwtVerify` and then reads the user row, so the check is against a
-- snapshot taken across an await and outside the transaction that does the writing. Every other
-- once-per-account rule in this server is re-read inside its transaction; `/factions` does exactly
-- that two files away and says why.
--
-- What a second base would cost, if the window ever opened: `findByOwnerId` is a single-row read, so
-- one of the two is playable and the other is a permanent ghost that nothing can ever settle. It
-- would still be in `listSummaries()`, so it would sit on the leaderboard, count in the city-level
-- average that prices the Bar's calibre and the black market, hold a crew name against the
-- uniqueness scan, and occupy a district in `openTheNearestGround`.
--
-- Both columns already have an index (`0001_init.sql`); they are simply not unique. Replacing them
-- rather than adding a second index, because a non-unique index beside a unique one on the same
-- column is dead weight the planner will never choose.
--
-- No backfill and no data change, and a duplicate therefore stops the boot. That is the right
-- behaviour, but the reason is not that the invariant has never been broken: it had been. A dev
-- database carried three bases for the AI rival, in three districts, dated to the three occasions
-- `BOT_DISTRICT_ID` moved, because `seedBot` asked "is the rival standing here" rather than "does
-- this account have a base". The seed is fixed; this index is what stops it recurring.
--
-- So an operator meeting this error has real duplicates and a decision to make about which row
-- survives, which is not a decision a migration should take on their behalf: the loser is a crew
-- somebody may have played. Resolve them by hand, then run this again.
DROP INDEX IF EXISTS idx_bases_owner;
DROP INDEX IF EXISTS idx_overseers_user;
CREATE UNIQUE INDEX idx_bases_owner ON bases (owner_id);
CREATE UNIQUE INDEX idx_overseers_user ON overseers (user_id);
