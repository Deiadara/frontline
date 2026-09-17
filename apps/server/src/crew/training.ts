import {
  ATTRIBUTE_LABELS,
  BENCH_LABEL,
  OFFICER_ROLE_LABELS,
  OVERSEER_SUBJECT,
  TRAINING_GAIN,
  TRAINING_SECONDS,
  TRAININGS_PER_DAY,
  applyGain,
  officerPortraits,
  rollDay,
  sessionFor,
  settleTraining,
  trainingsLeft,
  type Base,
  type Commander,
  type Overseer,
  type TrainingResponse,
  type TrainingSubject,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';

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
}

/**
 * Everything finished, applied, and written.
 *
 * Returns the base and Overseer as they now stand rather than re-reading them, so a caller can
 * project a response without a second round trip disagreeing with what was just committed.
 */
export function settleTrainingFor(repos: Repositories, base: Base, now: string): SettledTraining {
  const overseer = overseerOf(repos, base);
  const { state, gains } = settleTraining(base.training, now);

  if (gains.length === 0) {
    // The day may still have rolled even with nothing to pay out, and a rolled day is a state
    // change: not writing it means the allowance is recomputed on every read forever.
    if (state !== base.training) repos.bases.updateTraining(base.id, state, base.commanders);
    return { base: { ...base, training: state }, overseer };
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

  /*
   * §F2: and the player is told, which they were not.
   *
   * `training_done` has been in the catalogue since notifications were written, with a label, a
   * blurb, an icon and a switch of its own on the settings screen, and **nothing has ever sent
   * one**: a player could turn "Training" off and on and change nothing either way. The same bug
   * `unit_trained` had, fixed the same way and in the same place, at the settler that already knows
   * the work landed (`district/settle.ts` says so in as many words).
   *
   * One per settle rather than one per session. Drilling is lazy like every other clock here, so a
   * crew that has been away all night settles a day's sessions in one read, and a receipt each
   * would be a burst of identical lines about an hour that finished eleven hours ago.
   */
  const who = gains[0];
  const first = who
    ? who.subjectId === OVERSEER_SUBJECT
      ? (developed?.name ?? 'Your Overseer')
      : (commanders.find((officer) => officer.id === who.subjectId)?.name ?? 'Somebody')
    : 'Somebody';
  notifyBase(repos, base.id, {
    kind: 'training_done',
    title:
      gains.length === 1
        ? `${first} finished an hour on ${ATTRIBUTE_LABELS[who!.attribute]}`
        : `${gains.length} hours on the floor are done`,
    body:
      gains.length === 1
        ? 'The sheet has moved.'
        : `Starting with ${first} on ${ATTRIBUTE_LABELS[who!.attribute]}.`,
    link: '/game/training',
    now: new Date(now),
  });

  return { base: { ...base, training: state, commanders }, overseer: developed };
}

/** The Overseer behind a base, through the user who owns it. */
export function overseerOf(repos: Repositories, base: Base): Overseer | undefined {
  const owner = repos.users.findById(base.ownerId);
  if (!owner?.overseerId) return undefined;
  return repos.overseers.findById(owner.overseerId);
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
      attributes: overseer.attributes,
      perks: overseer.perks,
      session: sessionFor(state, OVERSEER_SUBJECT) ?? null,
      lastAttribute: state.last[OVERSEER_SUBJECT] ?? null,
      // The player is never a casualty: §D4 is about officers, and the Overseer leads nothing.
      injuredUntil: null,
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
      attributes: officer.attributes,
      perks: officer.perks,
      session: sessionFor(state, officer.id) ?? null,
      lastAttribute: state.last[officer.id] ?? null,
      // §D4: an injured officer still trains. What is off is their services to the crew, and an
      // hour in a bed reading is exactly the hour somebody laid up has going spare.
      injuredUntil: officer.injuredUntil,
    });
  }

  return {
    serverNow: now,
    sessionsLeft: trainingsLeft(state, now, extraSessions),
    perDay: TRAININGS_PER_DAY + Math.max(0, extraSessions),
    gainPerSession: TRAINING_GAIN,
    sessionSeconds: TRAINING_SECONDS,
    subjects,
  };
}
