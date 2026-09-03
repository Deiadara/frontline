import { z } from 'zod';
import { BUILDING_KINDS, type BuildingKind } from './kinds.js';

/**
 * Building modifications (GDD §A1): the second axis a structure improves along.
 *
 * A modification is **not** a level. Levels are bought with materials and time; a modification is
 * *researched* or built in the Scrapyard, needs a Lead Engineer on the books to design it, and then
 * sits in one of the structure's three slots. Each structure offers five and holds three, so the
 * choice is which three of the five this district is: see §E, which is what made the slots
 * emptiable again.
 *
 * Slots open as the structure grows, at {@link MODIFICATION_SLOT_LEVELS}.
 */

/**
 * What a modification actually does.
 *
 * A closed set, and every member is read by something. That constraint is the whole design of this
 * module: it would have been easy to give each of the sixty-five a bespoke sentence and no
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
  'character_xp_percent',
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

export interface ModificationSpec {
  id: string;
  building: BuildingKind;
  name: string;
  description: string;
  effect: ModificationEffect;
  /** Percentage points. Always positive. */
  magnitude: number;
}

/**
 * The catalogue, five per structure.
 *
 * The board named nine of these outright (Encrypted Core, Automated Protocols, Precision
 * Fabricators, Salvage Drones, Quantum Modeling, Neural Drafting Table, Redundant Testing
 * Chambers, Arcades, Graffiti Walls, Insect Farm); those keep the board's own name and wording.
 * The rest fill each structure out to five along the same lines.
 */
const SPECS: readonly Omit<ModificationSpec, 'id'>[] = [
  // --- The Nexus ---
  {
    building: 'nexus',
    name: 'Encrypted Core',
    description: 'Encrypts all allegiance data. Anyone casing this district works blind.',
    effect: 'defense_percent',
    magnitude: 12,
  },
  {
    building: 'nexus',
    name: 'Automated Protocols',
    description:
      'Some functions run without staff assigned, so the work starts the moment it is ordered.',
    effect: 'build_time_reduction',
    magnitude: 10,
  },
  {
    building: 'nexus',
    name: 'Requisition Ledger',
    description: 'Every job costed before it is called in. Nothing is ordered twice.',
    effect: 'build_cost_reduction',
    magnitude: 10,
  },
  {
    building: 'nexus',
    name: 'Standing Orders',
    description:
      'Every job has a written rate and nobody argues about it. The book stretches further for it.',
    effect: 'payroll_percent',
    magnitude: 20,
  },
  {
    building: 'nexus',
    name: 'Priority Bus',
    description: 'The Nexus decides which job goes first, and it is never the one that can wait.',
    effect: 'build_time_reduction',
    magnitude: 8,
  },

  // --- The Quarters ---
  {
    building: 'quarters',
    name: 'Hot Bunking',
    description: 'Two shifts, one bed, and nobody in it at the same time.',
    effect: 'housing_percent',
    magnitude: 18,
  },
  {
    building: 'quarters',
    name: 'Debriefing Room',
    description:
      'Salvaged foam on every bulkhead, and a table in the middle of it. Crews come back and say what happened.',
    effect: 'faction_xp_percent',
    magnitude: 4,
  },
  {
    building: 'quarters',
    name: 'Filtered Air Handlers',
    description:
      'Clean air on the bunk deck. People sign for less when they can breathe where they sleep.',
    effect: 'payroll_percent',
    magnitude: 15,
  },
  {
    building: 'quarters',
    name: 'Prefab Stacks',
    description:
      'The crew assembles its own housing off a pattern, and the pattern is a storey taller each time.',
    effect: 'housing_percent',
    magnitude: 12,
  },
  {
    building: 'quarters',
    name: 'Turnout Drills',
    description:
      'Bunk to boots in ninety seconds. It carries into everything else they are asked to do.',
    effect: 'character_xp_percent',
    magnitude: 8,
  },

  // --- The Greenhouse ---
  {
    building: 'greenhouse',
    name: 'Insect Farm',
    description:
      'Protein alternative. Efficient, low resource cost, and nobody asks twice what is in it.',
    effect: 'production_percent',
    magnitude: 22,
  },
  {
    building: 'greenhouse',
    name: 'Spectrum Lamps',
    description: 'Tuned to what each tray actually wants instead of to what was in the crate.',
    effect: 'production_percent',
    magnitude: 16,
  },
  {
    building: 'greenhouse',
    name: 'Sealed Growrooms',
    description:
      'Heat stays in and the trays run year round, so a ration goes further than it did.',
    effect: 'training_supplies_reduction',
    magnitude: 12,
  },
  {
    building: 'greenhouse',
    name: 'Canteen Line',
    description:
      'Fresh food served where it is grown. What gets talked about over it is what went wrong last night.',
    effect: 'faction_xp_percent',
    magnitude: 5,
  },
  {
    building: 'greenhouse',
    name: 'Seed Vault',
    description:
      'A cold locker of everything that grows here. Nobody has to be paid in advance against a bad crop.',
    effect: 'payroll_percent',
    magnitude: 18,
  },

  // --- The Generator ---
  {
    building: 'generator',
    name: 'Cascade Turbines',
    description:
      'Exhaust off the first stage spins the second. Twice the noise, and every crane in the district turns faster.',
    effect: 'build_time_reduction',
    magnitude: 14,
  },
  {
    building: 'generator',
    name: 'Heat Recapture',
    description: 'The waste heat goes back into the boiler instead of into the ceiling.',
    effect: 'build_cost_reduction',
    magnitude: 10,
  },
  {
    building: 'generator',
    name: 'Fuel Polishing',
    description: 'Water and sludge out before the burn. The same oil goes appreciably further.',
    effect: 'build_cost_reduction',
    magnitude: 12,
  },
  {
    building: 'generator',
    name: 'Load Balancers',
    description:
      'Work is smoothed across the day, so nothing spikes and no crew stands idle waiting for one.',
    effect: 'build_time_reduction',
    magnitude: 10,
  },
  {
    building: 'generator',
    name: 'Instrument Bench',
    description:
      'The turbine gets a bench and a log book beside it. Everything that breaks is written down and read.',
    effect: 'faction_xp_percent',
    magnitude: 3,
  },

  // --- The Scrapyard ---
  {
    building: 'scrapyard',
    name: 'Precision Fabricators',
    description:
      'Improves the quality of crafted weapons and devices, and wastes far less getting there.',
    effect: 'production_percent',
    magnitude: 18,
  },
  {
    building: 'scrapyard',
    name: 'Salvage Drones',
    description:
      'Automated units that collect scrap after raids, while everyone else is still leaving.',
    effect: 'raid_loot_percent',
    magnitude: 20,
  },
  {
    building: 'scrapyard',
    name: 'Magnetic Sorting Line',
    description:
      'Ferrous off the belt before a hand touches it. The sorting floor triples its throughput.',
    effect: 'production_percent',
    magnitude: 14,
  },
  {
    building: 'scrapyard',
    name: 'Press Automation',
    description:
      'Stock cut to pattern here rather than on site, so every build order lands lighter.',
    effect: 'build_cost_reduction',
    magnitude: 8,
  },
  {
    building: 'scrapyard',
    name: 'Cutting Bay Extraction',
    description:
      'Fume hoods and local extraction, so the floor runs a full shift instead of clearing the air twice a day.',
    effect: 'production_percent',
    magnitude: 10,
  },

  // --- The Apothecary ---
  {
    building: 'apothecary',
    name: 'Deep Racking',
    description:
      'The stack goes up to the roof and back into the rock. Nothing is on the floor any more.',
    effect: 'storage_percent',
    magnitude: 20,
  },
  {
    building: 'apothecary',
    name: 'Climate Cells',
    description: 'Sealed, cooled and logged. Things keep here that used to spoil in a fortnight.',
    effect: 'storage_percent',
    magnitude: 15,
  },
  {
    building: 'apothecary',
    name: 'False Bulkheads',
    description:
      'The real stock is not where the ledger says. Raiders take the decoy and leave satisfied.',
    effect: 'defense_percent',
    magnitude: 10,
  },
  {
    building: 'apothecary',
    name: 'Field Kits',
    description:
      'Every crew goes out carrying what it needs, so nobody is owed danger money for going without.',
    effect: 'payroll_percent',
    magnitude: 15,
  },
  {
    building: 'apothecary',
    name: 'Bulk Requisition',
    description:
      'Buy for the year, not for the job. What the district builds gets cheaper across the board.',
    effect: 'build_cost_reduction',
    magnitude: 8,
  },

  // --- The Gate ---
  {
    building: 'gate',
    name: 'Interlocking Bulwarks',
    description: 'Ferrocrete teeth staggered so nothing has a straight run at the opening.',
    effect: 'defense_percent',
    magnitude: 20,
  },
  {
    building: 'gate',
    name: 'Automated Turret Nests',
    description: 'Salvaged servos and a firing solution that does not need anyone awake.',
    effect: 'defense_percent',
    magnitude: 16,
  },
  {
    building: 'gate',
    name: 'Sally Port',
    description:
      'A way out that raiders do not know about, which is also a way back in carrying things.',
    effect: 'raid_loot_percent',
    magnitude: 10,
  },
  {
    building: 'gate',
    name: 'Watch Rota',
    description: 'Everyone stands a turn on the step. Everyone gets better at reading the street.',
    effect: 'character_xp_percent',
    magnitude: 8,
  },
  {
    building: 'gate',
    name: 'Ferrocrete Recycling',
    description: 'Rubble goes back into the mixer. Every wall in the district costs less to raise.',
    effect: 'build_cost_reduction',
    magnitude: 7,
  },

  // --- The Lab ---
  {
    building: 'lab',
    name: 'Quantum Modeling',
    description:
      'Research ideas faster using predictive algorithms, and stop running the dead ends at all.',
    effect: 'research_time_reduction',
    magnitude: 18,
  },
  {
    building: 'lab',
    name: 'Neural Drafting Table',
    description:
      'Researchers use implants to design directly in their mind. What they learn doing it stays.',
    effect: 'character_xp_percent',
    magnitude: 12,
  },
  {
    building: 'lab',
    name: 'Redundant Testing Chambers',
    description:
      'Run multiple experiments simultaneously instead of queuing behind the slowest one.',
    effect: 'research_time_reduction',
    magnitude: 14,
  },
  {
    building: 'lab',
    name: 'Process Cell',
    description:
      'Efficient work streams, written down, followed. The whole district builds faster for it.',
    effect: 'build_time_reduction',
    magnitude: 10,
  },
  {
    building: 'lab',
    name: 'Shielded Datacore',
    description: 'Faraday mesh and an air gap. What the district knows cannot be taken off it.',
    effect: 'defense_percent',
    magnitude: 10,
  },

  // --- The Gauntlet ---
  {
    building: 'gauntlet',
    name: 'Live-Fire Range',
    description: 'Real rounds, real noise. Nothing else teaches as fast or as permanently.',
    effect: 'character_xp_percent',
    magnitude: 18,
  },
  {
    building: 'gauntlet',
    name: 'Instructor Cadre',
    description: 'People whose whole job is making other people better at theirs.',
    effect: 'character_xp_percent',
    magnitude: 14,
  },
  {
    building: 'gauntlet',
    name: 'Conditioning Programme',
    description:
      'A crew that is fit costs less to keep. Half of what an officer charges is for the risk.',
    effect: 'payroll_percent',
    magnitude: 15,
  },
  {
    building: 'gauntlet',
    name: 'Drill Yard Extension',
    description: 'The yard doubles as muster ground and overflow billet when the district is full.',
    effect: 'housing_percent',
    magnitude: 10,
  },
  {
    building: 'gauntlet',
    name: 'Salvaged Simulators',
    description:
      'Combine training rigs, repurposed. A recruit walks the course before they walk it.',
    effect: 'training_time_reduction',
    magnitude: 12,
  },

  // --- The Infirmary ---
  {
    building: 'infirmary',
    name: 'Autoclave Suite',
    description:
      'Sterile instruments, every time. An officer who expects to survive the year asks for less of it up front.',
    effect: 'payroll_percent',
    magnitude: 22,
  },
  {
    building: 'infirmary',
    name: 'Compounding Printer',
    description:
      'Prints the drugs the Combine will not sell down here. What that saves goes straight on the book.',
    effect: 'payroll_percent',
    magnitude: 16,
  },
  {
    building: 'infirmary',
    name: 'Trauma Bay',
    description:
      'People come back from jobs they would not have come back from, and the crew learns from every one.',
    effect: 'faction_xp_percent',
    magnitude: 6,
  },
  {
    building: 'infirmary',
    name: 'Nutrition Programme',
    description: 'Somebody finally works out what the crew is actually short of, and fixes it.',
    effect: 'character_xp_percent',
    magnitude: 10,
  },
  {
    building: 'infirmary',
    name: 'Cold Storage',
    description: 'A cold chain that runs the length of the district, for far more than medicine.',
    effect: 'storage_percent',
    magnitude: 10,
  },

  // --- The Garage ---
  {
    building: 'garage',
    name: 'Rotor Bay',
    description:
      'High enough for a mast, wide enough for blades. The thing nobody will discuss gets finished here.',
    effect: 'production_percent',
    magnitude: 20,
  },
  {
    building: 'garage',
    name: 'Fuel Cracking Column',
    description: 'Heavy ends into something an engine will actually take.',
    effect: 'production_percent',
    magnitude: 16,
  },
  {
    building: 'garage',
    name: 'Haulage Rigs',
    description: 'Flatbeds and a crane. A raid stops being limited by what people can carry.',
    effect: 'raid_loot_percent',
    magnitude: 22,
  },
  {
    building: 'garage',
    name: 'Machine Shop',
    description:
      'Parts made here instead of waited for. Every build in the district stops queuing behind a part.',
    effect: 'build_time_reduction',
    magnitude: 12,
  },
  {
    building: 'garage',
    name: 'Mobile Rigs',
    description:
      'Vehicle powerplants dragged out to whichever site needs one, when nothing is on the ramp.',
    effect: 'build_time_reduction',
    magnitude: 10,
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

export const MODIFICATION_IDS: readonly string[] = MODIFICATIONS.map((mod) => mod.id);

const BY_ID = new Map(MODIFICATIONS.map((mod) => [mod.id, mod]));

export function findModification(id: string): ModificationSpec | undefined {
  return BY_ID.get(id);
}

export function isModificationId(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Validated against the catalogue rather than declared as an enum of sixty-five literals: the ids
 * are *derived* from the names above, so an enum would be a second list to keep in step with the
 * first. The refinement reads the same map every lookup does.
 */
export const ModificationIdSchema = z
  .string()
  .refine(isModificationId, { message: 'unknown modification' });
export type ModificationId = string;

/** The five a structure offers, in catalogue order. */
export function modificationsFor(kind: BuildingKind): ModificationSpec[] {
  return MODIFICATIONS.filter((mod) => mod.building === kind);
}

/** How many each structure offers: asserted, so a missing entry cannot ship quietly. */
export const MODIFICATIONS_PER_BUILDING = 5;

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
 * Why a modification cannot be started right now. Ordered as they are checked, most structural
 * first: no point telling a player they cannot afford something their district cannot host.
 */
export const MODIFICATION_BLOCKERS = [
  /** The structure it goes in has not been built. */
  'not_built',
  /** Built, but every slot its level has opened is already full. */
  'no_slot',
  /** §C4: nobody on the books holds the Lead Engineer post. */
  'no_lead_engineer',
  /** Another project is already on the bench (§B9: one at a time). */
  'research_busy',
  'cannot_afford',
  /**
   * The crew already owns the drawing, whether it is on the shelf or bolted on.
   *
   * A real blocker rather than "nothing is in the way". It used to be spelled as an early `return
   * null`, which the display path never reached (it short-circuits on `installed`) and the one
   * caller that treats the blocker as a *gate* read as permission: the Lab charged for a second
   * copy of the same paper, ran its clock, and banked nothing at the end because the id was
   * already in `addons.researched`.
   */
  'already_drawn',
] as const;
export const ModificationBlockerSchema = z.enum(MODIFICATION_BLOCKERS);
export type ModificationBlocker = z.infer<typeof ModificationBlockerSchema>;

/** Guards the catalogue's shape at module load rather than only under test. */
for (const kind of BUILDING_KINDS) {
  const count = modificationsFor(kind).length;
  if (count !== MODIFICATIONS_PER_BUILDING) {
    throw new Error(
      `${kind} offers ${count} modifications, expected ${MODIFICATIONS_PER_BUILDING}`,
    );
  }
}
