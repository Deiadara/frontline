/**
 * Battles: called for a mark, deployed into, led, boosted, trapped, reinforced by an ally, the
 * garrison locked in the last hour, resolved by the world clock, and the notoriety ladder.
 */
import {
  VEHICLES,
  createCommander,
  makeAttributes,
  type ActionsResponse,
  type BattleMutationResponse,
  type BattleTarget,
  type BattleView,
  type BattlesResponse,
  type CityResponse,
  type DeployQuoteResponse,
  type DistrictDetailResponse,
  type FactionMutationResponse,
  type MeResponse,
  type NotificationsResponse,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf, conservingUnits, first, MINUTE, HOUR } from './playthrough-helpers.js';
import { unitLedger } from './playthrough-invariants.js';
import {
  addItems,
  addOfficer,
  addUnits,
  grantResources,
  setBuildings,
  setInfamy,
  setLevel,
} from './playthrough-bench.js';

const TRAP = 'trap_pressure_plates';

async function board(h: Harness, crew: Player): Promise<BattlesResponse | undefined> {
  return h.ok<BattlesResponse>({ as: crew, method: 'GET', route: '/api/battles' });
}

function viewOf(read: BattlesResponse | undefined, battleId: string): BattleView | undefined {
  return read?.coming.find((one) => one.battle.id === battleId);
}

/** A's held ground in its first open district: the location the attack is called on. */
async function aGround(
  h: Harness,
  a: Player,
): Promise<{ districtId: string; locationId: string } | undefined> {
  const map = await h.ok<CityResponse>({ as: a, method: 'GET', route: '/api/city' });
  for (const summary of map?.districts ?? []) {
    if (!summary.held || summary.held.mine === 0 || summary.held.mine === summary.held.total)
      continue;
    const detail = await h.ok<DistrictDetailResponse>({
      as: a,
      method: 'GET',
      route: '/api/city/:id',
      params: { id: summary.district.id },
    });
    const held = detail?.locations.find(
      (one) => one.holder.kind === 'crew' && one.holder.baseId === a.baseId,
    );
    if (held) return { districtId: summary.district.id, locationId: held.location.id };
  }
  return undefined;
}

export async function battles(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');
  const d = player(cast, 'D');
  const e = player(cast, 'E');

  const ground = await aGround(h, a);
  if (!ground) {
    h.check(
      false,
      'A holds no location in a district with a seam, so nobody can call a fight on it',
    );
    return;
  }

  h.at('battles: E arms for a fight (bench)');
  setLevel(h, e, 16);
  setBuildings(h, e, { nexus: 6, quarters: 5, gate: 2, apothecary: 3 });
  grantResources(h, e, { caps: 10_000 });
  addUnits(h, e, { razors: 40 });
  setInfamy(h, e, 3_000);
  addOfficer(
    h,
    e,
    createCommander(
      'bench-E-field_commander',
      'E field commander',
      'field_commander',
      makeAttributes(70),
    ),
  );
  addItems(h, a, { [TRAP]: 1 });
  const vehicle = first(VEHICLES, 'vehicle');
  h.repos.bases.updateFleet(a.baseId, { ...(await baseOf(h, a)).fleet, [vehicle.id]: 2 });

  const target: BattleTarget = {
    kind: 'location',
    districtId: ground.districtId,
    locationId: ground.locationId,
  };
  const eBoard = await board(h, e);
  if (!eBoard) return;
  const mark = first(eBoard.slots, 'declarable slot');
  const price = eBoard.callPrices.locations[ground.locationId] ?? 0;

  h.at('battles: calls that cannot be made');
  const markMs = new Date(mark).getTime();
  const declare = (who: Player, body: unknown) =>
    h.refuse({
      as: who,
      method: 'POST',
      route: '/api/battles/declare',
      body,
      expect: 409,
      code: 'BATTLE_REFUSED',
    });
  await declare(e, { target, scheduledFor: new Date(markMs + 7 * MINUTE).toISOString() });
  await declare(e, { target, scheduledFor: new Date(markMs - 7 * HOUR).toISOString() });
  await declare(e, { target, scheduledFor: new Date(markMs + 30 * HOUR).toISOString() });
  await declare(a, { target, scheduledFor: mark });
  // The location named under a district it is not in: a place the map does not have.
  const elsewhere = ground.districtId === 'neon-docks' ? 'steelbelt' : 'neon-docks';
  await declare(d, { target: { ...target, districtId: elsewhere }, scheduledFor: mark });
  await h.refuseMalformed(e, '/api/battles/declare', {
    target: { kind: 'moon' },
    scheduledFor: mark,
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/declare',
    body: { target, scheduledFor: 'tomorrow' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  const eBase = await baseOf(h, e);
  setInfamy(h, e, 0);
  await declare(e, { target, scheduledFor: mark });
  setInfamy(h, e, eBase.economy.infamy);

  h.at('battles: E calls a fight on A');
  const before = await baseOf(h, e);
  const called = await h.ok<BattleMutationResponse>({
    as: e,
    method: 'POST',
    route: '/api/battles/declare',
    body: { target, scheduledFor: mark },
  });
  const battle = called?.battles.coming.find(
    (one) =>
      one.battle.target.kind === 'location' && one.battle.target.locationId === ground.locationId,
  );
  if (!called || !battle) {
    h.check(false, 'the declared fight is not on the board');
    return;
  }
  const battleId = battle.battle.id;
  cast.facts.set('battle:e-on-a', battleId);
  h.check(
    called.base.economy.infamy === before.economy.infamy - price,
    `calling the fight cost ${before.economy.infamy - called.base.economy.infamy} infamy, the board quoted ${price}`,
  );
  await declare(e, { target, scheduledFor: mark });
  const aView = viewOf(await board(h, a), battleId);
  h.check(aView?.role === 'defender', `A is the ${aView?.role} in a fight called on A's ground`);
  const aMe = await h.ok<MeResponse>({ as: a, method: 'GET', route: '/api/me' });
  h.check(
    (aMe?.unread?.fightsOnYou ?? 0) >= 1,
    'A has a fight called on them and the red mark reads zero',
  );
  const aBell = await h.ok<NotificationsResponse>({
    as: a,
    method: 'GET',
    route: '/api/notifications',
  });
  h.check(
    Boolean(aBell?.notifications.some((one) => one.kind === 'district_attacked')),
    'A was not told a fight was called on them',
  );

  h.at('battles: E deploys');
  const quote = await h.ok<DeployQuoteResponse>({
    as: e,
    method: 'POST',
    route: '/api/battles/deploy/quote',
    body: { battleId, changes: { razors: 20 } },
  });
  h.check((quote?.minutes ?? 0) > 0, `the column is quoted at ${quote?.minutes} minutes`);
  await conservingUnits(h, e, 'deploying a column', () =>
    h.ok<BattleMutationResponse>({
      as: e,
      method: 'POST',
      route: '/api/battles/deploy',
      body: { battleId, changes: { razors: 20 } },
    }),
  );
  await conservingUnits(h, e, 'deploying a second column', () =>
    h.ok<BattleMutationResponse>({
      as: e,
      method: 'POST',
      route: '/api/battles/deploy',
      body: { battleId, changes: { razors: 1 } },
    }),
  );
  const onTheRoad = await h.ok<ActionsResponse>({ as: e, method: 'GET', route: '/api/actions' });
  const straggler = onTheRoad?.movements.find((one) => one.battleId === battleId && one.size === 1);
  h.check(
    onTheRoad?.movements.some((one) => one.battleId === battleId && one.size === 20) ?? false,
    'the column of twenty is not on the road',
  );
  if (straggler) {
    await conservingUnits(h, e, 'turning a column around', () =>
      h.ok<ActionsResponse>({
        as: e,
        method: 'POST',
        route: '/api/actions/recall',
        body: { movementId: straggler.id },
      }),
    );
    await h.refuse({
      as: e,
      method: 'POST',
      route: '/api/actions/recall',
      body: { movementId: straggler.id },
      expect: 404,
      code: 'NOT_FOUND',
    });
  }
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/actions/recall',
    body: { movementId: 'no-such-column' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  const aColumns = await h.ok<ActionsResponse>({ as: a, method: 'GET', route: '/api/actions' });
  void aColumns;
  const eColumn = onTheRoad?.movements.find((one) => one.battleId === battleId && one.size === 20);
  if (eColumn) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/actions/recall',
      body: { movementId: eColumn.id },
      expect: 403,
      code: 'FORBIDDEN',
    });
  }
  await h.refuseMalformed(e, '/api/actions/recall', { movementId: false });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/deploy',
    body: { battleId, changes: { razors: 999 } },
    expect: 409,
    code: 'BATTLE_REFUSED',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/deploy',
    body: { battleId, changes: {}, perimeterChanges: { razors: 1 } },
    expect: 409,
    code: 'BATTLE_REFUSED',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/deploy',
    body: { battleId, changes: { scavengers: 1 } },
    expect: 409,
    code: 'BATTLE_REFUSED',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/battles/deploy',
    body: { battleId, changes: { razors: 1 } },
    expect: 409,
    code: 'BATTLE_REFUSED',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/deploy',
    body: { battleId: 'no-such-fight', changes: { razors: 1 } },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/battles/deploy/quote',
    body: { battleId, changes: { razors: 1 } },
    expect: 409,
    code: 'BATTLE_REFUSED',
  });
  await h.refuseMalformed(e, '/api/battles/deploy', { battleId, changes: { razors: 'many' } });
  await h.refuseMalformed(e, '/api/battles/deploy/quote', { battleId: 1 });

  h.at('battles: leaders');
  const eOfficer = 'bench-E-field_commander';
  const aOfficer = `bench-A-field_commander`;
  await h.ok<BattleMutationResponse>({
    as: e,
    method: 'POST',
    route: '/api/battles/lead',
    body: { battleId, officerId: eOfficer },
  });
  await h.ok<BattleMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/battles/lead',
    body: { battleId, officerId: aOfficer },
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/battles/lead',
    body: { battleId, officerId: eOfficer },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/battles/lead',
    body: { battleId, officerId: null },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/lead',
    body: { battleId: 'no-such-fight', officerId: null },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(e, '/api/battles/lead', { battleId });

  h.at('battles: a name burned on the fight');
  const eFight = viewOf(await board(h, e), battleId);
  const boost = eFight?.boosts.find((one) => one.available && one.affordable);
  if (boost) {
    const was = (await baseOf(h, e)).economy.infamy;
    const bought = await h.ok<BattleMutationResponse>({
      as: e,
      method: 'POST',
      route: '/api/battles/boost',
      body: { battleId, boostId: boost.id },
    });
    h.check(
      bought?.base.economy.infamy === was - boost.cost,
      `a boost priced ${boost.cost} took infamy from ${was} to ${bought?.base.economy.infamy}`,
    );
    await h.refuse({
      as: e,
      method: 'POST',
      route: '/api/battles/boost',
      body: { battleId, boostId: boost.id },
      expect: 409,
      code: 'BOOST_REFUSED',
    });
  } else {
    h.check(
      false,
      `E has no boost it can buy on its fight: ${JSON.stringify(eFight?.boosts.map((one) => [one.id, one.available, one.affordable]))}`,
    );
  }
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/boost',
    body: { battleId, boostId: 'no_such_boost' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/battles/boost',
    body: { battleId, boostId: boost?.id ?? 'x' },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuseMalformed(e, '/api/battles/boost', { battleId, boostId: 3 });

  h.at('battles: the defence');
  await conservingUnits(h, a, 'moving up to defend', () =>
    h.ok<BattleMutationResponse>({
      as: a,
      method: 'POST',
      route: '/api/battles/deploy',
      body: { battleId, changes: { razors: 3 }, perimeterChanges: { razors: 1 } },
    }),
  );
  await h.ok<BattleMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/battles/trap',
    body: { battleId, trapId: TRAP },
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/battles/trap',
    body: { battleId, trapId: 'trap_gas_shell' },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/battles/trap',
    body: { battleId, trapId: 'trap_of_dreams' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/trap',
    body: { battleId, trapId: TRAP },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuseMalformed(a, '/api/battles/trap', { battleId });
  const yard = (await baseOf(h, a)).fleet[vehicle.id] ?? 0;
  const rolled = await h.ok<BattleMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/battles/vehicles',
    body: { battleId, vehicles: { [vehicle.id]: 1 } },
  });
  h.check(
    (rolled?.base.fleet[vehicle.id] ?? 0) === yard - 1,
    `taking one ${vehicle.id} left ${rolled?.base.fleet[vehicle.id]} of ${yard} in the yard`,
  );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/battles/vehicles',
    body: { battleId, vehicles: { [vehicle.id]: 9 } },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/battles/vehicles',
    body: { battleId, vehicles: {} },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuseMalformed(a, '/api/battles/vehicles', { battleId, vehicles: [] });

  h.at('battles: an ally sends help');
  await conservingUnits(h, b, 'reinforcing an ally', () =>
    h.ok<FactionMutationResponse>({
      as: b,
      method: 'POST',
      route: '/api/factions/reinforce',
      body: { battleId, army: { razors: 3 } },
    }),
  );
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/factions/reinforce',
    body: { battleId, army: { razors: 1 } },
    expect: 409,
    code: 'FACTION_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/reinforce',
    body: { battleId: 'no-such-fight', army: { razors: 1 } },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/reinforce',
    body: { battleId, army: { razors: 999 } },
    expect: 409,
    code: 'BATTLE_REFUSED',
  });
  await h.refuseMalformed(b, '/api/factions/reinforce', { battleId, army: 'all' });
  const aBellAfter = await h.ok<NotificationsResponse>({
    as: a,
    method: 'GET',
    route: '/api/notifications',
  });
  h.check(
    Boolean(aBellAfter?.notifications.some((one) => one.kind === 'reinforcement_arrived')),
    'A was not told help is on the way',
  );

  h.at('battles: the garrison is locked in the last hour');
  h.advanceTo(markMs - 30 * MINUTE);
  // `POST /city/garrison` is gone (maintainer, 2026-09-28): units reach and leave ground by
  // walking, so the move is the door the lock holds.
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/actions/move',
    body: {
      from: { kind: 'location', locationId: ground.locationId },
      to: { kind: 'district' },
      army: { razors: 1 },
    },
    expect: 409,
    code: 'PLACE_UNAVAILABLE',
  });
  await conservingUnits(h, a, 'walking one more onto a locked garrison', () =>
    h.ok({
      as: a,
      method: 'POST',
      route: '/api/actions/move',
      body: {
        from: { kind: 'district' },
        to: { kind: 'location', locationId: ground.locationId },
        army: { razors: 1 },
      },
    }),
  );

  h.at('battles: the mark');
  // Every unit on either side is counted before the fight, wherever it is standing.
  h.advanceTo(markMs - MINUTE);
  h.settleAll();
  const ledgersBefore = new Map([e, a, b].map((crew) => [crew.label, unitLedger(h, crew.baseId)]));
  h.advanceTo(markMs + MINUTE);
  const eAfter = await board(h, e);
  const aAfter = await board(h, a);
  const eReport = eAfter?.reports.find((one) => one.battleId === battleId);
  const aReport = aAfter?.reports.find((one) => one.battleId === battleId);
  h.check(
    eReport !== undefined && aReport !== undefined,
    'the fight has no report on one of the two boards',
  );
  h.check(
    !eAfter?.coming.some((one) => one.battle.id === battleId),
    'a resolved fight is still coming',
  );
  if (eReport && aReport) {
    h.check(
      eReport.won !== aReport.won,
      `both sides report the same result (attacker won: ${eReport.won}, defender won: ${aReport.won})`,
    );
    const control = h.repos.city.control(ground.locationId);
    const holder = control?.holder.kind === 'crew' ? control.holder.baseId : control?.holder.kind;
    h.check(
      eReport.won ? holder === e.baseId : holder === a.baseId,
      `the attacker ${eReport.won ? 'won' : 'lost'} and ${ground.locationId} is held by ${holder}`,
    );
  }
  if (eReport?.analysis) {
    h.settleAll();
    // What each side reports losing is exactly what left its rosters: nothing more, nothing less.
    const lostBy = (units: readonly { unitId: string; lost: number; caught: number }[]) =>
      Object.fromEntries(units.map((one) => [one.unitId, one.lost + one.caught]));
    const drift = (crews: Player[]): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const crew of crews) {
        const before = ledgersBefore.get(crew.label) ?? {};
        const after = unitLedger(h, crew.baseId);
        for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
          const moved = (after[id] ?? 0) - (before[id] ?? 0);
          if (moved !== 0) out[id] = (out[id] ?? 0) + moved;
        }
      }
      return out;
    };
    // A trap takes its toll before contact and is reported beside the unit rows, not in them.
    const attackerLost =
      Object.values(lostBy(eReport.analysis.attacker.units)).reduce((sum, n) => sum + n, 0) +
      (eReport.analysis.trap?.killed ?? 0);
    const attackerDrift = Object.values(drift([e])).reduce((sum, n) => sum + n, 0);
    h.check(
      attackerDrift === -attackerLost,
      `the attacker's report says ${attackerLost} units lost (trap included) and E's units moved by ${attackerDrift}`,
    );
    const defenderLost = lostBy(eReport.analysis.defender.units);
    const defenderDrift = drift([a, b]);
    for (const id of new Set([...Object.keys(defenderLost), ...Object.keys(defenderDrift)])) {
      h.check(
        (defenderDrift[id] ?? 0) === -(defenderLost[id] ?? 0),
        `the defenders' report says ${defenderLost[id] ?? 0} ${id} lost and A and B's units moved by ${defenderDrift[id] ?? 0}`,
      );
    }
  }
  const bag = (await baseOf(h, a)).inventory as Record<string, number | undefined>;
  const trapLeft = bag[TRAP] ?? 0;
  h.check(
    trapLeft === 0,
    `the trap named on the fight is still in A's bag (${trapLeft}) after it went off`,
  );

  h.at('battles: a finished fight takes no orders');
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/deploy',
    body: { battleId, changes: { razors: 1 } },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/lead',
    body: { battleId, officerId: null },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/battles/boost',
    body: { battleId, boostId: boost?.id ?? 'x' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/battles/trap',
    body: { battleId, trapId: null },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/battles/vehicles',
    body: { battleId, vehicles: {} },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/factions/reinforce',
    body: { battleId, army: { razors: 1 } },
    expect: 404,
    code: 'NOT_FOUND',
  });

  await pendingCap(h, e);
  await notoriety(h, a, d);
  await npcFight(h, a);
}

/** A crew may have three calls out at once; the fourth is refused until one lands. */
async function pendingCap(h: Harness, e: Player): Promise<void> {
  h.at('battles: as many calls as a crew can answer for');
  setInfamy(h, e, 5_000);
  const read = await board(h, e);
  const mark = read?.slots[0];
  if (!read || !mark) return;
  // Ground an NPC party is standing on, anywhere in E's city, outside a shut district: inside one
  // the gate is the only thing to call on.
  const map = await h.ok<CityResponse>({ as: e, method: 'GET', route: '/api/city' });
  const shut = new Set(read.gates.filter((gate) => gate.shut).map((gate) => gate.districtId));
  const targets: BattleTarget[] = [];
  for (const summary of map?.districts ?? []) {
    if (summary.isHome || summary.district.kind !== 'contested') continue;
    if (shut.has(summary.district.id)) continue;
    const detail = await h.ok<DistrictDetailResponse>({
      as: e,
      method: 'GET',
      route: '/api/city/:id',
      params: { id: summary.district.id },
    });
    for (const view of detail?.locations ?? []) {
      if (view.holder.kind !== 'looters' && view.holder.kind !== 'government') continue;
      targets.push({
        kind: 'location',
        districtId: summary.district.id,
        locationId: view.location.id,
      });
    }
  }
  const pending = h.repos.sieges.pendingCountFor(e.baseId);
  const room = Math.max(0, 3 - pending);
  if (targets.length <= room) {
    h.check(false, `E can see only ${targets.length} places to call a fight on`);
    return;
  }
  for (const target of targets.slice(0, room)) {
    await h.ok({
      as: e,
      method: 'POST',
      route: '/api/battles/declare',
      body: { target, scheduledFor: mark },
    });
  }
  const fourth = targets[room];
  if (fourth) {
    await h.refuse({
      as: e,
      method: 'POST',
      route: '/api/battles/declare',
      body: { target: fourth, scheduledFor: mark },
      expect: 409,
      code: 'BATTLE_REFUSED',
    });
  }
  // Nobody is sent to any of them: they land on the mark and are lost without a fight.
  h.advanceTo(new Date(mark).getTime() + 5 * MINUTE);
  const after = await board(h, e);
  h.check(
    !after?.coming.some((one) => one.battle.scheduledFor === mark),
    'fights nobody deployed to are still coming after their mark',
  );
}

/** The ladder: a rank is bought with infamy, once per press. */
async function notoriety(h: Harness, a: Player, d: Player): Promise<void> {
  h.at('battles: the notoriety ladder');
  setInfamy(h, a, 5_000);
  const base = await baseOf(h, a);
  const rank = base.economy.notoriety;
  const bought = await h.ok<BattleMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/battles/notoriety',
    body: { fromNotoriety: rank },
  });
  h.check(
    bought?.base.economy.notoriety === rank + 1,
    `buying a rank took notoriety from ${rank} to ${bought?.base.economy.notoriety}`,
  );
  h.check((bought?.base.economy.infamy ?? 5_000) < 5_000, 'a rank cost no infamy');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/battles/notoriety',
    body: { fromNotoriety: rank },
    expect: 409,
    code: 'STALE_STATE',
  });
  await h.refuseMalformed(a, '/api/battles/notoriety', { fromNotoriety: 'one' });
  setInfamy(h, d, 0);
  await h.refuse({
    as: d,
    method: 'POST',
    route: '/api/battles/notoriety',
    body: {},
    expect: 409,
    code: 'NOT_ENOUGH_INFAMY',
  });
  // Up to the Black Market's door (notoriety 3), for the back room later.
  for (let step = 0; step < 3; step += 1) {
    const now = await baseOf(h, a);
    if (now.economy.notoriety >= 3) break;
    await h.ok({
      as: a,
      method: 'POST',
      route: '/api/battles/notoriety',
      body: { fromNotoriety: now.economy.notoriety },
    });
  }
}

/** A calls a fight on ground the looters or the Combine hold, and takes it. */
async function npcFight(h: Harness, a: Player): Promise<void> {
  h.at('battles: A takes NPC ground');
  const map = await h.ok<CityResponse>({ as: a, method: 'GET', route: '/api/city' });
  let target: BattleTarget | undefined;
  for (const summary of map?.districts ?? []) {
    if (summary.isHome || summary.held.mine === summary.held.total) continue;
    const detail = await h.ok<DistrictDetailResponse>({
      as: a,
      method: 'GET',
      route: '/api/city/:id',
      params: { id: summary.district.id },
    });
    const npc = detail?.locations.find((one) => one.holder.kind === 'looters');
    if (npc) {
      target = { kind: 'location', districtId: summary.district.id, locationId: npc.location.id };
      break;
    }
  }
  if (!target) return;
  addUnits(h, a, { razors: 40 });
  setInfamy(h, a, 3_000);
  const read = await board(h, a);
  const mark = first(read?.slots, 'slot');
  const called = await h.ok<BattleMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/battles/declare',
    // No hold flag: winners hold what they take (maintainer, 2026-09-28), and the field is gone.
    body: { target, scheduledFor: mark },
  });
  const fight = called?.battles.coming.find(
    (one) =>
      one.battle.target.kind === 'location' &&
      one.battle.target.locationId === (target.kind === 'location' ? target.locationId : ''),
  );
  if (!fight) return;
  await conservingUnits(h, a, 'deploying on NPC ground', () =>
    h.ok({
      as: a,
      method: 'POST',
      route: '/api/battles/deploy',
      body: { battleId: fight.battle.id, changes: { razors: 40 } },
    }),
  );
  h.advanceTo(new Date(mark).getTime() + MINUTE);
  const after = await board(h, a);
  const report = after?.reports.find((one) => one.battleId === fight.battle.id);
  h.check(report !== undefined, 'the fight on NPC ground has no report');
  if (report && target.kind === 'location') {
    const control = h.repos.city.control(target.locationId);
    const mine = control?.holder.kind === 'crew' && control.holder.baseId === a.baseId;
    h.check(report.won === mine, `A ${report.won ? 'won' : 'lost'} and holds the ground: ${mine}`);
  }
  h.advance(HOUR);
}
