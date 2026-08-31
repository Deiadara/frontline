-- What a faction has earned, as opposed to what its members happen to be holding (board request).
--
-- Team infamy is **not** the sum of the members' current infamy, and the difference matters twice:
--
--   1. Infamy is spent (notoriety, §D7). If the team total were a sum over members, buying a rank
--      would drop the faction down the leaderboard, which is the opposite of what a record of what
--      you have done should do.
--   2. Somebody arriving with 30,000 infamy would hand their new faction 30,000 they had no part in
--      earning, and a faction could climb by recruiting rather than by fighting.
--
-- So it is an accumulator on the *membership*: infamy earned in a fight is added to the row for the
-- crew that earned it, and only while that row exists. Joining starts at zero, and the total a
-- faction shows is the sum over the people currently at its table.
ALTER TABLE faction_members
ADD COLUMN infamy_earned REAL NOT NULL DEFAULT 0;
