import { CITY_DISTRICTS, type District } from './city/districts.js';
import {
  MISSION_TEMPLATES,
  rewardScale,
  type MissionKind,
  type MissionTemplate,
} from './missions.js';
import { PLAYER_XP_AWARDS } from './progression/state.js';
import { GAME_TIMEZONE, dayInZone } from './time/zone.js';
import { MILESTONE_THIRD_CREW, isPlayerUnlockActive } from './progression/unlocks.js';
import { RESOURCE_KEYS, type PartialResources, type ResourceKey } from './resources.js';
import { seedFrom } from './rng.js';
import { isCombatUnit, type Army, type UnitLoadouts } from './units/index.js';
import { bareLineRules, type LineRules } from './battle/line.js';
import { lootCapacityOf } from './raid.js';

/**
 * Where work comes from (GDD §E, §A4).
 *
 * The board used to be one flat list of eight jobs that every crew saw for ever. That is a menu,
 * not a map: nothing about it said where you were working, nothing changed as the city changed,
 * and taking a job cost nothing but the clock.
 *
 * Work is now **per area**. Every contested district you have scouted that nobody holds end to
 * end offers three jobs; there is one more board, `misc`, for the work that belongs to nobody's
 * ground. Take one and the other two are off the table until that crew is home, so a district is
 * a commitment rather than a queue. Across the whole city a crew can only have
 * {@link BASE_CONCURRENT_MISSIONS} running at once, in different areas, and the only thing that
 * lifts that is a milestone.
 *
 * Two of those conditions arrived on 2026-09-21 and between them they make the board a map of
 * where the city is still loose: a residential district is somebody's plot and posts nothing, and
 * a district one party holds down to the last location is behind an armed gate and posts nothing
 * either, whoever that party is. The city as authored starts with two contested districts open
 * (Chrome Row and the Glasshouse Fields) and six shut, so breaking a gate is what puts a board on
 * the screen. {@link areaIsOpen} is the rule and `missions/board.test.ts` on the server is what
 * holds the count.
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
 * area's own id flips. That is the maintainer's rule and it is a good one: a board of three fights is a
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

/**
 * Every board this job is on offer at right now, `misc` first and then the districts in map order.
 *
 * Takes the moment rather than a day string, because the two kinds of board no longer share a
 * key: a district's is its game day and `misc` carries an hourly slot inside it. Asking each area
 * for its own key through `missionBoardKey` is the only reading that cannot go stale for one of
 * them while staying right for the other.
 *
 * Contested districts only (maintainer, 2026-09-21). `missionOffers` is a pure function of an area
 * id and will happily deal three jobs for a residential district, which posts none: a caller
 * asking "where is this job today" was handed a plot on the days the rotation put one first, and
 * the launch it built from that answer came back refused. The other half of {@link areaIsOpen},
 * whether the ground is scouted and loose, is a fact about one crew and cannot be answered here.
 */
export function areasOffering(
  templateId: string,
  now: Date,
  zone: string = GAME_TIMEZONE,
): string[] {
  const boards = CITY_DISTRICTS.filter((district) => district.kind === 'contested');
  return [MISC_AREA_ID, ...boards.map((district) => district.id)].filter((areaId) =>
    missionOffers(areaId, missionBoardKey(areaId, now, zone)).some(
      (template) => template.id === templateId,
    ),
  );
}

/** The game date a board is generated from, `YYYY-MM-DD`: the same grammar the Bar's roster uses. */
export function missionBoardDay(now: Date, zone: string = GAME_TIMEZONE): string {
  return dayInZone(now, zone);
}

/**
 * How often the `misc` board turns over, in minutes (maintainer, 2026-09-19).
 *
 * "Make the misc missions be a big pool, not the same over and over, and different ones are
 * chosen each time."
 *
 * The districts keep the day. A district's board is a fact about *ground*, and a player who
 * scouts the Rustyard and comes back an hour later to take the job they saw is entitled to find
 * it there. `misc` is the opposite by construction: it is the board with no address, always open
 * before anything has been scouted, and its whole job is to be the thing there is always
 * something to do on. Turning over hourly is what stops it being the same three cards every time
 * a player opens the page.
 *
 * An hour rather than minutes, because the board is still a shared fact: two players looking at
 * `misc` at the same moment see the same three, and `pagePrize` and the launch's own check read
 * the same key. See {@link missionBoardKey}.
 */
export const MISC_BOARD_ROTATION_MINUTES = 60;

/**
 * The key a board is generated from: the day, plus a slot within it for `misc`.
 *
 * One function for both, so the screen, the launch's "is this still on offer" check and the page
 * prize cannot disagree about which board they are talking about. A district's key is its day
 * unchanged, which is exactly what every one of those three read before this existed.
 */
export function missionBoardKey(areaId: string, now: Date, zone: string = GAME_TIMEZONE): string {
  const day = missionBoardDay(now, zone);
  if (areaId !== MISC_AREA_ID) return day;
  const slot = Math.floor(now.getTime() / (MISC_BOARD_ROTATION_MINUTES * 60_000));
  return `${day}#${slot}`;
}

/**
 * The keys a job may honestly be launched from: this board, and the one before it.
 *
 * The seam a faster turnover opens. A player who opens the send window at the end of a slot and
 * presses the button after it has rolled would be told "that job is not on offer there" about a
 * card that was on the wall when they read it. One slot of grace closes that, and closes nothing
 * else: a job two slots old is genuinely gone.
 *
 * A district has one key, because a day-old board is a day out of date rather than a second out.
 */
export function launchableBoardKeys(
  areaId: string,
  now: Date,
  zone: string = GAME_TIMEZONE,
): string[] {
  const current = missionBoardKey(areaId, now, zone);
  if (areaId !== MISC_AREA_ID) return [current];
  const before = new Date(now.getTime() - MISC_BOARD_ROTATION_MINUTES * 60_000);
  const previous = missionBoardKey(areaId, before, zone);
  return previous === current ? [current] : [current, previous];
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
 * A fifth, which is the maintainer's figure. A failed run taught the crew something, and a level curve
 * that paid nothing at all for a bad day would make the safest job on the board the only one worth
 * taking. Resources are a different matter: a failure banks none, whatever kind it was.
 */
export const FAILED_MISSION_XP_SHARE = 0.2;

/** Whether this district is one a crew may still take work in. */
export interface AreaAvailability {
  scouted: boolean;
  /**
   * One party holds every location in it, whoever they are.
   *
   * That is what arms a gate (`city/control.ts`, `startingHolder`), and a district behind an armed
   * gate has no work in it for anybody: there is nobody inside to hire a crew and nothing loose to
   * be paid for taking. It reads the same whether the party is the Combine, the looters, a rival
   * or the reader: see {@link areaIsOpen}.
   */
  heldWhole: boolean;
}

/**
 * Whether a crew may be offered work in this district (maintainer, 2026-09-21).
 *
 * Three conditions, and the last two are the new ones:
 *
 *   * **Scouted.** Work is only offered on ground somebody has had eyes on.
 *   * **Contested.** A residential district is somebody's plot, and the four of them hold no
 *     capturable locations at all (`districts.ts` guards it at module load). A job board over a
 *     rival's hideout was offering work in a place with nothing in it to work on.
 *   * **Not held end to end.** One party holding all of it is exactly what arms the gate, so the
 *     district is shut. This closed only against *your own* holdings before, which read as a rule
 *     about the reader rather than about the ground: the Combine Spire, held by the Combine down
 *     to the last plot, still posted three jobs a day.
 *
 * The misc board is not a district and is never subject to any of this: see {@link MISC_AREA_ID}.
 */
export function areaIsOpen(district: District, { scouted, heldWhole }: AreaAvailability): boolean {
  return district.kind === 'contested' && scouted && !heldWhole;
}

/** Districts a crew may be offered work in, in map order. */
export function openAreas(
  availability: (district: District) => AreaAvailability,
): readonly District[] {
  return CITY_DISTRICTS.filter((district) => areaIsOpen(district, availability(district)));
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
 *
 * Read off the **fitted** sheet, not the printed one. Three cards in `units/modifications.ts`
 * move `lootCapacity` (Hook and Line, Counterweight Harness, Rescue Rig, all written for the
 * carriers), and the roster shows the bag they promise. A force is a bag of unit ids with no
 * loadout of its own, so the crew's `unitLoadouts` come in beside it; a caller with no crew to
 * hand gets the catalogue figure.
 */
export function missionCarry(
  force: Army,
  loadouts: UnitLoadouts = {},
  /** §A4: what the crew's holdings and perks add to the bag, the same channel a raid spends. */
  bonusPercent = 0,
  /** ...and the marks they have been granted, so Haul Rigging is worth the research slot. */
  rules: LineRules = bareLineRules(),
): number {
  // Delegated rather than written twice. The doc above claimed "the same figure the raid path
  // uses, and deliberately" while this was a second arithmetic that ignored `picker`, ignored
  // `lootCapacityPercent` and ignored granted marks: a Scavenger carried 22 on a raid and 10 on a
  // job, and the Pawn Shop was worth nothing to a crew that only ran jobs.
  return lootCapacityOf(force, bonusPercent, loadouts, rules);
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

  const room = Math.max(0, Math.floor(capacity));
  const share = room / needed;

  /*
   * The proportional share first, floored, and then the bag is **filled**.
   *
   * Flooring every line on its own leaves the remainders on the floor, and a crew that walked to
   * the edge of the map does not come home with empty slots. Measured across the board it threw
   * away 2.4 slots on an average trim and nine on the Deep Expedition, and at the bottom it was
   * worse than untidy: a crew with one slot free and a payout of seventeen scrap carried
   * `floor(17 * 1/32) = 0` of it and came back with nothing at all, holding an empty bag.
   *
   * So the floor is the start and not the answer. What is left of the capacity is handed out one
   * unit at a time, largest remainder first, which is the same tie-break `splitSurvivors` uses to
   * hand back units and is chosen for the same reason: it fills exactly, it cannot exceed what was
   * on offer, and it puts the odd slot where the proportional share came closest to earning it.
   */
  const taken: Partial<Record<ResourceKey, number>> = {};
  let used = 0;
  for (const key of RESOURCE_KEYS) {
    const amount = payout[key];
    if (amount === undefined || amount <= 0) continue;
    const whole = Math.floor(amount * share);
    if (whole > 0) {
      taken[key] = whole;
      used += whole * weights[key];
    }
  }

  /** How far each line fell short of its exact share: who has first claim on a spare slot. */
  const remainder = (key: ResourceKey): number => {
    const amount = payout[key] ?? 0;
    return amount * share - (taken[key] ?? 0);
  };

  for (;;) {
    let best: ResourceKey | null = null;
    for (const key of RESOURCE_KEYS) {
      const amount = payout[key] ?? 0;
      // Never more than was on offer, and never a unit that will not fit in what is left.
      if ((taken[key] ?? 0) >= amount) continue;
      if (weights[key] > room - used) continue;
      if (best === null || remainder(key) > remainder(best)) best = key;
    }
    if (best === null) break;
    taken[best] = (taken[best] ?? 0) + 1;
    used += weights[best];
  }

  const carried: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = taken[key];
    if (amount !== undefined && amount > 0) carried[key] = amount;
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
