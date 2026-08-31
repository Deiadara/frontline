-- What a notification is *about*, so opening one can show it (board request).
--
-- A notification carried a `link` and nothing else, so every receipt for a mission went to the same
-- place: the missions screen, with no way to say which of the four crews that came home this
-- morning the line referred to. The subject is the id of the thing itself, and the kind already on
-- the row says what sort of thing that is.
--
-- Null for everything written before this and for kinds that genuinely have no subject (a payroll
-- warning is about the book, not about a row in it). The detail sheet falls back to the headline
-- and the link, which is exactly what these notifications could do before.
ALTER TABLE notifications
ADD COLUMN subject_id TEXT;
