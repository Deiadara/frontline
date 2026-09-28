-- Who a city's Bar was poured for on a given day (maintainer, 2026-09-28).
--
-- The roster is a pure function of the day and of the city's crews, and the crews keep levelling,
-- so a crew joining or levelling at noon used to re-roll every seat: the room a player bid on in the
-- morning was a different room by the evening, and the close could settle the table against a
-- person nobody had seen. The first read or close of a city's room on a day writes the profile its
-- seats are built from, and every later read and the close rebuild the room from this row.
--
-- The weakest crew with a stake, the strongest, and the stake-weighted middle, each as a level and
-- a notoriety rank. REAL throughout: the averages are fractional, and so are both ends of an empty
-- city, which falls back to the world's average level (`roomProfileOf`).
CREATE TABLE bar_rooms (
  day TEXT NOT NULL,
  city_id TEXT NOT NULL,
  lowest_level REAL NOT NULL,
  lowest_notoriety REAL NOT NULL,
  highest_level REAL NOT NULL,
  highest_notoriety REAL NOT NULL,
  average_level REAL NOT NULL,
  average_notoriety REAL NOT NULL,
  PRIMARY KEY (day, city_id)
) STRICT;
