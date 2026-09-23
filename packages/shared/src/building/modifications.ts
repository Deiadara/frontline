import { z } from 'zod';
import type { ModificationRequirement } from './requirements.js';
import { BUILDING_KINDS, type BuildingKind } from './kinds.js';
import type { ModificationRarity } from '../modification-rarity.js';

/**
 * Building modifications (GDD §A1): the second axis a structure improves along.
 *
 * A modification is **not** a level. Levels are bought with materials and time; a modification is
 * *researched* or built in the Scrapyard, needs a Lead Engineer on the books to design it, and then
 * sits in one of the structure's three slots. Each structure offers seven and holds three, so the
 * choice is which three of the seven this district is: see §E, which is what made the slots
 * emptiable again.
 *
 * Slots open as the structure grows, at {@link MODIFICATION_SLOT_LEVELS}.
 */

/**
 * What a modification actually does.
 *
 * A closed set, and every member is read by something. That constraint is the whole design of this
 * module: it would have been easy to give each of the seventy-seven a bespoke sentence and no
 * implementation, which is exactly the dead-`output` mistake the structure catalogue was rewritten
 * to remove. A modification whose effect cannot be spelled as one of these does not get written.
 *
 * Every kind is oriented so that **more is better**, including the ones that shrink a number: a
 * `build_time_reduction` of 10 means builds take 10% less time. A player comparing two figures
 * should never have to remember which way one of them points.
 */
export const MODIFICATION_EFFECTS = [
  /** This structure's own hourly output. The only effect that is local rather than district-wide. */
  'production_percent',
  'build_cost_reduction',
  'build_time_reduction',
  'storage_percent',
  'defense_percent',
  /** Percentage points on the allegiance's own XP, so the district levels you as well as it feeds you. */
  'faction_xp_percent',
  'research_time_reduction',
  'housing_percent',
  /** Percentage points on the payroll ceiling: room for another name on the book. */
  'payroll_percent',
  'raid_loot_percent',
  /** Percentage points off the training clock of every unit on the roster. */
  'training_time_reduction',
  /** Percentage points off the **supplies** line of a training bill, and no other line. */
  'training_supplies_reduction',
] as const;
export const ModificationEffectSchema = z.enum(MODIFICATION_EFFECTS);
export type ModificationEffect = z.infer<typeof ModificationEffectSchema>;

/** Effects that apply only to the structure the modification is installed in. */
export const LOCAL_EFFECTS: readonly ModificationEffect[] = ['production_percent'];

/**
 * The families a modification can belong to (maintainer request, 2026-09-14).
 *
 * This is the deck-building half of the system. A slot used to be a shopping decision: pick the
 * three biggest numbers the structure offers and you were done, and there was no reason to ever
 * look at the other four. A family gives the three slots in a building a *shape*, because a card
 * is worth more beside its own kind: see {@link ModificationSpec.synergy} for the pair bonus and
 * {@link SET_BONUSES} for what filling all three with one family is worth.
 *
 * Deliberately small. Six families over a hundred-odd cards means a family is a real archetype a
 * player can build toward, where twenty would mean every card is its own family and the mechanic
 * is decoration.
 */
export const MODIFICATION_FAMILIES = [
  /** Pipes, tanks, drains. Anything that moves water or waste. */
  'plumbing',
  /** Wiring, busbars, cells. Anything that moves current. */
  'power',
  /** Lenses, sensors, screens. Anything that watches. */
  'optics',
  /** Arms, rails, feeders. Anything that does a job without a person. */
  'automation',
  /** Bunks, stoves, paint. Anything that makes a place bearable. */
  'comfort',
  /** Plate, mesh, bulkheads. Anything that stops something coming through. */
  'armour',
] as const;
export const ModificationFamilySchema = z.enum(MODIFICATION_FAMILIES);
export type ModificationFamily = z.infer<typeof ModificationFamilySchema>;

export const MODIFICATION_FAMILY_LABELS: Readonly<Record<ModificationFamily, string>> = {
  plumbing: 'Plumbing',
  power: 'Power',
  optics: 'Optics',
  automation: 'Automation',
  comfort: 'Comfort',
  armour: 'Armour',
};

export interface ModificationSpec {
  id: string;
  /**
   * The structure this card belongs to, and the one its id is built from.
   *
   * Still exactly one, because `idFor` reads it and seventy-seven ids are already saved against
   * live districts. Where a card may be fitted is {@link ModificationSpec.fits}, which defaults to
   * this and only this.
   */
  building: BuildingKind;
  /**
   * Every structure this card will go into.
   *
   * Absent means "its own building and nowhere else", which is the whole original catalogue. A
   * plumbing run makes sense in the Quarters, the Nexus and the Infirmary and nowhere near the
   * Gauntlet, and saying so is more interesting than either "one building" or "anywhere".
   */
  fits?: readonly BuildingKind[];
  name: string;
  description: string;
  effect: ModificationEffect;
  /** Percentage points. Always positive. */
  magnitude: number;
  /**
   * The word on the card, in the same four steps the unit cards use.
   *
   * Required, so a card that forgets it fails to compile rather than defaulting to BASIC. It is a
   * claim about {@link ModificationSpec.magnitude} and nothing else: `decks.test.ts` holds every
   * card inside its band in {@link MODIFICATION_RARITY_BANDS}.
   */
  rarity: ModificationRarity;
  /** Which archetype this card belongs to. Absent means it combos with nothing. */
  family?: ModificationFamily;
  /**
   * What this card is worth beside a particular kind of neighbour.
   *
   * Read per building: if any *other* modification fitted in the same structure carries `with`,
   * this card's magnitude goes up by `bonus` percentage points. One-directional on purpose, so a
   * pair can be lopsided: a pump is worth more next to a generator than the generator is next to
   * the pump.
   */
  synergy?: { with: ModificationFamily; bonus: number };
  /**
   * What a crew has to be before this one goes in (`building/requirements.ts`).
   *
   * Absent is the band the card's own `rarity` names, which is how ninety cards carry four gates
   * each without ninety hand-written tables. Present overrides one gate or all of them, for a card
   * whose content wants something the band does not say.
   */
  requires?: Partial<ModificationRequirement>;
}

/**
 * What filling all three slots of one structure with one family is worth.
 *
 * The top of the deck-building ladder and the reason to commit rather than to spread. A set is
 * deliberately harder than it looks: three slots open at {@link MODIFICATION_SLOT_LEVELS}, so a
 * complete set is a structure near its ceiling with three cards of one family that all fit it.
 *
 * The bonus is a district effect rather than more of the family's own trade, so completing a set
 * buys something the three cards could not buy on their own.
 */
export const SET_BONUSES: Readonly<
  Record<ModificationFamily, { effect: ModificationEffect; magnitude: number; title: string }>
> = {
  plumbing: { effect: 'production_percent', magnitude: 10, title: 'Everything Runs' },
  power: { effect: 'build_time_reduction', magnitude: 8, title: 'The Lights Never Dip' },
  optics: { effect: 'research_time_reduction', magnitude: 10, title: 'Nothing Unseen' },
  automation: { effect: 'training_time_reduction', magnitude: 9, title: 'It Runs Itself' },
  comfort: { effect: 'housing_percent', magnitude: 12, title: 'Somewhere Worth Coming Back To' },
  armour: { effect: 'defense_percent', magnitude: 12, title: 'Buttoned Up' },
};

/**
 * The bands the catalogue is authored against, in points of {@link ModificationSpec.magnitude}.
 *
 * Declared rather than measured off the shipped cards, for the reason `units/modifications.ts`
 * gives: a test that read the ranges out of the catalogue would agree with whatever the catalogue
 * said. The measure is the printed magnitude alone. A synergy bonus is not counted, because it is
 * paid only beside the right neighbour and because the two things that already read a card's
 * strength, the yard's bill in `addons.ts` and the retrofit gate in `blueprints/`, both read the
 * raw magnitude.
 *
 * ADVANCED starts where `ADVANCED_MODIFICATION_MAGNITUDE` in `addons.ts` starts: that is the line
 * past which a card wants the structure's retrofit document and costs high-quality metal, and a
 * card wearing the word ADVANCED must be one the yard treats as advanced. `addons.ts` imports this
 * module, so the number is repeated here and `decks.test.ts` pins the two together.
 *
 * The top two bands were lifted on 2026-09-16, when the four gates in `building/requirements.ts`
 * made them properly hard to reach: ADVANCED from 12 to 16 and MASTERPIECE from 18 to 22, every
 * card moved by a flat +2 and +6 so the order inside each band is exactly what it was. The price
 * follows on its own, at `ADDON_SCRAP_PER_MAGNITUDE` a point, which is the reason nothing else had
 * to be retuned: a masterpiece that is worth a third more costs a third more.
 */
export const MODIFICATION_RARITY_BANDS: Readonly<
  Record<ModificationRarity, { min: number; max: number }>
> = {
  basic: { min: 1, max: 8 },
  intricate: { min: 9, max: 10 },
  advanced: { min: 14, max: 18 },
  masterpiece: { min: 24, max: 28 },
};

/**
 * How far a piece of engineering travels, by what it does (maintainer request, 2026-09-16).
 *
 * "If you do unlock some through blueprints they are available for all the buildings they can fit
 * into: some in just one, some in two or three, some in all." A bolt-on made for one structure is
 * a bolt-on for that structure; a *designed* card is a design, and a crew that has assembled the
 * drawings owns the design rather than one copy of it.
 *
 * So the reach is the trade, not the address. A card that takes time off a build belongs anywhere
 * work is scheduled; a plate belongs anywhere a wall does, which is everywhere; a production card
 * belongs to the three structures that produce, and nowhere else, which is also what the load guard
 * in `production.ts` insists on.
 *
 * `production_percent` is the one line that must stay inside `PRODUCING_BUILDINGS`: a card paying
 * production into a structure that produces nothing is a card sold for nothing, which is the bug
 * the Garage's two dead cards were.
 */
const FITS_BY_EFFECT: Readonly<Record<ModificationEffect, readonly BuildingKind[]>> = {
  production_percent: ['greenhouse', 'generator', 'scrapyard'],
  build_cost_reduction: ['nexus', 'scrapyard', 'garage'],
  build_time_reduction: ['nexus', 'scrapyard', 'generator', 'garage'],
  storage_percent: ['apothecary', 'scrapyard', 'greenhouse'],
  // A plate is a plate. The one card family that goes anywhere a wall does.
  defense_percent: BUILDING_KINDS,
  faction_xp_percent: ['nexus', 'quarters', 'infirmary', 'greenhouse'],
  research_time_reduction: ['lab', 'nexus', 'apothecary'],
  housing_percent: ['quarters', 'infirmary', 'apothecary'],
  payroll_percent: ['nexus', 'quarters'],
  raid_loot_percent: ['garage', 'scrapyard', 'gauntlet', 'gate'],
  training_time_reduction: ['gauntlet', 'quarters', 'infirmary'],
  training_supplies_reduction: ['greenhouse', 'gauntlet', 'apothecary'],
};

/**
 * Every structure a card will go into.
 *
 * Three answers in order: what the card says, then the trade it belongs to, then its own structure.
 *
 * The middle one is the change of 2026-09-16 and it is deliberately gated on the grade. A BASIC
 * card is something a crew bangs together for the structure in front of it and it stays there; from
 * INTRICATE up a card is a drawing, and a drawing that has been assembled is worth what it is worth
 * everywhere it makes sense. That is the whole reason to chase a document rather than a card.
 *
 * The card's own structure is always in the set, whatever the table says, so a card can never be
 * homeless.
 */
export function fitsIn(spec: ModificationSpec): readonly BuildingKind[] {
  if (spec.fits) return spec.fits;
  if (spec.rarity === 'basic') return [spec.building];
  const byTrade = FITS_BY_EFFECT[spec.effect];
  return byTrade.includes(spec.building) ? byTrade : [spec.building, ...byTrade];
}

/** Whether this card may be fitted to `kind`. */
export function modificationFits(spec: ModificationSpec, kind: BuildingKind): boolean {
  return fitsIn(spec).includes(kind);
}

/**
 * The catalogue, seven per structure.
 *
 * The maintainer named nine of these outright (Encrypted Core, Automated Protocols, Precision
 * Fabricators, Salvage Drones, Quantum Modeling, Neural Drafting Table, Redundant Testing
 * Chambers, Arcades, Graffiti Walls, Insect Farm); those keep the maintainer's own name and wording.
 * The rest fill each structure out to seven along the same lines. Every structure carries at
 * least one plain bolt-on and one piece of engineering, either side of the advanced threshold in
 * `addons.ts`, so the Scrapyard's level gate has something to hold back on every plot.
 */
const SPECS: readonly Omit<ModificationSpec, 'id'>[] = [
  // --- The Nexus ---
  {
    building: 'nexus',
    name: 'Encrypted Core',
    description: 'Encrypts all allegiance data. Anyone casing this district works blind.',
    effect: 'defense_percent',
    magnitude: 14,
    rarity: 'advanced',
    family: 'armour',
  },
  {
    building: 'nexus',
    name: 'Automated Protocols',
    description:
      'Some functions run without staff assigned, so the work starts the moment it is ordered.',
    effect: 'build_time_reduction',
    magnitude: 10,
    rarity: 'intricate',
    family: 'power',
  },
  {
    building: 'nexus',
    name: 'Requisition Ledger',
    description: 'Every job costed before it is called in. Nothing is ordered twice.',
    effect: 'build_cost_reduction',
    magnitude: 10,
    rarity: 'intricate',
    family: 'automation',
  },
  {
    building: 'nexus',
    name: 'Standing Orders',
    description:
      'Every job has a written rate and nobody argues about it. The book stretches further for it.',
    effect: 'payroll_percent',
    magnitude: 26,
    rarity: 'masterpiece',
    family: 'comfort',
  },
  {
    building: 'nexus',
    name: 'Priority Bus',
    description: 'The Nexus decides which job goes first, and it is never the one that can wait.',
    effect: 'build_time_reduction',
    magnitude: 8,
    rarity: 'basic',
    family: 'power',
  },
  {
    building: 'nexus',
    name: 'Filed Drawings',
    description:
      'Every drawing the district has ever paid for, filed where the Lab can find it again.',
    effect: 'research_time_reduction',
    magnitude: 8,
    rarity: 'basic',
    family: 'optics',
  },
  {
    building: 'nexus',
    name: 'Stores Register',
    description:
      'One register for every store in the district, so nothing is counted twice or lost behind a door.',
    effect: 'storage_percent',
    magnitude: 16,
    rarity: 'advanced',
    family: 'plumbing',
  },

  // --- The Quarters ---
  {
    building: 'quarters',
    name: 'Hot Bunking',
    description: 'Two shifts, one bed, and nobody in it at the same time.',
    effect: 'housing_percent',
    magnitude: 24,
    rarity: 'masterpiece',
    family: 'comfort',
  },
  {
    building: 'quarters',
    name: 'Debriefing Room',
    description:
      'Salvaged foam on every bulkhead, and a table in the middle of it. Crews come back and say what happened.',
    effect: 'faction_xp_percent',
    magnitude: 4,
    rarity: 'basic',
    family: 'comfort',
  },
  {
    building: 'quarters',
    name: 'Filtered Air Handlers',
    description:
      'Clean air on the bunk deck. People sign for less when they can breathe where they sleep.',
    effect: 'payroll_percent',
    magnitude: 17,
    rarity: 'advanced',
    family: 'comfort',
  },
  {
    building: 'quarters',
    name: 'Prefab Stacks',
    description:
      'The crew assembles its own housing off a pattern, and the pattern is a storey taller each time.',
    effect: 'housing_percent',
    magnitude: 14,
    rarity: 'advanced',
    family: 'comfort',
  },
  {
    building: 'quarters',
    name: 'Turnout Drills',
    description: 'Bunk to boots in ninety seconds, and the same again on every other parade.',
    effect: 'training_time_reduction',
    magnitude: 8,
    rarity: 'basic',
    family: 'automation',
  },
  {
    building: 'quarters',
    name: 'Mess Rota',
    description: 'One kitchen, one sitting, and what a recruit is fed stops being an argument.',
    effect: 'training_supplies_reduction',
    magnitude: 8,
    rarity: 'basic',
    family: 'plumbing',
  },
  {
    building: 'quarters',
    name: 'Undercroft Billets',
    description: 'The cellars dug out, drained and bunked. Cold, dry, and out of the wind.',
    effect: 'housing_percent',
    magnitude: 16,
    rarity: 'advanced',
    family: 'comfort',
  },

  // --- The Greenhouse ---
  {
    building: 'greenhouse',
    name: 'Insect Farm',
    description:
      'Protein alternative. Efficient, low resource cost, and nobody asks twice what is in it.',
    effect: 'production_percent',
    magnitude: 28,
    rarity: 'masterpiece',
    family: 'automation',
  },
  {
    building: 'greenhouse',
    name: 'Spectrum Lamps',
    description: 'Tuned to what each tray actually wants instead of to what was in the crate.',
    effect: 'production_percent',
    magnitude: 18,
    rarity: 'advanced',
    family: 'automation',
  },
  {
    building: 'greenhouse',
    name: 'Sealed Growrooms',
    description:
      'Heat stays in and the trays run year round, so a ration goes further than it did.',
    effect: 'training_supplies_reduction',
    magnitude: 14,
    rarity: 'advanced',
    family: 'plumbing',
  },
  {
    building: 'greenhouse',
    name: 'Canteen Line',
    description:
      'Fresh food served where it is grown. What gets talked about over it is what went wrong last night.',
    effect: 'faction_xp_percent',
    magnitude: 5,
    rarity: 'basic',
    family: 'comfort',
  },
  {
    building: 'greenhouse',
    name: 'Seed Vault',
    description:
      'A cold locker of everything that grows here. Nobody has to be paid in advance against a bad crop.',
    effect: 'payroll_percent',
    magnitude: 24,
    rarity: 'masterpiece',
    family: 'comfort',
  },
  {
    building: 'greenhouse',
    name: 'Root Cellars',
    description: 'Cold stores under the benches, so a good month keeps until a bad one.',
    effect: 'storage_percent',
    magnitude: 9,
    rarity: 'intricate',
    family: 'plumbing',
  },
  {
    building: 'greenhouse',
    name: 'Hydroponic Racks',
    description: 'Trays stacked four high on a pump loop. The floor grows what an acre used to.',
    effect: 'production_percent',
    magnitude: 15,
    rarity: 'advanced',
    family: 'automation',
  },

  // --- The Generator ---
  {
    building: 'generator',
    name: 'Cascade Turbines',
    description:
      'Exhaust off the first stage spins the second. Twice the noise, and every crane in the district turns faster.',
    effect: 'build_time_reduction',
    magnitude: 16,
    rarity: 'advanced',
    family: 'power',
  },
  {
    building: 'generator',
    name: 'Heat Recapture',
    description: 'The waste heat goes back into the boiler instead of into the ceiling.',
    effect: 'build_cost_reduction',
    magnitude: 10,
    rarity: 'intricate',
    family: 'automation',
  },
  {
    building: 'generator',
    name: 'Fuel Polishing',
    description: 'Water and sludge out before the burn. The same oil goes appreciably further.',
    effect: 'build_cost_reduction',
    magnitude: 14,
    rarity: 'advanced',
    family: 'automation',
  },
  {
    building: 'generator',
    name: 'Load Balancers',
    description:
      'Work is smoothed across the day, so nothing spikes and no crew stands idle waiting for one.',
    effect: 'build_time_reduction',
    magnitude: 10,
    rarity: 'intricate',
    family: 'power',
  },
  {
    building: 'generator',
    name: 'Instrument Bench',
    description:
      'The turbine gets a bench and a log book beside it. Everything that breaks is written down and read.',
    effect: 'faction_xp_percent',
    magnitude: 3,
    rarity: 'basic',
    family: 'comfort',
  },
  {
    building: 'generator',
    name: 'Clean Feed',
    description:
      'The Lab bench gets its power off the top of the load, so no run dies in a brownout.',
    effect: 'research_time_reduction',
    magnitude: 7,
    rarity: 'basic',
    family: 'optics',
  },
  /*
   * Homed here rather than in the Garage, where it was written (§A1, the production split).
   *
   * `production_percent` is local, so this card's +16 was a percentage of nothing for as long as
   * the Garage has produced nothing, and after the split the Generator was the one producing
   * structure in the game that no card could raise: its oil ran at its level and its damage and
   * that was the whole of it. The flavour never moved, only the plate it is bolted to.
   */
  {
    building: 'generator',
    name: 'Fuel Cracking Column',
    description: 'Heavy ends into something an engine will actually take.',
    effect: 'production_percent',
    magnitude: 18,
    rarity: 'advanced',
    family: 'automation',
  },
  {
    building: 'generator',
    name: 'Standby Bank',
    description: 'Charged cells that hold the lights and the turrets up when the main set is hit.',
    effect: 'defense_percent',
    magnitude: 14,
    rarity: 'advanced',
    family: 'armour',
  },

  // --- The Scrapyard ---
  {
    building: 'scrapyard',
    name: 'Precision Fabricators',
    description:
      'Improves the quality of crafted weapons and devices, and wastes far less getting there.',
    effect: 'production_percent',
    magnitude: 24,
    rarity: 'masterpiece',
    family: 'automation',
  },
  {
    building: 'scrapyard',
    name: 'Salvage Drones',
    description:
      'Automated units that collect scrap after raids, while everyone else is still leaving.',
    effect: 'raid_loot_percent',
    magnitude: 26,
    rarity: 'masterpiece',
    family: 'optics',
  },
  {
    building: 'scrapyard',
    name: 'Magnetic Sorting Line',
    description:
      'Ferrous off the belt before a hand touches it. The sorting floor triples its throughput.',
    effect: 'production_percent',
    magnitude: 16,
    rarity: 'advanced',
    family: 'automation',
  },
  {
    building: 'scrapyard',
    name: 'Press Automation',
    description:
      'Stock cut to pattern here rather than on site, so every build order lands lighter.',
    effect: 'build_cost_reduction',
    magnitude: 8,
    rarity: 'basic',
    family: 'automation',
  },
  {
    building: 'scrapyard',
    name: 'Cutting Bay Extraction',
    description:
      'Fume hoods and local extraction, so the floor runs a full shift instead of clearing the air twice a day.',
    effect: 'production_percent',
    magnitude: 10,
    rarity: 'intricate',
    family: 'automation',
  },
  {
    building: 'scrapyard',
    name: 'Parts Cage',
    description: 'Everything worth keeping behind mesh, tagged, with one key and one list.',
    effect: 'storage_percent',
    magnitude: 9,
    rarity: 'intricate',
    family: 'plumbing',
  },
  {
    building: 'scrapyard',
    name: 'Alloy Furnace',
    description:
      'Mixed metal in, one grade out. The yard stops selling good stock at scrap prices.',
    effect: 'production_percent',
    magnitude: 17,
    rarity: 'advanced',
    family: 'automation',
  },

  // --- The Apothecary ---
  {
    building: 'apothecary',
    name: 'Deep Racking',
    description:
      'The stack goes up to the roof and back into the rock. Nothing is on the floor any more.',
    effect: 'storage_percent',
    magnitude: 26,
    rarity: 'masterpiece',
    family: 'plumbing',
  },
  {
    building: 'apothecary',
    name: 'Climate Cells',
    description: 'Sealed, cooled and logged. Things keep here that used to spoil in a fortnight.',
    effect: 'storage_percent',
    magnitude: 17,
    rarity: 'advanced',
    family: 'plumbing',
  },
  {
    building: 'apothecary',
    name: 'False Bulkheads',
    description:
      'The real stock is not where the ledger says. Raiders take the decoy and leave satisfied.',
    effect: 'defense_percent',
    magnitude: 10,
    rarity: 'intricate',
    family: 'armour',
  },
  {
    building: 'apothecary',
    name: 'Field Kits',
    description:
      'Every crew goes out carrying what it needs, so nobody is owed danger money for going without.',
    effect: 'payroll_percent',
    magnitude: 17,
    rarity: 'advanced',
    family: 'comfort',
  },
  {
    building: 'apothecary',
    name: 'Bulk Requisition',
    description:
      'Buy for the year, not for the job. What the district builds gets cheaper across the board.',
    effect: 'build_cost_reduction',
    magnitude: 8,
    rarity: 'basic',
    family: 'automation',
  },
  {
    building: 'apothecary',
    name: 'Stimulant Line',
    description:
      'Measured doses for the drill yard, and a recruit is through the course a week sooner.',
    effect: 'training_time_reduction',
    magnitude: 8,
    rarity: 'basic',
    family: 'automation',
  },
  {
    building: 'apothecary',
    name: 'Dispensary Apprenticeships',
    description:
      'Apprentices grinding and weighing under somebody who has seen a wrong dose. Nothing is spoiled twice.',
    effect: 'training_supplies_reduction',
    magnitude: 14,
    rarity: 'advanced',
    family: 'plumbing',
  },

  // --- The Gate ---
  {
    building: 'gate',
    name: 'Interlocking Bulwarks',
    description: 'Ferrocrete teeth staggered so nothing has a straight run at the opening.',
    effect: 'defense_percent',
    magnitude: 26,
    rarity: 'masterpiece',
    family: 'armour',
  },
  {
    building: 'gate',
    name: 'Automated Turret Nests',
    description: 'Salvaged servos and a firing solution that does not need anyone awake.',
    effect: 'defense_percent',
    magnitude: 18,
    rarity: 'advanced',
    family: 'armour',
  },
  {
    building: 'gate',
    name: 'Sally Port',
    description:
      'A way out that raiders do not know about, which is also a way back in carrying things.',
    effect: 'raid_loot_percent',
    magnitude: 10,
    rarity: 'intricate',
    family: 'optics',
  },
  {
    building: 'gate',
    name: 'Watch Rota',
    description:
      'Everyone stands a turn on the step, so everyone learns which doors out there are worth opening.',
    effect: 'raid_loot_percent',
    magnitude: 8,
    rarity: 'basic',
    family: 'optics',
  },
  {
    building: 'gate',
    name: 'Ferrocrete Recycling',
    description: 'Rubble goes back into the mixer. Every wall in the district costs less to raise.',
    effect: 'build_cost_reduction',
    magnitude: 7,
    rarity: 'basic',
    family: 'automation',
  },
  {
    building: 'gate',
    name: 'Toll House',
    description: 'Everything coming in pays at the step, and the book covers another name for it.',
    effect: 'payroll_percent',
    magnitude: 8,
    rarity: 'basic',
    family: 'comfort',
  },
  {
    building: 'gate',
    name: 'Kill Funnel',
    description: 'The approach narrowed to one lane that nothing wide can turn around in.',
    effect: 'defense_percent',
    magnitude: 16,
    rarity: 'advanced',
    family: 'armour',
  },

  // --- The Lab ---
  {
    building: 'lab',
    name: 'Quantum Modeling',
    description:
      'Research ideas faster using predictive algorithms, and stop running the dead ends at all.',
    effect: 'research_time_reduction',
    magnitude: 24,
    rarity: 'masterpiece',
    family: 'optics',
  },
  {
    building: 'lab',
    name: 'Neural Drafting Table',
    description:
      'Researchers design directly in their mind. A revision that took a fortnight takes an hour.',
    effect: 'research_time_reduction',
    magnitude: 14,
    rarity: 'advanced',
    family: 'optics',
  },
  {
    building: 'lab',
    name: 'Redundant Testing Chambers',
    description:
      'Run multiple experiments simultaneously instead of queuing behind the slowest one.',
    effect: 'research_time_reduction',
    magnitude: 16,
    rarity: 'advanced',
    family: 'optics',
  },
  {
    building: 'lab',
    name: 'Process Cell',
    description:
      'Efficient work streams, written down, followed. The whole district builds faster for it.',
    effect: 'build_time_reduction',
    magnitude: 10,
    rarity: 'intricate',
    family: 'power',
  },
  {
    building: 'lab',
    name: 'Shielded Datacore',
    description: 'Faraday mesh and an air gap. What the district knows cannot be taken off it.',
    effect: 'defense_percent',
    magnitude: 10,
    rarity: 'intricate',
    family: 'armour',
  },
  {
    building: 'lab',
    name: 'Written Drill',
    description: 'Drill set down properly, so the Gauntlet stops teaching the same hour twice.',
    effect: 'training_time_reduction',
    magnitude: 7,
    rarity: 'basic',
    family: 'automation',
  },
  {
    building: 'lab',
    name: 'Materials Bench',
    description:
      'Substitutes tested before they are ordered, so the district buys the cheap one that holds.',
    effect: 'build_cost_reduction',
    magnitude: 14,
    rarity: 'advanced',
    family: 'automation',
  },

  // --- The Gauntlet ---
  {
    building: 'gauntlet',
    name: 'Live-Fire Range',
    description: 'Real rounds, real noise. Nobody who has drilled here panics at the door.',
    effect: 'defense_percent',
    magnitude: 24,
    rarity: 'masterpiece',
    family: 'armour',
  },
  {
    building: 'gauntlet',
    name: 'Instructor Cadre',
    description: 'People whose whole job is making other people better at theirs. Less is ruined.',
    effect: 'training_supplies_reduction',
    magnitude: 16,
    rarity: 'advanced',
    family: 'plumbing',
  },
  {
    building: 'gauntlet',
    name: 'Conditioning Programme',
    description:
      'A crew that is fit costs less to keep. Half of what an officer charges is for the risk.',
    effect: 'payroll_percent',
    magnitude: 17,
    rarity: 'advanced',
    family: 'comfort',
  },
  {
    building: 'gauntlet',
    name: 'Drill Yard Extension',
    description: 'The yard doubles as muster ground and overflow billet when the district is full.',
    effect: 'housing_percent',
    magnitude: 10,
    rarity: 'intricate',
    family: 'comfort',
  },
  {
    building: 'gauntlet',
    name: 'Salvaged Simulators',
    description:
      'Combine training rigs, repurposed. A recruit walks the course before they walk it.',
    effect: 'training_time_reduction',
    magnitude: 14,
    rarity: 'advanced',
    family: 'automation',
  },
  {
    building: 'gauntlet',
    name: 'Kit Store',
    description:
      'Kit issued, signed for and handed back, so a course stops eating a new set every intake.',
    effect: 'training_supplies_reduction',
    magnitude: 9,
    rarity: 'intricate',
    family: 'plumbing',
  },
  {
    building: 'gauntlet',
    name: 'Night Course',
    description: 'The same run made in the dark until dark stops being a reason to slow down.',
    effect: 'training_time_reduction',
    magnitude: 16,
    rarity: 'advanced',
    family: 'automation',
  },

  // --- The Infirmary ---
  {
    building: 'infirmary',
    name: 'Autoclave Suite',
    description:
      'Sterile instruments, every time. An officer who expects to survive the year asks for less of it up front.',
    effect: 'payroll_percent',
    magnitude: 28,
    rarity: 'masterpiece',
    family: 'comfort',
  },
  {
    building: 'infirmary',
    name: 'Compounding Printer',
    description:
      'Prints the drugs the Combine will not sell down here. What that saves goes straight on the book.',
    effect: 'payroll_percent',
    magnitude: 18,
    rarity: 'advanced',
    family: 'comfort',
  },
  {
    building: 'infirmary',
    name: 'Trauma Bay',
    description:
      'People come back from jobs they would not have come back from, and the crew learns from every one.',
    effect: 'faction_xp_percent',
    magnitude: 6,
    rarity: 'basic',
    family: 'comfort',
  },
  {
    building: 'infirmary',
    name: 'Nutrition Programme',
    description:
      'Somebody finally works out what the crew is short of. People mend faster and the beds free up.',
    effect: 'housing_percent',
    magnitude: 10,
    rarity: 'intricate',
    family: 'comfort',
  },
  {
    building: 'infirmary',
    name: 'Cold Storage',
    description: 'A cold chain that runs the length of the district, for far more than medicine.',
    effect: 'storage_percent',
    magnitude: 10,
    rarity: 'intricate',
    family: 'plumbing',
  },
  {
    building: 'infirmary',
    name: 'Convalescent Beds',
    description: 'Beds that stand empty most weeks and billet the overflow the rest of the time.',
    effect: 'housing_percent',
    magnitude: 8,
    rarity: 'basic',
    family: 'comfort',
  },
  {
    building: 'infirmary',
    name: 'Prosthetics Bench',
    description:
      'Limbs fitted and tuned here, so somebody is back on the course in days rather than months.',
    effect: 'training_time_reduction',
    magnitude: 14,
    rarity: 'advanced',
    family: 'automation',
  },

  // --- The Garage ---
  /*
   * The Garage's masterpiece, on a channel the Garage has.
   *
   * It paid `production_percent`, which is local, into the one structure whose stated rule is that
   * it produces nothing: 5,000 scrap and 240 high-quality metal for a percentage of zero. What a
   * hangar with a machine in it is actually worth to a crew is what comes home on it, which is the
   * channel Haulage Rigs and the Tyre Bank already pay into and which `crew/standing.ts` folds into
   * the raiding column's bag.
   */
  {
    building: 'garage',
    name: 'Rotor Bay',
    description:
      'High enough for a mast, wide enough for blades. The thing nobody will discuss gets finished here, and it comes back loaded.',
    effect: 'raid_loot_percent',
    magnitude: 26,
    rarity: 'masterpiece',
    family: 'automation',
  },
  {
    building: 'garage',
    name: 'Haulage Rigs',
    description: 'Flatbeds and a crane. A raid stops being limited by what people can carry.',
    effect: 'raid_loot_percent',
    magnitude: 28,
    rarity: 'masterpiece',
    family: 'optics',
  },
  {
    building: 'garage',
    name: 'Machine Shop',
    description:
      'Parts made here instead of waited for. Every build in the district stops queuing behind a part.',
    effect: 'build_time_reduction',
    magnitude: 14,
    rarity: 'advanced',
    family: 'power',
  },
  {
    building: 'garage',
    name: 'Mobile Rigs',
    description:
      'Vehicle powerplants dragged out to whichever site needs one, when nothing is on the ramp.',
    effect: 'build_time_reduction',
    magnitude: 10,
    rarity: 'intricate',
    family: 'power',
  },
  {
    building: 'garage',
    name: 'Tyre Bank',
    description: 'Rims and treads sorted by size, so nothing comes home on a bare hub.',
    effect: 'raid_loot_percent',
    magnitude: 9,
    rarity: 'intricate',
    family: 'optics',
  },
  {
    building: 'garage',
    // Wheels are the point: a yard with room to park is a yard that can take these, and the
    // Scrapyard is the other structure in the district with open ground.
    fits: ['garage', 'scrapyard'],
    name: 'Fuel Bowsers',
    description:
      'Tankage on wheels. What the district cannot hold standing still, it holds parked.',
    effect: 'storage_percent',
    magnitude: 16,
    rarity: 'advanced',
    family: 'plumbing',
  },
  /*
   * --- The fittings that go in more than one place (maintainer request, 2026-09-14) ---
   *
   * Every card above belongs to exactly one structure, which made a slot a shopping decision: read
   * the seven on offer, take the three biggest numbers, never look again. These are the deck: each
   * one fits a *set* of structures where it makes sense, and each one is worth more beside a
   * particular family than it is alone.
   *
   * `building` is still one structure, because `idFor` builds the id from it and every id in this
   * file is saved against live districts. It is the card's home for the Scrapyard's bench; `fits`
   * is where it may actually go.
   */
  {
    building: 'quarters',
    fits: ['quarters', 'nexus', 'infirmary', 'apothecary'],
    name: 'Standpipe Run',
    description:
      'Clean water to every floor instead of one tap in the yard. People stop being ill.',
    effect: 'housing_percent',
    magnitude: 8,
    rarity: 'basic',
    family: 'plumbing',
    synergy: { with: 'comfort', bonus: 6 },
  },
  {
    building: 'nexus',
    fits: ['nexus', 'lab', 'garage', 'scrapyard'],
    name: 'Busbar Spine',
    description: 'One heavy run of copper down the building, tapped wherever it is wanted.',
    effect: 'build_time_reduction',
    magnitude: 6,
    rarity: 'basic',
    family: 'power',
    synergy: { with: 'automation', bonus: 5 },
  },
  {
    building: 'lab',
    fits: ['lab', 'gate', 'nexus', 'gauntlet'],
    name: 'Sensor Mesh',
    description:
      'Cheap sensors everywhere rather than good ones somewhere. Nothing crosses unseen.',
    effect: 'defense_percent',
    magnitude: 7,
    rarity: 'basic',
    family: 'optics',
    synergy: { with: 'power', bonus: 6 },
  },
  {
    building: 'scrapyard',
    fits: ['scrapyard', 'garage', 'generator', 'gauntlet'],
    name: 'Overhead Rail',
    description: 'A gantry the length of the shop. Nobody carries anything heavy twice.',
    effect: 'build_cost_reduction',
    magnitude: 6,
    rarity: 'basic',
    family: 'automation',
    synergy: { with: 'power', bonus: 5 },
  },
  {
    building: 'greenhouse',
    fits: ['greenhouse', 'apothecary', 'infirmary', 'quarters', 'scrapyard'],
    name: 'Grey Water Loop',
    description: 'Nothing leaves the building that could be used again first.',
    effect: 'training_supplies_reduction',
    magnitude: 7,
    rarity: 'basic',
    family: 'plumbing',
    synergy: { with: 'automation', bonus: 5 },
  },
  {
    building: 'infirmary',
    fits: ['infirmary', 'quarters', 'apothecary'],
    name: 'Quiet Wing',
    description:
      'Thick walls and no through traffic. People come out of it faster than they went in.',
    effect: 'payroll_percent',
    magnitude: 8,
    rarity: 'basic',
    family: 'comfort',
    synergy: { with: 'plumbing', bonus: 6 },
  },
  {
    building: 'gate',
    fits: ['gate', 'nexus', 'generator', 'scrapyard'],
    name: 'Blast Shutters',
    description: 'Steel that comes down faster than anybody can get under it.',
    effect: 'defense_percent',
    magnitude: 9,
    rarity: 'intricate',
    family: 'armour',
    synergy: { with: 'power', bonus: 7 },
  },
  {
    building: 'gauntlet',
    fits: ['gauntlet', 'quarters', 'infirmary'],
    name: 'Mess Hall',
    description: 'Hot food at the end of a shift. It is not complicated and it works.',
    effect: 'training_time_reduction',
    magnitude: 7,
    rarity: 'basic',
    family: 'comfort',
    synergy: { with: 'plumbing', bonus: 5 },
  },
  /*
   * Homed and fitted on the three structures that actually make something.
   *
   * `production_percent` is the one local effect, so a production card in a structure with no
   * output is a card that does nothing at all: the first draft of this fitted the Generator, the
   * Nexus and the Lab, none of which produce, and it would have been eight percent of nothing in
   * every slot it could reach. The catalogue test below refuses exactly that now.
   */
  {
    building: 'scrapyard',
    // The Garage was on this list until the production split took its output away. A local effect
    // in a structure with no output is a card the picker offers and the arithmetic ignores. Not
    // the Generator either: its own Load Balancers card sits in the same picker, and two cards a
    // letter apart doing different things is a shelf nobody can read.
    fits: ['scrapyard', 'greenhouse'],
    name: 'Load Balancer',
    description: 'Decides what goes dark first, so the thing that pays never does.',
    effect: 'production_percent',
    magnitude: 8,
    rarity: 'basic',
    family: 'power',
    synergy: { with: 'optics', bonus: 6 },
  },
  {
    building: 'garage',
    fits: ['garage', 'scrapyard', 'gauntlet'],
    name: 'Parts Carousel',
    description: 'The part you want arrives in front of you instead of being looked for.',
    effect: 'training_supplies_reduction',
    magnitude: 6,
    rarity: 'basic',
    family: 'automation',
    synergy: { with: 'optics', bonus: 5 },
  },
  {
    building: 'apothecary',
    fits: ['apothecary', 'greenhouse', 'infirmary'],
    name: 'Cold Store',
    description: 'A room that stays cold whatever the district is doing. Nothing spoils.',
    effect: 'storage_percent',
    magnitude: 9,
    rarity: 'intricate',
    family: 'plumbing',
    synergy: { with: 'power', bonus: 7 },
  },
  {
    building: 'gauntlet',
    fits: ['gauntlet', 'gate', 'garage'],
    name: 'Range Optics',
    description: 'Glass on the targets and a screen in the shed. Arguments about hits end.',
    effect: 'training_time_reduction',
    magnitude: 6,
    rarity: 'basic',
    family: 'optics',
    synergy: { with: 'automation', bonus: 6 },
  },
];

/** `nexus` + `Encrypted Core` → `nexus_encrypted_core`. Ids are derived so no two can collide. */
function idFor(spec: Omit<ModificationSpec, 'id'>): string {
  return `${spec.building}_${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.replace(
    /_+$/,
    '',
  );
}

export const MODIFICATIONS: readonly ModificationSpec[] = SPECS.map((spec) => ({
  ...spec,
  id: idFor(spec),
}));

const BY_ID = new Map(MODIFICATIONS.map((mod) => [mod.id, mod]));

export function findModification(id: string): ModificationSpec | undefined {
  return BY_ID.get(id);
}

export function isModificationId(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Validated against the catalogue rather than declared as an enum of seventy-seven literals: the ids
 * are *derived* from the names above, so an enum would be a second list to keep in step with the
 * first. The refinement reads the same map every lookup does.
 */
export const ModificationIdSchema = z
  .string()
  .refine(isModificationId, { message: 'unknown modification' });

/**
 * The cards that call this structure home, in catalogue order.
 *
 * Home rather than fittable: this is what the Scrapyard's bench groups by, and a card has exactly
 * one home however many structures it fits. What may be *installed* in a structure is
 * {@link modificationsFittingIn}, which is a superset and is what the district's own picker reads.
 */
export function modificationsFor(kind: BuildingKind): ModificationSpec[] {
  return MODIFICATIONS.filter((mod) => mod.building === kind);
}

/**
 * Every card that will go into this structure: its own, and the cross-building fittings.
 *
 * The list the district dialog offers when a player presses an empty slot. Sorted so a structure's
 * own cards come first, because those are the ones the Scrapyard sells under its name and the ones
 * a player has already been reading.
 */
export function modificationsFittingIn(kind: BuildingKind): ModificationSpec[] {
  return MODIFICATIONS.filter((mod) => modificationFits(mod, kind)).sort((a, b) => {
    const home = Number(b.building === kind) - Number(a.building === kind);
    return home !== 0 ? home : a.name.localeCompare(b.name);
  });
}

/** Every card of one rarity, in catalogue order. This is how the bench groups and colours them. */
export function modificationsOfRarity(rarity: ModificationRarity): readonly ModificationSpec[] {
  return MODIFICATIONS.filter((mod) => mod.rarity === rarity);
}

/** How many each structure calls its own: asserted, so a missing entry cannot ship quietly. */
export const MODIFICATIONS_PER_BUILDING = 7;

/**
 * Structure levels at which a modification slot opens (§A1: "unlocked when the building reaches
 * lvl 5, 10 and 20"). Three entries, so three is also the cap.
 */
export const MODIFICATION_SLOT_LEVELS: readonly number[] = [5, 10, 20];
export const MAX_MODIFICATION_SLOTS = MODIFICATION_SLOT_LEVELS.length;

/** How many modifications a structure at `level` may hold. */
export function modificationSlotsAt(level: number): number {
  return MODIFICATION_SLOT_LEVELS.filter((needed) => level >= needed).length;
}

/** The structure level that would open the next slot, or `null` when all three are open. */
export function nextModificationSlotLevel(level: number): number | null {
  return MODIFICATION_SLOT_LEVELS.find((needed) => level < needed) ?? null;
}

/**
 * Guards the catalogue's shape at module load rather than only under test.
 *
 * Counted over `building` rather than over what fits, because the cross-building fittings are
 * deliberately lopsided: the Quarters can take a plumbing run that the Gauntlet cannot, and a rule
 * demanding every structure fit the same number of cards would flatten exactly the decision those
 * cards exist to create. What every structure must have is its own seven.
 */
for (const kind of BUILDING_KINDS) {
  const count = modificationsFor(kind).length;
  if (count < MODIFICATIONS_PER_BUILDING) {
    throw new Error(
      `${kind} calls ${count} modifications home, expected at least ${MODIFICATIONS_PER_BUILDING}`,
    );
  }
}
