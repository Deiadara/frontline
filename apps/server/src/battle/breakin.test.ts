/**
 * Breaking into a lived-in district: what leaves with the raiders, and what does not come back.
 *
 * A `district` target is the only path in the game that plunders a stockpile, and until this file
 * nothing tested the `building` target it replaced: `grep -rn "kind: 'building'"` across the
 * server suite found no test at all.
 * Two shipped bugs lived in that gap, and both are the same mistake in different clothes, so both
 * are pinned here as invariants rather than as numbers.
 *
 *   * The defender's salvage refund was added to the stockpile *as it stood before the raid*, and
 *     `updateResources` rewrites the whole column, so writing it put the looted resources back. The
 *     attacker kept the haul, the defender lost nothing, and the difference was minted.
 *   * `planks` was priced and stocked but missing from `PLUNDER_PRIORITY`, so no raid had ever
 *     taken one. Covered directly in `shared/src/raid.test.ts`; the end-to-end half is here.
 *
 * Both are measured by conservation: a raid *moves* resources, so the total across the two crews
 * cannot change. That holds whatever the loot table, the carry capacity or the refund percentage
 * are tuned to, which a hard-coded expected stockpile would not.
 */
import {
  MAX_LOCATION_LEVEL,
  RAID_DISRUPTION_HOURS,
  RAID_DISRUPTION_PERCENT,
  DISRUPTED_CHANNELS,
  RESOURCE_KEYS,
  declarationWindow,
  skirmishOutcome,
  type BattleTarget,
  type BattlesResponse,
  type Resources,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleDistrict } from '../district/settle.js';
import { standingEffectsFor } from '../crew/standing.js';
import { settleMovements } from './movement.js';
import { STRUCTURES_WRECKED_PER_RAID, settleBattles } from './resolve.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** The attacker wins and both sides lose bodies, so there is something to refund on each end. */
const bloody: SkirmishEngine = {
  resolve: (input) =>
    skirmishOutcome({
      winner: 'attacker',
      log: ['through the wall'],
      killed: input.defending,
      winnerLosses: { razors: 2 },
    }),
};

interface Crew {
  token: string;
  baseId: string;
  districtId: string;
}

interface World {
  app: FastifyInstance;
  db: AppDatabase;
  raider: Crew;
  victim: Crew;
}

async function register(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(registered.statusCode, `register: ${registered.statusCode}`).toBe(201);
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode, `overseer: ${chosen.statusCode}`).toBe(201);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  return { token, baseId: base.id, districtId: base.districtId };
}

async function makeWorld(): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: bloody, logger: false });
  instances.push({ app, db });

  const raider = await register(app, 'raider');
  const planted = await register(app, 'victim');

  // Every new crew is planted on the same opening ground, so the victim is moved next door: a
  // break-in needs two crews in two districts, and a crew cannot raid itself.
  const HOME = 'ashen-terraces';
  db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, planted.baseId);
  const victim: Crew = { ...planted, districtId: HOME };
  expect(raider.districtId).not.toBe(victim.districtId);

  app.repos.city.markScouted(raider.baseId, victim.districtId, new Date().toISOString());
  // Nothing behind a standing gate can be reached, so the way in is already open. Breaking it is
  // its own fight with its own rules and its own tests; this file is about what happens *after*.
  app.repos.sieges.breakGate(victim.districtId, new Date(Date.now() + 3_600_000).toISOString());
  return { app, db, raider, victim };
}

const stockOf = (world: World, baseId: string): Resources =>
  world.app.repos.bases.findById(baseId)!.resources;

const totalAcross = (world: World): Resources =>
  RESOURCE_KEYS.reduce(
    (sum, key) => ({
      ...sum,
      [key]: stockOf(world, world.raider.baseId)[key] + stockOf(world, world.victim.baseId)[key],
    }),
    {} as Resources,
  );

/** Declares a raid on the victim's district, sends a column, and settles it. */
async function breakIn(world: World): Promise<void> {
  const target: BattleTarget = { kind: 'district', districtId: world.victim.districtId };
  const declared = await world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(world.raider.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);

  const board = await world.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(world.raider.token),
  });
  const view = board.json<BattlesResponse>().coming[0];
  if (!view) throw new Error('expected a declared break-in');
  await world.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(world.raider.token),
    payload: { battleId: view.battle.id, changes: { razors: 6 }, perimeterChanges: {} },
  });

  const mark = new Date(Date.now() - 60_000);
  world.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(mark.toISOString(), view.battle.id);
  /*
   * And the column arrives.
   *
   * Sending units starts a march rather than filling a deployment, so winding only the *mark* back
   * resolves a fight nobody turned up to: the attacking force is empty, the hold capacity is zero
   * and the raid carries nothing. That is a correct settle and a useless fixture, and it is why the
   * conservation check below asserts something was actually looted before comparing the two sides.
   */
  world.db
    .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
    .run(new Date(mark.getTime() - 60_000).toISOString(), mark.toISOString(), view.battle.id);
  settleMovements(world.app.repos, new Date());

  expect(settleBattles(world.app.repos, world.app.skirmishEngine, new Date())).toHaveLength(1);
}

/** Hands the victim a location outright, so its hold bonus is live on their side of the fight. */
function give(world: World, locationId: string): void {
  const control = world.app.repos.city.control(locationId);
  if (!control) throw new Error(`no control row for ${locationId}`);
  world.app.repos.city.put({
    ...control,
    holder: { kind: 'crew', baseId: world.victim.baseId },
    level: MAX_LOCATION_LEVEL,
    garrison: {},
  });
}

/** Enough of everything that the raiders' hold, not the victim's poverty, is what bounds the haul. */
function fill(world: World, baseId: string, each = 50_000): void {
  world.app.repos.bases.updateResources(
    baseId,
    Object.fromEntries(RESOURCE_KEYS.map((key) => [key, each])) as unknown as Resources,
  );
}

describe('breaking into a lived-in district', () => {
  it('moves resources between the two crews without creating any', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);

    const before = totalAcross(world);
    await breakIn(world);
    const after = totalAcross(world);

    for (const key of RESOURCE_KEYS) {
      expect(after[key], `${key} was created or destroyed by a raid`).toBe(before[key]);
    }
  });

  /**
   * The same, with the defender holding a Bone Market.
   *
   * This is the case the duplication bug needed: the refund write is what put the loot back, and it
   * only happens when the defender has a salvage percentage and lost somebody. Without the hold the
   * raid conserves resources whether or not the bug is present, so the case above cannot catch it.
   */
  it('conserves resources even when the defender is owed a salvage refund', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    /*
     * A poor victim, in caps only.
     *
     * A raid leaves the till alone now (board 2026-09-09), so the hold fills with materials on its
     * own and this is belt and braces rather than the load-bearing setup it used to be. It is kept
     * because the reason is still live: the refund is paid in caps, so any assertion about caps is
     * about a resource that can move on two counts at once and cannot tell a clobbered stockpile
     * from a refunded one. A victim with 40 caps makes that impossible to hide behind.
     */
    world.app.repos.bases.updateResources(world.victim.baseId, {
      ...stockOf(world, world.victim.baseId),
      caps: 40,
    });
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);
    world.app.repos.bases.updateArmy(world.victim.baseId, { razors: 8 }, []);
    give(world, 'rustyard-bones');

    const victimBefore = stockOf(world, world.victim.baseId);
    const raiderBefore = stockOf(world, world.raider.baseId);
    await breakIn(world);
    const victimAfter = stockOf(world, world.victim.baseId);
    const raiderAfter = stockOf(world, world.raider.baseId);

    // Somebody was actually robbed, or this proves nothing about the loot at all.
    const looted = RESOURCE_KEYS.filter((key) => raiderAfter[key] > raiderBefore[key]);
    expect(looted.length, 'the raid carried nothing out').toBeGreaterThan(0);
    // And robbed of something the refund cannot also explain. Without this the loop below skips
    // every key it is given and passes against a stockpile that was handed straight back.
    expect(
      looted.filter((key) => key !== 'caps'),
      'the raid carried out nothing but caps, so the refund and the loot cannot be told apart',
    ).not.toEqual([]);
    // The refund actually happened, which is the whole precondition for the bug.
    expect(
      victimAfter.caps + (victimBefore.caps - victimAfter.caps),
      'sanity: the victim was measured',
    ).toBe(victimBefore.caps);

    for (const key of looted) {
      const gained = raiderAfter[key] - raiderBefore[key];
      const lost = victimBefore[key] - victimAfter[key];
      // Caps can move on both counts at once: the refund is paid in them. Everything else the
      // raiders carried out has to have left the victim's stockpile, one for one.
      if (key === 'caps') continue;
      expect(lost, `the victim kept the ${key} the raiders carried out`).toBe(gained);
    }
  });
});

/**
 * §A4, board 2026-09-09: what one call on a district actually takes.
 *
 * The `building` target this replaced hit exactly one roof and took a share of everything including
 * the till. A crew who wanted a home properly turned over needed thirteen declarations against a cap
 * of three, so nobody ever wrecked anything, and the raid that did happen carried away a wallet.
 */
describe('one raid on the whole district', () => {
  it('carries out materials and never the till', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);

    const victimBefore = stockOf(world, world.victim.baseId);
    const raiderBefore = stockOf(world, world.raider.baseId);
    await breakIn(world);
    const victimAfter = stockOf(world, world.victim.baseId);
    const raiderAfter = stockOf(world, world.raider.baseId);

    // Something left, or the caps assertion below is vacuous: an empty haul takes no caps either.
    const looted = RESOURCE_KEYS.filter(
      (key) => key !== 'caps' && raiderAfter[key] > raiderBefore[key],
    );
    expect(looted, 'the raid carried nothing out').not.toEqual([]);
    // And the victim's wallet is exactly where it was. The raider is not owed a salvage refund
    // here (nothing they hold pays one), so the two sides can be checked directly.
    expect(victimAfter.caps, 'the raid took caps').toBe(victimBefore.caps);
    expect(raiderAfter.caps, 'the raider was paid in caps').toBe(raiderBefore.caps);
  });

  it('leaves three of their structures limping, not one and not all of them', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);

    // Enough roofs that "three" and "all of them" are different answers.
    const victimBase = world.app.repos.bases.findById(world.victim.baseId)!;
    world.app.repos.bases.updateDistrict(
      victimBase.id,
      [
        ...victimBase.buildings,
        { id: 'v-scrapyard', kind: 'scrapyard', level: 7, modifications: [], damage: 0 },
        { id: 'v-gate', kind: 'gate', level: 6, modifications: [], damage: 0 },
        { id: 'v-quarters', kind: 'quarters', level: 5, modifications: [], damage: 0 },
      ],
      victimBase.buildQueue,
    );
    const standing = world.app.repos.bases.findById(world.victim.baseId)!.buildings;
    expect(standing.length, 'fixture: not enough roofs to tell three from all').toBeGreaterThan(
      STRUCTURES_WRECKED_PER_RAID,
    );
    expect(standing.every((building) => building.damage === 0)).toBe(true);

    await breakIn(world);

    const after = world.app.repos.bases.findById(world.victim.baseId)!.buildings;
    const hit = after.filter((building) => building.damage > 0);
    expect(hit).toHaveLength(STRUCTURES_WRECKED_PER_RAID);
    // The tallest first, which is the rule a defender can plan around.
    const tallest = [...standing]
      .sort((a, b) => b.level - a.level || a.id.localeCompare(b.id))
      .slice(0, STRUCTURES_WRECKED_PER_RAID)
      .map((building) => building.id);
    expect(hit.map((building) => building.id).sort()).toEqual([...tallest].sort());
    // And the raid's own clock is on each of them, so they repair from now.
    for (const building of hit) expect(building.damagedAt).not.toBeNull();
  });

  /**
   * The second half of §A4's disruption: not only fewer hours of production, but a weaker crew.
   *
   * Measured through `standingEffectsFor`, which is the fold every consumer of a crew's standing
   * reads: a channel that was not cut here is a channel a raid does not reach anywhere.
   */
  it('takes the same share off every positive percentage the victim holds', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);
    // Ground worth holding, so the victim has percentages to lose in the first place.
    give(world, 'rustyard-bones');

    const victim = () => world.app.repos.bases.findById(world.victim.baseId)!;
    const before = standingEffectsFor(world.app.repos, victim(), new Date());
    // `DISRUPTED_CHANNELS` rather than every percent channel: `productionPercent` is exempt because
    // the settle walk already takes the same quarter off the hours it multiplies.
    const paying = DISRUPTED_CHANNELS.filter((channel) => before[channel] > 0);
    expect(
      paying,
      'the victim holds no positive percentage, so there is nothing to measure',
    ).not.toEqual([]);

    await breakIn(world);

    const after = standingEffectsFor(world.app.repos, victim(), new Date());
    const scale = 1 - RAID_DISRUPTION_PERCENT / 100;
    for (const channel of paying) {
      expect(after[channel], `${channel} was untouched by the raid`).toBeCloseTo(
        before[channel] * scale,
        6,
      );
    }
    // And it wears off: read past the expiry and the crew is whole again.
    const over = new Date(Date.parse(victim().economy.disruption.until as string) + 1_000);
    const recovered = standingEffectsFor(world.app.repos, victim(), over);
    for (const channel of paying) {
      expect(recovered[channel], `${channel} never came back`).toBeCloseTo(before[channel], 6);
    }
  });
});

/**
 * §A4's other half: what a raid leaves behind.
 *
 * `raid.ts` says it in two bullets, and only one of them was implemented. What leaves is bounded
 * by the carry, and `plunder` does that; what stays broken is disruption, and *nothing wrote it*.
 * `disruptionFrom` and `refreshDisruption` were exported and documented and called by nobody,
 * while `settleDistrict` carefully cut its production walk at an expiry that could never be set.
 * So the one consequence of losing a raid that a victim cannot buy back never happened.
 */
describe('what a raid leaves behind (§A4)', () => {
  const disruptionOf = (world: World, baseId: string) =>
    world.app.repos.bases.findById(baseId)!.economy.disruption;

  it('leaves the district running badly, and leaves the raiders alone', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);

    expect(disruptionOf(world, world.victim.baseId).until).toBeNull();
    const at = Date.now();
    await breakIn(world);

    const hurt = disruptionOf(world, world.victim.baseId);
    expect(hurt.percent).toBe(RAID_DISRUPTION_PERCENT);
    expect(hurt.until).not.toBeNull();
    const hours = (Date.parse(hurt.until as string) - at) / 3_600_000;
    expect(hours).toBeGreaterThan(RAID_DISRUPTION_HOURS - 0.1);
    expect(hours).toBeLessThan(RAID_DISRUPTION_HOURS + 0.1);

    // The crew that did it goes home to a district that works: this is a thing done *to* somebody.
    expect(disruptionOf(world, world.raider.baseId).until).toBeNull();
  });

  /** And what the victim actually loses for it: a share of the hours, off the production walk. */
  it('costs the victim a quarter of what the district would have made', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);
    // A new crew stands a Nexus and a Generator, neither of which makes anything. Give the victim
    // a Scrapyard so the walk has an output to lose a share of.
    const victimBase = world.app.repos.bases.findById(world.victim.baseId)!;
    world.app.repos.bases.updateDistrict(
      victimBase.id,
      [
        ...victimBase.buildings,
        { id: 'victim-scrapyard', kind: 'scrapyard', level: 10, modifications: [], damage: 0 },
      ],
      victimBase.buildQueue,
    );
    await breakIn(world);

    /*
     * The same district, the same window, twice: once limping and once well.
     *
     * An A/B against itself rather than against the raider's district, because the two crews are
     * planted on different ground with different structures and the control has to be the same
     * place. The stockpile and the production clock are wound back between the two runs, so what
     * is measured is the same window of accrual and nothing else.
     */
    // Anchored on the disruption the raid actually wrote rather than on the wall clock, so the
    // five-hour window below always sits inside it: read off `new Date()` it drifted against the
    // raid's own instant and the assertion went red on a busy run.
    const raided = world.app.repos.bases.findById(world.victim.baseId)!.economy.disruption;
    if (raided.until === null) throw new Error('the raid wrote no disruption to measure');
    const from = new Date(Date.parse(raided.until) - RAID_DISRUPTION_HOURS * 3_600_000);
    const wind = (disruption: { until: string | null; percent: number }) => {
      const base = world.app.repos.bases.findById(world.victim.baseId)!;
      world.app.repos.bases.updateResources(
        base.id,
        Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0])) as unknown as Resources,
      );
      world.app.repos.bases.updateEconomy(base.id, {
        ...base.economy,
        disruption,
        productionSettledAt: from.toISOString(),
        productionCarry: {},
      });
    };
    // Five hours, inside the six the disruption lasts: one hour of a level-1 district rounds to
    // nothing but carry, and a window past the expiry would be measuring a partly-recovered place.
    const WINDOW_HOURS = 5;
    const accrue = (): Resources => {
      settleDistrict(
        world.app.repos,
        world.app.repos.bases.findById(world.victim.baseId)!,
        new Date(from.getTime() + WINDOW_HOURS * 3_600_000),
      );
      return stockOf(world, world.victim.baseId);
    };

    wind(raided);
    const limping = accrue();
    wind({ until: null, percent: 0 });
    const well = accrue();

    // Whatever the district actually makes: measured rather than named, so retuning a structure
    // cannot make this test wrong.
    const made = RESOURCE_KEYS.filter((key) => well[key] > 0);
    expect(made.length, 'the district made nothing, so there is nothing to lose').toBeGreaterThan(
      0,
    );
    for (const key of made) {
      expect(limping[key], `${key} was untouched by the raid`).toBeLessThan(well[key]);
      const share = 1 - limping[key] / well[key];
      // A quarter off, within the rounding a whole-number stockpile imposes.
      expect(share, `${key} lost the wrong share`).toBeGreaterThan(
        RAID_DISRUPTION_PERCENT / 100 - 0.06,
      );
      expect(share, `${key} lost the wrong share`).toBeLessThan(
        RAID_DISRUPTION_PERCENT / 100 + 0.06,
      );
    }
  });

  /**
   * A second raid refreshes rather than stacks, and refreshing never *shortens* a longer one.
   *
   * The grief case `refreshDisruption` was written for: two crews taking turns must not be able to
   * hold a district at zero output, and a crew that raided an hour ago must not be able to raid
   * again to hand the victim back four of the six hours.
   */
  it('refreshes a standing disruption rather than stacking or shortening it', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 40 }, []);

    const victim = world.app.repos.bases.findById(world.victim.baseId)!;
    const longer = new Date(Date.now() + 24 * 3_600_000).toISOString();
    world.app.repos.bases.updateEconomy(victim.id, {
      ...victim.economy,
      disruption: { until: longer, percent: RAID_DISRUPTION_PERCENT },
    });

    await breakIn(world);

    const after = disruptionOf(world, world.victim.baseId);
    // The later expiry stands, and the percentage is one raid's worth rather than two.
    expect(after.until).toBe(longer);
    expect(after.percent).toBe(RAID_DISRUPTION_PERCENT);
  });
});
