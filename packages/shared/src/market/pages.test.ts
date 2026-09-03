/**
 * Buying pages: the Black Market (§F2) and the Runner (§F3).
 *
 * The two shops are deliberately different answers to the same problem. The fence tells you exactly
 * which page you are looking at and charges infamy, so it is where a player goes when they are one
 * page short of something and want to stop waiting. The Runner turns one up now and then for caps,
 * dear, and never on demand.
 *
 * Both are measured over the real shelves rather than asserted off the constants: a weight or an
 * odds constant says what was intended, and what a player sees is what the whole deck does with it.
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINTS } from '../blueprints/catalog.js';
import { ITEM_CATALOG, type ItemId } from '../items/catalog.js';

/** The kind of an item on a barrow line, looked up once rather than indexed inline. */
const kindOf = (item: string): string => ITEM_CATALOG[item as ItemId].kind;

/** ...and what it is nominally worth, for the same reason. */
const valueOf = (item: string): number => ITEM_CATALOG[item as ItemId].capsValue;
import {
  BLACK_MARKET_GOODS,
  BLACK_MARKET_SLOTS,
  PAGES_ON_THE_SHELF,
  blackMarketBoard,
  pagesOnShelf,
} from './blackmarket.js';
import { VENDOR_PAGE_ODDS, vendorStockFor } from './vendor.js';

const DAYS = 150;
const PAGE_IDS = new Set<string>(BLUEPRINTS.flatMap((b) => b.pages.map((page) => page.id)));

describe('the Black Market sells pages (§F2)', () => {
  it('shows pages often enough to matter and not so often it is a page shop', () => {
    const kinds = new Map<string, number>();
    let slots = 0;
    for (let day = 0; day < DAYS; day += 1) {
      for (const slot of blackMarketBoard(`2026-06-${day}`, Array(BLACK_MARKET_SLOTS).fill(0))) {
        const spec = BLACK_MARKET_GOODS[slot.goodId];
        if (!spec) continue;
        slots += 1;
        kinds.set(spec.kind, (kinds.get(spec.kind) ?? 0) + 1);
      }
    }
    const share = (kinds.get('blueprint_page') ?? 0) / slots;
    // Measured at 18.9%, about the same as whole blueprints. The floor is the interesting half:
    // all 157 pages went into the deck at first and nine tenths of the shelf became pages.
    expect(share, `pages are ${(100 * share).toFixed(1)}% of the shelf`).toBeGreaterThan(0.08);
    expect(share, `pages are ${(100 * share).toFixed(1)}% of the shelf`).toBeLessThan(0.3);
  });

  it('carries only a handful of the catalogue on any one day', () => {
    // The whole reason the shelf is not a page shop: a player cannot come here for a named page on
    // a day the fence does not have it.
    expect(pagesOnShelf('2026-06-01')).toHaveLength(PAGES_ON_THE_SHELF);
    const days = new Set([0, 1, 2, 3].map((d) => pagesOnShelf(`2026-06-${d}`).join()));
    expect(days.size, 'the fence has the same pages every day').toBeGreaterThan(1);
  });

  it('says which page it is, and charges infamy for it', () => {
    const pages = Object.values(BLACK_MARKET_GOODS).filter((g) => g.kind === 'blueprint_page');
    expect(pages.length).toBe(PAGE_IDS.size);
    for (const good of pages) {
      // §F2b: named. A player buying here is not gambling.
      expect(good.name.length).toBeGreaterThan(0);
      // §F2c: priced in infamy, which is the only currency this shop takes.
      expect(good.infamy).toBeGreaterThan(0);
      const granted = Object.keys(good.grants ?? {});
      expect(granted).toHaveLength(1);
      expect(PAGE_IDS.has(granted[0]!), `${good.id} grants something that is not a page`).toBe(
        true,
      );
    }
  });

  it('prices a page of a long blueprint above a page of a short one', () => {
    const shortest = [...BLUEPRINTS].sort((a, b) => a.pages.length - b.pages.length)[0]!;
    const longest = [...BLUEPRINTS].sort((a, b) => b.pages.length - a.pages.length)[0]!;
    const priceOf = (pageId: string) =>
      Object.values(BLACK_MARKET_GOODS).find(
        (g) => (g.grants as Record<string, number> | undefined)?.[pageId] === 1,
      )!.infamy;
    expect(priceOf(longest.pages[0].id)).toBeGreaterThan(priceOf(shortest.pages[0].id));
  });
});

describe('the Runner sometimes has a page (§F3)', () => {
  const barrows = Array.from({ length: DAYS }, (_, day) => vendorStockFor(`2026-07-${day}`));
  const pageLines = barrows.flatMap((stock) =>
    stock.filter((line) => kindOf(line.item) === 'page'),
  );

  it('has one rarely rather than most days', () => {
    const withPage = barrows.filter((stock) =>
      stock.some((line) => kindOf(line.item) === 'page'),
    ).length;
    expect(withPage, 'the Runner never carries a page').toBeGreaterThan(0);
    // Measured at one opening in 5.4. A band, because the odds are one constant and the barrow is
    // a whole draw around it.
    const oneIn = barrows.length / withPage;
    expect(oneIn, `a page on one barrow in ${oneIn.toFixed(1)}`).toBeGreaterThan(3);
    expect(VENDOR_PAGE_ODDS).toBeLessThan(0.25);
  });

  it('charges caps for it, and more than the sheet is nominally worth', () => {
    expect(pageLines.length).toBeGreaterThan(0);
    for (const line of pageLines) {
      // §F3c: caps. `price` on a vendor line is caps and there is no infamy on this barrow at all.
      expect(line.price).toBeGreaterThan(valueOf(line.item));
      // One sheet of paper, and only ever one.
      expect(line.stock).toBe(1);
    }
  });
});
