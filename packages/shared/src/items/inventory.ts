import { z } from 'zod';
import { ITEM_CATALOG, ItemIdSchema, type ItemId } from './catalog.js';

/**
 * What a crew is holding that is not a resource.
 *
 * A sparse count map rather than a list of stacks: two Ceramic Plates are two Ceramic Plates, and
 * there is nothing about one of them that differs from the other. A list would let the same item
 * appear twice with different counts and make every consumer merge them.
 *
 * Zero is not stored. An item at zero and an item never held are the same fact, and keeping the
 * key around means every "do I have any?" check has to test the value as well as the key, which
 * is the check somebody eventually forgets.
 */

/**
 * `partialRecord`, not `record`.
 *
 * Zod 4 made `z.record(someEnum, …)` *exhaustive*: it demands a key for every member of the enum,
 * which for an inventory would mean storing a zero for all eighteen items and would reject `{}`: the
 * state every crew starts in. `partialRecord` is the sparse one, and sparse is the whole model
 * here: an item at zero and an item never held are the same fact.
 */
export const InventorySchema: z.ZodType<Partial<Record<ItemId, number>>> = z.partialRecord(
  ItemIdSchema,
  z.number().int().positive(),
);
export type Inventory = z.infer<typeof InventorySchema>;

/** A requirement or a payment expressed in items: how many of each. */
export type ItemCost = Partial<Record<ItemId, number>>;

export function itemCount(inventory: Inventory, id: ItemId): number {
  return inventory[id] ?? 0;
}

/** Everything held, in catalogue order, as pairs. Zero-count entries can never appear. */
export function heldItems(inventory: Inventory): [ItemId, number][] {
  return Object.entries(inventory).filter(([, count]) => count > 0) as [ItemId, number][];
}

export function hasItems(inventory: Inventory, cost: ItemCost): boolean {
  return Object.entries(cost).every(
    ([id, needed]) => itemCount(inventory, id as ItemId) >= (needed ?? 0),
  );
}

/** Adds items. Never mutates: the caller decides what to do with the result. */
export function addItems(inventory: Inventory, gained: ItemCost): Inventory {
  const next: Inventory = { ...inventory };
  for (const [id, count] of Object.entries(gained)) {
    if (!count) continue;
    const key = id as ItemId;
    next[key] = (next[key] ?? 0) + count;
  }
  return next;
}

/**
 * Takes items out, dropping any key that reaches zero.
 *
 * Floors at zero rather than going negative. A caller that has not checked {@link hasItems} first
 * has a bug, and a negative count in storage would turn that bug into a permanently broken save.
 */
export function removeItems(inventory: Inventory, spent: ItemCost): Inventory {
  const next: Inventory = { ...inventory };
  for (const [id, count] of Object.entries(spent)) {
    if (!count) continue;
    const key = id as ItemId;
    const left = (next[key] ?? 0) - count;
    if (left > 0) next[key] = left;
    else delete next[key];
  }
  return next;
}

/** How many distinct kinds of thing are being held: the number the Inventory tab shows. */
export function inventorySize(inventory: Inventory): number {
  return heldItems(inventory).length;
}

/**
 * Which blueprint pages arrived between two reads of an inventory, and how many of each.
 *
 * A diff rather than a return value from each of the paths that hand a page over, because there
 * are six of them (a mission's prize, the Runner's close, the fence's shelf, the Lab's trade, and
 * both sides of a settled offer) and every one of them already writes the whole inventory back.
 * Asking what changed is one rule in one place; asking each caller to also announce what it gave
 * is six chances for a new path to hand over a page in silence.
 *
 * Only pages, and only upward. An item spent is not news, and a component is not a document.
 */
export function pagesGained(before: Inventory, after: Inventory): ItemCost {
  const gained: ItemCost = {};
  for (const [id, count] of heldItems(after)) {
    if (ITEM_CATALOG[id].kind !== 'page') continue;
    const delta = count - itemCount(before, id);
    if (delta > 0) gained[id] = delta;
  }
  return gained;
}
