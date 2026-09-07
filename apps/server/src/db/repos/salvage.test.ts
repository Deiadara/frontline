import {
  ITEM_IDS,
  PERK_IDS,
  VEHICLE_IDS,
  STARTING_RESOURCES,
  createCommander,
  emptyDeployment,
  findOverseerPreset,
  overseerFromPreset,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
} from '@frontline/shared';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../index.js';
import { createRepositories, type Repositories } from './index.js';

/**
 * What a retired content id does to a saved row.
 *
 * The perk book is content: ids are authored, persisted verbatim, and validated on the way back out
 * against the live catalogue. `bases.ts` already anticipates a retirement and drops the unknown id
 * off an officer's sheet, on the stated grounds that the alternative is an account nobody can open.
 * The Overseer's row did not, and it is worse placed to fail: `overseers.findById` sits inside
 * `crewSheetsFor`, which sits inside every settle, every projection and the battle engine's inputs,
 * so a throw there costs the player every screen rather than one bonus.
 *
 * There is no way to retire a perk from inside a test, so the retirement is simulated the only
 * honest way: an id the catalogue has never carried is written into the row, which is exactly what
 * a stored-then-retired id looks like on the read path.
 */

const dbs: AppDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

const RETIRED = 'a_perk_that_was_retired';

function openStack(): { repos: Repositories; db: AppDatabase } {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  return { repos: createRepositories(db), db };
}

describe('a perk the catalogue no longer carries', () => {
  it('is not in the book, so the fixture below is a real retirement', () => {
    expect(PERK_IDS).not.toContain(RETIRED);
  });

  it('drops off the Overseer rather than taking the account down', () => {
    const { repos, db } = openStack();
    const preset = findOverseerPreset('fixer');
    if (!preset) throw new Error('fixture: no such preset');
    const overseer = overseerFromPreset(preset, 'overseer-1');

    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    repos.overseers.insert({
      overseer,
      userId: 'user-1',
      presetId: preset.presetId,
      createdAt: new Date().toISOString(),
    });
    db.prepare('UPDATE overseers SET perks_json = ? WHERE id = ?').run(
      JSON.stringify([...overseer.perks, RETIRED]),
      overseer.id,
    );

    const read = repos.overseers.findById(overseer.id);
    expect(read).toBeDefined();
    expect(read?.perks).not.toContain(RETIRED);
    expect(read?.perks).toEqual(overseer.perks);
  });

  it('already drops off an officer, which is the behaviour being matched', () => {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    const officer = createCommander('officer-1', 'Vasso', 'lead_engineer');
    const base = seedBase(repos, [officer]);
    db.prepare('UPDATE bases SET commanders_json = ? WHERE id = ?').run(
      JSON.stringify([{ ...officer, perks: [RETIRED] }]),
      base,
    );
    expect(repos.bases.findById(base)?.commanders[0]?.perks).toEqual([]);
  });
});

/**
 * The same repair, for the two id-bearing columns that did not have it.
 *
 * `FleetSchema` and `InventorySchema` are `z.partialRecord` over an id enum, so a retired vehicle
 * or item is not a missing line on a screen: it is `BaseSchema.parse` throwing out of `findById`,
 * which costs the player every screen and throws inside the world tick when it touches that base.
 * The other eight id-bearing columns were already swept; these two were also the only two no
 * migration has ever had to sweep, so nothing else stood behind them.
 */
describe('an item or a vehicle the catalogue no longer carries', () => {
  it('is not in either catalogue, so the fixtures below are real retirements', () => {
    expect(ITEM_IDS).not.toContain(RETIRED);
    expect(VEHICLE_IDS).not.toContain(RETIRED);
  });

  it('drops out of the inventory rather than taking the account down', () => {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    const base = seedBase(repos, []);
    db.prepare('UPDATE bases SET inventory_json = ? WHERE id = ?').run(
      JSON.stringify({ [ITEM_IDS[0] as string]: 3, [RETIRED]: 2 }),
      base,
    );
    const read = repos.bases.findById(base);
    expect(read).toBeDefined();
    expect(read?.inventory).toEqual({ [ITEM_IDS[0] as string]: 3 });
  });

  it('drops out of a deployment rather than taking the world tick down', () => {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    const base = seedBase(repos, []);
    const now = new Date();
    const battle = {
      id: 'battle-1',
      target: { kind: 'gate' as const, districtId: 'kettle-row' },
      attackerBaseId: base,
      defender: { kind: 'unoccupied' as const },
      scheduledFor: new Date(now.getTime() + 3_600_000).toISOString(),
      declaredAt: now.toISOString(),
      resolvedAt: null,
      seed: 'seed-1',
      holdAfterCapture: false,
    };
    repos.sieges.insert(battle);
    repos.sieges.putDeployment({
      ...emptyDeployment(battle.id, base, 'attacker', now.toISOString()),
      vehicles: { [VEHICLE_IDS[0] as string]: 1 },
    });
    db.prepare('UPDATE battle_deployments SET vehicles_json = ? WHERE battle_id = ?').run(
      JSON.stringify({ [VEHICLE_IDS[0] as string]: 1, [RETIRED]: 9 }),
      battle.id,
    );

    const rows = repos.sieges.side(battle.id, 'attacker');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vehicles).toEqual({ [VEHICLE_IDS[0] as string]: 1 });
  });

  it('drops out of the fleet rather than taking the account down', () => {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    const base = seedBase(repos, []);
    db.prepare('UPDATE bases SET fleet_json = ? WHERE id = ?').run(
      JSON.stringify({ [VEHICLE_IDS[0] as string]: 1, [RETIRED]: 4 }),
      base,
    );
    const read = repos.bases.findById(base);
    expect(read).toBeDefined();
    expect(read?.fleet).toEqual({ [VEHICLE_IDS[0] as string]: 1 });
  });
});

function seedBase(repos: Repositories, commanders: ReturnType<typeof createCommander>[]): string {
  const now = new Date().toISOString();
  repos.bases.insert({
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Ninth Street Crew',
    districtId: 'kettle-row',
    level: 1,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'b-nexus', kind: 'nexus', level: 1, modifications: [], damage: 0 }],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    addons: undefined,
    commanders,
    createdAt: now,
  });
  return 'base-1';
}

/**
 * The third place an attribute name is stored, and the one 0075 missed.
 *
 * `bases.training_json` names an attribute in every session and in `last`, both validated against
 * the live enum, so a crew that had drilled Signals under its old name threw out of `BaseSchema`
 * on every read after 0075: every authenticated route answered 500 for that account. Migration
 * 0080 sweeps the renames; `rowToBase` drops what was retired. The row here is written the way a
 * pre-0075 crew's still is, and read the way every route reads it.
 */
describe('attribute names in the training book', () => {
  const RENAMES = new URL('../migrations/0080_training_attribute_names.sql', import.meta.url);

  function drilledUnderOldNames(): { repos: Repositories; db: AppDatabase; base: string } {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Drilled',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    const base = seedBase(repos, []);
    const now = new Date().toISOString();
    db.prepare('UPDATE bases SET training_json = ? WHERE id = ?').run(
      JSON.stringify({
        day: '2026-08-16',
        used: 2,
        sessions: [
          {
            id: 's1',
            subjectId: 'overseer',
            attribute: 'hacking',
            startedAt: now,
            durationSeconds: 60,
          },
          {
            id: 's2',
            subjectId: 'c1',
            attribute: 'demolition',
            startedAt: now,
            durationSeconds: 60,
          },
        ],
        last: { overseer: 'hacking', c1: 'demolition', c2: 'fabrication' },
      }),
      base,
    );
    return { repos, db, base };
  }

  it('is swept by the migration, and what the migration cannot rename is dropped on read', () => {
    const { repos, db, base } = drilledUnderOldNames();
    db.exec(readFileSync(RENAMES, 'utf8'));

    const stored = db.prepare('SELECT training_json FROM bases WHERE id = ?').get(base) as {
      training_json: string;
    };
    expect(stored.training_json).not.toContain('"hacking"');
    expect(stored.training_json).not.toContain('"fabrication"');

    const read = repos.bases.findById(base);
    expect(read).toBeDefined();
    expect(read?.training.sessions.map((session) => session.attribute)).toEqual(['signals']);
    expect(read?.training.last).toEqual({ overseer: 'signals', c2: 'craft' });
    expect(read?.training.used).toBe(2);
  });

  it('opens the account even before the migration has run', () => {
    const { repos, base } = drilledUnderOldNames();
    // The floor alone: the old names are unknown to the enum, so they go the way a retired
    // attribute goes rather than taking the row down with them.
    expect(() => repos.bases.findById(base)).not.toThrow();
    expect(repos.bases.findById(base)?.training.sessions).toEqual([]);
  });
});
