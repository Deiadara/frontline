import {
  HIRING_INSIGHT_ROLES,
  RESEARCH_MINUTES,
  canAfford,
  canDevelop,
  findModification,
  researchCost,
  researchTimeReduction,
  roleFullyResearched,
  spendResources,
  unlocksCrossReference,
  withReduction,
  type ActiveResearch,
  type Base,
  type Overseer,
  type ResearchProject,
  speedMultiplier,
} from '@frontline/shared';
import { adminCost, adminMinutes, adminWaives } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { modificationBlocker } from '../district/modifications.js';
import { pairingsExhausted } from './discover.js';

/**
 * Putting the crew onto a research project (GDD §B9, §F2, §F4): every gate between "look into
 * this" and a running clock.
 *
 * The §F4 gate is the interesting one: the cross-reference option is not silently dropped when the
 * lead cannot unlock it, it is *refused*. §F4 says the option stays locked without the Imagination
 * for it, and an option that quietly does nothing when you pick it is not locked, it is broken.
 */

export interface StartInput {
  base: Base;
  overseer: Overseer;
  project: ResearchProject;
  id: string;
  now: Date;
  /** Testing mode: a minute rather than hours, and no materials (`admin/mode.ts`). */
  admin?: boolean;
}

export const RESEARCH_REFUSALS = [
  'already_running',
  'no_lead',
  'option_locked',
  'nothing_to_learn',
  // §A1 modification work adds three of its own: the structure, the slot and the engineer.
  'unknown_modification',
  'modification_unavailable',
  'no_modification_slot',
  'no_lead_engineer',
  'cannot_afford',
] as const;
export type ResearchRefusal = (typeof RESEARCH_REFUSALS)[number];

export type StartResult =
  | { kind: 'refused'; reason: ResearchRefusal }
  | { kind: 'started'; base: Base; active: ActiveResearch };

/**
 * The first reason this project cannot start, or `null` if it can.
 *
 * Order matters and follows the fiction: is anyone free, is the right person free, can they do the
 * thing that was asked, is there anything left to find, and only then, can we pay for it.
 */
function refusalFor(input: StartInput): ResearchRefusal | null {
  const { base, overseer, project } = input;
  if (base.research.active) return 'already_running';

  if (project.kind === 'investigation') {
    // §B9/§C4: a Professor or Head of Research, gated on W1's constant rather than a second
    // hardcoded role check (INTERFACES R4).
    const lead = base.commanders.find((officer) => officer.id === project.leadOfficerId);
    // A benched officer leads nothing: an investigation is run out of a chair, and the whole
    // point of the bench is that they are not in one yet.
    if (!lead || lead.role === null || !HIRING_INSIGHT_ROLES.includes(lead.role)) return 'no_lead';
    if (project.crossReference && !unlocksCrossReference(lead.attributes)) return 'option_locked';

    // A role at `MAX_ROLE_FACTS` has nothing left to give, and a cross-reference-only run is
    // pointless once the pairing cap is reached: refuse rather than charge for nothing.
    const roleDone = roleFullyResearched(base.research.facts, project.role);
    if (roleDone && (!project.crossReference || pairingsExhausted(base.research.facts))) {
      return 'nothing_to_learn';
    }
  } else if (project.kind === 'training') {
    if (!canDevelop(overseer.attributes, project.attribute)) return 'nothing_to_learn';
  } else {
    const refusal = modificationRefusal(base, project.modificationId);
    if (refusal) return refusal;
  }

  if (input.admin) return null;
  return canAfford(base.resources, researchCost(project.kind)) ? null : 'cannot_afford';
}

/**
 * The §A1 gates, mapped from the blocker the district screen already reports onto this module's
 * own refusal list. One translation, so the two screens can never disagree about why.
 */
function modificationRefusal(base: Base, id: string): ResearchRefusal | null {
  const spec = findModification(id);
  if (!spec) return 'unknown_modification';
  switch (modificationBlocker(base, spec)) {
    case 'not_built':
      return 'modification_unavailable';
    case 'no_slot':
      return 'no_modification_slot';
    case 'no_lead_engineer':
      return 'no_lead_engineer';
    // `research_busy` is already refused above as `already_running`, and `cannot_afford` is the
    // shared check below: neither needs a second home here.
    default:
      return null;
  }
}

/**
 * Charges for the project and starts its clock.
 *
 * `durationMinutes` is copied onto the row here and never re-read from `RESEARCH_MINUTES`, so
 * retuning the catalogue cannot retime a project that is already running: the same freeze
 * `launchMission` applies to a crew already out.
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
    // §A1: the Lab is what makes research quick, and its cut is frozen onto the row with
    // everything else. Floored at a minute: a project that lands the instant it starts has no
    // clock, and the whole screen is built around one.
    // §F2, and the people, on top of the Lab. Analysis reads the failure, Improvisation gets a
    // result out of the wrong equipment; a crew with neither works at the catalogue rate.
    durationMinutes: adminMinutes(
      Math.max(
        1,
        Math.round(
          withReduction(RESEARCH_MINUTES[project.kind], researchTimeReduction(base.buildings)) /
            speedMultiplier(standingEffectsFor(repos, base).researchSpeedPercent),
        ),
      ),
      admin,
    ),
  };
  const started: Base = {
    ...base,
    resources: spendResources(base.resources, adminCost(researchCost(project.kind), admin)),
    research: { ...base.research, active },
  };

  repos.bases.updateResources(started.id, started.resources);
  repos.bases.updateResearch(started.id, started.research);
  return { kind: 'started', base: started, active };
}
