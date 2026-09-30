import {
  CITY_DISTRICTS,
  MISC_AREA_ID,
  missionCompletesAt,
  type ActionsResponse,
  type Base,
  type ClaimAllResponse,
  type LaunchMissionResponse,
  type MissionOffer,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleMoves } from '../moves/moves.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * A new crew's first session, played through the real routes on a clock that only moves when told.
 *
 * The bug pass of 2026-09-29 found a crew reached no fighter until a Gauntlet at 11 h 35 min, so no
 * foothold and no district board, and a misc fight card it was refused. The ruling was to pay
 * fighters from the first mission feats (`FIRST_SQUAD` in `feats/catalog.ts`). This plays the
 * opening the way a player would: the quickest plain job on the misc board, every Scavenger sent,
 * the Overseer leading, and every waiting feat collected as each run comes home.
 */

const START = new Date('2026-11-10T09:00:00.000Z');
const MINUTE = 60_000;
/** A first session: long enough to be an evening, short enough that the Gauntlet is out of reach. */
const SESSION_MS = 120 * MINUTE;
/** What a crew needs: one to walk onto open ground and at least two for the fight card. */
const FIGHTERS_WANTED = 5;

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
});

interface Crew {
  app: FastifyInstance;
  call: <T>(method: 'GET' | 'POST', url: string, payload?: object) => Promise<T>;
  baseId: string;
}

async function newCrew(): Promise<Crew> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'first_session', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const baseId = (await chooseOverseer(app, token)).json<{ base: Base }>().base.id;
  const call = async <T>(method: 'GET' | 'POST', url: string, payload?: object): Promise<T> => {
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });
    if (res.statusCode !== 200) throw new Error(`${method} ${url}: ${res.body.slice(0, 300)}`);
    return res.json<T>();
  };
  return { app, call, baseId };
}

const razorsOf = (crew: Crew): number =>
  crew.app.repos.bases.findById(crew.baseId)?.army.razors ?? 0;

/** The quickest plain job on the misc board, or nothing while a run is already out there. */
function quickestPlainJob(board: MissionsResponse): MissionOffer | undefined {
  const misc = board.areas.find((area) => area.id === MISC_AREA_ID);
  if (!misc || misc.activeMissionId !== null) return undefined;
  return misc.offers
    .filter((offer) => offer.kind === 'standard')
    .sort((a, b) => a.totalMinutes - b.totalMinutes)[0];
}

/** Plays plain misc jobs until the crew holds `wanted` Razors or the session runs out. */
async function playOpening(crew: Crew, wanted: number): Promise<{ firstAt: number | null }> {
  let firstAt: number | null = null;
  while (Date.now() - START.getTime() < SESSION_MS && razorsOf(crew) < wanted) {
    await crew.call<ClaimAllResponse>('POST', '/api/feats/claim-all');
    if (firstAt === null && razorsOf(crew) > 0) firstAt = Date.now() - START.getTime();
    const board = await crew.call<MissionsResponse>('GET', '/api/missions');
    const job = quickestPlainJob(board);
    if (!job) {
      vi.setSystemTime(Date.now() + MINUTE);
      continue;
    }
    const { mission } = await crew.call<LaunchMissionResponse>('POST', '/api/missions', {
      templateId: job.templateId,
      areaId: MISC_AREA_ID,
      boardKey: job.boardKey,
      grade: job.grade,
      force: { scavengers: board.army.scavengers ?? 0 },
      leaderId: board.leaders[0]!.id,
    });
    vi.setSystemTime(missionCompletesAt(mission).getTime() + 1_000);
  }
  await crew.call<ClaimAllResponse>('POST', '/api/feats/claim-all');
  if (firstAt === null && razorsOf(crew) > 0) firstAt = Date.now() - START.getTime();
  return { firstAt };
}

/** Open ground in an independent district of the crew's city: somewhere to walk in unopposed. */
function openGround(crew: Crew): { locationId: string; districtId: string } {
  for (const district of CITY_DISTRICTS) {
    if (district.kind !== 'contested' || district.allegiance === 'government') continue;
    for (const location of district.locations) {
      if (crew.app.repos.city.control(location.id)?.holder.kind === 'unoccupied') {
        return { locationId: location.id, districtId: district.id };
      }
    }
  }
  throw new Error('fixture: no open ground in the city');
}

describe("a new crew's first session", () => {
  it('earns enough Razors from its first mission feats to take ground and the fight card', async () => {
    const crew = await newCrew();
    const { firstAt } = await playOpening(crew, FIGHTERS_WANTED);
    const minutes = (Date.now() - START.getTime()) / MINUTE;

    expect(razorsOf(crew), `Razors after ${minutes} minutes`).toBeGreaterThanOrEqual(
      FIGHTERS_WANTED,
    );
    // Was 11 h 35 min, off the Gauntlet. Measured 12 minutes (the three misc jobs of `oddjobs_1`),
    // six Razors at 24 minutes (`runs_1`) and eight at 84 (`clean_1`).
    expect(firstAt, 'no Razor in the first session').not.toBeNull();
    expect(firstAt!).toBeLessThanOrEqual(20 * MINUTE);
    expect(minutes).toBeLessThanOrEqual(45);

    // One Razor walks onto open ground, and the district's board opens under the foothold rule.
    const ground = openGround(crew);
    await crew.call<ActionsResponse>('POST', '/api/actions/move', {
      from: { kind: 'district' },
      to: { kind: 'location', locationId: ground.locationId },
      army: { razors: 1 },
      vehicles: {},
    });
    vi.setSystemTime(Date.now() + 120 * MINUTE);
    settleMoves(crew.app.repos, new Date());
    expect(crew.app.repos.city.control(ground.locationId)?.holder).toEqual({
      kind: 'crew',
      baseId: crew.baseId,
    });
    const board = await crew.call<MissionsResponse>('GET', '/api/missions');
    expect(board.areas.map((area) => area.id)).toContain(ground.districtId);

    // ...and the rest take the misc board's fight card, which a crew of porters is refused.
    const fight = board.areas
      .find((area) => area.id === MISC_AREA_ID)!
      .offers.find((offer) => offer.kind === 'battle');
    expect(fight, 'the misc board deals no fight card').toBeDefined();
    const sent = await crew.call<LaunchMissionResponse>('POST', '/api/missions', {
      templateId: fight!.templateId,
      areaId: MISC_AREA_ID,
      boardKey: fight!.boardKey,
      grade: fight!.grade,
      force: { razors: razorsOf(crew) },
      leaderId: board.leaders[0]!.id,
    });
    expect(sent.mission.force.razors).toBeGreaterThanOrEqual(2);
  });
});
