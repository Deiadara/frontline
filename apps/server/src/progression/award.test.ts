import {
  PLAYER_XP_AWARDS,
  STARTING_RESOURCES,
  playerXpToNextLevel,
  startingEconomy,
  startingAssignees,
  startingProgression,
  startingResearch,
  findPlayerUnlock,
  playerLevelGrants,
  type Base,
  type PlayerLevelUnlock,
  startingTraining,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { awardPlayerXp, levelUpFrom } from './award.js';

const NOW = '2026-08-13T09:30:00.000Z';
const open: AppDatabase[] = [];

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function makeRepos(): { db: AppDatabase; repos: Repositories } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  open.push(db);
  return { db, repos: createRepositories(db) };
}

function seedBase(db: AppDatabase, repos: Repositories, level: number): Base {
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    'user-1',
    'operator',
    'hash',
    NOW,
  );
  const base: Base = {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Foothold',
    districtId: 'neon-docks',
    level,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(NOW),
    progression: startingProgression(),
    research: startingResearch(),
    assignees: startingAssignees(),
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining('2026-08-16T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
    fleet: {},
    commanders: [],
    createdAt: NOW,
  };
  repos.bases.insert(base);
  return base;
}

describe('awardPlayerXp — the single XP write path (INTERFACES R7)', () => {
  it('banks XP without levelling when the award falls short', () => {
    const { db, repos } = makeRepos();
    const base = seedBase(db, repos, 1);

    const { base: after, award } = awardPlayerXp(repos, base, 'raidWon');

    expect(award).toMatchObject({ source: 'raidWon', xpGained: 80, levelsGained: 0, level: 1 });
    expect(after.progression.xpIntoLevel).toBe(80);
    // Persisted, not just returned.
    expect(repos.bases.findById('base-1')).toMatchObject({
      level: 1,
      progression: { xpIntoLevel: 80 },
    });
  });

  it('writes the new level and the carried-over XP together on a level-up', () => {
    const { db, repos } = makeRepos();
    const base = seedBase(db, repos, 1);

    awardPlayerXp(repos, base, 'raidWon'); // 80
    const reread = repos.bases.findById('base-1');
    expect(reread).toBeDefined();
    const { award } = awardPlayerXp(repos, reread as Base, 'questCompleted'); // +200 => 280, clears 100

    expect(award).toMatchObject({ level: 2, levelsGained: 1 });
    expect(repos.bases.findById('base-1')).toMatchObject({
      level: 2,
      progression: { xpIntoLevel: 180 },
    });
  });

  it('hands back the §I2 grants the new level unlocked', () => {
    const { db, repos } = makeRepos();
    // 580 of the 600 needed to clear level 3; one mission (120) crosses into level 4.
    const base = seedBase(db, repos, 3);
    repos.bases.updateProgression(base.id, 3, { xpIntoLevel: 580 });
    const at3 = repos.bases.findById('base-1') as Base;

    const { award } = awardPlayerXp(repos, at3, 'missionCompleted');

    expect(award.level).toBe(4);
    // Level 4 is where §G3's per-officer cap turns over from 1 to 2.
    expect(award.grants).toEqual({ assigneePool: 5, assigneeCapPerOfficer: 2, recruitSlots: 5 });
    // Level 4 opens nothing — the catalogue's doors are at 3, 5, 7 and 10. Pinned as empty rather
    // than left unasserted: an award that announced a door it had not opened is the bug this field
    // makes possible, and it would look exactly like a passing test.
    expect(award.unlocks).toEqual([]);
  });

  it('names the §I3 door a level-up opened, rather than leaving it to be found by accident', () => {
    const { db, repos } = makeRepos();
    // 280 of the 300 needed to clear level 2; one mission (120) carries it into level 3, which is
    // where the Archive opens.
    const base = seedBase(db, repos, 2);
    repos.bases.updateProgression(base.id, 2, { xpIntoLevel: 280 });
    const at2 = repos.bases.findById('base-1') as Base;

    const { award } = awardPlayerXp(repos, at2, 'missionCompleted');

    expect(award.level).toBe(3);
    expect(award.unlocks.map((unlock) => unlock.id)).toEqual(['research']);
    // With its copy, because a locked door has to be able to say what is behind it.
    expect(award.unlocks[0]?.name).toBe('The Archive');
    expect(award.unlocks[0]?.description).toBeTruthy();
  });

  it('reports every door a single oversized award crossed, not just the last', () => {
    const { db, repos } = makeRepos();
    // Level 1 with 980 banked. One quest (200) clears level 1 (100), level 2 (300) and level 3
    // (600) in one go, landing on 4 — past both the Archive at 3 and nothing else.
    const base = seedBase(db, repos, 1);
    repos.bases.updateProgression(base.id, 1, { xpIntoLevel: 980 });
    const at1 = repos.bases.findById('base-1') as Base;

    const { award } = awardPlayerXp(repos, at1, 'questCompleted');

    expect(award.levelsGained).toBeGreaterThan(1);
    expect(award.unlocks.map((unlock) => unlock.id)).toEqual(['research']);
  });

  it("never leaves stored progress at or above the stored level's threshold", () => {
    const { db, repos } = makeRepos();
    let base = seedBase(db, repos, 1);
    for (let i = 0; i < 60; i += 1) {
      base = awardPlayerXp(repos, base, 'questCompleted').base;
      const stored = repos.bases.findById('base-1') as Base;
      expect(stored.progression.xpIntoLevel).toBeLessThan(playerXpToNextLevel(stored.level));
      expect(stored.level).toBe(base.level);
    }
    expect(base.level).toBeGreaterThan(1);
  });
});

/**
 * The announcement itself (§I2, §I3, MOU-227).
 *
 * `levelUpFrom` is what every route puts on its response, and it is the one place a *run* of awards
 * is folded into a single thing to say. Tested directly rather than through a route: the route
 * suites that used to cover it went with the battle rework, and an aggregation nobody exercises is
 * an aggregation that quietly starts returning nothing.
 */
describe('levelUpFrom — one announcement for a whole settlement', () => {
  const award = (level: number, levelsGained: number, unlocks: PlayerLevelUnlock[]) => ({
    source: 'missionCompleted' as const,
    xpGained: 120,
    level,
    progression: { xpIntoLevel: 0 },
    xpToNextLevel: playerXpToNextLevel(level),
    levelsGained,
    grants: playerLevelGrants(level),
    unlocks,
  });

  it('says nothing at all when no level was crossed', () => {
    expect(levelUpFrom([award(2, 0, [])])).toBeUndefined();
    expect(levelUpFrom([])).toBeUndefined();
  });

  it('adds the levels up and reports the one the player ended on', () => {
    const announced = levelUpFrom([award(2, 1, []), award(3, 1, [])]);
    expect(announced).toMatchObject({ level: 3, levelsGained: 2 });
  });

  it('carries every door the *run* opened, not only the last award’s', () => {
    // Two settlements landing on one read — a mission home and a build finished — each crossing a
    // level with a door on it. Announcing only the last one loses the first for good: no later
    // read re-resolves a settle, so this response is the only place it can ever be said.
    const first = findPlayerUnlock('research');
    const second = findPlayerUnlock('market');
    expect(first, 'the catalogue must still have these doors').toBeDefined();
    expect(second).toBeDefined();

    const announced = levelUpFrom([award(3, 1, [first!]), award(5, 2, [second!])]);
    expect(announced?.unlocks.map((unlock) => unlock.id)).toEqual(['research', 'market']);
  });
});

describe('migration 0005_progression', () => {
  /**
   * The R6 trap, guarded: `0003_economy.sql` defaulted `economy_json` to `'{}'`, which its own
   * schema rejects — so only the fresh-insert path produced anything valid. Reading a row that
   * never wrote `progression_json` proves this column's DEFAULT does not repeat it.
   */
  it('defaults a row that predates the column to a valid, readable progression', () => {
    const { db, repos } = makeRepos();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('user-1', 'operator', 'hash', NOW);
    // Every column except progression_json — the shape an older row has after ADD COLUMN.
    db.prepare(
      `INSERT INTO bases
         (id, owner_id, name, district_id, level, is_bot,
          resources_json, economy_json, buildings_json, commanders_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'base-old',
      'user-1',
      'Legacy Hold',
      'neon-docks',
      2,
      0,
      JSON.stringify(STARTING_RESOURCES),
      JSON.stringify(startingEconomy(NOW)),
      '[]',
      '[]',
      NOW,
    );

    expect(repos.bases.findById('base-old')).toMatchObject({
      level: 2,
      progression: { xpIntoLevel: 0 },
    });
  });
});

describe('XP source pricing (§I1)', () => {
  it('pays for fighting, not only for winning', () => {
    expect(PLAYER_XP_AWARDS.raidLost).toBeGreaterThan(0);
    expect(PLAYER_XP_AWARDS.raidWon).toBeGreaterThan(PLAYER_XP_AWARDS.raidLost);
  });
});

/*
 * The two suites that drove `POST /api/city/attack` were here, and they went with it (board,
 * battle rework).
 *
 * §I1 still pays for fighting and it now pays **both** crews, because a declared fight is one the
 * defender turns out for. That wiring lives in the settler, and it is measured against the real
 * routes in `battle/fight-xp.test.ts` — the same shape these were, one layer along.
 */
