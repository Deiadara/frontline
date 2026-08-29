import { z } from 'zod';
import { BUILDING_KINDS, findModification, type BuildingKind } from '../building/index.js';
import { ENV_LABEL_IDS, type EnvLabelId } from '../city/labels.js';
import { LOCATION_KINDS, type LocationKind } from '../city/locations.js';
import type { PartialResources } from '../resources.js';
import { UNIT_MODIFIERS, type UnitModifierId, type UnitStats } from './stats.js';

/**
 * The battle units (GDD §A5).
 *
 * Five tiers, and what separates them is not only power. It is **what you had to do with the
 * world to get them**. Rabble needs a Gauntlet, or in one case nothing at all. Specialists need
 * something researched or a specific augment fitted. Heavy units need a clinic you took off
 * somebody. Legendary units need a location on the map *and* a structure at the top of its tree: the
 * Colossus is built out of a war machine graveyard because that is where the hulls are.
 *
 * That is the whole design intent of the requirement list below: a unit roster is a readout of a
 * campaign, not a shopping list.
 */

/**
 * The tiers, in the order a roster reads them: cheapest and least specialised first.
 *
 * `regular` is gone rather than empty. It had become the tier a unit went in when nobody had
 * decided what it was, which is the opposite of what a tier is for: every one of these now answers
 * "what kind of thing is this", and a unit that does not obviously belong to one of them is a unit
 * whose design is not finished.
 *
 * `carrier` was `support`, renamed for the same reason: "support" describes a role in a fight and
 * these two are never in one. They carry.
 */
export const UNIT_TIERS = [
  'carrier',
  'rabble',
  'specialist',
  'wonder',
  'heavy',
  'legendary',
] as const;
export const UnitTierSchema = z.enum(UNIT_TIERS);
export type UnitTier = z.infer<typeof UnitTierSchema>;

export const UNIT_TIER_LABELS: Record<UnitTier, string> = {
  carrier: 'Carriers',
  rabble: 'Rabble',
  specialist: 'Specialists',
  wonder: 'Wonders of Engineering',
  heavy: 'Heavy',
  legendary: 'Legendary',
};

/**
 * One condition on fielding a unit. **All** of a unit's clauses must hold.
 *
 * Three kinds, and between them they cover everything the design asks for: "enough Gauntlet
 * levels", "a strong enough Generator", "researched it in the Lab" and "a certain augment fitted"
 * are all `building` or `modification`; "there is a factory in another district that makes them"
 * is `location`.
 */
export type UnitRequirement =
  | { kind: 'building'; building: BuildingKind; level: number }
  | { kind: 'modification'; modificationId: string }
  | { kind: 'location'; locationKind: LocationKind };

export interface UnitSpec {
  id: string;
  name: string;
  tier: UnitTier;
  blurb: string;
  /** The structure that runs the work. Most units are trained; a few are *made*. */
  trainedAt: BuildingKind;
  /** Legendary units are one of a kind. You hold one or none. */
  unique: boolean;
  /**
   * Whether this unit can fight at all (§A5, §E).
   *
   * `false` for the scavenger tier, and it is a hard rule rather than a very low offense: a
   * Scavenger is never put in a battle line, never draws fire, and contributes nothing to either
   * side of an exchange. What they are for is carrying: they go on a standard mission alone, or
   * alongside fighters on a battle mission to bring the haul home. Defaulted true, because every
   * unit written before the tier existed was a fighter.
   */
  combat?: boolean;
  /**
   * Whether the enemy has to deal with this stack before anything behind it (§A5).
   *
   * A targeting rule, not a stat, which is why it is a flag here rather than a row in
   * `UNIT_MODIFIERS`: every entry in that table is percentage points on a number, and this one
   * changes *who gets shot at*. The engine reads it in `battle/engine.ts`.
   *
   * What it buys is a sheet that is worth fielding while being bad at the thing the engine scores
   * units on. Targeting picks by damage-per-point-of-enemy-health, so a wall with no damage and a
   * lot of health is the least attractive target on the field: without this, a shield line is
   * walked past and the people behind it are shot instead, which is the exact opposite of what a
   * shield line is.
   */
  taunts?: boolean;
  requires: readonly UnitRequirement[];
  cost: PartialResources;
  trainSeconds: number;
  /** What one costs against the standing army cap. A Colossus is not one soldier. */
  supply: number;
  stats: UnitStats;
  modifiers: readonly UnitModifierId[];
  /**
   * Percentage points **per tier** added to what an environment label is already worth to this
   * unit (`city/labels.ts`).
   *
   * Almost every unit leaves this empty and is answered by the label's own stat rule: a
   * Juggernaut cooks in the heat because it is wearing ninety-five points of armour, not because
   * somebody typed a row for it. What goes here is the handful of cases a sheet genuinely cannot
   * express: Anodics fight *better* in a room full of noise, and no combination of their eleven
   * numbers says so.
   */
  affinities?: Partial<Record<EnvLabelId, number>>;
  /**
   * Labels whose baseline simply does not apply. The affinity, if any, still does.
   *
   * For the things that are not really people: a machine is not frightened by an eerie room and a
   * creature that breathes chlorine is not troubled by a chlorine leak. Immunity rather than a
   * large positive affinity, because "immune" is a fact a player can rely on and "+13 per tier
   * which happens to cancel out at this armour value" is a coincidence that breaks on a rebalance.
   */
  immuneTo?: readonly EnvLabelId[];
}

/** The middle of the road. Every unit below states only what makes it different from this. */
const BASE_STATS: UnitStats = {
  speed: 40,
  vitality: 100,
  morale: 50,
  armor: 10,
  damageType: 'ballistic',
  resistances: {},
  penetration: 5,
  range: 30,
  offense: 175,
  evasion: 10,
  stealth: 20,
  lootCapacity: 20,
  intimidation: 10,
};

const sheet = (over: Partial<UnitStats>): UnitStats => ({ ...BASE_STATS, ...over });

const gauntlet = (level: number): UnitRequirement => ({
  kind: 'building',
  building: 'gauntlet',
  level,
});
const structure = (building: BuildingKind, level: number): UnitRequirement => ({
  kind: 'building',
  building,
  level,
});
const fitted = (modificationId: string): UnitRequirement => ({
  kind: 'modification',
  modificationId,
});
const holds = (locationKind: LocationKind): UnitRequirement => ({ kind: 'location', locationKind });

export const UNIT_CATALOG: readonly UnitSpec[] = [
  // ---------------------------------------------------------------- rabble
  {
    id: 'razors',
    name: 'Razors',
    tier: 'rabble',
    blurb: 'Light blade-wielding urban fighters. Cheap, willing, and not expected back.',
    trainedAt: 'gauntlet',
    unique: false,
    /**
     * Nothing at all: the only unit in the game with no requirement.
     *
     * A crew that has not built a Gauntlet yet must still be able to put *somebody* on the street,
     * or the first session has no move in it: the opening district holds a Nexus and a Generator,
     * and a roster that was entirely locked behind a barracks would make the whole city
     * unreachable until one was standing.
     */
    requires: [],
    cost: { caps: 40, supplies: 10 },
    trainSeconds: 45,
    supply: 1,
    stats: sheet({
      speed: 55,
      vitality: 75,
      morale: 40,
      armor: 5,
      damageType: 'blade',
      penetration: 8,
      range: 5,
      offense: 160,
      evasion: 15,
      stealth: 30,
      lootCapacity: 25,
      intimidation: 8,
    }),
    modifiers: ['urban_bonus', 'close_quarters'],
  },
  {
    id: 'anodics',
    name: 'Anodics',
    tier: 'rabble',
    blurb:
      'Overqualified, over-medicated and unaccountably hard to put down. Somebody who read every book in the district, shaved most of it off, and came down here with a bottle of speed and a plan.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(2)],
    /**
     * The cheapest thing in the game that can take a hit.
     *
     * Rabble tier and priced like it, but with a Warden's constitution and a middling everything
     * else: the first unit worth fielding in numbers once there is a Gauntlet to train them in.
     * (Razors remain the one thing a crew with no barracks can put on the street; that is their
     * whole job, and nothing else is allowed to take it.)
     *
     * What Anodics are *for* is the ground, not the sheet: a room, a tunnel, a factory floor with a
     * press running. Fight them in a yard and they are worse than Razors.
     */
    cost: { caps: 55, supplies: 15, scrap: 10 },
    trainSeconds: 60,
    supply: 1,
    stats: sheet({
      speed: 46,
      vitality: 145,
      morale: 66,
      armor: 16,
      damageType: 'blade',
      penetration: 10,
      range: 12,
      offense: 200,
      evasion: 8,
      stealth: 8,
      lootCapacity: 18,
      intimidation: 22,
    }),
    modifiers: ['close_quarters', 'last_stand'],
    /**
     * The one unit whose whole identity is a label.
     *
     * **Noisy** is the headline and it is not a metaphor: they are running on something that turns
     * a room full of machinery into a reason to keep going, and a press hall or a full tavern is
     * where they are worth twice what they cost. **Crammed** doubles down on the close-quarters
     * modifier they already carry. **Open** is the bill for both: in a yard with sightlines they
     * are a slow target with a bottle.
     *
     * **Eerie** is the quiet one: they are far too wired to be unnerved by anything, which is not
     * courage and does not need to be.
     */
    affinities: { noisy: 11, crammed: 7, eerie: 5, open: -5 },
  },
  {
    id: 'sparks',
    name: 'Sparks',
    tier: 'rabble',
    blurb: 'Young recruits with jury-rigged weapons. Hit hard once, then hope.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(1)],
    cost: { caps: 45, supplies: 5, scrap: 20 },
    trainSeconds: 50,
    supply: 1,
    stats: sheet({
      speed: 45,
      vitality: 50,
      morale: 30,
      armor: 3,
      penetration: 18,
      range: 45,
      offense: 240,
      evasion: 8,
      stealth: 15,
      lootCapacity: 15,
      intimidation: 6,
    }),
    modifiers: ['urban_bonus'],
  },
  {
    id: 'scrapers',
    name: 'Scrapers',
    tier: 'rabble',
    blurb: 'Scavengers turned fighters. Light armour, quick hands, gone before the answer comes.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(2)],
    cost: { caps: 50, supplies: 10, scrap: 25 },
    trainSeconds: 55,
    supply: 1,
    stats: sheet({
      speed: 70,
      vitality: 65,
      morale: 45,
      armor: 6,
      damageType: 'blade',
      penetration: 10,
      range: 10,
      offense: 140,
      evasion: 25,
      stealth: 40,
      lootCapacity: 60,
      intimidation: 5,
    }),
    modifiers: ['urban_bonus', 'ambush'],
  },

  // --------------------------------------------------------------- regulars
  {
    id: 'breakers',
    name: 'Breakers',
    tier: 'heavy',
    blurb: 'Door-kicking close-quarters specialists. Whatever is behind it, they go through it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(4)],
    cost: { caps: 120, supplies: 20, scrap: 60, oil: 15 },
    trainSeconds: 150,
    supply: 2,
    stats: sheet({
      speed: 45,
      vitality: 150,
      morale: 60,
      armor: 30,
      damageType: 'explosive',
      penetration: 12,
      range: 15,
      offense: 275,
      evasion: 8,
      stealth: 10,
      lootCapacity: 30,
      intimidation: 30,
    }),
    modifiers: ['close_quarters', 'breaching'],
  },
  {
    id: 'wardens',
    name: 'Wardens',
    tier: 'heavy',
    blurb: 'Defensive specialists. Considerably better at holding a location than at taking one.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(4)],
    cost: { caps: 130, supplies: 20, scrap: 80 },
    trainSeconds: 160,
    supply: 2,
    stats: sheet({
      speed: 30,
      vitality: 185,
      morale: 70,
      armor: 45,
      resistances: { blade: 25, explosive: -20 },
      penetration: 6,
      range: 40,
      offense: 190,
      evasion: 5,
      stealth: 8,
      lootCapacity: 20,
      intimidation: 20,
    }),
    modifiers: ['dug_in', 'last_stand'],
  },
  {
    id: 'ghosts',
    name: 'Ghosts',
    tier: 'specialist',
    blurb: 'Lightly armed and hard to pin down. Fighting them is easy. Finding them is the job.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(5)],
    cost: { caps: 160, supplies: 25, oil: 20 },
    trainSeconds: 180,
    supply: 2,
    stats: sheet({
      speed: 60,
      vitality: 90,
      morale: 55,
      armor: 10,
      damageType: 'blade',
      penetration: 25,
      range: 15,
      offense: 210,
      evasion: 35,
      stealth: 85,
      lootCapacity: 25,
      intimidation: 5,
    }),
    modifiers: ['night_operations', 'ambush'],
    affinities: { dark: 8, foggy: 4, noisy: -7 },
  },
  {
    id: 'road_reavers',
    name: 'Road Reavers',
    tier: 'wonder',
    blurb: 'Motorcycle raiders. Fast, loud, aggressive, and halfway home with your fuel.',
    trainedAt: 'garage',
    unique: false,
    requires: [gauntlet(5), structure('garage', 4)],
    cost: { caps: 180, supplies: 25, scrap: 90, oil: 60 },
    trainSeconds: 200,
    supply: 2,
    stats: sheet({
      speed: 92,
      vitality: 115,
      morale: 55,
      armor: 18,
      penetration: 14,
      range: 35,
      offense: 250,
      evasion: 30,
      stealth: 10,
      lootCapacity: 70,
      intimidation: 35,
    }),
    modifiers: ['open_field', 'urban_bonus'],
    // Motorcycles. Wet, snow and a corridor are all the same answer.
    affinities: { wet: -6, snowy: -7, crammed: -7, open: 6 },
  },
  /**
   * The wall, and the only unit in the game that is not trying to win the fight.
   *
   * Its damage is the lowest of anything that fights at all: 45 against a Razor's 160, which is
   * roughly one Razor's worth of harm from three bodies. Everything it has is on the other side of
   * the ledger, 520 hit points and 70 points of plate, and `bulwark` adds seventy percent of that
   * again while it is holding ground. It cannot take a location. It can make one cost more than it
   * is worth.
   *
   * `taunts` is what makes any of that matter, and without it the sheet is worthless rather than
   * defensive. Targeting is by damage per point of enemy health (`threatWeight`), so a unit built
   * with no damage and a great deal of health is the *least* attractive target on the field: the
   * enemy would walk past the shield wall and shoot the Snipers behind it, which is precisely the
   * arrangement a shield wall exists to prevent.
   */
  {
    id: 'ironsides',
    name: 'Ironsides',
    tier: 'heavy',
    blurb: 'A shield wall of salvaged plate. It will not beat you. It will not move, either.',
    trainedAt: 'gauntlet',
    unique: false,
    taunts: true,
    requires: [gauntlet(6), structure('scrapyard', 5)],
    cost: { caps: 200, supplies: 30, scrap: 140, highQualityMetal: 10 },
    trainSeconds: 240,
    supply: 3,
    stats: sheet({
      speed: 25,
      vitality: 520,
      morale: 85,
      armor: 70,
      damageType: 'blade',
      resistances: { ballistic: 35, blade: 35, explosive: -30 },
      penetration: 5,
      range: 10,
      offense: 45,
      evasion: 3,
      stealth: 5,
      lootCapacity: 25,
      // Deliberately unimpressive, and it is the number that makes the sheet *bad at attacking*.
      // Measured, not guessed: at 40 a stack of these took every equal-supply fight it started,
      // because this engine settles a stalemate by who breaks first and a wall never breaks. It
      // was winning by outlasting rather than by killing, which is the opposite of the brief. At
      // 25 the same stack loses the fights it starts and holds the ones it is given.
      intimidation: 25,
    }),
    modifiers: ['bulwark', 'dug_in'],
    // Salvaged plate, worn all day. The cold is somebody else's problem.
    affinities: { cold: 5, hot: -5, snowy: -4 },
  },
  {
    id: 'ash_walkers',
    name: 'Ash Walkers',
    tier: 'rabble',
    blurb: 'Chem-suited troops who go where the air is wrong and come back out of it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(6), structure('cistern', 5)],
    cost: { caps: 190, supplies: 30, scrap: 70, oil: 40 },
    trainSeconds: 220,
    supply: 2,
    stats: sheet({
      speed: 38,
      vitality: 140,
      morale: 65,
      armor: 35,
      damageType: 'chemical',
      resistances: { chemical: 90, blade: -25 },
      penetration: 8,
      range: 25,
      offense: 225,
      evasion: 8,
      stealth: 15,
      lootCapacity: 30,
      intimidation: 25,
    }),
    modifiers: ['tunnel_rat'],
    // Chem suits. The whole unit exists for the air being wrong, so the one label that
    // decides most of a chemical plant does not touch them.
    immuneTo: ['toxic'],
    affinities: { hot: -4 },
  },

  // ------------------------------------------------------------ specialists
  {
    id: 'snipers',
    name: 'Snipers',
    tier: 'specialist',
    blurb: 'Long range, one shot, one kill. Everything else is spent waiting for it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(7), fitted('gauntlet_live_fire_range')],
    cost: { caps: 260, supplies: 40, scrap: 60, highQualityMetal: 12 },
    trainSeconds: 300,
    supply: 2,
    stats: sheet({
      speed: 35,
      vitality: 75,
      morale: 60,
      armor: 8,
      penetration: 60,
      range: 95,
      offense: 350,
      evasion: 12,
      stealth: 60,
      lootCapacity: 10,
      intimidation: 25,
    }),
    modifiers: ['rooftop', 'open_field'],
    // A rifle is a promise about a sightline, and fog, wind and a low ceiling all break it.
    affinities: { elevated: 7, foggy: -7, windy: -5 },
  },
  {
    id: 'stitchers',
    name: 'Stitchers',
    tier: 'specialist',
    blurb: 'Field medics. Contribute nothing to a fight and decide how many walk out of it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(7), structure('infirmary', 5)],
    cost: { caps: 220, supplies: 60 },
    trainSeconds: 280,
    supply: 2,
    stats: sheet({
      speed: 40,
      vitality: 100,
      morale: 70,
      armor: 12,
      damageType: 'blade',
      penetration: 2,
      range: 10,
      offense: 60,
      evasion: 15,
      stealth: 25,
      lootCapacity: 20,
      intimidation: 2,
    }),
    modifiers: ['dug_in'],
    // Medics are not fighting; what stops them is not being able to find anybody.
    affinities: { dark: -6, foggy: -5, eerie: -5 },
  },
  {
    id: 'demolishers',
    name: 'Demolishers',
    tier: 'specialist',
    blurb:
      'Explosive ordnance experts. Uninterested in your people; very interested in your walls.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(8), structure('scrapyard', 6)],
    cost: { caps: 280, supplies: 40, scrap: 120, oil: 80, highQualityMetal: 15 },
    trainSeconds: 330,
    supply: 3,
    stats: sheet({
      speed: 30,
      vitality: 135,
      morale: 55,
      armor: 25,
      damageType: 'explosive',
      penetration: 20,
      range: 40,
      offense: 325,
      evasion: 6,
      stealth: 10,
      lootCapacity: 25,
      intimidation: 45,
    }),
    modifiers: ['breaching', 'armor_piercing'],
  },
  {
    id: 'kite_crews',
    name: 'Kite Crews',
    tier: 'wonder',
    blurb: 'Drone operators working off rooftops. They see the fight before anybody is in it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(8), structure('lab', 5)],
    cost: { caps: 280, supplies: 40, scrap: 40, highQualityMetal: 18 },
    trainSeconds: 310,
    supply: 2,
    stats: sheet({
      speed: 55,
      vitality: 85,
      morale: 55,
      armor: 10,
      damageType: 'energy',
      penetration: 12,
      range: 75,
      offense: 190,
      evasion: 22,
      stealth: 50,
      lootCapacity: 12,
      intimidation: 10,
    }),
    modifiers: ['rooftop', 'open_field'],
    // Drones. Weather is the whole of their problem and the ground is none of it.
    affinities: { windy: -9, foggy: -6, elevated: 6 },
  },
  {
    id: 'netrunners',
    name: 'Netrunners',
    tier: 'specialist',
    blurb: 'Combat hackers who hijack enemy augmentations mid-fight. Nobody enjoys meeting them.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(9), structure('lab', 8), fitted('lab_quantum_modeling')],
    cost: { caps: 360, supplies: 55, highQualityMetal: 30 },
    trainSeconds: 380,
    supply: 3,
    stats: sheet({
      speed: 42,
      vitality: 85,
      morale: 65,
      armor: 12,
      damageType: 'energy',
      penetration: 35,
      range: 55,
      offense: 275,
      evasion: 20,
      stealth: 55,
      lootCapacity: 10,
      intimidation: 20,
    }),
    modifiers: ['night_operations', 'armor_piercing'],
    // They work off other people's augmentations, and a wet street does nothing to that.
    affinities: { crammed: 5, eerie: -4 },
  },
  {
    id: 'sleepers',
    name: 'Sleepers',
    tier: 'specialist',
    blurb: 'Planted long ago, and useful exactly once. They are already inside.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(9), fitted('nexus_encrypted_core')],
    cost: { caps: 340, supplies: 50, oil: 30 },
    trainSeconds: 360,
    supply: 2,
    stats: sheet({
      speed: 45,
      vitality: 85,
      morale: 75,
      armor: 10,
      damageType: 'blade',
      penetration: 45,
      range: 10,
      offense: 250,
      evasion: 25,
      stealth: 95,
      lootCapacity: 15,
      intimidation: 10,
    }),
    modifiers: ['ambush', 'urban_bonus'],
  },
  {
    id: 'cyber_dogs',
    name: 'Cyberhounds',
    tier: 'wonder',
    blurb:
      'Augmented working dogs off the kennels under the flyover. They find what is hiding and they do not need to see it to do it.',
    trainedAt: 'infirmary',
    unique: false,
    requires: [structure('infirmary', 6), holds('doghouse')],
    cost: { caps: 190, supplies: 90, highQualityMetal: 15 },
    trainSeconds: 420,
    supply: 1,
    stats: sheet({
      speed: 92,
      vitality: 90,
      morale: 72,
      armor: 8,
      damageType: 'blade',
      penetration: 30,
      range: 4,
      offense: 290,
      evasion: 38,
      stealth: 55,
      lootCapacity: 0,
      intimidation: 45,
    }),
    modifiers: ['ambush', 'night_operations'],
    /**
     * They hunt by nose, so the two labels that blind everybody else are the two they are best in.
     * What stops them is noise, a press hall is a dog with no ears, and anything that makes the
     * handler's job harder makes theirs impossible.
     */
    affinities: { dark: 7, foggy: 9, noisy: -7, eerie: -4 },
  },
  {
    id: 'juggernauts',
    name: 'Juggernauts',
    tier: 'heavy',
    blurb:
      'Fully augmented heavy assault units. Barely human any more, and no longer bothered by it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(12), structure('generator', 10), holds('gene_clinic')],
    cost: { caps: 700, supplies: 105, scrap: 300, oil: 200, highQualityMetal: 90 },
    trainSeconds: 900,
    supply: 6,
    stats: sheet({
      speed: 30,
      vitality: 435,
      morale: 85,
      armor: 78,
      resistances: { ballistic: 40, blade: 50, energy: -35 },
      penetration: 18,
      range: 45,
      offense: 425,
      evasion: 2,
      stealth: 2,
      lootCapacity: 50,
      intimidation: 75,
    }),
    modifiers: ['armor_piercing', 'last_stand'],
  },
  {
    id: 'hollow_men',
    name: 'Hollow Men',
    tier: 'heavy',
    blurb: 'Shock troops with the fear surgically removed. It took the rest of it with it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(13), structure('infirmary', 10), holds('gene_clinic')],
    cost: { caps: 650, supplies: 200, highQualityMetal: 70 },
    trainSeconds: 840,
    supply: 5,
    stats: sheet({
      speed: 55,
      vitality: 250,
      morale: 100,
      armor: 45,
      damageType: 'blade',
      resistances: { energy: -45 },
      penetration: 30,
      range: 15,
      offense: 390,
      evasion: 12,
      stealth: 20,
      lootCapacity: 30,
      intimidation: 70,
    }),
    modifiers: ['close_quarters', 'terror'],
    // The fear was removed surgically. So was most of the rest of it.
    immuneTo: ['eerie'],
  },
  {
    id: 'the_condemned',
    name: 'The Condemned',
    tier: 'rabble',
    blurb: 'Death row, handed one last chance and a blade. Nothing left to threaten them with.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(12), holds('fight_pit')],
    cost: { caps: 300, supplies: 120 },
    trainSeconds: 600,
    supply: 3,
    stats: sheet({
      speed: 48,
      vitality: 160,
      morale: 100,
      armor: 15,
      damageType: 'blade',
      penetration: 35,
      range: 10,
      offense: 340,
      evasion: 10,
      stealth: 15,
      lootCapacity: 25,
      intimidation: 60,
    }),
    modifiers: ['last_stand', 'close_quarters'],
    // Nothing left to threaten them with, which covers every room in the city.
    affinities: { eerie: 8, crammed: 5 },
  },

  // -------------------------------------------------------------- legendary
  {
    id: 'the_specter',
    name: 'The Specter',
    tier: 'legendary',
    blurb:
      'Experimental full-spectrum cloak. Invisible until it strikes, and then briefly visible.',
    trainedAt: 'lab',
    unique: true,
    requires: [structure('lab', 15), fitted('lab_shielded_datacore'), holds('satellite_uplink')],
    cost: { caps: 1500, supplies: 225, oil: 300, highQualityMetal: 250 },
    trainSeconds: 3600,
    supply: 8,
    stats: sheet({
      speed: 75,
      vitality: 300,
      morale: 90,
      armor: 35,
      damageType: 'energy',
      penetration: 80,
      range: 40,
      offense: 475,
      evasion: 60,
      stealth: 100,
      lootCapacity: 20,
      intimidation: 80,
    }),
    modifiers: ['ambush', 'night_operations'],
    /*
     * A full-spectrum cloak defeats eyes. It does nothing at all about ears, and that is what the
     * `noisy` affinity is: this sheet used to say the same thing twice, once here and once as a
     * vulnerability to sonic damage, which stopped meaning anything when the only unit that dealt
     * sonic left the roster. **The Specter now carries no resistances at all**, which makes it the
     * one legendary with no written weakness. Worth an answer eventually; it is not a regression,
     * because nothing has been able to exploit the old one since the Bell-Ringers went.
     */
    affinities: { dark: 10, eerie: 8, noisy: -8 },
  },
  {
    id: 'the_abomination',
    name: 'The Abomination',
    tier: 'legendary',
    blurb: 'A failed experiment that became a weapon. Unstable, devastating, and not steerable.',
    trainedAt: 'lab',
    unique: true,
    requires: [structure('lab', 16), structure('infirmary', 12), holds('mad_scientist_lair')],
    cost: { caps: 1400, supplies: 400, highQualityMetal: 200 },
    trainSeconds: 4200,
    supply: 10,
    stats: sheet({
      speed: 45,
      vitality: 700,
      morale: 100,
      armor: 55,
      damageType: 'chemical',
      resistances: { chemical: 100, ballistic: 30 },
      penetration: 50,
      range: 15,
      offense: 500,
      evasion: 5,
      stealth: 0,
      lootCapacity: 0,
      intimidation: 100,
    }),
    modifiers: ['terror', 'close_quarters'],
    // It breathes chlorine by preference and nothing about a room has ever unsettled it.
    immuneTo: ['toxic', 'eerie'],
    affinities: { cold: 4, crammed: 4 },
  },
  {
    id: 'the_colossus',
    name: 'The Colossus',
    tier: 'legendary',
    blurb: 'A single massive machine that functions like a walking fortress. It arrives slowly.',
    trainedAt: 'garage',
    unique: true,
    /**
     * A crane, and there are two in the city.
     *
     * Some things can only be assembled standing up, which is what a Construction Site is for. The
     * Spire has one and so does Datavault Sigma: deliberately, because for a while the Spire had
     * the only one, and the Spire is the *end* of the game: a legendary unit gated on the last
     * district anybody takes is a legendary unit nobody ever fields. Sigma is difficulty 6, which
     * puts the Colossus in the same band as the Specter and the Juggernaut.
     */
    requires: [structure('garage', 16), structure('generator', 14), holds('construction_site')],
    cost: { caps: 2200, supplies: 330, scrap: 900, oil: 600, highQualityMetal: 400 },
    trainSeconds: 5400,
    supply: 12,
    stats: sheet({
      speed: 18,
      vitality: 1000,
      morale: 95,
      armor: 95,
      damageType: 'explosive',
      resistances: { ballistic: 70, blade: 80, explosive: 40, energy: -30 },
      penetration: 25,
      range: 60,
      offense: 490,
      evasion: 0,
      stealth: 0,
      lootCapacity: 120,
      intimidation: 95,
    }),
    modifiers: ['breaching', 'armor_piercing'],
    // A walking fortress is a machine: it is not frightened and it does not breathe. What it is,
    // is enormous: it cannot get into half the ground on the map and it cooks in its own plate.
    immuneTo: ['eerie', 'toxic'],
    affinities: { crammed: -8, hot: -5, wet: -4 },
  },
  {
    id: 'the_saint',
    name: 'The Saint',
    tier: 'legendary',
    blurb: 'A legendary fighter whose presence alone steadies everyone who can see them.',
    trainedAt: 'gauntlet',
    unique: true,
    requires: [gauntlet(15), structure('quarters', 12), holds('tavern')],
    cost: { caps: 1200, supplies: 300, highQualityMetal: 120 },
    trainSeconds: 3000,
    supply: 6,
    stats: sheet({
      speed: 50,
      vitality: 265,
      morale: 100,
      armor: 30,
      damageType: 'blade',
      penetration: 20,
      range: 20,
      offense: 275,
      evasion: 25,
      stealth: 20,
      lootCapacity: 20,
      intimidation: 40,
    }),
    modifiers: ['last_stand', 'dug_in'],
  },
  {
    id: 'the_cartographer',
    name: 'The Cartographer',
    tier: 'legendary',
    blurb: 'Has walked every street in this city and remembers which ones are still there.',
    trainedAt: 'lab',
    unique: true,
    requires: [structure('lab', 12), holds('rail_yard'), holds('satellite_uplink')],
    cost: { caps: 1000, supplies: 150, oil: 150, highQualityMetal: 100 },
    trainSeconds: 2700,
    supply: 5,
    stats: sheet({
      speed: 88,
      vitality: 200,
      morale: 90,
      armor: 20,
      penetration: 15,
      range: 35,
      offense: 225,
      evasion: 40,
      stealth: 70,
      lootCapacity: 40,
      intimidation: 20,
    }),
    modifiers: ['urban_bonus', 'night_operations'],
  },
  /**
   * A specialist, sitting in the legendary block, and both halves of that are deliberate.
   *
   * The tier is what the game reads: `UNIT_TIERS` decides where it appears and `unitsInTier` who
   * it is priced against. It came down a tier because a machine you can only ever own one of is a
   * trophy, and this is meant to be the thing you put at the front of a line that has to hold,
   * which is a job you want to be able to do twice. Coming down the ladder costs it `unique`:
   * one-of-a-kind is what `legendary` *means* here, and `units.test.ts` holds the two together.
   *
   * The array position is untouched on purpose. A unit's art seed is its index in this array, so
   * moving it into the specialist block above would renumber every unit after it for the sake of
   * reading order in one file.
   */
  {
    id: 'the_twins',
    name: 'Twins',
    tier: 'wonder',
    blurb: 'One body, two minds, and neither of them sleeps. Nothing has ever got behind it.',
    trainedAt: 'lab',
    unique: false,
    /**
     * Built rather than hired, and built by somebody who should not have been allowed to.
     *
     * The Lab high enough to attempt it, and the two places in the city where that kind of work is
     * actually done: a Mad Scientist's Lair for the design and a Gene Clinic for the half of it
     * that is still meat. Two locations rather than one because it is the only legendary in the
     * game with no weapon on its sheet, and a unit that survives everything has to cost something
     * on the map rather than only in the stockpile.
     */
    requires: [structure('lab', 12), holds('mad_scientist_lair'), holds('gene_clinic')],
    cost: { caps: 460, supplies: 75, scrap: 190, oil: 90, highQualityMetal: 70 },
    trainSeconds: 520,
    supply: 4,
    /*
     * Brought down the ladder with the tier, not carried down it.
     *
     * The sheet was legendary scale, 420 vitality behind 78 armour, against a specialist band that
     * tops out at 80 and 25. Left alone it beat every other unit in the game at equal supply, which
     * `balance.test.ts` is there to forbid: a roster is a web and this was the top of a ladder.
     * What it keeps is the shape rather than the numbers, because the shape is the unit: heavy for
     * its tier, slow, almost impossible to move, and carrying almost no way to hurt anyone.
     */
    stats: sheet({
      speed: 30,
      vitality: 165,
      morale: 100,
      armor: 32,
      damageType: 'blade',
      resistances: { ballistic: 25, blade: 20, energy: -25 },
      penetration: 18,
      range: 10,
      offense: 170,
      evasion: 5,
      stealth: 0,
      lootCapacity: 60,
      intimidation: 60,
    }),
    // Two heads facing opposite ways is the whole design: it cannot be flanked and it cannot be
    // startled, so it is the thing you put at the front of a line that has to hold.
    modifiers: ['last_stand', 'night_operations'],
    // A machine with a face on each side. The dark is not a problem it has, and neither is fear.
    immuneTo: ['eerie', 'dark'],
    affinities: { crammed: -6, open: 4 },
  },

  // --------------------------------------------------------------- support
  //
  // Last in the file and first in the game, which is a seam rather than an ordering: the art
  // manifest derives a unit's seed from its **index in this array**, so a unit inserted anywhere
  // but the end renumbers every asset after it and orphans art that has already been made. New
  // units go here. Where they appear on screen is `UNIT_TIERS`, which puts support at the top.
  //
  // People who carry things. They are not soldiers and the game never pretends otherwise: they
  // cannot be deployed to a fight, they cannot hold ground, and on a battle mission they walk in
  // behind the people who can. What they are is the cheapest loot capacity in the game and the
  // only unit the Nexus itself signs, which makes a standard mission something a crew can run on
  // day one without spending a single body it might have wanted for a fight.
  {
    id: 'scavengers',
    name: 'Scavengers',
    tier: 'carrier',
    blurb:
      'They know which floors still hold weight and which pipes still have copper in them. Hand them a bag and point at a building.',
    trainedAt: 'nexus',
    unique: false,
    combat: false,
    requires: [],
    cost: { caps: 25, supplies: 15 },
    trainSeconds: 30,
    supply: 1,
    stats: sheet({
      // A little under average on the road, which is the trade: the biggest bag in the game on
      // the slowest legs that still count as quick.
      speed: 34,
      vitality: 60,
      morale: 45,
      armor: 0,
      penetration: 0,
      range: 0,
      // Not zero, because a zero would divide badly in more than one place downstream, and not
      // meaningful either: `combat: false` is what actually keeps them out of a fight.
      offense: 5,
      evasion: 20,
      stealth: 45,
      // Ten slots, which is the board's figure. Twice a Razor's and half again a Scraper's.
      lootCapacity: 10,
      intimidation: 0,
    }),
    modifiers: [],
  },
  {
    id: 'haulers',
    name: 'Haulers',
    tier: 'carrier',
    blurb:
      'Barrow, harness and a back that has done this for twenty years. Slow, patient, and they never come home light.',
    trainedAt: 'nexus',
    unique: false,
    combat: false,
    requires: [structure('nexus', 4)],
    cost: { caps: 60, supplies: 20, planks: 30 },
    trainSeconds: 90,
    supply: 2,
    stats: sheet({
      speed: 26,
      vitality: 75,
      morale: 50,
      armor: 2,
      penetration: 0,
      range: 0,
      offense: 5,
      evasion: 8,
      stealth: 25,
      lootCapacity: 30,
      intimidation: 0,
    }),
    modifiers: [],
  },

  /**
   * Appended, and it has to be: a unit's art seed is its index in this array, so a legendary filed
   * up in the legendary block would renumber every unit between there and here.
   *
   * A duellist rather than a brawler, and the sheet says so: the highest offense and evasion on the
   * roster against almost no armour and a body that a solid hit takes apart. Everything about it is
   * the first exchange. `close_quarters` because the thing was made for a ballroom and fights like
   * it, `terror` because people who have seen it work do not stay to see it twice.
   */
  {
    id: 'the_crimson_dancer',
    name: 'The Crimson Dancer',
    tier: 'legendary',
    blurb: 'Went into the Fight Pit a dancer and came out on blades. Still counts the beats.',
    trainedAt: 'gauntlet',
    unique: true,
    /**
     * Three clauses, as every legendary needs, and each one a different half of what it is: the
     * Gauntlet at the top for the fighter, a Lab deep enough to have built the legs, and the Fight
     * Pit, which is where it learned what they were for.
     */
    requires: [gauntlet(15), structure('lab', 12), holds('fight_pit')],
    cost: { caps: 1400, supplies: 260, oil: 180, highQualityMetal: 200 },
    trainSeconds: 3300,
    supply: 6,
    stats: sheet({
      speed: 92,
      vitality: 250,
      morale: 95,
      armor: 18,
      damageType: 'blade',
      // Blade limbs, so it goes through armour rather than around it, and it has nothing to
      // answer an explosion with: the frame is a dancer's, and it is meant to be brittle.
      resistances: { explosive: -35 },
      penetration: 70,
      range: 10,
      offense: 490,
      evasion: 88,
      stealth: 45,
      lootCapacity: 15,
      intimidation: 85,
    }),
    modifiers: ['close_quarters', 'terror'],
    // A hall with a floor to work on. Mud and a crowd both take the footing away.
    affinities: { open: 6, crammed: -6, wet: -5 },
  },

  /**
   * Appended for the same reason the Dancer is: a unit's art seed is its index in this array.
   *
   * The gap in the roster this fills is *reach on a body that can take a hit*. Everything tanky was
   * melee, at 10 to 15, and everything with range was made of paper: a Sniper reaches 95 behind 45
   * vitality and 8 armour. A slug gun is 30, which is further than anything can walk in the time it
   * takes to fire twice and nowhere near far enough to sit at the back, so it holds a line and
   * shoots off it. `dug_in` because that is the job, `armor_piercing` because a slug is what you
   * load when the other side turned up in plate.
   */
  {
    id: 'sluggers',
    name: 'Sluggers',
    tier: 'heavy',
    blurb: 'Scrap plate and a short slug gun. Stands where it is put and makes the room expensive.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(6), structure('scrapyard', 4)],
    cost: { caps: 210, supplies: 30, scrap: 110, highQualityMetal: 8 },
    trainSeconds: 230,
    supply: 2,
    stats: sheet({
      speed: 32,
      vitality: 190,
      morale: 70,
      armor: 42,
      damageType: 'ballistic',
      penetration: 24,
      range: 30,
      offense: 260,
      evasion: 8,
      stealth: 10,
      lootCapacity: 25,
      intimidation: 35,
    }),
    modifiers: ['dug_in', 'armor_piercing'],
    // A slug spreads. Ground that keeps the other side in front of you is worth more than ground
    // that lets them come round.
    affinities: { crammed: 5, open: -4 },
  },

  /**
   * Appended, like the two above it: a unit's art seed is its index in this array.
   *
   * The top of the damage scale, and the sheet is built so that being the top of it is survivable
   * for everyone else. 700 is two thirds again what the Abomination hits for, on 200 hit points and
   * 8 points of plate: anything that lands on this connects, and one Colossus round is most of it.
   * What it trades that for is not being *there* when the shot arrives, which is what 92 evasion
   * buys under the miss rule (`battle/matchup.ts`): forty-six attacks in a hundred go past.
   *
   * That makes it the one unit whose worth depends on what is shooting at it rather than on how
   * much of it there is, which is the point of a legendary. A wall of Wardens plinks off it all
   * day; one lucky Demolisher round ends it.
   */
  {
    id: 'the_loose_end',
    name: 'The Loose End',
    tier: 'legendary',
    blurb: 'Walked out of a contract nobody walks out of. The chain-blade was the severance.',
    trainedAt: 'gauntlet',
    unique: true,
    /**
     * A Gauntlet at the top, a Garage that can keep a powered blade fed, and a rail yard, which is
     * where somebody who has to keep moving ends up and where the contract finally lapsed.
     */
    requires: [gauntlet(16), structure('garage', 12), holds('rail_yard')],
    cost: { caps: 1600, supplies: 240, oil: 220, highQualityMetal: 260 },
    trainSeconds: 3600,
    supply: 7,
    stats: sheet({
      speed: 95,
      vitality: 200,
      morale: 90,
      armor: 8,
      damageType: 'blade',
      // A powered edge answers plate and nothing answers a blast: there is no armour to hide in
      // and the whole sheet is built on not being hit.
      resistances: { explosive: -40, ballistic: 15 },
      penetration: 85,
      range: 15,
      offense: 700,
      evasion: 92,
      stealth: 60,
      lootCapacity: 20,
      intimidation: 80,
    }),
    modifiers: ['close_quarters', 'ambush'],
    // Room to move is the whole sheet. Shoulder to shoulder, evasion is worth nothing.
    affinities: { open: 8, crammed: -10 },
  },
];

const BY_ID = new Map(UNIT_CATALOG.map((unit) => [unit.id, unit]));

/**
 * Whether this unit can be put in a battle line at all (§A5).
 *
 * The one question every force-picker, deploy route and battle setup asks before it accepts a
 * unit id. Written as a helper rather than read off `spec.combat` at each site so the default for
 * a unit that predates the field lives in exactly one place.
 */
export function isCombatUnit(unit: UnitSpec | string | undefined): boolean {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  return spec ? spec.combat !== false : false;
}

/** The other half: people who carry, and who may only ever go on a mission. */
export function isSupportUnit(unit: UnitSpec | string | undefined): boolean {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  return spec ? spec.combat === false : false;
}

export function findUnit(unitId: string): UnitSpec | undefined {
  return BY_ID.get(unitId);
}

export function isUnitId(value: string): boolean {
  return BY_ID.has(value);
}

export const UNIT_IDS: readonly string[] = UNIT_CATALOG.map((unit) => unit.id);

/** Validated against the catalogue rather than declared as an enum of literals: one list. */
export const UnitIdSchema = z.string().refine(isUnitId, { message: 'unknown unit' });

export function unitsInTier(tier: UnitTier): UnitSpec[] {
  return UNIT_CATALOG.filter((unit) => unit.tier === tier);
}

/** Which units holding a location of this kind would open up: read back off the requirements. */
export function unitsUnlockedByLocation(locationKind: LocationKind): UnitSpec[] {
  return UNIT_CATALOG.filter((unit) =>
    unit.requires.some((need) => need.kind === 'location' && need.locationKind === locationKind),
  );
}

/**
 * Guards the catalogue at module load.
 *
 * A requirement naming a modification or a location kind that does not exist is a unit nobody can
 * ever field, and the only symptom would be a permanently greyed row. Cheaper to trip here.
 */
for (const unit of UNIT_CATALOG) {
  if (!BUILDING_KINDS.includes(unit.trainedAt)) {
    throw new Error(`${unit.id} is trained at ${unit.trainedAt}, which is not a structure`);
  }
  if (unit.tier === 'legendary' && !unit.unique) {
    throw new Error(`${unit.id} is legendary but not unique`);
  }
  for (const need of unit.requires) {
    if (need.kind === 'modification' && !findModification(need.modificationId)) {
      throw new Error(`${unit.id} needs ${need.modificationId}, which is not a modification`);
    }
    if (need.kind === 'location' && !LOCATION_KINDS.includes(need.locationKind)) {
      throw new Error(`${unit.id} needs a ${need.locationKind}, which is not a location kind`);
    }
    if (need.kind === 'building' && !BUILDING_KINDS.includes(need.building)) {
      throw new Error(`${unit.id} needs a ${need.building}, which is not a structure`);
    }
  }
  for (const modifier of unit.modifiers) {
    if (!UNIT_MODIFIERS[modifier]) {
      throw new Error(`${unit.id} carries ${modifier}, which is not a modifier`);
    }
  }
  for (const id of Object.keys(unit.affinities ?? {})) {
    if (!ENV_LABEL_IDS.includes(id as EnvLabelId)) {
      throw new Error(`${unit.id} has an affinity for ${id}, which is not an environment label`);
    }
  }
  for (const id of unit.immuneTo ?? []) {
    if (!ENV_LABEL_IDS.includes(id)) {
      throw new Error(`${unit.id} is immune to ${id}, which is not an environment label`);
    }
  }
}

if (BY_ID.size !== UNIT_CATALOG.length) throw new Error('two units share an id');
