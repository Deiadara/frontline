import { z } from 'zod';
import { IdSchema } from './primitives.js';
import { PartialResourcesSchema } from './resources.js';

export const DISTRICT_KINDS = ['player_base', 'raid', 'market', 'npc_stronghold'] as const;
export const DistrictKindSchema = z.enum(DISTRICT_KINDS);
export type DistrictKind = z.infer<typeof DistrictKindSchema>;

/** Normalized 0..1 map coordinates — the renderer scales to its viewport. */
export const PositionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type Position = z.infer<typeof PositionSchema>;

/** A node on the Grepolis-style city map. */
export const DistrictSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: DistrictKindSchema,
  position: PositionSchema,
  difficulty: z.number().int().min(1).max(10),
  rewards: PartialResourcesSchema,
});
export type District = z.infer<typeof DistrictSchema>;

/** District new players are settled into by POST /api/overseer. */
export const STARTER_DISTRICT_ID = 'neon-docks';

/** The hard-coded city map. */
export const CITY_DISTRICTS: readonly District[] = [
  {
    id: 'neon-docks',
    name: 'Neon Docks',
    kind: 'player_base',
    position: { x: 0.12, y: 0.72 },
    difficulty: 1,
    rewards: {},
  },
  {
    id: 'ashen-terraces',
    name: 'Ashen Terraces',
    kind: 'player_base',
    position: { x: 0.85, y: 0.2 },
    difficulty: 1,
    rewards: {},
  },
  {
    id: 'rustyard',
    name: 'The Rustyard',
    kind: 'raid',
    position: { x: 0.28, y: 0.55 },
    difficulty: 2,
    rewards: { alloy: 120, credits: 60 },
  },
  {
    id: 'chrome-row',
    name: 'Chrome Row',
    kind: 'raid',
    position: { x: 0.45, y: 0.78 },
    difficulty: 4,
    rewards: { credits: 200, power: 40 },
  },
  {
    id: 'undergrid',
    name: 'The Undergrid',
    kind: 'raid',
    position: { x: 0.55, y: 0.42 },
    difficulty: 5,
    rewards: { power: 90, data: 45 },
  },
  {
    id: 'datavault-sigma',
    name: 'Datavault Sigma',
    kind: 'raid',
    position: { x: 0.68, y: 0.65 },
    difficulty: 6,
    rewards: { data: 160, credits: 90 },
  },
  {
    id: 'glasshouse-fields',
    name: 'Glasshouse Fields',
    kind: 'raid',
    position: { x: 0.2, y: 0.28 },
    difficulty: 3,
    rewards: { credits: 110, alloy: 70 },
  },
  {
    id: 'sprawl-exchange',
    name: 'Sprawl Exchange',
    kind: 'market',
    position: { x: 0.38, y: 0.15 },
    difficulty: 1,
    rewards: {},
  },
  {
    id: 'halcyon-plaza',
    name: 'Halcyon Plaza',
    kind: 'market',
    position: { x: 0.62, y: 0.88 },
    difficulty: 2,
    rewards: {},
  },
  {
    id: 'blacksite-7',
    name: 'Blacksite 7',
    kind: 'npc_stronghold',
    position: { x: 0.78, y: 0.38 },
    difficulty: 8,
    rewards: { credits: 350, data: 200, alloy: 150 },
  },
  {
    id: 'combine-spire',
    name: 'Spire of the Combine',
    kind: 'npc_stronghold',
    position: { x: 0.5, y: 0.08 },
    difficulty: 10,
    rewards: { credits: 600, power: 250, data: 300, alloy: 300 },
  },
];

export function findDistrict(districtId: string): District | undefined {
  return CITY_DISTRICTS.find((district) => district.id === districtId);
}
