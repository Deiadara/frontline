import { describe, expect, it } from 'vitest';
import { defaultSkirmishEngine } from './skirmish.js';
import { findFeat } from '../feats/catalog.js';
import {
  TRAP_CATALOG,
  findTrap,
  springTrap,
  trapBite,
  type TrapSpec,
  type TrapWire,
} from './traps.js';
import type { Army } from '../units/training.js';

/**
 * What a trap does to a fight, through the real engine (maintainer, 2026-09-29).
 *
 * "Soften traps": a trap tilts an even fight and does not decide it. Before this, 40 Razors and
 * 10 Breakers against the same won 51.5% of 200 seeds and 3% once Pressure Plates had taken three
 * of them. Every figure here is a win rate over the same 200 seeds, so the comparisons are paired.
 */

const SEEDS = 200;
const EVEN: Army = { razors: 40, breakers: 10 };
// A line that shoots from range, which is what the wire's speed half is worth most against.
const RANGED: Army = { razors: 24, snipers: 8, breakers: 6 };

function winRate(attacking: Army, defending: Army, trap?: TrapSpec | TrapWire): number {
  let wins = 0;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const toll = trap && 'effect' in trap ? springTrap(attacking, trap) : null;
    const slowed = toll?.slowed ?? (trap && !('effect' in trap) ? trap : null);
    const outcome = defaultSkirmishEngine.resolve({
      seed: `trap-sweep-${seed}`,
      attackerName: 'A',
      defenderName: 'D',
      locationName: 'the approach',
      attacking: toll?.survivors ?? attacking,
      defending,
      ...(slowed ? { attackerSlowed: slowed } : {}),
    });
    if (outcome.winner === 'attacker') wins += 1;
  }
  return wins / SEEDS;
}

describe('a trap tilts an even fight rather than deciding it', () => {
  const bare = winRate(EVEN, EVEN);

  it('starts from a fight that is actually even', () => {
    expect(bare).toBeGreaterThan(0.45);
    expect(bare).toBeLessThan(0.6);
  });

  /** The ruling's own target: Pressure Plates take an even attack to roughly 25% to 35%. */
  it('Pressure Plates take an even attack to between a quarter and a third', () => {
    const plated = winRate(EVEN, EVEN, findTrap('trap_pressure_plates'));
    expect(plated).toBeGreaterThanOrEqual(0.25);
    expect(plated).toBeLessThanOrEqual(0.35);
  });

  it('leaves every trap in the catalogue short of a certain hold', () => {
    for (const spec of TRAP_CATALOG) {
      const rate = winRate(EVEN, EVEN, spec);
      expect(rate, spec.id).toBeLessThan(bare);
      expect(rate, spec.id).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe('Razor Wire slows the attack instead of killing it', () => {
  const wire = findTrap('trap_razor_wire')!;
  if (wire.effect.kind !== 'wire') throw new Error('fixture error: Razor Wire is not the wire');
  const slow: TrapWire = wire.effect;

  it('costs an even attack some of its odds and kills nobody doing it', () => {
    expect(springTrap(EVEN, wire).survivors).toEqual(EVEN);
    const bare = winRate(EVEN, EVEN);
    const wired = winRate(EVEN, EVEN, wire);
    expect(wired).toBeLessThan(bare - 0.03);
    expect(wired).toBeGreaterThan(0.3);
  });

  /** The speed half is read as reach and closing, so a rifle line gets the most out of it. */
  it('is worth more in front of a line that shoots than in front of a line of blades', () => {
    const againstBlades = winRate(EVEN, EVEN) - winRate(EVEN, EVEN, wire);
    const againstRifles = winRate(EVEN, RANGED) - winRate(EVEN, RANGED, wire);
    expect(againstRifles).toBeGreaterThan(againstBlades);
    // ...and the speed half alone does that: with no morale cut it still costs the attack.
    const speedOnly = winRate(EVEN, RANGED, { ...slow, moraleCut: 0 });
    expect(speedOnly).toBeLessThan(winRate(EVEN, RANGED) - 0.1);
  });

  /** Both halves come back once the attack is through: a wire that lasted all fight decides it. */
  it('hands the speed and the morale back after its opening rounds', () => {
    // Held for its two rounds and then for the whole fight: in front of a rifle line, and with the
    // morale half alone on a column big enough for a few points to decide it if they stayed.
    expect(winRate(EVEN, RANGED, { ...slow, rounds: 12 })).toBeLessThan(
      winRate(EVEN, RANGED, wire) - 0.1,
    );
    const big: Army = { razors: 160, breakers: 40 };
    const morale: TrapWire = { speedCut: 0, moraleCut: 4, rounds: 2 };
    expect(winRate(big, big, { ...morale, rounds: 12 })).toBeLessThan(
      winRate(big, big, morale) - 0.1,
    );
  });
});

/**
 * The trap kill ladder moves with the traps (CLAUDE.md, "Feats move with the game"). Its top rung
 * asked for 5,000 when the biggest trap stopped at 34; this holds the rungs to what the catalogue's
 * bites can actually pay on a column of 200, the size the comment on the ladder prices against.
 */
describe('the trap kill feats', () => {
  const biting = TRAP_CATALOG.flatMap((spec) =>
    spec.effect.kind === 'bite' ? [trapBite(200, spec.effect.bite)] : [],
  );
  const perTrap = biting.reduce((sum, kills) => sum + kills, 0) / biting.length;

  it('asks for no more sprung traps at the top than the trap-laying ladder lays at The Ground Bites', () => {
    const top = findFeat('snares_3')!;
    const laid = findFeat('traps_5')!;
    expect(top.target / perTrap).toBeLessThan(laid.target);
  });

  it('opens within a handful of traps', () => {
    expect(findFeat('snares_1')!.target / perTrap).toBeLessThanOrEqual(5);
  });
});
