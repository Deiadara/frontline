import { randomUUID } from 'node:crypto';
import {
  removeFleet,
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
  leading,
  officerIsInjured,
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
    const { templateId, areaId, force, officerId, vehicles } = parseBody(
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
    // §D4: an officer who is still recovering is out, and leading is a service like any other.
    // Refused rather than quietly demoted to an unled run: the player picked a person, and a job
    // that silently costs the §G6 penalty is worse than one that says why it will not go.
    if (officer && officerIsInjured(officer.injuredUntil, now)) {
      throw new AppError('MISSION_REFUSED', `${officer.name} is still laid up`);
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
    /*
     * §G6: a hard run needs an officer leading it. The terms it fixes (`delegationTerms`) are what
     * `launchMission` freezes onto the row beside §F5's.
     *
     * One refusal, not two. There used to be a second, for an easy job with no officer and nobody
     * in the assignee pool to delegate to; there is no pool, and what a mission sends is units,
     * which the force check above already covers. The level-up rides out on the envelope because
     * the settle above may have banked one before this refused.
     */
    const crew = resolveCrew({ base, template, officer });
    if (!crew.terms.allowed) {
      throw new AppError(
        'MISSION_NEEDS_OFFICER',
        'That job is too hard to run without an officer leading it',
        levelUp,
      );
    }

    /*
     * §C3: the machines leave the yard with the crew.
     *
     * Checked against the yard rather than trusted, like the force above: a client naming four
     * trucks it does not own would otherwise buy the speed of four trucks. Refused whole rather
     * than silently trimmed, because a crew that thought it was riding and is walking has made a
     * different decision about a clock it cannot see.
     */
    for (const [id, count] of Object.entries(vehicles)) {
      if ((base.fleet[id as keyof typeof base.fleet] ?? 0) < (count ?? 0)) {
        throw new AppError('FORBIDDEN', 'You do not have that many in the yard', levelUp);
      }
    }

    const stored = launchMission({
      id: randomUUID(),
      base,
      template,
      areaId,
      force,
      vehicles,
      now,
      overseer,
      terms: crew.terms,
      officer,
      admin: app.config.admin,
      // §A4/§E: the ground this crew holds takes time off the road (the Smuggler's Tunnel), and
      // the people on the books take a bigger cut of what the job pays. Read once: two calls would
      // be two settles of the same effects.
      /*
       * §D5: an officer's leading perks pay on a run they are actually on.
       *
       * `leading` spends them onto the same two channels the ground already pushes, so a Short Way
       * and a Smuggler's Tunnel add up rather than arriving through two parallel paths. Skipped
       * outright when nobody is leading, which is the whole condition on the channel.
       */
      ...(({ missionSpeedPercent, missionSpoilsPercent, leadLootPercent }) => ({
        missionSpeedPercent,
        missionSpoilsPercent: missionSpoilsPercent + (officer ? leadLootPercent : 0),
      }))(
        officer
          ? leading(standingEffectsFor(app.repos, base, now))
          : standingEffectsFor(app.repos, base, now),
      ),
    });
    // The row and the roster move together: a crew that is out is a crew that is not at home to
    // defend the district, and a split between these two would let the same people do both.
    app.db.transaction(() => {
      app.repos.missions.insert(stored);
      app.repos.bases.updateArmy(base.id, removeForce(base.army, force), base.trainingQueue);
      // The yard empties with the roster, and for the same reason: a machine that is out on a run
      // is not in the yard to be sent to a fight.
      app.repos.bases.updateFleet(base.id, removeFleet(base.fleet, vehicles));
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
