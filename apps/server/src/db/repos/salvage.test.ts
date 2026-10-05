import {
  ITEM_IDS,
  PERK_IDS,
  RESEARCH_ITEMS,
  VEHICLE_IDS,
  featMeasureKey,
  findResearchItem,
  STARTING_RESOURCES,
  createCommander,
  emptyDeployment,
  findOverseerPreset,
  overseerFromPreset,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  UNIT_IDS,
  type MarketOffer,
} from '@frontline/shared';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { featSnapshot } from '../../feats/snapshot.js';
import { settleMarketBoard } from '../../market/board.js';
import {
  auth,
  closeWorlds,
  declare,
  holdPlot,
  makeWorld,
  register,
  aDayAfter,
  runTheFight,
} from '../../testing/fight-world.js';
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
    const officer = createCommander('officer-1', 'Vasso', 'engineer');
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
      wokeSleepers: false,
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
    buildings: [{ id: 'b-nexus', kind: 'nexus', level: 1, modifications: [] }],
    buildQueue: [],
    army: {},
    musterQueue: [],
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

/**
 * The Flatbed and the War Hauler, taken out of the Garage.
 *
 * Two real retirements rather than the invented id above, and three columns hold a fleet:
 * `bases.fleet_json`, `battle_deployments.vehicles_json` and `missions.vehicles_json`. The first
 * two were already repaired on read; the third read `readJson` raw, so a run that had launched in
 * a War Hauler threw out of `MissionSchema` on the way out of the database and took the missions
 * board, the settle and every screen that lists a run with it.
 *
 * Both halves are asserted because both are load-bearing. 0085 fixes the rows that exist when it
 * runs; the readers cover a backup restored from before it, and a save written by an older process
 * afterwards.
 */
describe('the machines the Garage no longer builds', () => {
  const SWEEP = new URL('../migrations/0085_retire_flatbed_war_hauler.sql', import.meta.url);
  const GONE = ['flatbed', 'war_hauler'];
  const KEPT = VEHICLE_IDS[0] as string;

  /** A crew with one of each retired machine, and one that still exists, in all three columns. */
  function parkedRetiredMachines(): { repos: Repositories; db: AppDatabase; base: string } {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    const base = seedBase(repos, []);
    const now = new Date();
    const fleet = JSON.stringify({ [KEPT]: 1, flatbed: 2, war_hauler: 3 });

    db.prepare('UPDATE bases SET fleet_json = ? WHERE id = ?').run(fleet, base);

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
      wokeSleepers: false,
    };
    repos.sieges.insert(battle);
    repos.sieges.putDeployment(emptyDeployment(battle.id, base, 'attacker', now.toISOString()));
    db.prepare('UPDATE battle_deployments SET vehicles_json = ? WHERE battle_id = ?').run(
      fleet,
      battle.id,
    );

    repos.missions.insert({
      mission: {
        id: 'mission-1',
        baseId: base,
        templateId: 'scrap-run',
        areaId: 'misc',
        payPercent: 0,
        xp: 4,
        force: {},
        vehicles: {},
        pricedMinutes: 30,
        startedAt: now.toISOString(),
        recalledAt: null,
        travelMinutes: 10,
        durationMinutes: 20,
        status: 'active',
        officerId: null,
        grade: null,
        overseerLed: false,
        lost: {},
        reported: true,
        outcome: null,
        rewards: {},
        spoils: {},
        resolvedAt: null,
        pagePrize: null,
        pageWon: null,
        found: {},
      },
      seed: 7,
      successChance: 0.5,
    });
    db.prepare('UPDATE missions SET vehicles_json = ? WHERE id = ?').run(fleet, 'mission-1');

    return { repos, db, base };
  }

  it('are gone from the catalogue, so the rows below are a real retirement', () => {
    for (const id of GONE) expect(VEHICLE_IDS as readonly string[]).not.toContain(id);
    expect(VEHICLE_IDS as readonly string[]).toContain(KEPT);
  });

  it('open a base, a deployment and a mission that still name them', () => {
    const { repos } = parkedRetiredMachines();

    expect(repos.bases.findById('base-1')?.fleet).toEqual({ [KEPT]: 1 });
    expect(repos.sieges.side('battle-1', 'attacker')[0]?.vehicles).toEqual({ [KEPT]: 1 });
    expect(repos.missions.findById('mission-1')?.mission.vehicles).toEqual({ [KEPT]: 1 });
  });

  it('are swept out of all three columns by 0085, and what is left is untouched', () => {
    const { db } = parkedRetiredMachines();
    db.exec(readFileSync(SWEEP, 'utf8'));

    const stored = [
      (
        db.prepare('SELECT fleet_json AS json FROM bases WHERE id = ?').get('base-1') as {
          json: string;
        }
      ).json,
      (
        db
          .prepare('SELECT vehicles_json AS json FROM battle_deployments WHERE battle_id = ?')
          .get('battle-1') as { json: string }
      ).json,
      (
        db.prepare('SELECT vehicles_json AS json FROM missions WHERE id = ?').get('mission-1') as {
          json: string;
        }
      ).json,
    ];
    for (const json of stored) expect(JSON.parse(json)).toEqual({ [KEPT]: 1 });
  });
});

/**
 * The rows no repair reached (bug pass, 2026-09-29).
 *
 * Every column above drops a retired id on the way out of the database. These did not, and they
 * failed worse than a base does: `moves.due` and `sleepers.due` parse every row on the clock before
 * settling any, so one retired unit in one crew's column stopped every crew's columns and cells
 * from landing, and the same row answered 500 on six of its owner's screens. A spy report and a
 * market claim are kept after the thing they name has gone, and a claim that did not parse was
 * neither shown nor paid.
 */
describe('a retired id in the rows that were never swept', () => {
  const UNIT = 'razors';
  const VEHICLE = VEHICLE_IDS[0] as string;
  const ITEM = ITEM_IDS[0] as string;
  const NOW = new Date('2026-09-29T12:00:00.000Z');
  const EARLIER = '2026-09-29T11:00:00.000Z';

  function stackWithCrew(): { repos: Repositories; db: AppDatabase } {
    const stack = openStack();
    stack.repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: EARLIER,
    });
    seedBase(stack.repos, []);
    return stack;
  }

  it('is not in any catalogue, and the unit kept beside it is', () => {
    expect(UNIT_IDS).not.toContain(RETIRED);
    expect(UNIT_IDS).toContain(UNIT);
  });

  it('drops out of a column on the road, so the clock still lands every column', () => {
    const { repos, db } = stackWithCrew();
    repos.moves.insert({
      id: 'move-1',
      baseId: 'base-1',
      from: { kind: 'district' },
      to: { kind: 'gate' },
      army: { [UNIT]: 2 },
      vehicles: { [VEHICLE]: 1 },
      departedAt: EARLIER,
      arrivesAt: EARLIER,
      travelMinutes: 10,
      recalledAt: null,
    });
    db.prepare('UPDATE unit_moves SET army_json = ?, vehicles_json = ? WHERE id = ?').run(
      JSON.stringify({ [UNIT]: 2, [RETIRED]: 3 }),
      JSON.stringify({ [VEHICLE]: 1, [RETIRED]: 1 }),
      'move-1',
    );

    const [due] = repos.moves.due(NOW.toISOString());
    expect(due?.army).toEqual({ [UNIT]: 2 });
    expect(due?.vehicles).toEqual({ [VEHICLE]: 1 });
    expect(repos.moves.activeFor('base-1')).toHaveLength(1);
  });

  it('drops out of a posting on an ally’s ground', () => {
    const { repos, db } = stackWithCrew();
    repos.alliedGarrisons.set('steelbelt-ramp', 'base-1', { [UNIT]: 4 });
    db.prepare('UPDATE allied_garrisons SET army_json = ?').run(
      JSON.stringify({ [UNIT]: 4, [RETIRED]: 2 }),
    );
    expect(repos.alliedGarrisons.at('steelbelt-ramp')).toEqual([
      { baseId: 'base-1', army: { [UNIT]: 4 } },
    ]);
  });

  it('drops out of a sleeper cell, so the clock still lands every cell', () => {
    const { repos, db } = stackWithCrew();
    repos.sleepers.insert({
      id: 'cell-1',
      baseId: 'base-1',
      locationId: 'steelbelt-ramp',
      army: { [UNIT]: 1 },
      phase: 'outbound',
      departedAt: EARLIER,
      arrivesAt: EARLIER,
      travelMs: 60_000,
    });
    db.prepare('UPDATE sleeper_cells SET army_json = ? WHERE id = ?').run(
      JSON.stringify({ [UNIT]: 1, [RETIRED]: 5 }),
      'cell-1',
    );
    expect(repos.sleepers.due(NOW.toISOString()).map((cell) => cell.army)).toEqual([{ [UNIT]: 1 }]);
  });

  it('drops out of a spy report, which is kept for ever', () => {
    const { repos, db } = stackWithCrew();
    repos.spying.insertReport({
      id: 'report-1',
      baseId: 'base-1',
      target: { kind: 'location', locationId: 'steelbelt-ramp' },
      districtId: 'steelbelt',
      districtName: 'The Steelbelt',
      placeName: 'The Ramp',
      holder: { kind: 'government', name: 'The Combine', player: null, faction: null },
      tier: 'loose_ears',
      capsPaid: 100,
      writtenAt: EARLIER,
      failed: false,
      exposed: { [UNIT]: 6 },
      exposedSlots: 6,
      unitsShown: true,
      totalSlots: null,
      foundOut: false,
      accuracy: null,
      unseen: null,
      accuracyShown: false,
    });
    db.prepare('UPDATE spy_reports SET exposed_json = ? WHERE id = ?').run(
      JSON.stringify({ [UNIT]: 6, [RETIRED]: 2 }),
      'report-1',
    );
    expect(repos.spying.reportsFor('base-1', 10).map((report) => report.exposed)).toEqual([
      { [UNIT]: 6 },
    ]);
  });

  function listing(id: string, status: MarketOffer['status']): MarketOffer {
    return {
      id,
      sellerBaseId: 'base-1',
      sellerName: 'The Ninth Street Crew',
      give: { resources: { oil: 5 }, items: { [ITEM]: 1 } },
      want: { resources: { planks: 5 }, items: { [ITEM]: 1 } },
      status,
      createdAt: EARLIER,
      counterTo: null,
      directedAt: null,
      cityId: 'ashfall',
    };
  }

  it('drops out of a claim, and the claim is shown and paid rather than lost', () => {
    const { repos, db } = stackWithCrew();
    const offer = listing('offer-1', 'accepted');
    repos.market.insert(offer);
    repos.market.insertClaim({
      id: 'claim-1',
      baseId: 'base-1',
      offer,
      reason: 'taken',
      goods: { resources: { oil: 5 }, items: { [ITEM]: 1 } },
      takenBy: 'somebody',
      createdAt: EARLIER,
      claimUntil: EARLIER,
    });
    const retired = JSON.stringify({ [ITEM]: 1, [RETIRED]: 2 });
    db.prepare('UPDATE market_claims SET items_json = ?').run(retired);
    db.prepare(
      `UPDATE market_offers SET give_json = json_set(give_json, '$.items', json(?)),
         want_json = json_set(want_json, '$.items', json(?))`,
    ).run(retired, retired);

    const [shown] = repos.market.claimsFor('base-1');
    expect(shown?.goods.items).toEqual({ [ITEM]: 1 });
    expect(shown?.offer.want.items).toEqual({ [ITEM]: 1 });

    const oil = repos.bases.findById('base-1')!.resources.oil;
    expect(settleMarketBoard(repos, NOW)).toBe(1);
    expect(repos.market.findClaim('claim-1')).toBeUndefined();
    expect(repos.bases.findById('base-1')!.resources.oil).toBe(oil + 5);
  });

  it('drops out of what an open listing gives and asks for, and it is on the board again', () => {
    const { repos, db } = stackWithCrew();
    repos.market.insert(listing('offer-2', 'open'));
    const retired = JSON.stringify({ [ITEM]: 1, [RETIRED]: 2 });
    db.prepare(
      `UPDATE market_offers SET give_json = json_set(give_json, '$.items', json(?)),
         want_json = json_set(want_json, '$.items', json(?))`,
    ).run(retired, retired);
    const [open] = repos.market.listByStatus('open');
    expect(open?.give.items).toEqual({ [ITEM]: 1 });
    expect(open?.want.items).toEqual({ [ITEM]: 1 });
  });
});

describe('a finished fight whose row this build cannot read', () => {
  afterEach(closeWorlds);

  it('is left off the crew profile rather than taking it down for everybody', async () => {
    const world = await makeWorld('defender');
    const caller = await register(world, 'caller', { razors: 3 });
    const holder = await register(world, 'holder');
    holdPlot(world, holder, { razors: 1 });
    const firstFight = await declare(world, caller);
    runTheFight(world, firstFight);
    // A day on, or the caller who lost could not call the plot again (2026-10-05).
    aDayAfter(world, firstFight);
    runTheFight(world, await declare(world, caller));
    expect(world.app.repos.sieges.resolvedFor(caller.baseId, 10)).toHaveLength(2);

    // A holder kind this build does not have, on the older of the two.
    world.db
      .prepare(
        `UPDATE scheduled_battles SET defender_json = '{"kind":"retired_holder"}'
         WHERE id = (SELECT id FROM scheduled_battles ORDER BY resolved_at LIMIT 1)`,
      )
      .run();

    expect(world.app.repos.sieges.resolvedFor(caller.baseId, 10)).toHaveLength(1);
    const profile = await world.app.inject({
      method: 'GET',
      url: `/api/crews/${caller.baseId}`,
      headers: auth(holder.token),
    });
    expect(profile.statusCode, profile.body).toBe(200);
  });
});

/**
 * The maintainer's ruling, 2026-09-29: a renamed or retired research rung is gone for good.
 *
 * Commit `ab3b2c5` renamed or removed nine rungs without a migration. No mapping and no refund: the
 * dead id is dropped on read, so it counts toward nothing, and the crew simply lacks the rung.
 */
describe('a research rung the catalogue no longer carries', () => {
  const DEAD = ['tech_standing_signals', 'tech_loading_drill', 'tech_fence_network'];
  const LIVE = [RESEARCH_ITEMS[0]!.id, RESEARCH_ITEMS[1]!.id];
  const writeResearch = (db: AppDatabase, base: string, research: unknown) =>
    db
      .prepare('UPDATE bases SET research_json = ? WHERE id = ?')
      .run(JSON.stringify(research), base);
  const activeOn = (techId: string) => ({
    id: 'research-1',
    project: { kind: 'technology', techId },
    startedAt: new Date().toISOString(),
    durationMinutes: 60,
    paid: {},
  });
  const seeded = () => {
    const { repos, db } = openStack();
    repos.users.insert({
      id: 'user-1',
      username: 'Keeper',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    return { repos, db, base: seedBase(repos, []) };
  };

  it('names ids that really are gone, beside ones that are not', () => {
    for (const id of DEAD) expect(findResearchItem(id), id).toBeUndefined();
    for (const id of LIVE) expect(findResearchItem(id), id).toBeDefined();
  });

  it('drops off the finished list, and research_done counts only the rungs that exist', () => {
    const { repos, db, base } = seeded();
    writeResearch(db, base, { active: null, technologies: [LIVE[0], ...DEAD, LIVE[1]] });

    const read = repos.bases.findById(base)!;
    expect(read.research.technologies).toEqual(LIVE);
    expect(featSnapshot(repos, read)[featMeasureKey('research_done')]).toBe(LIVE.length);
  });

  it('takes a project on a dead rung off the bench, and leaves a live one running', () => {
    const { repos, db, base } = seeded();
    writeResearch(db, base, { active: activeOn(DEAD[0]!), technologies: [] });
    expect(repos.bases.findById(base)!.research.active).toBeNull();

    writeResearch(db, base, { active: activeOn(LIVE[0]!), technologies: [] });
    expect(repos.bases.findById(base)!.research.active?.project.techId).toBe(LIVE[0]);
  });
});
