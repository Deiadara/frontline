import { describe, expect, it } from 'vitest';
import { bareBattlefield, type Battlefield } from './battlefield.js';
import { lootCapacityOf, PICKER_EXTRA_LOAD } from '../raid.js';
import { findUnit, UNIT_RULES, type Army, type UnitSpec } from '../units/index.js';
import {
  holdsTheLine,
  MAX_PACK_BONUS,
  MAX_SAPPER_CUT,
  opensFire,
  packBonusPercent,
  PACK_STEP,
  sappedGround,
  sapperCutPercent,
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

type Mark = 'strikes_first' | 'stalwart' | 'sapper' | 'pack' | 'picker';

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

/** Bodies a side lost, which is the figure every mark below is measured on. */
const lost = (side: Simulation['attacker']): number =>
  side.stacks.reduce((total, stack) => total + (stack.started - stack.alive), 0);

/** Fortified ground, so the sapper has something to take apart. */
const dugIn = (percent: number): Battlefield => ({ ...bareBattlefield(), fortifyPercent: percent });

describe('Runs in Packs: massing one sheet is worth something', () => {
  it('pays nothing for the first body and caps where the doc says', () => {
    expect(packBonusPercent(0)).toBe(0);
    expect(packBonusPercent(1)).toBe(0);
    expect(packBonusPercent(11)).toBeCloseTo(10 * PACK_STEP, 6);
    expect(packBonusPercent(1000)).toBe(MAX_PACK_BONUS);
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

  it('is worth nothing to a single body, so the sheet is honest', () => {
    const one = stackOf(fight({ cyber_dogs: 1 }, { razors: 40 }, 'pack-2').attacker, 'cyber_dogs');
    const bare = withoutMark('cyber_dogs', 'pack', () =>
      stackOf(fight({ cyber_dogs: 1 }, { razors: 40 }, 'pack-2').attacker, 'cyber_dogs'),
    );
    expect(one.effective.offense).toBeCloseTo(bare.effective.offense, 6);
  });
});

describe('Wall Breaker: the works come down', () => {
  it('scales with the share of the line that is sapping, and caps', () => {
    expect(sapperCutPercent({ razors: 40 })).toBe(0);
    expect(sapperCutPercent({})).toBe(0);
    // A quarter of the line is full cover, and past it nothing more is bought.
    expect(sapperCutPercent({ demolishers: 10, razors: 30 })).toBeCloseTo(MAX_SAPPER_CUT, 6);
    expect(sapperCutPercent({ demolishers: 30, razors: 10 })).toBeCloseTo(MAX_SAPPER_CUT, 6);
    // An eighth is half of it.
    expect(sapperCutPercent({ demolishers: 5, razors: 35 })).toBeCloseTo(MAX_SAPPER_CUT / 2, 6);
  });

  it('does not count the porters, who are not on the line', () => {
    expect(sapperCutPercent({ demolishers: 10, razors: 30, scavengers: 200 })).toBeCloseTo(
      MAX_SAPPER_CUT,
      6,
    );
  });

  it('takes a share off the fortification and never all of it', () => {
    const ground = sappedGround(dugIn(60), { demolishers: 40 });
    expect(ground.fortifyPercent).toBeCloseTo(60 * (1 - MAX_SAPPER_CUT / 100), 6);
    expect(ground.fortifyPercent).toBeGreaterThan(0);
    // Nothing sapping is the identical object, so the common case costs no allocation.
    expect(sappedGround(dugIn(60), { razors: 40 })).toEqual(dugIn(60));
  });

  it('costs the defender bodies that the same force without the mark does not take', () => {
    const attacking: Army = { demolishers: 14, razors: 26 };
    const ground = dugIn(60);
    const sapped = fight(attacking, { wardens: 30 }, 'sap-1', ground);
    const intact = withoutMark('demolishers', 'sapper', () =>
      fight(attacking, { wardens: 30 }, 'sap-1', ground),
    );
    expect(lost(sapped.defender)).toBeGreaterThan(lost(intact.defender));
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
    const armed = fight({ razors: 40 }, { snipers: 20 }, 'first-2');
    const quiet = withoutMark('snipers', 'strikes_first', () =>
      fight({ razors: 40 }, { snipers: 20 }, 'first-2'),
    );
    expect(lost(armed.attacker)).toBeGreaterThan(lost(quiet.attacker));
  });
});

describe('Holds the Line: it does not run while over half of it stands', () => {
  it('reads the bodies standing, not the morale', () => {
    const stalwart = { unit: spec('wardens'), alive: 6, started: 10 } as Stack;
    expect(holdsTheLine(stalwart)).toBe(true);
    expect(holdsTheLine({ ...stalwart, alive: 5 })).toBe(false);
    expect(holdsTheLine({ ...stalwart, unit: spec('razors') })).toBe(false);
  });

  /**
   * The end-to-end case, and it is a *found* one rather than a constructed one: this exact matchup
   * and seed break the Wardens without the mark and hold them with it. Pinning a case the rule
   * actually changes is the only way this test can fail when the engine stops reading the flag.
   */
  it('holds a stack the same fight breaks without the mark', () => {
    const held = fight({ hollow_men: 20, razors: 40 }, { wardens: 60 }, 'stalwart-1');
    const broken = withoutMark('wardens', 'stalwart', () =>
      fight({ hollow_men: 20, razors: 40 }, { wardens: 60 }, 'stalwart-1'),
    );
    expect(stackOf(broken.defender, 'wardens').brokeAt).not.toBeNull();
    expect(stackOf(held.defender, 'wardens').brokeAt).toBeNull();
    // ...and it is holding for the stated reason, not because nothing was shooting at it.
    expect(holdsTheLine(stackOf(held.defender, 'wardens'))).toBe(true);
  });

  it('never leaves a stalwart stack broken while over half of it is standing', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const battle = fight({ juggernauts: 40 }, { wardens: 25, razors: 20 }, `stalwart-${seed}`);
      const wardens = stackOf(battle.defender, 'wardens');
      if (wardens.brokeAt !== null) expect(holdsTheLine(wardens), seed).toBe(false);
    }
  });
});

describe('Picks the Field: a flat load per body', () => {
  it('adds the same load to every picker, over and above the sheet', () => {
    const sheetOnly = spec('scavengers').stats.lootCapacity * 10;
    expect(lootCapacityOf({ scavengers: 10 })).toBe(sheetOnly + PICKER_EXTRA_LOAD * 10);
  });

  it('is not scaled by the carry percentage, which is the whole difference', () => {
    const sheetOnly = spec('scavengers').stats.lootCapacity * 10;
    expect(lootCapacityOf({ scavengers: 10 }, 50)).toBeCloseTo(
      sheetOnly * 1.5 + PICKER_EXTRA_LOAD * 10,
      6,
    );
  });

  it('pays nothing to a force that carries none of them', () => {
    const carried = lootCapacityOf({ razors: 10 });
    const control = withoutMark('scavengers', 'picker', () => lootCapacityOf({ scavengers: 10 }));
    expect(carried).toBe(spec('razors').stats.lootCapacity * 10);
    expect(control).toBe(spec('scavengers').stats.lootCapacity * 10);
  });
});
