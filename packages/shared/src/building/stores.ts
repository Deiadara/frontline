import { z } from 'zod';
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  type PartialResources,
  type ResourceKey,
  type Resources,
} from '../resources.js';
import { storageCapacity, storageCapacityFor } from './production.js';
import type { Building } from './state.js';

/**
 * The stores are a hard ceiling on every resource, whatever pays into them (maintainer ruling,
 * 2026-09-28).
 *
 * "You're never past your storage, it will go to waste, the excess, but whenever you do something
 * that would push you to waste it has a warning first."
 *
 * Production always stopped at the ceiling. Mission pay, raid loot, a market trade and a refund did
 * not: each of them added straight onto the stockpile, so a crew with a level-one Apothecary could
 * sit on ten times what its warehouse holds. Every credit now goes through {@link creditStores},
 * which lands what fits and names what does not. The warning half lives with the callers: an
 * immediate credit the player fires is refused with `WOULD_WASTE` until they agree to it, and one
 * that lands later (a crew coming home) is quoted on the screen they commit from.
 */

/**
 * The player's yes to a credit that would overflow the stores, on every request that can make one.
 *
 * Without it such a request is refused with `WOULD_WASTE` and the figure it would lose, and
 * nothing is written; the client asks the player and sends the request again with this set. The
 * question is asked by the server rather than drawn by the screen so no client can skip it.
 */
export const AcceptWasteSchema = z.boolean().optional();

/** What each store holds at most, per resource. `Infinity` for caps, which have no ceiling. */
export type StoreCeilings = Readonly<Record<ResourceKey, number>>;

/**
 * Every store's ceiling for this district, the crew's storage bonus (§F2) folded in.
 *
 * One reading for the whole stockpile rather than `storageCapacityFor` per key at each call site,
 * because the bulk shelf is the expensive half and every resource's ceiling is a share of it.
 */
export function storeCeilings(
  buildings: readonly Building[],
  crewStorageCapacityPercent = 0,
): StoreCeilings {
  const bulk = storageCapacity(buildings, crewStorageCapacityPercent);
  return Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, storageCapacityFor(buildings, key, bulk)]),
  ) as StoreCeilings;
}

/**
 * The first line of a price the stores could never hold, however long the crew waits.
 *
 * The ceiling is the only limit on a stockpile, and some prices outgrow it: the Generator's burn
 * follows the Generator and the store follows the Apothecary. "Short of oil" on a price no amount
 * of waiting can reach sends a player to wait for nothing (bug pass, 2026-10-02).
 */
export function overTheStores(
  cost: PartialResources,
  ceilings: StoreCeilings,
): { key: ResourceKey; most: number } | null {
  const key = RESOURCE_KEYS.find((one) => (cost[one] ?? 0) > ceilings[one]);
  return key === undefined ? null : { key, most: ceilings[key] };
}

/** The sentence for {@link overTheStores}: what the stores hold, and the one way to hold more. */
export function overTheStoresText(over: { key: ResourceKey; most: number }): string {
  return `Your stores hold at most ${over.most.toLocaleString()} ${RESOURCE_LABELS[over.key].toLowerCase()}. Raise the Apothecary to hold more.`;
}

export interface StoresCredit {
  /** The stockpile after the credit. */
  readonly resources: Resources;
  /** What went into the stores. What the lifetime ladders count as earned. */
  readonly landed: PartialResources;
  /** What had no room and is gone, or `undefined` when everything fitted. */
  readonly wasted: PartialResources | undefined;
}

/**
 * `gain` added to `stock`, up to each store's ceiling, and the rest thrown away.
 *
 * A store already over its ceiling (a save from before this rule, or an Apothecary that lost a
 * storage card) keeps what it has and takes nothing more: the credit never takes anything away.
 * Amounts of zero or less are nothing arriving, not a debit, which is what a spend is for.
 */
export function creditStores(
  stock: Resources,
  gain: PartialResources,
  ceilings: StoreCeilings,
): StoresCredit {
  const resources = { ...stock };
  const landed: PartialResources = {};
  const wasted: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = gain[key] ?? 0;
    if (amount <= 0) continue;
    const takes = Math.min(amount, Math.max(0, ceilings[key] - stock[key]));
    resources[key] += takes;
    if (takes > 0) landed[key] = takes;
    if (amount > takes) wasted[key] = amount - takes;
  }
  return {
    resources,
    landed,
    wasted: Object.keys(wasted).length > 0 ? wasted : undefined,
  };
}

/**
 * "120 Scrap and 40 Oil", for the warning and the report line.
 *
 * Shared so the refusal the server writes and the dialog the client draws name the loss in the
 * same words.
 */
export function describeWaste(wasted: PartialResources): string {
  const parts = RESOURCE_ORDER.flatMap((key) => {
    const amount = wasted[key] ?? 0;
    return amount > 0 ? [`${amount.toLocaleString('en-US')} ${RESOURCE_LABELS[key]}`] : [];
  });
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** The sentence a `WOULD_WASTE` refusal carries. The client adds its own question after it. */
export function wasteWarning(wasted: PartialResources): string {
  return `This would put you over your storage: ${describeWaste(wasted)} would go to waste`;
}
