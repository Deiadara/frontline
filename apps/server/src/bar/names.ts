import { randomInt, type Rng } from '../characters/rng.js';

/**
 * Names for the Bar's roster (GDD §H1).
 *
 * Flavour only — a name is never read by a mechanic. It lives server-side with the rest of roster
 * generation so the whole roster stays one pure function of the UTC date (§H2a).
 */

const GIVEN_NAMES = [
  'Iris',
  'Ren',
  'Odile',
  'Cassius',
  'Mira',
  'Tobias',
  'Yuen',
  'Dorotea',
  'Kestrel',
  'Amara',
  'Silas',
  'Nadia',
  'Emeric',
  'Juno',
  'Rashid',
  'Ilse',
  'Bruno',
  'Wren',
  'Osric',
  'Lupe',
  'Hadley',
  'Zoya',
  'Marcus',
  'Ines',
] as const;

const FAMILY_NAMES = [
  'Vale',
  'Kaido',
  'Marchetti',
  'Oyelaran',
  'Strand',
  'Petrosyan',
  'Bequer',
  'Nkemdi',
  'Halloran',
  'Voskuijlen',
  'Adeyemi',
  'Cortázar',
  'Rask',
  'Fontaine',
  'Duman',
  'Weiss',
  'Okonkwo',
  'Lindqvist',
  'Abara',
  'Ferreira',
  'Tanaka',
  'Salvatierra',
  'Grieve',
  'Mbeki',
] as const;

/**
 * Street handles, used in place of a family name now and then. The Bar is a room full of people
 * who mostly do not give their real names.
 */
const HANDLES = [
  'the Ledger',
  'Nine Lives',
  'Sunday',
  'the Undergrid Ghost',
  'Off-Grid',
  'Cold Start',
  'the Quiet Hour',
  'Dropout',
  'the Long Way',
  'Ash',
  'Second Shift',
  'the Last Word',
] as const;

/** How often a recruit goes by a handle rather than a surname. */
const HANDLE_CHANCE = 0.25;

function pick<T>(rng: Rng, items: readonly T[]): T {
  const chosen = items[randomInt(rng, 0, items.length - 1)];
  if (chosen === undefined) throw new Error('cannot pick from an empty name list');
  return chosen;
}

/** One name. Same rng state, same name — the roster has to be reproducible (§H2a). */
export function rollName(rng: Rng): string {
  const given = pick(rng, GIVEN_NAMES);
  if (rng() < HANDLE_CHANCE) return `${given} "${pick(rng, HANDLES)}"`;
  return `${given} ${pick(rng, FAMILY_NAMES)}`;
}
