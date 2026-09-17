/**
 * The page rate, measured over the boards the game actually produces.
 *
 * The brief gives a rate and not a table: about one page every seven rotations, a rotation being
 * the full set of three offers. So the only honest test is to generate the real boards and count,
 * which is what this does. Asserting `pagePrizeOdds` returns the constant it is written from would
 * pass against a board whose difficulty mix quietly doubled the number a player sees.
 *
 * That is not hypothetical. With the base set to a flat one in twenty one, this read one page per
 * 5.96 rotations, because about 71% of the real board is hard work and the hard lift compounds
 * across it. The blend is divided back out so the seven is what a player gets.
 */
import { describe, expect, it } from 'vitest';
import { CITY_DISTRICTS } from '../city/index.js';
import { MISC_AREA_ID, missionOffers } from '../missions.areas.js';
import { BLUEPRINT_CATEGORIES } from './catalog.js';
import { pagesOnShelf } from '../market/blackmarket.js';
import { BLUEPRINTS } from './catalog.js';
import { pagePrizeFor, pagePrizeOdds, pageWonFrom } from './prize.js';

/** Enough days to settle a one-in-twenty-one rate, few enough to stay quick. */
const DAYS = 150;
const AREAS = [MISC_AREA_ID, ...CITY_DISTRICTS.map((district) => district.id)];

function sweep() {
  let rotations = 0;
  let offers = 0;
  let pages = 0;
  const byCategory = new Map<string, number>();
  for (let day = 0; day < DAYS; day += 1) {
    const stamp = `2026-04-${day}`;
    for (const areaId of AREAS) {
      const templates = missionOffers(areaId, stamp);
      if (templates.length === 0) continue;
      rotations += 1;
      for (const template of templates) {
        offers += 1;
        const category = pagePrizeFor(areaId, stamp, template.id, template.difficulty);
        if (category === null) continue;
        pages += 1;
        byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
      }
    }
  }
  return { rotations, offers, pages, byCategory };
}

describe('pages as mission pay (§F1)', () => {
  const board = sweep();

  it('pays about one page every seven rotations', () => {
    expect(board.rotations, 'no boards were generated, so this measures nothing').toBeGreaterThan(
      1000,
    );
    const perPage = board.rotations / board.pages;
    // Measured at 7.39. A band rather than a number, because the rate is a property of the whole
    // board and a tuning pass on mission difficulty legitimately moves it a little.
    expect(perPage, `one page per ${perPage.toFixed(2)} rotations`).toBeGreaterThan(6);
    expect(perPage, `one page per ${perPage.toFixed(2)} rotations`).toBeLessThan(9);
  });

  it('never becomes something a crew can farm', () => {
    // §F1h: harder work pays better, "but only by a bit". A hard job may not be worth double.
    expect(pagePrizeOdds('hard')).toBeGreaterThan(pagePrizeOdds('easy'));
    expect(pagePrizeOdds('hard')).toBeLessThan(pagePrizeOdds('easy') * 2);
    // And no single offer is ever likely to carry one.
    expect(pagePrizeOdds('hard')).toBeLessThan(0.1);
  });

  it('spreads across all three categories rather than favouring one', () => {
    for (const category of BLUEPRINT_CATEGORIES) {
      const share = (board.byCategory.get(category) ?? 0) / board.pages;
      expect(share, `${category} is ${(100 * share).toFixed(1)}% of pages`).toBeGreaterThan(0.2);
    }
  });

  it('gives the same offer the same answer every time it is read', () => {
    // A card that re-rolled its prize on every read is a card a player refreshes until it pays.
    const first = pagePrizeFor('rustyard', '2026-04-09', 'anything', 'hard');
    for (let i = 0; i < 5; i += 1) {
      expect(pagePrizeFor('rustyard', '2026-04-09', 'anything', 'hard')).toBe(first);
    }
    // ...and a different day is a different question.
    const days = new Set(
      Array.from({ length: 40 }, (_, d) =>
        pagePrizeFor('rustyard', `2026-05-${d}`, 'anything', 'hard'),
      ),
    );
    expect(days.size, 'every day gave the same answer').toBeGreaterThan(1);
  });
});

/**
 * Rarity decides how often a page turns up, on both channels (maintainer, 2026-09-17).
 *
 * It decided nothing before: every one of the 255 pages was equally likely, so the scale the
 * Scrapyard gates and prices on meant nothing to the two draws that actually hand a page over. In
 * the unit category it ran backwards, six Basic pages against nine Masterpiece ones.
 *
 * Sampled rather than reasoned about, and over the whole catalogue rather than a fixture: the
 * question is whether the shipped content comes out in the right order, and the counts per rarity
 * are part of the answer.
 */
describe('how often each rarity of page turns up', () => {
  const RARITIES = ['basic', 'intricate', 'advanced', 'masterpiece'] as const;

  /**
   * Rate per page of that rarity, so the differing counts per band do not decide the answer.
   *
   * `from` scopes the denominator to the pool the draw actually samples. Getting that wrong is the
   * first way this test went: counting every category's pages while `pageWonFrom` only ever draws
   * unit pages made the per-page rates meaningless and reported the ordering backwards.
   */
  function perPageRate(
    draw: (seed: number) => string | null,
    runs: number,
    from: readonly (typeof BLUEPRINTS)[number][] = BLUEPRINTS,
  ) {
    const rarityOf = new Map<string, string>();
    const pages = new Map<string, number>();
    for (const blueprint of from) {
      for (const page of blueprint.pages) {
        const rarity = ('rarity' in page ? page.rarity : undefined) ?? blueprint.rarity;
        rarityOf.set(page.id, rarity);
        pages.set(rarity, (pages.get(rarity) ?? 0) + 1);
      }
    }
    const hits = new Map<string, number>();
    for (let i = 0; i < runs; i += 1) {
      const id = draw(i);
      if (id === null) continue;
      const rarity = rarityOf.get(id);
      if (rarity) hits.set(rarity, (hits.get(rarity) ?? 0) + 1);
    }
    return RARITIES.map((rarity) => (hits.get(rarity) ?? 0) / (pages.get(rarity) ?? 1));
  }

  it('hands out a common page more often than a rare one, on a mission', () => {
    const units = BLUEPRINTS.filter((blueprint) => blueprint.category === 'unit');
    const rates = perPageRate((i) => pageWonFrom('unit', `prize-rate-${i}`), 30_000, units);
    // Strictly descending across the scale, which is the whole claim.
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]!, `${RARITIES[i]} should be rarer than ${RARITIES[i - 1]}`).toBeLessThan(
        rates[i - 1]!,
      );
    }
    // ...and gently: the brief was "not too much, since you need more of them".
    expect(rates[0]! / rates[3]!).toBeGreaterThan(1.5);
    expect(rates[0]! / rates[3]!).toBeLessThan(3);
  });

  it('stocks a common page more often than a rare one, at the fence', () => {
    const rates = perPageRate((i) => {
      const [first] = pagesOnShelf(`2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`);
      return first === undefined ? null : first.replace(/^page_/, '');
    }, 12_000);
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]!, `${RARITIES[i]} should be rarer than ${RARITIES[i - 1]}`).toBeLessThan(
        rates[i - 1]!,
      );
    }
  });
});
