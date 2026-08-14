import { z } from 'zod';
import { BUILDING_KINDS, type BuildingKind } from './kinds.js';

/**
 * Building modifications (GDD §A1) — the second axis a structure improves along.
 *
 * A modification is **not** a level. Levels are bought with materials and time; a modification is
 * *researched*, needs a Lead Engineer on the books to run the work, and then stays installed. Each
 * structure offers five, and holds at most {@link MAX_MODIFICATION_SLOTS} of them — so the choice
 * is which three of the five this district is, and it is not reversible on a whim.
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
 * Every kind is oriented so that **more is better**, including the ones that shrink a number — a
 * `build_time_reduction` of 10 means builds take 10% less time. A player comparing two figures
 * should never have to remember which way one of them points.
 */
export const MODIFICATION_EFFECTS = [
  /** This structure's own hourly output. The only effect that is local rather than district-wide. */
  'production_percent',
  'build_cost_reduction',
  'build_time_reduction',
  'storage_percent',
  'power_supply_percent',
  'power_draw_reduction',
  'defense_percent',
  /** Flat points on the morale meter, not a percentage. */
  'morale_flat',
  'research_time_reduction',
  'housing_percent',
  'character_xp_percent',
  /** Softens the morale hit from a missed payday or a lean week. */
  'hardship_reduction',
  'raid_loot_percent',
  /** Oil the Generator burns to hold the grid up. */
  'fuel_efficiency',
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
  /** Percentage points, or flat meter points for `morale_flat`. Always positive. */
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
    description: 'Encrypts all faction data. Anyone casing this district works blind.',
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
      'The district keeps running through a bad week because it does not need to be told to.',
    effect: 'hardship_reduction',
    magnitude: 20,
  },
  {
    building: 'nexus',
    name: 'Grid Priority Bus',
    description: 'The Nexus decides what browns out first, and it is never anything that matters.',
    effect: 'power_draw_reduction',
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
    name: 'Sound Baffling',
    description: 'Salvaged foam on every bulkhead. People actually sleep.',
    effect: 'morale_flat',
    magnitude: 4,
  },
  {
    building: 'quarters',
    name: 'Filtered Air Handlers',
    description:
      'Clean air on the bunk deck. A lean week is a lot less lean without a chest full of undercity.',
    effect: 'hardship_reduction',
    magnitude: 15,
  },
  {
    building: 'quarters',
    name: 'Prefab Stacks',
    description:
      'The crew assembles its own housing off a pattern, and the pattern gets reused everywhere else.',
    effect: 'build_cost_reduction',
    magnitude: 6,
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
    description: 'Heat stays in, so the lamps stop paying to warm the district.',
    effect: 'power_draw_reduction',
    magnitude: 12,
  },
  {
    building: 'greenhouse',
    name: 'Canteen Line',
    description: 'Fresh food served where it is grown. The crew notices immediately.',
    effect: 'morale_flat',
    magnitude: 5,
  },
  {
    building: 'greenhouse',
    name: 'Seed Vault',
    description:
      'A cold locker of everything that grows here. A failed crop stops being a catastrophe.',
    effect: 'hardship_reduction',
    magnitude: 18,
  },

  // --- The Generator ---
  {
    building: 'generator',
    name: 'Cascade Turbines',
    description:
      'Exhaust off the first stage spins the second. Twice the noise, far more than twice the output.',
    effect: 'power_supply_percent',
    magnitude: 20,
  },
  {
    building: 'generator',
    name: 'Heat Recapture',
    description: 'The waste heat goes back into the boiler instead of into the ceiling.',
    effect: 'power_supply_percent',
    magnitude: 14,
  },
  {
    building: 'generator',
    name: 'Fuel Polishing',
    description: 'Water and sludge out before the burn. The same oil goes appreciably further.',
    effect: 'fuel_efficiency',
    magnitude: 25,
  },
  {
    building: 'generator',
    name: 'Load Balancers',
    description:
      'Draw is smoothed across the day, so nothing spikes and nothing is oversized to survive it.',
    effect: 'power_draw_reduction',
    magnitude: 10,
  },
  {
    building: 'generator',
    name: 'Silent Mounts',
    description:
      'The turbine stops being audible in the Quarters. Small thing. Enormous difference.',
    effect: 'morale_flat',
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
      'Fume hoods and local extraction replace running the whole floor at full ventilation.',
    effect: 'power_draw_reduction',
    magnitude: 10,
  },

  // --- The Cistern ---
  {
    building: 'cistern',
    name: 'Reverse Osmosis Stack',
    description:
      'Membrane filtration on the outflow. The district can hold more people on the same intake.',
    effect: 'housing_percent',
    magnitude: 14,
  },
  {
    building: 'cistern',
    name: 'Greywater Recovery',
    description: 'Nothing leaves this district once. A dry month stops being a crisis.',
    effect: 'hardship_reduction',
    magnitude: 18,
  },
  {
    building: 'cistern',
    name: 'Chlorination Automation',
    description:
      'Dosing runs itself instead of running the pumps flat out and correcting afterwards.',
    effect: 'power_draw_reduction',
    magnitude: 12,
  },
  {
    building: 'cistern',
    name: 'Settling Expansion',
    description:
      'Two more tanks cut into the rock. Buffer for the district, and space for everything else.',
    effect: 'storage_percent',
    magnitude: 12,
  },
  {
    building: 'cistern',
    name: 'Clean Line to the Commons',
    description:
      'Drinkable water on tap where the crew drinks. The Combine charges for this upstairs.',
    effect: 'morale_flat',
    magnitude: 5,
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
    description: 'Every crew goes out carrying what it needs to get through a bad one.',
    effect: 'hardship_reduction',
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

  // --- The Commons ---
  {
    building: 'commons',
    name: 'Arcades',
    description:
      'Entertainment machines, mostly working. Morale goes up significantly and stays there.',
    effect: 'morale_flat',
    magnitude: 8,
  },
  {
    building: 'commons',
    name: 'Graffiti Walls',
    description:
      'Designated art space. Increases faction identity and pride — the district starts looking like itself.',
    effect: 'morale_flat',
    magnitude: 6,
  },
  {
    building: 'commons',
    name: 'Shared Kitchens',
    description:
      'Everyone eats the same food at the same table, including in the weeks there is not much of it.',
    effect: 'hardship_reduction',
    magnitude: 20,
  },
  {
    building: 'commons',
    name: 'Notice Board',
    description:
      'Who needs what, posted where everyone drinks. Work finds hands without going through an officer.',
    effect: 'build_time_reduction',
    magnitude: 8,
  },
  {
    building: 'commons',
    name: 'Sparring Circle',
    description: 'Friendly, mostly. People learn more here than they do being told things.',
    effect: 'character_xp_percent',
    magnitude: 10,
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
      'A crew that is fit takes a hard month the way a crew that is not takes a hard week.',
    effect: 'hardship_reduction',
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
    description: 'Combine training rigs, repurposed. They teach the crew and they teach the Lab.',
    effect: 'research_time_reduction',
    magnitude: 8,
  },

  // --- The Infirmary ---
  {
    building: 'infirmary',
    name: 'Autoclave Suite',
    description: 'Sterile instruments, every time. The difference between a wound and a funeral.',
    effect: 'hardship_reduction',
    magnitude: 22,
  },
  {
    building: 'infirmary',
    name: 'Compounding Printer',
    description:
      'Prints the drugs the Combine will not sell down here, from precursors it cannot trace.',
    effect: 'hardship_reduction',
    magnitude: 16,
  },
  {
    building: 'infirmary',
    name: 'Trauma Bay',
    description:
      'People come back from jobs they would not have come back from. The crew knows it.',
    effect: 'morale_flat',
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
    name: 'Mobile Generators',
    description: 'Vehicle powerplants patched into the grid when they are not under a chassis.',
    effect: 'power_supply_percent',
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

/** How many each structure offers — asserted, so a missing entry cannot ship quietly. */
export const MODIFICATIONS_PER_BUILDING = 5;

/**
 * Structure levels at which a modification slot opens (§A1 — "unlocked when the building reaches
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
  /** §C4 — nobody on the books holds the Lead Engineer post. */
  'no_lead_engineer',
  /** Another project is already on the bench (§B9 — one at a time). */
  'research_busy',
  'cannot_afford',
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
