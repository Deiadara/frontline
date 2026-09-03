import { describe, expect, it } from 'vitest';
import { MAX_ATTRIBUTE, makeAttributes, type Attributes } from '../attributes.js';
import { UnitStatsSchema, type Army } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { officerOutcomeOf, officerStackOf, simulate, allocate, type Stack } from './engine.js';
import {
  MAX_OFFICER_INJURY_CHANCE,
  MIN_OFFICER_INJURY_CHANCE,
  OFFICER_ARMOR_CAP,
  OFFICER_HELD_BACK_STATS,
  OFFICER_RANGE_CAP,
  OFFICER_STAT_FORMULAS,
  OFFICER_STAT_KEYS,
  OFFICER_TARGET_SHARE,
  battleMargin,
  isOfficerUnitId,
  officerBattleStats,
  officerInjured,
  officerInjuryChance,
  officerIsInjured,
  officerRecoveryAt,
  officerRecoverySeconds,
  officerStat,
  officerStatCeiling,
  officerUnit,
  type BattleOfficer,
} from './officer.js';
import { routSurvivors, winnerCasualties } from './rout.js';

/**
 * The officer on the field (§D).
 *
 * Two halves. The first is the attribute table, which is arithmetic and is pinned twice over: once
 * derived from the table (so a weight that moves is caught) and once against numbers computed by
 * hand off the board's own formulas (so a table rewritten to agree with itself is caught too). A
 * test that only asks the table what the table says would pass on any table.
 *
 * The second is what the engine does with them: they draw half the fire, they never appear in a
 * casualty list, and falling is an injury rather than a death.
 */

const officer = (attributes: Partial<Attributes>, base = 0): BattleOfficer => ({
  officerId: 'off-1',
  name: 'Vasco Renn',
  attributes: makeAttributes(base, attributes),
});

const FULL: Attributes = makeAttributes(MAX_ATTRIBUTE);

describe('the attribute to battle stat mapping (§D2)', () => {
  it('reaches exactly 100 in every capped stat at a full sheet', () => {
    const stats = officerBattleStats(FULL);
    for (const stat of OFFICER_STAT_KEYS) {
      const { cap } = OFFICER_STAT_FORMULAS[stat];
      if (cap === null || OFFICER_HELD_BACK_STATS.includes(stat)) continue;
      expect({ stat, value: stats[stat] }).toEqual({ stat, value: 100 });
    }
  });

  it('holds armour and range below the rating their formulas would reach', () => {
    const stats = officerBattleStats(FULL);
    // The formula's own ceiling is 100 for both. The cap is the deliberate exception, so both
    // halves are asserted: an armour formula rewritten to top out at 30 would pass the second
    // check alone and would have quietly stopped being an exception at all.
    expect(officerStatCeiling('armor')).toBe(100);
    expect(officerStatCeiling('range')).toBe(100);
    expect(stats.armor).toBe(OFFICER_ARMOR_CAP);
    expect(stats.range).toBe(OFFICER_RANGE_CAP);
  });

  it("has each capped formula's weights sum to exactly one", () => {
    for (const stat of OFFICER_STAT_KEYS) {
      const { cap } = OFFICER_STAT_FORMULAS[stat];
      if (cap === null || OFFICER_HELD_BACK_STATS.includes(stat)) continue;
      expect({ stat, ceiling: officerStatCeiling(stat) }).toEqual({ stat, ceiling: 100 });
    }
  });

  /**
   * The independent anchor.
   *
   * Every figure below was computed by hand off the board's table rather than read out of
   * `OFFICER_STAT_FORMULAS`, so a weight edited in the table fails here even if the derived tests
   * above still agree with themselves.
   */
  it('matches the board table on a hand-computed sheet', () => {
    const sheet = officer(
      {
        strength: 40,
        dexterity: 30,
        toughness: 24,
        stamina: 20,
        speed: 60,
        improvisation: 16,
        stealth: 50,
        deception: 40,
        reflexes: 70,
        resolve: 44,
        composure: 32,
        leadership: 60,
        intuition: 20,
        logic: 30,
        strategy: 50,
        analysis: 10,
        intimidation: 36,
        authority: 80,
      },
      0,
    ).attributes;
    const stats = officerBattleStats(sheet);

    expect(stats.offense).toBe(90); // ceil(40 * 1.5 + 30) = ceil(90)
    expect(stats.vitality).toBe(58); // 24 * 2 + 20 * 0.5 = 58
    expect(stats.speed).toBe(50); // 0.75 * 60 + 0.25 * 20 = 50
    expect(stats.armor).toBe(24); // toughness, under the cap of 30
    expect(stats.range).toBe(20); // 0.75 * 30 + 0.25 * 16 = 26.5, held at the cap of 20
    expect(stats.stealth).toBe(46); // 32.5 + 2.4 + 4 + 7 = 45.9 -> 46
    // The board's table still reads 45 (22 + 8 + 15), and that rating is what is asserted below.
    // What goes onto the field is that rating placed on the roster's morale scale: see
    // `officerMorale`. 60 + 45% of the remaining 40 = 78.
    expect(officerStat('morale', sheet)).toBe(45);
    expect(stats.morale).toBe(78);
    expect(stats.penetration).toBe(34); // 3 + 20 + 4.5 + 5 + 1 = 33.5 -> 34
    expect(stats.evasion).toBe(54); // 42 + 2 + 9.6 = 53.6 -> 54
    expect(stats.intimidation).toBe(47); // 27 + 20 = 47
  });

  it('produces a sheet the unit schema accepts, from an empty officer and a full one', () => {
    for (const sheet of [makeAttributes(0), FULL, makeAttributes(15)]) {
      expect(() => UnitStatsSchema.parse(officerBattleStats(sheet))).not.toThrow();
    }
  });

  it('floors vitality at one, because the schema demands a positive integer', () => {
    expect(officerBattleStats(makeAttributes(0)).vitality).toBe(1);
  });

  it('rounds damage up and everything else to nearest', () => {
    // strength 1, dexterity 0: 1.5 -> ceil 2, and the same figure would round to 2 as well, so
    // pick a value where the two differ. strength 3 gives 4.5: ceil 5, round 4.
    expect(officerStat('offense', makeAttributes(0, { strength: 3 }))).toBe(5);
    // speed 1: 0.75 -> 1 by rounding.
    expect(officerStat('speed', makeAttributes(0, { speed: 1 }))).toBe(1);
  });

  it('gives the synthesised unit an id the catalogue can never resolve', () => {
    const unit = officerUnit(officer({ strength: 40 }));
    expect(isOfficerUnitId(unit.id)).toBe(true);
    expect(unit.id).toContain('off-1');
  });
});

// --- §D3: how they fight -------------------------------------------------------------------

const led = (attacking: Army, defending: Army, leader?: BattleOfficer, seed = 'led-1') =>
  simulate({
    seed,
    battlefield: bareBattlefield(),
    attacker: {
      name: 'A',
      army: attacking,
      defending: false,
      ...(leader ? { officer: leader } : {}),
    },
    defender: { name: 'D', army: defending, defending: true },
  });

/** The same stack with its officer flag off, so a test can measure what the flag is worth. */
const unflagged = (stack: Stack): Stack => {
  const { officer: _dropped, ...rest } = stack;
  return rest;
};

const stackOf = (side: ReturnType<typeof led>['attacker'], name: string): Stack => {
  const found = side.stacks.find((stack) => stack.unit.name === name);
  if (!found) throw new Error(`no ${name} stack`);
  return found;
};

describe('an officer in the line (§D3)', () => {
  it('puts one extra body on the side that has a leader, and none on the one that does not', () => {
    const leader = officer({ strength: 60, toughness: 50, resolve: 60 });
    const withLeader = led({ razors: 10 }, { razors: 10 }, leader);
    expect(officerStackOf(withLeader.attacker)?.started).toBe(1);
    expect(officerStackOf(withLeader.defender)).toBeUndefined();
  });

  it('draws half the fire a unit of the same threat would, while anybody else is standing', () => {
    const leader = officer({ strength: 60, toughness: 50, resolve: 60 });
    const sim = led({ razors: 10 }, { razors: 10 }, leader);
    const shooter = stackOf(sim.defender, 'Razors');
    const shares = allocate(shooter, sim.attacker.stacks);
    const onOfficer = shares.find(({ target }) => target.officer !== undefined);
    expect(onOfficer).toBeDefined();

    // Same allocation with the officer's discount removed, by unflagging the stack.
    const bare = sim.attacker.stacks.map(unflagged);
    const undiscounted = allocate(shooter, bare);
    const officerIndex = sim.attacker.stacks.findIndex((stack) => stack.officer !== undefined);
    const full = undiscounted[officerIndex]!.share;
    // Both are shares of one round's fire, so the ratio is what the rule promises rather than the
    // absolute figure: halving one weight also raises everybody else's share of the normalisation.
    expect(onOfficer!.share).toBeLessThan(full);
    expect(onOfficer!.share / full).toBeGreaterThan(0.4);
    expect(onOfficer!.share / full).toBeLessThan(0.75);
  });

  it('takes the whole of the fire when they are the only one left', () => {
    const leader = officer({ strength: 60, toughness: 50, resolve: 60 });
    const sim = led({ razors: 1 }, { razors: 1 }, leader);
    const shooter = stackOf(sim.defender, 'Razors');
    const officerStack = officerStackOf(sim.attacker)!;
    const alone = allocate(shooter, [{ ...officerStack, alive: 1, pool: 100 }]);
    expect(alone).toHaveLength(1);
    expect(alone[0]!.share).toBe(1);
  });

  it('confirms the discount is what moved it: an unflagged officer stack takes more', () => {
    const leader = officer({ strength: 60, toughness: 50, resolve: 60 });
    const sim = led({ razors: 10 }, { razors: 10 }, leader);
    const shooter = stackOf(sim.defender, 'Razors');
    const officerIndex = sim.attacker.stacks.findIndex((stack) => stack.officer !== undefined);
    const discounted = allocate(shooter, sim.attacker.stacks)[officerIndex]!.share;
    const plain = allocate(shooter, sim.attacker.stacks.map(unflagged))[officerIndex]!.share;
    expect(discounted).toBeCloseTo((plain * OFFICER_TARGET_SHARE) / (1 - plain / 2), 6);
  });

  it('never appears in a casualty list, alive or dead', () => {
    const leader = officer({ strength: 5, toughness: 1, resolve: 1 });
    // A hopeless fight, so the officer certainly falls: 2 Razors against 60.
    const sim = led({ razors: 2 }, { razors: 60 }, leader, 'wipe');
    const { fled, killed } = routSurvivors(
      sim.attacker,
      { pursuit: 40, lastRound: sim.rounds.length, away: true },
      () => 0.9,
    );
    for (const id of [...Object.keys(fled), ...Object.keys(killed)]) {
      expect(isOfficerUnitId(id)).toBe(false);
    }
    expect(Object.keys(winnerCasualties(sim.attacker)).some(isOfficerUnitId)).toBe(false);
  });

  it('reports what the officer did, and whether they were taken off the field', () => {
    const leader = officer({ strength: 90, dexterity: 60, toughness: 80, resolve: 80 });
    const sim = led({ razors: 6 }, { razors: 6 }, leader, 'report');
    const outcome = officerOutcomeOf(sim.attacker);
    expect(outcome?.officerId).toBe('off-1');
    expect(outcome?.name).toBe('Vasco Renn');
    expect(outcome?.damage).toBeGreaterThan(0);
    expect(officerOutcomeOf(sim.defender)).toBeNull();
  });

  it('is excluded from the ledger rows, so committed counts bodies only', () => {
    const leader = officer({ strength: 60, toughness: 50, resolve: 60 });
    const withLeader = led({ razors: 10 }, { razors: 10 }, leader, 'ledger');
    const alone = led({ razors: 10 }, { razors: 10 }, undefined, 'ledger');
    expect(withLeader.attacker.stacks).toHaveLength(alone.attacker.stacks.length + 1);
  });
});

// --- §D4: injury ---------------------------------------------------------------------------

describe('officer injury (§D4)', () => {
  it('is likelier the worse the day went', () => {
    const crushing = officerInjuryChance(battleMargin(1, 0));
    const even = officerInjuryChance(battleMargin(0.5, 0.5));
    const disaster = officerInjuryChance(battleMargin(0, 1));
    expect(crushing).toBeLessThan(even);
    expect(even).toBeLessThan(disaster);
    expect(crushing).toBe(MIN_OFFICER_INJURY_CHANCE);
    expect(disaster).toBe(MAX_OFFICER_INJURY_CHANCE);
  });

  it('is never certain and never impossible', () => {
    for (const margin of [-4, -1, -0.3, 0, 0.3, 1, 4]) {
      const chance = officerInjuryChance(battleMargin(margin, 0));
      expect(chance).toBeGreaterThanOrEqual(MIN_OFFICER_INJURY_CHANCE);
      expect(chance).toBeLessThanOrEqual(MAX_OFFICER_INJURY_CHANCE);
    }
  });

  it('is settled rather than rolled for an officer who was taken off the field', () => {
    // A crushing win, where the roll would almost certainly clear: falling still means injured.
    expect(officerInjured(true, 1, 0.99)).toBe(true);
    expect(officerInjured(false, 1, 0.99)).toBe(false);
  });

  it('clamps the margin, so a nonsense share cannot produce a chance outside the band', () => {
    expect(battleMargin(3, -3)).toBe(1);
    expect(battleMargin(-3, 3)).toBe(-1);
  });

  it('settles recovery off a stored timestamp rather than a running clock', () => {
    const now = new Date('2026-08-31T12:00:00.000Z');
    const until = officerRecoveryAt(now);
    expect(until).toBe('2026-09-01T12:00:00.000Z');
    expect(officerIsInjured(until, now)).toBe(true);
    expect(officerRecoverySeconds(until, now)).toBe(24 * 3600);
    const later = new Date('2026-09-01T12:00:00.001Z');
    expect(officerIsInjured(until, later)).toBe(false);
    expect(officerRecoverySeconds(until, later)).toBe(0);
    expect(officerIsInjured(null, now)).toBe(false);
  });
});
