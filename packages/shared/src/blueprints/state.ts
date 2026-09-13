import type { ItemId } from '../items/catalog.js';
import {
  addItems,
  itemCount,
  removeItems,
  type Inventory,
  type ItemCost,
} from '../items/inventory.js';
import { seedFrom } from '../rng.js';
import {
  BLUEPRINTS,
  findBlueprint,
  findBlueprintPage,
  type BlueprintPage,
  type BlueprintSpec,
} from './catalog.js';

/**
 * What a crew knows about a blueprint (GDD §D5 to §D10).
 *
 * Four states, and the first one is the design: a blueprint you hold no pages of **does not exist
 * for you**. It is not greyed out, it is not on the page, you cannot count how many there are left
 * to find. The first page is the moment the document becomes a thing you are working towards, and
 * that is why the Blueprints page is worth opening at all.
 *
 * - `unknown`   no pages, not unlocked. Never rendered.
 * - `partial`   at least one page. Darkened, with a square per page and a lock on it.
 * - `complete`  every page, not unlocked yet. The Unlock control appears.
 * - `unlocked`  the crew pressed Unlock. Permanent, and it moves to the unlocked list.
 *
 * ## All four are read out of the satchel
 *
 * There is no blueprint table on a base. Pages are items, and so is the finished document, so the
 * state above is a function of `inventory` and nothing else. That is what makes a page survive a
 * save without a column of its own, and it is what makes "I own this" a fact the server already
 * stores rather than one more thing that can drift out of step with the pages it was made from.
 */
export const BLUEPRINT_STATUSES = ['unknown', 'partial', 'complete', 'unlocked'] as const;
export type BlueprintStatus = (typeof BLUEPRINT_STATUSES)[number];

/** One square in the row under a blueprint: which page, and how many of it the crew is holding. */
export interface PageHolding {
  page: BlueprintPage;
  /** Copies held. One is a filled square; more than one is a spare, which Reimagining can spend. */
  held: number;
}

export interface BlueprintHolding {
  blueprint: BlueprintSpec;
  status: BlueprintStatus;
  /** Every page of the document in order, held or not. §D6 draws this row. */
  pages: readonly PageHolding[];
  /** Distinct pages held, which is what the "3 of 8" line counts. */
  distinctHeld: number;
}

/** Whether the finished document is in the satchel: the record that Unlock was pressed. */
export function isBlueprintUnlocked(inventory: Inventory, id: string): boolean {
  return itemCount(inventory, id as ItemId) > 0;
}

export function pageHoldings(inventory: Inventory, spec: BlueprintSpec): PageHolding[] {
  return spec.pages.map((page) => ({ page, held: itemCount(inventory, page.id as ItemId) }));
}

export function blueprintStatus(inventory: Inventory, spec: BlueprintSpec): BlueprintStatus {
  if (isBlueprintUnlocked(inventory, spec.id)) return 'unlocked';
  const held = pageHoldings(inventory, spec).filter((entry) => entry.held > 0).length;
  if (held === 0) return 'unknown';
  return held === spec.pages.length ? 'complete' : 'partial';
}

export function blueprintHolding(inventory: Inventory, spec: BlueprintSpec): BlueprintHolding {
  const pages = pageHoldings(inventory, spec);
  return {
    blueprint: spec,
    status: blueprintStatus(inventory, spec),
    pages,
    distinctHeld: pages.filter((entry) => entry.held > 0).length,
  };
}

/**
 * Everything the crew has any business seeing, in catalogue order.
 *
 * §D5 in one filter. A caller that wants to draw the whole catalogue does not get to: the unknown
 * ones are not in the list, so there is no way to leak their existence by forgetting a check on a
 * screen. See `blueprints.test.ts`, which counts what a crew holding nothing can see.
 */
export function knownBlueprints(inventory: Inventory): BlueprintHolding[] {
  return BLUEPRINTS.map((spec) => blueprintHolding(inventory, spec)).filter(
    (holding) => holding.status !== 'unknown',
  );
}

export const BLUEPRINT_UNLOCK_REFUSALS = [
  'unknown_blueprint',
  'already_unlocked',
  'missing_pages',
] as const;
export type BlueprintUnlockRefusal = (typeof BLUEPRINT_UNLOCK_REFUSALS)[number];

/** What each refusal says on the Blueprints page. */
export const BLUEPRINT_UNLOCK_MESSAGES: Readonly<Record<BlueprintUnlockRefusal, string>> = {
  unknown_blueprint: 'Nobody has heard of that document',
  already_unlocked: 'You already know this one',
  missing_pages: 'Pages are still missing',
};

export function unlockRefusal(inventory: Inventory, id: string): BlueprintUnlockRefusal | null {
  const spec = findBlueprint(id);
  if (!spec) return 'unknown_blueprint';
  if (isBlueprintUnlocked(inventory, spec.id)) return 'already_unlocked';
  if (blueprintStatus(inventory, spec) !== 'complete') return 'missing_pages';
  return null;
}

/**
 * §D10: the pages become the blueprint.
 *
 * One of each page goes out and the finished document comes in, which is what makes the button a
 * transaction rather than a label change. Spares survive: a crew holding two Frame Jigs unlocks
 * the motorbike and still has one to feed Reimagining.
 *
 * Never mutates, and returns `null` rather than throwing when the unlock is not allowed. The
 * caller has already asked {@link unlockRefusal} for the reason to print.
 */
export function unlockBlueprint(inventory: Inventory, id: string): Inventory | null {
  const spec = findBlueprint(id);
  if (!spec || unlockRefusal(inventory, id) !== null) return null;
  const spent: ItemCost = Object.fromEntries(spec.pages.map((page) => [page.id, 1]));
  return addItems(removeItems(inventory, spent), { [spec.id]: 1 });
}

/**
 * §G4: the Reimagining seam.
 *
 * The trade itself is not here and must not be added here: it is a research item and a Head of
 * Research, both of which belong to the Lab. What the Blueprints page needs from this module is
 * the ability to draw the section **locked, with its requirements stated**, before either of those
 * exists, and that is a predicate over two booleans the Lab can hand it.
 *
 * Whoever wires the trade fills these two in and implements the swap. Nothing else on the page
 * changes.
 */
export interface ReimaginingContext {
  /** An officer sitting in the Head of Research seat right now. */
  hasHeadOfResearch: boolean;
  /** The Reimagining research finished (§G1). */
  hasReimaginingResearch: boolean;
}

/** How many pages the trade eats (§G2). Stated on the locked panel so the cost is never a surprise. */
export const REIMAGINING_PAGES_SPENT = 3;

export function reimaginingAvailable(context: ReimaginingContext): boolean {
  return context.hasHeadOfResearch && context.hasReimaginingResearch;
}

/**
 * Pages the crew holds more than one of, and could therefore spend.
 *
 * Exported for the Reimagining panel to show what is on the table before the trade exists. A page
 * of an unlocked document counts: the document is already assembled, so every copy left is spare.
 */
export function sparePages(inventory: Inventory): { pageId: string; spare: number }[] {
  const spares: { pageId: string; spare: number }[] = [];
  for (const spec of BLUEPRINTS) {
    const unlocked = isBlueprintUnlocked(inventory, spec.id);
    for (const page of spec.pages) {
      const held = itemCount(inventory, page.id);
      const spare = unlocked ? held : held - 1;
      if (spare > 0) spares.push({ pageId: page.id, spare });
    }
  }
  return spares;
}

/**
 * Every page the crew is holding, with the document it came out of.
 *
 * What the Reimagining tray is drawn from: one tile per distinct page, carrying how many copies
 * are in the bag, because a page can go into the machine as many times as it is held.
 */
export interface HeldPage {
  page: BlueprintPage;
  blueprint: BlueprintSpec;
  held: number;
}

export function heldPages(inventory: Inventory): HeldPage[] {
  const held: HeldPage[] = [];
  for (const spec of BLUEPRINTS) {
    for (const page of spec.pages) {
      const count = itemCount(inventory, page.id);
      if (count > 0) held.push({ page, blueprint: spec, held: count });
    }
  }
  return held;
}

/**
 * §G2/§G3: three pages to the Lab, one page you do not have back.
 *
 * **Guaranteed**, which is the whole point and the reason this is not a roll. A player spending
 * three pages is buying certainty, so the trade either hands back something new or refuses: there
 * is no outcome where the pages are gone and nothing arrived. That also means the refusal has to
 * be able to say "there is nothing left to want", which is a real end state once a crew holds a
 * copy of every page in the game.
 *
 * "One you do not have" is measured against pages **held**, not against blueprints unlocked: a page
 * of a document you have already assembled is one you own, and handing it back would be handing
 * back nothing. Any category (§G3), because the trade is with the Lab rather than with a shop and
 * the Lab does not care which drawer the sheet came out of.
 *
 * ## The player names the three (maintainer, 2026-09-10)
 *
 * The Lab used to pick, spending the most duplicated pages first. That was the right rule while
 * the trade was a button, and it is the wrong one now that the machine has three sockets and a
 * tray: a player who drops three sheets in has already decided, and a bench that quietly swapped
 * them for whatever it liked best would be answering a question nobody asked. So the pages come in
 * on the request, and the rule is only that they are pages, that the crew holds as many copies as
 * it named, and that there are exactly three.
 *
 * What the caller still does not get to choose is what comes back. That is seeded off the crew and
 * the moment, so a request retried because the connection dropped cannot be retried until the Lab
 * offers something better.
 */
export type ReimaginingRefusal =
  'not_available' | 'nothing_left_to_find' | 'wrong_page_count' | 'pages_not_held';

/**
 * What each refusal says to the player, beside `BLUEPRINT_UNLOCK_MESSAGES` and for the same
 * reason: the route answers with the machine name, and a screen printing `pages_not_held` at
 * somebody is telling them nothing.
 */
export const REIMAGINING_REFUSAL_MESSAGES: Readonly<Record<ReimaginingRefusal, string>> = {
  not_available: 'The Lab is not doing this yet.',
  nothing_left_to_find:
    'Every page there is, you either hold or have already bound into a document. Nothing left to want.',
  wrong_page_count: 'The machine takes three pages. No more, no fewer.',
  pages_not_held: 'You are not holding three pages like that.',
};

export interface ReimaginingInput {
  inventory: Inventory;
  context: ReimaginingContext;
  /** The three the player put in the sockets, in the order they put them there. */
  pages: readonly string[];
  /** Seeded off the crew and the moment, so a retried request cannot shop for a better page. */
  seed: string;
}

/**
 * Pages this crew has never seen, which is what the trade can hand back.
 *
 * A page of an **unlocked** document is not one of them, whatever the count says. Unlocking spends
 * one of every page, so a finished document leaves all of its pages at zero, and reading the count
 * alone put every one of them straight back into the pool: three spare pages in and, out of the
 * one guaranteed-new page in the game, a sheet of something the crew assembled a month ago. That
 * also kept `nothing_left_to_find` out of reach, since unlocking a document refilled the pool it
 * was meant to empty.
 */
export function unseenPages(inventory: Inventory): string[] {
  return BLUEPRINTS.filter((spec) => !isBlueprintUnlocked(inventory, spec.id)).flatMap((spec) =>
    spec.pages.map((page) => page.id).filter((pageId) => itemCount(inventory, pageId) === 0),
  );
}

/**
 * Whether the crew really holds every copy the request named.
 *
 * Counted rather than checked one at a time, because naming the same page three times is allowed
 * and is the ordinary way to spend a stack: a crew holding two Slab Armours may put two in and no
 * more. An id that is not a page at all fails here too, so a request naming a servo is refused
 * with the same sentence as one naming a page the crew does not have.
 */
function holdsNamedPages(inventory: Inventory, pages: readonly string[]): boolean {
  const wanted = new Map<string, number>();
  for (const pageId of pages) wanted.set(pageId, (wanted.get(pageId) ?? 0) + 1);
  for (const [pageId, count] of wanted) {
    if (!findBlueprintPage(pageId)) return false;
    if (itemCount(inventory, pageId as ItemId) < count) return false;
  }
  return true;
}

/**
 * The refusals, in the order a player wants to hear them.
 *
 * "Nothing left to find" comes before anything about the three sockets, because it is a fact about
 * the crew rather than about what they have just dropped in: a player at the end of the collection
 * should read it on an empty machine rather than after filling it.
 */
export function reimaginingRefusal(input: ReimaginingInput): ReimaginingRefusal | null {
  if (!reimaginingAvailable(input.context)) return 'not_available';
  if (unseenPages(input.inventory).length === 0) return 'nothing_left_to_find';
  if (input.pages.length !== REIMAGINING_PAGES_SPENT) return 'wrong_page_count';
  if (!holdsNamedPages(input.inventory, input.pages)) return 'pages_not_held';
  return null;
}

export interface Reimagined {
  inventory: Inventory;
  /** What went in, so the report can say what it cost. */
  spent: string[];
  /** ...and what came back. */
  gained: string;
}

/**
 * Runs the trade, or returns null when {@link reimaginingRefusal} would refuse it.
 *
 * The three that go in are the three that were named. What comes back cannot be one of them: the
 * pool is read off the inventory as it stands *before* the spend, and every named page is held
 * there, so `unseenPages` has already left all three out. Pinned by a test rather than by a second
 * filter, because a filter here would be a second copy of the rule that could drift from the first.
 */
export function reimagine(input: ReimaginingInput): Reimagined | null {
  if (reimaginingRefusal(input) !== null) return null;

  const spent = [...input.pages];
  const unseen = unseenPages(input.inventory);
  const gained = unseen[seedFrom(`reimagine:${input.seed}`) % unseen.length]!;
  const cost: ItemCost = {};
  for (const pageId of spent) {
    const id = pageId as ItemId;
    cost[id] = (cost[id] ?? 0) + 1;
  }
  return {
    inventory: addItems(removeItems(input.inventory, cost), { [gained as ItemId]: 1 }),
    spent,
    gained,
  };
}
