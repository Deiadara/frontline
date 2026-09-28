-- What a crew carried home and the stores had no room for (maintainer ruling, 2026-09-28).
--
-- The stores are a hard ceiling on every resource now, mission pay included, so a run can bring
-- home more than lands. `rewards_json` keeps what came through the gate and this keeps the part of
-- it that was thrown away, so the report can say so. Every row settled before the rule landed all
-- of its pay, which is what the empty default says.
ALTER TABLE missions ADD COLUMN wasted_json TEXT NOT NULL DEFAULT '{}';
