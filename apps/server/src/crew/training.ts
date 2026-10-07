import {
  markFromPoints,
  ATTRIBUTE_LABELS,
  BENCH_LABEL,
  OFFICER_ROLE_LABELS,
  OVERSEER_SUBJECT,
  TRAINING_GAIN,
  TRAINING_QUEUE_SLOTS,
  TRAINING_SECONDS,
  TRAININGS_PER_DAY,
  applyGain,
  drillEndsAt,
  drillSeconds,
  officerPortraits,
  rollDay,
  sessionFor,
  settleTraining,
  trainingsLeft,
  type Base,
  type Commander,
  type LeaderHold,
  type OfficerMark,
  type Overseer,
  type TrainingGain,
  type TrainingSession,
  type TrainingResponse,
  type TrainingSubject,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';
import { officerDuty } from './duty.js';
import { projectCrewOfficer } from './roster.js';
import {
  liftedOfficerSheet,
  liftedOverseerSheet,
  officerLiftRoom,
  standingEffectsFor,
} from './standing.js';

/**
 * Paying out the drilling (§F2).
 *
 * Lazy, like every other clock in this game: nothing runs on a timer, and an hour that finished
 * while nobody was looking is banked the next time anybody reads the board. The one thing that is
 * *not* like the others is where the gain lands: a session on the Overseer writes the `overseers`
 * table and a session on an officer writes the base's officer blob, so this is the only settler in
 * the codebase that touches two tables. Both writes go inside one transaction at the call site.
 */

export interface SettledTraining {
  base: Base;
  overseer: Overseer | undefined;
  /** The hours that landed on this settle, oldest first. Empty when nothing finished. */
  gains: TrainingGain[];
  /** When the last of those hours ended, which is what their receipt is dated. Null with no gains. */
  finishedAt: Date | null;
}

/**
 * Everything finished, applied, written, and announced.
 *
 * Returns the base and Overseer as they now stand rather than re-reading them, so a caller can
 * project a response without a second round trip disagreeing with what was just committed.
 */
export function settleTrainingFor(repos: Repositories, base: Base, now: string): SettledTraining {
  const settled = bankTrainingFor(repos, base, now);
  announceDrills(repos, settled.base, settled);
  return settled;
}

/**
 * The same, without the receipt: for `settleBase`, which banks drills at every cut point in its
 * window and sends one receipt for all of them once the window is walked.
 */
export function bankTrainingFor(repos: Repositories, base: Base, now: string): SettledTraining {
  const overseer = overseerOf(repos, base);
  const { state, gains } = settleTraining(base.training, now);
  const finishedAt = lastDrillEnded(base.training.sessions, now);

  if (gains.length === 0) {
    // The day may still have rolled even with nothing to pay out, and a rolled day is a state
    // change: not writing it means the allowance is recomputed on every read forever.
    if (state !== base.training) repos.bases.updateTraining(base.id, state, base.commanders);
    return { base: { ...base, training: state }, overseer, gains, finishedAt };
  }

  let commanders: Commander[] = base.commanders;
  let developed = overseer;
  for (const gain of gains) {
    if (gain.subjectId === OVERSEER_SUBJECT) {
      if (developed)
        developed = { ...developed, attributes: applyGain(developed.attributes, gain) };
      continue;
    }
    commanders = commanders.map((officer) =>
      officer.id === gain.subjectId
        ? { ...officer, attributes: applyGain(officer.attributes, gain) }
        : officer,
    );
  }

  repos.bases.updateTraining(base.id, state, commanders);
  if (developed && developed !== overseer) {
    repos.overseers.updateAttributes(developed.id, developed.attributes);
  }
  return { base: { ...base, training: state, commanders }, overseer: developed, gains, finishedAt };
}

/** The end of the latest session that is over by `now`, or null when none is. */
function lastDrillEnded(sessions: readonly TrainingSession[], now: string): Date | null {
  const cutoff = Date.parse(now);
  const ended = sessions.map(drillEndsAt).filter((end) => end <= cutoff);
  return ended.length === 0 ? null : new Date(Math.max(...ended));
}

/**
 * §F2: and the player is told, which they were not.
 *
 * `training_done` has been in the catalogue since notifications were written, with a label, a
 * blurb, an icon and a switch of its own on the settings screen, and **nothing has ever sent
 * one**: a player could turn "Training" off and on and change nothing either way. The same bug
 * `unit_mustered` had, fixed the same way and in the same place, at the settler that already knows
 * the work landed (`district/settle.ts` says so in as many words).
 *
 * One per settle rather than one per session. Drilling is lazy like every other clock here, so a
 * crew that has been away all night settles a day's sessions in one read, and a receipt each
 * would be a burst of identical lines about an hour that finished eleven hours ago.
 */
export function announceDrills(
  repos: Repositories,
  base: Base,
  drilled: Pick<SettledTraining, 'gains' | 'finishedAt'>,
): void {
  const { gains, finishedAt } = drilled;
  const [who] = gains;
  if (!who || finishedAt === null) return;
  const first =
    who.subjectId === OVERSEER_SUBJECT
      ? (overseerOf(repos, base)?.name ?? 'Your Overseer')
      : (base.commanders.find((officer) => officer.id === who.subjectId)?.name ?? 'Somebody');
  notifyBase(repos, base.id, {
    kind: 'training_done',
    title:
      gains.length === 1
        ? `${first} finished an hour on ${ATTRIBUTE_LABELS[who.attribute]}`
        : `${gains.length} hours on the floor are done`,
    body:
      gains.length === 1
        ? 'The sheet has moved.'
        : `Starting with ${first} on ${ATTRIBUTE_LABELS[who.attribute]}.`,
    link: '/game/training',
    // Dated when the last of them ended, not at the read that noticed.
    at: finishedAt,
  });
}

/** The Overseer behind a base, through the user who owns it. */
export function overseerOf(repos: Repositories, base: Base): Overseer | undefined {
  const owner = repos.users.findById(base.ownerId);
  if (!owner?.overseerId) return undefined;
  return repos.overseers.findById(owner.overseerId);
}

/**
 * How long an hour on the floor takes each person on these books, by subject id (2026-10-01).
 *
 * `drillSeconds` of the sheet the crew fields them with: the lifted one, which their march and
 * their spy work already read (maintainer, 2026-09-30), so a Right Hand who makes everybody
 * quicker on the road makes them quicker at the bench too. The Overseer is lifted by the Right
 * Hand alone, as everywhere else. The route stores the answer on the session when it starts.
 *
 * Then the ground's cut (`trainingTimePercent`, the Exercise Yard, maintainer 2026-10-06): off
 * everybody's clock alike, after the sheet has set it, so a held yard shortens the Overseer's hour
 * as much as a recruit's.
 */
export function drillSecondsBySubject(
  repos: Repositories,
  base: Base,
  overseer: Overseer | undefined,
  now: Date,
): Map<string, number> {
  const room = officerLiftRoom(repos, base, now);
  const ground = standingEffectsFor(repos, base, now).trainingTimePercent;
  const onTheGround = (sheetSeconds: number): number =>
    Math.max(1, Math.round(sheetSeconds * (1 - Math.min(100, Math.max(0, ground)) / 100)));
  const seconds = new Map<string, number>();
  if (overseer) {
    seconds.set(
      OVERSEER_SUBJECT,
      onTheGround(drillSeconds(liftedOverseerSheet(overseer.attributes, room))),
    );
  }
  for (const officer of base.commanders) {
    seconds.set(
      officer.id,
      onTheGround(drillSeconds(liftedOfficerSheet(officer, room).attributes)),
    );
  }
  return seconds;
}

/**
 * Each officer's mark for the chair they are in, by subject id, for the portraits on the tab.
 *
 * Through `projectCrewOfficer` on the same lifted sheet the crew screen projects, so the stamp on
 * the training rail is the stamp on the crew card and cannot drift from it. The bench has no chair
 * and so no mark; the Overseer's mark is their own grade, on the Overseer's seat.
 */
export function officerMarksBySubject(
  repos: Repositories,
  base: Base,
  now: Date,
): Map<string, OfficerMark> {
  const room = officerLiftRoom(repos, base, now);
  const marks = new Map<string, OfficerMark>();
  for (const officer of base.commanders) {
    const { mark } = projectCrewOfficer(officer, liftedOfficerSheet(officer, room));
    if (mark !== null) marks.set(officer.id, mark);
  }
  // The Overseer's own grade, on their own seat (maintainer, 2026-10-04).
  if (room.overseerPoints !== null) {
    marks.set(OVERSEER_SUBJECT, markFromPoints(room.overseerPoints));
  }
  return marks;
}

/**
 * The Training tab, as a response.
 *
 * The Overseer leads the list because they are the person a player thinks of first and the only
 * one who is always there. Officers follow in hiring order, which is the order they appear
 * everywhere else.
 */
export function projectTraining(
  base: Base,
  overseer: Overseer | undefined,
  now: string,
  /** §A4: sessions the ground adds on top of the day's allowance. The Gym. */
  extraSessions = 0,
  /** Drills the queue holds: `TRAINING_QUEUE_SLOTS` plus the Professor's rung. */
  queueSlots = TRAINING_QUEUE_SLOTS,
  /** Each person's own hour, from {@link drillSecondsBySubject}. Absent is the plain hour. */
  sessionSeconds: ReadonlyMap<string, number> = new Map(),
  /** Each person's stamp, from {@link officerMarksBySubject}. Absent is no stamp. */
  marks: ReadonlyMap<string, OfficerMark> = new Map(),
  /** Who is away from the floor, from {@link drillHolds}. Absent is free. */
  holds: ReadonlyMap<string, LeaderHold> = new Map(),
): TrainingResponse {
  const state = rollDay(base.training, now);
  const subjects: TrainingSubject[] = [];
  // Faces for the whole roster at once: per-officer hashing puts the same face on two of them on
  // 39% of rosters, which is the birthday problem rather than an unlucky save.
  const faces = officerPortraits(base.commanders.map((officer) => officer.id));

  if (overseer) {
    subjects.push({
      id: OVERSEER_SUBJECT,
      name: overseer.name,
      role: 'Overseer',
      // No chair, so no skill is more or less useful than another: the sheet draws plain.
      officerRole: null,
      portraitId: overseer.portraitId,
      mark: marks.get(OVERSEER_SUBJECT) ?? null,
      attributes: overseer.attributes,
      perks: overseer.perks,
      session: sessionFor(state, OVERSEER_SUBJECT) ?? null,
      lastAttribute: state.last[OVERSEER_SUBJECT] ?? null,
      // The player is never a casualty: §D4 is about officers, and the Overseer leads nothing.
      injuredUntil: null,
      held: holds.get(OVERSEER_SUBJECT) ?? null,
      sessionSeconds: sessionSeconds.get(OVERSEER_SUBJECT) ?? TRAINING_SECONDS,
    });
  }

  for (const officer of base.commanders) {
    subjects.push({
      id: officer.id,
      name: officer.name,
      // §C2: somebody on the bench still trains. They are on the books, they are being paid, and
      // an hour on the bench is the cheapest hour a crew ever buys.
      role: officer.role === null ? BENCH_LABEL : OFFICER_ROLE_LABELS[officer.role],
      officerRole: officer.role,
      // The stored face (maintainer, 2026-09-11), with the old derived one behind it for an officer
      // written before the column existed and not yet backfilled.
      portraitId: officer.portraitId ?? faces.get(officer.id) ?? null,
      mark: marks.get(officer.id) ?? null,
      attributes: officer.attributes,
      perks: officer.perks,
      session: sessionFor(state, officer.id) ?? null,
      lastAttribute: state.last[officer.id] ?? null,
      injuredUntil: officer.injuredUntil,
      // Out on a run, held for a fight or laid up: none of them drills (maintainer, 2026-10-06).
      held: holds.get(officer.id) ?? null,
      sessionSeconds: sessionSeconds.get(officer.id) ?? TRAINING_SECONDS,
    });
  }

  return {
    serverNow: now,
    sessionsLeft: trainingsLeft(state, now, extraSessions),
    perDay: TRAININGS_PER_DAY + Math.max(0, extraSessions),
    queueSlots,
    gainPerSession: TRAINING_GAIN,
    sessionSeconds: TRAINING_SECONDS,
    subjects,
  };
}

/**
 * Who is away from the training floor, by subject: an officer leading a run, held for a fight or
 * laid up, and the Overseer out leading a run (maintainer, 2026-10-06). The bench is not a hold:
 * somebody benched still drills.
 */
export function drillHolds(repos: Repositories, base: Base, now: Date): Map<string, LeaderHold> {
  const holds = new Map<string, LeaderHold>();
  for (const officer of base.commanders) {
    const duty = officerDuty(repos, base, officer, now);
    if (duty !== null && duty.held !== 'bench') holds.set(officer.id, duty.held);
  }
  const overseerOut = repos.missions
    .listActiveByBaseId(base.id)
    .some((entry) => entry.mission.overseerLed);
  if (overseerOut) holds.set(OVERSEER_SUBJECT, 'run');
  return holds;
}
