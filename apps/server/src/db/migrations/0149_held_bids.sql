-- Bids on the Runner's lots and the fence's shelf are held when placed (maintainer, 2026-10-06).
--
-- A bid comes off the bidder's stock the moment it is placed: caps at the barrow, infamy at the
-- fence. Raising your own bid hands the old hold back and takes the new one, and at the close
-- everybody who did not win gets their hold back. The winner has already paid.
--
-- `held` is what was actually taken, after the crew's own discount and after admin mode. The
-- discount can move between the bid and the close, so the figure is stored rather than worked out
-- again: a refund read off today's discount would hand back more or less than was taken. Zero on
-- every row before this, which pre-launch is the honest reading: those bids took nothing.
ALTER TABLE vendor_bids ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE black_market_bids ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
