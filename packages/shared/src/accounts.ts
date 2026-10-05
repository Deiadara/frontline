import { z } from 'zod';
import { GOVERNMENT } from './allegiance.js';
import { COMBINE_LEADERS } from './city/combine.js';
import { HOLDER_LABELS } from './city/control.js';
import { findUnit } from './units/catalog.js';

/**
 * The rules on what an account may be called and what it may use as a password (bug pass,
 * 2026-09-29, maintainer rulings on the onboarding entries).
 *
 * One module for both ends: the sign-up board and the settings screen refuse a bad value as it is
 * typed, and the server refuses the same value off the same function when a crafted request skips
 * the screen.
 */

// --- invisible characters ---

/**
 * Unicode's "other" category: controls, format characters (the zero-width space, the bidi
 * overrides, the soft hyphen), private use, surrogates and unassigned points. None of them is a
 * letter a reader sees, and the bidi ones reverse what the rest of the name reads as.
 */
const OTHER_CATEGORY = /\p{C}/gu;

/** A name with every {@link OTHER_CATEGORY} character taken out. */
export function withoutInvisibleCharacters(name: string): string {
  return name.replace(OTHER_CATEGORY, '');
}

// --- reserved names ---

/**
 * The seeded bots' usernames (`apps/server/src/seed/constants.ts`).
 *
 * Spelled out here because the seed is server code and this list has to reach the client too.
 * `seed/reserved-names.test.ts` pins that every bot the seed writes is on it, so a fifth bot
 * cannot be added without its name being reserved.
 */
export const SEEDED_BOT_USERNAMES = [
  'Vex_Holdings',
  'Sable_Ninth',
  'Sollen_Tam',
  'Halvard_Line',
] as const;

/** The house's own words: who runs the game rather than who plays it. */
const STAFF_WORDS = [
  'admin',
  'administrator',
  'system',
  'moderator',
  'mod',
  'staff',
  'frontline',
] as const;

/**
 * A name reduced to what a reader tells it apart by: case, spaces and the separators a username
 * may hold (`_`) or a display name may hold (`-`, `.`, spaces) are gone, so `Directive_Xero`,
 * `directive-xero` and `Directive Xero` are all `directivexero`.
 */
function reservedKey(name: string): string {
  return withoutInvisibleCharacters(name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_.-]+/g, '');
}

/**
 * Every name that would read as the game speaking (maintainer, 2026-09-29): the three Combine
 * leaders by id and by the name the unit sheet prints, the regime by every label the game gives
 * it, the staff words and the seeded bots. Built off the catalogue rather than typed, so a leader
 * renamed on the sheet is reserved under the new name without anybody remembering to come here.
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set(
  [
    ...COMBINE_LEADERS.flatMap((leader) => [
      leader.unitId,
      findUnit(leader.unitId)?.name ?? leader.unitId,
    ]),
    GOVERNMENT.name,
    GOVERNMENT.adjective,
    HOLDER_LABELS.government,
    'government',
    'regime',
    ...STAFF_WORDS,
    ...SEEDED_BOT_USERNAMES,
  ].map(reservedKey),
);

/** Whether a username or display name is one the game keeps for itself. */
export function isReservedName(name: string): boolean {
  return RESERVED_KEYS.has(reservedKey(name));
}

export const RESERVED_NAME_MESSAGE = 'That name belongs to the game. Pick another.';

// --- display names ---

export const DISPLAY_NAME_MAX = 32;

/**
 * A display name as a player sets it: the invisible characters stripped rather than refused, so a
 * name pasted with a stray zero-width space still saves, and then trimmed and bounded. A name that
 * was nothing but invisible characters is empty afterwards and refused like a blank one.
 *
 * Whether somebody else already goes by it needs the accounts table, so that half is the server's
 * (`routes/settings.ts`, through {@link sameDisplayName}).
 */
export const DisplayNameSchema = z
  .string()
  .transform(withoutInvisibleCharacters)
  .pipe(
    z
      .string()
      .trim()
      .min(1, 'A name needs at least one character that shows')
      .max(DISPLAY_NAME_MAX)
      .refine((name) => !isReservedName(name), RESERVED_NAME_MESSAGE),
  );

/**
 * Letters from other scripts that are drawn like a Latin one, and the Latin one they pass for.
 *
 * The common part of Unicode's confusables table that a name can be built from: Cyrillic and Greek
 * look-alikes, and the digits and bars that read as letters. Lower case only, because the skeleton
 * is folded first.
 */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  // Cyrillic
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ѕ: 's',
  і: 'i',
  ї: 'i',
  ј: 'j',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  һ: 'h',
  ӏ: 'l',
  ɡ: 'g',
  // Greek
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ω: 'w',
  ζ: 'z',
  μ: 'u',
  // Digits and bars
  '0': 'o',
  '1': 'l',
  '|': 'l',
  '!': 'l',
};

/**
 * What a name looks like, for telling two apart (maintainer, 2026-10-02): folded case, accents and
 * invisible characters gone, look-alike letters mapped to the Latin letter they pass for, and "rn"
 * read as the "m" it draws. Two names with one skeleton are one name to a reader, so the second is
 * refused.
 */
export function nameSkeleton(name: string): string {
  const folded = withoutInvisibleCharacters(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  return [...folded]
    .map((char) => LOOK_ALIKES[char] ?? char)
    .join('')
    .replace(/rn/g, 'm');
}

/**
 * Whether two names read the same, for a display name against another account's username or
 * display name: by their skeletons (`nameSkeleton`), so a look-alike of somebody's name is theirs.
 */
export function sameDisplayName(a: string, b: string): boolean {
  return nameSkeleton(a) === nameSkeleton(b);
}

export const DISPLAY_NAME_TAKEN_MESSAGE = 'Somebody already goes by that name. Pick another.';

// --- passwords ---

export const PASSWORD_MIN_CHARACTERS = 8;

/**
 * bcrypt reads the first 72 bytes of a password and ignores the rest (bug pass, 2026-09-29), so a
 * longer one was partly decoration: an account made with 72 `a`s and an `X` opened with 72 `a`s
 * and a `Y`. Capped at what is actually checked, in bytes rather than characters, because an
 * accented letter takes two and most symbols three or four.
 */
export const PASSWORD_MAX_BYTES = 72;

/**
 * The UTF-8 length, which is what bcrypt counts. Worked off the code points rather than through
 * `TextEncoder`, which this package's `lib` does not declare. A lone surrogate counts three, the
 * width of the replacement character an encoder writes in its place.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const PASSWORD_TOO_LONG_MESSAGE = `At most ${String(PASSWORD_MAX_BYTES)} bytes: an accented letter counts two, most symbols three or four.`;

/** A new password, at sign-up or on the settings screen. Signing in takes whatever was set. */
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_CHARACTERS)
  // A character is at least one byte, so this bounds the string before the byte count walks it.
  .max(PASSWORD_MAX_BYTES, PASSWORD_TOO_LONG_MESSAGE)
  .refine((password) => utf8Length(password) <= PASSWORD_MAX_BYTES, PASSWORD_TOO_LONG_MESSAGE);
