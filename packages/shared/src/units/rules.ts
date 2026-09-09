/**
 * The unit marks: the flags on a sheet that are **rules** rather than numbers.
 *
 * Its own module rather than a section of the catalogue, and the reason is an import cycle. A
 * location, a perk or a research rung can now *grant* a mark (`unit_mark` in `city/locations.ts`),
 * and the line the card prints for that has to name the mark. `units/catalog.ts` imports
 * `LocationKind` from `city/locations.ts`, so the catalogue cannot be imported back for a value
 * without closing the loop at module-load time. This file imports nothing, so anybody may read it.
 *
 * `units/catalog.ts` re-exports everything here, so no call site outside the package moved.
 */

/**
 * The flags that are **rules** rather than numbers, in the player's words.
 *
 * Every row here is a thing that happens rather than a figure that moves: who gets shot at, who
 * does not run, whose shot lands before the lines form. That is what separates this table from
 * `UNIT_MODIFIERS`, where every entry is percentage points on a number in some context. A unit
 * sheet with eleven numbers on it can say a Sniper hits hard; nothing on it can say a Sniper has
 * already fired.
 *
 * They were on the sheet and on nothing else, so the roster screen could not show them and a
 * player had no way to learn that an Ironside is a shield line or that a Stitcher does anything at
 * all. A table rather than a set of literals in a React file, because the wire, the roster and the
 * dossier all have to say the same thing.
 *
 * Keyed on the `UnitSpec` field, so adding a rule is a field, a row here, and the engine reading
 * it. Nothing else.
 */
export interface UnitRuleSpec {
  label: string;
  description: string;
  /**
   * Whether the rule is a thing the unit can do or a thing it cannot, so the card knows the colour.
   *
   * Defaulted to `'positive'` rather than written on every row, because all but one of the rules
   * are and a field that is almost always the same value stops being read. A card draws a negative
   * rule in the refusal red it already uses for a locked row, which is the only difference this
   * makes.
   */
  tone?: 'positive' | 'negative';
}

export const UNIT_RULES = {
  taunts: {
    label: 'Shield Line',
    description:
      'The enemy has to deal with this stack before anything standing behind it. Most of their fire comes here whether or not it is the sensible target.',
  },
  mends: {
    label: 'Field Medic',
    description:
      'Undoes part of every round of damage the rest of the line takes, before anybody counts the casualties. Never works on itself, so it is worth bringing beside fighters and worthless on its own.',
  },
  no_ride: {
    label: 'Too big to ride',
    description:
      'There is no seat in this city that takes one. It walks wherever it is going, and everybody sent with it walks at its pace.',
    tone: 'negative',
  },
  strikes_first: {
    label: 'Opening Volley',
    description:
      'Gets its shot away before either line is in position. Attacking or defending, in the open or in a cellar, and there is nothing the other side can do about it.',
  },
  stalwart: {
    label: 'Holds the Line',
    description:
      'Will not break while over half of them are still standing, whatever is happening to the people beside it. Under half it runs like anybody else.',
  },
  sapper: {
    label: 'Wall Breaker',
    description:
      'Brings the works down rather than shooting over them. Everything the defender dug, built and bolted on is worth less for as long as these are on the ground.',
  },
  pack: {
    label: 'Runs in Packs',
    description:
      'Fights harder for every other one of itself in the line. One is a nuisance. Forty is a different animal.',
  },
  picker: {
    label: 'Picks the Field',
    description:
      'Goes through the ground on the way out and comes home carrying more than it was issued. Worth the same to a rich crew as to a poor one.',
  },
} as const satisfies Record<string, UnitRuleSpec>;

export type UnitRuleId = keyof typeof UNIT_RULES;
export const UNIT_RULE_IDS = Object.keys(UNIT_RULES) as UnitRuleId[];
