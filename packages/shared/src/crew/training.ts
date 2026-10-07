import { z } from 'zod';
import { cancelWindowMs, cancelWindowOpen } from '../time/cancel.js';
import {
  ATTRIBUTE_NAMES,
  AttributeNameSchema,
  clampAttribute,
  MAX_ATTRIBUTE,
  type AttributeName,
  type Attributes,
} from '../attributes.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { GAME_TIMEZONE, dayInZone } from '../time/zone.js';
import type { LeaderHold } from '../missions.leading.js';

/**
 * Deliberate practice (GDD §F2).
 *
 * Levelling was the only thing that moved a sheet, which meant a player who wanted a better
 * Cryptography had exactly one move: go and do something unrelated until a level arrived, then
 * spend the point. Training is the other road: small, daily, and *chosen*. It is also the only
 * system in the game where the player says out loud what kind of crew they are building.
 *
 * ## The three rules, and why each exists
 *
 * **Five a day.** A cap, not a currency: unspent days do not bank. The point is a reason to come
 * back tomorrow, and a bankable allowance is a reason to come back in a fortnight and spend forty.
 *
 * **An hour each, less for the quick.** Long enough that the queue is a real decision and short
 * enough to finish inside a session. A person's own Speed, Resolve and Organization take up to half
 * of it off ({@link drillSeconds}). The floor is a queue ({@link TRAINING_QUEUE_SLOTS}): the hours run
 * one after another, never side by side, and one person holds at most one place in it.
 *
 * **Never the same thing twice running.** Without it the whole system collapses into "put every
 * point into your best attribute", the sheet stops describing a person and starts describing a
 * build order, and the other thirty-four attributes are decoration again. It is per person: your
 * Overseer doing Stamina today does not stop an officer doing Stamina today.
 */

/** How many sessions a crew may start in one day. Does not bank. */
export const TRAININGS_PER_DAY = 5;

/**
 * How many drills the floor's queue holds, the one running included (maintainer, 2026-10-04).
 *
 * Two: one on the bench and one waiting behind it, each starting when the one before it ends. The
 * hours never run side by side (maintainer, 2026-09-21: five at once put the whole day through in
 * the first hour), so the allowance is still a *day* and the order is still a decision; the queue
 * only spares a player from coming back on the hour to start the next one. The Professor's fourth
 * rung (`research/tracks.ts`, `training_queue`) adds a third place, which is the only way past this.
 */
export const TRAINING_QUEUE_SLOTS = 2;

/** How long one session takes, before the person on the bench shortens it. */
export const TRAINING_SECONDS = 3600;

/**
 * What each point of a sheet is worth against the hour (maintainer, 2026-10-01).
 *
 * "An officer's speed, resolve and organization all lower training time down to half of what it
 * initially was totally. The ratio is speed being twice as good as the other two." So a point of
 * Speed counts double, and a 20% cut on a sheet even across the three is 10% from Speed and 5%
 * each from Resolve and Organization: each attribute's share of the cut is its share of these
 * weighted points.
 */
export const DRILL_TIME_WEIGHTS = {
  speed: 2,
  resolve: 1,
  organization: 1,
} as const satisfies Partial<Record<AttributeName, number>>;

/** The most of the hour a sheet can take off, approached and never reached: never under half. */
export const DRILL_TIME_CUT_CEILING = 50;

/**
 * How quickly the cut closes on {@link DRILL_TIME_CUT_CEILING}, in weighted points.
 *
 * 174 puts all three at 100 (400 points) at 45%, all three at 50 at 34%, and a fresh recruit at
 * about 15 each at 15%. The maintainer may retune it.
 */
export const DRILL_TIME_CUT_SCALE = 174;

/** The weighted points a sheet brings to the hour: `2 x Speed + Resolve + Organization`. */
export function drillTimePoints(sheet: Pick<Attributes, keyof typeof DRILL_TIME_WEIGHTS>): number {
  return (Object.keys(DRILL_TIME_WEIGHTS) as (keyof typeof DRILL_TIME_WEIGHTS)[]).reduce(
    (total, name) => total + DRILL_TIME_WEIGHTS[name] * Math.max(0, sheet[name]),
    0,
  );
}

/**
 * The percent of the hour this sheet takes off: `50 x (1 - e^(-points / 174))`.
 *
 * A curve rather than a sum with a stop, for the reason every unit effect is one (2026-09-29):
 * every point still helps, and the session never reaches half an hour.
 */
export function drillTimeCutPercent(
  sheet: Pick<Attributes, keyof typeof DRILL_TIME_WEIGHTS>,
): number {
  return DRILL_TIME_CUT_CEILING * (1 - Math.exp(-drillTimePoints(sheet) / DRILL_TIME_CUT_SCALE));
}

/**
 * How long this person's session lasts, in whole seconds.
 *
 * Read off the sheet the crew fields them with (the lifted one, as their march and their spy work
 * are), when the session starts, and stored on it as `durationSeconds`: every reader of a
 * session's end reads that, so a sheet that moves mid-hour moves no clock already running.
 */
export function drillSeconds(sheet: Pick<Attributes, keyof typeof DRILL_TIME_WEIGHTS>): number {
  return Math.round(TRAINING_SECONDS * (1 - drillTimeCutPercent(sheet) / 100));
}

/** What a finished session is worth. */
export const TRAINING_GAIN = 2;

/**
 * Where a session stops being worth two points and starts being worth one.
 *
 * The back half of a skill is meant to cost more than the front half. Flat gains made the last
 * fifty points exactly as cheap as the first fifty, so the only question a player ever had was
 * *which* skill to drill and never *whether* to keep drilling one they had already taken a long
 * way. Halving above the midpoint is what makes the second half a decision: five hours a day is
 * five hours whichever end of the scale it is spent at.
 *
 * It lines up with the band table in `crew/importance.ts`, and that is not a coincidence: 50 is
 * where a skill starts paying real bonus points, so it is where the drilling gets harder.
 */
export const TRAINING_HALF_GAIN_FROM = 50;

/** What one session is worth to a skill that is already at `current`. */
export function trainingGainFor(current: number): number {
  return current >= TRAINING_HALF_GAIN_FROM ? 1 : TRAINING_GAIN;
}

/** The subject id the Overseer trains under. Officers use their own id. */
export const OVERSEER_SUBJECT = 'overseer';

/**
 * One session in flight.
 *
 * `startedAt` plus `durationSeconds` rather than an end timestamp, matching every other queue in
 * the game: a stored end time is a second copy of the duration, and the two disagree the first
 * time a duration is rebalanced.
 */
export const TrainingSessionSchema = z.object({
  id: IdSchema,
  /** `OVERSEER_SUBJECT`, or an officer's id. */
  subjectId: z.string().min(1),
  /**
   * What `last` read for this person when the session began, so a cancel can put it back.
   *
   * `null` is "nothing before"; absent is a session written before this was kept, which
   * `cancelDrill` treats as unknown and leaves alone.
   */
  previousAttribute: AttributeNameSchema.nullable().optional(),
  attribute: AttributeNameSchema,
  /**
   * When the hour begins, which for a drill waiting in the queue is when the one ahead of it ends
   * ({@link nextDrillStart}), so it can be later than now.
   */
  startedAt: IsoDateTimeSchema,
  /**
   * When it was put on the list, and so which day's allowance it was charged to. Differs from
   * `startedAt` only for a drill that queued; absent on a session written before the queue, where
   * the two were the same instant.
   */
  queuedAt: IsoDateTimeSchema.optional(),
  durationSeconds: z.number().int().positive(),
});
export type TrainingSession = z.infer<typeof TrainingSessionSchema>;

export const TrainingStateSchema = z.object({
  /** The game day `used` is counted against. */
  day: z.string(),
  /** Sessions started today. Reset when the day rolls, never carried. */
  used: z.number().int().min(0),
  sessions: z.array(TrainingSessionSchema),
  /**
   * What each person trained most recently: the memory the no-repeat rule reads.
   *
   * Written when a session *starts*, not when it finishes, so queueing Stamina twice in a row is
   * refused at the point the player asks for it rather than an hour later.
   */
  last: z.record(z.string(), AttributeNameSchema),
});
export type TrainingState = z.infer<typeof TrainingStateSchema>;

export function startingTraining(now: string): TrainingState {
  return { day: trainingDay(now), used: 0, sessions: [], last: {} };
}

/** The game calendar day an instant belongs to. Athens, like every other daily reset. */
export function trainingDay(now: string, zone: string = GAME_TIMEZONE): string {
  return dayInZone(new Date(now), zone);
}

/** The state with today's allowance in it. Idempotent, and safe to call on every read. */
export function rollDay(state: TrainingState, now: string): TrainingState {
  const today = trainingDay(now);
  return state.day === today ? state : { ...state, day: today, used: 0 };
}

/**
 * How many sessions this crew may still start today.
 *
 * `extra` is what the ground adds (§A4): the Gym is one more session in a day than the day has
 * room for, and at level 4 it is four more. Threaded through here rather than added at the call
 * site so the count on the screen and the gate in `trainingBlocker` cannot disagree about it.
 */
export function trainingsLeft(state: TrainingState, now: string, extra = 0): number {
  return Math.max(0, TRAININGS_PER_DAY + Math.max(0, extra) - rollDay(state, now).used);
}

export function drillEndsAt(session: TrainingSession): number {
  return Date.parse(session.startedAt) + session.durationSeconds * 1000;
}

export function drillRemainingMs(session: TrainingSession, now: number): number {
  return Math.max(0, drillEndsAt(session) - now);
}

/** How long a drill waiting in the queue has until it begins; zero once it has. */
export function drillWaitMs(session: TrainingSession, now: number): number {
  return Math.max(0, Date.parse(session.startedAt) - now);
}

/** 0..1 through the hour, for a bar that fills. */
export function drillProgressAt(session: TrainingSession, now: number): number {
  const total = session.durationSeconds * 1000;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - Date.parse(session.startedAt)) / total));
}

/** This person's place in the queue, running or waiting. One per person (maintainer, 2026-10-04). */
export function sessionFor(state: TrainingState, subjectId: string): TrainingSession | undefined {
  return state.sessions.find((session) => session.subjectId === subjectId);
}

/** Whether the hour has begun, as against waiting its turn in the queue. */
export function drillUnderway(session: TrainingSession, now: number): boolean {
  return Date.parse(session.startedAt) <= now;
}

/** When a drill joining the queue now would begin: as the last one in it ends, or now if it is empty. */
export function nextDrillStart(state: TrainingState, now: string): string {
  const last = Math.max(Date.parse(now), ...state.sessions.map(drillEndsAt));
  return new Date(last).toISOString();
}

/** Why this session cannot start, or `null` when it can. Player-facing wording. */
export type TrainingBlocker = string;

/**
 * The refusals in the player's words, one copy for the server's `trainingBlocker` and the client's
 * dimmed drill (bug pass, 2026-10-06): the two had drifted into different sentences for the same
 * rule ("Nothing left today" against "No sessions left today").
 */
export const TRAINING_BLOCKERS = {
  noSessions: 'No sessions left today',
  inSession: 'Already in a session',
  inQueue: 'Already in the queue',
  queueFull: 'The queue is full',
  lastTime: 'Trained that last time',
  maxed: 'Nothing left to learn here',
} as const;

/**
 * Somebody away from the floor cannot drill (maintainer, 2026-10-06): out leading a run, held for
 * a fight, or laid up. The bench may, which is why `bench` answers null. One sentence for the
 * route and the dimmed drill.
 */
export function drillHoldBlocker(held: LeaderHold | null): TrainingBlocker | null {
  switch (held) {
    case 'run':
      return 'Out leading a run';
    case 'fight':
      return 'Held for a fight';
    case 'injury':
      return 'Laid up';
    default:
      return null;
  }
}

export function trainingBlocker(
  state: TrainingState,
  subjectId: string,
  attribute: AttributeName,
  sheet: Attributes,
  now: string,
  extra = 0,
  /** Places in the queue: {@link TRAINING_QUEUE_SLOTS} plus what the Professor's track has bought. */
  slots = TRAINING_QUEUE_SLOTS,
): TrainingBlocker | null {
  const rolled = rollDay(state, now);
  if (trainingsLeft(rolled, now, extra) <= 0) return TRAINING_BLOCKERS.noSessions;
  const held = sessionFor(rolled, subjectId);
  if (held) {
    return drillUnderway(held, Date.parse(now))
      ? TRAINING_BLOCKERS.inSession
      : TRAINING_BLOCKERS.inQueue;
  }
  // After the per-person check, so someone already on the list reads the more exact refusal.
  if (rolled.sessions.length >= slots) return TRAINING_BLOCKERS.queueFull;
  if (rolled.last[subjectId] === attribute) return TRAINING_BLOCKERS.lastTime;
  if (sheet[attribute] >= MAX_ATTRIBUTE) return TRAINING_BLOCKERS.maxed;
  return null;
}

/**
 * Put a session on the board.
 *
 * The caller has already checked {@link trainingBlocker}; this does not re-check, because it is
 * also the function a test uses to build a state in a known shape and a guard here would make the
 * happy path and the fixture path disagree about what is possible.
 */
/** Whether a drill can still be called off: inside the first tenth of its hour. */
export function drillCancellable(session: TrainingSession, now: string): boolean {
  return cancelWindowOpen(
    Date.parse(session.startedAt),
    session.durationSeconds * 1000,
    Date.parse(now),
  );
}

export function drillCancelWindowMs(session: TrainingSession, now: string): number {
  return cancelWindowMs(
    Date.parse(session.startedAt),
    session.durationSeconds * 1000,
    Date.parse(now),
  );
}

/**
 * Take a drill off the board and hand the day's session back: nothing was learned, so nothing
 * was spent but the slot, and the slot comes back whole.
 *
 * The no-repeat memory comes back too. `last` is written when a session *starts*, so a cancelled
 * Stamina hour left "Trained that last time" standing against Stamina for a drill that never
 * happened, and the only way past it was to drill something else first. It is put back to what
 * it read before the session began, which `beginTraining` kept on the session for exactly this;
 * simply deleting it would let a player cancel an hour to drill the same thing twice running,
 * which is the rule the memory exists to hold.
 *
 * A session written before the memory was kept (`previousAttribute` absent) leaves `last` as it
 * stands: the conservative reading, one refused drill rather than one free repeat.
 */
export function cancelDrill(state: TrainingState, sessionId: string, now: string): TrainingState {
  const rolled = rollDay(state, now);
  const cancelled = rolled.sessions.find((session) => session.id === sessionId);
  if (!cancelled) return rolled;
  const last = { ...rolled.last };
  if (cancelled.previousAttribute === null) delete last[cancelled.subjectId];
  else if (cancelled.previousAttribute !== undefined) {
    last[cancelled.subjectId] = cancelled.previousAttribute;
  }
  /*
   * The slot comes back only when it was spent today.
   *
   * `rollDay` has already put today's `used` back to zero, and an hour started before the boundary
   * was charged against an allowance that no longer exists: taking one off this one hands the crew
   * an hour they never spent. Reachable whenever a drill started at 23:57 is still inside its
   * six-minute window at 00:01 and today's counter is already standing at one.
   *
   * Read off the day it was *queued*, not the day it starts: a drill put on the list at 23:30
   * behind one ending at 00:20 was charged to the day it was asked for.
   */
  const spentToday = trainingDay(cancelled.queuedAt ?? cancelled.startedAt) === rolled.day;
  return {
    ...rolled,
    used: spentToday ? Math.max(0, rolled.used - 1) : rolled.used,
    sessions: closeUpQueue(
      rolled.sessions.filter((session) => session.id !== sessionId),
      Date.parse(now),
    ),
    last,
  };
}

/**
 * The queue with the gap a cancel left closed: every drill still waiting starts as the one ahead
 * of it ends, or now, whichever is later. A drill already under way keeps its clock.
 */
function closeUpQueue(sessions: readonly TrainingSession[], now: number): TrainingSession[] {
  let cursor = now;
  return [...sessions]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((session) => {
      const startedAt = drillUnderway(session, now)
        ? session.startedAt
        : new Date(Math.max(cursor, now)).toISOString();
      const placed = startedAt === session.startedAt ? session : { ...session, startedAt };
      cursor = Math.max(cursor, drillEndsAt(placed));
      return placed;
    });
}

export function beginTraining(
  state: TrainingState,
  session: TrainingSession,
  now: string,
): TrainingState {
  const rolled = rollDay(state, now);
  return {
    ...rolled,
    used: rolled.used + 1,
    sessions: [
      ...rolled.sessions,
      { ...session, previousAttribute: rolled.last[session.subjectId] ?? null },
    ],
    last: { ...rolled.last, [session.subjectId]: session.attribute },
  };
}

/**
 * One finished session, waiting to be written onto somebody's sheet.
 *
 * Deliberately carries **no amount**. What a session is worth depends on where the skill already
 * is (see {@link trainingGainFor}), and this struct is produced by `settleTraining`, which reads
 * the clock and not the sheet. An `amount` here would be a second, staler answer to a question
 * `applyGain` is already the authority on, and the two would drift the first time the rule changed.
 */
export interface TrainingGain {
  subjectId: string;
  attribute: AttributeName;
}

/**
 * Everything that has finished, taken off the board.
 *
 * Pure: it says what was earned and hands back the remaining state. Applying a gain to a sheet
 * means writing to two different tables, the Overseer's own row and the base's officer blob, and
 * that belongs to whoever owns those, not to a rule.
 */
export function settleTraining(
  state: TrainingState,
  now: string,
): { state: TrainingState; gains: TrainingGain[] } {
  const at = Date.parse(now);
  const done = state.sessions.filter((session) => drillEndsAt(session) <= at);
  if (done.length === 0) return { state: rollDay(state, now), gains: [] };
  return {
    state: {
      ...rollDay(state, now),
      sessions: state.sessions.filter((session) => drillEndsAt(session) > at),
    },
    gains: done.map((session) => ({
      subjectId: session.subjectId,
      attribute: session.attribute,
    })),
  };
}

/**
 * A finished session, applied. Clamped, so a 99 does not go past the ceiling.
 *
 * The **only** place a session's value is decided, and it is decided against the sheet in front of
 * it: two points below the halfway mark and one at or above it.
 */
export function applyGain(sheet: Attributes, gain: TrainingGain): Attributes {
  const current = sheet[gain.attribute];
  return { ...sheet, [gain.attribute]: clampAttribute(current + trainingGainFor(current)) };
}

/**
 * What the hour actually looks like.
 *
 * The maintainer asked for a title on each one: a workout for something physical, the right book for
 * something mental, and the reason to write thirty-five rather than four is that four means the
 * Training tab shows the same sentence five times a day forever. These are the closest this game
 * gets to saying what a day in the district is like, so they are specific: a place, a piece of
 * equipment, somebody else in the room.
 */
export interface Drill {
  /** What the session is called. */
  title: string;
  /** One line, present tense, about the hour itself. */
  detail: string;
}

export const TRAINING_DRILLS: Readonly<Record<AttributeName, Drill>> = {
  strength: {
    title: 'Axle work',
    detail: 'A truck axle, a chalk line and somebody counting badly.',
  },
  stamina: {
    title: 'The stair run',
    detail: 'Forty flights of the Nexus service stack, then forty more, breathing the smog.',
  },
  dexterity: {
    title: 'Wire drill',
    detail: 'Strip, splice, seal. Blindfolded by the end of the hour, because the power stays on.',
  },
  speed: {
    title: 'Curfew sprints',
    detail: 'Marked distance across the yard, on the clock, on the whistle.',
  },
  reflexes: {
    title: 'The drop board',
    detail: 'Somebody drops a bolt without warning. You catch it or you pick it up.',
  },
  toughness: {
    title: 'Cold hours',
    detail: 'Stand in the vent wash until it stops being interesting, then keep standing.',
  },
  stealth: {
    title: 'Floor plan walk',
    detail: 'Cross a lit room without a single person in it looking up.',
  },
  organization: {
    title: 'The board',
    detail: 'Take a stalled job apart on paper until the reason it stalled is on one line.',
  },
  analysis: {
    title: 'After-action reading',
    detail: 'A stack of reports on fights that went wrong, and no help about which part mattered.',
  },
  improvisation: {
    title: 'Wrong-parts bench',
    detail: 'Build the thing on the card out of the crate, which does not contain the parts.',
  },
  logic: {
    title: 'Three witnesses',
    detail: 'Three accounts of the same night. Two are wrong and nobody says which.',
  },
  composure: {
    title: 'Breath and count',
    detail: 'An hour of doing something dull while the alarm bell is rung on purpose.',
  },
  resolve: {
    title: 'The long sit',
    detail: 'Hold a position nobody is contesting, past the point it feels like a waste.',
  },
  intuition: {
    title: 'Cold room',
    detail: 'Walk into a room somebody left in a hurry and say what happened in it.',
  },
  strategy: {
    title: 'The map table',
    detail: 'Take the district apart into ground worth holding and ground worth losing.',
  },
  authority: {
    title: 'Standing the room',
    detail: 'Give a briefing to people who have decided in advance not to be impressed.',
  },
  leadership: {
    title: 'Shift handover',
    detail: 'Run the change of watch. Nobody leaves confused, nobody leaves resentful.',
  },
  charisma: {
    title: 'A night at the bar',
    detail: 'Buy nothing, leave with four names and a favour owed.',
  },
  communication: {
    title: 'Radio discipline',
    detail: 'Say the whole thing in nine words, over a channel that keeps dropping.',
  },
  intimidation: {
    title: 'The doorway',
    detail: 'Stand in one. Practise not saying anything at all.',
  },
  negotiation: {
    title: 'Wage table',
    detail: 'Open the book with somebody who has done this longer than you have.',
  },
  deception: {
    title: 'The false ledger',
    detail: 'Write a week of records that survive being read carefully by a stranger.',
  },
  empathy: {
    title: 'The quiet one',
    detail: 'Find whoever has stopped talking this week and find out what about.',
  },
  diplomacy: {
    title: "Neighbour's table",
    detail: 'An hour with a crew you are not fighting, spent not starting anything.',
  },
  engineering: {
    title: 'Teardown',
    detail: 'Strip a generator to its plates and have it running before the shift ends.',
  },
  signals: {
    title: 'Combine traffic',
    detail:
      'A day of intercepts, most of it weather reports, one of it not. Then the same pass over your own net, looking for what a stranger would have found.',
  },
  craft: {
    title: 'Bench fit',
    detail:
      'Make the part twice. Keep the one that seats without persuasion, and mend the one that did not.',
  },
  medicine: {
    title: 'Triage round',
    detail: 'The infirmary at shift change, deciding who waits.',
  },
  cybernetics: {
    title: 'Calibration',
    detail: "Tune somebody else's shunt while they tell you exactly how it feels.",
  },
  salvage: {
    title: 'Wreck walk',
    detail: 'An hour in the yard deciding what is worth the trip and what is scenery.',
  },
  encyclopedia: {
    title: 'Reading week',
    detail:
      'Half a shelf of somebody else\u2019s trade, at speed. Nobody is examined on it and everybody is, later, without warning.',
  },
  navigation: {
    title: 'Undergrid route',
    detail: 'Cross four levels without surfacing and without asking anyone.',
  },
  chemistry: {
    title: 'The bathtub run',
    detail: 'Same feedstock, better yield, nothing catches fire.',
  },
  logistics: {
    title: 'Manifest night',
    detail: 'Count the warehouse against the book until they agree.',
  },
  cryptography: {
    title: 'Cipher hour',
    detail: "Break yesterday's traffic, then write today's so it cannot be.",
  },
};

/** Every attribute, in the order a Training tab should offer them. */
export const TRAINABLE_ATTRIBUTES: readonly AttributeName[] = ATTRIBUTE_NAMES;
