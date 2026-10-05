import {
  drillEndsAt,
  queueCompletesAt,
  researchCompletesAt,
  musterCompletesAt,
} from '@frontline/shared';
import type { BaseWork } from '../db/repos/bases.js';
import type { Repositories } from '../db/repos/index.js';
import { settleEach } from '../world/guard.js';
import { settleBase } from './settle.js';

/**
 * Whether any of a crew's own clocks has run out: a build, a batch of units, a Lab rung or a drill.
 * The same instants `settleBase` banks at, read off the same shared functions.
 */
export function workDue(work: BaseWork, now: Date): boolean {
  const at = now.getTime();
  return (
    work.buildQueue.some((order) => queueCompletesAt(order).getTime() <= at) ||
    work.musterQueue.some((order) => musterCompletesAt(order).getTime() <= at) ||
    (work.research.active !== null && researchCompletesAt(work.research.active).getTime() <= at) ||
    work.training.sessions.some((session) => drillEndsAt(session) <= at)
  );
}

/**
 * Banks every crew's finished work, whether or not its owner is looking (maintainer ruling,
 * 2026-09-29: settle finished work).
 *
 * A crew's builds, batches, research and drills were banked, and their XP paid, only when that
 * crew's owner read a screen, so the standings, a crew's file and a faction's levels showed an
 * offline crew as it was when its owner last looked: a rival saw level 1 and a Nexus at 1 on a crew
 * that had eight Nexus levels finished an hour ago. Shaped like the crews-coming-home sweep: the
 * candidates are crews with something under way, and a crew is loaded and settled only when one
 * of its clocks has run out, each in its own transaction (`settleEach`).
 *
 * Returns how many crews it settled.
 */
export function settleFinishedWork(repos: Repositories, now: Date): number {
  const due = repos.bases.listWorkInFlight().filter((work) => workDue(work, now));
  return settleEach(
    repos,
    'finished work',
    due,
    (work) => work.id,
    (work) => {
      const base = repos.bases.findById(work.id);
      if (base) settleBase(repos, base, now);
    },
  );
}
