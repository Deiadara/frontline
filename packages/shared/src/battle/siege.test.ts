import { describe, expect, it } from 'vitest';
import {
  MAX_DAMAGE_PENALTY,
  MIN_STRIKE_DAMAGE,
  MAX_STRIKE_DAMAGE,
  RECOVERY_PER_LEVEL,
  buildingEffectiveness,
  buildingProduction,
  damageBuilding,
  gateFortifyPercent,
  repairedByBuilding,
  strikeDamage,
  type Building,
} from '../building/index.js';
import { FORTIFY_MAX_LEVEL, fortifyBonusPercent, noTerritoryEffects } from '../city/index.js';
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
import { catchChance, perimeterFights, perimeterToll, ringCoverage } from './perimeter.js';
import { mulberry32, seedFrom } from './rng.js';
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
    expect(gateArmed({ kind: 'faction', baseId: 'b1' })).toBe(true);
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

  it('does nothing at all when nobody set one, and draws nothing either', () => {
    const used = stream();
    const untouched = stream();
    used();
    untouched();

    const toll = perimeterToll({ razors: 20 }, {}, used);
    expect(toll.caught).toEqual({});
    expect(toll.escaped).toEqual({ razors: 20 });
    // An absent ring must not consume a draw. `perimeterToll` sits inside the rout now, so a ring
    // nobody set would otherwise shift every historical fight's survivors by one draw.
    expect(used()).toBe(untouched());
  });

  it('covers more runners the thicker it is, and never more than all of them', () => {
    expect(ringCoverage({ razors: 2 }, 20)).toBeCloseTo(0.15, 6);
    expect(ringCoverage({ razors: 100 }, 20)).toBe(1);
    expect(ringCoverage({ razors: 10 }, 0)).toBe(0);
  });

  it('catches a slow, loud unit more often than a fast, quiet one', () => {
    expect(catchChance('juggernauts', 1)).toBeGreaterThan(catchChance('ghosts', 1));
  });

  it('takes a real share of a withdrawal when it is thick enough to', () => {
    const toll = perimeterToll({ razors: 40 }, { wardens: 40 }, stream());
    const stopped = toll.caught.razors ?? 0;
    expect(stopped).toBeGreaterThan(0);
    expect(stopped + (toll.escaped.razors ?? 0)).toBe(40);
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
    fortification: 0,
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
   * The Gate, and only the Gate.
   *
   * Watches used to sit on every structure and cost nothing; what replaced them is the same three
   * levels the city's locations are dug in with, paid for in materials, on the one structure that
   * *is* the way in. A dug-in Greenhouse is worth nothing, which is the whole point of moving it.
   */
  it('reads the Gate’s fortification and no other structure’s', () => {
    const dug = (kind: Building['kind'], fortification: number): Building => ({
      ...structure(0),
      kind,
      fortification,
    });
    expect(gateFortifyPercent([])).toBe(0);
    expect(gateFortifyPercent([dug('gate', 0)])).toBe(0);
    expect(gateFortifyPercent([dug('gate', 3)])).toBe(fortifyBonusPercent('medium', 3));
    expect(gateFortifyPercent([dug('greenhouse', 3)])).toBe(0);
    // The schema caps it; the reader caps it again so a hand-written row cannot buy more.
    expect(gateFortifyPercent([dug('gate', 99)])).toBe(
      fortifyBonusPercent('medium', FORTIFY_MAX_LEVEL),
    );
  });
});
