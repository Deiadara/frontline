import {
  ATTRIBUTE_NAMES,
  AttributesSchema,
  MAX_RECRUITMENT_ATTRIBUTE,
  OFFICER_ROLES,
  TRAIT_IDS,
  type AttributeName,
  type OfficerRole,
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

  /** The rating at which a player reads an attribute as "this recruit is strong here". */
  const STRONG_CUTOFF = 24;

  /** A sheet's attributes in descending rating, strongest first. */
  function ranked(attributes: Record<AttributeName, number>): [AttributeName, number][] {
    return ATTRIBUTE_NAMES.map((name): [AttributeName, number] => [name, attributes[name]]).sort(
      (a, b) => b[1] - a[1],
    );
  }

  /**
   * What a player can actually see as "this recruit is strong here": the cutoff sits midway
   * between the ~18 base band and the ~30 lift, so it separates them well — but not symmetrically.
   * Measured over 3000 rolls: a non-lifted attribute reaches it 2.45% of the time, while a lift
   * falls short of it 0.52% of the time. Per attribute that is 4.7x; per *sheet* it is 0.73
   * spurious strengths against 0.02 missed lifts (~35x), because a sheet has ~29 non-lifted
   * attributes and only 3-5 lifts — 738 of 3000 sheets show six or more "strong" attributes when
   * at most five were ever lifted.
   *
   * The skew only ever *enlarges* the strong set, which can only make whole-template containment
   * easier to claim, so every leak number below over-states the real leak. Conservative in the
   * direction that matters, but do not read the set as the lifted set.
   */
  function strongSet(attributes: Record<AttributeName, number>): Set<string> {
    return new Set(
      ranked(attributes)
        .filter(([, value]) => value >= STRONG_CUTOFF)
        .map(([name]) => name),
    );
  }

  /** The affinity's lowest-weighted template attribute — the one an ordered take never reaches. */
  function lightestTemplateAttribute(role: OfficerRole): AttributeName {
    const entries = Object.entries(ROLE_REQUIREMENTS[role].weights) as [AttributeName, number][];
    const lightest = entries.sort((a, b) => a[1] - b[1])[0];
    if (!lightest) throw new Error(`role ${role} has an empty template`);
    return lightest[0];
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
      sheet.filter(([, value]) => value >= STRONG_CUTOFF).map(([name]) => name),
    );
    expect(rate).toBeLessThan(0.1); // measured 0.002
  });

  /**
   * The load-bearing assertion — the one MOU-184 filed this bug on.
   *
   * A player does not study one sheet; they read a roster. So the unit is a 20-recruit window,
   * and the question is how many sheets in it hand over a role's *complete* template — every one
   * of its five attributes visibly strong at once, which is the table row itself, verbatim.
   * Before the off-template draw this was **6.89 rows per roster**: the Bar reconstructed the
   * hidden table for free, and §B9's research task (W7) had nothing left to sell. It is now 0.167
   * — 25 sheets of 3000, landing in 23 of the 150 rosters, at most 2 in any one of them.
   *
   * That 2 is a sample maximum, not a bound: at 20k rolls the worst window is still 2 under these
   * seeds but 3 under other seedings. A hard zero would not *flake* — the sample is
   * `rollRecruit(0..2999)`, fully deterministic — it would simply fail today, and it would be the
   * wrong bar anyway: a roll can legitimately land all five by chance, so pinning zero would make
   * any later change to the seeds or the base band a false alarm. Hence a rate, well under the
   * ~1-per-roster that would put a row back in front of the player every time they refresh.
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

  // A per-roll reading rather than a mean: the affinity has to reach the sheet on nearly every
  // roll, not on average, because a minority of affinity-free rolls averages away inside every
  // other floor here. Be honest about what it currently catches — at the highest *legal*
  // off-template count (2) it reads 0.984 and passes, while best-fit reads 0.444 and fails its
  // own floor, so this gate is redundant today. It earns its place as the backstop for the
  // import guard in `generate.ts`: at 3 off-template, where a roll can lift nothing on-template
  // at all, it collapses to 0.549 — and the leak rate *improves* (0.007 rows/roster), so a
  // tuning run reading leak numbers alone would call that a win.
  it('leaves almost every individual sheet at least one on-template strength', () => {
    const shaped = ROLLS.filter((roll) =>
      ranked(roll.attributes)
        .slice(0, 3)
        .some(([name]) => templates.get(roll.affinity)?.has(name)),
    ).length;
    expect(shaped / ROLLS.length).toBeGreaterThan(0.95); // measured 1.000; 0.549 at 3 off-template
  });

  /**
   * The other direction, and the reason the leak bounds above are bounds rather than targets: the
   * roll still has to *mean* something. A recruit shaped for head_spy really is the best head_spy
   * on the roster; the player simply cannot prove it. Had de-fingerprinting reduced the sheet to
   * noise, mean rank would sit near 10 of 19 and every assertion above would still pass.
   *
   * This is the assertion that fails if someone later "hardens" the generator into mush — and,
   * via the upper bound, the one that fails if the sheet is ever made *more* legible than the
   * design allows. Every other bound in this block is one-sided; a floor alone is passed by
   * construction by any change that increases legibility, which is how the whole B8 defect got in.
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
    expect(bestFit).toBeLessThan(0.85); // 0.928 if the on-template draw is ever taken in order

    const topThree = ranks.filter((rank) => rank <= 3).length / ranks.length;
    expect(topThree).toBeGreaterThan(0.9); // measured 0.952

    expect(mean(ranks)).toBeLessThan(2); // measured 1.48 of 19
  });

  /**
   * The direct witness for the second half of the de-fingerprinting, which the bounds above only
   * catch by proxy. A strength is not just "one attribute from outside the template" — the rest
   * are *drawn* over the weights rather than taken in order, so the affinity's lightest template
   * member reaches the sheet sometimes instead of never.
   *
   * Take the on-template draw in order instead and every assertion above except the best-fit
   * ceiling still passes, while this number goes 0.355 -> 0.023: the two heaviest members would
   * then co-occur on every single sheet of that affinity and the lightest on none, which is a
   * rigid signature to reconstruct the table from — exactly what the co-strength attack behind
   * W7 looks for, and the reason a per-sheet leak bound alone is not enough.
   */
  it("keeps the affinity's lightest template attribute in play", () => {
    const reached = ROLLS.filter((roll) =>
      strongSet(roll.attributes).has(lightestTemplateAttribute(roll.affinity)),
    ).length;
    expect(reached / ROLLS.length).toBeGreaterThan(0.2); // measured 0.355; 0.023 taken in order
  });
});
