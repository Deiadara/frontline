import { describe, expect, it } from 'vitest';
import { noTerritoryEffects } from '../city/index.js';
import { bareBattlefield, type Battlefield } from './battlefield.js';
import { findUnit, UNIT_RULES, type Army, type UnitSpec } from '../units/index.js';
import {
  breaksWalls,
  holdsTheLine,
  MAX_PACK_BONUS,
  opensFire,
  packBonusPercent,
  PACK_HALF,
  simulate,
  type Simulation,
  type Stack,
} from './engine.js';

/**
 * The five marks the 2026-09-09 pass added, measured through the engine rather than asserted about.
 *
 * Every one of them is a **rule**: it changes what happens in a round rather than scaling a number
 * on a sheet, which is the whole reason they are flags on `UnitSpec` and rows in `UNIT_RULES`
 * instead of another entry in `UNIT_MODIFIERS`. A rule that is only read by the table that names it
 * is content nobody meets, so each one here is checked twice: once for the arithmetic, and once
 * end to end with the flag switched off, which is the control that says the engine is reading it.
 *
 * ## Why the controls mutate the catalogue
 *
 * There is no way to build a synthetic unit for these: `simulate` takes an `Army` of catalogue ids
 * and resolves each through `findUnit`, so a fabricated sheet never reaches a stack. Comparing a
 * marked unit against a different unmarked one is not a control either, because the two sheets
 * differ in eleven other numbers and the difference could come from any of them.
 *
 * So {@link withoutMark} takes the flag off the real spec for the length of one measurement and
 * puts it back. That makes each control a genuine mutant: with the engine's read of the flag
 * deleted, the "with" and "without" runs come out identical and the test fails. The restore is in a
 * `finally`, so a failing expectation inside the block cannot leak the mutation into the next test.
 */

type Mark = 'strikes_first' | 'stalwart' | 'wall_breaker' | 'pack';

const spec = (unitId: string): UnitSpec => {
  const found = findUnit(unitId);
  if (!found) throw new Error(`${unitId} is not in the catalogue`);
  return found;
};

function withoutMark<T>(unitId: string, mark: Mark, run: () => T): T {
  // Widened to a plain map for the write. Indexing five optional keys at once narrows the *write*
  // type to their intersection, which excludes the `undefined` the read hands back, so the restore
  // does not typecheck against the interface even though it is putting back exactly what it took.
  const sheet = spec(unitId) as unknown as Record<Mark, boolean | undefined>;
  const had = sheet[mark];
  delete sheet[mark];
  try {
    return run();
  } finally {
    sheet[mark] = had;
  }
}

const fight = (
  attacking: Army,
  defending: Army,
  seed: string,
  battlefield: Battlefield = bareBattlefield(),
): Simulation =>
  simulate({
    seed,
    battlefield,
    attacker: { name: 'A', army: attacking, defending: false },
    defender: { name: 'D', army: defending, defending: true },
  });

const stackOf = (side: Simulation['attacker'], unitId: string): Stack => {
  const found = side.stacks.find((stack) => stack.unit.id === unitId);
  if (!found) throw new Error(`no ${unitId} on this side`);
  return found;
};

describe('Collective: massing one sheet is worth something', () => {
  it('pays nothing for the first unit and approaches the asymptote without reaching it', () => {
    expect(packBonusPercent(0)).toBe(0);
    expect(packBonusPercent(1)).toBe(0);
    // Half the asymptote at `PACK_HALF` others, which is the whole definition of the knob.
    expect(packBonusPercent(PACK_HALF + 1)).toBeCloseTo(MAX_PACK_BONUS / 2, 6);
    // Uncapped, so it never stops climbing, and convergent, so it never arrives.
    expect(packBonusPercent(1000)).toBeLessThan(MAX_PACK_BONUS);
    expect(packBonusPercent(1_000_000)).toBeLessThan(MAX_PACK_BONUS);
    expect(packBonusPercent(1001)).toBeGreaterThan(packBonusPercent(1000));
  });

  /**
   * The shape the maintainer asked for, in the two numbers they gave (2026-09-19).
   *
   * "Have it scale per unit used but have a diminishing returns effect where adding one more
   * from 4 to 5 units increases all of their power more than from 49 to 50."
   *
   * Asserted as a ratio rather than as two magic figures, so a retune of either constant moves
   * the curve without moving the rule: what has to stay true is that the early bodies are worth
   * several times the late ones, not that they are worth 1.18 points.
   */
  it('pays the fifth body many times what the fiftieth is worth', () => {
    const early = packBonusPercent(5) - packBonusPercent(4);
    const late = packBonusPercent(50) - packBonusPercent(49);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(0);
    expect(early / late).toBeGreaterThan(5);
  });

  it('never goes backwards and never goes flat, anywhere a player could reach', () => {
    for (let units = 1; units < 300; units += 1) {
      expect(
        packBonusPercent(units + 1),
        `the ${units + 1}th body was worth nothing`,
      ).toBeGreaterThan(packBonusPercent(units));
    }
  });

  it('raises the stack the engine builds, and names itself in the reasons', () => {
    const packed = stackOf(
      fight({ cyber_dogs: 20 }, { razors: 20 }, 'pack-1').attacker,
      'cyber_dogs',
    );
    const bare = withoutMark('cyber_dogs', 'pack', () =>
      stackOf(fight({ cyber_dogs: 20 }, { razors: 20 }, 'pack-1').attacker, 'cyber_dogs'),
    );

    expect(packed.effective.offense).toBeCloseTo(
      bare.effective.offense * (1 + packBonusPercent(20) / 100),
      6,
    );
    expect(packed.effective.reasons).toContain(UNIT_RULES.pack.label);
    expect(bare.effective.reasons).not.toContain(UNIT_RULES.pack.label);
  });

  it('is worth nothing to a single unit, so the sheet is honest', () => {
    const one = stackOf(fight({ cyber_dogs: 1 }, { razors: 40 }, 'pack-2').attacker, 'cyber_dogs');
    const bare = withoutMark('cyber_dogs', 'pack', () =>
      stackOf(fight({ cyber_dogs: 1 }, { razors: 40 }, 'pack-2').attacker, 'cyber_dogs'),
    );
    expect(one.effective.offense).toBeCloseTo(bare.effective.offense, 6);
  });
});

/**
 * Wall Breaker: the Colossus's, and the enemy's gates count for nothing in its fight (maintainer,
 * 2026-09-26). The traps and the gate's lost level are the settler's (`battle/resolve.ts`) and are
 * pinned there; what the engine owns is the gate's toughness, which is gone for the whole fight.
 */
describe('Wall Breaker: the gate does nothing against the Colossus', () => {
  const gated = (percent: number) => ({ ...noTerritoryEffects(), gatePercent: percent });
  const defenderVitality = (attacking: Army, gatePercent: number): number =>
    simulate({
      seed: 'walls',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: attacking, defending: false },
      defender: {
        name: 'D',
        army: { wardens: 20 },
        defending: true,
        territory: gated(gatePercent),
      },
    }).defender.stacks[0]!.effective.vitality;

  it('is the Colossus alone', () => {
    expect(spec('the_colossus').wall_breaker).toBe(true);
    for (const unit of ['demolishers', 'breakers', 'juggernauts', 'razors']) {
      expect(spec(unit).wall_breaker, unit).not.toBe(true);
    }
  });

  it('takes the gate off every defender while one is in the line, and only then', () => {
    expect(breaksWalls({ the_colossus: 1, razors: 20 })).toBe(true);
    expect(breaksWalls({ razors: 20, demolishers: 6 })).toBe(false);
    expect(breaksWalls({ the_colossus: 0, razors: 20 })).toBe(false);
    // The gate is worth its toughness against everybody else...
    expect(defenderVitality({ razors: 20 }, 60)).toBeGreaterThan(
      defenderVitality({ razors: 20 }, 0),
    );
    // ...and nothing at all with the Colossus in the attacking line.
    expect(defenderVitality({ the_colossus: 1, razors: 20 }, 60)).toBe(
      defenderVitality({ the_colossus: 1, razors: 20 }, 0),
    );
  });

  it('is gone with the mark: the same force without it meets the gate', () => {
    const withoutIt = withoutMark('the_colossus', 'wall_breaker', () =>
      defenderVitality({ the_colossus: 1, razors: 20 }, 60),
    );
    expect(withoutIt).toBeGreaterThan(defenderVitality({ the_colossus: 1, razors: 20 }, 0));
  });
});

describe('Opening Volley: a shot away before the lines form', () => {
  it('reports a side as opening fire only when something on it carries the mark', () => {
    const withSnipers = fight({ snipers: 10 }, { razors: 20 }, 'first-0');
    expect(opensFire(withSnipers.attacker)).toBe(true);
    expect(opensFire(withSnipers.defender)).toBe(false);
  });

  it('costs the enemy more in the first round than the same force without it', () => {
    const attacking: Army = { snipers: 20 };
    const opened = fight(attacking, { razors: 40 }, 'first-1');
    const quiet = withoutMark('snipers', 'strikes_first', () =>
      fight(attacking, { razors: 40 }, 'first-1'),
    );
    expect(opened.rounds[0]?.defenderLost ?? 0).toBeGreaterThan(quiet.rounds[0]?.defenderLost ?? 0);
  });

  /**
   * The half `ambush` cannot do. A defender is standing on ground it already holds, so it never
   * sets an ambush; a sheet that says it shoots first has to shoot first from either chair or the
   * rule is a second ambush with a different name.
   */
  it('works for the defender, which an ambush never does', () => {
    // Measured on wins, not on the attackers' dead (2026-10-05): with morale reading wounds, a
    // volley that softens the attack makes it break and run sooner, so fewer of it die and more of
    // it lose. 300 seeds: the snipers hold 300 with the volley and 197 without.
    const seeds = Array.from({ length: 40 }, (_, i) => `first-${i}`);
    const held = (run: () => ReturnType<typeof fight>[]) =>
      run().filter((one) => one.winner === 'defender').length;
    const armed = held(() => seeds.map((seed) => fight({ razors: 40 }, { snipers: 20 }, seed)));
    const quiet = held(() =>
      withoutMark('snipers', 'strikes_first', () =>
        seeds.map((seed) => fight({ razors: 40 }, { snipers: 20 }, seed)),
      ),
    );
    expect(armed).toBeGreaterThan(quiet);
  });
});

describe('Holds the Line: it does not run while over half of it stands', () => {
  it('reads the units standing, not the morale', () => {
    const stalwart = { unit: spec('wardens'), alive: 6, started: 10 } as Stack;
    expect(holdsTheLine(stalwart)).toBe(true);
    expect(holdsTheLine({ ...stalwart, alive: 5 })).toBe(false);
    expect(holdsTheLine({ ...stalwart, unit: spec('razors') })).toBe(false);
  });

  /**
   * End to end, swept over seeds rather than pinned on one. The single found seed this used to be
   * expired three times, most recently on 2026-10-02 when being outnumbered started counting unit
   * slots: 40 Wardens (80 slots) stopped feeling outnumbered three to one by 120 Razors. Measured
   * that day at 40 points of morale down: without the mark the Wardens break on 30 seeds of 30,
   * with it on none, and the mark never breaks a line that held without it.
   */
  it('holds a stack the same fight breaks without the mark', () => {
    const SEEDS = 30;
    const shaken = (seed: string) => (): Simulation =>
      simulate({
        seed,
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: { razors: 120 }, defending: false },
        defender: {
          name: 'D',
          army: { wardens: 40 },
          defending: true,
          territory: { ...noTerritoryEffects(), unitMoraleFlat: -40 },
        },
      });
    let saved = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      const held = stackOf(shaken(`stalwart-${i}`)().defender, 'wardens');
      const broken = stackOf(
        withoutMark('wardens', 'stalwart', shaken(`stalwart-${i}`)).defender,
        'wardens',
      );
      // Never harms: a line that held without the mark holds with it.
      if (broken.brokeAt === null) expect(held.brokeAt, `seed ${i}`).toBeNull();
      if (broken.brokeAt !== null && held.brokeAt === null) {
        saved += 1;
        // ...and it is holding for the stated reason, not because nothing was shooting at it.
        expect(holdsTheLine(held), `seed ${i}`).toBe(true);
      }
    }
    expect(saved).toBeGreaterThanOrEqual(SEEDS * 0.8);
  });

  it('never leaves a stalwart stack broken while over half of it is standing', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const battle = fight({ juggernauts: 40 }, { wardens: 25, razors: 20 }, `stalwart-${seed}`);
      const wardens = stackOf(battle.defender, 'wardens');
      if (wardens.brokeAt !== null) expect(holdsTheLine(wardens), seed).toBe(false);
    }
  });
});
