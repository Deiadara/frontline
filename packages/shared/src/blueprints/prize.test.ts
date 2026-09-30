/**
 * The page rate, measured over the boards the game actually produces.
 *
 * The brief gives a rate and not a table: about four pages every seven rotations since 2026-09-29
 * (one in seven before it), a rotation being the full set of three offers, each launched once. So
 * the only honest test is to generate the real boards, launch every card on them, and count, which
 * is what this does. Asserting `pagePrizeOdds`
 * returns the constant it is written from would pass against a board whose difficulty mix quietly
 * doubled the number a player sees.
 *
 * That is not hypothetical. With the base set to a flat one in twenty one, this read one page per
 * 5.96 rotations, because about 71% of the real board is hard work and the hard lift compounds
 * across it. The blend is divided back out so the rate is what a player gets.
 */
import { describe, expect, it } from 'vitest';
import { CITY_DISTRICTS } from '../city/index.js';
import { MISC_AREA_ID, missionOffers } from '../missions.areas.js';
import { BLUEPRINT_CATEGORIES } from './catalog.js';
import { pagesOnShelf } from '../market/blackmarket.js';
import { BLUEPRINTS } from './catalog.js';
import {
  drawPage,
  pagePrizeCategory,
  pagePrizeFor,
  pagePrizeOdds,
  pageWonFrom,
  pagesIn,
} from './prize.js';
import { seedFrom } from '../rng.js';
import { OFFICER_MARKS } from '../crew/marks.js';
import { findFeat } from '../feats/catalog.js';

/** Any server secret: the rate is a property of the draw, not of which secret keys it. */
const SALT = 'prize-test-salt';

/** Enough days to settle a one-in-twenty-one rate, few enough to stay quick. */
const DAYS = 150;
const AREAS = [MISC_AREA_ID, ...CITY_DISTRICTS.map((district) => district.id)];

function sweep() {
  let rotations = 0;
  let offers = 0;
  let pages = 0;
  // Each launch's own seed, as the server draws one per run.
  let launch = 0;
  const byCategory = new Map<string, number>();
  for (let day = 0; day < DAYS; day += 1) {
    const stamp = `2026-04-${day}`;
    for (const areaId of AREAS) {
      // Level 72, where C is the centre of the deal at half pace: the middle of the ladder, which
      // is the rate `BOARD_DIFFICULTY_BLEND` is set to (2026-09-28).
      const jobs = missionOffers(areaId, stamp, 72);
      if (jobs.length === 0) continue;
      rotations += 1;
      for (const job of jobs) {
        offers += 1;
        launch += 1;
        const category = pagePrizeFor(SALT, seedFrom(`launch:${launch}`), job.grade);
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

  it('pays about four pages every seven rotations', () => {
    expect(board.rotations, 'no boards were generated, so this measures nothing').toBeGreaterThan(
      1000,
    );
    const perPage = board.rotations / board.pages;
    // Measured at 7.39 at one in seven, so about 1.85 now. A band rather than a number, because the
    // rate is a property of the whole board and a tuning pass on mission difficulty legitimately
    // moves it a little.
    expect(perPage, `one page per ${perPage.toFixed(2)} rotations`).toBeGreaterThan(1.5);
    expect(perPage, `one page per ${perPage.toFixed(2)} rotations`).toBeLessThan(2.25);
  });

  it('never becomes something a crew can farm', () => {
    // §F1h: harder work pays better, "but only by a bit". The hardest grade may not be worth double.
    expect(pagePrizeOdds('S+')).toBeGreaterThan(pagePrizeOdds('F-'));
    expect(pagePrizeOdds('C')).toBeGreaterThan(pagePrizeOdds('F-'));
    expect(pagePrizeOdds('S+')).toBeLessThan(pagePrizeOdds('F-') * 2);
    // And a paying card is still the exception: about one in five at the middle, under one in four
    // at the top (it was under one in ten at one page in seven rotations).
    expect(pagePrizeOdds('S+')).toBeLessThan(0.25);
  });

  /**
   * A category's share of the paying cards is its share of the page weight (maintainer,
   * 2026-09-29). It was a third each, so a consumable sheet came about four times as often as a
   * unit or upgrade sheet of the same rarity.
   */
  it('splits the paying cards between the categories by the pages in them', () => {
    const weight = (category: (typeof BLUEPRINT_CATEGORIES)[number]) =>
      pagesIn(category).reduce((total, page) => total + page.weight, 0);
    const total = BLUEPRINT_CATEGORIES.reduce((sum, category) => sum + weight(category), 0);
    for (const category of BLUEPRINT_CATEGORIES) {
      const share = (board.byCategory.get(category) ?? 0) / board.pages;
      expect(share, `${category} is ${(100 * share).toFixed(1)}% of pages`).toBeCloseTo(
        weight(category) / total,
        1,
      );
    }
  });

  /*
   * Rolled per launch (maintainer, 2026-09-29). The roll was keyed on the card, so a card that paid
   * once paid on every run of it until the board turned over, and every crew dealt that card saw
   * the same prize. The same card sent again is now a fresh chance at the same odds.
   */
  it('rolls every launch of the same card on its own', () => {
    const runs = Array.from({ length: 4000 }, (_, run) => pagePrizeFor(SALT, run, 'C'));
    const paid = runs.filter((page) => page !== null).length;
    // Independent rolls at the card's odds: 4,000 of them land within a couple of points of it.
    expect(paid / runs.length).toBeGreaterThan(pagePrizeOdds('C') - 0.02);
    expect(paid / runs.length).toBeLessThan(pagePrizeOdds('C') + 0.02);
    // And a paying run says nothing about the next one: a run after a paying run pays at the
    // same rate as any other, which is the farm the old key allowed.
    const afterAPage = runs.filter((page, run) => run > 0 && runs[run - 1] !== null);
    const again = afterAPage.filter((page) => page !== null).length / afterAPage.length;
    expect(again).toBeLessThan(pagePrizeOdds('C') + 0.06);
  });

  it('gives one run the same answer every time it is asked', () => {
    // The settle and any replay read the prize off the run's seed, so it must not move.
    for (const run of [1, 77, 4_294_967_295]) {
      const first = pagePrizeFor(SALT, run, 'S+');
      for (let i = 0; i < 5; i += 1) expect(pagePrizeFor(SALT, run, 'S+')).toBe(first);
    }
  });

  /**
   * The server's secret decides which runs pay, so the client cannot work it out.
   *
   * This function ships in the client bundle. Unsalted, a player who ever learned a run's seed
   * could read its prize off it. Two salts over the same runs must disagree about which ones
   * carry a page.
   */
  it('answers differently under a different secret', () => {
    const runs = Array.from({ length: 2000 }, (_, run) => run);
    const paying = (salt: string) => runs.filter((run) => pagePrizeFor(salt, run, 'S+') !== null);
    const ours = paying(SALT);
    const theirs = new Set(paying('a-guess'));
    expect(ours.length, 'nothing paid, so there was nothing to hide').toBeGreaterThan(20);
    const agreed = ours.filter((run) => theirs.has(run)).length;
    // Independent draws at about one in four agree on a paying run about a quarter of the time.
    expect(agreed / ours.length).toBeLessThan(0.4);
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

  /**
   * A sheet's odds on a job are its rarity's, whichever category it is filed under (maintainer,
   * 2026-09-29). Measured through the two draws a run makes, the card's category and the page on
   * arrival: a Basic unit sheet against a Basic consumable one.
   */
  it('makes a Basic unit sheet as likely off a job as a Basic consumable sheet', () => {
    const sheetRate = (
      categoryFor: (bits: number) => (typeof BLUEPRINT_CATEGORIES)[number],
      category: (typeof BLUEPRINT_CATEGORIES)[number],
    ) => {
      const inCategory = BLUEPRINTS.filter((blueprint) => blueprint.category === category);
      return perPageRate(
        (i) => pageWonFrom(categoryFor(seedFrom(`sheet:${i}`) >>> 17), `sheet:${i}`),
        60_000,
        inCategory,
      )[0]!;
    };
    const ratio = (categoryFor: (bits: number) => (typeof BLUEPRINT_CATEGORIES)[number]) =>
      sheetRate(categoryFor, 'unit') / sheetRate(categoryFor, 'consumable');

    expect(ratio(pagePrizeCategory)).toBeGreaterThan(0.8);
    expect(ratio(pagePrizeCategory)).toBeLessThan(1.25);
    // The control: a third of the draws to each category, as it was, is nowhere near even.
    const thirds = (bits: number) => BLUEPRINT_CATEGORIES[bits % BLUEPRINT_CATEGORIES.length]!;
    expect(ratio(thirds)).toBeLessThan(0.5);
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

/**
 * The draw replays, seed for seed (2026-09-18).
 *
 * `drawPage` is a seeded draw and nothing pinned what it returns, only that the rate it produces
 * over a sweep is right. Those are different promises: a refactor can keep the distribution exactly
 * and still hand a different page to the same seed, and a seeded draw whose output moves is a
 * replay that no longer replays. It nearly happened the day this was written, when `drawPage` was
 * rewritten to call a shared `drawWeighted` helper and the only thing standing behind "identical"
 * was an argument about `Math.round` being a no-op on integer weights. The argument was right, and
 * an argument is not a measurement.
 *
 * Pinned by category rather than by a hand-written list of ids, so the table is regenerable and a
 * reader can see what it is: the same seeds, the same answers, before and after whatever changed.
 */
describe('the page draw is a replay', () => {
  const SEEDS = ['run:1', 'run:2', 'run:3', 'prize:alpha', 'prize:omega'];

  it('hands the same seed the same page every time it is asked', () => {
    for (const category of BLUEPRINT_CATEGORIES) {
      const pool = pagesIn(category);
      for (const seed of SEEDS) {
        const first = drawPage(pool, seed);
        expect(first, `${category} drew nothing for ${seed}`).not.toBeNull();
        // Ten times rather than twice: a draw that reads a module-level cursor would pass a pair.
        for (let again = 0; again < 10; again += 1) {
          expect(drawPage(pool, seed), `${category}/${seed} moved on read ${again}`).toBe(first);
        }
      }
    }
  });

  /**
   * And the answers themselves, which is the half a determinism check cannot see.
   *
   * A rewrite that is deterministic but *different* passes everything above this line. These are
   * the pages the draw returned on the day the table was written. If a change moves one, that is a
   * decision somebody makes and re-records deliberately, not a green suite.
   *
   * Written out rather than snapshotted on purpose. Nothing else in this repo uses snapshots, and a
   * snapshot is the wrong tool for a guard like this one: `vitest -u` re-records it silently, which
   * is exactly the failure the test exists to make loud.
   */
  it('returns the pages it returned when this table was written', () => {
    const drawn = Object.fromEntries(
      BLUEPRINT_CATEGORIES.map((category) => [
        category,
        SEEDS.map((seed) => drawPage(pagesIn(category), seed)),
      ]),
    );
    expect(drawn).toEqual({
      /*
       * Re-recorded on 2026-09-20, deliberately, and this is the note the test above asks for.
       *
       * **All three categories moved at once, and that is the tell.** The 2026-09-19 re-record
       * below moved `upgrade` alone because a document had been added to that pool. This time the
       * pools are untouched and every seed lands somewhere else in all three, because what
       * changed is the draw: `drawWeighted` in `rng.ts` took its point in the range by a modulus
       * of the hash, and `2^32` is not a multiple of any of these pools' scaled totals, so the
       * first 34.2% of the cumulative range was drawn about 10% too often and the rest about 4%
       * too little. It now takes the point off the `mulberry32` stream, which is uniform.
       *
       * Nothing a player already holds changes. `pageWonFrom` runs once at settlement and the
       * page is written into the inventory, so this decides future drops and re-reads nothing.
       */
      unit: [
        'pg_the_twins_paired_harness',
        'pg_kite_crews_spar_frames',
        'pg_heli_porter_main_gearbox',
        'pg_rotorcraft_fuel_governor',
        'pg_the_specter_scent_null',
      ],
      upgrade: [
        'pg_mod_ablative_layers_replacement_count',
        'pg_mod_hook_and_line_throwing_lines',
        'pg_infirmary_ward_layout',
        'pg_gauntlet_pit_drainage',
        'pg_mod_composite_carapace_weight_budget',
      ],
      /* Two seeds drawing the same page is not a fault: duplicates are allowed (§F1d), and with
         5 seeds over a 133-weight pool a collision is ordinary rather than surprising. */
      consumable: [
        'pg_shaped_charges_tamping_notes',
        'pg_overnight_plating_weld_sequence',
        'pg_flooded_cellar_sluice_gates',
        'pg_flooded_cellar_sluice_gates',
        'pg_refined_accelerant_burn_rate',
      ],
    });
  });
});

/**
 * The `pages` ladder moves with the rate (feats move with the game). Its top two rungs sat at two
 * and four and a half years for a player launching 24 runs a day at one page in seven rotations;
 * they were retargeted with the rate on 2026-09-29.
 *
 * Counted off the jobs alone, at the middle grade and 70% of runs coming home, which is a floor:
 * the Runner, the fence and the bench add about a fifth on top in the simulation the targets were
 * set from (2,707 found in two years against 2,336 off the jobs).
 */
describe('the pages ladder against the supply', () => {
  const offJobs = (days: number) =>
    24 * pagePrizeOdds(OFFICER_MARKS[Math.floor(OFFICER_MARKS.length / 2)]!) * 0.7 * days;
  const target = (id: string) => findFeat(id)!.target;

  it('puts the top rung within two years of an engaged player, and the one under it within one', () => {
    expect(offJobs(730) * 1.2).toBeGreaterThan(target('pages_7'));
    expect(offJobs(365) * 1.2).toBeGreaterThan(target('pages_6'));
  });

  it('keeps the top rung a two-year feat rather than a first-year one', () => {
    expect(offJobs(365) * 1.2).toBeLessThan(target('pages_7'));
  });
});
