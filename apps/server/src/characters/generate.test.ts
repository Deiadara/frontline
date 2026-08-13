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

  // B2: "a bad one ~10", read off the sheet — the only view a player has. This assertion can sit
  // where B2a actually puts the weakness only because the base band was re-centred to keep the
  // natural tail clear of it; the measurements behind that are on `BASE_MEAN` in `generate.ts`.
  //
  // The count of low ratings stays as the regression signal: it is the statistic that collapses
  // (2.28 -> ~0.5) if the weakness push is ever dropped.
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
  // Larger than the B2 sample: the load-bearing assertion here is a rate per 20-recruit roster,
  // so it needs enough rolls to make a meaningful number of rosters (3000 = 150 of them).
  const LEAK_SAMPLE_SIZE = 3000;
  const ROSTER_SIZE = 20;
  const ROLLS = Array.from({ length: LEAK_SAMPLE_SIZE }, (_, i) => rollRecruit(i));

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
   * What a player can actually see as "this recruit is strong here": 24 sits midway between the
   * ~18 base band and the ~30 lift, which makes it a near-perfect classifier between the two —
   * a base draw reaches it only on a long tail, and a lift falls short of it about as rarely.
   */
  function strongSet(attributes: Record<AttributeName, number>): Set<string> {
    return new Set(
      ranked(attributes)
        .filter(([, value]) => value >= 24)
        .map(([name]) => name),
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

  // The attack a player can actually mount, read off the visible strengths. That set no longer
  // fits inside a single template, because one strength is drawn from outside it on purpose.
  it('almost never lets the visible strengths pin down one role', () => {
    const rate = leakRate((sheet) =>
      sheet.filter(([, value]) => value >= 24).map(([name]) => name),
    );
    expect(rate).toBeLessThan(0.1); // measured 0.002
  });

  /**
   * The load-bearing assertion — the one MOU-184 filed this bug on.
   *
   * A player does not study one sheet; they read a roster. So the unit is a 20-recruit window,
   * and the question is how many sheets in it hand over a role's *complete* template — every one
   * of its five attributes visibly strong at once, which is the table row itself, verbatim.
   * Before the off-template draw this was **6.5 rows per roster, worst case 17 of 20**: the Bar
   * reconstructed the hidden table for free, and §B9's research task (W7) had nothing left to
   * sell. It is now 0.17, worst case 2 of 150 rosters.
   *
   * A hard zero is the wrong bar — it flakes, because a roll can legitimately land all five by
   * chance — so this is a rate, well under the ~1-per-roster that would put a row back in front
   * of the player every time they refresh.
   */
  it('does not hand a whole role template to a 20-recruit roster', () => {
    const verbatim = ROLLS.map((roll) => {
      const strong = strongSet(roll.attributes);
      return OFFICER_ROLES.some((role) =>
        [...(templates.get(role) ?? [])].every((name) => strong.has(name)),
      );
    });

    const rosters: number[] = [];
    for (let i = 0; i + ROSTER_SIZE <= verbatim.length; i += ROSTER_SIZE) {
      rosters.push(verbatim.slice(i, i + ROSTER_SIZE).filter(Boolean).length);
    }

    expect(rosters).toHaveLength(LEAK_SAMPLE_SIZE / ROSTER_SIZE);
    expect(mean(rosters)).toBeLessThan(0.5); // measured 0.167; 6.5 before the off-template draw
  });

  /**
   * The sharper read: every roll lifts at least three attributes, so the top three are all
   * strengths — no false positives from a lucky base draw, unlike the >= 24 cut above. This is
   * the residual the off-template draw cannot remove, since when the off-template strength ranks
   * 4th or 5th the top three are all on-template. It was 91% before the change.
   *
   * Note what this number is and is not. It presupposes an attacker who *already holds all 19
   * weight sets* — someone who has bought what W7 sells. So it bounds how **legible** a sheet is
   * to a fully-informed reader, not how **secret** the table is, and it is strictly weaker than
   * what that reader can already do: the assertion below says the affinity is the outright
   * best-fitting role 76% of the time, so "certain on 19%" is subsumed by "right on 76%". Driving
   * this number down and driving that one down are the same knob turned the same way — which is
   * why it is bounded loosely here rather than minimised.
   */
  it('rarely lets even the top three ratings pin down one role', () => {
    const rate = leakRate((sheet) => sheet.slice(0, 3).map(([name]) => name));
    expect(rate).toBeLessThan(0.25); // measured 0.194
  });

  // Every floor below is a mean over the whole sample, and a minority of affinity-free rolls
  // averages away inside them: raising the off-template count to 3 takes the share of sheets
  // whose top three carry nothing from the template 0% -> 14% while mean rank (3.67, floor 4)
  // and best-fit share (0.47) stay green under their old floors — and the leak rate *improves*,
  // so a tuning run would read that as a win. This is the per-roll reading that sees it: the
  // affinity has to reach the sheet on nearly every roll, not on average. (`generate.ts` now
  // rejects that count at import; this gate is what makes the cap earn its place, and would also
  // catch the same degeneracy arriving by another route.)
  it('leaves almost every individual sheet at least one on-template strength', () => {
    const shaped = ROLLS.filter((roll) =>
      ranked(roll.attributes)
        .slice(0, 3)
        .some(([name]) => templates.get(roll.affinity)?.has(name)),
    ).length;
    expect(shaped / ROLLS.length).toBeGreaterThan(0.95); // measured 1.000; 0.860 at 3 off-template
  });

  /**
   * The other direction, and the reason the leak bounds above are bounds rather than targets: the
   * roll still has to *mean* something. A recruit shaped for head_spy really is the best head_spy
   * on the roster; the player simply cannot prove it. Had de-fingerprinting reduced the sheet to
   * noise, mean rank would sit near 10 of 19 and every assertion above would still pass.
   *
   * This is the assertion that fails if someone later "hardens" the generator into mush.
   */
  it('still leaves the affinity the best-fitting role by a wide margin', () => {
    const ranks = ROLLS.map((roll) => {
      const byFit = OFFICER_ROLES.map(
        (role) => [role, roleFit(roll.attributes, role)] as const,
      ).sort((a, b) => b[1] - a[1]);
      return byFit.findIndex(([role]) => role === roll.affinity) + 1;
    });

    const bestFit = ranks.filter((rank) => rank === 1).length / ranks.length;
    expect(bestFit).toBeGreaterThan(0.7); // measured 0.756

    const topThree = ranks.filter((rank) => rank <= 3).length / ranks.length;
    expect(topThree).toBeGreaterThan(0.9); // measured 0.952

    expect(mean(ranks)).toBeLessThan(2); // measured 1.48 of 19
  });
});
