-- What a location's running upgrade was charged (bug pass, 2026-10-04).
--
-- The Engineer's cut is read live, and calling an upgrade off refunded ninety percent of the
-- price as it stood at the cancel. Seating an Engineer to start one and benching them to cancel
-- handed back about 1.8 times what was spent. The charge is kept on the row now and the cancel
-- refunds that. Null on every row before this, which refunds the list price as it always did.
ALTER TABLE location_control ADD COLUMN upgrade_paid_json TEXT;
