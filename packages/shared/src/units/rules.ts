/**
 * The unit marks: the flags on a sheet that are **rules** rather than numbers.
 *
 * Its own module rather than a section of the catalogue, and the reason is an import cycle. A
 * location, a perk or a research rung can now *grant* a mark (`unit_mark` in `city/locations.ts`),
 * and the line the card prints for that has to name the mark. `units/catalog.ts` imports
 * `city/atlas.ts`, which imports `city/locations.ts`, so the catalogue cannot be imported back for
 * a value without closing the loop at module-load time. This file imports nothing, so anybody may read it.
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
  // TAUNT since 2026-10-13 (maintainer), from Shield Line. The id stays `taunts`.
  taunts: {
    label: 'Taunt',
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
  // Reworked 2026-10-13 (maintainer): it was "never breaks while more than half are standing".
  stalwart: {
    label: 'Holds the Line',
    description: "This unit's morale does not drop during the fight.",
  },
  focus: {
    label: 'Focus',
    description:
      'Makes the best attack it can, every time: its shots go where they do the most harm.',
  },
  steadies: {
    label: 'Steadying Presence',
    description:
      'While it stands and has not broken, nobody else on its side drops below wavering: nobody beside it runs.',
  },
  faith: {
    label: 'Faith',
    description:
      'This unit gains +30 vitality and +30 damage for each Mausoleum you control, and you may keep fifty more of them for each.',
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
      "Weakens every figure the enemy's modifications add by the jam percent. Against Wonders of Engineering, each unit slot of jammers covers three unit slots of machine, so one Netrunner covers nine: a covered machine loses 55% of its damage and armour, and every extra Netrunner on it cuts deeper, towards 75%. Nothing else.",
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
  // Box Nine and the Cold Store at level 5 hand this to the Snipers and the Stitchers, and the
  // Geppetto is born with it (maintainer, 2026-10-09).
  safe_distance: {
    label: 'Safe Distance',
    description:
      'Intimidation is half as effective against them, and while anybody else on their side is still in the fight, enemy units with range below 50 cannot target them.',
  },
  // The Mess Room at level 5 hands this to the Breakers (maintainer, 2026-10-09).
  drunk: {
    label: 'Drunk',
    description:
      'Goes for the Rabble first whenever there are any to go for, and hits them 10% harder.',
  },
  // The Kennels at level 5 hand this to the Cyberhounds (maintainer, 2026-10-09).
  good_boy: {
    label: 'Good Boy',
    description:
      'Each one lifts the morale of your Rabble by +10, as many of them as fit in its own unit slots: two one-slot Rabble or one two-slot. Every unit is lifted once at most.',
  },
  /*
   * Was a modifier, +15% in the streets, until 2026-10-09, when the maintainer made it this: two
   * things that happen rather than a number that moves, so it lives with the rules. The Snipers
   * carry it on the sheet; the Repeater Mast hands it to the Kite Crews at level 5.
   */
  rooftop: {
    label: 'Rooftop',
    description:
      'They cannot be ambushed, and have double evasion against units with range below 30.',
  },
  // The Reactor Shed hands this to the one unit type its holder names (maintainer, 2026-10-14).
  radioactive: {
    label: 'Radioactive',
    description:
      'Whenever one of these dies, it deals its vitality as damage to the stack that killed it, spread over the next 5 rounds.',
  },
  // The Cartographer's (maintainer, 2026-10-09): the final clock of any journey she is on.
  shortcut: {
    label: 'Shortcut',
    description:
      'Travelling between cities, or between districts in the same city, takes 50% less time.',
  },
  // The Old Dome at level 5 hands this to the Cartographer (maintainer, 2026-10-09).
  perception: {
    label: 'Perception',
    description: 'While she is alive in a battle, every enemy unit’s stealth is halved.',
  },
  // The Geppetto's, and his alone (maintainer, 2026-10-09). The Crate Ring's level sets how strong
  // the robots are, and at level 5 he makes two a round, which the card prints as AD HOC ARMY II.
  ad_hoc_army: {
    label: 'Ad Hoc Army',
    description:
      'Starts the fight with a robot beside him and makes another every round after, whether or not the others are still standing, for as long as he is in the fight. The robots are Wonders of Engineering with TAUNT, and they are not yours to keep: none of them is mustered, paid for or counted as a loss. The Crate Ring makes them tougher by level, and at level 5 he makes two a round.',
  },
  /*
   * The door rules (2026-10-14). Written on no sheet: a unit's door hands them over by level
   * (`battle/doors.ts`, `doorUnit`), the same way a location hands over SAFE DISTANCE. They were
   * read by the engine off the door ladder alone, so the Dancer's card had no PAPERCUT chip,
   * locked or held, while her fights stripped armour. A row here is what puts the chip on the
   * card, greyed with a cross until the door is at the level that pays it.
   */
  spectacle: {
    label: 'Spectacle',
    description: 'Every kill it makes pays twice the infamy it would have otherwise.',
  },
  papercut: {
    label: 'Papercut',
    description: 'Every attack strips 5 armour from every enemy unit, for the rest of the fight.',
  },
  blowout: {
    label: 'Blowout',
    description:
      'When one dies it bursts, dealing its damage to as many enemy unit slots as it had.',
  },
  inspiration: {
    label: 'Inspiration',
    description: 'Every ally fighting beside it ignores the ground that is bad for it.',
  },
  last_chance: {
    label: 'Last Chance',
    description: 'As one dies it strikes once more, one time in five.',
  },
} as const satisfies Record<string, UnitRuleSpec>;

export type UnitRuleId = keyof typeof UNIT_RULES;

/**
 * The rules a location, a perk or a research rung may hand to a unit that does not carry it.
 *
 * Every rule but the Wall Breaker, which belongs to the Colossus alone (maintainer, 2026-09-26),
 * the Death Cloaks' Faith (2026-10-06), which only means something on a unit raised in a tomb,
 * the Geppetto's Ad Hoc Army (2026-10-09), which needs the robots only he can make, and the Saint's
 * Steadying Presence (2026-10-05), which is what makes the one legendary worth it:
 * nullifying every gate and trap in a fight is the one-of-a-kind machine's whole point, and a type
 * rather than a convention is what stops a perk written next month from handing it to a Razor.
 * The five door rules (2026-10-14) are a door's to pay and nobody else's: `battle/doors.ts` is
 * the one table that hands them over.
 */
export type GrantableUnitMark = Exclude<
  UnitRuleId,
  | 'wall_breaker'
  | 'steadies'
  | 'faith'
  | 'ad_hoc_army'
  | 'spectacle'
  | 'papercut'
  | 'blowout'
  | 'inspiration'
  | 'last_chance'
>;
export const UNIT_RULE_IDS = Object.keys(UNIT_RULES) as UnitRuleId[];
