import {
  DEFAULT_BADGE,
  SPY_COURIER_RESEARCH_ID,
  SPY_WRITTEN_RESEARCH_ID,
  createCommander,
  dayInZone,
  makeAttributes,
  type Commander,
  type Notification,
  type SpyTarget,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { courierPick, courierReportId, courierTargets, settleCouriers } from './courier.js';

/**
 * Turned Runners (maintainer, 2026-09-28): one full report a day, at the Athens boundary, on a
 * random location held by a player outside the crew's faction. Home gates count; home districts,
 * looter and Combine ground do not.
 */

interface Stack {
  app: FastifyInstance;
  token: string;
  baseId: string;
  userId: string;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function register(app: FastifyInstance, username: string): Promise<Stack> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  const base = chosen.json<{ base: { id: string; ownerId: string } }>().base;
  return { app, token, baseId: base.id, userId: base.ownerId };
}

async function makeWorld(): Promise<{ me: Stack; rival: Stack }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return { me: await register(app, 'reader'), rival: await register(app, 'courier_owner') };
}

function teach(stack: Stack, ...ids: string[]): void {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateResearch(base.id, {
    ...base.research,
    technologies: [...new Set([...base.research.technologies, ...ids])],
  });
}

/**
 * A Master of Whispers in the chair and fit to work: the courier reports to them, and comes only
 * while somebody is working it (bug pass, 2026-10-01).
 */
function seatWhispers(stack: Stack, officer: Partial<Commander> = {}): void {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateCommanders(base.id, [
    ...base.commanders.filter((one) => one.id !== 'spy'),
    { ...createCommander('spy', 'Wire', 'master_of_whispers', makeAttributes(40), []), ...officer },
  ]);
}

/** The rival holds the Press, behind a Master of Whispers of theirs no job at Loose Ears would read past. */
function guardedPress(me: Stack, rival: Stack, garrison: Record<string, number>): void {
  const press = me.app.repos.city.control('steelbelt-press')!;
  me.app.repos.city.put({ ...press, holder: { kind: 'crew', baseId: rival.baseId }, garrison });
  const theirs = me.app.repos.bases.findById(rival.baseId)!;
  me.app.repos.bases.updateCommanders(rival.baseId, [
    ...theirs.commanders,
    createCommander('c', 'Quiet', 'master_of_whispers', makeAttributes(100), []),
  ]);
}

const bell = (stack: Stack, kind: Notification['kind']): Notification[] =>
  stack.app.repos.social.notifications(stack.userId, 50).filter((n) => n.kind === kind);

const NOON = new Date('2026-09-28T09:00:00.000Z');
const NEXT_DAY = new Date('2026-09-29T09:00:00.000Z');

describe('the Turned Runners courier', () => {
  it('files one full report a day, on a rival, whatever their counter-intelligence', async () => {
    const { me, rival } = await makeWorld();
    seatWhispers(me);
    teach(me, SPY_COURIER_RESEARCH_ID, SPY_WRITTEN_RESEARCH_ID);
    // The same force at the Press and at their gate, so whichever the courier picks, the report
    // has to be all of it.
    const force = { razors: 30, ghosts: 12, the_specter: 1 };
    guardedPress(me, rival, force);
    me.app.repos.bases.updateGateArmy(rival.baseId, force);

    expect(settleCouriers(me.app.repos, NOON)).toBe(1);
    const report = me.app.repos.spying.reportsFor(me.baseId, 5)[0]!;
    expect(report.id).toBe(courierReportId(me.baseId, dayInZone(NOON)));
    expect(report.tier).toBeNull();
    expect(report.capsPaid).toBe(0);
    expect(report.failed).toBe(false);
    expect(report.holder.kind).toBe('crew');
    expect(report.holder.name).toBe(me.app.repos.bases.findById(rival.baseId)!.name);
    // Everything a spy can count, and the Specter no spy ever can.
    expect(report.exposed).toEqual({ razors: 30, ghosts: 12 });
    expect(bell(me, 'spy_report')[0]!.title).toMatch(/courier/);
    expect(me.app.repos.feats.tallies(me.baseId).courier_reports).toBe(1);
    // Nobody on the other end hears of it: their courier is the one who talked.
    expect(bell(rival, 'spied_on')).toHaveLength(0);
  });

  it('files it once a day however many times the clock ticks, and again the next day', async () => {
    const { me, rival } = await makeWorld();
    seatWhispers(me);
    teach(me, SPY_COURIER_RESEARCH_ID);
    guardedPress(me, rival, { razors: 30 });

    expect(settleCouriers(me.app.repos, NOON)).toBe(1);
    expect(settleCouriers(me.app.repos, new Date(NOON.getTime() + 3_600_000))).toBe(0);
    expect(me.app.repos.spying.reportsFor(me.baseId, 10)).toHaveLength(1);
    expect(settleCouriers(me.app.repos, NEXT_DAY)).toBe(1);
    expect(me.app.repos.spying.reportsFor(me.baseId, 10)).toHaveLength(2);
  });

  it('brings nothing to a crew without the rung', async () => {
    const { me, rival } = await makeWorld();
    seatWhispers(me);
    guardedPress(me, rival, { razors: 30 });
    expect(settleCouriers(me.app.repos, NOON)).toBe(0);
    expect(me.app.repos.spying.reportsFor(me.baseId, 10)).toHaveLength(0);
  });

  it('comes only while somebody is working the chair, and not for the days it was not', async () => {
    const { me, rival } = await makeWorld();
    teach(me, SPY_COURIER_RESEARCH_ID);
    guardedPress(me, rival, { razors: 30 });
    const later = new Date(NOON.getTime() + 3_600_000);

    // Empty, benched, and in a hospital bed past the tick: nothing each time.
    expect(settleCouriers(me.app.repos, NOON), 'an empty chair').toBe(0);
    seatWhispers(me, { role: null });
    expect(settleCouriers(me.app.repos, NOON), 'a benched officer').toBe(0);
    seatWhispers(me, { injuredUntil: later.toISOString() });
    expect(settleCouriers(me.app.repos, NOON), 'an officer in bed').toBe(0);
    expect(me.app.repos.spying.reportsFor(me.baseId, 10)).toHaveLength(0);

    // Out of bed later the same day: that day's report, once.
    expect(settleCouriers(me.app.repos, later)).toBe(1);
    expect(settleCouriers(me.app.repos, later)).toBe(0);
    expect(me.app.repos.spying.reportsFor(me.baseId, 10)[0]!.id).toBe(
      courierReportId(me.baseId, dayInZone(NOON)),
    );
  });

  it("reads a rival's locations and home gate, and never looter, Combine or its own ground", async () => {
    const { me, rival } = await makeWorld();
    guardedPress(me, rival, { razors: 30 });
    const reader = me.app.repos.bases.findById(me.baseId)!;
    const targets = courierTargets(me.app.repos, reader);
    const rivalHome = me.app.repos.bases.findById(rival.baseId)!.districtId;

    expect(targets).toContainEqual({ kind: 'location', locationId: 'steelbelt-press' });
    expect(targets).toContainEqual({ kind: 'gate', districtId: rivalHome });
    for (const target of targets) {
      if (target.kind === 'gate') {
        expect(target.districtId, 'our own gate').not.toBe(reader.districtId);
        continue;
      }
      const holder = me.app.repos.city.control(target.locationId)!.holder;
      expect(holder.kind, target.locationId).toBe('crew');
      if (holder.kind === 'crew') expect(holder.baseId).not.toBe(me.baseId);
    }
  });

  it('skips everybody at the same table', async () => {
    const { me, rival } = await makeWorld();
    guardedPress(me, rival, { razors: 30 });
    me.app.repos.factions.insert({
      id: 'f1',
      name: 'The Compact',
      badge: DEFAULT_BADGE,
      blurb: '',
      foundedAt: NOON.toISOString(),
    });
    for (const [userId, rank] of [
      [rival.userId, 'leader'],
      [me.userId, 'member'],
    ] as const) {
      me.app.repos.factions.addMember({
        userId,
        factionId: 'f1',
        rank,
        joinedAt: NOON.toISOString(),
      });
    }
    const reader = me.app.repos.bases.findById(me.baseId)!;
    const rivalHome = me.app.repos.bases.findById(rival.baseId)!.districtId;
    const targets = courierTargets(me.app.repos, reader);
    expect(targets).not.toContainEqual({ kind: 'location', locationId: 'steelbelt-press' });
    expect(targets).not.toContainEqual({ kind: 'gate', districtId: rivalHome });
  });

  it('picks the same place for the same crew and day, and moves about across days', () => {
    const targets: SpyTarget[] = Array.from({ length: 12 }, (_, index) => ({
      kind: 'location',
      locationId: `place-${index}`,
    }));
    expect(courierPick('b1', '2026-09-28', targets)).toEqual(
      courierPick('b1', '2026-09-28', targets),
    );
    const picked = new Set(
      Array.from({ length: 30 }, (_, day) =>
        JSON.stringify(courierPick('b1', `2026-10-${String(day + 1).padStart(2, '0')}`, targets)),
      ),
    );
    expect(picked.size).toBeGreaterThan(5);
    expect(courierPick('b1', '2026-09-28', [])).toBeNull();
  });
});
