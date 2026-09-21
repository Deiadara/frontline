import { randomUUID } from 'node:crypto';
import {
  OVERSEER_SUBJECT,
  StartTrainingRequestSchema,
  TRAINING_BENCHES,
  TRAINING_SECONDS,
  beginTraining,
  crewSheet,
  trainingBlocker,
  type Base,
  type CrewStandingResponse,
  type TrainingResponse,
  type TrainingSession,
  CancelDrillRequestSchema,
  cancelDrill,
  drillCancellable,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { projectTraining, settleTrainingFor } from '../crew/training.js';
import { tallyDrillPaired } from '../feats/tally.js';
import { crewEffectsFor, crewSheetsFor } from '../crew/standing.js';
import { AppError, parseBody } from '../errors.js';
import { standingEffectsFor } from '../crew/standing.js';
import { ownBase } from './own-base.js';

/**
 * §A4: how many extra sessions the crew's ground buys them today (the Gym).
 *
 * Read in one place and passed to both the projection and the gate, because a screen that says
 * "2 left" over a route that refuses the second is worse than either number being wrong.
 */
function extraSessionsFor(app: FastifyInstance, base: Base): number {
  return standingEffectsFor(app.repos, base).extraTrainingSessions;
}

/** How many people may drill at once: one, plus the Professor's Second Chair. Same rule as above. */
function benchesFor(app: FastifyInstance, base: Base): number {
  return TRAINING_BENCHES + standingEffectsFor(app.repos, base).trainingBenchesFlat;
}

/**
 * The Training tab and the Overseer's own profile (§F2).
 *
 * Both routes settle first. A player who left an hour ago and comes back should see the point
 * already on the sheet, not a finished bar that pays out on the next click, and settling on read
 * is what makes "come back tomorrow" work without a scheduler.
 */

export function registerTrainingRoutes(app: FastifyInstance): void {
  /** Take a drill off the board inside its first tenth; the day's session comes back. */
  app.post('/training/cancel', { preHandler: app.authenticate }, (request): TrainingResponse => {
    const { sessionId } = parseBody(CancelDrillRequestSchema, request.body);
    const now = new Date().toISOString();
    return app.db.transaction(() => {
      const { base, overseer } = settleTrainingFor(
        app.repos,
        ownBase(app, request.currentUser.id),
        now,
      );
      const session = base.training.sessions.find((held) => held.id === sessionId);
      if (!session) throw new AppError('NOT_FOUND', 'No drill by that name is running');
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
        benchesFor(app, base),
      );
    })();
  });

  app.get('/training', { preHandler: app.authenticate }, (request): TrainingResponse => {
    const now = new Date().toISOString();
    const settled = app.db.transaction(() =>
      settleTrainingFor(app.repos, ownBase(app, request.currentUser.id), now),
    )();
    return projectTraining(
      settled.base,
      settled.overseer,
      now,
      extraSessionsFor(app, settled.base),
      benchesFor(app, settled.base),
    );
  });

  /** §F2: put one person through one hour of one thing. */
  app.post('/training', { preHandler: app.authenticate }, (request): TrainingResponse => {
    const { subjectId, attribute } = parseBody(StartTrainingRequestSchema, request.body);
    const now = new Date().toISOString();

    return app.db.transaction(() => {
      const { base, overseer } = settleTrainingFor(
        app.repos,
        ownBase(app, request.currentUser.id),
        now,
      );

      const sheet =
        subjectId === OVERSEER_SUBJECT
          ? overseer?.attributes
          : base.commanders.find((officer) => officer.id === subjectId)?.attributes;
      if (!sheet) throw new AppError('NOT_FOUND', 'Nobody on your books by that id');

      const blocker = trainingBlocker(
        base.training,
        subjectId,
        attribute,
        sheet,
        now,
        extraSessionsFor(app, base),
        benchesFor(app, base),
      );
      // The wording is the same one the tab already shows against the disabled button, so a player
      // who somehow gets past the client reads the same sentence rather than a second vocabulary.
      if (blocker !== null) throw new AppError('TRAINING_REFUSED', blocker);
      // Counted off the settled book, before this one is added: a drill beside a running one.
      if (base.training.sessions.length > 0) tallyDrillPaired(app.repos, base.id);

      const session: TrainingSession = {
        id: randomUUID(),
        subjectId,
        attribute,
        startedAt: now,
        durationSeconds: TRAINING_SECONDS,
      };
      const training = beginTraining(base.training, session, now);
      app.repos.bases.updateTraining(base.id, training, base.commanders);
      return projectTraining(
        { ...base, training },
        overseer,
        now,
        extraSessionsFor(app, base),
        benchesFor(app, base),
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
      settleTrainingFor(app.repos, ownBase(app, request.currentUser.id), now),
    )();
    if (!settled.overseer) throw new AppError('NOT_FOUND', 'You have not chosen an overseer yet');

    const sheet = crewSheet(crewSheetsFor(app.repos, settled.base));
    // The whole crew fold, not the sheet's ten channels alone. `effectsOfSheet` writes only what
    // attributes drive, so every perk-only channel on this response was structurally zero: the
    // district panel quoted the payroll step at full price and greyed a button `POST /bar/payroll`
    // would have taken, and the crew effects page listed thirteen channels as dormant for ever.
    const effects = crewEffectsFor(app.repos, settled.base);
    return {
      overseer: settled.overseer,
      crewSheet: sheet,
      // Every numeric channel of the fold, not the `EFFECT_CHANNELS` list: that list is the sheet's
      // twenty-two, and the perk-only channels (`payrollStepDiscountPercent` among them) are not on
      // it, so filtering by it dropped exactly the figures this response exists to carry. `perHour`
      // is a resource map rather than a number and is the one thing the filter keeps out.
      effects: Object.fromEntries(
        Object.entries(effects).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number',
        ),
      ),
      // Beside the numbers rather than inside them: the screens that quote a haul need to know
      // which sheets have been granted `picker`, and a record of arrays cannot ride on `effects`.
      marks: effects.unitMarks,
      // ...and the bag the settle actually pays, off the standing fold. See the note on the
      // schema: `effects` is people-only on purpose, and a held Pawn Shop and the three raid
      // modifications are worth up to 83 points that a board reading `effects` never quoted.
      haulPercent: standingEffectsFor(app.repos, settled.base, new Date(now)).lootCapacityPercent,
    };
  });
}
