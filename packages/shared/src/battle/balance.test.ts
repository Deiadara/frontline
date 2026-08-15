import { describe, expect, it } from 'vitest';
import { UNIT_CATALOG, type UnitSpec } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { simulate } from './engine.js';

/**
 * Whether the roster is a **web** or a **ladder**.
 *
 * Every other test in this directory checks a rule. This one checks the content the rules produce,
 * by playing every non-unique unit against every other at equal supply and reading the result as a
 * graph. Two things have to be true of that graph, and neither is guaranteed by any amount of
 * correct arithmetic:
 *
 * - **Nothing is unbeatable.** A unit that wins every matchup is not a strong unit, it is the end
 *   of the decision — everyone builds it and the roster collapses to one row.
 * - **The graph has cycles.** A ↠ B ↠ C ↠ A is what "some counter others" *means*. Without a cycle
 *   the roster is a power ranking with extra steps, however many resistances are written on it.
 *
 * This is also the harness that found the real bug in the armour curve: 0 A.D.'s per-point falloff
 * on a 0–100 stat made the heavy tier untouchable, which showed up here as a unit at 21 of 21 and
 * nowhere else.
 *
 * Unique units are excluded. They are one-of-a-kind by design and a fight of sixty Colossi is not a
 * matchup anybody can have.
 */

/** Supply spent per side. Equal supply is the only fair way to compare a Razor with a Juggernaut. */
const SUPPLY_BUDGET = 60;

/** Seeds per pairing. Enough to settle a coin-flip matchup, few enough to run in a second. */
const RUNS = 7;

const ROSTER: UnitSpec[] = UNIT_CATALOG.filter((unit) => !unit.unique);

function beatsGraph(): Map<string, Set<string>> {
  const beats = new Map<string, Set<string>>(ROSTER.map((unit) => [unit.id, new Set<string>()]));
  for (const attacker of ROSTER) {
    for (const defender of ROSTER) {
      if (attacker.id === defender.id) continue;
      let wins = 0;
      for (let seed = 0; seed < RUNS; seed += 1) {
        const simulation = simulate({
          seed: `balance-${attacker.id}-${defender.id}-${seed}`,
          battlefield: bareBattlefield(),
          attacker: {
            name: 'A',
            army: { [attacker.id]: Math.max(1, Math.floor(SUPPLY_BUDGET / attacker.supply)) },
            defending: false,
          },
          defender: {
            name: 'D',
            army: { [defender.id]: Math.max(1, Math.floor(SUPPLY_BUDGET / defender.supply)) },
            defending: true,
          },
        });
        if (simulation.winner === 'attacker') wins += 1;
      }
      if (wins > RUNS / 2) beats.get(attacker.id)!.add(defender.id);
    }
  }
  return beats;
}

const BEATS = beatsGraph();

describe('the roster is a web, not a ladder', () => {
  it('leaves every unit something that beats it', () => {
    const unbeaten = ROSTER.filter((unit) =>
      ROSTER.every((other) => other.id === unit.id || !BEATS.get(other.id)!.has(unit.id)),
    );
    expect(unbeaten.map((unit) => unit.id)).toEqual([]);
  });

  it('has counter cycles in it', () => {
    const cycles: string[] = [];
    for (const a of ROSTER) {
      for (const b of BEATS.get(a.id)!) {
        for (const c of BEATS.get(b)!) {
          if (c !== a.id && BEATS.get(c)!.has(a.id)) cycles.push(`${a.id}→${b}→${c}→${a.id}`);
        }
      }
    }
    expect(cycles.length, 'a roster with no cycle is a power ranking').toBeGreaterThan(4);
  });

  /**
   * A support unit is allowed to lose every straight fight — a Stitcher's whole job is to be
   * somewhere else on the field. What is not allowed is a unit that *wins* every one.
   */
  it('has no unit that beats the entire roster', () => {
    for (const unit of ROSTER) {
      expect(BEATS.get(unit.id)!.size, `${unit.id} beats everything`).toBeLessThan(
        ROSTER.length - 1,
      );
    }
  });

  it('rewards the tier ladder without making it the only thing that matters', () => {
    const wins = (tier: string) => {
      const inTier = ROSTER.filter((unit) => unit.tier === tier);
      return inTier.reduce((total, unit) => total + BEATS.get(unit.id)!.size, 0) / inTier.length;
    };
    // Heavier units are better at the same supply — they are gated behind campaigns, not price.
    expect(wins('heavy')).toBeGreaterThan(wins('rabble'));
    // ...but not so much better that the lower tiers stop beating anything.
    expect(wins('rabble')).toBeGreaterThan(2);
  });
});
