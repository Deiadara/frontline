-- Every letter sent in the last day, kept where deleting letters cannot reach it (maintainer,
-- 2026-10-06).
--
-- The day's hundred counted the sender's sent copies, and the ten to one reader counted the
-- sender's letters still in that reader's mailbox. The mailbox trim hard-deletes every letter its
-- reader has deleted, so a spammer sent ten, the victim deleted them, the next arrival trimmed the
-- rows away, and the count was back to zero: deleting spam reopened the gate. The day's hundred was
-- only right because `MAILBOX_LIMIT` and `MESSAGES_PER_DAY` happened to be equal.
--
-- Two kinds of row, one per question the limits ask:
--
--   * `recipient_user_id` null: one row per letter the sender wrote, which the day's hundred counts.
--     Invitations are not written here; they have their own ledger (0133), which the day adds in.
--   * `recipient_user_id` set: one row per mailbox a letter reached, invitations and faction
--     letters included, which the ten to one reader counts. A reader who blocked the sender is never
--     reached and never counted.
--
-- No foreign key on the letter: the row outlives the message it logged. Rows older than a day are
-- pruned on insert, since no limit looks back further.
CREATE TABLE IF NOT EXISTS letter_sends (
  letter_id         TEXT NOT NULL,
  sender_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  sent_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_letter_sends_sender
  ON letter_sends (sender_user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_letter_sends_reader
  ON letter_sends (sender_user_id, recipient_user_id, sent_at);
