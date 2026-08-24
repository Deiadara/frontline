import { randomUUID } from 'node:crypto';
import {
  OVERSEER_SUBJECT,
  StartTrainingRequestSchema,
  TRAINING_SECONDS,
  beginTraining,
  EFFECT_CHANNELS,
  crewSheet,
  effectsOfSheet,
  trainingBlocker,
  type Base,
  type CrewStandingResponse,
  type TrainingResponse,
  type TrainingSession,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { projectTraining, settleTrainingFor } from '../crew/training.js';
import { crewSheetsFor } from '../crew/standing.js';
import { AppError, parseBody } from '../errors.js';
import { standingEffectsFor } from '../crew/standing.js';

/**
 * §A4 — how many extra sessions the crew's ground buys them today (the Gym).
 *
 * Read in one place and passed to both the projection and the gate, because a screen that says
 * "2 left" over a route that refuses the second is worse than either number being wrong.
 */
function extraSessionsFor(app: FastifyInstance, base: Base): number {
  return standingEffectsFor(app.repos, base).extraTrainingSessions;
}

/**
 * The Training tab and the Overseer's own profile (§F2).
 *
 * Both routes settle first. A player who left an hour ago and comes back should see the point
 * already on the sheet, not a finished bar that pays out on the next click — and settling on read
 * is what makes "come back tomorrow" work without a scheduler.
 */

function ownBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
  return base;
}

export function registerTrainingRoutes(app: FastifyInstance): void {
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
    );
  });

  /** §F2 — put one person through one hour of one thing. */
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
      );
      // The wording is the same one the tab already shows against the disabled button, so a player
      // who somehow gets past the client reads the same sentence rather than a second vocabulary.
      if (blocker !== null) throw new AppError('TRAINING_REFUSED', blocker);

      const session: TrainingSession = {
        id: randomUUID(),
        subjectId,
        attribute,
        startedAt: now,
        durationSeconds: TRAINING_SECONDS,
      };
      const training = beginTraining(base.training, session, now);
      app.repos.bases.updateTraining(base.id, training, base.commanders);
      return projectTraining({ ...base, training }, overseer, now, extraSessionsFor(app, base));
    })();
  });

  /**
   * The Overseer's own page: who they are, and what the crew's sheet is currently buying.
   *
   * The effects are computed from the player's *own* people, so nothing here is hidden from them
   * in the first place — this is the opposite of the §B8a role table, which is about somebody
   * else's fit and never leaves the server.
   */
  app.get('/overseer/me', { preHandler: app.authenticate }, (request): CrewStandingResponse => {
    const now = new Date().toISOString();
    const settled = app.db.transaction(() =>
      settleTrainingFor(app.repos, ownBase(app, request.currentUser.id), now),
    )();
    if (!settled.overseer) throw new AppError('NOT_FOUND', 'You have not chosen an overseer yet');

    const sheet = crewSheet(crewSheetsFor(app.repos, settled.base));
    const effects = effectsOfSheet(sheet);
    return {
      overseer: settled.overseer,
      crewSheet: sheet,
      // Channel by channel rather than the whole struct: `perHour` is a resource map, not a
      // number, and a response typed `Record<string, number>` has to be built from the list of
      // things that actually are numbers.
      effects: Object.fromEntries(EFFECT_CHANNELS.map((channel) => [channel, effects[channel]])),
    };
  });
}
