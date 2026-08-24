import { randomUUID } from 'node:crypto';
import {
  LaunchMissionRequestSchema,
  RecallMissionRequestSchema,
  canRecall,
  findMissionTemplate,
  type Base,
  type LaunchMissionResponse,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { resolveCrew } from '../missions/crew.js';
import { CONCURRENT_MISSION_LIMIT, launchMission } from '../missions/launch.js';
import { standingEffectsFor } from '../crew/standing.js';
import { resolveDueMissions } from '../missions/resolve.js';

/** The caller's own base — a player runs missions from their one base or from nowhere. */
function requireOwnBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) {
    throw new AppError('NO_BASE', 'You do not have a base yet');
  }
  return base;
}

export function registerMissionRoutes(app: FastifyInstance): void {
  app.get('/missions', { preHandler: app.authenticate }, (request): MissionsResponse => {
    const now = new Date();
    const own = requireOwnBase(app, request.currentUser.id);
    const settlement = resolveDueMissions(app.repos, own, now);

    return {
      missions: app.repos.missions.listByBaseId(settlement.base.id).map((stored) => stored.mission),
      justResolved: settlement.resolved,
      resources: settlement.base.resources,
      activeLimit: CONCURRENT_MISSION_LIMIT,
      serverNow: now.toISOString(),
      levelUp: settlement.levelUp,
    };
  });

  app.post('/missions', { preHandler: app.authenticate }, (request): LaunchMissionResponse => {
    const { templateId, officerId } = parseBody(LaunchMissionRequestSchema, request.body);
    const template = findMissionTemplate(templateId);
    if (!template) {
      throw new AppError('NOT_FOUND', 'That mission is not on the board');
    }

    const now = new Date();
    const own = requireOwnBase(app, request.currentUser.id);

    // §G6 — naming somebody who does not work here is a 404, not an unled run: silently demoting it
    // to a delegation would charge the §G6 penalty for what is really a stale tab or a typo.
    //
    // Checked *before* the settle so a doomed request never banks one (MOU-280): the settle's
    // level-up can only be announced by the response that caused it, and this one is an error
    // envelope. The lookup reads `base.commanders`, which a settlement never touches, so hoisting
    // it changes no answer. The checks below cannot follow it up: both read state the settle moves.
    const officer = officerId ? own.commanders.find((held) => held.id === officerId) : undefined;
    if (officerId !== undefined && !officer) {
      throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
    }

    // Settle first: a mission that came home while the player was reading the board frees a slot
    // they should be allowed to use on this very request.
    const { base, levelUp } = resolveDueMissions(app.repos, own, now);
    if (app.repos.missions.countActiveByBaseId(base.id) >= CONCURRENT_MISSION_LIMIT) {
      throw new AppError(
        'MISSIONS_AT_CAPACITY',
        'Every crew you have is already out on a mission',
        levelUp,
      );
    }

    // §F5 — the run rides on the player's own character, so the Overseer is read here and the
    // modified chance is frozen onto the row by `launchMission`.
    const overseer = request.currentUser.overseerId
      ? app.repos.overseers.findById(request.currentUser.overseerId)
      : undefined;
    // §G6 — hard runs need an officer; easy ones can go out on assignees alone. The crew also
    // fixes the §G5/§G7 multipliers, which `launchMission` freezes onto the row beside §F5's.
    //
    // This sizes the delegation off `base.level`, which the settle above may just have raised, so
    // it runs on the settled base: hoisting it would refuse a crew the level-up had already paid
    // for. Its refusal therefore carries the level-up out on the envelope instead.
    const crew = resolveCrew({ base, template, officer });
    if (!crew.terms.allowed) {
      throw new AppError(
        crew.terms.refusal === 'needs_officer' ? 'MISSION_NEEDS_OFFICER' : 'NO_ASSIGNEES',
        crew.terms.refusal === 'needs_officer'
          ? 'That job is too hard to run without an officer leading it'
          : 'You have nobody free to send',
        levelUp,
      );
    }

    const stored = launchMission({
      id: randomUUID(),
      base,
      template,
      now,
      overseer,
      terms: crew.terms,
      officer,
      admin: app.config.admin,
      // §A4 — the ground this crew holds takes time off the road (the Smuggler's Tunnel).
      missionSpeedPercent: standingEffectsFor(app.repos, base, now).missionSpeedPercent,
    });
    app.repos.missions.insert(stored);
    // The settle above is the only place this level-up is ever reported: the next `GET /missions`
    // re-resolves nothing, so dropping it here loses it outright rather than deferring it.
    return { mission: stored.mission, serverNow: now.toISOString(), levelUp };
  });

  /**
   * §E — turn a crew around.
   *
   * Not a cancel: the mission stays on the books and still settles, it just settles as a failure
   * with nothing in the bag. The clock is not rewritten either — `recalledAt` is recorded and the
   * return leg is derived from it, so the report afterwards can still say how long the run was
   * meant to take and how far they got before the order reached them.
   */
  app.post('/missions/recall', { preHandler: app.authenticate }, (request): MissionsResponse => {
    const { missionId } = parseBody(RecallMissionRequestSchema, request.body);
    const now = new Date();
    const base = requireOwnBase(app, request.currentUser.id);

    return app.db.transaction(() => {
      const stored = app.repos.missions.findById(missionId);
      if (!stored || stored.mission.baseId !== base.id) {
        throw new AppError('NOT_FOUND', 'No mission of yours by that id');
      }
      if (!canRecall(stored.mission, now)) {
        throw new AppError('MISSION_REFUSED', 'They are already at the gate');
      }
      app.repos.missions.markRecalled(missionId, now.toISOString());
      return {
        missions: app.repos.missions.listByBaseId(base.id).map((entry) => entry.mission),
        justResolved: [],
        resources: base.resources,
        activeLimit: CONCURRENT_MISSION_LIMIT,
        serverNow: now.toISOString(),
      };
    })();
  });
}
