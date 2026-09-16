/**
 * §G2/§G3: three named pages in, one page you have never seen out.
 *
 * The word in the brief is **guaranteed**, and that is what most of this file is about: a player
 * spending three pages is buying certainty, so there must be no path where the pages are gone and
 * nothing came back. The interesting cases are therefore the refusals, not the happy one.
 *
 * Since the maintainer's 2026-09-10 call the player names the three, so a second family of refusals
 * matters as much: the request has to be three, they have to be pages, and the crew has to be
 * holding as many copies as it named. A trade that took a page nobody had would mint one out of a
 * negative count in the inventory.
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINTS } from './catalog.js';
import {
  REIMAGINING_PAGES_SPENT,
  REIMAGINING_REFUSAL_MESSAGES,
  reimagine,
  reimaginingRefusal,
  unseenPages,
} from './state.js';
import type { Inventory } from '../items/inventory.js';

const READY = { hasHeadOfResearch: true, hasReimaginingResearch: true };
const ALL_PAGES = BLUEPRINTS.flatMap((spec) => spec.pages.map((page) => page.id));

/** A crew holding `copies` of the first few pages, so there is something to name three times. */
function holding(copies: number, distinct = 3): Inventory {
  const bag: Record<string, number> = {};
  for (const pageId of ALL_PAGES.slice(0, distinct)) bag[pageId] = copies;
  return bag;
}

const first = ALL_PAGES[0]!;
const second = ALL_PAGES[1]!;
const third = ALL_PAGES[2]!;
const held = (bag: Inventory, id: string) => (bag as Record<string, number>)[id] ?? 0;

describe('reimagining a page (§G2, §G3)', () => {
  it('spends the three the player named and hands back one nobody has seen', () => {
    const inventory = holding(2, 3);
    const before = unseenPages(inventory).length;

    const result = reimagine({
      inventory,
      context: READY,
      pages: [first, second, third],
      seed: 'a',
    });
    expect(result, 'the trade refused a crew that could pay for it').not.toBeNull();
    expect(result!.spent).toEqual([first, second, third]);
    // §G2: guaranteed new. Not "probably new".
    expect(ALL_PAGES).toContain(result!.gained);
    expect(before - unseenPages(result!.inventory).length).toBe(1);

    // The named copies really left the bag, and nothing else moved.
    for (const pageId of [first, second, third]) {
      expect(held(inventory, pageId) - held(result!.inventory, pageId)).toBe(1);
    }
    expect(held(result!.inventory, result!.gained)).toBe(1);
  });

  /**
   * Naming one page three times.
   *
   * The ordinary way to spend a stack, and the case a per-page "held at least one" check waves
   * through while the inventory goes to minus one.
   */
  it('takes the same page three times when the crew is holding three of it', () => {
    const inventory: Inventory = { [first]: 4 };
    const result = reimagine({
      inventory,
      context: READY,
      pages: [first, first, first],
      seed: 'b',
    });
    expect(result).not.toBeNull();
    expect(result!.spent).toEqual([first, first, first]);
    expect(held(result!.inventory, first)).toBe(1);
  });

  it('refuses a page the crew is not holding at all, and takes nothing', () => {
    const inventory: Inventory = { [first]: 2, [second]: 2 };
    const pages = [first, second, third];
    expect(reimaginingRefusal({ inventory, context: READY, pages, seed: 'c' })).toBe(
      'pages_not_held',
    );
    expect(reimagine({ inventory, context: READY, pages, seed: 'c' })).toBeNull();
    expect(held(inventory, first), 'a refused trade spent a page').toBe(2);
  });

  it('refuses a page named more times than it is held', () => {
    // Two copies, named three times. Each name is a page the crew holds; the count is the lie.
    const inventory: Inventory = { [first]: 2 };
    expect(
      reimaginingRefusal({
        inventory,
        context: READY,
        pages: [first, first, first],
        seed: 'd',
      }),
    ).toBe('pages_not_held');
  });

  it('refuses an id that is not a page, however much of it the crew holds', () => {
    const inventory: Inventory = { [first]: 2, scrap_servo: 40 };
    expect(
      reimaginingRefusal({
        inventory,
        context: READY,
        pages: [first, 'scrap_servo', 'scrap_servo'],
        seed: 'e',
      }),
    ).toBe('pages_not_held');
  });

  it('refuses anything that is not exactly three', () => {
    const inventory = holding(2, 3);
    const ask = (pages: readonly string[]) =>
      reimaginingRefusal({ inventory, context: READY, pages, seed: 'f' });
    expect(ask([])).toBe('wrong_page_count');
    expect(ask([first, second])).toBe('wrong_page_count');
    expect(ask([first, second, third, first])).toBe('wrong_page_count');
    expect(ask([first, second, third])).toBeNull();
  });

  it('refuses without the research or without a Head of Research', () => {
    const inventory = holding(2, 3);
    const pages = [first, second, third];
    expect(
      reimaginingRefusal({
        inventory,
        context: { hasHeadOfResearch: true, hasReimaginingResearch: false },
        pages,
        seed: 'g',
      }),
    ).toBe('not_available');
    expect(
      reimaginingRefusal({
        inventory,
        context: { hasHeadOfResearch: false, hasReimaginingResearch: true },
        pages,
        seed: 'g',
      }),
    ).toBe('not_available');
  });

  it('refuses when there is nothing left in the game to want', () => {
    // Every page twice. Plenty to spend and nothing to buy, which is the one case where
    // "guaranteed something new" cannot be honoured and so must not take the pages.
    const bag: Record<string, number> = {};
    for (const pageId of ALL_PAGES) bag[pageId] = 2;
    const inventory = bag as Inventory;
    const pages = [first, second, third];
    expect(unseenPages(inventory)).toEqual([]);
    expect(reimaginingRefusal({ inventory, context: READY, pages, seed: 'h' })).toBe(
      'nothing_left_to_find',
    );
    expect(reimagine({ inventory, context: READY, pages, seed: 'h' })).toBeNull();
  });

  /**
   * The three that went in cannot be the one that comes out.
   *
   * Held pages are outside the pool by construction, and every named page is held, so this holds
   * without a filter of its own. It is pinned across many seeds rather than argued: the argument
   * stops being true the moment somebody reads the pool off the post-trade inventory, where all
   * three may well be back at zero.
   */
  it('never hands back one of the three that were spent', () => {
    const inventory: Inventory = { [first]: 1, [second]: 1, [third]: 1 };
    const pages = [first, second, third];
    for (const seed of Array.from({ length: 200 }, (_, index) => `spent-${index}`)) {
      const result = reimagine({ inventory, context: READY, pages, seed });
      expect(result).not.toBeNull();
      expect(pages, `${seed} paid back a page it had just eaten`).not.toContain(result!.gained);
    }
  });

  it('never hands back a page of a document the crew has already unlocked', () => {
    /*
     * Unlocking spends one of every page, so a finished document leaves its pages at zero held.
     * Reading "unseen" off the count alone put all of them back on the table, and the guaranteed
     * new page turned out to be a sheet of something already assembled.
     */
    const shortest = [...BLUEPRINTS].sort((a, b) => a.pages.length - b.pages.length)[0]!;
    const bag: Record<string, number> = { [shortest.id]: 1 };
    // Three copies of pages belonging to some *other* document, so the trade is payable and the
    // only thing under test is which page comes back.
    const other = BLUEPRINTS.find((spec) => spec.id !== shortest.id)!;
    const paying = other.pages.slice(0, 3).map((page) => page.id);
    expect(paying).toHaveLength(REIMAGINING_PAGES_SPENT);
    for (const pageId of paying) bag[pageId] = 2;
    const inventory = bag as Inventory;

    const unlockedPages = new Set<string>(shortest.pages.map((page) => page.id));
    expect(
      unseenPages(inventory).filter((pageId) => unlockedPages.has(pageId)),
      'pages of an unlocked document are still in the pool',
    ).toEqual([]);

    // And across many seeds, not one of them ever comes out of the trade.
    for (const seed of Array.from({ length: 200 }, (_, index) => `unlocked-${index}`)) {
      const result = reimagine({ inventory, context: READY, pages: paying, seed });
      expect(result).not.toBeNull();
      expect(unlockedPages.has(result!.gained), `${seed} paid out ${result!.gained}`).toBe(false);
    }
  });

  it('runs out of things to want once every document is held or unlocked', () => {
    // Every document unlocked and three copies of one page. There is genuinely nothing left in the
    // game to hand back, and the trade has to say so rather than recycling a spent page.
    const bag: Record<string, number> = {};
    for (const spec of BLUEPRINTS) bag[spec.id] = 1;
    bag[first] = 3;
    const inventory = bag as Inventory;
    const pages = [first, first, first];
    expect(unseenPages(inventory)).toEqual([]);
    expect(reimaginingRefusal({ inventory, context: READY, pages, seed: 'i' })).toBe(
      'nothing_left_to_find',
    );
    expect(reimagine({ inventory, context: READY, pages, seed: 'i' })).toBeNull();
  });

  it('gives the same crew the same page for the same seed', () => {
    const inventory = holding(3, 3);
    const pages = [first, second, third];
    const once = reimagine({ inventory, context: READY, pages, seed: 'j' });
    const twice = reimagine({ inventory, context: READY, pages, seed: 'j' });
    expect(once!.gained).toBe(twice!.gained);
    // ...and a different moment is a different page, or a retry is a reroll.
    const seeds = new Set(
      ['k', 'l', 'm', 'n', 'o'].map(
        (seed) => reimagine({ inventory, context: READY, pages, seed })!.gained,
      ),
    );
    expect(seeds.size).toBeGreaterThan(1);
  });

  /** Every refusal has words, because the route answers with the machine name and nothing else. */
  it('has a player-facing sentence for every refusal it can return', () => {
    const inventory = holding(2, 3);
    const reasons = [
      reimaginingRefusal({
        inventory,
        context: { hasHeadOfResearch: false, hasReimaginingResearch: false },
        pages: [],
        seed: 'p',
      }),
      reimaginingRefusal({ inventory, context: READY, pages: [first], seed: 'p' }),
      reimaginingRefusal({
        inventory,
        context: READY,
        pages: [first, first, first],
        seed: 'p',
      }),
    ];
    expect(reasons).toEqual(['not_available', 'wrong_page_count', 'pages_not_held']);
    for (const [reason, sentence] of Object.entries(REIMAGINING_REFUSAL_MESSAGES)) {
      expect(sentence.length, `${reason} has no sentence`).toBeGreaterThan(10);
      expect(sentence, `${reason} prints its own machine name`).not.toContain('_');
    }
  });
});
