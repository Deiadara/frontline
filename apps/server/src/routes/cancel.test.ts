import {
  RESEARCH_ITEMS,
  STARTING_RESOURCES,
  CANCEL_REFUND,
  buildingCost,
  capturedGateCost,
  findDistrict,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  upgradeCost,
  type Base,
  type BuildStructureResponse,
  type PartialResources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { cancelGateRaise, gateFor, raiseCapturedGate } from '../city/gates.js';
import { cancelUpgrade, startUpgrade, upgradeSeconds } from '../city/upgrade.js';
import { loadConfig } from '../config.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { cancelBuild, queueBuild } from '../district/build.js';
import { cancelResearch } from '../research/start.js';
import { recallSpy, settleSpying } from '../spying/spying.js';
import { chooseOverseer } from '../testing/overseer.js';
import { AppError } from '../errors.js';

/**
 * Calling things off (maintainer request, 2026-09-12; `time/cancel.ts`).
 *
 * One rule, seven clocks: inside the first tenth, ninety percent back, and for a journey the way
 * home as long as the way out. Each clock is asserted at three points: open, shut, and what came
 * back. The percentage is read off the shared constant so this suite follows the rule if the
 * board moves the number, and asserts the *amount* against the price the crew was actually
 * charged, so a refund computed off today's price rather than the price paid would show.
 */

const HOUR = '2026-09-12T10:00:00.000Z';

/**
 * The fixtures hold far more than any store so every clock can be paid for, which means every
 * refund here lands on a full store (maintainer ruling, 2026-09-28). The windows are what these
 * tests measure, so they agree to the waste up front; `full stores` below is the warning itself.
 */
const RICH_ON_PURPOSE = true;
const at = (minutes: number) => new Date(Date.parse(HOUR) + minutes * 60_000);

const dbs: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

function stack(): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  dbs.push(db);
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'changer', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'Second Thoughts',
    districtId: 'kettle-row',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES, caps: 9e6, scrap: 9e6, planks: 9e6, oil: 9e6 },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [
      { id: 'nexus', kind: 'nexus', level: 20, modifications: [] },
      { id: 'generator', kind: 'generator', level: 1, modifications: [] },
    ],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(HOUR),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: HOUR,
  };
  repos.bases.insert(base);
  return { repos, base };
}

const RUSTYARD = findDistrict('steelbelt')!;
const PRESS = RUSTYARD.locations[0]!;

function hand(repos: Repositories, baseId: string, locationId: string): void {
  const control = repos.city.control(locationId)!;
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
}

/** Ninety percent of each line, rounded down, as `cancelRefund` promises. */
function ninety(paid: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(paid)
      .filter(([, amount]) => (amount ?? 0) > 0)
      .map(([key, amount]) => [key, Math.floor((amount ?? 0) * CANCEL_REFUND)]),
  );
}

describe('a build order', () => {
  it('comes off the queue inside its first tenth with ninety percent back, and closes the queue up', () => {
    const { repos, base } = stack();
    const first = queueBuild(repos, { base, structure: 'quarters', id: 'q1', now: at(0) });
    expect(first.kind).toBe('queued');
    if (first.kind !== 'queued') return;
    const second = queueBuild(repos, {
      base: first.base,
      structure: 'greenhouse',
      id: 'q2',
      now: at(0),
    });
    expect(second.kind).toBe('queued');
    if (second.kind !== 'queued') return;
    const price = buildingCost('quarters', 1, base.buildings);
    expect(first.entry.paid).toEqual(price);
    // The second waits behind the first.
    expect(second.entry.startedAt).not.toBe(first.entry.startedAt);

    // A second in: well inside the tenth of even a short first level.
    const soon = new Date(at(0).getTime() + 1000);
    const cancelled = cancelBuild(repos, second.base, 'q1', soon, RICH_ON_PURPOSE);
    expect(cancelled.kind).toBe('cancelled');
    if (cancelled.kind !== 'cancelled') return;
    expect(cancelled.refund).toEqual(ninety(price));
    expect(cancelled.base.resources.caps).toBe(
      second.base.resources.caps + (ninety(price).caps ?? 0),
    );
    // The one behind moved up to now: it was waiting on a build that no longer exists.
    expect(cancelled.base.buildQueue.map((entry) => entry.id)).toEqual(['q2']);
    expect(cancelled.base.buildQueue[0]!.startedAt).toBe(soon.toISOString());
    // And the row says the same as the return value.
    expect(repos.bases.findById(base.id)!.buildQueue).toHaveLength(1);
  });

  it('refuses once the first tenth is gone', () => {
    const { repos, base } = stack();
    const queued = queueBuild(repos, { base, structure: 'quarters', id: 'q1', now: at(0) });
    if (queued.kind !== 'queued') throw new Error('fixture: the order was refused');
    const tenth = (queued.entry.durationSeconds * 1000) / 10;
    const before = new Date(at(0).getTime() + tenth - 1);
    const after = new Date(at(0).getTime() + tenth);
    expect(cancelBuild(repos, queued.base, 'q1', after)).toEqual({
      kind: 'refused',
      reason: 'window_closed',
    });
    expect(cancelBuild(repos, queued.base, 'q1', before, RICH_ON_PURPOSE).kind).toBe('cancelled');
  });
});

describe('a research project', () => {
  it('comes off the bench inside its first tenth with ninety percent back', () => {
    const { repos, base } = stack();
    const spec = RESEARCH_ITEMS[0]!;
    const paid = { caps: 1_000, scrap: 250 };
    const running: Base = {
      ...base,
      research: {
        ...base.research,
        active: {
          id: 'r1',
          project: { kind: 'technology', techId: spec.id },
          startedAt: HOUR,
          durationMinutes: 100,
          paid,
        },
      },
    };
    repos.bases.updateResearch(base.id, running.research);

    expect(cancelResearch(repos, running, at(10))).toEqual({
      kind: 'refused',
      reason: 'window_closed',
    });
    const cancelled = cancelResearch(repos, running, at(9), RICH_ON_PURPOSE);
    expect(cancelled.kind).toBe('cancelled');
    if (cancelled.kind !== 'cancelled') return;
    expect(cancelled.refund).toEqual(ninety(paid));
    expect(cancelled.base.research.active).toBeNull();
    expect(repos.bases.findById(base.id)!.research.active).toBeNull();
    expect(cancelResearch(repos, cancelled.base, at(9))).toEqual({
      kind: 'refused',
      reason: 'nothing_running',
    });
  });
});

describe("a location's work", () => {
  it('calls an upgrade off inside its first tenth, with ninety percent of the level back', () => {
    const { repos, base } = stack();
    hand(repos, base.id, PRESS.id);
    const control = repos.city.control(PRESS.id)!;
    const started = startUpgrade(repos, { base, location: PRESS, control, now: at(0) });
    expect(started.kind).toBe('started');
    if (started.kind !== 'started') return;
    const price = upgradeCost(PRESS.kind, control.level)!;
    const seconds = upgradeSeconds(PRESS.kind, control.level);

    const late = new Date(at(0).getTime() + seconds * 100);
    expect(
      cancelUpgrade(repos, {
        base: started.base,
        location: PRESS,
        control: started.control,
        now: late,
      }),
    ).toEqual({ kind: 'refused', reason: 'window_closed' });

    const early = new Date(at(0).getTime() + seconds * 50);
    const cancelled = cancelUpgrade(repos, {
      base: started.base,
      location: PRESS,
      control: started.control,
      now: early,
      acceptWaste: RICH_ON_PURPOSE,
    });
    expect(cancelled.kind).toBe('cancelled');
    if (cancelled.kind !== 'cancelled') return;
    expect(cancelled.refund).toEqual(ninety(price));
    expect(cancelled.control.upgradingUntil).toBeNull();
    expect(repos.city.control(PRESS.id)!.upgradingUntil).toBeNull();
  });
});

describe('a spy job', () => {
  it('turns round in the first tenth of the whole job, walks home as far as it came, and reports nothing', () => {
    const { repos, base } = stack();
    /*
     * Two hours out, an hour looking and two hours home: 300 minutes, so the window is 30
     * (maintainer, 2026-09-22), not a tenth of the walk.
     */
    const run = (id: string, baseId: string) => ({
      id,
      baseId,
      target: { kind: 'gate' as const, districtId: 'blacksite' },
      tier: 'loose_ears' as const,
      capsPaid: 100,
      departedAt: HOUR,
      returnsAt: at(300).toISOString(),
      travelMinutes: 120,
      recalledAt: null,
    });
    repos.spying.insert(run('j1', base.id));
    expect(recallSpy(repos, base, at(31))).toEqual({ kind: 'refused', reason: 'window_closed' });
    expect(recallSpy(repos, base, at(12)).kind).toBe('recalled');

    const { repos: second, base: other } = stack();
    second.spying.insert(run('j2', other.id));
    const recalled = recallSpy(second, other, at(8));
    expect(recalled.kind).toBe('recalled');
    if (recalled.kind !== 'recalled') return;
    // Eight minutes out, eight minutes home: the distance covered, since the cap at the two-hour
    // walk out does not bind this early.
    expect(recalled.run.returnsAt).toBe(at(16).toISOString());
    expect(recalled.run.recalledAt).toBe(at(8).toISOString());
    expect(recallSpy(second, other, at(9))).toEqual({ kind: 'refused', reason: 'nobody_out' });

    // Home and settled, with no report: they never got there. The caps went at the send.
    settleSpying(second, at(16));
    expect(second.spying.activeFor(other.id)).toEqual([]);
    expect(second.spying.reportsFor(other.id, 10)).toEqual([]);
    // Nor is it a job home on the feats board: that ladder counts reports written.
    expect(second.feats.tallies(other.id).spy_jobs_returned ?? 0).toBe(0);
  });
});

describe('a captured gate being raised', () => {
  it('is called off inside its first tenth, with ninety percent of the price back', () => {
    const { repos, base } = stack();
    for (const location of RUSTYARD.locations) hand(repos, base.id, location.id);
    const started = raiseCapturedGate(repos, base, RUSTYARD.id, at(0));
    expect(started.kind).toBe('started');
    if (started.kind !== 'started') return;
    expect(started.gate.upgradingSince).toBe(at(0).toISOString());
    const total = Date.parse(started.gate.upgradingUntil!) - at(0).getTime();

    expect(
      cancelGateRaise(repos, started.base, RUSTYARD.id, new Date(at(0).getTime() + total / 10)),
    ).toEqual({ kind: 'refused', reason: 'window_closed' });
    const cancelled = cancelGateRaise(
      repos,
      started.base,
      RUSTYARD.id,
      new Date(at(0).getTime() + total / 20),
      RICH_ON_PURPOSE,
    );
    expect(cancelled.kind).toBe('cancelled');
    if (cancelled.kind !== 'cancelled') return;
    expect(cancelled.refund).toEqual(ninety(capturedGateCost(2)));
    expect(gateFor(repos, RUSTYARD.id).upgradingTo).toBeNull();
    expect(gateFor(repos, RUSTYARD.id).level).toBe(1);
  });
});

/**
 * Every refund goes into the stores, and a refund onto a full one is warned about first
 * (maintainer ruling, 2026-09-28).
 *
 * The fixtures stand far over the scrap, plank and oil ceilings, so that part of each refund would
 * be thrown away whole. Without the player's yes each cancel is refused with the figure
 * and nothing moves: the order is still on the row.
 */
describe('full stores', () => {
  function wouldWaste(call: () => unknown): PartialResources {
    try {
      call();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('WOULD_WASTE');
      return (error as AppError).waste ?? {};
    }
    throw new Error('the cancel went through without a warning');
  }
  /** The part of a refund aimed at the three stores `stack` fills far past their ceiling. */
  const overTheTop = (refund: PartialResources): PartialResources =>
    Object.fromEntries(
      Object.entries(refund).filter(([key]) => ['scrap', 'planks', 'oil'].includes(key)),
    );

  it('warns before a build refund is thrown away, and leaves the order on the queue', () => {
    const { repos, base } = stack();
    const queued = queueBuild(repos, { base, structure: 'quarters', id: 'q1', now: at(0) });
    if (queued.kind !== 'queued') throw new Error('fixture: the order was refused');
    const waste = wouldWaste(() => cancelBuild(repos, queued.base, 'q1', at(0)));
    expect(waste).toEqual(overTheTop(ninety(queued.entry.paid)));
    expect(repos.bases.findById(base.id)!.buildQueue.map((entry) => entry.id)).toEqual(['q1']);
  });

  it('warns before a research refund is thrown away', () => {
    const { repos, base } = stack();
    const paid = { caps: 1_000, scrap: 250 };
    const running: Base = {
      ...base,
      research: {
        ...base.research,
        active: {
          id: 'r1',
          project: { kind: 'technology', techId: RESEARCH_ITEMS[0]!.id },
          startedAt: HOUR,
          durationMinutes: 100,
          paid,
        },
      },
    };
    repos.bases.updateResearch(base.id, running.research);
    expect(wouldWaste(() => cancelResearch(repos, running, at(1)))).toEqual({ scrap: 225 });
    expect(repos.bases.findById(base.id)!.research.active?.id).toBe('r1');
  });

  it("warns before a location's refund is thrown away", () => {
    const { repos, base } = stack();
    hand(repos, base.id, PRESS.id);
    const control = repos.city.control(PRESS.id)!;
    const started = startUpgrade(repos, { base, location: PRESS, control, now: at(0) });
    if (started.kind !== 'started') throw new Error('fixture: the upgrade was refused');
    const refund = ninety(upgradeCost(PRESS.kind, control.level)!);
    const waste = wouldWaste(() =>
      cancelUpgrade(repos, {
        base: started.base,
        location: PRESS,
        control: started.control,
        now: at(0),
      }),
    );
    expect(waste).toEqual(overTheTop(refund));
    expect(repos.city.control(PRESS.id)!.upgradingUntil).not.toBeNull();
  });

  it("warns before a gate's refund is thrown away", () => {
    const { repos, base } = stack();
    for (const location of RUSTYARD.locations) hand(repos, base.id, location.id);
    const started = raiseCapturedGate(repos, base, RUSTYARD.id, at(0));
    if (started.kind !== 'started') throw new Error('fixture: the raise was refused');
    const waste = wouldWaste(() => cancelGateRaise(repos, started.base, RUSTYARD.id, at(0)));
    expect(waste).toEqual(overTheTop(ninety(capturedGateCost(2))));
    expect(gateFor(repos, RUSTYARD.id).upgradingTo).toBe(2);
  });
});

describe('over the wire', () => {
  async function player(): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    dbs.push(db);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    apps.push(app);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'wavering', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
  }

  it('cancels a build through the route and hands the refund back on the response', async () => {
    const { app, token, baseId } = await player();
    const before = app.repos.bases.findById(baseId)!;
    const built = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'quarters' },
    });
    expect(built.statusCode, built.body).toBe(200);
    const queued = built.json<BuildStructureResponse>().base;
    const order = queued.buildQueue[0]!;
    // The testing build waives the bill, so what was paid is what the row says was paid.
    const spent = before.resources.caps - queued.resources.caps;
    expect(spent).toBe(order.paid.caps ?? 0);

    const cancelled = await app.inject({
      method: 'POST',
      url: '/api/base/cancel',
      headers: { authorization: `Bearer ${token}` },
      payload: { orderId: order.id },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const after = cancelled.json<BuildStructureResponse>().base;
    expect(after.buildQueue).toEqual([]);
    expect(after.resources.caps).toBe(queued.resources.caps + Math.floor(spent * CANCEL_REFUND));

    const again = await app.inject({
      method: 'POST',
      url: '/api/base/cancel',
      headers: { authorization: `Bearer ${token}` },
      payload: { orderId: order.id },
    });
    expect(again.statusCode).toBe(404);
  });

  /*
   * An order in front of another of the same structure cannot go while that one stays: the later
   * order was priced as the level after it, and landing it without it jumped a level for a tenth
   * of the skipped one's price (bug pass, 2026-09-27).
   */
  it('refuses to cancel an order another is built on, and takes the later one first', async () => {
    const { app, token, baseId } = await player();
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateResources(baseId, {
      caps: 900_000,
      supplies: 900_000,
      oil: 900_000,
      scrap: 900_000,
      highQualityMetal: 90_000,
      planks: 900_000,
    });
    app.repos.bases.updateBuildings(
      baseId,
      base.buildings.map((building) =>
        building.kind === 'nexus' ? { ...building, level: 10 } : building,
      ),
    );
    const build = () =>
      app.inject({
        method: 'POST',
        url: '/api/base/build',
        headers: { authorization: `Bearer ${token}` },
        payload: { kind: 'generator' },
      });
    expect((await build()).statusCode).toBe(200);
    const second = await build();
    expect(second.statusCode, second.body.slice(0, 200)).toBe(200);
    const [first, next] = second.json<BuildStructureResponse>().base.buildQueue;
    // The stockpile is far over the stores so two generators can be paid for; what comes back
    // from a cancel is thrown away, and that is agreed to up front because it is not the point.
    const cancel = (orderId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/base/cancel',
        headers: { authorization: `Bearer ${token}` },
        payload: { orderId, acceptWaste: RICH_ON_PURPOSE },
      });

    const refused = await cancel(first!.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('built on it');
    expect((await cancel(next!.id)).statusCode).toBe(200);
    expect((await cancel(first!.id)).statusCode).toBe(200);
  });
});
