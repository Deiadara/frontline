import { describe, expect, it } from 'vitest';
import {
  ATLAS_UNIFIED_BONUSES,
  REACTOR_LOCK_MS,
  findLocation,
  noTerritoryEffects,
  reactorChangesAt,
  unifiedBonusFor,
  upgradeCost,
  type TerritoryEffects,
} from '../city/index.js';
import { applyHoldBonus, bonusesAt, describeHoldBonus } from '../city/locations.js';
import { UNIT_RULES, findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import {
  RADIOACTIVE_ROUNDS,
  burnFallout,
  radioactiveDeaths,
  simulate,
  type Fallout,
  type Killers,
  type SideState,
  type Stack,
} from './engine.js';

/** The Blockhouse's last four and Combine parity, batch 19 (maintainer, 2026-10-14). */

const field = bareBattlefield();
const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus, { locationId: id }),
    noTerritoryEffects(),
  );
const kindsAt = (id: string, level: number): string[] =>
  bonusesAt(findLocation(id)!, level).map((bonus) => bonus.kind);

function stackOf(id: string, alive: number, territory = noTerritoryEffects()): Stack {
  const spec = { ...findUnit(id)!, ...(territory.unitMarks[id] ? { radioactive: true } : {}) };
  const effective = effectiveStats(spec, field, { defending: false, outnumbered: 0 }, territory);
  return {
    unit: spec,
    effective,
    alive,
    pool: alive * effective.vitality,
    bodies: new Array<number>(alive).fill(effective.vitality),
    morale: effective.morale,
    brokeAt: null,
    started: alive,
    charged: 0,
    suppressed: 0,
    dealt: 0,
    sheet: spec.stats,
    modGain: {},
    loudTier: 0,
  };
}

describe('the Interlocking', () => {
  it('pays 50 to 75 defensive spy points and 50 to 100 oil an hour, and nothing else', () => {
    expect(
      [1, 2, 3, 4, 5].map(
        (level) => holding('blockhouse-interlocking', level).intelResistancePercent,
      ),
    ).toEqual([50, 55, 60, 65, 75]);
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('blockhouse-interlocking', level).perHour),
    ).toEqual([50, 60, 70, 80, 100].map((oil) => ({ oil })));
  });
});

describe('the Records Office', () => {
  it('takes 15% to 25% off every location upgrade, and nothing else', () => {
    expect(kindsAt('blockhouse-records', 5)).toEqual(['location_upgrade_discount']);
    expect(
      [1, 2, 3, 4, 5].map(
        (level) => holding('blockhouse-records', level).locationUpgradeDiscountPercent,
      ),
    ).toEqual([15, 17, 19, 21, 25]);
    const foundry = findLocation('annexes-coldrow')!;
    const full = upgradeCost(foundry, 2)!;
    const cut = upgradeCost(foundry, 2, 0, 25)!;
    for (const key of Object.keys(full) as (keyof typeof full)[]) {
      expect(cut[key]!, key).toBeLessThan(full[key]!);
      expect(cut[key]!, key).toBeCloseTo(Math.max(1, full[key]! * 0.75), -1);
    }
  });
});

describe('the Parade Ground', () => {
  it('pays 1, 1, 1, 1, 2 sessions and 1, 2, 3, 3, 5 on every Physical attribute', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('blockhouse-parade', level).extraTrainingSessions),
    ).toEqual([1, 1, 1, 1, 2]);
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('blockhouse-parade', level).officerGroupFlat),
    ).toEqual([1, 2, 3, 3, 5].map((physical) => ({ physical })));
  });
});

describe('the Reactor Shed', () => {
  it('is a choice and nothing else, the same at every level, listed by its own id', () => {
    expect(kindsAt('blockhouse-reactor', 1)).toEqual(['reactor_choice']);
    expect(kindsAt('blockhouse-reactor', 5)).toEqual(['reactor_choice']);
    expect(holding('blockhouse-reactor', 3).reactorSheds).toEqual(['blockhouse-reactor']);
    expect(describeHoldBonus(bonusesAt(findLocation('blockhouse-reactor')!, 1)[0]!)).toContain(
      'Radioactive',
    );
  });

  it('locks a choice for 12 hours', () => {
    const at = new Date('2026-10-14T00:00:00.000Z');
    expect(REACTOR_LOCK_MS).toBe(12 * 3_600_000);
    expect(reactorChangesAt(null, at)).toBeNull();
    expect(reactorChangesAt(at.toISOString(), new Date(at.getTime() + 3_600_000))).toBe(
      new Date(at.getTime() + REACTOR_LOCK_MS).toISOString(),
    );
    expect(reactorChangesAt(at.toISOString(), new Date(at.getTime() + REACTOR_LOCK_MS))).toBeNull();
  });
});

describe('RADIOACTIVE', () => {
  const marked = { ...noTerritoryEffects(), unitMarks: { razors: ['radioactive' as const] } };

  it('reads as the maintainer wrote it', () => {
    expect(UNIT_RULES.radioactive.description).toBe(
      'Whenever one of these dies, it deals its vitality as damage to the stack that killed it, spread over the next 5 rounds.',
    );
  });

  it('burns the stack that hit hardest for a fifth of each dead body a round, five rounds', () => {
    const victims = stackOf('razors', 3, marked);
    const killer = stackOf('wardens', 5);
    const bystander = stackOf('ironsides', 5);
    const side = { stacks: [victims] } as unknown as SideState;
    const before = new Map([[victims, 5]]);
    const killers: Killers = new Map([[victims, { shooter: killer, damage: 100 }]]);
    const fallout: Fallout[] = [];
    radioactiveDeaths(side, before, killers, fallout);
    // Two dead, each its own burn.
    expect(fallout).toHaveLength(2);
    expect(fallout[0]).toEqual({
      stack: killer,
      perRound: victims.effective.vitality / RADIOACTIVE_ROUNDS,
      left: RADIOACTIVE_ROUNDS,
    });
    let burned = 0;
    for (let round = 0; round < 7; round += 1) {
      const incoming = new Map<Stack, number>();
      burnFallout(fallout, incoming);
      burned += incoming.get(killer) ?? 0;
      expect(incoming.get(bystander)).toBeUndefined();
    }
    expect(burned).toBeCloseTo(2 * victims.effective.vitality, 9);
  });

  it('burns nobody for a unit without the mark, or a death with no shooter on record', () => {
    const plain = stackOf('razors', 3);
    const fallout: Fallout[] = [];
    radioactiveDeaths(
      { stacks: [plain] } as unknown as SideState,
      new Map([[plain, 5]]),
      new Map([[plain, { shooter: stackOf('wardens', 1), damage: 1 }]]),
      fallout,
    );
    const marked2 = stackOf('razors', 3, marked);
    radioactiveDeaths(
      { stacks: [marked2] } as unknown as SideState,
      new Map([[marked2, 5]]),
      new Map(),
      fallout,
    );
    expect(fallout).toEqual([]);
  });

  it('costs the side that kills them more in a real fight', () => {
    let lostWith = 0;
    let lostWithout = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const fight = (territory?: TerritoryEffects) =>
        simulate({
          seed: `reactor-${seed}`,
          battlefield: field,
          attacker: { name: 'A', army: { wardens: 20 }, defending: false },
          defender: {
            name: 'D',
            army: { razors: 40 },
            defending: true,
            ...(territory ? { territory } : {}),
          },
        }).attacker.stacks.reduce((total, stack) => total + stack.started - stack.alive, 0);
      lostWith += fight(marked);
      lostWithout += fight();
    }
    expect(lostWith).toBeGreaterThan(lostWithout);
  });
});

describe('every city’s last district', () => {
  it('pays exactly what the Nave pays', () => {
    const nave = ATLAS_UNIFIED_BONUSES.nave!.bonus;
    expect(nave).toEqual({ kind: 'anti_combine' });
    expect(ATLAS_UNIFIED_BONUSES.blockhouse!.bonus).toEqual(nave);
    expect(unifiedBonusFor('ccs')?.bonus).toEqual(nave);
  });
});

describe('the Tower Box', () => {
  it('lifts the damage of units with range 50 or more by 20% to 40%, and nothing else', () => {
    expect(kindsAt('blockhouse-towerbox', 5)).toEqual(['unit_stat_percent']);
    const side = { defending: false, outnumbered: 0 };
    const lift = (unitId: string, level: number) => {
      const unit = findUnit(unitId)!;
      const bare = effectiveStats(unit, field, side, noTerritoryEffects()).offense;
      const held = effectiveStats(unit, field, side, holding('blockhouse-towerbox', level)).offense;
      return Math.round(((held - bare) / unit.stats.offense) * 100);
    };
    expect(findUnit('snipers')!.stats.range).toBeGreaterThanOrEqual(50);
    expect([1, 2, 3, 4, 5].map((level) => lift('snipers', level))).toEqual([20, 24, 28, 32, 40]);
    expect(lift('razors', 5)).toBe(0);
    expect(holding('blockhouse-towerbox', 5).intelYieldPercent).toBe(0);
    expect(describeHoldBonus(bonusesAt(findLocation('blockhouse-towerbox')!, 1)[0]!)).toBe(
      '+20% damage for units with range 50 or more',
    );
  });

  it('counts a unit at exactly 50, which the Parapet does not', () => {
    const fifty = { ...findUnit('razors')!, stats: { ...findUnit('razors')!.stats, range: 50 } };
    const side = { defending: false, outnumbered: 0 };
    const bare = effectiveStats(fifty, field, side, noTerritoryEffects()).offense;
    expect(
      effectiveStats(fifty, field, side, holding('blockhouse-towerbox', 1)).offense,
    ).toBeGreaterThan(bare);
    expect(effectiveStats(fifty, field, side, holding('viaduct-parapet', 1)).offense).toBe(bare);
  });
});
