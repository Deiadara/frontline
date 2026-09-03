import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_NAMES, MAX_ATTRIBUTE, type Attributes } from '../attributes.js';
import { OFFICER_ROLES } from '../roles.js';
import {
  ASSIGNABLE_OFFICER_PORTRAIT_IDS,
  DUPLICATE_OFFICER_PORTRAIT_IDS,
  OFFICER_PORTRAIT_IDS,
  officerPortraitId,
  officerPortraits,
} from '../roles.js';
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
    const spy = sheet({ stealth: MAX_ATTRIBUTE, deception: 80, signals: 80 });
    const best = [...OFFICER_ROLES].sort(
      (a, b) => officerScore(spy, b).total - officerScore(spy, a).total,
    )[0];
    expect(best).toBe('head_spy');
  });
});

/**
 * One face each, and the same face every time.
 *
 * Hashing an id on its own is not enough, and the arithmetic is why: forty-three faces against six
 * officers is the birthday problem and collides on about three rosters in ten. That shipped, and it
 * shipped looking exactly like what it was: one woman on two cards.
 */
describe('who wears which face', () => {
  const roster = (size: number, salt = ''): string[] =>
    Array.from({ length: size }, (_, index) => `commander-${salt}-${index}`);

  it('never gives two people on one roster the same face', () => {
    for (let trial = 0; trial < 500; trial += 1) {
      const ids = roster(OFFICER_ROLES.length, String(trial));
      const faces = [...officerPortraits(ids).values()];
      expect(new Set(faces).size, `roster ${trial}`).toBe(ids.length);
    }
  });

  /** The pathological case: a roster as large as the pool has to consume the pool exactly. */
  it('hands out every face when the roster is the size of the pool', () => {
    const ids = roster(ASSIGNABLE_OFFICER_PORTRAIT_IDS.length);
    expect(new Set(officerPortraits(ids).values()).size).toBe(
      ASSIGNABLE_OFFICER_PORTRAIT_IDS.length,
    );
  });

  /**
   * The two faces that are somebody else's face, kept out of every roster.
   *
   * `officer-42` is pixel-identical to `officer-26` and `officer-43` is `officer-33` mirrored, so
   * handing either out puts one person on the crew screen twice under two names.
   *
   * The ids are **written out here as literals**, and that is the point of the test rather than an
   * accident of style. The first version of this asserted against
   * `DUPLICATE_OFFICER_PORTRAIT_IDS`, which is the list under test: emptying that list made the
   * assertion vacuously true and the test stayed green through the exact regression it exists to
   * catch. Measured, not assumed, the mutant was run. An expectation copied from the source agrees
   * with any source, including a wrong one.
   */
  it('never hands out either of the two duplicated faces', () => {
    const everybody = [
      ...officerPortraits(roster(ASSIGNABLE_OFFICER_PORTRAIT_IDS.length)).values(),
    ];
    expect(everybody).not.toContain('42');
    expect(everybody).not.toContain('43');

    const lone = roster(500).map((id) => officerPortraitId(id));
    expect(lone).not.toContain('42');
    expect(lone).not.toContain('43');
  });

  /** The art still describes them, so the board's order sheet does not lose two entries. */
  it('still lists the duplicates as art that exists', () => {
    expect(OFFICER_PORTRAIT_IDS).toContain('42');
    expect(OFFICER_PORTRAIT_IDS).toContain('43');
    expect(OFFICER_PORTRAIT_IDS).toHaveLength(99);
    expect(ASSIGNABLE_OFFICER_PORTRAIT_IDS).toHaveLength(97);
    expect(DUPLICATE_OFFICER_PORTRAIT_IDS).toEqual(['42', '43']);
  });

  it('gives everybody a face from the pool, and nobody two', () => {
    const ids = roster(9);
    const assigned = officerPortraits(ids);
    expect(assigned.size).toBe(ids.length);
    for (const id of ids) expect(OFFICER_PORTRAIT_IDS).toContain(assigned.get(id));
  });

  /**
   * Hiring somebody must not restyle the people already on the books.
   *
   * A crew screen where every face shuffles because one person was hired is worse than duplicates:
   * it says the roster is not a list of people, it is a list of slots.
   */
  it('leaves the faces of everybody already placed alone when one more joins', () => {
    const before = officerPortraits(roster(6));
    const after = officerPortraits([...roster(6), 'commander--99']);
    for (const [id, face] of before) expect(after.get(id), id).toBe(face);
  });

  /**
   * The same promise against real ids, which is where it used to break.
   *
   * `commander--99` sorts after every `commander-N`, so the case above passed while the function
   * assigned in sorted id order and could not fail. Officer ids are UUIDs and a new hire sorts
   * *anywhere*: on a four-chair roster 1.8% of hires moved somebody else's face, and 11.2% at a
   * full nineteen. A newcomer whose id sorts first is the whole of the case, so it is generated
   * here rather than hoped for.
   */
  it('leaves them alone when the newcomer’s id sorts before everybody', () => {
    for (let size = 2; size <= 19; size += 1) {
      const existing = Array.from({ length: size }, () => randomUUID());
      const before = officerPortraits(existing);
      for (let trial = 0; trial < 60; trial += 1) {
        const newcomer = randomUUID();
        const after = officerPortraits([...existing, newcomer]);
        for (const [id, face] of before) {
          expect(after.get(id), `${size} officers, hired ${newcomer}`).toBe(face);
        }
        expect(new Set(after.values()).size).toBe(size + 1);
      }
    }
  });

  /**
   * The property that was traded away, recorded so the next reader knows it was a choice.
   *
   * Assignment now follows the caller's order, because "the incumbent keeps their face" is only
   * expressible as an order and roster order is hire order. A caller that sorts the roster before
   * calling therefore draws different faces from the same crew, and the crew screen and the server
   * compute this independently, so neither may sort.
   */
  it('is a function of the order the roster is handed over in, which is now load-bearing', () => {
    const ids = roster(11);
    const forwards = officerPortraits(ids);
    const backwards = officerPortraits([...ids].reverse());
    // Still every face distinct whichever way round, which is the invariant that never moved.
    expect(new Set(backwards.values()).size).toBe(11);
    expect([...forwards.keys()].every((id) => backwards.has(id))).toBe(true);
  });
});
