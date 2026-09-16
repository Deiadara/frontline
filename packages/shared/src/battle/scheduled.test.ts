import { describe, expect, it } from 'vitest';
import {
  DECLARE_INFAMY_COST,
  DECLARE_UNAFFORDABLE_MESSAGE,
  declareInfamyCost,
} from './scheduled.js';

/**
 * §D7, as the maintainer put it on 2026-09-15: calling a fight costs a hundred infamy only when the
 * ground is held by a crew a player runs. Everything else on the map is free to call.
 */
describe('what calling a fight costs (§D7)', () => {
  it('charges the full price for ground a player holds', () => {
    expect(DECLARE_INFAMY_COST).toBe(100);
    expect(declareInfamyCost({ kind: 'crew', baseId: 'somebody' }, true)).toBe(100);
  });

  /**
   * The control for the second argument: the same holder plate, an AI crew behind it, nothing
   * charged. The two calls differ in one boolean and a hundred points.
   */
  it('charges nothing for a crew nobody plays', () => {
    expect(declareInfamyCost({ kind: 'crew', baseId: 'the_rival' }, false)).toBe(0);
  });

  it('charges nothing for the Combine, the looters, or empty ground', () => {
    expect(declareInfamyCost({ kind: 'government' }, false)).toBe(0);
    expect(declareInfamyCost({ kind: 'looters' }, false)).toBe(0);
    expect(declareInfamyCost({ kind: 'unoccupied' }, false)).toBe(0);
  });

  it('names the price and who it is for in the refusal', () => {
    expect(DECLARE_UNAFFORDABLE_MESSAGE).toContain(String(DECLARE_INFAMY_COST));
    expect(DECLARE_UNAFFORDABLE_MESSAGE).toContain("another player's crew");
  });
});
