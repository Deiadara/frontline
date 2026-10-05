/**
 * The crew: chairs, the Archive's one bench, and the drill floor.
 */
import {
  OVERSEER_SUBJECT,
  RESEARCH_ITEMS,
  cancelRefund,
  createCommander,
  makeAttributes,
  type CrewMutationResponse,
  type CrewResponse,
  type CrewStandingResponse,
  type OfficerRole,
  type ResearchResponse,
  type TrainingResponse,
} from '@frontline/shared';
import type { Harness, Player } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { baseOf, expectDelta, negate, MINUTE } from './playthrough-helpers.js';
import { addOfficer } from './playthrough-bench.js';

/** The Master of Whispers' first rung: the bench the Archive scene starts, cancels and finishes. */
const FIRST_RUNG = RESEARCH_ITEMS.find(
  (item) => item.track === 'master_of_whispers' && item.step === 1,
)!.id;

/** The chairs every crew fills from the bench, on top of whoever the Bar gave them. */
const BENCH_CHAIRS: readonly OfficerRole[] = [
  'researcher',
  'right_hand',
  'trader',
  'field_commander',
  'engineer',
  'cartographer',
];

/**
 * Seats the bench's officers, so every track the later scenes need has somebody in its chair.
 *
 * This puts a level-16 crew past its six officer slots, which is the state an old save is in
 * (maintainer, 2026-09-30): the books keep everyone and only the next hire is refused. No scene
 * after this one bids at the Bar, so nothing here is turned away.
 */
export function staffTheCrews(h: Harness, cast: Cast): void {
  for (const label of ['A', 'B', 'C', 'D'] as const) {
    const crew = player(cast, label);
    // A seats the officer it won at the Bar as its Master of Whispers; the others get one here.
    const chairs: readonly OfficerRole[] =
      label === 'A' ? BENCH_CHAIRS : [...BENCH_CHAIRS, 'master_of_whispers'];
    for (const role of chairs) {
      addOfficer(
        h,
        crew,
        createCommander(
          `bench-${label}-${role}`,
          `${label} ${role.replace(/_/g, ' ')}`,
          role,
          makeAttributes(75),
        ),
      );
    }
  }
}

export async function crewScene(h: Harness, cast: Cast): Promise<void> {
  const a = player(cast, 'A');
  const b = player(cast, 'B');
  staffTheCrews(h, cast);
  await chairs(h, a, b);
  await archive(h, a, b);
  await drills(h, a, b);
}

async function chairs(h: Harness, a: Player, b: Player): Promise<void> {
  h.at('crew: the chairs');
  const crew = await h.ok<CrewResponse>({ as: a, method: 'GET', route: '/api/crew' });
  const signed = crew?.officers.find((one) => one.role === null);
  if (!crew || !signed) {
    h.check(false, 'A has nobody on the bench to seat (the Bar should have signed somebody)');
    return;
  }
  const seated = await h.ok<CrewMutationResponse>({
    as: a,
    method: 'POST',
    route: '/api/crew/reassign',
    body: { officerId: signed.officerId, role: 'master_of_whispers' },
  });
  h.check(
    seated?.crew.officers.find((one) => one.officerId === signed.officerId)?.role ===
      'master_of_whispers',
    'the officer did not take the Master of Whispers chair',
  );
  // Re-seating somebody where they already sit changes nothing.
  await h.ok({
    as: a,
    method: 'POST',
    route: '/api/crew/reassign',
    body: { officerId: signed.officerId, role: 'master_of_whispers' },
  });
  const other = crew.officers.find((one) => one.role === 'trader');
  if (other) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/crew/reassign',
      body: { officerId: other.officerId, role: 'master_of_whispers' },
      expect: 409,
      code: 'ROLE_TAKEN',
    });
    // Two people on the bench is fine: the bench is not a chair.
    await h.ok({
      as: a,
      method: 'POST',
      route: '/api/crew/reassign',
      body: { officerId: other.officerId, role: null },
    });
    await h.ok({
      as: a,
      method: 'POST',
      route: '/api/crew/reassign',
      body: { officerId: other.officerId, role: 'trader' },
    });
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/crew/reassign',
    body: { officerId: 'nobody', role: 'trader' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/crew/reassign',
    body: { officerId: signed.officerId, role: 'emperor' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/crew/reassign', { officerId: signed.officerId });
  // B's officers are B's.
  const theirs = await h.ok<CrewResponse>({ as: b, method: 'GET', route: '/api/crew' });
  const bOfficer = theirs?.officers[0];
  if (bOfficer) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/crew/reassign',
      body: { officerId: bOfficer.officerId, role: null },
      expect: 404,
      code: 'NOT_FOUND',
    });
  }
}

async function archive(h: Harness, a: Player, b: Player): Promise<void> {
  h.at('research: the Archive');
  const screen = await h.ok<ResearchResponse>({ as: a, method: 'GET', route: '/api/research' });
  if (!screen) return;
  const rung = screen.technologies.find((tech) => tech.id === FIRST_RUNG);
  h.check(rung !== undefined, 'the Archive does not list the first Whispers rung');
  h.check(rung?.blocker === null, `A cannot start the first Whispers rung: ${rung?.blocker}`);
  const locked = screen.technologies.find((tech) => !tech.known && tech.blocker !== null);
  if (!rung || rung.blocker !== null) return;

  const before = await baseOf(h, a);
  const started = await h.ok<ResearchResponse>({
    as: a,
    method: 'POST',
    route: '/api/research/tech',
    body: { techId: rung.id },
  });
  const afterStart = await baseOf(h, a);
  h.check(started?.active !== null && started?.active !== undefined, 'the Archive started nothing');
  expectDelta(
    h,
    before.resources,
    afterStart.resources,
    negate(rung.cost),
    'starting the first Whispers rung',
  );
  const other = screen.technologies.find(
    (tech) => tech.id !== rung.id && !tech.known && tech.blocker === null,
  );
  if (other) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/research/tech',
      body: { techId: other.id },
      expect: 409,
      code: 'RESEARCH_BUSY',
    });
  }
  // Called straight off: ninety percent back.
  const cancelled = await h.ok<ResearchResponse>({
    as: a,
    method: 'POST',
    route: '/api/research/cancel',
    body: {},
  });
  h.check(cancelled?.active === null, 'the cancelled project is still on the bench');
  const afterCancel = await baseOf(h, a);
  expectDelta(
    h,
    afterStart.resources,
    afterCancel.resources,
    cancelRefund(rung.cost),
    'cancelling the first Whispers rung',
  );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/research/cancel',
    body: {},
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/research/cancel', []);

  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/research/tech',
    body: { techId: 'tech_nothing' },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuseMalformed(a, '/api/research/tech', { techId: 9 });
  if (locked) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/research/tech',
      body: { techId: locked.id },
      expect: 409,
      code: 'RESEARCH_OPTION_LOCKED',
    });
  }
  // An empty till.
  const flush = await baseOf(h, a);
  if ((rung.cost.caps ?? 0) > 0) {
    h.repos.bases.updateResources(a.baseId, { ...flush.resources, caps: 0 });
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/research/tech',
      body: { techId: rung.id },
      expect: 409,
      code: 'INSUFFICIENT_CAPS',
    });
    h.repos.bases.updateResources(a.baseId, flush.resources);
  }

  // Started again and left to finish.
  const again = await h.ok<ResearchResponse>({
    as: a,
    method: 'POST',
    route: '/api/research/tech',
    body: { techId: rung.id },
  });
  if (again?.completesAt) h.advanceTo(new Date(again.completesAt).getTime() + MINUTE);
  const done = await h.ok<ResearchResponse>({ as: a, method: 'GET', route: '/api/research' });
  h.check(
    Boolean(done?.technologies.find((tech) => tech.id === FIRST_RUNG)?.known),
    'the first Whispers rung is not known after its clock ran out',
  );
  h.check(done?.active === null, 'the finished project is still on the bench');
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/research/tech',
    body: { techId: FIRST_RUNG },
    expect: 409,
    code: 'RESEARCH_EXHAUSTED',
  });
  void b;
}

async function drills(h: Harness, a: Player, b: Player): Promise<void> {
  h.at('drills: the floor');
  const floor = await h.ok<TrainingResponse>({ as: a, method: 'GET', route: '/api/training' });
  if (!floor) return;
  const overseer = floor.subjects.find((one) => one.id === OVERSEER_SUBJECT);
  if (!overseer) {
    h.check(false, 'the Overseer is not on the drill floor');
    return;
  }
  const attribute = 'stamina';
  const was = overseer.attributes[attribute];
  const started = await h.ok<TrainingResponse>({
    as: a,
    method: 'POST',
    route: '/api/training',
    body: { subjectId: OVERSEER_SUBJECT, attribute },
  });
  const session = started?.subjects.find((one) => one.id === OVERSEER_SUBJECT)?.session;
  h.check(session !== null && session !== undefined, 'the drill did not start');
  h.check(
    started?.sessionsLeft === floor.sessionsLeft - 1,
    'starting a drill did not spend a session',
  );
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/training',
    body: { subjectId: OVERSEER_SUBJECT, attribute: 'speed' },
    expect: 409,
    code: 'TRAINING_REFUSED',
  });
  if (session) {
    const cancelled = await h.ok<TrainingResponse>({
      as: a,
      method: 'POST',
      route: '/api/training/cancel',
      body: { sessionId: session.id },
    });
    h.check(
      cancelled?.sessionsLeft === floor.sessionsLeft,
      'cancelling a drill did not hand the session back',
    );
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/training/cancel',
      body: { sessionId: session.id },
      expect: 404,
      code: 'NOT_FOUND',
    });
  }
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/training',
    body: { subjectId: 'nobody', attribute },
    expect: 404,
    code: 'NOT_FOUND',
  });
  await h.refuse({
    as: a,
    method: 'POST',
    route: '/api/training',
    body: { subjectId: OVERSEER_SUBJECT, attribute: 'luck' },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuseMalformed(a, '/api/training', { subjectId: OVERSEER_SUBJECT });
  await h.refuseMalformed(a, '/api/training/cancel', { sessionId: 1 });
  // B's officer is not on A's floor.
  const bFloor = await h.ok<TrainingResponse>({ as: b, method: 'GET', route: '/api/training' });
  const bOfficer = bFloor?.subjects.find((one) => one.id !== OVERSEER_SUBJECT);
  if (bOfficer) {
    await h.refuse({
      as: a,
      method: 'POST',
      route: '/api/training',
      body: { subjectId: bOfficer.id, attribute },
      expect: 404,
      code: 'NOT_FOUND',
    });
  }

  h.at('drills: an hour on the floor');
  const second = await h.ok<TrainingResponse>({
    as: a,
    method: 'POST',
    route: '/api/training',
    body: { subjectId: OVERSEER_SUBJECT, attribute },
  });
  h.advance((second?.sessionSeconds ?? 3600) * 1000 + MINUTE);
  const standing = await h.ok<CrewStandingResponse>({
    as: a,
    method: 'GET',
    route: '/api/overseer/me',
  });
  const now = standing?.overseer.attributes[attribute] ?? was;
  h.check(
    now === was + (second?.gainPerSession ?? 0),
    `an hour of ${attribute} took the Overseer from ${was} to ${now}, the floor promised +${second?.gainPerSession}`,
  );
}
