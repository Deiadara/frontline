-- A level below one is a row the game cannot read (2026-09-22).
--
-- The Console's Clean slate wrote `bases.level = 0` until 2026-09-22 (`routes/admin.ts` now
-- writes 1), and `BaseSchema` refuses anything under one on the way out of the database. The
-- world clock reads every base each second, so one such row made every tick fail with a
-- ZodError and the server useless for everybody. The same floor is on a location's level and a
-- captured gate's, so all three are clamped: a level is a count of work done, and none done is
-- level one, the state a fresh row starts in.
UPDATE bases SET level = 1 WHERE level < 1;
UPDATE location_control SET level = 1 WHERE level < 1;
UPDATE captured_gates SET level = 1 WHERE level < 1;
