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
  IMPORTANCE_TIER,
  SEAT_WEIGHT,
  describeImportance,
  TIER_SHORTFALL_RATIO,
  importanceOf,
  seatPoints,
  skillsThatMatter,
  tierValue,
  type AttributeImportance,
} from './importance.js';
import { markFromPoints } from './marks.js';

const sheet = (over: Partial<Attributes> = {}): Attributes =>
  ({ ...Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, 0])), ...over }) as Attributes;

/**
 * The scoring rule, pinned to the maintainer's own worked examples.
 *
 * Both of them are transcribed rather than paraphrased, because a scoring table is the kind of
 * thing a test can agree with while being wrong: any monotonic function of the sheet passes "more
 * is better", and the whole content of this design is *which* number comes out.
 */
describe('how much a skill matters, and the bands a job pays', () => {
  it('weights a point by how much the seat cares about the skill', () => {
    expect(IMPORTANCE_WEIGHT).toEqual({
      insignificant: 1,
      useful: 2,
      essential: 3,
      irreplaceable: 4,
    });
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

/**
 * The seat's points (maintainer, 2026-09-30): "the best strategy is to have them in tiers, e.g. if
 * tiers are 25, 50 and 75, to have the irreplaceable above 75, the essential above 50 and the
 * useful above 25 and the rest wherever. [...] Still don't delete the fact that insignificant
 * attributes still contribute to the overall."
 */
describe('the seat and its tiers', () => {
  const TAGGED: readonly AttributeImportance[] = ['useful', 'essential', 'irreplaceable'];

  it('wants the irreplaceable skill at 75, the essentials at 50 and the useful ones at 25', () => {
    expect(IMPORTANCE_TIER).toEqual({
      insignificant: 0,
      useful: 25,
      essential: 50,
      irreplaceable: 75,
    });
  });

  it('keeps every skill on the 0 to 100 scale, continuous through its tier', () => {
    for (const importance of [...TAGGED, 'insignificant'] as const) {
      expect(tierValue(0, importance)).toBe(0);
      expect(tierValue(100, importance)).toBeCloseTo(100, 10);
      const tier = IMPORTANCE_TIER[importance];
      expect(tierValue(tier + 1e-9, importance)).toBeCloseTo(tierValue(tier, importance), 6);
    }
    expect(tierValue(37, 'insignificant')).toBe(37);
  });

  /** "A penalty applied when stats are left behind": a point short is worth more than one past. */
  it('prices a point short of the tier at 2.5 times a point past it', () => {
    for (const importance of TAGGED) {
      const tier = IMPORTANCE_TIER[importance];
      const short = tierValue(tier, importance) - tierValue(tier - 1, importance);
      const past = tierValue(tier + 1, importance) - tierValue(tier, importance);
      expect(short / past, importance).toBeCloseTo(TIER_SHORTFALL_RATIO, 10);
    }
  });

  /**
   * The whole ruling in one inequality, per seat: the cheapest point that brings a tagged skill up
   * to its tier is worth more to the seat than the dearest point past any tier. Read off the
   * curve's own slopes, so a retune of the tiers, the ratio or the weights that breaks the order
   * fails here before any search is run.
   */
  it('makes every shortfall worth more than every surplus, in every seat', () => {
    const slope = (importance: AttributeImportance, at: number) =>
      SEAT_WEIGHT[importance] * (tierValue(at + 1, importance) - tierValue(at, importance));
    const cheapestShort = Math.min(
      ...TAGGED.map((importance) => slope(importance, IMPORTANCE_TIER[importance] - 1)),
    );
    const dearestPast = Math.max(
      ...TAGGED.map((importance) => slope(importance, IMPORTANCE_TIER[importance])),
    );
    expect(cheapestShort).toBeGreaterThan(dearestPast * 1.5);
    // An untagged skill still pays, and less than any point a tag wants.
    expect(slope('insignificant', 50)).toBeGreaterThan(0);
    expect(slope('insignificant', 50)).toBeLessThan(dearestPast);
  });

  it('reads an empty sheet as nothing and a perfect one as a hundred, in every seat', () => {
    for (const role of OFFICER_ROLES) {
      expect(seatPoints(sheet(), role)).toBe(0);
      expect(
        seatPoints(sheet(Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, 100]))), role),
      ).toBeCloseTo(100, 10);
    }
  });

  it('still counts a skill the seat does not tag, and counts it for less', () => {
    const base = sheet(Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, 30])));
    const untagged = seatPoints({ ...base, strength: 40 }, 'master_of_whispers');
    const useful = seatPoints({ ...base, logic: 40 }, 'master_of_whispers');
    expect(untagged).toBeGreaterThan(seatPoints(base, 'master_of_whispers'));
    expect(useful).toBeGreaterThan(untagged);
  });

  /**
   * The maintainer's example, on a Master of Whispers with 190 points to spend over a floor of 10.
   * In tiers: Stealth 75, Deception and Signals 50, Logic, Intuition and Cryptography 25. Peaked:
   * Stealth 100 and the rest of the tags left behind.
   */
  it('grades the tiered sheet above the peaked one for the same points', () => {
    const floor = Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, 10]));
    const tiered = sheet({
      ...floor,
      stealth: 75,
      deception: 50,
      signals: 50,
      logic: 25,
      intuition: 25,
      cryptography: 25,
    });
    const peaked = sheet({
      ...floor,
      stealth: 100,
      deception: 35,
      signals: 35,
      logic: 27,
      intuition: 27,
      cryptography: 26,
    });
    const spent = (a: Attributes) => ATTRIBUTE_NAMES.reduce((t, n) => t + a[n] - 10, 0);
    expect(spent(tiered)).toBe(spent(peaked));
    expect(seatPoints(tiered, 'master_of_whispers')).toBeGreaterThan(
      seatPoints(peaked, 'master_of_whispers') + 3,
    );
    expect(markFromPoints(seatPoints(tiered, 'master_of_whispers'))).toBe('D+');
    expect(markFromPoints(seatPoints(peaked, 'master_of_whispers'))).toBe('D');
  });

  /**
   * The optimiser the ruling asks for, over every seat and five budgets: no allocation found by a
   * seeded random search beats filling the tiers first, and filling the tiers strictly beats both
   * single-skill focus and spreading the points flat over the tags.
   */
  it('finds no allocation of a fixed budget that beats filling the tiers first', () => {
    const FLOOR = 10;
    let seed = 0x5eed;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const fillInOrder = (
      steps: readonly (readonly [readonly string[], number])[],
      budget: number,
    ) => {
      const out = sheet(Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, FLOOR])));
      let left = budget;
      for (const [names, to] of steps) {
        for (const name of names) {
          const key = name as keyof Attributes;
          const add = Math.max(0, Math.min(left, to - out[key]));
          out[key] += add;
          left -= add;
        }
      }
      return out;
    };
    for (const role of OFFICER_ROLES) {
      const of = (importance: AttributeImportance) =>
        ATTRIBUTE_NAMES.filter((name) => importanceOf(role, name) === importance);
      const [irr, ess, use] = [of('irreplaceable'), of('essential'), of('useful')];
      const tagged = [...irr, ...ess, ...use];
      for (const budget of [120, 200, 250, 320, 450]) {
        const tiered = seatPoints(
          fillInOrder(
            [
              [irr, 75],
              [ess, 50],
              [use, 25],
              [irr, 100],
              [ess, 100],
              [use, 100],
            ],
            budget,
          ),
          role,
        );
        const focused = seatPoints(
          fillInOrder(
            [
              [irr, 100],
              [ess, 100],
              [use, 100],
            ],
            budget,
          ),
          role,
        );
        const flat = seatPoints(
          sheet({
            ...Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, FLOOR])),
            ...Object.fromEntries(tagged.map((n) => [n, FLOOR + budget / tagged.length])),
          }),
          role,
        );
        expect(tiered, `${role} at ${budget}: focus`).toBeGreaterThan(focused);
        expect(tiered, `${role} at ${budget}: flat`).toBeGreaterThan(flat);
        for (let trial = 0; trial < 60; trial++) {
          const out = sheet(Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, FLOOR])));
          let left = budget;
          while (left > 0) {
            const pool = random() < 0.85 ? tagged : ATTRIBUTE_NAMES;
            const name = pool[Math.floor(random() * pool.length)] as keyof Attributes;
            const add = Math.min(left, 1 + Math.floor(random() * 15), 100 - out[name]);
            out[name] += add;
            left -= add;
          }
          expect(seatPoints(out, role), `${role} at ${budget}, trial ${trial}`).toBeLessThanOrEqual(
            tiered + 1e-9,
          );
        }
      }
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
    expect(importanceOf('master_of_whispers', 'stealth')).toBe('irreplaceable');
  });

  it('gives every seat a shape rather than a single number', () => {
    for (const role of OFFICER_ROLES) {
      expect(skillsThatMatter(role).length, role).toBeGreaterThanOrEqual(4);
    }
  });

  /**
   * No two chairs are the same chair.
   *
   * Thirteen seats that wanted the same skills would make the assignment screen a formality, and
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
    const best = [...OFFICER_ROLES].sort((a, b) => seatPoints(spy, b) - seatPoints(spy, a))[0];
    expect(best).toBe('master_of_whispers');
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

  /** The art still describes them, so the maintainer's order sheet does not lose two entries. */
  it('still lists the duplicates as art that exists', () => {
    expect(OFFICER_PORTRAIT_IDS).toContain('42');
    expect(OFFICER_PORTRAIT_IDS).toContain('43');
    // Twenty-five faces added by the board on 2026-09-15, on top of the forty from 2026-09-11.
    // The assignable pool is 162 and is no longer prime, so the probe in `officerPortraits` can
    // draw a stride that walks a subset: the linear sweep at the end of it is what covers that.
    expect(OFFICER_PORTRAIT_IDS).toHaveLength(164);
    expect(ASSIGNABLE_OFFICER_PORTRAIT_IDS).toHaveLength(162);
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
   * *anywhere*: on a four-chair roster 1.8% of hires moved somebody else's face, and 11.2% at
   * what was then a full nineteen (measured 2026-09, before the chairs went to thirteen). A newcomer whose id sorts first is the whole of the case, so it is generated
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

/**
 * The tag's hover says what the tag does (wiring audit, 2026-10-01): the target and the shortfall
 * rule. It also said how much of the skill reached the crew's sheet, until skills stopped reaching
 * the crew except through a chair's grade (2026-10-04).
 */
describe("what a tag's hover promises", () => {
  it('says nothing about a share reaching the crew any more', () => {
    for (const importance of ['insignificant', 'useful', 'essential', 'irreplaceable'] as const) {
      expect(describeImportance(importance)).not.toMatch(/reaches the crew/);
    }
  });

  it.each(['useful', 'essential', 'irreplaceable'] as const)(
    '%s names its tier, and a point short of it does cost more than a point past it earns',
    (importance) => {
      const tier = IMPORTANCE_TIER[importance];
      expect(describeImportance(importance)).toContain(`wants it at ${tier} or better`);
      expect(describeImportance(importance)).toContain('costs the grade more');
      const short = tierValue(tier, importance) - tierValue(tier - 1, importance);
      const past = tierValue(tier + 1, importance) - tierValue(tier, importance);
      expect(short).toBeGreaterThan(past);
    },
  );
});
