import {
  SPY_DEFENCE_BREAK_EVEN,
  SPY_GATE_POINTS_PER_LEVEL,
  breachExpiry,
  counterScore,
  createCommander,
  findDistrict,
  findModification,
  makeAttributes,
  type Building,
  type SpyTarget,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, overseerSpyGuardAt, pinOverseer } from '../testing/overseer.js';
import { groundBehind } from './spying.js';

/**
 * A broken gate hides nothing from a spy (maintainer, 2026-09-27; wiring audit, 2026-10-01).
 *
 * The ruling is that a door off its hinges "holds no one out and hides nothing, until the breach
 * closes", and the fight and the standing fold both obey it. The spy contest counts the gate as
 * its own term, `SPY_GATE_POINTS_PER_LEVEL` a level, and read the level whether or not the gate
 * was standing, so a spy on a breached district still paid for every level of the wall. Two
 * gates take that term: a player's home Gate and the gate on a district held whole, so each is
 * measured here, standing and broken.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function register(app: FastifyInstance, username: string): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  return chosen.json<{ base: { id: string } }>().base.id;
}

async function world() {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const readerId = await register(app, 'watcher');
  const holderId = await register(app, 'watched');
  // The holder's Overseer at the break-even, so only the gates move the counter (2026-10-04).
  overseerSpyGuardAt(app, holderId, SPY_DEFENCE_BREAK_EVEN);
  const reader = app.repos.bases.findById(readerId)!;
  app.repos.bases.updateCommanders(readerId, [
    ...reader.commanders,
    createCommander('spy', 'Wire', 'master_of_whispers', makeAttributes(55), []),
  ]);
  return { app, readerId, holderId };
}

type World = Awaited<ReturnType<typeof world>>;

function counterAt({ app, readerId }: World, target: SpyTarget, now: Date): number {
  const looked = groundBehind(app.repos, app.repos.bases.findById(readerId)!, target, now);
  if (looked.kind !== 'ground') throw new Error(`fixture: refused ${looked.reason}`);
  return counterScore(looked.ground.counter);
}

const NOW = new Date();

describe('a broken gate, to a spy', () => {
  it('counts nothing for the home Gate while it is broken, and all of it again after', async () => {
    const w = await world();
    const home = w.app.repos.bases.findById(w.holderId)!;
    const walled: Building[] = [
      ...home.buildings.filter((building) => building.kind !== 'gate'),
      { id: 'gate-under-test', kind: 'gate', level: 12, modifications: [] },
    ];
    w.app.repos.bases.updateBuildings(w.holderId, walled);
    const target: SpyTarget = { kind: 'gate', districtId: home.districtId };

    const standing = counterAt(w, target, NOW);
    w.app.repos.sieges.breakGate(home.districtId, breachExpiry(NOW));
    const broken = counterAt(w, target, NOW);
    // Positive control: the same wall counts again once the breach has closed.
    const mended = counterAt(w, target, new Date(Date.parse(breachExpiry(NOW)) + 1000));

    expect(standing - broken).toBe(12 * SPY_GATE_POINTS_PER_LEVEL);
    expect(mended).toBe(standing);
  });

  it('counts nothing for a captured gate while it is broken', async () => {
    const w = await world();
    for (const location of findDistrict('steelbelt')!.locations) {
      const control = w.app.repos.city.control(location.id)!;
      w.app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: w.holderId } });
    }
    const target: SpyTarget = { kind: 'gate', districtId: 'steelbelt' };

    const standing = counterAt(w, target, NOW);
    w.app.repos.sieges.breakGate('steelbelt', breachExpiry(NOW));
    const broken = counterAt(w, target, NOW);

    expect(standing - broken, 'the captured gate starts at a level, so it has to count').toBe(
      SPY_GATE_POINTS_PER_LEVEL,
    );
  });
});

/**
 * The district's counter-intelligence cards (maintainer, 2026-10-01: "make it anti-spy").
 *
 * Encrypted Core pays points a spy has to beat. Measured at the home gate and on a location the
 * holder keeps elsewhere, since `crewCounter` prices both, against the same crew without the card.
 */
describe('a counter-intelligence card, to a spy', () => {
  it('adds its points to the holder side, at the gate and on held ground', async () => {
    const w = await world();
    const home = w.app.repos.bases.findById(w.holderId)!;
    const press = w.app.repos.city.control('steelbelt-press')!;
    w.app.repos.city.put({ ...press, holder: { kind: 'crew', baseId: w.holderId } });
    const gate: SpyTarget = { kind: 'gate', districtId: home.districtId };
    const location: SpyTarget = { kind: 'location', locationId: 'steelbelt-press' };

    const bare = [counterAt(w, gate, NOW), counterAt(w, location, NOW)];
    const core = findModification('nexus_encrypted_core')!;
    w.app.repos.bases.updateBuildings(w.holderId, [
      ...home.buildings.filter((building) => building.kind !== 'nexus'),
      { id: 'nexus-under-test', kind: 'nexus', level: 20, modifications: [core.id] },
    ]);
    const carded = [counterAt(w, gate, NOW), counterAt(w, location, NOW)];

    expect(carded[0]! - bare[0]!).toBe(core.magnitude);
    expect(carded[1]! - bare[1]!).toBe(core.magnitude);
  });
});
