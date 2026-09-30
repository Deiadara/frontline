import {
  MISC_AREA_ID,
  featMeasureKey,
  findMissionTemplate,
  storageCapacityFor,
  type Base,
  type MissionTemplate,
} from '@frontline/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { resolveDueMissions } from '../missions/resolve.js';
import { createRng } from '../characters/rng.js';
import { launchMission } from '../missions/launch.js';
import { areasOffering } from '@frontline/shared';
import { settleDistrict } from '../district/settle.js';
import { sureLeader } from '../testing/leader.js';
import { acceptOffer, postOffer } from '../market/board.js';
import { tallyBattleResolved, tallyBattleSide, tallyRailJourney } from './tally.js';
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
    buildings: [{ id: 'b-nexus', kind: 'nexus', level: 5, modifications: [] }],
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
        areaId: areasOffering(template.id, T0, base.level)[0] ?? MISC_AREA_ID,
        force: { haulers: 40 },
        now: T0,
        seed,
        vehicles: {},
        grade: template.grades[0],
        leader: sureLeader(),
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

  it('counts a landed long shot by the odds it went out with, and not a sure thing', () => {
    // Freeze two landed runs at launch odds either side of the line: the settle, not the test,
    // has to carry the chance through to the tally.
    const landsAt = (chance: number) => {
      let seed = 1;
      while (createRng(seed)() >= chance) seed += 1;
      return seed;
    };
    const base = repos.bases.findById('base-1')!;
    for (const [id, chance] of [
      ['long', 0.2],
      ['sure', 0.9],
    ] as const) {
      const seed = landsAt(chance);
      const launched = launchMission({
        id: `mission-${id}`,
        base,
        template: scrapRun,
        areaId: areasOffering(scrapRun.id, T0, base.level)[0] ?? MISC_AREA_ID,
        force: { haulers: 40 },
        now: T0,
        seed,
        vehicles: {},
        grade: scrapRun.grades[0],
        leader: sureLeader(),
      });
      repos.missions.insert({ ...launched, successChance: chance });
    }
    resolveDueMissions(repos, base, after(600));

    expect(talliesNow()[featMeasureKey('missions_done')]).toBe(2);
    expect(talliesNow()[featMeasureKey('jobs_won_long_odds')]).toBe(1);
  });

  it('counts what actually came through the gate as earned', () => {
    // An empty yard, so the whole haul has room: the case below is the one where it does not.
    const empty = repos.bases.findById('base-1')!;
    repos.bases.updateResources(empty.id, { ...empty.resources, scrap: 0 });
    send(scrapRun, 2);
    const base = repos.bases.findById('base-1')!;
    const { base: settled } = resolveDueMissions(repos, base, after(600));

    const tallies = talliesNow();
    const earnedScrap = tallies[featMeasureKey('resources_earned', 'scrap')] ?? 0;
    expect(earnedScrap).toBeGreaterThan(0);
    // What the lifetime counter banked is what the stockpile actually grew by, not what the
    // template quoted: a haul trimmed by what the crew could carry counts as what arrived.
    expect(settled.resources.scrap).toBe(earnedScrap);
  });

  /**
   * Full stores keep what does not fit out of the counter too (maintainer ruling, 2026-09-28).
   *
   * The haul is clamped to the ceiling at the gate and the excess is thrown away, so a crew
   * sitting on a nearly full yard earns only the room it had: `resources_earned` counts what
   * landed, and the run's row keeps what did not.
   */
  it('counts only what the stores had room for, and records the rest on the run', () => {
    const nearlyFull = repos.bases.findById('base-1')!;
    const ceiling = storageCapacityFor(nearlyFull.buildings, 'scrap');
    repos.bases.updateResources(nearlyFull.id, { ...nearlyFull.resources, scrap: ceiling - 10 });
    send(scrapRun, 2);
    const base = repos.bases.findById('base-1')!;
    const { base: settled, resolved } = resolveDueMissions(repos, base, after(600));

    const carried = resolved[0]?.rewards.scrap ?? 0;
    // A guard on the guard: the run has to carry more than the room for this to mean anything.
    expect(carried).toBeGreaterThan(10);
    expect(settled.resources.scrap).toBe(ceiling);
    expect(talliesNow()[featMeasureKey('resources_earned', 'scrap')]).toBe(10);
    expect(resolved[0]?.wasted?.scrap).toBe(carried - 10);
    // And the report reads it back off the row.
    expect(repos.missions.findById('mission-2')?.mission.wasted?.scrap).toBe(carried - 10);
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
        { id: 'b-green', kind: 'greenhouse', level: 4, modifications: [] },
        { id: 'b-yard', kind: 'scrapyard', level: 4, modifications: [] },
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
   * held to a floor and to one deal a day per pair of crews (`tallyMarketDeal`).
   */
  it('counts the deal without crediting either side with lifetime earnings', () => {
    const seller = repos.bases.findById('base-1')!;
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES ('owner-2', 'two', 'x', ?)`,
    ).run(T0.toISOString());
    // An empty yard on the taking side, so the 500 scrap is a trade and not a warning.
    const other = makeBase({ id: 'base-2', ownerId: 'owner-2', name: 'The Other Yard' });
    repos.bases.insert({ ...other, resources: { ...other.resources, scrap: 0 } });

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

/**
 * The frontier counters (2026-09-24), driven by hand rather than by a settle.
 *
 * Every other block in this file runs the real path, which is the right way round and is not
 * available here: neither of these has a call site yet. `battles_won_abroad` waits on one line at
 * the settle in `battle/resolve.ts` and `rail_journeys` on the mover taking the railway offer, and
 * both are being written by somebody else. What can be proved now is the half that lives in this
 * file, which is also the half most likely to be wrong: whether a fight was abroad is decided
 * here, off the crew's own district, and getting that backwards is invisible from the call site.
 *
 * Both directions are pinned. A rule that only ever says "yes" passes a test that only ever asks
 * for a yes, and "is this city not my city" is exactly the sort of comparison that reads the same
 * either way round.
 */
describe('fighting away from home', () => {
  const abroad = () => talliesNow()[featMeasureKey('battles_won_abroad')];

  it('counts a win in another city and not one at home', () => {
    // The crew lives in Kettle Row, which is Ashfall.
    tallyBattleResolved(repos, 'base-1', {
      attacked: true,
      won: true,
      kills: 3,
      districtId: 'neon-docks',
    });
    expect(talliesNow()[featMeasureKey('battles_won')], 'the ordinary counters still move').toBe(1);
    expect(abroad(), 'the Docks are in this crew’s own city').toBeUndefined();

    tallyBattleResolved(repos, 'base-1', {
      attacked: true,
      won: true,
      kills: 1,
      districtId: 'viaduct',
    });
    expect(abroad()).toBe(1);
  });

  /**
   * ...and the mirror, with a crew that lives in Terminus.
   *
   * The same two districts, the same two calls, the opposite answers. A rule written as "is this
   * district in Terminus" rather than "is this district not in my city" passes the test above and
   * fails here, and nothing else in the tree would have said so.
   */
  it('reads abroad from where the crew lives, not from which city it is', () => {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES ('owner-tm', 'tm', 'x', ?)`,
    ).run(T0.toISOString());
    repos.bases.insert(
      makeBase({
        id: 'base-tm',
        ownerId: 'owner-tm',
        name: 'The Sidings',
        districtId: 'carriage',
      }),
    );
    const theirs = () => repos.feats.tallies('base-tm')[featMeasureKey('battles_won_abroad')];

    tallyBattleResolved(repos, 'base-tm', {
      attacked: false,
      won: true,
      kills: 0,
      districtId: 'viaduct',
    });
    expect(theirs(), 'the Viaduct is home for this one').toBeUndefined();

    tallyBattleResolved(repos, 'base-tm', {
      attacked: true,
      won: true,
      kills: 0,
      districtId: 'neon-docks',
    });
    expect(theirs()).toBe(1);
  });

  it('counts nothing for a fight that was lost, or one with no address', () => {
    tallyBattleResolved(repos, 'base-1', {
      attacked: true,
      won: false,
      kills: 0,
      districtId: 'viaduct',
    });
    expect(abroad(), 'a loss abroad is still a loss').toBeUndefined();

    // A call site that has not been given a district yet loses one counter rather than a fight.
    tallyBattleResolved(repos, 'base-1', { attacked: true, won: true, kills: 0 });
    expect(abroad()).toBeUndefined();
    expect(talliesNow()[featMeasureKey('battles_won')]).toBe(1);
  });
});

describe('the railway', () => {
  it('counts a journey each time one is put on the train', () => {
    expect(talliesNow()[featMeasureKey('rail_journeys')]).toBeUndefined();
    tallyRailJourney(repos, 'base-1');
    tallyRailJourney(repos, 'base-1');
    expect(talliesNow()[featMeasureKey('rail_journeys')]).toBe(2);
  });
});

describe('one side of a fight, crew by crew', () => {
  const side = (line: [string | null, Record<string, number>][], kills: number) =>
    tallyBattleSide(repos, {
      attacked: false,
      won: true,
      kills,
      districtId: 'kettle-row',
      principal: 'base-1',
      line: new Map(line),
    });

  it('hands a trap’s kills to the principal when nobody was standing in the line', () => {
    side([['base-1', {}]], 3);
    expect(talliesNow()[featMeasureKey('kills')]).toBe(3);
    expect(talliesNow()[featMeasureKey('battles_defended_won')]).toBe(1);
  });

  it('gives the regime its share of the kills and credits it nothing', () => {
    side(
      [
        ['base-1', { razors: 1 }],
        [null, { razors: 3 }],
      ],
      4,
    );
    expect(talliesNow()[featMeasureKey('kills')]).toBe(1);
  });
});
