import {
  MISC_AREA_ID,
  featMeasureKey,
  findMissionTemplate,
  type Base,
  type MissionTemplate,
} from '@frontline/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { resolveDueMissions } from '../missions/resolve.js';
import { launchMission } from '../missions/launch.js';
import { areasOffering, missionBoardDay } from '@frontline/shared';
import { settleDistrict } from '../district/settle.js';
import { acceptOffer, postOffer } from '../market/board.js';
import {
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
} from '@frontline/shared';

/**
 * The counters, driven by the game rather than by hand (maintainer request, 2026-09-13).
 *
 * `db/repos/feats.test.ts` proves the table adds up. The route tests prove a claim pays. Neither
 * of them proves the thing in between, which is that **playing** moves the numbers: every tally is
 * a call at an event site, and a hook on the wrong side of an early return is a feat that never
 * finishes for anybody while every other test in the tree stays green.
 *
 * So these run the real settle paths and read the counters afterwards.
 */

let db: AppDatabase;
let repos: Repositories;

const T0 = new Date('2026-09-13T12:00:00.000Z');
const OWNER = 'owner-1';

function makeBase(over: Partial<Base> = {}): Base {
  const now = T0.toISOString();
  return {
    id: 'base-1',
    ownerId: OWNER,
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 4,
    isBot: false,
    resources: {
      caps: 50_000,
      supplies: 50_000,
      oil: 50_000,
      scrap: 50_000,
      planks: 50_000,
      highQualityMetal: 5_000,
    },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'b-nexus', kind: 'nexus', level: 5, modifications: [], damage: 0 }],
    buildQueue: [],
    army: { haulers: 400 },
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
    ...over,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'one', 'x', ?)`,
  ).run(OWNER, T0.toISOString());
  repos.bases.insert(makeBase());
});

const talliesNow = () => repos.feats.tallies('base-1');
const after = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe('a run coming home', () => {
  /** A short standard job that always lands, so the settle is about the counters and not the dice. */
  const scrapRun = findMissionTemplate('scrap-run') as MissionTemplate;

  function send(template: MissionTemplate, seed: number): void {
    const base = repos.bases.findById('base-1')!;
    repos.missions.insert(
      launchMission({
        id: `mission-${seed}`,
        base,
        template,
        areaId: areasOffering(template.id, missionBoardDay(T0))[0] ?? MISC_AREA_ID,
        force: { haulers: 40 },
        now: T0,
        seed,
        vehicles: {},
        unled: 'free',
      }),
    );
  }

  it('counts the job, where it was, and what kind it was', () => {
    send(scrapRun, 1);
    const base = repos.bases.findById('base-1')!;
    resolveDueMissions(repos, base, after(600));

    const tallies = talliesNow();
    expect(tallies[featMeasureKey('missions_done')]).toBe(1);
    expect(tallies[featMeasureKey('missions_of_kind', 'standard')]).toBe(1);
    // The area is whichever board offered it, read back off the row rather than assumed.
    const areaKey = Object.keys(tallies).find((key) => key.startsWith('missions_in_area:'));
    expect(areaKey).toBeDefined();
    expect(tallies[areaKey!]).toBe(1);
  });

  it('counts what actually came through the gate as earned', () => {
    send(scrapRun, 2);
    const base = repos.bases.findById('base-1')!;
    const { base: settled } = resolveDueMissions(repos, base, after(600));

    const tallies = talliesNow();
    const earnedScrap = tallies[featMeasureKey('resources_earned', 'scrap')] ?? 0;
    expect(earnedScrap).toBeGreaterThan(0);
    // What the lifetime counter banked is what the stockpile actually grew by, not what the
    // template quoted: a haul trimmed by what the crew could carry counts as what arrived.
    expect(settled.resources.scrap - 50_000).toBe(earnedScrap);
  });

  it('adds up across several runs rather than replacing', () => {
    for (const seed of [3, 4, 5]) send(scrapRun, seed);
    const base = repos.bases.findById('base-1')!;
    resolveDueMissions(repos, base, after(600));
    expect(talliesNow()[featMeasureKey('missions_done')]).toBe(3);
  });

  it('leaves the counters alone when nothing is due', () => {
    send(scrapRun, 6);
    const base = repos.bases.findById('base-1')!;
    // One minute in: the crew is still walking, so nothing has come home.
    resolveDueMissions(repos, base, after(1));
    expect(talliesNow()).toEqual({});
  });

  /**
   * A cancelled run is not a run, and this is the exploit if it is.
   *
   * Cancelling inside the window refunds ninety per cent of what was spent and costs only the
   * minutes already walked. If a recall counted, launch-and-cancel would be the fastest way to
   * finish every mission ladder in the catalogue, and the per-district ones would take minutes.
   */
  it('counts nothing for a crew that was turned round', () => {
    send(scrapRun, 8);
    repos.missions.markRecalled('mission-8', after(1).toISOString());
    const base = repos.bases.findById('base-1')!;
    resolveDueMissions(repos, base, after(600));

    const tallies = talliesNow();
    expect(tallies[featMeasureKey('missions_done')]).toBeUndefined();
    expect(tallies[featMeasureKey('missions_of_kind', 'standard')]).toBeUndefined();
    expect(Object.keys(tallies).some((key) => key.startsWith('missions_in_area:'))).toBe(false);
    // And nothing was earned either, because a recalled crew comes home with nothing.
    expect(Object.keys(tallies).some((key) => key.startsWith('resources_earned:'))).toBe(false);
  });

  /**
   * Settling twice must not count twice.
   *
   * Every settle path in this server is called on read and is safe to call again; a counter is the
   * one kind of state where a second call is silently wrong rather than loudly wrong, because
   * nothing about the crew looks different afterwards.
   */
  it('counts a run once however many times the settle runs', () => {
    send(scrapRun, 7);
    const base = repos.bases.findById('base-1')!;
    resolveDueMissions(repos, base, after(600));
    const once = talliesNow();

    for (let pass = 0; pass < 5; pass += 1) {
      resolveDueMissions(repos, repos.bases.findById('base-1')!, after(700));
    }
    expect(talliesNow()).toEqual(once);
  });
});

describe('a district producing', () => {
  it('counts what the buildings made as earned', () => {
    const base = repos.bases.findById('base-1')!;
    /*
     * An empty stockpile, because a full one produces nothing.
     *
     * Storage is `800` at the base and this crew has no Apothecary, so the fifty thousand it
     * starts with is far over every cap and an hour of production adds exactly zero. The first
     * version of this test measured that and read as a missing hook.
     */
    repos.bases.updateResources(base.id, {
      caps: 0,
      supplies: 0,
      oil: 0,
      scrap: 0,
      planks: 0,
      highQualityMetal: 0,
    });
    repos.bases.updateDistrict(
      base.id,
      [
        ...base.buildings,
        { id: 'b-green', kind: 'greenhouse', level: 4, modifications: [], damage: 0 },
        { id: 'b-yard', kind: 'scrapyard', level: 4, modifications: [], damage: 0 },
      ],
      base.buildQueue,
    );
    settleDistrict(repos, repos.bases.findById('base-1')!, after(60));

    const tallies = talliesNow();
    // Production is the biggest faucet in the game and the only one with no record of its own, so
    // a lifetime-earnings ladder is badly wrong without this hook.
    expect(tallies[featMeasureKey('resources_earned', 'supplies')]).toBeGreaterThan(0);
    expect(tallies[featMeasureKey('resources_earned', 'scrap')]).toBeGreaterThan(0);
    // And nothing farms caps, which is why the lifetime-caps ladder is fed by jobs and trades.
    expect(tallies[featMeasureKey('resources_earned', 'caps')]).toBeUndefined();
  });

  it('does not count a settle that moved nothing', () => {
    settleDistrict(repos, repos.bases.findById('base-1')!, after(60));
    // A Nexus produces nothing, so an hour of it is an hour of nothing.
    expect(talliesNow()[featMeasureKey('resources_earned', 'scrap')]).toBeUndefined();
  });
});

describe('trading', () => {
  /**
   * A deal is counted, what changed hands is not.
   *
   * Two accounts can pass one listing back and forth indefinitely at no net cost, so crediting
   * either side's lifetime earnings with what arrived would make the three million cap ladder,
   * which pays the largest reward in the catalogue, a matter of clicking. The deal counters stay,
   * because their feats are small and each pass costs the escrow round trip.
   */
  it('counts the deal without crediting either side with lifetime earnings', () => {
    const seller = repos.bases.findById('base-1')!;
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES ('owner-2', 'two', 'x', ?)`,
    ).run(T0.toISOString());
    repos.bases.insert(makeBase({ id: 'base-2', ownerId: 'owner-2', name: 'The Other Yard' }));

    const posted = postOffer(
      repos,
      seller,
      { resources: { scrap: 500 }, items: {} },
      { resources: { caps: 500 }, items: {} },
      undefined,
      T0,
    );
    expect(posted.kind, JSON.stringify(posted)).toBe('done');

    const offer = repos.market.openBySeller(seller.id)[0]!;
    const taken = acceptOffer(repos, repos.bases.findById('base-2')!, offer.id, after(1));
    expect(taken.kind, JSON.stringify(taken)).toBe('done');

    // Both sides are credited with the deal itself.
    expect(repos.feats.tallies('base-1')[featMeasureKey('market_sales')]).toBe(1);
    expect(repos.feats.tallies('base-2')[featMeasureKey('market_buys')]).toBe(1);
    // And neither with lifetime earnings, however much moved.
    for (const baseId of ['base-1', 'base-2']) {
      const tallies = repos.feats.tallies(baseId);
      expect(
        Object.keys(tallies).some((key) => key.startsWith('resources_earned:')),
        baseId,
      ).toBe(false);
    }
  });
});

describe('the counters under load', () => {
  /**
   * Two hundred bumps of the same key, which is what a busy evening looks like.
   *
   * The point is not the speed, it is that every one of them lands: `value = value + ?` in a
   * single statement, rather than a read and a write that can lose one another.
   */
  it('loses nothing when the same counter is moved over and over', () => {
    for (let press = 0; press < 200; press += 1) {
      repos.feats.bumpMany('base-1', [
        { tally: featMeasureKey('kills'), amount: 2 },
        { tally: featMeasureKey('missions_done'), amount: 1 },
      ]);
    }
    const tallies = talliesNow();
    expect(tallies[featMeasureKey('kills')]).toBe(400);
    expect(tallies[featMeasureKey('missions_done')]).toBe(200);
  });

  it('keeps two crews apart while both are being written', () => {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES ('owner-2', 'two', 'x', ?)`,
    ).run(T0.toISOString());
    repos.bases.insert(makeBase({ id: 'base-2', ownerId: 'owner-2', name: 'The Other Yard' }));

    // Interleaved on purpose, so a repo that leaked between crews would be visible.
    for (let press = 0; press < 50; press += 1) {
      repos.feats.bump('base-1', featMeasureKey('kills'), 1);
      repos.feats.bump('base-2', featMeasureKey('kills'), 3);
    }
    expect(repos.feats.tallies('base-1')[featMeasureKey('kills')]).toBe(50);
    expect(repos.feats.tallies('base-2')[featMeasureKey('kills')]).toBe(150);
  });
});
