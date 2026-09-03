import { randomUUID } from 'node:crypto';
import {
  HIRING_INSIGHT_ROLES,
  OFFICER_ROLES,
  RESEARCH_COST_CAPS,
  StartResearchRequestSchema,
  StartTechRequestSchema,
  researchCompletesAt,
  roleFullyResearched,
  unlocksCrossReference,
  type Base,
  type Overseer,
  type ResearchLead,
  type ResearchResponse,
  type StartResearchResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBase } from '../district/settle.js';
import { hasLeadEngineer, modificationOptions } from '../district/modifications.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { pairingsExhausted } from '../research/discover.js';
import { settleResearch } from '../research/settle.js';
import { startResearch, type ResearchRefusal } from '../research/start.js';
import { labResearchItems, researchHead, trackStatuses } from '../research/tracks.js';

/**
 * Research and discovery (GDD §B9, §F2-§F4).
 *
 * The response carries **discovered facts only**. There is no fit score, no weight, no ordering and
 * nothing keyed by role id anywhere in it: §B9 is the one feature allowed to put role knowledge on
 * the wire, which makes it the one that has to prove it did not put the table there
 * (§B8a, INTERFACES R4). `apps/server/src/research/discovery.leak.test.ts` asserts that over this
 * route's real response body, because the W1 guard scans client-reachable directories and a server
 * route is outside all of them.
 */

interface Player {
  base: Base;
  overseer: Overseer;
}

/**
 * The caller's base and Overseer, with everything that settles on the clock already settled.
 *
 * Payroll first, then research: a project that landed while the player was away is banked before
 * the page is rendered, so the facts it produced are on the very response that reports it done.
 */
function settledPlayer(
  app: FastifyInstance,
  ownerId: string,
  overseerId: string | null,
  now: Date,
): Player & { justDiscovered: ResearchResponse['justDiscovered'] } {
  const owned = app.repos.bases.findByOwnerId(ownerId);
  if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');

  const chosen = overseerId ? app.repos.overseers.findById(overseerId) : undefined;
  if (!chosen) throw new AppError('NO_BASE', 'You have not chosen an Overseer yet');

  const settlement = settleResearch(app.repos, settleBase(app.repos, owned, now).base, chosen, now);
  return {
    base: settlement.base,
    overseer: settlement.overseer,
    justDiscovered: settlement.discovered,
  };
}

/** §B9/§C4 + §F4, who could lead an investigation, and what their own sheet unlocks. */
function leadsOn(base: Base): ResearchLead[] {
  return (
    base.commanders
      // Narrowed to a seated officer, so `role` below is a chair rather than possibly the bench.
      .flatMap((officer) =>
        officer.role !== null && HIRING_INSIGHT_ROLES.includes(officer.role)
          ? [{ ...officer, role: officer.role }]
          : [],
      )
      .map((officer) => ({
        officerId: officer.id,
        name: officer.name,
        role: officer.role,
        crossReference: unlocksCrossReference(officer.attributes),
      }))
  );
}

/**
 * Every refusal is a 409 except the missing lead, which is the crew being unequipped rather than
 * busy. The client can pre-empt all of them from `GET /research`, so these are the honest last
 * word on a stale tab, not the primary way a player learns the rules.
 */
const REFUSAL_ERRORS: Record<ResearchRefusal, { code: ErrorCode; message: string }> = {
  already_running: { code: 'RESEARCH_BUSY', message: 'Your people are already on something' },
  unknown_research: { code: 'NOT_FOUND', message: 'No such research' },
  already_researched: { code: 'RESEARCH_EXHAUSTED', message: 'That is already done' },
  locked: {
    code: 'RESEARCH_OPTION_LOCKED',
    message: 'Your people are not ready for that yet',
  },
  no_lead: {
    code: 'NO_RESEARCH_LEAD',
    message: 'Only a Professor or a Head of Research can run that',
  },
  option_locked: {
    code: 'RESEARCH_OPTION_LOCKED',
    message: 'They lack the imagination to see the connections',
  },
  nothing_to_learn: {
    code: 'RESEARCH_EXHAUSTED',
    message: 'There is nothing further to be learned there',
  },
  unknown_modification: {
    code: 'MODIFICATION_UNAVAILABLE',
    message: 'No such modification',
  },
  modification_unavailable: {
    code: 'MODIFICATION_UNAVAILABLE',
    message: 'That structure is not standing yet',
  },
  no_modification_slot: {
    code: 'NO_MODIFICATION_SLOT',
    message: 'That structure has no free slot. Raise it further first',
  },
  no_lead_engineer: {
    code: 'NO_LEAD_ENGINEER',
    message: 'Modification work needs a Lead Engineer on the books',
  },
  cannot_afford: { code: 'INSUFFICIENT_CAPS', message: 'You cannot cover the costs' },
};

/**
 * The whole research screen, for one settled crew.
 *
 * One projection rather than two copies: the read and the launch both answer with it, so a field
 * added to the response cannot reach the page on one path and not the other.
 */
function researchScreen(
  app: FastifyInstance,
  base: Base,
  overseer: Overseer,
  justDiscovered: ResearchResponse['justDiscovered'],
  now: Date,
): ResearchResponse {
  const { active, facts } = base.research;
  return {
    serverNow: now.toISOString(),
    active,
    completesAt: active ? researchCompletesAt(active).toISOString() : null,
    justDiscovered,
    facts,
    leads: leadsOn(base),
    openRoles: OFFICER_ROLES.filter((role) => !roleFullyResearched(facts, role)),
    pairingsExhausted: pairingsExhausted(facts),
    overseerAttributes: overseer.attributes,
    caps: base.resources.caps,
    costs: RESEARCH_COST_CAPS,
    canModify: hasLeadEngineer(base),
    modifications: modificationOptions(base),
    technologies: labResearchItems(app.repos, base),
    tracks: trackStatuses(base),
    head: researchHead(base),
  };
}

export function registerResearchRoutes(app: FastifyInstance): void {
  app.get('/research', { preHandler: app.authenticate }, (request): ResearchResponse => {
    const now = new Date();
    const user = request.currentUser;
    const { base, overseer, justDiscovered } = settledPlayer(app, user.id, user.overseerId, now);
    return researchScreen(app, base, overseer, justDiscovered, now);
  });

  /**
   * §C: put the crew on one rung of one track.
   *
   * On the Lab's one bench rather than bought outright, which reverses the earlier call and is the
   * point of §C3a: a rung takes *time*, and the Head of Research's own sheet is what shortens it.
   * A programme that landed the instant it was paid for had nothing for their points to buy.
   *
   * Kept on its own route, with its own request body, so the client's `startTech` call and every
   * fixture built on it still work: the difference is that this now answers with a running clock.
   */
  app.post('/research/tech', { preHandler: app.authenticate }, (request): ResearchResponse => {
    const { techId } = parseBody(StartTechRequestSchema, request.body);
    const now = new Date();
    const user = request.currentUser;

    return app.db.transaction(() => {
      const { base, overseer, justDiscovered } = settledPlayer(app, user.id, user.overseerId, now);
      const result = startResearch(app.repos, {
        base,
        overseer,
        project: { kind: 'technology', techId },
        id: randomUUID(),
        now,
        admin: app.config.admin,
      });
      if (result.kind === 'refused') {
        const { code, message } = REFUSAL_ERRORS[result.reason];
        throw new AppError(code, message);
      }
      return researchScreen(app, result.base, overseer, justDiscovered, now);
    })();
  });

  app.post('/research', { preHandler: app.authenticate }, (request): StartResearchResponse => {
    const project = parseBody(StartResearchRequestSchema, request.body);
    const now = new Date();
    const user = request.currentUser;
    // Settle first: a project that landed while the player was reading the page frees the slot
    // they should be allowed to use on this very request.
    const { base, overseer } = settledPlayer(app, user.id, user.overseerId, now);

    const result = startResearch(app.repos, {
      base,
      overseer,
      project,
      id: randomUUID(),
      now,
      admin: app.config.admin,
    });
    if (result.kind === 'refused') {
      const { code, message } = REFUSAL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    return {
      active: result.active,
      completesAt: researchCompletesAt(result.active).toISOString(),
      resources: result.base.resources,
    };
  });
}
