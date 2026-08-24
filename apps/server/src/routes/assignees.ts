import {
  PlaceAssigneesRequestSchema,
  ReassignOfficerRequestSchema,
  ReskillRequestSchema,
  placeAssignees,
  reskillAssignees,
  type AssigneesMutationResponse,
  type AssigneesResponse,
  type Base,
  type PlacementRefusal,
  type ReskillRefusal,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { projectAssignees, settleAssignees } from '../assignees/roster.js';
import { districtPopulation } from '../district/population.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';

/**
 * The assignee layer (GDD §G).
 *
 * Two writes, and they are deliberately asymmetric. §G2 placement adds people to an officer and
 * can never take them back; §G4 reskilling rewrites the whole map at once but needs a Professor
 * (§C4). That asymmetry is the feature, it is what a Professor is *for*, so it lives in two
 * routes rather than one endpoint with a flag.
 */

/** A player has one base, so the pool has one home. */
function ownBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
  // Officers who have walked out (§H5) still hold placements until this sweep runs, and a stale
  // map must never be what a write is validated against.
  return settleAssignees(app.repos, base);
}

const PLACEMENT_ERRORS: Record<PlacementRefusal, { code: ErrorCode; message: string }> = {
  unknown_officer: { code: 'NOT_FOUND', message: 'Nobody on your books by that id' },
  not_positive: { code: 'VALIDATION_ERROR', message: 'Place at least one assignee' },
  not_enough_unplaced: {
    code: 'NO_ASSIGNEES',
    message: 'You have nobody left in the pool to place',
  },
  at_cap: { code: 'ASSIGNEES_AT_CAP', message: 'That officer cannot take any more' },
};

const RESKILL_ERRORS: Record<ReskillRefusal, { code: ErrorCode; message: string }> = {
  no_professor: { code: 'NO_PROFESSOR', message: 'Reskilling needs a Professor on the books' },
  unknown_officer: { code: 'NOT_FOUND', message: 'Nobody on your books by that id' },
  at_cap: { code: 'ASSIGNEES_AT_CAP', message: 'That plan puts too many under one officer' },
  over_pool: { code: 'NO_ASSIGNEES', message: 'That plan places more assignees than you have' },
};

export function registerAssigneeRoutes(app: FastifyInstance): void {
  app.get('/assignees', { preHandler: app.authenticate }, (request): AssigneesResponse => {
    return projectAssignees(app.repos, ownBase(app, request.currentUser.id));
  });

  /** §G2: place the assignees a level-up handed over. */
  app.post(
    '/assignees/place',
    { preHandler: app.authenticate },
    (request): AssigneesMutationResponse => {
      const { officerId, count } = parseBody(PlaceAssigneesRequestSchema, request.body);
      const base = ownBase(app, request.currentUser.id);

      const result = placeAssignees(base.assignees, {
        officers: base.commanders,
        commanderId: officerId,
        count,
        level: base.level,
      });
      if (result.kind === 'refused') {
        const { code, message } = PLACEMENT_ERRORS[result.reason];
        throw new AppError(code, message);
      }

      // §A1: the Quarters put a ceiling on the whole district, officers and assignees alike.
      // Checked *after* the §G rules on purpose: the pool and the per-officer cap are what the
      // player is entitled to, and housing is the district's own limit on top of that. Told the
      // other way round, a player short of beds would be told to build even when the placement
      // was never legal in the first place.
      const population = districtPopulation(app.repos, base);
      if (count > population.spare) {
        throw new AppError(
          'NO_HOUSING',
          `Your district houses ${population.capacity}. Raise the Quarters or take more ground`,
        );
      }

      app.repos.bases.updateAssignees(base.id, result.state);
      return { assignees: projectAssignees(app.repos, { ...base, assignees: result.state }) };
    },
  );

  /** §G4/§C4: the Professor's process: reassign everyone at once. */
  app.post(
    '/assignees/reskill',
    { preHandler: app.authenticate },
    (request): AssigneesMutationResponse => {
      const { placements } = parseBody(ReskillRequestSchema, request.body);
      const base = ownBase(app, request.currentUser.id);

      const result = reskillAssignees({
        officers: base.commanders,
        plan: placements,
        level: base.level,
      });
      if (result.kind === 'refused') {
        const { code, message } = RESKILL_ERRORS[result.reason];
        throw new AppError(code, message);
      }

      app.repos.bases.updateAssignees(base.id, result.state);
      return { assignees: projectAssignees(app.repos, { ...base, assignees: result.state }) };
    },
  );

  /**
   * §C2: move an officer into a different position.
   *
   * A hire is a person, not a job title: the sheet a player weighed at the Bar does not change
   * when the crew's needs do, and being stuck with the role you picked in the first thirty seconds
   * of meeting somebody is the kind of decision a game should let you take back.
   *
   * The position has to be *open*. Two people cannot hold one job, and a swap is two reassignments
   * with an empty seat in between, which is a decision the player should have to make on purpose
   * rather than something a route quietly does for them.
   *
   * Their assignees stay with them. The pool is placed under a *person*, not under a title.
   */
  app.post(
    '/assignees/reassign',
    { preHandler: app.authenticate },
    (request): AssigneesMutationResponse => {
      const { officerId, role } = parseBody(ReassignOfficerRequestSchema, request.body);
      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const officer = base.commanders.find((candidate) => candidate.id === officerId);
        if (!officer) throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
        if (officer.role === role) {
          return { assignees: projectAssignees(app.repos, base) };
        }
        const taken = base.commanders.some(
          (candidate) => candidate.role === role && candidate.id !== officerId,
        );
        if (taken) throw new AppError('ROLE_TAKEN', 'Somebody already holds that position');

        const commanders = base.commanders.map((candidate) =>
          candidate.id === officerId ? { ...candidate, role } : candidate,
        );
        app.repos.bases.updateCommanders(base.id, commanders);
        return { assignees: projectAssignees(app.repos, { ...base, commanders }) };
      })();
    },
  );
}
