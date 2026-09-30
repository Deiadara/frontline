/**
 * The mission board: jobs at several grades, every one led, one called back, each paid once.
 */
import {
  GRADES,
  RESOURCE_KEYS,
  VEHICLES,
  canRecall,
  cityOfDistrict,
  districtsOfCity,
  launchableBoardKeys,
  missionOffers,
  missionCompletesAt,
  type LaunchMissionResponse,
  type Mission,
  type MissionArea,
  type MissionOffer,
  type MissionsResponse,
  type Resources,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { MINUTE, baseOf, conservingUnits, resourceDelta } from './playthrough-helpers.js';
import { ledgerDrift, unitLedger } from './playthrough-invariants.js';

export interface Job {
  area: MissionArea;
  offer: MissionOffer;
}

/** Every job on a board a crew could launch right now, cheapest first. */
export function openJobs(board: MissionsResponse): Job[] {
  return board.areas
    .filter((area) => area.activeMissionId === null)
    .flatMap((area) => area.offers.map((offer) => ({ area, offer })))
    .filter((job) => job.offer.kind === 'standard')
    .sort((x, y) => x.offer.totalMinutes - y.offer.totalMinutes);
}

export async function board(h: Harness, crew: Player): Promise<MissionsResponse | undefined> {
  const read = await h.ok<MissionsResponse>({ as: crew, method: 'GET', route: '/api/missions' });
  if (read?.justResolved) noteResolved(h, crew, read.justResolved);
  return read;
}

/** A run is reported home once: a second report of the same id means it was settled twice. */
const reportedHome = new Set<string>();
export function noteResolved(h: Harness, crew: Player, resolved: readonly Mission[]): void {
  for (const mission of resolved) {
    h.check(
      !reportedHome.has(mission.id),
      `${crew.label}: mission ${mission.id} was reported home a second time`,
    );
    reportedHome.add(mission.id);
  }
}

/** Sends a crew out on a job with its whole set of porters and the Overseer at the front. */
export async function launch(
  h: Harness,
  crew: Player,
  job: Job,
  force: Record<string, number>,
  leaderId: string,
): Promise<Mission | undefined> {
  const sent = await conservingUnits(h, crew, `launching ${job.offer.templateId}`, () =>
    h.ok<LaunchMissionResponse>({
      as: crew,
      method: 'POST',
      route: '/api/missions',
      body: {
        templateId: job.offer.templateId,
        areaId: job.area.id,
        boardKey: job.offer.boardKey,
        grade: job.offer.grade,
        force,
        leaderId,
      },
    }),
  );
  const mission = sent?.mission;
  if (!mission) return undefined;
  h.check(
    mission.grade === job.offer.grade,
    `${crew.label}: a ${job.offer.grade} card was launched at grade ${mission.grade}`,
  );
  h.check(
    JSON.stringify(mission.force) === JSON.stringify(force),
    `${crew.label}: sent ${JSON.stringify(force)}, the run carries ${JSON.stringify(mission.force)}`,
  );
  return mission;
}

/**
 * Brings a run home and checks the bill: the stockpile moves by exactly what the run says it
 * carried, and a second read pays nothing more.
 */
export async function bringHome(
  h: Harness,
  crew: Player,
  mission: Mission,
): Promise<Mission | undefined> {
  const due = missionCompletesAt(mission).getTime();
  if (h.repos.missions.findById(mission.id)?.mission.status !== 'active') {
    // Another run's wait already carried the clock past this one: it is home, unmeasured.
    const read = await board(h, crew);
    return read?.missions.find((one) => one.id === mission.id);
  }
  h.advanceTo(due - 1);
  h.settleAll();
  const before = (await baseOf(h, crew)).resources;
  const ledgerBefore = unitLedger(h, crew.baseId);
  h.advanceTo(due);
  const read = await h.ok<MissionsResponse>({ as: crew, method: 'GET', route: '/api/missions' });
  if (!read) return undefined;
  const home = read.missions.find((one) => one.id === mission.id);
  const reported = read.justResolved.find((one) => one.id === mission.id);
  // The world tick may have brought it home first; either way it must be resolved now.
  h.check(
    home?.status === 'resolved',
    `${crew.label}: mission ${mission.id} is not home at its due time (${home?.status})`,
  );
  if (reported) noteResolved(h, crew, [reported]);
  if (!home) return undefined;
  expectPaid(h, crew, before, read.resources, home);
  // The crew came home short exactly the people the run reports lost.
  const drift = ledgerDrift(ledgerBefore, unitLedger(h, crew.baseId));
  const lost = Object.entries(home.lost)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([id, n]) => `${id}: ${ledgerBefore[id] ?? 0} -> ${(ledgerBefore[id] ?? 0) - (n ?? 0)}`);
  h.check(
    JSON.stringify(drift.sort()) === JSON.stringify(lost.sort()),
    `${crew.label}: mission ${home.id} reports ${JSON.stringify(home.lost)} lost and the crew's units moved by ${drift.join(', ') || 'nothing'}`,
  );
  // Nothing more on a second read, or after another tick.
  const again = await h.ok<MissionsResponse>({ as: crew, method: 'GET', route: '/api/missions' });
  h.check(
    !again?.justResolved.some((one) => one.id === mission.id),
    `${crew.label}: mission ${mission.id} was reported again on the next read`,
  );
  if (again) expectSame(h, crew, read.resources, again.resources, 'a second read of the board');
  h.tick();
  const later = await baseOf(h, crew);
  expectSame(h, crew, read.resources, later.resources, 'a world tick after the run came home');
  return home;
}

/**
 * The stockpile moved by the run's carried rewards less what the full stores threw away at the
 * gate (maintainer ruling, 2026-09-28), give or take a unit of production.
 */
function expectPaid(
  h: Harness,
  crew: Player,
  before: Resources,
  after: Resources,
  mission: Mission,
): void {
  const moved = resourceDelta(before, after);
  const off = RESOURCE_KEYS.filter(
    (key) =>
      Math.abs((moved[key] ?? 0) - ((mission.rewards[key] ?? 0) - (mission.wasted?.[key] ?? 0))) >
      (key === 'caps' ? 0 : 1),
  );
  h.check(
    off.length === 0,
    `${crew.label}: mission ${mission.id} (${mission.outcome}) carried ${JSON.stringify(mission.rewards)}, wasted ${JSON.stringify(mission.wasted ?? {})}, and the stockpile moved by ${JSON.stringify(moved)}`,
  );
  if (mission.outcome === 'failure' && mission.recalledAt !== null) {
    h.check(
      Object.keys(mission.rewards).length === 0,
      `${crew.label}: a recalled run brought ${JSON.stringify(mission.rewards)} home`,
    );
  }
}

function expectSame(h: Harness, crew: Player, a: Resources, b: Resources, what: string): void {
  const moved = resourceDelta(a, b);
  h.check(
    Object.keys(moved).length === 0,
    `${crew.label}: ${what} moved the stockpile by ${JSON.stringify(moved)}`,
  );
}

export async function missions(h: Harness, cast: Cast): Promise<void> {
  const crews = (['A', 'B', 'C', 'D'] as const).map((label) => player(cast, label));
  const grades = new Set<string>();

  h.at('missions: reading the board');
  const runs: { crew: Player; mission: Mission }[] = [];
  for (const crew of crews) {
    const read = await board(h, crew);
    if (!read) continue;
    const overseer = read.leaders.find((leader) => leader.kind === 'overseer');
    h.check(overseer !== undefined, `${crew.label}: the Overseer is not on the bench`);
    const jobs = openJobs(read);
    h.check(jobs.length > 0, `${crew.label}: the board has no job on it`);
    // A grade nobody has run yet, where the board allows it.
    const job = jobs.find((one) => !grades.has(one.offer.grade)) ?? jobs[0];
    if (!overseer || !job) continue;
    grades.add(job.offer.grade);
    const porters = read.army.scavengers ?? 0;
    h.at(`missions: ${crew.label} sends a ${job.offer.grade} job`);
    const mission = await launch(h, crew, job, { scavengers: Math.min(porters, 4) }, overseer.id);
    if (mission) {
      const run = { crew, mission };
      runs.push(run);
      if (runs.length === 1) await launchRefusals(h, crew, mission, crews[1]);
      if (runs.length === 2) await recallRun(h, run);
    }
    // Staggered, so no two runs land on the same instant and each payout is measured alone.
    h.advance(MINUTE * 3);
  }
  h.check(
    grades.size >= 2,
    `the boards only offered one grade between four crews: ${[...grades].join(', ')}`,
  );

  const firstRun = runs[0];

  const recalledRun = runs[1];
  h.at('missions: the runs come home');
  for (const run of runs.sort(
    (x, y) => missionCompletesAt(x.mission).getTime() - missionCompletesAt(y.mission).getTime(),
  )) {
    h.at(`missions: ${run.crew.label}'s run comes home`);
    const home = await bringHome(h, run.crew, run.mission);
    if (home && run === recalledRun) {
      h.check(home.outcome === 'failure', `a recalled run came home as ${home.outcome}`);
    }
    // Too late to call back once home.
    await h.refuse({
      as: run.crew,
      method: 'POST',
      route: '/api/missions/recall',
      body: { missionId: run.mission.id },
      expect: 409,
      code: 'MISSION_REFUSED',
    });
  }

  if (firstRun) await freeLeaderRefusals(h, firstRun.crew);
}

/** Calls a run back the moment it has left, which is inside the first tenth of any clock. */
async function recallRun(h: Harness, run: { crew: Player; mission: Mission }): Promise<void> {
  h.at('missions: a run called back');
  const { crew, mission } = run;
  h.check(canRecall(mission, h.now()), 'a run launched this second cannot be called back');
  const recalled = await conservingUnits(h, crew, 'recalling a run', () =>
    h.ok<MissionsResponse>({
      as: crew,
      method: 'POST',
      route: '/api/missions/recall',
      body: { missionId: mission.id },
    }),
  );
  const turned = recalled?.missions.find((one) => one.id === mission.id);
  h.check(
    turned?.recalledAt !== null && turned?.recalledAt !== undefined,
    'the recalled run carries no recall time',
  );
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/missions/recall',
    body: { missionId: mission.id },
    expect: 409,
    code: 'MISSION_REFUSED',
  });
  if (turned) run.mission = turned;
}

/** The refusals that need the Overseer free: the force, the ground, the yard. */
async function freeLeaderRefusals(h: Harness, crew: Player): Promise<void> {
  h.at(`missions: refusals with a free leader (${crew.label})`);
  const read = await board(h, crew);
  const overseer = read?.leaders.find((leader) => leader.kind === 'overseer');
  const job = read ? openJobs(read)[0] : undefined;
  if (!read || !overseer || !job) return;
  const body = {
    templateId: job.offer.templateId,
    areaId: job.area.id,
    boardKey: job.offer.boardKey,
    grade: job.offer.grade,
    leaderId: overseer.id,
  };
  // A card the board never showed: the right job at a grade it was not dealt at. The launch takes
  // exactly the card that was read (maintainer, 2026-09-29).
  const hiddenGrade = GRADES.find((grade) => grade !== job.offer.grade);
  if (hiddenGrade) {
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/missions',
      body: { ...body, grade: hiddenGrade, force: { scavengers: 1 } },
      expect: 404,
      code: 'NOT_FOUND',
    });
  }
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/missions',
    body: { ...body, force: { scavengers: 999 } },
    expect: 409,
    code: 'NO_FORCE',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/missions',
    body: { ...body, force: {} },
    expect: 409,
    code: 'NO_FORCE',
  });
  const vehicle = VEHICLES[0];
  if (vehicle) {
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/missions',
      body: { ...body, force: { scavengers: 1 }, vehicles: { [vehicle.id]: 2 } },
      expect: 403,
      code: 'FORBIDDEN',
    });
  }
  // Ground this crew holds nothing in, with a card that district really is dealing today: the
  // board is not open to it (maintainer, 2026-09-29).
  const base = await baseOf(h, crew);
  const controls = h.repos.city.controls();
  const blind = districtsOfCity(cityOfDistrict(base.districtId)).find(
    (district) =>
      district.kind === 'contested' &&
      !district.locations.some((location) => {
        const holder = controls.get(location.id)?.holder;
        return holder?.kind === 'crew' && holder.baseId === base.id;
      }),
  );
  if (blind) {
    const key = launchableBoardKeys(blind.id, h.now())[0];
    const dealt = key === undefined ? undefined : missionOffers(blind.id, key, base.level)[0];
    if (dealt) {
      await h.refuse({
        as: crew,
        method: 'POST',
        route: '/api/missions',
        body: {
          templateId: dealt.template.id,
          areaId: blind.id,
          boardKey: key,
          grade: dealt.grade,
          leaderId: overseer.id,
          force: { scavengers: 1 },
        },
        expect: 409,
        code: 'MISSION_REFUSED',
      });
    }
  }
}

/** Everything a launch must refuse, sent while the crew's Overseer is out on a run. */
async function launchRefusals(
  h: Harness,
  crew: Player,
  running: Mission,
  other: Player | undefined,
): Promise<void> {
  h.at(`missions: launch refusals (${crew.label})`);
  const read = await board(h, crew);
  if (!read) return;
  const overseer = read.leaders.find((leader) => leader.kind === 'overseer');
  const jobs = openJobs(read);
  const job = jobs[0];
  if (!overseer || !job) return;
  const body = {
    templateId: job.offer.templateId,
    areaId: job.area.id,
    boardKey: job.offer.boardKey,
    grade: job.offer.grade,
    force: { scavengers: 1 },
    leaderId: overseer.id,
  };
  // The Overseer is out: one job at a time for them as for anybody.
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/missions',
    body,
    expect: 409,
    code: 'MISSION_REFUSED',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/missions',
    body: { ...body, leaderId: 'nobody-at-all' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/missions',
    body: { ...body, templateId: 'no-such-job' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  const { leaderId: _dropped, ...leaderless } = body;
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/missions',
    body: leaderless,
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(crew, '/api/missions', { ...body, force: { scavengers: -1 } });
  // The same area as the running job.
  const busyArea = read.areas.find((area) => area.id === running.areaId);
  const busyOffer = busyArea?.offers[0];
  if (busyArea && busyOffer) {
    await h.refuse({
      as: crew,
      method: 'POST',
      route: '/api/missions',
      body: {
        ...body,
        areaId: busyArea.id,
        templateId: busyOffer.templateId,
        boardKey: busyOffer.boardKey,
        grade: busyOffer.grade,
      },
      expect: 409,
      code: 'MISSION_REFUSED',
    });
  }
  // Somebody else's Overseer is not on this bench.
  if (other) {
    const theirs = await board(h, other);
    const theirOverseer = theirs?.leaders.find((leader) => leader.kind === 'overseer');
    if (theirOverseer && theirOverseer.id !== overseer.id) {
      await h.refuse({
        as: crew,
        method: 'POST',
        route: '/api/missions',
        body: { ...body, leaderId: theirOverseer.id },
        expect: 404,
        code: 'NOT_FOUND',
      });
    }
    // ...and their run is not this crew's to call back.
    const theirRun = theirs?.missions.find((one) => one.status === 'active');
    if (theirRun) {
      await h.refuse({
        as: crew,
        method: 'POST',
        route: '/api/missions/recall',
        body: { missionId: theirRun.id },
        expect: 404,
        code: 'NOT_FOUND',
      });
    }
  }
  await h.refuse({
    as: crew,
    method: 'POST',
    route: '/api/missions/recall',
    body: { missionId: 'no-such-run' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(crew, '/api/missions/recall', { missionId: 3 });
}
