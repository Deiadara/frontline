import { z } from 'zod';
import { PartialResourcesSchema, RESOURCE_KEYS, type ResourceKey } from '../resources.js';
import { ArmySchema } from '../units/training.js';
import { findUnit } from '../units/index.js';
import type { FeatReward } from './rewards.js';

/**
 * What a feat reward loses when the crew has nowhere to put it (maintainer ruling, 2026-09-23).
 *
 * ## The rule
 *
 * "If a reward claim would put you over the threshold of unit slots or storage, and you click
 * claim on it there is a warning that this much would be wasted, and if you click yes it goes
 * through up to threshold."
 *
 * So a claim is **paid up to the ceiling and the excess is discarded**, and the player is told the
 * figure before it happens. This module is the arithmetic behind both halves: the quote the feats
 * read carries, and the clamp the claim route pays through. One function, so the number a dialog
 * shows and the number a till discards cannot be computed two ways.
 *
 * ## Its own split, beside the stores' one
 *
 * Since 2026-09-28 every credit in the game lands this way (`building/stores.ts`): the stores are
 * a hard ceiling and the excess is thrown away, with a warning first wherever the player is the
 * one pressing. A feat keeps a split of its own because it is the one credit that also pays units,
 * and beds are a ceiling the stores know nothing about.
 *
 * ## Why unit slots are in it too
 *
 * They were a flat refusal until this ruling: a feat paying units into a district with no beds was
 * turned down with `no_unit_slots` and left ready. The maintainer named unit slots first, so they
 * go through the same door as the stores. The player is told how many units have nowhere to sleep
 * and can decline, which is the old behaviour with the decision handed back to them, and Collect
 * All still refuses to make that decision on anybody's behalf.
 */

/** Units and resources a claim would throw away. Absent channels lose nothing. */
export const FeatWasteSchema = z.object({
  resources: PartialResourcesSchema.optional(),
  units: ArmySchema.optional(),
});
export type FeatWaste = z.infer<typeof FeatWasteSchema>;

/**
 * What the district has room for right now.
 *
 * Resources are the spare in each store, `ceiling - held`, and `Infinity` for caps, which have no
 * ceiling. A store that is already over its top gives a negative figure and is read as zero: the
 * ruling pays up to the ceiling, and a crew standing above it has no room left under it.
 */
export interface FeatClaimRoom {
  readonly resources: Readonly<Record<ResourceKey, number>>;
  /** Spare unit slots, the same §A1 fold training and the Garage read. */
  readonly unitSlots: number;
}

export interface FeatRewardSplit {
  /** What the crew actually receives. Can be empty when every channel overflows. */
  readonly paid: FeatReward;
  /** What is discarded, or `undefined` when the whole reward fits. */
  readonly wasted: FeatWaste | undefined;
}

/**
 * Splits a reward into what fits and what does not.
 *
 * XP, infamy, items and boosts are never split: none of them has a ceiling, so all four are paid
 * whole whatever the stores are doing. A feat that pays only those can never be wasted, which is
 * most of the catalogue.
 *
 * Units are taken **whole**, in the order the reward lists them, until the beds run out. Splitting
 * a unit is not a thing the roster can hold, and a greedy walk in catalogue order is the one rule
 * a player can check against the tokens on the rung: the reward reads left to right and so does
 * the payment.
 */
export function splitFeatReward(reward: FeatReward, room: FeatClaimRoom): FeatRewardSplit {
  const paidResources: Record<string, number> = {};
  const lostResources: Record<string, number> = {};
  for (const key of RESOURCE_KEYS) {
    const amount = reward.resources?.[key] ?? 0;
    if (amount <= 0) continue;
    const takes = Math.min(amount, Math.max(0, room.resources[key]));
    if (takes > 0) paidResources[key] = takes;
    if (amount > takes) lostResources[key] = amount - takes;
  }

  const paidUnits: Record<string, number> = {};
  const lostUnits: Record<string, number> = {};
  let beds = Math.max(0, room.unitSlots);
  for (const [unitId, count] of Object.entries(reward.units ?? {})) {
    if (!count || count <= 0) continue;
    // One slot for a sheet the catalogue has forgotten, which is the floor `unitSlotsUsed` and
    // every other reader of a retired unit already uses. A sheet costing nothing takes no bed and
    // so cannot be refused one.
    const slots = findUnit(unitId)?.unitSlots ?? 1;
    const takes = slots <= 0 ? count : Math.min(count, Math.floor(beds / slots));
    beds -= takes * slots;
    if (takes > 0) paidUnits[unitId] = takes;
    if (count > takes) lostUnits[unitId] = count - takes;
  }

  const paid: FeatReward = {
    ...(Object.keys(paidResources).length > 0 ? { resources: paidResources } : {}),
    ...(reward.items ? { items: reward.items } : {}),
    ...(Object.keys(paidUnits).length > 0 ? { units: paidUnits } : {}),
    ...(reward.xp !== undefined ? { xp: reward.xp } : {}),
    ...(reward.infamy !== undefined ? { infamy: reward.infamy } : {}),
    ...(reward.boosts ? { boosts: reward.boosts } : {}),
  };

  const lost = Object.keys(lostResources).length > 0 || Object.keys(lostUnits).length > 0;
  return {
    paid,
    wasted: lost
      ? {
          ...(Object.keys(lostResources).length > 0 ? { resources: lostResources } : {}),
          ...(Object.keys(lostUnits).length > 0 ? { units: lostUnits } : {}),
        }
      : undefined,
  };
}
