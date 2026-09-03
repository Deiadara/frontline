import {
  DEFAULT_BADGE,
  findDistrict,
  findLocation,
  startingHolder,
  CAPTURED_GATE_START_LEVEL,
  GATE_BREACH_HOURS,
  breachExpiry,
  capturedGateDefensePercent,
  gateDefensePercent,
  BATTLE_BOOSTS,
  NOTORIETY_FIRST_COST,
  findBattleBoost,
  NOTORIETY_TO_FIELD,
  STARTING_RESOURCES,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  declarationWindow,
  deployedSize,
  garrisonSize,
  findTrap,
  infamyForKill,
  skirmishOutcome,
  type BattleMutationResponse,
  type BattlesResponse,
  type BattleTarget,
  infamyForRaidWon,
  type ScheduledBattle,
  type SkirmishEngine,
  type UnitsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import type { Repositories } from '../db/repos/index.js';
import { MAX_PENDING_DECLARATIONS } from './declare.js';
import { settleMovements } from './movement.js';
import { settleBattles } from './resolve.js';
import { gateFor, holdsDistrictWhole } from '../city/gates.js';

/**
 * The declared-battle loop end to end (GDD §A4, battle rework).
 *
 * Two halves, and they are tested through different seams on purpose. **Declaring and deploying**
 * go through HTTP, because the whole point of those rules is that they are enforced at the boundary
 * against whatever a client sends. **Resolution** is driven by calling the settler with an explicit
 * `now`, because the alternative is a test that waits eight hours.
 */

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  repos: Repositories;
  token: string;
  baseId: string;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const errorCode = (res: InjectResponse): string =>
  res.json<{ error: { code: string } }>().error.code;

async function makeStack(username = 'caller', engine?: SkirmishEngine): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = engine
    ? await buildApp({ config, db, skirmishEngine: engine, logger: false })
    : await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  /*
   * Scouting is a journey now (`scouting/scouting.ts`), so the button no longer opens ground: it
   * sends somebody who walks back hours later. A fixture wants the *state*, not the trip.
   *
   * Reading every control in the district as well, which the removed HTTP call used to do as a
   * side effect. `city.control()` writes the starting row the first time it is asked for one, and
   * `setTrap` is an `UPDATE`: on a district nobody had read, arming a trap updated no rows and
   * said nothing, so the fixture armed a trap that was never there. Production reads the control
   * to check who holds the ground before it charges for the trap, so it materialises the row on
   * the way past; this is the one path that did not.
   */
  app.repos.city.markScouted(baseId, 'rustyard', new Date().toISOString());
  for (const locationId of RUSTYARD_LOCATIONS) app.repos.city.control(locationId);

  // Every district in the city starts wholly held by one NPC party, which means every gate in the
  // city starts armed: see the test that pins exactly that. Most of what is worth testing here is
  // about a district with a seam in it, so the fixture opens one.
  const ramp = app.repos.city.control('rustyard-ramp')!;
  app.repos.city.put({ ...ramp, holder: { kind: 'unoccupied' }, garrison: {} });

  return { app, db, repos: app.repos, token, baseId };
}

/** Puts every location in the Rustyard back in one party's hands, so its gate is armed again. */
function shutTheRustyard(stack: Stack): void {
  for (const locationId of RUSTYARD_LOCATIONS) {
    const control = stack.repos.city.control(locationId)!;
    stack.repos.city.put({ ...control, holder: { kind: 'looters' }, garrison: { razors: 2 } });
  }
}

/**
 * Every location in the Rustyard, read off the catalogue rather than typed.
 *
 * A hard-coded list of four silently stopped shutting the district the day two more were added to
 * it: `shutTheRustyard` still returned, the gate was never armed, and three tests about the gate
 * rule went red for a reason that had nothing to do with the gate rule.
 */
const RUSTYARD_LOCATIONS: readonly string[] = (findDistrict('rustyard')?.locations ?? []).map(
  (location) => location.id,
);

/** The one the looters are actually standing on: an empty lot has nobody to answer a call. */
const SQUATTED_RUSTYARD_LOCATION: string = (() => {
  const district = findDistrict('rustyard');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Rustyard has nobody on it at all');
  return held.id;
})();

/** A mark inside the window, from the real clock the routes read. */
function nextMark(): string {
  return declarationWindow(new Date()).earliest.toISOString();
}

const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: SQUATTED_RUSTYARD_LOCATION,
};

async function declare(
  stack: Stack,
  target: BattleTarget = PRESS,
  scheduledFor = nextMark(),
): Promise<InjectResponse> {
  return stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: { target, scheduledFor },
  });
}

async function board(stack: Stack): Promise<BattlesResponse> {
  const res = await stack.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(stack.token),
  });
  expect(res.statusCode).toBe(200);
  return res.json<BattlesResponse>();
}

/** A Gate on the ground, since a new district has none and only the Gate can be dug in. */
function raiseGate(stack: Stack): { id: string } {
  const base = stack.repos.bases.findById(stack.baseId)!;
  const gate = {
    id: 'gate-1',
    kind: 'gate' as const,
    level: 1,
    modifications: [],
    damage: 0,
  };
  stack.repos.bases.updateDistrict(base.id, [...base.buildings, gate], base.buildQueue);
  return gate;
}

/**
 * A rival crew living in the Rustyard, with a Gate of their own.
 *
 * `residentOf` finds a district's inhabitant by `districtId` alone, so planting a base there is
 * all it takes to turn an NPC district into somebody's home, which is what a breach needs before
 * there is a Gate on the ground at all.
 */
function plantRival(
  stack: Stack,
  over: {
    id?: string;
    userId?: string;
    username?: string;
    districtId?: string;
    army?: Record<string, number>;
  } = {},
): string {
  const userId = over.userId ?? 'rival-user';
  const baseId = over.id ?? 'rival-base';
  stack.repos.users.insert({
    id: userId,
    username: over.username ?? 'Rival',
    passwordHash: 'x',
    createdAt: new Date().toISOString(),
  });
  const now = new Date().toISOString();
  const rival: Base = {
    id: baseId,
    ownerId: userId,
    name: 'The Other Crew',
    districtId: over.districtId ?? 'rustyard',
    level: 4,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [
      {
        id: 'rival-nexus',
        kind: 'nexus',
        level: 4,
        modifications: [],
        damage: 0,
      },
      { id: 'rival-gate', kind: 'gate', level: 4, modifications: [], damage: 0 },
    ],
    buildQueue: [],
    army: over.army ?? {},
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
  stack.repos.bases.insert(rival);
  return rival.id;
}

async function units(stack: Stack): Promise<UnitsResponse> {
  const res = await stack.app.inject({
    method: 'GET',
    url: '/api/units',
    headers: auth(stack.token),
  });
  expect(res.statusCode).toBe(200);
  return res.json<UnitsResponse>();
}

async function deploy(
  stack: Stack,
  battleId: string,
  changes: Record<string, number>,
  perimeterChanges: Record<string, number> = {},
): Promise<InjectResponse> {
  return stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.token),
    payload: { battleId, changes, perimeterChanges },
  });
}

/** Puts a declared fight's mark in the past so the settler will pick it up. */
function bringForward(stack: Stack, battle: ScheduledBattle, at: Date): void {
  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(at.toISOString(), battle.id);
  land(stack, battle.id, at);
}

/**
 * §A4: put whatever is walking to this fight on the ground.
 *
 * Sending units starts a column rather than filling a deployment (`battle/movement.ts`), so a
 * fixture that only winds the *mark* back resolves a fight nobody arrived at. That is correct
 * behaviour and a useless fixture, so both clocks move together, exactly as they would have if the
 * crew had sent in time.
 */
function land(stack: Stack, battleId: string, at: Date): void {
  stack.db
    .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
    .run(new Date(at.getTime() - 60_000).toISOString(), at.toISOString(), battleId);
  settleMovements(stack.app.repos, new Date());
}

/** An engine that always hands the fight to one side, for the settlement rules around it. */
function decided(winner: 'attacker' | 'defender', extra = {}): SkirmishEngine {
  return {
    resolve: (input) =>
      skirmishOutcome({
        winner,
        log: [`${input.locationName} decided`],
        ...extra,
      }),
  };
}

describe('calling a fight (§A4)', () => {
  it('takes a legal call and puts it on the board for both participants to see', async () => {
    const stack = await makeStack();
    const res = await declare(stack);
    expect(res.statusCode).toBe(200);

    const { coming } = res.json<BattleMutationResponse>().battles;
    expect(coming).toHaveLength(1);
    expect(coming[0]!.role).toBe('attacker');
    expect(coming[0]!.targetName).toBe(findLocation(SQUATTED_RUSTYARD_LOCATION)?.name);
    // The other side exists from the moment the call is made: an NPC answers a call the same day.
    expect(coming[0]!.enemySize).not.toBe(0);
  });

  it('offers only half-hour marks, and refuses anything between them', async () => {
    const stack = await makeStack();
    for (const slot of (await board(stack)).slots) {
      expect(Date.parse(slot) % (30 * 60_000)).toBe(0);
    }

    const offSlot = new Date(Date.parse(nextMark()) + 7 * 60_000).toISOString();
    const res = await declare(stack, PRESS, offSlot);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('BATTLE_REFUSED');
  });

  it('refuses a mark inside eight hours and one past a day', async () => {
    const stack = await makeStack();
    const window = declarationWindow(new Date());

    const early = new Date(window.earliest.getTime() - 30 * 60_000).toISOString();
    const late = new Date(window.latest.getTime() + 30 * 60_000).toISOString();
    expect((await declare(stack, PRESS, early)).statusCode).toBe(409);
    expect((await declare(stack, PRESS, late)).statusCode).toBe(409);
  });

  it('refuses ground this crew has never looked at', async () => {
    const stack = await makeStack();
    const res = await declare(stack, {
      kind: 'location',
      districtId: 'blacksite-7',
      locationId: 'blacksite-7-armory',
    });
    expect(res.statusCode).toBe(409);
  });

  it('caps how many calls one crew can have out at once', async () => {
    const stack = await makeStack();
    const results = [];
    for (const locationId of RUSTYARD_LOCATIONS) {
      results.push(await declare(stack, { kind: 'location', districtId: 'rustyard', locationId }));
    }
    expect(results.filter((res) => res.statusCode === 200)).toHaveLength(MAX_PENDING_DECLARATIONS);
    expect(errorCode(results[MAX_PENDING_DECLARATIONS]!)).toBe('BATTLE_REFUSED');
  });

  it('refuses a second call on ground somebody has already called', async () => {
    const stack = await makeStack();
    expect((await declare(stack)).statusCode).toBe(200);
    expect((await declare(stack)).statusCode).toBe(409);
  });

  /**
   * The gate rule, and the reason it exists: a district one party holds outright has no seam to walk
   * through, so the only legal call is on the way in.
   */
  it('sends you at the gate once one party holds every location in the district', async () => {
    const stack = await makeStack();
    shutTheRustyard(stack);

    const atPlace = await declare(stack);
    expect(atPlace.statusCode).toBe(409);
    expect(atPlace.json<{ error: { message: string } }>().error.message).toMatch(/gate/);

    const atGate = await declare(stack, { kind: 'gate', districtId: 'rustyard' });
    expect(atGate.statusCode).toBe(200);
  });

  /**
   * A consequence of the board's rule that is worth stating out loud: a fresh map is *entirely*
   * shut, because every district starts held end to end by the looters or the Combine. The opening
   * move against any district is therefore a gate assault, and the locations inside it only become
   * declarable during the breach that follows.
   */
  it('starts every district in the city shut, because one party holds all of each', async () => {
    const stack = await makeStack();
    shutTheRustyard(stack);
    expect((await declare(stack)).statusCode).toBe(409);
    expect((await declare(stack, { kind: 'gate', districtId: 'rustyard' })).statusCode).toBe(200);
  });

  it('has no gate to break while the district is split', async () => {
    const stack = await makeStack();
    const res = await declare(stack, { kind: 'gate', districtId: 'rustyard' });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/no gate/i);
  });
});

describe('moving people up to it (§A4)', () => {
  it('takes units off the roster when they are sent, and puts them back when they are pulled', async () => {
    const stack = await makeStack();
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    const before = declared.json<BattleMutationResponse>().base.army.razors ?? 0;
    expect(before).toBeGreaterThan(1);

    const sent = await deploy(stack, battleId, { razors: 2 });
    expect(sent.statusCode).toBe(200);
    const afterSending = sent.json<BattleMutationResponse>();
    // Off the roster the moment they set out, which is what stops the same two being promised to
    // three fights. Not on the ground yet: they are walking. See `battle/movement.ts`.
    expect(afterSending.base.army.razors ?? 0).toBe(before - 2);
    expect(afterSending.battles.coming[0]!.muster?.army.razors ?? 0).toBe(0);

    land(stack, battleId, new Date());
    const arrived = await board(stack);
    expect(arrived.coming[0]!.muster?.army.razors).toBe(2);

    const pulled = await deploy(stack, battleId, { razors: -2 });
    expect(pulled.statusCode).toBe(200);
    // Nobody has a ring out, so a withdrawal costs nothing at all.
    expect(pulled.json<BattleMutationResponse>().base.army.razors ?? 0).toBe(before);
  });

  it('will not send units the crew does not have', async () => {
    const stack = await makeStack();
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    const res = await deploy(stack, battleId, { razors: 9999 });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('BATTLE_REFUSED');
  });

  it('keeps the ring separate from the line, and counts both as committed', async () => {
    const stack = await makeStack();
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;

    await deploy(stack, battleId, { razors: 1 }, { razors: 1 });
    // One column carries both, and the two halves stay apart when it lands.
    land(stack, battleId, new Date());
    const view = (await board(stack)).coming[0]!;
    expect(view.muster?.army.razors).toBe(1);
    expect(view.muster?.perimeter.razors).toBe(1);
    expect(view.muster?.size).toBe(2);
  });

  /** §D7: the heaviest things on the roster will not take a contract from a nobody. */
  it('refuses to field a unit the crew has not earned the name for', async () => {
    const stack = await makeStack();
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateArmy(base.id, { ...base.army, the_colossus: 1 }, base.trainingQueue);

    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;

    const refused = await deploy(stack, battleId, { the_colossus: 1 });
    expect(refused.statusCode).toBe(409);

    stack.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      notoriety: NOTORIETY_TO_FIELD.legendary,
    });
    expect((await deploy(stack, battleId, { the_colossus: 1 })).statusCode).toBe(200);
  });

  /**
   * The other end of the deployment window. Past the mark there is nothing left to move people to:
   * the settler at the top of every handler has already run the fight, so the call 404s rather than
   * refusing, which is the honest answer, since the row is no longer a coming fight.
   */
  it('has nothing left to deploy into once the mark has passed', async () => {
    const stack = await makeStack();
    const declared = await declare(stack);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
    bringForward(stack, battle, new Date(Date.now() - 60_000));

    const res = await deploy(stack, battle.id, { razors: 1 });
    expect(res.statusCode).toBe(404);
    expect(stack.repos.sieges.find(battle.id)!.resolvedAt).not.toBeNull();
  });
});

/** Sets a fight up, moves people to it, and drags its mark into the past. */
async function readyFight(stack: Stack, force: Record<string, number> = { razors: 4 }) {
  const declared = await declare(stack);
  const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
  if (Object.keys(force).length > 0) await deploy(stack, battle.id, force);
  const mark = new Date(Date.now() - 60_000);
  bringForward(stack, battle, mark);
  return { battle: stack.repos.sieges.find(battle.id)!, mark };
}

describe('resolving it (§A4)', () => {
  it('takes the location on a win, clears its diggings and brings the survivors home', async () => {
    const stack = await makeStack('winner', decided('attacker'));
    const { battle } = await readyFight(stack);
    const before = stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0;

    const settled = settleBattles(stack.repos, stack.app.skirmishEngine, new Date());
    expect(settled).toHaveLength(1);

    const control = stack.repos.city.control(SQUATTED_RUSTYARD_LOCATION)!;
    expect(control.holder).toEqual({ kind: 'crew', baseId: stack.baseId });
    expect(control.fortification).toBe(0);
    expect(control.garrison).toEqual({});
    expect(stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0).toBe(before + 4);
    expect(stack.repos.sieges.find(battle.id)!.resolvedAt).not.toBeNull();
  });

  /**
   * §A4: you take the ground as it stands.
   *
   * A capture used to put the location back to level 1, which made every level poured into
   * contested ground a wager on never losing it. It does not any more: banked levels change hands
   * with the location, and taking a worked one off somebody is now the fastest way to own one.
   *
   * The two things that still reset are here as well, because the contrast is the rule: the
   * diggings go (fortification is the loser's own work on the ground, not the ground) and so does
   * an upgrade that was paid for and not yet banked.
   */
  it('takes a worked location at the level it had been worked to', async () => {
    const stack = await makeStack('winner', decided('attacker'));
    const { battle } = await readyFight(stack);
    const before = stack.repos.city.control(SQUATTED_RUSTYARD_LOCATION)!;
    stack.repos.city.put({
      ...before,
      level: 7,
      fortification: 2,
      upgradingUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });

    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const control = stack.repos.city.control(SQUATTED_RUSTYARD_LOCATION)!;
    expect(control.holder).toEqual({ kind: 'crew', baseId: stack.baseId });
    expect(control.level).toBe(7);
    expect(control.upgradingUntil).toBeNull();
    expect(control.fortification).toBe(0);
    expect(stack.repos.sieges.find(battle.id)!.resolvedAt).not.toBeNull();
  });

  /**
   * A column still on the road when the fight is decided comes home, and stays home.
   *
   * `recallOvertaken` turns those units round, and it does the right thing: it re-reads the base
   * and merges the column back into the roster. Then the settlement wrote the roster again from a
   * snapshot taken before any of that, and the column went with it. The units were not returned,
   * not killed, and not reported: they were deleted, and the only trace was a stockpile that did
   * not add up.
   *
   * Reachable without doing anything strange: deployment stays open until a second before the
   * mark (`battle/schedule.ts`) and a march can take up to two hours (`city/geography.ts`), so any
   * late reinforcement to a distant fight is in exactly this state.
   */
  it('does not delete a column that was still marching when the fight was decided', async () => {
    const stack = await makeStack('overtaken', decided('attacker'));
    const declared = await declare(stack);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;

    const before = stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0;
    await deploy(stack, battle.id, { razors: 3 });
    // Out of the roster and onto the road.
    expect(stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0).toBe(before - 3);
    expect(stack.repos.movements.forBattle(battle.id)).toHaveLength(1);

    // The mark comes forward, and the column does *not* land: it is still walking when the fight
    // is decided. `bringForward` is deliberately not used here, because landing them is the case
    // that already works.
    stack.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), battle.id);

    expect(settleBattles(stack.repos, stack.app.skirmishEngine, new Date())).toHaveLength(1);

    // Turned round and back on the books: nothing was lost by arriving late.
    expect(stack.repos.movements.forBattle(battle.id)).toHaveLength(0);
    expect(stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0).toBe(before);
  });

  /**
   * A deployment names units, and only units.
   *
   * `changes` was `z.record(z.string(), z.number().int())`, so any string was a key. Zod drops
   * `__proto__`, but `constructor` and `toString` survive as ordinary own properties, and the
   * withdrawal branch never checked that a key was a unit before reading it: `next['constructor']`
   * on a plain object is a *function*, `Math.min(-delta, fn)` is `NaN`, and the `back === 0` guard
   * lets `NaN` straight through. The roster then carried a `NaN` entry, which serialises to `null`
   * and turns every `forceSize` that touches it into `NaN`.
   *
   * Both keys are asserted, and a real unit alongside them, so this fails if the refusal ever comes
   * from something other than the key being rejected.
   */
  it('refuses a deployment naming something that is not a unit', async () => {
    const stack = await makeStack('junkkeys', decided('attacker'));
    const declared = await declare(stack);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
    const before = stack.repos.bases.findById(stack.baseId)!.army;

    for (const key of ['constructor', 'toString', '__proto__']) {
      const res = await deploy(stack, battle.id, { [key]: -1 });
      expect(res.statusCode, `${key} was accepted as a unit`).toBe(400);
    }

    // And the roster is untouched: no NaN, no new keys, nothing lost.
    const after = stack.repos.bases.findById(stack.baseId)!.army;
    expect(after).toEqual(before);
    for (const [unit, count] of Object.entries(after)) {
      expect(Number.isFinite(count), `${unit} is not a finite count`).toBe(true);
    }
  });

  it('runs a fight exactly once, however many times the settler is called', async () => {
    const stack = await makeStack('once', decided('attacker'));
    await readyFight(stack);
    expect(settleBattles(stack.repos, stack.app.skirmishEngine, new Date())).toHaveLength(1);
    expect(settleBattles(stack.repos, stack.app.skirmishEngine, new Date())).toHaveLength(0);
  });

  it('leaves the ground alone on a loss and sends home only whoever ran', async () => {
    const stack = await makeStack(
      'loser',
      decided('defender', { fled: { razors: 1 }, winnerLosses: { razors: 2 } }),
    );
    const { battle } = await readyFight(stack);
    const before = stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0;
    const standing = garrisonSize(stack.repos.city.control(SQUATTED_RUSTYARD_LOCATION)!);
    const answered = deployedSize(stack.repos.sieges.deployment(battle.id, 'defender')!);

    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    expect(stack.repos.city.control(SQUATTED_RUSTYARD_LOCATION)!.holder.kind).toBe('looters');
    expect(stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0).toBe(before + 1);
    // A successful defence rewrites the garrison: whoever came up for the fight is standing on the
    // location now, less whatever the defence cost. Leaving the old garrison there would quietly make
    // defending free and would lose the reinforcements that answered the call.
    expect(garrisonSize(stack.repos.city.control(SQUATTED_RUSTYARD_LOCATION)!)).toBe(
      standing + answered - 2,
    );
  });

  /**
   * §D7: killing is what raises a name, and the ledger has no ceiling.
   *
   * Asserted as an exact sum rather than as a floor. A floor passes with the kill term deleted,
   * because taking the ground pays a flat bonus on its own that is larger than six Razors.
   */
  it('banks infamy for what was killed, on top of what the ground was worth', async () => {
    const stack = await makeStack('infamous', decided('attacker', { killed: { razors: 6 } }));
    await readyFight(stack);
    const before = stack.repos.bases.findById(stack.baseId)!.economy.infamy;

    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const after = stack.repos.bases.findById(stack.baseId)!.economy.infamy;
    // The Rustyard is independent ground, so the only ground bonus is the flat one for taking it.
    expect(after - before).toBe(
      6 * infamyForKill('razors') + infamyForRaidWon({ fromTheState: false, seatOfPower: false }),
    );
  });

  /**
   * A fight is atomic, and the trap is what proves it.
   *
   * `springAnyTrap` consumes the trap *before* the engine runs, and `markResolved` happens after.
   * So a fight that fails in between used to leave the world in a state the rules do not describe:
   * the defender's trap spent, and the fight still on the board to be run again later without one.
   * The world clock is what made that worth fixing rather than noting, because it retries every
   * second and swallows what it catches, so the trap would be gone and nobody would be told.
   *
   * The engine is the failure injected here because it sits exactly between the two writes.
   */
  it('leaves nothing behind when a fight fails halfway through', async () => {
    const exploding: SkirmishEngine = {
      resolve: () => {
        throw new Error('engine exploded');
      },
    };
    const stack = await makeStack('halfway', exploding);
    const spec = findTrap('trap_collapse')!;
    const armedAt = new Date().toISOString();
    stack.repos.sieges.setTrap(SQUATTED_RUSTYARD_LOCATION, { trapId: spec.id, armedAt });
    const { battle } = await readyFight(stack);

    expect(() => settleBattles(stack.repos, exploding, new Date())).toThrow('engine exploded');

    // Both halves: the trap is still standing, and the fight is still coming.
    expect(stack.repos.sieges.trap(SQUATTED_RUSTYARD_LOCATION)).toEqual({
      trapId: spec.id,
      armedAt,
    });
    expect(stack.repos.sieges.find(battle.id)!.resolvedAt).toBeNull();
  });

  /**
   * Resolved as a *defeat* on purpose. Capturing a location clears its trap as well, so an attacker
   * win would leave two writes clearing one flag and a mutant that deleted the trap's own clear
   * would sit behind the capture's and stay green.
   */
  it('springs a trap before contact and never leaves it armed afterwards', async () => {
    const stack = await makeStack('trapped', decided('defender', { fled: { razors: 1 } }));
    const spec = findTrap('trap_collapse')!;
    stack.repos.sieges.setTrap(SQUATTED_RUSTYARD_LOCATION, {
      trapId: spec.id,
      armedAt: new Date().toISOString(),
    });

    let seen = 0;
    const counting: SkirmishEngine = {
      resolve: (input) => {
        seen = Object.values(input.attacking).reduce((sum, count) => sum + count, 0);
        return skirmishOutcome({ winner: 'defender', log: ['done'], fled: { razors: 1 } });
      },
    };
    const armed = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateArmy(armed.id, { razors: 30 }, armed.trainingQueue);
    await readyFight(stack, { razors: 30 });
    settleBattles(stack.repos, counting, new Date());

    expect(seen).toBeLessThan(30);
    expect(seen).toBeGreaterThan(0);
    expect(stack.repos.sieges.trap(SQUATTED_RUSTYARD_LOCATION)).toBeUndefined();
  });

  /**
   * A breach is a door off its hinges, not a demolition (board request).
   *
   * A gate's strength is its level and nothing else now, so a breach has exactly one thing it can
   * take: the way in, for {@link GATE_BREACH_HOURS} hours. The level survives it, the way a
   * location's own level survives until somebody actually stands on the ground.
   */
  it('leaves the Gate standing at its level when it is breached', async () => {
    const stack = await makeStack('breaker', decided('attacker'));
    shutTheRustyard(stack);
    const rivalId = plantRival(stack);

    const declared = await declare(stack, { kind: 'gate', districtId: 'rustyard' });
    expect(declared.statusCode).toBe(200);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
    bringForward(stack, battle, new Date(Date.now() - 60_000));
    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const gate = stack.repos.bases
      .findById(rivalId)!
      .buildings.find((building) => building.kind === 'gate')!;
    expect(gate.level).toBe(4);
  });

  it('breaks a gate for a day when the way in is what was attacked', async () => {
    const stack = await makeStack('breacher', decided('attacker'));
    shutTheRustyard(stack);

    const declared = await declare(stack, { kind: 'gate', districtId: 'rustyard' });
    expect(declared.statusCode).toBe(200);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
    bringForward(stack, battle, new Date(Date.now() - 60_000));

    const now = new Date();
    settleBattles(stack.repos, stack.app.skirmishEngine, now);

    const gate = stack.repos.sieges.gate('rustyard')!;
    expect(Date.parse(gate.brokenUntil!) - now.getTime()).toBeGreaterThan(
      (GATE_BREACH_HOURS - 1) * 3_600_000,
    );
    // Pinned to the board's number rather than only to the constant: an assertion written against
    // `GATE_BREACH_HOURS` alone is true whatever the constant says, and the number is the rule.
    expect(GATE_BREACH_HOURS).toBe(24);
  });

  /**
   * The rule the ring is bought for. A stub engine reports nobody home, so the loser is told
   * nothing, not a redacted table, nothing.
   */
  it('withholds the report from a loser nobody came back to', async () => {
    const stack = await makeStack('silenced', decided('defender', { fled: {} }));
    await readyFight(stack);
    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const reports = (await board(stack)).reports;
    expect(reports).toHaveLength(1);
    expect(reports[0]!.won).toBe(false);
    expect(reports[0]!.redacted).toBe(true);
    expect(reports[0]!.analysis).toBeNull();
  });

  it('hands the loser a report when at least one of them got home', async () => {
    const stack = await makeStack('told', decided('defender', { fled: { razors: 1 } }));
    await readyFight(stack);
    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const reports = (await board(stack)).reports;
    expect(reports[0]!.redacted).toBe(false);
    expect(reports[0]!.analysis).not.toBeNull();
  });
});

/**
 * §A4: the gate rule that only fires while the door is off its hinges (board request).
 *
 * Driven through the settler rather than through `resetGateOnDistrictLost` directly, because what
 * is under test here is the *wiring*: the rule lives in `city/gates.ts` and would pass its own
 * tests all day with nothing in `resolve.ts` calling it. The unit arms of the rule (an expired
 * breach, a district that was already split) are in `city/gates.test.ts`.
 */
describe('losing a location behind a broken gate (§A4)', () => {
  /** The whole Rustyard in the rival's hands, with a gate raised on it. */
  function rivalHoldsItAll(stack: Stack, rivalId: string, gateLevel: number): void {
    for (const locationId of RUSTYARD_LOCATIONS) {
      const control = stack.repos.city.control(locationId)!;
      stack.repos.city.put({
        ...control,
        holder: { kind: 'crew', baseId: rivalId },
        garrison: { razors: 1 },
      });
    }
    stack.repos.capturedGates.put({
      districtId: 'rustyard',
      level: gateLevel,
      upgradingTo: null,
      upgradingUntil: null,
    });
  }

  /**
   * Take one location off the rival, which is the only way ground changes hands.
   *
   * The door has to be open at the moment of the *call*: a district one party holds whole is shut,
   * and `declare.ts` refuses everything but the gate itself while it is. `breachStillOpen` is what
   * separates the two arms, because a fight is called eight to twenty-four hours out and a breach
   * runs for twenty-four: a call made late in the window resolves after the door is back on.
   */
  async function takeOneOff(stack: Stack, breachStillOpen: boolean): Promise<void> {
    stack.repos.sieges.breakGate('rustyard', breachExpiry(new Date()));
    const declared = await declare(stack, {
      kind: 'location',
      districtId: 'rustyard',
      locationId: RUSTYARD_LOCATIONS[0]!,
    });
    expect(declared.statusCode).toBe(200);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
    if (!breachStillOpen) {
      stack.repos.sieges.breakGate('rustyard', new Date(Date.now() - 60_000).toISOString());
    }
    bringForward(stack, battle, new Date(Date.now() - 60_000));
    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());
  }

  it('puts the gate back to level 1 and breaks the district up', async () => {
    const stack = await makeStack('holder', decided('attacker'));
    const rivalId = plantRival(stack);
    rivalHoldsItAll(stack, rivalId, 9);
    expect(holdsDistrictWhole(stack.repos, rivalId, 'rustyard')).toBe(true);

    await takeOneOff(stack, true);

    expect(gateFor(stack.repos, 'rustyard').level).toBe(CAPTURED_GATE_START_LEVEL);
    expect(holdsDistrictWhole(stack.repos, rivalId, 'rustyard')).toBe(false);
  });

  /** The breach is the condition. A gate standing again keeps its levels for whoever holds next. */
  it('leaves the gate alone when the breach has run out before the fight lands', async () => {
    const stack = await makeStack('holder', decided('attacker'));
    const rivalId = plantRival(stack);
    rivalHoldsItAll(stack, rivalId, 9);

    await takeOneOff(stack, false);

    expect(gateFor(stack.repos, 'rustyard').level).toBe(9);
    expect(holdsDistrictWhole(stack.repos, rivalId, 'rustyard')).toBe(false);
  });
});

describe('what a name buys (§D7)', () => {
  /** The first boost anybody may buy, and the only one this bare stack has on the table. */
  const open = () => BATTLE_BOOSTS.find((spec) => spec.unlock.kind === 'open')!;

  const buy = (stack: Stack, battleId: string, boostId: string) =>
    stack.app.inject({
      method: 'POST',
      url: '/api/battles/boost',
      headers: auth(stack.token),
      payload: { battleId, boostId },
    });

  it('buys one boost for one fight, and refuses when the name is not worth it', async () => {
    const stack = await makeStack();
    const spec = open();
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;

    const broke = await buy(stack, battleId, spec.id);
    expect(broke.statusCode).toBe(409);
    expect(errorCode(broke)).toBe('NOT_ENOUGH_INFAMY');

    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateEconomy(base.id, { ...base.economy, infamy: spec.cost + 10 });

    const paid = await buy(stack, battleId, spec.id);
    expect(paid.statusCode).toBe(200);
    const after = paid.json<BattleMutationResponse>();
    expect(after.base.economy.infamy).toBe(10);
    expect(after.battles.coming[0]!.boostId).toBe(spec.id);
  });

  it('offers nothing an officer or the Lab has not put on the table', async () => {
    const stack = await makeStack();
    const gated = BATTLE_BOOSTS.find((spec) => spec.unlock.kind !== 'open')!;
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateEconomy(base.id, { ...base.economy, infamy: 100_000 });

    const view = (await board(stack)).coming[0]!;
    expect(view.boosts.find((option) => option.id === gated.id)!.available).toBe(false);

    const refused = await buy(stack, battleId, gated.id);
    expect(refused.statusCode).toBe(403);
  });

  it('replaces the boost rather than stacking it, and charges again for the change of mind', async () => {
    const stack = await makeStack();
    const [first, second] = BATTLE_BOOSTS.filter((spec) => spec.unlock.kind === 'open');
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    const base = stack.repos.bases.findById(stack.baseId)!;
    const purse = first!.cost + second!.cost + 5;
    stack.repos.bases.updateEconomy(base.id, { ...base.economy, infamy: purse });

    expect((await buy(stack, battleId, first!.id)).statusCode).toBe(200);
    const changed = await buy(stack, battleId, second!.id);
    expect(changed.statusCode).toBe(200);
    const after = changed.json<BattleMutationResponse>();
    expect(after.battles.coming[0]!.boostId).toBe(second!.id);
    expect(after.base.economy.infamy).toBe(5);
  });

  /**
   * §D7: pressing "Burn the name" twice on the same boost is not a change of mind.
   *
   * The route charged `spec.cost` on every call and wrote the same `boostId` back, so a double
   * click, a retried request, or a player re-picking the boost they already hold (the dropdown
   * lists it and does not disable it) paid full price for a deployment row that did not move. The
   * test above pins that *changing* boost costs twice, which is the rule; this pins that not
   * changing it costs once.
   */
  it('charges nothing to buy the boost it already has', async () => {
    const stack = await makeStack();
    const spec = open();
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateEconomy(base.id, { ...base.economy, infamy: spec.cost * 3 });

    expect((await buy(stack, battleId, spec.id)).statusCode).toBe(200);
    const once = stack.repos.bases.findById(stack.baseId)!.economy.infamy;

    const again = await buy(stack, battleId, spec.id);
    expect(again.statusCode).toBe(200);
    expect(again.json<BattleMutationResponse>().battles.coming[0]!.boostId).toBe(spec.id);
    expect(stack.repos.bases.findById(stack.baseId)!.economy.infamy).toBe(once);
  });

  it('prices a boost against the force actually standing on the ground', async () => {
    const stack = await makeStack();
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    await deploy(stack, battleId, { razors: 4 });
    land(stack, battleId, new Date());

    const view = (await board(stack)).coming[0]!;
    const wholeForce = view.boosts.find(
      (option) => findBattleBoost(option.id)!.effect.kind === 'force',
    )!;
    const legends = view.boosts.find((option) => {
      const effect = findBattleBoost(option.id)!.effect;
      return effect.kind === 'tier' && effect.tier === 'legendary';
    })!;
    // Everything you sent is everything you sent; a boost on legends against four Razors is not.
    expect(wholeForce.reach).toBe(100);
    expect(legends.reach).toBe(0);
  });

  it('climbs the ladder, and the rank stays when the wallet is spent back down', async () => {
    const stack = await makeStack();
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      infamy: NOTORIETY_FIRST_COST + 5,
    });

    const climb = () =>
      stack.app.inject({
        method: 'POST',
        url: '/api/battles/notoriety',
        headers: auth(stack.token),
      });

    const bought = await climb();
    expect(bought.statusCode).toBe(200);
    const after = bought.json<BattleMutationResponse>();
    expect(after.base.economy.notoriety).toBe(1);
    expect(after.base.economy.infamy).toBe(5);

    // The second rung costs three times the first, so five points does not reach it.
    const short = await climb();
    expect(short.statusCode).toBe(409);
    expect(errorCode(short)).toBe('NOT_ENOUGH_INFAMY');
    expect(stack.repos.bases.findById(stack.baseId)!.economy.notoriety).toBe(1);
  });
});

describe('holding a district (§A4)', () => {
  /**
   * A gate cannot be dug in at all (board request).
   *
   * Watches came first: a count on every structure that bought 5% each and cost nothing, so an
   * empty roster could click a district 15% harder to enter. Fortification replaced them and made
   * the same mistake with a price on it, because it made a gate harder to get through without
   * making it any higher. A gate's strength is its level, so the route that sold the second number
   * is gone rather than refusing: there is nothing left for it to sell.
   */
  it('offers no way to dig a gate in', async () => {
    const stack = await makeStack();
    const gate = raiseGate(stack);
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateResources(base.id, {
      caps: 900_000,
      supplies: 900_000,
      oil: 900_000,
      scrap: 900_000,
      highQualityMetal: 9_000,
      planks: 900_000,
    });

    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/fortify',
      headers: auth(stack.token),
      payload: { buildingId: gate.id },
    });
    expect(res.statusCode).toBe(404);
  });

  /** And the defence tab has nothing to offer on it either: level and damage, that is the row. */
  it('lists a structure by its level and its damage, with nothing to dig', async () => {
    const stack = await makeStack();
    const gate = raiseGate(stack);

    const row = (await board(stack)).structures.find((entry) => entry.buildingId === gate.id)!;
    expect(row.level).toBe(1);
    expect(Object.keys(row).sort()).toEqual(
      ['buildingId', 'damage', 'effectiveness', 'kind', 'label', 'level'].sort(),
    );
  });

  /**
   * §B7: what a gate is worth is its level, wherever it stands.
   *
   * The same number for a wall raised at home and a wall taken with the district it sits in, which
   * is the board's rule that the two are on the same footing. Asserted against the captured gate's
   * own function rather than against a figure typed here, so the two cannot drift apart.
   */
  it('is worth the same per level at home as on ground it took', async () => {
    const stack = await makeStack();
    raiseGate(stack);
    const base = stack.repos.bases.findById(stack.baseId)!;
    const gate = base.buildings.find((building) => building.kind === 'gate')!;

    expect(gateDefensePercent(base.buildings)).toBe(capturedGateDefensePercent(gate.level));
  });
});

/**
 * §A1 against §A4: an army abroad is an army this crew still feeds.
 *
 * `districtPopulation` counts the roster, the bench and the garrisons on held ground, and the
 * reason it counts garrisons is written on it: leaving them out "would make emptying the district
 * into the city a way to house an army for free". A column on the road and a muster standing on a
 * battlefield are the same argument and were not in the same sum, so sending units out freed their
 * beds, the freed beds took a training order, and the fight handed the units back into a district
 * that no longer had room for them.
 */
describe('the beds an army abroad still occupies (§A1, §A4)', () => {
  it('frees no housing by sending units to a fight, walking or landed', async () => {
    const stack = await makeStack();
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateArmy(base.id, { razors: 10 }, base.trainingQueue);

    const home = await units(stack);
    expect(home.supplyUsed).toBeGreaterThan(0);

    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    expect((await deploy(stack, battleId, { razors: 4 })).statusCode).toBe(200);

    // On the road: off the roster, but still eating.
    expect((await units(stack)).supplyUsed).toBe(home.supplyUsed);

    // Standing on the ground: same argument, same answer.
    land(stack, battleId, new Date());
    expect((await units(stack)).supplyUsed).toBe(home.supplyUsed);
  });

  it('refuses a training order that only fits while the army is away', async () => {
    const stack = await makeStack();
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateArmy(base.id, { razors: 10 }, base.trainingQueue);
    stack.repos.bases.updateResources(base.id, {
      caps: 900_000,
      supplies: 900_000,
      oil: 900_000,
      scrap: 900_000,
      highQualityMetal: 0,
      planks: 900_000,
    });

    const before = await units(stack);
    const room = before.supplyCap - before.supplyUsed;

    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    await deploy(stack, battleId, { razors: 4 });

    // The four are away, so a naive count says there are four more beds than there are.
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/units/train',
      headers: auth(stack.token),
      payload: { unitId: 'razors', count: room + 4 },
    });
    expect(res.statusCode).toBe(409);
  });
});

/**
 * §J8: what a fight pays the faction, as opposed to what it pays the player.
 *
 * The board's rule has three halves and each one is a way the obvious implementation gets it wrong:
 * a faction's figure is not a sum of its members' wallets, it does not fall when somebody spends,
 * and it does not inherit what somebody was already holding when they walked in.
 */
describe('what a fight earns the faction', () => {
  const seat = (stack: Stack, username: string) => {
    const owner = stack.repos.bases.findById(stack.baseId)!.ownerId;
    stack.repos.factions.insert({
      id: 'f1',
      name: 'Iron Wolves',
      badge: DEFAULT_BADGE,
      blurb: '',
      foundedAt: new Date().toISOString(),
    });
    stack.repos.factions.addMember({
      userId: owner,
      factionId: 'f1',
      rank: 'leader',
      joinedAt: new Date().toISOString(),
    });
    expect(username).toBeTruthy();
    return owner;
  };

  const earned = (stack: Stack, owner: string) =>
    stack.repos.factions.membershipOf(owner)!.infamyEarned;

  it('credits the table with exactly what the fight paid the player', async () => {
    const stack = await makeStack('banker', decided('attacker'));
    const owner = seat(stack, 'banker');
    await readyFight(stack);

    const before = stack.repos.bases.findById(stack.baseId)!.economy.infamy;
    expect(earned(stack, owner)).toBe(0);

    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const after = stack.repos.bases.findById(stack.baseId)!.economy.infamy;
    expect(after).toBeGreaterThan(before);
    // The same number, not a recomputation of it: the faction is credited from the two economies
    // so a clamp on the player's side cannot leave the two disagreeing.
    expect(earned(stack, owner)).toBeCloseTo(after - before, 6);
  });

  /**
   * A member who joined holding a fortune hands the faction nothing.
   *
   * Asserted by giving the player a large balance *before* the fight and checking the faction's
   * figure is the fight's pay rather than the wallet.
   */
  it('ignores what a member was already holding', async () => {
    const stack = await makeStack('rich', decided('attacker'));
    const owner = seat(stack, 'rich');
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateEconomy(base.id, { ...base.economy, infamy: 30_000 });
    await readyFight(stack);

    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const after = stack.repos.bases.findById(stack.baseId)!.economy.infamy;
    expect(after).toBeGreaterThan(30_000);
    expect(earned(stack, owner)).toBeCloseTo(after - 30_000, 6);
    expect(earned(stack, owner)).toBeLessThan(1_000);
  });

  /** Spending is a thing you do with a wallet. The record of what you won does not move. */
  it('does not fall when the player spends infamy on notoriety', async () => {
    const stack = await makeStack('spender', decided('attacker'));
    const owner = seat(stack, 'spender');
    await readyFight(stack);
    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const won = earned(stack, owner);
    expect(won).toBeGreaterThan(0);

    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      infamy: base.economy.infamy + NOTORIETY_FIRST_COST,
    });
    const bought = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/notoriety',
      headers: auth(stack.token),
      payload: {},
    });
    expect(bought.statusCode).toBe(200);

    expect(earned(stack, owner)).toBe(won);
  });

  /**
   * The board's rule: append-only. A leaver does not un-win their fights.
   *
   * The member's own row goes with them, because that one is "what is this person contributing".
   * The faction's total does not, because that one is "what has this faction done", and the answer
   * to that does not change when somebody walks out of the room.
   */
  it('keeps what a leaver won, and forgets what the leaver was contributing', async () => {
    const stack = await makeStack('leaver', decided('attacker'));
    const owner = seat(stack, 'leaver');
    await readyFight(stack);
    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const won = earned(stack, owner);
    expect(won).toBeGreaterThan(0);
    expect(stack.repos.factions.find('f1')?.infamyEarned).toBeCloseTo(won, 6);

    stack.repos.factions.removeMember(owner);
    expect(stack.repos.factions.membershipOf(owner)).toBeUndefined();
    // The faction's record is untouched by the departure.
    expect(stack.repos.factions.find('f1')?.infamyEarned).toBeCloseTo(won, 6);

    // ...and rejoining starts the *contribution* from nothing without resetting the faction.
    stack.repos.factions.addMember({
      userId: owner,
      factionId: 'f1',
      rank: 'member',
      joinedAt: new Date().toISOString(),
    });
    expect(earned(stack, owner)).toBe(0);
    expect(stack.repos.factions.find('f1')?.infamyEarned).toBeCloseTo(won, 6);
  });

  /**
   * A member who joined holding a fortune hands the faction nothing.
   *
   * Asserted by giving the player a large balance *before* the fight and checking the faction's
   * figure is the fight's pay rather than the wallet.
   */
  it('ignores what a member was already holding', async () => {
    const stack = await makeStack('rich', decided('attacker'));
    const owner = seat(stack, 'rich');
    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateEconomy(base.id, { ...base.economy, infamy: 30_000 });
    await readyFight(stack);

    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const after = stack.repos.bases.findById(stack.baseId)!.economy.infamy;
    expect(after).toBeGreaterThan(30_000);
    expect(earned(stack, owner)).toBeCloseTo(after - 30_000, 6);
    expect(earned(stack, owner)).toBeLessThan(1_000);
  });

  /** Spending is a thing you do with a wallet. The record of what you won does not move. */
  it('does not fall when the player spends infamy on notoriety', async () => {
    const stack = await makeStack('spender', decided('attacker'));
    const owner = seat(stack, 'spender');
    await readyFight(stack);
    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());

    const won = earned(stack, owner);
    expect(won).toBeGreaterThan(0);

    const base = stack.repos.bases.findById(stack.baseId)!;
    stack.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      infamy: base.economy.infamy + NOTORIETY_FIRST_COST,
    });
    const bought = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/notoriety',
      headers: auth(stack.token),
      payload: {},
    });
    expect(bought.statusCode).toBe(200);

    expect(earned(stack, owner)).toBe(won);
  });
});

/**
 * A stored report this build cannot read costs its own row, and nothing else.
 *
 * The battles screen was unreachable for an account whose history contained one analysis written
 * before a tier rename: the parse threw, the projection threw, and `GET /battles` answered 500. A
 * history with a gap in it is a nuisance; a history that renders none of its rows because of one is
 * a broken game.
 */
describe('reading a battle history written by an older build', () => {
  it('skips a report it cannot parse and still serves the board', async () => {
    const stack = await makeStack('archivist', decided('attacker'));
    await readyFight(stack);
    settleBattles(stack.repos, stack.app.skirmishEngine, new Date());
    expect(stack.repos.sieges.resolvedFor(stack.baseId, 10)).toHaveLength(1);

    // Rewrite the stored analysis the way a retired vocabulary would leave it.
    const row = stack.db
      .prepare('SELECT id, analysis_json FROM scheduled_battles WHERE analysis_json IS NOT NULL')
      .get() as { id: string; analysis_json: string };
    const stored = JSON.parse(row.analysis_json) as {
      attacker: { units: { tier: string }[] };
      defender: { units: { tier: string }[] };
    };
    // The tier vocabulary as it was before the rename, which this build's enum does not have.
    // Written onto whichever side fielded somebody, so the test does not depend on which one the
    // fixture engine gave a unit line to.
    const lines = [...stored.attacker.units, ...stored.defender.units];
    if (lines.length > 0) {
      for (const line of lines) line.tier = 'regular';
    } else {
      stored.attacker.units = [{ tier: 'regular' }];
    }
    stack.db
      .prepare('UPDATE scheduled_battles SET analysis_json = ? WHERE id = ?')
      .run(JSON.stringify(stored), row.id);

    // The row is gone from the history rather than taking the history with it...
    expect(stack.repos.sieges.resolvedFor(stack.baseId, 10)).toHaveLength(0);

    // ...and the board still answers.
    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    expect(board.statusCode).toBe(200);
  });
});

/**
 * Two crews on one district must not have their rosters crossed.
 *
 * `resolveOne` looks the defender up twice and by different means: `residentOf(district)` decides
 * whose army *fights*, and `defendingBaseOf(battle)` decides whose roster is *written back*. They
 * agree while a district holds one crew, and every human account is planted on the same opening
 * ground with no unique index on `district_id`, so two is reachable on day one.
 *
 * When they disagree the settle consumes one crew's army and overwrites the other's with the
 * survivors: units destroyed for a player who was not in the fight, and conjured for one who was.
 * A single write, no report, nothing to trace it by.
 */
describe('a district with two crews on it', () => {
  const bodies = (army: Record<string, number>): number =>
    Object.values(army).reduce((total, count) => total + count, 0);

  it('never writes one crew the survivors of another crew’s roster', async () => {
    /*
     * The defender must *win*, and that is load-bearing rather than incidental.
     *
     * On a defeat the defending roster is emptied either way, so the cross-wire is invisible: the
     * first three versions of this test used an attacker win and passed against the bug. It is the
     * write-back of survivors that carries the damage.
     */
    const stack = await makeStack('crossed', decided('defender'));
    // A second crew on the same ground as the rival, so `residentOf` and the named defender can
    // pick different bases.
    /*
     * The divergence needs three things at once, and each is reachable on an ordinary board:
     * a gate (so one party holds the whole district), a *named crew* defending it (so
     * `defendingBaseOf` answers with that crew), and a second crew living on the same ground that
     * `residentOf` answers with instead.
     */
    // The bystander is planted *first*, so `residentOf` answers with them: it takes the district's
    // inhabitant by district alone and there is only ever one seat at that table.
    const bystanderId = plantRival(stack, {
      id: 'bystander-base',
      userId: 'bystander-user',
      username: 'bystander',
      army: { razors: 9 },
    });
    const rivalId = plantRival(stack);
    // The rival holds every location, so the gate is theirs and the fight names them.
    for (const locationId of RUSTYARD_LOCATIONS) {
      const control = stack.repos.city.control(locationId)!;
      stack.repos.city.put({
        ...control,
        holder: { kind: 'crew', baseId: rivalId },
        garrison: { razors: 2 },
      });
    }
    stack.repos.bases.updateArmy(rivalId, { razors: 4 }, []);
    const bystanderBefore = stack.repos.bases.findById(bystanderId)!.army;
    const before = bodies(stack.repos.bases.findById(rivalId)!.army) + bodies(bystanderBefore);

    const declared = await declare(stack, { kind: 'gate', districtId: 'rustyard' });
    expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
    bringForward(stack, battle, new Date(Date.now() - 60_000));
    expect(settleBattles(stack.repos, stack.app.skirmishEngine, new Date())).toHaveLength(1);

    /*
     * Conservation, because the damage is duplication rather than deletion.
     *
     * Under the cross-wire the bystander's roster is read into the defence and never written back,
     * so it still reads 9 afterwards, while the *named* defender is handed the survivors of a
     * force that was never theirs. Asserting "the bystander is untouched" therefore passes against
     * the bug: it is untouched, and that is precisely the problem. What cannot survive is the sum.
     */
    const after =
      bodies(stack.repos.bases.findById(rivalId)!.army) +
      bodies(stack.repos.bases.findById(bystanderId)!.army);
    expect(after, 'the settle minted bodies across the two crews').toBeLessThanOrEqual(before);

    // And the crew that was not named kept exactly what it had: it was never in this fight.
    expect(stack.repos.bases.findById(bystanderId)!.army).toEqual(bystanderBefore);
  });
});

/**
 * A gate held by a crew who does not live behind it.
 *
 * `districtHolder` makes whoever holds every location in a district the defender of its gate, and
 * it never asks where they sleep. A crew living in the Ashen Terraces can hold the whole Rustyard,
 * and then the Rustyard has a named crew defender and no resident at all.
 *
 * `assemble` takes that crew and folds their **home roster** into the defence, because its third
 * parameter is the base whose books are settled rather than the district's inhabitant. For a crew
 * defending their own home that is right and is the point: nobody should have to remember to
 * defend the room they are standing in. For a crew three districts away it conscripts an army that
 * never marched, and `fromHomeRoster` then makes the survivors *replace* the roster, so a lost gate
 * fight in a district they only hold on paper destroys everything they own at home.
 *
 * An attacker who wanted a rival's standing army gone did not have to find it. They declared on a
 * gate.
 */
describe('a gate held from a district you do not live in', () => {
  const bodies = (army: Record<string, number>): number =>
    Object.values(army).reduce((total, count) => total + count, 0);

  /** A second real account, through the real routes, so the deploy below is a player's own. */
  async function secondCrew(
    stack: Stack,
    username: string,
  ): Promise<{ token: string; id: string }> {
    const registered = await stack.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'hunter2pass' },
    });
    expect(registered.statusCode, registered.body.slice(0, 200)).toBe(201);
    const token = registered.json<{ token: string }>().token;
    const chosen = await stack.app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'enforcer' },
    });
    expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
    const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
    // The whole premise. If a later change plants new crews in the Rustyard this fixture stops
    // testing anything, and it should say so rather than quietly pass.
    expect(base.districtId, 'the fixture crew was planted in the district it is holding').not.toBe(
      'rustyard',
    );
    return { token, id: base.id };
  }

  /** Hands the Rustyard to one crew outright, which is what arms its gate in their name. */
  function handOver(stack: Stack, baseId: string, garrison: Record<string, number>): void {
    for (const locationId of RUSTYARD_LOCATIONS) {
      const control = stack.repos.city.control(locationId)!;
      stack.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison });
    }
  }

  /** Declares on the gate and settles it, after letting the holder send whatever they are sending. */
  async function fightOverTheGate(
    stack: Stack,
    holder: { token: string; id: string },
    send: Record<string, number> | null,
  ): Promise<void> {
    const declared = await declare(stack, { kind: 'gate', districtId: 'rustyard' });
    expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
    expect(battle.defender).toEqual({ kind: 'crew', baseId: holder.id });

    if (send) {
      const sent = await stack.app.inject({
        method: 'POST',
        url: '/api/battles/deploy',
        headers: auth(holder.token),
        payload: { battleId: battle.id, changes: send, perimeterChanges: {} },
      });
      expect(
        sent.statusCode,
        `the holder could not defend their gate: ${sent.body.slice(0, 200)}`,
      ).toBe(200);
    }

    bringForward(stack, battle, new Date(Date.now() - 60_000));
    expect(settleBattles(stack.repos, stack.app.skirmishEngine, new Date())).toHaveLength(1);
  }

  it('does not spend the home army of a crew that sent nothing to the fight', async () => {
    const stack = await makeStack('raider', decided('attacker'));
    const holder = await secondCrew(stack, 'holder');
    handOver(stack, holder.id, { razors: 2 });
    stack.repos.bases.updateArmy(holder.id, { razors: 10 }, []);

    // They sent nobody: the gate is defended by what is standing in the district, and their own
    // crew is at home in another one.
    await fightOverTheGate(stack, holder, null);

    expect(
      stack.repos.bases.findById(holder.id)!.army,
      'a gate fight in a district they only hold destroyed the army at their home',
    ).toEqual({ razors: 10 });
  });

  it('sends a winning holder the column they did send back home', async () => {
    const stack = await makeStack('raider', decided('defender'));
    const holder = await secondCrew(stack, 'holder');
    handOver(stack, holder.id, { razors: 2 });
    stack.repos.bases.updateArmy(holder.id, { razors: 10 }, []);

    await fightOverTheGate(stack, holder, { razors: 6 });

    // Nobody died: `decided` names a winner and no losses. The six that marched are owed back, and
    // the four that stayed home were never in it.
    expect(
      bodies(stack.repos.bases.findById(holder.id)!.army),
      'the winning holder did not get their column back',
    ).toBe(10);
  });
});
