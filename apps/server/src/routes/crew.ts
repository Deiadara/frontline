import type { FastifyInstance } from 'fastify';
import {
  ReassignOfficerRequestSchema,
  type CrewMutationResponse,
  type CrewResponse,
} from '@frontline/shared';
import { AppError, parseBody } from '../errors.js';
import { projectCrew } from '../crew/roster.js';
import { ownBase } from './own-base.js';

/**
 * The crew (GDD §C2, §G).
 *
 * This was `/assignees`, and it carried three writes: place some of the level-granted pool under an
 * officer, reskill the whole map at once, and move somebody between chairs. The first two went with
 * the pool. What is left is the read and the one write that was never about assignees at all.
 */
export function registerCrewRoutes(app: FastifyInstance): void {
  app.get('/crew', { preHandler: app.authenticate }, (request): CrewResponse => {
    return projectCrew(app.repos, ownBase(app, request.currentUser.id));
  });

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
   */
  app.post('/crew/reassign', { preHandler: app.authenticate }, (request): CrewMutationResponse => {
    const { officerId, role } = parseBody(ReassignOfficerRequestSchema, request.body);
    return app.db.transaction(() => {
      const base = ownBase(app, request.currentUser.id);
      const officer = base.commanders.find((candidate) => candidate.id === officerId);
      if (!officer) throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
      if (officer.role === role) return { crew: projectCrew(app.repos, base) };

      /*
       * A chair holds one officer. The bench holds as many as you have signed.
       *
       * `role === null` is the absence of a chair, not a chair called "none", so the occupancy
       * check has to skip it: without the guard, moving a second person to the bench would be
       * refused as "somebody already holds that position", which is both wrong and a confusing
       * thing to be told about a bench.
       */
      const taken =
        role !== null &&
        base.commanders.some((candidate) => candidate.role === role && candidate.id !== officerId);
      if (taken) throw new AppError('ROLE_TAKEN', 'Somebody already holds that position');

      const commanders = base.commanders.map((candidate) =>
        candidate.id === officerId ? { ...candidate, role } : candidate,
      );
      app.repos.bases.updateCommanders(base.id, commanders);
      return { crew: projectCrew(app.repos, { ...base, commanders }) };
    })();
  });
}
