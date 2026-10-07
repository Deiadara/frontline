import {
  MISC_AREA_ID,
  MISSION_INFAMY_DELTA,
  boostedXp,
  earnedInfamy,
  findMissionTemplate,
  missionInfamyForBattle,
  templateTimings,
  unitSlotsUsed,
  type Army,
  type Base,
  type CrewEffects,
  type Mission,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { playerXpBonusPercent } from '../progression/award.js';
import { holdEveryBoard } from '../testing/footholds.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { sureLeader } from '../testing/leader.js';
import { launchMission } from './launch.js';
import { resolveDueMissions } from './resolve.js';
import { missionInfamySurcharge, type MissionBattle } from './battle.js';
import type * as Standing from '../crew/standing.js';
import type * as Battle from './battle.js';

/**
 * Reliquary's three readings of the dead reach a battle job's settle (maintainer, 2026-10-06:
 * "all units that were intimidated", "each unit that dies in battle"): the Fight Pit's surcharge
 * on the enemy's intimidated dead, SPECTACLE's on the Dancer's kills and the Gravefields' XP on
 * the crew's own. The declared-fight settle paid all three and a job paid none. The engine side,
 * that a job files the ledgers at all, is `dead-ledgers.test.ts`.
 */

/*
 * The settle, with the fight and the crew's ground held still.
 *
 * The fight is replaced with one whose ledgers are known, because what is under test is what the
 * settle does with them rather than what the engine files; and the crew's standing effects are
 * the real ones plus whatever `held.ground` says, so the same crew can be settled with and
 * without a Pit and the Gravefields and the two figures compared.
 */
const held = vi.hoisted((): { ground: Partial<CrewEffects> } => ({ ground: {} }));
// Hoisted with the mock that reads them, since a mock factory cannot see the module's own consts.
const { FORCE, LOST, KILLED, INTIMIDATED, SPECTACLE } = vi.hoisted(
  (): Record<'FORCE' | 'LOST' | 'KILLED' | 'INTIMIDATED' | 'SPECTACLE', Army> => ({
    FORCE: { razors: 20 },
    LOST: { razors: 3 },
    KILLED: { civic_levy: 4 },
    INTIMIDATED: { civic_levy: 2 },
    SPECTACLE: { civic_levy: 1 },
  }),
);

vi.mock('./battle.js', async (importOriginal) => {
  const real = await importOriginal<typeof Battle>();
  const fixed: MissionBattle = {
    outcome: 'success',
    enemy: { civic_levy: 6 },
    lost: LOST,
    recovered: 0,
    killed: KILLED,
    intimidatedKills: INTIMIDATED,
    spectacleKills: SPECTACLE,
    home: { razors: 17 },
    carrying: { razors: 17 },
    fledEnemy: {},
    vehicles: {},
    wreckedVehicles: {},
  };
  return { ...real, fightMissionBattle: () => fixed };
});

vi.mock('../crew/standing.js', async (importOriginal) => {
  const real = await importOriginal<typeof Standing>();
  return {
    ...real,
    standingEffectsFor: (...args: Parameters<typeof real.standingEffectsFor>) => ({
      ...real.standingEffectsFor(...args),
      ...held.ground,
    }),
  };
});

const T0 = new Date('2026-08-13T12:00:00.000Z');
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  held.ground = {};
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

interface Stack {
  repos: Repositories;
  baseId: string;
}

async function makeStack(username: string): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();
  await chooseOverseer(app, token);
  pinOverseer(app, token);
  const repos = createRepositories(db);
  const base = repos.bases.findByOwnerId(user.id)!;
  repos.bases.updateArmy(base.id, { ...FORCE, haulers: 5 }, base.musterQueue);
  holdEveryBoard(repos, base.id);
  return { repos, baseId: base.id };
}

const baseOf = (stack: Stack): Base => stack.repos.bases.findById(stack.baseId)!;

/** One battle job out and home again, settled with whatever ground `held` says the crew holds. */
async function settledJob(
  username: string,
  ground: Partial<CrewEffects>,
): Promise<{ stack: Stack; mission: Mission; at: Date; gain: number }> {
  held.ground = ground;
  const stack = await makeStack(username);
  const template = findMissionTemplate('convoy-ambush')!;
  const base = baseOf(stack);
  const stored = launchMission({
    id: `run-${username}`,
    base,
    template,
    areaId: MISC_AREA_ID,
    force: FORCE,
    now: T0,
    seed: 7,
    leader: sureLeader(),
    grade: template.grades[0],
  });
  stack.repos.missions.insert(stored);
  const at = new Date(T0.getTime() + (templateTimings(template).totalMinutes + 1) * 60_000);
  const gain = (await import('../crew/standing.js')).standingEffectsFor(
    stack.repos,
    baseOf(stack),
    at,
  ).infamyGainPercent;
  const settled = resolveDueMissions(stack.repos, baseOf(stack), at);
  const mission = settled.resolved[0];
  if (!mission) throw new Error('nothing settled');
  expect(mission.reported).toBe(true);
  expect(mission.lost).toEqual(LOST);
  return { stack, mission, at, gain };
}

describe('what the settle pays off a job for the dead', () => {
  it('adds the Pit and SPECTACLE surcharges to the infamy, at the job rate', async () => {
    const bare = await settledJob('bare', {});
    const pit = await settledJob('pit', { intimidatedInfamyPercent: 100 });
    const ordinary = MISSION_INFAMY_DELTA.battle.success + missionInfamyForBattle(KILLED, {});
    // The Dancer's double pays with no Pit at all; the Pit adds the intimidated on top.
    expect(bare.mission.infamyPaid).toBe(
      Math.round(
        earnedInfamy(
          ordinary +
            missionInfamySurcharge({ intimidatedKills: INTIMIDATED, spectacleKills: SPECTACLE }, 0),
          bare.gain,
        ),
      ),
    );
    expect(pit.mission.infamyPaid).toBe(
      Math.round(
        earnedInfamy(
          ordinary +
            missionInfamySurcharge(
              { intimidatedKills: INTIMIDATED, spectacleKills: SPECTACLE },
              100,
            ),
          pit.gain,
        ),
      ),
    );
    expect(pit.mission.infamyPaid).toBeGreaterThan(bare.mission.infamyPaid!);
  });

  it('pays the Gravefields XP for every unit slot of the crew own dead, as its own award', async () => {
    const bare = await settledJob('unmourned', {});
    const mourned = await settledJob('mourned', { xpPerSlotLost: 3 });
    const before = baseOf(bare.stack);
    const after = baseOf(mourned.stack);
    expect(after.level).toBe(before.level);
    expect(after.progression.xpIntoLevel - before.progression.xpIntoLevel).toBe(
      boostedXp(
        Math.round(3 * unitSlotsUsed(LOST)),
        playerXpBonusPercent(mourned.stack.repos, after, mourned.at),
      ),
    );
  });
});
