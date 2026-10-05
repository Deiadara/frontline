import { describe, expect, it } from 'vitest';
import type { Army } from '../units/index.js';
import { bareBattlefield, type Battlefield } from './battlefield.js';
import { simulate } from './engine.js';

/**
 * Morale reads wounds, not bodies (maintainer, 2026-10-05, P2-A).
 *
 * The casualty shock was charged on whole dead bodies, so a hurt front body counted for nothing
 * until it fell and long fights between hardy sheets turned on the round one body happened to die.
 * Adding a few Razors to a line of Anodics in a tunnel swung the win rate 60, 21, 34, 20, 41, 41:
 * more units losing more often, against the 2026-09-29 rule that more is always a bit better.
 */
const TUNNEL: Battlefield = {
  ...bareBattlefield('a tunnel'),
  contexts: ['underground', 'dark'],
  frontage: 10,
};

function winRate(attacker: Army, defender: Army, seeds: number): number {
  let wins = 0;
  for (let i = 0; i < seeds; i += 1) {
    const fight = simulate({
      seed: `wounds-${i}`,
      battlefield: TUNNEL,
      attacker: { name: 'A', army: attacker, defending: false },
      defender: { name: 'D', army: defender, defending: true },
    });
    if (fight.winner === 'attacker') wins += 1;
  }
  return wins / seeds;
}

describe('a mixed line gaining a few units', () => {
  it('does not swing its odds on which round one body falls', () => {
    const rates = [1, 2, 3, 4, 5, 6].map((razors) =>
      winRate({ anodics: 16, razors }, { razors: 52 }, 300),
    );
    // Measured 2026-10-05: about 81, 79, 83, 82, 80, 78. It was 60, 21, 34, 20, 41, 41.
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.15);
    for (const rate of rates) expect(rate).toBeGreaterThan(0.6);
  });
});
