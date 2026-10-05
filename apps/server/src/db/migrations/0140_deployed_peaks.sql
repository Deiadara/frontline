-- The most each crew has had at each fight, counted toward the "units deployed" feats once
-- (maintainer, 2026-10-02). They counted every landing, and a withdrawal from a raid on your own
-- district is instant, so sending the same five hundred again every two minutes cleared the top
-- rung in about a day.
CREATE TABLE deployed_peaks (
  battle_id TEXT NOT NULL,
  base_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  unit_slots INTEGER NOT NULL,
  PRIMARY KEY (battle_id, base_id)
);
