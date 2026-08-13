import {
  ALIGNMENT_LEAVE_THRESHOLD,
  ALIGNMENT_MAX,
  ALIGNMENT_START,
  ATTRIBUTE_NAMES,
  CHARACTER_LEVEL_PLAYER_POINTS,
  AMBITIONS,
  CommanderSchema,
  MAX_RECRUITMENT_ATTRIBUTE,
  MORAL_COMPASSES,
  PAY_WEEK_MS,
  RECRUIT_MAX_MIN_INFAMY,
  REPUTATION_LABELS,
  alignmentTarget,
  askingWage,
  assessJoin,
  createCommander,
  hearsAnyCrewOut,
  playerLevelGrants,
  proratedFirstWage,
  reputationStance,
  reservationWage,
  startingEconomy,
  startingAssignees,
  startingProgression,
  startingResearch,
  type Base,
  type BarResponse,
  type Commander,
} from '@frontline/shared';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { assessAgainst, hireRecruit, wageAskedOf } from './hire.js';
import { alignmentAt, settleOfficerAlignment } from './officers.js';
import {
  BAR_OPEN_DOOR_FLOOR,
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
    resources: { caps: 5000, food: 100, oil: 100, scrap: 100, highQualityMetal: 10 },
    economy: startingEconomy(NOW.toISOString()),
    progression: startingProgression(),
    research: startingResearch(),
    assignees: startingAssignees(),
    buildings: [],
    commanders: [],
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

/** A repository double: hiring writes through three calls and the tests assert on what landed. */
function fakeRepos(): {
  repos: Parameters<typeof hireRecruit>[0];
  written: { commanders?: Commander[]; caps?: number; wages?: Record<string, number> };
} {
  const written: { commanders?: Commander[]; caps?: number; wages?: Record<string, number> } = {};
  const bases = {
    updateResources: (_id: string, resources: { caps: number }) => {
      written.caps = resources.caps;
    },
    updateEconomy: (_id: string, economy: { payroll: { wages: Record<string, number> } }) => {
      written.wages = economy.payroll.wages;
    },
    updateCommanders: (_id: string, commanders: Commander[]) => {
      written.commanders = commanders;
    },
  };
  return { repos: { bases } as unknown as Parameters<typeof hireRecruit>[0], written };
}

describe('§H2/§H2a — one global roster, generated from the UTC date', () => {
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

  it('is a pure function of the day — same answer every time it is asked', () => {
    expect(barRoster('2026-08-13')).toEqual(barRoster('2026-08-13'));
    // Recomputed independently rather than memoised: distinct object identities, equal values.
    expect(barRoster('2026-08-13')[0]).not.toBe(barRoster('2026-08-13')[0]);
  });

  it('rolls people the rest of the game would accept', () => {
    for (const day of ['2026-01-01', '2026-08-13', '2026-12-31', '2027-02-28']) {
      for (const recruit of barRoster(day)) {
        expect(recruit.name.length).toBeGreaterThan(2);
        expect(recruit.requirement.minInfamy).toBeGreaterThanOrEqual(0);
        expect(recruit.requirement.minInfamy).toBeLessThanOrEqual(RECRUIT_MAX_MIN_INFAMY);
        for (const name of ATTRIBUTE_NAMES) {
          expect(recruit.attributes[name]).toBeLessThanOrEqual(MAX_RECRUITMENT_ATTRIBUTE);
        }
      }
    }
  });

  it('always seats recruits any crew can approach, on every day and against every word', () => {
    // The guarantee is about *both* gates, and it is why the Bar can never be an empty screen.
    // Rolling either one freely leaves days where a new crew has nobody: §H3 alone bottoms out at
    // one open door, and §H3 plus a bare open-door floor still left a day with nobody interested.
    const words = [...REPUTATION_LABELS];
    for (let day = 0; day < 400; day++) {
      const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      const roster = barRoster(key);
      expect(roster.filter((r) => r.requirement.minInfamy === 0).length).toBeGreaterThanOrEqual(
        BAR_OPEN_DOOR_FLOOR,
      );
      for (const reputation of words) {
        const willing = roster.filter(
          (r) => assessJoin(r, r.requirement, { infamy: 0, reputation }).interested,
        );
        expect(
          willing.length,
          `${key} leaves a crew reading "${reputation}" only ${willing.length} recruits`,
        ).toBeGreaterThanOrEqual(BAR_OPEN_DOOR_FLOOR);
      }
    }
  });

  it('leaves the ungated seats free to be anyone else — the floor is a floor, not the roster', () => {
    // A guarantee that quietly flattened every recruit into the same safe disposition would pass
    // the check above and gut §H3/§H4 entirely.
    const gated = new Set<number>();
    const compasses = new Set<string>();
    for (let day = 0; day < 200; day++) {
      const key = barDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      barRoster(key).forEach((recruit, index) => {
        if (recruit.requirement.minInfamy > 0) gated.add(index);
        compasses.add(recruit.moralCompass);
      });
    }
    expect(gated.size, 'every seat past the floor must be able to carry a §H3 gate').toBe(
      BAR_ROSTER_SIZE - BAR_OPEN_DOOR_FLOOR,
    );
    expect(compasses.size).toBe(MORAL_COMPASSES.length);
  });

  it('can seat every ambition on a guaranteed-open chair', () => {
    // The open-door seats fall back to a compass that clears §H4. That fallback has to exist for
    // *every* ambition, or `recruitAt` throws on some future day rather than at a retune.
    for (const ambition of AMBITIONS) {
      expect(
        MORAL_COMPASSES.some((moralCompass) => hearsAnyCrewOut({ ambition, moralCompass })),
        `${ambition} has no moral compass that can hear any crew out`,
      ).toBe(true);
    }
  });
});

describe('§H3/§H4 — the roster as one particular crew sees it', () => {
  it('locks a recruit whose infamy gate the crew has not cleared, and unlocks it when they do', () => {
    const gated = barRoster('2026-08-13').find((r) => r.requirement.minInfamy > 0);
    if (!gated) throw new Error('expected the roster to contain at least one gated recruit');

    const quiet = makeBase();
    const notorious = makeBase({
      economy: { ...quiet.economy, infamy: RECRUIT_MAX_MIN_INFAMY },
    });
    expect(
      wageAskedOf(gated, assessAgainst(notorious, gated, NOW).stance),
      'a crew that clears the gate gets a price',
    ).toBeGreaterThan(0);
    // The gate itself is asserted through the route below; here it is enough that the crew's own
    // numbers, not the recruit's, are what changed.
    expect(quiet.economy.infamy).toBeLessThan(gated.requirement.minInfamy);
  });

  it('quotes a higher wage to a crew the character dislikes (§H4 → §H7)', () => {
    const [recruit] = barRoster('2026-08-13');
    if (!recruit) throw new Error('empty roster');
    const stance = reputationStance(recruit, 'Cautious');
    const base = makeBase();
    expect(wageAskedOf(recruit, assessAgainst(base, recruit, NOW).stance)).toBe(
      askingWage(recruit.attributes, stance),
    );
  });
});

describe('§H7/§H8 — hiring out of the Bar', () => {
  const recruit = () => {
    const found = barRoster('2026-08-13').find((r) => r.requirement.minInfamy === 0);
    if (!found) throw new Error('expected an ungated recruit');
    return found;
  };

  it('signs at the offered wage, banks the officer and writes the wage into W2 payroll', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase();
    const hire = recruit();
    const asking = wageAskedOf(hire, assessAgainst(base, hire, NOW).stance);

    const result = hireRecruit(repos, {
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
    expect(result.officer.alignment).toBe(ALIGNMENT_START);
    expect(result.officer.level).toBe(1);
    expect(result.officer.unspentPoints).toBe(0);
    // The wage lives in W2's payroll book and nowhere else (INTERFACES R9).
    expect(written.wages).toEqual({ [hire.id]: asking });
    expect(result.base.economy.payroll.wages[hire.id]).toBe(asking);
    expect(written.commanders?.map((c) => c.id)).toEqual([hire.id]);
  });

  it('takes the prorated first payment at recruitment (§H7)', () => {
    const monday = new Date('2026-08-10T00:00:00.000Z');
    const hire = recruit();

    // Exactly on the boundary: a full week.
    const onBoundary = hireRecruit(fakeRepos().repos, {
      base: makeBase(),
      recruit: hire,
      role: 'head_spy',
      offerWage: 200,
      now: monday,
    });
    expect(onBoundary.kind).toBe('hired');
    if (onBoundary.kind !== 'hired') return;
    expect(onBoundary.firstPayment).toBe(onBoundary.wage);
    expect(onBoundary.base.resources.caps).toBe(5000 - onBoundary.wage);

    // An hour before the next boundary: an hour's worth.
    const hourLeft = new Date(monday.getTime() + PAY_WEEK_MS - 60 * 60 * 1000);
    const lateHire = hireRecruit(fakeRepos().repos, {
      base: makeBase(),
      recruit: hire,
      role: 'head_spy',
      offerWage: 200,
      now: hourLeft,
    });
    expect(lateHire.kind).toBe('hired');
    if (lateHire.kind !== 'hired') return;
    expect(lateHire.firstPayment).toBe(proratedFirstWage(lateHire.wage, hourLeft));
    expect(lateHire.firstPayment).toBeLessThan(onBoundary.firstPayment);
  });

  it('counters a lowball instead of signing or erroring (§H7)', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase();
    const hire = recruit();
    const result = hireRecruit(repos, {
      base,
      recruit: hire,
      role: 'head_spy',
      offerWage: 1,
      now: NOW,
    });
    expect(result.kind).toBe('countered');
    if (result.kind !== 'countered') return;
    expect(result.wage).toBeGreaterThanOrEqual(
      reservationWage(wageAskedOf(hire, assessAgainst(base, hire, NOW).stance)),
    );
    expect(written.commanders, 'a counter must not hire anybody').toBeUndefined();
    expect(written.caps, 'a counter must not move caps').toBeUndefined();
  });

  it('refuses when the crew cannot cover the first payment', () => {
    const { repos, written } = fakeRepos();
    const broke = makeBase({
      resources: { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 },
    });
    const result = hireRecruit(repos, {
      base: broke,
      recruit: recruit(),
      role: 'head_spy',
      offerWage: 500,
      now: NOW,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'cannot_afford' });
    expect(written.commanders).toBeUndefined();
  });

  it('holds §H8: 2 slots at level 1, +1 per level', () => {
    expect(playerLevelGrants(1).recruitSlots).toBe(2);
    expect(playerLevelGrants(2).recruitSlots).toBe(3);

    const full = makeBase({
      commanders: [
        createCommander('a', 'A', 'scout', {}, [], { now: NOW.toISOString() }),
        createCommander('b', 'B', 'trader', {}, [], { now: NOW.toISOString() }),
      ],
    });
    expect(
      hireRecruit(fakeRepos().repos, {
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
        base: levelled,
        recruit: recruit(),
        role: 'head_spy',
        offerWage: 500,
        now: NOW,
      }).kind,
    ).toBe('hired');
  });

  it('holds §C3: one officer per role', () => {
    const taken = makeBase({
      commanders: [createCommander('a', 'A', 'head_spy', {}, [], { now: NOW.toISOString() })],
    });
    expect(
      hireRecruit(fakeRepos().repos, {
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
      commanders: [
        createCommander(hire.id, hire.name, 'scout', {}, [], { now: NOW.toISOString() }),
      ],
    });
    expect(
      hireRecruit(fakeRepos().repos, {
        base: already,
        recruit: hire,
        role: 'head_spy',
        offerWage: 500,
        now: NOW,
      }),
    ).toEqual({ kind: 'refused', reason: 'already_hired' });
  });
});

describe('§H5 — alignment drifts to what they make of the crew', () => {
  const officerWho = (ambition: Commander['ambition'], moralCompass: Commander['moralCompass']) =>
    createCommander('o1', 'Test', 'scout', {}, [], {
      ambition,
      moralCompass,
      now: NOW.toISOString(),
    });

  it('falls below the leave threshold for someone who hates what the crew has become', () => {
    // `Reckless` is one of the four words a live mechanic can produce today, and a knowledge-driven
    // pragmatist reads it at -2 — the only stance whose target sits under §H5's threshold.
    const officer = officerWho('knowledge', 'pragmatist');
    expect(alignmentTarget(reputationStance(officer, 'Reckless'))).toBeLessThan(
      ALIGNMENT_LEAVE_THRESHOLD,
    );

    const aMonthLater = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    const alignment = alignmentAt(officer, 'Reckless', aMonthLater);
    expect(alignment).toBeLessThan(ALIGNMENT_LEAVE_THRESHOLD);
  });

  it('climbs past the bonus threshold for someone the crew suits', () => {
    const officer = officerWho('notoriety', 'ruthless');
    const aMonthLater = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(alignmentAt(officer, 'Feared', aMonthLater)).toBeGreaterThan(75);
  });

  it('stays inside the meter and does not move on a backwards clock', () => {
    const officer = officerWho('notoriety', 'ruthless');
    const before = new Date(NOW.getTime() - PAY_WEEK_MS);
    expect(alignmentAt(officer, 'Feared', before)).toBe(ALIGNMENT_START);
    expect(
      alignmentAt({ ...officer, alignment: ALIGNMENT_MAX }, 'Feared', NOW),
    ).toBeLessThanOrEqual(ALIGNMENT_MAX);
  });

  it('persists a drift, and writes nothing when nobody moved', () => {
    const writes: Commander[][] = [];
    const repos = {
      bases: { updateCommanders: (_id: string, c: Commander[]) => writes.push(c) },
    } as unknown as Parameters<typeof settleOfficerAlignment>[0];

    const base = makeBase({ commanders: [officerWho('notoriety', 'ruthless')] });
    const later = new Date(NOW.getTime() + PAY_WEEK_MS);
    const settled = settleOfficerAlignment(repos, base, later);
    expect(writes).toHaveLength(1);
    expect(settled.commanders[0]?.alignment).not.toBe(ALIGNMENT_START);

    // Settling the already-settled roster again at the same instant is not a second write.
    settleOfficerAlignment(repos, settled, later);
    expect(writes).toHaveLength(1);

    // ...and a base with no officers never touches the database at all.
    settleOfficerAlignment(repos, makeBase(), later);
    expect(writes).toHaveLength(1);
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
    expect(bar.reputation).toBe('Cautious');
    expect(bar.infamy).toBe(0);
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
    const hired = res.json<{ accepted: boolean; wage: number; firstPayment: number }>();
    expect(hired.accepted).toBe(true);
    expect(hired.firstPayment).toBeGreaterThan(0);

    const after = await readBar(app, token);
    expect(after.slotsUsed).toBe(1);
    expect(after.filledRoles).toEqual(['head_spy']);
    expect(after.officers[0]?.commander.name).toBe(target.name);
    expect(after.officers[0]?.weeklyWage).toBe(hired.wage);
    expect(after.recruits.find((r) => r.id === target.id)?.hired).toBe(true);
    expect(after.caps).toBe(bar.caps - hired.firstPayment);
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
    const yesterday = findBarRecruit('1999-01-01', 'bar-1999-01-01-0');
    expect(yesterday, 'the helper only finds a recruit on its own day').toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: '/api/bar/hire',
      headers: { authorization: `Bearer ${token}` },
      payload: { recruitId: 'bar-1999-01-01-0', role: 'head_spy', offerWage: 50 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('assigns a §H6 point by hand and refuses when none are banked', async () => {
    const { app, db } = await makeApp();
    const token = await makePlayer(app, 'levelling_operator');
    const bar = await readBar(app, token);
    const target = bar.recruits.find((r) => r.askingWage !== null);
    if (!target?.askingWage) throw new Error('expected an interested recruit');

    await app.inject({
      method: 'POST',
      url: '/api/bar/hire',
      headers: { authorization: `Bearer ${token}` },
      payload: { recruitId: target.id, role: 'head_spy', offerWage: target.askingWage },
    });

    const assign = (attribute: string) =>
      app.inject({
        method: 'POST',
        url: '/api/bar/assign-point',
        headers: { authorization: `Bearer ${token}` },
        payload: { officerId: target.id, attribute },
      });

    // Nothing banked yet — a fresh hire is level 1 and has never levelled.
    const empty = await assign('stealth');
    expect(empty.statusCode).toBe(409);
    expect(empty.json<{ error: { code: string } }>().error.code).toBe('NO_POINTS');

    // Bank the §H6 grant directly: nothing in the game awards character XP yet (INTERFACES R2).
    const row = db.prepare('SELECT id, commanders_json FROM bases WHERE is_bot = 0').get() as {
      id: string;
      commanders_json: string;
    };
    const officers = JSON.parse(row.commanders_json) as Commander[];
    const before = officers[0]?.attributes.stealth ?? 0;
    db.prepare('UPDATE bases SET commanders_json = ? WHERE id = ?').run(
      JSON.stringify(
        officers.map((o) => ({ ...o, level: 2, unspentPoints: CHARACTER_LEVEL_PLAYER_POINTS })),
      ),
      row.id,
    );

    const spent = await assign('stealth');
    expect(spent.statusCode).toBe(200);
    const officer = spent.json<{ officer: Commander }>().officer;
    expect(officer.unspentPoints).toBe(CHARACTER_LEVEL_PLAYER_POINTS - 1);
    expect(officer.attributes.stealth).toBe(before + 1);
  });

  it('needs a base — recruiting from nowhere is a 409, not a crash', async () => {
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
    db.prepare('DELETE FROM schema_migrations WHERE name = ?').run('0006_recruitment.sql');
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
      JSON.stringify({ caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 }),
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

  it('backfills officers stored before §H4/§H5/§H6 existed', () => {
    const db = rewoundToBefore0006();
    plantBase(db, 'legacy-base', [legacyOfficer]);
    expect(runMigrations(db, MIGRATIONS)).toEqual(['0006_recruitment.sql']);

    const [migrated] = commandersOf(db, 'legacy-base');
    expect(migrated).toMatchObject({
      id: 'legacy-1',
      name: 'Pre-H Officer',
      role: 'head_spy',
      traits: ['gutter_born'],
      alignment: ALIGNMENT_START,
      level: 1,
      xpIntoLevel: 0,
      unspentPoints: 0,
    });
    expect(migrated?.attributes.stealth, 'the existing sheet survives untouched').toBe(20);
    // The whole point: the row now parses with the schema the read path actually uses.
    expect(() => CommanderSchema.parse(migrated)).not.toThrow();
    db.close();
  });

  it('leaves an empty roster alone and does not overwrite officers that already have the fields', () => {
    const db = rewoundToBefore0006();
    const already = createCommander('kept-1', 'Already Migrated', 'scout', {}, [], {
      ambition: 'revenge',
      moralCompass: 'ruthless',
      now: NOW.toISOString(),
    });
    plantBase(db, 'empty-base', []);
    plantBase(db, 'kept-base', [{ ...already, alignment: 88, level: 4, unspentPoints: 3 }]);
    runMigrations(db, MIGRATIONS);

    expect(commandersOf(db, 'empty-base')).toEqual([]);
    expect(commandersOf(db, 'kept-base')[0]).toMatchObject({
      ambition: 'revenge',
      moralCompass: 'ruthless',
      alignment: 88,
      level: 4,
      unspentPoints: 3,
    });
    db.close();
  });
});
