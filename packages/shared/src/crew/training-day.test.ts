import { describe, expect, it } from 'vitest';
import {
  TRAININGS_PER_DAY,
  TRAINING_SECONDS,
  beginTraining,
  cancelDrill,
  drillCancellable,
  startingTraining,
  trainingDay,
  trainingsLeft,
  type TrainingSession,
  type TrainingState,
} from './training.js';

/**
 * The day an hour is charged against, and the day it is refunded to.
 *
 * `rollDay` puts today's allowance back at zero and leaves yesterday's sessions on the board,
 * which is right: an hour that straddles midnight is still running. What was wrong is the refund.
 * `cancelDrill` took one off `used` whatever day the cancelled hour started on, so a drill charged
 * to yesterday handed its slot back to *today*.
 *
 * Reachable whenever a drill started at 23:57 is still inside its cancel window (`CANCEL_WINDOW`,
 * six minutes of the hour) at 00:01, by which time the crew has already spent one of today's five
 * queueing the next. Cancel the old one and the counter goes back to zero with an hour of today's
 * work already on the list.
 */

/** 23:57 Athens on the 23rd, and 00:01 Athens on the 24th: four minutes apart across midnight. */
const YESTERDAY_LATE = '2026-09-23T20:57:00.000Z';
const TODAY_EARLY = '2026-09-23T21:01:00.000Z';

const session = (id: string, subjectId: string, startedAt: string): TrainingSession => ({
  id,
  subjectId,
  attribute: 'stamina',
  startedAt,
  durationSeconds: TRAINING_SECONDS,
});

describe('cancelling an hour that was charged to another day', () => {
  it('is set up on a real boundary, with the old drill still inside its window', () => {
    // The control: if either of these stopped holding, every assertion below would be vacuous.
    expect(trainingDay(YESTERDAY_LATE)).toBe('2026-09-23');
    expect(trainingDay(TODAY_EARLY)).toBe('2026-09-24');
    expect(drillCancellable(session('a', 'overseer', YESTERDAY_LATE), TODAY_EARLY)).toBe(true);
  });

  it('leaves today’s allowance alone when yesterday’s hour is called off', () => {
    const yesterday: TrainingState = {
      ...startingTraining(YESTERDAY_LATE),
      used: 1,
      sessions: [session('a', 'overseer', YESTERDAY_LATE)],
      last: { overseer: 'stamina' },
    };
    // The second bench takes one of today's five while yesterday's hour is still running.
    const started = beginTraining(yesterday, session('b', 'off-1', TODAY_EARLY), TODAY_EARLY);
    expect(started.day).toBe('2026-09-24');
    expect(started.used).toBe(1);

    const cancelled = cancelDrill(started, 'a', TODAY_EARLY);
    // Today paid for one hour and is still running it, so one of today's five is gone.
    expect(cancelled.used).toBe(1);
    expect(trainingsLeft(cancelled, TODAY_EARLY)).toBe(TRAININGS_PER_DAY - 1);
    expect(cancelled.sessions.map((one) => one.id)).toEqual(['b']);
  });

  it('still hands back a slot spent on the same day', () => {
    // The positive control for the fix: the ordinary cancel has to keep paying its hour back.
    const today = beginTraining(
      startingTraining(TODAY_EARLY),
      session('c', 'overseer', TODAY_EARLY),
      TODAY_EARLY,
    );
    expect(today.used).toBe(1);
    expect(cancelDrill(today, 'c', TODAY_EARLY).used).toBe(0);
    expect(trainingsLeft(cancelDrill(today, 'c', TODAY_EARLY), TODAY_EARLY)).toBe(
      TRAININGS_PER_DAY,
    );
  });
});

/**
 * A drill waiting in the queue starts on a later day than it was asked for (2026-10-04), and the
 * day it is charged to is the day it was *queued*, which `queuedAt` keeps.
 */
describe('cancelling a queued drill across midnight', () => {
  /** 23:30 Athens on the 23rd, and the hour ahead of it ending at 00:20 on the 24th. */
  const QUEUED_AT = '2026-09-23T20:30:00.000Z';
  const STARTS_AT = '2026-09-23T21:20:00.000Z';
  const queued = (): TrainingState =>
    beginTraining(
      {
        ...startingTraining(QUEUED_AT),
        used: 1,
        sessions: [session('a', 'overseer', '2026-09-23T20:20:00.000Z')],
      },
      { ...session('q', 'off-1', STARTS_AT), queuedAt: QUEUED_AT },
      QUEUED_AT,
    );

  it('hands the slot back to the day it was queued on', () => {
    expect(trainingDay(STARTS_AT)).toBe('2026-09-24');
    const state = queued();
    expect(state.used).toBe(2);
    expect(cancelDrill(state, 'q', '2026-09-23T20:40:00.000Z').used).toBe(1);
  });

  it('leaves the next day alone once midnight has passed', () => {
    // One of today's five already spent, so a refund charged to the wrong day would show.
    const today = beginTraining(queued(), session('t', 'off-2', TODAY_EARLY), TODAY_EARLY);
    expect(today.used).toBe(1);
    expect(cancelDrill(today, 'q', TODAY_EARLY).used).toBe(1);
  });
});
