import {
  SPY_SLEEPERS_RESEARCH_ID,
  featMeasureKey,
  findDistrict,
  findLocation,
  type Army,
  type BattlesResponse,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { groundBehind } from '../spying/spying.js';
import {
  PLOT,
  auth,
  closeWorlds,
  declare,
  faction,
  holdPlot,
  landEveryMove,
  makeWorld,
  register,
  runTheFight,
  type Crew,
  type World,
} from '../testing/fight-world.js';
import { settleBattles } from './resolve.js';

/**
 * Who fights for whom, decided at the mark (maintainer, 2026-09-28): every unit at the place of a
 * fight attacks if it is the attacker's or a faction-mate's, defends if it is the defender's or a
 * faction-mate's, and otherwise is parked, untouched and unseen (`battle/alignment.ts`).
 *
 * Each case reads the two lines the engine was actually handed, so a unit counted on the wrong side
 * or on both cannot pass. Nobody dies in these fights: the engine is decided by hand, so the only
 * thing that can move a unit is the settle.
 */

afterEach(closeWorlds);

const waitingCell = (world: World, crew: Crew, army: Army) =>
  world.app.repos.sleepers.insert({
    id: `cell-${crew.baseId}`,
    baseId: crew.baseId,
    locationId: PLOT,
    army,
    phase: 'waiting',
    departedAt: new Date(Date.now() - 3_600_000).toISOString(),
    arrivesAt: new Date(Date.now() - 1_800_000).toISOString(),
    travelMs: 1_800_000,
  });

describe('postings on the ground of a fight', () => {
  it('fight for the crew that posted them when it is the one calling the fight', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    faction(world, 'f1', [holder, caller]);
    holdPlot(world, holder, { razors: 5 });
    // Posted while the two were friends, and still standing there.
    world.app.repos.alliedGarrisons.set(PLOT, caller.baseId, { razors: 4 });

    const battleId = await declare(world, caller);
    runTheFight(world, battleId);

    // In the attacking line, and not in the defending one. It used to stand against its own crew.
    expect(world.seen().attacking).toEqual({ razors: 4 });
    expect(world.seen().defending).toEqual({ razors: 5 });
    expect(world.app.repos.alliedGarrisons.get(PLOT, caller.baseId)).toEqual({});
    // Won, and the survivors are the caller's, holding what they took: never the holder's to lose.
    expect(world.app.repos.city.control(PLOT)!).toMatchObject({
      holder: { kind: 'crew', baseId: caller.baseId },
      garrison: { razors: 4 },
    });
  });

  it('are parked when their crew is on neither side, and walk home when the ground changes hands', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller', { razors: 6 });
    const holder = await register(world, 'holder');
    const stranger = await register(world, 'stranger');
    holdPlot(world, holder, { razors: 5 });
    // Left behind by an alliance that is over: nobody's side in this fight.
    world.app.repos.alliedGarrisons.set(PLOT, stranger.baseId, { razors: 3 });

    const battleId = await declare(world, caller);
    runTheFight(world, battleId);

    expect(world.seen().defending, 'a neutral stood in the line').toEqual({ razors: 5 });
    expect(world.app.repos.alliedGarrisons.get(PLOT, stranger.baseId)).toEqual({});
    const [walking] = world.app.repos.moves.activeFor(stranger.baseId);
    expect(walking?.army, 'the parked posting was wiped with the ground').toEqual({ razors: 3 });
    landEveryMove(world);
    expect(world.app.repos.bases.findById(stranger.baseId)!.army).toEqual({ razors: 3 });
  });
});

describe('deployment rows at the mark', () => {
  it('parks a reinforcement whose crew has left the side, and walks it home', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    const friend = await register(world, 'friend');
    faction(world, 'f1', [caller, friend]);
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    const row = world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)!;
    world.app.repos.sieges.putDeployment({ ...row, army: { razors: 2 } });
    world.app.repos.sieges.putDeployment({ ...row, baseId: friend.baseId, army: { razors: 6 } });
    // The friend walks out of the faction before the mark.
    world.app.repos.factions.removeMember(friend.userId);

    runTheFight(world, battleId);

    expect(world.seen().attacking, 'a crew on no side fought').toEqual({ razors: 2 });
    expect(world.app.repos.sieges.deployment(battleId, 'attacker', friend.baseId)).toBeUndefined();
    landEveryMove(world);
    expect(world.app.repos.bases.findById(friend.baseId)!.army).toEqual({ razors: 6 });
  });

  /** Bug pass, 2026-09-28: the rows are the mark's to settle, and a crew on no side sends nothing. */
  it('turns away a crew that has left the side, at the deploy and at the reinforce', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    const friend = await register(world, 'friend');
    faction(world, 'f1', [caller, friend]);
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    const row = world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)!;
    world.app.repos.sieges.putDeployment({ ...row, baseId: friend.baseId, army: { razors: 6 } });
    const send = (url: string, payload: object) =>
      world.app.inject({ method: 'POST', url, headers: auth(friend.token), payload });
    const deploy = () =>
      send('/api/battles/deploy', { battleId, changes: { razors: 1 }, perimeterChanges: {} });
    const reinforce = () => send('/api/factions/reinforce', { battleId, army: { razors: 1 } });
    // The positive control: at the table, the row is theirs to feed.
    expect((await deploy()).body).not.toContain('not in');

    world.app.repos.factions.removeMember(friend.userId);
    const deployed = await deploy();
    expect(deployed.statusCode).toBe(409);
    expect(deployed.body).toContain('You are not in that fight');
    const reinforced = await reinforce();
    expect(reinforced.statusCode).toBe(409);
    expect(reinforced.body).toContain('not_a_member');
  });

  it('turns away help for a fight inside one faction, where the helper is on neither side', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    const friend = await register(world, 'friend');
    faction(world, 'f1', [caller, holder, friend]);
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);

    const helped = await world.app.inject({
      method: 'POST',
      url: '/api/factions/reinforce',
      headers: auth(friend.token),
      payload: { battleId, army: { razors: 1 } },
    });
    expect(helped.statusCode).toBe(409);
    expect(helped.body).toContain('not_a_member');
  });

  it("moves a reinforcement to the defence when its crew has joined the defender's faction", async () => {
    const world = await makeWorld('defender');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    const turncoat = await register(world, 'turncoat');
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    const row = world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)!;
    world.app.repos.sieges.putDeployment({ ...row, army: { razors: 2 } });
    world.app.repos.sieges.putDeployment({ ...row, baseId: turncoat.baseId, army: { razors: 6 } });
    faction(world, 'f2', [holder, turncoat]);

    runTheFight(world, battleId);

    expect(world.seen().attacking).toEqual({ razors: 2 });
    expect(world.seen().defending).toEqual({ razors: 11 });
    // Held, and their survivors went home to them rather than onto the holder's garrison.
    expect(world.app.repos.city.control(PLOT)!.garrison).toEqual({ razors: 5 });
    landEveryMove(world);
    expect(world.app.repos.bases.findById(turncoat.baseId)!.army).toEqual({ razors: 6 });
  });
});

describe('Sleepers waiting on the ground', () => {
  it("wake into the fight for a faction-mate of the caller, and a neutral's sleep on", async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    const mate = await register(world, 'mate');
    const stranger = await register(world, 'stranger');
    faction(world, 'f1', [caller, mate]);
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    waitingCell(world, mate, { sleepers: 2 });
    waitingCell(world, stranger, { sleepers: 3 });

    runTheFight(world, battleId);

    expect(world.seen().attacking).toEqual({ sleepers: 2 });
    expect(world.seen().defending).toEqual({ razors: 5 });
    expect(world.app.repos.sleepers.waitingAt(mate.baseId, PLOT)).toBeUndefined();
    expect(world.app.repos.sleepers.waitingAt(stranger.baseId, PLOT)?.army).toEqual({
      sleepers: 3,
    });
  });

  it("wake for the caller's own cell that went to ground after the call, and count as planted", async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    expect(world.app.repos.sieges.find(battleId)!.wokeSleepers).toBe(false);
    waitingCell(world, caller, { sleepers: 4 });

    runTheFight(world, battleId);

    expect(world.seen().attacking).toEqual({ sleepers: 4 });
    const tallies = world.app.repos.feats.tallies(caller.baseId);
    expect(tallies[featMeasureKey('battles_won_planted')] ?? 0).toBe(1);
  });
});

describe('Sleepers that were not there at the mark (bug pass, 2026-09-28)', () => {
  it('leave a cell that landed after the mark out of the fight, however late the settle ran', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    const mate = await register(world, 'mate');
    faction(world, 'f1', [caller, mate]);
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    const mark = Date.parse(world.app.repos.sieges.find(battleId)!.scheduledFor);
    // Due twenty minutes after the mark, and already written down as landed: the late tick.
    world.app.repos.sleepers.insert({
      id: 'cell-late',
      baseId: mate.baseId,
      locationId: PLOT,
      army: { sleepers: 2 },
      phase: 'waiting',
      departedAt: new Date(mark - 10 * 60_000).toISOString(),
      arrivesAt: new Date(mark + 30 * 60_000).toISOString(),
      travelMs: 30 * 60_000,
    });

    runTheFight(world, battleId);

    expect(world.seen().attacking).toEqual({});
    expect(world.app.repos.sleepers.waitingAt(mate.baseId, PLOT)?.army).toEqual({ sleepers: 2 });
  });

  it('are held on the ground in the last hour, like everybody else there', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    waitingCell(world, caller, { sleepers: 2 });
    const recall = () =>
      world.app.inject({
        method: 'POST',
        url: '/api/city/sleepers/recall',
        headers: auth(caller.token),
        payload: { cellId: `cell-${caller.baseId}` },
      });
    // Half an hour from the mark.
    world.app.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() + 30 * 60_000).toISOString(), battleId);
    const held = await recall();
    expect(held.statusCode, held.body).toBe(409);
    expect(held.body).toContain('within the hour');

    // Two hours out, the same cell gets up and leaves.
    world.app.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() + 2 * 3_600_000).toISOString(), battleId);
    expect((await recall()).statusCode).toBe(200);
  });
});

describe('a raid, and the crews who share the district', () => {
  it("turns out a neighbour of the defender's faction, and leaves a neutral neighbour alone", async () => {
    const world = await makeWorld('defender');
    const HOME = 'ashen-terraces';
    const raider = await register(world, 'raider');
    const resident = await register(world, 'resident', { razors: 10 });
    const friend = await register(world, 'friend', { razors: 4 });
    const stranger = await register(world, 'stranger', { razors: 7 });
    for (const crew of [resident, friend, stranger]) {
      world.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, crew.baseId);
    }
    faction(world, 'f3', [resident, friend]);
    world.app.repos.city.markScouted(raider.baseId, HOME, new Date().toISOString());
    world.app.repos.sieges.breakGate(HOME, new Date(Date.now() + 48 * 3_600_000).toISOString());

    const battleId = await declare(world, raider, { kind: 'district', districtId: HOME });
    runTheFight(world, battleId);

    expect(world.seen().defending).toEqual({ razors: 14 });
    // Held: the friend's people are home again, and the stranger's were never touched.
    expect(world.app.repos.bases.findById(friend.baseId)!.army).toEqual({ razors: 4 });
    expect(world.app.repos.bases.findById(stranger.baseId)!.army).toEqual({ razors: 7 });
    expect(world.app.repos.bases.findById(resident.baseId)!.army).toEqual({ razors: 10 });
  });
});

describe('what a spy is shown (maintainer, 2026-09-28: neutrals "don\'t show up in spying")', () => {
  it("counts the holder's side and nobody parked there", async () => {
    const world = await makeWorld('attacker');
    const reader = await register(world, 'reader');
    const holder = await register(world, 'holder');
    const mate = await register(world, 'mate');
    const stranger = await register(world, 'stranger');
    faction(world, 'f2', [holder, mate]);
    holdPlot(world, holder, { razors: 5 });
    world.app.repos.alliedGarrisons.set(PLOT, mate.baseId, { razors: 2 });
    world.app.repos.alliedGarrisons.set(PLOT, stranger.baseId, { razors: 9 });
    waitingCell(world, mate, { sleepers: 1 });
    waitingCell(world, stranger, { sleepers: 6 });
    const base = world.app.repos.bases.findById(reader.baseId)!;
    world.app.repos.bases.updateResearch(reader.baseId, {
      ...base.research,
      technologies: [...base.research.technologies, SPY_SLEEPERS_RESEARCH_ID],
    });

    const looked = groundBehind(world.app.repos, world.app.repos.bases.findById(reader.baseId)!, {
      kind: 'location',
      locationId: PLOT,
    });
    expect(looked.kind).toBe('ground');
    if (looked.kind === 'ground') expect(looked.ground.army).toEqual({ razors: 7, sleepers: 1 });
  });

  /**
   * Bug pass, 2026-09-28: a crew holding a district from somewhere else defends its gate with what
   * it sends, so its location garrisons and anybody's planted cells are not behind that gate.
   */
  it('shows nobody behind the gate of a district a crew holds from elsewhere', async () => {
    const world = await makeWorld('attacker');
    const reader = await register(world, 'reader');
    const holder = await register(world, 'holder');
    const districtId = findLocation(PLOT)!.districtId;
    for (const location of findDistrict(districtId)!.locations) {
      const control = world.app.repos.city.control(location.id)!;
      world.app.repos.city.put({
        ...control,
        holder: { kind: 'crew', baseId: holder.baseId },
        garrison: { razors: 10 },
      });
    }
    waitingCell(world, holder, { sleepers: 3 });

    const looked = groundBehind(world.app.repos, world.app.repos.bases.findById(reader.baseId)!, {
      kind: 'gate',
      districtId,
    });
    expect(looked.kind).toBe('ground');
    if (looked.kind === 'ground') expect(looked.ground.army).toEqual({});
  });
});

describe('the battle page shows what is at the place', () => {
  it("lists the holder's garrison for the defence, and the caller's own posting for the attack", async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    faction(world, 'f1', [holder, caller]);
    holdPlot(world, holder, { razors: 5 });
    world.app.repos.alliedGarrisons.set(PLOT, caller.baseId, { razors: 4 });
    const battleId = await declare(world, caller);

    const board = async (crew: Crew) =>
      (await world.app.inject({ method: 'GET', url: '/api/battles', headers: auth(crew.token) }))
        .json<BattlesResponse>()
        .coming.find((view) => view.battle.id === battleId)!;
    expect((await board(holder)).muster?.standing).toEqual({ razors: 5 });
    expect((await board(caller)).muster?.standing).toEqual({ razors: 4 });
  });

  it("leaves a row whose crew has left the side out of that side's muster", async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    const friend = await register(world, 'friend');
    faction(world, 'f1', [caller, friend]);
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    const row = world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)!;
    world.app.repos.sieges.putDeployment({ ...row, army: { razors: 2 } });
    world.app.repos.sieges.putDeployment({ ...row, baseId: friend.baseId, army: { razors: 6 } });
    const muster = async () =>
      (await world.app.inject({ method: 'GET', url: '/api/battles', headers: auth(caller.token) }))
        .json<BattlesResponse>()
        .coming.find((view) => view.battle.id === battleId)!.muster?.army;

    expect(await muster()).toEqual({ razors: 8 });
    world.app.repos.factions.removeMember(friend.userId);
    expect(await muster()).toEqual({ razors: 2 });
  });
});

/**
 * A fight's survivors walk home from it (maintainer, 2026-09-28: "Nothing sends units immediately,
 * you need to move them"). The fight's own tests pin who survives; these pin where they go and how.
 */
describe('survivors of a fight', () => {
  /** A call on `crew`'s own gate, written straight onto the table: the settle is what is measured. */
  function callOnTheGate(world: World, attacker: Crew, crew: Crew, over = 60_000): string {
    const districtId = world.app.repos.bases.findById(crew.baseId)!.districtId;
    world.app.repos.sieges.insert({
      id: 'gate-fight',
      target: { kind: 'gate', districtId },
      attackerBaseId: attacker.baseId,
      defender: { kind: 'unoccupied' },
      scheduledFor: new Date(Date.now() - over).toISOString(),
      declaredAt: new Date(Date.now() - 9 * 3_600_000).toISOString(),
      resolvedAt: null,
      seed: 'seed',
      holdAfterCapture: true,
      wokeSleepers: false,
    });
    return 'gate-fight';
  }

  it('fall back from a gate that fell on foot, and stay on one that held', async () => {
    const fell = await makeWorld('attacker', { fled: { razors: 2 } });
    const raider = await register(fell, 'raider');
    const home = await register(fell, 'home');
    fell.app.repos.bases.updateGateArmy(home.baseId, { razors: 4 });
    callOnTheGate(fell, raider, home);
    expect(settleBattles(fell.app.repos, fell.engine, new Date())).toHaveLength(1);

    expect(fell.app.repos.bases.findById(home.baseId)!.gateArmy).toEqual({});
    expect(fell.app.repos.bases.findById(home.baseId)!.army, 'back in an instant').toEqual({});
    const [back] = fell.app.repos.moves.activeFor(home.baseId);
    expect(back?.from).toEqual({ kind: 'gate' });
    expect(back?.army).toEqual({ razors: 2 });
    landEveryMove(fell);
    expect(fell.app.repos.bases.findById(home.baseId)!.army).toEqual({ razors: 2 });

    const held = await makeWorld('defender');
    const raider2 = await register(held, 'raider');
    const home2 = await register(held, 'home');
    held.app.repos.bases.updateGateArmy(home2.baseId, { razors: 4 });
    callOnTheGate(held, raider2, home2);
    expect(settleBattles(held.app.repos, held.engine, new Date())).toHaveLength(1);
    expect(held.app.repos.bases.findById(home2.baseId)!.gateArmy).toEqual({ razors: 4 });
    expect(held.app.repos.moves.activeFor(home2.baseId)).toEqual([]);
  });

  it('walk home from a location their crew lost', async () => {
    const world = await makeWorld('attacker', { fled: { razors: 2 } });
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    holdPlot(world, holder, { razors: 5 });
    const battleId = await declare(world, caller);
    runTheFight(world, battleId);

    expect(world.app.repos.bases.findById(holder.baseId)!.army).toEqual({});
    const [back] = world.app.repos.moves.activeFor(holder.baseId);
    expect(back?.from).toEqual({ kind: 'location', locationId: PLOT });
    expect(back?.army).toEqual({ razors: 2 });
    landEveryMove(world);
    expect(world.app.repos.bases.findById(holder.baseId)!.army).toEqual({ razors: 2 });
  });

  it("stay on their own gate when a neighbour's gate garrison held it", async () => {
    const world = await makeWorld('defender');
    const raider = await register(world, 'raider');
    const home = await register(world, 'home');
    const friend = await register(world, 'friend');
    const districtId = world.app.repos.bases.findById(home.baseId)!.districtId;
    world.db
      .prepare('UPDATE bases SET district_id = ? WHERE id = ?')
      .run(districtId, friend.baseId);
    faction(world, 'f4', [home, friend]);
    world.app.repos.bases.updateGateArmy(home.baseId, { razors: 4 });
    world.app.repos.bases.updateGateArmy(friend.baseId, { razors: 3 });
    callOnTheGate(world, raider, home);
    expect(settleBattles(world.app.repos, world.engine, new Date())).toHaveLength(1);

    expect(world.seen().defending).toEqual({ razors: 7 });
    expect(world.app.repos.bases.findById(friend.baseId)!.gateArmy).toEqual({ razors: 3 });
    expect(world.app.repos.moves.activeFor(friend.baseId)).toEqual([]);
  });

  it('walk home from a lost fight with the machines that carried them', async () => {
    const world = await makeWorld('defender', { fled: { razors: 2 } });
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    holdPlot(world, holder, {});
    const battleId = await declare(world, caller);
    const row = world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)!;
    world.app.repos.sieges.putDeployment({
      ...row,
      army: { razors: 2 },
      vehicles: { motorcycle: 1 },
    });
    const yard = world.app.repos.bases.findById(caller.baseId)!.fleet.motorcycle ?? 0;

    runTheFight(world, battleId);

    const [column] = world.app.repos.moves.activeFor(caller.baseId);
    expect(column?.army).toEqual({ razors: 2 });
    expect(column?.vehicles).toEqual({ motorcycle: 1 });
    expect(world.app.repos.bases.findById(caller.baseId)!.fleet.motorcycle ?? 0).toBe(yard);
    landEveryMove(world);
    expect(world.app.repos.bases.findById(caller.baseId)!.fleet.motorcycle ?? 0).toBe(yard + 1);
    expect(world.app.repos.bases.findById(caller.baseId)!.army).toEqual({ razors: 2 });
  });

  it('send the machines home on their own when the crew stays to hold, and nobody can turn them round', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const holder = await register(world, 'holder');
    holdPlot(world, holder, {});
    const battleId = await declare(world, caller);
    const row = world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)!;
    world.app.repos.sieges.putDeployment({
      ...row,
      army: { razors: 2 },
      vehicles: { motorcycle: 1 },
    });

    runTheFight(world, battleId);

    expect(world.app.repos.city.control(PLOT)!.garrison).toEqual({ razors: 2 });
    const [convoy] = world.app.repos.moves.activeFor(caller.baseId);
    expect(convoy?.army).toEqual({});
    expect(convoy?.vehicles).toEqual({ motorcycle: 1 });
    expect(convoy?.recalledAt, 'an empty convoy could be recalled home in seconds').not.toBeNull();
  });
});
