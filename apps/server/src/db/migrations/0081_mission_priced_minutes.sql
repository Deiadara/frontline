-- §C3: the clock a run's pay was quoted on.
--
-- `travel_minutes` carries the machines' cut, and the settle priced rewards and XP off it, so a
-- crew that rode was paid less than the card said. The card's own total is frozen here at launch.
-- Zero on every run already on the road, which the settler reads as "price off the row's clock",
-- exactly what it did before.
ALTER TABLE missions ADD COLUMN priced_minutes INTEGER NOT NULL DEFAULT 0;
