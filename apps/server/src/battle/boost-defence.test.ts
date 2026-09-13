/**
 * §D7: a name that buys defence buys it for whoever burned it.
 *
 * `Stand Your Ground` is open to anybody, costs 200 infamy, and its own line reads "+15% defence
 * for everything you send" (`describeBoostEffect`). The black market sells the same shape of thing
 * on a crate whose card says "Any fight you take it into". Neither is offered per side: the fight
 * page hands a crew its shelf whichever side of the fight it is on, and it gates by side where it
 * means to, which is why `traps` next to it is `side === 'defender' ? ... : []` and `boosts` is not.
 *
 * `boosted` spent the defence figure on `defensePercent`, which is the "holding your ground"
 * channel. `battle/effects.ts` reads that channel through `side.defending ? ... : 0`, so an
 * attacker who burned the name paid the infamy and fought with exactly the sheet they would have
 * had without it. Worse than a small bonus: a bonus that is not there at all, with a receipt.
 *
 * Measured on what the units actually fight with rather than on a channel, because a channel that
 * moved and is then read by nobody is the bug this file is about. `effectiveStats` with
 * `defending: false` is the same call the engine makes for an attacking stack.
 */
import {
  declarationWindow,
  effectiveStats,
  findBattleBoost,
  findUnit,
  skirmishOutcome,
  type BattleTarget,
  type BattlesResponse,
  type SkirmishEngine,
  type SkirmishInput,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleMovements } from './movement.js';
import { settleBattles } from './resolve.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'rustyard',
  locationId: 'rustyard-press',
};

/** The open name whose whole effect is defence, which is the one an attacker could not spend. */
const STAND_YOUR_GROUND = findBattleBoost('boost_stand_your_ground');
if (!STAND_YOUR_GROUND || STAND_YOUR_GROUND.effect.stat !== 'defense') {
  throw new Error('fixture error: the open defence name is not on the shelf');
}
// Bound to plain consts after the guard: a module-level narrowing does not follow the reference
// into a closure, and `STAND_YOUR_GROUND!` inside a helper would be an assertion rather than a check.
const NAME_ID = STAND_YOUR_GROUND.id;
const NAME_COST = STAND_YOUR_GROUND.cost;

/** What the attacker sends, and how many. A `force` boost reaches all of them. */
const SENT = 'razors';
const SQUAD = 30;

function spy(): { engine: SkirmishEngine; seen: SkirmishInput[] } {
  const seen: SkirmishInput[] = [];
  return {
    seen,
    engine: {
      resolve: (input) => {
        seen.push(input);
        return skirmishOutcome({ winner: 'attacker', log: ['decided'] });
      },
    },
  };
}

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
  seen: SkirmishInput[];
}

async function makeStack(): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const { engine, seen } = spy();
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'stander', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  app.repos.city.markScouted(baseId, 'rustyard', new Date().toISOString());
  // One location off the looters, so the Rustyard's gate is not armed and a location can be called.
  const control = app.repos.city.control('rustyard-bonefield');
  if (control) app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });

  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('fixture error: no base');
  app.repos.bases.updateArmy(baseId, { ...base.army, [SENT]: SQUAD }, base.trainingQueue);
  // Enough of a name to burn one. Written straight onto the economy: earning 200 infamy is a
  // dozen fights and none of them are what this file is about.
  app.repos.bases.updateEconomy(baseId, {
    ...base.economy,
    infamy: base.economy.infamy + NAME_COST * 2,
  });

  return { app, db, token, baseId, seen };
}

/** Declares the fight, lands a squad on the ground, optionally burns the name, then settles it. */
async function attack(stack: Stack, burn: string | null): Promise<void> {
  const declared = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: { target: PRESS, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);

  const board = await stack.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(stack.token),
  });
  const view = board.json<BattlesResponse>().coming[0];
  if (!view) throw new Error('expected a declared battle');
  const battleId = view.battle.id;

  const deployed = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.token),
    payload: { battleId, changes: { [SENT]: SQUAD }, perimeterChanges: {} },
  });
  expect(deployed.statusCode, deployed.body.slice(0, 200)).toBe(200);

  if (burn !== null) {
    const applied = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/boost',
      headers: auth(stack.token),
      payload: { battleId, boostId: burn },
    });
    expect(applied.statusCode, applied.body.slice(0, 200)).toBe(200);
  }

  // Both clocks back, so the settler picks the fight up with the column already standing on it.
  const at = new Date(Date.now() - 60_000);
  stack.db
    .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
    .run(new Date(at.getTime() - 60_000).toISOString(), at.toISOString(), battleId);
  settleMovements(stack.app.repos, new Date());
  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(at.toISOString(), battleId);
  settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());
}

/** What one attacking body was worth in that fight: the engine's own call, on the attacking side. */
function attackingVitality(input: SkirmishInput | undefined): number {
  const unit = findUnit(SENT);
  if (!input || !unit) throw new Error('fixture error: no fight to read');
  const territory = input.attackerTerritory;
  const ground = input.battlefield;
  if (!territory || !ground)
    throw new Error('the attacker must have reached the engine with a fold');
  // The squad has to be standing there, or a `force` boost covers nothing and this measures nothing.
  expect(input.attacking[SENT], 'the column must have landed').toBe(SQUAD);
  return effectiveStats(unit, ground, { defending: false, outnumbered: false }, territory).vitality;
}

describe('a defence name burned by the attacker', () => {
  it('changes what the units it was bought for actually fight with', async () => {
    const plain = await makeStack();
    await attack(plain, null);
    const bare = attackingVitality(plain.seen[0]);

    const bought = await makeStack();
    await attack(bought, NAME_ID);
    const stood = attackingVitality(bought.seen[0]);

    // The name was paid for either way: what is asserted below is that it bought something.
    expect(bought.app.repos.bases.findById(bought.baseId)?.economy.infamy).toBe(
      (plain.app.repos.bases.findById(plain.baseId)?.economy.infamy ?? 0) - NAME_COST,
    );
    expect(stood).toBeGreaterThan(bare);
  });
});
