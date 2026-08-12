import {
  ATTRIBUTE_NAMES,
  AttributesSchema,
  MAX_RECRUITMENT_ATTRIBUTE,
  TRAIT_IDS,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { generateCharacter } from './generate.js';

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

  // B2: "a bad one ~10".
  it("pushes a character's worst attributes down to about 10", () => {
    const bottomTwo = SAMPLE.map((_, i) => mean(descending(i).slice(-2)));
    expect(mean(bottomTwo)).toBeGreaterThan(8);
    expect(mean(bottomTwo)).toBeLessThan(12);
  });

  // B7: *some* characters carry a trait — not none, and not all of them.
  it('gives a minority of characters a trait', () => {
    const withTrait = SAMPLE.filter((character) => character.traits.length > 0).length;
    expect(withTrait / SAMPLE_SIZE).toBeGreaterThan(0.2);
    expect(withTrait / SAMPLE_SIZE).toBeLessThan(0.5);
  });
});
