import { CHAIR_SETTLE_HOURS, createCommander, type CrewResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { crewEffectsFor, officerLiftRoom } from '../crew/standing.js';
import { settleBase } from '../district/settle.js';
import { spyStrengthFor } from '../spying/spying.js';
import { chooseOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';

/**
 * §C2 against the settle window.
 *
 * `settleDistrict` reads the crew's `productionPercent` once and applies it to the whole elapsed
 * window, on the stated grounds that "a crew does not change halfway through a settle".
 * `/crew/reassign` was the one write route in the server that did not settle first, which made that
 * comment false: seat an officer where their best attribute pays, and the next read banks the
 * *whole* unsettled window at the new rate. Two HTTP calls buy a day of production the crew never
 * had.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

describe('reseating an officer', () => {
  it('settles the window that was earned under the old seat before the new seat applies', async () => {
    const app = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'seat_mover', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    openDoors(app, token, 'crew');
    const baseId = chosen.json<{ base: { id: string } }>().base.id;

    // Somebody to move, and a stale settle clock: a day of production nobody has banked.
    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('no base');
    settleBase(app.repos, base, new Date());
    const settled = app.repos.bases.findById(baseId);
    if (!settled) throw new Error('no base');

    const officer = createCommander('officer-1', 'Vasso', 'engineer', { engineering: 90 });
    app.repos.bases.updateCommanders(baseId, [...settled.commanders, officer]);

    const aDayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
    app.repos.bases.updateEconomy(baseId, {
      ...settled.economy,
      productionSettledAt: aDayAgo,
    });

    const target = 'steward';

    const reassigned = await app.inject({
      method: 'POST',
      url: '/api/crew/reassign',
      headers: auth(token),
      payload: { officerId: officer.id, role: target },
    });
    expect(reassigned.statusCode, reassigned.body).toBe(200);

    // The unsettled day must have been banked before the seat changed, so nothing of it is left
    // to be paid at the new rate.
    const after = app.repos.bases.findById(baseId);
    expect(after?.economy.productionSettledAt).not.toBe(aDayAgo);
    expect(Date.parse(after?.economy.productionSettledAt ?? '')).toBeGreaterThan(
      Date.parse(aDayAgo),
    );
  });
});

/**
 * The reseat cooldown (maintainer, 2026-10-05): a chair gives nothing for its first
 * `CHAIR_SETTLE_HOURS`, so one strong officer cannot be walked through every chair to carry each
 * passive at the moment it is spent.
 */
describe('a chair taken a moment ago', () => {
  async function crewWith(
    officers: ReturnType<typeof createCommander>[],
  ): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
    const app = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'chair_hopper', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    openDoors(app, token, 'crew');
    const baseId = chosen.json<{ base: { id: string } }>().base.id;
    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('no base');
    app.repos.bases.updateCommanders(baseId, [...base.commanders, ...officers]);
    return { app, token, baseId };
  }

  const reseat = async (
    app: FastifyInstance,
    token: string,
    officerId: string,
    role: string | null,
  ): Promise<CrewResponse> => {
    const moved = await app.inject({
      method: 'POST',
      url: '/api/crew/reassign',
      headers: auth(token),
      payload: { officerId, role },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    return moved.json<{ crew: CrewResponse }>().crew;
  };

  const later = (hours: number): Date => new Date(Date.now() + hours * 3_600_000);
  const settles = CHAIR_SETTLE_HOURS;

  it('pays the passive only once the officer has settled in, and says when on the card', async () => {
    const officer = createCommander('officer-1', 'Vasso', null, { engineering: 90 });
    const { app, token, baseId } = await crewWith([officer]);
    const crew = await reseat(app, token, officer.id, 'engineer');
    const card = crew.officers.find((one) => one.officerId === officer.id);
    const seatedAt = app.repos.bases
      .findById(baseId)
      ?.commanders.find((one) => one.id === officer.id)?.seatedAt;
    expect(seatedAt).toBeTypeOf('string');
    expect(Date.parse(card?.chairFrom ?? '') - Date.parse(seatedAt ?? '')).toBe(
      settles * 3_600_000,
    );

    const base = app.repos.bases.findById(baseId)!;
    expect(crewEffectsFor(app.repos, base, later(settles - 0.1)).chairPoints.engineer).toBe(
      undefined,
    );
    expect(
      crewEffectsFor(app.repos, base, later(settles + 0.1)).chairPoints.engineer,
    ).toBeGreaterThan(10);
  });

  it('leaves an officer seated before the clock existed settled', async () => {
    const officer = createCommander('officer-1', 'Vasso', 'engineer', { engineering: 90 });
    const { app, baseId } = await crewWith([officer]);
    const base = app.repos.bases.findById(baseId)!;
    expect(crewEffectsFor(app.repos, base).chairPoints.engineer).toBeGreaterThan(10);
  });

  it('restarts the clock on every move, including a hop from one chair to the next', async () => {
    const officer = createCommander('officer-1', 'Vasso', 'engineer', { engineering: 90 });
    const { app, token, baseId } = await crewWith([officer]);
    await reseat(app, token, officer.id, 'veteran');
    const base = app.repos.bases.findById(baseId)!;
    const effects = crewEffectsFor(app.repos, base);
    expect(effects.chairPoints.engineer).toBe(undefined);
    expect(effects.chairPoints.veteran).toBe(undefined);
  });

  it('holds back the Right Hand lift and the spy grade too', async () => {
    const hand = createCommander('hand', 'Ilse', null, { leadership: 95, composure: 95 });
    const whisper = createCommander('whisper', 'Corin', null, { cryptography: 95, stealth: 95 });
    const peer = createCommander('peer', 'Dax', 'engineer');
    const { app, token, baseId } = await crewWith([hand, whisper, peer]);
    await reseat(app, token, hand.id, 'right_hand');
    await reseat(app, token, whisper.id, 'master_of_whispers');
    const base = app.repos.bases.findById(baseId)!;

    expect(officerLiftRoom(app.repos, base, later(1)).rightHand).toBe(null);
    expect(officerLiftRoom(app.repos, base, later(settles + 0.1)).rightHand?.id).toBe(hand.id);
    expect(spyStrengthFor(app.repos, base, 'loose_ears', later(1)).chairPoints).toBe(0);
    expect(
      spyStrengthFor(app.repos, base, 'loose_ears', later(settles + 0.1)).chairPoints,
    ).toBeGreaterThan(0);
  });
});
