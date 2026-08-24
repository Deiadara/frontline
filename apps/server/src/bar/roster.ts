import {
  AMBITIONS,
  MORAL_COMPASSES,
  BAR_HIRES_PER_DAY,
  RECRUIT_MAX_MIN_INFAMY,
  hearsAnyCrewOut,
  type Ambition,
  type Attributes,
  type JoinRequirement,
  type MoralCompass,
  type TraitId,
} from '@frontline/shared';
import { generateCharacter } from '../characters/generate.js';
import { createRng, randomInt, type Rng } from '../characters/rng.js';
import { rollName } from './names.js';

export { BAR_HIRES_PER_DAY };

/**
 * The Bar's shared roster (GDD §H1, §H2, §H2a, §H2b).
 *
 * §H2 makes this "the same for every player": one room, not a private roll per account. It is still
 * a pure function with no roster table and no scheduled job — what it is a function *of* is now the
 * UTC date **and** the per-seat turnover counts, because the room is no longer read-only.
 *
 * Hiring somebody takes them out of the room for everybody, and the seat immediately produces
 * somebody else (§H2b). That is what `generation` is: how many people have already been hired out
 * of this seat today. It goes into the seed, so seat 3's second occupant is a different person from
 * their first, deterministically, and every player sees the same replacement.
 *
 * Note what is *not* generated here: a role. A character at the Bar has not been hired into
 * anything yet (§C2), and the affinity that shaped their sheet is dropped by `generateCharacter`
 * on the way out (§B8a, INTERFACES R4) — which is why this module calls that and never
 * `rollRecruit`.
 */

/** How many people are drinking here on any given day. */
export const BAR_ROSTER_SIZE = 8;

/** Recruits whose §H3 gate is simply "anyone may approach me". */
const OPEN_DOOR_CHANCE = 0.6;
/** The lowest non-zero infamy gate worth rolling — below this it is not a gate at all. */
const MIN_INFAMY_GATE = 10;

/**
 * How many of the day's recruits any crew can always approach: no §H3 gate, and a disposition
 * whose two halves cannot object to the same reputation word, so §H4 cannot refuse them either.
 *
 * Both gates need the guarantee, and measuring is what showed it. Rolling §H3 independently
 * bottoms out at a single open door over 800 days (2026-08-13 is one of those days), and a *plain*
 * floor — one that forces §H3 but leaves the compass rolled — still left 1 day in 1200 where §H4
 * refused every survivor and a brand-new crew had nobody willing. Forcing the compass too (see
 * `recruitAt`) is what closed that: an open-door seat clears both gates by construction, so a Bar
 * that is empty on the day a player first opens it is unreachable for any floor >= 1.
 *
 * Which makes 3 a UX margin rather than the correctness floor — 1 would be safe. On the worst day
 * a brand-new crew sees exactly this many willing recruits (measured over 1200 days x every
 * reputation word), so what this constant sets is how much *choice* that day offers. Weigh it as
 * that.
 */
export const BAR_OPEN_DOOR_FLOOR = 3;

/** §H2a — the UTC date a roster is generated from, `YYYY-MM-DD`. */
export function barDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * FNV-1a over the seed string. Any stable string→int32 would do; what matters is that it depends
 * on nothing but its argument, so the same day yields the same roster on every process and host.
 */
function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const chosen = items[randomInt(rng, 0, items.length - 1)];
  if (chosen === undefined) throw new Error('cannot pick from an empty list');
  return chosen;
}

/**
 * §H3 — what this character asks of a crew. Most people at the Bar will talk to anyone; the rest
 * want a name that has already been heard.
 */
function rollRequirement(rng: Rng): JoinRequirement {
  if (rng() < OPEN_DOOR_CHANCE) return { minInfamy: 0 };
  return { minInfamy: randomInt(rng, MIN_INFAMY_GATE, RECRUIT_MAX_MIN_INFAMY) };
}

/** A character on the roster, before any particular crew is judged against them. */
export interface BarCharacter {
  id: string;
  name: string;
  attributes: Attributes;
  traits: TraitId[];
  ambition: Ambition;
  moralCompass: MoralCompass;
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
function recruitAt(day: string, index: number, generation: number): BarCharacter {
  const { attributes, traits } = generateCharacter(seedFrom(`${day}:${index}:${generation}:sheet`));
  const rng = createRng(seedFrom(`${day}:${index}:${generation}:disposition`));
  // The floor is a property of the *seat*, not of the person in it — otherwise the first three
  // hires of the day would close the only doors a new crew can walk through.
  const openDoor = index < BAR_OPEN_DOOR_FLOOR;

  const name = rollName(rng);
  const ambition = pick(rng, AMBITIONS);
  const drawn = pick(rng, MORAL_COMPASSES);

  return {
    id: recruitId(day, index, generation),
    name,
    attributes,
    traits,
    ambition,
    // An open-door seat keeps its rolled compass when that already clears §H4, and otherwise
    // takes the first one that does. Every ambition has at least one — asserted in the tests, so
    // a retune of either table that broke it could not land quietly.
    moralCompass:
      openDoor && !hearsAnyCrewOut({ ambition, moralCompass: drawn })
        ? compassThatHearsAnyoneOut(ambition)
        : drawn,
    requirement: openDoor ? { minInfamy: 0 } : rollRequirement(rng),
  };
}

function compassThatHearsAnyoneOut(ambition: Ambition): MoralCompass {
  const found = MORAL_COMPASSES.find((moralCompass) => hearsAnyCrewOut({ ambition, moralCompass }));
  if (!found) throw new Error(`no moral compass leaves ${ambition} able to hear any crew out`);
  return found;
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
 * §H2 — the whole room for a UTC day, given how far each seat has turned over.
 *
 * `generations` is indexed by seat; a short or missing entry reads as an untouched seat, so a
 * caller that has not written a single row yet gets exactly the roster §H2a always produced.
 */
export function barRoster(
  day: string,
  generations: readonly number[] = [],
  seats: number = BAR_ROSTER_SIZE,
): BarCharacter[] {
  return Array.from({ length: Math.max(BAR_ROSTER_SIZE, seats) }, (_, index) =>
    recruitAt(day, index, generations[index] ?? 0),
  );
}

/**
 * §F2 — how many extra seats a well-known crew fills.
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
 * over — and it needs it for an id it has already matched against the live roster, so there is
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
 */
export function findBarRecruit(
  day: string,
  recruitId: string,
  generations: readonly number[] = [],
  seats: number = BAR_ROSTER_SIZE,
): BarCharacter | undefined {
  return barRoster(day, generations, seats).find((recruit) => recruit.id === recruitId);
}
