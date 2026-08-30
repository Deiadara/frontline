import { CITY_DISTRICTS, type District } from './city/districts.js';
import {
  MISSION_TEMPLATES,
  rewardScale,
  type MissionKind,
  type MissionTemplate,
} from './missions.js';
import { PLAYER_XP_AWARDS } from './progression/state.js';
import { MILESTONE_THIRD_CREW, isPlayerUnlockActive } from './progression/unlocks.js';
import { RESOURCE_KEYS, type PartialResources, type ResourceKey } from './resources.js';
import { seedFrom } from './rng.js';
import { findUnit, isCombatUnit, type Army } from './units/index.js';

/**
 * Where work comes from (GDD §E, §A4).
 *
 * The board used to be one flat list of eight jobs that every crew saw for ever. That is a menu,
 * not a map: nothing about it said where you were working, nothing changed as the city changed,
 * and taking a job cost nothing but the clock.
 *
 * Work is now **per area**. Every district you have scouted and do not yet own outright offers
 * three jobs; there is one more board, `misc`, for the work that belongs to nobody's ground. Take
 * one and the other two are off the table until that crew is home, so a district is a commitment
 * rather than a queue. Across the whole city a crew can only have {@link BASE_CONCURRENT_MISSIONS}
 * running at once, in different areas, and the only thing that lifts that is a milestone.
 *
 * The three on offer are a pure function of the area, so two players looking at Steelbelt see
 * the same three jobs and a player can plan around them. What differs is what they pay: a job in a
 * hard district is worth more than the same job in an easy one, which is what makes the map worth
 * pushing into.
 */

/** The board that is not anybody's ground: scrap runs, expeditions, work with no address. */
export const MISC_AREA_ID = 'misc';

/** Jobs on offer in one area at a time. Three, and taking one closes the other two. */
export const MISSIONS_PER_AREA = 3;

/** Crews a base can have out at once, before any milestone lifts it. */
export const BASE_CONCURRENT_MISSIONS = 2;

/**
 * §I3: how many a crew who has earned it may run.
 *
 * Every reader goes through here rather than through the constant, so a milestone cannot be
 * honoured on the screen and forgotten at the gate.
 */
export function concurrentMissionSlots(level: number): number {
  return BASE_CONCURRENT_MISSIONS + (isPlayerUnlockActive(MILESTONE_THIRD_CREW, level) ? 1 : 0);
}

/**
 * The three jobs an area offers, and the mix they come in.
 *
 * **One battle and two standard, or two battle and one standard**, decided per area on a coin the
 * area's own id flips. That is the board's rule and it is a good one: a board of three fights is a
 * board a crew with no army cannot read, and a board of three scrap runs is a board nobody with an
 * army wants. Every board has both kinds on it, and half of them lead with the fighting.
 *
 * Deterministic in the area **and the UTC day**: the pick walks each kind's own pool from a seeded
 * start in a seeded stride, so the three are stable for the whole day and two players looking at
 * Steelbelt see the same three, and the board turns over at midnight. The turnover is what
 * keeps a pool larger than the city's fifty-nine slots from being dead content: a job that is
 * on nobody's board today is on somebody's within the fortnight.
 *
 * `misc` gets the same treatment rather than a hand-picked list; what makes it different is that
 * it is always open, before a crew has scouted anything.
 */
export function missionOffers(areaId: string, day = ''): MissionTemplate[] {
  const seed = seedFrom(`${areaId}:${day}`);
  // The coin. One bit off the hash rather than a second draw, so the mix and the picks below
  // cannot be retuned independently by accident.
  const battles = (seed & 1) === 0 ? 1 : 2;

  const chosen = [
    ...takeFrom(byKind('battle'), seed, battles),
    ...takeFrom(byKind('standard'), seed >>> 8, MISSIONS_PER_AREA - battles),
  ];
  // Ordered as the board draws them rather than grouped by kind: three cards that always put the
  // fights on the left would make the arrows the only thing worth reading.
  return chosen.sort((a, b) => a.durationMinutes - b.durationMinutes);
}

const byKind = (kind: MissionKind): readonly MissionTemplate[] =>
  MISSION_TEMPLATES.filter((template) => template.kind === kind);

/** `count` different entries out of `pool`, walked from a seeded start in a seeded stride. */
function takeFrom(
  pool: readonly MissionTemplate[],
  seed: number,
  count: number,
): MissionTemplate[] {
  if (pool.length === 0) return [];
  const start = seed % pool.length;
  const stride = pool.length === 1 ? 1 : 1 + (seed % (pool.length - 1));
  const chosen: MissionTemplate[] = [];
  for (let step = 0; chosen.length < count && step < pool.length * 2; step += 1) {
    const template = pool[(start + step * stride) % pool.length];
    if (template && !chosen.includes(template)) chosen.push(template);
  }
  return chosen;
}

/** Every board this job is on offer at today, `misc` first and then the districts in map order. */
export function areasOffering(templateId: string, day = ''): string[] {
  return [MISC_AREA_ID, ...CITY_DISTRICTS.map((district) => district.id)].filter((areaId) =>
    missionOffers(areaId, day).some((template) => template.id === templateId),
  );
}

/** The UTC date a board is generated from, `YYYY-MM-DD`: the same grammar the Bar's roster uses. */
export function missionBoardDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * What a district's difficulty does to a job's pay.
 *
 * Percentage points per point of district difficulty (1..10). The Combine Spire pays about eighty
 * percent more than the Neon Docks for the same work, which is the whole reason to scout outwards.
 * `misc` sits at the bottom of the scale on purpose: it is the board that is always open, so it
 * has to be the one that pays least.
 */
export const PAY_PERCENT_PER_DIFFICULTY = 9;

export function areaDifficulty(areaId: string): number {
  if (areaId === MISC_AREA_ID) return 1;
  return CITY_DISTRICTS.find((district) => district.id === areaId)?.difficulty ?? 1;
}

export function areaPayPercent(areaId: string): number {
  return (areaDifficulty(areaId) - 1) * PAY_PERCENT_PER_DIFFICULTY;
}

/** A reward bundle with the area's premium on it. Whole units; a line that rounds away is dropped. */
export function scaledSpoils(spoils: PartialResources, payPercent: number): PartialResources {
  const factor = 1 + Math.max(0, payPercent) / 100;
  const scaled: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = spoils[key];
    if (amount === undefined) continue;
    const paid = Math.round(amount * factor);
    if (paid > 0) scaled[key] = paid;
  }
  return scaled;
}

/**
 * What the crew's own level does to a job (§I, §E5).
 *
 * Both halves move together, and they have to: a board that paid more without asking more would
 * make levelling a way of skipping the game, and one that asked more without paying more would
 * make it a punishment. Ten percent more pay per level over the first, and a point of success
 * chance off every other level, floored so the hardest job on the board never becomes a coin flip.
 *
 * Applied at the *offer*, so what a player reads on the card is what the run was launched under:
 * `launchMission` freezes both onto the row and a level gained mid-flight cannot re-price a crew
 * that has already gone.
 */
export const PAY_PERCENT_PER_LEVEL = 10;
export const SUCCESS_DROP_PER_LEVEL = 0.005;
export const MIN_SCALED_SUCCESS = 0.5;

export function levelPayPercent(level: number): number {
  return Math.max(0, Math.trunc(level) - 1) * PAY_PERCENT_PER_LEVEL;
}

export function scaledSuccessChance(base: number, level: number): number {
  const harder = base - Math.max(0, Math.trunc(level) - 1) * SUCCESS_DROP_PER_LEVEL;
  return Math.max(MIN_SCALED_SUCCESS, Math.min(1, harder));
}

/**
 * XP a job pays (§I1).
 *
 * Priced off the clock and the risk rather than authored per template: a job that takes a crew
 * off the board for a day is worth more than one that takes twenty minutes, and a battle is worth
 * more than a scrap run of the same length because it can come home with nothing.
 *
 * `PLAYER_XP_AWARDS.missionCompleted` is still the anchor: a thirty-minute standard job pays
 * exactly it, and everything else is that figure moved by the same §E5 curve the money uses.
 */
export function missionXp(template: MissionTemplate, totalMinutes: number, level: number): number {
  const scaled = PLAYER_XP_AWARDS.missionCompleted * rewardScale(totalMinutes, template.kind);
  // Harder ground is worth more to learn from, at the same rate the pay climbs.
  return Math.max(1, Math.round(scaled * (1 + levelPayPercent(level) / 100)));
}

/**
 * The share of it a run that came home empty still pays.
 *
 * A fifth, which is the board's figure. A failed run taught the crew something, and a level curve
 * that paid nothing at all for a bad day would make the safest job on the board the only one worth
 * taking. Resources are a different matter: a failure banks none, whatever kind it was.
 */
export const FAILED_MISSION_XP_SHARE = 0.2;

/** Whether this district is one a crew may still take work in. */
export interface AreaAvailability {
  scouted: boolean;
  /** Every location taken and the gate down: there is nothing left in there to be paid for. */
  ownedOutright: boolean;
}

export function areaIsOpen({ scouted, ownedOutright }: AreaAvailability): boolean {
  return scouted && !ownedOutright;
}

/** Districts a crew may be offered work in, in map order. */
export function openAreas(
  availability: (district: District) => AreaAvailability,
): readonly District[] {
  return CITY_DISTRICTS.filter((district) => areaIsOpen(availability(district)));
}

// --- who goes ---

export const MISSION_FORCE_REFUSALS = ['no_force', 'not_enough_units', 'needs_fighters'] as const;
export type MissionForceRefusal = (typeof MISSION_FORCE_REFUSALS)[number];

/**
 * Loot slots this crew can carry home.
 *
 * The same figure the raid path uses, and deliberately: a Scavenger's ten slots mean the same
 * thing whether they are emptying a stockpile or a collapsed overpass. It is what makes the
 * support tier worth training, because a job that pays more than the crew can lift pays only what
 * the crew can lift.
 */
export function missionCarry(force: Army): number {
  return Object.entries(force).reduce((total, [unitId, count]) => {
    const unit = findUnit(unitId);
    return unit ? total + unit.stats.lootCapacity * Math.max(0, count) : total;
  }, 0);
}

/** The slots a payout takes up, by the same weights a raid is measured in. */
export function payoutSlots(
  payout: PartialResources,
  weights: Readonly<Record<ResourceKey, number>>,
): number {
  return RESOURCE_KEYS.reduce((total, key) => total + (payout[key] ?? 0) * weights[key], 0);
}

/**
 * What a crew actually gets home, given what they can carry.
 *
 * Trimmed proportionally rather than by priority: a mission is work the crew went out to do and
 * came back from, so what they leave behind is a share of everything rather than the awkward
 * lines. Whole units, and a line that rounds to nothing is dropped.
 */
export function carriedHome(
  payout: PartialResources,
  capacity: number,
  weights: Readonly<Record<ResourceKey, number>>,
): PartialResources {
  const needed = payoutSlots(payout, weights);
  if (needed <= capacity || needed <= 0) return payout;
  const share = capacity / needed;
  const carried: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = payout[key];
    if (amount === undefined) continue;
    const taken = Math.floor(amount * share);
    if (taken > 0) carried[key] = taken;
  }
  return carried;
}

/**
 * Whether this force may go on this job.
 *
 * A battle mission needs somebody who can fight in it: porters may go along to carry, and they may
 * not go alone. A standard mission takes anybody, which is the point of the support tier.
 */
export function missionForceRefusal(
  force: Army,
  army: Army,
  kind: MissionKind,
): MissionForceRefusal | null {
  const entries = Object.entries(force).filter(([, count]) => count > 0);
  if (entries.length === 0) return 'no_force';
  if (entries.some(([unitId, count]) => (army[unitId] ?? 0) < count)) return 'not_enough_units';
  if (kind === 'battle' && !entries.some(([unitId]) => isCombatUnit(unitId))) {
    return 'needs_fighters';
  }
  return null;
}
