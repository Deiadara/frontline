import { z } from 'zod';
import { ATTRIBUTE_NAMES } from '../attributes.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import type { PartialResources } from '../resources.js';
import { OfficerRoleSchema } from '../roles.js';

/**
 * Research projects (GDD §B9, §F2): the two things the crew can put time into.
 *
 * An **investigation** is §B9's librarian-ish task: somebody senior reads the room, the files and
 * the last decade of who worked out where, and comes back knowing one more thing about what a job
 * actually needs. A **training** project is §F2: the Overseer develops one of their own attributes.
 *
 * Both are one-at-a-time and run on the real clock, settled lazily on read exactly like missions
 * (§E2) and payroll (§H7). There is no scheduler to keep alive, and a crew nobody looks at owes
 * the same result whenever it is next opened.
 */

/**
 * §B9/§C4: an investigation is led by one held officer. Which roles may lead is *not* decided
 * here: `HIRING_INSIGHT_ROLES` in `roles.ts` is W1's, and the server gates on it (INTERFACES R4).
 */
export const InvestigationProjectSchema = z.object({
  kind: z.literal('investigation'),
  /** The job being investigated. Roles are public (§C1); what they *need* is not (§B8a). */
  role: OfficerRoleSchema,
  leadOfficerId: IdSchema,
  /** §F4: the extra option, available only when the lead's Imagination unlocks it. */
  crossReference: z.boolean(),
});
export type InvestigationProject = z.infer<typeof InvestigationProjectSchema>;

/** §F2: the Overseer develops one attribute. Any of them, including irrelevant ones (§B6). */
export const TrainingProjectSchema = z.object({
  kind: z.literal('training'),
  attribute: z.enum(ATTRIBUTE_NAMES),
});
export type TrainingProject = z.infer<typeof TrainingProjectSchema>;

/**
 * §A1: modification work: designing and fitting one of a structure's five upgrades.
 *
 * It sits in the research queue rather than in the build queue on purpose. A modification is not
 * bought and it is not a level; it is *worked out*, which is the same crew and the same bench the
 * Lab already occupies, and it means a district cannot fit three modifications at once any more
 * than it can run three investigations at once.
 *
 * Unlike an investigation, the lead is not chosen: §C4 makes this the Lead Engineer's work, and
 * the server reads which officer holds that role rather than taking one on the request.
 */
export const ModificationProjectSchema = z.object({
  kind: z.literal('modification'),
  modificationId: z.string().min(1),
});
export type ModificationProject = z.infer<typeof ModificationProjectSchema>;

/**
 * A discriminated union rather than one wide object with nullable fields: an investigation always
 * has a lead and never an attribute, and a training project is the other way round. Neither state
 * can be written down wrong.
 */
export const ResearchProjectSchema = z.discriminatedUnion('kind', [
  InvestigationProjectSchema,
  TrainingProjectSchema,
  ModificationProjectSchema,
]);
export type ResearchProject = z.infer<typeof ResearchProjectSchema>;
export type ResearchProjectKind = ResearchProject['kind'];

/** How long each kind takes, inside §E7's band so it reads as the same game as the mission board. */
export const RESEARCH_MINUTES: Record<ResearchProjectKind, number> = {
  investigation: 45,
  training: 90,
  /** The longest of the three: a modification is permanent, and permanence is priced in hours. */
  modification: 180,
};

/** What each kind costs up front, in caps (§D2). Charged at launch, never refunded. */
export const RESEARCH_COST_CAPS: Record<ResearchProjectKind, number> = {
  investigation: 120,
  training: 200,
  modification: 350,
};

/**
 * Materials a modification needs on top of its caps: the only research project that builds
 * anything physical, and the reason the Garage's high-quality metal has somewhere to go.
 */
export const MODIFICATION_MATERIALS: PartialResources = {
  scrap: 220,
  oil: 60,
  highQualityMetal: 45,
};

/** The whole bill for a project, caps and materials together. */
export function researchCost(kind: ResearchProjectKind): PartialResources {
  return kind === 'modification'
    ? { ...MODIFICATION_MATERIALS, caps: RESEARCH_COST_CAPS[kind] }
    : { caps: RESEARCH_COST_CAPS[kind] };
}

/**
 * A project in flight.
 *
 * `durationMinutes` is copied off `RESEARCH_MINUTES` at launch and never re-read, for the same
 * reason `MissionSchema` freezes its clock: retuning the numbers must not retime a project that is
 * already running.
 */
export const ActiveResearchSchema = z.object({
  id: IdSchema,
  project: ResearchProjectSchema,
  startedAt: IsoDateTimeSchema,
  durationMinutes: z.number().int().positive(),
});
export type ActiveResearch = z.infer<typeof ActiveResearchSchema>;

const MINUTE_MS = 60_000;

export function researchCompletesAt(active: ActiveResearch): Date {
  return new Date(Date.parse(active.startedAt) + active.durationMinutes * MINUTE_MS);
}

/** Milliseconds until the result lands; never negative. */
export function researchRemainingMs(active: ActiveResearch, now: Date): number {
  return Math.max(0, researchCompletesAt(active).getTime() - now.getTime());
}

/** Fraction of the project completed, clamped to 0..1: the progress bar on the research page. */
export function researchProgressAt(active: ActiveResearch, now: Date): number {
  const elapsedMs = now.getTime() - Date.parse(active.startedAt);
  return Math.min(1, Math.max(0, elapsedMs / (active.durationMinutes * MINUTE_MS)));
}

/** True once the clock is up but the result has not been banked: what the settler looks for. */
export function isResearchDue(active: ActiveResearch, now: Date): boolean {
  return researchRemainingMs(active, now) === 0;
}
