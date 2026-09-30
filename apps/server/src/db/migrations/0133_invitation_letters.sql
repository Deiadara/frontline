-- Every invitation letter a player has sent in the last week (maintainer, 2026-09-29).
--
-- An invitation lands in the invitee's mailbox as a letter with no sent copy, so the day's letter
-- limit, which counts sent copies, never saw it, and nothing limited how often one player could be
-- invited: demoting a chief or disbanding a faction drops the open invitation, and the next one
-- went through. This is the count both limits read. It is kept apart from `messages` because the
-- invitee's mailbox is trimmed to its newest hundred, and a count that lived in somebody else's
-- mailbox could be emptied by writing to them.
--
-- `faction_id` has no foreign key on purpose: a disbanded faction must not take its count with it,
-- or founding and disbanding would reset it. Rows older than a week are pruned on insert.
CREATE TABLE IF NOT EXISTS invitation_letters (
  id              TEXT PRIMARY KEY,
  sender_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  faction_id      TEXT NOT NULL,
  invitee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invitation_letters_sender
  ON invitation_letters (sender_user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_invitation_letters_invitee
  ON invitation_letters (invitee_user_id, sent_at);
