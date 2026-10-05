import {
  BLACK_MARKET_GOODS,
  TERMINUS_CITY_ID,
  blackMarketEffect,
  type BattlesResponse,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { cityLevelFor } from '../blackmarket/shelf.js';
import { standingEffectsFor } from '../crew/standing.js';
import {
  ON_PLOT,
  auth,
  closeWorlds,
  declare,
  faction,
  holdPlot,
  makeWorld,
  register,
  runTheFight,
  type Crew,
  type World,
} from '../testing/fight-world.js';
import { settleBattles } from './resolve.js';

/**
 * Traps, vehicles and battle boosts (bug pass, 2026-09-29).
 *
 * Three defects, each measured before it was fixed. The machines on a fight carried every column
 * separately when the yard was loaded after the columns had left; a crate of contraband was
 * weighted by Ashfall's street in every fight in the world, Terminus included (and since
 * 2026-09-29 is weighted by no street at all); and an ally's fight page offered names the route
 * would refuse them.
 */

afterEach(closeWorlds);

const post = (world: World, crew: Crew, url: string, payload: Record<string, unknown>) =>
  world.app.inject({ method: 'POST', url: `/api/${url}`, headers: auth(crew.token), payload });

/** Every column this fight has on the road, as minutes from leaving to landing. */
function columnMinutes(world: World, battleId: string): number[] {
  return world.app.repos.movements
    .forBattle(battleId)
    .map((column) =>
      Math.round((Date.parse(column.arrivesAt) - Date.parse(column.departedAt)) / 60_000),
    );
}

describe('a seat on a fight is sold to one column, whichever door came first', () => {
  /**
   * Wardens are two slots and slow; the Scrappy is two seats at 65. One Warden rides one bike, so
   * five one-Warden columns need five bikes. Before the fix the bike was loaded after the columns
   * had gone and every one of the five was re-timed onto it: 15 minutes each became 12 each.
   */
  async function fiveColumns(bikes: number): Promise<{ world: World; crew: Crew; id: string }> {
    const world = await makeWorld('defender');
    const crew = await register(world, 'convoy', { wardens: 10 });
    const holder = await register(world, 'holder', {});
    holdPlot(world, holder, { razors: 5 });
    world.app.repos.bases.updateFleet(crew.baseId, { motorcycle: bikes });
    const id = await declare(world, crew);
    return { world, crew, id };
  }

  it('refuses a bike loaded under five columns it cannot seat, and leaves their clocks alone', async () => {
    const { world, crew, id } = await fiveColumns(1);
    for (let sent = 0; sent < 5; sent += 1) {
      const res = await post(world, crew, 'battles/deploy', {
        battleId: id,
        changes: { wardens: 1 },
      });
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    }
    const walking = columnMinutes(world, id);

    const loaded = await post(world, crew, 'battles/vehicles', {
      battleId: id,
      vehicles: { motorcycle: 1 },
    });
    expect(loaded.statusCode, 'one bike carried five columns').toBe(409);
    expect(columnMinutes(world, id)).toEqual(walking);
    expect(world.app.repos.bases.findById(crew.baseId)!.fleet).toEqual({ motorcycle: 1 });
  });

  it('refuses narrowing the set out from under columns already riding it, and lets them walk', async () => {
    const { world, crew, id } = await fiveColumns(5);
    expect(
      (await post(world, crew, 'battles/vehicles', { battleId: id, vehicles: { motorcycle: 5 } }))
        .statusCode,
    ).toBe(200);
    for (let sent = 0; sent < 5; sent += 1) {
      const res = await post(world, crew, 'battles/deploy', {
        battleId: id,
        changes: { wardens: 1 },
      });
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    }
    const riding = columnMinutes(world, id);

    // Four bikes home to the yard and the five columns still on the one that is left.
    const narrowed = await post(world, crew, 'battles/vehicles', {
      battleId: id,
      vehicles: { motorcycle: 1 },
    });
    expect(narrowed.statusCode, 'four bikes went home and nobody got off').toBe(409);
    expect(columnMinutes(world, id)).toEqual(riding);

    // Taking the lot off is the walk, which has no ceiling.
    const unloaded = await post(world, crew, 'battles/vehicles', { battleId: id, vehicles: {} });
    expect(unloaded.statusCode, unloaded.body.slice(0, 200)).toBe(200);
    for (const [index, minutes] of columnMinutes(world, id).entries()) {
      expect(minutes).toBeGreaterThan(riding[index]!);
    }
  });

  it('still loads a bike under the one column it can seat, and that column rides', async () => {
    const { world, crew, id } = await fiveColumns(1);
    await post(world, crew, 'battles/deploy', { battleId: id, changes: { wardens: 1 } });
    const [walking] = columnMinutes(world, id);

    const loaded = await post(world, crew, 'battles/vehicles', {
      battleId: id,
      vehicles: { motorcycle: 1 },
    });
    expect(loaded.statusCode, loaded.body.slice(0, 200)).toBe(200);
    expect(columnMinutes(world, id)[0]).toBeLessThan(walking!);
  });

  it('still loads a bike under one column too big for it, which fills it once and walks', async () => {
    const { world, crew, id } = await fiveColumns(1);
    await post(world, crew, 'battles/deploy', { battleId: id, changes: { wardens: 4 } });
    const walking = columnMinutes(world, id);

    const loaded = await post(world, crew, 'battles/vehicles', {
      battleId: id,
      vehicles: { motorcycle: 1 },
    });
    expect(loaded.statusCode, loaded.body.slice(0, 200)).toBe(200);
    // Three Wardens are still on foot, so the column is exactly as slow as it was.
    expect(columnMinutes(world, id)).toEqual(walking);
  });
});

describe('a crate does what its card says in whatever city the fight is in', () => {
  const SYRINGES = BLACK_MARKET_GOODS['adrenaline_syringes'];
  if (!SYRINGES?.boost) throw new Error('fixture error: the syringes are not on the shelf');
  /** A looters' halt in Terminus, handed to a crew so there is somebody to call it on. */
  const HALT = 'coldwater-halt-platform';

  /**
   * Flat since 2026-09-29 (maintainer: "make these be flat"). It was weighted by the fight's city,
   * up to half again, so the stash tab's figure was the least a crate did. A veteran Terminus is
   * the case that used to move it most.
   */
  it('quotes and applies the card’s figure on a fight in a veteran Terminus', async () => {
    const world = await makeWorld('defender');
    const { repos } = world.app;
    const smuggler = await register(world, 'smuggler', { razors: 20 });
    const holder = await register(world, 'holder', {});
    const veteran = await register(world, 'veteran', {});
    // Terminus's street is a veteran's: the only crew living there is level 60, which put the
    // back room's old potency on its ceiling while Ashfall's two fresh crews left it near the floor.
    world.db
      .prepare('UPDATE bases SET district_id = ?, level = ? WHERE id = ?')
      .run('carriage', 60, veteran.baseId);
    // The guard: the two cities still disagree, so a weighting left anywhere would show.
    expect(cityLevelFor(repos, TERMINUS_CITY_ID)).toBeGreaterThan(cityLevelFor(repos) + 10);
    const applied = SYRINGES.boost!.offensePercent;

    const control = repos.city.control(HALT)!;
    repos.city.put({ ...control, holder: { kind: 'crew', baseId: holder.baseId }, garrison: {} });
    repos.blackMarket.writeStash(smuggler.baseId, { [SYRINGES.id]: 1 });
    const now = new Date();
    const battleId = 'crate-in-terminus';
    repos.sieges.insert({
      id: battleId,
      attackerBaseId: smuggler.baseId,
      target: { kind: 'location', districtId: 'coldwater-halt', locationId: HALT },
      defender: { kind: 'crew', baseId: holder.baseId },
      declaredAt: new Date(now.getTime() - 3_600_000).toISOString(),
      scheduledFor: new Date(now.getTime() + 3_600_000).toISOString(),
      resolvedAt: null,
      seed: 'crate-seed',
      holdAfterCapture: false,
      wokeSleepers: false,
    });
    repos.sieges.putDeployment({
      battleId,
      baseId: smuggler.baseId,
      side: 'attacker',
      // The least commitment a fight needs at the lock (2026-10-05), or it is called off.
      army: { razors: 20 },
      perimeter: {},
      boostIds: [SYRINGES.id],
      officerId: null,
      trapId: null,
      vehicles: {},
      updatedAt: now.toISOString(),
    });

    const board = await world.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(smuggler.token),
    });
    const view = board
      .json<BattlesResponse>()
      .coming.find((coming) => coming.battle.id === battleId);
    const card = view?.boosts.find((option) => option.id === SYRINGES.id);
    expect(card?.effect, 'the card quoted a weighted figure').toBe(blackMarketEffect(SYRINGES));
    expect(card?.effect).toBe(SYRINGES.effect);

    const smugglerBase = repos.bases.findById(smuggler.baseId)!;
    const before = standingEffectsFor(repos, smugglerBase, now).unitOffensePercent;
    world.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(now.getTime() - 60_000).toISOString(), battleId);
    expect(settleBattles(repos, world.engine, now)).toHaveLength(1);
    expect(world.seen().attackerTerritory?.unitOffensePercent).toBe(before + applied);
  });
});

describe('an ally on a fight', () => {
  it('is shown the names as shut, with the reason the route refuses them', async () => {
    const world = await makeWorld('defender');
    const caller = await register(world, 'caller', { razors: 30 });
    const ally = await register(world, 'ally', { razors: 30 });
    const holder = await register(world, 'holder', {});
    faction(world, 'crews', [caller, ally]);
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    world.app.repos.sieges.putDeployment({
      battleId,
      baseId: ally.baseId,
      side: 'attacker',
      army: { razors: 5 },
      perimeter: {},
      boostIds: [],
      officerId: null,
      trapId: null,
      vehicles: {},
      updatedAt: new Date().toISOString(),
    });
    const optionsFor = async (crew: Crew) => {
      const board = await world.app.inject({
        method: 'GET',
        url: '/api/battles',
        headers: auth(crew.token),
      });
      return board.json<BattlesResponse>().coming.find((view) => view.battle.id === battleId)!
        .boosts;
    };

    // The positive control: the caller is offered the open names, so a list shut for everybody
    // cannot pass this.
    const open = (await optionsFor(caller)).filter((option) => option.available);
    expect(open.length).toBeGreaterThan(0);

    const shown = await optionsFor(ally);
    expect(shown.length).toBe((await optionsFor(caller)).length);
    for (const option of shown) {
      expect(option.available, option.id).toBe(false);
      expect(option.source).toBe('Only the crew whose fight this is can put a name on it');
    }
    const [name] = open;
    const refused = await post(world, ally, 'battles/boost', { battleId, boostId: name!.id });
    expect(refused.statusCode).toBe(403);
  });
});

/**
 * A crate named on two fights, and the first to land spends the last of it (maintainer,
 * 2026-09-29). The id stayed on the second fight's row, a name is final, and the route refused a
 * new one with "One name to a fight" beside a panel that read "Nothing taken yet". A spent crate
 * frees the slot now.
 */
describe('the last of a crate, spent on one of two fights it was named on', () => {
  const SYRINGES = 'adrenaline_syringes';
  const STIMS = 'combat_stims';

  async function twoFightsOneCrate() {
    const world = await makeWorld('attacker');
    const { repos } = world.app;
    const crew = await register(world, 'smuggler', { razors: 40 });
    const holder = await register(world, 'holder', {});
    holdPlot(world, holder, { razors: 3 });
    repos.blackMarket.writeStash(crew.baseId, { [SYRINGES]: 1, [STIMS]: 1 });
    const now = Date.now();
    const ids = ['crate-first', 'crate-second'];
    ids.forEach((id, index) => {
      repos.sieges.insert({
        id,
        attackerBaseId: crew.baseId,
        target: ON_PLOT,
        defender: { kind: 'crew', baseId: holder.baseId },
        declaredAt: new Date(now - 3_600_000).toISOString(),
        scheduledFor: new Date(now + (index + 1) * 3_600_000).toISOString(),
        resolvedAt: null,
        seed: `crate-${id}`,
        holdAfterCapture: false,
        wokeSleepers: false,
      });
      repos.sieges.putDeployment({
        battleId: id,
        baseId: crew.baseId,
        side: 'attacker',
        // The least commitment a fight needs at the lock (2026-10-05), or it is called off.
        army: { razors: 20 },
        perimeter: {},
        boostIds: [],
        officerId: null,
        trapId: null,
        vehicles: {},
        updatedAt: new Date(now).toISOString(),
      });
    });
    for (const battleId of ids) {
      const named = await post(world, crew, 'battles/boost', { battleId, boostId: SYRINGES });
      expect(named.statusCode, named.body.slice(0, 200)).toBe(200);
    }
    return { world, crew, first: ids[0]!, second: ids[1]! };
  }

  const viewOf = async (world: World, crew: Crew, battleId: string) => {
    const board = await world.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(crew.token),
    });
    return board.json<BattlesResponse>().coming.find((view) => view.battle.id === battleId)!;
  };

  it('frees the second fight’s slot, and it takes a new boost', async () => {
    const { world, crew, first, second } = await twoFightsOneCrate();
    runTheFight(world, first);

    const row = world.app.repos.sieges.deployment(second, 'attacker', crew.baseId)!;
    expect(row.boostIds).toEqual([]);
    // The panel and the route agree: nothing taken, and room to take something.
    const view = await viewOf(world, crew, second);
    expect(view.boostIds).toEqual([]);
    expect(view.boosts.some((option) => option.id === SYRINGES)).toBe(false);

    const renamed = await post(world, crew, 'battles/boost', { battleId: second, boostId: STIMS });
    expect(renamed.statusCode, renamed.body.slice(0, 200)).toBe(200);
    expect(world.app.repos.sieges.deployment(second, 'attacker', crew.baseId)!.boostIds).toEqual([
      STIMS,
    ]);
  });

  it('leaves the name on the second fight while the bag still holds one', async () => {
    const { world, crew, first, second } = await twoFightsOneCrate();
    // A second syringe in the bag: the name on the next fight is still a live crate.
    world.app.repos.blackMarket.writeStash(crew.baseId, { [SYRINGES]: 2, [STIMS]: 1 });
    runTheFight(world, first);

    expect(world.app.repos.sieges.deployment(second, 'attacker', crew.baseId)!.boostIds).toEqual([
      SYRINGES,
    ]);
    expect(world.app.repos.blackMarket.stashFor(crew.baseId)[SYRINGES]).toBe(1);
  });
});
