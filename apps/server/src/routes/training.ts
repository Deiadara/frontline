import { randomUUID } from 'node:crypto';
import {
  OVERSEER_SUBJECT,
  PRIVATE_CHANNELS,
  StartTrainingRequestSchema,
  TRAINING_QUEUE_SLOTS,
  TRAINING_SECONDS,
  beginTraining,
  nextDrillStart,
  trainingBlocker,
  type Base,
  type CrewStandingResponse,
  type TrainingResponse,
  type TrainingSession,
  CancelDrillRequestSchema,
  cancelDrill,
  drillCancellable,
  drillHoldBlocker,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { requireArea } from '../progression/doors.js';
import {
  drillSecondsBySubject,
  officerMarksBySubject,
  drillHolds,
  projectTraining,
  settleTrainingFor,
} from '../crew/training.js';
import { tallyDrillThirdInLine } from '../feats/tally.js';
import { chairLinesFor, crewEffectsFor, officerFitReader } from '../crew/standing.js';
import { chairLineContext } from '../crew/roster.js';
import { ledgerFor } from '../bar/hire.js';
import { AppError, parseBody } from '../errors.js';
import { standingEffectsFor } from '../crew/standing.js';
import { spyPointsFor } from '../spying/spying.js';
import { settledOwnBase } from './own-base.js';
import { adminSeconds } from '../admin/mode.js';

/**
 * §A4: how many extra sessions the crew's ground buys them today (the Gym).
 *
 * Read in one place and passed to both the projection and the gate, because a screen that says
 * "2 left" over a route that refuses the second is worse than either number being wrong.
 */
function extraSessionsFor(app: FastifyInstance, base: Base): number {
  return standingEffectsFor(app.repos, base).extraTrainingSessions;
}

/** How many drills the queue holds: two, plus the Professor's Second Chair. Same rule as above. */
function queueSlotsFor(app: FastifyInstance, base: Base): number {
  return TRAINING_QUEUE_SLOTS + standingEffectsFor(app.repos, base).trainingQueueFlat;
}

/**
 * The Training tab and the Overseer's own profile (§F2).
 *
 * Both routes settle first. A player who left an hour ago and comes back should see the point
 * already on the sheet, not a finished bar that pays out on the next click, and settling on read
 * is what makes "come back tomorrow" work without a scheduler.
 *
 * The whole crew, not the drills alone: an hour landing moves what the district makes, so the
 * district has to be walked up to it first (`settleBase` does both, in order). Landed on its own,
 * the next settle priced the whole window with the new sheet.
 */

export function registerTrainingRoutes(app: FastifyInstance): void {
  /** Take a drill off the board inside its first tenth; the day's session comes back. */
  app.post('/training/cancel', { preHandler: app.authenticate }, (request): TrainingResponse => {
    const { sessionId } = parseBody(CancelDrillRequestSchema, request.body);
    const now = new Date().toISOString();
    return app.db.transaction(() => {
      const { base, overseer } = settleTrainingFor(
        app.repos,
        settledOwnBase(app, request.currentUser.id, new Date(now)),
        now,
      );
      const session = base.training.sessions.find((held) => held.id === sessionId);
      if (!session) throw new AppError('NOT_FOUND', 'No drill by that name is on the floor');
      if (!drillCancellable(session, now)) {
        throw new AppError('TRAINING_REFUSED', 'The hour has gone too far to stop');
      }
      const training = cancelDrill(base.training, sessionId, now);
      app.repos.bases.updateTraining(base.id, training, base.commanders);
      return projectTraining(
        { ...base, training },
        overseer,
        now,
        extraSessionsFor(app, base),
        queueSlotsFor(app, base),
        drillSecondsBySubject(app.repos, base, overseer, new Date(now)),
        officerMarksBySubject(app.repos, base, new Date(now)),
        drillHolds(app.repos, base, new Date(now)),
      );
    })();
  });

  app.get('/training', { preHandler: app.authenticate }, (request): TrainingResponse => {
    const now = new Date().toISOString();
    const settled = app.db.transaction(() =>
      settleTrainingFor(app.repos, settledOwnBase(app, request.currentUser.id, new Date(now)), now),
    )();
    return projectTraining(
      settled.base,
      settled.overseer,
      now,
      extraSessionsFor(app, settled.base),
      queueSlotsFor(app, settled.base),
      drillSecondsBySubject(app.repos, settled.base, settled.overseer, new Date(now)),
      officerMarksBySubject(app.repos, settled.base, new Date(now)),
      drillHolds(app.repos, settled.base, new Date(now)),
    );
  });

  /** §F2: put one person through one hour of one thing. */
  app.post('/training', { preHandler: app.authenticate }, (request): TrainingResponse => {
    const { subjectId, attribute } = parseBody(StartTrainingRequestSchema, request.body);
    const now = new Date().toISOString();

    return app.db.transaction(() => {
      const { base, overseer } = settleTrainingFor(
        app.repos,
        settledOwnBase(app, request.currentUser.id, new Date(now)),
        now,
      );
      // After the settle, which can bank a finished build's XP and the level that opens this door
      // (bug pass, 2026-10-06): read off the raw row, that crew was refused until the next read.
      requireArea(base, 'training');

      const sheet =
        subjectId === OVERSEER_SUBJECT
          ? overseer?.attributes
          : base.commanders.find((officer) => officer.id === subjectId)?.attributes;
      if (!sheet) throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
      // Nobody away from the floor drills: a run, a fight or a sickbed (maintainer, 2026-10-06).
      const away = drillHoldBlocker(
        drillHolds(app.repos, base, new Date(now)).get(subjectId) ?? null,
      );
      if (away !== null) throw new AppError('TRAINING_REFUSED', away);

      const blocker = trainingBlocker(
        base.training,
        subjectId,
        attribute,
        sheet,
        now,
        extraSessionsFor(app, base),
        queueSlotsFor(app, base),
      );
      // The wording is the same one the tab already shows against the disabled button, so a player
      // who somehow gets past the client reads the same sentence rather than a second vocabulary.
      if (blocker !== null) throw new AppError('TRAINING_REFUSED', blocker);
      // Counted off the settled book, before this one is added: the third place, which only the
      // Professor's Second Chair opens.
      if (base.training.sessions.length >= TRAINING_QUEUE_SLOTS) {
        tallyDrillThirdInLine(app.repos, base.id);
      }

      // This person's own hour, off their lifted sheet (maintainer, 2026-10-01), frozen on the
      // session: the settle, the countdown and the cancel window all read `durationSeconds`.
      const seconds = drillSecondsBySubject(app.repos, base, overseer, new Date(now));
      const session: TrainingSession = {
        id: randomUUID(),
        subjectId,
        attribute,
        // Behind whatever is already on the list: the floor runs one drill at a time.
        startedAt: nextDrillStart(base.training, now),
        queuedAt: now,
        // Five seconds in admin mode, like every other clock (maintainer ruling, 2026-09-29).
        durationSeconds: adminSeconds(seconds.get(subjectId) ?? TRAINING_SECONDS, app.config.admin),
      };
      const training = beginTraining(base.training, session, now);
      app.repos.bases.updateTraining(base.id, training, base.commanders);
      return projectTraining(
        { ...base, training },
        overseer,
        now,
        extraSessionsFor(app, base),
        queueSlotsFor(app, base),
        seconds,
        officerMarksBySubject(app.repos, base, new Date(now)),
        drillHolds(app.repos, base, new Date(now)),
      );
    })();
  });

  /**
   * The Overseer's own page: who they are, and what the crew's sheet is currently buying.
   *
   * The effects are computed from the player's *own* people, so nothing here is hidden from them
   * in the first place. This is the opposite of the §B8a role table, which is about somebody
   * else's fit and never leaves the server.
   */
  app.get('/overseer/me', { preHandler: app.authenticate }, (request): CrewStandingResponse => {
    const now = new Date().toISOString();
    const settled = app.db.transaction(() =>
      settleTrainingFor(app.repos, settledOwnBase(app, request.currentUser.id, new Date(now)), now),
    )();
    if (!settled.overseer) throw new AppError('NOT_FOUND', 'You have not chosen an overseer yet');

    // What each working chair gives, and the Overseer's own grade (maintainer, 2026-10-04).
    const { chairs, overseerGrade } = chairLinesFor(
      app.repos,
      settled.base,
      new Date(now),
      chairLineContext(app.repos, settled.base, officerFitReader(app.repos, settled.base)),
    );
    // The whole crew fold: perks, the Lab and the rank. Attributes stopped landing on it when the
    // chairs took over (2026-10-04).
    const effects = crewEffectsFor(app.repos, settled.base);
    // The ground's and the raid modifications' share as well: what a job's return is paid off.
    const standing = standingEffectsFor(app.repos, settled.base, new Date(now));
    return {
      overseer: settled.overseer,
      chairs,
      overseerGrade,
      payroll: ledgerFor(settled.base, standing),
      // Every numeric channel of the fold, not the `EFFECT_CHANNELS` list: that list is the sheet's
      // twenty-two, and the perk-only channels (`payrollStepDiscountPercent` among them) are not on
      // it, so filtering by it dropped exactly the figures this response exists to carry. `perHour`
      // is a resource map rather than a number and is the one thing the filter keeps out.
      // ...less the two spy totals, which are not public (maintainer, 2026-10-01).
      effects: Object.fromEntries(
        Object.entries(effects).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === 'number' && !PRIVATE_CHANNELS.has(entry[0]),
        ),
      ),
      // Beside the numbers rather than inside them: the screens that quote a haul need to know
      // which sheets have been granted `picker`, and a record of arrays cannot ride on `effects`.
      marks: effects.unitMarks,
      // ...and the bag the settle actually pays, off the standing fold. See the note on the
      // schema: `effects` is people-only on purpose, and a held Pawn Shop and the three raid
      // modifications are worth up to 83 points that a board reading `effects` never quoted.
      haulPercent: standing.lootCapacityPercent,
      carrierFlat: standing.carrierLootFlat,
      missionCapsPercent: standing.missionCapsPercent,
      // The crew's own spy totals, for the Master of Whispers' seat (2026-10-07).
      spyPoints: spyPointsFor(app.repos, settled.base, new Date(now)),
    };
  });
}
