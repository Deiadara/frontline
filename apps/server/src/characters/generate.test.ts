import {
  ATTRIBUTE_NAMES,
  AttributesSchema,
  MAX_RECRUITMENT_ATTRIBUTE,
  OFFICER_ROLES,
  TRAIT_IDS,
  type AttributeName,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { ROLE_REQUIREMENTS, roleFit } from '../roles/requirements.js';
import { generateCharacter, rollRecruit } from './generate.js';

/**
 * B2/B2a is a claim about a *distribution*, so it is checked over a large sample rather than by
 * spot-checking one roll. The assertions read off the sheet only — the same three numbers a
 * player would see — never the generator's internal bookkeeping about which attributes it chose
 * to lift, which would be the fit hint B8 forbids.
 */
const SAMPLE_SIZE = 2000;

const SAMPLE = Array.from({ length: SAMPLE_SIZE }, (_, i) => generateCharacter(i));

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sheetOf(index: number): number[] {
  const character = SAMPLE[index];
  if (!character) throw new Error(`no sample at ${index}`);
  return ATTRIBUTE_NAMES.map((name) => character.attributes[name]);
}

const descending = (index: number): number[] => sheetOf(index).sort((a, b) => b - a);

describe('generateCharacter', () => {
  it('is a pure function of its seed', () => {
    expect(generateCharacter(1234)).toEqual(generateCharacter(1234));
    expect(generateCharacter(1234)).not.toEqual(generateCharacter(1235));
  });

  // B6: every human carries every attribute, whatever their role would be.
  it('always produces a complete, valid sheet', () => {
    for (const character of SAMPLE) {
      expect(() => AttributesSchema.parse(character.attributes)).not.toThrow();
      for (const trait of character.traits) expect(TRAIT_IDS).toContain(trait);
    }
  });

  // B2: "average 15-20".
  it("averages inside the board's 15-20 band", () => {
    const perCharacter = SAMPLE.map((_, i) => mean(sheetOf(i)));
    expect(mean(perCharacter)).toBeGreaterThanOrEqual(15);
    expect(mean(perCharacter)).toBeLessThanOrEqual(20);
  });

  // B2a: "no attribute exceeds 40 at recruitment" — a hard ceiling, not a tendency, so this
  // asserts the maximum over every attribute of every sample rather than an average.
  it('never puts a single attribute above 40', () => {
    const highest = Math.max(...SAMPLE.map((_, i) => Math.max(...sheetOf(i))));
    expect(highest).toBeLessThanOrEqual(MAX_RECRUITMENT_ATTRIBUTE);
    // ...and the ceiling is actually approached, so the test would notice a collapsed curve.
    expect(highest).toBeGreaterThan(33);
  });

  // B2: "a good attribute ~30". Every character gets at least MIN_STRENGTHS (3) lifted
  // attributes, so the top three are exactly the ones the board is describing.
  it("lifts a character's best attributes to about 30", () => {
    const topThree = SAMPLE.map((_, i) => mean(descending(i).slice(0, 3)));
    expect(mean(topThree)).toBeGreaterThan(28);
    expect(mean(topThree)).toBeLessThan(32);
  });

  // B2: "a bad one ~10", read off the sheet — the only view a player has.
  //
  // This assertion used to sit at 6-10 with a caveat attached: at a base roll of N(15, 3.5) the
  // *natural* minimum of 34 draws landed near 8, below the injected weakness at 10, so the
  // deliberately-weakened attribute was not the sheet's weak end at all and the B2a push was
  // invisible from outside. At N(18, 2.5) the natural tail sits near 12.5 and the weakness lands
  // ~3 points clear below it, so the lowest rating now *is* the pushed one and the band can be
  // asserted where B2a actually puts it.
  //
  // The count of low ratings stays as the regression signal: it is the statistic that collapses
  // (2.26 -> ~0.5) if the weakness push is ever dropped.
  it('leaves every character a weak end in the low band', () => {
    const lowest = SAMPLE.map((_, i) => descending(i).at(-1) ?? Number.NaN);
    expect(mean(lowest)).toBeGreaterThan(8.5); // measured 9.32
    expect(mean(lowest)).toBeLessThan(11);
    expect(Math.max(...lowest)).toBeLessThanOrEqual(16);

    const lowRatings = SAMPLE.map((_, i) => sheetOf(i).filter((value) => value <= 12).length);
    expect(mean(lowRatings)).toBeGreaterThan(1.5); // measured 2.26
  });

  // B7: *some* characters carry a trait — not none, and not all of them.
  it('gives a minority of characters a trait', () => {
    const withTrait = SAMPLE.filter((character) => character.traits.length > 0).length;
    expect(withTrait / SAMPLE_SIZE).toBeGreaterThan(0.2);
    expect(withTrait / SAMPLE_SIZE).toBeLessThan(0.5);
  });
});

/**
 * B8 — how much of the hidden table a sheet gives away (MOU-160 F1).
 *
 * The attacker model is deliberately generous: assume the player has somehow reconstructed all
 * 19 weight sets, then let them read a sheet. Two things must hold at once, and they pull in
 * opposite directions — which is why both are pinned here. A leak bound on its own is passed
 * perfectly by pure noise, and a roll that told the player nothing would be the worse game.
 *
 *  - **leak** — can they name the affinity *with certainty*? A sheet gives itself away when the
 *    attributes it lifted sit inside exactly one role's template: that role is then the only
 *    answer. Strengths used to be the template's own top-k, so containment was automatic and
 *    ~91% of sheets named their role outright.
 *  - **signal** — is the affinity still genuinely the recruit's best role? It has to be: a
 *    recruit shaped for head_spy really is the best head_spy. The player simply cannot *prove*
 *    it, and cannot compute `roleFit` at all, because the weights never leave the server.
 *    Selling that certainty is what the §B9 research task (W7) is for.
 */
describe('what a sheet gives away about its affinity (B8)', () => {
  const ROLLS = Array.from({ length: SAMPLE_SIZE }, (_, i) => rollRecruit(i));

  const templates = new Map<string, Set<string>>(
    OFFICER_ROLES.map((role) => [role, new Set(Object.keys(ROLE_REQUIREMENTS[role].weights))]),
  );

  /** A sheet's attributes in descending rating, strongest first. */
  function ranked(attributes: Record<AttributeName, number>): [AttributeName, number][] {
    return ATTRIBUTE_NAMES.map((name): [AttributeName, number] => [name, attributes[name]]).sort(
      (a, b) => b[1] - a[1],
    );
  }

  /**
   * Fraction of sheets on which `read` narrows the table to exactly the affinity and nothing
   * else — i.e. the player reads those attributes, finds one role's template contains all of
   * them and no other role's does, and is right.
   */
  function leakRate(read: (sheet: [AttributeName, number][]) => AttributeName[]): number {
    const pinned = ROLLS.filter((roll) => {
      const picked = read(ranked(roll.attributes));
      if (picked.length === 0) return false;
      const candidates = OFFICER_ROLES.filter((role) =>
        picked.every((name) => templates.get(role)?.has(name)),
      );
      return candidates.length === 1 && candidates[0] === roll.affinity;
    });
    return pinned.length / ROLLS.length;
  }

  // The attack a player can actually mount: 24 sits midway between the ~18 base band and the ~30
  // lift, so everything at or above it is visibly a strength. That set never fits a single
  // template now, because 1-2 strengths are drawn from outside the template on purpose.
  it('almost never lets the visible strengths pin down one role', () => {
    const rate = leakRate((sheet) =>
      sheet.filter(([, value]) => value >= 24).map(([name]) => name),
    );
    expect(rate).toBeLessThan(0.1); // measured 0.005
  });

  // The sharper attack, and the one that really bounds the leak: every roll lifts at least three
  // attributes, so the top three are all strengths — no false positives from a lucky base draw to
  // muddy the read, unlike the >= 24 cut above. This is the residual the off-template draw cannot
  // remove: when the off-template strength happens to rank 4th or 5th, the top three are all
  // on-template. It was 91% before this change.
  it('rarely lets even the top three ratings pin down one role', () => {
    const rate = leakRate((sheet) => sheet.slice(0, 3).map(([name]) => name));
    expect(rate).toBeLessThan(0.2); // measured 0.117
  });

  // The other direction: the roll still means something. Rank the affinity among all 19 roles by
  // fit — had de-fingerprinting reduced the sheet to noise, this would sit near 10 of 19.
  it('still leaves the affinity the best-fitting role by a wide margin', () => {
    const ranks = ROLLS.map((roll) => {
      const byFit = OFFICER_ROLES.map(
        (role) => [role, roleFit(roll.attributes, role)] as const,
      ).sort((a, b) => b[1] - a[1]);
      return byFit.findIndex(([role]) => role === roll.affinity) + 1;
    });
    expect(mean(ranks)).toBeLessThan(4); // measured 2.26 of 19

    const bestFit = ranks.filter((rank) => rank === 1).length / ranks.length;
    expect(bestFit).toBeGreaterThan(0.4); // measured 0.61
  });
});
