-- Every mailbox keeps its newest hundred letters, and every sent folder its newest hundred sends
-- (maintainer, 2026-09-29; `MAILBOX_LIMIT` in `social/messages.ts`).
--
-- The inbox showed the newest 200 and nothing pruned the rest, so a letter past the 200th was on no
-- screen while its unread mark still counted on the badge, and a deleted letter stayed a row for
-- ever. From here the send trims as it writes (`db/repos/social.ts`); this brings the letters
-- already stored under the same cap, deleted ones first.
--
-- A recipient's copy is what the sender's folder counts to print "1/3 read", so a copy that goes
-- is folded into its sent copy first: `pruned_recipients` and `pruned_read` carry what the rows
-- that are gone used to say.
ALTER TABLE messages ADD COLUMN pruned_recipients INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN pruned_read INTEGER NOT NULL DEFAULT 0;

CREATE TEMP TABLE doomed_letters AS
SELECT id, thread_id, read_at
FROM (
  SELECT id, thread_id, read_at, deleted,
         ROW_NUMBER() OVER (
           PARTITION BY recipient_user_id ORDER BY deleted, sent_at DESC, id DESC
         ) AS place
  FROM messages
  WHERE is_sent_copy = 0
)
WHERE deleted = 1 OR place > 100;

UPDATE messages
SET pruned_recipients = pruned_recipients
      + (SELECT COUNT(*) FROM doomed_letters d WHERE d.thread_id = messages.thread_id),
    pruned_read = pruned_read
      + (SELECT COUNT(*) FROM doomed_letters d
          WHERE d.thread_id = messages.thread_id AND d.read_at IS NOT NULL)
WHERE is_sent_copy = 1 AND thread_id IN (SELECT thread_id FROM doomed_letters);

DELETE FROM messages WHERE id IN (SELECT id FROM doomed_letters);
DROP TABLE doomed_letters;

DELETE FROM messages
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY recipient_user_id ORDER BY sent_at DESC, id DESC
           ) AS place
    FROM messages
    WHERE is_sent_copy = 1
  )
  WHERE place > 100
);
