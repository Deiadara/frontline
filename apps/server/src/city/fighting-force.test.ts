import {
  CITY_LOCATIONS,
  MAX_LOCATION_LEVEL,
  UNIT_CATALOG,
  type Base,
  type Location,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { setGarrison } from './actions.js';
import { isFightingForce } from '../battle/forces.js';

/**
 * §A5: a porter is never in a line, at any door.
 *
 * The support tier cannot fight, and `isFightingForce` is the one rule that says so. What this
 * file measures is that **every** way of putting units on ground asks it, because the rule is
 * enforced per door rather than in one place and a door that forgets it is silent: the request
 * succeeds, the Scavengers stand in the rank, and they are killed for a share of an exchange they
 * cannot take part in.
 *
 * That is not hypothetical. `setGarrison` was exactly that door: it checked the §D7 rank a unit
 * will not take the field without, with a comment explaining that a garrison *is* a defending
 * force because `assemble` merges it into the line, and then never asked whether the units could
 * fight at all. Deploy, attack and raid all did, and none of the four had a test.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

interface Stack {
  app: FastifyInstance;
  base: Base;
  token: string;
}

async function makeStack(): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'porter_boss', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  await app.inject({
    method: 'POST',
    url: '/api/city/scout',
    headers: auth(token),
    payload: { districtId: 'rustyard' },
  });

  // A crew of porters and one fighter, so every case below can be run twice: once with people who
  // cannot fight, once with somebody who can, which is what makes the refusals mean something.
  const found = app.repos.bases.findByOwnerId(
    app.repos.users.findByUsername('porter_boss')?.id ?? '',
  );
  if (!found) throw new Error('the fixture crew has no base');
  const base: Base = { ...found, army: { scavengers: 6, haulers: 4, razors: 5 } };
  app.repos.bases.updateArmy(base.id, base.army, base.trainingQueue);
  return { app, base, token };
}

/** A location in the district this crew has scouted, and the control row that goes with it. */
function somewhere(): Location {
  const found = CITY_LOCATIONS.find((location) => location.districtId === 'rustyard');
  if (!found) throw new Error('the Rustyard has no locations');
  return found;
}

/** Hands this crew the place outright, so a garrison change is even reachable. */
function held(stack: Stack, location: Location): void {
  const control = stack.app.repos.city.control(location.id);
  if (!control) throw new Error(`no control row for ${location.id}`);
  stack.app.repos.city.put({
    ...control,
    holder: { kind: 'crew', baseId: stack.base.id },
    level: MAX_LOCATION_LEVEL,
    garrison: {},
  });
}

describe('§A5: every door that puts units on ground refuses the support tier', () => {
  it('refuses a garrison of porters, and takes the same post from a fighter', async () => {
    const stack = await makeStack();
    const location = somewhere();
    held(stack, location);

    expect(
      setGarrison(stack.app.repos, {
        base: stack.base,
        location,
        changes: { scavengers: 3 },
      }),
    ).toEqual({ kind: 'refused', reason: 'not_a_fighting_force' });

    // Mixed is still refused: one porter in the rank is one porter in the rank.
    expect(
      setGarrison(stack.app.repos, {
        base: stack.base,
        location,
        changes: { razors: 2, haulers: 1 },
      }),
    ).toEqual({ kind: 'refused', reason: 'not_a_fighting_force' });

    // And the control is live: a fighter takes the post.
    expect(
      setGarrison(stack.app.repos, { base: stack.base, location, changes: { razors: 2 } }).kind,
    ).toBe('ok');
  });

  /**
   * Bringing them home is never blocked.
   *
   * The check reads only what is being *sent out*, which matters for a rule that can start
   * applying to units already on the ground: a retune that made some unit non-combat tomorrow must
   * not strand it on a rooftop with no way to withdraw it.
   */
  it('always lets a withdrawal through, whoever is standing there', async () => {
    const stack = await makeStack();
    const location = somewhere();
    held(stack, location);
    stack.app.repos.city.setGarrison(location.id, { scavengers: 2 });

    expect(
      setGarrison(stack.app.repos, { base: stack.base, location, changes: { scavengers: -2 } })
        .kind,
    ).toBe('ok');
  });

  /**
   * And the rule itself, over the whole catalogue.
   *
   * The per-door checks above are what a player hits; this is what stops a *new* support unit from
   * being safe at one door and not another. `isFightingForce` is the single predicate every door
   * asks, so a tier added tomorrow is refused everywhere the day it is written.
   */
  it('refuses any force with a porter in it, and passes one without', () => {
    for (const porter of UNIT_CATALOG.filter((unit) => unit.tier === 'carrier')) {
      expect(isFightingForce({ [porter.id]: 1 }), porter.id).toBe(false);
      expect(isFightingForce({ razors: 10, [porter.id]: 1 }), porter.id).toBe(false);
      // Zero of them is not a porter in the line: a change map carrying an untouched key must not
      // refuse a force that is actually all fighters.
      expect(isFightingForce({ razors: 10, [porter.id]: 0 }), porter.id).toBe(true);
    }
    expect(isFightingForce({ razors: 4, snipers: 2 })).toBe(true);
  });
});
