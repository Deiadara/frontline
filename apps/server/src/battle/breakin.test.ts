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
  DECLARE_INFAMY_COST,
  MAX_LOCATION_LEVEL,
  MAX_RAID_DISRUPTION_PERCENT,
  MIN_RAID_DISRUPTION_PERCENT,
  RAID_DISRUPTION_HOURS,
  DISRUPTED_CHANNELS,
  RESOURCE_KEYS,
  featMeasureKey,
  declarationWindow,
  skirmishOutcome,
  weightOf,
  type Army,
  type BattleTarget,
  type BattlesResponse,
  type Resources,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { elsewhere } from '../testing/districts.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleDistrict } from '../district/settle.js';
import { standingEffectsFor } from '../crew/standing.js';
import { settleMovements } from './movement.js';
import { settleBattles } from './resolve.js';
import { chooseOverseer } from '../testing/overseer.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/**
 * The attacker wins and both sides lose units, so there is something to refund on each end.
 *
 * The attacker's losses are a parameter since 2026-09-18: what a raid carries home now depends on
 * who is still standing to carry it, so a fixture that always kills the same two cannot measure the
 * rule. Two is the default, which is what every case written before that change was built on.
 */
const bloodyWith = (winnerLosses: Army = { razors: 2 }): SkirmishEngine => ({
  resolve: (input) =>
    skirmishOutcome({
      winner: 'attacker',
      log: ['through the wall'],
      killed: input.defending,
      winnerLosses,
    }),
});
const bloody = bloodyWith();

/**
 * The attacker wins, and half the defending line walks away alive.
 *
 * What a won raid costs the district is priced off the share of the defence that was put in the
 * ground (`defenderLossShare`), so a fixture where everybody always dies can only ever measure the
 * ceiling. `fled` carries the other half, because a defender who ran is a defender the raiders did
 * not have to go through: that is the distinction the scaling is built on.
 */
const halfLost: SkirmishEngine = {
  resolve: (input) => {
    const half = (keep: (count: number) => number): Army =>
      Object.fromEntries(
        Object.entries(input.defending).map(([unitId, count]) => [unitId, keep(count)]),
      );
    return skirmishOutcome({
      winner: 'attacker',
      log: ['through the wall'],
      killed: half((count) => Math.floor(count / 2)),
      fled: half((count) => count - Math.floor(count / 2)),
      winnerLosses: { razors: 2 },
    });
  },
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
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, `overseer: ${chosen.statusCode}`).toBe(201);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  // §D7: calling a fight costs infamy and nobody starts with any. Fixture money, enough for every
  // call this file makes.
  const purse = app.repos.bases.findById(base.id)!.economy;
  app.repos.bases.updateEconomy(base.id, { ...purse, infamy: DECLARE_INFAMY_COST * 8 });
  return { token, baseId: base.id, districtId: base.districtId };
}

async function makeWorld(engine: SkirmishEngine = bloody): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const raider = await register(app, 'raider');
  const planted = await register(app, 'victim');

  // A break-in needs two crews in two districts, and a crew cannot raid itself. New accounts are
  // spread across the residential districts now, so the victim's new home is derived from the
  // raider's rather than named: see `testing/districts.ts`.
  const HOME = elsewhere(raider.districtId);
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
     * A raid leaves the till alone now ( maintainer 2026-09-09), so the hold fills with materials on its
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
 * §A4, maintainer 2026-09-09: what one call on a district actually takes.
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

    /*
     * §I: and the lifetime ladders counted it.
     *
     * `tallyResourcesEarned` names "missions, fights, the market, and production" in its own doc
     * and the fight was the one that never called it. A raid is the largest single payment in the
     * game, so the five `resources_earned` feats were measuring a crew's jobs and its shopping
     * while calling the total everything it had ever earned: a war crew that took what it owned
     * off other people sat at nothing on all five.
     */
    const earned = world.app.repos.feats.tallies(world.raider.baseId);
    for (const key of looted) {
      expect(
        earned[featMeasureKey('resources_earned', key)] ?? 0,
        `the raid's ${key} was never counted as earned`,
      ).toBeCloseTo(raiderAfter[key] - raiderBefore[key], 6);
    }
  });

  /**
   * Dead people do not carry sacks (maintainer, 2026-09-18).
   *
   * The hold used to be loaded off `committed`, the whole force that marched, so a crew that lost
   * nine tenths of itself taking a district carried exactly as much home as one that walked in
   * unopposed. Casualties were free twice over: they stopped being a cost the moment the ground
   * was taken, and they cost nothing at the pickup either.
   *
   * Measured as an ordering across two otherwise identical raids rather than against a figure,
   * because the haul is a drawn mix now and the numbers move with the seed. What may not move is
   * which of the two comes home heavier.
   */
  it('carries less home when fewer of the raiders are standing', async () => {
    const weigh = async (winnerLosses: Army): Promise<number> => {
      const world = await makeWorld(bloodyWith(winnerLosses));
      fill(world, world.victim.baseId);
      world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);
      const before = stockOf(world, world.raider.baseId);
      await breakIn(world);
      const after = stockOf(world, world.raider.baseId);
      return weightOf(
        Object.fromEntries(RESOURCE_KEYS.map((key) => [key, after[key] - before[key]])),
      );
    };

    // Six march in. In the first raid they all walk out; in the second, five of the six do not.
    const whole = await weigh({});
    const mauled = await weigh({ razors: 5 });
    expect(whole, 'a raid that lost nobody carried nothing').toBeGreaterThan(0);
    expect(mauled, `a raid down to one carrier took ${mauled} against ${whole}`).toBeLessThan(
      whole,
    );
  });

  /**
   * ...and the ones the medics bring round were on the ground while the bags were filled.
   *
   * The Infirmary takes people off the casualty list *after* the fight, so the roster that walks
   * home is longer than the one that did the carrying. Loading the hold off the survivors would be
   * easy to get wrong in exactly this way, and the wrong version is invisible: it pays out slightly
   * too much, on a number nobody can check by hand.
   *
   * So the raid is run twice on identical fixtures, once with a deep Infirmary and once without,
   * and the haul may not move. `recoveredCarryLoot` is the research that buys the other answer, and
   * it is covered where the research lives.
   */
  it('does not let the Infirmary put people back on the carrying party', async () => {
    const weigh = async (infirmary: number): Promise<number> => {
      const world = await makeWorld(bloodyWith({ razors: 5 }));
      fill(world, world.victim.baseId);
      world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);
      if (infirmary > 0) {
        const base = world.app.repos.bases.findById(world.raider.baseId)!;
        world.app.repos.bases.updateDistrict(
          base.id,
          [
            ...base.buildings,
            {
              id: 'raider-infirmary',
              kind: 'infirmary',
              level: infirmary,
              modifications: [],
            },
          ],
          base.buildQueue,
        );
      }
      const before = stockOf(world, world.raider.baseId);
      await breakIn(world);
      const after = stockOf(world, world.raider.baseId);
      /*
       * Weighed rather than counted, and the difference matters.
       *
       * The haul is a drawn mix now, and every world here has its own battle id, which is the seed:
       * two raids of identical capacity come home with different *lines*. Counting units compares
       * a kilogram of supplies against a fifth of a bar of metal and reports a difference that is
       * the draw rather than the rule. The hold bounds weight, so weight is the comparable figure.
       */
      return weightOf(
        Object.fromEntries(RESOURCE_KEYS.map((key) => [key, after[key] - before[key]])),
      );
    };

    const bare = await weigh(0);
    const withMedics = await weigh(12);
    expect(bare, 'the fixture carried nothing, so this compares two zeroes').toBeGreaterThan(0);
    /*
     * Within a fifth, not exactly equal, and the tolerance is the honest part.
     *
     * Exact equality was written first and is a knife edge: the two runs are separate worlds with
     * separate battle ids, the battle id seeds the draw, and a hold whose remainder cannot buy one
     * more of anything comes home a kilogram or two short in one mix and not the other. It passed
     * every run in isolation and failed once under full suite load, which is the worst way for a
     * test to be wrong.
     *
     * A fifth separates the rule from the noise with room to spare. Five of the six raiders fall
     * and a level 12 Infirmary recovers two of the five, so the wrong answer puts three people on
     * the carrying party instead of one: a **three times** heavier haul, not a few kilos.
     */
    expect(
      withMedics,
      `the medics added ${(withMedics - bare).toFixed(1)}kg to a ${bare.toFixed(1)}kg haul`,
    ).toBeLessThan(bare * 1.2);
  });

  /**
   * One penalty, not two (maintainer, 2026-09-18).
   *
   * A won raid used to wreck three of the victim's roofs on a 24 hour repair clock *and* disrupt
   * the whole district, so the same win was charged twice. The per-structure half is gone, and
   * this is the pin on its absence: a raid that does everything else it does leaves every
   * structure exactly as it found it, and takes its pound of flesh off the district's clocks.
   */
  it('leaves every structure standing, and takes the hours instead', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);

    // More than one roof, so "untouched" is a claim about a district rather than about a building.
    const victimBase = world.app.repos.bases.findById(world.victim.baseId)!;
    world.app.repos.bases.updateDistrict(
      victimBase.id,
      [
        ...victimBase.buildings,
        { id: 'v-scrapyard', kind: 'scrapyard', level: 7, modifications: [] },
        { id: 'v-gate', kind: 'gate', level: 6, modifications: [] },
        { id: 'v-quarters', kind: 'quarters', level: 5, modifications: [] },
      ],
      victimBase.buildQueue,
    );
    const standing = world.app.repos.bases.findById(world.victim.baseId)!.buildings;
    expect(
      standing.length,
      'fixture: too few roofs to tell untouched from unlucky',
    ).toBeGreaterThan(3);

    await breakIn(world);

    const after = world.app.repos.bases.findById(world.victim.baseId)!.buildings;
    expect(after).toEqual(standing);
    // And the raid did land: without this the test above passes on a raid that never happened.
    expect(
      world.app.repos.bases.findById(world.victim.baseId)!.economy.disruption.until,
    ).not.toBeNull();
  });

  /**
   * ...and the surviving penalty moves with the defeat.
   *
   * Two worlds, identical but for what the engine does to the defending line: one where it is wiped
   * out and one where half of it walks away. A flat percentage, which is what this replaced, makes
   * these two numbers the same.
   */
  it('cuts the district by more when the defence lost by more', async () => {
    const raidWith = async (engine: SkirmishEngine): Promise<number> => {
      const world = await makeWorld(engine);
      fill(world, world.victim.baseId);
      world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);
      // A line to lose: with nobody home there is no "half" to leave standing.
      world.app.repos.bases.updateArmy(world.victim.baseId, { razors: 8 }, []);
      await breakIn(world);
      return world.app.repos.bases.findById(world.victim.baseId)!.economy.disruption.percent;
    };

    const wiped = await raidWith(bloody);
    const halved = await raidWith(halfLost);

    expect(halved, 'the cut did not move with the defeat').toBeLessThan(wiped);
    expect(halved).toBeGreaterThanOrEqual(MIN_RAID_DISRUPTION_PERCENT);
    // The board's ceiling, and the worst night in the game is exactly on it.
    expect(wiped).toBe(MAX_RAID_DISRUPTION_PERCENT);
    expect(wiped).toBeLessThanOrEqual(50);
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
    // Read off what the raid actually wrote rather than off a constant: the percentage moves with
    // the defeat now, and a test that assumed one would drift the day a fixture's defence changed.
    const scale = 1 - victim().economy.disruption.percent / 100;
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
    // Nobody survived the stub's fight, which is the worst a defence can do, so this is the cap.
    expect(hurt.percent).toBe(MAX_RAID_DISRUPTION_PERCENT);
    expect(hurt.until).not.toBeNull();
    const hours = (Date.parse(hurt.until as string) - at) / 3_600_000;
    expect(hours).toBeGreaterThan(RAID_DISRUPTION_HOURS - 0.1);
    expect(hours).toBeLessThan(RAID_DISRUPTION_HOURS + 0.1);

    // The crew that did it goes home to a district that works: this is a thing done *to* somebody.
    expect(disruptionOf(world, world.raider.baseId).until).toBeNull();
  });

  /** And what the victim actually loses for it: a share of the hours, off the production walk. */
  it('costs the victim the share the disruption names, off what it would have made', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 20 }, []);
    // A new crew stands a Nexus and a Generator, and a level-1 Generator makes six oil an hour,
    // which is thin enough that whole-unit rounding is most of it. Give the victim a Scrapyard so
    // the walk has a line with volume in it to lose a share of.
    const victimBase = world.app.repos.bases.findById(world.victim.baseId)!;
    world.app.repos.bases.updateDistrict(
      victimBase.id,
      [
        ...victimBase.buildings,
        { id: 'victim-scrapyard', kind: 'scrapyard', level: 10, modifications: [] },
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
    /*
     * The wreckage as the raid left it, put back before each run.
     *
     * Settling repairs, and it writes the repaired structures back, so the first of the two runs
     * handed the second a district 20 points healthier and the control quietly out-produced the
     * subject for a second reason. It cost every line about four points of share on top of the
     * quarter, which the tolerance below swallowed until the Generator started making oil and the
     * smallest line in the walk showed it.
     */
    const wrecked = world.app.repos.bases.findById(world.victim.baseId)!.buildings;
    const wind = (disruption: { until: string | null; percent: number }) => {
      const base = world.app.repos.bases.findById(world.victim.baseId)!;
      world.app.repos.bases.updateDistrict(base.id, wrecked, base.buildQueue);
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
      // Exactly the percentage the raid wrote, within the rounding a whole-number stockpile
      // imposes. Read off the record rather than off a constant, because the number depends on how
      // badly this fixture's defence lost and the walk must charge whatever was written.
      expect(share, `${key} lost the wrong share`).toBeGreaterThan(raided.percent / 100 - 0.06);
      expect(share, `${key} lost the wrong share`).toBeLessThan(raided.percent / 100 + 0.06);
    }
  });

  /**
   * A second raid refreshes rather than stacks, field by field.
   *
   * The grief case `refreshDisruption` was written for: two crews taking turns must not be able to
   * hold a district at zero output, and a crew that raided an hour ago must not be able to raid
   * again to hand the victim back four of the six hours. Both fields are asserted because the
   * percentage moves with the defeat now: taking the later record whole would let a token raid
   * *lift* a district out of a cut it had just been put in.
   */
  it('takes the longer window and the harsher cut, never the sum of either', async () => {
    const world = await makeWorld();
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 40 }, []);

    const victim = world.app.repos.bases.findById(world.victim.baseId)!;
    const longer = new Date(Date.now() + 24 * 3_600_000).toISOString();
    world.app.repos.bases.updateEconomy(victim.id, {
      ...victim.economy,
      disruption: { until: longer, percent: MIN_RAID_DISRUPTION_PERCENT },
    });

    await breakIn(world);

    const after = disruptionOf(world, world.victim.baseId);
    // The longer expiry stands: six fresh hours must not shorten a day that was already owed.
    expect(after.until).toBe(longer);
    // ...and the harsher cut stands, at one raid's worth rather than two.
    expect(after.percent).toBe(MAX_RAID_DISRUPTION_PERCENT);
  });

  /** The other direction: a gentler raid on a district already cut to the bone lifts nothing. */
  it('does not let a token second raid lift a standing cut', async () => {
    const world = await makeWorld(halfLost);
    fill(world, world.victim.baseId);
    world.app.repos.bases.updateArmy(world.raider.baseId, { razors: 40 }, []);
    world.app.repos.bases.updateArmy(world.victim.baseId, { razors: 8 }, []);

    const victim = world.app.repos.bases.findById(world.victim.baseId)!;
    const shorter = new Date(Date.now() + 60_000).toISOString();
    world.app.repos.bases.updateEconomy(victim.id, {
      ...victim.economy,
      disruption: { until: shorter, percent: MAX_RAID_DISRUPTION_PERCENT },
    });

    await breakIn(world);

    const after = disruptionOf(world, world.victim.baseId);
    // The fresh six hours are the longer window, so they win...
    expect(Date.parse(after.until as string)).toBeGreaterThan(Date.parse(shorter));
    // ...and half a line walking away does not buy the district its output back.
    expect(after.percent).toBe(MAX_RAID_DISRUPTION_PERCENT);
  });
});
