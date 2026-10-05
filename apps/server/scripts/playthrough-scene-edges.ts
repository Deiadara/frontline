/**
 * The edges: queues and slots at their limits, an officer let go mid-run, an offer left to expire,
 * units posted on an ally's ground when the faction breaks, and the same button pressed twice at
 * once from two tabs.
 */
import {
  findUnit,
  type ActionsResponse,
  type BattlesResponse,
  type ClaimFeatResponse,
  type FactionResponse,
  type FeatsResponse,
  type MarketMutationResponse,
  type MarketResponse,
  type Mission,
  type MissionsResponse,
  type UnitsResponse,
  TECH_DISTRICT_OFFERS,
} from '@frontline/shared';
import type { Harness, Player, Reply } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf, expectDelta, HOUR, MINUTE } from './playthrough-helpers.js';
import {
  addItems,
  addUnits,
  grantResources,
  setInfamy,
  addTechnologies,
} from './playthrough-bench.js';
import { board, bringHome, launch, openJobs } from './playthrough-scene-missions.js';
import { ledgerDrift, unitLedger } from './playthrough-invariants.js';

export async function edges(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');
  const d = player(cast, 'D');
  await benchLimits(h, d);
  await missionCapacity(h, a);
  await offerExpiry(h, b);
  await allyPosting(h, a, b);
  await races(h, a, b, c, d);
}

async function benchLimits(h: Harness, d: Player): Promise<void> {
  h.at('edges: the muster bench is full');
  grantResources(h, d, { caps: 5_000, supplies: 2_000 });
  const roster = await h.ok<UnitsResponse>({ as: d, method: 'GET', route: '/api/units' });
  const unit = roster?.units.find((one) => one.unlocked && !one.unique);
  if (!roster || !unit) return;
  const placed: string[] = [];
  for (let order = roster.queue.length; order < 5; order += 1) {
    const res = await h.ok<{ queue: { id: string }[] }>({
      as: d,
      method: 'POST',
      route: '/api/units/muster',
      body: { unitId: unit.id, count: 1 },
    });
    const last = res?.queue[res.queue.length - 1];
    if (last) placed.push(last.id);
  }
  await h.refuse({
    as: d,
    method: 'POST',
    route: '/api/units/muster',
    body: { unitId: unit.id, count: 1 },
    expect: 409,
    code: 'MUSTER_QUEUE_FULL',
  });
  for (const id of placed.reverse()) {
    await h.call({
      as: d,
      method: 'POST',
      route: '/api/units/cancel',
      body: { orderId: id },
      expect: 'any',
    });
  }

  h.at('edges: nowhere to house another');
  const read = await h.ok<UnitsResponse>({ as: d, method: 'GET', route: '/api/units' });
  if (!read) return;
  // One batch bigger than the spare beds is refused whole, and so is a second batch that would
  // overfill beds the first one has already spoken for.
  const beds = read.unitSlotsCap - read.unitSlotsUsed;
  const perUnit = Math.max(1, unit.unitSlots);
  const fits = Math.floor(beds / perUnit);
  if (fits >= 1 && fits + 1 <= 50) {
    grantResources(h, d, { caps: 20_000, supplies: 4_000 });
    await h.refuse({
      as: d,
      method: 'POST',
      route: '/api/units/muster',
      body: { unitId: unit.id, count: fits + 1 },
      expect: 409,
      code: 'NO_UNIT_SLOTS',
    });
    const first = await h.ok<{ queue: { id: string }[] }>({
      as: d,
      method: 'POST',
      route: '/api/units/muster',
      body: { unitId: unit.id, count: fits },
    });
    await h.refuse({
      as: d,
      method: 'POST',
      route: '/api/units/muster',
      body: { unitId: unit.id, count: 1 },
      expect: 409,
      code: 'NO_UNIT_SLOTS',
    });
    const order = first?.queue[first.queue.length - 1];
    if (order)
      await h.call({
        as: d,
        method: 'POST',
        route: '/api/units/cancel',
        body: { orderId: order.id },
        expect: 'any',
      });
  }
  const razor = findUnit('razors');
  const spare = read.unitSlotsCap - read.unitSlotsUsed;
  if (razor && spare > 0) {
    const filler = Math.ceil(spare / Math.max(1, razor.unitSlots)) + 1;
    addUnits(h, d, { razors: filler });
    await h.refuse({
      as: d,
      method: 'POST',
      route: '/api/units/muster',
      body: { unitId: unit.id, count: 1 },
      expect: 409,
      code: 'NO_UNIT_SLOTS',
    });
    addUnits(h, d, { razors: -filler });
  }
}

async function missionCapacity(h: Harness, a: Player): Promise<void> {
  h.at('edges: every crew out');
  addUnits(h, a, { scavengers: 20, razors: 10 });
  const read = await board(h, a);
  if (!read) return;
  const free = read.leaders.filter((one) => one.held === null);
  const jobs = openJobs(read);
  const runs: Mission[] = [];
  for (let slot = 0; slot < read.activeLimit; slot += 1) {
    const leader = free[slot];
    const job = jobs.find((one) => !runs.some((run) => run.areaId === one.area.id));
    if (!leader || !job) break;
    const mission = await launch(h, a, job, { scavengers: 2 }, leader.id);
    if (mission) runs.push(mission);
    h.advance(2 * MINUTE);
  }
  const spareLeader = free[runs.length];
  // Any card will do: the slots are counted before the area is.
  const spareJob = jobs[0];
  if (runs.length === read.activeLimit && spareLeader && spareJob) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/missions',
      body: {
        templateId: spareJob.offer.templateId,
        areaId: spareJob.area.id,
        boardKey: spareJob.offer.boardKey,
        grade: spareJob.offer.grade,
        force: { scavengers: 1 },
        leaderId: spareLeader.id,
      },
      expect: 409,
      code: 'MISSIONS_AT_CAPACITY',
    });
  } else {
    h.check(
      false,
      `A could not fill its ${read.activeLimit} mission slots (${runs.length} out, ${free.length} leaders free)`,
    );
  }

  h.at('edges: an officer let go while leading a run');
  const officerRun = runs.find((run) => run.officerId !== null && !run.overseerLed);
  if (officerRun?.officerId) {
    // Refused while they are out: the run needs its leader to come home.
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/bar/release',
      body: { officerId: officerRun.officerId },
      expect: 409,
      code: 'STALE_STATE',
    });
  }
  for (const run of runs) await bringHome(h, a, run);
}

async function offerExpiry(h: Harness, b: Player): Promise<void> {
  h.at('edges: a listing nobody takes');
  addItems(h, b, { coolant_cell: 3 });
  addTechnologies(h, b, [TECH_DISTRICT_OFFERS]);
  const before = await baseOf(h, b);
  const posted = await h.ok<MarketMutationResponse>({
    as: b,
    method: 'POST',
    route: '/api/market/offer',
    body: {
      give: { resources: {}, items: { coolant_cell: 2 } },
      want: { resources: { caps: 50 }, items: {} },
    },
  });
  const offer = posted?.market.mine.find(
    (one) => one.status === 'open' && (one.give.items as Record<string, number>).coolant_cell === 2,
  );
  if (!offer) return;
  const held = (inventory: Record<string, number | undefined>) => inventory.coolant_cell ?? 0;
  h.check(
    held(posted?.market.inventory) === held(before.inventory) - 2,
    'posting did not take the goods into escrow',
  );
  h.advance(49 * HOUR);
  const read = await h.ok<MarketResponse>({ as: b, method: 'GET', route: '/api/market' });
  h.check(
    !read?.mine.some((one) => one.id === offer.id && one.status === 'open'),
    'a listing past its lifetime is still open',
  );
  // Held on the board for B to claim (maintainer, 2026-09-28), then paid in by the world clock
  // once its 24 hours are up, whether or not B ever looks.
  h.check(
    read?.claims.some((one) => one.offer.id === offer.id && one.reason === 'expired') === true,
    'an expired listing is not waiting on the board to be claimed',
  );
  h.check(
    held((await baseOf(h, b)).inventory) === held(before.inventory) - 2,
    'an expired listing skipped the claim and went straight back',
  );
  h.advance(25 * HOUR);
  const after = await baseOf(h, b);
  h.check(
    held(after.inventory) === held(before.inventory),
    `an unclaimed listing gave back ${held(after.inventory)} coolant cells of ${held(before.inventory)} after its 24 hours`,
  );
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/market/withdraw',
    body: { offerId: offer.id },
    expect: 409,
    code: 'MARKET_REFUSED',
  });
}

/** B posts Razors on A's ground (they are allies); A kicks B and they come home, none lost. */
async function allyPosting(h: Harness, a: Player, b: Player): Promise<void> {
  h.at("edges: units on an ally's ground");
  const aUnits = await h.ok<UnitsResponse>({ as: a, method: 'GET', route: '/api/units' });
  const held = Object.keys(aUnits?.standingAt ?? {})[0];
  const bUnits = await h.ok<UnitsResponse>({ as: b, method: 'GET', route: '/api/units' });
  const allyPlace = bUnits?.moveDestinations.find((one) => one.group === 'faction');
  if (!held || !allyPlace) {
    h.check(false, `B sees no ally ground to post units on (A holds ${held ?? 'nothing'})`);
    return;
  }
  // The screen offers every ally's location as a destination; the move must accept what it offers.
  const moveBody = { from: { kind: 'district' }, to: allyPlace.place, army: { razors: 3 } };
  const offered = await h.call<ActionsResponse>({
    as: b,
    method: 'POST',
    route: '/api/actions/move',
    body: moveBody,
    expect: 200,
  });
  const sent = offered.status === 200 ? offered.body : undefined;
  const move = sent?.moves[sent.moves.length - 1];
  if (move) h.advanceTo(new Date(move.arrivesAt).getTime() + MINUTE);
  h.advance(10 * MINUTE);
  const posted = h.repos.alliedGarrisons.forBase(b.baseId);
  h.check(posted.length > 0, "B walked onto an ally's ground and is not posted there");

  h.settleAll();
  const before = unitLedger(h, b.baseId);
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/factions/member',
    body: { userId: b.userId, action: 'kick' },
  });
  const after = unitLedger(h, b.baseId);
  const drift = ledgerDrift(before, after);
  h.check(
    drift.length === 0,
    `B was kicked with units on A's ground and the count moved (${drift.join(', ')})`,
  );
  h.check(
    h.repos.alliedGarrisons.forBase(b.baseId).length === 0,
    "B left the faction and is still posted on A's ground",
  );

  // Back to the table for the rest of the run.
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/factions/invite',
    body: { username: b.username },
  });
  const screen = await h.ok<FactionResponse>({ as: b, method: 'GET', route: '/api/factions' });
  const invite = screen?.invites[0];
  if (invite)
    await h.ok({
      as: b,
      method: 'POST',
      route: '/api/factions/answer',
      body: { inviteId: invite.id, accept: true },
    });
}

function successes(replies: readonly Reply<unknown>[]): number {
  return replies.filter((one) => one.status >= 200 && one.status < 300).length;
}

/** The same press twice at once, from two tabs or two players: exactly one of them lands. */
async function races(h: Harness, a: Player, b: Player, c: Player, d: Player): Promise<void> {
  h.at('races: two buyers for one listing');
  grantResources(h, b, { scrap: 500 });
  grantResources(h, c, { scrap: 500 });
  // Room on D's scrap shelf for what the listing asks, or the post is a waste warning instead.
  const dHeld = await baseOf(h, d);
  h.repos.bases.updateResources(d.baseId, { ...dHeld.resources, scrap: 0 });
  // Counted before the listing, so D's escrow is inside the before and the after alike.
  const [bBefore, cBefore, dBefore] = [await baseOf(h, b), await baseOf(h, c), await baseOf(h, d)];
  const listed = await h.ok<MarketMutationResponse>({
    as: d,
    method: 'POST',
    route: '/api/market/offer',
    body: {
      give: { resources: { caps: 300 }, items: {} },
      want: { resources: { scrap: 50 }, items: {} },
    },
  });
  const offer = listed?.market.mine.find(
    (one) => one.status === 'open' && one.give.resources.caps === 300,
  );
  if (offer) {
    const replies = await Promise.all([
      h.call({
        as: b,
        method: 'POST',
        route: '/api/market/accept',
        body: { offerId: offer.id },
        expect: 'any',
      }),
      h.call({
        as: c,
        method: 'POST',
        route: '/api/market/accept',
        body: { offerId: offer.id },
        expect: 'any',
      }),
    ]);
    h.check(
      successes(replies) === 1,
      `two buyers pressed at once and ${successes(replies)} of them bought the listing`,
    );
    const [bAfter, cAfter, dAfter] = [await baseOf(h, b), await baseOf(h, c), await baseOf(h, d)];
    const caps = (one: { resources: { caps: number } }[]) =>
      one.reduce((sum, x) => sum + x.resources.caps, 0);
    h.check(
      caps([bAfter, cAfter, dAfter]) === caps([bBefore, cBefore, dBefore]),
      `caps across the three crews went from ${caps([bBefore, cBefore, dBefore])} to ${caps([bAfter, cAfter, dAfter])}`,
    );
  }

  h.at('races: one payroll step, pressed twice');
  const room = await h.ok<{ payroll: { purchasedSteps: number } }>({
    as: a,
    method: 'GET',
    route: '/api/bar',
  });
  if (room) {
    const steps = room.payroll.purchasedSteps;
    const replies = await Promise.all([
      h.call({
        as: a,
        method: 'POST',
        route: '/api/bar/payroll',
        body: { fromSteps: steps },
        expect: 'any',
      }),
      h.call({
        as: a,
        method: 'POST',
        route: '/api/bar/payroll',
        body: { fromSteps: steps },
        expect: 'any',
      }),
    ]);
    h.check(
      successes(replies) <= 1,
      `one payroll step pressed twice bought ${successes(replies)} steps`,
    );
    const after = await h.ok<{ payroll: { purchasedSteps: number } }>({
      as: a,
      method: 'GET',
      route: '/api/bar',
    });
    h.check(
      after?.payroll.purchasedSteps === steps + successes(replies),
      `the book moved from ${steps} to ${after?.payroll.purchasedSteps} steps`,
    );
  }

  h.at('races: one rank, pressed twice');
  setInfamy(h, c, 20_000);
  const cBase = await baseOf(h, c);
  const rankReplies = await Promise.all([
    h.call({
      as: c,
      method: 'POST',
      route: '/api/battles/notoriety',
      body: { fromNotoriety: cBase.economy.notoriety },
      expect: 'any',
    }),
    h.call({
      as: c,
      method: 'POST',
      route: '/api/battles/notoriety',
      body: { fromNotoriety: cBase.economy.notoriety },
      expect: 'any',
    }),
  ]);
  h.check(
    successes(rankReplies) === 1,
    `one rank pressed twice bought ${successes(rankReplies)} ranks`,
  );
  const ranked = await h.ok<BattlesResponse>({ as: c, method: 'GET', route: '/api/battles' });
  void ranked;
  h.check(
    (await baseOf(h, c)).economy.notoriety === cBase.economy.notoriety + 1,
    'the rank moved by more than one',
  );

  h.at('races: one feat, collected twice');
  const featBoard = await h.ok<FeatsResponse>({ as: b, method: 'GET', route: '/api/feats' });
  const ready = featBoard?.progress.find(
    (one) => one.state === 'ready' && featBoard.waste[one.id] === undefined,
  );
  if (ready) {
    const before = await baseOf(h, b);
    const replies = await Promise.all([
      h.call<ClaimFeatResponse>({
        as: b,
        method: 'POST',
        route: '/api/feats/claim',
        body: { featId: ready.id },
        expect: 'any',
      }),
      h.call<ClaimFeatResponse>({
        as: b,
        method: 'POST',
        route: '/api/feats/claim',
        body: { featId: ready.id },
        expect: 'any',
      }),
    ]);
    h.check(
      successes(replies) === 1,
      `one feat collected twice at once paid ${successes(replies)} times`,
    );
    const paid = replies.find((one) => one.status === 200)?.body.paid as
      { resources?: Record<string, number> } | undefined;
    if (paid?.resources) {
      const after = await baseOf(h, b);
      expectDelta(
        h,
        before.resources,
        after.resources,
        paid.resources,
        'a feat collected twice at once',
      );
    }
  }

  h.at('races: one leader, sent twice');
  const read = await h.ok<MissionsResponse>({ as: d, method: 'GET', route: '/api/missions' });
  const overseer = read?.leaders.find((one) => one.kind === 'overseer' && one.held === null);
  const jobs = read ? openJobs(read) : [];
  const [first, second] = jobs;
  if (overseer && first && second) {
    const replies = await Promise.all(
      [first, second].map((job) =>
        h.call({
          as: d,
          method: 'POST',
          route: '/api/missions',
          body: {
            templateId: job.offer.templateId,
            areaId: job.area.id,
            boardKey: job.offer.boardKey,
            grade: job.offer.grade,
            force: { scavengers: 1 },
            leaderId: overseer.id,
          },
          expect: 'any',
        }),
      ),
    );
    h.check(
      successes(replies) === 1,
      `one Overseer sent on two jobs at once led ${successes(replies)} of them`,
    );
    h.advance(12 * HOUR);
    await board(h, d);
  }
}
