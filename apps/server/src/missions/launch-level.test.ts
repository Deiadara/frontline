import {
  MISC_AREA_ID,
  createCommander,
  missionBoardKey,
  missionOffers,
  type LaunchMissionResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * A card the player pressed survives a level-up banked in between (2026-09-28).
 *
 * Boards are dealt at the crew's level, so the world clock banking a level between the read and
 * the press re-deals the card underneath the player: the job can change grade or leave the board,
 * and the launch answered "That job is not on offer there" about the card on their screen. It now
 * also accepts the card as the level before dealt it.
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

/** A level and a plain job on the misc board one level below it that is gone at it. */
function aCardTheLevelTookAway(): { level: number; templateId: string } {
  const key = missionBoardKey(MISC_AREA_ID, AT);
  for (let level = 2; level < 90; level += 1) {
    const now = new Set(missionOffers(MISC_AREA_ID, key, level).map((job) => job.template.id));
    const before = missionOffers(MISC_AREA_ID, key, level - 1).find(
      (job) => job.template.kind === 'standard' && !now.has(job.template.id),
    );
    if (before) return { level, templateId: before.template.id };
  }
  throw new Error('no level on this key takes a plain card away');
}

describe('a card pressed across a level-up', () => {
  it('still goes out as the board dealt it a level ago', async () => {
    const { level, templateId } = aCardTheLevelTookAway();

    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'the_lateleveller', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateArmy(baseId, { razors: 10 }, base.trainingQueue);
    // Seated: the bench leads nothing (maintainer, 2026-09-28).
    app.repos.bases.updateCommanders(baseId, [
      createCommander('off-1', 'Halvard Nyx', 'field_commander'),
    ]);
    app.repos.bases.updateProgression(baseId, level, base.progression);

    const launched = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${token}` },
      payload: { templateId, areaId: MISC_AREA_ID, force: { razors: 1 }, leaderId: 'off-1' },
    });
    expect(launched.statusCode, launched.body.slice(0, 300)).toBe(200);
    expect(launched.json<LaunchMissionResponse>().mission.templateId).toBe(templateId);
  });
});
