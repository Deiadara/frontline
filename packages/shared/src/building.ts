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
  description: string;
  /**
   * Cost to construct at level 1 (per-level scaling is a later milestone). Every structure burns
   * oil to raise: GDD §D3 makes oil the resource that building and upgrading consume.
   */
  baseCost: PartialResources;
  /** Passive output per tick at level 1. */
  output: PartialResources;
}

export const BUILDING_CATALOG: Record<BuildingKind, BuildingSpec> = {
  command_center: {
    name: 'Command Center',
    description: 'The nerve center of the base. Caps the level of every other structure.',
    baseCost: { caps: 400, scrap: 200, oil: 100 },
    output: { caps: 10 },
  },
  reactor: {
    name: 'Fusion Reactor',
    description: 'Feeds the grid. Everything dies in the dark without it.',
    baseCost: { caps: 150, scrap: 100, oil: 60 },
    output: { oil: 18 },
  },
  data_hub: {
    name: 'Data Hub',
    description: 'Harvests the datastream for intel and market signals.',
    baseCost: { caps: 200, scrap: 80, oil: 40 },
    output: { caps: 12 },
  },
  foundry: {
    name: 'Foundry',
    description: 'Smelts scavenged wreckage into high-quality metal.',
    baseCost: { caps: 250, scrap: 150, oil: 50 },
    output: { highQualityMetal: 6 },
  },
  barracks: {
    name: 'Barracks',
    description: 'Houses and trains your enforcers.',
    baseCost: { caps: 300, scrap: 150, oil: 40 },
    output: {},
  },
  wall: {
    name: 'Perimeter Wall',
    description: 'Ferrocrete and razorwire. The first thing raiders meet.',
    baseCost: { scrap: 250, oil: 30 },
    output: {},
  },
};
