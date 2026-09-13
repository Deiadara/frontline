import {
  FEATS,
  evaluateFeats,
  readyCount,
  type Base,
  type FeatProgress,
  type FeatSnapshot,
  type FeatsResponse,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { featSnapshot, overseerSnapshot } from './snapshot.js';

/**
 * Every threshold the catalogue asks the Overseer's sheet about.
 *
 * Computed once at module load rather than on every read. The set is decided by the catalogue,
 * which is a constant, so recomputing it per request would be the same answer a few thousand times
 * a minute. See `overseerSnapshot` for why these are not simply enumerated.
 */
const OVERSEER_THRESHOLDS: readonly number[] = [
  ...new Set(
    FEATS.filter((feat) => feat.measure === 'overseer_skills_at').map((feat) => Number(feat.scope)),
  ),
].filter((threshold) => Number.isFinite(threshold));

/**
 * Everything a feat could ask about this crew, including the half that lives on their Overseer.
 *
 * Split out from `featSnapshot` because the Overseer is on the *account* and not on the crew, so
 * it needs a second lookup that the pure state walk has no business doing.
 */
export function snapshotFor(repos: Repositories, base: Base): FeatSnapshot {
  const user = repos.users.findById(base.ownerId);
  const overseer = user?.overseerId ? repos.overseers.findById(user.overseerId) : undefined;
  return {
    ...featSnapshot(repos, base),
    ...overseerSnapshot(overseer?.attributes, OVERSEER_THRESHOLDS),
  };
}

export function progressFor(repos: Repositories, base: Base): FeatProgress[] {
  return evaluateFeats(FEATS, snapshotFor(repos, base), repos.feats.claimed(base.id));
}

/**
 * The whole feats screen.
 *
 * Progress only, never the catalogue: see `api.feats.ts` for why the descriptions stay on the
 * client. Locked rows are sent too, rather than filtered out, because the screen draws them as
 * shut doors and a ladder that simply stopped would read as a bug.
 */
export function projectFeats(repos: Repositories, base: Base, now: Date): FeatsResponse {
  const progress = progressFor(repos, base);
  return {
    progress,
    ready: readyCount(progress),
    claimed: progress.filter((one) => one.state === 'claimed').length,
    serverNow: now.toISOString(),
  };
}

/**
 * How many are waiting, for the badge on the bottom bar.
 *
 * The same evaluation the screen does, which is deliberate: a badge saying three over a screen
 * showing two would be two answers to one question. It is a handful of indexed reads plus a walk
 * over a constant array, and it rides on the `/me` poll the shell already runs.
 */
export function featsReadyCount(repos: Repositories, base: Base): number {
  return readyCount(progressFor(repos, base));
}
