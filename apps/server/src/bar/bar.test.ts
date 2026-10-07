import {
  DEFAULT_CITY_ID,
  MAX_WAGE_DISCOUNT,
  committedWage,
  DISMISSAL_WEEKS,
  MAX_OPEN_AUCTIONS,
  PAYROLL_BASE,
  districtUnitSlotCapacity,
  noTerritoryEffects,
  ATTRIBUTE_NAMES,
  CommanderSchema,
  MAX_RECRUITMENT_ATTRIBUTE,
  RECRUIT_LEGEND_NOTORIETY,
  askingWage,
  beginTraining,
  type TrainingState,
  makeAttributes,
  sessionFor,
  trainingsLeft,
  TRAINING_SECONDS,
  blackMarketDay,
  assessJoin,
  createCommander,
  maxOpenAuctionsFor,
  payrollStepCost,
  playerLevelGrants,
  playerXpToNextLevel,
  reservationWage,
  startingEconomy,
  startingProgression,
  startingResearch,
  type BarAuction,
  type Base,
  type BarResponse,
  type BidResponse,
  type Commander,
  type CrewResponse,
  type JoinRequirement,
  type Notification,
  startingTraining,
  OFFICER_ROLES,
  flatRoom,
  NO_FREE_BED_TEXT,
  nextMinimumBid,
} from '@frontline/shared';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, replayMigrations, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { crewEffectsFor } from '../crew/standing.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { projectRecruit } from './project.js';
import {
  bidCeilingFor,
  recruitSlotsFor,
  releaseOfficer,
  signRecruit,
  wageAskedOf,
  type HireRefusal,
} from './hire.js';
import { reserveFor, settleBarAuctions } from './auction.js';
import { barRoomOf } from './room.js';
import { MAX_CALIBRE, recruitmentCeiling } from '../characters/generate.js';
import {
  BAR_OPEN_DOOR_FLOOR,
  BAR_ROSTER_SIZE,
  barDay,
  barRoster,
  findBarRecruit,
  recruitId,
  type BarCharacter,
} from './roster.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';
import { tickWorld } from '../live/clock.js';

/*
 * The clock, pinned.
 *
 * Every bid route reads `new Date()` and refuses outside the phase it belongs to, so a suite on
 * the real clock would go red for half an hour a day. Only `Date` is faked: Fastify's own timers
 * have to keep running or `app.inject` never settles.
 *
 * August, so Athens is GMT+3 and the day turns at 21:00 UTC.
 */
/** Midday in Athens: the open phase, where the ordinary bidding happens. */
const NOW = new Date('2026-08-13T09:00:00.000Z');
/** Twenty minutes before the close: the sealed phase. */
const SEALED = new Date('2026-08-13T20:40:00.000Z');
/** Half past midnight in Athens: a new day, and yesterday's tables are due. */
const AFTER = new Date('2026-08-13T21:30:00.000Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
  vi.setSystemTime(NOW);
});

async function makeApp({ admin = false } = {}): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ...(admin ? { ADMIN: 'true' } : {}),
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  const handle = { app, db };
  instances.push(handle);
  return handle;
}

/** Sits somebody in every chair this crew has, so a win at the close has nowhere to go. */
function fillEveryChair(app: FastifyInstance, baseId: string, prefix: string): void {
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('no base');
  const chairs = recruitSlotsFor(base);
  app.repos.bases.updateCommanders(
    base.id,
    OFFICER_ROLES.slice(0, chairs).map((role, index) =>
      createCommander(`${prefix}-${String(index)}`, `Sitter ${String(index)}`, role),
    ),
  );
}

/** Razors into every bed the district has left, so an officer has nowhere to sleep. */
function fillEveryBed(app: FastifyInstance, baseId: string): void {
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('no base');
  const spare = districtUnitSlots(app.repos, base).spare;
  app.repos.bases.updateArmy(
    base.id,
    { ...base.army, razors: (base.army.razors ?? 0) + spare },
    base.musterQueue,
  );
}

interface Player {
  token: string;
  userId: string;
  baseId: string;
  username: string;
}

/**
 * A registered player who has picked an overseer, i.e. one who has a base.
 *
 * With the Bar's door open by default, because the server holds it now (level 5) and nearly every
 * case here bids. `shut` leaves the crew as it arrives, for the cases about a fresh player.
 */
async function makePlayer(
  app: FastifyInstance,
  username: string,
  { shut = false }: { shut?: boolean } = {},
): Promise<Player> {
  const register = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(register.statusCode).toBe(201);
  const registered = register.json<{ token: string; user: { id: string } }>();

  const overseer = await chooseOverseer(app, registered.token);
  if (!shut) openDoors(app, registered.token, 'bar');
  expect(overseer.statusCode).toBe(201);
  // The room is the same eight tables for everybody on a given game day, and one §F6 signature
  // widens the pool it is drawn from by 40%, which is the thing this file counts.
  pinOverseer(app, registered.token);
  return {
    token: registered.token,
    userId: registered.user.id,
    baseId: overseer.json<{ base: { id: string } }>().base.id,
    username,
  };
}

/**
 * Lifts a crew to `level`. A player opens the Bar at its door level, which is one officer slot
 * (maintainer, 2026-09-30), so a test that seats somebody before bidding needs the second.
 */
function raiseTo(app: FastifyInstance, player: Player, level: number): void {
  const base = app.repos.bases.findById(player.baseId);
  if (!base) throw new Error('no base');
  app.repos.bases.updateProgression(base.id, level, base.progression);
}

async function readBar(app: FastifyInstance, player: Player): Promise<BarResponse> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/bar',
    headers: { authorization: `Bearer ${player.token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<BarResponse>();
}

/** The first table this crew can actually sit at, with the recruit it is about. */
function openTable(bar: BarResponse): { auction: BarAuction; name: string } {
  const recruit = bar.recruits.find((entry) => entry.assessment.interested);
  const auction = bar.auctions.find((entry) => entry.recruitId === recruit?.id);
  if (!recruit || !auction) throw new Error('fixture: nobody at the Bar this crew can approach');
  return { auction, name: recruit.name };
}

/** Every table this crew can sit at, in roster order. */
function openTables(bar: BarResponse): BarAuction[] {
  const willing = new Set(
    bar.recruits.filter((entry) => entry.assessment.interested).map((entry) => entry.id),
  );
  return bar.auctions.filter((auction) => willing.has(auction.recruitId));
}

function bid(app: FastifyInstance, player: Player, recruitId: string, amount: number) {
  return app.inject({
    method: 'POST',
    url: '/api/bar/bid',
    headers: { authorization: `Bearer ${player.token}` },
    payload: { recruitId, amount },
  });
}

function seal(app: FastifyInstance, player: Player, recruitId: string, amount: number) {
  return app.inject({
    method: 'POST',
    url: '/api/bar/seal',
    headers: { authorization: `Bearer ${player.token}` },
    payload: { recruitId, amount },
  });
}

const errorOf = (body: string): { code: string; message: string } =>
  (JSON.parse(body) as { error: { code: string; message: string } }).error;

/** Level 7: the Bar is open and the slot ladder has reached two, so two officers fill the books. */
const TWO_SLOT_LEVEL = 7;

function makeBase(overrides: Partial<Base> = {}): Base {
  return {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'Test Hold',
    districtId: 'neon-docks',
    level: TWO_SLOT_LEVEL,
    isBot: false,
    resources: {
      caps: 5000,
      supplies: 100,
      oil: 100,
      scrap: 100,
      highQualityMetal: 10,
      planks: 100,
    },
    economy: startingEconomy(NOW.toISOString()),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining('2026-08-16T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

interface Written {
  commanders?: Commander[];
  caps?: number;
  commitments?: Record<string, number>;
  /** The book as `releaseOfficer` left it, when it had a drill of the released officer's to drop. */
  training?: TrainingState;
  hires: number;
}

/** A repository double: signing writes through three calls and the tests assert on what landed. */
function fakeRepos(
  /** Who is out: a run led by this officer id, or a fight they are leading. */
  out: { runLedBy?: string; fightLedBy?: string } = {},
): {
  repos: Parameters<typeof signRecruit>[0];
  written: Written;
} {
  const written: Written = { hires: 0 };
  const bases = {
    // The payroll ledger now reads the standing fold (B2), which walks every crew's seats.
    listSummaries: () => [],
    updateResources: (_id: string, resources: { caps: number }) => {
      written.caps = resources.caps;
    },
    updateEconomy: (_id: string, economy: { payroll: { commitments: Record<string, number> } }) => {
      written.commitments = economy.payroll.commitments;
    },
    updateCommanders: (_id: string, commanders: Commander[]) => {
      written.commanders = commanders;
    },
    // A fourth write, and only on the one path that can orphan a drill: letting somebody go while
    // they are on an hour. A double missing it throws rather than passing, which is the right way
    // round, but it has to be here or the release case cannot run at all.
    updateTraining: (_id: string, training: TrainingState, commanders: Commander[]) => {
      written.training = training;
      written.commanders = commanders;
    },
  };
  const bar = {
    recordHire: () => {
      written.hires += 1;
    },
  };
  /*
   * A crew holding nothing.
   *
   * The crew fold reads what the *ground* adds to its officers (§A4: the Chapel, the Broadcast
   * Station), so a double that omits the city repo is a double the code under test cannot run
   * against: an empty map is what "this crew holds nothing" actually looks like.
   */
  const city = { controls: () => new Map(), control: () => undefined };
  const users = { findById: () => undefined };
  const overseers = { findById: () => undefined };
  const sieges = {
    deploymentsFor: () => [],
    gate: () => undefined,
    leadingElsewhere: (officerId: string) =>
      officerId === out.fightLedBy ? [{ battleId: 'battle-1' }] : [],
  };
  const movements = { forBase: () => [] };
  // Signing counts the beds (2026-09-29), and the bed count reads everybody the crew has out: a
  // crew with nobody planted, walking or posted anywhere.
  const sleepers = { forBase: () => [] };
  const moves = { activeFor: () => [] };
  const alliedGarrisons = { forBase: () => [] };
  const missions = {
    listActiveByBaseId: () =>
      out.runLedBy === undefined
        ? []
        : [
            {
              mission: {
                officerId: out.runLedBy,
                startedAt: new Date().toISOString(),
                travelMinutes: 10,
                durationMinutes: 10,
                recalledAt: null,
              },
            },
          ],
  };
  /*
   * A crew in no faction, which is the state these cases are written for.
   *
   * §H3's faction door reads `Faction.infamyEarned` through this repo (`factionInfamyOf`), so a
   * double that omits it is a double the code under test cannot run against. Answering "no
   * membership" is what a crew that has not joined anything actually looks like, and it is the
   * standout seats' hardest door left shut.
   */
  const factions = { membershipOf: () => undefined, find: () => undefined };
  return {
    repos: {
      bases,
      bar,
      city,
      users,
      overseers,
      sieges,
      movements,
      missions,
      factions,
      sleepers,
      moves,
      alliedGarrisons,
    } as unknown as Parameters<typeof signRecruit>[0],
    written,
  };
}

describe('§H2/§H2a: one global roster, generated from the game date', () => {
  it('serves two different accounts the identical roster on the same game day', async () => {
    const { app } = await makeApp();
    const first = await readBar(app, await makePlayer(app, 'operator_one'));
    const second = await readBar(app, await makePlayer(app, 'operator_two'));

    expect(first.day).toBe(second.day);
    expect(first.recruits).toHaveLength(BAR_ROSTER_SIZE);
    // Every rolled fact, not just the ids: identical people, not merely identical slots. The
    // assessment is dropped because it is a judgement of the *crew*, not part of the roster.
    const rolled = (response: BarResponse) =>
      response.recruits.map(({ assessment: _judged, ...rest }) => rest);
    expect(rolled(second)).toEqual(rolled(first));
  });

  it('serves a different roster on the next game day', () => {
    const today = barRoster('2026-08-13');
    const tomorrow = barRoster('2026-08-14');
    expect(tomorrow).not.toEqual(today);
    // Not merely re-keyed: the people themselves are different.
    expect(tomorrow.map((r) => r.name)).not.toEqual(today.map((r) => r.name));
    expect(tomorrow.map((r) => r.attributes)).not.toEqual(today.map((r) => r.attributes));
  });

  it('turns over on Athens midnight, which is the clock every other daily reset uses', () => {
    // August, so Athens is GMT+3: the room changes at 21:00 UTC. Pinned against the black
    // market's own day key, because the whole point is that they roll together.
    expect(barDay(new Date('2026-08-13T20:59:59.999Z'))).toBe('2026-08-13');
    expect(barDay(new Date('2026-08-13T21:00:00.000Z'))).toBe('2026-08-14');
    expect(barDay(new Date('2026-08-13T21:00:00.000Z'))).toBe(
      blackMarketDay(new Date('2026-08-13T21:00:00.000Z')),
    );
    // And in winter Athens is GMT+2, so the boundary moves with the zone rather than staying put.
    expect(barDay(new Date('2026-01-13T21:59:59.999Z'))).toBe('2026-01-13');
    expect(barDay(new Date('2026-01-13T22:00:00.000Z'))).toBe('2026-01-14');
  });

  it('is a pure function of the day: same answer every time it is asked', () => {
    expect(barRoster('2026-08-13')).toEqual(barRoster('2026-08-13'));
    // Recomputed independently rather than memoised: distinct object identities, equal values.
    expect(barRoster('2026-08-13')[0]).not.toBe(barRoster('2026-08-13')[0]);
  });

  it('rolls people the rest of the game would accept', () => {
    for (const day of ['2026-01-01', '2026-08-13', '2026-12-31', '2027-02-28']) {
      for (const recruit of barRoster(day)) {
        expect(recruit.name.length).toBeGreaterThan(2);
        expect(recruit.requirement.minNotoriety).toBeGreaterThanOrEqual(0);
        // The standout seats ask up to `Feared`; every ordinary seat stops at the room's own
        // ceiling. Both are ranks a crew can reach, which is the rule that matters here.
        expect(recruit.requirement.minNotoriety).toBeLessThanOrEqual(RECRUIT_LEGEND_NOTORIETY);
        for (const name of ATTRIBUTE_NAMES) {
          expect(recruit.attributes[name]).toBeLessThanOrEqual(MAX_RECRUITMENT_ATTRIBUTE);
        }
      }
    }
  });

  it('holds the open-door floor at the measured three', () => {
    // Every other assertion about the floor is written *relative* to this constant, so all of them
    // move with it and none of them pin it: lowering it to 1 leaves the whole W5 suite green while
    // cutting a brand-new crew's worst day down to a single willing recruit: the worst day offers
    // exactly the floor, measured. An empty Bar stays unreachable either way (`recruitAt` forces
    // both gates), so what moves is how much choice a new crew gets, and that is a decision worth
    // pinning rather than deriving. The HTTP cases below also lean on it for their stability.
    expect(BAR_OPEN_DOOR_FLOOR).toBe(3);
  });

  it('always seats recruits a brand-new crew can approach, on every day and at every calibre', () => {
    // Why the Bar can never be an empty screen. A new crew is rank `Nobody` at level 1, so every
    // rolled door is shut to them; the floor is what guarantees there is somebody to talk to on
    // their first night, whatever the city's own standing has done to the room.
    for (let day = 0; day < 400; day++) {
      const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      for (const cityLevel of [0, 8, 30]) {
        const roster = barRoster(key, cityLevel);
        const willing = roster.filter(
          (r) =>
            assessJoin(r.requirement, {
              notoriety: 0,
              infamy: 0,
              factionInfamy: 0,
            }).interested,
        );
        expect(
          willing.length,
          `${key} at city level ${cityLevel} leaves a new crew only ${willing.length} recruits`,
        ).toBeGreaterThanOrEqual(BAR_OPEN_DOOR_FLOOR);
      }
    }
  });

  /**
   * §H2: the room scales with the city. Measured as a distribution rather than per seat, because
   * one seat's roll can go either way and what the mechanic promises is that the *room* is better.
   */
  it('seats better people as the city levels', () => {
    const meanOf = (cityLevel: number): number => {
      let total = 0;
      let count = 0;
      for (let day = 0; day < 60; day++) {
        const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
        for (const recruit of barRoster(key, cityLevel)) {
          for (const name of ATTRIBUTE_NAMES) {
            total += recruit.attributes[name];
            count += 1;
          }
        }
      }
      return total / count;
    };
    const early = meanOf(0);
    const late = meanOf(30);
    expect(late).toBeGreaterThan(early + 3);
    /*
     * The recruitment ceiling climbs with the room since 2026-09-28 (maintainer: "officers up to
     * even higher ones"), and it used to hold at 40 whatever the city. It still stops short of the
     * top of the scale, which is what training is for, and a finished city really does pass 40.
     */
    let highest = 0;
    for (let day = 0; day < 30; day++) {
      const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      for (const recruit of barRoster(key, 110)) {
        for (const name of ATTRIBUTE_NAMES) {
          expect(recruit.attributes[name]).toBeLessThanOrEqual(recruitmentCeiling(MAX_CALIBRE));
          highest = Math.max(highest, recruit.attributes[name]);
        }
      }
    }
    expect(recruitmentCeiling(MAX_CALIBRE)).toBeLessThan(100);
    expect(highest).toBeGreaterThan(MAX_RECRUITMENT_ATTRIBUTE);
  });

  it('leaves the ungated seats free to be anyone else: the floor is a floor, not the roster', () => {
    // A guarantee that quietly flattened every recruit into the same safe disposition would pass
    // the check above and gut §H3 entirely. Read in a city whose crews have bought a few rungs,
    // because the high seat asks the top crew's own rank and a city of `Nobody`s has none to ask.
    const gated = new Set<number>();
    const perksSeen = new Set<string>();
    for (let day = 0; day < 200; day++) {
      const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      barRoster(key, flatRoom(20, 3)).forEach((recruit, index) => {
        if (recruit.requirement.minNotoriety > 0) gated.add(index);
        for (const id of recruit.perks) perksSeen.add(id);
      });
    }
    expect(gated.size, 'every seat past the floor must be able to carry a §H3 gate').toBe(
      BAR_ROSTER_SIZE - BAR_OPEN_DOOR_FLOOR,
    );
    // Two hundred days of rosters should reach a good part of the book. A catalogue whose tail
    // never appears is content nobody can hire, which is the mission-board hazard in another form.
    expect(perksSeen.size, 'the perk book barely circulates').toBeGreaterThan(60);
  });
});

describe('§H3: the roster as one particular crew sees it', () => {
  it('locks a recruit whose §H3 gate the crew has not cleared, and unlocks it when they do', () => {
    const gated = barRoster('2026-08-13').find((r) => r.requirement.minNotoriety > 0);
    if (!gated) throw new Error('expected the roster to contain at least one gated recruit');

    const quiet = makeBase();
    expect(wageAskedOf(gated), 'a crew that clears the gate gets a price').toBeGreaterThan(0);
    // The gate itself is asserted through the route below; here it is enough that the crew's own
    // numbers, not the recruit's, are what changed.
    expect(quiet.economy.notoriety).toBeLessThan(gated.requirement.minNotoriety);
  });

  it('prices a recruit off their sheet and their tags, and off nothing about the crew', () => {
    const [recruit] = barRoster('2026-08-13');
    if (!recruit) throw new Error('empty roster');
    expect(wageAskedOf(recruit)).toBe(askingWage(recruit.attributes, 0, recruit.perks));
  });

  /**
   * §H7: and the tags are a real part of that price, not decoration.
   *
   * Attributes are the half of a person that can be trained; a perk is the half that cannot, and
   * the room used to hand it over free. Asserted as a *difference* rather than a figure, because
   * what matters is that carrying something broad costs more than carrying something narrow, and
   * both of those are catalogue numbers that may be retuned.
   */
  it('charges more for a tag that pays everywhere than for one that pays on one unit', () => {
    const sheet = makeAttributes(58);
    const broad = askingWage(sheet, 0, ['battlefield_surgeon']);
    const narrow = askingWage(sheet, 0, ['arc_warden']);
    const bare = askingWage(sheet, 0, []);

    expect(bare, 'a tag has to cost something').toBeLessThan(narrow);
    expect(narrow, 'breadth has to beat magnitude').toBeLessThan(broad);
    // ...and enough that a better sheet does not simply out-price a better tag.
    expect(broad).toBeGreaterThan(askingWage(makeAttributes(62), 0, ['arc_warden']));
  });

  /** §H7a: the floor is what the table opens at, and it is a fact about the person. */
  it('opens a table at the reservation price off that same sheet', () => {
    const [recruit] = barRoster('2026-08-13');
    if (!recruit) throw new Error('empty roster');
    expect(reserveFor(recruit)).toBe(
      reservationWage(askingWage(recruit.attributes, 0, recruit.perks)),
    );
    expect(reserveFor(recruit)).toBeLessThan(wageAskedOf(recruit));
  });
});

describe('§H7/§H8: putting a won recruit on the books', () => {
  const recruit = () => {
    const found = barRoster('2026-08-13').find((r) => r.requirement.minNotoriety === 0);
    if (!found) throw new Error('expected an ungated recruit');
    return found;
  };

  const sign = (repos: Parameters<typeof signRecruit>[0], base: Base, price: number) =>
    signRecruit(repos, { base, userId: 'user-1', recruit: recruit(), price, now: NOW });

  /**
   * Every §H3 door refuses at the close, not only the two on the HUD.
   *
   * `refusalFor` used to name `notoriety` and `level` in two `if`s, so when the standout seats
   * added the wallet and the badge (2026-09-11) the close stopped reading them: the bid gate
   * refused the crew at the table and the close handed the officer over at midnight anyway. It is
   * reachable without doing anything strange, because infamy is a wallet that goes down: bid while
   * you are holding it, spend it on a tier or in the back room, and win them at the close.
   */
  it('refuses at the close for every door, including the wallet and the badge', () => {
    const hire = recruit();
    const doors: [string, JoinRequirement, HireRefusal][] = [
      ['rank', { ...hire.requirement, minNotoriety: 4 }, 'requirement'],
      ['wallet', { ...hire.requirement, minInfamy: 500 }, 'infamy'],
      ['badge', { ...hire.requirement, minFactionInfamy: 250 }, 'faction'],
    ];
    for (const [label, requirement, reason] of doors) {
      const { repos } = fakeRepos();
      // A crew that clears everything except the one door under test. `fakeRepos` answers "no
      // faction", so the badge case needs nothing else set up.
      const base: Base = {
        ...makeBase(),
        level: 30,
        economy: { ...makeBase().economy, notoriety: 3, infamy: 0 },
      };
      const result = signRecruit(repos, {
        base,
        userId: 'user-1',
        recruit: { ...hire, requirement },
        price: reserveFor(hire),
        now: NOW,
      });
      expect(result, `${label} was not refused at the close`).toEqual({
        kind: 'refused',
        reason,
      });
    }

    // The control: the same crew and the same price with every door open really does sign, so the
    // four refusals above are the doors rather than some other clause biting first.
    const { repos } = fakeRepos();
    const open = signRecruit(repos, {
      base: { ...makeBase(), level: 30, economy: { ...makeBase().economy, notoriety: 3 } },
      userId: 'user-1',
      recruit: hire,
      price: reserveFor(hire),
      now: NOW,
    });
    expect(open.kind).toBe('signed');
  });

  it('signs at the closing price, banks the officer and commits it against the payroll book', () => {
    const { repos, written } = fakeRepos();
    const hire = recruit();
    const price = reserveFor(hire) + 5;

    const result = sign(repos, makeBase(), price);
    expect(result.kind).toBe('signed');
    if (result.kind !== 'signed') return;

    expect(result.wage).toBe(price);
    // The close happens while the player is asleep, so nobody is signed into a chair.
    expect(result.officer.role).toBeNull();
    // What the table closed at is what the book is charged, and it is the whole relationship.
    expect(result.officer.weeklyWage).toBe(price);
    expect(result.officer.perks).toEqual(hire.perks);
    expect(written.commitments).toEqual({ [hire.id]: price });
    expect(result.base.economy.payroll.commitments[hire.id]).toBe(price);
    expect(written.commanders?.map((c) => c.id)).toEqual([hire.id]);
    expect(written.hires, 'the signing log gets its row').toBe(1);
  });

  /**
   * "Need a free bed" (maintainer, 2026-09-29): an officer sleeps in one, so a packed district
   * cannot sign anybody.
   *
   * This test has been pointed both ways. It said a full district still signs while officers were
   * outside the pool; they have drawn a bed each since 2026-09-15 and the Bar was the one door
   * that never asked, so a crew could hire itself over its own ceiling.
   */
  it('refuses to sign into a district with no bed left, and signs with one', () => {
    const bare = makeBase();
    const capacity = districtUnitSlotCapacity(bare.buildings, noTerritoryEffects());
    // Razors are one unit each, so the first roster leaves exactly one bed and the second none.
    const oneLeft = makeBase({ army: { razors: capacity - 1 } });
    expect(sign(fakeRepos().repos, oneLeft, reserveFor(recruit())).kind).toBe('signed');

    const packed = makeBase({ army: { razors: capacity } });
    expect(sign(fakeRepos().repos, packed, reserveFor(recruit()))).toEqual({
      kind: 'refused',
      reason: 'no_unit_slots',
    });
  });

  /**
   * The book, not the stockpile. Signing takes nothing: what it does is spend a slice of a ceiling
   * the player has to go and buy more of.
   */
  it('commits the fee against the book and charges no caps at all', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase();
    const result = sign(repos, base, reserveFor(recruit()));
    expect(result.kind).toBe('signed');
    if (result.kind !== 'signed') return;
    expect(result.base.resources.caps).toBe(base.resources.caps);
    expect(written.caps, 'signing must not move caps').toBeUndefined();
    expect(result.payroll.committed).toBe(result.wage);
    expect(result.payroll.available).toBe(result.payroll.capacity - result.wage);
  });

  it('refuses a fee the payroll book will not stretch to', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase();
    // Already spoken for, down to a few caps: the fee cannot fit whatever is in the bank.
    const full = {
      ...base,
      economy: {
        ...base.economy,
        payroll: { ...base.economy.payroll, commitments: { 'someone-else': PAYROLL_BASE - 1 } },
      },
    };
    expect(sign(repos, full, reserveFor(recruit()))).toEqual({
      kind: 'refused',
      reason: 'no_payroll',
    });
    expect(written.commanders).toBeUndefined();
  });

  it('holds §H8: one slot with the Bar, another every two levels', () => {
    expect(playerLevelGrants(4).recruitSlots).toBe(0);
    expect(playerLevelGrants(5).recruitSlots).toBe(1);
    expect(playerLevelGrants(TWO_SLOT_LEVEL).recruitSlots).toBe(2);
    expect(playerLevelGrants(8).recruitSlots).toBe(2);
    expect(playerLevelGrants(9).recruitSlots).toBe(3);

    // Below the Bar's level the books hold nobody at all.
    expect(sign(fakeRepos().repos, makeBase({ level: 4 }), reserveFor(recruit()))).toEqual({
      kind: 'refused',
      reason: 'no_slots',
    });

    const full = makeBase({
      commanders: [
        createCommander('a', 'A', 'cartographer', {}),
        createCommander('b', 'B', 'trader', {}),
      ],
    });
    expect(sign(fakeRepos().repos, full, reserveFor(recruit()))).toEqual({
      kind: 'refused',
      reason: 'no_slots',
    });

    // One level up is still two slots; the next arrives two levels on, because §H8 is read off
    // W6's grant table.
    expect(sign(fakeRepos().repos, { ...full, level: 8 }, reserveFor(recruit()))).toEqual({
      kind: 'refused',
      reason: 'no_slots',
    });
    expect(sign(fakeRepos().repos, { ...full, level: 9 }, reserveFor(recruit())).kind).toBe(
      'signed',
    );
  });

  /*
   * Maintainer, 2026-09-30: a crew holding more officers than its level now allows (a save from
   * before the slot ladder) keeps every one of them, and signs nobody until it is back under.
   */
  it('keeps a crew over its slots whole, and signs nobody new until it is back under', () => {
    const roles = ['cartographer', 'trader', 'salvager', 'salvager'] as const;
    const over = makeBase({
      commanders: roles.map((role, index) => createCommander(`o${String(index)}`, 'O', role, {})),
    });
    const { repos, written } = fakeRepos();
    expect(sign(repos, over, reserveFor(recruit()))).toEqual({
      kind: 'refused',
      reason: 'no_slots',
    });
    expect(written.commanders, 'a refusal rewrites nobody off the books').toBeUndefined();

    // Three officers at two slots is still over; two of them gone is under, and the Bar opens.
    const stillOver = { ...over, commanders: over.commanders.slice(0, 3) };
    expect(sign(fakeRepos().repos, stillOver, reserveFor(recruit())).kind).toBe('refused');
    const under = { ...over, commanders: over.commanders.slice(0, 1) };
    expect(sign(fakeRepos().repos, under, reserveFor(recruit())).kind).toBe('signed');
  });

  it('never puts more officers on the books than there are chairs', () => {
    const ceiling = OFFICER_ROLES.length;
    expect(recruitSlotsFor(makeBase({ level: 500 }))).toBe(ceiling);
    // Thirteen chairs since 2026-10-04: the last slot opens at 29, so 27 is one short.
    expect(recruitSlotsFor(makeBase({ level: 27 }))).toBe(ceiling - 1);
  });

  // The level is the only source (maintainer, 2026-10-01: "Remove the +1 at the bar mechanic"):
  // the two rungs that used to add a slot pay a universal bonus now and nothing at the Bar.
  it('counts the level alone, whatever the Lab has finished', () => {
    const research = {
      active: null,
      technologies: ['tech_the_growth_curve', 'tech_succession_planning'],
    };
    for (const level of [9, 20, 35]) {
      expect(recruitSlotsFor(makeBase({ level, research })), `level ${level}`).toBe(
        playerLevelGrants(level).recruitSlots,
      );
    }
  });

  it('will not sign the same person twice', () => {
    const hire = recruit();
    const already = makeBase({
      commanders: [createCommander(hire.id, hire.name, 'cartographer', {})],
    });
    expect(sign(fakeRepos().repos, already, reserveFor(hire))).toEqual({
      kind: 'refused',
      reason: 'already_hired',
    });
  });

  /**
   * Maintainer, 2026-09-29: admin mode waives at the close what it waived at the table. The table
   * lets an admin crew bid past a full set of chairs, a full district, a spent book and a shut
   * door; a close that then checked all four for real passed the only bidder over and signed
   * nobody. Each gate is proved twice, so a waiver that leaked into the ordinary mode fails here.
   */
  it('signs through the chair, the bed, the book and the door in admin mode, and only there', () => {
    const hire = recruit();
    const bare = makeBase();
    const beds = districtUnitSlotCapacity(bare.buildings, noTerritoryEffects());
    const gates: [string, Base, BarCharacter, HireRefusal][] = [
      [
        'chair',
        makeBase({
          commanders: [
            createCommander('a', 'A', 'cartographer', {}),
            createCommander('b', 'B', 'trader', {}),
          ],
        }),
        hire,
        'no_slots',
      ],
      ['bed', makeBase({ army: { razors: beds } }), hire, 'no_unit_slots'],
      [
        'book',
        {
          ...bare,
          economy: {
            ...bare.economy,
            payroll: { ...bare.economy.payroll, commitments: { 'someone-else': PAYROLL_BASE - 1 } },
          },
        },
        hire,
        'no_payroll',
      ],
      [
        'door',
        bare,
        { ...hire, requirement: { ...hire.requirement, minNotoriety: 4 } },
        'requirement',
      ],
    ];
    for (const [label, base, person, reason] of gates) {
      const input = { base, userId: 'user-1', recruit: person, price: reserveFor(hire), now: NOW };
      expect(signRecruit(fakeRepos().repos, input), `${label}, ordinary mode`).toEqual({
        kind: 'refused',
        reason,
      });
      expect(
        signRecruit(fakeRepos().repos, { ...input, admin: true }).kind,
        `${label}, admin`,
      ).toBe('signed');
    }

    // A fact is not a gate: admin mode still will not put one person on the books twice.
    const already = makeBase({
      commanders: [createCommander(hire.id, hire.name, 'cartographer', {})],
    });
    expect(
      signRecruit(fakeRepos().repos, {
        base: already,
        userId: 'user-1',
        recruit: hire,
        price: reserveFor(hire),
        now: NOW,
        admin: true,
      }),
    ).toEqual({ kind: 'refused', reason: 'already_hired' });
  });

  /**
   * The other end of the contract, and the only place caps move. Committing is free so a player
   * will bid; walking it back is ten weeks so they will think about it first.
   */
  it('frees the slice when an officer is let go, and charges ten weeks of it', () => {
    const { repos } = fakeRepos();
    const hired = sign(repos, makeBase(), reserveFor(recruit()));
    if (hired.kind !== 'signed') throw new Error('expected a signing');

    const released = releaseOfficer(repos, hired.base, hired.officer.id);
    expect(released.kind).toBe('released');
    if (released.kind !== 'released') return;
    expect(released.fee).toBe(hired.wage * DISMISSAL_WEEKS);
    expect(released.base.resources.caps).toBe(hired.base.resources.caps - released.fee);
    expect(released.payroll.committed).toBe(0);
    expect(released.base.commanders).toHaveLength(0);
  });

  /**
   * Somebody let go mid-drill takes their hour with them (2026-09-21).
   *
   * A training session is keyed by subject id and nothing but this path can orphan one. It was
   * harmless while a stranded session only blocked its own subject; with a queue of fixed length
   * (`TRAINING_QUEUE_SLOTS`) it holds a place nobody can see, on a screen that offers no way to
   * clear it.
   *
   * Both halves are pinned: the session goes, and the day's allowance comes back, because nothing
   * was learned in an hour that was cut short.
   */
  it('takes a released officer’s drill off the board, and hands the hour back', () => {
    const { repos, written } = fakeRepos();
    const hired = sign(repos, makeBase(), reserveFor(recruit()));
    if (hired.kind !== 'signed') throw new Error('expected a signing');

    const now = new Date().toISOString();
    const drilling: Base = {
      ...hired.base,
      training: beginTraining(
        hired.base.training,
        {
          id: 'drill-1',
          subjectId: hired.officer.id,
          attribute: 'logic',
          startedAt: now,
          durationSeconds: TRAINING_SECONDS,
        },
        now,
      ),
    };
    expect(
      sessionFor(drilling.training, hired.officer.id),
      'the fixture has nobody drilling',
    ).toBeDefined();
    const spent = trainingsLeft(drilling.training, now);

    const released = releaseOfficer(repos, drilling, hired.officer.id);
    expect(released.kind).toBe('released');
    if (released.kind !== 'released') return;

    expect(sessionFor(released.base.training, hired.officer.id)).toBeUndefined();
    expect(released.base.training.sessions).toHaveLength(0);
    expect(trainingsLeft(released.base.training, now)).toBe(spent + 1);
    // ...and it is written, not merely returned: the route answers off the book on the next read.
    expect(written.training?.sessions ?? ['unwritten']).toHaveLength(0);
    // Written with the roster the officer has already left, or the same call would put them back.
    expect(written.commanders).toHaveLength(0);
  });

  it('refuses to let somebody go the crew cannot pay off, and 404s a stranger', () => {
    const { repos } = fakeRepos();
    const hired = sign(repos, makeBase(), reserveFor(recruit()));
    if (hired.kind !== 'signed') throw new Error('expected a signing');

    const broke = { ...hired.base, resources: { ...hired.base.resources, caps: 0 } };
    expect(releaseOfficer(repos, broke, hired.officer.id)).toEqual({
      kind: 'refused',
      reason: 'cannot_afford',
    });
    expect(releaseOfficer(repos, hired.base, 'nobody')).toEqual({
      kind: 'refused',
      reason: 'not_on_the_books',
    });
  });

  /** Every run has a leader (2026-09-28), so nobody is let go from the head of one. */
  it('will not let somebody go while they are out leading a run or a fight', () => {
    const { repos } = fakeRepos();
    const hired = sign(repos, makeBase(), reserveFor(recruit()));
    if (hired.kind !== 'signed') throw new Error('expected a signing');
    const id = hired.officer.id;

    expect(releaseOfficer(fakeRepos({ runLedBy: id }).repos, hired.base, id)).toEqual({
      kind: 'refused',
      reason: 'on_duty',
      held: 'run',
    });
    expect(releaseOfficer(fakeRepos({ fightLedBy: id }).repos, hired.base, id)).toEqual({
      kind: 'refused',
      reason: 'on_duty',
      held: 'fight',
    });
    // Somebody else out leading changes nothing for this one.
    expect(releaseOfficer(fakeRepos({ runLedBy: 'someone-else' }).repos, hired.base, id).kind).toBe(
      'released',
    );
  });
});

describe('§H7a: bidding at the Bar', () => {
  it('opens a table at the reserve, and the whole city sees the bid', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'operator_one');
    const two = await makePlayer(app, 'operator_two');

    const bar = await readBar(app, one);
    const { auction } = openTable(bar);
    expect(auction.leading, 'an untouched table has no leader').toBeNull();
    expect(auction.nextBid, 'and it opens at the reserve').toBe(auction.reserve);
    expect(bar.auctionsUsed).toBe(0);
    expect(bar.auctionsAllowed).toBe(MAX_OPEN_AUCTIONS);

    const placed = await bid(app, one, auction.recruitId, auction.reserve);
    expect(placed.statusCode, placed.body.slice(0, 300)).toBe(200);
    const mine = placed.json<BidResponse>();
    expect(mine.auction.leading).toMatchObject({
      username: one.username,
      amount: auction.reserve,
      yours: true,
    });
    expect(mine.auction.yourBid).toBe(auction.reserve);
    expect(mine.auction.bidders).toBe(1);
    expect(mine.auctionsUsed).toBe(1);

    // The other side of the room: the same bid, by name, and not marked as theirs.
    const theirs = await readBar(app, two);
    const seen = theirs.auctions.find((entry) => entry.recruitId === auction.recruitId);
    expect(seen?.leading).toMatchObject({ username: one.username, yours: false });
    expect(seen?.bids).toHaveLength(1);
    expect(seen?.bidders).toBe(1);
    expect(seen?.yourBid, "nobody else's bid is ever mine").toBeNull();
    expect(seen?.nextBid).toBeGreaterThan(auction.reserve);
  });

  it('refuses a bid under the increment, and says what it would take', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'increment_one');
    const two = await makePlayer(app, 'increment_two');

    const { auction } = openTable(await readBar(app, one));
    expect((await bid(app, one, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    const table = (await readBar(app, two)).auctions.find(
      (entry) => entry.recruitId === auction.recruitId,
    );
    if (!table) throw new Error('the table went missing');
    // Matching the leader is not beating them, and neither is anything under the step.
    const short = await bid(app, two, auction.recruitId, table.nextBid - 1);
    expect(short.statusCode).toBe(409);
    expect(errorOf(short.body).code).toBe('BID_REFUSED');
    expect(errorOf(short.body).message).toContain(String(table.nextBid));

    const enough = await bid(app, two, auction.recruitId, table.nextBid);
    expect(enough.statusCode, enough.body.slice(0, 300)).toBe(200);
    expect(enough.json<BidResponse>().auction.leading?.username).toBe(two.username);
  });

  /**
   * The floor, at the exact cap either side of it.
   *
   * The test above measures the *increment* against a leader; this one measures the reserve on a
   * table nobody has opened, which is the other boundary and the one a first bid actually hits.
   */
  it('takes a first bid at exactly the reserve, and refuses one cap under it', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'floor_one');
    const two = await makePlayer(app, 'floor_two');

    const bar = await readBar(app, one);
    const tables = openTables(bar);
    const [first, second] = tables;
    if (!first || !second)
      throw new Error('fixture: the room needs two tables this crew can sit at');

    const under = await bid(app, one, first.recruitId, first.reserve - 1);
    expect(under.statusCode).toBe(409);
    expect(errorOf(under.body).code).toBe('BID_REFUSED');
    expect(errorOf(under.body).message).toContain(String(first.reserve));
    // Nothing was banked, so the table is still untouched and still counts against no cap.
    const untouched = (await readBar(app, two)).auctions.find(
      (entry) => entry.recruitId === first.recruitId,
    );
    expect(untouched?.leading).toBeNull();
    expect(untouched?.bidders).toBe(0);
    expect((await readBar(app, one)).auctionsUsed, 'a refused bid is not a table').toBe(0);

    // Exactly the reserve stands, on a table with the same shape.
    const at = await bid(app, one, second.recruitId, second.reserve);
    expect(at.statusCode, at.body.slice(0, 300)).toBe(200);
    expect(at.json<BidResponse>().auction.leading?.amount).toBe(second.reserve);
  });

  /**
   * A sealed value **equal** to the leading open bid.
   *
   * `sealBid`'s floor is the highest of the reserve, the crew's own open bid and the leader's, and
   * it is a floor rather than a step: matching the leader is a legal final, because at the close a
   * tie is decided by a coin hashed off the auction (§H7a) rather than by who was there first. One
   * under it cannot win and is refused before the player spends the evening believing in it.
   */
  it('takes a sealed value level with the leader, and refuses one under it', async () => {
    const { app } = await makeApp();
    const leader = await makePlayer(app, 'level_leader');
    const sniper = await makePlayer(app, 'level_sniper');

    const { auction, name } = openTable(await readBar(app, leader));
    expect((await bid(app, leader, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    vi.setSystemTime(SEALED);
    const short = await seal(app, sniper, auction.recruitId, auction.reserve - 1);
    expect(short.statusCode).toBe(409);
    expect(errorOf(short.body).message).toContain(String(auction.reserve));

    const level = await seal(app, sniper, auction.recruitId, auction.reserve);
    expect(level.statusCode, level.body.slice(0, 300)).toBe(200);
    expect(level.json<BidResponse>().auction.yourSealed).toBe(auction.reserve);

    // And the close: two finals at the same number, exactly one contract, and the coin decides.
    vi.setSystemTime(AFTER);
    const fromLeader = await readBar(app, leader);
    const fromSniper = await readBar(app, sniper);
    expect(fromLeader.slotsUsed + fromSniper.slotsUsed, 'a tie is not two contracts').toBe(1);
    const signed = fromLeader.slotsUsed === 1 ? fromLeader : fromSniper;
    expect(signed.officers[0]?.commander.name).toBe(name);
    // Whoever it was paid the number they both put down, not a step above it.
    expect(signed.results[0]).toMatchObject({ outcome: 'won', price: auction.reserve });
  });

  it('refuses the leader raising their own bid', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'lonely_bidder');
    const { auction } = openTable(await readBar(app, one));
    expect((await bid(app, one, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    const again = await bid(app, one, auction.recruitId, auction.reserve * 3);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again.body).code).toBe('BID_REFUSED');
    expect(errorOf(again.body).message).toContain('already the highest');
  });

  it('holds the crew to two tables at once, and to three at level 40', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'busy_bidder');

    const tables = openTables(await readBar(app, player));
    expect(tables.length).toBeGreaterThan(MAX_OPEN_AUCTIONS);
    for (let table = 0; table < MAX_OPEN_AUCTIONS; table += 1) {
      const auction = tables[table];
      if (!auction) throw new Error('fixture: not enough tables');
      expect((await bid(app, player, auction.recruitId, auction.nextBid)).statusCode).toBe(200);
    }

    const third = tables[MAX_OPEN_AUCTIONS];
    if (!third) throw new Error('fixture: not enough tables');
    const refused = await bid(app, player, third.recruitId, third.nextBid);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused.body).code).toBe('TOO_MANY_AUCTIONS');
    expect(errorOf(refused.body).message).toContain('every table you can hold');

    // §I3: the level-40 milestone used to buy a second signing a day. It buys a third table now.
    const base = app.repos.bases.findById(player.baseId);
    if (!base) throw new Error('no base');
    app.repos.bases.updateProgression(base.id, 40, base.progression);
    // A book wide enough that the level-40 room's prices cannot be what refuses the third bid.
    app.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      // 400 flat expansions of 30: 12,000 of room.
      payroll: { ...base.economy.payroll, purchasedSteps: 400 },
    });

    const grown = await readBar(app, player);
    expect(grown.auctionsAllowed).toBe(maxOpenAuctionsFor(40));
    expect(grown.auctionsUsed).toBe(MAX_OPEN_AUCTIONS);
    const spare = openTables(grown).find(
      (auction) =>
        !tables.slice(0, MAX_OPEN_AUCTIONS).some((t) => t.recruitId === auction.recruitId),
    );
    if (!spare) throw new Error('fixture: no fourth table');
    const allowed = await bid(app, player, spare.recruitId, spare.nextBid);
    expect(allowed.statusCode, allowed.body.slice(0, 300)).toBe(200);
  });

  /**
   * Every bid holds its wage against the payroll book until the close, won or lost (maintainer,
   * 2026-10-04; P1-A, 2026-10-02). A crew with room for one wage leading two tables signed whoever
   * sat in the lowest seat at midnight and lost the other for want of payroll.
   */
  it('holds a bid against the book even once a rival is in front', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'reserved_book');
    const rival = await makePlayer(app, 'reserved_rival');
    const bar = await readBar(app, player);
    const [first, second] = openTables(bar);
    if (!first || !second) throw new Error('fixture: two tables needed');
    // In wages, the talked-down figure the book is charged (`committedWage`).
    const wage = (amount: number) => committedWage(amount, bar.wageDiscountPercent);
    const outbid = nextMinimumBid(first.reserve, first.nextBid);
    // Room for either wage on its own and not for both.
    const room = wage(first.nextBid) + wage(second.nextBid) - 1;
    const base = app.repos.bases.findById(player.baseId)!;
    app.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      payroll: {
        ...base.economy.payroll,
        commitments: { 'someone-else': bar.payroll.capacity - room },
      },
    });

    expect((await bid(app, player, first.recruitId, first.nextBid)).statusCode).toBe(200);
    expect((await bid(app, rival, first.recruitId, outbid)).statusCode).toBe(200);
    // Outbid, and the wage is still held: the screen's "bid up to" says so, and so does the route.
    expect((await readBar(app, player)).bidCeiling).toBeLessThan(second.nextBid);
    const refused = await bid(app, player, second.recruitId, second.nextBid);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused.body).message).toContain('payroll');
  });

  /*
   * An open bid and a higher sealed value on one table hold the higher once (bug pass,
   * 2026-10-04: the open-phase version could not fail, because a raise overwrites its own row).
   * Room for the sealed value and a second table's lock exactly: one cap less is refused, which
   * holds that the sealed value is what counts, and the exact room goes through, which holds that
   * the open bid under it is not counted on top.
   */
  it('holds the higher of an open bid and a sealed value, once', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'raise_once');
    const bar = await readBar(app, player);
    const [first, second] = openTables(bar);
    if (!first || !second) throw new Error('fixture: two tables needed');
    const wage = (amount: number) => committedWage(amount, bar.wageDiscountPercent);
    const sealedAtFirst = first.nextBid + 100;
    const sealedAtSecond = second.reserve;
    // A book wide enough to hold both locks, so the room left is set by the commitment alone.
    const wide = app.repos.bases.findById(player.baseId)!;
    app.repos.bases.updateEconomy(wide.id, {
      ...wide.economy,
      payroll: { ...wide.economy.payroll, purchasedSteps: 400 },
    });
    const capacity = (await readBar(app, player)).payroll.capacity;
    const roomOf = (room: number) => {
      const base = app.repos.bases.findById(player.baseId)!;
      app.repos.bases.updateEconomy(base.id, {
        ...base.economy,
        payroll: {
          ...base.economy.payroll,
          commitments: { 'someone-else': capacity - room },
        },
      });
    };
    roomOf(wage(sealedAtFirst) + wage(sealedAtSecond));

    expect((await bid(app, player, first.recruitId, first.nextBid)).statusCode).toBe(200);
    vi.setSystemTime(SEALED);
    const locked = await seal(app, player, first.recruitId, sealedAtFirst);
    expect(locked.statusCode, locked.body.slice(0, 600)).toBe(200);

    roomOf(wage(sealedAtFirst) + wage(sealedAtSecond) - 1);
    const short = await seal(app, player, second.recruitId, sealedAtSecond);
    expect(short.statusCode).toBe(409);
    expect(errorOf(short.body).message).toContain('payroll');

    roomOf(wage(sealedAtFirst) + wage(sealedAtSecond));
    const exact = await seal(app, player, second.recruitId, sealedAtSecond);
    expect(exact.statusCode, exact.body.slice(0, 600)).toBe(200);
  });

  it('has no way to take a bid back', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'no_withdraw');
    const { auction } = openTable(await readBar(app, player));
    expect((await bid(app, player, auction.recruitId, auction.nextBid)).statusCode).toBe(200);
    const withdrawn = await app.inject({
      method: 'POST',
      url: '/api/bar/withdraw',
      headers: { authorization: `Bearer ${player.token}` },
      payload: { recruitId: auction.recruitId },
    });
    expect(withdrawn.statusCode).toBe(404);
    expect((await readBar(app, player)).auctionsUsed).toBe(1);
  });

  it('takes no open bid once the table seals, and no lock before it does', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'late_bidder');
    const { auction } = openTable(await readBar(app, player));

    // Before the last half hour there is nothing to lock: the open bid is the only move.
    const early = await seal(app, player, auction.recruitId, auction.reserve);
    expect(early.statusCode).toBe(409);
    expect(errorOf(early.body).message).toContain('Nothing is sealed yet');

    vi.setSystemTime(SEALED);
    const late = await bid(app, player, auction.recruitId, auction.reserve);
    expect(late.statusCode).toBe(409);
    expect(errorOf(late.body).code).toBe('BID_REFUSED');
    expect(errorOf(late.body).message).toBe('The table is sealed. Lock a final value instead');
    expect((await readBar(app, player)).auctions[0]?.phase).toBe('sealed');
  });

  it('takes one sealed value, refuses a second, and refuses one that cannot win', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'sealed_one');
    const two = await makePlayer(app, 'sealed_two');
    const { auction } = openTable(await readBar(app, one));
    expect((await bid(app, one, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    vi.setSystemTime(SEALED);
    // A value under the leading open bid cannot win, so it is refused rather than banked.
    const doomed = await seal(app, two, auction.recruitId, auction.reserve - 1);
    expect(doomed.statusCode).toBe(409);
    expect(errorOf(doomed.body).message).toContain(String(auction.reserve));

    // A crew with no open bid may still lock one: that is what the sealed phase is for.
    const locked = await seal(app, two, auction.recruitId, auction.reserve + 20);
    expect(locked.statusCode, locked.body.slice(0, 300)).toBe(200);
    expect(locked.json<BidResponse>().auction.yourSealed).toBe(auction.reserve + 20);
    expect(locked.json<BidResponse>().auctionsUsed, 'a lock is a table too').toBe(1);

    const twice = await seal(app, two, auction.recruitId, auction.reserve + 200);
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice.body).message).toContain('locked your final value');

    // And nobody else can see it. The leader still reads an open table with one bid on it.
    const theirs = (await readBar(app, one)).auctions.find(
      (entry) => entry.recruitId === auction.recruitId,
    );
    expect(theirs?.yourSealed).toBeNull();
    expect(theirs?.bids).toHaveLength(1);
    expect(theirs?.bidders, 'the count is the one hint that somebody is there').toBe(2);
  });

  it('404s a recruit who is not at the Bar today (§H2)', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'stale_operator');
    const yesterday = recruitId('1999-01-01', 0);
    expect(findBarRecruit('1999-01-01', yesterday), 'the id is well formed').toBeDefined();

    expect((await bid(app, player, yesterday, 50)).statusCode).toBe(404);
  });

  it('refuses a bid with every bed taken, and says so on the read first', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'bedless');
    const { auction } = openTable(await readBar(app, player));

    fillEveryBed(app, player.baseId);
    expect((await readBar(app, player)).bedsFree).toBe(0);
    const refused = await bid(app, player, auction.recruitId, auction.reserve);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused.body)).toMatchObject({
      code: 'NO_UNIT_SLOTS',
      message: NO_FREE_BED_TEXT,
    });
  });

  it('needs a base: bidding from nowhere is a 409, not a crash', async () => {
    const { app } = await makeApp();
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'baseless', password: 'hunter2pass' },
    });
    const token = register.json<{ token: string }>().token;
    const res = await app.inject({
      method: 'GET',
      url: '/api/bar',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res.body).code).toBe('NO_BASE');
  });

  it('is behind authentication', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/bar' })).statusCode).toBe(401);
  });

  it('reports slots, crew standing and an empty roster of officers to a fresh player', async () => {
    const { app } = await makeApp();
    const bar = await readBar(app, await makePlayer(app, 'fresh_operator', { shut: true }));

    expect(bar.slotsUsed).toBe(0);
    expect(bar.slotsTotal).toBe(playerLevelGrants(1).recruitSlots);
    expect(bar.officers).toEqual([]);
    expect(bar.filledRoles).toEqual([]);
    expect(bar.notoriety).toBe(0);
    expect(bar.level).toBe(1);
    expect(bar.infamy).toBe(0);
    expect(bar.payroll.capacity).toBeGreaterThan(0);
    expect(bar.payroll.committed).toBe(0);
    expect(bar.results, 'nobody bid yesterday').toEqual([]);
    // One table per recruit, in roster order, so a card and its table are the same index.
    expect(bar.auctions.map((auction) => auction.recruitId)).toEqual(
      bar.recruits.map((recruit) => recruit.id),
    );
  });

  it('prices only the recruits who are interested (§H7)', async () => {
    const { app } = await makeApp();
    const bar = await readBar(app, await makePlayer(app, 'pricing_operator'));
    for (const recruit of bar.recruits) {
      expect(recruit.askingWage === null).toBe(!recruit.assessment.interested);
      if (recruit.askingWage !== null) expect(recruit.askingWage).toBeGreaterThan(0);
    }
    expect(bar.recruits.some((r) => r.askingWage !== null)).toBe(true);
  });

  // Research stopped paying officer slots (maintainer, 2026-10-01): the Bar's total is the level's.
  it('seats no more once Succession Planning is finished', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'planning_operator');
    const base = app.repos.bases.findById(player.baseId);
    if (!base) throw new Error('no base');
    const before = (await readBar(app, player)).slotsTotal;
    expect(before).toBe(playerLevelGrants(base.level).recruitSlots);

    // The two rungs that used to add a slot pay a universal bonus now.
    app.repos.bases.updateResearch(base.id, {
      ...base.research,
      technologies: [
        ...base.research.technologies,
        'tech_succession_planning',
        'tech_the_growth_curve',
      ],
    });
    expect((await readBar(app, player)).slotsTotal).toBe(before);
  });

  /*
   * Maintainer, 2026-09-30: a crew over its slots (a save from before the ladder) keeps everyone,
   * and the table says so rather than only "no room".
   */
  it('refuses a crew over its slots a table, keeps its officers, and says why', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'over_the_limit');
    const base = app.repos.bases.findById(player.baseId);
    if (!base) throw new Error('no base');
    const held = [
      createCommander('held-1', 'One', 'cartographer', {}),
      createCommander('held-2', 'Two', 'trader', {}),
      createCommander('held-3', 'Three', null, {}),
    ];
    app.repos.bases.updateCommanders(base.id, held);

    const bar = await readBar(app, player);
    expect(bar.slotsUsed).toBe(3);
    expect(bar.slotsTotal).toBe(1);
    const refused = await bid(app, player, openTable(bar).auction.recruitId, bar.bidCeiling);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused.body).code).toBe('NO_RECRUIT_SLOTS');
    expect(errorOf(refused.body).message).toContain('The officers you hold stay');
    expect(app.repos.bases.findById(base.id)?.commanders.map((one) => one.id)).toEqual(
      held.map((one) => one.id),
    );
  });

  /** §H7a: nobody leaves the room before midnight, whatever anybody has bid. */
  it('leaves the room exactly as it was when somebody bids in it', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'room_one');
    const two = await makePlayer(app, 'room_two');
    const before = await readBar(app, one);
    const { auction } = openTable(before);
    expect((await bid(app, one, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    const after = await readBar(app, one);
    const bystander = await readBar(app, two);
    expect(after.recruits.map((r) => r.id)).toEqual(before.recruits.map((r) => r.id));
    expect(bystander.recruits.map((r) => r.id)).toEqual(before.recruits.map((r) => r.id));
    expect(after.recruits).toHaveLength(BAR_ROSTER_SIZE);
  });

  it('rotates the whole room at midnight', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'midnight_operator');
    const today = await readBar(app, player);

    vi.setSystemTime(AFTER);
    const tomorrow = await readBar(app, player);
    expect(tomorrow.day).not.toBe(today.day);
    const yesterdays = new Set(today.recruits.map((r) => r.id));
    expect(tomorrow.recruits.some((r) => yesterdays.has(r.id))).toBe(false);
  });
});

describe('§H7a: the close', () => {
  /** Reads a player's bell. */
  const bell = (app: FastifyInstance, player: Player): Notification[] =>
    app.repos.social.notifications(player.userId, 50);

  it('signs the highest final onto the bench, and tells everybody at the table', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'closing_one');
    const two = await makePlayer(app, 'closing_two');

    const bar = await readBar(app, one);
    const { auction, name } = openTable(bar);
    expect((await bid(app, one, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    // The snipe: no open bid at all, one locked value in the last half hour.
    vi.setSystemTime(SEALED);
    const price = auction.reserve + 25;
    expect((await seal(app, two, auction.recruitId, price)).statusCode).toBe(200);

    // What the winner's book will be charged: the price after their own negotiators (§H7). Read
    // off the crew as it stands *before* the close, which is the fold `signRecruit` reads.
    const crew = app.repos.bases.findById(two.baseId);
    if (!crew) throw new Error('no base');
    const charged = committedWage(price, crewEffectsFor(app.repos, crew).wageDiscountPercent);

    // The loser opens the Bar first, so the close is not run by the crew it pays.
    vi.setSystemTime(AFTER);
    const loser = await readBar(app, one);
    const winner = await readBar(app, two);

    expect(winner.slotsUsed).toBe(1);
    expect(winner.officers[0]?.commander.name).toBe(name);
    expect(winner.officers[0]?.commander.role, 'the close signs to the bench').toBeNull();
    expect(winner.officers[0]?.weeklyWage).toBe(charged);
    expect(winner.payroll.committed).toBe(charged);
    expect(winner.filledRoles).toEqual([]);
    expect(loser.slotsUsed).toBe(0);

    // …and they are in the crew, which is the screen a player goes to next.
    const roster = await app.inject({
      method: 'GET',
      url: '/api/crew',
      headers: { authorization: `Bearer ${two.token}` },
    });
    expect(roster.json<CrewResponse>().officers.map((entry) => entry.name)).toContain(name);

    // §I1: signing somebody pays, even when the decision was made hours earlier at a table.
    const paid = app.repos.bases.findById(two.baseId);
    expect(paid?.progression.xpIntoLevel).toBeGreaterThan(0);

    // Both of them are told, and told different things.
    const won = bell(app, two).find((entry) => entry.kind === 'officer_hired');
    expect(won?.title).toBe(
      charged === price
        ? `${name} signed with you at ${price} caps`
        : `${name} signed with you: won at ${price.toLocaleString('en')}, on the books at ${charged.toLocaleString('en')} caps`,
    );
    const outbid = bell(app, one).find((entry) => entry.kind === 'bar_outbid');
    expect(outbid?.title).toBe(
      `${name} went to ${two.username} for ${price.toLocaleString('en')} caps`,
    );

    // And the results panel says the same thing from each side.
    expect(loser.results).toEqual([
      {
        day: bar.day,
        recruitId: auction.recruitId,
        name,
        outcome: 'lost',
        price,
        winner: two.username,
        yourFinal: auction.reserve,
      },
    ]);
    expect(winner.results[0]).toMatchObject({ outcome: 'won', price, winner: two.username });

    // The table is settled once. A second read must not sign anybody a second time.
    expect((await readBar(app, two)).slotsUsed).toBe(1);
  });

  it('passes a winner with no chair down to the next final', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'chairless');
    const two = await makePlayer(app, 'patient');

    const bar = await readBar(app, one);
    const { auction, name } = openTable(bar);
    expect((await bid(app, two, auction.recruitId, auction.reserve)).statusCode).toBe(200);
    const top = (await readBar(app, one)).auctions.find(
      (entry) => entry.recruitId === auction.recruitId,
    );
    expect((await bid(app, one, auction.recruitId, top?.nextBid ?? 0)).statusCode).toBe(200);

    // The highest bidder fills every chair after bidding. The close has to notice.
    fillEveryChair(app, one.baseId, 'sitting');

    const runnerUp = app.repos.bases.findById(two.baseId);
    if (!runnerUp) throw new Error('no base');
    const charged = committedWage(
      auction.reserve,
      crewEffectsFor(app.repos, runnerUp).wageDiscountPercent,
    );

    vi.setSystemTime(AFTER);
    const passed = await readBar(app, one);
    const took = await readBar(app, two);

    expect(took.officers.map((entry) => entry.commander.name)).toContain(name);
    expect(took.officers.find((entry) => entry.commander.name === name)?.weeklyWage).toBe(charged);
    expect(passed.officers.map((entry) => entry.commander.name)).not.toContain(name);
    expect(passed.results[0]).toMatchObject({ outcome: 'passed', winner: two.username });
    expect(took.results[0]).toMatchObject({ outcome: 'won' });
  });

  it('passes a winner with no bed down to the next final', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'bedless_leader');
    const two = await makePlayer(app, 'housed_runner');

    const { auction, name } = openTable(await readBar(app, one));
    expect((await bid(app, two, auction.recruitId, auction.reserve)).statusCode).toBe(200);
    const top = (await readBar(app, one)).auctions.find(
      (entry) => entry.recruitId === auction.recruitId,
    );
    expect((await bid(app, one, auction.recruitId, top?.nextBid ?? 0)).statusCode).toBe(200);

    // The highest bidder musters into every bed after bidding. The close has to notice.
    fillEveryBed(app, one.baseId);

    vi.setSystemTime(AFTER);
    const passed = await readBar(app, one);
    const took = await readBar(app, two);

    expect(passed.officers.map((entry) => entry.commander.name)).not.toContain(name);
    expect(took.officers.map((entry) => entry.commander.name)).toContain(name);
    expect(passed.results[0]).toMatchObject({ outcome: 'passed', winner: two.username });
  });

  /**
   * The close reads the crew as it stands at midnight, not as it stood at its last request (bug
   * pass, 2026-09-29). A build finishes on the next settle, and the world clock runs the close
   * without settling anybody, so a Quarters rung done at eleven still had not housed anyone: the
   * winner was judged bedless and passed over for a bed they had. The barrow's close settled its
   * winner since 2026-09-28; the Bar's did not.
   */
  it('settles the winner before it judges them: a Quarters rung done before midnight is a bed', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'late_builder');

    const { auction, name } = openTable(await readBar(app, one));
    expect((await bid(app, one, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    // Every bed taken after the bid, and one more Quarters rung ordered that lands at 23:00 Athens.
    fillEveryBed(app, one.baseId);
    const base = app.repos.bases.findById(one.baseId);
    if (!base) throw new Error('no base');
    const quarters = base.buildings.find((building) => building.kind === 'quarters')?.level ?? 0;
    app.repos.bases.updateDistrict(base.id, base.buildings, [
      {
        id: 'quarters-order',
        kind: 'quarters',
        level: quarters + 1,
        startedAt: NOW.toISOString(),
        durationSeconds: 11 * 3600,
        paid: {},
        parts: {},
      },
    ]);

    // The world clock gets there first, as it does on a live server: nobody has read this crew.
    vi.setSystemTime(AFTER);
    settleBarAuctions(app.repos, AFTER);

    const signed = app.repos.bases.findById(one.baseId);
    expect(signed?.commanders.map((officer) => officer.name)).toContain(name);
  });

  /**
   * Maintainer, 2026-09-29: an admin bid the table accepted wins at the close. Measured before the
   * fix: a crew with every chair filled bid in admin mode, was accepted, and read "Passed" in the
   * morning with nobody signed. Both doors into the close are driven, the Bar's own read and the
   * world clock, because whichever reaches the table first after midnight is the one that closes it.
   */
  describe('in admin mode, the close waives what the table waived', () => {
    async function aloneAtAFullTable(admin: boolean) {
      const { app } = await makeApp({ admin });
      const player = await makePlayer(app, admin ? 'admin_full_house' : 'plain_full_house');
      const { auction, name } = openTable(await readBar(app, player));
      if (admin) {
        // Full before the bid: the table waives the chair in admin mode, so it takes the bid.
        fillEveryChair(app, player.baseId, 'sitter');
        expect((await bid(app, player, auction.recruitId, auction.reserve)).statusCode).toBe(200);
      } else {
        // The ordinary table refuses a full crew, so the chairs fill after the bid.
        expect((await bid(app, player, auction.recruitId, auction.reserve)).statusCode).toBe(200);
        fillEveryChair(app, player.baseId, 'sitter');
      }
      vi.setSystemTime(AFTER);
      return { app, player, name };
    }

    it('signs the lone bidder when the Bar is read after midnight', async () => {
      const { app, player, name } = await aloneAtAFullTable(true);
      const bar = await readBar(app, player);
      expect(bar.officers.map((entry) => entry.commander.name)).toContain(name);
      expect(bar.results[0]).toMatchObject({ outcome: 'won' });
    });

    it('signs the lone bidder when the world clock gets there first', async () => {
      const { app, player, name } = await aloneAtAFullTable(true);
      tickWorld(app.repos, app.skirmishEngine, AFTER, true);
      const signed = app.repos.bases.findById(player.baseId);
      expect(signed?.commanders.map((officer) => officer.name)).toContain(name);
    });

    it('still passes over a full crew when admin mode is off', async () => {
      const { app, player, name } = await aloneAtAFullTable(false);
      const bar = await readBar(app, player);
      expect(bar.officers.map((entry) => entry.commander.name)).not.toContain(name);
      expect(bar.results[0]).toMatchObject({ outcome: 'passed' });
    });
  });

  /**
   * Two crews outbid the winner and neither could take the person. The second of them used to read
   * "lost", with a winning price under their own final on the same line. Passed is anybody the
   * ranking walked past on the way to the crew that signed.
   */
  it('tells every crew the ranking walked past that it passed, not only the top one', async () => {
    const { app } = await makeApp();
    const first = await makePlayer(app, 'walked_past_first');
    const second = await makePlayer(app, 'walked_past_second');
    const third = await makePlayer(app, 'signs_at_the_floor');

    const { auction } = openTable(await readBar(app, first));
    let next = auction.reserve;
    for (const player of [third, second, first]) {
      const placed = await bid(app, player, auction.recruitId, next);
      expect(placed.statusCode).toBe(200);
      next = placed.json<BidResponse>().auction.nextBid;
    }
    fillEveryChair(app, first.baseId, 'first');
    fillEveryChair(app, second.baseId, 'second');

    vi.setSystemTime(AFTER);
    const top = (await readBar(app, first)).results[0];
    const behind = (await readBar(app, second)).results[0];
    const took = (await readBar(app, third)).results[0];

    expect(took).toMatchObject({ outcome: 'won', winner: third.username });
    expect(top).toMatchObject({ outcome: 'passed', winner: third.username });
    expect(behind).toMatchObject({ outcome: 'passed', winner: third.username });
    expect(behind?.yourFinal).toBeGreaterThan(behind?.price ?? Infinity);

    /*
     * The bell tells them the same (bug pass, 2026-09-29). It read "went to them for 300" beside
     * a bid of 500, which is a broken auction rather than a door the crew had shut.
     */
    // With the door that shut, so a crew that out-bid the room knows what to fix (2026-10-02).
    const passedOver = `You could not take ${top?.name} at the close (every officer slot was taken), so ${third.username} did at ${(took?.price ?? 0).toLocaleString('en')} caps`;
    for (const player of [first, second]) {
      const [told] = bell(app, player).filter((entry) => entry.kind === 'bar_outbid');
      expect(told?.title).toBe(passedOver);
    }
  });

  it('leaves a table nobody can take unsold, and does not re-roll the seat', async () => {
    const { app } = await makeApp();
    const one = await makePlayer(app, 'broke_one');
    const two = await makePlayer(app, 'broke_two');

    const bar = await readBar(app, one);
    const { auction, name } = openTable(bar);
    expect((await bid(app, two, auction.recruitId, auction.reserve)).statusCode).toBe(200);
    const top = (await readBar(app, one)).auctions.find(
      (entry) => entry.recruitId === auction.recruitId,
    );
    expect((await bid(app, one, auction.recruitId, top?.nextBid ?? 0)).statusCode).toBe(200);

    // Both crews fill every chair after bidding, so the ranking runs out of takers.
    for (const player of [one, two]) fillEveryChair(app, player.baseId, player.username);

    vi.setSystemTime(AFTER);
    const first = await readBar(app, one);
    const second = await readBar(app, two);

    expect(first.officers.map((entry) => entry.commander.name)).not.toContain(name);
    expect(second.officers.map((entry) => entry.commander.name)).not.toContain(name);
    // The crew that led it hears that it went nowhere; the one behind them hears it went unsold.
    expect(first.results[0]).toMatchObject({ outcome: 'passed', price: null, winner: null });
    expect(second.results[0]).toMatchObject({ outcome: 'unsold', price: null, winner: null });
    // ...and the bells say the same two things (bug pass, 2026-09-29).
    expect(bell(app, one)[0]?.title).toBe(
      `You could not take ${name} at the close (every officer slot was taken), and nobody else could either`,
    );
    expect(bell(app, two)[0]?.title).toBe(`${name} went unsigned`);
    // The room is whole: nobody was replaced, the day simply ended.
    expect(second.recruits).toHaveLength(BAR_ROSTER_SIZE);
    expect(second.recruits.map((entry) => entry.id)).not.toContain(auction.recruitId);
  });
});

/**
 * §H7a: a tie goes to a coin, and the coin is a hash rather than a draw.
 *
 * Driven against two databases built in opposite order on purpose. Whoever is first in the rows is
 * the winner under any "first bid wins" rule, so a settle that quietly resolved ties by row order
 * would hand the two runs two different crews. Everything else about the two worlds is identical:
 * the day, the seat, the user ids and the two equal finals.
 */
/**
 * §I2: the two things the Bar has to run before it answers, and the one it has to say.
 *
 * The close is the Bar's own clock and it moves state every route here reads: it fills a chair, it
 * commits a wage, and signing somebody pays XP. Two halves were missing.
 *
 *   * `BarResponse.levelUp` has been on the wire since §I2 and the screen has latched it since it
 *     shipped, and nothing on the server ever filled it in. The close runs on this read, so this
 *     read is very often the only thing in the game that knows a level was crossed: the marker
 *     stays banked and the card is announced by whichever poll happens to drain it next.
 *   * `POST /bar/bid` and `POST /bar/seal` did not settle at all. Every other Bar route did, so
 *     which door a player came through decided whether the officer they won overnight was on the
 *     books yet.
 */
describe('§I2: the Bar settles before it answers', () => {
  it('announces the level the close paid for, exactly once', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'levelling_up');

    const bar = await readBar(app, player);
    const { auction } = openTable(bar);
    expect((await bid(app, player, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    // One point short of the next level, so the close's own `officerHired` award is what crosses
    // it and nothing else on the read can be what this is measuring.
    const before = app.repos.bases.findById(player.baseId);
    if (!before) throw new Error('fixture: no base');
    app.repos.bases.updateProgression(before.id, before.level, {
      xpIntoLevel: playerXpToNextLevel(before.level) - 1,
    });

    vi.setSystemTime(AFTER);
    const announced = await readBar(app, player);
    expect(announced.slotsUsed, 'fixture: nobody was signed, so nothing paid').toBe(1);
    expect(announced.levelUp?.level).toBe(before.level + 1);
    expect(announced.levelUp?.levelsGained).toBe(1);

    // Drained, so the shell's own poll cannot draw the same card a second time.
    expect((await readBar(app, player)).levelUp).toBeUndefined();
  });

  it('runs last night before it looks at a bid, even one it is about to refuse', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'overnight_winner');

    const bar = await readBar(app, player);
    const { auction, name } = openTable(bar);
    expect((await bid(app, player, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    vi.setSystemTime(AFTER);
    // Nothing reads the Bar and no world clock runs: the only thing to touch the server since
    // midnight is this bid, and it names a seat from a roster that no longer exists.
    const stale = await bid(app, player, recruitId(bar.day, 0), auction.reserve);
    expect(stale.statusCode).toBe(404);

    const signed = app.repos.bases.findById(player.baseId);
    expect(signed?.commanders.map((officer) => officer.name)).toEqual([name]);
  });
});

describe('a tie at the close', () => {
  const DAY = '2026-08-12';

  function tiedWorld(order: readonly string[]): { winner: string | null; db: AppDatabase } {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const repos = createRepositories(db);

    for (const userId of ['user_a', 'user_b']) {
      repos.users.insert({
        id: userId,
        username: userId,
        passwordHash: 'x',
        createdAt: NOW.toISOString(),
      });
      repos.bases.insert(makeBase({ id: `base-${userId}`, ownerId: userId }));
    }
    // Read off the room the close rebuilds the recruit from. Two crews past the Bar's level move
    // the city's room off the flat one, and a reserve priced off a different room is a table
    // nobody's bid clears.
    const recruit = barRoster(DAY, barRoomOf(repos, DEFAULT_CITY_ID, DAY))[0];
    if (!recruit) throw new Error('empty roster');
    for (const userId of order) {
      repos.bar.placeOpenBid({
        day: DAY,
        recruitId: recruit.id,
        userId,
        baseId: `base-${userId}`,
        amount: reserveFor(recruit),
        at: `${DAY}T09:00:00.000Z`,
      });
    }

    settleBarAuctions(repos, NOW);
    const [result] = repos.bar.results(DAY);
    return { winner: result?.winnerUserId ?? null, db };
  }

  it('picks the same crew whichever of them bid first', () => {
    const forwards = tiedWorld(['user_a', 'user_b']);
    const backwards = tiedWorld(['user_b', 'user_a']);
    try {
      expect(forwards.winner, 'a tie still has to be won by somebody').not.toBeNull();
      expect(backwards.winner).toBe(forwards.winner);
      // And exactly one of them got them: a tie is not two contracts.
      const held = (db: AppDatabase, userId: string) =>
        createRepositories(db).bases.findByOwnerId(userId)?.commanders.length ?? 0;
      expect(held(forwards.db, 'user_a') + held(forwards.db, 'user_b')).toBe(1);
    } finally {
      forwards.db.close();
      backwards.db.close();
    }
  });
});

describe('0006_recruitment.sql', () => {
  const MIGRATIONS = fileURLToPath(new URL('../db/migrations/', import.meta.url));

  /** A database migrated all the way, then rewound so `0006` will run again on the next call. */
  function rewoundToBefore0006(): AppDatabase {
    const db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS);
    // Both, and in that order. 0006 added the §H4/§H5/§H6 fields and 0043 took them away again
    // when those mechanics were cut, so replaying only the first leaves the officer in a middle
    // state no live save ever stops at. What a genuinely old save goes through is the pair.
    // 0042 is deliberately not in this list: it renames a column, and DDL does not replay.
    for (const name of ['0006_recruitment.sql', '0043_officer_perks.sql']) {
      db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(name);
    }
    return db;
  }

  function plantBase(db: AppDatabase, id: string, commanders: unknown[]): void {
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run(`${id}-user`, `${id}-user`, 'x', NOW.toISOString());
    db.prepare(
      `INSERT INTO bases (id, owner_id, name, district_id, level, is_bot,
         resources_json, economy_json, progression_json, buildings_json, commanders_json, created_at)
       VALUES (?, ?, ?, 'neon-docks', 1, 0, ?, ?, ?, '[]', ?, ?)`,
    ).run(
      id,
      `${id}-user`,
      'Legacy Hold',
      JSON.stringify({ caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 }),
      JSON.stringify(startingEconomy(NOW.toISOString())),
      JSON.stringify(startingProgression()),
      JSON.stringify(commanders),
      NOW.toISOString(),
    );
  }

  function commandersOf(db: AppDatabase, id: string): Commander[] {
    const row = db.prepare('SELECT commanders_json FROM bases WHERE id = ?').get(id) as {
      commanders_json: string;
    };
    return JSON.parse(row.commanders_json) as Commander[];
  }

  const legacyOfficer = {
    id: 'legacy-1',
    name: 'Pre-H Officer',
    role: 'master_of_whispers',
    attributes: Object.fromEntries(ATTRIBUTE_NAMES.map((n) => [n, 20])),
    traits: ['gutter_born'],
  };

  /*
   * 0006 added the §H4/§H5/§H6 fields to legacy officers; 0042 took them away again when those
   * mechanics were cut. Running the pair is the honest test, because that is what a save from
   * before either of them actually goes through, and the property that matters is unchanged: the
   * row parses with the schema the read path uses.
   */
  it('carries an officer stored before §H4 all the way to the perk-era schema', () => {
    const db = rewoundToBefore0006();
    plantBase(db, 'legacy-base', [{ ...legacyOfficer, askingWage: 44 }]);
    expect(replayMigrations(db, MIGRATIONS)).toEqual([
      '0006_recruitment.sql',
      '0043_officer_perks.sql',
    ]);

    const [migrated] = commandersOf(db, 'legacy-base');
    expect(migrated).toMatchObject({
      id: 'legacy-1',
      name: 'Pre-H Officer',
      role: 'master_of_whispers',
    });
    // The fee follows the rename. Defaulting it would hand this crew a roster that works free.
    expect(migrated?.weeklyWage, 'the agreed fee survived the rename').toBe(44);
    // No honest mapping from a trait to a perk, so they start empty rather than being handed
    // bonuses nobody offered them.
    expect(migrated?.perks).toEqual([]);
    expect(migrated?.attributes.stealth, 'the existing sheet survives untouched').toBe(20);
    // The whole point: the row now parses with the schema the read path actually uses.
    expect(() => CommanderSchema.parse(migrated)).not.toThrow();
    db.close();
  });

  /**
   * An empty roster stays empty, and an officer who is already in the new shape is left alone.
   *
   * The second half is the one that matters, because `0043` rewrites every officer object in the
   * column rather than patching missing keys. Without the `COALESCE` on both fields it would reset
   * a hired officer's perks to `[]` and their fee back to the opening price on any replay, which
   * is one restore away from being a live data loss rather than a hypothetical one.
   */
  it('leaves an empty roster alone and does not undo an officer already in the new shape', () => {
    const db = rewoundToBefore0006();
    const already = createCommander(
      'kept-1',
      'Already Migrated',
      'cartographer',
      {},
      ['skim_route'],
      30,
    );
    plantBase(db, 'empty-base', []);
    plantBase(db, 'kept-base', [already]);
    replayMigrations(db, MIGRATIONS);

    expect(commandersOf(db, 'empty-base')).toEqual([]);
    expect(commandersOf(db, 'kept-base')[0]).toMatchObject({
      id: 'kept-1',
      perks: ['skim_route'],
      weeklyWage: 30,
    });
    db.close();
  });
});

/**
 * §H2a: the person on the card is the person you sign.
 *
 * The roster is generated at the city's average level (`barCalibre`), which is how a mature city
 * gets better people through the door. The hire and negotiate routes used to resolve the same id at
 * level 0, so at a grown-up Bar the sheet on the card and the sheet on the contract were two
 * different people wearing one id. Nothing failed: both are legitimate recruits.
 */
describe('§H2a: the Bar gets better as the city does', () => {
  /** Puts real levels on the map so `averageLevel()` is well above the calibre floor. */
  const growTheCity = (app: FastifyInstance, level: number) => {
    for (const summary of app.repos.bases.listSummaries()) {
      const base = app.repos.bases.findById(summary.id);
      if (!base) continue;
      app.repos.bases.updateProgression(base.id, level, base.progression);
    }
  };

  /**
   * On the next game day: the room is frozen at the day's first read since 2026-09-28
   * (`bar/room.ts`), so a city that levels at noon changes tomorrow's room and not today's. Held
   * against the same people poured at yesterday's profile, so the gain is the city's and not a
   * different night's luck.
   */
  it('offers a stronger room once the city has levelled', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'young_city');
    const before = await readBar(app, player);
    const yesterday = app.repos.bar.room(before.day, before.cityId);
    if (!yesterday) throw new Error('the first read froze no room');

    growTheCity(app, 30);
    vi.setSystemTime(AFTER);
    const after = await readBar(app, player);
    const unmoved = barRoster(after.day, yesterday, after.cityId);

    const mean = (recruits: readonly { attributes: Record<string, number> }[]) =>
      recruits.reduce(
        (total, recruit) => total + Object.values(recruit.attributes).reduce((a, b) => a + b, 0),
        0,
      ) / recruits.length;
    expect(mean(after.recruits)).toBeGreaterThan(mean(unmoved));
  });

  /**
   * The bug this exists for: the card and the contract must be the same sheet.
   *
   * Asserted against the *signed officer's* attributes rather than against a second read of the
   * roster, because that is the copy that ends up on the payroll for good.
   */
  it('signs the recruit that was on the card, not a level-1 version of them', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'mature_city');
    growTheCity(app, 30);
    const base = app.repos.bases.findById(player.baseId);
    if (!base) throw new Error('no base');
    // A level-30 room prices above a starting book, and this test is not about the book.
    app.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      // 400 flat expansions of 30: 12,000 of room.
      payroll: { ...base.economy.payroll, purchasedSteps: 400 },
    });

    const bar = await readBar(app, player);
    const target = bar.recruits.find((r) => r.assessment.interested);
    const auction = bar.auctions.find((entry) => entry.recruitId === target?.id);
    if (!target || !auction) throw new Error('expected an interested recruit');
    expect((await bid(app, player, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    vi.setSystemTime(AFTER);
    const after = await readBar(app, player);
    const signed = after.officers.find((officer) => officer.commander.name === target.name);
    expect(signed, 'the won officer should be on the roster').toBeDefined();
    expect(signed?.commander.attributes).toEqual(target.attributes);
  });
});

/**
 * §H7a: the auction has one floor, and it is the city's. The contract is not.
 *
 * `wageDiscountPercent` is fed by four perks, two attributes and a technology. It cannot come off
 * the asking price any more: two crews bidding against each other have to be bidding against the
 * same number, or the same offer is legal for one of them and under the floor for the other, and
 * the close has to choose which of two reserves the ranking is measured against.
 *
 * It comes off the **contract** instead, at the close, for the winner alone. Both halves are
 * tested here: the card and the floor are the city's number, and the book entry is not.
 */
describe('what a table opens at (§H7)', () => {
  function crewWith(perks: string[]): { repos: Repositories; base: Base } {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const repos = createRepositories(db);
    repos.users.insert({
      id: 'user-1',
      username: 'Haggler',
      passwordHash: 'x',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const base = makeBase({
      commanders: [createCommander('neg-1', 'Ada Vance', 'professor', {}, perks)],
    });
    repos.bases.insert(base);
    return { repos, base };
  }

  it('quotes the same asking price to a crew with a negotiator and one without', () => {
    const { repos, base } = crewWith(['union_rep']);
    const [recruit] = barRoster('2026-08-13');
    if (!recruit) throw new Error('empty roster');

    const discount = crewEffectsFor(repos, base).wageDiscountPercent;
    expect(discount, 'the Union Rep is still worth something on the channel').toBeGreaterThan(0);
    // …and it is worth nothing at the Bar, on the card or at the floor.
    expect(projectRecruit(base, recruit).askingWage).toBe(
      askingWage(recruit.attributes, 0, recruit.perks),
    );
    expect(reserveFor(recruit)).toBe(
      reservationWage(askingWage(recruit.attributes, 0, recruit.perks)),
    );
  });

  it('charges the book the price the winner talked down, and tells everybody the price', async () => {
    const { app } = await makeApp();
    const plain = await makePlayer(app, 'no_negotiator');
    const haggler = await makePlayer(app, 'union_shop');
    raiseTo(app, haggler, TWO_SLOT_LEVEL);

    // A negotiator already on the books. Their own wage is zero, so the book shows the new
    // contract and nothing else.
    const base = app.repos.bases.findById(haggler.baseId);
    if (!base) throw new Error('no base');
    app.repos.bases.updateCommanders(base.id, [
      createCommander('neg-1', 'Ada Vance', 'trader', {}, ['union_rep'], 0),
    ]);
    const discount = crewEffectsFor(app.repos, {
      ...base,
      commanders: [createCommander('neg-1', 'Ada Vance', 'trader', {}, ['union_rep'], 0)],
    }).wageDiscountPercent;
    expect(discount, 'the perk has to be worth something or this proves nothing').toBeGreaterThan(
      0,
    );

    const bar = await readBar(app, plain);
    const { auction, name } = openTable(bar);
    expect((await bid(app, plain, auction.recruitId, auction.reserve)).statusCode).toBe(200);
    const table = (await readBar(app, haggler)).auctions.find(
      (entry) => entry.recruitId === auction.recruitId,
    );
    if (!table) throw new Error('the table went missing');
    const price = table.nextBid;
    expect((await bid(app, haggler, auction.recruitId, price)).statusCode).toBe(200);

    vi.setSystemTime(AFTER);
    const lost = await readBar(app, plain);
    const won = await readBar(app, haggler);

    // The book, and only the book, is charged the talked-down figure.
    const charged = committedWage(price, discount);
    expect(charged).toBeLessThan(price);
    const officer = won.officers.find((entry) => entry.commander.name === name);
    expect(officer?.weeklyWage).toBe(charged);
    expect(won.payroll.committed).toBe(charged);

    // Everything the rest of the city reads is the number the table closed at.
    expect(won.results[0]).toMatchObject({ outcome: 'won', price });
    expect(lost.results[0]).toMatchObject({ outcome: 'lost', price, winner: haggler.username });
    expect(
      app.repos.social
        .notifications(haggler.userId, 50)
        .find((entry) => entry.kind === 'officer_hired')?.title,
      // The winner's own bell adds what their book was charged (bug pass, 2026-10-02): the Crew
      // page and the dismissal fee read that figure, and the bid alone read as the wage.
    ).toBe(
      `${name} signed with you: won at ${price.toLocaleString('en')}, on the books at ${charged.toLocaleString('en')} caps`,
    );
    expect(
      app.repos.social.notifications(plain.userId, 50).find((entry) => entry.kind === 'bar_outbid')
        ?.title,
    ).toBe(`${name} went to ${haggler.username} for ${price.toLocaleString('en')} caps`);
  });

  /**
   * The ceiling on the wire is the one the gate enforces. A screen that capped the field at the
   * raw book refused bids the server would have taken, and one that did not cap it drew a refusal
   * the player could not read off any number on the page.
   */
  it('quotes a bid ceiling the book holds after the talk-down, and refuses one cap over it', async () => {
    const { app } = await makeApp();
    const haggler = await makePlayer(app, 'ceiling_shop');
    raiseTo(app, haggler, TWO_SLOT_LEVEL);
    const base = app.repos.bases.findById(haggler.baseId);
    if (!base) throw new Error('no base');
    app.repos.bases.updateCommanders(base.id, [
      createCommander('neg-1', 'Ada Vance', 'trader', {}, ['union_rep'], 0),
    ]);

    const bar = await readBar(app, haggler);
    const discount = crewEffectsFor(
      app.repos,
      app.repos.bases.findById(base.id)!,
    ).wageDiscountPercent;
    expect(discount).toBeGreaterThan(0);
    expect(bar.bidCeiling).toBe(bidCeilingFor(bar.payroll.available, discount));
    expect(bar.bidCeiling).toBeGreaterThan(bar.payroll.available);
    expect(committedWage(bar.bidCeiling, discount)).toBeLessThanOrEqual(bar.payroll.available);
    expect(committedWage(bar.bidCeiling + 1, discount)).toBeGreaterThan(bar.payroll.available);

    // The table with the lowest floor, so the ceiling is the only thing in the way.
    const table = openTables(bar).sort((a, b) => a.reserve - b.reserve)[0];
    if (!table) throw new Error('no open table');
    expect(table.reserve).toBeLessThanOrEqual(bar.bidCeiling);
    const over = await bid(app, haggler, table.recruitId, bar.bidCeiling + 1);
    expect(over.statusCode).toBe(409);
    expect(errorOf(over.body).code).toBe('NO_PAYROLL');
    expect((await bid(app, haggler, table.recruitId, bar.bidCeiling)).statusCode).toBe(200);
  });

  /**
   * Past the cap on the talk-down. A late crew's wage channel reaches 119 (see `committedWage`),
   * which the contract clamps to half off, so the ceiling has to clamp the same way: it read the
   * raw figure, found nothing left to pay, and quoted the bare book, half of what the gate takes.
   */
  it('quotes the ceiling off the capped talk-down, however big the raw channel is', () => {
    for (const discount of [MAX_WAGE_DISCOUNT, 100, 119]) {
      const ceiling = bidCeilingFor(200, discount);
      expect(committedWage(ceiling, discount), `at ${discount}`).toBeLessThanOrEqual(200);
      expect(committedWage(ceiling + 1, discount), `at ${discount}`).toBeGreaterThan(200);
    }
    expect(bidCeilingFor(200, 119)).toBe(bidCeilingFor(200, MAX_WAGE_DISCOUNT));
  });

  /** The panel reads the last night the crew sat at a table, not only last night. */
  it('still shows a close two days later, when the crew skipped a night', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'late_riser');
    const bar = await readBar(app, player);
    const { auction } = openTable(bar);
    expect((await bid(app, player, auction.recruitId, auction.reserve)).statusCode).toBe(200);

    vi.setSystemTime(new Date(AFTER.getTime() + 24 * 60 * 60_000));
    const later = await readBar(app, player);
    expect(later.results.map((entry) => entry.outcome)).toEqual(['won']);
    expect(later.results[0]?.day).toBe(bar.day);
  });

  it('is worth more with the perk than the same officer without it', () => {
    const bare = crewWith([]);
    const rep = crewWith(['union_rep']);

    const without = crewEffectsFor(bare.repos, bare.base).wageDiscountPercent;
    const with_ = crewEffectsFor(rep.repos, rep.base).wageDiscountPercent;

    expect(with_).toBeGreaterThan(without);
  });
});

/**
 * §H7: the book always has another expansion for sale, priced in caps (maintainer, 2026-10-01: 300
 * for the first 30, then 360, 420 and on).
 *
 * The screens read `nextStepCost`, but a client is not a rule: the route is what charges the caps,
 * refuses a crew that is short, and keeps selling however much has been bought.
 */
describe('widening the book (§H7)', () => {
  const raise = (app: FastifyInstance, player: Player, fromSteps?: number) =>
    app.inject({
      method: 'POST',
      url: '/api/bar/payroll',
      headers: { authorization: `Bearer ${player.token}` },
      payload: fromSteps === undefined ? {} : { fromSteps },
    });

  /** A crew holding `caps` and `steps` expansions already bought. */
  function setBook(app: FastifyInstance, player: Player, steps: number, caps = 500_000): void {
    const base = app.repos.bases.findById(player.baseId);
    if (!base) throw new Error('no base');
    app.repos.bases.updateResources(base.id, { ...base.resources, caps });
    app.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      payroll: { ...base.economy.payroll, purchasedSteps: steps },
    });
  }

  it('sells the first expansion for 300 caps, leaves the scrap alone, and widens the book by 30', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'book_opener');
    setBook(app, player, 0);
    const before = app.repos.bases.findById(player.baseId)!.resources;
    const capacity = (await readBar(app, player)).payroll.capacity;

    const bought = await raise(app, player, 0);
    expect(bought.statusCode, bought.body.slice(0, 300)).toBe(200);
    const body = bought.json<{
      spent: number;
      resources: { scrap: number; caps: number };
      payroll: { purchasedSteps: number; nextStepCost: number; capacity: number };
    }>();
    expect(body.spent).toBe(300);
    expect(body.payroll.purchasedSteps).toBe(1);
    expect(body.payroll.nextStepCost).toBe(360);
    expect(body.payroll.capacity).toBe(capacity + 30);
    expect(body.resources.scrap).toBe(before.scrap);
    const after = app.repos.bases.findById(player.baseId)!.resources;
    // Caps have no ceiling and production makes none, so the whole difference is the price.
    expect(after.caps).toBe(before.caps - 300);
  });

  it('keeps selling, sixty dearer each time, however many have been bought', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'book_wide');
    setBook(app, player, 300);

    const bought = await raise(app, player, 300);
    expect(bought.statusCode, bought.body.slice(0, 300)).toBe(200);
    expect(bought.json<{ spent: number }>().spent).toBe(payrollStepCost(300));
    expect(payrollStepCost(300)).toBe(18_300);
    expect(
      bought.json<{ payroll: { purchasedSteps: number; nextStepCost: number } }>().payroll,
    ).toMatchObject({ purchasedSteps: 301, nextStepCost: 18_360 });
  });

  it('refuses a crew short of the caps and changes nothing', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'book_short');
    setBook(app, player, 0, payrollStepCost(0) - 1);

    const refused = await raise(app, player, 0);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused.body).code).toBe('INSUFFICIENT_RESOURCES');
    expect(errorOf(refused.body).message).toBe('You need 300 caps to widen the book');
    const after = app.repos.bases.findById(player.baseId)!;
    expect(after.economy.payroll.purchasedSteps).toBe(0);
    expect(after.resources.caps).toBe(299);
  });

  it('refuses a second press for the expansion the first one already bought', async () => {
    const { app } = await makeApp();
    const player = await makePlayer(app, 'book_twice');
    setBook(app, player, 0);

    expect((await raise(app, player, 0)).statusCode).toBe(200);
    const stale = await raise(app, player, 0);
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale.body).code).toBe('STALE_STATE');
    expect(app.repos.bases.findById(player.baseId)!.economy.payroll.purchasedSteps).toBe(1);
  });
});
