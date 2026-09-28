import {
  RESOURCE_KEYS,
  unitSlotsUsed,
  type Base,
  type FeatClaimRoom,
  type FeatReward,
  type ResourceKey,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { storeCeilingsOf } from '../district/stores.js';
import { districtUnitSlots } from '../district/unit-slots.js';

/**
 * What this district has room for: one read, for every reader of the feat ceilings.
 *
 * Three places ask the same question and used to ask it three ways. The feats read quotes what a
 * rung would waste, a single claim clamps the payment to it, and Collect All spends it down across
 * the backlog. A second definition of "spare" is a warning that disagrees with the till.
 *
 * The stores are `ceiling - held`, and caps come out `Infinity`, because the currency has no
 * ceiling: `storageCapacityFor` says so and `splitFeatReward` therefore never wastes any. A store
 * already over its top gives a negative figure, which is deliberate and is read as no room at all:
 * nothing credits past a ceiling any more (`district/stores.ts`), but a save from before that rule,
 * or a store that lost a storage card, can still be standing above one.
 *
 * The ceilings are `storeCeilingsOf`, the crew's §F2 Logistics included: the ceiling the HUD bar
 * draws is the one with the bonus folded in, and a claim clamping to the bare structures' figure
 * would discard a reward the stockpile panel says there is room for.
 */
export function featClaimRoom(repos: Repositories, base: Base, now: Date): FeatClaimRoom {
  const ceilings = storeCeilingsOf(repos, base, now);
  const resources = {} as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) resources[key] = ceilings[key] - base.resources[key];
  return { resources, unitSlots: districtUnitSlots(repos, base).spare };
}

/**
 * The room left after part of the backlog has been paid, for Collect All's walk.
 *
 * §A1 and the shelves are spent down **across** the batch, not checked against each feat on its
 * own: two rungs that each fit the spare room separately do not both fit if the first one takes
 * it. That was already true of the beds and is now true of the stores as well, through one
 * subtraction rather than two loops.
 */
export function spendRoom(room: FeatClaimRoom, paid: FeatReward): FeatClaimRoom {
  const resources = { ...room.resources };
  for (const key of RESOURCE_KEYS) resources[key] -= paid.resources?.[key] ?? 0;
  return { resources, unitSlots: room.unitSlots - unitSlotsUsed(paid.units ?? {}) };
}
