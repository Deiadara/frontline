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
      'Brings the works down rather than shooting over them. Everything the defender dug, built and bolted on is worth less for the whole fight, and it is worth less from the first exchange: the wall comes down before anybody fires, and killing the people who brought it down does not put it back up.',
  },
  pack: {
    label: 'Collective',
    description:
      'The more you have of this unit the better its bonuses. Carriers can carry more loot and combat units fight harder when there is more of them.',
  },
  jammer: {
    label: 'Jamming',
    description:
      "Hijacks the other side's augmentations for as long as the fight lasts. Every round, before a shot is fired, the enemy line's armour and its damage both drop. It is worth more the more of your own line is doing it, and it stops the moment the last of them is down. This is how they hurt people, so whatever the place does to another unit's shooting it does to their jamming instead: the ground they are standing on, the weather, the dark and the crew's programmes. What the enemy is wearing does not come into it, because a jam is laid on the whole line at once and not aimed at anybody, and neither does the yard: a better gunsight makes them shoot better, which for these is twenty points of nothing.",
  },
  loud: {
    label: 'Loud',
    description:
      'Puts Noisy II on whoever they are fighting, round by round, for as long as they are still up. Only the people actually trading with them hear it: a stack off fighting the rest of your line is on quiet ground. What it costs depends on who it lands on, because a machine hardly notices and anything that hunts by ear is in trouble. The Stereo Rig takes it to Noisy IV.',
  },
  sleeper: {
    label: 'Goes to Ground',
    description:
      'Can be planted on a place you do not hold, long before there is anything to fight over, and left there. Nothing finds them: no scout counts them and no amount of digging turns them up. Call a fight on that ground and they are already standing in it, with the walk paid days ago. Nobody else in the crew can be anywhere they were not sent.',
  },
} as const satisfies Record<string, UnitRuleSpec>;

export type UnitRuleId = keyof typeof UNIT_RULES;
export const UNIT_RULE_IDS = Object.keys(UNIT_RULES) as UnitRuleId[];
