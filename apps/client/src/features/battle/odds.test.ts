import { bareBattlefield, estimatedForce, forecast } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { sideAtTheMark, yourOdds } from './odds';

/**
 * Bug pass, 2026-10-02: a defender's reading put the player in the attacker's slot, which is the
 * slot the engine gives the ambush and the walk through a wire. The reading is the hold rate with
 * the enemy attacking.
 */
describe('the odds from the reader’s side', () => {
  const plan = {
    seed: 'odds-test',
    ground: bareBattlefield(),
    sending: { ghosts: 20 },
    fitted: {},
    size: 20,
    shadow: null,
  };

  it('reads a defender as the side being attacked', () => {
    const held = yourOdds({ ...plan, holding: true });
    const theRightWayRound = forecast({
      seed: plan.seed,
      battlefield: plan.ground,
      attacker: { name: 'them', army: estimatedForce(plan.size), defending: false },
      defender: { name: 'you', army: plan.sending, upgrades: {}, defending: true },
    });
    expect(held.chance).toBeCloseTo(1 - theRightWayRound.winChance, 9);
    expect(held.kept).toBeCloseTo(theRightWayRound.defenderSurvival, 9);
  });

  it('reads an attacker as the side attacking', () => {
    const taken = yourOdds({ ...plan, holding: false });
    const straight = forecast({
      seed: plan.seed,
      battlefield: plan.ground,
      attacker: { name: 'you', army: plan.sending, upgrades: {}, defending: false },
      defender: { name: 'them', army: estimatedForce(plan.size), defending: true },
    });
    expect(taken.chance).toBeCloseTo(straight.winChance, 9);
  });
});

/*
 * Bug pass, 2026-10-02: the odds stood a Warden in for every unit a Written Report had named. 40
 * Razors against the 30 Razors a report listed read 0% (against 30 Wardens) on a fight they win
 * every time.
 */
describe('the odds against a report that named the units', () => {
  it('fights the units it named, not Wardens', () => {
    const plan = {
      seed: 'odds-named',
      ground: bareBattlefield(),
      sending: { razors: 40 },
      fitted: {},
      size: 30,
      holding: false,
      shadow: null,
    };
    const named = yourOdds({ ...plan, army: { razors: 30 } });
    const guessed = yourOdds(plan);
    expect(named.chance).toBeGreaterThan(0.9);
    expect(guessed.chance).toBeLessThan(named.chance);
  });
});

describe('the side the odds stand up', () => {
  it('counts who stands there with no row, beside the rows', () => {
    expect(sideAtTheMark({ army: { razors: 4 }, standing: { razors: 2, wardens: 6 } })).toEqual({
      razors: 6,
      wardens: 6,
    });
    expect(sideAtTheMark(null)).toEqual({});
  });
});
