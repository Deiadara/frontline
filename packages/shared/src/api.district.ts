import { z } from 'zod';
import { BaseSchema } from './base.js';
import { BuildingKindSchema, MAX_MODIFICATION_SLOTS } from './building/index.js';
import { PartialResourcesSchema, ResourcesSchema } from './resources.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';

/**
 * The wire shapes the buildings patch added: the Generator's burn (§B4), the modification slots
 * (§E) and the Scrapyard's page (§B9).
 *
 * A separate module from `api.ts` on purpose. That file is the contract for every screen in the
 * game and is edited by whoever is working on any of them; three new features arriving in it at
 * once is three merge conflicts in a file where a conflict is a silently wrong schema. Everything
 * here is re-exported from the package root, so a consumer cannot tell the difference.
 */

// --- §B4: the Generator's paid burn -----------------------------------------------------------

export const BuyBuildBoostRequestSchema = z.object({});
export type BuyBuildBoostRequest = z.infer<typeof BuyBuildBoostRequestSchema>;

export const BuildBoostResponseSchema = z.object({
  base: BaseSchema,
  /** What the burn cost, so the receipt can say it without the client re-deriving the price. */
  paid: PartialResourcesSchema,
});
export type BuildBoostResponse = z.infer<typeof BuildBoostResponseSchema>;

// --- §E: filling and emptying a structure's three slots ---------------------------------------

export const FitModificationRequestSchema = z.object({
  building: BuildingKindSchema,
  modificationId: z.string().min(1),
});
export type FitModificationRequest = z.infer<typeof FitModificationRequestSchema>;

export const ClearModificationRequestSchema = z.object({
  building: BuildingKindSchema,
  slot: z
    .number()
    .int()
    .min(0)
    .max(MAX_MODIFICATION_SLOTS - 1),
});
export type ClearModificationRequest = z.infer<typeof ClearModificationRequestSchema>;

export const ModificationSlotResponseSchema = z.object({ base: BaseSchema });
export type ModificationSlotResponse = z.infer<typeof ModificationSlotResponseSchema>;

// --- §B9: the Scrapyard's page ----------------------------------------------------------------

export const AddonKindSchema = z.enum(['modification', 'upgrade']);
export type AddonKind = z.infer<typeof AddonKindSchema>;

export const ScrapyardEntrySchema = z.object({
  id: z.string(),
  kind: AddonKindSchema,
  name: z.string(),
  description: z.string(),
  /** The structure a modification bolts to, or null for a unit upgrade. */
  building: BuildingKindSchema.nullable(),
  /** One line: what it does, already worded. */
  effect: z.string(),
  /** Scrap, and high-quality metal for the advanced entries. Never anything else (§B9). */
  cost: PartialResourcesSchema,
  advanced: z.boolean(),
  /** The blueprint it wants, in the player's words, or null when it needs none. */
  blueprint: z.string().nullable(),
  /** How many the crew already owns. Unit upgrades are one or none. */
  owned: z.number().int().nonnegative(),
  /** Why the button is dead, already worded, or null when it is live. */
  blocker: z.string().nullable(),
});
export type ScrapyardEntry = z.infer<typeof ScrapyardEntrySchema>;

export const ScrapyardResponseSchema = z.object({
  /** Zero when the Scrapyard has not been built: the page says so rather than 404ing. */
  scrapyardLevel: z.number().int().nonnegative(),
  resources: ResourcesSchema,
  entries: z.array(ScrapyardEntrySchema),
});
export type ScrapyardResponse = z.infer<typeof ScrapyardResponseSchema>;

export const BuildAddonRequestSchema = z.object({
  kind: AddonKindSchema,
  id: z.string().min(1),
});
export type BuildAddonRequest = z.infer<typeof BuildAddonRequestSchema>;

export const BuildAddonResponseSchema = z.object({
  scrapyard: ScrapyardResponseSchema,
  base: BaseSchema,
});
export type BuildAddonResponse = z.infer<typeof BuildAddonResponseSchema>;

/**
 * §B7: a gate on a district this crew has taken whole, as the city screen sees it.
 *
 * Sent for every district the crew holds outright, and for no others: the whole point of the
 * mechanic is that taking the last location in a district is what opens it.
 */
export const CapturedGateViewSchema = z.object({
  districtId: IdSchema,
  districtName: z.string(),
  level: z.number().int().nonnegative(),
  /** What the next level costs, or null at the ceiling. */
  nextCost: PartialResourcesSchema.nullable(),
  /** Seconds the next level takes, or null at the ceiling. */
  nextSeconds: z.number().int().nonnegative().nullable(),
  /** When work in progress lands, or null when nobody is working on it. */
  upgradingUntil: IsoDateTimeSchema.nullable(),
  /** What it is worth right now, already worded for the screen. */
  defensePercent: z.number(),
  intelResistancePercent: z.number(),
  /** Why the button is dead, already worded, or null when it is live. */
  refusal: z.string().nullable(),
});
export type CapturedGateView = z.infer<typeof CapturedGateViewSchema>;

export const RaiseGateRequestSchema = z.object({ districtId: IdSchema });
export type RaiseGateRequest = z.infer<typeof RaiseGateRequestSchema>;
