/**
 * The level gates, pushed from a crew that has not earned them.
 *
 * The client draws a locked door over the Bar (level 5), Drills (level 3), the Archive (a Head of
 * Research in the chair), the Market (level 15), District Offers (a research rung) and the Black
 * Market (notoriety 3): `AREA_REQUIREMENTS` in `progression/unlocks.ts`, read by `RequireUnlock`.
 * The server has an error code for exactly that refusal, `AREA_LOCKED` ("this crew is not senior
 * enough to be in it"). A hand-written request is not a screen, so each write here is sent by a
 * level-one crew and must be refused with it.
 */
import {
  OVERSEER_SUBJECT,
  type BarResponse,
  type BlackMarketResponse,
  type MarketResponse,
  type ResearchResponse,
} from '@frontline/shared';
import type { Harness } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf } from './playthrough-helpers.js';

export async function levelGates(h: Harness, cast: Cast): Promise<void> {
  const e = player(cast, 'E');
  const base = await baseOf(h, e);
  h.check(base.level < 3 && base.economy.notoriety < 3, 'E is meant to be a brand new crew here');

  h.at('level gates: the Bar at level 1');
  const bar = await h.ok<BarResponse>({ as: e, method: 'GET', route: '/api/bar' });
  // A table this crew could otherwise take: nobody blocking, and a bid inside its payroll. Any other
  // refusal would be about the bid rather than the door.
  const table = bar?.recruits.findIndex(
    (recruit, index) =>
      recruit.assessment.blockers.length === 0 &&
      (bar.auctions[index]?.nextBid ?? Number.POSITIVE_INFINITY) <= bar.bidCeiling,
  );
  const recruit = table === undefined || table < 0 ? undefined : bar?.recruits[table];
  const auction = table === undefined || table < 0 ? undefined : bar?.auctions[table];
  if (recruit && auction) {
    await h.refuse({
      as: e,
      method: 'POST',
      route: '/api/bar/bid',
      body: { recruitId: recruit.id, amount: auction.nextBid },
      expect: 403,
      code: 'AREA_LOCKED',
    });
  }

  h.at('level gates: Drills at level 1');
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/training',
    body: { subjectId: OVERSEER_SUBJECT, attribute: 'strength' },
    expect: 403,
    code: 'AREA_LOCKED',
  });

  h.at('level gates: the Archive with nobody in the Head of Research chair');
  // Every rung wants a mark from the officer in its track's chair, so a crew with nobody on the
  // books has nothing it can start: the door is held by the rungs themselves. Probed only if the
  // screen offers a rung with no blocker.
  const archive = await h.ok<ResearchResponse>({ as: e, method: 'GET', route: '/api/research' });
  const open = archive?.technologies.find((tech) => !tech.known && tech.blocker === null);
  if (open) {
    await h.refuse({
      as: e,
      method: 'POST',
      route: '/api/research/tech',
      body: { techId: open.id },
      expect: 403,
      code: 'AREA_LOCKED',
    });
  }

  h.at('level gates: the Market at level 1');
  await h.ok<MarketResponse>({ as: e, method: 'GET', route: '/api/market' });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/market/supply',
    body: { key: 'scrap', units: 1 },
    expect: 403,
    code: 'AREA_LOCKED',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/market/offer',
    body: {
      give: { resources: { caps: 10 }, items: {} },
      want: { resources: { scrap: 10 }, items: {} },
    },
    expect: 403,
    code: 'AREA_LOCKED',
  });

  h.at('level gates: the Black Market at notoriety 0');
  const shelf = await h.ok<BlackMarketResponse>({
    as: e,
    method: 'GET',
    route: '/api/black-market',
  });
  const lot = shelf?.offers[0];
  if (lot) {
    await h.refuse({
      as: e,
      method: 'POST',
      route: '/api/black-market/bid',
      body: { slotIndex: lot.slot.index, goodId: lot.slot.goodId, amount: 1 },
      // The back room holds its own door: a name too small is refused with its own code.
      expect: 409,
      code: 'BLACK_MARKET_REFUSED',
    });
  }
}
