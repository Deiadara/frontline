-- What the job paid, as opposed to what the crew could carry home (board request).
--
-- `rewards_json` is what was banked, which is already capped by `missionCarry`: send four porters
-- to a job that pays ten slots and six slots are left on the ground. That is a real and deliberate
-- mechanic, and until now it was completely invisible. The report could say "you brought back 120
-- scrap" and could not say "out of 300", so a player under-crewing every run had no way to find
-- out they were doing it.
--
-- So the pre-cap figure is stored beside the post-cap one. Both, because neither can be derived
-- from the other after the fact: the payout depends on a seed, a template that may since have been
-- retired, and a premium frozen at launch.
--
-- Empty for every mission resolved before this, which reads as "not recorded" rather than as "the
-- crew carried everything": the report only draws the comparison when there is something to
-- compare, so an old row shows what it always showed.
ALTER TABLE missions
ADD COLUMN spoils_json TEXT NOT NULL DEFAULT '{}';
