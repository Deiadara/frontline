-- Who holds each card at a faction's table, and since when (Onboarding, maintainer 2026-10-15).
--
-- A seat whose holder changes, by the leader reseating somebody or by a new member taking it, is
-- locked for twelve hours and its card pays nothing until they are up. The table is dealt in code
-- (`dealCards`), off the members' rows, so this records what the deal was the last time it was
-- read: a holder that differs from the row starts the seat's Onboarding.
--
-- Empty on every existing table, which `cardsAtTable` reads as settled: the holders seated when
-- this lands are recorded on the first read from the day they joined, not from today.
CREATE TABLE faction_card_holders (
  faction_id TEXT NOT NULL REFERENCES factions (id) ON DELETE CASCADE,
  card TEXT NOT NULL,
  user_id TEXT NOT NULL,
  since TEXT NOT NULL,
  PRIMARY KEY (faction_id, card)
);
