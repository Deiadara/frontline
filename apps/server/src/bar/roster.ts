import {
  AMBITIONS,
  MORAL_COMPASSES,
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

/**
 * The Bar's daily roster (GDD §H1, §H2, §H2a).
 *
 * §H2 makes this "the same for every player", and §H2a spells out the consequence: it is a pure
 * function of the UTC date. There is no roster table, no per-player roll, and no scheduled job
 * that refreshes anything — two accounts asking on the same UTC day compute the same eight people
 * because they run the same arithmetic on the same seed. INTERFACES R9 records that decision.
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
 * The recruit in slot `index` of `day`'s roster.
 *
 * Two independent seeds on purpose. `generateCharacter` consumes a whole rng stream and its draw
 * order is W1's to change; drawing the name and disposition from a *separate* stream means a
 * retune of the attribute roll cannot silently rename everyone.
 */
function recruitAt(day: string, index: number): BarCharacter {
  const { attributes, traits } = generateCharacter(seedFrom(`${day}:${index}:sheet`));
  const rng = createRng(seedFrom(`${day}:${index}:disposition`));
  const openDoor = index < BAR_OPEN_DOOR_FLOOR;

  const name = rollName(rng);
  const ambition = pick(rng, AMBITIONS);
  const drawn = pick(rng, MORAL_COMPASSES);

  return {
    id: `bar-${day}-${index}`,
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

/** §H2 — the whole roster for a UTC day. Identical for every player, every time it is asked. */
export function barRoster(day: string): BarCharacter[] {
  return Array.from({ length: BAR_ROSTER_SIZE }, (_, index) => recruitAt(day, index));
}

/** The one recruit with this id on `day`'s roster, or `undefined` if it names no slot of it. */
export function findBarRecruit(day: string, recruitId: string): BarCharacter | undefined {
  return barRoster(day).find((recruit) => recruit.id === recruitId);
}
