import {
  DECLARE_INFAMY_COST,
  STACKHOUSE_RESEARCH_ID,
  createCommander,
  type Army,
  type BattleTarget,
} from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeStackhouseBet } from '../blackmarket/stackhouse.js';
import {
  PLOT,
  auth,
  closeWorlds,
  faction,
  holdPlot,
  makeWorld,
  register,
  type Crew,
  type World,
} from '../testing/fight-world.js';
import { pinOverseer } from '../testing/overseer.js';
import { armTheAttack } from '../testing/attack.js';
import { everybodyHome } from '../testing/walk.js';
import { settleWorld } from '../world/settle.js';

/**
 * The life of a declared fight, end to end through the real routes and the world tick (bug pass,
 * 2026-10-05, pass 2): the call and what it costs, the clock edges, who sends what, the mark, and
 * where every unit is once everybody has walked home.
 *
 * The clock is faked (`Date` only) so the edges are exact: a call at exactly eight hours, a
 * withdrawal a millisecond before the last hour and one at it. The engine is decided by hand
 * (`makeWorld`), so the only thing that moves a unit is the settle, and every figure below is the
 * arithmetic of the settle rather than of the dice.
 */

afterEach(async () => {
  vi.useRealTimers();
  await closeWorlds();
});

const CALLED_AT = '2026-10-06T09:00:00.000Z';
const MARK = '2026-10-06T17:00:00.000Z';
const BELT = 'steelbelt';
const onBelt = (locationId: string): BattleTarget => ({
  kind: 'location',
  districtId: BELT,
  locationId,
});

function at(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

/** Crews registered at the call's own instant, each with a pinned character and this roster. */
async function crews<Name extends string>(
  world: World,
  rosters: Record<Name, Army>,
): Promise<Record<Name, Crew>> {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(CALLED_AT);
  const out = {} as Record<Name, Crew>;
  for (const name of Object.keys(rosters) as Name[]) {
    const crew = await register(world, name, rosters[name]);
    pinOverseer(world.app, crew.token);
    out[name] = crew;
  }
  return out;
}

function call(world: World, crew: Crew, target: BattleTarget, scheduledFor = MARK) {
  return world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(crew.token),
    payload: { target, scheduledFor },
  });
}

function deploy(world: World, crew: Crew, battleId: string, changes: Record<string, number>) {
  return world.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(crew.token),
    payload: { battleId, changes },
  });
}

function reinforce(world: World, crew: Crew, battleId: string, army: Army) {
  return world.app.inject({
    method: 'POST',
    url: '/api/factions/reinforce',
    headers: auth(crew.token),
    payload: { battleId, army },
  });
}

const message = (res: { json: () => unknown }) =>
  (res.json() as { error?: { message?: string } }).error?.message;
const infamy = (world: World, crew: Crew) =>
  world.app.repos.bases.findById(crew.baseId)!.economy.infamy;
const army = (world: World, crew: Crew) => world.app.repos.bases.findById(crew.baseId)!.army;
const onlyPending = (world: World) => {
  const [battle] = world.app.repos.sieges.pending();
  if (!battle) throw new Error('no fight was called');
  return battle.id;
};

/** The columns land a minute before the mark, then the tick runs the fight a second after it. */
function runOnTheTick(world: World): number {
  at('2026-10-06T16:59:00.000Z');
  settleWorld(world.app.repos, world.engine, new Date());
  at('2026-10-06T17:00:01.000Z');
  return settleWorld(world.app.repos, world.engine, new Date());
}

describe('calling a fight', () => {
  it('refuses empty ground, takes one call per place, and prices only a player’s ground', async () => {
    const world = await makeWorld('attacker');
    const { caller, second, holder } = await crews(world, {
      caller: { razors: 20 },
      second: { razors: 20 },
      holder: {},
    });
    const purse = DECLARE_INFAMY_COST * 8;

    // The ramp is the Belt's empty plot: walked onto, never fought for (2026-10-04).
    const empty = await call(world, caller, onBelt('steelbelt-ramp'));
    expect(empty.statusCode).toBe(409);
    expect(message(empty)).toBe('Nobody holds it. Send units to walk in and it is yours');

    // The regime's plot is free to call, and once called it takes no second call from anybody.
    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
    expect(infamy(world, caller)).toBe(purse);
    const again = await call(world, second, onBelt(PLOT));
    expect(again.statusCode).toBe(409);
    expect(message(again)).toBe('Somebody has already called that one');

    // A player's plot costs the call's price; the same plot under a bot costs nothing.
    const pawn = world.app.repos.city.control('steelbelt-pawn')!;
    world.app.repos.city.put({
      ...pawn,
      holder: { kind: 'crew', baseId: holder.baseId },
      garrison: { razors: 1 },
    });
    expect((await call(world, second, onBelt('steelbelt-pawn'))).statusCode).toBe(200);
    expect(infamy(world, second)).toBe(purse - DECLARE_INFAMY_COST);
    world.db.prepare('UPDATE bases SET is_bot = 1 WHERE id = ?').run(holder.baseId);
    const pumps = world.app.repos.city.control('steelbelt-pumps')!;
    world.app.repos.city.put({
      ...pumps,
      holder: { kind: 'crew', baseId: holder.baseId },
      garrison: { razors: 1 },
    });
    expect((await call(world, caller, onBelt('steelbelt-pumps'))).statusCode).toBe(200);
    expect(infamy(world, caller)).toBe(purse);
  });

  it('keeps the walk-in shut on ground with a call still on it', async () => {
    const world = await makeWorld('attacker');
    const { caller, walker } = await crews(world, { caller: {}, walker: { razors: 5 } });
    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
    // The plot empties under the call (a save from before the 2026-10-04 rule reads the same).
    const plot = world.app.repos.city.control(PLOT)!;
    world.app.repos.city.put({ ...plot, holder: { kind: 'unoccupied' }, garrison: {} });

    const walk = await world.app.inject({
      method: 'POST',
      url: '/api/actions/move',
      headers: auth(walker.token),
      payload: {
        from: { kind: 'district' },
        to: { kind: 'location', locationId: PLOT },
        army: { razors: 5 },
      },
    });
    expect(walk.statusCode).toBe(409);
    expect(message(walk)).toBe(
      'A fight is called on that ground. Nobody claims it until it is over',
    );
    expect(army(world, walker)).toEqual({ razors: 5 });
  });

  it('takes a mark exactly eight hours out, and not a millisecond later', async () => {
    const world = await makeWorld('attacker');
    const { caller } = await crews(world, { caller: {} });

    at('2026-10-06T09:00:00.001Z');
    const late = await call(world, caller, onBelt(PLOT));
    expect(message(late)).toBe('Nobody gets less than eight hours to see you coming');
    expect(world.app.repos.sieges.pending()).toHaveLength(0);

    at(CALLED_AT);
    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
  });
});

describe('before the mark', () => {
  it('lets a withdrawal through a millisecond before the last hour, and holds it at the hour', async () => {
    const world = await makeWorld('attacker');
    const { caller } = await crews(world, { caller: { razors: 30 } });
    await call(world, caller, onBelt(PLOT));
    const battleId = onlyPending(world);
    // Twenty-one, so the attack still has the twenty a fight needs at the lock after one leaves.
    expect((await deploy(world, caller, battleId, { razors: 21 })).statusCode).toBe(200);
    expect(army(world, caller)).toEqual({ razors: 9 });
    at('2026-10-06T15:00:00.000Z');
    settleWorld(world.app.repos, world.engine, new Date());
    expect(world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)?.army).toEqual({
      razors: 21,
    });

    at('2026-10-06T15:59:59.999Z');
    expect((await deploy(world, caller, battleId, { razors: -1 })).statusCode).toBe(200);
    at('2026-10-06T16:00:00.000Z');
    const locked = await deploy(world, caller, battleId, { razors: -1 });
    expect(locked.statusCode).toBe(409);
    expect(message(locked)).toBe(
      'A fight lands within the hour. Nobody leaves the ground now, and whoever is there fights',
    );
    expect(world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)?.army).toEqual({
      razors: 20,
    });
  });

  it('holds an officer to one fight and refuses one who cannot get there by the mark', async () => {
    const world = await makeWorld('attacker');
    const { caller } = await crews(world, { caller: {} });
    const base = world.app.repos.bases.findById(caller.baseId)!;
    const officer = createCommander('off-1', 'Vasco Renn', 'field_commander', {
      strength: 70,
      toughness: 60,
      dexterity: 50,
      resolve: 60,
      reflexes: 55,
    });
    world.app.repos.bases.updateCommanders(caller.baseId, [...base.commanders, officer]);
    await call(world, caller, onBelt(PLOT));
    await call(world, caller, onBelt('steelbelt-pawn'));
    const [first, second] = world.app.repos.sieges.pending().map((battle) => battle.id);
    // Committed, or the lock calls the first off before the late naming is tried (2026-10-05).
    armTheAttack(world.app.repos, first!, caller.baseId);
    const lead = (battleId: string, officerId: string | null) =>
      world.app.inject({
        method: 'POST',
        url: '/api/battles/lead',
        headers: auth(caller.token),
        payload: { battleId, officerId },
      });

    expect((await lead(first!, 'off-1')).statusCode).toBe(200);
    const twice = await lead(second!, 'off-1');
    expect(twice.statusCode).toBe(403);
    expect(message(twice)).toBe('Vasco Renn is at a fight');

    expect((await lead(first!, null)).statusCode).toBe(200);
    at('2026-10-06T16:58:00.000Z');
    const late = await lead(first!, 'off-1');
    expect(late.statusCode).toBe(403);
    const [, minutes] = /is (\d+) minutes away, and this one starts in 2$/.exec(message(late)!)!;
    expect(Number(minutes)).toBeGreaterThan(2);
  });
});

describe('the mark', () => {
  it('splits a four-crew fight back to every crew that sent, and pays each ledger', async () => {
    // The defence is ten Razors: six die, four run. The attack loses three of twenty, the least a
    // fight needs at the lock (2026-10-05).
    const world = await makeWorld('attacker', {
      killed: { razors: 6 },
      fled: { razors: 4 },
      winnerLosses: { razors: 3 },
    });
    const { caller, callerAlly, holder, holderAlly } = await crews(world, {
      caller: { razors: 20 },
      callerAlly: { razors: 20 },
      holder: { razors: 20 },
      holderAlly: { razors: 20 },
    });
    faction(world, 'callers', [caller, callerAlly]);
    faction(world, 'holders', [holder, holderAlly]);
    holdPlot(world, holder, { razors: 5 });
    world.app.repos.alliedGarrisons.set(PLOT, holderAlly.baseId, { razors: 3 });

    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
    expect(infamy(world, caller)).toBe(DECLARE_INFAMY_COST * 7);
    const battleId = onlyPending(world);
    expect((await deploy(world, caller, battleId, { razors: 12 })).statusCode).toBe(200);
    expect((await reinforce(world, callerAlly, battleId, { razors: 8 })).statusCode).toBe(200);
    expect((await reinforce(world, holderAlly, battleId, { razors: 2 })).statusCode).toBe(200);
    // Off the roster the moment they are sent.
    expect([caller, callerAlly, holderAlly].map((crew) => army(world, crew))).toEqual([
      { razors: 8 },
      { razors: 12 },
      { razors: 18 },
    ]);

    expect(runOnTheTick(world)).toBe(1);
    expect(world.seen().attacking).toEqual({ razors: 20 });
    expect(world.seen().defending).toEqual({ razors: 10 });
    // Seventeen came through, split 12:8 (10.2 and 6.8, the odd one to the larger remainder: 10 and
    // 7): the caller's ten hold the plot, and no posting is left on ground that changed hands.
    expect(world.app.repos.city.control(PLOT)).toMatchObject({
      holder: { kind: 'crew', baseId: caller.baseId },
      garrison: { razors: 10 },
    });
    expect(world.app.repos.alliedGarrisons.at(PLOT)).toEqual([]);

    vi.useRealTimers();
    everybodyHome(world.app.repos);
    // Deployed = survivors + dead, per crew. The caller: 8 home and 10 holding of 20. Its ally:
    // 7 of 8 back. The holder's 5 and the ally's 3 posted plus 2 sent split 5:5 over 4 runners.
    expect(army(world, caller)).toEqual({ razors: 8 });
    expect(army(world, callerAlly)).toEqual({ razors: 19 });
    expect(army(world, holder)).toEqual({ razors: 22 });
    expect(army(world, holderAlly)).toEqual({ razors: 20 });

    // The caller: 6 kills, 4 routed at half (2) and the win (25). No state premium: the plot was a
    // player's, not the Combine's (bug pass, 2026-10-05). The holder: the 3 it killed. Allies bank nothing; each faction is credited what its principal
    // banked.
    expect(infamy(world, caller)).toBe(DECLARE_INFAMY_COST * 7 + 33);
    expect(infamy(world, holder)).toBe(DECLARE_INFAMY_COST * 8 + 3);
    expect(infamy(world, callerAlly)).toBe(DECLARE_INFAMY_COST * 8);
    expect(infamy(world, holderAlly)).toBe(DECLARE_INFAMY_COST * 8);
    const earned = (id: string) =>
      (
        world.db.prepare('SELECT infamy_earned AS n FROM factions WHERE id = ?').get(id) as {
          n: number;
        }
      ).n;
    expect(earned('callers')).toBe(33);
    expect(earned('holders')).toBe(3);
  });

  it('walks an ally who left the faction home whole, and shuts the withdrawal behind it', async () => {
    const world = await makeWorld('attacker', { winnerLosses: { razors: 2 } });
    const { caller, ally } = await crews(world, { caller: { razors: 30 }, ally: { razors: 20 } });
    faction(world, 'callers', [caller, ally]);
    await call(world, caller, onBelt(PLOT));
    const battleId = onlyPending(world);
    // Twenty of the caller's own, so the attack stands at the lock without the ally (2026-10-05).
    await deploy(world, caller, battleId, { razors: 20 });
    expect((await reinforce(world, ally, battleId, { razors: 5 })).statusCode).toBe(200);
    at('2026-10-06T15:00:00.000Z');
    settleWorld(world.app.repos, world.engine, new Date());
    expect(world.app.repos.sieges.deployment(battleId, 'attacker', ally.baseId)?.army).toEqual({
      razors: 5,
    });

    const left = await world.app.inject({
      method: 'POST',
      url: '/api/factions/leave',
      headers: auth(ally.token),
      payload: {},
    });
    expect(left.statusCode).toBe(200);
    const pull = await deploy(world, ally, battleId, { razors: -1 });
    expect(message(pull)).toBe('You are not in that fight');

    expect(runOnTheTick(world)).toBe(1);
    // Only the caller's twenty stood in the line; its eighteen survivors hold the plot.
    expect(world.seen().attacking).toEqual({ razors: 20 });
    expect(world.app.repos.city.control(PLOT)?.garrison).toEqual({ razors: 18 });
    vi.useRealTimers();
    everybodyHome(world.app.repos);
    expect(army(world, ally)).toEqual({ razors: 20 });
    expect(army(world, caller)).toEqual({ razors: 10 });
  });

  it('raids a home through its breach with the resident’s ally in it, and pays the bet on the same tick', async () => {
    // Fourteen defend: eight die, six run. The raiders lose three of twenty.
    const world = await makeWorld('attacker', {
      killed: { razors: 8 },
      fled: { razors: 6 },
      winnerLosses: { razors: 3 },
    });
    const { raider, resident, residentAlly } = await crews(world, {
      raider: { razors: 20 },
      resident: { razors: 10 },
      residentAlly: { razors: 20 },
    });
    faction(world, 'residents', [resident, residentAlly]);
    const home = world.app.repos.bases.findById(resident.baseId)!.districtId;
    world.app.repos.sieges.breakGate(home, '2026-10-07T09:00:00.000Z');

    expect((await call(world, raider, { kind: 'district', districtId: home })).statusCode).toBe(
      200,
    );
    const battleId = onlyPending(world);
    // The bet is the resident's ally's, against its own side: the caller may not bet on its own
    // call (2026-10-05), and the resident's caps are what the raid loots.
    const purse = world.app.repos.bases.findById(residentAlly.baseId)!;
    world.app.repos.bases.updateResearch(residentAlly.baseId, {
      ...purse.research,
      technologies: [...purse.research.technologies, STACKHOUSE_RESEARCH_ID],
    });
    world.app.repos.bases.updateResources(residentAlly.baseId, { ...purse.resources, caps: 3000 });
    expect(
      placeStackhouseBet(world.app.repos, {
        base: world.app.repos.bases.findById(residentAlly.baseId)!,
        battleId,
        side: 'attacker',
        stake: 1000,
        now: new Date(),
        admin: false,
      }),
    ).toEqual({ kind: 'placed' });
    // All twenty: the least a fight needs at the lock (2026-10-05).
    await deploy(world, raider, battleId, { razors: 20 });
    expect((await reinforce(world, residentAlly, battleId, { razors: 4 })).statusCode).toBe(200);

    expect(runOnTheTick(world)).toBe(1);
    // The whole district army defends, with the ally's column beside it.
    expect(world.seen().defending).toEqual({ razors: 14 });
    // Two thousand after the stake, and the win pays twice it on the tick that ran the fight.
    expect(world.app.repos.bases.findById(residentAlly.baseId)!.resources.caps).toBe(4000);
    // The survivors are the resident's roster at once: six runners split 10:4 is 4 and 2.
    expect(army(world, resident)).toEqual({ razors: 4 });

    vi.useRealTimers();
    everybodyHome(world.app.repos);
    expect(army(world, raider)).toEqual({ razors: 17 });
    expect(army(world, residentAlly)).toEqual({ razors: 18 });
    // 8 kills, 6 routed at half (3), and the 25 for a raid won on ground that is not the regime's.
    expect(infamy(world, raider)).toBe(DECLARE_INFAMY_COST * 7 + 36);
    expect(infamy(world, resident)).toBe(DECLARE_INFAMY_COST * 8 + 3);
  });

  it('calls off a fight whose ground is gone on the tick, walks everybody home and hands the stake back', async () => {
    const world = await makeWorld('attacker');
    const { caller, mate } = await crews(world, { caller: { razors: 20 }, mate: {} });
    faction(world, 'callers', [caller, mate]);
    await call(world, caller, onBelt(PLOT));
    const battleId = onlyPending(world);
    // A faction mate's bet: the caller may not bet on its own call (2026-10-05).
    const purse = world.app.repos.bases.findById(mate.baseId)!;
    world.app.repos.bases.updateResearch(mate.baseId, {
      ...purse.research,
      technologies: [...purse.research.technologies, STACKHOUSE_RESEARCH_ID],
    });
    world.app.repos.bases.updateResources(mate.baseId, { ...purse.resources, caps: 3000 });
    expect(
      placeStackhouseBet(world.app.repos, {
        base: world.app.repos.bases.findById(mate.baseId)!,
        battleId,
        side: 'attacker',
        stake: 1000,
        now: new Date(),
        admin: false,
      }),
    ).toEqual({ kind: 'placed' });
    expect(world.app.repos.bases.findById(mate.baseId)!.resources.caps).toBe(2000);
    // All twenty, so the lock does not call it off first: the path under test is the ground gone.
    await deploy(world, caller, battleId, { razors: 20 });
    at('2026-10-06T15:00:00.000Z');
    settleWorld(world.app.repos, world.engine, new Date());
    // The district leaves the map under the fight (a renamed or retired district).
    world.db
      .prepare('UPDATE scheduled_battles SET district_id = ? WHERE id = ?')
      .run('nowhere-at-all', battleId);

    expect(runOnTheTick(world)).toBe(0);
    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).not.toBeNull();
    expect(world.app.repos.sieges.pending()).toHaveLength(0);
    expect(world.app.repos.bases.findById(mate.baseId)!.resources.caps).toBe(3000);
    vi.useRealTimers();
    everybodyHome(world.app.repos);
    expect(army(world, caller)).toEqual({ razors: 20 });
  });
});

/**
 * Bug pass, 2026-10-05: the Bone Market's refund went to the crew that called the fight for the
 * whole side's dead, an ally's included, and the ally got nothing for its own.
 */
describe('the salvage refund on a side of several crews', () => {
  const SALVAGE = ['tech_reimagining', 'tech_nothing_wasted']; // 8 + 15 = 23%
  const caps = (world: World, crew: Crew) =>
    world.app.repos.bases.findById(crew.baseId)!.resources.caps;
  const salvage = (world: World, crew: Crew) => {
    const base = world.app.repos.bases.findById(crew.baseId)!;
    world.app.repos.bases.updateResearch(base.id, {
      ...base.research,
      technologies: [...base.research.technologies, ...SALVAGE],
    });
  };

  async function lostAttack(allyHasSalvage: boolean) {
    // Every attacker dies: fifteen of the caller's, five of the ally's (twenty, the least a fight
    // needs at the lock).
    const world = await makeWorld('defender', {
      killed: { razors: 20 },
      fled: {},
      winnerLosses: {},
    });
    const { caller, ally } = await crews(world, { caller: { razors: 20 }, ally: { razors: 20 } });
    faction(world, 'callers', [caller, ally]);
    salvage(world, caller);
    if (allyHasSalvage) salvage(world, ally);
    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
    const battleId = onlyPending(world);
    expect((await deploy(world, caller, battleId, { razors: 15 })).statusCode).toBe(200);
    expect((await reinforce(world, ally, battleId, { razors: 5 })).statusCode).toBe(200);
    const before = { caller: caps(world, caller), ally: caps(world, ally) };
    expect(runOnTheTick(world)).toBe(1);
    return { caller: caps(world, caller) - before.caller, ally: caps(world, ally) - before.ally };
  }

  it('pays the caller for its own fifteen and nothing for the ally’s five', async () => {
    // Fifteen Razors at 40 caps, 23% back: 138. The whole side's twenty would have paid 184.
    expect(await lostAttack(false)).toEqual({ caller: 138, ally: 0 });
  });

  it('pays an ally holding its own salvage for its own dead', async () => {
    expect(await lostAttack(true)).toEqual({ caller: 138, ally: 46 });
  });
});

describe('an ally whose posting stood in the defence (bug pass, 2026-10-05)', () => {
  it('is in the fight’s history, as the holder is', async () => {
    const world = await makeWorld('attacker', {
      killed: { razors: 6 },
      fled: { razors: 2 },
      winnerLosses: {},
    });
    const { caller, holder, holderAlly } = await crews(world, {
      caller: { razors: 20 },
      holder: { razors: 20 },
      holderAlly: { razors: 20 },
    });
    faction(world, 'holders', [holder, holderAlly]);
    holdPlot(world, holder, { razors: 4 });
    world.app.repos.alliedGarrisons.set(PLOT, holderAlly.baseId, { razors: 4 });
    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
    const battleId = onlyPending(world);
    expect((await deploy(world, caller, battleId, { razors: 20 })).statusCode).toBe(200);
    expect(runOnTheTick(world)).toBe(1);
    const history = (crew: Crew) =>
      world.app.repos.sieges.resolvedFor(crew.baseId, 10).map((one) => one.battle.id);
    expect(history(holder)).toEqual([battleId]);
    expect(history(holderAlly)).toEqual([battleId]);
  });
});

/**
 * The maintainer's rulings of 2026-10-05 on calls nobody means to fight: the attack needs twenty
 * unit slots committed at the lock or the fight is called off, and a crew that called a place and
 * lost waits a day before it may call that place again.
 */
describe('a call has to be meant', () => {
  async function calledWith(slots: number) {
    const world = await makeWorld('attacker');
    const { caller, mate } = await crews(world, { caller: { razors: 30 }, mate: {} });
    faction(world, 'callers', [caller, mate]);
    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
    const battleId = onlyPending(world);
    const purse = world.app.repos.bases.findById(mate.baseId)!;
    world.app.repos.bases.updateResearch(mate.baseId, {
      ...purse.research,
      technologies: [...purse.research.technologies, STACKHOUSE_RESEARCH_ID],
    });
    world.app.repos.bases.updateResources(mate.baseId, { ...purse.resources, caps: 3000 });
    expect(
      placeStackhouseBet(world.app.repos, {
        base: world.app.repos.bases.findById(mate.baseId)!,
        battleId,
        side: 'defender',
        stake: 1000,
        now: new Date(),
        admin: false,
      }).kind,
    ).toBe('placed');
    expect((await deploy(world, caller, battleId, { razors: slots })).statusCode).toBe(200);
    const infamyAfterCall = infamy(world, caller);
    // A minute before the lock: still on. At the lock: judged.
    at('2026-10-06T15:59:00.000Z');
    settleWorld(world.app.repos, world.engine, new Date());
    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).toBeNull();
    at('2026-10-06T16:00:00.000Z');
    settleWorld(world.app.repos, world.engine, new Date());
    return { world, caller, mate, battleId, infamyAfterCall };
  }

  it('calls off an attack under twenty unit slots at the lock: everybody home, bets back, infamy kept', async () => {
    const { world, caller, mate, battleId, infamyAfterCall } = await calledWith(19);
    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).not.toBeNull();
    expect(world.app.repos.sieges.pending()).toHaveLength(0);
    expect(world.app.repos.bases.findById(mate.baseId)!.resources.caps).toBe(3000);
    expect(infamy(world, caller)).toBe(infamyAfterCall);
    const told = world.app.repos.social
      .notifications(world.app.repos.bases.findById(caller.baseId)!.ownerId, 5)
      .map((one) => one.title);
    expect(told).toContain('A fight was called off');
    vi.useRealTimers();
    everybodyHome(world.app.repos);
    expect(army(world, caller)).toEqual({ razors: 30 });
  });

  it('lets an attack of twenty stand', async () => {
    const { world, battleId } = await calledWith(20);
    expect(world.app.repos.sieges.find(battleId)?.resolvedAt).toBeNull();
  });

  it('holds the crew that called and lost off the place for a day, and nobody else', async () => {
    const world = await makeWorld('defender', { killed: { razors: 20 } });
    const { caller, other } = await crews(world, { caller: { razors: 30 }, other: { razors: 30 } });
    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
    const battleId = onlyPending(world);
    expect((await deploy(world, caller, battleId, { razors: 20 })).statusCode).toBe(200);
    expect(runOnTheTick(world)).toBe(1);

    // Called for the next day, still inside a day of the lost fight's mark.
    at('2026-10-06T18:00:00.000Z');
    const again = await call(world, caller, onBelt(PLOT), '2026-10-07T09:00:00.000Z');
    expect(again.statusCode).toBe(409);
    expect(message(again)).toBe(
      'You lost here. You cannot call it again until 24 hours after that fight',
    );
    expect((await call(world, other, onBelt(PLOT), '2026-10-07T09:00:00.000Z')).statusCode).toBe(
      200,
    );
  });

  it('lets the crew that lost call the place again a day after the fight', async () => {
    const world = await makeWorld('defender', { killed: { razors: 20 } });
    const { caller } = await crews(world, { caller: { razors: 30 } });
    expect((await call(world, caller, onBelt(PLOT))).statusCode).toBe(200);
    const battleId = onlyPending(world);
    expect((await deploy(world, caller, battleId, { razors: 20 })).statusCode).toBe(200);
    expect(runOnTheTick(world)).toBe(1);
    at('2026-10-07T17:00:01.000Z');
    expect((await call(world, caller, onBelt(PLOT), '2026-10-08T01:30:00.000Z')).statusCode).toBe(
      200,
    );
  });
});
