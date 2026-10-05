import { describe, expect, it } from 'vitest';
import {
  MODIFICATIONS,
  PLAYER_UNITS,
  describeAddonEffect,
  fitsIn,
  MUSTER_SPEED_CEILING,
  MUSTER_SPEED_KNEE,
  MAX_MUSTER_DISCOUNT,
  MODIFICATION_RARITY_BANDS,
  MODIFICATION_REQUIREMENT_BANDS,
  SCRAPYARD_LEVEL_FOR_RARITY,
  scrapyardLevelForModification,
  SUPPLIES_LINE_CEILING,
  modificationRequirement,
  suppliesLineCut,
  suppliesOnlyCut,
  musterCost,
  musterSecondsFor,
  musterSpeedAfterTaper,
  musterSuppliesReduction,
} from '../index.js';

/**
 * The muster bench's two ceilings, replaced by tapers (maintainer ruling, 2026-10-01, bugs B3).
 *
 * The speed stopped at 60 and the supplies cut at 40, so a crew past either was sold cards that
 * paid nothing. Now each pays in full to a knee and then less for every point, closing on a
 * ceiling it never reaches. What is pinned: ordinary figures do not move, the old stops barely
 * move, and a point past the old stop is still worth something on the clock and on the bill.
 */

const one = (value: number): number => Math.round(value * 10) / 10;

describe('the muster speed taper', () => {
  it('pays in full up to the knee', () => {
    for (const speed of [0, 20, 40, MUSTER_SPEED_KNEE]) {
      expect(musterSpeedAfterTaper(speed), String(speed)).toBe(speed);
    }
    expect(musterSpeedAfterTaper(-10), 'a raid never makes the bench slower than bare').toBe(0);
  });

  it('bends past the knee, close to the old stop and short of the ceiling', () => {
    expect(one(musterSpeedAfterTaper(60))).toBe(59.5);
    expect(one(musterSpeedAfterTaper(80))).toBe(70.8);
    expect(one(musterSpeedAfterTaper(110))).toBe(77.2);
    expect(musterSpeedAfterTaper(200)).toBeLessThan(MUSTER_SPEED_CEILING);
  });

  it('keeps paying for every point past the old stop of 60', () => {
    let previous = musterSpeedAfterTaper(60);
    for (let speed = 61; speed <= 200; speed += 1) {
      const next = musterSpeedAfterTaper(speed);
      expect(next, String(speed)).toBeGreaterThan(previous);
      previous = next;
    }
  });

  it('is what the clock divides by', () => {
    const slowest = [...PLAYER_UNITS].sort((a, b) => b.musterSeconds - a.musterSeconds)[0]!;
    // Under the knee the clock is the plain divisor, as it was.
    expect(musterSecondsFor(slowest, 1, 40)).toBe(Math.round(slowest.musterSeconds / 1.4));
    // Positive control: past the old stop the clock still moves. Under a hard 60 these were equal.
    expect(musterSecondsFor(slowest, 1, 90)).toBeLessThan(musterSecondsFor(slowest, 1, 60));
    expect(musterSecondsFor(slowest, 1, 90)).toBe(
      Math.round(slowest.musterSeconds / (1 + musterSpeedAfterTaper(90) / 100)),
    );
  });
});

/**
 * The supplies line (maintainer, 2026-10-01): "go up to about 70% off and generally nerf the supply
 * reduction bonuses so that it's hard to get there and a mid game crew is expected to have reduced
 * it by about 20%". The general cut and the supplies-only cut ride one taper toward 70, with the
 * general cut as its knee, so the general cut is never what pays less.
 */
describe('the supplies line of a muster bill', () => {
  it('takes the general cut in full, as every other line does', () => {
    for (const general of [0, 13, 30, MAX_MUSTER_DISCOUNT]) {
      expect(suppliesLineCut(general, 0), String(general)).toBe(general);
    }
    // The general cut's own floor price still holds on this line.
    expect(suppliesLineCut(80, 0)).toBe(MAX_MUSTER_DISCOUNT);
  });

  it('lands the crews the ruling names where it asked', () => {
    // A typical mid-game crew: general 9, a Greenhouse 10 (5) and Mess Rota (4); and the strong
    // one built for cheap supplies, general 20.6 and 13 points.
    expect(one(suppliesLineCut(9, 9))).toBe(17.4);
    expect(one(suppliesLineCut(20.55, 13))).toBe(32);
    expect(one(suppliesLineCut(4, 2))).toBe(6);
    expect(one(suppliesLineCut(28.9, 28))).toBe(49.2);
    // The deepest stack: half price already, a Greenhouse 20 and the district's card ceiling.
    expect(one(suppliesLineCut(50, 80))).toBe(69.6);
    expect(suppliesLineCut(50, 200)).toBeLessThan(SUPPLIES_LINE_CEILING);
  });

  it('pays for every supplies point, nearly in full at first and less as the line fills', () => {
    expect(suppliesOnlyCut(13, 1)).toBeGreaterThan(0.99);
    for (const general of [0, 13, 46, 50]) {
      let previous = suppliesLineCut(general, 0);
      for (let points = 1; points <= 120; points += 1) {
        const next = suppliesLineCut(general, points);
        expect(next, `${general} + ${points}`).toBeGreaterThan(previous);
        previous = next;
      }
    }
    // The room left shrinks as the general cut grows: ten points are worth less at half price.
    expect(suppliesOnlyCut(50, 10)).toBeLessThan(suppliesOnlyCut(13, 10));
  });

  it('is what the bill takes off the supplies, and the rest of the bill takes the general cut', () => {
    const hungriest = [...PLAYER_UNITS].sort(
      (a, b) => (b.cost.supplies ?? 0) - (a.cost.supplies ?? 0),
    )[0]!;
    const base = (hungriest.cost.supplies ?? 0) * 10;
    const bill = musterCost(hungriest, 10, 50, 50);
    expect(bill.supplies).toBe(Math.round(base * (1 - suppliesLineCut(50, 50) / 100)));
    // Positive control: the two used to add, so half price and 50 points was 99.8% off.
    expect(bill.supplies!).toBeGreaterThan(base * 0.29);
    expect(bill.caps).toBe(Math.round((hungriest.cost.caps ?? 0) * 10 * 0.5));
  });
});

/** The seven supplies cards and the Greenhouse, halved and more (2026-10-01). */
describe('the supply reduction sources', () => {
  const supplies = MODIFICATIONS.filter((spec) => spec.effect === 'muster_supplies_reduction');

  it('prints the nerfed values, each inside the band its word names', () => {
    expect(Object.fromEntries(supplies.map((spec) => [spec.id, spec.magnitude]))).toEqual({
      quarters_mess_rota: 4,
      greenhouse_sealed_growrooms: 7,
      apothecary_dispensary_apprenticeships: 7,
      gauntlet_instructor_cadre: 8,
      gauntlet_kit_store: 5,
      greenhouse_grey_water_loop: 3,
      garage_parts_carousel: 3,
    });
    for (const spec of supplies) {
      const band = MODIFICATION_RARITY_BANDS[spec.rarity];
      expect(spec.magnitude, spec.id).toBeGreaterThanOrEqual(band.min);
      expect(spec.magnitude, spec.id).toBeLessThanOrEqual(band.max);
    }
  });

  it('keeps the gates the bigger ones had, so a basic price is still a late fitting', () => {
    const gatesOf = (id: string, was: 'advanced' | 'intricate') => {
      const spec = supplies.find((one) => one.id === id)!;
      const asked = modificationRequirement(spec, spec.building);
      const band = MODIFICATION_REQUIREMENT_BANDS[was];
      expect(asked.crewLevel, id).toBe(band.crewLevel);
      expect(asked.notoriety, id).toBe(band.notoriety);
      expect(asked.officer?.mark, id).toBe(band.mark);
      // ...and the reach a drawing had, rather than a basic card's one structure.
      expect(fitsIn(spec), id).toEqual(['greenhouse', 'gauntlet', 'apothecary']);
      // ...and the Scrapyard rung it opened at (maintainer, 2026-10-01: "keep old Yard level").
      expect(scrapyardLevelForModification(spec), id).toBe(SCRAPYARD_LEVEL_FOR_RARITY[was]);
    };
    gatesOf('greenhouse_sealed_growrooms', 'advanced');
    gatesOf('apothecary_dispensary_apprenticeships', 'advanced');
    gatesOf('gauntlet_instructor_cadre', 'advanced');
    gatesOf('gauntlet_kit_store', 'intricate');
    // Positive control: a card that was always BASIC opens with the yard, as every basic card does.
    const rota = supplies.find((one) => one.id === 'quarters_mess_rota')!;
    expect(scrapyardLevelForModification(rota)).toBe(SCRAPYARD_LEVEL_FOR_RARITY.basic);
    expect(SCRAPYARD_LEVEL_FOR_RARITY.advanced).toBeGreaterThan(SCRAPYARD_LEVEL_FOR_RARITY.basic);
  });

  it('gives a mid-game district 9 points: a Greenhouse 10 and Mess Rota', () => {
    expect(
      musterSuppliesReduction([
        { id: 'g', kind: 'greenhouse', level: 10, modifications: [] },
        { id: 'q', kind: 'quarters', level: 10, modifications: ['quarters_mess_rota'] },
      ]),
    ).toBe(9);
  });
});

describe('the cards on the two tapered channels', () => {
  it('say they taper, as the defence cards do', () => {
    const tapered = MODIFICATIONS.filter(
      (spec) =>
        spec.effect === 'muster_time_reduction' || spec.effect === 'muster_supplies_reduction',
    );
    expect(tapered.length, 'the muster cards went missing').toBeGreaterThan(10);
    for (const spec of tapered) expect(describeAddonEffect(spec), spec.id).toContain('(tapers)');
  });
});
