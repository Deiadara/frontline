-- Messages: one player writing to another, or to their whole faction.
--
-- Fanned out at send: one row per recipient, sharing a `thread_id`. See `social/messages.ts` for
-- why (read state per person, no retroactive inbox for somebody who joins later, and a leaver keeps
-- what they were actually sent).
--
-- The sender's own copy is a row with `recipient_user_id = sender_user_id` and `is_sent_copy = 1`,
-- so the sent folder is the same table and the same read path rather than a second store that can
-- disagree with it about what was written.

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL REFERENCES users (id),
  sender_name TEXT NOT NULL,
  sender_tag TEXT,
  recipient_user_id TEXT NOT NULL REFERENCES users (id),
  audience TEXT NOT NULL CHECK (audience IN ('player', 'faction')),
  addressed_to TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  read_at TEXT,
  -- The sender's copy. Never counted as unread and never shown in the inbox.
  is_sent_copy INTEGER NOT NULL DEFAULT 0,
  -- Thrown away by this recipient. A flag rather than a delete, so the other copies of the same
  -- send are untouched by one person tidying up.
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_messages_inbox ON messages (recipient_user_id, is_sent_copy, deleted, sent_at);
CREATE INDEX idx_messages_thread ON messages (thread_id);
