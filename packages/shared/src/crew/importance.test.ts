import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_NAMES, MAX_ATTRIBUTE, type Attributes } from '../attributes.js';
import { OFFICER_ROLES } from '../roles.js';
import {
  IMPORTANCE_WEIGHT,
  ROLE_IMPORTANCE,
  SKILL_BONUS_BANDS,
  bandFor,
  importanceOf,
  officerScore,
  skillsThatMatter,
} from './importance.js';

const sheet = (over: Partial<Attributes> = {}): Attributes =>
  ({ ...Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, 0])), ...over }) as Attributes;

/**
 * The scoring rule, pinned to the board's own worked examples.
 *
 * Both of them are transcribed rather than paraphrased, because a scoring table is the kind of
 * thing a test can agree with while being wrong: any monotonic function of the sheet passes "more
 * is better", and the whole content of this design is *which* number comes out.
 */
describe('what a chair is worth to the person in it', () => {
  it('weights a point by how much the seat cares about the skill', () => {
    expect(IMPORTANCE_WEIGHT).toEqual({
      insignificant: 1,
      useful: 2,
      essential: 3,
      irreplaceable: 4,
    });
  });

  /**
   * The board's first example: "1 point in one insignificant, 2 in one useful, 2 in one essential
   * and 1 in irreplaceable" scores 1*1 + 2*2 + 2*3 + 1*4 = 15.
   *
   * Head Spy: Stealth is irreplaceable, Deception essential, Logic useful, and Strength is not
   * rated at all, which makes it the insignificant one.
   */
  it('adds up the way the worked example does', () => {
    const score = officerScore(
      sheet({ strength: 1, logic: 2, deception: 2, stealth: 1 }),
      'head_spy',
    );
    expect(score.base).toBe(1 * 1 + 2 * 2 + 2 * 3 + 1 * 4);
    expect(score.base).toBe(15);
    // Nothing is near a threshold, so the bands pay nothing and the total is the base.
    expect(score.bonus).toBe(0);
    expect(score.total).toBe(15);
  });

  /**
   * The board's second example: "2 insignificant in 51 and one useful in 34" pays 2*3 + 2 = 8.
   *
   * The bonus is per *skill* that reaches a band, not once per band, which is the half of the rule
   * a reading could get wrong in either direction.
   */
  it('pays the band bonus once for every skill that reaches it', () => {
    const before = officerScore(sheet(), 'head_spy');
    expect(before.bonus).toBe(0);

    // Strength and Toughness are unrated by the Head Spy (insignificant); Logic is useful.
    const score = officerScore(sheet({ strength: 51, toughness: 51, logic: 34 }), 'head_spy');
    expect(score.bonus).toBe(2 * 3 + 2);
    expect(score.bonus).toBe(8);
    // ...and the base is still the plain weighted sum underneath it.
    expect(score.base).toBe(51 * 1 + 51 * 1 + 34 * 2);
  });

  it('puts each band boundary on the side the table says', () => {
    expect(bandFor(24).bonus.essential).toBe(0);
    expect(bandFor(25).bonus.essential).toBe(3);
    expect(bandFor(49).bonus.essential).toBe(3);
    expect(bandFor(50).bonus.essential).toBe(9);
    expect(bandFor(74).bonus.irreplaceable).toBe(16);
    expect(bandFor(75).bonus.irreplaceable).toBe(32);
    expect(bandFor(99).bonus.irreplaceable).toBe(32);
    expect(bandFor(100).bonus.irreplaceable).toBe(64);
  });

  it('clamps a value outside the scale into the nearest end rather than falling over', () => {
    expect(bandFor(-5)).toBe(SKILL_BONUS_BANDS[0]);
    expect(bandFor(1000).bonus.irreplaceable).toBe(64);
  });

  /** A band is worth more the more the seat cares, at every rung. That is the point of the table. */
  it('pays more for the same peak in a skill the seat cares about', () => {
    for (const band of SKILL_BONUS_BANDS.slice(1)) {
      expect(band.bonus.useful, `${band.from}`).toBeGreaterThan(band.bonus.insignificant);
      expect(band.bonus.essential, `${band.from}`).toBeGreaterThan(band.bonus.useful);
      expect(band.bonus.irreplaceable, `${band.from}`).toBeGreaterThan(band.bonus.essential);
    }
  });
});

describe('the table of what each chair wants', () => {
  it('gives every seat exactly one irreplaceable skill', () => {
    for (const role of OFFICER_ROLES) {
      const rated = Object.values(ROLE_IMPORTANCE[role]);
      expect(
        rated.filter((importance) => importance === 'irreplaceable'),
        role,
      ).toHaveLength(1);
    }
  });

  it('leaves anything a seat does not name as insignificant', () => {
    // The Raid Boss has no use for cipher traffic.
    expect(importanceOf('raid_boss', 'cryptography')).toBe('insignificant');
    expect(importanceOf('head_spy', 'stealth')).toBe('irreplaceable');
  });

  it('gives every seat a shape rather than a single number', () => {
    for (const role of OFFICER_ROLES) {
      expect(skillsThatMatter(role).length, role).toBeGreaterThanOrEqual(4);
    }
  });

  /**
   * No two chairs are the same chair.
   *
   * Nineteen seats that wanted the same skills would make the assignment screen a formality, and
   * the duplicate would be invisible: both roles would simply score every officer identically.
   */
  it('gives no two seats the same set of demands', () => {
    const seen = new Map<string, string>();
    for (const role of OFFICER_ROLES) {
      const shape = ATTRIBUTE_NAMES.map((name) => importanceOf(role, name)).join('|');
      expect(
        seen.get(shape),
        `${role} wants exactly what ${seen.get(shape)} wants`,
      ).toBeUndefined();
      seen.set(shape, role);
    }
  });

  /** A perfect sheet in a chair scores more than the same sheet in any other. Sanity, end to end. */
  it('scores a specialist highest in the chair they are the specialist for', () => {
    const spy = sheet({ stealth: MAX_ATTRIBUTE, deception: 80, hacking: 80 });
    const best = [...OFFICER_ROLES].sort(
      (a, b) => officerScore(spy, b).total - officerScore(spy, a).total,
    )[0];
    expect(best).toBe('head_spy');
  });
});
