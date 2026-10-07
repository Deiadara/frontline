import { z } from 'zod';
import { BattleSideSchema } from '../battle/scheduled.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';

/**
 * The Stackhouse: the back room's book on declared fights (maintainer, 2026-10-05).
 *
 * A crew bets caps on who wins a fight that it, or somebody at its faction's table, is in: called
 * by one of them or called on one of them. A winning bet pays twice the stake, a losing one is
 * gone. The book is private: nobody else sees a bet, and nobody else's bet moves anything.
 *
 * One bet at a time, on either side, and it cannot be taken back. Betting on a fight closes an
 * hour before it starts. Never on a fight the crew called itself (maintainer, 2026-10-05): a
 * faction mate's call is fair game, so throwing one is still a play, but not a solo one. The door is the Fixer's third rung (`STACKHOUSE_RESEARCH_ID`, in
 * `research/tracks.ts`) on top of the Black Market's own.
 */

/** The most one bet can stake, in caps. */
export const STACKHOUSE_MAX_STAKE = 5_000;

/** Betting on a fight shuts this long before its mark. */
export const STACKHOUSE_CLOSES_MINUTES = 60;

/** What a winning bet hands back, as a multiple of the stake: the stake and as much again. */
export const STACKHOUSE_PAYOUT_TIMES = 2;

const MINUTE_MS = 60_000;

/** When betting on a fight marked for `scheduledFor` shuts. */
export function stackhouseClosesAt(scheduledFor: string): Date {
  return new Date(Date.parse(scheduledFor) - STACKHOUSE_CLOSES_MINUTES * MINUTE_MS);
}

/** Whether a fight marked for `scheduledFor` still takes bets at `now`. */
export function stackhouseOpen(scheduledFor: string, now: Date): boolean {
  return now.getTime() < stackhouseClosesAt(scheduledFor).getTime();
}

/** What a stake pays when the bet comes in. */
export function stackhousePayout(stake: number): number {
  return stake * STACKHOUSE_PAYOUT_TIMES;
}

/** One side of a fight as the book prints it. `yours` is your crew's or your faction's side. */
export const StackhouseSideViewSchema = z.object({
  name: z.string(),
  yours: z.boolean(),
});
export type StackhouseSideView = z.infer<typeof StackhouseSideViewSchema>;

/** A fight the book takes bets on. */
export const StackhouseFightSchema = z.object({
  battleId: IdSchema,
  /** The place being fought over: a location's name, a gate, or a district. */
  place: z.string(),
  districtName: z.string(),
  attacker: StackhouseSideViewSchema,
  defender: StackhouseSideViewSchema,
  startsAt: IsoDateTimeSchema,
  closesAt: IsoDateTimeSchema,
});
export type StackhouseFight = z.infer<typeof StackhouseFightSchema>;

/** The one bet a crew has riding, until its fight is over. */
export const StackhouseBetSchema = z.object({
  battleId: IdSchema,
  side: BattleSideSchema,
  /** What was charged: nothing on a bet placed in admin mode, which then pays out nothing. */
  stake: z.number().int().nonnegative(),
  placedAt: IsoDateTimeSchema,
  place: z.string(),
  /** The name of the side the bet is on. */
  backing: z.string(),
  startsAt: IsoDateTimeSchema,
});
export type StackhouseBet = z.infer<typeof StackhouseBetSchema>;

/**
 * How a bet ended. `refunded` is a fight that never ran (its attacker or its ground left the
 * world), which hands the stake back rather than calling it either way.
 */
export const STACKHOUSE_OUTCOMES = ['won', 'lost', 'refunded'] as const;
export const StackhouseOutcomeSchema = z.enum(STACKHOUSE_OUTCOMES);
export type StackhouseOutcome = z.infer<typeof StackhouseOutcomeSchema>;

/** The last bet that settled, so the book can say how it went. */
export const StackhouseResultSchema = z.object({
  place: z.string(),
  backing: z.string(),
  /** What was charged, as on {@link StackhouseBetSchema}. */
  stake: z.number().int().nonnegative(),
  outcome: StackhouseOutcomeSchema,
  /** Caps handed back: twice the stake on a win, the stake on a refund, nothing on a loss. */
  payout: z.number().int().nonnegative(),
  settledAt: IsoDateTimeSchema,
});
export type StackhouseResult = z.infer<typeof StackhouseResultSchema>;

export const StackhouseResponseSchema = z.object({
  serverNow: IsoDateTimeSchema,
  /** Whether the Fixer's rung is done. The Black Market's own door is the route's to check. */
  unlocked: z.boolean(),
  /** Fights still taking bets, soonest first. Empty while a bet is riding: one at a time. */
  fights: z.array(StackhouseFightSchema),
  activeBet: StackhouseBetSchema.nullable(),
  lastResult: StackhouseResultSchema.nullable(),
  maxStake: z.number().int().positive(),
});
export type StackhouseResponse = z.infer<typeof StackhouseResponseSchema>;

export const PlaceStackhouseBetRequestSchema = z.object({
  battleId: IdSchema,
  side: BattleSideSchema,
  stake: z.number().int().min(1).max(STACKHOUSE_MAX_STAKE),
});
export type PlaceStackhouseBetRequest = z.infer<typeof PlaceStackhouseBetRequestSchema>;

export const STACKHOUSE_REFUSALS = [
  'locked',
  'bet_riding',
  'own_call',
  'not_your_fight',
  'closed',
  'cannot_afford',
] as const;
export type StackhouseRefusal = (typeof STACKHOUSE_REFUSALS)[number];

export const STACKHOUSE_REFUSAL_TEXT: Readonly<Record<StackhouseRefusal, string>> = {
  locked:
    'The Stackhouse is shut to you. The Fixer has to research Put Your Money Where Your Mouth Is first',
  bet_riding: 'You already have a bet riding. The next one waits until that fight is over',
  own_call: 'You called that fight yourself. The book takes no bet from the crew that called it',
  not_your_fight: 'The book only takes bets on fights you or your faction are in',
  closed: 'Betting on that fight has closed',
  cannot_afford: 'You do not have the caps to cover that stake',
};
