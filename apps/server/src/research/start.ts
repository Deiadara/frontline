import {
  canAfford,
  findResearchItem,
  researchItemRefusal,
  spendResources,
  type ActiveResearch,
  type Base,
  type PartialResources,
  type ResearchProject,
} from '@frontline/shared';
import { adminCost, adminMinutes, adminWaives } from '../admin/mode.js';
import type { Repositories } from '../db/repos/index.js';
import { chairMarksFor, minutesFor, priceOf } from './tracks.js';

/**
 * Putting the crew onto a rung of a track (GDD §C): every gate between "put them on it" and a
 * running clock.
 *
 * The Lab has one bench, so the first gate is always whether it is free. What follows is §C2's
 * ladder, translated into the three names below, and then the money.
 */

export interface StartInput {
  base: Base;
  project: ResearchProject;
  id: string;
  now: Date;
  /** Testing mode: a minute rather than hours, and no materials (`admin/mode.ts`). */
  admin?: boolean;
}

export const RESEARCH_REFUSALS = [
  'already_running',
  // §C: the rung does not exist, the rung is already done, and every other gate on it. The third
  // is spelled `locked`, which is the vocabulary `admin/mode.ts` already waives for "behind
  // something you have not reached yet": an empty chair, an officer under the mark and an
  // unfinished rung below are all that, and the testing build should walk past all three.
  'unknown_research',
  'already_researched',
  'locked',
  'cannot_afford',
] as const;
export type ResearchRefusal = (typeof RESEARCH_REFUSALS)[number];

export type StartResult =
  | { kind: 'refused'; reason: ResearchRefusal }
  | { kind: 'started'; base: Base; active: ActiveResearch };

/**
 * The first reason this project cannot start, or `null` if it can.
 *
 * Order matters and follows the fiction: is the bench free, are the two chairs good enough for
 * this rung, and only then, can we pay for it.
 */
function refusalFor(input: StartInput): ResearchRefusal | null {
  const { base, project } = input;
  if (base.research.active) return 'already_running';

  const refusal = trackRefusal(base, project.techId);
  if (refusal) return refusal;

  if (input.admin) return null;
  return canAfford(base.resources, projectCost(base, project)) ? null : 'cannot_afford';
}

/**
 * §C2's gates, mapped onto this module's refusal list.
 *
 * Three names rather than seven: the page already carries the specific reason per rung
 * (`itemBlocker`), and this is the honest last word on a stale tab. What it must keep apart is the
 * refusal admin mode waives (a progress gate) from the one it does not (a statement about reality),
 * which is exactly the `locked` / `already_researched` split.
 */
function trackRefusal(base: Base, techId: string): ResearchRefusal | null {
  const spec = findResearchItem(techId);
  if (!spec) return 'unknown_research';
  const refusal = researchItemRefusal(
    techId,
    base.research.technologies,
    chairMarksFor(base, spec.track),
  );
  if (refusal === null) return null;
  return refusal === 'already_known' ? 'already_researched' : 'locked';
}

/** What this rung costs this crew: the catalogue price with the track officer's cut taken off. */
function projectCost(base: Base, project: ResearchProject): PartialResources {
  const spec = findResearchItem(project.techId);
  return spec ? priceOf(base, spec) : {};
}

/** The rung's own duration with every cut applied: the Lab, the crew's standing, and the Head. */
function projectMinutes(repos: Repositories, input: StartInput): number {
  const spec = findResearchItem(input.project.techId);
  return spec ? minutesFor(repos, input.base, spec) : 1;
}

/**
 * Charges for the rung and starts its clock.
 *
 * `durationMinutes` is copied onto the row here and never re-read from the catalogue, so retuning
 * the numbers cannot retime a project that is already running: the same freeze `launchMission`
 * applies to a crew already out.
 */
export function startResearch(repos: Repositories, input: StartInput): StartResult {
  const refusal = refusalFor(input);
  // The testing build waives the progress and price gates but not the "there is nothing to do"
  // ones: see `admin/mode.ts` for which and why.
  if (refusal && !adminWaives(refusal, input.admin ?? false))
    return { kind: 'refused', reason: refusal };

  const { base, project, id, now, admin = false } = input;
  const active: ActiveResearch = {
    id,
    project,
    startedAt: now.toISOString(),
    durationMinutes: adminMinutes(projectMinutes(repos, input), admin),
  };
  const started: Base = {
    ...base,
    resources: spendResources(base.resources, adminCost(projectCost(base, project), admin)),
    research: { ...base.research, active },
  };

  repos.bases.updateResources(started.id, started.resources);
  repos.bases.updateResearch(started.id, started.research);
  return { kind: 'started', base: started, active };
}
