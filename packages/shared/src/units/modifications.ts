import type { ItemCost } from '../items/inventory.js';
import type { PartialResources } from '../resources.js';
import { findUnit } from './catalog.js';
import { UNIT_RATING_KEYS, UNIT_STAT_KEYS, type UnitStats } from './stats.js';
import type { ModificationRarity as UnitModificationRarity } from '../modification-rarity.js';

/**
 * Unit modifications (maintainer, 2026-09-15): thirty cards, no ladder.
 *
 * This replaced the twelve tiered refits that `upgrades.ts` used to hold. A refit was a rung: four
 * lines, three tiers each, and tier N could not be built until tier N-1 was. That made the whole
 * catalogue one decision taken four times, because nobody ever chose *not* to buy the next rung in
 * a line they had already started. A modification is a card. There is no rung above it and none
 * below it, so what a player is choosing is which thirty-odd points of sheet this crew is, and the
 * answer is different for a Scavenger and for a Juggernaut.
 *
 * The rules that every door shares live next to this catalogue rather than in it: `upgrades.ts`
 * says whether the yard will cut a card (`upgradeRefusal`) and what a fitted set does to a sheet
 * (`upgradedStats`), and `loadout.ts` says which three of the crew's cards are on which unit.
 *
 * ## Rarity is a label on the numbers, and the yard's ladder reads it
 *
 * BASIC, INTRICATE, ADVANCED, MASTERPIECE. A player reads the word and knows roughly what the card
 * is worth before reading a single delta. Nothing in this module refuses a card because of its
 * rarity, and a masterpiece is not built out of an advanced one; the one thing the word gates is
 * the Scrapyard level a card opens at (`building/scrapyard.ts`, `SCRAPYARD_LEVEL_FOR_RARITY`),
 * which is a fact about the yard rather than about the card.
 *
 * The word has to be honest or it is worse than nothing, so the numbers are authored against
 * {@link UNIT_MODIFICATION_RARITY_BANDS}: a declared power range per rarity, with gaps between the
 * bands, checked card by card in `modifications.test.ts`. {@link unitModificationPower} is the
 * measure. Ratings count a point per point; damage, hit points and loot count at a quarter,
 * because those three are open figures rather than scores out of a hundred and +20 damage on a
 * Colossus is not worth what +20 evasion is on anything.
 *
 * Costs climb with the band too, and the same test holds it: no card in one band costs less scrap
 * than the dearest card in the band below, and high-quality metal starts at INTRICATE.
 *
 * ## Three are open, twenty-seven are drawings
 *
 * Taped Grips, Scrap Vest and Broken-In Boots are tape, offcuts and second-hand boots. A crew that
 * has just taken its first plot can build all three, which is what keeps the mechanic visible
 * before the mission board is. Everything else needs a blueprint document, the same §D12 mechanism
 * that gates units, vehicles and traps: the document declares its `targets` in
 * `blueprints/catalog.ts` (`bp_mod_*`, one per gated card) and
 * `blueprintGateMet(inventory, 'unit_upgrade', id)` answers.
 *
 * This module cannot read those documents itself: it sits below `blueprints/` in the import graph
 * and takes the answer as a predicate ({@link UnitModificationBlueprintGate}).
 * `blueprints/unit-modifications.test.ts` holds that every gated card has exactly one document
 * and every open card has none, so the predicate a caller passes is the real gate.
 *
 * ## Who can be fitted with what
 *
 * {@link UnitModificationSpec.fits} is the same idiom `building/modifications.ts` uses for its
 * cross-building cards: absent means every unit, present means exactly those. Ten of the thirty
 * are restricted, and each one is restricted for a reason a player can see on the sheet. A
 * Counterweight Harness is a bigger bag on a better frame and there is nothing to put it on
 * except a carrier.
 *
 * Legendary units take nothing at all. That is the maintainer's rule and it lives in
 * {@link modificationFitsUnit} rather than in a screen, because the Scrapyard is not the only
 * thing that asks: `loadout.ts` refuses the fit (`does_not_fit`), and the roster payload lists
 * the cards each unit can take so the screen can grey the rest.
 *
 * ## The hundred-point ceiling
 *
 * Every rating is out of 100 and `upgradedStats` clamps into 0..100 on the way out. Two things in
 * this catalogue are authored against that rather than left to the clamp:
 *
 * - No card moves a rating by more than its band's ceiling (6, 12, 20, 24 points). A card with a
 *   delta larger than that is a balance change that reads as a bug on a bar drawn past the end of
 *   its own track.
 * - Every negative delta in the catalogue is on `speed` or `morale`, and the whole catalogue at
 *   once takes 10 points of speed and 4 of morale. The lowest non-legendary sheet in the game is
 *   Ironsides on 22 speed and Sparks on 30 morale, so nothing here can drive a rating to the floor
 *   even fitted all at once. `modifications.test.ts` measures that on the raw sum, before the
 *   clamp, which is the only place it can fail.
 *
 * The top half is held by the clamp and by the three brackets (`UNIT_UPGRADE_SLOTS`). It cannot be
 * held on the raw sum: three units sit on 100 morale and Sleepers on 95 stealth, so any card that
 * adds either is past the ceiling on them before the clamp. `modifications.test.ts` pins the set of
 * unit-and-rating pairs where the three best eligible cards overshoot, so a retune cannot widen it
 * quietly.
 */

/**
 * The four words, owned by `modification-rarity.ts` and shared with the building catalogue.
 *
 * Re-exported under the names this module first shipped them with, so nothing that already reads
 * `UNIT_MODIFICATION_RARITIES` has to move. The vocabulary itself moved out because
 * `building/modifications.ts` needs the same four words and cannot import them from here:
 * `units/` already imports `building/`, and the other direction would be a cycle.
 */
export {
  MODIFICATION_RARITIES as UNIT_MODIFICATION_RARITIES,
  ModificationRaritySchema as UnitModificationRaritySchema,
  MODIFICATION_RARITY_LABELS as UNIT_MODIFICATION_RARITY_LABELS,
} from '../modification-rarity.js';
export type { UnitModificationRarity };

export const UNIT_MODIFICATION_RARITY_BLURBS: Readonly<Record<UnitModificationRarity, string>> = {
  basic: 'Offcuts, tape and drill. Anybody can make one and everybody has.',
  intricate: 'Somebody who knows the work, with the right stock in front of them.',
  advanced: 'Engineering. It goes wrong when it is rushed and it is expensive when it is not.',
  masterpiece: 'One of these turns up a year. The people who can build them are known by name.',
};

export interface UnitModificationSpec {
  id: string;
  name: string;
  description: string;
  /** Flat changes to the sheet of every unit this is fitted to. Same shape the refits use. */
  effect: Partial<UnitStats>;
  rarity: UnitModificationRarity;
  /**
   * Whether the yard needs the drawings before it can cut one.
   *
   * True for twenty-seven of the thirty. Explicit on every card rather than defaulted, because the
   * dangerous direction is the open one: a card that forgot the field would ship buildable on day
   * one. The three that are false are the three simplest cards in the catalogue.
   */
  requiresBlueprint: boolean;
  /**
   * Scrap always, high-quality metal from INTRICATE up. Nothing else.
   *
   * §B9: these are built in the Scrapyard and the Scrapyard's page shows two resources.
   */
  cost: PartialResources;
  /** Components, consumed on build. */
  parts: ItemCost;
  /**
   * Every unit this will go on. Absent means all of them.
   *
   * Ids as plain strings, the way `blueprints/catalog.ts` names its targets: the test checks that
   * each one is a real unit and that none of them is legendary. A union type here would have to be
   * generated off the unit catalogue, which is above this module.
   */
  fits?: readonly string[];
}

/**
 * The bands the catalogue is authored against, in {@link unitModificationPower} points.
 *
 * Declared here rather than measured off the shipped cards, which is the whole point of it: a test
 * that read the ranges out of the catalogue would agree with whatever the catalogue said, and a
 * masterpiece quietly retuned down to an intricate card's worth would pass. The gaps between the
 * bands are deliberate, so no two rarities can meet in the middle.
 *
 * `maxRatingDelta` is the separate, harder ceiling: the largest single move a card of that band is
 * allowed to make to any one 0..100 rating.
 */
export const UNIT_MODIFICATION_RARITY_BANDS: Readonly<
  Record<UnitModificationRarity, { min: number; max: number; maxRatingDelta: number }>
> = {
  basic: { min: 5, max: 9, maxRatingDelta: 6 },
  intricate: { min: 12, max: 19, maxRatingDelta: 12 },
  advanced: { min: 24, max: 32, maxRatingDelta: 20 },
  masterpiece: { min: 34, max: 46, maxRatingDelta: 24 },
};

/**
 * What the three open figures are worth against a rating, when the two are added up together.
 *
 * Damage, hit points and loot capacity are counts rather than scores: a Colossus carries four
 * hundred hit points and a Razor seventy-five, so a card worth +24 vitality has moved a Colossus
 * by six percent and a Razor by a third. A quarter is the rate that puts the catalogue's damage
 * cards and its evasion cards in the same band as each other, which is the only thing this number
 * has to do.
 */
export const OPEN_FIGURE_WEIGHT = 0.25;

/**
 * One number for how good a card is, which is what the rarity word on it claims.
 *
 * Signed: a downside is subtracted at full weight, so an exoframe that costs four points of speed
 * is worth four points less than the same shell that did not.
 */
export function unitModificationPower(spec: UnitModificationSpec): number {
  let total = 0;
  for (const key of UNIT_STAT_KEYS) {
    const delta = spec.effect[key];
    if (delta === undefined) continue;
    total += delta * (UNIT_RATING_KEYS.includes(key) ? 1 : OPEN_FIGURE_WEIGHT);
  }
  return total;
}

const SPECS: readonly UnitModificationSpec[] = [
  // ------------------------------------------------------------------ BASIC
  /*
   * The three that need no drawings.
   *
   * Tape, offcuts and boots somebody else wore in. They carry no parts and they are the three
   * cheapest cards in the catalogue, which is what "simplest" has to mean if a test is going to
   * hold it.
   */
  {
    id: 'taped_grips',
    name: 'Taped Grips',
    description: 'Friction tape round every handle in the squad. It stops one drop a week.',
    effect: { offense: 16, evasion: 2 },
    rarity: 'basic',
    requiresBlueprint: false,
    cost: { scrap: 500 },
    parts: {},
  },
  {
    id: 'scrap_vest',
    name: 'Scrap Vest',
    description:
      'Bottle crate and carpet underlay, layered until a knife will not go through. Nobody looks good in one.',
    effect: { vitality: 12, armor: 4, speed: -1 },
    rarity: 'basic',
    requiresBlueprint: false,
    cost: { scrap: 550 },
    parts: {},
  },
  {
    id: 'broken_in_boots',
    name: 'Broken-In Boots',
    description:
      'Somebody else wore them soft first. The squad stops leaving a trail of blisters and noise.',
    effect: { speed: 4, stealth: 2 },
    rarity: 'basic',
    requiresBlueprint: false,
    cost: { scrap: 600 },
    parts: {},
  },
  {
    id: 'filed_sights',
    name: 'Filed Sights',
    description: 'An afternoon with a needle file and a vice. The shot goes where the eye was.',
    effect: { offense: 8, range: 4, penetration: 2 },
    rarity: 'basic',
    requiresBlueprint: true,
    cost: { scrap: 900 },
    parts: { weld_rod: 2 },
  },
  {
    id: 'rag_wraps',
    name: 'Rag Wraps',
    description:
      'Cloth over every buckle and barrel. Metal stops catching the light and stops announcing you.',
    effect: { stealth: 6, speed: 1 },
    rarity: 'basic',
    requiresBlueprint: true,
    cost: { scrap: 950 },
    parts: { weld_rod: 1 },
  },
  {
    id: 'whistle_code',
    name: 'Whistle Code',
    description:
      'Six notes that mean six things. A section that cannot see each other still moves together.',
    effect: { morale: 6, intimidation: 2 },
    rarity: 'basic',
    requiresBlueprint: true,
    cost: { scrap: 1000 },
    parts: { signal_relay: 1 },
  },
  {
    id: 'hook_and_line',
    name: 'Hook and Line',
    description:
      'Forty metres of rope and a grapple. Whatever is on the third floor comes down to you.',
    effect: { lootCapacity: 12, speed: 2 },
    rarity: 'basic',
    requiresBlueprint: true,
    cost: { scrap: 1050 },
    parts: { weld_rod: 2 },
    fits: ['scavengers', 'haulers'],
  },
  {
    id: 'knuckle_guards',
    name: 'Knuckle Guards',
    description:
      'Cut steel over the fingers. It saves the hand, and it does something to the face it lands on.',
    effect: { offense: 12, armor: 3, intimidation: 2 },
    rarity: 'basic',
    requiresBlueprint: true,
    cost: { scrap: 1100 },
    parts: { weld_rod: 3 },
    fits: [
      'razors',
      'anodics',
      'scrapers',
      'ghosts',
      'ironsides',
      'stitchers',
      'sleepers',
      'cyber_dogs',
      'hollow_men',
      'the_condemned',
      'the_twins',
    ],
  },
  {
    id: 'ear_defenders',
    name: 'Ear Defenders',
    description:
      'Moulded plugs, issued and checked. People who can still hear the order do not run as early.',
    effect: { morale: 5, evasion: 2 },
    rarity: 'basic',
    requiresBlueprint: true,
    cost: { scrap: 1200 },
    parts: { scrap_servo: 1 },
  },

  // -------------------------------------------------------------- INTRICATE
  {
    id: 'ablative_layers',
    name: 'Ablative Layers',
    description:
      'Plate that comes apart instead of the person behind it. You replace it after every fight.',
    effect: { vitality: 24, armor: 9, speed: -2 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 2600, highQualityMetal: 130 },
    parts: { ceramic_plate: 3 },
  },
  {
    id: 'recoil_dampers',
    name: 'Recoil Dampers',
    description:
      'Springs and a gas port, fitted properly. The second shot arrives while the first is still landing.',
    effect: { offense: 28, penetration: 5, range: 4 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 2800, highQualityMetal: 140 },
    parts: { scrap_servo: 4 },
  },
  {
    id: 'twitch_loop',
    name: 'Twitch Loop',
    description:
      'A closed circuit from eye to hand with nothing in between. Thinking was the slow part.',
    effect: { speed: 7, evasion: 6 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 3000, highQualityMetal: 150 },
    parts: { scrap_servo: 3, neural_shunt: 1 },
  },
  {
    id: 'smoke_discipline',
    name: 'Smoke Discipline',
    description:
      'Nobody lights up, nobody cooks, nobody talks on the approach. It is a rule rather than a device and it works better than one.',
    effect: { stealth: 10, evasion: 4 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 3100, highQualityMetal: 160 },
    parts: { signal_relay: 2 },
  },
  {
    id: 'drill_book',
    name: 'The Drill Book',
    description:
      'Forty pages, most of it about standing still. Read aloud every morning until nobody needs it read.',
    effect: { morale: 12, intimidation: 5 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 3300, highQualityMetal: 170 },
    parts: { signal_relay: 1, optic_cluster: 1 },
  },
  {
    id: 'hardened_optics',
    name: 'Hardened Optics',
    description:
      'Sealed glass with a coating that does not fog or flare. You see the target on the bad day as well.',
    effect: { range: 9, penetration: 6, offense: 12 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 3500, highQualityMetal: 180 },
    parts: { optic_cluster: 3 },
    fits: [
      'sparks',
      'wardens',
      'snipers',
      'road_reavers',
      'kite_crews',
      'netrunners',
      'juggernauts',
      'sluggers',
    ],
  },
  {
    id: 'counterweight_harness',
    name: 'Counterweight Harness',
    description: 'Load on the hips instead of the shoulders. Twice the bag and the same walk home.',
    effect: { lootCapacity: 32, vitality: 20, speed: 2 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 3700, highQualityMetal: 190 },
    parts: { hydraulic_ram: 2, weld_rod: 4 },
    fits: ['scavengers', 'haulers'],
  },
  {
    id: 'bone_lattice',
    name: 'Bone Lattice',
    description:
      'Pins and mesh through the long bones. The frame stops being the thing that fails first.',
    effect: { vitality: 32, armor: 7 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 3900, highQualityMetal: 210 },
    parts: { ceramic_plate: 4, hydraulic_ram: 2 },
    fits: ['breakers', 'wardens', 'ironsides', 'juggernauts', 'sluggers'],
  },
  {
    id: 'trophy_rack',
    name: 'Trophy Rack',
    description:
      'Plate, teeth and body markings off everybody they have beaten, worn where it shows.',
    effect: { intimidation: 11, morale: 4 },
    rarity: 'intricate',
    requiresBlueprint: true,
    cost: { scrap: 4100, highQualityMetal: 220 },
    parts: { ceramic_plate: 2, weld_rod: 3 },
  },

  // --------------------------------------------------------------- ADVANCED
  {
    id: 'composite_carapace',
    name: 'Composite Carapace',
    description:
      'A shell built to the body rather than strapped over it. Heavy, loud, and very hard to open.',
    effect: { vitality: 40, armor: 14, intimidation: 5, speed: -3 },
    rarity: 'advanced',
    requiresBlueprint: true,
    cost: { scrap: 6200, highQualityMetal: 430 },
    parts: { ceramic_plate: 6, hydraulic_ram: 3 },
  },
  {
    id: 'ranging_gear',
    name: 'Ranging Gear',
    description:
      'Drum, wire and a hand-cut cam that solves the drop for you. Arguments about elevation end.',
    effect: { offense: 48, penetration: 10, range: 8 },
    rarity: 'advanced',
    requiresBlueprint: true,
    cost: { scrap: 6600, highQualityMetal: 460 },
    parts: { optic_cluster: 4, targeting_core: 1 },
    fits: [
      'sparks',
      'wardens',
      'snipers',
      'road_reavers',
      'kite_crews',
      'netrunners',
      'juggernauts',
      'sluggers',
    ],
  },
  {
    id: 'dry_joints',
    name: 'Dry Joints',
    description:
      'Graphite and rubber through every hinge and boot. A yard full of gravel stops being a warning.',
    effect: { stealth: 16, speed: 7, evasion: 5 },
    rarity: 'advanced',
    requiresBlueprint: true,
    cost: { scrap: 7000, highQualityMetal: 500 },
    parts: { scrap_servo: 8, pressure_valve: 2 },
  },
  {
    id: 'adrenal_regulator',
    name: 'Adrenal Regulator',
    description:
      'A pump that decides when they are frightened. The dose is small and the bill comes later.',
    effect: { morale: 15, speed: 6, vitality: 16 },
    rarity: 'advanced',
    requiresBlueprint: true,
    cost: { scrap: 7400, highQualityMetal: 540 },
    parts: { neural_shunt: 2, pressure_valve: 2 },
  },
  {
    id: 'breaching_charges',
    name: 'Breaching Charges',
    description:
      'Cones packed by somebody who has counted their own fingers recently. Plate stops being an answer.',
    effect: { penetration: 20, offense: 32 },
    rarity: 'advanced',
    requiresBlueprint: true,
    cost: { scrap: 7800, highQualityMetal: 580 },
    parts: { ceramic_plate: 4, coolant_cell: 1 },
    fits: ['breakers', 'demolishers', 'juggernauts', 'sluggers'],
  },
  {
    id: 'rescue_rig',
    name: 'Rescue Rig',
    description:
      'Winch, sled and a harness rated for a body. It brings back the load and occasionally the people.',
    effect: { lootCapacity: 48, vitality: 24, morale: 8, speed: 3 },
    rarity: 'advanced',
    requiresBlueprint: true,
    cost: { scrap: 8200, highQualityMetal: 640 },
    parts: { hydraulic_ram: 4, scrap_servo: 6 },
    fits: ['scavengers', 'haulers'],
  },
  {
    id: 'monofilament_edge',
    name: 'Monofilament Edge',
    description:
      'An edge one molecule wide, on a handle nobody is allowed to hold twice. It does not notice armour.',
    effect: { offense: 56, penetration: 12, evasion: 3 },
    rarity: 'advanced',
    requiresBlueprint: true,
    cost: { scrap: 8600, highQualityMetal: 700 },
    parts: { targeting_core: 1, coolant_cell: 2 },
    fits: [
      'razors',
      'anodics',
      'scrapers',
      'ghosts',
      'ironsides',
      'stitchers',
      'sleepers',
      'cyber_dogs',
      'hollow_men',
      'the_condemned',
      'the_twins',
    ],
  },

  // ------------------------------------------------------------ MASTERPIECE
  {
    id: 'hardshell_exoframe',
    name: 'Hardshell Exoframe',
    description:
      'A powered shell with its own cooling and its own opinion about doorways. You hear it three streets away.',
    effect: { vitality: 64, armor: 20, intimidation: 10, speed: -4 },
    rarity: 'masterpiece',
    requiresBlueprint: true,
    cost: { scrap: 13000, highQualityMetal: 980 },
    parts: { hydraulic_ram: 6, ceramic_plate: 10, coolant_cell: 3 },
  },
  {
    id: 'synaptic_lace',
    name: 'Synaptic Lace',
    description:
      'Grown through the cortex over six weeks. Everything gets faster and some of it does not come back.',
    effect: { speed: 14, evasion: 15, stealth: 10, morale: -4 },
    rarity: 'masterpiece',
    requiresBlueprint: true,
    cost: { scrap: 14000, highQualityMetal: 1060 },
    parts: { neural_shunt: 6, coolant_cell: 2, pressure_valve: 2 },
  },
  {
    id: 'guided_rounds',
    name: 'Guided Rounds',
    description:
      'Each round steers for the last half second. Cover becomes a suggestion, and the price is per shot.',
    effect: { offense: 72, penetration: 15, range: 11 },
    rarity: 'masterpiece',
    requiresBlueprint: true,
    cost: { scrap: 15000, highQualityMetal: 1180 },
    parts: { targeting_core: 3, optic_cluster: 6 },
    fits: [
      'sparks',
      'wardens',
      'snipers',
      'road_reavers',
      'kite_crews',
      'netrunners',
      'juggernauts',
      'sluggers',
    ],
  },
  {
    id: 'ghost_protocol',
    name: 'Ghost Protocol',
    description:
      'Heat, sound and signature all handled at once, by people who used to do this for the Combine. Nothing on the wire says anybody came.',
    effect: { stealth: 22, evasion: 12, speed: 8 },
    rarity: 'masterpiece',
    requiresBlueprint: true,
    cost: { scrap: 16500, highQualityMetal: 1300 },
    parts: { neural_shunt: 4, optic_cluster: 5, coolant_cell: 3 },
  },
  {
    id: 'colours_of_the_line',
    name: 'Colours of the Line',
    description:
      'A standard carried by somebody who has held one before. Nothing breaks in front of it, and everybody remembers which ones did.',
    effect: { morale: 22, intimidation: 14, vitality: 16 },
    rarity: 'masterpiece',
    requiresBlueprint: true,
    cost: { scrap: 18000, highQualityMetal: 1450 },
    parts: { signal_relay: 4, ceramic_plate: 6, targeting_core: 1 },
  },
];

export const UNIT_MODIFICATIONS: readonly UnitModificationSpec[] = SPECS;
export const UNIT_MODIFICATION_IDS: readonly string[] = SPECS.map((spec) => spec.id);

const BY_ID = new Map(SPECS.map((spec) => [spec.id, spec]));

export function findUnitModification(id: string): UnitModificationSpec | undefined {
  return BY_ID.get(id);
}

/** Every card of one rarity, in catalogue order. This is how the bench groups them. */
export function unitModificationsOfRarity(
  rarity: UnitModificationRarity,
): readonly UnitModificationSpec[] {
  return SPECS.filter((spec) => spec.rarity === rarity);
}

/**
 * Whether this card may be fitted to this unit.
 *
 * Three answers in one, and the order matters only for readability: an id nothing answers to is
 * refused, a legendary is refused whatever the card says, and everything else is the card's own
 * `fits` list or the absence of one.
 *
 * The legendary rule is here rather than on a screen because the screen is not the only caller:
 * the server will validate a fit request, the Scrapyard will price a bench, and a rule that lives
 * in a component is a rule that holds until somebody writes the second component.
 */
export function modificationFitsUnit(spec: UnitModificationSpec, unitId: string): boolean {
  const unit = findUnit(unitId);
  if (!unit) return false;
  if (unit.tier === 'legendary') return false;
  return spec.fits === undefined || spec.fits.includes(unitId);
}

/** Every card this unit can be fitted with. Empty for a legendary, and that is the rule working. */
export function modificationsForUnit(unitId: string): readonly UnitModificationSpec[] {
  return SPECS.filter((spec) => modificationFitsUnit(spec, unitId));
}

/**
 * Whether the crew holds the drawings for a card, by card id.
 *
 * Injected rather than imported, for the reason `upgrades.ts` gives: this module sits below
 * `blueprints/` in the import graph. The predicate must answer **false** when no document exists
 * for the id, which is not what `blueprintGateMet` does on its own. See the module doc.
 */
export type UnitModificationBlueprintGate = (modificationId: string) => boolean;

/** The blueprint clause and nothing else: the money, the parts and the yard are still the caller's. */
export function unitModificationBlueprintMet(
  spec: UnitModificationSpec,
  holdsDocument: UnitModificationBlueprintGate,
): boolean {
  return !spec.requiresBlueprint || holdsDocument(spec.id);
}

/** The largest move this card makes to any single 0..100 rating, downside included. */
export function largestRatingDelta(spec: UnitModificationSpec): number {
  let largest = 0;
  for (const key of UNIT_RATING_KEYS) {
    const delta = spec.effect[key];
    if (delta === undefined) continue;
    largest = Math.max(largest, Math.abs(delta));
  }
  return largest;
}
