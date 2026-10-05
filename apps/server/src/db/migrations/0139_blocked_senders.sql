-- Players whose letters a reader no longer takes (maintainer, 2026-10-02). A blocked sender's
-- letters and invitations are never put in the reader's mailbox.
CREATE TABLE blocked_senders (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, blocked_user_id)
);
