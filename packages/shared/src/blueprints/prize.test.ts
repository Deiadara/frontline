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
import { pagePrizeFor, pagePrizeOdds } from './prize.js';

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
