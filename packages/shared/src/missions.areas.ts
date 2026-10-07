import type { District } from './city/districts.js';
import { districtsOfCity, findDistrict } from './city/atlas.js';
import { DEFAULT_CITY_ID, cityIsOpen } from './city/cities.js';
import { rawMinutesBetween } from './city/geography.js';
import {
  MISSION_TEMPLATES,
  rewardScale,
  templateTimings,
  type Mission,
  type MissionKind,
  type MissionTemplate,
} from './missions.js';
import { PLAYER_XP_AWARDS } from './progression/state.js';
import { GAME_TIMEZONE, dayInZone } from './time/zone.js';
import { MILESTONE_THIRD_CREW, isPlayerUnlockActive } from './progression/unlocks.js';
import { RESOURCE_KEYS, type PartialResources, type ResourceKey } from './resources.js';
import { seedFrom } from './rng.js';
import { GRADES, dealGrade, gradeIndex, type Grade } from './missions.grade.js';
import { findUnit, type Army, type UnitLoadouts } from './units/index.js';
import { bareLineRules, standsInLine, type LineRules } from './battle/line.js';
import { lootCapacityOf } from './raid.js';

/**
 * Where work comes from (GDD §E, §A4).
 *
 * The board used to be one flat list of eight jobs that every crew saw for ever. That is a menu,
 * not a map: nothing about it said where you were working, nothing changed as the city changed,
 * and taking a job cost nothing but the clock.
 *
 * Work is now **per area**. Every contested district a crew holds at least one location in offers
 * three jobs; there is one more board, `misc`, for the work that belongs to nobody's ground. Take
 * one and the other two are off the table until that crew is home, so a district is a commitment
 * rather than a queue. Across the whole city a crew can only have {@link BASE_CONCURRENT_MISSIONS}
 * running at once, in different areas, and the only thing that lifts that is a milestone.
 *
 * The foothold rule is the maintainer's (2026-09-29): "in order to do missions in a district you
 * still need to hold at least one location in that district, or you can do the misc ones". So the
 * board is a map of where the crew has a stake, and taking the first place in a district is what
 * puts its board on the screen. {@link areaIsOpen} is the rule and `missions/board.test.ts` on the
 * server is what holds it.
 *
 * The three on offer are a pure function of the area, its key and the crew's level, so a crew
 * sees the same three on every read and can plan around them; two crews at different levels see
 * different grades (see {@link missionOffers}). What the ground adds is pay: a job in a hard
 * district is worth more than the same job in an easy one, which is what makes the map worth
 * pushing into.
 *
 * ## One city at a time, but the whole world priced (2026-09-24)
 *
 * Every enumeration here used to read `CITY_DISTRICTS`, which is Ashfall's twelve and nothing
 * else. Two different bugs came out of that the day Terminus opened. The enumerations
 * ({@link areasOffering}, {@link openAreas}) answered about the wrong city, so a crew standing in
 * Terminus read Ashfall's boards; those take a `cityId` now and go through `districtsOfCity`.
 * {@link areaDifficulty} was worse, because it does not enumerate anything: it looked a single
 * district up in Ashfall's array, missed, and fell through to its `?? 1`, which is the `misc`
 * floor. Every Terminus board would have paid the cheapest rate in the game, the Blockhouse's
 * difficulty 10 included. That one is a world-wide lookup (`findDistrict`) rather than a city
 * parameter: a district's difficulty is a fact about the ground and the caller already has its id.
 */

/** The board that is not anybody's ground: scrap runs, expeditions, work with no address. */
export const MISC_AREA_ID = 'misc';

/** Jobs on offer in one area at a time. Three, and taking one closes the other two. */
export const MISSIONS_PER_AREA = 3;
/** Of which exactly one is a fight (maintainer, 2026-09-23); the other two are plain work. */
export const FIGHTS_PER_AREA = 1;

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

/** One card on a board: the job, and the grade it was dealt at. */
export interface DealtJob {
  template: MissionTemplate;
  grade: Grade;
}

/**
 * The three jobs an area offers a crew, and the grade each is dealt at (maintainer, 2026-09-28).
 *
 * **One fight and two plain jobs**, on every board (maintainer, 2026-09-23): a board of three
 * fights is one a crew with no army cannot read, and a board of three scrap runs is one nobody with
 * an army wants.
 *
 * Each card rolls its grade off the crew's level (`dealGrade`), then takes a job of its kind whose
 * range covers that grade. Boards are a crew's own: taking a job touches nobody else's, and two
 * crews at different levels looking at one district see different work. For one crew the board is
 * deterministic in the area and its key (`missionBoardKey`), so a card re-read is the same card;
 * the level moves which cut of the same roll a card lands in, so a crew that levels up can see an
 * untaken card change, the way a fight's tier used to.
 *
 * `misc` gets the same treatment rather than a hand-picked list; what makes it different is that
 * it is always open, before a crew holds anything.
 */
export function missionOffers(areaId: string, day = '', level = 1): DealtJob[] {
  const kinds: MissionKind[] = [
    ...Array<MissionKind>(FIGHTS_PER_AREA).fill('battle'),
    ...Array<MissionKind>(MISSIONS_PER_AREA - FIGHTS_PER_AREA).fill('standard'),
  ];
  const dealt: DealtJob[] = [];
  kinds.forEach((kind, slot) => {
    const seed = seedFrom(`deal:${areaId}:${day}:${slot}`);
    const { covering, grades } = jobsOfKind(kind);
    const grade = dealGrade((seed % 100_000) / 100_000, level, grades);
    const fits = (covering.get(grade) ?? []).filter(
      (template) => !dealt.some((job) => job.template === template),
    );
    const template = fits[(seed >>> 7) % fits.length];
    if (template) dealt.push({ template, grade });
  });
  // Ordered as the board draws them rather than grouped by kind: three cards that always put the
  // fight on the left would make the arrows the only thing worth reading.
  return dealt.sort(
    (a, b) =>
      templateTimings(a.template, a.grade).durationMinutes -
      templateTimings(b.template, b.grade).durationMinutes,
  );
}

/**
 * Each kind's jobs by the grades they cover, worked out once. Read three times a board, and a
 * board is drawn for every area on every read of the missions screen.
 *
 * Built on first use rather than at load: this module and the catalogue import each other, and
 * the catalogue is not there yet while this one is still loading.
 */
const JOBS_BY_KIND = new Map<
  MissionKind,
  { covering: Map<Grade, MissionTemplate[]>; grades: Grade[] }
>();

function jobsOfKind(kind: MissionKind): {
  covering: Map<Grade, MissionTemplate[]>;
  grades: Grade[];
} {
  const known = JOBS_BY_KIND.get(kind);
  if (known) return known;
  const pool = MISSION_TEMPLATES.filter((template) => template.kind === kind);
  const covering = new Map<Grade, MissionTemplate[]>();
  for (const grade of GRADES) {
    const jobs = pool.filter((template) => covers(template, grade));
    if (jobs.length > 0) covering.set(grade, jobs);
  }
  // Every grade holds at least eight jobs of each kind (`missions.grade.test.ts`), so leaving out
  // the one or two already on the board never empties a grade the deal can land on.
  const built = { covering, grades: [...covering.keys()] };
  JOBS_BY_KIND.set(kind, built);
  return built;
}

/** Whether a job can be dealt at this grade. */
export function covers(template: MissionTemplate, grade: Grade): boolean {
  const at = gradeIndex(grade);
  return gradeIndex(template.grades[0]) <= at && at <= gradeIndex(template.grades[1]);
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
 * whether the crew holds a place there, is a fact about one crew and cannot be answered here.
 *
 * One city's boards, because a crew reads one city's board at a time and "where is this job
 * today" has a different answer in each of them. Defaulted to the city everybody starts in rather
 * than answering for the whole world: a caller that does not say which city means the one it has
 * always meant, and a list mixing three cities' district ids is a list nothing can act on without
 * splitting it again.
 */
export function areasOffering(
  templateId: string,
  now: Date,
  level: number,
  zone: string = GAME_TIMEZONE,
  cityId: string = DEFAULT_CITY_ID,
): string[] {
  const boards = districtsOfCity(cityId).filter((district) => district.kind === 'contested');
  return [MISC_AREA_ID, ...boards.map((district) => district.id)].filter((areaId) =>
    missionOffers(areaId, missionBoardKey(areaId, now, zone), level).some(
      (job) => job.template.id === templateId,
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
 * reads the Steelbelt's board and comes back an hour later to take the job they saw is entitled to
 * find it there. `misc` is the opposite by construction: it is the board with no address, always
 * open before a crew holds anything, and its whole job is to be the thing there is always
 * something to do on. Turning over hourly is what stops it being the same three cards every time
 * a player opens the page.
 *
 * An hour rather than minutes, because the key is still a shared fact: two crews at the same level
 * looking at `misc` at the same moment are dealt the same three (taking one touches nobody else's
 * board), and the launch's own check reads the same key. See {@link missionBoardKey}.
 */
export const MISC_BOARD_ROTATION_MINUTES = 60;

/**
 * The key a board is generated from: the day, plus a slot within it for `misc`.
 *
 * One function for both, so the screen and the launch's "is this still on offer" check cannot
 * disagree about which board they are talking about: the card carries its key and the launch names
 * it back. A district's key is its day unchanged, which is what both read before this existed.
 *
 * ## No city term, on purpose (2026-09-24)
 *
 * A district carries its city in its own id, so two cities' boards are already different boards.
 * `misc` is the one area that is not ground, and the question a second city raised is whether a
 * crew standing in Terminus should read a different three cards from the same crew at home.
 *
 * They read the same three, and that follows from what `misc` is: work with no address, and
 * therefore work with no city. Two other things say the same. `areaPayPercent(misc)` is 0 in every
 * city because the board that is always open is the board that pays least, so a per-city `misc`
 * would differ in its cards and in nothing a player can weigh. And `areaId` is what the
 * one-crew-per-area rule and the stored mission row are both keyed on, so making the cards differ
 * per city without splitting the id would leave one lock over boards that are no longer the same
 * board: a crew with a scrap run out of Ashfall would be refused a Terminus one it can see. The
 * split is a bigger change than the cards are worth, and it is the maintainer's to call.
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
 * percent more than the Neon Docks for the same work, which is the whole reason to push outwards.
 * `misc` sits at the bottom of the scale on purpose: it is the board that is always open, so it
 * has to be the one that pays least.
 */
export const PAY_PERCENT_PER_DIFFICULTY = 9;

/**
 * The authored difficulty of the ground a board sits on, anywhere in the world.
 *
 * `findDistrict` rather than a walk of one city's array. The `?? 1` below is there for an area id
 * the map genuinely does not have, a renamed district on a stale tab, and it has to stay a
 * fall-through of last resort: a lookup scoped to Ashfall silently gave every Terminus board the
 * `misc` rate, so the Blockhouse at difficulty 10 paid what the board that is always open pays.
 */
export function areaDifficulty(areaId: string): number {
  if (areaId === MISC_AREA_ID) return 1;
  const district = findDistrict(areaId);
  // A plot posts no board and carries no difficulty (maintainer, 2026-09-30), so it pays the floor.
  return district?.kind === 'contested' ? district.difficulty : 1;
}

export function areaPayPercent(areaId: string): number {
  return (areaDifficulty(areaId) - 1) * PAY_PERCENT_PER_DIFFICULTY;
}

/**
 * The walk a job in another city adds to each leg of its road, in minutes before anybody's pace or
 * bonuses are spent on it; 0 for a job in the crew's own city and for the misc board.
 *
 * The maintainer's ruling, 2026-09-29: "Add the walk". A crew may take work in any city it holds a
 * place in, and the road was the template's band (5, 20 or 60 minutes) wherever the job was, so an
 * Ashfall crew took a Terminus job on a five-minute road while the same people walking there for
 * a move took two hours across the frontier. It is the road a move between those two districts
 * walks (`rawMinutesBetween`, the frontier leg and all), added to the band, so every cut the band
 * takes (the ground's, the column's pace, the crew's travel bonuses) is spent on it too, and the
 * card is priced on the longer road the way it is priced on the band.
 *
 * The misc board has no address, so it adds nothing. Inside one city the band already stands for
 * the road, which is the rule the board has always had.
 */
export function missionWalkMinutes(homeDistrictId: string, areaId: string): number {
  if (areaId === MISC_AREA_ID) return 0;
  const home = findDistrict(homeDistrictId);
  const job = findDistrict(areaId);
  if (!home || !job || home.cityId === job.cityId) return 0;
  return Math.round(rawMinutesBetween(home, job));
}

/**
 * A job's pay with the crew's `missionCapsPercent` on its caps (Cap Counter, 2026-10-01).
 *
 * After `scaledSpoils`, and on the caps alone: the perk is about counting the money, and a crew that
 * holds it is paid more caps without its salvage changing.
 */
export function withMissionCaps(spoils: PartialResources, capsPercent: number): PartialResources {
  const caps = spoils.caps;
  if (caps === undefined || capsPercent <= 0) return spoils;
  return { ...spoils, caps: Math.round(caps * (1 + capsPercent / 100)) };
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
 * XP a job pays (§I1).
 *
 * Priced off the clock and the risk rather than authored per template: a job that takes a crew
 * off the board for a day is worth more than one that takes twenty minutes, and a battle is worth
 * more than a scrap run of the same length because it can come home with nothing.
 *
 * `PLAYER_XP_AWARDS.missionCompleted` is still the anchor: a thirty-minute standard job pays
 * exactly it, and everything else is that figure moved by the same §E5 curve the money uses.
 */
export function missionXp(
  template: MissionTemplate,
  totalMinutes: number,
  /** The grade the card was dealt and the row froze: harder work is worth more to learn from. */
  grade: Grade,
): number {
  return Math.max(
    1,
    Math.round(PLAYER_XP_AWARDS.missionCompleted * rewardScale(totalMinutes, template.kind, grade)),
  );
}

/**
 * The share of it a run that came home empty still pays.
 *
 * A fifth, which is the maintainer's figure. A failed run taught the crew something, and a level curve
 * that paid nothing at all for a bad day would make the safest job on the board the only one worth
 * taking. Resources are a different matter: a failure banks none, whatever kind it was.
 */
export const FAILED_MISSION_XP_SHARE = 0.2;

/**
 * The XP a finished run paid: the figure frozen at launch on a clean run, the failure's share of
 * it on one that came home empty, and none for a crew turned round before the site or one nobody
 * came back from.
 *
 * One function because two readers print or pay it: the settle banks it and the mission report
 * prints it, and the report printed the frozen figure whatever the outcome, so a failed run read
 * five times what it paid. A row from before missions priced their own XP carries zero, which
 * falls back to the table's anchor.
 */
export function missionXpEarned(
  mission: Pick<Mission, 'xp' | 'outcome' | 'recalledAt' | 'reported'>,
): number {
  if (!mission.reported || mission.recalledAt !== null) return 0;
  const full = mission.xp > 0 ? mission.xp : PLAYER_XP_AWARDS.missionCompleted;
  return Math.round(full * (mission.outcome === 'success' ? 1 : FAILED_MISSION_XP_SHARE));
}

/** Whether this district is one a crew may take work in. */
export interface AreaAvailability {
  /** How many locations in it this crew holds. */
  heldByCrew: number;
}

/**
 * Whether a crew may be offered work in this district (maintainer, 2026-09-29).
 *
 * Two conditions:
 *
 *   * **Contested.** A residential district is somebody's plot, and the four of them hold no
 *     capturable locations at all (`districts.ts` guards it at module load). A job board over a
 *     rival's hideout was offering work in a place with nothing in it to work on.
 *   * **A foothold.** The crew holds at least one location in it. Holding all of them keeps the
 *     board open: the district is the crew's own ground and its people still hire. Another party
 *     holding it whole cannot happen alongside a foothold, since whole means every location.
 *
 * It used to need the district scouted and **not** held end to end by anybody, the crew included.
 * Scouting left the game and the whole map is visible, so the stake is what opens a board now.
 *
 * The misc board is not a district and is never subject to any of this: see {@link MISC_AREA_ID}.
 */
export function areaIsOpen(district: District, { heldByCrew }: AreaAvailability): boolean {
  // A city that is not open has no work in it for anybody, whatever is held there (2026-09-29).
  return district.kind === 'contested' && heldByCrew > 0 && cityIsOpen(district.cityId);
}

/**
 * Districts a crew may be offered work in, in map order, within one city.
 *
 * The city is a parameter for the reason {@link areasOffering} gives: a board belongs to the
 * ground a crew is standing on, and Ashfall is the default rather than the whole of it.
 */
export function openAreas(
  availability: (district: District) => AreaAvailability,
  cityId: string = DEFAULT_CITY_ID,
): readonly District[] {
  return districtsOfCity(cityId).filter((district) => areaIsOpen(district, availability(district)));
}

// --- who goes ---

export const MISSION_FORCE_REFUSALS = ['no_force', 'not_enough_units', 'needs_fighters'] as const;
export type MissionForceRefusal = (typeof MISSION_FORCE_REFUSALS)[number];

/** Why a party cannot go, in the player's words: the launch's refusal and a standing order's stall. */
export const MISSION_FORCE_REFUSAL_TEXT: Record<MissionForceRefusal, string> = {
  no_force: 'Send somebody, or do not send anybody',
  not_enough_units: 'You do not have those units at home',
  needs_fighters: 'Somebody there has to be able to fight. Porters do not go in alone',
};

/**
 * Loot slots this crew can carry home.
 *
 * The same figure the raid path uses, and deliberately: a Scavenger's ten slots mean the same
 * thing whether they are emptying a stockpile or a collapsed overpass. It is what makes the
 * support tier worth mustering, because a job that pays more than the crew can lift pays only what
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
  /** The Straw Sack's bags (`carrierLootFlat`): slots on every carrier, the same as on a raid. */
  carrierFlat = 0,
): number {
  // Delegated rather than written twice. The doc above claimed "the same figure the raid path
  // uses, and deliberately" while this was a second arithmetic that ignored `picker`, ignored
  // `lootCapacityPercent` and ignored granted marks: a Scavenger carried 22 on a raid and 10 on a
  // job, and the Pawn Shop was worth nothing to a crew that only ran jobs.
  return lootCapacityOf(force, bonusPercent, loadouts, rules, carrierFlat);
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
 *
 * "Can fight" is the engine's own question (`standsInLine`), asked with the crew's line rules
 * (bug pass, 2026-09-29). A crew holding `carriers_fight` puts its porters in the line at their
 * full sheet, the declared-battle door already lets them go (`isFightingForce` in
 * `battle/deploy.ts`), and the settle fights them on a job too. This door asked `isCombatUnit`
 * and nothing else, so a party of Haulers that the fight would have stood in line was refused at
 * the gate. Defaulted to the bare rules, the strict reading, for a caller with no crew in hand.
 */
export function missionForceRefusal(
  force: Army,
  army: Army,
  kind: MissionKind,
  rules: LineRules = bareLineRules(),
): MissionForceRefusal | null {
  const entries = Object.entries(force).filter(([, count]) => count > 0);
  if (entries.length === 0) return 'no_force';
  if (entries.some(([unitId, count]) => (army[unitId] ?? 0) < count)) return 'not_enough_units';
  const fights = ([unitId]: [string, number]): boolean => {
    const unit = findUnit(unitId);
    return unit !== undefined && standsInLine(unit, rules);
  };
  if (kind === 'battle' && !entries.some(fights)) return 'needs_fighters';
  return null;
}
