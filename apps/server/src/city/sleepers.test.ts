import {
  CITY_LOCATIONS,
  DECLARE_INFAMY_COST,
  declarationWindow,
  findLocation,
  MAX_LOCATION_LEVEL,
  reportReaches,
  type Base,
  type BattlesResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleSleepers } from './sleepers.js';
import { settleBattles } from '../battle/resolve.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * §A4: Sleepers planted on ground nobody has fought over yet (maintainer, 2026-09-18).
 *
 * "They can be sent to a location despite of a battle and they just stay there doing nothing. If
 * a battle is called there they automatically participate as attackers when it's time, but up to
 * that point they are not visible by an enemy spy or anything."
 *
 * The rule this bends is the one every other unit obeys: force reaches a fight by being **sent to
 * one**, and the walk is therefore always paid inside the window everybody can see. A cell pays
 * it days early. So the tests that matter are about the seams either side of that: the door
 * refuses the sheets and the ground it should, the walk actually happens in both directions, and
 * the cell is standing in the deployment the moment the crew declares.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface World {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  base: Base;
  /** A location in a district this crew has scouted and does not hold. */
  locationId: string;
  districtId: string;
}

async function makeWorld(army: Record<string, number> = { sleepers: 6 }): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_planter', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  /*
   * Somewhere they can point at: open contested ground they have seen inside and do not live on.
   *
   * Not `elsewhere`, which answers with a *residential* district and those hold no locations at
   * all: a cell is planted on a location, so the fixture has to stand on ground that has them.
   *
   * Named rather than taken off the front of `CITY_LOCATIONS`, which the 2026-09-19 re-cut turned
   * into the Docks: Combine ground, held end to end, which means shut, which means every
   * declaration below was refused in favour of the gate. It also means a garrison on the plot
   * before anybody plants anything, and one case here reads that count expecting zero.
   *
   * Coin-Op Row is in Chrome Row's open half. `startingHolder` squats the four highest
   * `baseDefense` plots in an open district, which here are the Exchange, Cathode Tower, the
   * Overlook and the Statue, and leaves Saint Ferrous, the Regal, the Cracked Anvil and Coin-Op
   * Row standing empty. So the district has a seam and the plot has nobody on it.
   */
  const location = findLocation('chrome-row-coinop');
  if (!location) throw new Error('Coin-Op Row is not on the map');
  const districtId = location.districtId;
  app.repos.city.markScouted(baseId, districtId, new Date().toISOString());

  app.repos.bases.updateArmy(baseId, army, []);
  const base = app.repos.bases.findById(baseId)!;
  // §D7: calling a fight costs a name, and one of the tests below calls one.
  app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: DECLARE_INFAMY_COST * 3 });

  return { app, db, token, base, locationId: location.id, districtId };
}

const plant = (world: World, army: Record<string, number>) =>
  world.app.inject({
    method: 'POST',
    url: '/api/city/sleepers',
    headers: auth(world.token),
    payload: { locationId: world.locationId, army },
  });

/** Winds every walk back so the settle picks it up, then runs it. */
function landEverything(world: World): void {
  const past = new Date(Date.now() - 60_000).toISOString();
  world.db.prepare('UPDATE sleeper_cells SET arrives_at = ?').run(past);
  settleSleepers(world.app.repos, new Date());
}

const cells = (world: World) => world.app.repos.sleepers.forBase(world.base.id);
const armyOf = (world: World) => world.app.repos.bases.findById(world.base.id)!.army;

describe('planting a cell', () => {
  it('takes them off the roster and puts them on the road', async () => {
    const world = await makeWorld();
    const sent = await plant(world, { sleepers: 4 });
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);

    // Off the roster at once, exactly as a deployment takes them: a crew that promised the same
    // four to two places would be finding out which one they turned up at.
    expect(armyOf(world).sleepers).toBe(2);

    const [cell] = cells(world);
    expect(cell?.phase).toBe('outbound');
    expect(cell?.army).toEqual({ sleepers: 4 });
    // The walk is real, which is the whole value of planting early.
    expect(Date.parse(cell!.arrivesAt)).toBeGreaterThan(Date.parse(cell!.departedAt));
  });

  it('lands them, and a second cell merges into the first', async () => {
    const world = await makeWorld();
    await plant(world, { sleepers: 2 });
    landEverything(world);
    expect(cells(world)[0]?.phase).toBe('waiting');

    await plant(world, { sleepers: 3 });
    landEverything(world);

    // One row per crew per location: every reader downstream assumes it.
    expect(cells(world)).toHaveLength(1);
    expect(cells(world)[0]?.army).toEqual({ sleepers: 5 });
  });

  it('refuses a sheet that does not go to ground, and ground the crew holds', async () => {
    const world = await makeWorld({ sleepers: 4, razors: 10 });

    const wrongSheet = await plant(world, { razors: 5 });
    expect(wrongSheet.statusCode).toBe(409);
    expect(wrongSheet.body).toContain('Only Sleepers');
    // Nothing left the roster on a refusal.
    expect(armyOf(world).razors).toBe(10);

    // ...and their own ground is a garrison, not a cell.
    const control = world.app.repos.city.control(world.locationId);
    world.app.repos.city.put({
      ...control!,
      holder: { kind: 'crew', baseId: world.base.id },
    });
    const ours = await plant(world, { sleepers: 2 });
    expect(ours.statusCode).toBe(409);
    expect(ours.body).toContain('garrison');
  });

  it('refuses ground the crew has never seen inside', async () => {
    const world = await makeWorld();
    const unseen = CITY_LOCATIONS.find(
      (one) => one.districtId !== world.districtId && one.districtId !== world.base.districtId,
    );
    if (!unseen) throw new Error('the map has only two districts');

    const sent = await world.app.inject({
      method: 'POST',
      url: '/api/city/sleepers',
      headers: auth(world.token),
      payload: { locationId: unseen.id, army: { sleepers: 2 } },
    });
    expect(sent.statusCode).toBe(409);
    expect(sent.body).toContain('eyes on that ground');
  });

  /**
   * ...and accepts ground only a Satellite Uplink has seen (bug pass, 2026-09-20).
   *
   * Two doors were reading two different fogs. `battle/declare.ts` gates a declaration on
   * `cityContextFor(...).visible`, which is the scouted set plus the ground held plus the Uplink's
   * range, and says in its own comment why: "deriving it twice from different inputs is how a
   * screen and a rule quietly disagree about what a crew can see". This door read
   * `repos.city.scouted` and therefore refused exactly the ground the declaration allowed, so a
   * crew could call the fight and not put a cell on the plot first. A cell that cannot be planted
   * before the declaration is a cell with no point.
   */
  it('accepts ground a Satellite Uplink can see into', async () => {
    const world = await makeWorld();
    const uplink = CITY_LOCATIONS.find((one) => one.kind === 'satellite_uplink');
    if (!uplink) throw new Error('the map has no Satellite Uplink');

    /*
     * Held and worked to the ceiling, which puts `visionRange` past the eleven districts that are
     * not this crew's own. Anything less and the target below would depend on where the account
     * happened to be placed.
     */
    const held = world.app.repos.city.control(uplink.id);
    if (!held) throw new Error('the Uplink has no control row');
    world.app.repos.city.put({
      ...held,
      holder: { kind: 'crew', baseId: world.base.id },
      level: MAX_LOCATION_LEVEL,
    });

    const target = CITY_LOCATIONS.find(
      (one) =>
        one.districtId !== world.districtId &&
        one.districtId !== world.base.districtId &&
        one.districtId !== uplink.districtId,
    );
    if (!target) throw new Error('the map has too few districts');
    // Nothing but the Uplink can see it: no scout has ever been, and the crew holds nothing there.
    expect(world.app.repos.city.scouted(world.base.id).has(target.districtId)).toBe(false);

    const sent = await world.app.inject({
      method: 'POST',
      url: '/api/city/sleepers',
      headers: auth(world.token),
      payload: { locationId: target.id, army: { sleepers: 2 } },
    });
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
    expect(cells(world)[0]?.locationId).toBe(target.id);
  });
});

/**
 * §A1: a cell is still people this crew feeds (bug pass, 2026-09-18).
 *
 * Found by reading `unitsAbroad`'s own comment, which says exactly this about missions: a force
 * that leaves `base.army` and is counted nowhere makes the unit-slot cap dodgeable. Plant the
 * army, watch the draw fall, train a second one into the room, and be over the ceiling the day
 * the first lot walks home. A cell did precisely that until this.
 */
describe('what a planted cell costs the district', () => {
  const slotsUsed = async (world: World): Promise<number> => {
    const seen = await world.app.inject({
      method: 'GET',
      url: '/api/units',
      headers: auth(world.token),
    });
    expect(seen.statusCode, seen.body.slice(0, 200)).toBe(200);
    return seen.json<{ unitSlotsUsed: number }>().unitSlotsUsed;
  };

  it('still draws its beds, on the road and once it is in place', async () => {
    const world = await makeWorld();
    const before = await slotsUsed(world);
    expect(before, 'the fixture houses nobody, so there is nothing to keep').toBeGreaterThan(0);

    await plant(world, { sleepers: 4 });
    expect(await slotsUsed(world), 'planting freed their beds').toBe(before);

    landEverything(world);
    expect(await slotsUsed(world), 'going to ground freed their beds').toBe(before);

    // ...and they are given back when the cell finally comes home, not double-counted.
    const [cell] = cells(world);
    await world.app.inject({
      method: 'POST',
      url: '/api/city/sleepers/recall',
      headers: auth(world.token),
      payload: { cellId: cell!.id },
    });
    landEverything(world);
    expect(await slotsUsed(world)).toBe(before);
  });
});

describe('pulling a cell back out', () => {
  it('walks them home rather than teleporting them', async () => {
    const world = await makeWorld();
    await plant(world, { sleepers: 4 });
    landEverything(world);

    const [waiting] = cells(world);
    const recalled = await world.app.inject({
      method: 'POST',
      url: '/api/city/sleepers/recall',
      headers: auth(world.token),
      payload: { cellId: waiting!.id },
    });
    expect(recalled.statusCode, recalled.body.slice(0, 200)).toBe(200);

    // Still out: the walk home is owed, so a recall is not an escape hatch out of a fight that
    // is about to start.
    expect(cells(world)[0]?.phase).toBe('returning');
    expect(armyOf(world).sleepers).toBe(2);

    /*
     * ...and a settle **right now**, with the clock where it really is, leaves them out there.
     *
     * This is the assertion that makes the test about the walk. Without it the test winds every
     * mark into the past and settles, which brings them home whether the recall owed a walk or
     * teleported them: a recall that set `arrivesAt` to the current instant passed every line
     * above and below it.
     */
    settleSleepers(world.app.repos, new Date());
    expect(cells(world)[0]?.phase, 'the recall was a teleport home').toBe('returning');
    expect(armyOf(world).sleepers).toBe(2);

    landEverything(world);
    expect(cells(world)).toHaveLength(0);
    expect(armyOf(world).sleepers).toBe(6);
  });
});

describe('the fight they were planted for', () => {
  /**
   * The point of the whole mechanic: declare, and they are already standing in it.
   *
   * Poured into the attacking deployment at the declaration rather than folded in at the settle,
   * so the deploy window counts them and the crew can still pull them out (`adjustDeployment`).
   */
  it('wakes into the attacking deployment the moment the crew declares', async () => {
    const world = await makeWorld();
    await plant(world, { sleepers: 4 });
    landEverything(world);
    expect(cells(world)[0]?.phase).toBe('waiting');

    const called = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(world.token),
      payload: {
        target: {
          kind: 'location',
          districtId: world.districtId,
          locationId: world.locationId,
        },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 300)).toBe(200);

    const board = await world.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(world.token),
    });
    const view = board.json<BattlesResponse>().coming[0];
    if (!view) throw new Error('no fight was scheduled');

    const deployed = world.app.repos.sieges.deployment(view.battle.id, 'attacker', world.base.id);
    expect(deployed?.army, 'the Sleepers did not wake into the fight').toEqual({ sleepers: 4 });
    // ...and the cell is gone, so they cannot be in two places at once.
    expect(cells(world)).toHaveLength(0);
  });

  /** A cell still walking has not arrived, so there is nobody on that ground to wake. */
  it('leaves a cell still on the road out of it', async () => {
    const world = await makeWorld();
    await plant(world, { sleepers: 4 });

    const called = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(world.token),
      payload: {
        target: {
          kind: 'location',
          districtId: world.districtId,
          locationId: world.locationId,
        },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode).toBe(200);

    expect(cells(world)[0]?.phase, 'the walk was cut short by a declaration').toBe('outbound');
  });

  /**
   * Somebody else's fight on the same ground leaves them asleep.
   *
   * The maintainer's ruling, and the safe one: a cell is a fight you are setting up, not a favour
   * you do for whoever happens to attack the place first.
   */
  it('does not wake for a fight another crew called', async () => {
    const world = await makeWorld();
    await plant(world, { sleepers: 4 });
    landEverything(world);

    const rival = await world.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'the_rival', password: 'hunter2pass' },
    });
    const rivalToken = rival.json<{ token: string }>().token;
    const theirs = await chooseOverseer(world.app, rivalToken);
    const rivalBase = theirs.json<{ base: { id: string } }>().base.id;
    world.app.repos.city.markScouted(rivalBase, world.districtId, new Date().toISOString());
    const purse = world.app.repos.bases.findById(rivalBase)!.economy;
    world.app.repos.bases.updateEconomy(rivalBase, {
      ...purse,
      infamy: DECLARE_INFAMY_COST * 3,
    });
    world.app.repos.bases.updateArmy(rivalBase, { razors: 20 }, []);

    const called = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(rivalToken),
      payload: {
        target: {
          kind: 'location',
          districtId: world.districtId,
          locationId: world.locationId,
        },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 300)).toBe(200);

    // Still asleep, still ours, still on that ground.
    expect(cells(world)).toHaveLength(1);
    expect(cells(world)[0]?.phase).toBe('waiting');
    expect(cells(world)[0]?.army).toEqual({ sleepers: 4 });
  });
});

describe('what the ground says about them', () => {
  /**
   * Nothing at all, to anybody but their own crew. The maintainer's ruling: "not visible by an
   * enemy spy or anything."
   *
   * Read off the projection the rival's own screen is built from, because that is the thing that
   * would leak: a garrison count that quietly included four people nobody put there.
   */
  it('never shows up in what an enemy can see of the place', async () => {
    const world = await makeWorld();
    await plant(world, { sleepers: 4 });
    landEverything(world);

    const rival = await world.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'the_watcher', password: 'hunter2pass' },
    });
    const rivalToken = rival.json<{ token: string }>().token;
    const theirs = await chooseOverseer(world.app, rivalToken);
    world.app.repos.city.markScouted(
      theirs.json<{ base: { id: string } }>().base.id,
      world.districtId,
      new Date().toISOString(),
    );

    const seen = await world.app.inject({
      method: 'GET',
      url: `/api/city/${world.districtId}`,
      headers: auth(rivalToken),
    });
    expect(seen.statusCode, seen.body.slice(0, 200)).toBe(200);
    // Nothing in the whole payload names them. A blunt check on purpose: any field that started
    // carrying a cell, on any location, fails this.
    expect(seen.body).not.toContain('sleeper');
    const places = seen.json<{ locations: { location: { id: string }; garrisonSize: number }[] }>()
      .locations;
    expect(
      places.length,
      'the rival sees no locations at all, so this proves nothing',
    ).toBeGreaterThan(0);
    // Since 2026-09-22 nobody's count is served for free, cell or no cell: the figure is null on
    // every place the rival does not hold, and the report a spy job writes is where a cell would
    // have to leak, which `spying/spying.test.ts` holds shut without the rung.
    const place = places.find((one) => one.location.id === world.locationId);
    expect(place?.garrisonSize, 'the cell was counted as a garrison').toBeNull();
  });
});

/**
 * What the enemy learns, and when (maintainer, 2026-09-18).
 *
 * "They are only shown at the report in the end for the enemy, if he has units escape."
 *
 * That rule already exists and is not a Sleeper rule at all: `reportReaches` withholds a loser's
 * whole report unless somebody got home to tell them, which is the entire reason a perimeter is
 * worth the units it costs. A cell therefore stays secret for free when the defence is wiped out,
 * and is named in the ordinary way when it is not.
 *
 * Pinned here rather than left to `analysis.ts`, because it is a promise about *this* feature: a
 * change to the report rule that looked harmless on its own would quietly reveal every cell in
 * the game, and nothing else in the tree would say so.
 */
describe('what the enemy is told afterwards', () => {
  const analysisFor = (won: boolean, fled: number) => ({
    winner: won ? 'defender' : ('attacker' as const),
    defender: { fled, officer: null },
  });

  it('tells a defender who got somebody out, and nobody who did not', () => {
    // The shapes `reportReaches` actually reads, so this is the rule and not a paraphrase.
    const wipedOut = analysisFor(false, 0) as unknown as Parameters<typeof reportReaches>[1];
    const someGotOut = analysisFor(false, 3) as unknown as Parameters<typeof reportReaches>[1];

    expect(reportReaches('defender', wipedOut), 'a wiped-out defence was told').toBe(false);
    expect(reportReaches('defender', someGotOut), 'a defence with runners was not told').toBe(true);
  });

  /**
   * ...and once they are told, the cell is named like anything else that stood there.
   *
   * `standingReport` lists every stack by unit name, and the Sleepers woke into the attacking
   * deployment, so they are in it. There is deliberately nothing extra hiding them at this
   * point: the secrecy a cell buys is about the days *before* the fight, not about the fight.
   */
  it('names them in the standing report once it does reach', async () => {
    const world = await makeWorld();
    await plant(world, { sleepers: 4 });
    landEverything(world);

    const called = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(world.token),
      payload: {
        target: {
          kind: 'location',
          districtId: world.districtId,
          locationId: world.locationId,
        },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 300)).toBe(200);

    const view = (
      await world.app.inject({
        method: 'GET',
        url: '/api/battles',
        headers: auth(world.token),
      })
    ).json<BattlesResponse>().coming[0];
    const deployed = world.app.repos.sieges.deployment(view!.battle.id, 'attacker', world.base.id);
    // They are an ordinary part of the force now, which is what makes the report name them.
    expect(deployed?.army.sleepers).toBe(4);
  });
});

/**
 * §A4: the ladder that counts a plan coming off (maintainer, 2026-09-18).
 *
 * A cell wakes into an ordinary deployment and the report names its Sleepers like anybody
 * else's, so nothing else on the board can tell a fight that was set up days earlier from one
 * somebody marched into. `ScheduledBattle.wokeSleepers` is the only record of the difference,
 * and this is the seam it has to survive: written at the declaration, read at the settle.
 */
describe('the counter for a fight that was set up in advance', () => {
  const settled = async (world: World, plantFirst: boolean): Promise<number> => {
    if (plantFirst) {
      await plant(world, { sleepers: 4 });
      landEverything(world);
    }
    const called = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(world.token),
      payload: {
        target: {
          kind: 'location',
          districtId: world.districtId,
          locationId: world.locationId,
        },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 300)).toBe(200);
    const [pending] = world.app.repos.sieges.pending();
    return pending?.wokeSleepers === true ? 1 : 0;
  };

  it('records on the battle row whether a cell woke into it', async () => {
    expect(await settled(await makeWorld(), true), 'a planted fight was not recorded').toBe(1);
    // ...and the same declaration with the Sleepers still at home is not the same fight. This is
    // the half that matters: the ladder is about the setup, not about owning the sheet.
    expect(await settled(await makeWorld(), false)).toBe(0);
  });

  /** Marching them in the ordinary way is not planting them, however many you bring. */
  it('does not count Sleepers that were simply sent to the fight', async () => {
    const world = await makeWorld();
    expect(await settled(world, false)).toBe(0);
    const [pending] = world.app.repos.sieges.pending();
    await world.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(world.token),
      payload: { battleId: pending!.id, changes: { sleepers: 4 } },
    });
    expect(world.app.repos.sieges.find(pending!.id)?.wokeSleepers).toBe(false);
  });
});

/**
 * ...and that they actually fight (bug pass, 2026-09-18).
 *
 * Everything above stops at the deployment row. A cell that wakes into a deployment the settler
 * then ignores would pass every one of those tests and do nothing at all on the day, which is
 * the one thing a player would notice. So this runs the whole thing: plant, land, declare, wind
 * the mark back, settle, and read the Sleepers out of the finished battle's own record.
 */
describe('a planted cell in the fight it was planted for', () => {
  it('is in the resolved battle, on the attacking side', async () => {
    const world = await makeWorld();
    await plant(world, { sleepers: 4 });
    landEverything(world);

    const called = await world.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(world.token),
      payload: {
        target: {
          kind: 'location',
          districtId: world.districtId,
          locationId: world.locationId,
        },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 300)).toBe(200);
    const [pending] = world.app.repos.sieges.pending();
    if (!pending) throw new Error('no fight was scheduled');

    // Wind the mark into the past and run the real settler.
    world.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), pending.id);
    expect(settleBattles(world.app.repos, world.app.skirmishEngine, new Date())).toHaveLength(1);

    const [resolved] = world.app.repos.sieges.resolvedFor(world.base.id, 5);
    const analysis = resolved?.analysis;
    if (!analysis) throw new Error('the fight left no record');
    const fought = analysis.attacker.units.find((unit) => unit.unitId === 'sleepers');
    expect(fought, 'the Sleepers were not in the fight at all').toBeDefined();
    // They turned up in the strength they were planted in, not as a token entry.
    expect(fought?.started).toBe(4);
  });
});
