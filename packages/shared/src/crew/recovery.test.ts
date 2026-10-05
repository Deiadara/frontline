import { describe, expect, it } from 'vitest';
import { casualtyRecoveryShare, recoverCasualties } from './effects.js';

/**
 * Medics bring back a share of the whole fight's dead (maintainer, 2026-10-02).
 *
 * Rounded down per unit type, a win that lost one or two of each kind brought back nobody, so a
 * level 10 Infirmary quoting 28% got one back out of 562 over 300 wins. Rounded over the fight,
 * a squad-sized loss pays close to the quote, and the leftover goes to the biggest units first.
 */
describe('casualties the medics bring back', () => {
  const POINTS = 40; // a level 10 Infirmary: 28%
  const dead = { razors: 2, wardens: 2, snipers: 2, breakers: 1, ghosts: 1 };
  const total = Object.values(dead).reduce((sum, count) => sum + count, 0);
  const sizes: Record<string, number> = {
    razors: 1,
    wardens: 2,
    snipers: 1,
    breakers: 3,
    ghosts: 1,
  };

  it('brings back the fight’s share, not nothing, when every kind lost one or two', () => {
    const left = recoverCasualties(dead, POINTS, (id) => sizes[id] ?? 1);
    const back = total - Object.values(left).reduce((sum, count) => sum + count, 0);
    expect(back).toBe(Math.floor((total * casualtyRecoveryShare(POINTS)) / 100));
    expect(back).toBeGreaterThan(0);
  });

  it('hands the leftover to the biggest units first, and never more than died', () => {
    const left = recoverCasualties(dead, POINTS, (id) => sizes[id] ?? 1);
    // Two back out of eight: the Breakers (3 slots) and then the Wardens (2).
    expect(left.breakers).toBe(0);
    expect(left.wardens).toBe(1);
    for (const [unitId, count] of Object.entries(left)) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(dead[unitId as keyof typeof dead]);
    }
  });

  it('brings back nobody without medics', () => {
    expect(recoverCasualties(dead, 0)).toEqual(dead);
  });
});
