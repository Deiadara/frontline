import { z } from 'zod';

/**
 * Morale (GDD §D4) and infamy (§D7) are both 0..100 meters. Infamy is raised by *infamous*
 * actions — things that are not morally good but get your name passed around the street.
 */
export const METER_MIN = 0;
export const METER_MAX = 100;

export const MeterSchema = z.number().min(METER_MIN).max(METER_MAX);
export type Meter = z.infer<typeof MeterSchema>;

/** A fresh crew is willing but unknown: middling morale, no reputation on the street yet. */
export const STARTING_MORALE = 60;
export const STARTING_INFAMY = 0;

/** Infamy gained by taking a site by force. Placeholder tuning — see `TODO-LATER` below. */
export const INFAMY_PER_RAID_WON = 3;

/*
 * TODO-LATER — meter drivers that do not exist yet, and who lands them:
 *  - morale down on an unpaid payroll / starved upkeep: W5/MOU-164 owns the officer
 *    alignment meter (§H5) that this feeds, so the penalty curve lands with it.
 *  - morale up/down from mission outcomes: W3/MOU-162 (missions, §E).
 *  - infamy from anti-government action specifically: W10/MOU-169 (The Government).
 * Until those land, `INFAMY_PER_RAID_WON` on a won raid is the only live driver.
 */

/** Clamps any arithmetic result back into the meter's 0..100 range. */
export function clampMeter(value: number): Meter {
  return Math.min(METER_MAX, Math.max(METER_MIN, value));
}

/** Immutable meter nudge — the only way a meter should ever be moved. */
export function adjustMeter(value: Meter, delta: number): Meter {
  return clampMeter(value + delta);
}
