import type { FastifyInstance } from 'fastify';
import { requireAreaFor } from '../progression/doors.js';
import {
  LEADER_HOLD_MESSAGES,
  ReassignOfficerRequestSchema,
  type CrewMutationResponse,
  type CrewResponse,
} from '@frontline/shared';
import { AppError, parseBody } from '../errors.js';
import { projectCrew } from '../crew/roster.js';
import { ownBase } from './own-base.js';
import { settleBase } from '../district/settle.js';
import { officerDuty } from '../crew/duty.js';
import { resolveDueMissions } from '../missions/resolve.js';

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
    requireAreaFor(app.repos, request.currentUser.id, 'crew');
    const { officerId, role } = parseBody(ReassignOfficerRequestSchema, request.body);
    const now = new Date();
    return app.db.transaction(() => {
      /*
       * Settle before the reseat, like every other write route.
       *
       * `settleDistrict` reads the crew's `productionPercent` once and spends it across the whole
       * elapsed window, on the stated grounds that a crew does not change halfway through a settle.
       * This route was the one that made that false: seat an officer where their best attribute
       * pays, and the *unsettled* hours behind you are then banked at the new rate. A day of
       * production for two HTTP calls and a third to put them back.
       */
      // The runs as well, so a leader whose crew walked in while the player was reading the
      // roster is free to move on this very request rather than held by a run that is over.
      const settled = settleBase(app.repos, ownBase(app, request.currentUser.id), now).base;
      const base = resolveDueMissions(app.repos, settled, now).base;
      const officer = base.commanders.find((candidate) => candidate.id === officerId);
      if (!officer) throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
      if (officer.role === role) return { crew: projectCrew(app.repos, base) };

      /*
       * Not while they are out leading something (maintainer, 2026-09-28).
       *
       * The bench leads nothing, and every run keeps its leader, so taking a leader out of their
       * chair mid-run would leave the run with nobody at its head. A move between chairs waits
       * too: the settle spends the rungs of whichever chair the leader sits in at the mark, so a
       * swap mid-run would buy a fight with a chair that never went out. Laid up is fine, as it
       * is for a release: the bed is not a job.
       */
      const duty = officerDuty(app.repos, base, officer, now);
      if (duty !== null && (duty.held === 'run' || duty.held === 'fight')) {
        throw new AppError(
          'STALE_STATE',
          `${officer.name} ${LEADER_HOLD_MESSAGES[duty.held]}. Seat changes wait until they are back`,
        );
      }

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
