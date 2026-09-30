import {
  DECLARE_INFAMY_COST,
  RESOURCE_KEYS,
  declarationWindow,
  missionCompletesAt,
  missionTimings,
  type BarResponse,
  type LaunchMissionResponse,
  type MarketResponse,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { tickWorld } from '../live/clock.js';
import { chooseOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';
import { reportTickFailuresTo, type TickFailure } from '../world/guard.js';

/**
 * The online half of the game, played by several crews at once (robustness pass, 2026-09-25).
 *
 * Every other suite drives one crew through one rule. This one puts several on the same server,
 * has them press the same buttons at the same moment, and runs the world clock between their
 * turns, which is how the game is actually played. After every step it checks the things that
 * must never happen whatever the players did:
 *
 * - no answer is a server fault (5xx), however the requests interleave;
 * - no number a crew owns goes negative or fractional (resources, units, machines, inventory);
 * - no stage or row of the world tick fails;
 * - a contested thing (one market offer, one Bar seat) is won exactly once.
 *
 * The clock is faked (only `Date`), so a run's timings are exact and the edges of every window can
 * be stood on to the millisecond.
 */

interface Player {
  name: string;
  token: string;
  baseId: string;
}

interface World {
  app: FastifyInstance;
  db: AppDatabase;
  players: Player[];
  /** Every answer the server gave, so a fault anywhere in a scenario is caught at the end. */
  faults: string[];
  failures: TickFailure[];
}

const worlds: { app: FastifyInstance; db: AppDatabase; restore: () => void }[] = [];
let clock = Date.parse('2026-09-25T09:00:00.000Z');

afterEach(async () => {
  for (const one of worlds.splice(0)) {
    one.restore();
    await one.app.close();
    one.db.close();
  }
  vi.useRealTimers();
});

function setClock(at: number): void {
  clock = at;
  vi.setSystemTime(clock);
}
const advance = (ms: number): void => setClock(clock + ms);

async function world(count: number, options: { level?: number } = {}): Promise<World> {
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock(clock);
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'sim-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  const failures: TickFailure[] = [];
  const restore = reportTickFailuresTo((failure) => failures.push(failure));
  worlds.push({ app, db, restore });

  const players: Player[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = `crew${i}`;
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: name, password: 'hunter2pass' },
      // One address each: the sign-up limit is per address, and these are different people.
      remoteAddress: `10.0.0.${i + 1}`,
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    openDoors(app, token, 'market', 'offers', 'bar', 'training', 'crew');
    const baseId = chosen.json<{ base: { id: string } }>().base.id;
    // Enough of everything that a request is refused for what it asks rather than for being poor.
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateResources(baseId, {
      ...base.resources,
      caps: 5_000,
      supplies: 2_000,
      oil: 2_000,
      scrap: 2_000,
    });
    app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: DECLARE_INFAMY_COST * 20 });
    app.repos.bases.updateArmy(baseId, { ...base.army, razors: 40 }, base.trainingQueue);
    // Past the opening ramp when a test needs real road: a new crew's first jobs run on a
    // compressed clock (`earlyMissionRamp`), which can round a short walk down to nothing.
    if (options.level !== undefined) {
      app.repos.bases.updateProgression(baseId, options.level, base.progression);
    }
    players.push({ name, token, baseId });
  }
  return { app, db, players, faults: [], failures };
}

/** One request as a player, noting any server fault. */
async function as(
  w: World,
  player: Player | null,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  const options: InjectOptions = {
    method,
    url,
    headers: player ? { authorization: `Bearer ${player.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  };
  const res = await w.app.inject(options);
  if (res.statusCode >= 500 && res.statusCode !== 503) {
    w.faults.push(
      `${player?.name ?? 'anon'} ${method} ${url} -> ${res.statusCode} ${res.body.slice(0, 300)}`,
    );
  }
  return res;
}

function tick(w: World): void {
  tickWorld(w.app.repos, w.app.skirmishEngine, new Date(clock));
}

/** The invariants that hold whatever anybody did. */
function assertSound(w: World): void {
  expect(w.faults, w.faults.join('\n')).toEqual([]);
  expect(w.failures.map((one) => `${one.stage} ${one.item ?? ''} ${String(one.error)}`)).toEqual(
    [],
  );
  for (const player of w.players) {
    const base = w.app.repos.bases.findById(player.baseId)!;
    const counts: [string, number][] = [
      ...RESOURCE_KEYS.map((key): [string, number] => [`resource ${key}`, base.resources[key]]),
      ...Object.entries(base.army).map(([id, n]): [string, number] => [`army ${id}`, n ?? 0]),
      ...Object.entries(base.fleet).map(([id, n]): [string, number] => [`fleet ${id}`, n ?? 0]),
      ...Object.entries(base.inventory).map(([id, n]): [string, number] => [`item ${id}`, n ?? 0]),
    ];
    for (const [what, n] of counts) {
      expect(Number.isInteger(n) && n >= 0, `${player.name}: ${what} is ${n}`).toBe(true);
    }
  }
}

async function board(w: World, player: Player): Promise<MissionsResponse> {
  const res = await as(w, player, 'GET', '/api/missions');
  expect(res.statusCode, res.body).toBe(200);
  return res.json<MissionsResponse>();
}

/**
 * A plain job on a free board, and who can lead it, or null when there is none.
 *
 * `onTheRoad` asks for one with a walk in it. A job with no travel has no road home, so a crew
 * called off it is back the moment the order is given, which is right and tests nothing about
 * the walk back.
 */
async function plainJob(w: World, player: Player, onTheRoad = false) {
  const read = await board(w, player);
  for (const area of read.areas) {
    if (area.activeMissionId !== null) continue;
    const offer = area.offers.find(
      (one) => one.kind === 'standard' && (!onTheRoad || one.travelMinutes > 0),
    );
    const leader = read.leaders[0];
    if (offer && leader)
      return {
        areaId: area.id,
        templateId: offer.templateId,
        boardKey: offer.boardKey,
        grade: offer.grade,
        leaderId: leader.id,
      };
  }
  return null;
}

async function launch(w: World, player: Player, razors: number, onTheRoad = false) {
  const job = await plainJob(w, player, onTheRoad);
  if (!job) return null;
  return as(w, player, 'POST', '/api/missions', { ...job, force: { razors } });
}

const razorsAt = (w: World, player: Player): number =>
  w.app.repos.bases.findById(player.baseId)!.army['razors'] ?? 0;

describe('calling a run off, to the millisecond', () => {
  it('recalls inside the tenth, refuses on its edge, and brings the crew home on time', async () => {
    const w = await world(2, { level: 12 });
    const [me, them] = w.players as [Player, Player];
    const before = razorsAt(w, me);

    const sent = await launch(w, me, 3, true);
    expect(sent?.statusCode, sent?.body).toBe(200);
    const mission = sent!.json<LaunchMissionResponse>().mission;
    expect(mission.travelMinutes).toBeGreaterThan(0);
    expect(razorsAt(w, me)).toBe(before - 3);

    // The window is a tenth of the run's whole clock, measured from when it set out.
    const totalMs = missionTimings(mission).totalMinutes * 60_000;
    const edge = Date.parse(mission.startedAt) + totalMs * 0.1;

    // Somebody else's crew is not theirs to call back.
    setClock(edge - 1);
    const stranger = await as(w, them, 'POST', '/api/missions/recall', { missionId: mission.id });
    expect(stranger.statusCode).toBe(404);

    const recalled = await as(w, me, 'POST', '/api/missions/recall', { missionId: mission.id });
    expect(recalled.statusCode, recalled.body).toBe(200);
    // Twice is once.
    const again = await as(w, me, 'POST', '/api/missions/recall', { missionId: mission.id });
    expect(again.statusCode).toBe(409);

    const turned = w.app.repos.missions.findById(mission.id)!.mission;
    expect(turned.recalledAt).not.toBeNull();
    const home = missionCompletesAt(turned).getTime();
    // As far back as they had come: never longer than the time they had been out.
    expect(home - Date.parse(turned.recalledAt!)).toBeLessThanOrEqual(
      Date.parse(turned.recalledAt!) - Date.parse(turned.startedAt) + 1,
    );

    // Not a moment before they walk in...
    setClock(home - 1_000);
    tick(w);
    expect(w.app.repos.missions.findById(mission.id)!.mission.status).toBe('active');
    expect(razorsAt(w, me)).toBe(before - 3);
    // ...and every one of them the moment they do, with nothing paid for a job not done.
    setClock(home);
    tick(w);
    const landed = w.app.repos.missions.findById(mission.id)!.mission;
    expect(landed.status).toBe('resolved');
    expect(razorsAt(w, me)).toBe(before);

    // A second run, called at the exact edge of its window: too late, by the rule's strict `<`.
    const second = await launch(w, me, 2);
    expect(second?.statusCode, second?.body).toBe(200);
    const run = second!.json<LaunchMissionResponse>().mission;
    const runEdge = Date.parse(run.startedAt) + missionTimings(run).totalMinutes * 60_000 * 0.1;
    setClock(runEdge);
    const late = await as(w, me, 'POST', '/api/missions/recall', { missionId: run.id });
    expect(late.statusCode).toBe(409);

    assertSound(w);
  });

  it('pays a run that finishes on time and never pays it twice, however often it is read', async () => {
    const w = await world(1);
    const [me] = w.players as [Player];
    const sent = await launch(w, me, 4);
    expect(sent?.statusCode, sent?.body).toBe(200);
    const mission = sent!.json<LaunchMissionResponse>().mission;
    setClock(missionCompletesAt(mission).getTime());

    // The clock and three reads, all at once: the run is settled by whichever is first, once.
    await Promise.all([
      Promise.resolve().then(() => tick(w)),
      as(w, me, 'GET', '/api/missions'),
      as(w, me, 'GET', '/api/me'),
      as(w, me, 'GET', '/api/missions'),
    ]);
    const settled = w.app.repos.missions.findById(mission.id)!.mission;
    expect(settled.status).toBe('resolved');
    const paidOnce = w.app.repos.bases.findById(me.baseId)!.resources;
    tick(w);
    await as(w, me, 'GET', '/api/missions');
    expect(w.app.repos.bases.findById(me.baseId)!.resources).toEqual(paidOnce);
    assertSound(w);
  });
});

describe('crews pressing the same button at the same moment', () => {
  it('never puts more crews out than the ceiling, however many launches arrive at once', async () => {
    const w = await world(1);
    const [me] = w.players as [Player];
    const before = razorsAt(w, me);
    const read = await board(w, me);
    const jobs = read.areas.flatMap((area) =>
      area.offers
        .filter((offer) => offer.kind === 'standard')
        .slice(0, 1)
        .map((offer) => ({
          areaId: area.id,
          templateId: offer.templateId,
          boardKey: offer.boardKey,
          grade: offer.grade,
        })),
    );
    const leaderId = read.leaders[0]!.id;
    const answers = await Promise.all(
      [...jobs, ...jobs].map((job) =>
        as(w, me, 'POST', '/api/missions', { ...job, leaderId, force: { razors: 2 } }),
      ),
    );
    const sent = answers.filter((one) => one.statusCode === 200).length;
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThanOrEqual(read.activeLimit);
    expect(w.app.repos.missions.countActiveByBaseId(me.baseId)).toBe(sent);
    expect(razorsAt(w, me)).toBe(before - 2 * sent);
    assertSound(w);
  });

  it('gives one market offer to exactly one of the crews that take it together', async () => {
    const w = await world(4);
    const [seller, ...buyers] = w.players as [Player, ...Player[]];
    // Room for what the listing asks: the world stands every crew over its stores, and supplies
    // arriving on a full shelf are thrown away (maintainer ruling, 2026-09-28), which is not the
    // race this measures.
    const held = w.app.repos.bases.findById(seller.baseId)!;
    w.app.repos.bases.updateResources(held.id, { ...held.resources, supplies: 0 });
    const total = (key: 'caps' | 'supplies') =>
      w.players.reduce((sum, p) => sum + w.app.repos.bases.findById(p.baseId)!.resources[key], 0);
    const caps = total('caps');
    const supplies = total('supplies');

    const posted = await as(w, seller, 'POST', '/api/market/offer', {
      give: { resources: { caps: 100 }, items: {} },
      want: { resources: { supplies: 10 }, items: {} },
    });
    expect(posted.statusCode, posted.body).toBe(200);
    const market = posted.json<{ market: MarketResponse }>().market;
    const offerId = market.mine[0]!.id;

    const answers = await Promise.all(
      buyers.map((buyer) => as(w, buyer, 'POST', '/api/market/accept', { offerId })),
    );
    expect(answers.filter((one) => one.statusCode === 200)).toHaveLength(1);
    expect(
      answers.filter((one) => one.statusCode !== 200).every((one) => one.statusCode < 500),
    ).toBe(true);
    // The seller's side waits on the board until claimed (maintainer, 2026-09-28), and one claim.
    const board = (await as(w, seller, 'GET', '/api/market')).json<MarketResponse>();
    expect(board.claims).toHaveLength(1);
    const claimed = await as(w, seller, 'POST', '/api/market/claim', {
      claimId: board.claims[0]!.id,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    // Nothing was made or lost in the trade, only moved.
    expect(total('caps')).toBe(caps);
    expect(total('supplies')).toBe(supplies);
    assertSound(w);
  });

  it('seats one crew at a Bar table that six bid on at once, and charges nobody else', async () => {
    const w = await world(6);
    const bar = (await as(w, w.players[0]!, 'GET', '/api/bar')).json<BarResponse>();
    const recruit = bar.recruits[0]!;
    const capsOf = (p: Player) => w.app.repos.bases.findById(p.baseId)!.resources.caps;
    const before = new Map(w.players.map((p) => [p.name, capsOf(p)]));

    const bids = await Promise.all(
      w.players.flatMap((p, i) => [
        as(w, p, 'POST', '/api/bar/bid', { recruitId: recruit.id, amount: 100 + i * 10 }),
        as(w, p, 'POST', '/api/bar/bid', { recruitId: recruit.id, amount: 200 + i * 10 }),
      ]),
    );
    expect(bids.every((one) => one.statusCode < 500)).toBe(true);

    // Past the table's close, and the clock settles it.
    setClock(Date.parse(`${bar.day}T00:00:00.000Z`) + 2 * 86_400_000);
    tick(w);
    const winners = w.players.filter((p) => capsOf(p) < before.get(p.name)!);
    expect(winners.length).toBeLessThanOrEqual(1);
    for (const p of w.players) {
      if (!winners.includes(p))
        expect(capsOf(p), `${p.name} was charged for a seat`).toBe(before.get(p.name));
    }
    assertSound(w);
  });

  it('keeps every crew whole when several call a fight on the same ground at once', async () => {
    const w = await world(4);
    const target = { kind: 'location', districtId: 'steelbelt', locationId: '' };
    const place = w.app.repos.city.controls();
    const location = [...place.values()].find((one) => one.locationId.startsWith('steelbelt'));
    target.locationId = location?.locationId ?? 'steelbelt-0';
    const scheduledFor = declarationWindow(new Date(clock)).earliest.toISOString();

    const called = await Promise.all(
      w.players.map((p) => as(w, p, 'POST', '/api/battles/declare', { target, scheduledFor })),
    );
    expect(called.every((one) => one.statusCode < 500)).toBe(true);
    // To the mark and past it: whatever was declared is fought, and nobody is left negative.
    setClock(Date.parse(scheduledFor) + 60_000);
    tick(w);
    for (const p of w.players)
      expect(w.app.repos.bases.findById(p.baseId)!.economy.infamy).toBeGreaterThanOrEqual(0);
    assertSound(w);
  });
});

/**
 * One crew's unreadable row is that crew's problem and nobody else's.
 *
 * A row can go bad: a hand-edited save, a migration that missed a shape, a disk. What must not
 * follow is every other player's screens failing with it, or the world clock stopping. The broken
 * crew's own screens may answer 500, which is the truth about their data; everybody else's answer.
 */
describe('a corrupt row', () => {
  it('breaks no screen but its owner’s, and stops no tick', async () => {
    const w = await world(3);
    const [broken, other, third] = w.players as [Player, Player, Player];
    // Both have a run on the road, so the clock has something of each to settle.
    expect((await launch(w, broken, 2))?.statusCode).toBe(200);
    expect((await launch(w, other, 2))?.statusCode).toBe(200);
    w.db.prepare('UPDATE bases SET army_json = ? WHERE id = ?').run('{"razors":', broken.baseId);

    for (const url of [
      '/api/me',
      '/api/city',
      '/api/battles',
      '/api/market',
      '/api/bar',
      '/api/missions',
      '/api/units',
      '/api/leaderboard',
      '/api/factions',
      '/api/messages',
      '/api/notifications',
    ]) {
      for (const p of [other, third]) {
        const res = await w.app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${p.token}` },
        });
        // 200 and not merely under 500: a path that does not exist answers 404 and proves nothing.
        expect(res.statusCode, `${p.name} GET ${url}: ${res.body.slice(0, 200)}`).toBe(200);
      }
    }

    // The clock goes past both runs: the healthy crew comes home, the broken one is reported.
    setClock(clock + 24 * 3_600_000);
    tick(w);
    expect(w.app.repos.missions.listActiveByBaseId(other.baseId)).toHaveLength(0);
    expect(w.failures.length).toBeGreaterThan(0);
    expect(w.failures.every((one) => one.item === broken.baseId || one.item === undefined)).toBe(
      true,
    );
  });
});

/**
 * A few hundred turns of several crews doing whatever they like, with the world clock between.
 * Seeded, so a failure replays.
 */
describe('a busy evening', () => {
  it('holds every invariant through three hundred turns of six crews', async () => {
    const w = await world(6);
    let state = 7;
    const rand = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const one = <T>(from: readonly T[]): T => from[Math.floor(rand() * from.length)]!;
    const offerIds: string[] = [];

    const turn = async (p: Player): Promise<void> => {
      const roll = rand();
      if (roll < 0.25) {
        await launch(w, p, 1 + Math.floor(rand() * 4));
      } else if (roll < 0.4) {
        const active = w.app.repos.missions.listActiveByBaseId(p.baseId);
        if (active.length > 0) {
          await as(w, p, 'POST', '/api/missions/recall', { missionId: one(active).mission.id });
        }
      } else if (roll < 0.5) {
        await as(w, p, 'POST', '/api/units/train', {
          unitId: 'razors',
          count: 1 + Math.floor(rand() * 3),
        });
      } else if (roll < 0.6) {
        const posted = await as(w, p, 'POST', '/api/market/offer', {
          give: { resources: { caps: 10 + Math.floor(rand() * 50) }, items: {} },
          want: { resources: { supplies: 1 + Math.floor(rand() * 10) }, items: {} },
        });
        if (posted.statusCode === 200) {
          const mine = posted.json<{ market: MarketResponse }>().market.mine;
          offerIds.push(...mine.map((offer) => offer.id));
        }
      } else if (roll < 0.7 && offerIds.length > 0) {
        await as(w, p, 'POST', '/api/market/accept', { offerId: one(offerIds) });
      } else if (roll < 0.75 && offerIds.length > 0) {
        await as(w, p, 'POST', '/api/market/withdraw', { offerId: one(offerIds) });
      } else if (roll < 0.85) {
        const bar = await as(w, p, 'GET', '/api/bar');
        const recruits = bar.statusCode === 200 ? bar.json<BarResponse>().recruits : [];
        if (recruits.length > 0) {
          await as(w, p, 'POST', '/api/bar/bid', {
            recruitId: one(recruits).id,
            amount: 50 + Math.floor(rand() * 400),
          });
        }
      } else {
        await as(
          w,
          p,
          'GET',
          one([
            '/api/me',
            '/api/missions',
            '/api/market',
            '/api/battles',
            '/api/city',
            '/api/units',
          ]),
        );
      }
    };

    for (let round = 0; round < 300; round += 1) {
      await Promise.all(w.players.map((p) => turn(p)));
      advance((1 + Math.floor(rand() * 20)) * 60_000);
      tick(w);
      assertSound(w);
    }
    // And the missions that went out all came home or are still honestly on the road.
    for (const p of w.players) {
      for (const run of w.app.repos.missions.listByBaseId(p.baseId).map((entry) => entry.mission)) {
        if (run.status === 'active')
          expect(missionCompletesAt(run).getTime()).toBeGreaterThan(clock - 1);
      }
    }
  }, 300_000);
});
