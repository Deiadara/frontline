import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';

/**
 * Research projects (GDD §C): the one thing the crew can put time into.
 *
 * The Lab has one bench and one kind of work on it, a rung of one of the nineteen role tracks.
 * It runs on the real clock and settles lazily on read, exactly like missions (§E2) and payroll
 * (§H7): there is no scheduler to keep alive, and a crew nobody looks at owes the same result
 * whenever it is next opened.
 */

/**
 * §C: one rung of one of the nineteen role tracks (`tracks.ts`).
 *
 * A rung is a project rather than an outright purchase, which is what §C3a needs: a programme that
 * landed the moment it was paid for has no time for the Head of Research's points to cut. What it
 * costs and how long it takes are per rung and come from the catalogue, so neither is here.
 */
export const TechnologyProjectSchema = z.object({
  kind: z.literal('technology'),
  techId: z.string().min(1),
});
export type TechnologyProject = z.infer<typeof TechnologyProjectSchema>;

/**
 * What the Lab can be put on.
 *
 * A discriminated union of one rather than the bare object: the desk used to add three more kinds
 * here, every reader still switches on `kind`, and a second kind is a member rather than a rewrite
 * of every call site.
 */
export const ResearchProjectSchema = z.discriminatedUnion('kind', [TechnologyProjectSchema]);
export type ResearchProject = z.infer<typeof ResearchProjectSchema>;
export type ResearchProjectKind = ResearchProject['kind'];

/**
 * A project in flight.
 *
 * `durationMinutes` is worked out at launch and never re-read, for the same reason `MissionSchema`
 * freezes its clock: retuning the numbers must not retime a project that is already running.
 */
export const ActiveResearchSchema = z.object({
  id: IdSchema,
  project: ResearchProjectSchema,
  startedAt: IsoDateTimeSchema,
  durationMinutes: z.number().int().positive(),
});
export type ActiveResearch = z.infer<typeof ActiveResearchSchema>;

const MINUTE_MS = 60_000;

/**
 * Anything the Lab is running on a frozen clock.
 *
 * Structural rather than {@link ActiveResearch} itself, because §C's track rung is a second row
 * with the same two fields and no project on it. One set of clock helpers for both, so a countdown
 * cannot be right on one screen and wrong on the other.
 */
export interface ResearchClock {
  startedAt: string;
  durationMinutes: number;
}

export function researchCompletesAt(active: ResearchClock): Date {
  return new Date(Date.parse(active.startedAt) + active.durationMinutes * MINUTE_MS);
}

/** Milliseconds until the result lands; never negative. */
export function researchRemainingMs(active: ResearchClock, now: Date): number {
  return Math.max(0, researchCompletesAt(active).getTime() - now.getTime());
}

/** Fraction of the project completed, clamped to 0..1: the progress bar on the research page. */
export function researchProgressAt(active: ResearchClock, now: Date): number {
  const elapsedMs = now.getTime() - Date.parse(active.startedAt);
  return Math.min(1, Math.max(0, elapsedMs / (active.durationMinutes * MINUTE_MS)));
}

/** True once the clock is up but the result has not been banked: what the settler looks for. */
export function isResearchDue(active: ResearchClock, now: Date): boolean {
  return researchRemainingMs(active, now) === 0;
}
