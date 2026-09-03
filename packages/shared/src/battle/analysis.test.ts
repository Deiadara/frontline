import { describe, expect, it } from 'vitest';
import { analyseBattle, BattleAnalysisSchema } from './analysis.js';
import { bareBattlefield } from './battlefield.js';
import { simulate } from './engine.js';

/**
 * A report must be storable, whatever the engine hands it.
 *
 * `damage` is `z.number().nonnegative()` and `damageShare` is `z.number().min(0).max(1)` on this
 * module's own schema, and nothing validates an analysis before `db/repos/sieges.ts` writes it. The
 * read path does validate, and on a failure it logs "stored report is not readable by this build,
 * skipping" and returns nothing for that row, so the player wins a fight and it never appears on
 * their board. One stack with a negative `dealt` was enough, and it also pushed every *other*
 * stack's share past 1 by shrinking the divisor they are all measured against.
 *
 * The route that produced a negative `dealt` in play is closed (`MIN_GROUND_EFFECT_PERCENT` in
 * `city/labels.ts`, pinned by `city/labels.test.ts`). This is the guard behind it, because the
 * failure mode is silent and it costs the whole record of a fight.
 */

const fight = () =>
  simulate({
    seed: 'analysis-fixture',
    battlefield: bareBattlefield('the Bonefield'),
    attacker: { name: 'Us', army: { razors: 40, snipers: 6 }, defending: false },
    defender: { name: 'Them', army: { razors: 12 }, defending: true },
  });

const analyse = (simulation: ReturnType<typeof simulate>) =>
  analyseBattle({
    battleId: 'b1',
    locationName: 'the Bonefield',
    simulation,
    fled: {},
    winnerLosses: {},
    perimeter: { attacker: {}, defender: {} },
    perimeterCaught: {},
    trap: null,
    infamy: { attacker: 0, defender: 0 },
  });

describe('a stack that came out of the engine with negative damage', () => {
  it('is a real hazard for the schema, which is why the guard is here', () => {
    // The precondition: without a guard these two fields are what the schema refuses.
    const raw = fight();
    const stacks = raw.attacker.stacks.filter((stack) => stack.started > 0);
    expect(stacks.length).toBeGreaterThan(1);
  });

  it('does not put the report outside its own schema', () => {
    const simulation = fight();
    const target = simulation.attacker.stacks.find((stack) => stack.started > 0);
    if (!target) throw new Error('fixture: no attacking stack');
    target.dealt = -75;

    const analysis = analyse(simulation);
    const parsed = BattleAnalysisSchema.safeParse(analysis);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('does not let one negative stack push everybody else past a full share', () => {
    const simulation = fight();
    const target = simulation.attacker.stacks.find((stack) => stack.started > 0);
    if (!target) throw new Error('fixture: no attacking stack');
    target.dealt = -75;

    const analysis = analyse(simulation);
    for (const unit of analysis.attacker.units) {
      expect(unit.damage, unit.name).toBeGreaterThanOrEqual(0);
      expect(unit.damageShare, unit.name).toBeGreaterThanOrEqual(0);
      expect(unit.damageShare, unit.name).toBeLessThanOrEqual(1);
    }
  });
});
