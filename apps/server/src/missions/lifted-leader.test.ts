import {
  MISC_AREA_ID,
  composeProfile,
  createCommander,
  findMissionTemplate,
  leaningsFor,
  makeAttributes,
  missionBoardKey,
  missionOdds,
  missionOffers,
  templateTimings,
  type Attributes,
  type Base,
  type BattleOfficer,
  type Commander,
  type Grade,
  type Mission,
  type MissionTemplate,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { liftedOfficerSheet, officerLiftRoom, standingEffectsFor } from '../crew/standing.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { holdEveryBoard } from '../testing/footholds.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { rankFightLeaders } from './fight-leaders.js';
import { launchMission } from './launch.js';
import { officerAsLeader } from './leaders.js';
import { resolveDueMissions } from './resolve.js';
import type * as MissionBattle from './battle.js';
import { cardOn } from '../testing/card.js';

/**
 * A leader leads on their lifted sheet (maintainer, 2026-09-29).
 *
 * The crew screen draws an officer lifted by the ground, the Overseer's and the peers' teaching
 * perks, the Right Hand, Shared Knowledge and the Lab. The fight and the grade read the card as
 * printed, so a Raid Boss taught +5 Strength fought and was graded exactly as before the lesson.
 * These pin the lift at every door a leader goes through: the bench the board quotes from, the
 * odds the launch freezes, the practice fights, and the sheet the settle hands the engine.
 */

/** Every leader the settle hands the engine, recorded around the real fight. */
const fought: (BattleOfficer | undefined)[] = [];
vi.mock('./battle.js', async (importOriginal) => {
  const real = await importOriginal<typeof MissionBattle>();
  return {
    ...real,
    fightMissionBattle: (args: Parameters<typeof real.fightMissionBattle>[0]) => {
      fought.push(args.leader);
      return real.fightMissionBattle(args);
    },
  };
});

const T0 = new Date('2026-08-13T12:00:00.000Z');
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  fought.splice(0);
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

interface Stack {
  app: FastifyInstance;
  repos: Repositories;
  baseId: string;
  token: string;
}

/** The officer under test: a middling printed sheet, so a lift has room to show. */
const LEADER = 'off-lead';
const leaderOnCard = (): Commander =>
  createCommander(LEADER, 'Halvard Nyx', 'raid_boss', makeAttributes(30));

/**
 * The people who lift them: a Right Hand at the top of their chair (+5 to every group) and a peer
 * with Grip Coach (+5 Strength to every other officer).
 */
const teachers = (): Commander[] => [
  createCommander('off-rh', 'Second', 'right_hand', makeAttributes(100)),
  createCommander('off-grip', 'Coach', 'trader', makeAttributes(20), ['grip_coach']),
];

async function makeStack(username: string, taught: boolean): Promise<Stack> {
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
  repos.bases.updateArmy(base.id, { razors: 80, wardens: 20, haulers: 20 }, base.trainingQueue);
  holdEveryBoard(repos, base.id);
  repos.bases.updateCommanders(base.id, [leaderOnCard(), ...(taught ? teachers() : [])]);
  return { app, repos, baseId: base.id, token };
}

const baseOf = (stack: Stack): Base => stack.repos.bases.findById(stack.baseId)!;

function liftedLeader(stack: Stack, now: Date): Attributes {
  const base = baseOf(stack);
  const officer = base.commanders.find((one) => one.id === LEADER)!;
  return liftedOfficerSheet(officer, officerLiftRoom(stack.repos, base, now)).attributes;
}

/** A standard job on a board the crew can launch from right now. */
function aJobToday(level: number): { template: MissionTemplate; grade: Grade; areaId: string } {
  const now = new Date();
  for (const areaId of [MISC_AREA_ID, 'chrome-row', 'glasshouse-fields']) {
    const job = missionOffers(areaId, missionBoardKey(areaId, now), level).find(
      (entry) => entry.template.kind === 'standard',
    );
    if (job) return { template: job.template, grade: job.grade, areaId };
  }
  throw new Error('no standard job on any board today');
}

describe('the sheet a leader leads on', () => {
  it('is the lifted one on the bench the board hands over', async () => {
    const stack = await makeStack('lifted_bench', true);
    const res = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    const leader = res.json<MissionsResponse>().leaders.find((one) => one.id === LEADER)!;
    const lifted = liftedLeader(stack, new Date());

    expect(leader.attributes).toEqual(lifted);
    // The control: the lift is real, so the two sheets are not one sheet written twice.
    expect(lifted.strength).toBeGreaterThan(leaderOnCard().attributes.strength);
  });

  it('freezes the odds the board quoted, and the lift moves them', async () => {
    const stack = await makeStack('lifted_odds', true);
    const { template, grade, areaId } = aJobToday(baseOf(stack).level);
    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    const quotedSheet = board.json<MissionsResponse>().leaders.find((one) => one.id === LEADER)!;
    const profile = composeProfile(leaningsFor(template));
    // What the send dialog prints: `missionOdds` over the sheet on the wire (`MissionBoard.tsx`).
    const quoted = missionOdds({ grade, leader: quotedSheet.attributes, profile });

    const launched = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: {
        templateId: template.id,
        areaId,
        ...cardOn(areaId, grade),
        force: { razors: 1 },
        leaderId: LEADER,
      },
    });
    expect(launched.statusCode, launched.body.slice(0, 200)).toBe(200);
    const stored = stack.repos.missions.findById(launched.json<{ mission: Mission }>().mission.id);

    expect(stored?.successChance).toBe(quoted.chance);
    const onCard = missionOdds({ grade, leader: leaderOnCard().attributes, profile });
    expect(quoted.chance).toBeGreaterThan(onCard.chance);
  });

  it('is the sheet a battle job hands the engine at the settle', async () => {
    const stack = await makeStack('lifted_fight', true);
    const skirmish = findMissionTemplate('convoy-ambush')!;
    const base = baseOf(stack);
    const stored = launchMission({
      id: 'run-lifted',
      base,
      template: skirmish,
      areaId: MISC_AREA_ID,
      force: { razors: 9 },
      now: T0,
      seed: 4,
      leader: officerAsLeader(
        base.commanders.find((one) => one.id === LEADER)!,
        officerLiftRoom(stack.repos, base, T0),
      ),
      grade: skirmish.grades[0],
    });
    stack.repos.missions.insert(stored);
    const home = new Date(T0.getTime() + (templateTimings(skirmish).totalMinutes + 1) * 60_000);

    resolveDueMissions(stack.repos, baseOf(stack), home);

    expect(fought).toHaveLength(1);
    expect(fought[0]?.officerId).toBe(LEADER);
    expect(fought[0]?.attributes).toEqual(liftedLeader(stack, home));
    expect(fought[0]?.attributes.strength).toBeGreaterThan(leaderOnCard().attributes.strength);
  });

  /**
   * And the lift is worth something in the fight: the same officer, the same force, the same
   * practice seeds, once on the card and once lifted. Measured on two fights near the edge (a
   * sweep of force sizes on 2026-09-29: 10 Razors at E- and 14 at E+, where 12 Razors or more win
   * everything) and scored as the ranking scores them, wins plus half the survivors, so the
   * assertion is about the direction over 240 fights and not one fight that happens to tip.
   * Measured then: lifted 34.23 to 32.31, wins 164 to 155.
   */
  it('fights better lifted than on the card', async () => {
    const stack = await makeStack('lifted_practice', true);
    const base = baseOf(stack);
    const skirmish = findMissionTemplate('convoy-ambush')!;
    const officer = base.commanders.find((one) => one.id === LEADER)!;
    const lifted = officerAsLeader(officer, officerLiftRoom(stack.repos, base, new Date()));
    // The same id, so the chair and its rungs are the same person's in both: only the sheet moves.
    const onCard = { ...lifted, attributes: officer.attributes };
    const effects = standingEffectsFor(stack.repos, base, new Date());
    const scoreOf = (candidate: typeof lifted): number => {
      let score = 0;
      for (const [grade, razors] of [
        ['E-', 10],
        ['E+', 14],
      ] as const) {
        for (let sample = 0; sample < 20; sample += 1) {
          score += rankFightLeaders({
            base,
            template: skirmish,
            grade,
            force: { razors },
            vehicles: {},
            candidates: [candidate],
            effects,
            practice: `p:${String(sample)}`,
          })[0]!.score;
        }
      }
      return score;
    };

    expect(scoreOf(lifted)).toBeGreaterThan(scoreOf(onCard));
  });
});
