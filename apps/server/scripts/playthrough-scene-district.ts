/**
 * The district: the build queue, the Generator's burn, the name on the plaque, and the bench.
 */
import {
  UNCLAIMED_DISTRICT_NAME,
  findUnit,
  trainingCost,
  buildBoostOilCost,
  cancelRefund,
  type BaseDetailResponse,
  type BuildBoostResponse,
  type BuildStructureResponse,
  type MeResponse,
  type PartialResources,
  type RenameDistrictResponse,
  type TrainUnitsResponse,
  type UnitsResponse,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf, expectDelta, me, negate, HOUR } from './playthrough-helpers.js';
import { grantResources } from './playthrough-bench.js';

export async function district(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');
  const d = player(cast, 'D');

  h.at('district: reading your own and nobody else');
  await h.ok<BaseDetailResponse>({
    as: a,
    method: 'GET',
    route: '/api/base/:id',
    params: { id: a.baseId },
  });
  await h.call({
    as: a,
    method: 'GET',
    route: '/api/base/:id',
    params: { id: b.baseId },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.call({
    as: a,
    method: 'GET',
    route: '/api/base/:id',
    params: { id: 'no-such-base' },
    expect: 404,
    code: 'NOT_FOUND',
  });

  for (const crew of [a, b, c, d]) await openingBuilds(h, crew, b);

  h.at('district: build refusals');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/base/build',
    body: { kind: 'garage' },
    expect: 409,
    code: 'STRUCTURE_LOCKED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/base/build',
    body: { kind: 'castle' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/base/build', { kind: 12 });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/base/cancel',
    body: { orderId: 'no-such-order' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/base/cancel', { orderId: 5 });
  // Somebody else's order is not yours to call off.
  const bsQueue = (await baseOf(h, b)).buildQueue;
  const bsOrder = bsQueue[0];
  if (bsOrder) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/base/cancel',
      body: { orderId: bsOrder.id },
      expect: 404,
      code: 'NOT_FOUND',
    });
  }
  await fillTheQueue(h, d);

  h.at('district: the Generator burn');
  await h.refuseMalformed(a, '/api/base/boost', []);
  const before = await baseOf(h, a);
  const oil = buildBoostOilCost(before.buildings);
  if (before.resources.oil < oil) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/base/boost',
      body: {},
      expect: 409,
      code: 'BOOST_REFUSED',
    });
    grantResources(h, a, { oil: oil - before.resources.oil + 50 });
  }
  const fuelled = await baseOf(h, a);
  const burnt = await h.ok<BuildBoostResponse>({
    as: a,
    method: 'POST',
    route: '/api/base/boost',
    body: {},
  });
  if (burnt?.base) {
    h.check(
      burnt.paid.oil === oil,
      `the burn charged ${JSON.stringify(burnt.paid)}, the price is ${oil} oil`,
    );
    expectDelta(h, fuelled.resources, burnt.base.resources, { oil: -oil }, 'the burn');
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/base/boost',
    body: {},
    expect: 409,
    code: 'BOOST_REFUSED',
  });

  h.at('district: the name on the plaque');
  const renamed = await h.ok<RenameDistrictResponse>({
    as: a,
    method: 'POST',
    route: '/api/base/district-name',
    body: { name: 'Alba Yard' },
  });
  h.check(renamed?.base.name === 'Alba Yard', 'the rename did not stick');
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/base/district-name',
    body: { name: 'Alba Yard' },
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/base/district-name',
    body: { name: 'alba  yard' },
    expect: 409,
    code: 'DISTRICT_NAME_TAKEN',
  });
  // The map draws empty plots as "Player District I", "II"...; a crew may not wear one of those.
  const reserved = `${UNCLAIMED_DISTRICT_NAME} II`;
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/base/district-name',
    body: { name: reserved },
    expect: 409,
    code: 'DISTRICT_NAME_TAKEN',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/base/district-name',
    body: { name: 'x' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(b, '/api/base/district-name', { name: ['Brask'] });
  await h.ok({
    as: b,
    method: 'POST',
    route: '/api/base/district-name',
    body: { name: 'Brask Hollow' },
  });

  h.at('district: an empty bracket');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/base/modifications/clear',
    body: { building: 'nexus', slot: 0 },
    expect: 409,
    code: 'SLOT_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/base/modifications/clear',
    body: { building: 'garage', slot: 0 },
    expect: 409,
    code: 'SLOT_REFUSED',
  });
  await h.refuseMalformed(a, '/api/base/modifications/clear', { building: 'nexus', slot: 99 });

  for (const crew of [a, b, c, d]) await openingUnits(h, crew);

  h.at('district: the queue lands');
  const queued = await baseOf(h, a);
  const levelsBefore = new Map(queued.buildings.map((one) => [one.kind, one.level]));
  const orders = queued.buildQueue.map((order) => ({ kind: order.kind, level: order.level }));
  h.advance(12 * HOUR);
  const landed = await baseOf(h, a);
  h.check(
    landed.buildQueue.length === 0,
    `A's queue still holds ${landed.buildQueue.length} orders after twelve hours`,
  );
  for (const order of orders) {
    const level = landed.buildings.find((one) => one.kind === order.kind)?.level ?? 0;
    h.check(
      level >= order.level,
      `A ordered ${order.kind} level ${order.level} (was ${levelsBefore.get(order.kind) ?? 0}) and it stands at ${level}`,
    );
  }
}

/** Two structures on the queue, one of them called straight back off for ninety percent. */
async function openingBuilds(h: Harness, crew: Player, other: Player): Promise<void> {
  h.at(`district: ${crew.label} lays the first structures`);
  const read = await me(h, crew);
  if (!read?.base) return;
  await buildAtQuote(h, crew, read, 'quarters');
  const second = await me(h, crew);
  if (!second?.base) return;
  const gate = await buildAtQuote(h, crew, second, 'gate');
  const order = gate?.base.buildQueue.find((one) => one.kind === 'gate');
  if (!gate || !order) return;
  const cancelled = await h.ok<BuildStructureResponse>({
    as: crew,
    method: 'POST',
    route: '/api/base/cancel',
    body: { orderId: order.id },
  });
  if (cancelled?.base) {
    expectDelta(
      h,
      gate.base.resources,
      cancelled.base.resources,
      cancelRefund(order.paid),
      `${crew.label} cancelling the gate`,
    );
    h.check(
      !cancelled.base.buildQueue.some((one) => one.id === order.id),
      'the cancelled order is still queued',
    );
  }
  // The same order twice is gone the second time.
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/base/cancel',
    body: { orderId: order.id },
    expect: 404,
    code: 'NOT_FOUND',
  });
  void other;
}

/** Orders a structure and checks it cost exactly what `/me` quoted for it. */
async function buildAtQuote(
  h: Harness,
  crew: Player,
  read: MeResponse,
  kind: 'quarters' | 'gate' | 'apothecary',
): Promise<BuildStructureResponse | undefined> {
  if (!read.base) return undefined;
  const quote: PartialResources | undefined = read.buildQuotes?.[kind];
  h.check(quote !== undefined, `/me carries no quote for ${kind}`);
  const built = await h.ok<BuildStructureResponse>({
    as: crew,
    method: 'POST',
    route: '/api/base/build',
    body: { kind },
  });
  if (!built?.base) return undefined;
  if (quote)
    expectDelta(
      h,
      read.base.resources,
      built.base.resources,
      negate(quote),
      `${crew.label} building ${kind}`,
    );
  const order = built.base.buildQueue.find((one) => one.kind === kind);
  h.check(order !== undefined, `${kind} is not on the queue after ordering it`);
  const clock = read.buildClocks?.[kind];
  if (order && clock !== undefined) {
    h.check(
      order.durationSeconds === clock,
      `/me quoted ${kind} at ${clock}s and the order runs ${order.durationSeconds}s`,
    );
  }
  if (order && quote) {
    h.check(
      JSON.stringify(order.paid) === JSON.stringify(quote),
      `the ${kind} order records ${JSON.stringify(order.paid)} paid against a quote of ${JSON.stringify(quote)}`,
    );
  }
  return built;
}

/** D fills its queue and is refused the next order; a broke crew is refused on price. */
async function fillTheQueue(h: Harness, d: Player): Promise<void> {
  h.at('district: a full queue and an empty purse');
  grantResources(h, d, { caps: 3000, scrap: 3000, planks: 3000, supplies: 1500, oil: 1500 });
  const kinds = ['apothecary', 'gate', 'quarters', 'generator', 'nexus'] as const;
  let refusedFull = false;
  for (const kind of kinds) {
    const read = await baseOf(h, d);
    if (read.buildQueue.length >= 4) {
      await h.refuse({
        as: d,
        method: 'POST',
        route: '/api/base/build',
        body: { kind },
        expect: 409,
        code: 'BUILD_QUEUE_FULL',
      });
      refusedFull = true;
      break;
    }
    await h.ok({ as: d, method: 'POST', route: '/api/base/build', body: { kind } });
  }
  h.check(refusedFull, 'D never filled its build queue');
  // Empty the purse: nothing is affordable, so the next order is refused on price. The grant stood
  // D at its ceilings, so the refunds land on full stores: agreed to up front, because the waste
  // warning is not what this step is about (maintainer ruling, 2026-09-28).
  const broke = await baseOf(h, d);
  const orders = [...broke.buildQueue].reverse();
  for (const order of orders) {
    await h.ok({
      as: d,
      method: 'POST',
      route: '/api/base/cancel',
      body: { orderId: order.id, acceptWaste: true },
    });
  }
  const emptied = await baseOf(h, d);
  h.repos.bases.updateResources(d.baseId, { ...emptied.resources, caps: 0, scrap: 0, planks: 0 });
  await h.refuse({
    as: d,
    method: 'POST',
    route: '/api/base/build',
    body: { kind: 'quarters' },
    expect: 409,
    code: 'INSUFFICIENT_RESOURCES',
  });
  grantResources(h, d, { caps: 600, scrap: 500, planks: 420 });
}

/** The first units off the bench, and one batch called back. */
async function openingUnits(h: Harness, crew: Player): Promise<void> {
  h.at(`district: ${crew.label} trains the first units`);
  const roster = await h.ok<UnitsResponse>({ as: crew, method: 'GET', route: '/api/units' });
  if (!roster?.units) return;
  const open = roster.units.find((unit) => unit.unlocked && unit.owned >= 0);
  const locked = roster.units.find((unit) => !unit.unlocked && !unit.unique);
  if (!open) {
    h.check(false, `${crew.label} has no unit it can train`);
    return;
  }
  const before = await baseOf(h, crew);
  const trained = await h.ok<TrainUnitsResponse>({
    as: crew,
    method: 'POST',
    route: '/api/units/train',
    body: { unitId: open.id, count: 2 },
  });
  if (!trained?.base) return;
  const order = trained.queue.find((one) => one.unitId === open.id);
  h.check(order?.count === 2, `the order for two ${open.id} is not on the bench`);
  // The price the route charges: the catalogue's, less the crew-wide cut and this unit's own ground.
  const spec = findUnit(open.id);
  const twice: PartialResources = spec
    ? trainingCost(
        spec,
        2,
        roster.trainingCostReduction + (open.homeCostReduction ?? 0),
        roster.trainingSuppliesReduction ?? 0,
      )
    : {};
  expectDelta(
    h,
    before.resources,
    trained.base.resources,
    negate(twice),
    `${crew.label} training two ${open.id}`,
  );

  // A second batch, called straight off for ninety percent.
  const second = await h.ok<TrainUnitsResponse>({
    as: crew,
    method: 'POST',
    route: '/api/units/train',
    body: { unitId: open.id, count: 1 },
  });
  const extra = second?.queue.find((one) => one.id !== order?.id);
  if (second?.base && extra) {
    const cancelled = await h.ok<TrainUnitsResponse>({
      as: crew,
      method: 'POST',
      route: '/api/units/cancel',
      body: { orderId: extra.id },
    });
    if (cancelled?.base) {
      expectDelta(
        h,
        second.base.resources,
        cancelled.base.resources,
        cancelRefund(extra.paid),
        `${crew.label} cancelling a batch`,
      );
    }
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/units/cancel',
      body: { orderId: extra.id },
      expect: 404,
      code: 'NOT_FOUND',
    });
  }

  h.at(`district: ${crew.label} training refusals`);
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/units/train',
    body: { unitId: 'no_such_unit', count: 1 },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/units/train',
    body: { unitId: 'directive_xero', count: 1 },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/units/train',
    body: { unitId: open.id, count: 0 },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/units/train',
    body: { unitId: open.id, count: 51 },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(crew, '/api/units/train', { unitId: open.id, count: '2' });
  await h.refuseMalformed(crew, '/api/units/cancel', { orderId: null });
  if (locked) {
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/units/train',
      body: { unitId: locked.id, count: 1 },
      expect: 409,
      code: 'UNIT_LOCKED',
    });
  }
  const units = await h.ok<UnitsResponse>({ as: crew, method: 'GET', route: '/api/units' });
  h.check(
    (units?.army[open.id] ?? 0) === (before.army[open.id] ?? 0),
    `${open.id} joined the army before its training finished`,
  );
  // The units land once their clock has run.
  const seconds = order?.durationSeconds ?? 0;
  if (seconds > 0 && seconds < 6 * 3600) {
    h.advance(seconds * 1000 + 1000);
    const home = await baseOf(h, crew);
    h.check(
      (home.army[open.id] ?? 0) === (before.army[open.id] ?? 0) + 2,
      `${crew.label}: two ${open.id} trained, the army went from ${before.army[open.id] ?? 0} to ${home.army[open.id] ?? 0}`,
    );
  }
  void HOUR;
}
