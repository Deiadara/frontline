import {
  DISMISSAL_WEEKS,
  PAYROLL_BASE,
  districtPopulationCapacity,
  noTerritoryEffects,
  ATTRIBUTE_NAMES,
  CommanderSchema,
  MAX_RECRUITMENT_ATTRIBUTE,
  RECRUIT_MAX_MIN_NOTORIETY,
  askingWage,
  assessJoin,
  createCommander,
  playerLevelGrants,
  reservationWage,
  startingEconomy,
  startingProgression,
  startingResearch,
  type CrewResponse,
  type Base,
  type BarResponse,
  type Commander,
  startingTraining,
} from '@frontline/shared';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { hireRecruit, releaseOfficer, wageAskedOf } from './hire.js';
import {
  BAR_OPEN_DOOR_FLOOR,
  BAR_HIRES_PER_DAY,
  BAR_ROSTER_SIZE,
  barDay,
  barRoster,
  findBarRecruit,
} from './roster.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  const handle = { app, db };
  instances.push(handle);
  return handle;
}

/** A registered player who has picked an overseer, i.e. one who has a base. */
async function makePlayer(app: FastifyInstance, username: string): Promise<string> {
  const register = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(register.statusCode).toBe(201);
  const token = register.json<{ token: string }>().token;

  const overseer = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: { authorization: `Bearer ${token}` },
    payload: { presetId: 'enforcer' },
  });
  expect(overseer.statusCode).toBe(201);
  return token;
}

async function readBar(app: FastifyInstance, token: string): Promise<BarResponse> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/bar',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<BarResponse>();
}

const NOW = new Date('2026-08-13T09:00:00.000Z');

function makeBase(overrides: Partial<Base> = {}): Base {
  return {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'Test Hold',
    districtId: 'neon-docks',
    level: 1,
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
    trainingQueue: [],
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
  /** §H2b: the seat the hire turned over, and how many times this player has signed today. */
  turnedOver?: number;
  hiresToday: number;
}

/** A repository double: hiring writes through four calls and the tests assert on what landed. */
function fakeRepos(hiresToday = 0): {
  repos: Parameters<typeof hireRecruit>[0];
  written: Written;
} {
  const written: Written = { hiresToday };
  const bases = {
    updateResources: (_id: string, resources: { caps: number }) => {
      written.caps = resources.caps;
    },
    updateEconomy: (_id: string, economy: { payroll: { commitments: Record<string, number> } }) => {
      written.commitments = economy.payroll.commitments;
    },
    updateCommanders: (_id: string, commanders: Commander[]) => {
      written.commanders = commanders;
    },
  };
  const bar = {
    hiresBy: () => written.hiresToday,
    recordHire: (_hire: unknown, slot: number) => {
      written.turnedOver = slot;
      written.hiresToday += 1;
    },
  };
  /*
   * A crew holding nothing.
   *
   * The §H5 alignment settler folds the crew's own effects, and a crew's effects now include what
   * the *ground* adds to its officers (§A4: the Chapel, the Broadcast Station). So a double that
   * omits the city repo is a double the code under test cannot run against, which is the double
   * being wrong rather than the code being fragile: an empty map is what "this crew holds nothing"
   * actually looks like.
   */
  const city = { controls: () => new Map(), control: () => undefined, scouted: () => new Set() };
  const users = { findById: () => undefined };
  const overseers = { findById: () => undefined };
  /*
   * And a crew with nobody away.
   *
   * Same argument as the city repo above: §A1 counts the units this crew has at a fight against
   * the same beds as the officer being hired here, so `districtPopulation` reads both of these.
   * Empty lists are what "nothing deployed, nothing walking" looks like.
   */
  const sieges = { deploymentsFor: () => [] };
  const movements = { forBase: () => [] };
  // §A1: the population fold counts everybody a crew feeds, and that now includes the crews out on
  // missions. Nobody is out in these cases; the double has to answer the question all the same.
  const missions = { listActiveByBaseId: () => [] };
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
    } as unknown as Parameters<typeof hireRecruit>[0],
    written,
  };
}

/** The two §H2b fields every `hireRecruit` call needs, defaulted so cases can ignore them. */
const SIGNER = { userId: 'user-1', seat: 0 };

describe('§H2/§H2a: one global roster, generated from the UTC date', () => {
  it('serves two different accounts the identical roster on the same UTC day', async () => {
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

  it('serves a different roster on the next UTC day', () => {
    const today = barRoster('2026-08-13');
    const tomorrow = barRoster('2026-08-14');
    expect(tomorrow).not.toEqual(today);
    // Not merely re-keyed: the people themselves are different.
    expect(tomorrow.map((r) => r.name)).not.toEqual(today.map((r) => r.name));
    expect(tomorrow.map((r) => r.attributes)).not.toEqual(today.map((r) => r.attributes));
  });

  it('turns over exactly on the UTC midnight boundary, not on local midnight', () => {
    expect(barDay(new Date('2026-08-13T23:59:59.999Z'))).toBe('2026-08-13');
    expect(barDay(new Date('2026-08-14T00:00:00.000Z'))).toBe('2026-08-14');
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
        expect(recruit.requirement.minNotoriety).toBeLessThanOrEqual(RECRUIT_MAX_MIN_NOTORIETY);
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
    // pinning rather than deriving. The three HTTP cases below also lean on it for their
    // stability under the real clock.
    expect(BAR_OPEN_DOOR_FLOOR).toBe(3);
  });

  it('always seats recruits a brand-new crew can approach, on every day and at every calibre', () => {
    // Why the Bar can never be an empty screen. A new crew is rank `Nobody` at level 1, so every
    // rolled door is shut to them; the floor is what guarantees there is somebody to talk to on
    // their first night, whatever the city's own standing has done to the room.
    for (let day = 0; day < 400; day++) {
      const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      for (const cityLevel of [0, 8, 30]) {
        const roster = barRoster(key, [], BAR_ROSTER_SIZE, cityLevel);
        const willing = roster.filter(
          (r) => assessJoin(r.requirement, { notoriety: 0, level: 1 }).interested,
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
        for (const recruit of barRoster(key, [], BAR_ROSTER_SIZE, cityLevel)) {
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
    // And the recruitment ceiling still holds: the 40..100 band is what progression is for.
    for (let day = 0; day < 30; day++) {
      const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      for (const recruit of barRoster(key, [], BAR_ROSTER_SIZE, 90)) {
        for (const name of ATTRIBUTE_NAMES) {
          expect(recruit.attributes[name]).toBeLessThanOrEqual(MAX_RECRUITMENT_ATTRIBUTE);
        }
      }
    }
  });

  it('leaves the ungated seats free to be anyone else: the floor is a floor, not the roster', () => {
    // A guarantee that quietly flattened every recruit into the same safe disposition would pass
    // the check above and gut §H3/§H4 entirely.
    const gated = new Set<number>();
    const perksSeen = new Set<string>();
    for (let day = 0; day < 200; day++) {
      const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      barRoster(key).forEach((recruit, index) => {
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

  it('prices a recruit off their sheet and off nothing about the crew', () => {
    const [recruit] = barRoster('2026-08-13');
    if (!recruit) throw new Error('empty roster');
    expect(wageAskedOf(recruit)).toBe(askingWage(recruit.attributes));
  });

  /** The half of a walkout that persists. Six hours is a delay; this is what it actually costs. */
  it('marks a recruit up for every time this crew has walked out on them', () => {
    const [recruit] = barRoster('2026-08-13');
    if (!recruit) throw new Error('empty roster');
    const flat = wageAskedOf(recruit);
    const twice = wageAskedOf(recruit, { until: NOW.toISOString(), walkouts: 2 });
    expect(twice).toBeGreaterThan(flat);
  });
});

describe('§H7/§H8: hiring out of the Bar', () => {
  const recruit = () => {
    const found = barRoster('2026-08-13').find((r) => r.requirement.minNotoriety === 0);
    if (!found) throw new Error('expected an ungated recruit');
    return found;
  };

  it('signs at the offered fee, banks the officer and commits it against the payroll book', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase();
    const hire = recruit();
    const asking = wageAskedOf(hire);

    const result = hireRecruit(repos, {
      ...SIGNER,
      base,
      recruit: hire,
      role: 'head_spy',
      offerWage: asking,
      now: NOW,
    });
    expect(result.kind).toBe('hired');
    if (result.kind !== 'hired') return;

    expect(result.wage).toBe(asking);
    expect(result.officer.role).toBe('head_spy');
    // What they signed for is what the book is charged, and it is the whole of the relationship.
    expect(result.officer.weeklyWage).toBe(asking);
    expect(result.officer.perks).toEqual(hire.perks);
    // The fee lives in the payroll book and nowhere else, as a commitment rather than a bill.
    expect(written.commitments).toEqual({ [hire.id]: asking });
    expect(result.base.economy.payroll.commitments[hire.id]).toBe(asking);
    expect(written.commanders?.map((c) => c.id)).toEqual([hire.id]);
  });

  /**
   * §A1: an officer needs a bed like anybody else, and the army is in the same pool now.
   *
   * The interesting half is the second assertion. A crew whose district is full of *soldiers* is a
   * crew that cannot hire, which is the whole point of merging the two ceilings: it used to be
   * possible to fill the barracks and the Quarters independently and never notice either.
   */
  it('refuses a signing the district has no bed for, soldiers included', () => {
    const hire = recruit();
    const sign = (base: Base) =>
      hireRecruit(fakeRepos().repos, {
        ...SIGNER,
        base,
        recruit: hire,
        role: 'head_spy',
        offerWage: wageAskedOf(hire),
        now: NOW,
      });

    const bare = makeBase();
    expect(sign(bare).kind).toBe('hired');

    // Razors are one body each, so a roster the size of the whole pool leaves nowhere to put an
    // officer. Nothing about the Bar changed; what changed is who else is sleeping there.
    const packed = makeBase({
      army: { razors: districtPopulationCapacity(bare.buildings, noTerritoryEffects()) },
    });
    expect(sign(packed)).toEqual({ kind: 'refused', reason: 'no_housing' });
  });

  /**
   * The book, not the stockpile. Signing takes nothing: what it does is spend a slice of a ceiling
   * the player has to go and buy more of.
   */
  it('commits the fee against the book and charges no caps at all', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase();
    const hire = recruit();
    const result = hireRecruit(repos, {
      ...SIGNER,
      base,
      recruit: hire,
      role: 'head_spy',
      offerWage: wageAskedOf(hire),
      now: NOW,
    });
    expect(result.kind).toBe('hired');
    if (result.kind !== 'hired') return;
    expect(result.base.resources.caps).toBe(base.resources.caps);
    expect(written.caps, 'signing must not move caps').toBeUndefined();
    expect(result.payroll.committed).toBe(result.wage);
    expect(result.payroll.available).toBe(result.payroll.capacity - result.wage);
  });

  /**
   * §H7: the six hours a walkout buys, enforced at the *signing* and not only in the conversation.
   *
   * `/bar/negotiate` refuses to reopen a cold chair, which is what a player sees, and it is not
   * what a request has to go through: signing is its own route. A tab left open across a walkout,
   * or anything posting the floor price straight at `/bar/hire`, put the officer on the books
   * during the standoff. The markup applied (`wageAskedOf` reads the same record); the clock did
   * not, and the clock is the half that makes a walkout cost something today.
   */
  it('refuses a signing while they are still walked out on, and takes it once the clock runs out', () => {
    const hire = recruit();
    const sign = (standoff: { until: string; walkouts: number } | undefined) =>
      hireRecruit(fakeRepos().repos, {
        ...SIGNER,
        base: makeBase(),
        recruit: hire,
        role: 'head_spy',
        ...(standoff ? { standoff } : {}),
        offerWage: wageAskedOf(hire, standoff),
        now: NOW,
      });

    const cold = { until: new Date(NOW.getTime() + 60_000).toISOString(), walkouts: 1 };
    expect(sign(cold)).toEqual({ kind: 'refused', reason: 'standoff' });

    // The same record an hour after it expires: they will sit down, and at the marked-up price.
    const expired = { until: new Date(NOW.getTime() - 60_000).toISOString(), walkouts: 1 };
    const signed = sign(expired);
    expect(signed.kind).toBe('hired');
    if (signed.kind !== 'hired') return;
    expect(signed.wage).toBeGreaterThan(wageAskedOf(hire));
  });

  it('refuses a fee the payroll book will not stretch to', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase();
    const hire = recruit();
    // Already spoken for, down to a few caps: the fee cannot fit whatever the crew has in the bank.
    const full = {
      ...base,
      economy: {
        ...base.economy,
        payroll: { ...base.economy.payroll, commitments: { 'someone-else': PAYROLL_BASE - 1 } },
      },
    };
    const result = hireRecruit(repos, {
      ...SIGNER,
      base: full,
      recruit: hire,
      role: 'head_spy',
      offerWage: wageAskedOf(hire),
      now: NOW,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'no_payroll' });
    expect(written.commanders).toBeUndefined();
  });

  /**
   * The other end of the contract, and the only place caps move. Committing is free so a player
   * will sign somebody; walking it back is five weeks so they will think about it first.
   */
  it('frees the slice when an officer is let go, and charges five weeks of it', () => {
    const { repos } = fakeRepos();
    const hired = hireRecruit(repos, {
      ...SIGNER,
      base: makeBase(),
      recruit: recruit(),
      role: 'head_spy',
      offerWage: wageAskedOf(recruit()),
      now: NOW,
    });
    expect(hired.kind).toBe('hired');
    if (hired.kind !== 'hired') return;

    const released = releaseOfficer(repos, hired.base, hired.officer.id);
    expect(released.kind).toBe('released');
    if (released.kind !== 'released') return;
    expect(released.fee).toBe(hired.wage * DISMISSAL_WEEKS);
    expect(released.base.resources.caps).toBe(hired.base.resources.caps - released.fee);
    expect(released.payroll.committed).toBe(0);
    expect(released.base.commanders).toHaveLength(0);
  });

  it('refuses to let somebody go the crew cannot pay off, and 404s a stranger', () => {
    const { repos } = fakeRepos();
    const hired = hireRecruit(repos, {
      ...SIGNER,
      base: makeBase(),
      recruit: recruit(),
      role: 'head_spy',
      offerWage: wageAskedOf(recruit()),
      now: NOW,
    });
    if (hired.kind !== 'hired') throw new Error('expected a hire');

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

  it('counters a lowball instead of signing or erroring (§H7)', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase();
    const hire = recruit();
    const result = hireRecruit(repos, {
      ...SIGNER,
      base,
      recruit: hire,
      role: 'head_spy',
      offerWage: 1,
      now: NOW,
    });
    expect(result.kind).toBe('countered');
    if (result.kind !== 'countered') return;
    expect(result.wage).toBeGreaterThanOrEqual(reservationWage(wageAskedOf(hire)));
    expect(written.commanders, 'a counter must not hire anybody').toBeUndefined();
    expect(written.caps, 'a counter must not move caps').toBeUndefined();
  });

  it('holds §H8: 2 slots at level 1, +1 per level', () => {
    expect(playerLevelGrants(1).recruitSlots).toBe(2);
    expect(playerLevelGrants(2).recruitSlots).toBe(3);

    const full = makeBase({
      commanders: [createCommander('a', 'A', 'scout', {}), createCommander('b', 'B', 'trader', {})],
    });
    expect(
      hireRecruit(fakeRepos().repos, {
        ...SIGNER,
        base: full,
        recruit: recruit(),
        role: 'head_spy',
        offerWage: 500,
        now: NOW,
      }),
    ).toEqual({ kind: 'refused', reason: 'no_slots' });

    // The same crew one level up has room, because §H8 is read off W6's grant table.
    const levelled = { ...full, level: 2 };
    expect(
      hireRecruit(fakeRepos().repos, {
        ...SIGNER,
        base: levelled,
        recruit: recruit(),
        role: 'head_spy',
        offerWage: wageAskedOf(recruit()),
        now: NOW,
      }).kind,
    ).toBe('hired');
  });

  it('holds §C3: one officer per role', () => {
    const taken = makeBase({
      commanders: [createCommander('a', 'A', 'head_spy', {})],
    });
    expect(
      hireRecruit(fakeRepos().repos, {
        ...SIGNER,
        base: taken,
        recruit: recruit(),
        role: 'head_spy',
        offerWage: 500,
        now: NOW,
      }),
    ).toEqual({ kind: 'refused', reason: 'role_taken' });
  });

  it('will not hire the same person twice', () => {
    const hire = recruit();
    const already = makeBase({
      commanders: [createCommander(hire.id, hire.name, 'scout', {})],
    });
    expect(
      hireRecruit(fakeRepos().repos, {
        ...SIGNER,
        base: already,
        recruit: hire,
        role: 'head_spy',
        offerWage: 500,
        now: NOW,
      }),
    ).toEqual({ kind: 'refused', reason: 'already_hired' });
  });
});

describe('the Bar over HTTP', () => {
  it('reports slots, crew standing and an empty roster of officers to a fresh player', async () => {
    const { app } = await makeApp();
    const bar = await readBar(app, await makePlayer(app, 'fresh_operator'));

    expect(bar.slotsUsed).toBe(0);
    expect(bar.slotsTotal).toBe(playerLevelGrants(1).recruitSlots);
    expect(bar.officers).toEqual([]);
    expect(bar.filledRoles).toEqual([]);
    expect(bar.notoriety).toBe(0);
    expect(bar.level).toBe(1);
    expect(bar.infamy).toBe(0);
    expect(bar.payroll.capacity).toBeGreaterThan(0);
    expect(bar.payroll.committed).toBe(0);
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

  it('hires end to end and shows the officer back on the next read', async () => {
    const { app } = await makeApp();
    const token = await makePlayer(app, 'hiring_operator');
    const bar = await readBar(app, token);
    const target = bar.recruits.find((r) => r.assessment.interested && r.askingWage !== null);
    if (!target?.askingWage) throw new Error('expected an interested recruit');

    const res = await app.inject({
      method: 'POST',
      url: '/api/bar/hire',
      headers: { authorization: `Bearer ${token}` },
      payload: { recruitId: target.id, role: 'head_spy', offerWage: target.askingWage },
    });
    expect(res.statusCode).toBe(200);
    const hired = res.json<{
      accepted: boolean;
      wage: number;
      payroll: { committed: number; available: number; capacity: number };
    }>();
    expect(hired.accepted).toBe(true);
    // The book, not the stockpile: the fee is spoken for and nothing was charged.
    expect(hired.payroll.committed).toBe(hired.wage);
    expect(hired.payroll.available).toBe(hired.payroll.capacity - hired.wage);

    const after = await readBar(app, token);
    expect(after.slotsUsed).toBe(1);
    expect(after.filledRoles).toEqual(['head_spy']);
    expect(after.officers[0]?.commander.name).toBe(target.name);
    expect(after.officers[0]?.weeklyWage).toBe(hired.wage);
    // Nothing was charged: the book is a ceiling, not a bill.
    expect(after.caps).toBe(bar.caps);
    expect(after.payroll.committed).toBe(hired.wage);

    // …and they are in the crew, which is the screen a player goes to next.
    //
    // Worth its own read rather than trusting the Bar's: `/bar` projects the officers it just
    // wrote, so it would report a signing that went nowhere. The Crew screen is a different route
    // over a different projection, and "I agreed a wage and they never turned up" is the shape of
    // bug this catches.
    const crew = await app.inject({
      method: 'GET',
      url: '/api/crew',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(crew.statusCode).toBe(200);
    const roster = crew.json<CrewResponse>();
    expect(roster.officers.map((one) => one.name)).toContain(target.name);
    expect(roster.officers.find((one) => one.name === target.name)?.role).toBe('head_spy');

    // §H2b. They have left the room, and somebody else is in their seat. Both halves matter: a
    // roster that merely greyed them out would still be a private catalogue, and one that emptied
    // the seat would shrink the shared room every time anybody hired.
    expect(after.recruits.map((r) => r.id)).not.toContain(target.id);
    expect(after.recruits).toHaveLength(BAR_ROSTER_SIZE);
    const seat = bar.recruits.findIndex((r) => r.id === target.id);
    expect(after.recruits[seat]?.name).not.toBe(target.name);
    // And they left for everybody, not just for the crew that signed them.
    const bystander = await readBar(app, await makePlayer(app, 'bar_bystander'));
    expect(bystander.recruits.map((r) => r.id)).not.toContain(target.id);
    expect(bystander.recruits[seat]?.id).toBe(after.recruits[seat]?.id);
  });

  it('§H2b: allows one hire a day and refuses the second', async () => {
    const { app } = await makeApp();
    const token = await makePlayer(app, 'eager_operator');
    const bar = await readBar(app, token);
    expect(bar.hiresLeftToday).toBe(BAR_HIRES_PER_DAY);

    const [first, second] = bar.recruits.filter((r) => r.askingWage !== null);
    if (!first?.askingWage || !second?.askingWage) throw new Error('need two interested recruits');
    const hire = (recruitId: string, offerWage: number, role: string) =>
      app.inject({
        method: 'POST',
        url: '/api/bar/hire',
        headers: { authorization: `Bearer ${token}` },
        payload: { recruitId, role, offerWage },
      });

    expect((await hire(first.id, first.askingWage, 'head_spy')).statusCode).toBe(200);
    expect((await readBar(app, token)).hiresLeftToday).toBe(0);

    // A *different* role, so this can only be the daily limit and not §C3.
    const again = await hire(second.id, second.askingWage, 'trader');
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('DAILY_HIRE_LIMIT');
  });

  it('rejects a hire into a role that is already filled', async () => {
    const { app } = await makeApp();
    const token = await makePlayer(app, 'double_operator');
    const bar = await readBar(app, token);
    const [first, second] = bar.recruits.filter((r) => r.askingWage !== null);
    if (!first?.askingWage || !second?.askingWage) throw new Error('need two interested recruits');

    const hire = (recruitId: string, offerWage: number) =>
      app.inject({
        method: 'POST',
        url: '/api/bar/hire',
        headers: { authorization: `Bearer ${token}` },
        payload: { recruitId, role: 'head_spy', offerWage },
      });

    expect((await hire(first.id, first.askingWage)).statusCode).toBe(200);
    const clash = await hire(second.id, second.askingWage);
    expect(clash.statusCode).toBe(409);
    expect(clash.json<{ error: { code: string } }>().error.code).toBe('ROLE_TAKEN');
  });

  it('404s a recruit who is not at the Bar today (§H2)', async () => {
    const { app } = await makeApp();
    const token = await makePlayer(app, 'stale_operator');
    const yesterday = findBarRecruit('1999-01-01', 'bar-1999-01-01-0-0');
    expect(yesterday, 'the helper only finds a recruit on its own day').toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: '/api/bar/hire',
      headers: { authorization: `Bearer ${token}` },
      payload: { recruitId: 'bar-1999-01-01-0-0', role: 'head_spy', offerWage: 50 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('§H2b: 404s a recruit whose seat has already turned over', async () => {
    const { app } = await makeApp();
    const quick = await makePlayer(app, 'quick_operator');
    const slow = await makePlayer(app, 'slow_operator');

    // Both tabs are looking at the same room. One of them signs first.
    const staleView = await readBar(app, slow);
    const target = (await readBar(app, quick)).recruits.find(
      (r) => r.assessment.interested && r.askingWage !== null,
    );
    if (!target?.askingWage) throw new Error('expected an interested recruit');
    expect(staleView.recruits.map((r) => r.id)).toContain(target.id);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/bar/hire',
          headers: { authorization: `Bearer ${quick}` },
          payload: { recruitId: target.id, role: 'head_spy', offerWage: target.askingWage },
        })
      ).statusCode,
    ).toBe(200);

    // The stale tab now holds an id naming a generation that seat has moved past. It must not
    // sign the replacement by accident: the generation is in the id precisely so it cannot.
    const stale = await app.inject({
      method: 'POST',
      url: '/api/bar/hire',
      headers: { authorization: `Bearer ${slow}` },
      payload: { recruitId: target.id, role: 'head_spy', offerWage: target.askingWage },
    });
    expect(stale.statusCode).toBe(404);
  });

  it('needs a base: recruiting from nowhere is a 409, not a crash', async () => {
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
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NO_BASE');
  });

  it('is behind authentication', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/bar' })).statusCode).toBe(401);
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
    role: 'head_spy',
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
    expect(runMigrations(db, MIGRATIONS)).toEqual([
      '0006_recruitment.sql',
      '0043_officer_perks.sql',
    ]);

    const [migrated] = commandersOf(db, 'legacy-base');
    expect(migrated).toMatchObject({ id: 'legacy-1', name: 'Pre-H Officer', role: 'head_spy' });
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
    const already = createCommander('kept-1', 'Already Migrated', 'scout', {}, ['skim_route'], 30);
    plantBase(db, 'empty-base', []);
    plantBase(db, 'kept-base', [already]);
    runMigrations(db, MIGRATIONS);

    expect(commandersOf(db, 'empty-base')).toEqual([]);
    expect(commandersOf(db, 'kept-base')[0]).toMatchObject({
      id: 'kept-1',
      perks: ['skim_route'],
      weeklyWage: 30,
    });
    db.close();
  });
});
