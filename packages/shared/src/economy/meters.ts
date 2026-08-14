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

/** Infamy gained by taking any site by force (§D7). */
export const INFAMY_PER_RAID_WON = 3;
/**
 * On top of the above, for taking it off the Combine (§A3, §D7) — and again for a *seat* of its
 * power. Robbing a rival crew is a street matter; robbing the state is the kind of thing the
 * street repeats, and taking one of its two seats is the kind it repeats for a long time.
 */
export const INFAMY_PER_GOVERNMENT_SITE = 4;
export const INFAMY_PER_GOVERNMENT_SEAT = 5;

/** Whose ground a won raid took, as the infamy meter reads it. */
export interface RaidInfamyInput {
  /** It was Combine ground. */
  fromTheState: boolean;
  /** And one of the two seats of its power, not an outpost. */
  seatOfPower: boolean;
}

/**
 * Infamy a won raid earns. Takes plain flags rather than a district so the meter never has to know
 * what a district is — `raidTargetOf` is the one place the map is read.
 */
export function infamyForRaidWon({ fromTheState, seatOfPower }: RaidInfamyInput): number {
  return (
    INFAMY_PER_RAID_WON +
    (fromTheState ? INFAMY_PER_GOVERNMENT_SITE : 0) +
    (seatOfPower ? INFAMY_PER_GOVERNMENT_SEAT : 0)
  );
}

/**
 * Morale lost per pay-week the crew went short (§D4, feeding the §H5 officer alignment meter).
 * Counted in *missed paydays*, never in caps: a large shortfall on a large payroll is still one
 * payday missed, and that is what a crew reacts to. Wages bite harder than rations — people will
 * tighten their belts for a week, but they notice an empty envelope immediately.
 */
export const MORALE_PER_UNPAID_WAGE_WEEK = -3;
export const MORALE_PER_STARVED_WEEK = -2;

/*
 * Every §D driver the game can currently produce is live. For the record, and so the next reader
 * does not go looking for a marker that was removed rather than forgotten:
 *  - morale: mission outcomes (`MISSION_MORALE_DELTA`), unpaid payroll and starved upkeep
 *    (`moralePenaltyFor`), and the §F2 research settle (`moraleFromLeadership`).
 *  - infamy: any won raid, more of it off the Combine (`infamyForRaidWon`), and anti-government
 *    missions coming home (`MISSION_INFAMY_DELTA`).
 * What is still missing is a *mechanic*, not a driver: infamy has no decay, so it only ever rises.
 * That is a tuning question for the board (§D7 does not say), not something to invent here.
 */

/** Clamps any arithmetic result back into the meter's 0..100 range. */
export function clampMeter(value: number): Meter {
  return Math.min(METER_MAX, Math.max(METER_MIN, value));
}

/** Immutable meter nudge — the only way a meter should ever be moved. */
export function adjustMeter(value: Meter, delta: number): Meter {
  return clampMeter(value + delta);
}
