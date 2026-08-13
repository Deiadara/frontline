import {
  HIRING_INSIGHT_ROLES,
  RESEARCH_COST_CAPS,
  RESEARCH_MINUTES,
  canDevelop,
  roleFullyResearched,
  unlocksCrossReference,
  type ActiveResearch,
  type Base,
  type Overseer,
  type ResearchProject,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { pairingsExhausted } from './discover.js';

/**
 * Putting the crew onto a research project (GDD §B9, §F2, §F4) — every gate between "look into
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
}

export const RESEARCH_REFUSALS = [
  'already_running',
  'no_lead',
  'option_locked',
  'nothing_to_learn',
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
    // §B9/§C4 — a Professor or Head of Research, gated on W1's constant rather than a second
    // hardcoded role check (INTERFACES R4).
    const lead = base.commanders.find((officer) => officer.id === project.leadOfficerId);
    if (!lead || !HIRING_INSIGHT_ROLES.includes(lead.role)) return 'no_lead';
    if (project.crossReference && !unlocksCrossReference(lead.attributes)) return 'option_locked';

    // A role at `MAX_ROLE_FACTS` has nothing left to give, and a cross-reference-only run is
    // pointless once the pairing cap is reached — refuse rather than charge for nothing.
    const roleDone = roleFullyResearched(base.research.facts, project.role);
    if (roleDone && (!project.crossReference || pairingsExhausted(base.research.facts))) {
      return 'nothing_to_learn';
    }
  } else if (!canDevelop(overseer.attributes, project.attribute)) {
    return 'nothing_to_learn';
  }

  return base.resources.caps < RESEARCH_COST_CAPS[project.kind] ? 'cannot_afford' : null;
}

/**
 * Charges for the project and starts its clock.
 *
 * `durationMinutes` is copied onto the row here and never re-read from `RESEARCH_MINUTES`, so
 * retuning the catalogue cannot retime a project that is already running — the same freeze
 * `launchMission` applies to a crew already out.
 */
export function startResearch(repos: Repositories, input: StartInput): StartResult {
  const refusal = refusalFor(input);
  if (refusal) return { kind: 'refused', reason: refusal };

  const { base, project, id, now } = input;
  const active: ActiveResearch = {
    id,
    project,
    startedAt: now.toISOString(),
    durationMinutes: RESEARCH_MINUTES[project.kind],
  };
  const started: Base = {
    ...base,
    resources: { ...base.resources, caps: base.resources.caps - RESEARCH_COST_CAPS[project.kind] },
    research: { ...base.research, active },
  };

  repos.bases.updateResources(started.id, started.resources);
  repos.bases.updateResearch(started.id, started.research);
  return { kind: 'started', base: started, active };
}
