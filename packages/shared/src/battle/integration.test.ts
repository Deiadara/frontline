import { describe, expect, it } from 'vitest';
import { findUnit, type Army } from '../units/index.js';
import {
  bareBattlefield,
  battlefieldFor,
  homeBattlefield,
  type Battlefield,
} from './battlefield.js';
import { simulate, type Simulation } from './engine.js';
import { LUCK_LIMIT } from './luck.js';
import { moraleState } from './morale.js';
import { FINDING_KINDS, FINDING_VISIBILITIES } from './report.js';
import { TacticalSkirmishEngine, type SkirmishOutcome } from './skirmish.js';

/**
 * Whole fights, end to end, checked at every step.
 *
 * The other suites each pin one rule. This one runs the real engine over a spread of real rosters
 * and asserts the things that have to be true of *any* fight however the rules change: that every
 * body is accounted for, that nothing gains health or bodies, that a broken stack stops fighting,
 * that the report describes the simulation that actually happened.
 *
 * These are the tests that catch a bug nobody thought to look for. A unit test knows what it is
 * checking; a conservation law does not have to.
 */

const engine = new TacticalSkirmishEngine();

const DAY = new Date('2026-08-14T13:00:00Z');
const NIGHT = new Date('2026-08-14T23:30:00Z');

const total = (force: Army): number => Object.values(force).reduce((sum, n) => sum + n, 0);

/** A spread that exercises every mechanic: reach, closing, resistance, terror, width, ambush. */
const SCENARIOS: { name: string; attacking: Army; defending: Army; ground: Battlefield }[] = [
  {
    name: 'a mixed assault on a fortified sewer',
    attacking: { razors: 20, snipers: 6, breakers: 4 },
    defending: { wardens: 10, ironsides: 4 },
    ground: battlefieldFor({
      locationName: 'The Sump',
      kind: 'sewer_junction',
      fortifyDifficulty: 'medium',
      fortifyLevel: 3,
      at: NIGHT,
    }),
  },
  {
    name: 'fast units running down shooters in the open',
    attacking: { road_reavers: 12 },
    defending: { snipers: 14, kite_crews: 6 },
    ground: battlefieldFor({
      locationName: 'The Yard',
      kind: 'rail_yard',
      fortifyDifficulty: 'hard',
      fortifyLevel: 0,
      at: DAY,
    }),
  },
  {
    name: 'terror against a fragile line',
    attacking: { hollow_men: 4, razors: 14 },
    defending: { sparks: 24 },
    ground: homeBattlefield('Kettle Row', DAY),
  },
  {
    name: 'an ambush indoors',
    attacking: { scrapers: 18, ghosts: 6 },
    defending: { stitchers: 4, wardens: 8 },
    ground: battlefieldFor({
      locationName: 'The Armoury',
      kind: 'armory',
      fortifyDifficulty: 'easy',
      fortifyLevel: 5,
      at: NIGHT,
    }),
  },
  {
    name: 'a legendary against a horde',
    attacking: { razors: 60 },
    defending: { the_colossus: 1, ironsides: 6 },
    ground: battlefieldFor({
      locationName: 'The Graveyard',
      kind: 'war_machine_graveyard',
      fortifyDifficulty: 'medium',
      fortifyLevel: 1,
      at: DAY,
    }),
  },
  {
    name: 'an undefended location',
    attacking: { razors: 8 },
    defending: {},
    ground: battlefieldFor({
      locationName: 'The Press',
      kind: 'scrap_press',
      fortifyDifficulty: 'easy',
      fortifyLevel: 0,
      at: DAY,
    }),
  },
];

const run = (scenario: (typeof SCENARIOS)[number], seed: number): Simulation =>
  simulate({
    seed: `${scenario.name}-${seed}`,
    battlefield: scenario.ground,
    attacker: { name: 'The Ninth Street Crew', army: scenario.attacking, defending: false },
    defender: { name: 'the looters', army: scenario.defending, defending: true },
  });

const resolve = (scenario: (typeof SCENARIOS)[number], seed: number): SkirmishOutcome =>
  engine.resolve({
    seed: `${scenario.name}-${seed}`,
    attackerName: 'The Ninth Street Crew',
    defenderName: 'the looters',
    locationName: scenario.ground.locationName,
    attacking: scenario.attacking,
    defending: scenario.defending,
    battlefield: scenario.ground,
  });

describe.each(SCENARIOS.map((scenario) => [scenario.name, scenario] as const))(
  '%s',
  (_name, scenario) => {
    const seeds = [0, 1, 2, 3, 4];

    it('starts with exactly the force it was given', () => {
      for (const seed of seeds) {
        const simulation = run(scenario, seed);
        const started = (side: Simulation['attacker']) =>
          side.stacks.reduce((sum, stack) => sum + stack.started, 0);
        expect(started(simulation.attacker)).toBe(total(scenario.attacking));
        expect(started(simulation.defender)).toBe(total(scenario.defending));
      }
    });

    it('never gains a body or a point of health at any step', () => {
      for (const seed of seeds) {
        const simulation = run(scenario, seed);
        for (const side of [simulation.attacker, simulation.defender]) {
          for (const stack of side.stacks) {
            expect(stack.alive, stack.unit.id).toBeLessThanOrEqual(stack.started);
            expect(stack.alive, stack.unit.id).toBeGreaterThanOrEqual(0);
            expect(stack.pool, stack.unit.id).toBeLessThanOrEqual(
              stack.alive * stack.effective.vitality + 1e-9,
            );
            expect(stack.pool, stack.unit.id).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });

    it('keeps every stack on the morale scale, and its state consistent with it', () => {
      for (const seed of seeds) {
        const simulation = run(scenario, seed);
        for (const side of [simulation.attacker, simulation.defender]) {
          for (const stack of side.stacks) {
            expect(stack.morale).toBeGreaterThanOrEqual(0);
            expect(stack.morale).toBeLessThanOrEqual(100);
            // A stack is marked broken if and only if its morale actually ran out.
            if (stack.brokeAt !== null) expect(moraleState(stack.morale)).toBe('routed');
          }
        }
      }
    });

    it('numbers its rounds one to n, in order, and stops at the cap', () => {
      for (const seed of seeds) {
        const simulation = run(scenario, seed);
        expect(simulation.rounds.map((record) => record.round)).toEqual(
          simulation.rounds.map((_, index) => index + 1),
        );
        expect(simulation.rounds.length).toBeLessThanOrEqual(12);
        for (const record of simulation.rounds) {
          expect(record.attackerLost).toBeGreaterThanOrEqual(0);
          expect(record.defenderLost).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('never breaks a stack twice, and never before the fight starts', () => {
      for (const seed of seeds) {
        const simulation = run(scenario, seed);
        const rounds = simulation.rounds.length;
        for (const side of [simulation.attacker, simulation.defender]) {
          for (const stack of side.stacks) {
            if (stack.brokeAt === null) continue;
            expect(stack.brokeAt).toBeGreaterThanOrEqual(1);
            expect(stack.brokeAt).toBeLessThanOrEqual(rounds);
          }
        }
        // A stack is reported as breaking in exactly one round's record.
        const announced = simulation.rounds.flatMap((record) => [
          ...record.attackerBroke,
          ...record.defenderBroke,
        ]);
        expect(new Set(announced).size).toBe(announced.length);
      }
    });

    it('draws a luck roll inside the range for both sides', () => {
      for (const seed of seeds) {
        const { luck } = run(scenario, seed);
        for (const roll of [luck.attacker, luck.defender]) {
          expect(roll).toBeGreaterThanOrEqual(-LUCK_LIMIT);
          expect(roll).toBeLessThanOrEqual(LUCK_LIMIT);
          expect(Math.abs(roll * 10 - Math.round(roll * 10))).toBeLessThan(1e-9);
        }
      }
    });

    it('accounts for every body the loser brought', () => {
      for (const seed of seeds) {
        const outcome = resolve(scenario, seed);
        const brought =
          outcome.winner === 'attacker' ? total(scenario.defending) : total(scenario.attacking);
        expect(total(outcome.fled) + total(outcome.killed)).toBe(brought);
      }
    });

    it('never costs the winner more than it brought', () => {
      for (const seed of seeds) {
        const outcome = resolve(scenario, seed);
        const brought = outcome.winner === 'attacker' ? scenario.attacking : scenario.defending;
        for (const [unitId, lost] of Object.entries(outcome.winnerLosses)) {
          expect(lost, unitId).toBeLessThanOrEqual(brought[unitId] ?? 0);
          expect(lost, unitId).toBeGreaterThan(0);
        }
      }
    });

    it('never returns a unit nobody brought', () => {
      for (const seed of seeds) {
        const outcome = resolve(scenario, seed);
        const loser = outcome.winner === 'attacker' ? scenario.defending : scenario.attacking;
        for (const force of [outcome.fled, outcome.killed]) {
          for (const [unitId, count] of Object.entries(force)) {
            expect(loser[unitId], `${unitId} was never on this field`).toBeGreaterThanOrEqual(
              count,
            );
            expect(findUnit(unitId), unitId).toBeDefined();
          }
        }
      }
    });

    it('reports a log that describes the fight that happened', () => {
      for (const seed of seeds) {
        const outcome = resolve(scenario, seed);
        expect(outcome.log.length).toBeGreaterThan(1);
        expect(outcome.log.join(' ')).toContain(scenario.ground.locationName);
        expect(outcome.log.some((line) => line.trim() === '')).toBe(false);
        // The last line always accounts for the bodies.
        expect(outcome.log.at(-1)).toMatch(/lost on the ground|did not|broke and ran/);
      }
    });

    it('reports a standing readout covering every stack that turned up', () => {
      for (const seed of seeds) {
        const outcome = resolve(scenario, seed);
        expect(outcome.standing.attacker).toHaveLength(Object.keys(scenario.attacking).length);
        expect(outcome.standing.defender).toHaveLength(Object.keys(scenario.defending).length);
        for (const row of [...outcome.standing.attacker, ...outcome.standing.defender]) {
          expect(row.left).toBeGreaterThanOrEqual(0);
          expect(row.name.length).toBeGreaterThan(0);
        }
      }
    });

    it('tags every finding with a side, a kind and a visibility', () => {
      for (const seed of seeds) {
        for (const finding of resolve(scenario, seed).findings) {
          expect(['attacker', 'defender']).toContain(finding.side);
          // Against the enum rather than a list typed out here. This said `['ground',
          // 'engagement', 'resistance', 'morale']`, which is four of the five kinds `report.ts`
          // defines: it was not asserting that findings are well tagged, it was asserting that no
          // scenario in this file happens to produce a `support` finding, and it went red the first
          // time one did. The schema is the contract for what a kind may be.
          expect(FINDING_KINDS).toContain(finding.kind);
          expect(FINDING_VISIBILITIES).toContain(finding.visibility);
          expect(finding.text.length).toBeGreaterThan(0);
        }
      }
    });

    it('replays byte for byte from the same seed', () => {
      for (const seed of seeds) {
        expect(resolve(scenario, seed)).toEqual(resolve(scenario, seed));
      }
    });
  },
);

describe('across every scenario at once', () => {
  const everything = SCENARIOS.flatMap((scenario) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((seed) => ({ scenario, simulation: run(scenario, seed) })),
  );

  it('always finishes with somebody holding the ground', () => {
    for (const { simulation } of everything) {
      expect(['attacker', 'defender']).toContain(simulation.winner);
    }
  });

  it('takes bodies off a stack the round it breaks', () => {
    for (const { simulation } of everything) {
      for (const side of [simulation.attacker, simulation.defender]) {
        for (const stack of side.stacks.filter((candidate) => candidate.brokeAt !== null)) {
          // Pursuit takes a share the round it breaks, so a broken stack cannot be untouched.
          expect(stack.alive, stack.unit.id).toBeLessThan(stack.started);
        }
      }
    }
  });

  /**
   * A broken stack is out of the fight, and the only way to see that is in what it stops doing.
   *
   * Measured as the drop in the *enemy's* losses across the round a stack breaks. An earlier
   * version of this asserted that broken stacks had lost bodies, which is true of pursuit and says
   * nothing about firing: it passed with the exclusion deleted outright.
   *
   * Sparks break early (morale 30) and Wardens hold (70), so the defence loses most of its output
   * mid-fight while still having bodies on the field. Measured: the attacker's losses fall from
   * ~11% a round to ~3% the round after.
   */
  it('stops a broken stack contributing to the fight', () => {
    let compared = 0;
    for (let seed = 0; seed < 6; seed += 1) {
      const simulation = simulate({
        seed: `silence-${seed}`,
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: { razors: 44 }, defending: false },
        defender: { name: 'D', army: { sparks: 26, wardens: 6 }, defending: true },
      });

      const broke = simulation.rounds.findIndex((record) => record.defenderBroke.length > 0);
      if (broke < 0 || simulation.rounds.length < broke + 3) continue;
      compared += 1;

      const before = simulation.rounds[broke]?.attackerLost ?? 0;
      const after = simulation.rounds[broke + 2]?.attackerLost ?? 0;
      expect(after, `seed ${seed}: the broken stack kept shooting`).toBeLessThan(before * 0.6);
    }
    expect(compared, 'no seed produced a mid-fight collapse to measure').toBeGreaterThan(0);
  });

  it('never reports a loss share outside nothing-to-everything', () => {
    for (const { simulation } of everything) {
      for (const record of simulation.rounds) {
        expect(record.attackerLost).toBeLessThanOrEqual(1.0001);
        expect(record.defenderLost).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it('only claims an opening strike where somebody could set one', () => {
    for (const { scenario, simulation } of everything) {
      const ambushers = Object.keys(scenario.attacking).filter((unitId) =>
        findUnit(unitId)?.modifiers.includes('ambush'),
      );
      if (ambushers.length === 0) expect(simulation.openingStrike).toBe(0);
      expect(simulation.openingStrike).toBeGreaterThanOrEqual(0);
      expect(simulation.openingStrike).toBeLessThanOrEqual(1);
    }
  });

  it('produces different fights from different seeds', () => {
    for (const scenario of SCENARIOS) {
      if (total(scenario.defending) === 0) continue;
      const shapes = new Set(
        [0, 1, 2, 3, 4, 5, 6, 7].map((seed) => {
          const simulation = run(scenario, seed);
          return `${simulation.winner}:${simulation.rounds.length}:${simulation.luck.attacker}`;
        }),
      );
      expect(shapes.size, scenario.name).toBeGreaterThan(1);
    }
  });
});
