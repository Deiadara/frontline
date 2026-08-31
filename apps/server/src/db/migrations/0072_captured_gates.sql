-- §B7: the gate on a district somebody has taken whole (board request).
--
-- Keyed by district rather than by crew, and that is the design rather than a shortcut. A gate is a
-- wall standing in a place: a crew that loses the ground loses it, and a crew that takes the ground
-- inherits whatever the last holder built. Taking a district that has been worked up for a month is
-- therefore worth more than taking a fresh one, which is the same rule locations already follow.
--
-- No foreign key on `district_id`: districts are hard-authored in `city/districts.ts` and have never
-- had a table of their own.
--
-- `upgrading_to` and `upgrading_until` are one clock, stored the way every other clock in this
-- server is: a timestamp settled lazily on read and by the world tick, with no scheduler behind it.
-- Both null means the gate is standing and nobody is working on it.
CREATE TABLE captured_gates (
  district_id     TEXT    PRIMARY KEY,
  level           INTEGER NOT NULL DEFAULT 1,
  upgrading_to    INTEGER,
  upgrading_until TEXT
);

-- The world clock asks "what is due" every second, so that lookup gets the index rather than a scan.
CREATE INDEX idx_captured_gates_due ON captured_gates (upgrading_until);
