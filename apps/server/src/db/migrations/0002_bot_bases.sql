-- AI rival bases (MOU-113).
-- `is_bot` flags a base as AI-controlled: bot bases are raidable, human bases are not.
-- `commanders_json` holds the base's Commander[] (validated by @frontline/shared).
-- Both default so the rows written before this migration stay valid.

ALTER TABLE bases ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bases ADD COLUMN commanders_json TEXT NOT NULL DEFAULT '[]';
