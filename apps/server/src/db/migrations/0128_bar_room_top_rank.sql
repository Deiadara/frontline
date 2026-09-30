-- The highest notoriety rank in a city's room, frozen with the rest of it (audit, 2026-09-28).
--
-- `highest_notoriety` is the rank of the crew with the most standing, and standing leans on level:
-- a level-80 crew at rank 3 is the strongest in a room where two level-20 crews hold rank 13. The
-- standout door is capped one rung past the highest rank in town, and read off the wrong crew that
-- cap fell below the door's own floor. Nullable: a room frozen before this reads its strongest
-- crew's rank, which is what every room was stocked against until now.
ALTER TABLE bar_rooms ADD COLUMN top_notoriety REAL;
