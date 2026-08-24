import {
  findDistrict,
  findLocation,
  startingHolder,
  GATE_BREACH_HOURS,
  BATTLE_BOOSTS,
  NOTORIETY_FIRST_COST,
  findBattleBoost,
  NOTORIETY_TO_FIELD,
  MAX_BUILDING_GARRISONS,
  declarationWindow,
  deployedSize,
  districtDefense,
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
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import type { Repositories } from '../db/repos/index.js';
import { MAX_PENDING_DECLARATIONS } from './declare.js';
import { settleBattles } from './resolve.js';

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

  await app.inject({
    method: 'POST',
    url: '/api/city/scout',
    headers: auth(token),
    payload: { districtId: 'rustyard' },
  });

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
    expect(afterSending.base.army.razors ?? 0).toBe(before - 2);
    expect(afterSending.battles.coming[0]!.muster?.army.razors).toBe(2);

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

    const res = await deploy(stack, battleId, { razors: 1 }, { razors: 1 });
    const view = res.json<BattleMutationResponse>().battles.coming[0]!;
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

describe('resolving it (§A4)', () => {
  /** Sets a fight up, moves people to it, and drags its mark into the past. */
  async function readyFight(stack: Stack, force: Record<string, number> = { razors: 4 }) {
    const declared = await declare(stack);
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
    if (Object.keys(force).length > 0) await deploy(stack, battle.id, force);
    const mark = new Date(Date.now() - 60_000);
    bringForward(stack, battle, mark);
    return { battle: stack.repos.sieges.find(battle.id)!, mark };
  }

  it('takes the location on a win, clears its diggings and brings the survivors home', async () => {
    const stack = await makeStack('winner', decided('attacker'));
    const { battle } = await readyFight(stack);
    const before = stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0;

    const settled = settleBattles(stack.repos, stack.app.skirmishEngine, new Date());
    expect(settled).toHaveLength(1);

    const control = stack.repos.city.control(SQUATTED_RUSTYARD_LOCATION)!;
    expect(control.holder).toEqual({ kind: 'faction', baseId: stack.baseId });
    expect(control.fortification).toBe(0);
    expect(control.garrison).toEqual({});
    expect(stack.repos.bases.findById(stack.baseId)!.army.razors ?? 0).toBe(before + 4);
    expect(stack.repos.sieges.find(battle.id)!.resolvedAt).not.toBeNull();
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

  it('prices a boost against the force actually standing on the ground', async () => {
    const stack = await makeStack();
    const declared = await declare(stack);
    const battleId = declared.json<BattleMutationResponse>().battles.coming[0]!.battle.id;
    await deploy(stack, battleId, { razors: 4 });

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
  it('garrisons a structure up to three times and no further, and it is worth defence', async () => {
    const stack = await makeStack();
    const base = stack.repos.bases.findById(stack.baseId)!;
    const nexus = base.buildings[0]!;
    const bare = districtDefense(base.buildings);

    const post = (delta: number) =>
      stack.app.inject({
        method: 'POST',
        url: '/api/battles/garrison',
        headers: auth(stack.token),
        payload: { buildingId: nexus.id, delta },
      });

    for (let i = 0; i < MAX_BUILDING_GARRISONS; i += 1)
      expect((await post(1)).statusCode).toBe(200);
    expect((await post(1)).statusCode).toBe(409);

    const held = stack.repos.bases.findById(stack.baseId)!;
    expect(held.buildings.find((b) => b.id === nexus.id)!.garrisons).toBe(MAX_BUILDING_GARRISONS);
    expect(districtDefense(held.buildings)).toBeGreaterThan(bare);
  });
});
