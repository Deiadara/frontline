-- The weekly mark the Combine and the looters grow back on (maintainer, 2026-09-24).
--
-- "The army of combine erodes during the week but sunday night at midnight (before monday starts)
-- they are all regenerated on whichever locations a player does not hold." The erosion lives in
-- `battle/resolve.ts`; this table is what makes the other half happen exactly once.
--
-- One row per week, keyed on the mark itself as an instant, because the world tick runs about once
-- a second and the question it has to ask is "has this week been grown back yet" rather than "is it
-- midnight now". A server that was down over Sunday comes up inside the same week, finds no row for
-- it, and pays what it owes on its first tick; every tick after that finds the row. The mark is
-- computed in Athens time (`lastWeekBoundary`), which SQL has no way to do, so it arrives already
-- resolved to a UTC instant.
--
-- `at` is when the sweep actually ran, which is not the mark whenever the server was down over one.
-- Kept because the only way to tell those two apart afterwards is to have written both down.
--
-- One row a week is 52 a year, so nothing prunes it: a table that says which weeks the world has
-- been rebuilt on is worth more than the kilobyte.
CREATE TABLE IF NOT EXISTS garrison_regrowth (
  mark TEXT PRIMARY KEY,
  at   TEXT NOT NULL
);
