import { randomUUID } from 'node:crypto';
import {
  CITY_DISTRICTS,
  LaunchMissionRequestSchema,
  MISC_AREA_ID,
  RecallMissionRequestSchema,
  canRecall,
  concurrentMissionSlots,
  findMissionTemplate,
  missionForceRefusal,
  missionBoardDay,
  missionOffers,
  type Base,
  type LaunchMissionResponse,
  type MissionForceRefusal,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { removeForce } from '../battle/forces.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { areaStatesFor, projectAreas } from '../missions/board.js';
import { resolveCrew } from '../missions/crew.js';
import { launchMission } from '../missions/launch.js';
import { standingEffectsFor } from '../crew/standing.js';
import { resolveDueMissions } from '../missions/resolve.js';

/** Why a crew cannot go, in the player's words. */
const FORCE_ERRORS: Record<MissionForceRefusal, { code: ErrorCode; message: string }> = {
  no_force: { code: 'NO_FORCE', message: 'Send somebody, or do not send anybody' },
  not_enough_units: { code: 'NO_FORCE', message: 'You do not have those units at home' },
  needs_fighters: {
    code: 'MISSION_REFUSED',
    message: 'Somebody there has to be able to fight. Porters do not go in alone',
  },
};

/** The caller's own base: a player runs missions from their one base or from nowhere. */
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

    const stored = app.repos.missions.listByBaseId(settlement.base.id);
    const active = stored.filter((entry) => entry.mission.status === 'active');

    return {
      missions: stored.map((entry) => entry.mission),
      justResolved: settlement.resolved,
      resources: settlement.base.resources,
      activeLimit: concurrentMissionSlots(settlement.base.level),
      areas: projectAreas(
        CITY_DISTRICTS,
        areaStatesFor(app.repos, settlement.base),
        active,
        settlement.base.level,
        missionBoardDay(now),
      ),
      army: settlement.base.army,
      serverNow: now.toISOString(),
      levelUp: settlement.levelUp,
    };
  });

  app.post('/missions', { preHandler: app.authenticate }, (request): LaunchMissionResponse => {
    const { templateId, areaId, force, officerId } = parseBody(
      LaunchMissionRequestSchema,
      request.body,
    );
    const template = findMissionTemplate(templateId);
    if (!template) {
      throw new AppError('NOT_FOUND', 'That mission is not on the board');
    }
    const now = new Date();
    // The offer has to be one this area is making *today*: boards turn over at midnight UTC, so a
    // tab left open overnight is posting a job that is no longer on the wall.
    if (!missionOffers(areaId, missionBoardDay(now)).some((offer) => offer.id === templateId)) {
      throw new AppError('NOT_FOUND', 'That job is not on offer there');
    }

    const own = requireOwnBase(app, request.currentUser.id);

    // §G6: naming somebody who does not work here is a 404, not an unled run: silently demoting it
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
    const active = app.repos.missions
      .listByBaseId(base.id)
      .filter((entry) => entry.mission.status === 'active');

    if (active.length >= concurrentMissionSlots(base.level)) {
      throw new AppError(
        'MISSIONS_AT_CAPACITY',
        'Every crew you have is already out on a mission',
        levelUp,
      );
    }
    // One job per area at a time: taking one closes the other two until that crew is home. It is
    // what makes a district a commitment rather than a queue, and it is why the concurrency limit
    // above is not the whole rule.
    if (active.some((entry) => entry.mission.areaId === areaId)) {
      throw new AppError('MISSION_REFUSED', 'You already have a crew working that area', levelUp);
    }
    // §A4: work is only offered where the crew has been and where there is still something to do.
    if (areaId !== MISC_AREA_ID) {
      const state = areaStatesFor(app.repos, base).get(areaId);
      if (!state?.scouted) {
        throw new AppError('DISTRICT_UNSCOUTED', 'You have not had eyes on that ground', levelUp);
      }
      if (state.ownedOutright) {
        throw new AppError(
          'MISSION_REFUSED',
          'You own every inch of it. Nobody is paying you to go back',
          levelUp,
        );
      }
    }

    // §A5: who is going. Checked against the roster as the settle left it, so a crew that walked
    // back through the gate on this very request can be sent straight out again.
    const forceRefusal = missionForceRefusal(force, base.army, template.kind);
    if (forceRefusal) {
      const { code, message } = FORCE_ERRORS[forceRefusal];
      throw new AppError(code, message, levelUp);
    }

    // §F5: the run rides on the player's own character, so the Overseer is read here and the
    // modified chance is frozen onto the row by `launchMission`.
    const overseer = request.currentUser.overseerId
      ? app.repos.overseers.findById(request.currentUser.overseerId)
      : undefined;
    // §G6: hard runs need an officer; easy ones can go out on assignees alone. The crew also
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
      areaId,
      force,
      now,
      overseer,
      terms: crew.terms,
      officer,
      admin: app.config.admin,
      // §A4: the ground this crew holds takes time off the road (the Smuggler's Tunnel).
      missionSpeedPercent: standingEffectsFor(app.repos, base).missionSpeedPercent,
    });
    // The row and the roster move together: a crew that is out is a crew that is not at home to
    // defend the district, and a split between these two would let the same people do both.
    app.db.transaction(() => {
      app.repos.missions.insert(stored);
      app.repos.bases.updateArmy(base.id, removeForce(base.army, force), base.trainingQueue);
    })();
    // The settle above is the only place this level-up is ever reported: the next `GET /missions`
    // re-resolves nothing, so dropping it here loses it outright rather than deferring it.
    return { mission: stored.mission, serverNow: now.toISOString(), levelUp };
  });

  /**
   * §E: turn a crew around.
   *
   * Not a cancel: the mission stays on the books and still settles, it just settles as a failure
   * with nothing in the bag. The clock is not rewritten either: `recalledAt` is recorded and the
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
      const all = app.repos.missions.listByBaseId(base.id);
      return {
        missions: all.map((entry) => entry.mission),
        justResolved: [],
        resources: base.resources,
        activeLimit: concurrentMissionSlots(base.level),
        areas: projectAreas(
          CITY_DISTRICTS,
          areaStatesFor(app.repos, base),
          all.filter((entry) => entry.mission.status === 'active'),
          base.level,
          missionBoardDay(now),
        ),
        army: base.army,
        serverNow: now.toISOString(),
      };
    })();
  });
}
