import {
  RECRUIT_MAX_MIN_FACTION_INFAMY,
  RECRUIT_MAX_MIN_INFAMY,
  DEFAULT_CITY_ID,
  RECRUIT_MAX_MIN_NOTORIETY,
  perksWorth,
  RECRUIT_MIN_FACTION_INFAMY_GATE,
  RECRUIT_MIN_INFAMY_GATE,
  RECRUIT_LEGEND_NOTORIETY,
  RECRUIT_MIN_NOTORIETY_GATE,
  type Attributes,
  seedFrom,
  type JoinRequirement,
  GAME_TIMEZONE,
  dayInZone,
  MAX_NOTORIETY,
  crewStanding,
  flatRoom,
  type RoomCrew,
  type RoomProfile,
} from '@frontline/shared';
import {
  EARLY_ROOM_CALIBRE,
  MAX_CALIBRE,
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

/**
 * How many of the day's recruits any crew can always approach: no §H3 gate at all.
 *
 * A brand-new crew has rank `Nobody`, an empty wallet and no faction, so every rolled gate is shut
 * to them, and a Bar that is empty on the day a player first opens it reads as a broken screen
 * rather than as a locked door. Three is a choice rather than a correctness floor: one would be
 * safe, and three is what makes the first night's room worth reading.
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
 * above the room, guaranteed a couple of perks, and behind all three §H3 doors including the
 * faction's, the one that is not about the player alone.
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
 * somebody who has been somewhere. It is added to the city's own calibre, and the recruitment
 * ceiling climbs with the calibre of the roll (`recruitmentCeiling`), so the two chairs keep their
 * lead at every city level. They used to lose it past city level twelve, when the room reached the
 * old flat ceiling of 40 and the lift clamped away. `MAX_CALIBRE` leaves room for it on top of
 * `MAX_ROOM_CALIBRE`.
 */
export const STANDOUT_CALIBRE_LIFT = 6;

/** ...and the perks they are guaranteed, which the ordinary roll gives about one in five. */
export const STANDOUT_MIN_PERKS = 2;

/**
 * What makes a standout better than a lucky ordinary roll at the same calibre.
 *
 * Written when the room clamped at the old flat ceiling and `STANDOUT_CALIBRE_LIFT` did nothing in
 * a mature city (measured at city level 30: 989 sheet points against 986). The ceiling climbs now,
 * but these still shape the sheet: more of it is lifted and none of it is pulled down, so a
 * standout is better at more things without any single attribute passing the ceiling of its roll.
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
   * `STANDOUT_EXTRA_STRENGTHS`: attributes are trainable and clamped, so two sheets at the same
   * ceiling converge, while a tag is permanent and there is no ceiling on how good one is.
   * A standout carrying two tags off the rich draw is a different object from the room around it in
   * the one way a player cannot erase with a month at the training floor.
   */
  perkDraw: 'rich',
};

/**
 * Who each chair is pitched at (maintainer, 2026-09-28).
 *
 * "If 3 players are max level and one is a beginner have an officer appear for him as well, so make
 * it so that 2 officers appear for outliers (1 for the lowest and 1 for the highest) and the rest
 * appear based on the average with some deviation." The eight base seats are:
 *
 * - seat 0, **low**: pitched at the weakest crew with a stake in the city, with an open door, so a
 *   beginner in a finished city has somebody they can clear and afford;
 * - seats 1 to 4 and every seat a widened room adds, **average**: the city's weighted middle with
 *   the grade ladder's spread up and down, the first two with open doors;
 * - seat 5, **high**: pitched at the strongest crew, behind a rank at or just under theirs, so it
 *   is something they would want and a real ask of them;
 * - seats 6 and 7, **standout**: above the average, behind all three doors, which climb with the
 *   city's average rank.
 *
 * Fixed indices for the reason `BAR_STANDOUT_SEATS` gives.
 */
export type SeatKind = 'low' | 'average' | 'high' | 'standout';

export const LOW_SEAT = 0;
export const HIGH_SEAT = BAR_ROSTER_SIZE - BAR_STANDOUT_SEATS - 1;

export function seatKindOf(index: number): SeatKind {
  if (index === LOW_SEAT) return 'low';
  if (index === HIGH_SEAT) return 'high';
  if (index >= BAR_ROSTER_SIZE - BAR_STANDOUT_SEATS && index < BAR_ROSTER_SIZE) return 'standout';
  return 'average';
}

/** Whether seat `index` is one of the two the good ones sit in. */
export function isStandoutSeat(index: number): boolean {
  return seatKindOf(index) === 'standout';
}

/**
 * How far above the strongest crew's own level the high seat is rolled, in attribute points.
 *
 * Between the `steady` and `seasoned` grades: the seat exists to be worth that crew's while, and it
 * does not draw a grade because a green sheet behind the best crew's rank is a card nobody takes.
 */
export const HIGH_SEAT_CALIBRE_LIFT = 3;

/** How far under the strongest crew's rank the high seat's door may sit. */
export const HIGH_SEAT_RANK_SLACK = 1;

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
   * roll.
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

/**
 * How many rungs the whole ordinary door ladder climbs in a city whose average crew is past
 * `Marked` (maintainer, 2026-09-28: doors scale with the room).
 *
 * Zero until then, so a young city asks what it always asked. Past it the ladder moves up one rung
 * per rung of the average, top and grades together: in a city whose crews are mostly `Scourge`,
 * a door at `Unknown` is no door, and the average seats would all be open to everybody.
 */
export function roomRankShift(averageRank: number): number {
  return Math.max(0, Math.round(averageRank) - RECRUIT_MAX_MIN_NOTORIETY);
}

/** How high this person may ask, sheet and tags together, bounded by the room's own top rung. */
export function doorCeilingFor(
  grade: RecruitGrade,
  perks: readonly string[],
  averageRank = 0,
): number {
  const lift = Math.floor(perksWorth(perks) / WORTH_PER_DOOR_RUNG);
  const shift = roomRankShift(averageRank);
  return Math.min(RECRUIT_MAX_MIN_NOTORIETY + shift, grade.maxNotoriety + lift + shift);
}

/**
 * §H3: what this character asks of a crew. Most people at the Bar will talk to anyone; the rest
 * want a name that has already been heard. The level door that sometimes rode on the rank went on
 * 2026-09-28 (maintainer): the rank is the one door the ordinary room asks about.
 */
function rollRequirement(
  rng: Rng,
  grade: RecruitGrade,
  perks: readonly string[],
  averageRank: number,
): JoinRequirement {
  // Everything shut off. The two wide doors belong to the standout seats and are written out
  // rather than defaulted, so a reader of this function can see that it does not roll them.
  const open: JoinRequirement = {
    minNotoriety: 0,
    minInfamy: 0,
    minFactionInfamy: 0,
  };
  // Somebody with nothing to offer is in no position to ask. The grade decides how high they can
  // reach, which is what keeps the sheet and the door on a card telling the same story, and the
  // tags they carry lift that ceiling: see `doorCeilingFor`.
  const ceilingRank = doorCeilingFor(grade, perks, averageRank);
  if (ceilingRank < RECRUIT_MIN_NOTORIETY_GATE) return open;
  if (rng() < OPEN_DOOR_CHANCE) return open;
  return { ...open, minNotoriety: randomInt(rng, RECRUIT_MIN_NOTORIETY_GATE, ceilingRank) };
}

/**
 * How much harder a standout's two wallet doors get per rung of the city's average rank.
 *
 * A tenth, so a city whose crews average `Street Devil` (rank ten) asks twice what a new city asks,
 * which tops the wallet door out near 5,000. It was a fifth until the 2026-09-28 retune moved the
 * ranks onto the infamy a crew earns: a rank-ten crew has spent most of what it earned on those ten
 * rungs, so its wallet is nearer 5,000 than the 25,000 the old bands assumed.
 */
export const STANDOUT_INFAMY_PERCENT_PER_RANK = 10;

/** How many rungs above the city's average rank a standout's door may reach. */
export const STANDOUT_RANK_REACH = 3;

/** The softest rank a standout ever asks: the middle of the ordinary band. */
const STANDOUT_RANK_FLOOR = Math.ceil((RECRUIT_MIN_NOTORIETY_GATE + RECRUIT_MAX_MIN_NOTORIETY) / 2);

/**
 * The rank band a standout's door is rolled in, for a city whose crews average `averageRank` and
 * whose strongest crew stands at `highestRank`.
 *
 * The top never sits more than one rung past the strongest crew in town. Late in the game a rung
 * is weeks of infamy, so a door three rungs past everybody would be a chair nobody in the city can
 * sign before the roster turns over.
 */
export function standoutRankBand(
  averageRank: number,
  highestRank: number,
): { floor: number; top: number } {
  const average = Math.round(averageRank);
  const reach = Math.min(average + STANDOUT_RANK_REACH, Math.round(highestRank) + 1);
  return {
    floor: Math.min(MAX_NOTORIETY, Math.max(STANDOUT_RANK_FLOOR, average)),
    top: Math.min(MAX_NOTORIETY, Math.max(RECRUIT_LEGEND_NOTORIETY, reach)),
  };
}

/** What the wallet doors are multiplied by, for a city whose crews average `averageRank`. */
function standoutInfamyScale(averageRank: number): number {
  return 1 + (Math.max(0, Math.round(averageRank)) * STANDOUT_INFAMY_PERCENT_PER_RANK) / 100;
}

/**
 * A standout's doors: all three, every night, no open-door roll.
 *
 * The notoriety floor is the middle of the band rather than its bottom, because a standout asking
 * the softest rank in the game would be a standout anybody could sign on their first night, and the
 * whole point of the seat is that it is something to work towards. In a city whose average crew is
 * already past that, the floor is the average itself (`standoutRankBand`).
 */
function rollStandoutRequirement(
  rng: Rng,
  averageRank: number,
  highestRank: number,
): JoinRequirement {
  const { floor, top } = standoutRankBand(averageRank, highestRank);
  const scale = standoutInfamyScale(averageRank);
  const scaled = (value: number) => Math.round(value * scale);
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
    minNotoriety: randomInt(rng, floor, top),
    minInfamy: randomInt(rng, scaled(RECRUIT_MIN_INFAMY_GATE), scaled(RECRUIT_MAX_MIN_INFAMY)),
    minFactionInfamy: randomInt(
      rng,
      scaled(RECRUIT_MIN_FACTION_INFAMY_GATE),
      scaled(RECRUIT_MAX_MIN_FACTION_INFAMY),
    ),
  };
}

/**
 * The high seat's door: the strongest crew's own rank, or one under it.
 *
 * Only the rank. The wallet and the badge are what make a standout a standout, and this seat is
 * about one crew, so it asks the one thing that crew can see on its own HUD. A top crew still at
 * `Nobody` gets an open door: there is nothing to ask of it yet.
 */
function rollHighSeatRequirement(rng: Rng, highestRank: number): JoinRequirement {
  const open: JoinRequirement = { minNotoriety: 0, minInfamy: 0, minFactionInfamy: 0 };
  const rank = Math.min(MAX_NOTORIETY, Math.round(highestRank));
  if (rank < RECRUIT_MIN_NOTORIETY_GATE) return open;
  const floor = Math.max(RECRUIT_MIN_NOTORIETY_GATE, rank - HIGH_SEAT_RANK_SLACK);
  return { ...open, minNotoriety: randomInt(rng, floor, rank) };
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

/** The calibre a crew standing where `crew` stands pours a room at. */
function calibreOfCrew(crew: RoomCrew): number {
  return barCalibre(crewStanding(crew.level, crew.notoriety));
}

/**
 * How good the person in this chair is rolled, against the part of the city the chair is for.
 *
 * The standout and high seats do not draw a grade: what they are is the whole reason those chairs
 * exist. The low seat does, so a beginner's chair has the same spread a young city's room has.
 */
function seatCalibre(kind: SeatKind, grade: RecruitGrade, room: RoomProfile): number {
  switch (kind) {
    case 'low':
      return calibreOfCrew(room.lowest) + grade.calibre;
    case 'high':
      return calibreOfCrew(room.highest) + HIGH_SEAT_CALIBRE_LIFT;
    case 'standout':
      return calibreOfCrew(room.average) + STANDOUT_CALIBRE_LIFT;
    case 'average':
      return calibreOfCrew(room.average) + grade.calibre;
  }
}

const OPEN_DOOR: JoinRequirement = { minNotoriety: 0, minInfamy: 0, minFactionInfamy: 0 };

function seatRequirement(
  kind: SeatKind,
  index: number,
  rng: Rng,
  sheet: { grade: RecruitGrade; perks: readonly string[] },
  room: RoomProfile,
): JoinRequirement {
  if (kind === 'standout') {
    return rollStandoutRequirement(rng, room.average.notoriety, room.highest.notoriety);
  }
  if (kind === 'high') return rollHighSeatRequirement(rng, room.highest.notoriety);
  // The low seat is always inside the open floor: it is the chair a beginner has to be able to use.
  if (kind === 'low' || index < BAR_OPEN_DOOR_FLOOR) return { ...OPEN_DOOR };
  return rollRequirement(rng, sheet.grade, sheet.perks, room.average.notoriety);
}

function recruitAt(day: string, index: number, room: RoomProfile, cityId: string): BarCharacter {
  const key = roomKey(cityId);
  const kind = seatKindOf(index);
  const grade = gradeOf(seedFrom(`${key}${day}:${index}:${SEAT_GENERATION}:grade`));
  const { attributes, perks } = generateCharacter(
    seedFrom(`${key}${day}:${index}:${SEAT_GENERATION}:sheet`),
    seatCalibre(kind, grade, room),
    kind === 'standout' ? STANDOUT_ROLL : ORDINARY_ROLL,
  );
  const rng = createRng(seedFrom(`${key}${day}:${index}:${SEAT_GENERATION}:disposition`));

  return {
    id: recruitId(day, index, cityId),
    name: rollName(rng),
    attributes,
    perks,
    requirement: seatRequirement(kind, index, rng, { grade, perks }, room),
  };
}

/**
 * Standing per attribute point the room gains, in the early game.
 *
 * Standing is `crewStanding`: a level, plus two for every rung of the notoriety ladder. Three, so a
 * city standing at thirty puts ten points on every mean, which is `EARLY_ROOM_CALIBRE`, where the
 * whole Bar used to stop. Below standing three it is zero and the first night's Bar is the Bar the
 * game was balanced on.
 */
export const CITY_LEVELS_PER_CALIBRE = 3;

/** The standing the early slope runs to: where the old room stopped. */
export const EARLY_ROOM_STANDING = EARLY_ROOM_CALIBRE * CITY_LEVELS_PER_CALIBRE;

/**
 * The standing at which the room tops out (maintainer, 2026-09-28).
 *
 * A hundred and ten is a crew at level ninety that has bought ten rungs, which is where an active
 * player stands around day seventy-five. The room climbs in a straight line from
 * `EARLY_ROOM_STANDING` to here, so every level of the late game still buys a better Bar rather
 * than saturating at thirty the way it used to.
 */
export const LATE_ROOM_STANDING = 110;

/** The most calibre a room gives its ordinary seats. The standouts' lift is on top of it. */
export const MAX_ROOM_CALIBRE = MAX_CALIBRE - STANDOUT_CALIBRE_LIFT;

/** The calibre a room is poured at for a crew of this standing. */
export function barCalibre(standing: number): number {
  if (standing <= EARLY_ROOM_STANDING) {
    return Math.max(0, Math.floor(standing / CITY_LEVELS_PER_CALIBRE));
  }
  const climbed = (standing - EARLY_ROOM_STANDING) / (LATE_ROOM_STANDING - EARLY_ROOM_STANDING);
  return Math.min(
    MAX_ROOM_CALIBRE,
    Math.floor(EARLY_ROOM_CALIBRE + climbed * (MAX_ROOM_CALIBRE - EARLY_ROOM_CALIBRE)),
  );
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

/**
 * §H2: the whole room for one game day, in one city.
 *
 * `room` is the day's frozen profile (`bar/room.ts`). A bare number is a flat room where every crew
 * stands at that level with no rank, which is the shape the distribution tests and the progression
 * sim read.
 */
export function barRoster(
  day: string,
  seats: number = BAR_ROSTER_SIZE,
  room: RoomProfile | number = 0,
  cityId: string = DEFAULT_CITY_ID,
): BarCharacter[] {
  const profile = typeof room === 'number' ? flatRoom(room) : room;
  return Array.from({ length: Math.max(BAR_ROSTER_SIZE, seats) }, (_, index) =>
    recruitAt(day, index, profile, cityId),
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
 * The three things a recruit id names: the room it was minted in, the day, and the seat.
 *
 * Parsed rather than searched, because a table settled the morning after has to be rebuilt from
 * its id alone: the room it sat in is a day old and nothing stored it. That is also why the city
 * has to come back out of the string. The first version of this matched `bar-<day>-<seat>-<gen>`
 * with the day interpolated into the pattern, which cannot match an away room's
 * `bar-terminus:<day>-<seat>-<gen>` at all: every away table settled as an empty table with no
 * winner and no name, for ever, because the close could not rebuild the person it was about.
 *
 * A city id is a slug and can never contain a colon (`city/atlas.ts`), which is what makes the
 * optional prefix unambiguous against Ashfall's unprefixed ids.
 */
export interface RecruitIdParts {
  cityId: string;
  day: string;
  seat: number;
}

const RECRUIT_ID_PATTERN = /^bar-(?:([^:]+):)?(\d{4}-\d{2}-\d{2})-(\d+)-(\d+)$/;

export function parseRecruitId(id: string): RecruitIdParts | null {
  const match = RECRUIT_ID_PATTERN.exec(id);
  if (match === null) return null;
  const [, city, day, seat] = match;
  if (day === undefined || seat === undefined) return null;
  return { cityId: city ?? DEFAULT_CITY_ID, day, seat: Number(seat) };
}

/** Which city's room this id was minted in, or `null` when it is not a recruit id at all. */
export function cityOfRecruit(id: string): string | null {
  return parseRecruitId(id)?.cityId ?? null;
}

/** Which seat this recruit id names, or `null` when it names none of `day`'s. */
export function seatOf(day: string, id: string): number | null {
  const parts = parseRecruitId(id);
  return parts !== null && parts.day === day ? parts.seat : null;
}

/**
 * The one recruit with this id in `day`'s room, or `undefined` when the id names nobody in it.
 *
 * ## The room comes out of the id
 *
 * Not out of an argument. This used to rebuild the default city's roster whatever room the id named,
 * so every away recruit was a 404 on the bid and seal routes: the ids the away room mints carry a
 * city prefix and nothing on Ashfall's roster ever matches one. An id names exactly one room, so
 * taking it from anywhere else is an argument a caller can get wrong.
 *
 * ## `room` is not optional in practice
 *
 * It defaults to an empty city for the same reason `barRoster`'s does, and every caller resolving
 * somebody a player is about to bid on or sign must pass the real one, which is
 * `barRoomOf(repos, cityId, day)` for the city the id names. The roster route passed the city's
 * weighted calibre and the bid routes passed the flat world average, so the sheet on the card and
 * the sheet on the contract were generated at two different calibres: a player at a mature Bar was
 * shown a strong recruit and handed the level-1 version of them. The seed grammar makes that
 * silent, since both are legitimate people with the same id.
 */
export function findBarRecruit(
  day: string,
  recruitId: string,
  seats: number = BAR_ROSTER_SIZE,
  room: RoomProfile | number = 0,
): BarCharacter | undefined {
  const cityId = cityOfRecruit(recruitId);
  if (cityId === null) return undefined;
  return barRoster(day, seats, room, cityId).find((recruit) => recruit.id === recruitId);
}
