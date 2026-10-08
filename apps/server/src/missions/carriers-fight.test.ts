import {
  MISC_AREA_ID,
  createCommander,
  missionBoardKey,
  missionDealer,
  missionOffers,
  type LaunchMissionResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { cardOn } from '../testing/card.js';

/**
 * A crew that puts its porters in the line may send them to a fight on their own (bug pass,
 * 2026-09-29).
 *
 * `carriers_fight` stands a Hauler in the line at its own sheet (maintainer, 2026-09-27). The
 * declared-battle door honours it and the settle fights the porters on a job, but the job's own
 * door asked `isCombatUnit` alone, so a party of Haulers was refused with "Porters do not go in
 * alone" by a crew that had paid for exactly the opposite.
 */

const AT = new Date('2026-11-10T12:00:00.000Z');

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

async function aCrewOfPorters(username: string, research: readonly string[]) {
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
  const token = registered.json<{ token: string }>().token;
  const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateArmy(baseId, { haulers: 30 }, base.musterQueue);
  app.repos.bases.updateCommanders(baseId, [
    createCommander('off-1', 'Halvard Nyx', 'field_commander'),
  ]);
  app.repos.bases.updateResearch(baseId, {
    ...base.research,
    technologies: [...base.research.technologies, ...research],
  });
  return { app, token, level: base.level, dealer: missionDealer(base) };
}

async function sendPortersToTheFight(username: string, research: readonly string[]) {
  const { app, token, level, dealer } = await aCrewOfPorters(username, research);
  const fight = missionOffers(MISC_AREA_ID, missionBoardKey(MISC_AREA_ID, AT), level, dealer).find(
    (job) => job.template.kind === 'battle',
  );
  if (!fight) throw new Error('the misc board deals one fight on every key');
  return app.inject({
    method: 'POST',
    url: '/api/missions',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      templateId: fight.template.id,
      areaId: MISC_AREA_ID,
      ...cardOn(MISC_AREA_ID, fight.grade, AT),
      force: { haulers: 30 },
      leaderId: 'off-1',
    },
  });
}

describe('porters on a fight job', () => {
  it('are refused alone by a crew that keeps them out of the line', async () => {
    const refused = await sendPortersToTheFight('the_strict_yard', []);
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('Porters do not go in alone');
  });

  it('go alone for a crew that fields them (`carriers_fight`)', async () => {
    const sent = await sendPortersToTheFight('the_fight_yard', ['tech_everybody_fights']);
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
    expect(sent.json<LaunchMissionResponse>().mission.force).toEqual({ haulers: 30 });
  });
});
