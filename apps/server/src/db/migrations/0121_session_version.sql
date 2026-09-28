-- Sessions that can end (hardening pass, 2026-09-27).
--
-- Every token carries the account's session version at the moment it was signed, and a request is
-- accepted only while the two still match. Bumping the column ends every session the account has
-- open at once: a password change does it, and so does "log out everywhere". Zero for every
-- existing account; tokens signed before this migration carry no version and no expiry and are
-- refused, which costs each player one sign-in.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
