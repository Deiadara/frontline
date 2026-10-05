import {
  declarableSlots,
  featMeasureKey,
  findDistrict,
  type Army,
  type BattleTarget,
  type Building,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { gateFor } from '../city/gates.js';
import {
  PLOT,
  auth,
  closeWorlds,
  declare,
  holdPlot,
  makeWorld,
  register,
  runTheFight,
  type Crew,
  type World,
} from '../testing/fight-world.js';

/**
 * Four rulings of 2026-09-28 on where a fight may be and what it is worth:
 *
 * - "A gate bonus only counts when fighting at that gate, home gate's at home, and another
 *   districts' gate at that districts' gate."
 * - "the server should never allow a fight to happen in a location where the gate would come up
 *   before it and thus make it illegal."
 * - "If at least one location is taken the gate is never recovered, gate only works if a player
 *   controls the entire district."
 * - "two fights cannot be called in the same place at the same time", and "The server should
 *   automatically give the winners what they should hold, not ask them."
 */

afterEach(closeWorlds);

const BELT = findDistrict('steelbelt')!;

const HOME_GATE: Building = { id: 'gate', kind: 'gate', level: 5, modifications: [] };

function giveAGate(world: World, crew: Crew): void {
  const base = world.app.repos.bases.findById(crew.baseId)!;
  world.app.repos.bases.updateBuildings(crew.baseId, [
    ...base.buildings.filter((building) => building.kind !== 'gate'),
    HOME_GATE,
  ]);
}

const gateLevel = (world: World, crew: Crew): number =>
  world.app.repos.bases.findById(crew.baseId)!.buildings.find((one) => one.kind === 'gate')
    ?.level ?? 0;

/** A call on `crew`'s own gate, written straight onto the table and a minute past its mark. */
function callOnTheirGate(world: World, attacker: Crew, crew: Crew): string {
  world.app.repos.sieges.insert({
    id: 'gate-fight',
    target: { kind: 'gate', districtId: world.app.repos.bases.findById(crew.baseId)!.districtId },
    attackerBaseId: attacker.baseId,
    defender: { kind: 'unoccupied' },
    scheduledFor: new Date(Date.now() + 9 * 3_600_000).toISOString(),
    declaredAt: new Date().toISOString(),
    resolvedAt: null,
    seed: 'seed',
    holdAfterCapture: true,
    wokeSleepers: false,
  });
  return 'gate-fight';
}

function sendIn(world: World, battleId: string, crew: Crew, army: Army): void {
  const row = world.app.repos.sieges.deployment(battleId, 'attacker', crew.baseId)!;
  world.app.repos.sieges.putDeployment({ ...row, army });
}

describe('a gate counts only at that gate', () => {
  it('keeps the home Gate out of a location fight its crew defends, and in at its own gate', async () => {
    const away = await makeWorld('defender');
    const caller = await register(away, 'caller');
    const holder = await register(away, 'holder');
    giveAGate(away, holder);
    holdPlot(away, holder, { razors: 5 });
    runTheFight(away, await declare(away, caller));
    expect(away.seen().defenderTerritory?.gatePercent, 'the home Gate stood at a plot').toBe(0);

    const home = await makeWorld('defender');
    const raider = await register(home, 'raider');
    const resident = await register(home, 'resident');
    giveAGate(home, resident);
    home.app.repos.bases.updateGateArmy(resident.baseId, { razors: 5 });
    runTheFight(home, callOnTheirGate(home, raider, resident));
    expect(home.seen().defenderTerritory?.gatePercent ?? 0).toBeGreaterThan(0);
  });

  it('lets a Colossus lower only the gate it walked through', async () => {
    const away = await makeWorld('attacker');
    const caller = await register(away, 'caller');
    const holder = await register(away, 'holder');
    giveAGate(away, holder);
    holdPlot(away, holder, { razors: 5 });
    const plotFight = await declare(away, caller);
    sendIn(away, plotFight, caller, { the_colossus: 1 });
    runTheFight(away, plotFight);
    expect(gateLevel(away, holder), 'a Colossus at a plot lowered the home Gate').toBe(5);

    const home = await makeWorld('attacker');
    const raider = await register(home, 'raider');
    const resident = await register(home, 'resident');
    giveAGate(home, resident);
    const gateFight = callOnTheirGate(home, raider, resident);
    home.app.repos.sieges.putDeployment({
      battleId: gateFight,
      baseId: raider.baseId,
      side: 'attacker',
      army: { the_colossus: 1 },
      perimeter: {},
      boostIds: [],
      officerId: null,
      trapId: null,
      vehicles: {},
      updatedAt: new Date().toISOString(),
    });
    runTheFight(home, gateFight);
    expect(gateLevel(home, resident)).toBe(4);
  });
});

describe('no fight is called for after its gate comes back up', () => {
  /** The Belt held end to end by `holder`, its gate broken until `until`. */
  function beltBroken(world: World, holder: Crew, until: Date): void {
    for (const location of BELT.locations) {
      const control = world.app.repos.city.control(location.id)!;
      world.app.repos.city.put({
        ...control,
        holder: { kind: 'crew', baseId: holder.baseId },
        garrison: { razors: 1 },
      });
    }
    world.app.repos.sieges.breakGate('steelbelt', until.toISOString());
  }

  const call = (world: World, crew: Crew, target: BattleTarget, mark: Date) =>
    world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(crew.token),
      payload: { target, scheduledFor: mark.toISOString() },
    });

  it('refuses a location in a shut district at the moment the gate is back, and takes the mark before', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    const mark = declarableSlots(new Date())[4]!;
    beltBroken(world, holder, mark);
    const plot: BattleTarget = { kind: 'location', districtId: 'steelbelt', locationId: PLOT };

    const atTheClose = await call(world, caller, plot, mark);
    expect(atTheClose.statusCode).toBe(409);
    expect(atTheClose.body).toContain('back up before then');

    const before = declarableSlots(new Date())[3]!;
    expect((await call(world, caller, plot, before)).statusCode).toBe(200);
  });

  it('refuses a raid on a home at the moment its gate is back', async () => {
    const world = await makeWorld('attacker');
    const raider = await register(world, 'raider');
    const resident = await register(world, 'resident');
    const home = world.app.repos.bases.findById(resident.baseId)!.districtId;
    const mark = declarableSlots(new Date())[4]!;
    world.app.repos.sieges.breakGate(home, mark.toISOString());
    const raid: BattleTarget = { kind: 'district', districtId: home };

    expect((await call(world, raider, raid, mark)).statusCode).toBe(409);
    expect((await call(world, raider, raid, declarableSlots(new Date())[3]!)).statusCode).toBe(200);
  });

  /**
   * Bug pass, 2026-09-28: a gate fight won inside a breach broke the gate again from its own mark,
   * so a home could be kept open for ever one call at a time. While it is down, the gate is not a
   * target; once it is back up, it is again.
   */
  it('refuses a fight at a gate that is already down, and takes one once it is back up', async () => {
    const world = await makeWorld('attacker');
    const raider = await register(world, 'raider');
    const resident = await register(world, 'resident');
    const home = world.app.repos.bases.findById(resident.baseId)!.districtId;
    const slots = declarableSlots(new Date());
    world.app.repos.sieges.breakGate(home, slots[6]!.toISOString());
    const gate: BattleTarget = { kind: 'gate', districtId: home };

    const refused = await call(world, raider, gate, slots[3]!);
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('already down');

    world.app.repos.sieges.breakGate(home, new Date(Date.now() - 1_000).toISOString());
    expect((await call(world, raider, gate, slots[3]!)).statusCode).toBe(200);
  });
});

describe("a district's gate after a breach (non-player ground)", () => {
  function beltHeldBy(world: World, holder: Crew): void {
    for (const location of BELT.locations) {
      const control = world.app.repos.city.control(location.id)!;
      world.app.repos.city.put({
        ...control,
        holder: { kind: 'crew', baseId: holder.baseId },
        garrison: { razors: 1 },
      });
    }
  }

  const shutAfterTheBreach = async (world: World, caller: Crew) => {
    // The breach ran out an hour ago.
    world.app.repos.sieges.breakGate('steelbelt', new Date(Date.now() - 3_600_000).toISOString());
    const gate = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(caller.token),
      payload: {
        target: { kind: 'gate', districtId: 'steelbelt' },
        scheduledFor: declarableSlots(new Date())[0]!.toISOString(),
      },
    });
    return gate.statusCode === 200;
  };

  it('is never recovered once a location was taken inside the breach', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    beltHeldBy(world, holder);
    world.app.repos.capturedGates.put({
      districtId: 'steelbelt',
      level: 4,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });
    world.app.repos.sieges.breakGate(
      'steelbelt',
      new Date(Date.now() + 20 * 3_600_000).toISOString(),
    );
    // A plot taken while the door is off its hinges.
    runTheFight(world, await declare(world, caller));
    expect(world.app.repos.city.control(PLOT)!.holder).toEqual({
      kind: 'crew',
      baseId: caller.baseId,
    });
    expect(gateFor(world.app.repos, 'steelbelt').level, 'the wall went with the district').toBe(1);

    // The timer runs out and there is still no gate: nobody holds the Belt whole.
    expect(await shutAfterTheBreach(world, caller)).toBe(false);
  });

  it('comes back up when the timer runs out and nothing was taken', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    beltHeldBy(world, holder);
    expect(await shutAfterTheBreach(world, caller)).toBe(true);
  });
});

describe('one fight per place', () => {
  it('refuses a second call on the same place from anybody, at any mark, until the first is over', async () => {
    const world = await makeWorld('attacker');
    const first = await register(world, 'first');
    const second = await register(world, 'second');
    const holder = await register(world, 'holder');
    holdPlot(world, holder, { razors: 2 });
    const slots = declarableSlots(new Date());
    const fight = await declare(world, first, undefined, slots[0]!.toISOString());

    const again = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(second.token),
      payload: {
        target: { kind: 'location', districtId: 'steelbelt', locationId: PLOT },
        scheduledFor: slots[slots.length - 1]!.toISOString(),
      },
    });
    expect(again.statusCode).toBe(409);
    expect(again.body).toContain('Somebody has already called that one');

    runTheFight(world, fight);
    await expect(declare(world, second)).resolves.toBeTypeOf('string');
  });
});

// Maintainer, 2026-10-04: empty ground is walked onto, never fought for.
describe('no fight on empty ground', () => {
  it('refuses a call on a place nobody holds, and says to walk in', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const plot = world.app.repos.city.control(PLOT)!;
    world.app.repos.city.put({ ...plot, holder: { kind: 'unoccupied' }, garrison: {} });
    const slots = declarableSlots(new Date());

    const refused = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(caller.token),
      payload: {
        target: { kind: 'location', districtId: 'steelbelt', locationId: PLOT },
        scheduledFor: slots[0]!.toISOString(),
      },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('Send units to walk in');
    expect(world.app.repos.sieges.pending()).toHaveLength(0);
  });
});

describe('winners hold what they take', () => {
  it('holds the ground even when the call asked not to', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller', { razors: 10 });
    const holder = await register(world, 'holder');
    holdPlot(world, holder, { razors: 2 });
    const res = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(caller.token),
      payload: {
        target: { kind: 'location', districtId: 'steelbelt', locationId: PLOT },
        scheduledFor: declarableSlots(new Date())[0]!.toISOString(),
        holdAfterCapture: false,
      },
    });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const battleId = world.app.repos.sieges.pending()[0]!.id;
    expect(world.app.repos.sieges.find(battleId)!.holdAfterCapture).toBe(true);
    sendIn(world, battleId, caller, { razors: 3 });
    // A row written before the rule, unticked, holds as well.
    world.db
      .prepare('UPDATE scheduled_battles SET hold_after_capture = 0 WHERE id = ?')
      .run(battleId);

    runTheFight(world, battleId);
    expect(world.app.repos.city.control(PLOT)!).toMatchObject({
      holder: { kind: 'crew', baseId: caller.baseId },
      garrison: { razors: 3 },
    });
    expect(world.app.repos.feats.tallies(caller.baseId)[featMeasureKey('battles_won')]).toBe(1);
  });
});
