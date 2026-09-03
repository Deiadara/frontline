import { z } from 'zod';
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
 * **An hour each.** Long enough that the queue is a real decision and short enough to finish
 * inside a session. Sessions run side by side across different people; one person can only be
 * doing one thing at a time, which is the only part of this that is a simulation rather than a
 * rule.
 *
 * **Never the same thing twice running.** Without it the whole system collapses into "put every
 * point into your best attribute", the sheet stops describing a person and starts describing a
 * build order, and the other thirty-four attributes are decoration again. It is per person: your
 * Overseer doing Stamina today does not stop an officer doing Stamina today.
 */

/** How many sessions a crew may start in one day. Does not bank. */
export const TRAININGS_PER_DAY = 5;

/** How long one session takes. */
export const TRAINING_SECONDS = 3600;

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
  attribute: AttributeNameSchema,
  startedAt: IsoDateTimeSchema,
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

/** 0..1 through the hour, for a bar that fills. */
export function drillProgressAt(session: TrainingSession, now: number): number {
  const total = session.durationSeconds * 1000;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - Date.parse(session.startedAt)) / total));
}

/** Whoever is already busy. One session per person at a time. */
export function sessionFor(state: TrainingState, subjectId: string): TrainingSession | undefined {
  return state.sessions.find((session) => session.subjectId === subjectId);
}

/** Why this session cannot start, or `null` when it can. Player-facing wording. */
export type TrainingBlocker = string;

export function trainingBlocker(
  state: TrainingState,
  subjectId: string,
  attribute: AttributeName,
  sheet: Attributes,
  now: string,
  extra = 0,
): TrainingBlocker | null {
  const rolled = rollDay(state, now);
  if (trainingsLeft(rolled, now, extra) <= 0) return 'No sessions left today';
  if (sessionFor(rolled, subjectId)) return 'Already in a session';
  if (rolled.last[subjectId] === attribute) return 'Trained that last time';
  if (sheet[attribute] >= MAX_ATTRIBUTE) return 'Nothing left to learn here';
  return null;
}

/**
 * Put a session on the board.
 *
 * The caller has already checked {@link trainingBlocker}; this does not re-check, because it is
 * also the function a test uses to build a state in a known shape and a guard here would make the
 * happy path and the fixture path disagree about what is possible.
 */
export function beginTraining(
  state: TrainingState,
  session: TrainingSession,
  now: string,
): TrainingState {
  const rolled = rollDay(state, now);
  return {
    ...rolled,
    used: rolled.used + 1,
    sessions: [...rolled.sessions, session],
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
 * The board asked for a title on each one: a workout for something physical, the right book for
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
