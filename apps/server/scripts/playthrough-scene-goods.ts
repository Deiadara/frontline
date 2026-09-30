/**
 * Things a crew owns: the back room's crates, blueprints and their pages, the Scrapyard's cards
 * and traps (and taking a card back off), and the Garage.
 */
import {
  BLUEPRINTS,
  REIMAGINING_RESEARCH_ID,
  RESEARCH_ITEMS,
  type BlueprintTargetKind,
  findBlackMarketGood,
  findBlueprint,
  type BaseDetailResponse,
  type BlackMarketMutationResponse,
  type BlackMarketResponse,
  type BuildAddonResponse,
  type GarageMutationResponse,
  type GarageResponse,
  type MarketMutationResponse,
  type ModificationSlotResponse,
  type ReimagineResponse,
  type ScrapyardResponse,
  type UnitsResponse,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf, expectDelta, negate, DAY, MINUTE } from './playthrough-helpers.js';
import {
  addItems,
  addTechnologies,
  grantResources,
  setBuildings,
  setInfamy,
  setLevel,
} from './playthrough-bench.js';

/** The drawing a thing is made from, bound and in the bag: what a crew has after unlocking it. */
function grantBlueprintFor(h: Harness, crew: Player, kind: BlueprintTargetKind, id: string): void {
  const spec = BLUEPRINTS.find((one) =>
    one.targets.some((target) => target.kind === kind && target.id === id),
  );
  if (spec) addItems(h, crew, { [spec.id]: 1 });
}

export async function goods(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');
  await backRoom(h, a, b, c);
  await blueprints(h, a, c);
  await scrapyard(h, a, b);
  await garage(h, a);
}

async function backRoom(h: Harness, a: Player, b: Player, c: Player): Promise<void> {
  h.at('black market: the back room');
  setInfamy(h, a, 4_000);
  // B and C are here to be turned down for the bid and for the city, which the server only reaches
  // once the back room's own door (rank 3) is open to them.
  for (const crew of [b, c]) setInfamy(h, crew, (await baseOf(h, crew)).economy.infamy, 3);
  const shelf = await h.ok<BlackMarketResponse>({
    as: a,
    method: 'GET',
    route: '/api/black-market',
  });
  if (!shelf) return;
  await h.call({
    as: a,
    method: 'GET',
    route: '/api/black-market',
    query: { city: 'terminus' },
    expect: 403,
    code: 'CITY_SHUT',
  });
  const lot = shelf.offers.find((one) => one.affordable && one.lot !== null);
  if (!lot?.lot) {
    h.check(
      false,
      `A at notoriety ${(await baseOf(h, a)).economy.notoriety} can bid on nothing in the back room`,
    );
    return;
  }
  const bid = { slotIndex: lot.slot.index, goodId: lot.slot.goodId, amount: lot.lot.nextBid };
  const placed = await h.ok<BlackMarketMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/black-market/bid',
    body: bid,
  });
  const standing = placed?.blackMarket.offers.find((one) => one.slot.index === lot.slot.index)?.lot;
  h.check(standing?.leading?.yours === true, 'A bid in the back room and is not in front');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/black-market/bid',
    body: { ...bid, amount: bid.amount + 50 },
    expect: 409,
    code: 'BLACK_MARKET_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/black-market/bid',
    body: bid,
    expect: 409,
    code: 'BLACK_MARKET_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/black-market/bid',
    body: { ...bid, goodId: 'not_what_is_there' },
    expect: 409,
    code: 'BLACK_MARKET_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/black-market/bid',
    body: { ...bid, slotIndex: 60 },
    expect: 409,
    code: 'BLACK_MARKET_REFUSED',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/black-market/bid',
    body: { ...bid, city: 'ashfall' },
    expect: 403,
    code: 'CITY_SHUT',
  });
  await h.refuseMalformed(a, '/api/black-market/bid', {
    slotIndex: 'first',
    goodId: bid.goodId,
    amount: 1,
  });

  // The fence settles at midnight: the crate is A's and the infamy is spent.
  const before = await baseOf(h, a);
  const stashBefore = shelf.stash[lot.slot.goodId] ?? 0;
  h.advanceTo(new Date(shelf.refreshesAt).getTime() + MINUTE);
  const after = await h.ok<BlackMarketResponse>({
    as: a,
    method: 'GET',
    route: '/api/black-market',
  });
  const base = await baseOf(h, a);
  // A crate is either a boost for the stash or goods for the bag (`grants`).
  const spec = findBlackMarketGood(lot.slot.goodId);
  const held = (inventory: Record<string, number | undefined>, id: string): number =>
    inventory[id] ?? 0;
  const grants = Object.entries(spec?.grants ?? {});
  const arrived =
    grants.length > 0
      ? grants.every(
          ([id, n]) =>
            held(base.inventory as Record<string, number>, id) -
              held(before.inventory as Record<string, number>, id) ===
            n,
        )
      : (after?.stash[lot.slot.goodId] ?? 0) - stashBefore === 1;
  h.check(
    arrived,
    `A won ${lot.slot.goodId} at the close and it did not arrive (${spec?.effect ?? 'unknown good'})`,
  );
  h.check(base.economy.infamy < before.economy.infamy, 'A won a crate and paid no infamy');
  h.check(base.economy.infamy >= 0, `A's infamy is ${base.economy.infamy} after the close`);
}

async function blueprints(h: Harness, a: Player, c: Player): Promise<void> {
  h.at('blueprints: binding the pages');
  const spec = findBlueprint('bp_snipers');
  const spare = findBlueprint('bp_demolishers');
  if (!spec || !spare) {
    h.check(false, 'the blueprint catalogue has no Sniper or Demolisher blueprint to test with');
    return;
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/blueprints/unlock',
    body: { blueprintId: spec.id },
    expect: 409,
    code: 'BLUEPRINT_REFUSED',
  });
  addItems(h, a, Object.fromEntries(spec.pages.map((page) => [page.id, 1])));
  const bound = await h.ok<MarketMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/blueprints/unlock',
    body: { blueprintId: spec.id },
  });
  if (bound) {
    const inventory = bound.market.inventory as Record<string, number>;
    h.check(inventory[spec.id] === 1, 'binding the pages did not put the blueprint in the bag');
    h.check(
      spec.pages.every((page) => (inventory[page.id] ?? 0) === 0),
      'binding the pages left the pages in the bag',
    );
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/blueprints/unlock',
    body: { blueprintId: spec.id },
    expect: 409,
    code: 'BLUEPRINT_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/blueprints/unlock',
    body: { blueprintId: 'bp_nothing' },
    expect: 409,
    code: 'BLUEPRINT_REFUSED',
  });
  await h.refuseMalformed(a, '/api/blueprints/unlock', { blueprintId: 1 });

  h.at('blueprints: the Lab trades three pages for one');
  const three = spare.pages.slice(0, 3).map((page) => page.id);
  if (three.length === 3) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/blueprints/reimagine',
      body: { pages: three },
      expect: 409,
      code: 'REIMAGINING_REFUSED',
    });
    addItems(h, a, Object.fromEntries(three.map((id) => [id, 1])));
    // Holding the pages is not enough: the Lab has to have worked Reimagining out first.
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/blueprints/reimagine',
      body: { pages: three },
      expect: 409,
      code: 'REIMAGINING_REFUSED',
    });
    addTechnologies(h, a, [REIMAGINING_RESEARCH_ID]);
    const before = await baseOf(h, a);
    const traded = await h.ok<ReimagineResponse>({
      as: a,
      method: 'POST',
      route: '/api/blueprints/reimagine',
      body: { pages: three },
    });
    if (traded?.spent) {
      h.check(traded.spent.length === 3, `the Lab spent ${traded.spent.length} pages`);
      const after = await baseOf(h, a);
      const count = (inventory: Record<string, number | undefined>) =>
        Object.entries(inventory)
          .filter(([id]) => id.startsWith('pg_'))
          .reduce((sum, [, n]) => sum + (n ?? 0), 0);
      const pagesBefore = count(before.inventory);
      const pagesAfter = count(after.inventory);
      h.check(
        pagesAfter === pagesBefore - 3 + (traded.gained === null ? 0 : 1),
        `three pages in and ${traded.gained ?? 'nothing'} out took the pages from ${pagesBefore} to ${pagesAfter}`,
      );
    }
    await h.refuse({
      as: c,
      method: 'POST',
      route: '/api/blueprints/reimagine',
      body: { pages: three },
      expect: 409,
      code: 'REIMAGINING_REFUSED',
    });
  }
  await h.refuseMalformed(a, '/api/blueprints/reimagine', { pages: ['pg_one'] });
}

async function scrapyard(h: Harness, a: Player, b: Player): Promise<void> {
  h.at('scrapyard: cards and traps');
  setBuildings(h, a, { scrapyard: 6, quarters: 8, gauntlet: 5 });
  grantBlueprintFor(h, a, 'trap', 'trap_pressure_plates');
  // The trap is also a rung on the Security Officer's track.
  const plates = RESEARCH_ITEMS.find((item) => item.name === 'Pressure Plates');
  if (plates) addTechnologies(h, a, [plates.id]);
  grantResources(h, a, {
    caps: 20_000,
    scrap: 6_000,
    planks: 4_000,
    oil: 3_000,
    supplies: 3_000,
    highQualityMetal: 600,
  });
  const yard = await h.ok<ScrapyardResponse>({ as: a, method: 'GET', route: '/api/scrapyard' });
  if (!yard) return;

  const trap = yard.entries.find((one) => one.kind === 'trap' && one.blocker === null);
  if (trap) {
    const before = await baseOf(h, a);
    const built = await h.ok<BuildAddonResponse>({
      as: a,
      method: 'POST',
      route: '/api/scrapyard/build',
      body: { kind: 'trap', id: trap.id },
    });
    if (built) {
      expectDelta(
        h,
        before.resources,
        built.base.resources,
        negate(trap.cost),
        `building the ${trap.id} trap`,
      );
      h.check(
        (built.base.inventory[trap.id as keyof typeof built.base.inventory] ?? 0) ===
          (before.inventory[trap.id as keyof typeof before.inventory] ?? 0) + 1,
        'the trap is not in the bag',
      );
    }
  } else {
    h.check(
      false,
      `the Scrapyard offers no trap A can build: ${JSON.stringify(yard.entries.filter((one) => one.kind === 'trap').map((one) => [one.id, one.blocker]))}`,
    );
  }

  grantResources(h, a, {
    caps: 20_000,
    scrap: 6_000,
    planks: 4_000,
    oil: 3_000,
    supplies: 3_000,
    highQualityMetal: 600,
  });
  const restocked =
    (await h.ok<ScrapyardResponse>({ as: a, method: 'GET', route: '/api/scrapyard' })) ?? yard;
  const card = restocked.entries.find(
    (one) =>
      one.kind === 'modification' &&
      one.blocker === null &&
      one.targets.some((t) => t.blocker === null),
  );
  const into = card?.targets.find((t) => t.blocker === null);
  if (card && into) {
    const built = await h.ok<BuildAddonResponse>({
      as: a,
      method: 'POST',
      route: '/api/scrapyard/build',
      body: { kind: 'modification', id: card.id, target: into.id },
    });
    const structure = built?.base.buildings.find((one) => one.kind === into.id);
    const slot = structure?.modifications.findIndex((one) => one === card.id) ?? -1;
    h.check(slot >= 0, `the ${card.id} card was not bolted to ${into.id}`);
    if (slot >= 0) {
      const cleared = await h.ok<ModificationSlotResponse>({
        as: a,
        method: 'POST',
        route: '/api/base/modifications/clear',
        body: { building: into.id, slot },
      });
      const left = cleared?.base.buildings.find((one) => one.kind === into.id)?.modifications ?? [];
      const had = structure?.modifications ?? [];
      h.check(
        left.length === had.length - 1 &&
          left.filter((one) => one === card.id).length ===
            had.filter((one) => one === card.id).length - 1,
        `clearing the bracket left ${JSON.stringify(left)} (was ${JSON.stringify(had)})`,
      );
    }
  } else {
    h.check(
      false,
      `the Scrapyard offers no structure card A can bolt on: ${JSON.stringify(
        yard.entries
          .filter((one) => one.kind === 'modification')
          .slice(0, 8)
          .map((one) => [one.id, one.blocker]),
      )}`,
    );
  }

  // Topped up and read again: the cards above spent from the same stockpile.
  grantResources(h, a, {
    caps: 20_000,
    scrap: 6_000,
    planks: 4_000,
    oil: 3_000,
    supplies: 3_000,
    highQualityMetal: 600,
  });
  const fresh =
    (await h.ok<ScrapyardResponse>({ as: a, method: 'GET', route: '/api/scrapyard' })) ?? yard;
  const upgrade = fresh.entries.find(
    (one) =>
      one.kind === 'upgrade' && one.blocker === null && one.targets.some((t) => t.blocker === null),
  );
  const onto = upgrade?.targets.find((t) => t.blocker === null);
  if (upgrade && onto) {
    await h.ok<BuildAddonResponse>({
      as: a,
      method: 'POST',
      route: '/api/scrapyard/build',
      body: { kind: 'upgrade', id: upgrade.id, target: onto.id },
    });
    const units = await h.ok<UnitsResponse>({ as: a, method: 'GET', route: '/api/units' });
    const fitted = units?.units
      .find((one) => one.id === onto.id)
      ?.slots.find((slot) => slot.upgradeId !== null);
    h.check(fitted !== undefined, `the ${upgrade.id} card is not fitted to ${onto.id}`);
    if (fitted?.upgradeId) {
      const burnt = await h.ok<UnitsResponse>({
        as: a,
        method: 'POST',
        route: '/api/units/burn',
        body: { unitId: onto.id, upgradeId: fitted.upgradeId },
      });
      h.check(
        !burnt?.units
          .find((one) => one.id === onto.id)
          ?.slots.some((slot) => slot.upgradeId === fitted.upgradeId),
        'the burnt card is still fitted',
      );
      await h.refuse({
        as: a,
        method: 'POST',
        route: '/api/units/burn',
        body: { unitId: onto.id, upgradeId: fitted.upgradeId },
        expect: 409,
        code: 'WORKSHOP_REFUSED',
      });
    }
  } else {
    h.check(
      false,
      `the Scrapyard offers no unit card A can bolt on: ${JSON.stringify(
        yard.entries
          .filter((one) => one.kind === 'upgrade')
          .slice(0, 8)
          .map((one) => [one.id, one.blocker, one.targets.map((t) => [t.id, t.blocker])]),
      )}`,
    );
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/units/burn',
    body: { unitId: 'razors', upgradeId: 'no_such_card' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/units/burn', { unitId: 'razors', upgradeId: 4 });

  h.at('scrapyard: refusals');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/scrapyard/build',
    body: { kind: 'trap', id: 'trap_of_dreams' },
    expect: 409,
    code: 'SCRAPYARD_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/scrapyard/build',
    body: { kind: 'modification', id: card?.id ?? 'x' },
    expect: 409,
    code: 'SCRAPYARD_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/scrapyard/build',
    body: { kind: 'upgrade', id: upgrade?.id ?? 'x', target: 'no_such_unit' },
    expect: 409,
    code: 'SCRAPYARD_REFUSED',
  });
  const blocked = yard.entries.find((one) => one.blocker !== null);
  if (blocked) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/scrapyard/build',
      body: {
        kind: blocked.kind,
        id: blocked.id,
        ...(blocked.targets[0] ? { target: blocked.targets[0].id } : {}),
      },
      expect: 409,
      code: 'SCRAPYARD_REFUSED',
    });
  }
  await h.refuseMalformed(a, '/api/scrapyard/build', { kind: 'spaceship', id: 'x' });
  // A crew with no Scrapyard standing.
  const bYard = await h.ok<ScrapyardResponse>({ as: b, method: 'GET', route: '/api/scrapyard' });
  void bYard;
  const bBase = await h.ok<BaseDetailResponse>({
    as: b,
    method: 'GET',
    route: '/api/base/:id',
    params: { id: b.baseId },
  });
  void bBase;
}

async function garage(h: Harness, a: Player): Promise<void> {
  h.at('garage: a machine off the line');
  setLevel(h, a, 22);
  setBuildings(h, a, { nexus: 14, scrapyard: 7, generator: 7, garage: 4 });
  grantResources(h, a, {
    caps: 30_000,
    scrap: 8_000,
    planks: 4_000,
    oil: 8_000,
    supplies: 4_000,
    highQualityMetal: 1_500,
  });
  grantBlueprintFor(h, a, 'vehicle', 'motorcycle');
  const read = await h.ok<GarageResponse>({ as: a, method: 'GET', route: '/api/garage' });
  if (!read) return;
  const buildable = read.vehicles.find((one) => one.refusal === null);
  const blocked = read.vehicles.find((one) => one.refusal !== null);
  if (!buildable) {
    h.check(
      false,
      `A has a Garage and can build nothing: ${JSON.stringify(read.vehicles.map((one) => [one.id, one.refusal]))}`,
    );
    return;
  }
  const before = await baseOf(h, a);
  const queued = await h.ok<GarageMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/garage/build',
    body: { vehicleId: buildable.id },
  });
  if (queued) {
    expectDelta(
      h,
      before.resources,
      queued.garage.resources,
      negate(buildable.cost),
      `building a ${buildable.id}`,
    );
  }
  if (blocked) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/garage/build',
      body: { vehicleId: blocked.id },
      expect: 409,
      code: 'WORKSHOP_REFUSED',
    });
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/garage/build',
    body: { vehicleId: 'hovercraft' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/garage/build', { vehicleId: 3 });
  h.advance(buildable.buildSeconds * 1000 + MINUTE);
  const after = await h.ok<GarageResponse>({ as: a, method: 'GET', route: '/api/garage' });
  const owned = after?.vehicles.find((one) => one.id === buildable.id)?.owned ?? 0;
  h.check(
    owned === buildable.owned + 1,
    `a ${buildable.id} came off the line and the yard holds ${owned} (was ${buildable.owned})`,
  );
  void DAY;
}
