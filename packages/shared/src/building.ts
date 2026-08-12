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
  /** Cost to construct at level 1 (per-level scaling is a later milestone). */
  baseCost: PartialResources;
  /** Passive output per tick at level 1. */
  output: PartialResources;
}

export const BUILDING_CATALOG: Record<BuildingKind, BuildingSpec> = {
  command_center: {
    name: 'Command Center',
    description: 'The nerve center of the base. Caps the level of every other structure.',
    baseCost: { credits: 400, alloy: 200 },
    output: { credits: 10 },
  },
  reactor: {
    name: 'Fusion Reactor',
    description: 'Feeds the grid. Everything dies in the dark without it.',
    baseCost: { credits: 150, alloy: 100 },
    output: { power: 20 },
  },
  data_hub: {
    name: 'Data Hub',
    description: 'Harvests the datastream for intel and market signals.',
    baseCost: { credits: 200, power: 30 },
    output: { data: 15 },
  },
  foundry: {
    name: 'Foundry',
    description: 'Smelts scavenged wreckage into usable alloy.',
    baseCost: { credits: 250, power: 40 },
    output: { alloy: 12 },
  },
  barracks: {
    name: 'Barracks',
    description: 'Houses and trains your enforcers.',
    baseCost: { credits: 300, alloy: 150 },
    output: {},
  },
  wall: {
    name: 'Perimeter Wall',
    description: 'Ferrocrete and razorwire. The first thing raiders meet.',
    baseCost: { alloy: 250 },
    output: {},
  },
};
