-- What one crew owes one recruit after a conversation that ended badly (`bar/negotiation.ts`).
--
-- Not keyed by day, unlike `bar_negotiations`. That is the whole point of it: a walkout has to
-- outlive the roster it happened on, because the six hours it buys straddle the midnight UTC
-- boundary more often than not, and the ten percent it puts on the price is meant to be permanent.
CREATE TABLE bar_standoffs (
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The roster id as it was on the day it happened, exactly as `bar_hires.recruit_id` carries it.
  recruit_id TEXT NOT NULL,
  -- They will not sit down again before this, ISO 8601.
  until TEXT NOT NULL,
  -- Conversations that ended with them leaving. Each one marks their asking price up.
  walkouts INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, recruit_id)
) STRICT;
