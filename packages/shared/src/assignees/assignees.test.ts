import { describe, expect, it } from 'vitest';
import { createCommander } from '../commander.js';
import { playerLevelGrants } from '../progression/grants.js';
import {
  ASSIGNEE_BONUS_PERCENT,
  MAX_ASSIGNEES_PER_OFFICER,
  OFFICERLESS_DURATION_MULTIPLIER,
  OFFICERLESS_SUCCESS_MULTIPLIER,
  assigneeBonus,
  assigneeBonusPercent,
  assigneeCapPerOfficer,
  assigneePool,
  assigneePowerMultiplier,
  assigneeReducedMinutes,
  assigneeSpeedMultiplier,
  assigneesUnder,
  canReskill,
  delegatedMinutes,
  delegatedSuccessChance,
  delegationTerms,
  placeAssignees,
  placedAssignees,
  pruneAssignees,
  reskillAssignees,
  startingAssignees,
  unplacedAssignees,
  AssigneeStateSchema,
} from './index.js';

const professor = createCommander('prof', 'Vela', 'professor');
const scout = createCommander('scout', 'Rix', 'scout');
const trader = createCommander('trader', 'Bex', 'trader');

describe('§G7 — the bonus table', () => {
  /**
   * The twelve percentages are written out here by hand, on purpose. Reading them back off
   * `ASSIGNEE_BONUS_PERCENT` would assert the table against itself and pass under any corruption
   * of it; W4 owns these numbers, so hard-coding them is the point of the test, not a smell.
   *
   * They are also not a curve. The step at n=6 is +5.5 after three +4.5 steps, and at n=12 it is
   * +5.0 after a +2.0 — if a future change "smooths" the table, these rows are what fails.
   */
  it.each([
    [1, 5],
    [2, 10],
    [3, 14.5],
    [4, 19],
    [5, 23.5],
    [6, 29],
    [7, 33],
    [8, 37],
    [9, 40],
    [10, 43],
    [11, 45],
    [12, 50],
  ])('%i assignees give %f%%', (count, percent) => {
    expect(assigneeBonusPercent(count)).toBe(percent);
  });

  /**
   * The board's twelve rows are the contract and must survive any extension: the table above this
   * is checked value-by-value, and this pins that the join did not move the milestone it ends on.
   */
  it('keeps the board’s twelve rows intact, ending at 50%', () => {
    expect(ASSIGNEE_BONUS_PERCENT.slice(0, 12)).toEqual([
      5, 10, 14.5, 19, 23.5, 29, 33, 37, 40, 43, 45, 50,
    ]);
    expect(assigneeBonusPercent(12)).toBe(50);
  });

  /** The extension rows (13–24), and the block milestones the board's own rhythm implies. */
  it('continues past twelve on the board’s rhythm, to 75% at 24', () => {
    expect(ASSIGNEE_BONUS_PERCENT).toHaveLength(24);
    expect(MAX_ASSIGNEES_PER_OFFICER).toBe(24);
    expect(assigneeBonusPercent(18)).toBe(65);
    expect(assigneeBonusPercent(24)).toBe(75);

    // Each block of six is worth less than the one before it: +29, +21, +15, +10.
    const at = (n: number) => assigneeBonusPercent(n);
    expect([at(6), at(12) - at(6), at(18) - at(12), at(24) - at(18)]).toEqual([29, 21, 15, 10]);
  });

  it('clamps past the end of the table — the 25th body is worth nothing', () => {
    for (const count of [25, 26, 40, 100, 1000]) {
      expect(assigneeBonusPercent(count)).toBe(75);
    }
  });

  /**
   * `assigneeSpeedMultiplier` is `1 - bonus`, so a 100% bonus would make every job take no time.
   * The table must stay clear of that by construction, not by the caller flooring the result.
   */
  it('never reaches a 100% bonus, at any row', () => {
    for (const percent of ASSIGNEE_BONUS_PERCENT) expect(percent).toBeLessThan(100);
    expect(assigneeSpeedMultiplier(MAX_ASSIGNEES_PER_OFFICER)).toBeGreaterThan(0);
  });

  it('is authored at the half-point granularity the board used', () => {
    for (const percent of ASSIGNEE_BONUS_PERCENT) expect(percent * 2).toBe(Math.round(percent * 2));
  });

  it('pays nothing for nobody, and never goes negative', () => {
    for (const count of [0, -1, -12]) {
      expect(assigneeBonusPercent(count)).toBe(0);
      expect(assigneeSpeedMultiplier(count)).toBe(1);
      expect(assigneePowerMultiplier(count)).toBe(1);
    }
  });

  it('is strictly increasing up to the cap', () => {
    for (let count = 2; count <= MAX_ASSIGNEES_PER_OFFICER; count += 1) {
      expect(assigneeBonusPercent(count)).toBeGreaterThan(assigneeBonusPercent(count - 1));
    }
  });

  it('keeps the two board bumps that a fitted curve would smooth away', () => {
    const step = (count: number) => assigneeBonusPercent(count) - assigneeBonusPercent(count - 1);
    expect(step(6)).toBeCloseTo(5.5, 10);
    expect(step(5)).toBeCloseTo(4.5, 10);
    expect(step(12)).toBeCloseTo(5, 10);
    expect(step(11)).toBeCloseTo(2, 10);
  });
});

describe('§G5 — the same table drives time and power', () => {
  it('reads one bonus for both, so they cannot drift', () => {
    for (let count = 0; count <= 13; count += 1) {
      const bonus = assigneeBonus(count);
      expect(assigneeSpeedMultiplier(count)).toBeCloseTo(1 - bonus, 10);
      expect(assigneePowerMultiplier(count)).toBeCloseTo(1 + bonus, 10);
    }
  });

  it('halves a job at the twelve-assignee maximum', () => {
    expect(assigneeSpeedMultiplier(12)).toBeCloseTo(0.5, 10);
    expect(assigneePowerMultiplier(12)).toBeCloseTo(1.5, 10);
    expect(assigneeReducedMinutes(480, 12)).toBe(240);
  });

  it('never reduces a job below one minute', () => {
    expect(assigneeReducedMinutes(1, 12)).toBe(1);
    expect(assigneeReducedMinutes(2, 12)).toBe(1);
    expect(assigneeReducedMinutes(3, 1)).toBe(3);
  });
});

describe('§G3/§G3a — the per-officer cap', () => {
  it('is 1 at the start and 2 from level 4', () => {
    expect(assigneeCapPerOfficer(1)).toBe(1);
    expect(assigneeCapPerOfficer(2)).toBe(1);
    expect(assigneeCapPerOfficer(3)).toBe(1);
    expect(assigneeCapPerOfficer(4)).toBe(2);
    expect(assigneeCapPerOfficer(5)).toBe(2);
    expect(assigneeCapPerOfficer(10)).toBe(5);
  });

  /**
   * §G3a has no ceiling and there is no maximum player level, so the entitlement climbs forever
   * while the §G7 table is finite. Placement stops where the table does — at whatever length it
   * has, not at a number written here — because the first assignee past the end is worth 0% and
   * would be stranded behind an officer with no feedback saying so.
   */
  it('follows the table’s length, not a hardcoded number', () => {
    // The grant itself stays uncapped: the two readings are separable on purpose.
    expect(playerLevelGrants(40).assigneeCapPerOfficer).toBe(20);
    expect(playerLevelGrants(100).assigneeCapPerOfficer).toBe(50);

    // Below the table's end the grant governs; above it, the table does.
    expect(assigneeCapPerOfficer(24)).toBe(12);
    expect(assigneeCapPerOfficer(2 * MAX_ASSIGNEES_PER_OFFICER)).toBe(MAX_ASSIGNEES_PER_OFFICER);
    expect(assigneeCapPerOfficer(500)).toBe(MAX_ASSIGNEES_PER_OFFICER);
  });
});

describe('§G8 — the pool', () => {
  it('starts at 2 and grows by 1 a level, +1 more every fifth', () => {
    expect(assigneePool(1)).toBe(2);
    expect(assigneePool(2)).toBe(3);
    expect(assigneePool(4)).toBe(5);
    // Level 5 pays the +1 per level *and* the fifth-level extra.
    expect(assigneePool(5)).toBe(7);
    expect(assigneePool(10)).toBe(13);
  });

  it('counts placed and unplaced against that one pool', () => {
    const state = { placements: { scout: 2, trader: 1 } };
    expect(placedAssignees(state)).toBe(3);
    expect(assigneesUnder(state, 'scout')).toBe(2);
    expect(assigneesUnder(state, 'nobody')).toBe(0);
    expect(unplacedAssignees(state, 5)).toBe(4);
    expect(unplacedAssignees(state, 1)).toBe(0);
  });
});

describe('§G2 — placing what a level-up handed over', () => {
  const officers = [scout, trader, professor];

  it('places into an empty crew', () => {
    const result = placeAssignees(startingAssignees(), {
      officers,
      commanderId: 'scout',
      count: 1,
      level: 1,
    });
    expect(result).toEqual({ kind: 'placed', state: { placements: { scout: 1 } } });
  });

  it('refuses an officer who is not on the books', () => {
    const result = placeAssignees(startingAssignees(), {
      officers,
      commanderId: 'ghost',
      count: 1,
      level: 10,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'unknown_officer' });
  });

  it('refuses to place more than the pool has left', () => {
    // Level 1 grants 2; one is already out.
    const result = placeAssignees(
      { placements: { trader: 1 } },
      { officers, commanderId: 'scout', count: 2, level: 1 },
    );
    expect(result).toEqual({ kind: 'refused', reason: 'not_enough_unplaced' });
  });

  it('refuses to pass the §G3 cap even with pool to spare', () => {
    // Level 3: pool 4, cap 1.
    const result = placeAssignees(
      { placements: { scout: 1 } },
      { officers, commanderId: 'scout', count: 1, level: 3 },
    );
    expect(result).toEqual({ kind: 'refused', reason: 'at_cap' });
  });

  it('refuses non-positive and fractional counts', () => {
    for (const count of [0, -1, 1.5]) {
      expect(
        placeAssignees(startingAssignees(), { officers, commanderId: 'scout', count, level: 10 }),
      ).toEqual({ kind: 'refused', reason: 'not_positive' });
    }
  });

  it('never takes an assignee back — that is §G4 reskilling', () => {
    const placed = placeAssignees(startingAssignees(), {
      officers,
      commanderId: 'scout',
      count: 1,
      level: 10,
    });
    expect(placed.kind).toBe('placed');
    // There is no argument that could shrink `scout` here; the only refusals are the four above.
    const shrink = placeAssignees(
      { placements: { scout: 2 } },
      { officers, commanderId: 'scout', count: -1, level: 10 },
    );
    expect(shrink).toEqual({ kind: 'refused', reason: 'not_positive' });
  });

  it('returns an officer’s assignees to the pool when they leave the books', () => {
    const state = { placements: { scout: 2, trader: 1 } };
    expect(pruneAssignees(state, [scout, professor])).toEqual({ placements: { scout: 2 } });
    expect(unplacedAssignees(pruneAssignees(state, [scout, professor]), 5)).toBe(5);
  });
});

describe('§G4/§C4 — reskilling is the Professor’s process', () => {
  it('needs a Professor on the books', () => {
    expect(canReskill([scout, trader])).toBe(false);
    expect(canReskill([scout, professor])).toBe(true);
    expect(reskillAssignees({ officers: [scout, trader], plan: { scout: 1 }, level: 10 })).toEqual({
      kind: 'refused',
      reason: 'no_professor',
    });
  });

  it('reassigns everyone at once, and an officer left out of the plan ends with nobody', () => {
    const result = reskillAssignees({
      officers: [scout, trader, professor],
      plan: { trader: 2 },
      level: 10,
    });
    expect(result).toEqual({ kind: 'reskilled', state: { placements: { trader: 2 } } });
  });

  it('is the only way an assignee comes back off an officer', () => {
    const before = { placements: { scout: 3 } };
    const after = reskillAssignees({
      officers: [scout, trader, professor],
      plan: { scout: 1, trader: 2 },
      level: 10,
    });
    expect(placedAssignees(before)).toBe(3);
    expect(after).toEqual({ kind: 'reskilled', state: { placements: { scout: 1, trader: 2 } } });
  });

  it('drops zero counts rather than storing them', () => {
    const result = reskillAssignees({
      officers: [scout, trader, professor],
      plan: { scout: 0, trader: 2 },
      level: 10,
    });
    expect(result).toEqual({ kind: 'reskilled', state: { placements: { trader: 2 } } });
  });

  it('refuses a plan that breaks the cap or the pool, and applies none of it', () => {
    const officers = [scout, trader, professor];
    // Level 4: cap 2, pool 5.
    expect(reskillAssignees({ officers, plan: { scout: 3 }, level: 4 })).toEqual({
      kind: 'refused',
      reason: 'at_cap',
    });
    // Level 4: three officers × 2 = 6 placed, but the pool only holds 5.
    expect(
      reskillAssignees({ officers, plan: { scout: 2, trader: 2, prof: 2 }, level: 4 }),
    ).toEqual({ kind: 'refused', reason: 'over_pool' });
    expect(reskillAssignees({ officers, plan: { ghost: 1 }, level: 10 })).toEqual({
      kind: 'refused',
      reason: 'unknown_officer',
    });
  });
});

describe('§G6 — hard needs an officer, easy can go without', () => {
  it('refuses a hard job with nobody in charge', () => {
    const terms = delegationTerms({ difficulty: 'hard', hasOfficer: false, assignees: 12 });
    expect(terms.allowed).toBe(false);
    expect(terms.refusal).toBe('needs_officer');
  });

  it('allows a hard job the moment an officer leads it', () => {
    const terms = delegationTerms({ difficulty: 'hard', hasOfficer: true, assignees: 0 });
    expect(terms).toMatchObject({ allowed: true, refusal: null });
    expect(terms.durationMultiplier).toBe(1);
    expect(terms.successMultiplier).toBe(1);
  });

  it('lets assignees alone run an easy job — slower and with worse odds', () => {
    const alone = delegationTerms({ difficulty: 'easy', hasOfficer: false, assignees: 2 });
    const led = delegationTerms({ difficulty: 'easy', hasOfficer: true, assignees: 2 });

    expect(alone.allowed).toBe(true);
    expect(alone.durationMultiplier).toBeGreaterThan(led.durationMultiplier);
    expect(alone.successMultiplier).toBeLessThan(led.successMultiplier);
    expect(alone.durationMultiplier).toBeCloseTo(0.9 * OFFICERLESS_DURATION_MULTIPLIER, 10);
    expect(alone.successMultiplier).toBeCloseTo(1.1 * OFFICERLESS_SUCCESS_MULTIPLIER, 10);
  });

  it('refuses an easy job with nobody at all to send', () => {
    expect(delegationTerms({ difficulty: 'easy', hasOfficer: false, assignees: 0 })).toMatchObject({
      allowed: false,
      refusal: 'nobody_to_send',
    });
  });

  /**
   * The §G6 invariant, at every crew size the table covers: holding the people fixed, losing the
   * officer is strictly slower and strictly worse odds. That — not a comparison against some other
   * crew — is what "slower and with a lower success chance" fixes.
   */
  it('is strictly worse on both axes for the same crew, at every size', () => {
    for (let assignees = 1; assignees <= MAX_ASSIGNEES_PER_OFFICER; assignees += 1) {
      const alone = delegationTerms({ difficulty: 'easy', hasOfficer: false, assignees });
      const led = delegationTerms({ difficulty: 'easy', hasOfficer: true, assignees });
      expect(alone.durationMultiplier).toBeGreaterThan(led.durationMultiplier);
      expect(alone.successMultiplier).toBeLessThan(led.successMultiplier);
    }
  });

  it('applies the terms to a clock and to odds, clamped', () => {
    const led = delegationTerms({ difficulty: 'easy', hasOfficer: true, assignees: 12 });
    expect(delegatedMinutes(60, led)).toBe(30);
    expect(delegatedMinutes(1, led)).toBe(1);
    // 0.97 × 1.5 would be 1.455 — a chance can never pass certainty.
    expect(delegatedSuccessChance(0.97, led)).toBe(1);
    expect(delegatedSuccessChance(0.5, led)).toBeCloseTo(0.75, 10);
    expect(delegatedSuccessChance(0, led)).toBe(0);
  });
});

describe('AssigneeStateSchema', () => {
  it('accepts a placement map and rejects a negative or fractional count', () => {
    expect(AssigneeStateSchema.parse({ placements: { scout: 3 } })).toEqual({
      placements: { scout: 3 },
    });
    expect(AssigneeStateSchema.safeParse({ placements: { scout: -1 } }).success).toBe(false);
    expect(AssigneeStateSchema.safeParse({ placements: { scout: 1.5 } }).success).toBe(false);
    // Zero is not a stored value — an empty officer is an absent key (one shape per arrangement).
    expect(AssigneeStateSchema.safeParse({ placements: { scout: 0 } }).success).toBe(false);
  });
});
