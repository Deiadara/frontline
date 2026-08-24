import {
  OFFICER_ROLE_LABELS,
  OVERSEER_SUBJECT,
  TRAINING_GAIN,
  TRAINING_SECONDS,
  TRAININGS_PER_DAY,
  applyGain,
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

  if (overseer) {
    subjects.push({
      id: OVERSEER_SUBJECT,
      name: overseer.name,
      role: 'Overseer',
      portraitId: overseer.portraitId,
      attributes: overseer.attributes,
      traits: overseer.traits,
      session: sessionFor(state, OVERSEER_SUBJECT) ?? null,
      lastAttribute: state.last[OVERSEER_SUBJECT] ?? null,
    });
  }

  for (const officer of base.commanders) {
    subjects.push({
      id: officer.id,
      name: officer.name,
      role: OFFICER_ROLE_LABELS[officer.role],
      portraitId: null,
      attributes: officer.attributes,
      traits: officer.traits,
      session: sessionFor(state, officer.id) ?? null,
      lastAttribute: state.last[officer.id] ?? null,
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
