import {
  MISSION_TEMPLATES,
  assigneeBonusPercent,
  assigneeCapPerOfficer,
  assigneePool,
  createCommander,
  findMissionTemplate,
  type AssigneesResponse,
  type Base,
  type Commander,
  type Mission,
  type MissionTemplate,
  type OfficerRole,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const PASSWORD = 'hunter2pass';

interface Stack {
  app: FastifyInstance;
  repos: Repositories;
  base: Base;
  token: string;
}

async function makeStack(username = 'placer'): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  expect(registered.statusCode).toBe(201);
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();

  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/overseer',
        headers: { authorization: `Bearer ${token}` },
        payload: { presetId: 'enforcer' },
      })
    ).statusCode,
  ).toBe(201);

  const repos = createRepositories(db);
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) throw new Error('overseer creation did not mint a base');
  return { app, repos, base, token };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Hires officers straight onto the books, and levels the base up so a pool exists to place. */
function staff(stack: Stack, roles: readonly OfficerRole[], level = 1): Commander[] {
  const officers = roles.map((role, index) =>
    createCommander(`off-${index}`, `Officer ${index}`, role),
  );
  stack.repos.bases.updateCommanders(stack.base.id, officers);
  if (level !== stack.base.level) {
    stack.repos.bases.updateProgression(stack.base.id, level, { xpIntoLevel: 0 });
  }
  return officers;
}

const getAssignees = async (stack: Stack): Promise<AssigneesResponse> => {
  const res = await stack.app.inject({
    method: 'GET',
    url: '/api/assignees',
    headers: auth(stack.token),
  });
  expect(res.statusCode).toBe(200);
  return res.json<AssigneesResponse>();
};

describe('GET /api/assignees (§G)', () => {
  it('derives the pool, the cap and the §G7 ceiling from Base.level', async () => {
    const stack = await makeStack();
    staff(stack, ['field_commander'], 4);

    const body = await getAssignees(stack);
    expect(body.level).toBe(4);
    // §G8 at level 4: 2 + 3 = 5. §G3a: floor(4/2) = 2.
    expect(body.pool).toBe(5);
    expect(body.capPerOfficer).toBe(2);
    expect(body.placed).toBe(0);
    expect(body.unplaced).toBe(5);
    // The best reachable bonus is the cap's row, not 50%: the cap bites long before the table ends.
    expect(body.maxBonusPercent).toBe(10);
    expect(body.officers).toHaveLength(1);
    expect(body.officers[0]).toMatchObject({ assignees: 0, bonusPercent: 0, nextBonusPercent: 5 });
  });

  it('reports no Professor until one is hired (§C4)', async () => {
    const stack = await makeStack();
    staff(stack, ['field_commander']);
    expect((await getAssignees(stack)).canReskill).toBe(false);

    staff(stack, ['field_commander', 'professor']);
    expect((await getAssignees(stack)).canReskill).toBe(true);
  });

  /**
   * §H5 lets a badly-aligned officer walk out, and that path knows nothing about §G. Without the
   * sweep in `settleAssignees` their placement would sit in the map forever: counted against the
   * pool, reachable by nobody, and the player would lose a grant every time somebody quit.
   */
  it('returns a departed officer’s assignees to the pool', async () => {
    const stack = await makeStack();
    const [commander, spy] = staff(stack, ['field_commander', 'head_spy'], 10);
    stack.repos.bases.updateAssignees(stack.base.id, {
      placements: { [commander!.id]: 3, [spy!.id]: 2 },
    });
    expect((await getAssignees(stack)).placed).toBe(5);

    // The spy walks out.
    stack.repos.bases.updateCommanders(stack.base.id, [commander!]);
    const after = await getAssignees(stack);
    expect(after.placed).toBe(3);
    // §G8 at level 10 is 2 + 9 + 2 = 13, so the two who came back are unplaced again.
    expect(after.pool).toBe(13);
    expect(after.unplaced).toBe(10);
    // And the correction is persisted, not just projected.
    expect(stack.repos.bases.findById(stack.base.id)?.assignees.placements).toEqual({
      [commander!.id]: 3,
    });
  });
});

describe('POST /api/assignees/place (§G2)', () => {
  it('places from the unplaced pool and reports the new §G7 bonus', async () => {
    const stack = await makeStack();
    const [officer] = staff(stack, ['field_commander'], 10);

    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/assignees/place',
      headers: auth(stack.token),
      payload: { officerId: officer!.id, count: 3 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ assignees: AssigneesResponse }>().assignees;
    expect(body.placed).toBe(3);
    expect(body.officers[0]).toMatchObject({ assignees: 3, bonusPercent: 14.5 });
    expect(stack.repos.bases.findById(stack.base.id)?.assignees.placements).toEqual({
      [officer!.id]: 3,
    });
  });

  it('refuses past the §G3 cap and past the §G8 pool, with distinct codes', async () => {
    const stack = await makeStack();
    const [officer] = staff(stack, ['field_commander'], 4);

    // Level 4: cap 2, pool 5.
    const overCap = await stack.app.inject({
      method: 'POST',
      url: '/api/assignees/place',
      headers: auth(stack.token),
      payload: { officerId: officer!.id, count: 3 },
    });
    expect(overCap.statusCode).toBe(409);
    expect(overCap.json<{ error: { code: string } }>().error.code).toBe('ASSIGNEES_AT_CAP');

    // Pool exhaustion is a different refusal from the cap. Level 10: pool 13, cap 5: park all
    // thirteen across three officers, then ask a fourth for one more. That request is well inside
    // the cap and still has nobody to draw on.
    const drained = await makeStack('drained');
    const crew = staff(drained, ['field_commander', 'head_spy', 'trader', 'scout'], 10);
    drained.repos.bases.updateAssignees(drained.base.id, {
      placements: { [crew[0]!.id]: 5, [crew[1]!.id]: 5, [crew[2]!.id]: 3 },
    });
    expect((await getAssignees(drained)).unplaced).toBe(0);

    const overPool = await drained.app.inject({
      method: 'POST',
      url: '/api/assignees/place',
      headers: auth(drained.token),
      payload: { officerId: crew[3]!.id, count: 1 },
    });
    expect(overPool.statusCode).toBe(409);
    expect(overPool.json<{ error: { code: string } }>().error.code).toBe('NO_ASSIGNEES');
  });

  it('404s an officer who is not on the books', async () => {
    const stack = await makeStack();
    staff(stack, ['field_commander'], 10);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/assignees/place',
      headers: auth(stack.token),
      payload: { officerId: 'nobody', count: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/assignees/reskill (§G4/§C4)', () => {
  it('is refused without a Professor, even for a legal plan', async () => {
    const stack = await makeStack();
    const [officer] = staff(stack, ['field_commander'], 10);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/assignees/reskill',
      headers: auth(stack.token),
      payload: { placements: { [officer!.id]: 1 } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NO_PROFESSOR');
  });

  it('reassigns everyone at once: the only way an assignee comes back off an officer', async () => {
    const stack = await makeStack();
    const [commander, professor] = staff(stack, ['field_commander', 'professor'], 10);
    stack.repos.bases.updateAssignees(stack.base.id, { placements: { [commander!.id]: 4 } });

    // §G2 placement cannot shrink `commander`; only this can.
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/assignees/reskill',
      headers: auth(stack.token),
      payload: { placements: { [commander!.id]: 1, [professor!.id]: 2 } },
    });
    expect(res.statusCode).toBe(200);
    expect(stack.repos.bases.findById(stack.base.id)?.assignees.placements).toEqual({
      [commander!.id]: 1,
      [professor!.id]: 2,
    });
  });

  /**
   * §A1 across §G2 and §G4: two doors onto one arrangement, and only one of them was locked.
   *
   * `/place` checks the district's housing after the §G rules, because beds are the district's
   * limit on top of what the pool entitles you to. `/reskill` writes exactly the same
   * `assignees.placements` and checked only the pool and the per-officer cap, so a plan the
   * placement route refuses bed by bed went through whole the moment it was posted as a plan.
   */
  it('refuses a plan the district has no beds for, the same as placing them one at a time', async () => {
    const stack = await makeStack('housed');
    const [commander, professor] = staff(stack, ['field_commander', 'professor'], 10);

    /*
     * Make beds the scarce thing rather than the pool or the cap.
     *
     * A fresh district houses more than one officer's cap, so a plan big enough to break the
     * ceiling would break the per-officer rule first and prove nothing about housing. Soldiers
     * draw on the same pool (§A1), so filling the yard with Razors leaves a district whose only
     * remaining limit is the one under test.
     */
    const before = (await getAssignees(stack)).housing;
    const room = before.capacity - before.used;
    const plan = 3;
    expect(room).toBeGreaterThan(plan);
    const owned = stack.repos.bases.findById(stack.base.id)!;
    stack.repos.bases.updateArmy(
      stack.base.id,
      { ...owned.army, razors: (owned.army.razors ?? 0) + (room - plan + 1) },
      owned.trainingQueue,
    );

    const housing = (await getAssignees(stack)).housing;
    expect(housing.capacity - housing.used).toBe(plan - 1);
    // The pool and the per-officer cap both have to allow it, or this proves nothing about beds.
    expect(plan).toBeLessThanOrEqual(assigneeCapPerOfficer(10));
    expect(plan).toBeLessThanOrEqual(assigneePool(10));

    // One at a time: refused, and told it is the housing.
    const placed = await stack.app.inject({
      method: 'POST',
      url: '/api/assignees/place',
      headers: auth(stack.token),
      payload: { officerId: commander!.id, count: plan },
    });
    expect(placed.statusCode).toBe(409);
    expect(placed.json<{ error: { code: string } }>().error.code).toBe('NO_HOUSING');

    // The same arrangement, posted as a plan.
    const reskilled = await stack.app.inject({
      method: 'POST',
      url: '/api/assignees/reskill',
      headers: auth(stack.token),
      payload: { placements: { [commander!.id]: plan } },
    });
    expect(reskilled.statusCode).toBe(409);
    expect(reskilled.json<{ error: { code: string } }>().error.code).toBe('NO_HOUSING');
    expect(stack.repos.bases.findById(stack.base.id)?.assignees.placements ?? {}).toEqual({});
    void professor;
  });

  it('applies none of an over-pool plan', async () => {
    const stack = await makeStack();
    const [commander, professor] = staff(stack, ['field_commander', 'professor'], 4);
    stack.repos.bases.updateAssignees(stack.base.id, { placements: { [commander!.id]: 2 } });

    // Level 4: cap 2, pool 5, but 2 + 2 is legal, so reach for the cap instead.
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/assignees/reskill',
      headers: auth(stack.token),
      payload: { placements: { [commander!.id]: 3, [professor!.id]: 1 } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('ASSIGNEES_AT_CAP');
    // Untouched.
    expect(stack.repos.bases.findById(stack.base.id)?.assignees.placements).toEqual({
      [commander!.id]: 2,
    });
  });
});

describe('§G6 at the launch gate', () => {
  const hard = MISSION_TEMPLATES.filter((template) => template.difficulty === 'hard');
  const easy = MISSION_TEMPLATES.filter((template) => template.difficulty === 'easy');

  it('has both difficulties on the board, and they are not just kind renamed', () => {
    expect(hard.length).toBeGreaterThan(0);
    expect(easy.length).toBeGreaterThan(0);
    // `deep-expedition` is a *standard* mission that is nonetheless hard: a full day beyond the
    // wire. If difficulty were derived from `kind` this would be impossible to express.
    const expedition = findMissionTemplate('deep-expedition') as MissionTemplate;
    expect(expedition.kind).toBe('standard');
    expect(expedition.difficulty).toBe('hard');
  });

  it('refuses every hard mission with no officer leading it', async () => {
    const stack = await makeStack();
    staff(stack, ['field_commander'], 10); // on the books, but not named on the request

    for (const template of hard) {
      const res = await stack.app.inject({
        method: 'POST',
        url: '/api/missions',
        headers: auth(stack.token),
        payload: { templateId: template.id },
      });
      expect(res.statusCode, template.id).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('MISSION_NEEDS_OFFICER');
    }
  });

  it('lets an easy mission go out on assignees alone: slower and with worse odds', async () => {
    const stack = await makeStack();
    staff(stack, ['field_commander'], 10);
    const siphon = findMissionTemplate('fuel-siphon') as MissionTemplate;
    expect(siphon.difficulty).toBe('easy');

    const alone = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: { templateId: siphon.id },
    });
    expect(alone.statusCode).toBe(200);
    const unled = alone.json<{ mission: Mission }>().mission;

    // Level 10: pool 13, cap 5, so the delegation is 5 strong, worth 23.5% (§G7).
    const delegation = 5;
    expect(assigneeBonusPercent(delegation)).toBe(23.5);
    // 45 × (1 − 0.235) × 1.5 = 51.6 → 52. Slower than the authored 45 despite the bonus.
    expect(unled.durationMinutes).toBe(52);
    expect(unled.durationMinutes).toBeGreaterThan(siphon.durationMinutes);

    // The same job under an officer with the same five people is strictly faster.
    const led = await makeStack('led');
    const [leader] = staff(led, ['field_commander'], 10);
    led.repos.bases.updateAssignees(led.base.id, { placements: { [leader!.id]: delegation } });
    const withOfficer = await led.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(led.token),
      payload: { templateId: siphon.id, officerId: leader!.id },
    });
    expect(withOfficer.statusCode).toBe(200);
    const ledMission = withOfficer.json<{ mission: Mission }>().mission;
    // 45 × (1 − 0.235) = 34.4 → 34.
    expect(ledMission.durationMinutes).toBe(34);
    expect(ledMission.durationMinutes).toBeLessThan(unled.durationMinutes);
  });

  /**
   * A named officer who is not on the books is a 404, not a quietly-penalised delegation. The easy
   * path is the one that could hide it: a hard mission would refuse anyway, but an easy one would
   * have launched at the §G6 penalty and charged the player 1.5x the clock for a typo.
   */
  it('404s a named officer who is not on the books, rather than running unled', async () => {
    const stack = await makeStack();
    staff(stack, ['field_commander'], 10);

    for (const templateId of ['fuel-siphon', 'deep-expedition']) {
      const res = await stack.app.inject({
        method: 'POST',
        url: '/api/missions',
        headers: auth(stack.token),
        payload: { templateId, officerId: 'not-on-the-books' },
      });
      expect(res.statusCode, templateId).toBe(404);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
    }
    // And nothing launched.
    expect(stack.repos.missions.countActiveByBaseId(stack.base.id)).toBe(0);
  });

  it('refuses an easy mission when there is nobody free to send at all', async () => {
    const stack = await makeStack();
    // Level 1: the whole pool is 2 and the cap is 1, so two officers hold the lot and nothing is
    // left unplaced for a delegation to draw on.
    const officers = staff(stack, ['field_commander', 'head_spy'], 1);
    stack.repos.bases.updateAssignees(stack.base.id, {
      placements: { [officers[0]!.id]: 1, [officers[1]!.id]: 1 },
    });

    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: { templateId: 'scrap-run' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NO_ASSIGNEES');
  });
});

describe('migration 0008', () => {
  it('backfills an existing base to an empty placement map', async () => {
    const stack = await makeStack();
    const row = stack.repos.bases.findById(stack.base.id);
    expect(row?.assignees).toEqual({ placements: {} });
  });
});
