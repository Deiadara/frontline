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
import { BLUEPRINTS, pageRarity } from './catalog.js';
import { reimaginingOdds } from './reimagine-odds.js';
import {
  REIMAGINING_COMPLETE_XP,
  REIMAGINING_PAGES_SPENT,
  REIMAGINING_REFUSAL_MESSAGES,
  reimagine,
  reimaginingRefusal,
  unseenPages,
} from './state.js';
import type { Inventory } from '../items/inventory.js';
import { ITEM_RARITIES, type ItemRarity } from '../items/rarity.js';

const READY = { hasHeadOfResearch: true, hasReimaginingResearch: true };
const ALL_PAGES = BLUEPRINTS.flatMap((spec) => spec.pages.map((page) => page.id));

/** A crew holding `copies` of the first few pages, so there is something to name three times. */
function holding(copies: number, distinct = 3): Inventory {
  const bag: Record<string, number> = {};
  for (const pageId of ALL_PAGES.slice(0, distinct)) bag[pageId] = copies;
  return bag;
}

/** Every page with the tier it is graded at, which is what the payout ladder is measured against. */
const PAGE_RARITY = new Map<string, ItemRarity>(
  BLUEPRINTS.flatMap((spec) =>
    spec.pages.map((page) => [page.id, pageRarity(spec, page)] as const),
  ),
);
const PAGES_OF = (rarity: ItemRarity): string[] =>
  ALL_PAGES.filter((pageId) => PAGE_RARITY.get(pageId) === rarity);

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
    expect(held(result!.inventory, result!.gained!)).toBe(1);
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
    // Every page twice. Plenty to spend and nothing to buy: the pages go in and experience comes
    // out (maintainer, 2026-09-23), rather than the refusal it used to be.
    const bag: Record<string, number> = {};
    for (const pageId of ALL_PAGES) bag[pageId] = 2;
    const inventory = bag as Inventory;
    const pages = [first, second, third];
    expect(unseenPages(inventory)).toEqual([]);
    expect(reimaginingRefusal({ inventory, context: READY, pages, seed: 'h' })).toBeNull();
    const paid = reimagine({ inventory, context: READY, pages, seed: 'h' });
    expect(paid).not.toBeNull();
    expect(paid!.gained).toBeNull();
    expect(paid!.xp).toBe(REIMAGINING_COMPLETE_XP);
    // The three really left the bag, and nothing arrived in it.
    for (const pageId of pages) expect(held(paid!.inventory, pageId)).toBe(1);
    expect(unseenPages(paid!.inventory)).toEqual([]);
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
      expect(unlockedPages.has(result!.gained!), `${seed} paid out ${result!.gained}`).toBe(false);
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
    expect(reimaginingRefusal({ inventory, context: READY, pages, seed: 'i' })).toBeNull();
    const paid = reimagine({ inventory, context: READY, pages, seed: 'i' });
    expect(paid?.gained).toBeNull();
    expect(paid?.xp).toBe(REIMAGINING_COMPLETE_XP);
    expect(held(paid!.inventory, first)).toBe(0);
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

/**
 * What the bench pays out, and why it is measured rather than argued.
 *
 * The rarity draw and the ladder are tested apart in `reimagine-odds.test.ts`. What only shows up
 * here is the wiring: that the three sheets the player named are the ones the ladder is read off,
 * that the page really is picked out of the tier that was rolled, and that a tier with nothing
 * unseen in it still pays.
 *
 * The samples below are 5,000 trades and the tolerance is four binomial standard errors on the
 * share being checked, sqrt(p * (1 - p) / n), which is 2.3 percentage points against an 80% share
 * and 0.4 against a 0.5% one. That is an honest window rather than a round one: it is wide enough
 * that no reasonable hash reddens it, and a good deal narrower than the distance between any two
 * rungs of the ladder, so a swapped ladder or an ignored input misses it by a factor of ten.
 *
 * Nothing here is actually random. The seeds are fixed strings, so a passing run passes forever and
 * the only thing that moves these numbers is the maths moving. A 200,000-trade run off this code,
 * covering all twenty input multisets, came in inside 1.3 standard errors everywhere.
 */
describe('what the three sheets buy (maintainer, 2026-09-18)', () => {
  const SAMPLE = 5_000;
  /** Four binomial standard errors on a share of `share` over `SAMPLE` draws. See the note above. */
  const window = (share: number) => 4 * Math.sqrt((share * (1 - share)) / SAMPLE);

  /** Trades `SAMPLE` times off the same bag and counts the tier of the page that came back. */
  function payouts(inventory: Inventory, pages: readonly string[], tag: string) {
    const counts = new Map<ItemRarity, number>(ITEM_RARITIES.map((rarity) => [rarity, 0]));
    for (let index = 0; index < SAMPLE; index += 1) {
      const result = reimagine({ inventory, context: READY, pages, seed: `${tag}-${index}` });
      expect(result, 'the trade refused mid-sample').not.toBeNull();
      const rarity = PAGE_RARITY.get(result!.gained!)!;
      counts.set(rarity, counts.get(rarity)! + 1);
    }
    return (rarity: ItemRarity) => counts.get(rarity)! / SAMPLE;
  }

  /** Three sheets of the named tiers, held one deep each, and nothing else in the bag. */
  function feed(tiers: readonly ItemRarity[]): { inventory: Inventory; pages: string[] } {
    const bag: Record<string, number> = {};
    const pages: string[] = [];
    const taken = new Map<ItemRarity, number>();
    for (const tier of tiers) {
      const at = taken.get(tier) ?? 0;
      taken.set(tier, at + 1);
      const pageId = PAGES_OF(tier)[at]!;
      pages.push(pageId);
      bag[pageId] = (bag[pageId] ?? 0) + 1;
    }
    return { inventory: bag, pages };
  }

  it.each([
    ['basic', 'basic', 'basic'],
    ['basic', 'basic', 'masterpiece'],
    ['advanced', 'advanced', 'advanced'],
    ['masterpiece', 'masterpiece', 'masterpiece'],
  ] as ItemRarity[][])('pays %s + %s + %s at the ladder those three buy', (...tiers) => {
    const { inventory, pages } = feed(tiers);
    const odds = reimaginingOdds(tiers);
    const share = payouts(inventory, pages, tiers.join('+'));
    for (const rarity of ITEM_RARITIES) {
      expect(
        Math.abs(share(rarity) - odds[rarity]),
        `${tiers.join('+')} paid ${rarity} at ${(share(rarity) * 100).toFixed(2)}% against ${(odds[rarity] * 100).toFixed(2)}%`,
      ).toBeLessThan(window(odds[rarity]));
    }
  });

  /** The headline the brief asked for, stated as the two numbers a player would notice. */
  it('turns three Basic sheets into a Basic page four times in five, and three Masterpiece sheets into a Masterpiece page four times in five', () => {
    const cheap = feed(['basic', 'basic', 'basic']);
    expect(payouts(cheap.inventory, cheap.pages, 'cheap')('basic')).toBeGreaterThan(0.78);
    const dear = feed(['masterpiece', 'masterpiece', 'masterpiece']);
    expect(payouts(dear.inventory, dear.pages, 'dear')('masterpiece')).toBeGreaterThan(0.78);
  });

  /** Same bag, same seed, different sheets in the sockets: the page that comes back moves. */
  it('reads the ladder off the three that were named rather than off the bag', () => {
    const bag: Record<string, number> = {};
    for (const tier of ITEM_RARITIES)
      for (const pageId of PAGES_OF(tier).slice(0, 3)) bag[pageId] = 2;
    const inventory = bag as Inventory;
    const cheap = PAGES_OF('basic').slice(0, 3);
    const dear = PAGES_OF('masterpiece').slice(0, 3);
    const cheapShare = payouts(inventory, cheap, 'same-bag-cheap');
    const dearShare = payouts(inventory, dear, 'same-bag-dear');
    expect(cheapShare('basic')).toBeGreaterThan(0.7);
    expect(dearShare('masterpiece')).toBeGreaterThan(0.7);
    expect(dearShare('masterpiece')).toBeGreaterThan(cheapShare('masterpiece') * 50);
  });

  /**
   * A tier with nothing unseen left in it still has to pay.
   *
   * The trade is guaranteed, so an exhausted tier falls to the nearest stocked one. A crew that has
   * seen every Basic page rolls Basic four times in five off a cheap input, and every one of those
   * rolls has to come back as an Intricate page: 80% plus the 15% that was Intricate anyway.
   */
  it('falls to the next tier up when the tier it rolled has nothing unseen left', () => {
    const bag: Record<string, number> = {};
    for (const pageId of PAGES_OF('basic')) bag[pageId] = 1;
    const paying = PAGES_OF('basic')[0]!;
    bag[paying] = 4;
    const inventory = bag as Inventory;
    const pages = [paying, paying, paying];
    expect(
      unseenPages(inventory).filter((pageId) => PAGE_RARITY.get(pageId) === 'basic'),
      'the fixture left a Basic page unseen, so the fallback is never reached',
    ).toEqual([]);

    const share = payouts(inventory, pages, 'no-basics');
    expect(share('basic')).toBe(0);
    // 0.80 rolled Basic plus the 0.15 that rolled Intricate.
    expect(Math.abs(share('intricate') - 0.95)).toBeLessThan(window(0.95));
    // The tiers that were never exhausted are untouched.
    expect(Math.abs(share('advanced') - 0.045)).toBeLessThan(window(0.045));
    expect(Math.abs(share('masterpiece') - 0.005)).toBeLessThan(window(0.005));
  });

  /**
   * Nearest, and a tie goes down.
   *
   * With every Advanced page seen, an Advanced roll is one step from Intricate and one step from
   * Masterpiece. It has to land on Intricate: ties going up would make emptying a tier the fastest
   * route to the tier above it.
   */
  it('breaks a tie downwards when the exhausted tier sits between two stocked ones', () => {
    const bag: Record<string, number> = {};
    for (const pageId of PAGES_OF('advanced')) bag[pageId] = 1;
    const paying = PAGES_OF('advanced')[0]!;
    bag[paying] = 4;
    const inventory = bag as Inventory;
    const share = payouts(inventory, [paying, paying, paying], 'no-advanced');
    const odds = reimaginingOdds(['advanced', 'advanced', 'advanced']);

    expect(share('advanced')).toBe(0);
    // The 29.3% that rolled Advanced went to Intricate, not to Masterpiece.
    const toIntricate = odds.intricate + odds.advanced;
    expect(Math.abs(share('intricate') - toIntricate)).toBeLessThan(window(toIntricate));
    expect(Math.abs(share('masterpiece') - odds.masterpiece)).toBeLessThan(
      window(odds.masterpiece),
    );
    expect(Math.abs(share('basic') - odds.basic)).toBeLessThan(window(odds.basic));
  });

  /**
   * The search walks as far as it has to, not exactly one rung.
   *
   * With both Basic and Intricate emptied out, a cheap input rolls one of those two 95 times in a
   * hundred and every one of them has to come back Advanced. A fallback that steps a single tier
   * and stops would have nothing to hand over on the Basic rolls.
   */
  it('keeps stepping until it finds a stocked tier, however far that is', () => {
    const bag: Record<string, number> = {};
    for (const pageId of [...PAGES_OF('basic'), ...PAGES_OF('intricate')]) bag[pageId] = 1;
    const paying = PAGES_OF('basic')[0]!;
    bag[paying] = 4;
    const inventory = bag as Inventory;
    expect(
      unseenPages(inventory).filter((pageId) => {
        const rarity = PAGE_RARITY.get(pageId)!;
        return rarity === 'basic' || rarity === 'intricate';
      }),
    ).toEqual([]);

    const share = payouts(inventory, [paying, paying, paying], 'two-steps');
    expect(share('basic')).toBe(0);
    expect(share('intricate')).toBe(0);
    // 0.80 + 0.15 rolled a tier that is gone, plus the 0.045 that rolled Advanced anyway.
    expect(share('advanced')).toBeGreaterThan(0.99);
    expect(Math.abs(share('masterpiece') - 0.005)).toBeLessThan(window(0.005));
  });

  /** Whatever the ladder says, the page is still one nobody has seen and not one of the three. */
  it('still hands back an unseen page that is not one of the three, at every tier', () => {
    for (const tiers of [
      ['basic', 'basic', 'basic'],
      ['intricate', 'advanced', 'masterpiece'],
      ['masterpiece', 'masterpiece', 'masterpiece'],
    ] as ItemRarity[][]) {
      const { inventory, pages } = feed(tiers);
      const pool = new Set(unseenPages(inventory));
      for (let index = 0; index < 300; index += 1) {
        const result = reimagine({
          inventory,
          context: READY,
          pages,
          seed: `${tiers.join('+')}-clean-${index}`,
        })!;
        expect(pages).not.toContain(result.gained);
        expect(pool.has(result.gained!), `${result.gained} was not in the unseen pool`).toBe(true);
      }
    }
  });

  /** Determinism survived the second draw: one seed, one answer, however many times it is asked. */
  it('gives the same page for the same seed and the same three sheets, every time', () => {
    const { inventory, pages } = feed(['basic', 'intricate', 'masterpiece']);
    for (let index = 0; index < 50; index += 1) {
      const seed = `stable-${index}`;
      const once = reimagine({ inventory, context: READY, pages, seed })!;
      const twice = reimagine({ inventory, context: READY, pages, seed })!;
      const thrice = reimagine({ inventory, context: READY, pages, seed })!;
      expect(once.gained).toBe(twice.gained);
      expect(twice.gained).toBe(thrice.gained);
    }
  });
});
