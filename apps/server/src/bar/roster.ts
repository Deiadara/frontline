import {
  BAR_HIRES_PER_DAY,
  RECRUIT_MAX_MIN_LEVEL,
  RECRUIT_MAX_MIN_NOTORIETY,
  RECRUIT_MIN_LEVEL_GATE,
  RECRUIT_MIN_NOTORIETY_GATE,
  type Attributes,
  seedFrom,
  type JoinRequirement,
  GAME_TIMEZONE,
  dayInZone,
} from '@frontline/shared';
import { MAX_CALIBRE, generateCharacter } from '../characters/generate.js';
import { createRng, randomInt, type Rng } from '../characters/rng.js';
import { rollName } from './names.js';

export { BAR_HIRES_PER_DAY };

/**
 * The Bar's shared roster (GDD §H1, §H2, §H2a, §H2b).
 *
 * §H2 makes this "the same for every player": one room, not a private roll per account. It is still
 * a pure function with no roster table and no scheduled job: what it is a function *of* is now the
 * UTC date **and** the per-seat turnover counts, because the room is no longer read-only.
 *
 * Hiring somebody takes them out of the room for everybody, and the seat immediately produces
 * somebody else (§H2b). That is what `generation` is: how many people have already been hired out
 * of this seat today. It goes into the seed, so seat 3's second occupant is a different person from
 * their first, deterministically, and every player sees the same replacement.
 *
 * Note what is *not* generated here: a role. A character at the Bar has not been hired into
 * anything yet (§C2), and the affinity that shaped their sheet is dropped by `generateCharacter`
 * on the way out (§B8a, INTERFACES R4), which is why this module calls that and never
 * `rollRecruit`.
 */

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

/** §H2a: the game date a roster is generated from, `YYYY-MM-DD`. Athens, not UTC. */
export function barDay(now: Date, zone: string = GAME_TIMEZONE): string {
  return dayInZone(now, zone);
}

/**
 * §H3: what this character asks of a crew. Most people at the Bar will talk to anyone; the rest
 * want a name that has already been heard, and a few want both that and a crew that has lasted.
 *
 * The level door is rolled against the room's own calibre rather than out of thin air: a room
 * scaled up by a level-thirty city asks for a level-thirty crew, so the good ones that turn up
 * late are gated at something a crew playing that city has actually reached.
 */
function rollRequirement(rng: Rng, cityLevel: number): JoinRequirement {
  if (rng() < OPEN_DOOR_CHANCE) return { minNotoriety: 0, minLevel: 1 };
  const minNotoriety = randomInt(rng, RECRUIT_MIN_NOTORIETY_GATE, RECRUIT_MAX_MIN_NOTORIETY);
  if (rng() >= BOTH_DOORS_CHANCE) return { minNotoriety, minLevel: 1 };
  const ceiling = Math.min(RECRUIT_MAX_MIN_LEVEL, Math.max(RECRUIT_MIN_LEVEL_GATE, cityLevel));
  return { minNotoriety, minLevel: randomInt(rng, RECRUIT_MIN_LEVEL_GATE, ceiling) };
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
 * The recruit sitting in seat `index` of `day`'s roster, after `generation` people have already
 * been hired out of that seat.
 *
 * Two independent seeds on purpose. `generateCharacter` consumes a whole rng stream and its draw
 * order is W1's to change; drawing the name and disposition from a *separate* stream means a
 * retune of the attribute roll cannot silently rename everyone. Both carry the generation, so a
 * seat's replacement differs on every axis rather than being the same person under a new name.
 */
function recruitAt(
  day: string,
  index: number,
  generation: number,
  cityLevel: number,
): BarCharacter {
  const { attributes, perks } = generateCharacter(
    seedFrom(`${day}:${index}:${generation}:sheet`),
    barCalibre(cityLevel),
  );
  const rng = createRng(seedFrom(`${day}:${index}:${generation}:disposition`));
  const openDoor = index < BAR_OPEN_DOOR_FLOOR;

  return {
    id: recruitId(day, index, generation),
    name: rollName(rng),
    attributes,
    perks,
    requirement: openDoor ? { minNotoriety: 0, minLevel: 1 } : rollRequirement(rng, cityLevel),
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
 * The generation is *in* the id, which is what makes a stale tab safe: an id naming a generation
 * the seat has moved past cannot be found on the current roster, so hiring somebody who has
 * already left with somebody else fails with "not at the Bar today" rather than signing the
 * replacement by accident.
 */
export function recruitId(day: string, index: number, generation: number): string {
  return `bar-${day}-${index}-${generation}`;
}

/**
 * §H2: the whole room for a UTC day, given how far each seat has turned over.
 *
 * `generations` is indexed by seat; a short or missing entry reads as an untouched seat, so a
 * caller that has not written a single row yet gets exactly the roster §H2a always produced.
 */
export function barRoster(
  day: string,
  generations: readonly number[] = [],
  seats: number = BAR_ROSTER_SIZE,
  cityLevel = 0,
): BarCharacter[] {
  return Array.from({ length: Math.max(BAR_ROSTER_SIZE, seats) }, (_, index) =>
    recruitAt(day, index, generations[index] ?? 0, cityLevel),
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
 * Parsed rather than searched, because the caller needs the seat number in order to turn that seat
 * over, and it needs it for an id it has already matched against the live roster, so there is
 * nothing left to validate here beyond the grammar itself.
 */
export function seatOf(day: string, id: string): number | null {
  const match = new RegExp(`^bar-${day}-(\\d+)-(\\d+)$`).exec(id);
  const seat = match?.[1];
  return seat === undefined ? null : Number(seat);
}

/**
 * The one recruit with this id in the room right now, or `undefined`.
 *
 * `undefined` covers both "no such seat" and "that seat has moved on", and the caller wants the
 * same answer for both: the person named is not here.
 *
 * ## `cityLevel` is not optional in practice
 *
 * It defaults to 0 for the same reason `barRoster`'s does, and every caller that resolves somebody
 * a player is about to *sign* must pass the real one. The roster route was passing the city's
 * average level and the hire and negotiate routes were not, so the sheet on the card and the sheet
 * on the contract were generated at two different calibres: a player at a mature Bar was shown a
 * strong recruit and handed the level-1 version of them. The seed grammar makes that silent, since
 * both are legitimate people with the same id.
 */
export function findBarRecruit(
  day: string,
  recruitId: string,
  generations: readonly number[] = [],
  seats: number = BAR_ROSTER_SIZE,
  cityLevel = 0,
): BarCharacter | undefined {
  return barRoster(day, generations, seats, cityLevel).find((recruit) => recruit.id === recruitId);
}
