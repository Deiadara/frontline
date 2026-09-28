/**
 * The city: the map, ground taken by walking onto it, garrisons, location work, scouting, spying,
 * sleeper cells and a captured gate.
 */
import {
  PLAYER_UNITS,
  cancelRefund,
  type ActionsResponse,
  type CityMutationResponse,
  type CityResponse,
  type DistrictDetailResponse,
  type LocationView,
  type MoveQuoteResponse,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import {
  baseOf,
  conservingUnits,
  expectDelta,
  negate,
  MINUTE,
  HOUR,
} from './playthrough-helpers.js';
import { addUnits, grantResources } from './playthrough-bench.js';

const SLEEPER_UNIT = PLAYER_UNITS.find((unit) => unit.sleeper === true)?.id;

export async function city(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const c = player(cast, 'C');
  const ground = await mapReads(h, a);
  if (!ground) return;
  await walkOntoGround(h, a, ground);
  await garrison(h, a, ground);
  await locationWork(h, a, ground);
  await spying(h, a, ground);
  await scouting(h, a);
  await sleepers(h, a, ground);
  await capturedGate(h, a, c);
  // C takes ground in Terminus the same way, for the faction and battle scenes later.
  const terminus = await mapReads(h, c);
  if (terminus) await walkOntoGround(h, c, terminus);
}

export interface Ground {
  district: DistrictDetailResponse;
  /** A location nobody holds, which a column can walk onto. */
  open: LocationView;
  /** A location an NPC party holds. */
  held: LocationView | undefined;
}

async function mapReads(h: Harness, crew: Player): Promise<Ground | undefined> {
  h.at(`city: ${crew.label} reads the map`);
  const map = await h.ok<CityResponse>({ as: crew, method: 'GET', route: '/api/city' });
  if (!map) return undefined;
  const other = map.cityId === 'ashfall' ? 'terminus' : 'ashfall';
  const abroad = await h.ok<CityResponse>({
    as: crew,
    method: 'GET',
    route: '/api/city',
    query: { city: other },
  });
  h.check(
    abroad?.districts.every((one) => !one.scouted) ?? false,
    `${crew.label} sees scouted ground in ${other}, a city nobody of theirs has been to`,
  );
  await h.call({
    as: crew,
    method: 'GET',
    route: '/api/city',
    query: { city: 'redline' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.call({
    as: crew,
    method: 'GET',
    route: '/api/city/:id',
    params: { id: 'no-such-district' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  const home = await h.ok<DistrictDetailResponse>({
    as: crew,
    method: 'GET',
    route: '/api/city/:id',
    params: { id: map.homeDistrictId },
  });
  h.check(
    home?.district.id === map.homeDistrictId,
    'the home district read answered with another district',
  );

  for (const summary of map.districts.filter((one) => one.scouted && !one.isHome)) {
    const detail = await h.ok<DistrictDetailResponse>({
      as: crew,
      method: 'GET',
      route: '/api/city/:id',
      params: { id: summary.district.id },
    });
    if (!detail) continue;
    const open = detail.locations.find((one) => one.holder.kind === 'unoccupied');
    const held = detail.locations.find(
      (one) => one.holder.kind === 'looters' || one.holder.kind === 'government',
    );
    if (open) return { district: detail, open, held };
  }
  h.check(false, `${crew.label} has no scouted district with open ground in it`);
  return undefined;
}

/** A column of fighters walks onto open ground and holds it when it arrives. */
async function walkOntoGround(h: Harness, crew: Player, ground: Ground): Promise<void> {
  h.at(`city: ${crew.label} walks onto ${ground.open.location.id}`);
  const to = { kind: 'location', locationId: ground.open.location.id };
  const body = { from: { kind: 'district' }, to, army: { razors: 6 } };
  const quote = await h.ok<MoveQuoteResponse>({
    as: crew,
    method: 'POST',
    route: '/api/actions/move/quote',
    body,
  });
  h.check(
    (quote?.minutes ?? 0) > 0,
    `a walk to ${ground.open.location.id} is quoted at ${quote?.minutes} minutes`,
  );

  // Refusals, before anything is on the road.
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/actions/move',
    body: { ...body, to: { kind: 'district' } },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/actions/move',
    body: { ...body, army: {} },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/actions/move',
    body: { ...body, army: { razors: 9_999 } },
    expect: 409,
    code: 'NO_FORCE',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/actions/move',
    body: { ...body, army: { scavengers: 2 } },
    expect: 409,
    code: 'NO_FORCE',
  });
  if (ground.held) {
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/actions/move',
      body: { ...body, to: { kind: 'location', locationId: ground.held.location.id } },
      expect: 400,
      code: 'INVALID_TARGET',
    });
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/actions/move',
      body: {
        from: { kind: 'location', locationId: ground.held.location.id },
        to: { kind: 'district' },
        army: { razors: 1 },
      },
      expect: 403,
      code: 'FORBIDDEN',
    });
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/actions/move/quote',
      body: {
        from: { kind: 'location', locationId: ground.held.location.id },
        to: { kind: 'district' },
        army: { razors: 1 },
      },
      expect: 403,
      code: 'FORBIDDEN',
    });
  }
  await h.refuseMalformed(crew, '/api/actions/move', {
    from: { kind: 'moon' },
    to,
    army: { razors: 1 },
  });
  await h.refuseMalformed(crew, '/api/actions/move/quote', { from: 'district', to, army: {} });

  const sent = await conservingUnits(h, crew, 'a move onto open ground', () =>
    h.ok<ActionsResponse>({ as: crew, method: 'POST', route: '/api/actions/move', body }),
  );
  const move = sent?.moves.find((one) => one.to.kind === 'location');
  h.check(move !== undefined, 'the move is not on the road');

  // A second, smaller column, turned around at once.
  const second = await h.ok<ActionsResponse>({
    as: crew,
    method: 'POST',
    route: '/api/actions/move',
    body: { ...body, army: { razors: 1 } },
  });
  const turned = second?.moves.find((one) => one.id !== move?.id && one.recalledAt === null);
  if (turned) {
    await conservingUnits(h, crew, 'recalling a move', () =>
      h.ok<ActionsResponse>({
        as: crew,
        method: 'POST',
        route: '/api/actions/move/recall',
        body: { moveId: turned.id },
      }),
    );
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/actions/move/recall',
      body: { moveId: turned.id },
      expect: 409,
      code: 'PLACE_UNAVAILABLE',
    });
  }
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/actions/move/recall',
    body: { moveId: 'no-such-move' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(crew, '/api/actions/move/recall', { moveId: 12 });

  // They arrive, and the ground is theirs.
  if (move) h.advanceTo(new Date(move.arrivesAt).getTime() + MINUTE);
  h.advance(2 * HOUR);
  const after = await h.ok<DistrictDetailResponse>({
    as: crew,
    method: 'GET',
    route: '/api/city/:id',
    params: { id: ground.district.district.id },
  });
  const now = after?.locations.find((one) => one.location.id === ground.open.location.id);
  h.check(
    now?.holder.kind === 'crew' && now.holder.baseId === crew.baseId,
    `${crew.label}'s column arrived and ${ground.open.location.id} is held by ${JSON.stringify(now?.holder)}`,
  );
  h.check(
    (now?.garrison as Record<string, number> | null)?.razors === 6,
    `${ground.open.location.id} is garrisoned by ${JSON.stringify(now?.garrison)}, six Razors walked in`,
  );
  const actions = await h.ok<ActionsResponse>({ as: crew, method: 'GET', route: '/api/actions' });
  h.check(
    Boolean(actions?.stationed.some((one) => one.locationId === ground.open.location.id)),
    'the held ground is not listed among the stationed forces',
  );
}

async function garrison(h: Harness, a: Player, ground: Ground): Promise<void> {
  h.at('city: the garrison');
  const locationId = ground.open.location.id;
  // `POST /city/garrison` is gone (maintainer, 2026-09-28: "Nothing sends units immediately"):
  // standing units on ground and bringing them home are both moves, and both walk.
  const onto = (army: Record<string, number>, to: string = locationId) => ({
    from: { kind: 'district' },
    to: { kind: 'location', locationId: to },
    army,
  });
  await conservingUnits(h, a, 'walking units onto a garrison', () =>
    h.ok<ActionsResponse>({
      as: a,
      method: 'POST',
      route: '/api/actions/move',
      body: onto({ razors: 2 }),
    }),
  );
  await conservingUnits(h, a, 'walking units off a garrison', () =>
    h.ok<ActionsResponse>({
      as: a,
      method: 'POST',
      route: '/api/actions/move',
      body: {
        from: { kind: 'location', locationId },
        to: { kind: 'district' },
        army: { razors: 3 },
      },
    }),
  );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/actions/move',
    body: onto({ razors: 9_999 }),
    expect: 409,
    code: 'NO_FORCE',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/actions/move',
    body: onto({ scavengers: 1 }),
    expect: 409,
    code: 'NO_FORCE',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/actions/move',
    body: onto({ razors: 1 }, 'nowhere'),
    expect: 404,
    code: 'NOT_FOUND',
  });
  if (ground.held) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/actions/move',
      body: onto({ razors: 1 }, ground.held.location.id),
      expect: 400,
      code: 'INVALID_TARGET',
    });
  }
  await h.refuseMalformed(a, '/api/actions/move', onto({ razors: 'two' } as never));
}

async function locationWork(h: Harness, a: Player, ground: Ground): Promise<void> {
  h.at('city: working a location up');
  const locationId = ground.open.location.id;
  grantResources(h, a, { caps: 10_000, scrap: 2_000, planks: 2_000, supplies: 1_000, oil: 1_000 });
  const read = await h.ok<DistrictDetailResponse>({
    as: a,
    method: 'GET',
    route: '/api/city/:id',
    params: { id: ground.district.district.id },
  });
  const view = read?.locations.find((one) => one.location.id === locationId);
  const cost = view?.upgrade?.cost;
  const before = await baseOf(h, a);
  const started = await h.ok<CityMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/upgrade',
    body: { locationId },
  });
  if (started && cost)
    expectDelta(
      h,
      before.resources,
      started.base.resources,
      negate(cost),
      'starting location work',
    );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/upgrade',
    body: { locationId },
    expect: 409,
    code: 'PLACE_UNAVAILABLE',
  });
  const cancelled = await h.ok<CityMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/cancel-upgrade',
    body: { locationId },
  });
  if (started && cancelled && cost) {
    expectDelta(
      h,
      started.base.resources,
      cancelled.base.resources,
      cancelRefund(cost),
      'calling location work off',
    );
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/cancel-upgrade',
    body: { locationId },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/cancel-upgrade',
    body: { locationId: 'nowhere' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/city/cancel-upgrade', { locationId: 3 });
  await h.refuseMalformed(a, '/api/city/upgrade', { locationId: null });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/upgrade',
    body: { locationId: 'nowhere' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  if (ground.held) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/city/upgrade',
      body: { locationId: ground.held.location.id },
      expect: 409,
      code: 'PLACE_UNAVAILABLE',
    });
  }
  // An empty till.
  const flush = await baseOf(h, a);
  h.repos.bases.updateResources(a.baseId, {
    ...flush.resources,
    caps: 0,
    scrap: 0,
    planks: 0,
    supplies: 0,
    oil: 0,
    highQualityMetal: 0,
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/upgrade',
    body: { locationId },
    expect: 409,
    code: 'INSUFFICIENT_RESOURCES',
  });
  h.repos.bases.updateResources(a.baseId, flush.resources);

  // Started again and left to finish.
  const again = await h.ok<CityMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/upgrade',
    body: { locationId },
  });
  const until = again?.district.locations.find(
    (one) => one.location.id === locationId,
  )?.upgradingUntil;
  if (until) h.advanceTo(new Date(until).getTime() + MINUTE);
  const done = await h.ok<DistrictDetailResponse>({
    as: a,
    method: 'GET',
    route: '/api/city/:id',
    params: { id: ground.district.district.id },
  });
  const level = done?.locations.find((one) => one.location.id === locationId)?.level;
  h.check(
    level === (view?.level ?? 1) + 1,
    `location work finished and ${locationId} stands at level ${level}`,
  );
}

async function spying(h: Harness, a: Player, ground: Ground): Promise<void> {
  h.at('city: the runners');
  if (!ground.held) return;
  const target = { kind: 'location', locationId: ground.held.location.id };
  const before = await baseOf(h, a);
  const sent = await h.ok<CityMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/spy',
    body: { target, tier: 'loose_ears' },
  });
  h.check(
    sent?.district.spyRun !== null && sent?.district.spyRun !== undefined,
    'the runners did not go out',
  );
  if (sent) h.check(sent.base.resources.caps <= before.resources.caps, 'a spy job paid the crew');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/spy',
    body: { target, tier: 'loose_ears' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.ok({ as: a, method: 'POST', route: '/api/city/spy/recall', body: {} });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/spy/recall',
    body: {},
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/spy',
    body: { target: { kind: 'location', locationId: ground.open.location.id }, tier: 'loose_ears' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/spy',
    body: { target: { kind: 'location', locationId: 'nowhere' }, tier: 'loose_ears' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/spy',
    body: { target, tier: 'omniscience' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/city/spy', { target: 'there', tier: 'loose_ears' });
  await h.refuseMalformed(a, '/api/city/spy/recall', []);

  // Out again and home with a report.
  const again = await h.ok<CityMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/spy',
    body: { target, tier: 'loose_ears' },
  });
  const run = again?.district.spyRun;
  if (run) h.advanceTo(new Date(run.returnsAt).getTime() + MINUTE);
  h.advance(10 * MINUTE);
  const read = await h.ok<DistrictDetailResponse>({
    as: a,
    method: 'GET',
    route: '/api/city/:id',
    params: { id: ground.district.district.id },
  });
  const report = read?.locations.find(
    (one) => one.location.id === ground.held?.location.id,
  )?.latestSpyReport;
  h.check(
    report !== null && report !== undefined,
    'the runners came home and the location carries no report',
  );
}

async function scouting(h: Harness, a: Player): Promise<void> {
  h.at('city: scouting');
  const map = await h.ok<CityResponse>({ as: a, method: 'GET', route: '/api/city' });
  const blind = map?.districts.filter(
    (one) => !one.scouted && !one.isHome && one.district.kind === 'contested',
  );
  const first = blind?.[0];
  const seen = map?.districts.find((one) => one.scouted && !one.isHome);
  if (!map || !first) return;
  const sent = await h.ok<CityMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/scout',
    body: { districtId: first.district.id },
  });
  h.check(
    sent?.district.scoutingRun !== null && sent?.district.scoutingRun !== undefined,
    'nobody went out scouting',
  );
  const second = blind?.[1];
  if (second) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/city/scout',
      body: { districtId: second.district.id },
      expect: 400,
      code: 'VALIDATION_ERROR',
    });
  }
  await h.ok({ as: a, method: 'POST', route: '/api/city/scout/recall', body: {} });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/scout/recall',
    body: {},
    expect: 404,
    code: 'NOT_FOUND',
  });
  // The walk home has to finish before anybody goes out again.
  h.advance(12 * HOUR);
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/scout',
    body: { districtId: map.homeDistrictId },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  if (seen) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/city/scout',
      body: { districtId: seen.district.id },
      expect: 400,
      code: 'VALIDATION_ERROR',
    });
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/scout',
    body: { districtId: 'nowhere' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/city/scout', { districtId: 5 });
  await h.refuseMalformed(a, '/api/city/scout/recall', []);

  const again = await h.ok<CityMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/scout',
    body: { districtId: first.district.id },
  });
  const run = again?.district.scoutingRun;
  if (run) h.advanceTo(new Date(run.returnsAt).getTime() + MINUTE);
  const after = await h.ok<CityResponse>({ as: a, method: 'GET', route: '/api/city' });
  h.check(
    Boolean(after?.districts.find((one) => one.district.id === first.district.id)?.scouted),
    `the scout came home and ${first.district.id} is still in the fog`,
  );
}

async function sleepers(h: Harness, a: Player, ground: Ground): Promise<void> {
  h.at('city: a sleeper cell');
  if (!SLEEPER_UNIT || !ground.held) {
    h.check(SLEEPER_UNIT !== undefined, 'no unit in the catalogue can be planted as a sleeper');
    return;
  }
  addUnits(h, a, { [SLEEPER_UNIT]: 3 });
  const locationId = ground.held.location.id;
  const planted = await conservingUnits(h, a, 'planting a cell', () =>
    h.ok<CityMutationResponse>({
      as: a,
      method: 'POST',
      route: '/api/city/sleepers',
      body: { locationId, army: { [SLEEPER_UNIT]: 2 } },
    }),
  );
  const actions = await h.ok<ActionsResponse>({ as: a, method: 'GET', route: '/api/actions' });
  const cell = actions?.sleepers.find((one) => one.locationId === locationId);
  h.check(planted !== undefined && cell !== undefined, 'the cell is not on the actions board');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/sleepers',
    body: { locationId: ground.open.location.id, army: { [SLEEPER_UNIT]: 1 } },
    expect: 409,
    code: 'PLACE_UNAVAILABLE',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/sleepers',
    body: { locationId, army: { razors: 1 } },
    expect: 409,
    code: 'PLACE_UNAVAILABLE',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/sleepers',
    body: { locationId, army: { [SLEEPER_UNIT]: 99 } },
    expect: 409,
    code: 'PLACE_UNAVAILABLE',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/sleepers',
    body: { locationId: 'nowhere', army: { [SLEEPER_UNIT]: 1 } },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/city/sleepers', { locationId, army: [] });
  if (cell) {
    await conservingUnits(h, a, 'recalling a cell', () =>
      h.ok({
        as: a,
        method: 'POST',
        route: '/api/city/sleepers/recall',
        body: { cellId: cell.cellId },
      }),
    );
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/sleepers/recall',
    body: { cellId: 'no-such-cell' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/city/sleepers/recall', { cellId: 4 });
}

/** The bench hands A a whole district; A raises its gate through the API and calls the work off. */
async function capturedGate(h: Harness, a: Player, c: Player): Promise<void> {
  h.at('city: a captured gate');
  const map = await h.ok<CityResponse>({ as: a, method: 'GET', route: '/api/city' });
  const target = map?.districts.find(
    (one) => one.scouted && !one.isHome && one.district.kind === 'contested',
  );
  if (!map || !target) return;
  const districtId = target.district.id;
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/gate',
    body: { districtId },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/gate/cancel',
    body: { districtId },
    expect: 403,
    code: 'FORBIDDEN',
  });
  // The bench: every location in the district is A's, as a run of won fights would leave it.
  for (const location of target.district.locations) {
    const control = h.repos.city.control(location.id);
    if (!control) continue;
    h.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: a.baseId },
      garrison: { razors: 1 },
      upgradingUntil: null,
    });
  }
  grantResources(h, a, {
    caps: 20_000,
    scrap: 4_000,
    planks: 4_000,
    oil: 2_000,
    supplies: 2_000,
    highQualityMetal: 300,
  });
  const before = await baseOf(h, a);
  const raised = await h.ok<CityResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/gate',
    body: { districtId },
  });
  const gate = raised?.capturedGates.find((one) => one.districtId === districtId);
  h.check(gate !== undefined, 'the captured gate is not on the city read after raising it');
  const paid = await baseOf(h, a);
  h.check(paid.resources.caps <= before.resources.caps, 'raising a gate cost nothing');
  // Work already under way is not a question of money: the location route says PLACE_UNAVAILABLE.
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/gate',
    body: { districtId },
    expect: 409,
    code: 'PLACE_UNAVAILABLE',
  });
  await h.ok<CityResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/gate/cancel',
    body: { districtId },
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/city/gate/cancel',
    body: { districtId },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/city/gate',
    body: { districtId },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuseMalformed(a, '/api/city/gate', { districtId: [] });
  await h.refuseMalformed(a, '/api/city/gate/cancel', {});
  // Raised again and left to stand.
  await h.ok<CityResponse>({
    as: a,
    method: 'POST',
    route: '/api/city/gate',
    body: { districtId },
  });
  h.advance(2 * 24 * HOUR);
  const after = await h.ok<CityResponse>({ as: a, method: 'GET', route: '/api/city' });
  h.check(
    Boolean(after?.capturedGates.some((one) => one.districtId === districtId)),
    'the captured gate is gone from the city read after it finished',
  );
}
