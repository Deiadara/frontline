import { z } from 'zod';
import { BUILDING_KINDS, findModification, type BuildingKind } from '../building/index.js';
import { PLACE_KINDS, type PlaceKind } from '../city/places.js';
import type { PartialResources } from '../resources.js';
import { UNIT_MODIFIERS, type UnitModifierId, type UnitStats } from './stats.js';

/**
 * The battle units (GDD §A5).
 *
 * Five tiers, and what separates them is not only power — it is **what you had to do with the
 * world to get them**. Rabble needs a Gauntlet, or in one case nothing at all. Specialists need
 * something researched or a specific augment fitted. Heavy units need a clinic you took off
 * somebody. Legendary units need a place on the map *and* a structure at the top of its tree: the
 * Colossus is built out of a war machine graveyard because that is where the hulls are.
 *
 * That is the whole design intent of the requirement list below — a unit roster is a readout of a
 * campaign, not a shopping list.
 */

export const UNIT_TIERS = ['rabble', 'regular', 'specialist', 'heavy', 'legendary'] as const;
export const UnitTierSchema = z.enum(UNIT_TIERS);
export type UnitTier = z.infer<typeof UnitTierSchema>;

export const UNIT_TIER_LABELS: Record<UnitTier, string> = {
  rabble: 'Rabble',
  regular: 'Regulars',
  specialist: 'Specialists',
  heavy: 'Heavy',
  legendary: 'Legendary',
};

/**
 * One condition on fielding a unit. **All** of a unit's clauses must hold.
 *
 * Three kinds, and between them they cover everything the design asks for: "enough Gauntlet
 * levels", "a strong enough Generator", "researched it in the Lab" and "a certain augment fitted"
 * are all `building` or `modification`; "there is a factory in another district that makes them"
 * is `place`.
 */
export type UnitRequirement =
  | { kind: 'building'; building: BuildingKind; level: number }
  | { kind: 'modification'; modificationId: string }
  | { kind: 'place'; placeKind: PlaceKind };

export interface UnitSpec {
  id: string;
  name: string;
  tier: UnitTier;
  blurb: string;
  /** The structure that runs the work. Most units are trained; a few are *made*. */
  trainedAt: BuildingKind;
  /** Legendary units are one of a kind. You hold one or none. */
  unique: boolean;
  requires: readonly UnitRequirement[];
  cost: PartialResources;
  trainSeconds: number;
  /** What one costs against the standing army cap. A Colossus is not one soldier. */
  supply: number;
  stats: UnitStats;
  modifiers: readonly UnitModifierId[];
}

/** The middle of the road. Every unit below states only what makes it different from this. */
const BASE_STATS: UnitStats = {
  speed: 40,
  vitality: 60,
  morale: 50,
  armor: 10,
  damageType: 'ballistic',
  resistances: {},
  lethality: 5,
  range: 30,
  offense: 35,
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
const holds = (placeKind: PlaceKind): UnitRequirement => ({ kind: 'place', placeKind });

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
     * Nothing at all — the only unit in the game with no requirement.
     *
     * A crew that has not built a Gauntlet yet must still be able to put *somebody* on the street,
     * or the first session has no move in it: the opening district holds a Nexus and a Generator,
     * and a roster that was entirely locked behind a barracks would make the whole city
     * unreachable until one was standing.
     */
    requires: [],
    cost: { caps: 40, food: 10 },
    trainSeconds: 45,
    supply: 1,
    stats: sheet({
      speed: 55,
      vitality: 45,
      morale: 40,
      armor: 5,
      damageType: 'blade',
      lethality: 8,
      range: 5,
      offense: 32,
      evasion: 15,
      stealth: 30,
      lootCapacity: 25,
      intimidation: 8,
    }),
    modifiers: ['urban_bonus', 'close_quarters'],
  },
  {
    id: 'sparks',
    name: 'Sparks',
    tier: 'rabble',
    blurb: 'Young recruits with jury-rigged weapons. Hit hard once, then hope.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(1)],
    cost: { caps: 45, scrap: 20 },
    trainSeconds: 50,
    supply: 1,
    stats: sheet({
      speed: 45,
      vitality: 30,
      morale: 30,
      armor: 3,
      lethality: 18,
      range: 45,
      offense: 48,
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
    cost: { caps: 50, scrap: 25 },
    trainSeconds: 55,
    supply: 1,
    stats: sheet({
      speed: 70,
      vitality: 40,
      morale: 45,
      armor: 6,
      damageType: 'blade',
      lethality: 10,
      range: 10,
      offense: 28,
      evasion: 25,
      stealth: 40,
      lootCapacity: 60,
      intimidation: 5,
    }),
    modifiers: ['urban_bonus', 'ambush'],
  },
  {
    id: 'muckrakers',
    name: 'Muckrakers',
    tier: 'rabble',
    blurb:
      'Sewer crawlers who came up carrying. Poor in a fight, unmatched at leaving with things.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(2)],
    cost: { caps: 60, food: 20 },
    trainSeconds: 60,
    supply: 1,
    stats: sheet({
      speed: 35,
      vitality: 45,
      morale: 40,
      armor: 8,
      damageType: 'blade',
      lethality: 4,
      range: 5,
      offense: 18,
      evasion: 12,
      stealth: 55,
      lootCapacity: 110,
      intimidation: 3,
    }),
    modifiers: ['tunnel_rat', 'night_operations'],
  },

  // --------------------------------------------------------------- regulars
  {
    id: 'breakers',
    name: 'Breakers',
    tier: 'regular',
    blurb: 'Door-kicking close-quarters specialists. Whatever is behind it, they go through it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(4)],
    cost: { caps: 120, scrap: 60, oil: 15 },
    trainSeconds: 150,
    supply: 2,
    stats: sheet({
      speed: 45,
      vitality: 90,
      morale: 60,
      armor: 30,
      damageType: 'explosive',
      lethality: 12,
      range: 15,
      offense: 55,
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
    tier: 'regular',
    blurb: 'Defensive specialists. Considerably better at holding a place than at taking one.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(4)],
    cost: { caps: 130, scrap: 80 },
    trainSeconds: 160,
    supply: 2,
    stats: sheet({
      speed: 30,
      vitality: 110,
      morale: 70,
      armor: 45,
      resistances: { blade: 25, explosive: -20 },
      lethality: 6,
      range: 40,
      offense: 38,
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
    tier: 'regular',
    blurb: 'Lightly armed infiltrators. The problem is not fighting them — it is finding them.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(5)],
    cost: { caps: 160, oil: 20 },
    trainSeconds: 180,
    supply: 2,
    stats: sheet({
      speed: 60,
      vitality: 55,
      morale: 55,
      armor: 10,
      damageType: 'blade',
      lethality: 25,
      range: 15,
      offense: 42,
      evasion: 35,
      stealth: 85,
      lootCapacity: 25,
      intimidation: 5,
    }),
    modifiers: ['night_operations', 'ambush'],
  },
  {
    id: 'road_reavers',
    name: 'Road Reavers',
    tier: 'regular',
    blurb: 'Motorcycle raiders. Fast, loud, aggressive, and halfway home with your fuel.',
    trainedAt: 'garage',
    unique: false,
    requires: [gauntlet(5), structure('garage', 4)],
    cost: { caps: 180, scrap: 90, oil: 60 },
    trainSeconds: 200,
    supply: 2,
    stats: sheet({
      speed: 92,
      vitality: 70,
      morale: 55,
      armor: 18,
      lethality: 14,
      range: 35,
      offense: 50,
      evasion: 30,
      stealth: 10,
      lootCapacity: 70,
      intimidation: 35,
    }),
    modifiers: ['open_field', 'urban_bonus'],
  },
  {
    id: 'ironsides',
    name: 'Ironsides',
    tier: 'regular',
    blurb: 'A shield wall of salvaged plate. Slow, immovable, and very hard to be rid of.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(6), structure('scrapyard', 5)],
    cost: { caps: 200, scrap: 140, highQualityMetal: 10 },
    trainSeconds: 240,
    supply: 3,
    stats: sheet({
      speed: 25,
      vitality: 140,
      morale: 75,
      armor: 60,
      damageType: 'blade',
      resistances: { ballistic: 30, blade: 30, explosive: -30 },
      lethality: 5,
      range: 10,
      offense: 40,
      evasion: 3,
      stealth: 5,
      lootCapacity: 25,
      intimidation: 40,
    }),
    modifiers: ['dug_in', 'close_quarters'],
  },
  {
    id: 'ash_walkers',
    name: 'Ash Walkers',
    tier: 'regular',
    blurb: 'Chem-suited troops who go where the air is wrong and come back out of it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(6), structure('cistern', 5)],
    cost: { caps: 190, scrap: 70, oil: 40 },
    trainSeconds: 220,
    supply: 2,
    stats: sheet({
      speed: 38,
      vitality: 85,
      morale: 65,
      armor: 35,
      damageType: 'chemical',
      resistances: { chemical: 90, blade: -25 },
      lethality: 8,
      range: 25,
      offense: 45,
      evasion: 8,
      stealth: 15,
      lootCapacity: 30,
      intimidation: 25,
    }),
    modifiers: ['tunnel_rat'],
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
    cost: { caps: 260, scrap: 60, highQualityMetal: 12 },
    trainSeconds: 300,
    supply: 2,
    stats: sheet({
      speed: 35,
      vitality: 45,
      morale: 60,
      armor: 8,
      lethality: 60,
      range: 95,
      offense: 70,
      evasion: 12,
      stealth: 60,
      lootCapacity: 10,
      intimidation: 25,
    }),
    modifiers: ['rooftop', 'open_field'],
  },
  {
    id: 'stitchers',
    name: 'Stitchers',
    tier: 'specialist',
    blurb: 'Field medics. Contribute nothing to a fight and decide how many walk out of it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(7), structure('infirmary', 5)],
    cost: { caps: 220, food: 60 },
    trainSeconds: 280,
    supply: 2,
    stats: sheet({
      speed: 40,
      vitality: 60,
      morale: 70,
      armor: 12,
      damageType: 'blade',
      lethality: 2,
      range: 10,
      offense: 12,
      evasion: 15,
      stealth: 25,
      lootCapacity: 20,
      intimidation: 2,
    }),
    modifiers: ['dug_in'],
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
    cost: { caps: 280, scrap: 120, oil: 80, highQualityMetal: 15 },
    trainSeconds: 330,
    supply: 3,
    stats: sheet({
      speed: 30,
      vitality: 80,
      morale: 55,
      armor: 25,
      damageType: 'explosive',
      lethality: 20,
      range: 40,
      offense: 65,
      evasion: 6,
      stealth: 10,
      lootCapacity: 25,
      intimidation: 45,
    }),
    modifiers: ['breaching', 'armor_piercing'],
  },
  {
    id: 'jammers',
    name: 'Jammers',
    tier: 'specialist',
    blurb: 'Electronic warfare. The enemy is still there — they just cannot hear each other.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(8), structure('lab', 6)],
    cost: { caps: 300, highQualityMetal: 20 },
    trainSeconds: 320,
    supply: 2,
    stats: sheet({
      speed: 40,
      vitality: 55,
      morale: 60,
      armor: 15,
      damageType: 'energy',
      lethality: 5,
      range: 60,
      offense: 25,
      evasion: 18,
      stealth: 45,
      lootCapacity: 10,
      intimidation: 15,
    }),
    modifiers: ['night_operations'],
  },
  {
    id: 'kite_crews',
    name: 'Kite Crews',
    tier: 'specialist',
    blurb: 'Drone operators working off rooftops. They see the fight before anybody is in it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(8), structure('lab', 5)],
    cost: { caps: 280, scrap: 40, highQualityMetal: 18 },
    trainSeconds: 310,
    supply: 2,
    stats: sheet({
      speed: 55,
      vitality: 50,
      morale: 55,
      armor: 10,
      damageType: 'energy',
      lethality: 12,
      range: 75,
      offense: 38,
      evasion: 22,
      stealth: 50,
      lootCapacity: 12,
      intimidation: 10,
    }),
    modifiers: ['rooftop', 'open_field'],
  },
  {
    id: 'netrunners',
    name: 'Netrunners',
    tier: 'specialist',
    blurb: 'Combat hackers who hijack enemy augmentations mid-fight. Nobody enjoys meeting them.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(9), structure('lab', 8), fitted('lab_quantum_modeling')],
    cost: { caps: 360, highQualityMetal: 30 },
    trainSeconds: 380,
    supply: 3,
    stats: sheet({
      speed: 42,
      vitality: 50,
      morale: 65,
      armor: 12,
      damageType: 'energy',
      lethality: 35,
      range: 55,
      offense: 55,
      evasion: 20,
      stealth: 55,
      lootCapacity: 10,
      intimidation: 20,
    }),
    modifiers: ['night_operations', 'armor_piercing'],
  },
  {
    id: 'sleepers',
    name: 'Sleepers',
    tier: 'specialist',
    blurb: 'Planted long ago, and useful exactly once. They are already inside.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(9), fitted('nexus_encrypted_core')],
    cost: { caps: 340, oil: 30 },
    trainSeconds: 360,
    supply: 2,
    stats: sheet({
      speed: 45,
      vitality: 50,
      morale: 75,
      armor: 10,
      damageType: 'blade',
      lethality: 45,
      range: 10,
      offense: 50,
      evasion: 25,
      stealth: 95,
      lootCapacity: 15,
      intimidation: 10,
    }),
    modifiers: ['ambush', 'urban_bonus'],
  },
  {
    id: 'bell_ringers',
    name: 'Bell-Ringers',
    tier: 'specialist',
    blurb: 'Sonic warfare on a flatbed. They do not kill people so much as end their afternoon.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(10), holds('broadcast_tower')],
    cost: { caps: 380, scrap: 60, highQualityMetal: 25 },
    trainSeconds: 400,
    supply: 3,
    stats: sheet({
      speed: 35,
      vitality: 65,
      morale: 70,
      armor: 18,
      damageType: 'sonic',
      lethality: 8,
      range: 50,
      offense: 32,
      evasion: 10,
      stealth: 12,
      lootCapacity: 15,
      intimidation: 85,
    }),
    modifiers: ['terror'],
  },
  {
    id: 'wrecking_crew',
    name: 'Wrecking Crew',
    tier: 'specialist',
    blurb: 'Siege work. Slow to arrive, and then the fortification stops being one.',
    trainedAt: 'garage',
    unique: false,
    requires: [gauntlet(10), structure('garage', 8)],
    cost: { caps: 420, scrap: 220, oil: 120, highQualityMetal: 35 },
    trainSeconds: 450,
    supply: 4,
    stats: sheet({
      speed: 22,
      vitality: 120,
      morale: 60,
      armor: 40,
      damageType: 'explosive',
      lethality: 15,
      range: 35,
      offense: 75,
      evasion: 4,
      stealth: 6,
      lootCapacity: 40,
      intimidation: 50,
    }),
    modifiers: ['breaching', 'armor_piercing'],
  },

  // ------------------------------------------------------------------ heavy
  {
    id: 'juggernauts',
    name: 'Juggernauts',
    tier: 'heavy',
    blurb:
      'Fully augmented heavy assault units. Barely human any more, and no longer bothered by it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(12), structure('generator', 10), holds('gene_clinic')],
    cost: { caps: 700, scrap: 300, oil: 200, highQualityMetal: 90 },
    trainSeconds: 900,
    supply: 6,
    stats: sheet({
      speed: 30,
      vitality: 260,
      morale: 85,
      armor: 78,
      resistances: { ballistic: 40, blade: 50, energy: -35 },
      lethality: 18,
      range: 45,
      offense: 85,
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
    cost: { caps: 650, food: 200, highQualityMetal: 70 },
    trainSeconds: 840,
    supply: 5,
    stats: sheet({
      speed: 55,
      vitality: 150,
      morale: 100,
      armor: 45,
      damageType: 'blade',
      resistances: { sonic: 80, energy: -45 },
      lethality: 30,
      range: 15,
      offense: 78,
      evasion: 12,
      stealth: 20,
      lootCapacity: 30,
      intimidation: 70,
    }),
    modifiers: ['close_quarters', 'terror'],
  },
  {
    id: 'the_condemned',
    name: 'The Condemned',
    tier: 'heavy',
    blurb: 'Death row, handed one last chance and a blade. Nothing left to threaten them with.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(12), holds('fight_pit')],
    cost: { caps: 300, food: 120 },
    trainSeconds: 600,
    supply: 3,
    stats: sheet({
      speed: 48,
      vitality: 95,
      morale: 100,
      armor: 15,
      damageType: 'blade',
      lethality: 35,
      range: 10,
      offense: 68,
      evasion: 10,
      stealth: 15,
      lootCapacity: 25,
      intimidation: 60,
    }),
    modifiers: ['last_stand', 'close_quarters'],
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
    cost: { caps: 1500, oil: 300, highQualityMetal: 250 },
    trainSeconds: 3600,
    supply: 8,
    stats: sheet({
      speed: 75,
      vitality: 180,
      morale: 90,
      armor: 35,
      damageType: 'energy',
      lethality: 80,
      range: 40,
      offense: 95,
      evasion: 60,
      stealth: 100,
      lootCapacity: 20,
      intimidation: 80,
      // A full-spectrum cloak defeats eyes. It does nothing at all about ears.
      resistances: { sonic: -40 },
    }),
    modifiers: ['ambush', 'night_operations'],
  },
  {
    id: 'the_abomination',
    name: 'The Abomination',
    tier: 'legendary',
    blurb: 'A failed experiment that became a weapon. Unstable, devastating, and not steerable.',
    trainedAt: 'lab',
    unique: true,
    requires: [structure('lab', 16), structure('infirmary', 12), holds('gene_clinic')],
    cost: { caps: 1400, food: 400, highQualityMetal: 200 },
    trainSeconds: 4200,
    supply: 10,
    stats: sheet({
      speed: 45,
      vitality: 420,
      morale: 100,
      armor: 55,
      damageType: 'chemical',
      resistances: { chemical: 100, ballistic: 30, sonic: -30 },
      lethality: 50,
      range: 15,
      offense: 100,
      evasion: 5,
      stealth: 0,
      lootCapacity: 0,
      intimidation: 100,
    }),
    modifiers: ['terror', 'close_quarters'],
  },
  {
    id: 'the_colossus',
    name: 'The Colossus',
    tier: 'legendary',
    blurb: 'A single massive machine that functions like a walking fortress. It arrives slowly.',
    trainedAt: 'garage',
    unique: true,
    requires: [structure('garage', 16), structure('generator', 14), holds('war_machine_graveyard')],
    cost: { caps: 2200, scrap: 900, oil: 600, highQualityMetal: 400 },
    trainSeconds: 5400,
    supply: 12,
    stats: sheet({
      speed: 18,
      vitality: 600,
      morale: 95,
      armor: 95,
      damageType: 'explosive',
      resistances: { ballistic: 70, blade: 80, explosive: 40, energy: -30 },
      lethality: 25,
      range: 60,
      offense: 98,
      evasion: 0,
      stealth: 0,
      lootCapacity: 120,
      intimidation: 95,
    }),
    modifiers: ['breaching', 'armor_piercing'],
  },
  {
    id: 'the_saint',
    name: 'The Saint',
    tier: 'legendary',
    blurb: 'A legendary fighter whose presence alone steadies everyone who can see them.',
    trainedAt: 'gauntlet',
    unique: true,
    requires: [gauntlet(15), structure('quarters', 12), holds('fight_pit')],
    cost: { caps: 1200, food: 300, highQualityMetal: 120 },
    trainSeconds: 3000,
    supply: 6,
    stats: sheet({
      speed: 50,
      vitality: 160,
      morale: 100,
      armor: 30,
      damageType: 'blade',
      lethality: 20,
      range: 20,
      offense: 55,
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
    cost: { caps: 1000, oil: 150, highQualityMetal: 100 },
    trainSeconds: 2700,
    supply: 5,
    stats: sheet({
      speed: 88,
      vitality: 120,
      morale: 90,
      armor: 20,
      lethality: 15,
      range: 35,
      offense: 45,
      evasion: 40,
      stealth: 70,
      lootCapacity: 40,
      intimidation: 20,
    }),
    modifiers: ['urban_bonus', 'night_operations'],
  },
];

const BY_ID = new Map(UNIT_CATALOG.map((unit) => [unit.id, unit]));

export function findUnit(unitId: string): UnitSpec | undefined {
  return BY_ID.get(unitId);
}

export function isUnitId(value: string): boolean {
  return BY_ID.has(value);
}

export const UNIT_IDS: readonly string[] = UNIT_CATALOG.map((unit) => unit.id);

/** Validated against the catalogue rather than declared as an enum of literals — one list. */
export const UnitIdSchema = z.string().refine(isUnitId, { message: 'unknown unit' });

export function unitsInTier(tier: UnitTier): UnitSpec[] {
  return UNIT_CATALOG.filter((unit) => unit.tier === tier);
}

/** Which units holding a place of this kind would open up — read back off the requirements. */
export function unitsUnlockedByPlace(placeKind: PlaceKind): UnitSpec[] {
  return UNIT_CATALOG.filter((unit) =>
    unit.requires.some((need) => need.kind === 'place' && need.placeKind === placeKind),
  );
}

/**
 * Guards the catalogue at module load.
 *
 * A requirement naming a modification or a place kind that does not exist is a unit nobody can
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
    if (need.kind === 'place' && !PLACE_KINDS.includes(need.placeKind)) {
      throw new Error(`${unit.id} needs a ${need.placeKind}, which is not a place kind`);
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
}

if (BY_ID.size !== UNIT_CATALOG.length) throw new Error('two units share an id');
