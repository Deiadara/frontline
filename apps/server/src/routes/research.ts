import { randomUUID } from 'node:crypto';
import {
  HIRING_INSIGHT_ROLES,
  OFFICER_ROLES,
  RESEARCH_COST_CAPS,
  StartResearchRequestSchema,
  researchCompletesAt,
  roleFullyResearched,
  unlocksCrossReference,
  type Base,
  type Overseer,
  type ResearchLead,
  type ResearchResponse,
  type StartResearchResponse,
  describeTechEffect,
  ITEM_CATALOG,
  StartTechRequestSchema,
  TECHNOLOGIES,
  TECH_TRACK_BLUEPRINT,
  buildingLevel,
  canAfford,
  findTech,
  removeItems,
  spendResources,
  techInTrack,
  techRefusal,
  type ItemId,
  type LabTech,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBase } from '../district/settle.js';
import { hasLeadEngineer, modificationOptions } from '../district/modifications.js';
import { holdsBlueprint, holdsParts } from '../market/board.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { pairingsExhausted } from '../research/discover.js';
import { settleResearch } from '../research/settle.js';
import { startResearch, type ResearchRefusal } from '../research/start.js';

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

/** Why a programme cannot be started, in the player's words, or `null`. */
function techBlocker(base: Base, id: string): string | null {
  const spec = findTech(id);
  if (!spec) return 'No such programme';
  const reason = techRefusal(
    id,
    base.research.technologies,
    buildingLevel(base.buildings, 'lab'),
    holdsBlueprint(base),
    (cost) => canAfford(base.resources, cost),
    holdsParts(base),
  );
  if (reason === null) return null;
  switch (reason) {
    case 'unknown_tech':
      return 'No such programme';
    case 'already_known':
      return 'Already running';
    case 'needs_previous_tier': {
      const below = techInTrack(spec.track).find((other) => other.tier === spec.tier - 1);
      return `Finish ${below?.name ?? 'the programme below'} first`;
    }
    case 'needs_blueprint':
      return `Needs the ${ITEM_CATALOG[TECH_TRACK_BLUEPRINT[spec.track]].name}`;
    case 'lab_too_low':
      return `Needs the Lab at level ${spec.requiresLabLevel}`;
    case 'cannot_afford':
      return 'You cannot cover that';
    case 'missing_parts':
      return `Short of parts: ${Object.entries(spec.parts)
        .map(([itemId, count]) => `${count}× ${ITEM_CATALOG[itemId as ItemId].name}`)
        .join(', ')}`;
  }
}

/** The whole tech tree, with each rung's state worked out for this crew. */
function labTechnologies(base: Base): LabTech[] {
  return TECHNOLOGIES.map((spec) => ({
    id: spec.id,
    track: spec.track,
    tier: spec.tier,
    name: spec.name,
    description: spec.description,
    cost: spec.cost,
    parts: spec.parts,
    effect: describeTechEffect(spec),
    known: base.research.technologies.includes(spec.id),
    blocker: base.research.technologies.includes(spec.id) ? null : techBlocker(base, spec.id),
  }));
}

export function registerResearchRoutes(app: FastifyInstance): void {
  app.get('/research', { preHandler: app.authenticate }, (request): ResearchResponse => {
    const now = new Date();
    const user = request.currentUser;
    const { base, overseer, justDiscovered } = settledPlayer(app, user.id, user.overseerId, now);
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
      technologies: labTechnologies(base),
    };
  });

  /**
   * Start a standing programme.
   *
   * Bought outright rather than queued behind the Professor's one project slot: an investigation is
   * somebody's *time*, and the Lab only has one of those to give: a technology is money, parts and
   * a building tall enough to house the work. Putting both through one queue would mean a crew that
   * wants a fact this week cannot also want a programme, which is a false choice dressed as depth.
   */
  app.post('/research/tech', { preHandler: app.authenticate }, (request): ResearchResponse => {
    const { techId } = parseBody(StartTechRequestSchema, request.body);
    const now = new Date();
    const user = request.currentUser;

    return app.db.transaction(() => {
      const { base, overseer, justDiscovered } = settledPlayer(app, user.id, user.overseerId, now);
      const blocker = techBlocker(base, techId);
      if (blocker !== null) throw new AppError('RESEARCH_OPTION_LOCKED', blocker);

      const spec = findTech(techId);
      if (!spec) throw new AppError('NOT_FOUND', 'No such programme');

      const research = {
        ...base.research,
        technologies: [...base.research.technologies, spec.id],
      };
      app.repos.bases.updateHoldings(
        base.id,
        spendResources(base.resources, spec.cost),
        removeItems(base.inventory, spec.parts),
      );
      app.repos.bases.updateResearch(base.id, research);

      const after = { ...base, research, resources: spendResources(base.resources, spec.cost) };
      const { active, facts } = after.research;
      return {
        serverNow: now.toISOString(),
        active,
        completesAt: active ? researchCompletesAt(active).toISOString() : null,
        justDiscovered,
        facts,
        leads: leadsOn(after),
        openRoles: OFFICER_ROLES.filter((role) => !roleFullyResearched(facts, role)),
        pairingsExhausted: pairingsExhausted(facts),
        overseerAttributes: overseer.attributes,
        caps: after.resources.caps,
        costs: RESEARCH_COST_CAPS,
        canModify: hasLeadEngineer(after),
        modifications: modificationOptions(after),
        technologies: labTechnologies(after),
      };
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
