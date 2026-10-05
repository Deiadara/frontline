import {
  FOUND_FACTION_PLAYER_LEVEL,
  DECLARE_INFAMY_COST,
  createCommander,
  declarationWindow,
  findDistrict,
  findUnit,
  randomBadge,
  skirmishOutcome,
  startingHolder,
  type BattleTarget,
  type BattlesResponse,
  type FactionResponse,
  type MovePlace,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { armTheAttack } from '../testing/attack.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleMovements } from './movement.js';
import { settleMoves } from '../moves/moves.js';
import { settleBattles } from './resolve.js';
import { chooseOverseer } from '../testing/overseer.js';
import { queueMuster } from '../units/muster.js';
import { standingEffectsFor } from '../crew/standing.js';
import { everybodyHome } from '../testing/walk.js';

/**
 * Battle and faction fixes from the bug pass of 2026-09-27, each pinned by what a player would
 * see: whose units end up where, who is told, and what the board shows.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Every column walking anywhere, landed now. */
function landEveryMove(app: FastifyInstance, db: AppDatabase): void {
  db.prepare('UPDATE unit_moves SET returns_at = ?').run(
    new Date(Date.now() - 1_000).toISOString(),
  );
  settleMoves(app.repos, new Date());
}

interface Crew {
  token: string;
  userId: string;
  baseId: string;
}

const SQUATTED: string = (() => {
  const district = findDistrict('steelbelt');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Belt has nobody on it at all');
  return held.id;
})();

async function world(winner: 'attacker' | 'defender') {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  // Decided by hand and nobody dies, so the only thing that can move a unit is the settle.
  const engine: SkirmishEngine = {
    resolve: (input) => skirmishOutcome({ winner, log: [input.locationName] }),
  };
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });
  // One plot of the Belt left empty, so the district is open and a location can be called on.
  for (const location of findDistrict('steelbelt')?.locations ?? [])
    app.repos.city.control(location.id);
  const ramp = app.repos.city.control('steelbelt-ramp')!;
  app.repos.city.put({ ...ramp, holder: { kind: 'unoccupied' }, garrison: {} });
  return { app, db, engine };
}

async function register(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const body = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await chooseOverseer(app, body.token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: DECLARE_INFAMY_COST * 8 });
  // The level and Nexus a faction needs, and something to send.
  app.repos.bases.updateProgression(baseId, FOUND_FACTION_PLAYER_LEVEL, base.progression);
  app.repos.bases.updateBuildings(
    baseId,
    base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: 5 } : building,
    ),
  );
  app.repos.bases.updateArmy(baseId, { razors: 20 }, []);
  return { token: body.token, userId: body.user.id, baseId };
}

/** `leader` founds a faction and `member` joins it through the real invitation. */
async function ally(app: FastifyInstance, leader: Crew, member: Crew, memberName: string) {
  const founded = await app.inject({
    method: 'POST',
    url: '/api/factions',
    headers: auth(leader.token),
    payload: { name: 'The Ninth Street Crew', badge: randomBadge(7), blurb: '' },
  });
  expect(founded.statusCode, founded.body).toBe(200);
  await app.inject({
    method: 'POST',
    url: '/api/factions/invite',
    headers: auth(leader.token),
    payload: { username: memberName },
  });
  const pending = await app.inject({
    method: 'GET',
    url: '/api/factions',
    headers: auth(member.token),
  });
  const inviteId = pending.json<FactionResponse>().invites[0]?.id;
  if (!inviteId) throw new Error('fixture: no invitation reached the member');
  const joined = await app.inject({
    method: 'POST',
    url: '/api/factions/answer',
    headers: auth(member.token),
    payload: { inviteId, accept: true },
  });
  expect(joined.statusCode, joined.body).toBe(200);
}

async function declare(
  app: FastifyInstance,
  crew: Crew,
  target: BattleTarget,
  holdAfterCapture = false,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(crew.token),
    payload: {
      target,
      scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      holdAfterCapture,
    },
  });
  expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
  const battleId = app.repos.sieges.pending().at(-1)?.id;
  if (!battleId) throw new Error('fixture: no battle');
  return battleId;
}

/** Brings the mark forward, lands every column, and runs the fight. */
function fight(app: FastifyInstance, db: AppDatabase, engine: SkirmishEngine, battleId: string) {
  const mark = new Date(Date.now() - 60_000);
  db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
    mark.toISOString(),
    battleId,
  );
  db.prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?').run(
    new Date(mark.getTime() - 60_000).toISOString(),
    mark.toISOString(),
    battleId,
  );
  settleMovements(app.repos, new Date());
  expect(settleBattles(app.repos, engine, new Date())).toHaveLength(1);
}

describe('a location taken and held with an ally beside you', () => {
  it("leaves only the declarer's share on the ground and sends the ally's home", async () => {
    const { app, db, engine } = await world('attacker');
    const caller = await register(app, 'caller');
    const helper = await register(app, 'helper');
    await ally(app, caller, helper, 'helper');
    const battleId = await declare(
      app,
      caller,
      { kind: 'location', districtId: 'steelbelt', locationId: SQUATTED },
      true,
    );

    const sent = await app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(caller.token),
      payload: { battleId, changes: { razors: 4 }, perimeterChanges: {} },
    });
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
    const helped = await app.inject({
      method: 'POST',
      url: '/api/factions/reinforce',
      headers: auth(helper.token),
      payload: { battleId, army: { razors: 5 } },
    });
    expect(helped.statusCode, helped.body.slice(0, 300)).toBe(200);

    fight(app, db, engine, battleId);
    // The ally's share is on the road home from the ground, not home in the same second.
    expect(app.repos.bases.findById(helper.baseId)!.army.razors).toBe(15);
    expect(app.repos.moves.activeFor(helper.baseId)[0]?.army).toEqual({ razors: 5 });
    everybodyHome(app.repos);

    const control = app.repos.city.control(SQUATTED)!;
    expect(control.holder).toEqual({ kind: 'crew', baseId: caller.baseId });
    expect(control.garrison).toEqual({ razors: 4 });
    expect(app.repos.bases.findById(helper.baseId)!.army.razors).toBe(20);
  });
});

describe('a raid on a crew that never touched the fight', () => {
  async function raided() {
    const { app, db, engine } = await world('attacker');
    const raider = await register(app, 'raider');
    const resident = await register(app, 'resident');
    const HOME = 'ashen-terraces';
    db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, resident.baseId);
    app.repos.sieges.breakGate(HOME, new Date(Date.now() + 24 * 3_600_000).toISOString());
    const battleId = await declare(app, raider, { kind: 'district', districtId: HOME });
    return { app, db, engine, raider, resident, battleId };
  }

  it('rings the resident and puts the report on their board', async () => {
    const { app, db, engine, raider, resident, battleId } = await raided();
    await app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(raider.token),
      payload: { battleId, changes: { razors: 4 }, perimeterChanges: {} },
    });
    fight(app, db, engine, battleId);

    const bells = app.repos.social.notifications(resident.userId, 50);
    expect(bells.some((bell) => bell.kind === 'battle_report')).toBe(true);
    expect(app.repos.sieges.resolvedFor(resident.baseId, 10).map((row) => row.battle.id)).toContain(
      battleId,
    );
  });

  it('shows the raider no count, since no spy can see past the gate', async () => {
    const { app, raider } = await raided();
    const board = await app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(raider.token),
    });
    const view = board.json<BattlesResponse>().coming[0]!;
    expect(view.enemySize).toBeNull();
    expect(view.enemyIntel).toBe('Nobody sees past the gate into a district.');
    // And the seed that fixes the whole fight is not on the board for anybody.
    expect('seed' in view.battle).toBe(false);
  });
});

describe('who names the leader of a side', () => {
  it('refuses an ally, and leaves the principal free to name their own', async () => {
    const { app } = await world('attacker');
    const caller = await register(app, 'caller');
    const helper = await register(app, 'helper');
    await ally(app, caller, helper, 'helper');
    const battleId = await declare(app, caller, {
      kind: 'location',
      districtId: 'steelbelt',
      locationId: SQUATTED,
    });
    await app.inject({
      method: 'POST',
      url: '/api/factions/reinforce',
      headers: auth(helper.token),
      payload: { battleId, army: { razors: 5 } },
    });

    const hire = (crew: Crew, id: string) => {
      const base = app.repos.bases.findById(crew.baseId)!;
      const officer = createCommander(id, 'Vasco Renn', 'field_commander', {
        strength: 60,
        toughness: 60,
        dexterity: 50,
        resolve: 60,
        reflexes: 55,
      });
      app.repos.bases.updateCommanders(crew.baseId, [...base.commanders, officer]);
      return officer;
    };
    const lead = (crew: Crew, officerId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/battles/lead',
        headers: auth(crew.token),
        payload: { battleId, officerId },
      });

    const refused = await lead(helper, hire(helper, 'helper-officer').id);
    expect(refused.statusCode).toBe(403);
    const named = await lead(caller, hire(caller, 'caller-officer').id);
    expect(named.statusCode, named.body.slice(0, 200)).toBe(200);
  });
});

describe('leaving a faction', () => {
  it('walks units posted on the former ally’s ground home', async () => {
    const { app, db } = await world('attacker');
    const host = await register(app, 'host');
    const guest = await register(app, 'guest');
    await ally(app, host, guest, 'guest');
    const control = app.repos.city.control(SQUATTED)!;
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: host.baseId } });
    app.repos.alliedGarrisons.set(SQUATTED, guest.baseId, { razors: 6 });
    const guestBase = app.repos.bases.findById(guest.baseId)!;
    app.repos.bases.updateArmy(guest.baseId, { razors: 14 }, guestBase.musterQueue);

    const left = await app.inject({
      method: 'POST',
      url: '/api/factions/leave',
      headers: auth(guest.token),
    });
    expect(left.statusCode, left.body.slice(0, 300)).toBe(200);
    expect(app.repos.alliedGarrisons.get(SQUATTED, guest.baseId)).toEqual({});
    // Off the ground and on the road, not home in the same instant (maintainer, 2026-09-28).
    expect(app.repos.bases.findById(guest.baseId)!.army.razors).toBe(14);
    const [walking] = app.repos.moves.activeFor(guest.baseId);
    expect(walking?.from).toEqual({ kind: 'location', locationId: SQUATTED });
    expect(walking?.army).toEqual({ razors: 6 });
    expect(Date.parse(walking!.arrivesAt)).toBeGreaterThan(Date.now());
    landEveryMove(app, db);
    expect(app.repos.bases.findById(guest.baseId)!.army.razors).toBe(20);
  });
});

describe('one of each legendary', () => {
  it('counts the one standing on a location, not only the ones at home', async () => {
    const { app } = await world('attacker');
    const crew = await register(app, 'collector');
    // An empty yard, so the unit-slot cap (never waived) has room for the machine.
    app.repos.bases.updateArmy(crew.baseId, {}, []);
    const colossus = findUnit('the_colossus')!;
    const muster = () =>
      queueMuster(app.repos, {
        base: app.repos.bases.findById(crew.baseId)!,
        unit: colossus,
        count: 1,
        now: new Date(),
        // Waives the unlock and the bill, never the one-of-each rule.
        admin: true,
      });

    // The control: with none anywhere, the order is taken.
    expect(muster().kind).toBe('queued');
    app.repos.bases.updateArmy(crew.baseId, {}, []);

    const control = app.repos.city.control(SQUATTED)!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: crew.baseId },
      garrison: { the_colossus: 1 },
    });
    expect(muster()).toMatchObject({ kind: 'refused', reason: 'already_have_one' });
  });
});

describe('a fight nothing can resolve', () => {
  /*
   * Closed rather than retried for ever, and everybody already standing on it goes home with the
   * machines they came in. Only the columns still walking used to be sent back; a column that had
   * landed was folded into its row and lost with it.
   */
  it('hands back the units and vehicles already on the ground', async () => {
    const { app, db, engine } = await world('attacker');
    const caller = await register(app, 'caller');
    const battleId = await declare(app, caller, {
      kind: 'location',
      districtId: 'steelbelt',
      locationId: SQUATTED,
    });
    const sent = await app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(caller.token),
      payload: { battleId, changes: { razors: 7 }, perimeterChanges: {} },
    });
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
    expect(app.repos.bases.findById(caller.baseId)!.army.razors).toBe(13);

    // Land the column, then pull the ground out from under the fight.
    const mark = new Date(Date.now() - 60_000);
    db.prepare(
      'UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?',
    ).run(new Date(mark.getTime() - 60_000).toISOString(), mark.toISOString(), battleId);
    settleMovements(app.repos, new Date());
    db.prepare(
      "UPDATE scheduled_battles SET scheduled_for = ?, district_id = 'nowhere' WHERE id = ?",
    ).run(mark.toISOString(), battleId);
    settleBattles(app.repos, engine, new Date());

    expect(app.repos.sieges.find(battleId)!.resolvedAt).not.toBeNull();
    // They walk home from the ground rather than reappearing on the roster.
    expect(app.repos.bases.findById(caller.baseId)!.army.razors).toBe(13);
    expect(app.repos.moves.activeFor(caller.baseId)[0]?.army).toEqual({ razors: 7 });
    landEveryMove(app, db);
    expect(app.repos.bases.findById(caller.baseId)!.army.razors).toBe(20);
  });
});

describe('a breach is a window (maintainer, 2026-09-27)', () => {
  async function breached(hours: number) {
    const { app, db, engine } = await world('attacker');
    const raider = await register(app, 'raider');
    const resident = await register(app, 'resident');
    const HOME = 'ashen-terraces';
    db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, resident.baseId);
    app.repos.sieges.breakGate(HOME, new Date(Date.now() + hours * 3_600_000).toISOString());
    return { app, db, engine, raider, resident, HOME };
  }

  it('refuses a raid called for after the gate is back up', async () => {
    // Eight hours is the shortest notice a fight can be called on; a two-hour breach has shut by then.
    const { app, raider, HOME } = await breached(2);
    const res = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(raider.token),
      payload: {
        target: { kind: 'district', districtId: HOME },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('back up before then');
  });

  it('calls a raid off, and sends the raiders home, when the gate is up at the mark', async () => {
    const { app, db, engine, raider, HOME } = await breached(24);
    const battleId = await declare(app, raider, { kind: 'district', districtId: HOME });
    await app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(raider.token),
      payload: { battleId, changes: { razors: 6 }, perimeterChanges: {} },
    });
    // The gate is put back two minutes ago, a minute before the mark below.
    app.repos.sieges.breakGate(HOME, new Date(Date.now() - 120_000).toISOString());

    const mark = new Date(Date.now() - 60_000);
    db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
      mark.toISOString(),
      battleId,
    );
    db.prepare(
      'UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?',
    ).run(new Date(mark.getTime() - 60_000).toISOString(), mark.toISOString(), battleId);
    settleMovements(app.repos, new Date());
    expect(settleBattles(app.repos, engine, new Date())).toHaveLength(0);

    expect(app.repos.sieges.find(battleId)!.resolvedAt).not.toBeNull();
    const [walking] = app.repos.moves.activeFor(raider.baseId);
    expect(walking?.from).toEqual({ kind: 'street', districtId: HOME });
    expect(walking?.army).toEqual({ razors: 6 });
    landEveryMove(app, db);
    expect(app.repos.bases.findById(raider.baseId)!.army.razors).toBe(20);
    const bells = app.repos.social.notifications(raider.userId, 50);
    expect(bells.some((bell) => bell.title === 'The gate was back up in time')).toBe(true);
  });

  it('gives nothing from a broken gate', async () => {
    const { app, resident, HOME } = await breached(24);
    const base = app.repos.bases.findById(resident.baseId)!;
    app.repos.bases.updateBuildings(resident.baseId, [
      ...base.buildings.filter((building) => building.kind !== 'gate'),
      { id: 'gate', kind: 'gate', level: 5, modifications: [] },
    ]);
    const withGate = app.repos.bases.findById(resident.baseId)!;
    expect(standingEffectsFor(app.repos, withGate).gatePercent).toBe(0);

    app.repos.sieges.breakGate(HOME, new Date(Date.now() - 1_000).toISOString());
    expect(standingEffectsFor(app.repos, withGate).gatePercent).toBeGreaterThan(0);
  });
});

describe('ground with a fight called on it (maintainer, 2026-09-27)', () => {
  async function called(hoursOut: number) {
    const { app, db } = await world('attacker');
    const caller = await register(app, 'caller');
    const holder = await register(app, 'holder');
    const control = app.repos.city.control(SQUATTED)!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: holder.baseId },
      garrison: { razors: 5 },
    });
    const battleId = await declare(app, caller, {
      kind: 'location',
      districtId: 'steelbelt',
      locationId: SQUATTED,
    });
    // The attack's least commitment, or the lock calls it off (2026-10-05).
    armTheAttack(app.repos, battleId, caller.baseId);
    db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
      new Date(Date.now() + hoursOut * 3_600_000).toISOString(),
      battleId,
    );
    return { app, db, holder };
  }
  // The garrison door went (maintainer, 2026-09-28): standing units on ground, or taking them off
  // it, is a move, and the move is what the lock holds.
  const walk = (crew: Crew, from: MovePlace, to: MovePlace, app: FastifyInstance) =>
    app.inject({
      method: 'POST',
      url: '/api/actions/move',
      headers: auth(crew.token),
      payload: { from, to, army: { razors: 1 }, vehicles: {} },
    });
  const plot: MovePlace = { kind: 'location', locationId: SQUATTED };
  const pullOne = (app: FastifyInstance, crew: Crew) => walk(crew, plot, { kind: 'district' }, app);
  const addOne = (app: FastifyInstance, crew: Crew) => walk(crew, { kind: 'district' }, plot, app);

  it('lets nothing leave in the last hour, and still takes arrivals', async () => {
    const { app, db, holder } = await called(0.5);
    const refused = await pullOne(app, holder);
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('within the hour');
    expect((await addOne(app, holder)).statusCode).toBe(200);
    landEveryMove(app, db);
    expect(app.repos.city.control(SQUATTED)!.garrison.razors).toBe(6);
  });

  it('leaves the garrison free before the last hour', async () => {
    const { app, holder } = await called(5);
    expect((await pullOne(app, holder)).statusCode).toBe(200);
  });

  it('cannot be claimed by a crew walking onto it empty', async () => {
    const { app } = await world('attacker');
    const caller = await register(app, 'caller');
    const walker = await register(app, 'walker');
    // The one empty plot of the Belt. A fight cannot be called on empty ground (maintainer,
    // 2026-10-04), so it is called while looters hold it and the ground empties after (an admin
    // reset is one way), with the fight still to come.
    const EMPTY = 'steelbelt-ramp';
    const control = app.repos.city.control(EMPTY)!;
    app.repos.city.put({ ...control, holder: { kind: 'looters' } });
    await declare(app, caller, { kind: 'location', districtId: 'steelbelt', locationId: EMPTY });
    app.repos.city.put({ ...control, holder: { kind: 'unoccupied' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/actions/move',
      headers: auth(walker.token),
      payload: {
        from: { kind: 'district' },
        to: { kind: 'location', locationId: EMPTY },
        army: { razors: 4 },
        vehicles: {},
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('Nobody claims it until it is over');
  });
});
