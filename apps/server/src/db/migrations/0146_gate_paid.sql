-- What a captured gate's raise was charged (maintainer, 2026-10-05).
--
-- A gate raise now takes the crew's build discounts and its Engineer, read live. Calling one off
-- refunded ninety percent of the price read again at the cancel, so a cut seated for the order and
-- gone by the cancel would hand back more than was paid. The charge is kept on the row and the
-- cancel refunds that, as `location_control.upgrade_paid_json` does for location upgrades. Null on
-- every row before this, which refunds the list price as it always did.
ALTER TABLE captured_gates ADD COLUMN upgrade_paid_json TEXT;
