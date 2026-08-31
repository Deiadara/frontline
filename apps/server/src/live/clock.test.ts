import {
  MISC_AREA_ID,
  declarationWindow,
  findDistrict,
  findMissionTemplate,
  startingHolder,
  type BattleMutationResponse,
  type BattleTarget,
  type LiveEvent,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { launchMission } from '../missions/launch.js';
import { liveHub } from './hub.js';
import { WORLD_TICK_MS, startWorldClock, tickWorld } from './clock.js';

/**
 * The world clock: the promise that a fight happens on its mark.
 *
 * The whole file turns on one property, and it is asserted the only way it can honestly be
 * asserted: **not one HTTP request is made between declaring the fight and finding it resolved.**
 * Every other clock in this game settles on a read, so a test that resolved a battle and then read
 * a page to check would pass identically with the clock deleted. There is a test at the bottom that
 * does exactly that, deliberately, to show what the difference looks like.
 */

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** The location the looters are actually standing on, so the fight has somebody to have it with. */
const SQUATTED: string = (() => {
  const district = findDistrict('rustyard');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Rustyard has nobody on it at all');
  return held.id;
})();

const PRESS: BattleTarget = { kind: 'location', districtId: 'rustyard', locationId: SQUATTED };

async function makeStack(username: string): Promise<Stack> {
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
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  // Scouting is a journey now (`scouting/scouting.ts`), so the button no longer opens
  // ground: it sends somebody who walks back hours later. A fixture wants the *state*,
  // not the trip, so the intel is written directly.
  app.repos.city.markScouted(baseId, 'rustyard', new Date().toISOString());
  return { app, db, token, baseId };
}

/**
 * Declares a fight, sends bodies to it, and moves both clocks into the past.
 *
 * Both, and this is the part a fixture gets wrong: sending units starts a *column*, so winding only
 * the battle's mark back resolves a fight nobody walked to. Unlike the fixture in `battle.test.ts`
 * this one does **not** settle the movement itself: landing the column is the tick's own first job,
 * and a fixture that did it first would leave the tick's ordering untested. Doing it here is only
 * half of that, though. The order is caught by asserting on `committed` in the first test, because
 * a fight settled in the wrong order still resolves, and still reports one.
 */
async function readyFight(stack: Stack): Promise<{ battleId: string; mark: Date }> {
  const declared = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: { target: PRESS, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;
  await stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.token),
    payload: { battleId: battle.id, changes: { razors: 4 }, perimeterChanges: {} },
  });

  const mark = new Date(Date.now() - 60_000);
  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(mark.toISOString(), battle.id);
  stack.db
    .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
    .run(new Date(mark.getTime() - 60_000).toISOString(), mark.toISOString(), battle.id);
  return { battleId: battle.id, mark };
}

describe('a fight lands on its mark', () => {
  it('resolves with nobody reading a single page', async () => {
    const stack = await makeStack('unwatched');
    const { battleId } = await readyFight(stack);

    // The state the old server would have sat in indefinitely: the mark is a minute gone and the
    // fight has not happened, because a fight only happened when somebody loaded something.
    expect(stack.app.repos.sieges.find(battleId)!.resolvedAt).toBeNull();

    const resolved = tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date());

    expect(resolved).toBe(1);
    expect(stack.app.repos.sieges.find(battleId)!.resolvedAt).not.toBeNull();

    /*
     * And the four bodies that were walking to it were *in* it.
     *
     * This is the assertion that makes the tick's ordering real rather than asserted in a comment.
     * `resolvedAt` alone cannot see it: a fight settled before its column lands still resolves, and
     * still counts as one, it is simply a fight the attacker turned up to with nobody. `committed`
     * is what tells the two apart, and swapping the two settles in `tickWorld` turns this to 0.
     */
    const [report] = stack.app.repos.sieges.resolvedFor(stack.baseId, 5);
    expect(report?.analysis.attacker.committed).toBe(4);
  });

  /**
   * The positive control for the test above.
   *
   * Without the tick the row stays unresolved for as long as nothing is read, which is the bug the
   * clock exists to fix. If this ever goes red, the test above has stopped proving anything: it
   * would mean something else in the fixture is settling the fight.
   */
  it('does not resolve on its own without one', async () => {
    const stack = await makeStack('control');
    const { battleId } = await readyFight(stack);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stack.app.repos.sieges.find(battleId)!.resolvedAt).toBeNull();
  });

  /** Idempotent, because the read paths still settle too and both will race on a busy server. */
  it('runs a fight once however many ticks pass over it', async () => {
    const stack = await makeStack('once');
    await readyFight(stack);

    expect(tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date())).toBe(1);
    expect(tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date())).toBe(0);
    expect(tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date())).toBe(0);
  });

  it('leaves a fight whose mark is still ahead alone', async () => {
    const stack = await makeStack('early');
    const declared = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(stack.token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    const battle = declared.json<BattleMutationResponse>().battles.coming[0]!.battle;

    expect(tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date())).toBe(0);
    expect(stack.app.repos.sieges.find(battle.id)!.resolvedAt).toBeNull();
  });
});

describe('the receipt reaches an open tab', () => {
  /**
   * The end of the whole feature, in one test: a fight settles from the tick, and a player who is
   * connected and has not asked for anything hears about it.
   *
   * Subscribed to the process-wide hub rather than a local one, because that is the instance
   * `notify` publishes through, and the point is that the wiring between the two is real.
   */
  it('publishes to a connected player when the tick settles their fight', async () => {
    const stack = await makeStack('watcher');
    const ownerId = stack.app.repos.bases.findById(stack.baseId)!.ownerId;
    const heard: LiveEvent[] = [];
    const leave = liveHub.subscribe(ownerId, (event) => heard.push(event));

    try {
      await readyFight(stack);
      tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date());
    } finally {
      leave();
    }

    // Every receipt rings the bell; a fight also redraws the board.
    expect(heard.map((event) => event.kind)).toContain('notification');
    expect(heard.map((event) => event.kind)).toContain('battle');
    expect(heard.every((event) => !Number.isNaN(Date.parse(event.at)))).toBe(true);
  });

  /** Nobody else's tab lights up for a fight they had no part in. */
  it('says nothing to a player who was not in it', async () => {
    const stack = await makeStack('quiet');
    const listener = vi.fn();
    const leave = liveHub.subscribe('somebody-else-entirely', listener);

    try {
      await readyFight(stack);
      tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date());
    } finally {
      leave();
    }

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('the timer around it', () => {
  it('ticks until it is stopped, and not after', async () => {
    const stack = await makeStack('timed');
    const settled: number[] = [];
    const stop = startWorldClock({
      repos: stack.app.repos,
      engine: stack.app.skirmishEngine,
      intervalMs: 5,
      onSettled: (count) => settled.push(count),
    });

    await readyFight(stack);
    await vi.waitFor(() => expect(settled).toEqual([1]), { timeout: 2_000 });
    stop();

    const after = settled.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled.length).toBe(after);
  });

  /**
   * A tick that throws must not stop every future fight in the world.
   *
   * The standing evidence for why this matters is the 500 `/api/battles` served for months off one
   * unreadable row: a single bad record is enough to take a whole system down if nothing catches it.
   */
  it('keeps running when a tick throws, and reports it', async () => {
    const stack = await makeStack('broken');
    const errors: unknown[] = [];
    const engine = {
      resolve: () => {
        throw new Error('engine exploded');
      },
    };
    const stop = startWorldClock({
      repos: stack.app.repos,
      engine,
      intervalMs: 5,
      onError: (error) => errors.push(error),
    });

    await readyFight(stack);
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(1), { timeout: 2_000 });
    stop();

    expect((errors[0] as Error).message).toBe('engine exploded');
  });

  it('advances once a second, which is the resolution a countdown is read at', () => {
    expect(WORLD_TICK_MS).toBe(1_000);
  });
});

/**
 * §E: a crew comes home whether or not anybody is on the Missions screen.
 *
 * A run is private and deterministic, so by the rule at the top of `clock.ts` it could have stayed
 * lazy. It does not, because of what finishing one *writes*: the report. Settled only on a read of
 * one screen, a job that ended at 21:04 rang its bell whenever the player next opened Missions.
 */
describe('a crew comes home on time', () => {
  /** Puts a finished run on the books without going near the launch route or waiting for a clock. */
  function sendOutAndWait(stack: Stack, minutesAgo: number): string {
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    const template = findMissionTemplate('scrap-run')!;
    const stored = launchMission({
      id: `run-${minutesAgo}`,
      base,
      template,
      areaId: MISC_AREA_ID,
      force: { razors: 1 },
      now: new Date(Date.now() - minutesAgo * 60_000),
    });
    stack.app.repos.missions.insert(stored);
    return stored.mission.id;
  }

  it('settles a finished run with nobody on the missions screen', async () => {
    const stack = await makeStack('homecoming');
    const ownerId = stack.app.repos.bases.findById(stack.baseId)!.ownerId;
    const runId = sendOutAndWait(stack, 240);

    expect(stack.app.repos.missions.findById(runId)!.mission.status).toBe('active');

    tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date());

    expect(stack.app.repos.missions.findById(runId)!.mission.status).toBe('resolved');
    // And the receipt exists, which is the half that makes this worth doing at all.
    const bell = stack.app.repos.social.notifications(ownerId, 50);
    expect(bell.some((entry) => entry.kind === 'mission_home')).toBe(true);
  });

  /** The positive control: without a tick it stays out, which is the behaviour this replaced. */
  it('is still out if nothing advances the world', async () => {
    const stack = await makeStack('stillout');
    const runId = sendOutAndWait(stack, 240);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stack.app.repos.missions.findById(runId)!.mission.status).toBe('active');
  });

  it('leaves a crew that is still on the road alone', async () => {
    const stack = await makeStack('enroute');
    const runId = sendOutAndWait(stack, 0);

    tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date());

    expect(stack.app.repos.missions.findById(runId)!.mission.status).toBe('active');
  });

  it('tells a connected player the moment their crew is back', async () => {
    const stack = await makeStack('watched');
    const ownerId = stack.app.repos.bases.findById(stack.baseId)!.ownerId;
    const heard: LiveEvent[] = [];
    const leave = liveHub.subscribe(ownerId, (event) => heard.push(event));

    try {
      sendOutAndWait(stack, 240);
      tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date());
    } finally {
      leave();
    }

    expect(heard.map((event) => event.kind)).toContain('notification');
    expect(heard.map((event) => event.kind)).toContain('base');
  });
});
