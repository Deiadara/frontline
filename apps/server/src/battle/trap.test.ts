import {
  TRAP_CATALOG,
  blueprintForTrap,
  declarationWindow,
  findDistrict,
  findTrap,
  findTech,
  skirmishOutcome,
  startingHolder,
  type BattlesResponse,
  type BattleMutationResponse,
  type BattleTarget,
  type ItemId,
  type ScrapyardResponse,
  type SkirmishEngine,
} from '@frontline/shared';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createSiegeRepo } from '../db/repos/sieges.js';
import { settleBattles } from './resolve.js';
import { settleMovements } from './movement.js';

/**
 * Traps as a defensive consumable, end to end (plan §I4).
 *
 * The arithmetic of a trap going off is `battle/traps.ts` in the shared package and has not moved.
 * What is new is everything around it: the yard builds one behind two gates, it sits in a satchel,
 * a **defender** names it on a coming fight for nothing, and it leaves the bag at the mark.
 *
 * The fixture is deliberately two real crews rather than one crew and the looters, because almost
 * every rule here is about which side the caller is on, and a fight against an NPC has no caller
 * on the other side of it to refuse.
 */

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

interface Crew {
  token: string;
  id: string;
}

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  attacker: Crew;
  defender: Crew;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url));

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** The sentence out of the `{error:{code,message}}` envelope every refusal here comes back in. */
const messageOf = (res: InjectResponse): string =>
  res.json<{ error: { message: string } }>().error.message;

const RUSTYARD_LOCATIONS: readonly string[] = (findDistrict('rustyard')?.locations ?? []).map(
  (location) => location.id,
);

/** The one the looters actually stand on: an empty lot has nobody to hand over from. */
const SQUATTED: string = (() => {
  const district = findDistrict('rustyard');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Rustyard has nobody on it at all');
  return held.id;
})();

const PRESS: BattleTarget = { kind: 'location', districtId: 'rustyard', locationId: SQUATTED };

/** The cheapest trap and its document, read off the catalogues rather than typed out. */
const TRAP = TRAP_CATALOG[0]!;
const TRAP_ITEM = TRAP.id as ItemId;

async function signUp(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(registered.statusCode, registered.body.slice(0, 200)).toBe(201);
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  // The premise of the whole fixture. A crew planted in the Rustyard would be its *resident* and
  // the fight would be about their home rather than about a location they merely hold.
  expect(base.districtId, `${username} was planted in the district they are holding`).not.toBe(
    'rustyard',
  );
  return { token, id: base.id };
}

/**
 * One app, two crews, and a fight the second is defending.
 *
 * The attacker scouts and declares; the defender is handed the location first, which is what makes
 * `battle.defender` a named crew rather than the looters and therefore what makes `sideOf` answer
 * `'defender'` for their token.
 */
async function makeStack(engine?: SkirmishEngine): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = engine
    ? await buildApp({ config, db, skirmishEngine: engine, logger: false })
    : await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const attacker = await signUp(app, 'raider');
  const defender = await signUp(app, 'holder');

  app.repos.city.markScouted(attacker.id, 'rustyard', new Date().toISOString());
  for (const locationId of RUSTYARD_LOCATIONS) app.repos.city.control(locationId);
  const control = app.repos.city.control(SQUATTED)!;
  app.repos.city.put({
    ...control,
    holder: { kind: 'crew', baseId: defender.id },
    garrison: { razors: 2 },
  });

  return { app, db, attacker, defender };
}

async function declareOn(stack: Stack, target: BattleTarget = PRESS): Promise<string> {
  const res = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.attacker.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  /*
   * Picked out by its target rather than taken off the top of `coming`.
   *
   * Two fights declared in the same tick share a mark, so `coming[0]` is whichever the board
   * happens to sort first: reading it gave both declarations the *same* id, and the two-fight test
   * below then set one trap on one battle twice and passed for the wrong reason.
   */
  const named = res
    .json<BattleMutationResponse>()
    .battles.coming.find(
      (view) =>
        view.battle.target.kind === target.kind &&
        JSON.stringify(view.battle.target) === JSON.stringify(target),
    );
  expect(named, 'the declaration is not on the board').toBeDefined();
  expect(named!.battle.defender, 'the fight is not against the crew this fixture set up').toEqual({
    kind: 'crew',
    baseId: stack.defender.id,
  });
  return named!.battle.id;
}

/** Puts `count` of one item straight into a crew's satchel, leaving the stockpile alone. */
function give(stack: Stack, baseId: string, item: ItemId, count: number): void {
  const base = stack.app.repos.bases.findById(baseId)!;
  const inventory = { ...base.inventory };
  if (count <= 0) delete inventory[item];
  else inventory[item] = count;
  stack.app.repos.bases.updateHoldings(baseId, base.resources, inventory);
}

function setTrap(
  stack: Stack,
  token: string,
  battleId: string,
  trapId: string | null,
): Promise<InjectResponse> {
  return stack.app.inject({
    method: 'POST',
    url: '/api/battles/trap',
    headers: auth(token),
    payload: { battleId, trapId },
  });
}

async function boardFor(stack: Stack, token: string): Promise<BattlesResponse> {
  const res = await stack.app.inject({ method: 'GET', url: '/api/battles', headers: auth(token) });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  return res.json<BattlesResponse>();
}

const heldOf = (stack: Stack, baseId: string): number =>
  stack.app.repos.bases.findById(baseId)!.inventory[TRAP_ITEM] ?? 0;

/** Winds a fight's mark and its columns back so the settler will pick it up. */
function bringForward(stack: Stack, battleId: string, at: Date): void {
  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(at.toISOString(), battleId);
  stack.db
    .prepare('UPDATE troop_movements SET arrives_at = ? WHERE battle_id = ?')
    .run(at.toISOString(), battleId);
  settleMovements(stack.app.repos, at);
}

/** Sends the attacker's column and lands it, so there is a force for a trap to bite. */
async function sendAttackers(stack: Stack, battleId: string, army: Record<string, number>) {
  const base = stack.app.repos.bases.findById(stack.attacker.id)!;
  stack.app.repos.bases.updateArmy(base.id, army, base.trainingQueue);
  const sent = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.attacker.token),
    payload: { battleId, changes: army, perimeterChanges: {} },
  });
  expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);
}

describe('§I4: setting a trap on a fight you are defending', () => {
  it('takes the trap the defender is carrying, and takes nothing out of the bag for it', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 2);

    const res = await setTrap(stack, stack.defender.token, battleId, TRAP.id);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);

    const view = res.json<BattleMutationResponse>().battles.coming[0]!;
    expect(view.trapId).toBe(TRAP.id);
    // §I4c: nothing is spent by naming it. The bag is untouched until the fight resolves.
    expect(heldOf(stack, stack.defender.id)).toBe(2);
  });

  it('lets the defender take it back up again for nothing', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 1);
    expect((await setTrap(stack, stack.defender.token, battleId, TRAP.id)).statusCode).toBe(200);

    const cleared = await setTrap(stack, stack.defender.token, battleId, null);
    expect(cleared.statusCode, cleared.body.slice(0, 200)).toBe(200);
    expect(cleared.json<BattleMutationResponse>().battles.coming[0]!.trapId).toBeNull();
    expect(heldOf(stack, stack.defender.id)).toBe(1);
  });

  /*
   * The three refusals below look identical from outside the process, which is why each fixture
   * satisfies every requirement except the one under test. A defender with an empty bag and an
   * attacker with a full one both come back 403; only the sentence tells them apart, and only
   * these three cases together prove that three separate clauses exist rather than one.
   */
  it('refuses a defender who is not carrying one, with everything else in order', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 0);

    const res = await setTrap(stack, stack.defender.token, battleId, TRAP.id);
    expect(res.statusCode).toBe(403);
    expect(messageOf(res)).toBe('You are not carrying one of those');
  });

  it('refuses the attacker even when they are carrying one', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    give(stack, stack.attacker.id, TRAP_ITEM, 3);

    const res = await setTrap(stack, stack.attacker.token, battleId, TRAP.id);
    expect(res.statusCode).toBe(403);
    expect(messageOf(res)).toBe('You are the one walking in. There is nothing to bury');
  });

  it('refuses a bystander carrying one', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    const nosy = await signUp(stack.app, 'nosy');
    give(stack, nosy.id, TRAP_ITEM, 1);

    const res = await setTrap(stack, nosy.token, battleId, TRAP.id);
    expect(res.statusCode).toBe(403);
    expect(messageOf(res)).toBe('You are not in this one');
  });

  it('refuses a trap nobody has heard of', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 1);

    const res = await setTrap(stack, stack.defender.token, battleId, 'trap_nonsense');
    expect(res.statusCode).toBe(404);
  });

  /*
   * The window between deployment closing and the fight going off is exactly one second
   * (`DEPLOY_CUTOFF_MS`), and the fixture has to sit inside it: wind the mark all the way into the
   * past and the route's own `settleWorld` resolves the fight first, so the answer is "no fight by
   * that name" rather than the refusal under test. The mark is put 900ms out, which leaves the
   * request nine tenths of a second to land and an in-process inject takes single-digit
   * milliseconds.
   */
  it('refuses once they are already on the ground', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 1);
    stack.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() + 900).toISOString(), battleId);

    const res = await setTrap(stack, stack.defender.token, battleId, TRAP.id);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(409);
    expect(messageOf(res)).toBe('They are already on the ground');
  });

  /**
   * §I4c: one trap per **side**, not one per crew.
   *
   * The row holds a single id, so a crew cannot set two whatever this route does. What is enforced
   * here is the ally: a reinforcement with a shell of their own would be a second row for
   * `springAnyTrap` to find, and two traps going off is not what the board asked for.
   */
  it('refuses an ally a second trap once the defender has set one', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    const ally = await signUp(stack.app, 'ally');
    give(stack, stack.defender.id, TRAP_ITEM, 1);
    give(stack, ally.id, TRAP_ITEM, 1);
    // The ally is on the side because they have a row on it, exactly as a reinforcement would be.
    stack.app.repos.sieges.putDeployment({
      battleId,
      baseId: ally.id,
      side: 'defender',
      army: {},
      perimeter: {},
      boostId: null,
      officerId: null,
      trapId: null,
      vehicles: {},
      updatedAt: new Date().toISOString(),
    });

    expect((await setTrap(stack, stack.defender.token, battleId, TRAP.id)).statusCode).toBe(200);
    const second = await setTrap(stack, ally.token, battleId, TRAP.id);
    expect(second.statusCode).toBe(403);
    expect(messageOf(second)).toBe('Somebody on your side has already set one');
  });

  it('lets an ally set the one trap when the defender has not', async () => {
    const stack = await makeStack();
    const battleId = await declareOn(stack);
    const ally = await signUp(stack.app, 'ally2');
    give(stack, ally.id, TRAP_ITEM, 1);
    stack.app.repos.sieges.putDeployment({
      battleId,
      baseId: ally.id,
      side: 'defender',
      army: {},
      perimeter: {},
      boostId: null,
      officerId: null,
      trapId: null,
      vehicles: {},
      updatedAt: new Date().toISOString(),
    });

    const res = await setTrap(stack, ally.token, battleId, TRAP.id);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(stack.app.repos.sieges.deployment(battleId, 'defender', ally.id)!.trapId).toBe(TRAP.id);
  });
});

describe('§I4e/§I4f: what each side is told about traps', () => {
  it('sends the defender the whole catalogue with what they hold, and the attacker none', async () => {
    const stack = await makeStack();
    await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 2);

    const mine = (await boardFor(stack, stack.defender.token)).coming[0]!;
    expect(mine.side).toBe('defender');
    expect(mine.traps).toHaveLength(TRAP_CATALOG.length);
    const first = mine.traps.find((option) => option.trapId === TRAP.id)!;
    expect(first.held).toBe(2);
    expect(first.available).toBe(true);
    const other = mine.traps.find((option) => option.trapId !== TRAP.id)!;
    expect(other.held).toBe(0);
    expect(other.available).toBe(false);
    expect(other.blocker.length).toBeGreaterThan(0);

    const theirs = (await boardFor(stack, stack.attacker.token)).coming[0]!;
    expect(theirs.side).toBe('attacker');
    expect(theirs.traps).toEqual([]);
  });
});

describe('§I4d: the trap goes off at the mark and leaves the bag', () => {
  /** An engine that reports what it was handed, so a bite off the attack is measurable. */
  function counting(seen: { attacking: number }): SkirmishEngine {
    return {
      resolve: (input) => {
        seen.attacking = Object.values(input.attacking).reduce((sum, count) => sum + count, 0);
        return skirmishOutcome({ winner: 'defender', log: ['done'], fled: { razors: 1 } });
      },
    };
  }

  it('takes a bite out of the attack and one trap out of the satchel', async () => {
    const seen = { attacking: 0 };
    const stack = await makeStack(counting(seen));
    const battleId = await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 2);
    expect((await setTrap(stack, stack.defender.token, battleId, TRAP.id)).statusCode).toBe(200);

    await sendAttackers(stack, battleId, { razors: 30 });
    bringForward(stack, battleId, new Date(Date.now() - 60_000));
    expect(settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date())).toHaveLength(1);

    expect(seen.attacking, 'the trap did not bite').toBeLessThan(30);
    expect(seen.attacking, 'the trap was a wall').toBeGreaterThan(0);
    expect(heldOf(stack, stack.defender.id), 'the trap was not spent').toBe(1);
  });

  it('names the trap in the report', async () => {
    const seen = { attacking: 0 };
    const stack = await makeStack(counting(seen));
    const battleId = await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 1);
    await setTrap(stack, stack.defender.token, battleId, TRAP.id);
    await sendAttackers(stack, battleId, { razors: 30 });
    bringForward(stack, battleId, new Date(Date.now() - 60_000));
    const [resolved] = settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());

    expect(resolved!.analysis.trap?.name).toBe(TRAP.name);
    expect(resolved!.analysis.trap!.killed).toBeGreaterThan(0);
  });

  /**
   * §I4d: the same trap named on two fights lands on whichever resolves first.
   *
   * Exactly the rule contraband follows. Naming costs nothing and is reversible, so the bag is the
   * only thing that can stop one shell being spent twice, and it is checked at the mark rather
   * than at the moment the name was written.
   */
  it('lands on the first fight to resolve and leaves the second with nothing', async () => {
    const seen = { attacking: 0 };
    const stack = await makeStack(counting(seen));
    const first = await declareOn(stack);
    const other = RUSTYARD_LOCATIONS.find((id) => id !== SQUATTED && id !== 'rustyard-ramp')!;
    const control = stack.app.repos.city.control(other)!;
    stack.app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: stack.defender.id },
      garrison: { razors: 2 },
    });
    const second = await declareOn(stack, {
      kind: 'location',
      districtId: 'rustyard',
      locationId: other,
    });

    give(stack, stack.defender.id, TRAP_ITEM, 1);
    expect((await setTrap(stack, stack.defender.token, first, TRAP.id)).statusCode).toBe(200);
    expect((await setTrap(stack, stack.defender.token, second, TRAP.id)).statusCode).toBe(200);

    const base = stack.app.repos.bases.findById(stack.attacker.id)!;
    stack.app.repos.bases.updateArmy(base.id, { razors: 60 }, base.trainingQueue);
    for (const battleId of [first, second]) {
      const sent = await stack.app.inject({
        method: 'POST',
        url: '/api/battles/deploy',
        headers: auth(stack.attacker.token),
        payload: { battleId, changes: { razors: 30 }, perimeterChanges: {} },
      });
      expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);
    }

    bringForward(stack, first, new Date(Date.now() - 120_000));
    bringForward(stack, second, new Date(Date.now() - 60_000));
    const resolved = settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());
    expect(resolved).toHaveLength(2);

    const notes = resolved.map((entry) => entry.analysis.trap);
    expect(
      notes.filter((note) => note !== null),
      'the one trap went off twice',
    ).toHaveLength(1);
    expect(heldOf(stack, stack.defender.id)).toBe(0);
  });

  it('does nothing when the row names a trap the crew no longer holds', async () => {
    const seen = { attacking: 0 };
    const stack = await makeStack(counting(seen));
    const battleId = await declareOn(stack);
    give(stack, stack.defender.id, TRAP_ITEM, 1);
    await setTrap(stack, stack.defender.token, battleId, TRAP.id);
    // Sold, spent elsewhere, whatever: the row still names it and the bag is empty.
    give(stack, stack.defender.id, TRAP_ITEM, 0);

    await sendAttackers(stack, battleId, { razors: 30 });
    bringForward(stack, battleId, new Date(Date.now() - 60_000));
    const [resolved] = settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());

    expect(seen.attacking, 'a trap the crew does not hold still went off').toBe(30);
    expect(resolved!.analysis.trap).toBeNull();
  });
});

describe('§I4a/§I4b: the yard cuts one, behind two gates', () => {
  const document = blueprintForTrap(TRAP.id)!;
  const rung = findTech(TRAP.requiresTech)!;

  async function yard(stack: Stack): Promise<ScrapyardResponse> {
    const res = await stack.app.inject({
      method: 'GET',
      url: '/api/scrapyard',
      headers: auth(stack.defender.token),
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    return res.json<ScrapyardResponse>();
  }

  function build(stack: Stack): Promise<InjectResponse> {
    return stack.app.inject({
      method: 'POST',
      url: '/api/scrapyard/build',
      headers: auth(stack.defender.token),
      payload: { kind: 'trap', id: TRAP.id },
    });
  }

  /** A yard on the ground, the whole bill in the stockpile, and nothing else granted. */
  function readyToCut(stack: Stack): void {
    const base = stack.app.repos.bases.findById(stack.defender.id)!;
    stack.app.repos.bases.updateDistrict(
      base.id,
      [
        ...base.buildings.filter((building) => building.kind !== 'scrapyard'),
        { id: 'yard-1', kind: 'scrapyard', level: 3, modifications: [], damage: 0 },
      ],
      base.buildQueue,
    );
    stack.app.repos.bases.updateResources(base.id, {
      ...base.resources,
      scrap: 99_000,
      planks: 99_000,
      oil: 99_000,
      highQualityMetal: 99_000,
      caps: 99_000,
    });
  }

  const entryFor = (board: ScrapyardResponse) => board.entries.find((row) => row.id === TRAP.id)!;

  it('puts every trap on the board with the document it wants', async () => {
    const stack = await makeStack();
    readyToCut(stack);
    const board = await yard(stack);
    for (const spec of TRAP_CATALOG) {
      const row = board.entries.find((entry) => entry.id === spec.id);
      expect(row, spec.id).toBeDefined();
      expect(row!.kind).toBe('trap');
      expect(row!.building).toBeNull();
      expect(row!.cost).toEqual(spec.cost);
      expect(row!.blueprint).toBe(blueprintForTrap(spec.id)!.name);
    }
  });

  it('asks for the drawings first, then the Lab, then the bill, and cuts one at the end', async () => {
    const stack = await makeStack();
    readyToCut(stack);

    // Nothing: the document is what a player collects page by page, so it is named first.
    expect(entryFor(await yard(stack)).blocker).toBe(`Needs the ${document.name}`);
    let refused = await build(stack);
    expect(refused.statusCode).toBe(409);
    expect(messageOf(refused)).toBe(`Needs the ${document.name}`);

    // The document alone is not enough: the Lab rung is a separate gate and this proves it exists.
    give(stack, stack.defender.id, document.id as ItemId, 1);
    expect(entryFor(await yard(stack)).blocker).toBe(`Needs ${rung.name} from the Lab`);
    refused = await build(stack);
    expect(refused.statusCode).toBe(409);
    expect(messageOf(refused)).toBe(`Needs ${rung.name} from the Lab`);

    // ...and the rung alone is not enough either, which is the other half of the same proof.
    const withRung = stack.app.repos.bases.findById(stack.defender.id)!;
    stack.app.repos.bases.updateResearch(withRung.id, {
      ...withRung.research,
      technologies: [...withRung.research.technologies, TRAP.requiresTech],
    });
    give(stack, stack.defender.id, document.id as ItemId, 0);
    expect(entryFor(await yard(stack)).blocker).toBe(`Needs the ${document.name}`);

    // Both, and the money: the yard cuts it into the satchel and takes the bill.
    give(stack, stack.defender.id, document.id as ItemId, 1);
    const before = stack.app.repos.bases.findById(stack.defender.id)!.resources;
    expect(entryFor(await yard(stack)).blocker).toBeNull();
    const built = await build(stack);
    expect(built.statusCode, built.body.slice(0, 200)).toBe(200);

    expect(heldOf(stack, stack.defender.id)).toBe(1);
    expect(stack.app.repos.bases.findById(stack.defender.id)!.resources.scrap).toBe(
      before.scrap - (TRAP.cost.scrap ?? 0),
    );
    // Building a second is legal: two fights on the same evening want two traps.
    expect((await build(stack)).statusCode).toBe(200);
    expect(heldOf(stack, stack.defender.id)).toBe(2);
    expect(entryFor(await yard(stack)).owned).toBe(2);
  });

  it('refuses when the bill cannot be covered, with both gates open', async () => {
    const stack = await makeStack();
    readyToCut(stack);
    give(stack, stack.defender.id, document.id as ItemId, 1);
    const base = stack.app.repos.bases.findById(stack.defender.id)!;
    stack.app.repos.bases.updateResearch(base.id, {
      ...base.research,
      technologies: [...base.research.technologies, TRAP.requiresTech],
    });
    stack.app.repos.bases.updateResources(base.id, { ...base.resources, scrap: 0 });

    expect(entryFor(await yard(stack)).blocker).toBe('You cannot cover that');
    const refused = await build(stack);
    expect(refused.statusCode).toBe(409);
    expect(messageOf(refused)).toBe('You cannot cover that');
  });

  it('will not cut a trap that is not in the catalogue', async () => {
    const stack = await makeStack();
    readyToCut(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/scrapyard/build',
      headers: auth(stack.defender.token),
      payload: { kind: 'trap', id: 'trap_nonsense' },
    });
    expect(res.statusCode).toBe(409);
    expect(messageOf(res)).toBe('No such trap');
  });
});

/**
 * Migration 0078, checked against a row written by the schema before it.
 *
 * `BattleDeploymentSchema.parse` runs on every deployment read, so a column that arrived without a
 * default would throw for every fight declared before today rather than for none of them, and it
 * would throw inside the *global* settler, which takes the world tick down for everybody rather
 * than one save. The only way to see that is to write the old row and migrate it.
 */
describe('§I4c: migration 0078 on a deployment written before it', () => {
  const MINE = '0078_trap_on_deployment.sql';

  /** Every migration up to but not including `stopBefore`: the schema the legacy row was written by. */
  function migrateUpTo(db: AppDatabase, stopBefore: string): void {
    db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       )`,
    );
    for (const file of readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      if (file >= stopBefore) break;
      db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    }
  }

  const legacyRow = (): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, MINE);
    // A deployment references a battle which references a base which references a user, and this
    // fixture is about one column on one row. The keys go off for the insert and back on for the
    // migration, which is where they would matter. Set *after* the catch-up, because migration
    // 0045 rebuilds this very table and ends by turning them on again.
    db.pragma('foreign_keys = OFF');
    db.prepare(
      `INSERT INTO battle_deployments
         (battle_id, base_id, side, army_json, perimeter_json, boost_id, officer_id,
          vehicles_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'old-fight',
      'old-base',
      'defender',
      '{"razors":4}',
      '{}',
      'boost_plated_overnight',
      'off-1',
      '{"motorcycle":2}',
      '2026-08-01T00:00:00.000Z',
    );
    db.pragma('foreign_keys = ON');
    return db;
  };

  it('reads back as a fight with no trap on it, and changes nothing else', () => {
    const db = legacyRow();
    runMigrations(db);

    const row = createSiegeRepo(db).deployment('old-fight', 'defender', 'old-base');
    expect(row, 'the legacy deployment did not survive the migration').toBeDefined();
    expect(row!.trapId).toBeNull();
    // Every other field the row carried, so an ALTER that rebuilt the table would be caught here.
    expect(row!.army).toEqual({ razors: 4 });
    expect(row!.boostId).toBe('boost_plated_overnight');
    expect(row!.officerId).toBe('off-1');
    expect(row!.vehicles).toEqual({ motorcycle: 2 });
    expect(row!.updatedAt).toBe('2026-08-01T00:00:00.000Z');
    db.close();
  });

  it('is byte-identical when applied twice', () => {
    const db = legacyRow();
    runMigrations(db);
    const once = db.prepare('SELECT * FROM battle_deployments ORDER BY battle_id').all();
    // Applied a second time by hand, because the runner never re-runs a migration it has recorded.
    expect(() => db.exec(readFileSync(path.join(MIGRATIONS_DIR, MINE), 'utf8'))).toThrow(
      /duplicate column/i,
    );
    expect(db.prepare('SELECT * FROM battle_deployments ORDER BY battle_id').all()).toEqual(once);
    db.close();
  });
});

describe('the catalogues that have to agree', () => {
  it('gives every trap an item, a document and a Lab rung', () => {
    for (const spec of TRAP_CATALOG) {
      expect(findTrap(spec.id), spec.id).toBeDefined();
      expect(blueprintForTrap(spec.id), `${spec.id} has no blueprint`).toBeDefined();
      expect(findTech(spec.requiresTech), `${spec.id} names a rung nobody has`).toBeDefined();
    }
  });
});
