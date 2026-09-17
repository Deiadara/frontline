import { describe, expect, it } from 'vitest';
import { PERK_CATALOG, findPerk } from './perks.js';
import {
  MAX_PERK_WORTH,
  PERK_BREADTH,
  bonusWorth,
  perkBreadth,
  perkWorth,
  perksWorth,
} from './perk-worth.js';

/**
 * Breadth, not magnitude (maintainer, 2026-09-16).
 *
 * The Bar priced an officer off their attributes alone, which is the half of a person that **can be
 * trained**. A perk cannot be: it is what somebody permanently is, and it was free. So a sheet
 * carrying "a share of your dead walk back, in every fight you ever have" cost exactly what the
 * same sheet carrying "Anodics hit harder" cost, and the second number is the bigger one.
 */
describe('what a tag is worth', () => {
  it('prices a bonus that pays everywhere above a bigger one that pays on a single unit', () => {
    const broad = findPerk('battlefield_surgeon');
    const narrow = findPerk('arc_warden');
    if (!broad || !narrow) throw new Error('fixture: the catalogue moved');

    // The narrow one carries the larger number, which is the whole point of the case.
    const magnitudes = [broad.bonus, narrow.bonus].map((bonus) =>
      'percent' in bonus ? bonus.percent : 0,
    );
    expect(magnitudes[1], 'the narrow perk should be the bigger number').toBeGreaterThan(
      magnitudes[0]!,
    );
    // ...and it is worth less, because it almost never pays.
    expect(perkWorth(narrow.id)).toBeLessThan(perkWorth(broad.id));
  });

  it('gives every perk in the catalogue a worth, and never a negative one', () => {
    for (const perk of PERK_CATALOG) {
      const worth = perkWorth(perk.id);
      expect(worth, perk.id).toBeGreaterThan(0);
      expect(worth, perk.id).toBeLessThanOrEqual(MAX_PERK_WORTH);
    }
  });

  /** An id the catalogue does not carry is worth nothing rather than throwing on a read path. */
  it('is worth nothing for a perk that has been retired', () => {
    expect(perkWorth('a_perk_that_was_never_written')).toBe(0);
    expect(perksWorth([])).toBe(0);
  });

  it('adds up what somebody carries', () => {
    const two = ['battlefield_surgeon', 'arc_warden'];
    expect(perksWorth(two)).toBeCloseTo(perkWorth(two[0]!) + perkWorth(two[1]!), 10);
  });

  /**
   * The bands are ordered, which is the whole model in one assertion.
   *
   * If `named` ever came out above `everywhere`, every price this feeds would be backwards and the
   * tests above would still pass on the two particular perks they name.
   */
  it('orders the breadth bands from a single unit up to everything', () => {
    expect(PERK_BREADTH.named).toBeLessThan(PERK_BREADTH.conditional);
    expect(PERK_BREADTH.conditional).toBeLessThan(PERK_BREADTH.tier);
    expect(PERK_BREADTH.tier).toBeLessThan(PERK_BREADTH.wide);
    expect(PERK_BREADTH.wide).toBeLessThan(PERK_BREADTH.everywhere);
  });

  /**
   * A count of whole things is not a percentage.
   *
   * `{ flat: 1 }` on `training_sessions` is a whole extra hour on the floor every day for ever; on
   * `unit_morale` it is one point of a hundred. Scored alike, the first landed at the bottom of the
   * catalogue beside the genuinely marginal perks.
   */
  it('reads a count of whole things as worth more than one point of a rating', () => {
    const session = bonusWorth({ kind: 'training_sessions', flat: 1 });
    const morale = bonusWorth({ kind: 'unit_morale', flat: 1 });
    expect(session).toBeGreaterThan(morale);
  });

  /** Every kind the catalogue uses is banded on purpose rather than falling to the default. */
  it('bands every bonus kind the catalogue actually ships', () => {
    for (const perk of PERK_CATALOG) {
      expect(PERK_BREADTH, perk.bonus.kind).toHaveProperty(perkBreadth(perk.bonus));
    }
  });
});
