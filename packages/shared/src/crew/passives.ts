import {
  markIndex,
  markFromPoints,
  OFFICER_MARK_BAND,
  OFFICER_MARK_CEILING,
  OFFICER_MARK_FLOOR,
} from './marks.js';
import { ROLE_IMPORTANCE } from './importance.js';
import type { AttributeName } from '../attributes.js';
import type { OfficerRole } from '../roles.js';

/**
 * What each chair gives the crew, and only that chair (maintainer, 2026-10-04).
 *
 * An officer's skills reach the crew through one passive per chair, sized by how well they fill it:
 * the seat's points (`seatPoints`), the number behind their grade. There is no "best in the room"
 * any more. A brilliant analyst sitting as Trader does not speed up research; the Researcher does,
 * and nobody else. Perks still sum across the room: they are what a person brought, not what a
 * chair does.
 *
 * Every passive is a straight line on the same scale as the grades: nothing at the floor of the
 * F- band (10 points) and the whole of it at a perfect sheet (100). The Master of Whispers and the
 * Right Hand keep the chair work they already had (the spy grade, and the lift and the standing
 * orders), so they have no line here.
 */
export type ChairPassive =
  | 'research_speed'
  | 'payroll'
  | 'unit_slots'
  | 'battle_infamy'
  | 'raid_boss_body'
  | 'scrapyard_cost'
  | 'travel_time'
  | 'market_rates'
  | 'muster_cost'
  | 'building_cost'
  | 'mission_xp';

/** Which chair gives which passive. */
export const CHAIR_PASSIVE: Readonly<Partial<Record<OfficerRole, ChairPassive>>> = {
  researcher: 'research_speed',
  fixer: 'payroll',
  steward: 'unit_slots',
  field_commander: 'battle_infamy',
  raid_boss: 'raid_boss_body',
  salvager: 'scrapyard_cost',
  cartographer: 'travel_time',
  trader: 'market_rates',
  veteran: 'muster_cost',
  engineer: 'building_cost',
  professor: 'mission_xp',
};

/**
 * Each passive's whole value, at a perfect sheet, in percent.
 *
 * The Raid Boss's is how much his own damage and vitality grow: 400% more is five times his
 * starting figures. The Trader's is not here, because it is a rate rather than a share
 * ({@link traderRates}).
 */
export const CHAIR_PASSIVE_CAP: Readonly<Record<Exclude<ChairPassive, 'market_rates'>, number>> = {
  research_speed: 50,
  payroll: 50,
  unit_slots: 50,
  battle_infamy: 100,
  raid_boss_body: 400,
  scrapyard_cost: 50,
  travel_time: 50,
  muster_cost: 50,
  building_cost: 50,
  mission_xp: 50,
};

/** How far along the line a seat's points are: 0 at the F- floor, 1 at a perfect sheet. */
export function passiveShare(points: number): number {
  const above = Math.max(0, Math.min(OFFICER_MARK_CEILING, points) - OFFICER_MARK_FLOOR);
  return above / (OFFICER_MARK_CEILING - OFFICER_MARK_FLOOR);
}

/**
 * One chair's passive, in percent, for the seat's points. Not rounded: the figure a duration or a
 * price is computed from is rounded once, at the end.
 */
export function chairPassivePercent(
  passive: Exclude<ChairPassive, 'market_rates'>,
  points: number,
): number {
  return passiveShare(points) * CHAIR_PASSIVE_CAP[passive];
}

/** The chair's passive for a seat that may be empty: nothing when nobody is working it. */
export function seatedPassivePercent(
  passive: Exclude<ChairPassive, 'market_rates'>,
  points: number | null,
): number {
  return points === null ? 0 : chairPassivePercent(passive, points);
}

/** What the Raid Boss multiplies his own damage and vitality by: 1 at the floor, 5 at the top. */
export function raidBossBodyTimes(points: number): number {
  return 1 + chairPassivePercent('raid_boss_body', points) / 100;
}

/**
 * The points at which a Trader breaks even: the floor of C+ (maintainer, 2026-10-04: "around C+
 * you start having even trades").
 */
export const TRADER_EVEN_POINTS = OFFICER_MARK_FLOOR + markIndex('C+') * OFFICER_MARK_BAND;

/** What a perfect Trader gains on a trade: 25% over value, both ways. */
export const TRADER_TOP_GAIN = 0.25;

/**
 * What a Trader does to the two market rates.
 *
 * `worth` is what the broker hands back per unit of value it takes, and `markup` what the supply
 * charges per unit of value it sells. With nobody in the chair, or an F- in it, both stay at the
 * market's own (`plainWorth`, `plainMarkup`). From the floor of the grades a straight line to even
 * at C+, and on to 25% in the crew's favour at a perfect sheet: the broker pays 1.25 and the supply
 * sells at 0.8. Past C+ a crew can buy from the supply and sell to the broker at a profit, which is
 * the point; the supply's daily allowance is what keeps the loop a trade rather than a mint.
 */
export function traderRates(
  points: number | null,
  plainWorth: number,
  plainMarkup: number,
): { worth: number; markup: number } {
  if (points === null) return { worth: plainWorth, markup: plainMarkup };
  // From the floor of the grades, like every other chair's passive: an F- Trader changes nothing.
  const clamped = Math.max(OFFICER_MARK_FLOOR, Math.min(OFFICER_MARK_CEILING, points));
  if (clamped <= TRADER_EVEN_POINTS) {
    const along = (clamped - OFFICER_MARK_FLOOR) / (TRADER_EVEN_POINTS - OFFICER_MARK_FLOOR);
    return {
      worth: Math.max(plainWorth, plainWorth + (1 - plainWorth) * along),
      markup: Math.min(plainMarkup, plainMarkup + (1 - plainMarkup) * along),
    };
  }
  const along = (clamped - TRADER_EVEN_POINTS) / (OFFICER_MARK_CEILING - TRADER_EVEN_POINTS);
  const gain = 1 + TRADER_TOP_GAIN * along;
  return { worth: Math.max(plainWorth, gain), markup: Math.min(plainMarkup, 1 / gain) };
}

/**
 * The Overseer's one passive: points on every seated officer's irreplaceable and essential skills
 * (maintainer, 2026-10-04).
 *
 * One point per grade step, F- giving one and S+ twenty one, dealt in turn: the irreplaceable skill,
 * then one essential, then the other, then round again. So F- is one on the irreplaceable, F adds
 * one on an essential, F+ one on the other, E- a second on the irreplaceable, E a second on the
 * first essential and E+ a second on the other. Which essential comes first is the officer's own,
 * fixed off their id so it never flips between reads.
 */
export function overseerLift(
  overseerPoints: number,
  role: OfficerRole,
  officerId: string,
): Partial<Record<AttributeName, number>> {
  const steps = markIndex(markFromPoints(overseerPoints)) + 1;
  const tags = Object.entries(ROLE_IMPORTANCE[role]) as [AttributeName, string][];
  const irreplaceable = tags.find(([, tag]) => tag === 'irreplaceable')?.[0];
  const essentials = tags.filter(([, tag]) => tag === 'essential').map(([name]) => name);
  if (irreplaceable === undefined || essentials.length !== 2) return {};
  const order =
    hashOf(officerId) % 2 === 0
      ? [irreplaceable, essentials[0]!, essentials[1]!]
      : [irreplaceable, essentials[1]!, essentials[0]!];
  const lift: Partial<Record<AttributeName, number>> = {};
  for (let step = 0; step < steps; step += 1) {
    const name = order[step % order.length]!;
    lift[name] = (lift[name] ?? 0) + 1;
  }
  return lift;
}

/** FNV-1a over the id, so the essential an officer is lifted on first is theirs and stays theirs. */
function hashOf(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * How long a chair takes to start giving after somebody sits in it (maintainer, 2026-10-05).
 *
 * The seat's passive, the Right Hand's lift and the Master of Whispers' spy grade are all off
 * until then. What the officer brought (their perks, their fighting, the doors their grade opens)
 * is theirs and is on from the first minute.
 */
export const CHAIR_SETTLE_HOURS = 6;

const HOUR_MS = 3_600_000;

/** When the chair starts giving, or null when it already does. */
export function chairSettlesAt(
  officer: { seatedAt?: string | null | undefined },
  now: Date,
): Date | null {
  if (officer.seatedAt == null) return null;
  const at = Date.parse(officer.seatedAt) + CHAIR_SETTLE_HOURS * HOUR_MS;
  return at > now.getTime() ? new Date(at) : null;
}

/** Whether the chair is giving yet. See {@link chairSettlesAt}. */
export function chairIsSettled(
  officer: { seatedAt?: string | null | undefined },
  now: Date,
): boolean {
  return chairSettlesAt(officer, now) === null;
}
