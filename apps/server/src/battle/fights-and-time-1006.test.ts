import {
  CAPTURED_GATE_START_LEVEL,
  emptyDeployment,
  findDistrict,
  skirmishOutcome,
  startingHolder,
  type Army,
  type BattleTarget,
  type SkirmishEngine,
} from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { putControl } from '../city/actions.js';
import { settleGarrisonRegrowth } from '../city/regrowth.js';
import { startingBase } from '../crew/starting.js';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories } from '../db/repos/index.js';
import { settleBase } from '../district/settle.js';
import {
  PLOT,
  auth,
  closeWorlds,
  faction,
  makeWorld,
  register,
  type Crew,
  type World,
} from '../testing/fight-world.js';
import { pinOverseer } from '../testing/overseer.js';
import { everybodyHome } from '../testing/walk.js';
import { reportTickFailuresTo, type TickFailure } from '../world/guard.js';
import { settleWorld } from '../world/settle.js';

/**
 * The maintainer's rulings of 2026-10-06 on fights and time: a late fight is fought at its mark,
 * the twenty-slot rule is judged once at the lock, captured ground loses its work in progress, a
 * crew that leaves a faction takes its units out of its old friends' fights, a fight that cannot
 * be read is dropped, and the weekly rebuild waits an hour at most for last week's fights.
 */

afterEach(async () => {
  vi.useRealTimers();
  await closeWorlds();
});

const CALLED_AT = '2026-10-06T09:00:00.000Z';
const MARK = '2026-10-06T17:00:00.000Z';
const onBelt = (locationId: string): BattleTarget => ({
  kind: 'location',
  districtId: 'steelbelt',
  locationId,
});

function at(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

async function crews<Name extends string>(
  world: World,
  rosters: Record<Name, Army>,
): Promise<Record<Name, Crew>> {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(CALLED_AT);
  const out = {} as Record<Name, Crew>;
  for (const name of Object.keys(rosters) as Name[]) {
    const crew = await register(world, name, rosters[name]);
    pinOverseer(world.app, crew.token);
    out[name] = crew;
  }
  return out;
}

async function call(world: World, crew: Crew, target: BattleTarget): Promise<string> {
  const res = await world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(crew.token),
    payload: { target, scheduledFor: MARK },
  });
  expect(res.statusCode, res.body).toBe(200);
  const battle = world.app.repos.sieges.pending().find((one) => one.attackerBaseId === crew.baseId);
  if (!battle) throw new Error('the call wrote no battle');
  return battle.id;
}

async function deploy(world: World, crew: Crew, battleId: string, changes: Army): Promise<void> {
  const res = await world.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(crew.token),
    payload: { battleId, changes },
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function reinforce(world: World, crew: Crew, battleId: string, army: Army): Promise<void> {
  const res = await world.app.inject({
    method: 'POST',
    url: '/api/factions/reinforce',
    headers: auth(crew.token),
    payload: { battleId, army },
  });
  expect(res.statusCode, res.body).toBe(200);
}

function tick(world: World, iso: string, engine: SkirmishEngine = world.engine): number {
  at(iso);
  return settleWorld(world.app.repos, engine, new Date());
}

const army = (world: World, crew: Crew) => world.app.repos.bases.findById(crew.baseId)!.army;

/** When each walk this crew has been sent on set out, settled or not. */
function walksSetOut(world: World, crew: Crew): string[] {
  return (
    world.db.prepare('SELECT departed_at FROM unit_moves WHERE base_id = ?').all(crew.baseId) as {
      departed_at: string;
    }[]
  ).map((row) => row.departed_at);
}

/** A plot on the Belt held at the start by somebody, other than the one the fixtures fight on. */
const OTHER_PLOT: string = (() => {
  const district = findDistrict('steelbelt')!;
  const held = district.locations.find(
    (location) => location.id !== PLOT && startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('fixture error: the Belt has one held plot only');
  return held.id;
})();

describe('a fight settled late is fought at its mark', () => {
  it('dates the report and the walk home at the mark, not at the settle', async () => {
    // The whole line runs, so the whole line walks home.
    const world = await makeWorld('defender', { fled: { razors: 20 } });
    const { caller } = await crews(world, { caller: { razors: 30 } });
    const battleId = await call(world, caller, onBelt(PLOT));
    await deploy(world, caller, battleId, { razors: 20 });
    tick(world, '2026-10-06T16:59:00.000Z');

    // The server was down from before the mark until three hours after it.
    expect(tick(world, '2026-10-06T20:00:00.000Z')).toBe(1);
    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).toBe(MARK);
    const walks = walksSetOut(world, caller);
    expect(walks.length).toBeGreaterThan(0);
    expect(walks.every((departed) => departed === MARK)).toBe(true);
  });

  it('fights against the ground as it stood at the mark, not as the restart found it', async () => {
    const world = await makeWorld('defender');
    const { caller } = await crews(world, { caller: { razors: 30 } });
    const battleId = await call(world, caller, onBelt(PLOT));
    await deploy(world, caller, battleId, { razors: 20 });
    tick(world, '2026-10-06T16:59:00.000Z');

    // A plot of the caller's own, with work on it that lands an hour after the mark.
    const ramp = world.app.repos.city.control('steelbelt-ramp')!;
    world.app.repos.city.put({
      ...ramp,
      holder: { kind: 'crew', baseId: caller.baseId },
      level: 1,
      upgradingUntil: '2026-10-06T18:00:00.000Z',
    });
    let levelAtTheFight: number | null = null;
    const engine: SkirmishEngine = {
      resolve: () => {
        levelAtTheFight = world.app.repos.city.control('steelbelt-ramp')!.level;
        return skirmishOutcome({ winner: 'defender', log: [] });
      },
    };

    expect(tick(world, '2026-10-06T20:00:00.000Z', engine)).toBe(1);
    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).toBe(MARK);
    expect(levelAtTheFight, 'the upgrade landed before the fight it came after').toBe(1);
    expect(world.app.repos.city.control('steelbelt-ramp')!.level).toBe(2);
  });
});

describe('the twenty-slot rule is judged once, at the lock', () => {
  it('lets a fight that passed at the lock stand when a column is turned round after it', async () => {
    const world = await makeWorld('attacker');
    const { caller } = await crews(world, { caller: { razors: 30 } });
    const battleId = await call(world, caller, onBelt(PLOT));

    // Twenty on the road fifteen seconds before the lock, due well before the mark.
    at('2026-10-06T15:59:45.000Z');
    await deploy(world, caller, battleId, { razors: 20 });
    const [column] = world.app.repos.movements.forBattle(battleId);
    expect(column, 'fixture error: the deploy put nobody on the road').toBeDefined();
    expect(Date.parse(column!.arrivesAt)).toBeLessThanOrEqual(Date.parse(MARK));
    // A tenth of the walk has to reach past half a minute after the lock for the recall below.
    expect(Date.parse(column!.arrivesAt) - Date.parse(column!.departedAt)).toBeGreaterThan(
      10 * 45_000,
    );

    tick(world, '2026-10-06T16:00:00.000Z');
    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).toBeNull();

    // Turned round inside its first tenth, after the lock.
    at('2026-10-06T16:00:30.000Z');
    const recalled = await world.app.inject({
      method: 'POST',
      url: '/api/actions/recall',
      headers: auth(caller.token),
      payload: { movementId: column!.id },
    });
    expect(recalled.statusCode, recalled.body).toBe(200);
    expect(world.app.repos.movements.forBattle(battleId)).toHaveLength(0);

    tick(world, '2026-10-06T16:02:00.000Z');
    tick(world, '2026-10-06T16:30:00.000Z');
    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).toBeNull();
    const told = world.app.repos.social
      .notifications(world.app.repos.bases.findById(caller.baseId)!.ownerId, 10)
      .map((one) => one.title);
    expect(told).not.toContain('A fight was called off');
  });
});

describe('captured ground loses its work in progress', () => {
  it('calls off the location’s upgrade and its district gate’s raise, and refunds nobody', async () => {
    const world = await makeWorld('attacker');
    const { owner, taker } = await crews(world, { owner: {}, taker: {} });
    const repos = world.app.repos;
    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000).toISOString();
    repos.city.put({
      ...repos.city.control(PLOT)!,
      holder: { kind: 'crew', baseId: owner.baseId },
      upgradingUntil: later,
      upgradePaid: { caps: 500 },
    });
    repos.capturedGates.put({
      districtId: 'steelbelt',
      level: CAPTURED_GATE_START_LEVEL,
      upgradingTo: CAPTURED_GATE_START_LEVEL + 1,
      upgradingUntil: later,
      upgradingSince: now.toISOString(),
      upgradePaid: { caps: 900 },
    });
    const caps = (crew: Crew) => {
      settleBase(repos, repos.bases.findById(crew.baseId)!, now);
      return repos.bases.findById(crew.baseId)!.resources.caps;
    };
    const before = { owner: caps(owner), taker: caps(taker) };

    putControl(
      repos,
      { ...repos.city.control(PLOT)!, holder: { kind: 'crew', baseId: taker.baseId } },
      now,
    );

    const taken = repos.city.control(PLOT)!;
    expect(taken.upgradingUntil).toBeNull();
    expect(taken.upgradePaid ?? null).toBeNull();
    const gate = repos.capturedGates.find('steelbelt')!;
    expect(gate.upgradingTo).toBeNull();
    expect(gate.upgradingUntil).toBeNull();
    expect(gate.upgradePaid ?? null).toBeNull();
    expect(gate.level).toBe(CAPTURED_GATE_START_LEVEL);
    expect({ owner: caps(owner), taker: caps(taker) }).toEqual(before);
  });

  it('leaves both running while the ground stays with its holder', async () => {
    const world = await makeWorld('attacker');
    const { owner } = await crews(world, { owner: {} });
    const repos = world.app.repos;
    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000).toISOString();
    const held = {
      ...repos.city.control(PLOT)!,
      holder: { kind: 'crew' as const, baseId: owner.baseId },
      upgradingUntil: later,
      upgradePaid: { caps: 500 },
    };
    repos.city.put(held);
    repos.capturedGates.put({
      districtId: 'steelbelt',
      level: CAPTURED_GATE_START_LEVEL,
      upgradingTo: CAPTURED_GATE_START_LEVEL + 1,
      upgradingUntil: later,
      upgradingSince: now.toISOString(),
      upgradePaid: { caps: 900 },
    });

    putControl(repos, { ...held, garrison: { razors: 3 } }, now);

    expect(repos.city.control(PLOT)!.upgradingUntil).toBe(later);
    expect(repos.capturedGates.find('steelbelt')!.upgradingTo).toBe(CAPTURED_GATE_START_LEVEL + 1);
  });
});

describe('a crew that leaves its faction', () => {
  it('takes its units out of a mate’s fight at once, the landed and the walking, inside the lock', async () => {
    const world = await makeWorld('attacker');
    const { caller, mate } = await crews(world, { caller: { razors: 30 }, mate: { razors: 20 } });
    faction(world, 'callers', [caller, mate]);
    const battleId = await call(world, caller, onBelt(PLOT));
    await deploy(world, caller, battleId, { razors: 20 });
    await reinforce(world, mate, battleId, { razors: 10 });
    // Landed well before the lock.
    tick(world, '2026-10-06T15:00:00.000Z');
    expect(world.app.repos.sieges.deployment(battleId, 'attacker', mate.baseId)?.army).toEqual({
      razors: 10,
    });
    // ...and five more on the road inside the last hour.
    at('2026-10-06T16:20:00.000Z');
    await reinforce(world, mate, battleId, { razors: 5 });
    const onTheRoad = () =>
      world.app.repos.movements.forBattle(battleId).filter((one) => one.baseId === mate.baseId);
    expect(onTheRoad()).toHaveLength(1);

    at('2026-10-06T16:30:00.000Z');
    const left = await world.app.inject({
      method: 'POST',
      url: '/api/factions/leave',
      headers: auth(mate.token),
      payload: {},
    });
    expect(left.statusCode, left.body).toBe(200);

    expect(world.app.repos.sieges.deployment(battleId, 'attacker', mate.baseId)).toBeUndefined();
    expect(onTheRoad()).toHaveLength(0);
    expect(world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)?.army).toEqual({
      razors: 20,
    });
    vi.useRealTimers();
    everybodyHome(world.app.repos);
    expect(army(world, mate)).toEqual({ razors: 20 });
  });
});

describe('a fight this build cannot read', () => {
  it('is dropped with the error logged, its units walk home, and the other fights still run', async () => {
    const world = await makeWorld('attacker');
    const { broken, other } = await crews(world, {
      broken: { razors: 30 },
      other: { razors: 30 },
    });
    const brokenId = await call(world, broken, onBelt(PLOT));
    const otherId = await call(world, other, onBelt(OTHER_PLOT));
    await deploy(world, broken, brokenId, { razors: 20 });
    await deploy(world, other, otherId, { razors: 20 });
    tick(world, '2026-10-06T16:30:00.000Z');
    expect(world.app.repos.sieges.pending()).toHaveLength(2);

    // A holder kind this build no longer has.
    world.db
      .prepare('UPDATE scheduled_battles SET defender_json = ? WHERE id = ?')
      .run(JSON.stringify({ kind: 'retired_holder' }), brokenId);
    const failures: TickFailure[] = [];
    const restore = reportTickFailuresTo((failure) => failures.push(failure));
    try {
      expect(tick(world, '2026-10-06T17:00:01.000Z')).toBe(1);
    } finally {
      restore();
    }

    const closed = world.db
      .prepare('SELECT resolved_at, analysis_json FROM scheduled_battles WHERE id = ?')
      .get(brokenId) as { resolved_at: string | null; analysis_json: string | null };
    expect(closed.resolved_at).not.toBeNull();
    expect(closed.analysis_json).toBeNull();
    expect(failures.map(({ stage, item }) => `${stage}: ${item}`)).toContain(
      `unreadable fights: ${brokenId}`,
    );
    expect(world.app.repos.sieges.find(otherId)?.resolvedAt).toBe(MARK);
    vi.useRealTimers();
    everybodyHome(world.app.repos);
    expect(army(world, broken)).toEqual({ razors: 30 });
  });

  it('drops a deployment row it cannot read and still runs the fight', async () => {
    const world = await makeWorld('attacker');
    const { caller, mate } = await crews(world, { caller: { razors: 30 }, mate: { razors: 20 } });
    faction(world, 'callers', [caller, mate]);
    const battleId = await call(world, caller, onBelt(PLOT));
    await deploy(world, caller, battleId, { razors: 20 });
    await reinforce(world, mate, battleId, { razors: 10 });
    tick(world, '2026-10-06T16:30:00.000Z');
    expect(world.app.repos.sieges.deployment(battleId, 'attacker', mate.baseId)).toBeDefined();

    world.db
      .prepare('UPDATE battle_deployments SET army_json = ? WHERE battle_id = ? AND base_id = ?')
      .run('{not json', battleId, mate.baseId);
    const failures: TickFailure[] = [];
    const restore = reportTickFailuresTo((failure) => failures.push(failure));
    try {
      expect(tick(world, '2026-10-06T17:00:01.000Z')).toBe(1);
    } finally {
      restore();
    }

    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).toBe(MARK);
    expect(failures.map(({ stage }) => stage)).toContain('unreadable fights');
    expect(failures.map(({ stage }) => stage)).not.toContain('battles');
    expect(world.app.repos.sieges.deployment(battleId, 'attacker', mate.baseId)).toBeUndefined();
  });
});

describe('the weekly regrowth waits for last week’s fights', () => {
  /** Monday 00:00 in Athens. */
  const WEEK = new Date('2026-09-20T21:00:00.000Z');
  const PLOT_ON_DOCKS = 'neon-docks-tideline';

  function worldWithAFightBefore(mark: Date) {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const repos = createRepositories(db);
    repos.city.controls();
    const now = new Date(mark.getTime() - 3_600_000).toISOString();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES ('u-late', 'late', 'x', ?)`,
    ).run(now);
    const crew = startingBase({ id: 'base-late', ownerId: 'u-late', name: 'Late', now });
    repos.bases.insert(crew);
    repos.sieges.insert({
      id: 'stuck-fight',
      target: { kind: 'location', districtId: 'neon-docks', locationId: PLOT_ON_DOCKS },
      attackerBaseId: crew.id,
      defender: { kind: 'government' },
      scheduledFor: mark.toISOString(),
      declaredAt: new Date(mark.getTime() - 10 * 3_600_000).toISOString(),
      resolvedAt: null,
      seed: 'stuck-fight',
      holdAfterCapture: true,
      wokeSleepers: false,
    });
    repos.sieges.putDeployment({
      ...emptyDeployment('stuck-fight', crew.id, 'attacker', now),
      army: { razors: 20 },
    });
    repos.city.setGarrison(PLOT_ON_DOCKS, { civic_levy: 2 });
    return { db, repos };
  }

  it('holds the rebuild while a fight from before the Monday mark is still to run', () => {
    const { db, repos } = worldWithAFightBefore(new Date(WEEK.getTime() - 30 * 60_000));
    try {
      expect(settleGarrisonRegrowth(repos, new Date(WEEK.getTime() + 59 * 60_000))).toBe(0);
      expect(repos.regrowth.claimed(WEEK.toISOString())).toBe(false);
      expect(repos.city.control(PLOT_ON_DOCKS)!.garrison).toEqual({ civic_levy: 2 });
    } finally {
      db.close();
    }
  });

  it('runs anyway an hour after the mark, so one fight that keeps failing cannot hold it', () => {
    const { db, repos } = worldWithAFightBefore(new Date(WEEK.getTime() - 30 * 60_000));
    try {
      expect(settleGarrisonRegrowth(repos, new Date(WEEK.getTime() + 60 * 60_000))).toBeGreaterThan(
        0,
      );
      expect(repos.regrowth.claimed(WEEK.toISOString())).toBe(true);
    } finally {
      db.close();
    }
  });

  it('does not wait on a fight called for the new week', () => {
    const { db, repos } = worldWithAFightBefore(new Date(WEEK.getTime() + 30 * 60_000));
    try {
      expect(settleGarrisonRegrowth(repos, new Date(WEEK.getTime() + 60_000))).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
