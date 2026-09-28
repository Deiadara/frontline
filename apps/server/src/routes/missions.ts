import { randomUUID } from 'node:crypto';
import {
  removeFleet,
  districtsOfCity,
  LEADER_HOLD_MESSAGES,
  LaunchMissionRequestSchema,
  MISC_AREA_ID,
  RecallMissionRequestSchema,
  canRecall,
  concurrentMissionSlots,
  findDistrict,
  findMissionTemplate,
  FightLeaderQuoteRequestSchema,
  type FightLeaderQuoteResponse,
  missionForceRefusal,
  unitsBeyondNotoriety,
  launchableBoardKeys,
  missionOffers,
  boardIsAutomated,
  type Base,
  type Fleet,
  type LaunchMissionResponse,
  type LevelUp,
  type Mission,
  type MissionForceRefusal,
  type MissionRoad,
  type MissionsResponse,
  type LocationHolder,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { removeForce } from '../battle/forces.js';
import { AppError, cityQuery, parseBody, type ErrorCode } from '../errors.js';
import { areaStatesFor, projectAreas } from '../missions/board.js';
import { benchFor, leadersFor, runLedBy } from '../missions/leaders.js';
import { launchMission } from '../missions/launch.js';
import { chairOf, fightChanceFor, rankFightLeaders } from '../missions/fight-leaders.js';
import { standingEffectsFor } from '../crew/standing.js';
import { cityAsked, citiesFor, mayEnter } from '../city/stakes.js';
import { officerDuty } from '../crew/duty.js';
import { settleAndResolveMissions } from '../missions/resolve.js';
import { takeLevelUp } from '../progression/award.js';
import { rampFor } from '../missions/pricing.js';
import { placeLocked } from '../battle/lock.js';
import { settledOwnBase } from './own-base.js';

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

/**
 * How many crews may be out at once: the level's grant, plus what research has opened (§E, the
 * Cartographer's tenth rung). Read through the standing fold so every door research opens comes
 * through the one seam.
 */
function missionSlotsFor(app: FastifyInstance, base: Base, now: Date): number {
  return (
    concurrentMissionSlots(base.level) + standingEffectsFor(app.repos, base, now).missionSlotsFlat
  );
}

/**
 * Why a district behind an armed gate has no work in it, worded for whoever armed it.
 *
 * One sentence per holder rather than one for all of them: the rule is the same in every case
 * (one party holds every location, so the gate is shut and there is nobody inside hiring), but a
 * player who has just taken a district wants to be told they own it, and a player looking at the
 * Combine Spire wants to be told what is in their way.
 */
function shutAreaRefusal(holder: LocationHolder | null): string {
  switch (holder?.kind) {
    case 'crew':
      return 'You own every inch of it. Nobody is paying you to go back';
    case 'government':
      return 'The Combine holds every inch of it. Break the gate before anybody in there hires you';
    case 'looters':
      return 'The looters hold every inch of it. Break the gate before there is work in there';
    default:
      return 'One crew holds every inch of it. Nothing gets handed out behind a shut gate';
  }
}

/**
 * Whose boards this request is reading (2026-09-24).
 *
 * The board is the districts of one city, and it used to be Ashfall's twelve whoever asked. A crew
 * living in Terminus read a board of twelve districts it cannot walk to, and the areas it can
 * actually work were on nobody's screen.
 *
 * Which city is decided by the access model the Bar and the market already run on
 * (`city/access.ts`): **a crew's own city, or any city they hold at least one location in**. Work
 * is somebody in a city paying a crew to do a job, and the same sentence that says a crew with a
 * stake may drink there and bid there says they may be hired there. It reads the same `?city=`
 * parameter and refuses the same way, so the three doors of a city cannot disagree about who is
 * inside it: a crew thrown out of their last Terminus plot loses the board on the next read,
 * because the stake is read off the control map every time rather than granted and stored.
 *
 * A name they hold nothing in is refused rather than quietly answered with their own boards, which
 * is the market's argument: the jobs are different jobs, and a player looking at Terminus cards
 * they cannot launch would find out at the send button.
 */
function boardCity(app: FastifyInstance, base: Base, asked: string | undefined): string {
  const cityId = cityAsked(app.repos, base, asked);
  if (cityId === null) {
    throw new AppError('CITY_SHUT', 'You hold no ground in that city. Take a place in it first.');
  }
  return cityId;
}

/** The city a request named, if it named one. Absent means the crew's own. */
function askedCity(request: { query: unknown }): string | undefined {
  return cityQuery(request.query);
}

/**
 * A run as the client is shown it: without the page it may be carrying (maintainer, 2026-09-28).
 *
 * The offer stopped naming the prize so a player could not shop the board for it, and the row
 * still carried it. The launch answers with the row and every read of the board lists it, so a
 * player could launch, read the answer, call the crew back inside the window when it said
 * nothing, and try the next card. What a run found is `pageWon`, written on arrival; nothing on
 * the client reads the prize itself.
 */
function onTheWire(mission: Mission): Mission {
  return { ...mission, pagePrize: null };
}

/**
 * The crew's own cuts off the road to a job, off the same fold and with the same clamps the launch
 * spends them with, so the send dialog's round trip is the one the run keeps (`MissionRoadSchema`).
 */
function missionRoad(app: FastifyInstance, base: Base, now: Date): MissionRoad {
  const { travelSpeedPercent, roadMinutesOff, unitSpeedPercent } = standingEffectsFor(
    app.repos,
    base,
    now,
  );
  return {
    travelSpeedPercent: Math.max(0, travelSpeedPercent),
    roadMinutesOff: Math.max(0, roadMinutesOff),
    unitSpeedPercent,
  };
}

export function registerMissionRoutes(app: FastifyInstance): void {
  app.get('/missions', { preHandler: app.authenticate }, (request): MissionsResponse => {
    const now = new Date();
    const own = requireOwnBase(app, request.currentUser.id);
    // In a transaction, the way the world clock runs it: the settle marks a run resolved before it
    // pays, so a write failing halfway left a crew marked home with its units and its haul gone.
    const settlement = settleAndResolveMissions(app.repos, own, now);
    // Whatever this crew is owed, including a level the *world clock* banked while nobody was
    // looking: `takeLevelUp` reads the durable marker and clears it (migration 0083). Read off the
    // marker rather than off `settlement.levelUp`, so a threshold the clock crossed at 03:00 is
    // announced here rather than lost.
    // The board is chosen first: `boardCity` refuses a city this crew has lost its ground in, and a
    // refusal after `takeLevelUp` had cleared the marker lost the announcement for good.
    const cityId = boardCity(app, settlement.base, askedCity(request));
    const levelUp = takeLevelUp(app.repos, settlement.base.id);

    const stored = app.repos.missions.listByBaseId(settlement.base.id);
    // The runs still out, off their own query rather than off the history page above. That page is
    // the newest `MISSION_HISTORY_LIMIT` rows, so a day-long job with two hundred short ones
    // launched after it falls off the end of it: the bench would call its leader free while the
    // launch refuses them, and the area would offer work a crew is already in.
    const active = app.repos.missions.listActiveByBaseId(settlement.base.id);

    return {
      // Which board this is, and every board this crew may read. The same pair the Bar, the
      // market and the back room carry, so the picker on this screen works the way those do.
      cityId,
      cities: citiesFor(app.repos, settlement.base),
      leaders: leadersFor({
        repos: app.repos,
        base: settlement.base,
        overseer: request.currentUser.overseerId
          ? app.repos.overseers.findById(request.currentUser.overseerId)
          : undefined,
        active,
        now,
      }),
      level: settlement.base.level,
      missions: stored.map((entry) => onTheWire(entry.mission)),
      justResolved: settlement.resolved.map(onTheWire),
      resources: settlement.base.resources,
      activeLimit: missionSlotsFor(app, settlement.base, now),
      // The card quotes what the launch will freeze. Read from the same fold `POST /missions`
      // reads: a Smuggler's Tunnel shortens the clock and the crew's own fixer widens the cut, and
      // both used to be invisible to the board and frozen onto the run.
      areas: projectAreas(
        districtsOfCity(boardCity(app, settlement.base, askedCity(request))),
        areaStatesFor(app.repos, settlement.base),
        active,
        settlement.base.level,
        now,
        (({ missionSpeedPercent, missionSpoilsPercent }) => ({
          speedPercent: missionSpeedPercent,
          spoilsPercent: missionSpoilsPercent,
          // The opening band, which shortens the first runs and pays the premium that keeps them
          // worth taking (`missions.ramp.ts`).
          ramp: rampFor(app.repos, settlement.base),
        }))(standingEffectsFor(app.repos, settlement.base, now)),
      ),
      road: missionRoad(app, settlement.base, now),
      army: settlement.base.army,
      serverNow: now.toISOString(),
      levelUp,
    };
  });

  app.post('/missions', { preHandler: app.authenticate }, (request): LaunchMissionResponse => {
    const { templateId, areaId, force, leaderId, vehicles } = parseBody(
      LaunchMissionRequestSchema,
      request.body,
    );
    const template = findMissionTemplate(templateId);
    if (!template) {
      throw new AppError('NOT_FOUND', 'That mission is not on the board');
    }
    const now = new Date();
    /*
     * The offer has to be one this area is making now, or was one slot ago.
     *
     * A district's board turns over at midnight, Athens, so a tab left open overnight is posting
     * a job that is no longer on the wall. `misc` turns over hourly now
     * (`MISC_BOARD_ROTATION_MINUTES`), and one slot of grace is what stops a player who opened
     * the send window at 10:59 and pressed the button at 11:00 being refused a card that was on
     * the wall when they read it. `launchableBoardKeys` is one key for a district and two for
     * misc, so nothing about the daily boards changed.
     *
     * The matching key is kept rather than only asked about, because it is what the run's page
     * prize is drawn from and `launchMission` freezes that prize onto the row. The current slot
     * is first in the list, so a job standing on both boards is launched on the terms the player
     * is looking at now.
     *
     * Dealt at the crew's level before the settle, which is the board the player was reading: a
     * level banked by this very request must not swap the card they pressed for another one. The
     * grade comes with it, and is what the run is frozen at.
     */
    const own = requireOwnBase(app, request.currentUser.id);
    // ...or the level before it: the world clock can bank a level-up between the player reading
    // the board and pressing Send, and the card they pressed must not vanish under them. The
    // current level first, so a card on both boards goes out as it reads now.
    const dealt = [own.level, own.level - 1]
      .filter((level) => level >= 1)
      .flatMap((level) =>
        launchableBoardKeys(areaId, now).map((key) => ({
          key,
          job: missionOffers(areaId, key, level).find((job) => job.template.id === templateId),
        })),
      )
      .find((entry) => entry.job !== undefined);
    if (dealt?.job === undefined) {
      throw new AppError('NOT_FOUND', 'That job is not on offer there');
    }
    const boardKey = dealt.key;
    const grade = dealt.job.grade;

    /*
     * Who is leading it (maintainer, 2026-09-10).
     *
     * Naming somebody who is not on this crew's bench is a 404. Every run has a leader
     * (maintainer, 2026-09-28), and the Overseer is always on the bench, so a request with nobody
     * valid in it is a stale tab or a typo rather than a choice.
     *
     * This half is checked *before* the settle so a doomed request never banks one (MOU-280): the
     * settle's level-up can only be announced by the response that caused it, and this one is an
     * error envelope. It reads `base.commanders` and the Overseer, neither of which a settlement
     * touches, so hoisting it changes no answer. Whether that leader is *free* cannot follow it
     * up: the crew they are out with may be walking through the gate on this very request.
     */
    const bench = benchFor(
      request.currentUser.overseerId
        ? app.repos.overseers.findById(request.currentUser.overseerId)
        : undefined,
      own.commanders,
    );
    const leader = bench.find((candidate) => candidate.id === leaderId);
    if (!leader) {
      throw new AppError('NOT_FOUND', 'Nobody on your bench by that id');
    }

    // Settle first: a mission that came home while the player was reading the board frees a slot
    // they should be allowed to use on this very request.
    const { base } = settleAndResolveMissions(app.repos, own, now);
    // Drained here, before any refusal below, because every exit from this handler carries it.
    const levelUp = takeLevelUp(app.repos, base.id);
    // The active runs, not the whole history filtered down to them: the repo has a query for this
    // and the launch path was loading a month of finished work to count what is out.
    const active = app.repos.missions.listActiveByBaseId(base.id);

    // One job at a time, for the Overseer as much as for an officer: a person who is out is out.
    // Read off the runs the settle left active, so the leader who just came home is free again.
    if (runLedBy(leader, active) !== null) {
      throw new AppError('MISSION_REFUSED', `${leader.name} ${LEADER_HOLD_MESSAGES.run}`, levelUp);
    }
    /*
     * §D4 and the rest of what can hold an officer: injured, leading a declared fight, or on the
     * bench. Refused, because the player picked a person. The Overseer answers to none of it: they are the player, not an employee.
     *
     * Below the settle with the rule above, and for the same reason: `officerDuty` reads the
     * crew's active runs too, so hoisted it would hold an officer whose run has just landed.
     */
    const officer =
      leader.kind === 'officer' ? base.commanders.find((held) => held.id === leader.id) : undefined;
    const duty = officer ? officerDuty(app.repos, base, officer, now) : null;
    if (officer && duty !== null) {
      throw new AppError(
        'MISSION_REFUSED',
        `${officer.name} ${LEADER_HOLD_MESSAGES[duty.held]}`,
        levelUp,
      );
    }

    if (active.length >= missionSlotsFor(app, base, now)) {
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
      const district = findDistrict(areaId);
      const state = areaStatesFor(app.repos, base).get(areaId);
      if (!state?.scouted) {
        throw new AppError('DISTRICT_UNSCOUTED', 'You have not had eyes on that ground', levelUp);
      }
      /*
       * The city's own door, the same one the read draws the board through (see `boardCity`).
       *
       * Checked here as well as there because the screen is not the only way to post: a crew that
       * has lost its last plot in Terminus still has yesterday's card in an open tab, and the read
       * would refuse them while the launch waved them through. The wording names the stake rather
       * than the ground, because the fix is a place in that city rather than another scout.
       */
      if (district && !mayEnter(app.repos, base, district.cityId)) {
        throw new AppError(
          'CITY_SHUT',
          'Nobody in that city hires a crew that holds nothing in it. Take a place there first',
          levelUp,
        );
      }
      // The same rule the board draws with, worded for whoever is actually behind the gate.
      if (state.heldWhole) {
        throw new AppError('MISSION_REFUSED', shutAreaRefusal(state.wholeHolder), levelUp);
      }
      // Worded without a possessive: the plot may be the reader's own, and "somebody's plot" read
      // oddly against a player's own hideout.
      if (district?.kind !== 'contested') {
        throw new AppError(
          'MISSION_REFUSED',
          'Nobody hires a crew on a plot. That is somewhere people live, not ground with work in it',
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

    /*
     * §D7: the heaviest sheets will not take a contract from a nobody, on a job as on a raid.
     *
     * `notorietyToField` says a unit past the crew's rank "will not take the field", and the gate
     * stood on two of the three doors onto a field: the deployment (`battle/deploy.ts`) and the
     * city (`city/actions.ts`). A rank-0 crew that trained a Colossus was refused at the fight and
     * waved through here, with the same unit fighting the same engine on the other side of it.
     */
    if (unitsBeyondNotoriety(force, base.economy.notoriety).length > 0) {
      throw new AppError(
        'MISSION_REFUSED',
        'They will not take a contract from a name that small',
        levelUp,
      );
    }

    /*
     * §C2b: while any standing order is on, the board is the Right Hand's.
     *
     * The maintainer's rule is the strong one: not "the slots it is holding" but the whole board,
     * so the state a player is in is one sentence rather than a count they cannot see. Refused
     * here rather than hidden on the screen, because the screen is not the only way to post.
     */
    if (boardIsAutomated(app.repos.automations.forBase(base.id))) {
      throw new AppError(
        'MISSION_REFUSED',
        'Your Right Hand has the board. Switch the automation off to send a crew yourself',
        levelUp,
      );
    }

    /*
     * The party leaves from home, and nothing leaves home in the last hour before a raid on it
     * (`battle/lock.ts`, maintainer 2026-09-28): the district army is what that raid meets.
     */
    if (placeLocked(app.repos, base, { kind: 'district' }, now)) {
      throw new AppError(
        'MISSION_REFUSED',
        'A raid lands on your district within the hour. Nobody leaves home now',
        levelUp,
      );
    }

    // §C3: the machines leave the yard with the crew, checked like the force above.
    refuseVehiclesNotHeld(base, vehicles, levelUp);

    // Read once: two calls would be two settles of the same effects.
    const book = standingEffectsFor(app.repos, base, now);
    const stored = launchMission({
      id: randomUUID(),
      base,
      template,
      areaId,
      boardKey,
      // A fight's chance is what the practice fights say this leader is worth with this force
      // (`fight-leaders.ts`), frozen for the report; a plain job keeps its attribute grade.
      ...(template.kind === 'battle'
        ? {
            fightChance: fightChanceFor({
              base,
              template,
              grade,
              force,
              vehicles: vehicles ?? {},
              leader,
              effects: book,
            }),
          }
        : {}),
      // The grade this card was dealt: the odds, what a fight fields, the clock and the pay, frozen
      // with everything else the card promised.
      grade,
      force,
      vehicles,
      now,
      leader,
      // The band this crew is in, read before the run goes out and frozen on the row with the
      // clock and the pay it decides (`missions.ramp.ts`).
      ramp: rampFor(app.repos, base),
      admin: app.config.admin,
      // §A4/§E: the ground this crew holds takes time off the road (the Smuggler's Tunnel), and
      // the people on the books take a bigger cut of what the job pays. Read once: two calls would
      // be two settles of the same effects.
      /*
       * §D5: an officer's leading perks pay on a run they are actually on, and the two of them are
       * spent on **different** clocks.
       *
       * This used to hand `leading(...)` straight to the launch, which folds `leadArrivalPercent`
       * into `missionSpeedPercent`, and the launch priced the pay off that. `rewardScale` is
       * monotonic in the minutes, so a crew that sent their Short Way officer finished sooner and
       * was paid less than the card had quoted them: the §A4 bug `offerFor` was written against,
       * one channel along. The arrival cut goes to the running clock alone (`leadSpeedPercent`) and
       * the loot cut goes to the take, which is where a player would look for each of them.
       */
      ...(({
        missionSpeedPercent,
        missionSpoilsPercent,
        leadLootPercent,
        leadArrivalPercent,
        unitSpeedPercent,
        travelSpeedPercent,
        roadMinutesOff,
        anyRide,
      }) => ({
        missionSpeedPercent,
        // §C3: every walk in the game reads these, and a mission's road is a walk (maintainer,
        // 2026-09-23). Off the **unled** fold, so the leader's own Short Way is not counted twice:
        // `leading()` folds `leadArrivalPercent` into this channel, and it is spent separately
        // below as `leadSpeedPercent`.
        travelSpeedPercent,
        roadMinutesOff,
        leadSpeedPercent: officer ? leadArrivalPercent : 0,
        missionSpoilsPercent: missionSpoilsPercent + (officer ? leadLootPercent : 0),
        // §C3: the same channel the march reads (`battle/movement.ts`). The Skate Ground says
        // "everything you field moves faster" and the road to a job is a road.
        unitSpeedPercent,
        // And the other half of that sentence, which was missing: the Tram Depot's `any_ride`.
        // The march read it and the job did not, so one crew's Colossus rode to a fight and walked
        // to a mission on the same streets.
        anyRide,
      }))(book),
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
    return { mission: onTheWire(stored.mission), serverNow: now.toISOString(), levelUp };
  });

  /**
   * §E: turn a crew around.
   *
   * Not a cancel: the mission stays on the books and still settles, it just settles as a failure
   * with nothing in the bag. The clock is not rewritten either: `recalledAt` is recorded and the
   * return leg is derived from it, so the report afterwards can still say how long the run was
   * meant to take and how far they got before the order reached them.
   */
  /**
   * Who should lead a fight, for the force the player is filling in (maintainer, 2026-09-28).
   *
   * Advice, not a launch: little is refused that the launch would refuse, because the window asks
   * as the force changes and a half-filled party is a fair question. A party bigger than the crew
   * has is the exception (see below).
   * Every leader on the bench is rated, held or not, so the row of somebody out on a run still
   * says what they would be worth; the window keeps its own rule about who can be picked. An
   * officer with no chair is the exception and is not fought at all: they cannot lead until they
   * are seated (maintainer, 2026-09-28), and the chair they would get changes what they are worth.
   */
  app.post(
    '/missions/leaders/quote',
    { preHandler: app.authenticate },
    (request): FightLeaderQuoteResponse => {
      const { templateId, grade, force, vehicles } = parseBody(
        FightLeaderQuoteRequestSchema,
        request.body,
      );
      const template = findMissionTemplate(templateId);
      if (!template) throw new AppError('NOT_FOUND', 'That mission is not on the board');
      if (template.kind !== 'battle') {
        throw new AppError('VALIDATION_ERROR', 'Only a fight is led by whoever wins it');
      }
      const now = new Date();
      const base = settledOwnBase(app, request.currentUser.id, now);
      /*
       * A party the crew could not send is not a question worth fighting out (audit, 2026-09-28).
       *
       * Every candidate is rated over practice fights, and each fight's cost grows with the force,
       * so nothing capping the force let one account ask about ten million of every unit and hold
       * the event loop for seconds a request. Half-filled parties and no fighters yet are still
       * fair questions; more than the roster or the yard holds is not.
       */
      if (missionForceRefusal(force, base.army, template.kind) === 'not_enough_units') {
        const { code, message } = FORCE_ERRORS.not_enough_units;
        throw new AppError(code, message);
      }
      refuseVehiclesNotHeld(base, vehicles ?? {});
      const bench = benchFor(
        request.currentUser.overseerId
          ? app.repos.overseers.findById(request.currentUser.overseerId)
          : undefined,
        base.commanders,
      );
      return {
        leaders: rankFightLeaders({
          base,
          template,
          grade,
          force,
          vehicles: vehicles ?? {},
          candidates: bench.filter((one) => one.kind === 'overseer' || chairOf(base, one) !== null),
          effects: standingEffectsFor(app.repos, base, now),
          practice: `practice-leader:${base.id}:${template.id}:${grade}`,
        }),
      };
    },
  );

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
      // Settled first, as the read is, so the board this answers with is the board the next read
      // would show: a crew that came home while the order was given frees its slot here.
      const settlement = settleAndResolveMissions(app.repos, base, now);
      const settled = settlement.base;
      const levelUp = takeLevelUp(app.repos, settled.id);
      const all = app.repos.missions.listByBaseId(settled.id);
      // Off its own query, for the reason `GET /missions` gives: the page above is bounded and the
      // runs that are out are not.
      const active = app.repos.missions.listActiveByBaseId(settled.id);
      return {
        // The same two fields the read answers with. A recall does not free the person leading the
        // crew: they are on the road home, and the row stays active until they are through the
        // gate. What has changed here is whoever landed in the settle above.
        leaders: leadersFor({
          repos: app.repos,
          base: settled,
          overseer: request.currentUser.overseerId
            ? app.repos.overseers.findById(request.currentUser.overseerId)
            : undefined,
          active,
          now,
        }),
        level: settled.level,
        cityId: boardCity(app, settled, askedCity(request)),
        cities: citiesFor(app.repos, settled),
        missions: all.map((entry) => onTheWire(entry.mission)),
        justResolved: settlement.resolved.map(onTheWire),
        resources: settled.resources,
        activeLimit: missionSlotsFor(app, settled, now),
        // The same fold the read prices from. Without it every card was repainted at bare timings
        // and bare pay until the next poll put the crew's tunnel and fixer back on it.
        // The same city the read draws, off the same `?city=`: a recall repaints the board the
        // player is looking at, and answering with their home city would swap the screen under
        // somebody working a second city.
        areas: projectAreas(
          districtsOfCity(boardCity(app, settled, askedCity(request))),
          areaStatesFor(app.repos, settled),
          active,
          settled.level,
          now,
          (({ missionSpeedPercent, missionSpoilsPercent }) => ({
            speedPercent: missionSpeedPercent,
            spoilsPercent: missionSpoilsPercent,
            ramp: rampFor(app.repos, settled),
          }))(standingEffectsFor(app.repos, settled, now)),
        ),
        road: missionRoad(app, settled, now),
        army: settled.army,
        serverNow: now.toISOString(),
        levelUp,
      };
    })();
  });
}

/**
 * §C3: the machines named are in the yard, or the request is refused whole.
 *
 * Checked against the yard rather than trusted: a client naming four trucks it does not own would
 * otherwise buy the speed of four trucks. Refused rather than silently trimmed, because a crew that
 * thought it was riding and is walking has made a different decision about a clock it cannot see.
 */
function refuseVehiclesNotHeld(base: Base, vehicles: Fleet, levelUp?: LevelUp): void {
  for (const [id, count] of Object.entries(vehicles)) {
    if ((base.fleet[id as keyof Fleet] ?? 0) < (count ?? 0)) {
      throw new AppError('FORBIDDEN', 'You do not have that many in the yard', levelUp);
    }
  }
}
