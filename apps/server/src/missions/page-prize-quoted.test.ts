import {
  MISC_AREA_ID,
  createCommander,
  missionBoardDay,
  missionBoardKey,
  missionOffers,
  pagePrizeFor,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * §F1b: the blueprint page a mission card advertises is the page the row is frozen with.
 *
 * `misc` grew an hourly turnover on 2026-09-19 (`MISC_BOARD_ROTATION_MINUTES`) and `board.ts`
 * moved to `missionBoardKey`, which is `<day>#<slot>` for that one board. `launchMission` went on
 * seeding the prize off `missionBoardDay`, the bare day, so the card and the row ran two
 * independent draws of the same function: 105 misc cards in a fortnight quoted a page the launch
 * did not freeze, or froze one the card said nothing about. The districts were never affected,
 * because their key is their day, which is why every board test in the suite stayed green.
 *
 * Read off the wire and then off the row, the way `routes/quoted.test.ts` argues a price check has
 * to be done: a test that compared the two arithmetics would pass while both were wrong.
 */

const PASSWORD = 'hunter2pass';

/**
 * A moment where the two seeds disagree, and the job standing there.
 *
 * Pinned rather than searched, so a failure names one card and one hour instead of "some card,
 * some hour". The assertion below still holds at any moment; this is the one chosen because the
 * defect is visible in it, which is what stops the test passing vacuously on a day when the two
 * draws happen to agree. `standard`, so the launch needs nothing a battle job needs.
 */
const AT = new Date('2026-09-21T03:00:00.000Z');
const TEMPLATE = 'fuel-siphon';

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
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
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
  app.repos.bases.updateCommanders(baseId, [createCommander('off-1', 'Halvard Nyx', null)]);
  return { app, token, baseId };
}

describe('the page a misc card promises', () => {
  it('is the page the launched run is frozen with', async () => {
    // The fixture is only worth running while the card is still on that board.
    const onTheWall = missionOffers(MISC_AREA_ID, missionBoardKey(MISC_AREA_ID, AT)).some(
      (offer) => offer.id === TEMPLATE,
    );
    expect(onTheWall, `${TEMPLATE} is no longer on the misc board at ${AT.toISOString()}`).toBe(
      true,
    );

    const { app, token, baseId } = await crewAtTheBoard();
    const headers = { authorization: `Bearer ${token}` };

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers });
    expect(board.statusCode, board.body.slice(0, 200)).toBe(200);
    const misc = board
      .json<MissionsResponse>()
      .areas.find((area) => area.id === MISC_AREA_ID)
      ?.offers.find((offer) => offer.templateId === TEMPLATE);
    expect(misc, `${TEMPLATE} was not on the misc board the server drew`).toBeDefined();

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

    const row = app.repos.missions.listActiveByBaseId(baseId)[0];
    expect(row, 'the launch wrote no mission row').toBeDefined();
    expect(row!.mission.pagePrize).toBe(misc!.pagePrize);
  });

  /**
   * The positive control for the moment above, and the measure of what the defect was worth.
   *
   * The test above pins one hour and one card, which on its own proves nothing about whether that
   * hour was a fluke: if the misc key and the bare day happened to draw the same prize almost
   * always, the end-to-end check would pass through a reintroduced bug on most days. So this
   * counts the disagreements across a fortnight of misc slots and refuses a number small enough
   * for the other test to be luck.
   *
   * It deliberately does **not** assert the fix. Comparing the launch's key against the board's
   * key would be comparing one expression with itself, which is the tautology this file exists to
   * avoid; the launch is measured through the wire above, where it cannot be faked.
   */
  it('draws a materially different prize from the bare day, which is what the launch used to read', () => {
    let disagreements = 0;
    let cards = 0;
    for (let hour = 0; hour < 24 * 14; hour += 1) {
      const at = new Date(AT.getTime() + hour * 3_600_000);
      const key = missionBoardKey(MISC_AREA_ID, at);
      const day = missionBoardDay(at);
      expect(key, 'the misc board no longer carries a slot').not.toBe(day);
      for (const template of missionOffers(MISC_AREA_ID, key)) {
        cards += 1;
        const onTheCard = pagePrizeFor(MISC_AREA_ID, key, template.id, template.difficulty);
        const offTheDay = pagePrizeFor(MISC_AREA_ID, day, template.id, template.difficulty);
        if (onTheCard !== offTheDay) disagreements += 1;
      }
    }
    expect(cards, 'no misc cards in the window').toBeGreaterThan(500);
    expect(
      disagreements,
      'the two keys draw alike, so the route test could be luck',
    ).toBeGreaterThan(50);
  });
});
