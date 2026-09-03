-- §F1: a mission can carry a blueprint page, and both halves of that have to survive a restart.
--
-- `page_prize` is the *category* the card promised, frozen at launch: boards turn over at midnight
-- and a crew that is out overnight keeps the terms it left under, so this cannot be re-derived from
-- today's board. `page_won` is the page itself, written by the settler on arrival and read by the
-- mission report to name it.
--
-- Both nullable and both defaulting to NULL, which is the right answer for every mission already in
-- flight or already finished: none of them was ever offered a page, and a backfill would invent a
-- reward nobody was promised.

ALTER TABLE missions ADD COLUMN page_prize TEXT;
ALTER TABLE missions ADD COLUMN page_won TEXT;
