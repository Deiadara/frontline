import {
  RECRUIT_MAX_MIN_FACTION_INFAMY,
  RECRUIT_MAX_MIN_INFAMY,
  RECRUIT_MAX_MIN_LEVEL,
  DEFAULT_CITY_ID,
  RECRUIT_MAX_MIN_NOTORIETY,
  perksWorth,
  RECRUIT_MIN_FACTION_INFAMY_GATE,
  RECRUIT_MIN_INFAMY_GATE,
  RECRUIT_MIN_LEVEL_GATE,
  RECRUIT_LEGEND_NOTORIETY,
  RECRUIT_MIN_NOTORIETY_GATE,
  type Attributes,
  seedFrom,
  type JoinRequirement,
  GAME_TIMEZONE,
  dayInZone,
} from '@frontline/shared';
import {
  MAX_CALIBRE,
  MIN_CALIBRE,
  ORDINARY_ROLL,
  generateCharacter,
  type RollShape,
} from '../characters/generate.js';
import { createRng, randomInt, type Rng } from '../characters/rng.js';
import { rollName } from './names.js';

/**
 * The Bar's shared roster (GDD §H1, §H2, §H2a).
 *
 * §H2 makes this "the same for every player": one room, not a private roll per account, and a pure
 * function of the game day with no roster table and no scheduled job.
 *
 * It was briefly a function of the day *and* of per-seat turnover, because hiring somebody used to
 * take them out of the room and drop a replacement into their chair. The auction ended that. A
 * table has to stand all day for everybody bidding at it, so nobody leaves the room before
 * midnight, and the roster is once again a function of the date alone.
 *
 * Note what is *not* generated here: a role. A character at the Bar has not been hired into
 * anything yet (§C2), and the affinity that shaped their sheet is dropped by `generateCharacter`
 * on the way out (§B8a, INTERFACES R4), which is why this module calls that and never
 * `rollRecruit`.
 */

/**
 * The generation segment of a recruit id and of the seeds behind them, frozen at zero.
 *
 * It used to count how many people had been hired out of a seat today. Nothing turns a seat over
 * any more, so it is a constant, and it is kept rather than deleted for two reasons: the id
 * grammar `bar-<day>-<seat>-0` is parsed in three places and stored in `bar_bids`, `bar_hires` and
 * `bar_auction_results`, and leaving it in the seed keeps every room the roster tests have already
 * measured exactly the room they measured.
 */
const SEAT_GENERATION = 0;

/** How many people are drinking here on any given day. */
export const BAR_ROSTER_SIZE = 8;

/** Recruits whose §H3 gate is simply "anyone may approach me". */
const OPEN_DOOR_CHANCE = 0.6;

/** Of the gated ones, how many want the crew to have been around as well as to be known. */
const BOTH_DOORS_CHANCE = 0.35;

/**
 * How many of the day's recruits any crew can always approach: no §H3 gate at all.
 *
 * A brand-new crew has rank `Nobody` and level 1, so every rolled gate is shut to them, and a Bar
 * that is empty on the day a player first opens it reads as a broken screen rather than as a
 * locked door. Three is a choice rather than a correctness floor: one would be safe, and three is
 * what makes the first night's room worth reading.
 *
 * The floor is a property of the *seat*, not of the person in it, so the first three hires of the
 * day cannot close the only doors a new crew can walk through.
 */
export const BAR_OPEN_DOOR_FLOOR = 3;

/**
 * The good ones, and where they sit (maintainer request, 2026-09-11).
 *
 * The room used to be eight people drawn off one curve, so the best seat on a given night was the
 * best of eight ordinary rolls and a player had no reason to come back on a night they could not
 * afford anybody. The last two seats of the base roster are **standouts**: rolled at a calibre well
 * above the room, guaranteed a couple of perks, and behind all four §H3 doors including the two
 * that are not about the player alone.
 *
 * Fixed seat indices, and that is load-bearing. §H2 says the room is the same for every player, and
 * a crew whose Charisma has widened its room (`barSeatsFor`) must see the same people in the same
 * chairs as a crew that has not. Anything counted from the *end* of a room whose length varies
 * would put a different person behind these doors for two players looking at the same night. The
 * seats a widened room adds are ordinary people who happened to be in.
 */
export const BAR_STANDOUT_SEATS = 2;

/**
 * How far above the room a standout is rolled, in attribute points on every mean.
 *
 * Six, against a base mean of 18 and a strength mean of 30, so a standout in a fresh city reads as
 * somebody who has been somewhere. It is added to the city's own calibre and clamped with it, so in
 * a mature city where the room is already at the ceiling what separates the standouts is the perk
 * floor and the doors rather than the sheet. That is the honest version: the ceiling is the
 * ceiling, and a room cannot be better than the game allows anybody to be.
 */
export const STANDOUT_CALIBRE_LIFT = 6;

/** ...and the perks they are guaranteed, which the ordinary roll gives about one in five. */
export const STANDOUT_MIN_PERKS = 2;

/**
 * What makes a standout better once the city has run out of calibre to give.
 *
 * `STANDOUT_CALIBRE_LIFT` is the whole difference in a young city and none of it in a mature one,
 * because the room is already at `MAX_CALIBRE` and the lift clamps away: measured at city level 30
 * the two sheets came out at 989 and 986 points, which is no difference at all. These two are the
 * levers that still work at the ceiling. More of the sheet is lifted, and none of it is pulled
 * down, so a standout is better at more things without any single attribute passing
 * `MAX_RECRUITMENT_ATTRIBUTE`, which is the bound the whole game reads §B2a off.
 */
export const STANDOUT_EXTRA_STRENGTHS = 3;

/** The shape the standout seats are rolled at, in one object because the parts only move together. */
export const STANDOUT_ROLL: RollShape = {
  minPerks: STANDOUT_MIN_PERKS,
  extraStrengths: STANDOUT_EXTRA_STRENGTHS,
  noWeaknesses: true,
  /*
   * And the tags they draw are the good ones (maintainer, 2026-09-16).
   *
   * This is the lever that works best of the four at the ceiling, better even than
   * `STANDOUT_EXTRA_STRENGTHS`: attributes are trainable and clamped, so two sheets at
   * `MAX_CALIBRE` converge, while a tag is permanent and there is no ceiling on how good one is.
   * A standout carrying two tags off the rich draw is a different object from the room around it in
   * the one way a player cannot erase with a month at the training floor.
   */
  perkDraw: 'rich',
};

/** Whether seat `index` is one of the two the good ones sit in. */
export function isStandoutSeat(index: number): boolean {
  return index >= BAR_ROSTER_SIZE - BAR_STANDOUT_SEATS && index < BAR_ROSTER_SIZE;
}

/**
 * How good this particular person is, against the room they are standing in (maintainer request,
 * 2026-09-11).
 *
 * The room used to be one curve and everybody was drawn off it, so eight recruits came out within
 * a few percent of each other: measured over four hundred nights at city level 0, ordinary sheets
 * ran 638 to 686 points between the tenth and ninetieth percentiles, on a mean of 662. That is not
 * a room of people, it is the same person eight times with the names changed, and it made the
 * choice at the Bar a choice about the *price* rather than about the person.
 *
 * A grade is a shift of the whole sheet rather than more noise on each attribute. That distinction
 * is the point: thirty-five independent draws concentrate hard whatever their spread (the sum of
 * thirty-five gaussians has a standard deviation of about five times one of them, against a mean
 * of thirty-five times), so widening the per-attribute variance would blur every sheet without
 * separating any two people. Moving the mean the whole sheet is drawn from separates them.
 *
 * Weighted towards the middle, with both tails thin: most people at the Bar are ordinary, a green
 * one turns up often enough to be a real risk, and somebody seasoned is a night worth coming in
 * for. The offsets are added to the room's own calibre and clamped with it, so a mature city
 * raises the whole ladder rather than flattening it.
 */
export interface RecruitGrade {
  /** For the logs and the tests. Never shown to a player: what they see is the sheet. */
  id: string;
  /** Points added to every mean this sheet is drawn from, on top of the room's own calibre. */
  calibre: number;
  weight: number;
  /**
   * The hardest §H3 rank this grade will ask a crew for. Zero is "anyone may approach me".
   *
   * A person asks for what they are worth, and without this the two halves of a recruit came from
   * independent rolls: a green sheet of 348 points could sit behind the same rank-five door as the
   * best officer in the game, which is a card nobody would ever take and reads as a bug in the
   * roll. The level door rides on this one, because the control flow below only reaches it once a
   * rank has been asked for.
   */
  maxNotoriety: number;
}

export const RECRUIT_GRADES: readonly RecruitGrade[] = [
  { id: 'green', calibre: -8, weight: 12, maxNotoriety: 0 },
  { id: 'raw', calibre: -5, weight: 20, maxNotoriety: 1 },
  { id: 'ordinary', calibre: -2, weight: 30, maxNotoriety: 2 },
  { id: 'steady', calibre: 1, weight: 22, maxNotoriety: 3 },
  { id: 'seasoned', calibre: 4, weight: 12, maxNotoriety: 4 },
  /*
   * The top of the ordinary ladder, and deliberately under the standout seats' own lift.
   *
   * It was +7, which at every city level either matched or beat `STANDOUT_CALIBRE_LIFT`: an
   * ordinary seat rolled 1042 points against a standout's 1027 on the same night, with none of the
   * standout's doors on it. A seat that is as good and cheaper to reach makes the two chairs at
   * the end of the room pointless, so the ordinary ceiling stops below them.
   */
  { id: 'veteran', calibre: 5, weight: 4, maxNotoriety: RECRUIT_MAX_MIN_NOTORIETY },
] as const;

/**
 * Which grade this seat drew, off a seed of its own.
 *
 * A third stream rather than a draw off either existing one, for the reason the two already here
 * are separate: the sheet seed feeds a whole rng stream whose draw order is W1's to change, and
 * taking the grade off it would mean a retune of the attribute roll silently re-graded the room.
 */
export function gradeOf(seed: number): RecruitGrade {
  const total = RECRUIT_GRADES.reduce((sum, grade) => sum + grade.weight, 0);
  let roll = (createRng(seed)() * total) % total;
  for (const grade of RECRUIT_GRADES) {
    roll -= grade.weight;
    if (roll < 0) return grade;
  }
  // Unreachable while the weights are positive, and a total function beats a throw on a rounding
  // edge nobody will reproduce.
  return RECRUIT_GRADES[RECRUIT_GRADES.length - 1] as RecruitGrade;
}

/** §H2a: the game date a roster is generated from, `YYYY-MM-DD`. Athens, not UTC. */
export function barDay(now: Date, zone: string = GAME_TIMEZONE): string {
  return dayInZone(now, zone);
}

/**
 * What a tag is worth in rungs of the §H3 door (maintainer, 2026-09-16).
 *
 * "You can rank their rarity and price based on their tags too, and that matters a lot because tags
 * do not change and attributes can be trained." The price already reads them (`askingWage`); this is
 * the other half. A grade decides how high a *sheet* lets somebody reach, and a sheet is the half of
 * a person a crew can train up themselves, so a recruit whose whole value is a permanent tag was
 * asking for whatever their middling attributes allowed.
 *
 * One rung per this many points of `perksWorth`, so the best single tag in the game (the ceiling is
 * 20) is worth two rungs on its own and an ordinary one is worth none. Deliberately coarse: it is
 * meant to move the genuinely rare ones and leave the rest of the room where it was.
 */
export const WORTH_PER_DOOR_RUNG = 9;

/** How high this person may ask, sheet and tags together, bounded by the game's own top rung. */
export function doorCeilingFor(grade: RecruitGrade, perks: readonly string[]): number {
  const lift = Math.floor(perksWorth(perks) / WORTH_PER_DOOR_RUNG);
  return Math.min(RECRUIT_MAX_MIN_NOTORIETY, grade.maxNotoriety + lift);
}

/**
 * §H3: what this character asks of a crew. Most people at the Bar will talk to anyone; the rest
 * want a name that has already been heard, and a few want both that and a crew that has lasted.
 *
 * The level door is rolled against the room's own calibre rather than out of thin air: a room
 * scaled up by a level-thirty city asks for a level-thirty crew, so the good ones that turn up
 * late are gated at something a crew playing that city has actually reached.
 */
function rollRequirement(
  rng: Rng,
  cityLevel: number,
  grade: RecruitGrade,
  perks: readonly string[],
): JoinRequirement {
  // Everything shut off. The two wide doors belong to the standout seats and are written out
  // rather than defaulted, so a reader of this function can see that it does not roll them.
  const open: JoinRequirement = {
    minNotoriety: 0,
    minLevel: 1,
    minInfamy: 0,
    minFactionInfamy: 0,
  };
  // Somebody with nothing to offer is in no position to ask. The grade decides how high they can
  // reach, which is what keeps the sheet and the door on a card telling the same story, and the
  // tags they carry lift that ceiling: see `doorCeilingFor`.
  const ceilingRank = doorCeilingFor(grade, perks);
  if (ceilingRank < RECRUIT_MIN_NOTORIETY_GATE) return open;
  if (rng() < OPEN_DOOR_CHANCE) return open;
  const minNotoriety = randomInt(rng, RECRUIT_MIN_NOTORIETY_GATE, ceilingRank);
  if (rng() >= BOTH_DOORS_CHANCE) return { ...open, minNotoriety };
  const ceiling = Math.min(RECRUIT_MAX_MIN_LEVEL, Math.max(RECRUIT_MIN_LEVEL_GATE, cityLevel));
  return { ...open, minNotoriety, minLevel: randomInt(rng, RECRUIT_MIN_LEVEL_GATE, ceiling) };
}

/**
 * A standout's doors: all four, every night, no open-door roll.
 *
 * The notoriety floor is the middle of the band rather than its bottom, because a standout asking
 * the softest rank in the game would be a standout anybody could sign on their first night, and the
 * whole point of the seat is that it is something to work towards. The level door is rolled against
 * the city the same way the ordinary one is, so a room scaled up by a mature city asks for a crew
 * that city could actually have produced.
 */
function rollStandoutRequirement(rng: Rng, cityLevel: number): JoinRequirement {
  const floor = Math.ceil((RECRUIT_MIN_NOTORIETY_GATE + RECRUIT_MAX_MIN_NOTORIETY) / 2);
  const ceiling = Math.min(RECRUIT_MAX_MIN_LEVEL, Math.max(RECRUIT_MIN_LEVEL_GATE, cityLevel));
  return {
    /*
     * §D7: up to `Feared`, not up to `Marked` (maintainer, 2026-09-16).
     *
     * The ordinary room tops out at `RECRUIT_MAX_MIN_NOTORIETY`, and the standout seats used to
     * stop at the same rank, which meant the best two people in the city were available to a crew
     * that had bought five rungs of a fourteen-rung ladder. Past that rank nothing in the game
     * asked for anything at all, so the top half was a word on a chip. These two chairs are the
     * strongest sheets the Bar ever draws and they are the right thing to put behind it: the
     * ceiling is what a rank *buys*, and the floor is unchanged so a standout is still something
     * a mid-game crew can reach for.
     */
    minNotoriety: randomInt(rng, floor, RECRUIT_LEGEND_NOTORIETY),
    minLevel: randomInt(rng, RECRUIT_MIN_LEVEL_GATE, ceiling),
    minInfamy: randomInt(rng, RECRUIT_MIN_INFAMY_GATE, RECRUIT_MAX_MIN_INFAMY),
    minFactionInfamy: randomInt(
      rng,
      RECRUIT_MIN_FACTION_INFAMY_GATE,
      RECRUIT_MAX_MIN_FACTION_INFAMY,
    ),
  };
}

/** A character on the roster, before any particular crew is judged against them. */
export interface BarCharacter {
  id: string;
  name: string;
  attributes: Attributes;
  perks: string[];
  requirement: JoinRequirement;
}

/**
 * The recruit sitting in seat `index` of `day`'s roster.
 *
 * Two independent seeds on purpose. `generateCharacter` consumes a whole rng stream and its draw
 * order is W1's to change; drawing the name and disposition from a *separate* stream means a
 * retune of the attribute roll cannot silently rename everyone.
 */
/**
 * What a city's room is seeded off, so two cities are not the same eight people (2026-09-17).
 *
 * Empty for the default city, which keeps Ashfall's room exactly the room it has always been: every
 * fixture, screenshot and pinned recruit id in the suite is Ashfall's, and a prefix on all of them
 * would have rewritten the whole Bar to add a door nobody can walk through yet.
 */
function roomKey(cityId: string): string {
  return cityId === DEFAULT_CITY_ID ? '' : `${cityId}:`;
}

function recruitAt(day: string, index: number, cityLevel: number, cityId: string): BarCharacter {
  const room = roomKey(cityId);
  const standout = isStandoutSeat(index);
  // The standout seats are the top of the ladder outright and do not draw a grade: what they are
  // is the whole reason those two chairs exist.
  const grade = gradeOf(seedFrom(`${room}${day}:${index}:${SEAT_GENERATION}:grade`));
  const calibre = standout
    ? barCalibre(cityLevel) + STANDOUT_CALIBRE_LIFT
    : barCalibre(cityLevel) + grade.calibre;
  const { attributes, perks } = generateCharacter(
    seedFrom(`${room}${day}:${index}:${SEAT_GENERATION}:sheet`),
    Math.min(MAX_CALIBRE, Math.max(MIN_CALIBRE, calibre)),
    standout ? STANDOUT_ROLL : ORDINARY_ROLL,
  );
  const rng = createRng(seedFrom(`${room}${day}:${index}:${SEAT_GENERATION}:disposition`));
  const openDoor = index < BAR_OPEN_DOOR_FLOOR;

  return {
    id: recruitId(day, index, cityId),
    name: rollName(rng),
    attributes,
    perks,
    requirement: standout
      ? rollStandoutRequirement(rng, cityLevel)
      : openDoor
        ? { minNotoriety: 0, minLevel: 1, minInfamy: 0, minFactionInfamy: 0 }
        : rollRequirement(rng, cityLevel, grade, perks),
  };
}

/**
 * City levels per attribute point the room gains.
 *
 * Three, so a city averaging level thirty puts about ten points on every mean, which is where
 * `MAX_CALIBRE` caps it: the ceiling is reached by a city that is genuinely mature rather than by
 * one good player. Below level three it is zero and the first night's Bar is the Bar the game was
 * balanced on.
 */
export const CITY_LEVELS_PER_CALIBRE = 3;

export function barCalibre(cityLevel: number): number {
  return Math.min(MAX_CALIBRE, Math.max(0, Math.floor(cityLevel / CITY_LEVELS_PER_CALIBRE)));
}

/**
 * The id grammar, authored here and nowhere else.
 *
 * The trailing zero is {@link SEAT_GENERATION}. It is still in the grammar because ids from before
 * the auction are stored in the signing log and would otherwise stop parsing, and because a bid
 * carries this string across a midnight boundary: an id has to name a day and a seat for ever.
 */
/**
 * The id a seat's recruit is known by, which is also the id a bid is filed under.
 *
 * The city belongs in it for that second reason: two rooms on the same day would otherwise mint the
 * same eight ids, and a bid placed in one city would be a bid on a different person in another.
 * Ashfall's ids are unprefixed, so the ones already in the table still name the seats they were
 * placed on. See `roomKey`.
 */
export function recruitId(day: string, index: number, cityId: string = DEFAULT_CITY_ID): string {
  return `bar-${roomKey(cityId)}${day}-${index}-${SEAT_GENERATION}`;
}

/** §H2: the whole room for one game day, in one city. */
export function barRoster(
  day: string,
  seats: number = BAR_ROSTER_SIZE,
  cityLevel = 0,
  cityId: string = DEFAULT_CITY_ID,
): BarCharacter[] {
  return Array.from({ length: Math.max(BAR_ROSTER_SIZE, seats) }, (_, index) =>
    recruitAt(day, index, cityLevel, cityId),
  );
}

/**
 * §F2: how many extra seats a well-known crew fills.
 *
 * Extra seats are *added* to the eight, never substituted for them: the room a crew with no
 * reputation walks into is the same room it always was, so a Charisma bonus cannot quietly change
 * who is in seat three. Rounded down and capped, because the Bar is a room and not a job fair.
 */
export const MAX_EXTRA_BAR_SEATS = 4;
export const RECRUIT_POOL_PERCENT_PER_SEAT = 15;

export function barSeatsFor(recruitPoolPercent: number): number {
  const extra = Math.floor(Math.max(0, recruitPoolPercent) / RECRUIT_POOL_PERCENT_PER_SEAT);
  return BAR_ROSTER_SIZE + Math.min(MAX_EXTRA_BAR_SEATS, extra);
}

/**
 * Which seat this recruit id names, or `null` when it names none of `day`'s.
 *
 * Parsed rather than searched, because a table settled the morning after has to be rebuilt from
 * its id alone: the room it sat in is a day old and nothing stored it.
 */
export function seatOf(day: string, id: string): number | null {
  const match = new RegExp(`^bar-${day}-(\\d+)-(\\d+)$`).exec(id);
  const seat = match?.[1];
  return seat === undefined ? null : Number(seat);
}

/**
 * The one recruit with this id in `day`'s room, or `undefined` when the id names nobody in it.
 *
 * ## `cityLevel` is not optional in practice
 *
 * It defaults to 0 for the same reason `barRoster`'s does, and every caller resolving somebody a
 * player is about to bid on or sign must pass the real one. The roster route passed the city's
 * average level and the hire and negotiate routes did not, so the sheet on the card and the sheet
 * on the contract were generated at two different calibres: a player at a mature Bar was shown a
 * strong recruit and handed the level-1 version of them. The seed grammar makes that silent, since
 * both are legitimate people with the same id.
 */
export function findBarRecruit(
  day: string,
  recruitId: string,
  seats: number = BAR_ROSTER_SIZE,
  cityLevel = 0,
): BarCharacter | undefined {
  return barRoster(day, seats, cityLevel).find((recruit) => recruit.id === recruitId);
}
