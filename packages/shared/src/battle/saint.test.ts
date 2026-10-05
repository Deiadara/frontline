import { describe, expect, it } from 'vitest';
import { findUnit, type Army, type UnitSpec } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { simulate } from './engine.js';

/**
 * The Saint's Steadying Presence (maintainer, 2026-10-05: "build the aura"): while the Saint stands
 * and has not broken, no other stack on its side can run.
 *
 * Measured as an A/B on the same seeds, the flag switched off on the catalogue entry for the second
 * half: the aura is the only difference between the two readings.
 */
describe('the Saint steadies the line beside him', () => {
  const SAINT_SIDE: Army = { the_saint: 1, razors: 30 };
  const ENEMY: Army = { razors: 40 };
  const SEEDS = 200;

  /** Fights in which any stack beside the Saint broke and ran. */
  function lineRan(): number {
    let count = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      const fight = simulate({
        seed: `saint-${i}`,
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: ENEMY, defending: false },
        defender: { name: 'D', army: SAINT_SIDE, defending: true },
      });
      const others = fight.defender.stacks.filter((stack) => stack.unit.id !== 'the_saint');
      if (others.some((stack) => stack.brokeAt !== null)) count += 1;
    }
    return count;
  }

  it('holds the Razors beside him where they would otherwise run', () => {
    const saint = findUnit('the_saint') as UnitSpec & { steadies?: boolean };
    expect(saint.steadies).toBe(true);
    const steadied = lineRan();
    saint.steadies = false;
    let alone: number;
    try {
      alone = lineRan();
    } finally {
      saint.steadies = true;
    }
    // Measured 2026-10-05: 0 of 200 with the aura, 200 of 200 without.
    expect(alone).toBeGreaterThan(SEEDS / 2);
    expect(steadied).toBeLessThan(alone / 4);
  });
});
