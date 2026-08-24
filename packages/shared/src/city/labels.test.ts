import { describe, expect, it } from 'vitest';
import { findUnit, type UnitSpec } from '../units/index.js';
import {
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  MAX_LABEL_TIER,
  amplify,
  envLabel,
  frontageFactor,
  labelEffectPercent,
  labelText,
  labelVerdict,
  mergeLabels,
  tierNumeral,
  tierOf,
} from './labels.js';

/**
 * Environment labels (§A4) — the keywords that decide which units are worth bringing where.
 *
 * What is measured here is the *shape* of the system rather than any one number: that a tier is a
 * multiplier and not a lookup, that two sources of a label do not stack into a fifth tier, that
 * immunity means immunity, and that the four units the design leans on actually behave the way
 * their sheets and affinities claim. The individual percentages are content and will be retuned;
 * these properties are the contract that retuning has to keep.
 */

const unit = (id: string): UnitSpec => {
  const found = findUnit(id);
  if (!found) throw new Error(`no unit ${id}`);
  return found;
};

/** What a label is worth to a unit right now, as the engine would read it. */
const worth = (id: string, label: Parameters<typeof labelText>[0]): number =>
  labelEffectPercent(unit(id).stats, unit(id), label);

describe('environment labels', () => {
  it('names, describes and colours every label', () => {
    for (const id of ENV_LABEL_IDS) {
      const spec = ENV_LABEL_CATALOG[id];
      expect(spec.id, id).toBe(id);
      expect(spec.name.length, id).toBeGreaterThan(2);
      expect(spec.description.length, id).toBeGreaterThan(20);
      expect(spec.bites.length, id).toBeGreaterThan(20);
      // A rule that reads the same at both ends is a label that does nothing to anybody.
      expect(spec.rule.atLow, id).not.toBe(spec.rule.atHigh);
    }
  });

  it('writes a tier in Latin numerals and clamps to the four the scale has', () => {
    expect(tierNumeral(1)).toBe('I');
    expect(tierNumeral(4)).toBe('IV');
    expect(tierNumeral(0)).toBe('I');
    expect(tierNumeral(9)).toBe('IV');
    expect(labelText(envLabel('toxic', 2))).toBe('Toxic II');
    expect(envLabel('toxic', 11).tier).toBe(MAX_LABEL_TIER);
  });

  /** The whole reason tiers exist: Toxic II is exactly twice Toxic I, and nobody has to look up why. */
  it('makes a tier a multiplier rather than a second lookup', () => {
    const one = worth('razors', envLabel('toxic', 1));
    const three = worth('razors', envLabel('toxic', 3));
    expect(three).toBeCloseTo(one * 3, 5);
  });

  it('takes the strongest of two sources rather than summing them', () => {
    const merged = mergeLabels([envLabel('wet', 3)], [envLabel('wet', 1), envLabel('cold', 2)]);
    expect(tierOf(merged, 'wet')).toBe(3);
    expect(tierOf(merged, 'cold')).toBe(2);
    expect(tierOf(merged, 'toxic')).toBe(0);
  });

  it('draws labels in catalogue order however they arrived', () => {
    const merged = mergeLabels([envLabel('windy', 1)], [envLabel('crammed', 1)]);
    expect(merged.map((label) => label.id)).toEqual(['crammed', 'windy']);
  });

  it('raises a whole set by a step, and never past the ceiling', () => {
    const raised = amplify([envLabel('dark', 2), envLabel('eerie', 4)], 1);
    expect(raised).toEqual([envLabel('dark', 3), envLabel('eerie', 4)]);
  });
});

describe('what a label is worth to a unit', () => {
  /**
   * Heat is armour's problem and nobody else's.
   *
   * The stat-driven baseline in one assertion: the Colossus wears 95 points of plate and the
   * Razors wear 5, and neither of them has a hand-written row for `hot`.
   */
  it('reads the unit’s own sheet rather than a per-unit table', () => {
    // Neither has a hand-written `hot` row; the whole difference is 95 points of plate against 5.
    expect(worth('the_colossus', envLabel('hot', 2))).toBeLessThan(-15);
    expect(Math.abs(worth('razors', envLabel('hot', 2)))).toBeLessThan(2);
  });

  it('bites the lightly dressed in the cold and leaves the armoured alone', () => {
    expect(worth('razors', envLabel('cold', 2))).toBeLessThan(-10);
    expect(worth('juggernauts', envLabel('cold', 2))).toBeGreaterThan(
      worth('razors', envLabel('cold', 2)),
    );
  });

  it('bogs down bad mobility in the wet and barely touches the quick', () => {
    expect(worth('juggernauts', envLabel('wet', 2))).toBeLessThan(
      worth('cyber_dogs', envLabel('wet', 2)),
    );
  });

  /** §A5 — the Abomination breathes it. Immunity is a fact, not a coincidence of its armour value. */
  it('means immune when it says immune', () => {
    expect(worth('the_abomination', envLabel('toxic', 4))).toBe(0);
    expect(worth('the_abomination', envLabel('eerie', 4))).toBeGreaterThanOrEqual(0);
    // And the unarmoured, who have no such arrangement, suffer for it.
    expect(worth('razors', envLabel('toxic', 4))).toBeLessThan(-30);
  });

  it('lets a chem suit be better without being immune', () => {
    const suited = worth('ash_walkers', envLabel('toxic', 3));
    const abomination = worth('the_abomination', envLabel('toxic', 3));
    const bare = worth('razors', envLabel('toxic', 3));
    expect(suited).toBe(0);
    expect(abomination).toBe(0);
    expect(bare).toBeLessThan(suited);
  });
});

/**
 * The Anodics (§A5) — the unit whose identity *is* a pair of labels.
 *
 * The board's brief was "cheap, tanky all-rounder, better in close spaces, fights better when
 * there is noise". Three of those are on the sheet and the suite can read them; the fourth is not
 * expressible as a stat at all, which is what `affinities` is for. These four assertions are the
 * brief, restated as measurements.
 */
describe('the Anodics', () => {
  const anodics = unit('anodics');
  const razors = unit('razors');

  it('is cheap and tanky, which is a combination nothing else in rabble has', () => {
    expect(anodics.tier).toBe('rabble');
    expect(anodics.cost.caps ?? 0).toBeLessThan(100);
    expect(anodics.stats.vitality).toBeGreaterThan(razors.stats.vitality * 1.5);
  });

  it('fights better the louder it gets, and better the tighter it gets', () => {
    expect(worth('anodics', envLabel('noisy', 2))).toBeGreaterThan(20);
    expect(worth('anodics', envLabel('crammed', 2))).toBeGreaterThan(20);
  });

  it('pays for it in the open', () => {
    expect(worth('anodics', envLabel('open', 2))).toBeLessThan(-15);
  });

  /** A press hall at four in the morning: the ground they were designed for. */
  it('is worth bringing to a loud, tight, frightening room', () => {
    const pressHall = [envLabel('noisy', 3), envLabel('crammed', 2), envLabel('eerie', 2)];
    const verdict = labelVerdict(anodics.stats, anodics, pressHall);
    expect(verdict.percent).toBeGreaterThan(50);
    expect(verdict.reasons[0]).toContain('Noisy III');
    // And the same room is a bad afternoon for somebody who wanted a sightline.
    expect(labelVerdict(unit('snipers').stats, unit('snipers'), pressHall).percent).toBeLessThan(0);
  });
});

describe('a verdict over several labels', () => {
  it('sums them and names the ones that moved anything, strongest first', () => {
    const verdict = labelVerdict(unit('razors').stats, unit('razors'), [
      envLabel('toxic', 3),
      envLabel('crammed', 1),
    ]);
    expect(verdict.reasons).toHaveLength(2);
    expect(verdict.reasons[0]).toContain('Toxic III');
    expect(verdict.percent).toBeCloseTo(
      worth('razors', envLabel('toxic', 3)) + worth('razors', envLabel('crammed', 1)),
      5,
    );
  });

  it('says nothing about a label that changed nothing worth reading', () => {
    // Razors carry 5 armour, so `hot` is worth a fraction of a point and is not worth a chip.
    expect(
      labelVerdict(unit('razors').stats, unit('razors'), [envLabel('hot', 1)]).reasons,
    ).toHaveLength(0);
  });
});

describe('how much of a force fits', () => {
  it('narrows with Crammed and widens with Open', () => {
    expect(frontageFactor([envLabel('crammed', 3)])).toBeLessThan(1);
    expect(frontageFactor([envLabel('open', 3)])).toBeGreaterThan(1);
    expect(frontageFactor([])).toBe(1);
  });

  it('never closes the ground entirely, however tight it is', () => {
    expect(frontageFactor([envLabel('crammed', MAX_LABEL_TIER)])).toBeGreaterThan(0);
  });
});
