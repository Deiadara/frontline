/**
 * The market: the supply run, the Broker's barter, the Runner's barrow (bid, outbid, won), and
 * offers between players, with the caps on both sides counted before and after every trade.
 */
import {
  BARTER_MINIMUM,
  barterQuote,
  supplyPrice,
  type MarketMutationResponse,
  type MarketResponse,
  type NotificationsResponse,
  type Resources,
  TECH_DISTRICT_OFFERS,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf, expectDelta, HOUR, MINUTE } from './playthrough-helpers.js';
import { grantResources, addTechnologies } from './playthrough-bench.js';
import { storeCeilingsOf } from '../src/district/stores.js';

async function market(h: Harness, crew: Player): Promise<MarketResponse | undefined> {
  return h.ok<MarketResponse>({ as: crew, method: 'GET', route: '/api/market' });
}

function total(one: Resources, two: Resources): Resources {
  return {
    caps: one.caps + two.caps,
    supplies: one.supplies + two.supplies,
    oil: one.oil + two.oil,
    scrap: one.scrap + two.scrap,
    planks: one.planks + two.planks,
    highQualityMetal: one.highQualityMetal + two.highQualityMetal,
  };
}

export async function marketScene(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');
  const d = player(cast, 'D');
  for (const crew of [a, b, c, d]) grantResources(h, crew, { caps: 8_000 });
  // The offers board opens on the Trader's first programme, and the server holds that door.
  for (const crew of [a, b, c, d]) addTechnologies(h, crew, [TECH_DISTRICT_OFFERS]);
  await supplyAndBarter(h, a);
  await offers(h, a, b, c, d);
  await barrow(h, a, b, c);
}

async function supplyAndBarter(h: Harness, a: Player): Promise<void> {
  h.at('market: the supply run');
  const read = await market(h, a);
  if (!read) return;
  await h.call({
    as: a,
    method: 'GET',
    route: '/api/market',
    query: { city: 'terminus' },
    expect: 403,
    code: 'CITY_SHUT',
  });
  const line = read.supply.lines.find((one) => one.most >= 10);
  if (line) {
    const before = await baseOf(h, a);
    const bought = await h.ok<MarketMutationResponse>({
      as: a,
      method: 'POST',
      route: '/api/market/supply',
      body: { key: line.key, units: 10 },
    });
    if (bought) {
      expectDelta(
        h,
        before.resources,
        bought.market.resources,
        { caps: -supplyPrice(line.key, 10), [line.key]: 10 },
        'a supply run of ten',
      );
      h.check(
        bought.market.supply.used === read.supply.used + 10,
        `the ration went from ${read.supply.used} to ${bought.market.supply.used} used`,
      );
    }
    const left = (bought?.market.supply.allowance ?? 0) - (bought?.market.supply.used ?? 0);
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/market/supply',
      body: { key: line.key, units: left + 1 },
      expect: 409,
      code: 'MARKET_REFUSED',
    });
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/supply',
    body: { key: 'caps', units: 1 },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/market/supply', { key: 'scrap', units: 0 });

  h.at("market: the Broker's barter");
  // Something to give that the crew holds plenty of, for something it has room for: the bench
  // filled every store to the ceiling, so the planks are spent down first.
  const stocked = await baseOf(h, a);
  h.repos.bases.updateResources(a.baseId, { ...stocked.resources, planks: 0 });
  const board = await market(h, a);
  const amount = BARTER_MINIMUM * 10;
  const room = (key: string): number => {
    const line = board?.supply.lines.find((one) => one.key === key);
    return line ? line.capacity - (board?.resources[line.key] ?? 0) : 0;
  };
  const want = (['planks', 'oil', 'supplies', 'scrap'] as const).find(
    (key) => room(key) > amount * 4,
  );
  const give = (['scrap', 'supplies', 'oil', 'planks'] as const).find(
    (key) => key !== want && (board?.resources[key] ?? 0) >= amount,
  );
  if (!want || !give) {
    h.check(
      false,
      `A has nothing to barter with room for the answer: ${JSON.stringify(board?.resources)}`,
    );
    return;
  }
  const before = await baseOf(h, a);
  const traded = await h.ok<MarketMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/market/barter',
    body: { give, want, amount },
  });
  if (traded) {
    const gained = barterQuote(give, want, amount, traded.market.barterRate);
    expectDelta(
      h,
      before.resources,
      traded.market.resources,
      { [give]: -amount, [want]: gained },
      'a barter',
    );
  }
  // Nowhere to put what the Broker hands over.
  const full = (['planks', 'oil', 'supplies', 'scrap'] as const).find(
    (key) => key !== give && room(key) < amount,
  );
  if (full) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/market/barter',
      body: { give, want: full, amount: amount * 20 },
      expect: 409,
      code: 'MARKET_REFUSED',
    });
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/barter',
    body: { give, want: give, amount },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/barter',
    body: { give, want, amount: BARTER_MINIMUM - 1 },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/barter',
    body: { give, want, amount: 9_999_999 },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuseMalformed(a, '/api/market/barter', { give: 'scrap', want: 'gold', amount });
}

async function offers(h: Harness, a: Player, b: Player, c: Player, d: Player): Promise<void> {
  const listing = {
    give: { resources: { caps: 500 }, items: {} },
    want: { resources: { scrap: 200 }, items: {} },
  };
  // Room for it, so what changes hands below is conserved to the unit.
  const roomy = await baseOf(h, a);
  h.repos.bases.updateResources(a.baseId, { ...roomy.resources, scrap: 0 });

  h.at('market: an offer taken');
  const aBefore = await baseOf(h, a);
  const bBefore = await baseOf(h, b);
  const posted = await h.ok<MarketMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/market/offer',
    body: listing,
  });
  const offer = posted?.market.mine.find(
    (one) => one.status === 'open' && one.give.resources.caps === 500,
  );
  if (!posted || !offer) return;
  expectDelta(
    h,
    aBefore.resources,
    posted.market.resources,
    { caps: -500 },
    'posting an offer escrows what it gives',
  );
  const seen = await market(h, b);
  h.check(
    Boolean(seen?.offers.some((one) => one.id === offer.id)),
    "A's listing is not on B's board",
  );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/accept',
    body: { offerId: offer.id },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/market/withdraw',
    body: { offerId: offer.id },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  // A crew that cannot cover the want cannot take it.
  const dHeld = await baseOf(h, d);
  h.repos.bases.updateResources(d.baseId, { ...dHeld.resources, scrap: 0 });
  await h.refuse({
    as: d,
    method: 'POST',
    route: '/api/market/accept',
    body: { offerId: offer.id },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  h.repos.bases.updateResources(d.baseId, dHeld.resources);
  const taken = await h.ok<MarketMutationResponse>({
    as: b,
    method: 'POST',
    route: '/api/market/accept',
    body: { offerId: offer.id },
  });
  if (taken) {
    // The seller's side waits on the board for their Claim (maintainer, 2026-09-28).
    const aAfter = await baseOf(h, a);
    const bAfter = await baseOf(h, b);
    expectDelta(h, bBefore.resources, bAfter.resources, { caps: 500, scrap: -200 }, 'the buyer');
    expectDelta(
      h,
      aBefore.resources,
      aAfter.resources,
      { caps: -500 },
      'the seller, before claiming',
    );
    const held = (await market(h, a))?.claims.find((one) => one.offer.id === offer.id);
    h.check(held?.reason === 'taken', "the taken listing is not waiting on the seller's board");
    if (held) {
      await h.refuse({
        as: b,
        method: 'POST',
        route: '/api/market/claim',
        body: { claimId: held.id },
        expect: 409,
        code: 'MARKET_REFUSED',
      });

      h.at('market: a claim onto a full store');
      const scrapCeiling = storeCeilingsOf(h.repos, aAfter, h.now()).scrap;
      h.repos.bases.updateResources(a.baseId, { ...aAfter.resources, scrap: scrapCeiling });
      await h.refuse({
        as: a,
        method: 'POST',
        route: '/api/market/claim',
        body: { claimId: held.id },
        expect: 409,
        code: 'WOULD_WASTE',
      });
      h.repos.bases.updateResources(a.baseId, aAfter.resources);
      await h.ok<MarketMutationResponse>({
        as: a,
        method: 'POST',
        route: '/api/market/claim',
        body: { claimId: held.id },
      });
      const aClaimed = await baseOf(h, a);
      expectDelta(
        h,
        total(aBefore.resources, bBefore.resources),
        total(aClaimed.resources, bAfter.resources),
        {},
        'a trade between two players, claimed (caps and goods conserved)',
      );
      expectDelta(
        h,
        aBefore.resources,
        aClaimed.resources,
        { caps: -500, scrap: 200 },
        'the seller of an offer (escrow out, want in)',
      );
      await h.refuse({
        as: a,
        method: 'POST',
        route: '/api/market/claim',
        body: { claimId: held.id },
        expect: 409,
        code: 'MARKET_REFUSED',
      });
    }
  }
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/market/accept',
    body: { offerId: offer.id },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/withdraw',
    body: { offerId: offer.id },
    expect: 409,
    code: 'MARKET_REFUSED',
  });

  h.at('market: an offer withdrawn');
  const aStanding = await baseOf(h, a);
  // Asking for oil onto a full oil shelf is no question at the post any more: the claim asks.
  const second = await h.ok<MarketMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/market/offer',
    body: {
      give: { resources: { scrap: 100 }, items: {} },
      want: { resources: { oil: 80 }, items: {} },
    },
  });
  const withdrawn = second?.market.mine.find(
    (one) => one.status === 'open' && one.give.resources.scrap === 100,
  );
  if (withdrawn) {
    const back = await h.ok<MarketMutationResponse>({
      as: a,
      method: 'POST',
      route: '/api/market/withdraw',
      body: { offerId: withdrawn.id },
    });
    if (back)
      expectDelta(
        h,
        aStanding.resources,
        back.market.resources,
        {},
        'posting and withdrawing an offer',
      );
  }

  h.at('market: a counter');
  // Room on B's oil shelf for what the counter asks, so it is a trade rather than a waste warning
  // and the oil below is conserved to the unit.
  const bHeld = await baseOf(h, b);
  h.repos.bases.updateResources(b.baseId, { ...bHeld.resources, oil: 0 });
  // Counted from before A lists to after the listing is withdrawn: both escrows included.
  const aOpening = await baseOf(h, a);
  const bOpening = await baseOf(h, b);
  const third = await h.ok<MarketMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/market/offer',
    body: {
      give: { resources: { oil: 100 }, items: {} },
      want: { resources: { caps: 400 }, items: {} },
    },
  });
  const parent = third?.market.mine.find(
    (one) => one.status === 'open' && one.give.resources.oil === 100,
  );
  if (parent) {
    const countered = await h.ok<MarketMutationResponse>({
      as: b,
      method: 'POST',
      route: '/api/market/offer',
      body: {
        give: { resources: { caps: 300 }, items: {} },
        want: { resources: { oil: 100 }, items: {} },
        counterTo: parent.id,
      },
    });
    const counter = countered?.market.mine.find((one) => one.counterTo === parent.id);
    h.check(
      counter?.directedAt === a.baseId,
      `the counter is directed at ${counter?.directedAt}, not at A`,
    );
    if (counter) {
      const cBoard = await market(h, c);
      h.check(
        !cBoard?.offers.some((one) => one.id === counter.id),
        "a counter meant for A is on C's board",
      );
      await h.refuse({
        as: c,
        method: 'POST',
        route: '/api/market/accept',
        body: { offerId: counter.id },
        expect: 409,
        code: 'MARKET_REFUSED',
      });
      await h.ok({
        as: a,
        method: 'POST',
        route: '/api/market/accept',
        body: { offerId: counter.id },
      });
      // B posted the counter, so B's side of it waits on B's board until B claims it.
      const bClaim = (await market(h, b))?.claims.find((one) => one.offer.id === counter.id);
      h.check(bClaim?.reason === 'taken', 'the taken counter is not waiting on its poster');
      if (bClaim) {
        await h.ok({
          as: b,
          method: 'POST',
          route: '/api/market/claim',
          body: { claimId: bClaim.id },
        });
      }
    }
    await h.refuse({
      as: b,
      method: 'POST',
      route: '/api/market/offer',
      body: { ...listing, counterTo: 'no-such-offer' },
      expect: 409,
      code: 'MARKET_REFUSED',
    });
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/market/offer',
      body: { ...listing, counterTo: parent.id },
      expect: 409,
      code: 'MARKET_REFUSED',
    });
    await h.ok({
      as: a,
      method: 'POST',
      route: '/api/market/withdraw',
      body: { offerId: parent.id },
    });
    const aClosing = await baseOf(h, a);
    const bClosing = await baseOf(h, b);
    expectDelta(
      h,
      total(aOpening.resources, bOpening.resources),
      total(aClosing.resources, bClosing.resources),
      {},
      'a listing, a counter taken and the listing withdrawn (caps and goods conserved)',
    );
  }

  h.at('market: offers that cannot be posted');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/offer',
    body: { give: { resources: {}, items: {} }, want: listing.want },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/offer',
    body: { give: listing.give, want: { resources: {}, items: {} } },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/offer',
    body: { give: { resources: { caps: 99_999_999 }, items: {} }, want: listing.want },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/offer',
    body: { give: { resources: { caps: -5 }, items: {} }, want: listing.want },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/accept',
    body: { offerId: 'no-such-offer' },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuseMalformed(a, '/api/market/offer', { give: 'caps', want: 'scrap' });
  await h.refuseMalformed(a, '/api/market/accept', { offerId: 12 });
  await h.refuseMalformed(a, '/api/market/withdraw', {});
}

/** The Runner's barrow: two crews on one lot, the higher one wins it at the close. */
async function barrow(h: Harness, a: Player, b: Player, c: Player): Promise<void> {
  h.at("market: the Runner's barrow");
  let read = await market(h, a);
  if (!read) return;
  if (!read.vendor.open) {
    h.advanceTo(new Date(read.vendor.opensAt).getTime() + MINUTE);
    read = await market(h, a);
  }
  if (!read?.vendor.open) {
    h.check(false, `the Runner did not open at ${read?.vendor.opensAt}`);
    return;
  }
  const lot = read.vendor.stock.find((one) => one.line.stock > 0 && one.auction !== null);
  if (!lot?.auction) {
    h.check(false, 'the Runner came with nothing to bid on');
    return;
  }
  const lineId = lot.line.id;
  const aBid = await h.ok<MarketMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/market/bid',
    body: { lineId, amount: lot.auction.nextBid },
  });
  const after = aBid?.market.vendor.stock.find((one) => one.line.id === lineId)?.auction;
  h.check(after?.leading?.yours === true, 'A bid on a lot and is not leading it');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/bid',
    body: { lineId, amount: (after?.nextBid ?? 0) + 5 },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/market/bid',
    body: { lineId, amount: lot.auction.nextBid },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  const topped = await h.ok<MarketMutationResponse>({
    as: b,
    method: 'POST',
    route: '/api/market/bid',
    body: { lineId, amount: (after?.nextBid ?? 1) + 10 },
  });
  const top = topped?.market.vendor.stock.find((one) => one.line.id === lineId)?.auction;
  h.check(top?.leading?.yours === true, 'B outbid A and is not leading');
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/market/bid',
    body: { lineId: 'no-such-line', amount: 50 },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/market/bid',
    body: { lineId, amount: 5_000 },
    expect: 403,
    code: 'CITY_SHUT',
  });
  // A bid bigger than the purse.
  const poor = await baseOf(h, a);
  h.repos.bases.updateResources(a.baseId, { ...poor.resources, caps: 1 });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/bid',
    body: { lineId, amount: (top?.nextBid ?? 1) + 1 },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  h.repos.bases.updateResources(a.baseId, poor.resources);
  await h.refuseMalformed(b, '/api/market/bid', { lineId, amount: 'lots' });

  const bBefore = await baseOf(h, b);
  const closes = new Date(read.vendor.closesAt ?? lot.auction.closesAt).getTime();
  h.advanceTo(closes + MINUTE);
  const bRead = await market(h, b);
  const bAfter = await baseOf(h, b);
  const result = bRead?.vendor.results.find((one) => one.lineId === lineId);
  h.check(
    result?.outcome === 'won',
    `B led the lot at the close and the result reads ${JSON.stringify(result)}`,
  );
  h.check(
    (bAfter.inventory[lot.line.item as keyof typeof bAfter.inventory] ?? 0) >
      (bBefore.inventory[lot.line.item as keyof typeof bBefore.inventory] ?? 0),
    `B won ${lot.line.item} and it is not in the bag`,
  );
  h.check(bAfter.resources.caps < bBefore.resources.caps, 'B won a lot and paid nothing');
  const aBell = await h.ok<NotificationsResponse>({
    as: a,
    method: 'GET',
    route: '/api/notifications',
  });
  h.check(
    Boolean(aBell?.notifications.some((one) => one.kind === 'market_outbid')),
    'A lost the lot and was not told',
  );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/market/bid',
    body: { lineId, amount: 5_000 },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
  h.advance(HOUR);
}
