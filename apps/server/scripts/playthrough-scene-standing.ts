/**
 * What a crew has to show for it: feats and their rewards, the Right Hand's standing orders, the
 * standings and the profiles other players read.
 */
import {
  AUTOMATION_RUNGS,
  type AutomationsResponse,
  type ClaimAllResponse,
  type ClaimFeatResponse,
  type CrewProfileResponse,
  type FeatsResponse,
  type LeaderboardResponse,
  type MissionsResponse,
  type ResearchResponse,
} from '@frontline/shared';
import type { Harness } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf, expectDelta, HOUR, MINUTE } from './playthrough-helpers.js';
import { addTechnologies, grantResources } from './playthrough-bench.js';
import { board, openJobs } from './playthrough-scene-missions.js';

export async function feats(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const c = player(cast, 'C');
  h.at('feats: the board');
  const read = await h.ok<FeatsResponse>({ as: a, method: 'GET', route: '/api/feats' });
  if (!read) return;
  h.check(
    read.ready === read.progress.filter((one) => one.state === 'ready').length,
    `the board says ${read.ready} ready and lists a different number`,
  );
  const ready = read.progress.find(
    (one) => one.state === 'ready' && read.waste[one.id] === undefined,
  );
  const unfinished = read.progress.find((one) => one.state === 'open' || one.state === 'locked');
  if (ready) {
    const before = await baseOf(h, a);
    const claimed = await h.ok<ClaimFeatResponse>({
      as: a,
      method: 'POST',
      route: '/api/feats/claim',
      body: { featId: ready.id },
    });
    h.check(claimed?.featId === ready.id, 'the claim answered for another feat');
    // What the claim says it paid is what arrived.
    const paid = (claimed?.paid ?? {}) as { resources?: Record<string, number> };
    if (claimed && paid.resources) {
      const after = await baseOf(h, a);
      expectDelta(h, before.resources, after.resources, paid.resources, `collecting ${ready.id}`);
    }
    h.check(
      claimed?.feats.progress.find((one) => one.id === ready.id)?.state === 'claimed',
      'a collected feat does not read as claimed',
    );
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/feats/claim',
      body: { featId: ready.id },
      expect: 409,
      code: 'FEAT_REFUSED',
    });
  } else {
    h.check(
      false,
      `A has played two weeks and has no feat ready to collect (${read.claimed} claimed)`,
    );
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/feats/claim',
    body: { featId: 'feat_of_legend' },
    expect: 409,
    code: 'FEAT_REFUSED',
  });
  if (unfinished) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/feats/claim',
      body: { featId: unfinished.id },
      expect: 409,
      code: 'FEAT_REFUSED',
    });
  }
  await h.refuseMalformed(a, '/api/feats/claim', { featId: 5 });

  h.at('feats: collect all');
  const before = await h.ok<FeatsResponse>({ as: c, method: 'GET', route: '/api/feats' });
  const all = await h.ok<ClaimAllResponse>({
    as: c,
    method: 'POST',
    route: '/api/feats/claim-all',
    body: {},
  });
  if (before && all) {
    h.check(
      all.featIds.length + all.skipped.length === before.ready,
      `collect all took ${all.featIds.length} and skipped ${all.skipped.length} of ${before.ready} ready`,
    );
    h.check(
      all.feats.ready === all.skipped.length,
      `after collecting all, ${all.feats.ready} are still ready`,
    );
  }
  const again = await h.ok<ClaimAllResponse>({
    as: c,
    method: 'POST',
    route: '/api/feats/claim-all',
    body: {},
  });
  h.check(
    (again?.featIds.length ?? 0) === 0,
    `a second collect-all paid ${again?.featIds.length} feats again`,
  );
}

export async function automations(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  const c = player(cast, 'C');

  h.at('automations: locked');
  const locked = await h.ok<AutomationsResponse>({
    as: b,
    method: 'GET',
    route: '/api/automations',
  });
  h.check(
    locked?.powers.unlocked === false,
    'B has not researched the Open Door and the Right Hand works anyway',
  );
  const order = {
    slot: 0,
    enabled: true,
    order: 'missions',
    force: { scavengers: 2 },
    officerId: null,
  };
  await h.refuse({
    as: b,
    method: 'POST',
    route: '/api/automations',
    body: order,
    expect: 403,
    code: 'FORBIDDEN',
  });

  h.at('automations: the Open Door, researched');
  grantResources(h, a, {
    caps: 20_000,
    scrap: 3_000,
    planks: 3_000,
    oil: 3_000,
    supplies: 3_000,
    highQualityMetal: 400,
  });
  const lab = await h.ok<ResearchResponse>({ as: a, method: 'GET', route: '/api/research' });
  const door = lab?.technologies.find((tech) => tech.id === AUTOMATION_RUNGS.open);
  if (door && !door.known && door.blocker === null) {
    const started = await h.ok<ResearchResponse>({
      as: a,
      method: 'POST',
      route: '/api/research/tech',
      body: { techId: door.id },
    });
    if (started?.completesAt) h.advanceTo(new Date(started.completesAt).getTime() + MINUTE);
  } else if (door && !door.known) {
    // The rung is gated on something the bench has not set up; grant it so the orders can be read.
    addTechnologies(h, a, [AUTOMATION_RUNGS.open]);
  }
  const open = await h.ok<AutomationsResponse>({ as: a, method: 'GET', route: '/api/automations' });
  h.check(
    open?.powers.unlocked === true,
    'the Open Door is known and the Right Hand still will not work',
  );
  if (!open?.powers.unlocked) return;

  h.at('automations: orders that cannot be given');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: { ...order, slot: 1 },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: { ...order, order: 'battles' },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: { ...order, force: {} },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: { ...order, force: { constructor: 1 } },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: { ...order, unitSlots: 5 },
    expect: 403,
    code: 'FORBIDDEN',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: { ...order, optimiseFor: 'scrap' },
    expect: 403,
    code: 'FORBIDDEN',
  });
  // An officer who is not on this crew's books is nobody the Right Hand can send.
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: { ...order, officerId: 'bench-B-field_commander' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/automations', { ...order, slot: 7 });

  h.at('automations: the Right Hand runs the board');
  const saved = await h.ok<AutomationsResponse>({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: order,
  });
  h.check(
    saved?.slots.some((one) => one.slot === 0 && one.enabled) ?? false,
    'the standing order was not saved',
  );
  const read = await board(h, a);
  const job = read ? openJobs(read)[0] : undefined;
  const overseer = read?.leaders.find((one) => one.kind === 'overseer');
  if (job && overseer) {
    await h.refuse({
      as: a,
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
      expect: 409,
      code: 'MISSION_REFUSED',
    });
  }
  const savedAt = h.now().getTime();
  h.advance(2 * HOUR);
  const after = await h.ok<MissionsResponse>({ as: a, method: 'GET', route: '/api/missions' });
  h.check(
    Boolean(after?.missions.some((one) => Date.parse(one.startedAt) >= savedAt)),
    'the Right Hand held the board for two hours and sent nobody out',
  );
  const status = await h.ok<AutomationsResponse>({
    as: a,
    method: 'GET',
    route: '/api/automations',
  });
  const slot = status?.slots.find((one) => one.slot === 0);
  h.check(
    slot?.stalled === null || slot?.stalled === undefined,
    `the standing order stalled: ${slot?.stalled}`,
  );
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/automations',
    body: { ...order, enabled: false },
  });
  void c;
}

export async function standings(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const c = player(cast, 'C');

  h.at('standings: the leaderboard');
  const players = await h.ok<LeaderboardResponse>({
    as: a,
    method: 'GET',
    route: '/api/leaderboard',
  });
  if (players) {
    const infamy = players.entries.map((one) => ('infamy' in one ? one.infamy : 0));
    h.check(
      infamy.every((value, index) => index === 0 || (infamy[index - 1] ?? 0) >= value),
      'the players board is not in infamy order',
    );
    h.check(players.yourRank !== null, 'A is not ranked on the players board');
  }
  // One city at a time (maintainer, 2026-10-07): the board lists whoever holds ground there, with
  // every figure on a row still that player's across the world.
  const inTerminus = await h.ok<LeaderboardResponse>({
    as: c,
    method: 'GET',
    route: '/api/leaderboard',
    query: { city: 'terminus' },
  });
  h.check(
    inTerminus?.city === 'terminus',
    `C asked for Terminus and the board came back listed for ${String(inTerminus?.city)}`,
  );
  // A city nobody can play in yet is answered with the world rather than with an empty sheet.
  const shut = await h.ok<LeaderboardResponse>({
    as: c,
    method: 'GET',
    route: '/api/leaderboard',
    query: { city: 'reliquary' },
  });
  h.check(shut?.city === null, `a shut city was taken as a board scope: ${String(shut?.city)}`);
  const factionsBoard = await h.ok<LeaderboardResponse>({
    as: a,
    method: 'GET',
    route: '/api/leaderboard',
    query: { board: 'factions' },
  });
  h.check(factionsBoard?.yourRank !== null, 'A leads a faction and it is not ranked');
  await h.call({
    as: a,
    method: 'GET',
    route: '/api/leaderboard',
    query: { board: 'bots' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });

  h.at('standings: profiles');
  const own = await h.ok<CrewProfileResponse>({
    as: a,
    method: 'GET',
    route: '/api/crews/:id',
    params: { id: a.baseId },
  });
  h.check(own?.isYou === true, 'A reading its own profile is not told it is A');
  const byOwner = await h.ok<CrewProfileResponse>({
    as: a,
    method: 'GET',
    route: '/api/crews/:id',
    params: { id: a.userId },
  });
  h.check(byOwner?.crew.id === a.baseId, 'a profile read by account id answered with another crew');
  const seen = await h.ok<CrewProfileResponse>({
    as: c,
    method: 'GET',
    route: '/api/crews/:id',
    params: { id: a.baseId },
  });
  if (seen && own) {
    h.check(seen.isYou === false, 'C reading A is told it is A');
    // The whole city is visible (maintainer, 2026-09-29): a reader who has never been to Ashfall
    // reads the same holdings A reads on its own file.
    h.check(
      seen.holdings.length === own.holdings.length,
      'two readers of one crew list a different number of holdings',
    );
  }
  await h.call({
    as: a,
    method: 'GET',
    route: '/api/crews/:id',
    params: { id: 'nobody' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  const base = await baseOf(h, a);
  h.check(base.level >= 1, 'A has no level');
}
