import { z } from 'zod';

/**
 * When a fight may be called for (GDD §A4, battle rework).
 *
 * Battles stopped being something you press a button and watch resolve. You **declare** one for a
 * time, both sides get most of a day to move people towards it, and it goes off on the mark whether
 * or not anybody is watching. Three rules shape the whole system and every one of them is here:
 *
 * - **Half-hour marks only.** 12:30, 13:00, 13:30. A continuous clock would let a declaration land
 *   at 20:47:13 and turn the whole feature into a race to be the last to press send; a grid means
 *   two crews reading the same board see the same handful of times.
 * - **Eight hours' notice at the earliest.** The defender has to be able to *do* something about it.
 *   Eight hours is the shortest span that survives a sleep cycle in the wrong timezone, which is the
 *   difference between a strategy game and an alarm clock.
 * - **A day at the latest.** Past that the declaration stops being a threat and becomes a diary
 *   entry, and the ground it names would sit frozen for a week.
 *
 * Everything is computed from `now` and returns UTC instants. Nothing here stores anything: a window
 * is a pure function of the moment it was asked about, so a client and the server agree without
 * either sending the other a list.
 */

/** Battles land on the half hour, and nowhere else. */
export const BATTLE_SLOT_MINUTES = 30;
export const SLOT_MS = BATTLE_SLOT_MINUTES * 60_000;

/** The shortest notice a defender may be given. The board's example: at 12:00, 20:00 is the first. */
export const MIN_DECLARE_LEAD_HOURS = 8;
/** ...and the longest, so a declaration is a fight rather than an appointment. */
export const MAX_DECLARE_LEAD_HOURS = 24;

const HOUR_MS = 3_600_000;

/** The half-hour mark at or after `at`. Already on a mark means `at` itself. */
export function slotAtOrAfter(at: Date): Date {
  const time = at.getTime();
  const remainder = time % SLOT_MS;
  return remainder === 0 ? new Date(time) : new Date(time + (SLOT_MS - remainder));
}

/** The half-hour mark at or before `at`. */
export function slotAtOrBefore(at: Date): Date {
  const time = at.getTime();
  return new Date(time - (time % SLOT_MS));
}

/** Whether an instant sits exactly on a half-hour mark. */
export function isOnSlot(at: Date): boolean {
  return at.getTime() % SLOT_MS === 0;
}

export interface DeclarationWindow {
  /** The earliest mark that may be declared for. */
  earliest: Date;
  /** The latest. */
  latest: Date;
}

/**
 * The band of marks open right now.
 *
 * `earliest` rounds *up* off the eight-hour floor and `latest` rounds *down* off the day ceiling, so
 * neither bound can be widened by rounding — a window that rounded outwards would quietly hand a
 * declaring crew seven hours and fifty-nine minutes of notice on the defender.
 */
export function declarationWindow(now: Date): DeclarationWindow {
  return {
    earliest: slotAtOrAfter(new Date(now.getTime() + MIN_DECLARE_LEAD_HOURS * HOUR_MS)),
    latest: slotAtOrBefore(new Date(now.getTime() + MAX_DECLARE_LEAD_HOURS * HOUR_MS)),
  };
}

/** Every mark a declaration could name right now, in order. What a picker renders. */
export function declarableSlots(now: Date): Date[] {
  const { earliest, latest } = declarationWindow(now);
  const slots: Date[] = [];
  for (let time = earliest.getTime(); time <= latest.getTime(); time += SLOT_MS) {
    slots.push(new Date(time));
  }
  return slots;
}

export const SCHEDULE_REFUSALS = ['off_slot', 'too_soon', 'too_late'] as const;
export const ScheduleRefusalSchema = z.enum(SCHEDULE_REFUSALS);
export type ScheduleRefusal = z.infer<typeof ScheduleRefusalSchema>;

export const SCHEDULE_REFUSAL_MESSAGES: Readonly<Record<ScheduleRefusal, string>> = {
  off_slot: 'Fights are called on the half hour, and only on the half hour',
  too_soon: `Nobody gets less than ${MIN_DECLARE_LEAD_HOURS} hours to see you coming`,
  too_late: `Nothing is called more than ${MAX_DECLARE_LEAD_HOURS} hours out`,
};

/**
 * Why a time is not declarable, or `null` when it is.
 *
 * Off-slot is checked first on purpose: it is the one a client can fix by picking from the list it
 * was given, and telling a player their 20:47 is eight minutes too early would send them looking in
 * the wrong direction.
 */
export function scheduleRefusal(at: Date, now: Date): ScheduleRefusal | null {
  if (!isOnSlot(at)) return 'off_slot';
  const { earliest, latest } = declarationWindow(now);
  if (at.getTime() < earliest.getTime()) return 'too_soon';
  if (at.getTime() > latest.getTime()) return 'too_late';
  return null;
}

/**
 * The last instant reinforcements may still arrive.
 *
 * One second before the mark, which is the board's rule stated literally. It exists as a named
 * function rather than as `scheduledFor - 1000` at three call sites because "can I still send
 * people" is asked by the route, the settler and the screen, and three copies of a subtraction is
 * how two of them end up disagreeing by a second.
 */
export const DEPLOY_CUTOFF_MS = 1000;

export function deploymentClosesAt(scheduledFor: Date): Date {
  return new Date(scheduledFor.getTime() - DEPLOY_CUTOFF_MS);
}

export function deploymentIsOpen(scheduledFor: Date, now: Date): boolean {
  return now.getTime() <= deploymentClosesAt(scheduledFor).getTime();
}
