-- Notifications: the game telling a player what happened while they were not looking.
--
-- Every row carries a `link`, because a receipt you cannot follow back to the thing it is about is
-- the failure mode of every half-built notification system (`social/notifications.ts`).
--
-- Filtering happens at **write** time against `notification_settings`: a muted kind is never
-- recorded. That makes the unread badge a count of things the player asked for, and makes turning a
-- category back on a statement about the future rather than an unpacking of three weeks of history.

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX idx_notifications_user ON notifications (user_id, created_at);
CREATE INDEX idx_notifications_unread ON notifications (user_id, read_at);

CREATE TABLE notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  -- The kinds switched *off*, as a JSON array. Sparse on purpose: a kind added to the catalogue
  -- tomorrow is on by default for everybody, including players who have already been to the
  -- settings page. Recording what is on instead would silently opt them all out of it.
  muted_json TEXT NOT NULL DEFAULT '[]'
);
