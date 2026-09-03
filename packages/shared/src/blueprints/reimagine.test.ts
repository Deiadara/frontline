/**
 * §G2/§G3: three spare pages in, one page you have never seen out.
 *
 * The word in the brief is **guaranteed**, and that is what most of this file is about: a player
 * spending three pages is buying certainty, so there must be no path where the pages are gone and
 * nothing came back. The interesting cases are therefore the refusals, not the happy one.
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINTS } from './catalog.js';
import {
  REIMAGINING_PAGES_SPENT,
  reimagine,
  reimaginingRefusal,
  sparePages,
  unseenPages,
} from './state.js';
import type { Inventory } from '../items/inventory.js';

const READY = { hasHeadOfResearch: true, hasReimaginingResearch: true };
const ALL_PAGES = BLUEPRINTS.flatMap((spec) => spec.pages.map((page) => page.id));

/** A crew holding `spare + 1` of the first few pages, so it has real duplicates to spend. */
function withSpares(spare: number, distinct = 3): Inventory {
  const bag: Record<string, number> = {};
  for (const pageId of ALL_PAGES.slice(0, distinct)) bag[pageId] = spare + 1;
  return bag;
}

describe('reimagining a page (§G2, §G3)', () => {
  it('takes three pages and hands back one nobody has seen', () => {
    const inventory = withSpares(1, 3);
    const before = unseenPages(inventory).length;

    const result = reimagine({ inventory, context: READY, seed: 'a' });
    expect(result, 'the trade refused a crew that could afford it').not.toBeNull();
    expect(result!.spent).toHaveLength(REIMAGINING_PAGES_SPENT);
    // §G2: guaranteed new. Not "probably new".
    expect(ALL_PAGES).toContain(result!.gained);
    expect(before - unseenPages(result!.inventory).length).toBe(1);
    // And the pages really left the bag.
    const held = (bag: Inventory, id: string) => (bag as Record<string, number>)[id] ?? 0;
    for (const pageId of new Set(result!.spent)) {
      const spentCount = result!.spent.filter((id) => id === pageId).length;
      expect(held(inventory, pageId) - held(result!.inventory, pageId)).toBe(spentCount);
    }
  });

  it('spends the most duplicated pages first', () => {
    // Four of one and one spare of another. A player is one page short of finishing something with
    // the second, and an even spend would take it.
    const bag: Record<string, number> = { [ALL_PAGES[0]!]: 5, [ALL_PAGES[1]!]: 2 };
    const result = reimagine({ inventory: bag, context: READY, seed: 'b' });
    expect(result).not.toBeNull();
    expect(new Set(result!.spent), 'it broke into the page they were saving').toEqual(
      new Set([ALL_PAGES[0]!]),
    );
  });

  it('refuses without the research or without a Head of Research', () => {
    const inventory = withSpares(2, 3);
    expect(
      reimaginingRefusal({
        inventory,
        context: { hasHeadOfResearch: true, hasReimaginingResearch: false },
        seed: 'c',
      }),
    ).toBe('not_available');
    expect(
      reimaginingRefusal({
        inventory,
        context: { hasHeadOfResearch: false, hasReimaginingResearch: true },
        seed: 'c',
      }),
    ).toBe('not_available');
  });

  it('refuses a crew that cannot spare three, and takes nothing from them', () => {
    // Two spares, not three. The bag has to come out untouched.
    const bag: Record<string, number> = { [ALL_PAGES[0]!]: 2, [ALL_PAGES[1]!]: 2 };
    const inventory = bag as Inventory;
    expect(sparePages(inventory).reduce((n, e) => n + e.spare, 0)).toBe(2);
    expect(reimaginingRefusal({ inventory, context: READY, seed: 'd' })).toBe(
      'not_enough_spare_pages',
    );
    expect(reimagine({ inventory, context: READY, seed: 'd' })).toBeNull();
  });

  it('refuses when there is nothing left in the game to want', () => {
    // Every page twice. Plenty to spend and nothing to buy, which is the one case where
    // "guaranteed something new" cannot be honoured and so must not take the pages.
    const bag: Record<string, number> = {};
    for (const pageId of ALL_PAGES) bag[pageId] = 2;
    const inventory = bag as Inventory;
    expect(unseenPages(inventory)).toEqual([]);
    expect(reimaginingRefusal({ inventory, context: READY, seed: 'e' })).toBe(
      'nothing_left_to_find',
    );
    expect(reimagine({ inventory, context: READY, seed: 'e' })).toBeNull();
  });

  it('never hands back a page of a document the crew has already unlocked', () => {
    /*
     * Unlocking spends one of every page, so a finished document leaves its pages at zero held.
     * Reading "unseen" off the count alone put all of them back on the table, and the guaranteed
     * new page turned out to be a sheet of something already assembled.
     */
    const shortest = [...BLUEPRINTS].sort((a, b) => a.pages.length - b.pages.length)[0]!;
    const bag: Record<string, number> = { [shortest.id]: 1 };
    // Three spares of pages belonging to some *other* document, so the trade is affordable and the
    // only thing under test is which page comes back.
    const other = BLUEPRINTS.find((spec) => spec.id !== shortest.id)!;
    for (const page of other.pages.slice(0, 2)) bag[page.id] = 3;
    const inventory = bag as Inventory;
    expect(sparePages(inventory).reduce((n, e) => n + e.spare, 0)).toBeGreaterThanOrEqual(
      REIMAGINING_PAGES_SPENT,
    );

    const unlockedPages = new Set<string>(shortest.pages.map((page) => page.id));
    expect(
      unseenPages(inventory).filter((pageId) => unlockedPages.has(pageId)),
      'pages of an unlocked document are still in the pool',
    ).toEqual([]);

    // And across many seeds, not one of them ever comes out of the trade.
    for (const seed of Array.from({ length: 200 }, (_, i) => `unlocked-${i}`)) {
      const result = reimagine({ inventory, context: READY, seed });
      expect(result).not.toBeNull();
      expect(unlockedPages.has(result!.gained), `${seed} paid out ${result!.gained}`).toBe(false);
    }
  });

  it('runs out of things to want once every document is held or unlocked', () => {
    // Every document unlocked and two spare copies of one page. There is genuinely nothing left in
    // the game to hand back, and the trade has to say so rather than recycling a spent page.
    const bag: Record<string, number> = {};
    for (const spec of BLUEPRINTS) bag[spec.id] = 1;
    bag[ALL_PAGES[0]!] = 3;
    const inventory = bag as Inventory;
    expect(sparePages(inventory).reduce((n, e) => n + e.spare, 0)).toBe(3);
    expect(unseenPages(inventory)).toEqual([]);
    expect(reimaginingRefusal({ inventory, context: READY, seed: 'z' })).toBe(
      'nothing_left_to_find',
    );
    expect(reimagine({ inventory, context: READY, seed: 'z' })).toBeNull();
  });

  it('gives the same crew the same page for the same seed', () => {
    const inventory = withSpares(2, 3);
    const once = reimagine({ inventory, context: READY, seed: 'f' });
    const twice = reimagine({ inventory, context: READY, seed: 'f' });
    expect(once!.gained).toBe(twice!.gained);
    // ...and a different moment is a different page, or a retry is a reroll.
    const seeds = new Set(
      ['g', 'h', 'i', 'j', 'k'].map(
        (seed) => reimagine({ inventory, context: READY, seed })!.gained,
      ),
    );
    expect(seeds.size).toBeGreaterThan(1);
  });
});
