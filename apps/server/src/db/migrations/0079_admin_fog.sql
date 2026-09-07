-- The Console's fog of war: the districts an admin has chosen NOT to see.
--
-- In admin mode every district is scouted by default, because a reviewer standing in the testing
-- build wants to open any screen, not send a scout and wait. What has to be stored is only the
-- exceptions: a district the admin has un-ticked to look at the unscouted state of it. They live
-- in their own table rather than as rows removed from `district_intel`, so real scouting intel is
-- never touched: turn admin mode off and the world is exactly what the crew has actually seen.
CREATE TABLE admin_fog (
  base_id     TEXT NOT NULL REFERENCES bases (id) ON DELETE CASCADE,
  district_id TEXT NOT NULL,
  PRIMARY KEY (base_id, district_id)
);
