-- Team infamy is the faction's, for good (board correction to `0050`).
--
-- `0050` put the accumulator on the *membership* row, which made a faction's total the sum over its
-- current members and therefore made it fall when somebody left. The board's rule is append-only:
-- the number is the total infamy won in battle by people who were members **at the time they won
-- it**, and nothing subtracts from it afterwards. Somebody leaving does not un-win their fights.
--
-- So the accumulator moves to the faction. The existing per-membership figures are folded in rather
-- than thrown away: they were earned under these badges and the new total is their sum.
ALTER TABLE factions
ADD COLUMN infamy_earned REAL NOT NULL DEFAULT 0;

UPDATE factions
SET
  infamy_earned = COALESCE(
    (
      SELECT SUM(m.infamy_earned)
      FROM faction_members m
      WHERE m.faction_id = factions.id
    ),
    0
  );

-- The membership column stays, and stops being the faction's total. It is now the *contribution*
-- of one member: what this person has won since they sat down, which is what the roster shows
-- beside their name and what makes "who is pulling their weight" answerable. Dropping it would
-- throw that away to save a column.
