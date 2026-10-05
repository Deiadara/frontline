/**
 * Two weeks on (the bench), then the Bar: two crews at one table, the sealed half hour, the close
 * at midnight, a winner and a loser, widening the payroll book and letting somebody go.
 */
import {
  PAYROLL_STEP,
  PAYROLL_STEP_RESOURCE,
  type BarAuction,
  type BarRecruit,
  type BarResponse,
  type BidResponse,
  type IncreasePayrollResponse,
  type NotificationsResponse,
  type ReleaseOfficerResponse,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf, expectDelta } from './playthrough-helpers.js';
import {
  addUnits,
  grantResources,
  setBuildings,
  setInfamy,
  setLevel,
} from './playthrough-bench.js';

/** The four crews are moved to where two weeks of play would have them. */
export async function twoWeeksOn(h: Harness, cast: Cast): Promise<void> {
  for (const label of ['A', 'B', 'C', 'D'] as const) {
    const crew = player(cast, label);
    h.at(`bench: ${label} two weeks on`);
    setLevel(h, crew, 16);
    setBuildings(h, crew, {
      nexus: 6,
      generator: 3,
      quarters: 5,
      apothecary: 4,
      gate: 2,
      greenhouse: 1,
      scrapyard: 2,
      lab: 1,
      gauntlet: 1,
    });
    grantResources(h, crew, {
      caps: 20_000,
      supplies: 4_000,
      oil: 4_000,
      scrap: 4_000,
      planks: 4_000,
      highQualityMetal: 400,
    });
    addUnits(h, crew, { razors: 30, scavengers: 10 });
    setInfamy(h, crew, 600);
    await baseOf(h, crew);
  }
}

interface Table {
  recruit: BarRecruit;
  auction: BarAuction;
}

/** The tables both readers could sit at: nobody blocked, and the opening bid inside both payrolls. */
function sharedTables(x: BarResponse, y: BarResponse): Table[] {
  return x.recruits.flatMap((recruit, index) => {
    const auction = x.auctions[index];
    const theirs = y.recruits.find((one) => one.id === recruit.id);
    if (!auction || !theirs) return [];
    if (recruit.assessment.blockers.length > 0 || theirs.assessment.blockers.length > 0) return [];
    if (auction.leading !== null) return [];
    if (auction.nextBid * 1.3 > Math.min(x.bidCeiling, y.bidCeiling)) return [];
    return [{ recruit, auction }];
  });
}

async function bar(h: Harness, crew: Player): Promise<BarResponse | undefined> {
  return h.ok<BarResponse>({ as: crew, method: 'GET', route: '/api/bar' });
}

async function bid(
  h: Harness,
  crew: Player,
  recruitId: string,
  amount: number,
): Promise<BidResponse | undefined> {
  return h.ok<BidResponse>({
    as: crew,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId, amount },
  });
}

export async function barScene(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');
  const d = player(cast, 'D');

  h.at('bar: the room');
  const aRoom = await bar(h, a);
  const bRoom = await bar(h, b);
  if (!aRoom || !bRoom) return;
  h.check(aRoom.day === bRoom.day, 'two crews in one city see different days at the Bar');
  // One room for everybody in the city: the same eight people in the same chairs.
  const aIds = aRoom.recruits.map((one) => one.id);
  const bIds = bRoom.recruits.map((one) => one.id);
  h.check(
    JSON.stringify(aIds) === JSON.stringify(bIds),
    `two crews in one city see different people at the Bar: ${JSON.stringify(aIds)} and ${JSON.stringify(bIds)}`,
  );
  const tables = sharedTables(aRoom, bRoom);
  const contested = tables[0];
  const aOnly = tables[1];
  if (!contested) {
    h.check(false, 'no table at the Bar that both A and B could sit at');
    return;
  }
  const id = contested.recruit.id;

  h.at('bar: the open bidding');
  const opened = await bid(h, a, id, contested.auction.nextBid);
  h.check(opened?.auction.leading?.yours === true, 'A opened the table and is not leading it');
  const aAgain = opened?.auction.nextBid ?? contested.auction.nextBid + 1;
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId: id, amount: aAgain },
    expect: 409,
    code: 'BID_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId: id, amount: contested.auction.nextBid },
    expect: 409,
    code: 'BID_REFUSED',
  });
  const topped = await bid(h, b, id, aAgain);
  h.check(topped?.auction.leading?.yours === true, 'B outbid A and is not leading');
  const back = await bid(h, a, id, topped?.auction.nextBid ?? aAgain + 1);
  h.check(back?.auction.leading?.yours === true, 'A came back over B and is not leading');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/bar/seal',
    body: { recruitId: id, amount: 500 },
    expect: 409,
    code: 'BID_REFUSED',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId: 'bar-1999-01-01-0-0', amount: 50 },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId: id, amount: 0 },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/bar/bid', { recruitId: id, amount: 'fifty' });
  await h.refuseMalformed(a, '/api/bar/seal', { recruitId: 7, amount: 5 });
  // More than the book can carry.
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId: id, amount: bRoom.bidCeiling + 1_000 },
    expect: 409,
    code: 'NO_PAYROLL',
  });
  // A Terminus crew has no stake in Ashfall's room.
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId: id, amount: 500 },
    expect: 403,
    code: 'CITY_SHUT',
  });
  await h.call({
    as: c,
    method: 'GET',
    route: '/api/bar',
    query: { city: 'ashfall' },
    expect: 403,
    code: 'CITY_SHUT',
  });
  await h.call({
    as: c,
    method: 'GET',
    route: '/api/bar',
    query: { city: 'terminus' },
    expect: 200,
  });

  // A second table for A alone, so A is sitting at two, the most a level-16 crew may hold.
  if (aOnly) await bid(h, a, aOnly.recruit.id, aOnly.auction.nextBid);
  const allowed = back?.auctionsAllowed ?? 2;
  const third = aRoom.recruits.find(
    (recruit, index) =>
      recruit.id !== id &&
      recruit.id !== aOnly?.recruit.id &&
      recruit.assessment.blockers.length === 0 &&
      (aRoom.auctions[index]?.nextBid ?? 1e9) <= aRoom.bidCeiling,
  );
  const aTables = (back?.auctionsUsed ?? 0) + (aOnly ? 1 : 0);
  if (third && aTables >= allowed) {
    const index = aRoom.recruits.indexOf(third);
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/bar/bid',
      body: { recruitId: third.id, amount: aRoom.auctions[index]?.nextBid ?? 50 },
      expect: 409,
      code: 'TOO_MANY_AUCTIONS',
    });
  }

  // Terminus: C and D each take a table of their own.
  const terminusTables: { crew: Player; recruitId: string }[] = [];
  for (const crew of [c, d]) {
    const room = await bar(h, crew);
    const free = room?.recruits.findIndex(
      (recruit, index) =>
        recruit.assessment.blockers.length === 0 &&
        room.auctions[index]?.leading === null &&
        (room.auctions[index]?.nextBid ?? 1e9) <= room.bidCeiling,
    );
    const recruit = free !== undefined && free >= 0 ? room?.recruits[free] : undefined;
    const auction = free !== undefined && free >= 0 ? room?.auctions[free] : undefined;
    if (recruit && auction) {
      await bid(h, crew, recruit.id, auction.nextBid);
      terminusTables.push({ crew, recruitId: recruit.id });
    }
  }

  h.at('bar: the sealed half hour');
  h.advanceTo(new Date(contested.auction.sealedFrom).getTime() + 60_000);
  const sealedRoom = await bar(h, a);
  const sealedAuction = sealedRoom?.auctions.find((one) => one.recruitId === id);
  h.check(
    sealedAuction?.phase === 'sealed',
    `the table is ${sealedAuction?.phase} in the last half hour`,
  );
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId: id, amount: 900 },
    expect: 409,
    code: 'BID_REFUSED',
  });
  const leading = sealedAuction?.leading?.amount ?? 1;
  const aFinal = leading + 20;
  const bFinal = leading + 5;
  await h.ok<BidResponse>({
    as: a,
    method: 'POST',
    route: '/api/bar/seal',
    body: { recruitId: id, amount: aFinal },
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/bar/seal',
    body: { recruitId: id, amount: aFinal + 5 },
    expect: 409,
    code: 'BID_REFUSED',
  });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/bar/seal',
    body: { recruitId: id, amount: 1 },
    expect: 409,
    code: 'BID_REFUSED',
  });
  const bSealed = await h.ok<BidResponse>({
    as: b,
    method: 'POST',
    route: '/api/bar/seal',
    body: { recruitId: id, amount: bFinal },
  });
  h.check(
    bSealed?.auction.yourSealed === bFinal,
    `B sealed ${bFinal} and the table says ${bSealed?.auction.yourSealed}`,
  );

  h.at('bar: midnight');
  const aBefore = await baseOf(h, a);
  h.advanceTo(new Date(contested.auction.closesAt).getTime() + 60_000);
  const aAfter = await bar(h, a);
  const bAfter = await bar(h, b);
  const won = aAfter?.officers.find((one) => one.commander.id === id);
  h.check(won !== undefined, 'A sealed the highest final value and did not sign the recruit');
  h.check(
    !bAfter?.officers.some((one) => one.commander.id === id),
    'B lost the table and signed the recruit anyway',
  );
  const aResult = aAfter?.results.find((one) => one.recruitId === id);
  const bResult = bAfter?.results.find((one) => one.recruitId === id);
  h.check(
    aResult?.outcome === 'won' && aResult.price === aFinal,
    `A's result reads ${JSON.stringify(aResult)}`,
  );
  h.check(bResult?.outcome === 'lost', `B's result reads ${JSON.stringify(bResult)}`);
  if (won) {
    h.check(
      aAfter?.payroll !== undefined && won.weeklyWage > 0,
      `the signed officer carries a weekly wage of ${won.weeklyWage}`,
    );
  }
  h.check(
    (aAfter?.slotsUsed ?? 0) === aBefore.commanders.length + 1 + (aOnly ? 1 : 0) ||
      (aAfter?.slotsUsed ?? 0) === aBefore.commanders.length + 1,
    `A's books hold ${aAfter?.slotsUsed} after the close`,
  );
  const aBell = await h.ok<NotificationsResponse>({
    as: a,
    method: 'GET',
    route: '/api/notifications',
  });
  const bBell = await h.ok<NotificationsResponse>({
    as: b,
    method: 'GET',
    route: '/api/notifications',
  });
  h.check(
    Boolean(aBell?.notifications.some((one) => one.kind === 'officer_hired')),
    'A won a table and was not told',
  );
  h.check(
    Boolean(bBell?.notifications.some((one) => one.kind === 'bar_outbid')),
    'B lost a table and was not told',
  );
  for (const table of terminusTables) {
    const room = await bar(h, table.crew);
    h.check(
      Boolean(room?.officers.some((one) => one.commander.id === table.recruitId)),
      `${table.crew.label} was alone at a table and did not sign the recruit`,
    );
  }
  // Yesterday's table is closed: its recruit id is gone from today's roster.
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/bar/bid',
    body: { recruitId: id, amount: 900 },
    expect: 404,
    code: 'NOT_FOUND',
  });

  await payroll(h, a, b);
  await release(h, b, c);
}

/** Increase Payroll: one expansion of 30 at a time, paid in caps, never twice for one press. */
async function payroll(h: Harness, a: Player, b: Player): Promise<void> {
  h.at('bar: widening the payroll book');
  const room = await bar(h, a);
  if (!room) return;
  const steps = room.payroll.purchasedSteps;
  const before = await baseOf(h, a);
  const bought = await h.ok<IncreasePayrollResponse>({
    as: a,
    method: 'POST',
    route: '/api/bar/payroll',
    body: { fromSteps: steps },
  });
  if (bought) {
    h.check(
      bought.payroll.purchasedSteps === steps + 1,
      `payroll went from ${steps} to ${bought.payroll.purchasedSteps} steps`,
    );
    h.check(
      bought.payroll.capacity === room.payroll.capacity + PAYROLL_STEP,
      `one expansion moved the book from ${room.payroll.capacity} to ${bought.payroll.capacity}`,
    );
    expectDelta(
      h,
      before.resources,
      bought.resources,
      { [PAYROLL_STEP_RESOURCE]: -bought.spent },
      'a payroll expansion',
    );
  }
  // The same press again, naming the step the screen showed, is stale.
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/bar/payroll',
    body: { fromSteps: steps },
    expect: 409,
    code: 'STALE_STATE',
  });
  await h.refuseMalformed(a, '/api/bar/payroll', { fromSteps: -1 });
  // A crew with no caps cannot buy one.
  const poor = await baseOf(h, b);
  h.repos.bases.updateResources(b.baseId, { ...poor.resources, [PAYROLL_STEP_RESOURCE]: 0 });
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/bar/payroll',
    body: {},
    expect: 409,
    code: 'INSUFFICIENT_RESOURCES',
  });
  h.repos.bases.updateResources(b.baseId, poor.resources);
}

/** Letting an officer go costs ten weeks of their wage in caps, on the spot. */
async function release(h: Harness, b: Player, c: Player): Promise<void> {
  h.at('bar: letting somebody go');
  const room = await bar(h, c);
  const officer = room?.officers[0];
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/bar/release',
    body: { officerId: 'nobody' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(b, '/api/bar/release', { officerId: 42 });
  if (!officer || !room) return;
  // Somebody else's officer is not on B's books.
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/bar/release',
    body: { officerId: officer.commander.id },
    expect: 404,
    code: 'NOT_FOUND',
  });
  // A crew that cannot cover the fee keeps them.
  const held = await baseOf(h, c);
  if (officer.dismissalFee > 0) {
    h.repos.bases.updateResources(c.baseId, { ...held.resources, caps: officer.dismissalFee - 1 });
    await h.refuse({
      as: c,
      method: 'POST',
      route: '/api/bar/release',
      body: { officerId: officer.commander.id },
      expect: 409,
      code: 'INSUFFICIENT_CAPS',
    });
    h.repos.bases.updateResources(c.baseId, held.resources);
  }
  const before = await baseOf(h, c);
  const let_go = await h.ok<ReleaseOfficerResponse>({
    as: c,
    method: 'POST',
    route: '/api/bar/release',
    body: { officerId: officer.commander.id },
  });
  if (let_go) {
    h.check(
      let_go.fee === officer.dismissalFee,
      `the fee charged (${let_go.fee}) is not the fee quoted (${officer.dismissalFee})`,
    );
    expectDelta(
      h,
      before.resources,
      let_go.resources,
      { caps: -let_go.fee },
      'letting an officer go',
    );
  }
  const after = await baseOf(h, c);
  h.check(
    !after.commanders.some((one) => one.id === officer.commander.id),
    'the released officer is still on the books',
  );
  h.check(
    after.economy.payroll.commitments[officer.commander.id] === undefined,
    'the released officer still holds a slice of the payroll',
  );
  await h.refuse({
    as: c,
    method: 'POST',
    route: '/api/bar/release',
    body: { officerId: officer.commander.id },
    expect: 404,
    code: 'NOT_FOUND',
  });
}
