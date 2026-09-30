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
      "Draws the enemy's fire by its share of the line. A wall half the line takes three quarters of their shots before anything behind it, and a bigger one a little more.",
  },
  mends: {
    label: 'Field Medic',
    description:
      'Patches up the rest of the line every round, undoing part of the damage it takes. Cannot treat itself.',
  },
  no_ride: {
    label: 'Too big to ride',
    description: 'Fits in no vehicle. It walks, and everyone sent with it walks at its pace.',
    tone: 'negative',
  },
  strikes_first: {
    label: 'Opening Volley',
    description: 'Fires one volley before either line is in position, attacking or defending.',
  },
  stalwart: {
    label: 'Holds the Line',
    description: 'Never breaks while more than half of them are still standing.',
  },
  wall_breaker: {
    label: 'Wall Breaker',
    description:
      "Enemy gates and traps are rendered useless for the fight. Traps are consumed while the gate's level gets lowered.",
  },
  pack: {
    label: 'Collective',
    description: 'This unit fights harder and carries more loot when there is more of them.',
  },
  jammer: {
    label: 'Jamming',
    description:
      "Weakens every figure the enemy's modifications add by the jam percent. Against Wonders of Engineering, each Netrunner covers three unit slots of machine: a covered machine loses 55% of its damage and armour, and every extra Netrunner on it cuts deeper, towards 75%. Nothing else.",
  },
  loud: {
    label: 'Loud',
    description:
      'Makes the fight Noisy II for whoever it is trading fire with, Noisy IV with the Stereo Rig. Machines barely notice; anything that hunts by ear suffers.',
  },
  sleeper: {
    label: 'Goes to Ground',
    description:
      'Can be planted unseen on ground you do not hold, and is already standing there when you call a fight on it.',
  },
  unspyable: {
    label: 'Undetectable',
    description: 'Cannot be spied, you only find out about it from battle reports.',
  },
} as const satisfies Record<string, UnitRuleSpec>;

export type UnitRuleId = keyof typeof UNIT_RULES;

/**
 * The rules a location, a perk or a research rung may hand to a unit that does not carry it.
 *
 * Every rule but the Wall Breaker, which belongs to the Colossus alone (maintainer, 2026-09-26):
 * nullifying every gate and trap in a fight is the one-of-a-kind machine's whole point, and a type
 * rather than a convention is what stops a perk written next month from handing it to a Razor.
 */
export type GrantableUnitMark = Exclude<UnitRuleId, 'wall_breaker'>;
export const UNIT_RULE_IDS = Object.keys(UNIT_RULES) as UnitRuleId[];
