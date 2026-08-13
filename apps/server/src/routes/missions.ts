import { randomUUID } from 'node:crypto';
import {
  LaunchMissionRequestSchema,
  findMissionTemplate,
  type Base,
  type LaunchMissionResponse,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { resolveCrew } from '../missions/crew.js';
import { CONCURRENT_MISSION_LIMIT, launchMission } from '../missions/launch.js';
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
    // Settle first: a mission that came home while the player was reading the board frees a slot
    // they should be allowed to use on this very request.
    const { base } = resolveDueMissions(app.repos, own, now);
    if (app.repos.missions.countActiveByBaseId(base.id) >= CONCURRENT_MISSION_LIMIT) {
      throw new AppError('MISSIONS_AT_CAPACITY', 'Every crew you have is already out on a mission');
    }

    // §F5 — the run rides on the player's own character, so the Overseer is read here and the
    // modified chance is frozen onto the row by `launchMission`.
    const overseer = request.currentUser.overseerId
      ? app.repos.overseers.findById(request.currentUser.overseerId)
      : undefined;
    // §G6 — hard runs need an officer; easy ones can go out on assignees alone. The crew also
    // fixes the §G5/§G7 multipliers, which `launchMission` freezes onto the row beside §F5's.
    //
    // Naming somebody who does not work here is a 404, not an unled run: silently demoting it to a
    // delegation would charge the §G6 penalty for what is really a stale tab or a typo.
    const officer = officerId ? base.commanders.find((held) => held.id === officerId) : undefined;
    if (officerId !== undefined && !officer) {
      throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
    }
    const crew = resolveCrew({ base, template, officer });
    if (!crew.terms.allowed) {
      throw new AppError(
        crew.terms.refusal === 'needs_officer' ? 'MISSION_NEEDS_OFFICER' : 'NO_ASSIGNEES',
        crew.terms.refusal === 'needs_officer'
          ? 'That job is too hard to run without an officer leading it'
          : 'You have nobody free to send',
      );
    }

    const stored = launchMission({
      id: randomUUID(),
      base,
      template,
      now,
      overseer,
      terms: crew.terms,
    });
    app.repos.missions.insert(stored);
    return { mission: stored.mission, serverNow: now.toISOString() };
  });
}
