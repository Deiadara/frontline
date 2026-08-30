import { z } from 'zod';

/**
 * What a battle unit *is* (GDD §A5).
 *
 * Every figure is on the same 0..100 scale the character sheet uses (§B1), with two deliberate
 * exceptions called out on the fields themselves: vitality is hit points and loot capacity is
 * kilograms, and neither means anything as a percentage.
 *
 * Every figure here is read by the battle engine (`battle/`), and the sheet was written first for
 * exactly that reason: a model can be rewritten against content, and content cannot be rewritten
 * against a model that does not exist yet. `battle/matchup.test.ts` is where a change to any of
 * these numbers shows up as a change to a matchup.
 */

/**
 * What a unit hits with, and the axis resistances are written against.
 *
 * `sonic` was here and is gone with the Bell-Ringers, who were the only sheet that carried it. It
 * outlived them by one change as an enum member nothing could produce, with four units still
 * resisting a damage type no attacker in the game could deal: a lever the design was paying
 * attention to and the engine could never reach.
 */
export const DAMAGE_TYPES = ['ballistic', 'blade', 'explosive', 'energy', 'chemical'] as const;
export const DamageTypeSchema = z.enum(DAMAGE_TYPES);
export type DamageType = z.infer<typeof DamageTypeSchema>;

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  ballistic: 'Ballistic',
  blade: 'Blade',
  explosive: 'Explosive',
  energy: 'Energy',
  chemical: 'Chemical',
};

/**
 * Where a modifier applies. A closed list, because a modifier whose condition is prose is a
 * modifier the engine can never read.
 */
export const COMBAT_CONTEXTS = [
  'urban',
  'dark',
  'indoor',
  'open_ground',
  'underground',
  'vs_structure',
  'vs_armor',
  'vs_evasive',
  'vs_low_morale',
  'outnumbered',
  'defending',
] as const;
export const CombatContextSchema = z.enum(COMBAT_CONTEXTS);
export type CombatContext = z.infer<typeof CombatContextSchema>;

export const COMBAT_CONTEXT_LABELS: Record<CombatContext, string> = {
  urban: 'in built-up ground',
  dark: 'on unlit ground',
  indoor: 'inside a structure',
  open_ground: 'in the open',
  underground: 'below street level',
  vs_structure: 'against fortifications',
  vs_armor: 'against armour',
  vs_evasive: 'against something that will not hold still',
  vs_low_morale: 'against a shaken enemy',
  outnumbered: 'when outnumbered',
  defending: 'when holding ground',
};

export interface UnitModifierSpec {
  label: string;
  description: string;
  context: CombatContext;
  /** Percentage points on this unit's effectiveness while the context holds. */
  percent: number;
  /**
   * Which half of "effectiveness" the points land on. Defaults to `offense`.
   *
   * Every modifier used to be an attack bonus, which quietly made the whole table unusable for a
   * unit whose job is not damage: a shield wall with 60 damage and a +60% bonus for holding ground
   * gains 36 points of a stat nobody sends it for. A defensive sheet needs to be *harder to kill*
   * while the context holds, which is a different number in a different place, so it says which.
   */
  affects?: 'offense' | 'toughness';
}

/**
 * The named modifiers units carry: "Urban Bonus", "Night Operations" and the rest.
 *
 * A shared table rather than free text per unit, so two units that fight better in the dark say so
 * the same way, and so the engine has a finite set of conditions to implement rather than an open
 * vocabulary.
 */
export const UNIT_MODIFIERS = {
  urban_bonus: {
    label: 'Urban Bonus',
    description: 'Grew up in these streets and does not need a map of them.',
    context: 'urban',
    percent: 20,
  },
  night_operations: {
    label: 'Night Operations',
    description: 'Trained to work without light, and better for the enemy not being.',
    // Ground, not hour. The clock used to decide this and it made a floodlit yard at ten at night
    // count while a pitch-black sewer at noon did not. See `DARK_GROUND_TIER`.
    context: 'dark',
    percent: 20,
  },
  close_quarters: {
    label: 'Close Quarters',
    description: 'At its best in a corridor, where range stops mattering.',
    context: 'indoor',
    percent: 25,
  },
  open_field: {
    label: 'Open Field',
    description: 'Needs room, and is worth having when there is some.',
    context: 'open_ground',
    percent: 25,
  },
  tunnel_rat: {
    label: 'Tunnel Rat',
    description: 'Comfortable below the street, where most things are not.',
    context: 'underground',
    percent: 25,
  },
  breaching: {
    label: 'Breaching',
    description: 'Carries what it takes to make a door out of a wall.',
    context: 'vs_structure',
    percent: 30,
  },
  armor_piercing: {
    label: 'Armour Piercing',
    description: 'Ammunition or edge designed for the plate it will meet.',
    context: 'vs_armor',
    percent: 30,
  },
  /**
   * The other half of a pair that was missing one.
   *
   * Armour had a counter on every sheet in the game (`penetration`) and evasion had none at all,
   * which is not a small asymmetry: evasion is a flat miss chance nothing could erode, so the two
   * most evasive sheets in the roster were simply better than everything against everything.
   * Measured before this existed: the Crimson Dancer took 90% of her matchups with a spread of 23
   * points across opponents, which is what "uncounterable" looks like in a table.
   *
   * Deliberately a modifier rather than a stat. Penetration is on every sheet because plate is
   * ordinary; tracking something that does not want to be hit is a speciality, and it should be a
   * reason to bring a *particular* unit rather than a number everybody carries a little of.
   */
  tracking: {
    label: 'Tracking',
    description: 'Reads the movement, not the target. Ducking does not help.',
    context: 'vs_evasive',
    percent: 45,
  },
  terror: {
    label: 'Terror',
    description: 'Finishes what fear started, and starts it where it has not.',
    context: 'vs_low_morale',
    percent: 35,
  },
  last_stand: {
    label: 'Last Stand',
    description: 'Fights hardest when the odds are worst. That is not the same as fighting well.',
    context: 'outnumbered',
    percent: 25,
  },
  dug_in: {
    label: 'Dug In',
    description: 'Worth twice as much behind something as in front of it.',
    context: 'defending',
    percent: 30,
  },
  bulwark: {
    label: 'Bulwark',
    description: 'Holding ground is the whole job. Getting through takes time nobody has.',
    context: 'defending',
    percent: 70,
    // Toughness rather than damage: this is on the sheet that has almost no damage to raise.
    affects: 'toughness',
  },
  ambush: {
    label: 'Ambush',
    description: 'The first exchange is decided before the enemy knows there is one.',
    context: 'urban',
    percent: 25,
  },
  rooftop: {
    label: 'Rooftop',
    description: 'Works from above, which in this city is most places.',
    context: 'urban',
    percent: 15,
  },
} as const;

export type UnitModifierId = keyof typeof UNIT_MODIFIERS;
export const UNIT_MODIFIER_IDS = Object.keys(UNIT_MODIFIERS) as UnitModifierId[];

/**
 * A unit's sheet.
 *
 * Ordered as a player reads it: how it moves, how much it takes, how it hits, how it hides, and
 * what it can carry home.
 */
export const UnitStatsSchema = z.object({
  /** 0..100. How fast it crosses the city and closes ground. */
  speed: z.number().int().min(0).max(100),
  /** Hit points, **not** a 0..100 rating. A Colossus is worth twenty Razors and says so here. */
  vitality: z.number().int().positive(),
  /** 0..100. How easily it breaks and runs, and how well it resists being frightened. */
  morale: z.number().int().min(0).max(100),
  /** 0..100. Flat damage reduction before resistances. */
  armor: z.number().int().min(0).max(100),
  damageType: DamageTypeSchema,
  /**
   * Percentage reduction against each incoming damage type. Absent means none.
   *
   * A *partial* record on purpose: most units resist nothing in particular, and writing six zeroes
   * on every sheet would bury the two entries that matter under four that do not.
   */
  resistances: z.partialRecord(DamageTypeSchema, z.number().int()),
  /**
   * 0..100. Points of the target's armour this cancels outright (`battle/matchup.ts`).
   *
   * It was a critical-hit chance. A crit is a bonus against *everything*, which says nothing about
   * who a unit is for; penetration is worth exactly as much as the target is armoured, so it is
   * the stat that makes an anti-armour specialist a real answer rather than a bigger number.
   */
  penetration: z.number().int().min(0).max(100),
  /** 0..100. How far out it can hurt something. */
  range: z.number().int().min(0).max(100),
  /**
   * Damage dealt, and **not** a 0..100 rating: the same open scale `vitality` is on.
   *
   * It was capped at 100 and the catalogue already had a unit sitting on the cap, which is the
   * shape of a ceiling about to be in the way rather than a rule anybody chose. Attack and hit
   * points are the two figures a player compares between units in absolute terms ("this one hits
   * four times as hard"), and a rating out of 100 cannot say that once anything reaches the top.
   * Every other stat stays a rating, because a percentage chance to dodge genuinely is out of 100.
   */
  offense: z.number().int().min(0),
  /** 0..100. Chance to avoid an attack outright. */
  evasion: z.number().int().min(0).max(100),
  /** 0..100. How hard it is to spot **while infiltrating**, not once a fight has started. */
  stealth: z.number().int().min(0).max(100),
  /** Kilograms of salvage it can carry home. Every resource has a weight: see `raid.ts`. */
  lootCapacity: z.number().int().min(0),
  /** 0..100. What it does to an enemy's morale by turning up. */
  intimidation: z.number().int().min(0).max(100),
});
export type UnitStats = z.infer<typeof UnitStatsSchema>;

/** The stat keys in display order, so a sheet cannot silently drop one. */
export const UNIT_STAT_KEYS = [
  'speed',
  'vitality',
  'morale',
  'armor',
  'penetration',
  'range',
  'offense',
  'evasion',
  'stealth',
  'lootCapacity',
  'intimidation',
] as const satisfies readonly (keyof UnitStats)[];

/**
 * A *numeric* stat key: the eleven a sheet prints.
 *
 * Deliberately not `keyof UnitStats`, which also carries `damageType` and `resistances`. Those are
 * a word and a table, and neither has a bar or a figure to draw.
 */
export type StatKey = (typeof UNIT_STAT_KEYS)[number];

/**
 * The two open figures a player reads as quantities rather than as ratings.
 *
 * Attack and hit points are unbounded, so a bar out of 100 would be a lie about both: a Colossus
 * has twenty times a Razor's vitality and no track can show that. They are printed, large, above
 * the ratings. `lootCapacity` is open-ended too (kilograms) and is printed for the same reason,
 * but it is not a headline: what a unit *carries home* is a raid concern rather than the thing you
 * compare two units by.
 */
export const UNIT_HEADLINE_KEYS = ['offense', 'vitality'] as const satisfies readonly StatKey[];

/** Open-ended counts. Printed as figures, never as a fraction of anything. */
export const UNIT_FIGURE_KEYS = [
  ...UNIT_HEADLINE_KEYS,
  'lootCapacity',
] as const satisfies readonly StatKey[];

/**
 * Everything genuinely scored 0..100, in display order. These are the ones a bar can tell the
 * truth about, because the track *is* the maximum.
 */
export const UNIT_RATING_KEYS: readonly StatKey[] = UNIT_STAT_KEYS.filter(
  (key) => !UNIT_FIGURE_KEYS.includes(key as (typeof UNIT_FIGURE_KEYS)[number]),
);

export const UNIT_STAT_LABELS: Record<(typeof UNIT_STAT_KEYS)[number], string> = {
  speed: 'Speed',
  vitality: 'Vitality',
  morale: 'Morale',
  armor: 'Armour',
  penetration: 'Penetration',
  range: 'Range',
  offense: 'Damage',
  evasion: 'Evasion',
  stealth: 'Stealth',
  lootCapacity: 'Loot',
  intimidation: 'Intimidation',
};

/**
 * What each stat actually decides, in the player's words.
 *
 * Eleven numbers on a card with nothing but a one-word label each is a spec sheet, not a decision:
 * a player comparing Razors to Scrapers can see that one has more Evasion without knowing whether
 * Evasion is worth anything. These are read off what the battle engine does with each number, and
 * they are the copy behind the hover on every stat row.
 */
export const UNIT_STAT_EXPLAINERS: Record<(typeof UNIT_STAT_KEYS)[number], string> = {
  speed: 'Who moves first, and who gets a shot away before the other side has decided anything.',
  vitality: 'How much punishment one of them absorbs before they are out of the fight.',
  morale: 'How far it has to go badly before they break and run rather than hold the line.',
  armor: 'Taken off every hit that lands. Cheap weapons stop mattering against enough of it.',
  penetration:
    'How much of a target’s armour this gets through. Worth exactly as much as the target is wearing, and nothing at all against something in rags.',
  range: 'How long they get to shoot before the fight closes and range stops counting.',
  offense: 'What you feel when they land a hit.',
  evasion: 'How often the other side misses. Worth most against many small attacks.',
  stealth: 'Whether a raid is noticed on the way in, and whether anyone comes looking after.',
  lootCapacity: 'How much comes back on the truck when the ground is taken.',
  intimidation: 'Sometimes you do not even need to land a hit.',
};
