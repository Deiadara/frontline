import { z } from 'zod';
import type { RaidTarget } from './economy/reputation.js';
import { FactionSchema, governmentGarrisonFor } from './factions.js';
import { IdSchema } from './primitives.js';
import { PartialResourcesSchema } from './resources.js';

/**
 * `npc_stronghold` is a *Combine* stronghold (§A3) — a seat of the government's power rather than
 * one of its outposts. The member is not renamed to say so because the value is persisted (see
 * `db/migrations/0001_init.sql`); `faction` on the district carries the meaning instead.
 */
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
  /**
   * Whose ground this is (§A3). The Combine holds most of the attackable map — that is what makes
   * it "the main enemy" — but not all of it, so hitting a site is a choice about who you anger.
   */
  faction: FactionSchema,
  position: PositionSchema,
  difficulty: z.number().int().min(1).max(10),
  rewards: PartialResourcesSchema,
});
export type District = z.infer<typeof DistrictSchema>;

/** District new players are settled into by POST /api/overseer. */
export const STARTER_DISTRICT_ID = 'neon-docks';

/**
 * District held by the seeded AI rival. Its base is the only *base* that can be
 * raided — every other `player_base` district belongs to a human and is off-limits.
 */
export const BOT_DISTRICT_ID = 'ashen-terraces';

/**
 * The hard-coded city map.
 *
 * §A3 — the Combine holds the top of the ladder and most of what is worth taking: the two
 * strongholds, the data vault, the power spine and the state farms. The Rustyard and Chrome Row
 * stay independent on purpose, so "the *main* enemy" is a statement about the map and not a
 * tautology, and so a crew that wants nothing to do with the government still has ground to raid.
 */
export const CITY_DISTRICTS: readonly District[] = [
  {
    id: 'neon-docks',
    name: 'Neon Docks',
    kind: 'player_base',
    faction: 'independent',
    position: { x: 0.12, y: 0.72 },
    difficulty: 1,
    rewards: {},
  },
  {
    id: 'ashen-terraces',
    name: 'Ashen Terraces',
    kind: 'player_base',
    // A rival crew, not the state: raiding it is a street matter and moves no §D8 stance counter.
    faction: 'independent',
    position: { x: 0.85, y: 0.2 },
    // Held by the AI rival: a fortified base, so it sits between the mid raids and Blacksite 7.
    difficulty: 4,
    rewards: { caps: 180, scrap: 140, food: 60 },
  },
  {
    id: 'rustyard',
    name: 'The Rustyard',
    kind: 'raid',
    faction: 'independent',
    position: { x: 0.28, y: 0.55 },
    difficulty: 2,
    rewards: { scrap: 120, caps: 60 },
  },
  {
    id: 'chrome-row',
    name: 'Chrome Row',
    kind: 'raid',
    faction: 'independent',
    position: { x: 0.45, y: 0.78 },
    difficulty: 4,
    rewards: { caps: 200, scrap: 40 },
  },
  {
    id: 'undergrid',
    name: 'The Undergrid',
    kind: 'raid',
    // The Combine meters the undercity from here — the power spine, not a scrap claim.
    faction: 'government',
    position: { x: 0.55, y: 0.42 },
    difficulty: 5,
    rewards: { oil: 90, scrap: 45 },
  },
  {
    id: 'datavault-sigma',
    name: 'Datavault Sigma',
    kind: 'raid',
    faction: 'government',
    position: { x: 0.68, y: 0.65 },
    difficulty: 6,
    rewards: { caps: 160, highQualityMetal: 30 },
  },
  {
    id: 'glasshouse-fields',
    name: 'Glasshouse Fields',
    kind: 'raid',
    // State hydroponics. Everything the undercity eats is grown behind this fence.
    faction: 'government',
    position: { x: 0.2, y: 0.28 },
    difficulty: 3,
    rewards: { food: 110, scrap: 70 },
  },
  {
    id: 'sprawl-exchange',
    name: 'Sprawl Exchange',
    kind: 'market',
    faction: 'independent',
    position: { x: 0.38, y: 0.15 },
    difficulty: 1,
    rewards: {},
  },
  {
    id: 'halcyon-plaza',
    name: 'Halcyon Plaza',
    kind: 'market',
    faction: 'independent',
    position: { x: 0.62, y: 0.88 },
    difficulty: 2,
    rewards: {},
  },
  {
    id: 'blacksite-7',
    name: 'Blacksite 7',
    kind: 'npc_stronghold',
    faction: 'government',
    position: { x: 0.78, y: 0.38 },
    difficulty: 8,
    rewards: { caps: 350, highQualityMetal: 90, oil: 150 },
  },
  {
    id: 'combine-spire',
    name: 'Spire of the Combine',
    kind: 'npc_stronghold',
    faction: 'government',
    position: { x: 0.5, y: 0.08 },
    difficulty: 10,
    rewards: { caps: 600, oil: 250, highQualityMetal: 200, food: 300 },
  },
];

export function findDistrict(districtId: string): District | undefined {
  return CITY_DISTRICTS.find((district) => district.id === districtId);
}

/**
 * A seat of the government's power rather than one of its holdings (§A3) — what you have to take
 * to be *replacing* the Combine instead of merely robbing it. That is the whole difference between
 * §D8's `Anti-systemic` and `Revolutionary`, so it is derived here and never stored twice: a
 * Combine-held `npc_stronghold` is a seat, everything else it holds is an outpost.
 */
export function isSeatOfGovernmentPower(district: District): boolean {
  return district.faction === 'government' && district.kind === 'npc_stronghold';
}

/** Everything §D8's stance counters need to know about a raided district, and nothing more. */
export function raidTargetOf(district: District): RaidTarget {
  return { faction: district.faction, isSeatOfPower: isSeatOfGovernmentPower(district) };
}

/** The garrison standing on a district when the strike team arrives (§A3). */
export function garrisonOf(district: District): string {
  return district.faction === 'government'
    ? governmentGarrisonFor(district.difficulty)
    : 'whoever holds the ground and has decided to keep it';
}

/** District kinds that are hostile ground in themselves, whether or not a base sits there. */
export const ATTACKABLE_DISTRICT_KINDS: readonly DistrictKind[] = ['raid', 'npc_stronghold'];

/** What the attackability rule needs to know about who holds the district right now. */
export interface DistrictOccupancy {
  /** The district holds the attacker's own base. */
  isOwnBase: boolean;
  /** An AI rival base garrisons the district. */
  hasBotBase: boolean;
}

/**
 * The one attackability rule: raid sites and NPC strongholds are always fair game, any
 * district garrisoned by an AI rival becomes one, and you never attack yourself.
 *
 * Shared so the client's "Launch Attack" affordance and the server's POST /battle guard
 * cannot drift apart — a target the UI offers is a target the API accepts.
 */
export function isDistrictAttackable(district: District, occupancy: DistrictOccupancy): boolean {
  if (occupancy.isOwnBase) return false;
  return occupancy.hasBotBase || ATTACKABLE_DISTRICT_KINDS.includes(district.kind);
}
