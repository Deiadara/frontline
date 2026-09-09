import { randomUUID } from 'node:crypto';
import {
  StartTechRequestSchema,
  researchCompletesAt,
  type Base,
  type ResearchResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { startResearch, type ResearchRefusal } from '../research/start.js';
import { labResearchItems, researchHead, trackStatuses } from '../research/tracks.js';

/**
 * Research (GDD §C): the nineteen role tracks and the Lab's one bench.
 *
 * Nothing in the response is keyed by role id beyond the track list itself, and the only role
 * knowledge on it is the mark, which is the coarse hint §B8a allows. The scores behind the marks
 * and the percentages stay server-side (INTERFACES R4).
 */

/**
 * The caller's district, with everything that settles on the clock already settled.
 *
 * A rung that landed while the player was away is banked before the page is rendered, so the very
 * response that reports it done already counts it as finished. `settleBase` does that now, for
 * every route rather than only for these two.
 */
function settledBase(
  app: FastifyInstance,
  ownerId: string,
  overseerId: string | null,
  now: Date,
): Base {
  const owned = app.repos.bases.findByOwnerId(ownerId);
  if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');

  // The screen is the Overseer's Lab, so a player who has not chosen one has no screen. The
  // *settle* no longer needs them: `settleBase` banks a finished rung on every read path there is
  // (`research/settle.ts`), so this route is a reader like every other one.
  if (!overseerId || !app.repos.overseers.findById(overseerId)) {
    throw new AppError('NO_BASE', 'You have not chosen an Overseer yet');
  }

  return settleBase(app.repos, owned, now).base;
}

/**
 * Every refusal is a 409. The client can pre-empt all of them from `GET /research`, so these are
 * the honest last word on a stale tab, not the primary way a player learns the rules.
 */
const REFUSAL_ERRORS: Record<ResearchRefusal, { code: ErrorCode; message: string }> = {
  already_running: { code: 'RESEARCH_BUSY', message: 'Your people are already on something' },
  unknown_research: { code: 'NOT_FOUND', message: 'No such research' },
  already_researched: { code: 'RESEARCH_EXHAUSTED', message: 'That is already done' },
  locked: {
    code: 'RESEARCH_OPTION_LOCKED',
    message: 'Your people are not ready for that yet',
  },
  cannot_afford: { code: 'INSUFFICIENT_CAPS', message: 'You cannot cover the costs' },
};

/**
 * The whole research screen, for one settled crew.
 *
 * One projection rather than two copies: the read and the launch both answer with it, so a field
 * added to the response cannot reach the page on one path and not the other.
 */
function researchScreen(app: FastifyInstance, base: Base, now: Date): ResearchResponse {
  const { active } = base.research;
  return {
    serverNow: now.toISOString(),
    active,
    completesAt: active ? researchCompletesAt(active).toISOString() : null,
    caps: base.resources.caps,
    technologies: labResearchItems(app.repos, base),
    tracks: trackStatuses(base),
    head: researchHead(base),
  };
}

export function registerResearchRoutes(app: FastifyInstance): void {
  app.get('/research', { preHandler: app.authenticate }, (request): ResearchResponse => {
    const now = new Date();
    const user = request.currentUser;
    return researchScreen(app, settledBase(app, user.id, user.overseerId, now), now);
  });

  /**
   * §C: put the crew on one rung of one track.
   *
   * On the Lab's one bench rather than bought outright, which is the point of §C3a: a rung takes
   * *time*, and the Head of Research's own sheet is what shortens it. A programme that landed the
   * instant it was paid for had nothing for their points to buy.
   */
  app.post('/research/tech', { preHandler: app.authenticate }, (request): ResearchResponse => {
    const { techId } = parseBody(StartTechRequestSchema, request.body);
    const now = new Date();
    const user = request.currentUser;

    return app.db.transaction(() => {
      const result = startResearch(app.repos, {
        base: settledBase(app, user.id, user.overseerId, now),
        project: { kind: 'technology', techId },
        id: randomUUID(),
        now,
        admin: app.config.admin,
      });
      if (result.kind === 'refused') {
        const { code, message } = REFUSAL_ERRORS[result.reason];
        throw new AppError(code, message);
      }
      return researchScreen(app, result.base, now);
    })();
  });
}
