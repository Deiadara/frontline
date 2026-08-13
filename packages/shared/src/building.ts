import { z } from 'zod';
import { IdSchema } from './primitives.js';
import type { PartialResources } from './resources.js';

export const BUILDING_KINDS = [
  'command_center',
  'reactor',
  'data_hub',
  'foundry',
  'barracks',
  'wall',
] as const;
export const BuildingKindSchema = z.enum(BUILDING_KINDS);
export type BuildingKind = z.infer<typeof BuildingKindSchema>;

export const BuildingSchema = z.object({
  id: IdSchema,
  kind: BuildingKindSchema,
  level: z.number().int().min(1),
});
export type Building = z.infer<typeof BuildingSchema>;

export interface BuildingSpec {
  name: string;
  /** Short label for the village plot — the full `name` is too wide under a sprite. */
  shortName: string;
  description: string;
  /**
   * Cost to construct at level 1. Every level above that is `buildingCost`'s job. Every structure
   * burns oil to raise: GDD §D3 makes oil the resource that building and upgrading consume.
   */
  baseCost: PartialResources;
  /** Passive output per tick at level 1. */
  output: PartialResources;
}

export const BUILDING_CATALOG: Record<BuildingKind, BuildingSpec> = {
  command_center: {
    name: 'Command Center',
    shortName: 'Command',
    description: 'The nerve center of the base. Caps the level of every other structure.',
    baseCost: { caps: 400, scrap: 200, oil: 100 },
    output: { caps: 10 },
  },
  reactor: {
    name: 'Fusion Reactor',
    shortName: 'Reactor',
    description: 'Feeds the grid. Everything dies in the dark without it.',
    baseCost: { caps: 150, scrap: 100, oil: 60 },
    output: { oil: 18 },
  },
  data_hub: {
    name: 'Data Hub',
    shortName: 'Data Hub',
    description: 'Harvests the datastream for intel and market signals.',
    baseCost: { caps: 200, scrap: 80, oil: 40 },
    output: { caps: 12 },
  },
  foundry: {
    name: 'Foundry',
    shortName: 'Foundry',
    description: 'Smelts scavenged wreckage into high-quality metal.',
    baseCost: { caps: 250, scrap: 150, oil: 50 },
    output: { highQualityMetal: 6 },
  },
  barracks: {
    name: 'Barracks',
    shortName: 'Barracks',
    description: 'Houses and trains your enforcers.',
    baseCost: { caps: 300, scrap: 150, oil: 40 },
    output: {},
  },
  wall: {
    name: 'Perimeter Wall',
    shortName: 'Wall',
    description: 'Ferrocrete and razorwire. The first thing raiders meet.',
    baseCost: { scrap: 250, oil: 30 },
    output: {},
  },
};

/**
 * Ceiling on every structure's level (GDD §D3 — the hideout is what oil is spent on, so it needs a
 * top). The Command Center is the only structure allowed to reach it; see `structureLevelCap`.
 */
export const BUILDING_MAX_LEVEL = 10;

/**
 * Per-level cost growth. Level 1 is the catalogue price; each level after multiplies it, so the
 * level-10 Command Center costs ~69x its first build and oil stays the thing you never have enough
 * of. Costs are what §D3 is: the sink.
 */
export const BUILDING_COST_GROWTH = 1.6;

/**
 * What it costs to raise `kind` **to** `level` — level 1 being the initial construction.
 *
 * The whole `baseCost` bundle scales, not just the oil, so a structure never gets cheaper in any
 * resource as it climbs. Rounded to whole units: resources are counted, not measured.
 */
export function buildingCost(kind: BuildingKind, level: number): PartialResources {
  const growth = BUILDING_COST_GROWTH ** (level - 1);
  const scaled = Object.entries(BUILDING_CATALOG[kind].baseCost).map(([key, amount]) => [
    key,
    Math.round((amount ?? 0) * growth),
  ]);
  return Object.fromEntries(scaled) as PartialResources;
}

/**
 * The highest level `kind` may currently reach on this base.
 *
 * The Command Center's own catalogue copy is the rule ("Caps the level of every other structure"),
 * so it is enforced rather than left as flavour text: everything else stops at the Command Center's
 * level, and the Command Center itself stops at {@link BUILDING_MAX_LEVEL}. A hideout with no
 * Command Center standing caps everything else at 0, which is why the starting base is minted with
 * one.
 */
export function structureLevelCap(kind: BuildingKind, buildings: readonly Building[]): number {
  if (kind === 'command_center') return BUILDING_MAX_LEVEL;
  return buildings.find((building) => building.kind === 'command_center')?.level ?? 0;
}

/** The level a build/upgrade would produce, or `null` when the structure is already at its cap. */
export function nextStructureLevel(
  kind: BuildingKind,
  buildings: readonly Building[],
): number | null {
  const current = buildings.find((building) => building.kind === kind)?.level ?? 0;
  const next = current + 1;
  return next > structureLevelCap(kind, buildings) ? null : next;
}
