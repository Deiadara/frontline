import {
  MISC_AREA_ID,
  createCommander,
  missionBoardKey,
  missionOffers,
  pagePrizeFor,
  type LaunchMissionResponse,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { pagePrizeSaltFrom } from './prize-salt.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * §F1b: a run's blueprint page is a surprise until the crew is home (maintainer, 2026-09-28).
 *
 * The card used to name the page's category ("A unit blueprint's page") and this file used to
 * check that the card and the launched row agreed on it. The maintainer took the line off the
 * card: whether a job pays a page at all is something a player learns from the notification on a
 * successful return and from the Recently returned list, never beforehand. The launch still
 * freezes a prize onto the row, because that is what the return reads.
 *
 * Read off the wire, the way `routes/quoted.test.ts` argues a check like this has to be done: a
 * schema that merely lacks the field would still let a projection spread a page onto the offer.
 */

const PASSWORD = 'hunter2pass';

/**
 * A moment and a job whose run carries a page.
 *
 * Pinned rather than searched, so a failure names one card and one hour. Chosen because the prize
 * is not null here: on a job with no page the card would say nothing either way, and the test
 * would pass vacuously. `standard`, so the launch needs nothing a battle job needs. Dealt at F to
 * a new crew, a mark above the job's floor, and the prize is there at F and not at F-: a launch
 * that froze the prize at the job's lowest grade rather than the dealt one stores nothing.
 *
 * Refound when the server's secret joined the seed (`missions/prize-salt.ts`): every draw moved,
 * and under the `test-secret` salt below this is the first misc card from 2026-11-10 that pays
 * at its dealt grade and not at its floor.
 */
const AT = new Date('2027-03-23T01:00:00.000Z');
const TEMPLATE = 'scrap-run';
const JWT_SECRET = 'test-secret';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AT);
});

async function crewAtTheBoard(): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_siphoner', password: PASSWORD },
  });
  const token = registered.json<{ token: string }>().token;
  const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;

  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('the fixture crew has no base');
  // Somebody to send, and somebody to lead them: a launch with neither is refused for a reason
  // this test is not about.
  app.repos.bases.updateArmy(baseId, { razors: 10 }, base.trainingQueue);
  // Seated: the bench leads nothing (maintainer, 2026-09-28).
  app.repos.bases.updateCommanders(baseId, [
    createCommander('off-1', 'Halvard Nyx', 'field_commander'),
  ]);
  return { app, token, baseId };
}

describe('the page a run might bring home', () => {
  it('is on the launched row and nowhere on the card', async () => {
    const { app, token, baseId } = await crewAtTheBoard();
    const level = app.repos.bases.findById(baseId)!.level;
    // The fixture is only worth running while the card is still on that board, for this crew.
    const onTheWall = missionOffers(MISC_AREA_ID, missionBoardKey(MISC_AREA_ID, AT), level).find(
      (job) => job.template.id === TEMPLATE,
    );
    expect(
      onTheWall,
      `${TEMPLATE} is no longer on the misc board at ${AT.toISOString()}`,
    ).toBeDefined();
    expect(onTheWall!.grade, 'the pinned card is dealt at its floor').not.toBe(
      onTheWall!.template.grades[0],
    );
    const headers = { authorization: `Bearer ${token}` };

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers });
    expect(board.statusCode, board.body.slice(0, 200)).toBe(200);
    const misc = board
      .json<MissionsResponse>()
      .areas.find((area) => area.id === MISC_AREA_ID)
      ?.offers.find((offer) => offer.templateId === TEMPLATE);
    expect(misc, `${TEMPLATE} was not on the misc board the server drew`).toBeDefined();
    expect(misc).not.toHaveProperty('pagePrize');
    expect(board.body).not.toMatch(/pagePrize|page_prize/);

    const launched = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers,
      payload: {
        templateId: TEMPLATE,
        areaId: MISC_AREA_ID,
        force: { razors: 1 },
        leaderId: 'off-1',
      },
    });
    expect(launched.statusCode, launched.body.slice(0, 300)).toBe(200);
    /*
     * ...and not on the run once it is out. The launch answers with the row and every read of the
     * board carries it, so a prize left on it told a player which card paid a page: launch, read
     * the answer, recall inside the window if it said nothing, and try the next card.
     */
    expect(launched.json<LaunchMissionResponse>().mission.pagePrize).toBeNull();
    const reread = await app.inject({ method: 'GET', url: '/api/missions', headers });
    const out = reread.json<MissionsResponse>().missions.filter((one) => one.status === 'active');
    expect(out, 'the launched run is not on the board read').toHaveLength(1);
    expect(out[0]!.pagePrize).toBeNull();

    const row = app.repos.missions.listActiveByBaseId(baseId)[0];
    expect(row, 'the launch wrote no mission row').toBeDefined();
    const frozen = pagePrizeFor(
      pagePrizeSaltFrom(JWT_SECRET),
      MISC_AREA_ID,
      missionBoardKey(MISC_AREA_ID, AT),
      TEMPLATE,
      onTheWall!.grade,
    );
    expect(frozen, 'the pinned job pays no page, so the card had nothing to hide').not.toBeNull();
    expect(row!.mission.pagePrize).toBe(frozen);
  });
});
