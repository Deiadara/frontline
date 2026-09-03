import { describe, expect, it } from 'vitest';
import {
  BUILDING_MAX_LEVEL,
  MAX_DAMAGE_PENALTY,
  MIN_STRIKE_DAMAGE,
  MAX_STRIKE_DAMAGE,
  RECOVERY_PER_LEVEL,
  buildingEffectiveness,
  buildingProduction,
  damageBuilding,
  districtDefense,
  gateDefensePercent,
  gateIntelResistancePercent,
  repairedByBuilding,
  strikeDamage,
  type Building,
} from '../building/index.js';
import {
  capturedGateDefensePercent,
  capturedGateIntelResistancePercent,
  noTerritoryEffects,
} from '../city/index.js';
import { blurredCount } from '../crew/index.js';
import { analyseBattle, reportReaches } from './analysis.js';
import { bareBattlefield } from './battlefield.js';
import {
  MAX_COHESION_WIDTH,
  effectiveFrontage,
  engagedBodies,
  simulate,
  type SideSetup,
  type SideState,
} from './engine.js';
import {
  INTEL_BLACKOUT_PERCENT,
  deploymentBlurPercent,
  forceStealth,
  intelQualityLine,
  observedForceSize,
} from './intel.js';
import { PERIMETER_FLEE_PENALTY, breakOut, perimeterFights } from './perimeter.js';
import { pursuitSpeed, routSurvivors } from './rout.js';
import { mulberry32, seedFrom } from '../rng.js';
import {
  BATTLE_SLOT_MINUTES,
  MAX_DECLARE_LEAD_HOURS,
  MIN_DECLARE_LEAD_HOURS,
  declarableSlots,
  declarationWindow,
  deploymentIsOpen,
  isOnSlot,
  scheduleRefusal,
  slotAtOrAfter,
  slotAtOrBefore,
} from './schedule.js';
import {
  GATE_BREACH_HOURS,
  breachExpiry,
  declarationRefusal,
  deployedSize,
  gateArmed,
  gateIsBroken,
  isBattleDue,
  type BattleTarget,
  type ScheduledBattle,
} from './scheduled.js';
import { TRAP_CATALOG, findTrap, springTrap, trapsAvailable } from './traps.js';

const NOON = new Date('2026-08-16T12:00:00.000Z');
const at = (iso: string): Date => new Date(iso);

describe('when a fight may be called for (§A4)', () => {
  it('rounds to the half hour in both directions without ever widening the window', () => {
    expect(slotAtOrAfter(at('2026-08-16T12:00:00.000Z')).toISOString()).toBe(
      '2026-08-16T12:00:00.000Z',
    );
    expect(slotAtOrAfter(at('2026-08-16T12:00:00.001Z')).toISOString()).toBe(
      '2026-08-16T12:30:00.000Z',
    );
    expect(slotAtOrBefore(at('2026-08-16T12:29:59.999Z')).toISOString()).toBe(
      '2026-08-16T12:00:00.000Z',
    );
  });

  /** The board's own worked example: at 12:00 the first mark you may call is 20:00. */
  it('opens eight hours out and shuts a day out, exactly as the board stated it', () => {
    const window = declarationWindow(NOON);
    expect(window.earliest.toISOString()).toBe('2026-08-16T20:00:00.000Z');
    expect(window.latest.toISOString()).toBe('2026-08-17T12:00:00.000Z');
  });

  it('offers every half-hour mark inside the window and nothing outside it', () => {
    const slots = declarableSlots(NOON);
    const spanMinutes = (MAX_DECLARE_LEAD_HOURS - MIN_DECLARE_LEAD_HOURS) * 60;
    expect(slots).toHaveLength(spanMinutes / BATTLE_SLOT_MINUTES + 1);
    for (const slot of slots) {
      expect(isOnSlot(slot), slot.toISOString()).toBe(true);
      expect(scheduleRefusal(slot, NOON), slot.toISOString()).toBeNull();
    }
  });

  it('refuses a time between the marks before it complains about the clock', () => {
    // Off-slot is the refusal a client can fix by picking from the list it was handed; telling
    // somebody their 20:47 is eight minutes early sends them looking in the wrong direction.
    expect(scheduleRefusal(at('2026-08-16T20:47:00.000Z'), NOON)).toBe('off_slot');
    expect(scheduleRefusal(at('2026-08-16T19:00:00.000Z'), NOON)).toBe('too_soon');
    expect(scheduleRefusal(at('2026-08-17T12:30:00.000Z'), NOON)).toBe('too_late');
  });

  it('holds the boundaries themselves open', () => {
    expect(scheduleRefusal(at('2026-08-16T20:00:00.000Z'), NOON)).toBeNull();
    expect(scheduleRefusal(at('2026-08-17T12:00:00.000Z'), NOON)).toBeNull();
    expect(scheduleRefusal(at('2026-08-16T19:30:00.000Z'), NOON)).toBe('too_soon');
  });

  /** "Up to one second before the fight": the board's rule, stated literally. */
  it('keeps deployment open until one second before the mark, and shuts it after', () => {
    const mark = at('2026-08-16T20:00:00.000Z');
    expect(deploymentIsOpen(mark, at('2026-08-16T19:59:59.000Z'))).toBe(true);
    expect(deploymentIsOpen(mark, at('2026-08-16T19:59:59.001Z'))).toBe(false);
    expect(deploymentIsOpen(mark, mark)).toBe(false);
  });
});

describe('what may be declared against (§A4)', () => {
  const location: BattleTarget = { kind: 'location', districtId: 'd', locationId: 'p' };
  const gate: BattleTarget = { kind: 'gate', districtId: 'd' };
  const building: BattleTarget = { kind: 'building', districtId: 'd', buildingId: 'b' };

  it('sends you at the gate when one party holds the whole district', () => {
    const shut = { shut: true, breached: false, inhabited: true };
    expect(declarationRefusal(location, shut)).toBe('gate_armed');
    expect(declarationRefusal(gate, shut)).toBeNull();
  });

  it('has no gate to break when the district is split', () => {
    const open = { shut: false, breached: false, inhabited: true };
    expect(declarationRefusal(gate, open)).toBe('no_gate');
    expect(declarationRefusal(location, open)).toBeNull();
  });

  it('keeps the structures behind a standing gate out of reach, and opens them once it is down', () => {
    expect(declarationRefusal(building, { shut: true, breached: false, inhabited: true })).toBe(
      'gate_intact',
    );
    expect(
      declarationRefusal(building, { shut: true, breached: true, inhabited: true }),
    ).toBeNull();
  });

  it('has nothing to break in a breached district nobody lives in', () => {
    expect(declarationRefusal(building, { shut: true, breached: true, inhabited: false })).toBe(
      'nothing_to_break',
    );
  });

  /** A breach re-opens the ordinary route in as well: the door is off its hinges. */
  it('lets locations be attacked again while the gate is down', () => {
    expect(
      declarationRefusal(location, { shut: true, breached: true, inhabited: true }),
    ).toBeNull();
  });

  it('reads an armed gate off who holds the ground, and never off unoccupied ground', () => {
    expect(gateArmed({ kind: 'crew', baseId: 'b1' })).toBe(true);
    expect(gateArmed({ kind: 'government' })).toBe(true);
    expect(gateArmed({ kind: 'unoccupied' })).toBe(false);
    expect(gateArmed(null)).toBe(false);
  });

  it('keeps a breach open for a day and not a minute longer', () => {
    // Anchored to the board's own number rather than to the constant: deriving the expectation
    // from `GATE_BREACH_HOURS` makes this test agree with any retune of it, including one that
    // shortens a siege window to an hour.
    expect(GATE_BREACH_HOURS).toBe(24);
    const until = breachExpiry(NOON);
    expect(Date.parse(until) - NOON.getTime()).toBe(GATE_BREACH_HOURS * 3_600_000);
    expect(gateIsBroken({ districtId: 'd', brokenUntil: until }, NOON)).toBe(true);
    expect(gateIsBroken({ districtId: 'd', brokenUntil: until }, new Date(Date.parse(until)))).toBe(
      false,
    );
    expect(gateIsBroken({ districtId: 'd', brokenUntil: null }, NOON)).toBe(false);
    expect(gateIsBroken(undefined, NOON)).toBe(false);
  });
});

describe('a declared battle', () => {
  const battle: ScheduledBattle = {
    id: 'b1',
    target: { kind: 'location', districtId: 'd', locationId: 'p' },
    attackerBaseId: 'a1',
    defender: { kind: 'looters' },
    scheduledFor: '2026-08-16T20:00:00.000Z',
    declaredAt: NOON.toISOString(),
    resolvedAt: null,
    seed: 'seed',
    holdAfterCapture: false,
  };

  it('comes due on the mark and not before, and never twice', () => {
    expect(isBattleDue(battle, at('2026-08-16T19:59:59.999Z'))).toBe(false);
    expect(isBattleDue(battle, at('2026-08-16T20:00:00.000Z'))).toBe(true);
    expect(isBattleDue({ ...battle, resolvedAt: '2026-08-16T20:00:00.000Z' }, NOON)).toBe(false);
  });

  it('counts both forces as committed, because both left the roster', () => {
    expect(deployedSize({ army: { razors: 10, snipers: 2 }, perimeter: { road_reavers: 3 } })).toBe(
      15,
    );
  });
});

describe('the ring outside the fight (§A4)', () => {
  const stream = () => mulberry32(seedFrom('ring'));
  // No `battlefield`: omitted is open ground, and `exactOptionalPropertyTypes` refuses an explicit
  // `undefined` for an optional property.
  const bare = {
    seed: 'ring-test',
    context: { pursuit: 0, lastRound: 3, away: true },
  };
  const bodies = (army: Record<string, number>): number =>
    Object.values(army).reduce((sum, count) => sum + count, 0);

  /**
   * One real lost fight, routed at a given hardship.
   *
   * A real simulation rather than a hand-built `SideState`, so the stacks carry the sheets the
   * chance is computed from. The fight is the same every call: only the stream and the multiplier
   * move, which is what makes the two totals comparable.
   */
  const routSurvivorsAt = (hardship: number, next: () => number) => {
    const fight = simulate({
      seed: 'penalty-fight',
      attacker: { name: 'a', army: { razors: 30 }, defending: false },
      defender: { name: 'b', army: { wardens: 40 }, defending: true },
    });
    const loser = fight.winner === 'attacker' ? fight.defender : fight.attacker;
    return routSurvivors(
      loser,
      { pursuit: 0, lastRound: fight.rounds.length, away: true, hardship },
      next,
    );
  };

  it('does nothing at all when nobody set one, and draws nothing either', () => {
    const used = stream();
    const untouched = stream();
    used();
    untouched();

    const out = breakOut({ ...bare, fleeing: { razors: 20 }, ring: {} }, used);
    expect(out.caught).toEqual({});
    expect(out.escaped).toEqual({ razors: 20 });
    expect(out.ringLosses).toEqual({});
    expect(out.rounds, 'a fight happened with nobody to fight').toBe(0);
    // An absent ring must not consume a draw. The breakout sits inside the rout stream, so a ring
    // nobody set would otherwise shift every historical fight's survivors by one draw.
    expect(used()).toBe(untouched());
  });

  it('does nothing when there is a ring and nobody running into it', () => {
    const out = breakOut({ ...bare, fleeing: {}, ring: { wardens: 40 } }, stream());
    expect(out.escaped).toEqual({});
    expect(out.caught).toEqual({});
    expect(out.rounds).toBe(0);
  });

  it('stops some of a withdrawal it is thick enough to hold, and pays for it', () => {
    const out = breakOut({ ...bare, fleeing: { razors: 40 }, ring: { wardens: 60 } }, stream());
    // Everybody is accounted for: a runner either got clear or did not, and nobody is invented.
    expect(bodies(out.escaped) + bodies(out.caught)).toBe(40);
    expect(bodies(out.caught), 'a ring this thick stopped nobody').toBeGreaterThan(0);
    expect(out.rounds).toBeGreaterThan(0);
    // The thing a toll could never do: standing in front of them costs the ring bodies.
    expect(bodies(out.ringLosses), 'the ring held sixty people off for free').toBeGreaterThan(0);
  });

  /*
   * The other thing a toll could never do.
   *
   * The old model was a per-runner catch rate against ring thickness, so four bodies in front of
   * two hundred still collected their share and took nothing back. A ring is a fight now, so a thin
   * one in front of a mass breakout is ridden through.
   */
  it('is ridden through when it is thin and the withdrawal is not', () => {
    const out = breakOut({ ...bare, fleeing: { razors: 200 }, ring: { razors: 2 } }, stream());
    expect(out.brokeThrough, 'two bodies turned two hundred back').toBe(true);
    expect(bodies(out.escaped)).toBeGreaterThan(0);
    expect(bodies(out.ringLosses), 'the ring was ridden through and lost nobody').toBeGreaterThan(
      0,
    );
  });

  /**
   * The one rule that is not the first fight's, and the one the board asked for by name.
   *
   * Measured as a rate over many withdrawals rather than on one, because a single roll of a halved
   * chance can still come up. Both runs are the same fleeing force against the same ring, so the
   * only thing between them is the multiplier.
   */
  it('makes getting away half as likely at the ring as it is in the fight', () => {
    expect(PERIMETER_FLEE_PENALTY).toBe(0.5);

    const escapedOver = (hardship: number): number => {
      let got = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        const next = mulberry32(seedFrom(`penalty:${seed}`));
        const { fled } = routSurvivorsAt(hardship, next);
        got += bodies(fled);
      }
      return got;
    };
    const ordinary = escapedOver(1);
    const atTheRing = escapedOver(PERIMETER_FLEE_PENALTY);
    expect(ordinary, 'nobody got away under either rule, so this measures nothing').toBeGreaterThan(
      0,
    );
    // Halved odds over sixty withdrawals: the gap is a rate, not a coin flip.
    expect(atTheRing).toBeLessThan(ordinary * 0.75);
  });

  /**
   * That the penalty is *applied*, and not merely defined and exported.
   *
   * The test above proves `fleeChance` honours a hardship it is handed. It says nothing about
   * whether `breakOut` hands it one, and that gap was real: deleting `hardship:
   * PERIMETER_FLEE_PENALTY` from the breakout left all 329 battle tests green. A rule nothing
   * applies is a constant with a good name.
   *
   * Rebuilt from the outside rather than toggled with a test-only knob: `breakOut` seeds its second
   * battle on `${seed}:ring`, so re-running that exact simulation and routing it at the ordinary
   * chance gives the counterfactual. The two runs share a rout stream, so the multiplier is the only
   * thing between them. It does couple this test to that seed suffix, which is deliberate: change
   * the suffix and this fails loudly rather than going quietly green.
   */
  it('applies the halved chance at the ring rather than only defining it', () => {
    const fleeing = { razors: 30 };
    const ring = { wardens: 40 };
    const context = { pursuit: 0, lastRound: 3, away: true };
    let halved = 0;
    let ordinary = 0;
    let held = 0;

    for (let i = 0; i < 40; i += 1) {
      const seed = `wiring:${i}`;
      const second = simulate({
        seed: `${seed}:ring`,
        attacker: { name: 'the withdrawal', army: fleeing, defending: false },
        defender: { name: 'the ring', army: ring, defending: true },
      });
      // Only a ring that held produces a second rout roll at all.
      if (second.winner !== 'defender') continue;
      held += 1;

      halved += bodies(
        breakOut({ ...bare, seed, fleeing, ring }, mulberry32(seedFrom(`${seed}:stream`))).escaped,
      );
      const { fled } = routSurvivors(
        second.attacker,
        { ...context, pursuit: pursuitSpeed(second.defender), lastRound: second.rounds.length },
        mulberry32(seedFrom(`${seed}:stream`)),
      );
      ordinary += bodies(fled);
    }

    expect(held, 'the ring never held, so no second rout was ever rolled').toBeGreaterThan(0);
    expect(ordinary, 'nobody got away under either rule, so this measures nothing').toBeGreaterThan(
      0,
    );
    expect(halved, 'the ring rolled the ordinary chance').toBeLessThan(ordinary * 0.75);
  });

  /** The board's rule, and the whole gamble: a beaten side's ring never fights. */
  it('only ever works for the side that won', () => {
    expect(perimeterFights('attacker', 'attacker')).toBe(true);
    expect(perimeterFights('defender', 'attacker')).toBe(false);
  });
});

describe('traps (§A4)', () => {
  it('gates every trap behind a Lab programme, and hands over only what is known', () => {
    for (const spec of TRAP_CATALOG) expect(spec.requiresTech).toMatch(/^tech_/);
    expect(trapsAvailable([])).toEqual([]);
    expect(trapsAvailable(['tech_pressure_plates']).map((spec) => spec.id)).toEqual([
      'trap_pressure_plates',
    ]);
  });

  /**
   * The rule that stops a trap being a wall. It takes a bite and the attack happens anyway: the
   * only exception is the one where there is nothing left to attack with.
   */
  it('takes a bounded bite and leaves the attack standing', () => {
    const spec = findTrap('trap_collapse')!;
    const toll = springTrap({ razors: 200 }, spec);
    expect(toll.killed.razors).toBe(spec.maxKills);
    expect(toll.survivors.razors).toBe(200 - spec.maxKills);
    expect(toll.wipedOut).toBe(false);
  });

  it('never takes more than the ceiling, however big the force', () => {
    for (const spec of TRAP_CATALOG) {
      const toll = springTrap({ razors: 10_000 }, spec);
      expect(toll.killed.razors, spec.id).toBeLessThanOrEqual(spec.maxKills);
    }
  });

  it('spreads its victims across the stacks rather than deleting the smallest one', () => {
    const toll = springTrap({ razors: 60, the_colossus: 1 }, findTrap('trap_collapse')!);
    expect(toll.survivors.the_colossus).toBe(1);
    expect(toll.killed.razors).toBeGreaterThan(0);
  });

  it('reports a wipe-out, which is the one case an attack does not happen', () => {
    const toll = springTrap({ razors: 1 }, findTrap('trap_gas_shell')!);
    expect(toll.wipedOut).toBe(true);
    expect(toll.survivors).toEqual({});
  });

  it('does nothing to a force that is not there', () => {
    const toll = springTrap({}, findTrap('trap_pressure_plates')!);
    expect(toll.killed).toEqual({});
    expect(toll.wipedOut).toBe(false);
  });
});

describe('what the other side can see of a deployment (§F2)', () => {
  it('reads an exact count when nobody is hiding anything', () => {
    expect(observedForceSize({ razors: 37 }, 0)).toBe(37);
  });

  it('coarsens rather than lying, so a blurred count is never systematically wrong', () => {
    const blur = 24;
    expect(observedForceSize({ razors: 37 }, blur)).toBe(blurredCount(37, blur));
  });

  it('tells a badly outclassed watcher nothing at all rather than a number they would plan on', () => {
    expect(observedForceSize({ razors: 37 }, INTEL_BLACKOUT_PERCENT)).toBeNull();
    expect(intelQualityLine(INTEL_BLACKOUT_PERCENT)).toMatch(/dark/);
  });

  it('counts a quiet force as harder to count than a loud one of the same size', () => {
    expect(forceStealth({ ghosts: 10 })).toBeGreaterThan(forceStealth({ juggernauts: 10 }));
    const quiet = deploymentBlurPercent({
      resistancePercent: 0,
      yieldPercent: 0,
      force: { ghosts: 10 },
    });
    const loud = deploymentBlurPercent({
      resistancePercent: 0,
      yieldPercent: 0,
      force: { juggernauts: 10 },
    });
    expect(quiet).toBeGreaterThan(loud);
  });

  it('lets a crew that out-reads its rival see the exact number, and no better than exact', () => {
    expect(
      deploymentBlurPercent({ resistancePercent: 10, yieldPercent: 400, force: { razors: 5 } }),
    ).toBe(0);
  });
});

describe('the report (§A5)', () => {
  const fight = () => {
    const simulation = simulate({
      seed: 'analysis-fixture',
      battlefield: bareBattlefield('the Bonefield'),
      attacker: { name: 'Us', army: { razors: 40, snipers: 6 }, defending: false },
      defender: { name: 'Them', army: { razors: 12 }, defending: true },
    });
    return simulation;
  };

  it('ranks a side by what it actually put out, and shares add to one', () => {
    const simulation = fight();
    const analysis = analyseBattle({
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

    const winner = analysis.winner === 'attacker' ? analysis.attacker : analysis.defender;
    expect(winner.units.length).toBeGreaterThan(0);
    const shares = winner.units.reduce((sum, unit) => sum + unit.damageShare, 0);
    expect(shares).toBeCloseTo(1, 6);
    // Sorted by damage, hardest first: the table is the answer to "which of these earned it".
    for (let i = 1; i < winner.units.length; i += 1) {
      expect(winner.units[i - 1]!.damage).toBeGreaterThanOrEqual(winner.units[i]!.damage);
    }
  });

  it('counts every body: what started is what survived plus what was lost', () => {
    const simulation = fight();
    const analysis = analyseBattle({
      battleId: 'b1',
      locationName: 'the Bonefield',
      simulation,
      fled: { razors: 3 },
      winnerLosses: { razors: 2 },
      perimeter: { attacker: {}, defender: {} },
      perimeterCaught: {},
      trap: null,
      infamy: { attacker: 0, defender: 0 },
    });
    for (const side of [analysis.attacker, analysis.defender]) {
      for (const unit of side.units) {
        expect(unit.started, unit.name).toBe(unit.survived + unit.lost);
      }
    }
  });

  /**
   * The rule the whole perimeter mechanic exists for: the winner is always told, the loser only if
   * somebody made it home.
   */
  it('always reaches the winner', () => {
    const analysis = analyseBattle({
      battleId: 'b1',
      locationName: 'the Bonefield',
      simulation: fight(),
      fled: {},
      winnerLosses: {},
      perimeter: { attacker: {}, defender: {} },
      perimeterCaught: {},
      trap: null,
      infamy: { attacker: 0, defender: 0 },
    });
    expect(reportReaches(analysis.winner, analysis)).toBe(true);
  });

  it('reaches the loser only when somebody ran and got home', () => {
    const simulation = fight();
    const loser = simulation.winner === 'attacker' ? 'defender' : 'attacker';
    const build = (fled: Record<string, number>) =>
      analyseBattle({
        battleId: 'b1',
        locationName: 'the Bonefield',
        simulation,
        fled,
        winnerLosses: {},
        perimeter: { attacker: {}, defender: {} },
        perimeterCaught: {},
        trap: null,
        infamy: { attacker: 0, defender: 0 },
      });

    expect(reportReaches(loser, build({}))).toBe(false);
    const survivor = losingUnitOf(simulation, loser);
    expect(reportReaches(loser, build({ [survivor]: 1 }))).toBe(true);
  });
});

function losingUnitOf(
  simulation: { attacker: SideState; defender: SideState },
  side: 'attacker' | 'defender',
): string {
  const stack = simulation[side].stacks.find((candidate) => candidate.started > 0);
  if (!stack) throw new Error('the fixture put nobody on the losing side');
  return stack.unit.id;
}

describe('everything that feeds the engine (§A5)', () => {
  const groundOf = () => bareBattlefield('the yard');

  const run = (setup: Partial<SideSetup>) =>
    simulate({
      seed: 'feeds-fixture',
      battlefield: groundOf(),
      attacker: { name: 'Us', army: { razors: 60 }, defending: false, ...setup },
      defender: { name: 'Them', army: { razors: 60 }, defending: true },
    });

  /**
   * The workshop was the one input the engine did not read: a crew could buy Slaved Optics for
   * every unit it owns and fight exactly as well as one that had not, which made the whole refit a
   * number on a screen.
   */
  it('fights better with the workshop refit fitted', () => {
    const bare = run({});
    const kitted = run({ upgrades: { razors: ['weapons_1', 'armour_1'] } });

    const offense = (side: SideState) => side.stacks[0]!.effective.offense;
    expect(offense(kitted.attacker)).toBeGreaterThan(offense(bare.attacker));
    expect(kitted.attacker.stacks[0]!.effective.vitality).toBeGreaterThan(
      bare.attacker.stacks[0]!.effective.vitality,
    );
  });

  /**
   * The point of slots. A refit is bolted to the unit it was slotted onto, so kitting the Sparks
   * does nothing for the Razors standing next to them: before this, one flat list was folded onto
   * every sheet on the side and the choice of what to fit where did not exist.
   */
  it('pays only the unit the upgrade is slotted onto', () => {
    const elsewhere = run({ upgrades: { sparks: ['weapons_1', 'armour_1'] } });
    const bare = run({});
    expect(elsewhere.attacker.stacks[0]!.effective.offense).toBe(
      bare.attacker.stacks[0]!.effective.offense,
    );
  });

  /**
   * §A5 teamwork. The only bonus in the game whose worth depends on how many people you brought:
   * worth nothing to a force that already fits on the ground, and worth a great deal to one that
   * does not.
   */
  it('gets more of an oversized force into contact when the crew can co-ordinate', () => {
    const frontage = 20;
    const crowd: SideState = { ...run({}).attacker, cohesionPercent: 0 };
    const led: SideState = { ...crowd, cohesionPercent: 40 };

    expect(effectiveFrontage(led, frontage)).toBeGreaterThan(effectiveFrontage(crowd, frontage));
    expect(engagedBodies(led, frontage)).toBeGreaterThan(engagedBodies(crowd, frontage));
  });

  it('never widens the ground past the ceiling, however well led the crew is', () => {
    const side: SideState = { ...run({}).attacker, cohesionPercent: 1000 };
    expect(effectiveFrontage(side, 20)).toBe(20 * MAX_COHESION_WIDTH);
  });

  it('does nothing at all for a force that already fits on the ground', () => {
    const side = run({});
    const led: SideState = { ...side.attacker, cohesionPercent: 40 };
    // Frontage far above the body count, so every one of them is already in contact and there is
    // nothing left for co-ordination to buy.
    const roomy = 1000;
    expect(engagedBodies(led, roomy)).toBe(engagedBodies(side.attacker, roomy));
  });

  /** Held ground the crew took: the Sewer Junction's stealth reaches the fight, not just the map. */
  it('carries a territory stealth bonus into the fight', () => {
    const plain = run({});
    const hidden = run({
      territory: { ...noTerritoryEffects(), unitStealthPercent: 50 },
    });
    expect(hidden.attacker.stacks[0]!.effective.stealth).toBeGreaterThan(
      plain.attacker.stacks[0]!.effective.stealth,
    );
  });
});

describe('what a breach does to a district (§A4)', () => {
  const structure = (damage: number): Building => ({
    id: 'g',
    kind: 'greenhouse',
    level: 10,
    modifications: [],
    damage,
  });

  it('costs a wrecked structure up to half its job, and never more', () => {
    expect(buildingEffectiveness(structure(0))).toBe(1);
    expect(buildingEffectiveness(structure(100))).toBe(1 - MAX_DAMAGE_PENALTY);
    expect(buildingEffectiveness(structure(50))).toBeCloseTo(1 - MAX_DAMAGE_PENALTY / 2, 6);
    expect(MAX_DAMAGE_PENALTY).toBeLessThanOrEqual(0.5);
  });

  it('actually reaches the district clocks rather than sitting on the record', () => {
    const intact = buildingProduction('greenhouse', [structure(0)]).supplies ?? 0;
    const wrecked = buildingProduction('greenhouse', [structure(100)]).supplies ?? 0;
    expect(wrecked).toBeLessThan(intact);
    // Halved, not stopped: a Greenhouse wrecked to a standstill starves a roster that had nothing
    // to do with the fight, which is a punishment loop rather than a setback.
    expect(wrecked).toBeCloseTo(intact * (1 - MAX_DAMAGE_PENALTY), 6);
  });

  it('scales the wrecking by how badly the defence lost, and always leaves a mark', () => {
    expect(strikeDamage(0)).toBe(MIN_STRIKE_DAMAGE);
    expect(strikeDamage(1)).toBe(MAX_STRIKE_DAMAGE);
    expect(strikeDamage(0.5)).toBeGreaterThan(strikeDamage(0));
    expect(MIN_STRIKE_DAMAGE).toBeGreaterThan(0);
  });

  it('puts a structure right when a level goes on it, and never past intact', () => {
    expect(repairedByBuilding(structure(30)).damage).toBe(0);
    expect(repairedByBuilding(structure(100)).damage).toBe(100 - RECOVERY_PER_LEVEL);
  });

  it('stops damage at wrecked rather than letting it climb for ever', () => {
    expect(damageBuilding(structure(90), 40, NOON.toISOString()).damage).toBe(100);
  });

  /**
   * A gate's strength is its level, and nothing else (board request).
   *
   * Watches sat on every structure and cost nothing; digging replaced them and was the same
   * mistake wearing a price tag, because it made a gate harder to get through without making it
   * any higher. Both are gone. Locations keep the digging (`city/fortification.ts`), where the
   * ground varies and the choice is a real one.
   *
   * Pinned as an equality against the *captured* gate's formula rather than against a number
   * typed here, because the rule is that the two are on the same footing: a wall you raised at
   * home and a wall you took are worth the same per level.
   */
  it('is worth its level and nothing else, at home and on ground it took', () => {
    const gateAt = (level: number): Building => ({ ...structure(0), kind: 'gate', level });
    for (const level of [1, 4, 12, BUILDING_MAX_LEVEL]) {
      expect(gateDefensePercent([gateAt(level)])).toBe(capturedGateDefensePercent(level));
      expect(gateIntelResistancePercent([gateAt(level)])).toBe(
        capturedGateIntelResistancePercent(level),
      );
    }
    // The flat rating moves with the level too, and with nothing a player can buy separately.
    expect(districtDefense([gateAt(2)])).toBeGreaterThan(districtDefense([gateAt(1)]));
  });
});
