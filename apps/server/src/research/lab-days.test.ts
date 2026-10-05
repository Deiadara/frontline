import {
  createCommander,
  itemsInTrack,
  makeAttributes,
  type Base,
  type Building,
  type Commander,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { settleBase } from '../district/settle.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { cancelResearch, startResearch } from './start.js';

/**
 * The Lab over a simulated day (bug pass 3, 2026-10-05): prices at Lab 10 and 20, the tier gate at
 * Lab 1, the Researcher's cut on the clock and never on the bill, the six-hour settle, the clock
 * frozen at start, and the ninety percent a cancel in the first tenth hands back.
 *
 * Every figure is worked out by hand from the catalogue's formulas and written in as a number.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date('2026-10-05T12:00:00.000Z');

let accounts = 0;

const RICH = {
  caps: 100_000,
  scrap: 20_000,
  planks: 0,
  oil: 0,
  supplies: 0,
  highQualityMetal: 4_000,
};

/** A perfect sheet in `role`, seated `hoursAgo` before {@link NOW}. */
function officer(role: 'engineer' | 'researcher', hoursAgo: number): Commander {
  return {
    ...createCommander(`${role}-lab`, `${role} lab`, role, makeAttributes(100)),
    seatedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
  };
}

/** A crew at Lab `lab` with the Engineer track climbed to `done` rungs and the officers given. */
async function lab(
  labLevel: number,
  done: number,
  officers: Commander[],
): Promise<{ app: FastifyInstance; id: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  accounts += 1;
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: `lab_days_${accounts}`, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  pinOverseer(app, token);
  const id = chosen.json<{ base: { id: string } }>().base.id;
  const fresh = app.repos.bases.findById(id)!;
  app.repos.bases.updateCommanders(id, [
    ...fresh.commanders.map((one) => ({ ...one, role: null })),
    ...officers,
  ]);
  const buildings: Building[] = [
    { id: 'nexus-lab', kind: 'nexus', level: 20, modifications: [] },
    { id: 'apothecary-lab', kind: 'apothecary', level: 20, modifications: [] },
    { id: 'lab-lab', kind: 'lab', level: labLevel, modifications: [] },
  ];
  app.repos.bases.updateDistrict(id, buildings, []);
  app.repos.bases.updateResources(id, { ...fresh.resources, ...RICH });
  app.repos.bases.updateResearch(id, {
    active: null,
    technologies: itemsInTrack('engineer')
      .slice(0, done)
      .map((spec) => spec.id),
  });
  return { app, id };
}

const read = (app: FastifyInstance, id: string): Base => app.repos.bases.findById(id)!;
const rung = (step: number): string => itemsInTrack('engineer')[step - 1]!.id;

function start(app: FastifyInstance, id: string, step: number, now = NOW) {
  return startResearch(app.repos, {
    base: read(app, id),
    project: { kind: 'technology', techId: rung(step) },
    id: `run-${step}`,
    now,
  });
}

describe('what a rung costs and how long it takes', () => {
  it('opens nothing at Lab 1: the first tier needs a Lab at 2', async () => {
    const { app, id } = await lab(1, 0, [officer('engineer', 24), officer('researcher', 24)]);
    expect(start(app, id, 1)).toEqual({ kind: 'refused', reason: 'locked' });
  });

  it('at Lab 10 takes 15% off the bill and the settled Researcher 47.1% off the clock', async () => {
    const { app, id } = await lab(10, 4, [officer('engineer', 24), officer('researcher', 24)]);
    // Nothing else on the research clock, so the sum is the Researcher's 50 points alone.
    expect(standingEffectsFor(app.repos, read(app, id), NOW).researchSpeedPercent).toBe(0);
    const started = start(app, id, 5);
    if (started.kind !== 'started') throw new Error(started.reason);
    /*
     * Rung 5: caps 600 x 5^1.35 = 5,269 to 5,250; scrap 400 x 5^1.25 = 2,991 to 3,000; metal
     * 30 x 2^1.3 = 73.9 to 70. Less 15%: 4,462.5 (4,463), 2,550, 59.5 (60). The clock is
     * 20 + 25 x 5 = 145 minutes; 50 points through the 30/92 taper is 47.09% off: 76.7, so 77.
     */
    expect(started.active.paid).toEqual({ caps: 4463, scrap: 2550, highQualityMetal: 60 });
    expect(started.active.durationMinutes).toBe(77);
    expect(started.base.resources.caps).toBe(RICH.caps - 4463);
  });

  it('refuses rung 6 at Lab 10, and opens it at 12', async () => {
    const shut = await lab(10, 5, [officer('engineer', 24), officer('researcher', 24)]);
    expect(start(shut.app, shut.id, 6)).toEqual({ kind: 'refused', reason: 'locked' });
    const open = await lab(12, 5, [officer('engineer', 24), officer('researcher', 24)]);
    expect(start(open.app, open.id, 6).kind).toBe('started');
  });

  it('at Lab 20 takes 30% off the tenth rung, and a Researcher seated an hour ago cuts nothing', async () => {
    const settled = await lab(20, 9, [officer('engineer', 24), officer('researcher', 24)]);
    const fresh = await lab(20, 9, [officer('engineer', 24), officer('researcher', 1)]);
    const a = start(settled.app, settled.id, 10);
    const b = start(fresh.app, fresh.id, 10);
    if (a.kind !== 'started' || b.kind !== 'started') throw new Error('refused');
    /*
     * Rung 10: caps 600 x 10^1.35 = 13,432 to 13,450; scrap 400 x 10^1.25 = 7,113 to 7,100; metal
     * 30 x 7^1.3 = 376.5 to 380. Less 30%: 9,415, 4,970, 266. The Researcher never moves the bill.
     */
    expect(a.active.paid).toEqual({ caps: 9415, scrap: 4970, highQualityMetal: 266 });
    expect(b.active.paid).toEqual(a.active.paid);
    // 270 minutes; 47.09% off is 142.9, so 143. Unsettled, the chair opens the rung and cuts nothing.
    expect(a.active.durationMinutes).toBe(143);
    expect(b.active.durationMinutes).toBe(270);
  });
});

describe('one project at a time, on a clock frozen at start', () => {
  it('refuses a second, lands at the frozen minute after the Researcher leaves, and pays once', async () => {
    const { app, id } = await lab(10, 4, [officer('engineer', 24), officer('researcher', 24)]);
    const started = start(app, id, 5);
    if (started.kind !== 'started') throw new Error(started.reason);
    expect(start(app, id, 6)).toEqual({ kind: 'refused', reason: 'already_running' });

    // The Researcher leaves the chair: the running clock does not move.
    const base = read(app, id);
    app.repos.bases.updateCommanders(
      id,
      base.commanders.map((one) => (one.role === 'researcher' ? { ...one, role: null } : one)),
    );
    const before = settleBase(app.repos, read(app, id), new Date(NOW.getTime() + 76 * MINUTE));
    expect(before.base.research.active?.durationMinutes).toBe(77);
    expect(before.base.research.technologies).not.toContain(rung(5));

    const after = settleBase(app.repos, read(app, id), new Date(NOW.getTime() + 77 * MINUTE));
    expect(after.base.research.active).toBeNull();
    expect(after.base.research.technologies.filter((one) => one === rung(5))).toHaveLength(1);
  });

  it('hands back 90% inside the first tenth, and refuses after it', async () => {
    const { app, id } = await lab(20, 9, [officer('engineer', 24), officer('researcher', 24)]);
    const started = start(app, id, 10);
    if (started.kind !== 'started') throw new Error(started.reason);
    // 143 minutes: the window is 14.3 minutes.
    const inside = cancelResearch(app.repos, read(app, id), new Date(NOW.getTime() + 14 * MINUTE));
    if (inside.kind !== 'cancelled') throw new Error(inside.reason);
    // floor(0.9 x 9,415), floor(0.9 x 4,970), floor(0.9 x 266).
    expect(inside.refund).toEqual({ caps: 8473, scrap: 4473, highQualityMetal: 239 });
    expect(inside.base.resources.caps).toBe(RICH.caps - 9415 + 8473);

    const again = start(app, id, 10);
    if (again.kind !== 'started') throw new Error(again.reason);
    expect(
      cancelResearch(app.repos, read(app, id), new Date(NOW.getTime() + 15 * MINUTE)).kind,
    ).toBe('refused');
  });
});
