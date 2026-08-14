import { z } from 'zod';
import { IsoDateTimeSchema } from '../primitives.js';
import { MeterSchema, STARTING_INFAMY, STARTING_MORALE } from './meters.js';
import { PayrollStateSchema, startingPayroll } from './payroll.js';
import {
  ReputationTallySchema,
  deriveReputation,
  startingTally,
  type ReputationLabel,
} from './reputation.js';

/**
 * Everything about a base that is neither a stockpile nor a structure: the two meters (§D4, §D7),
 * the action tally reputation is read off (§D8) and the wage book payroll settles (§H7).
 *
 * These are the *only* copies of these counters in the system — nothing else may tally infamy or
 * reputation.
 */
export const EconomyStateSchema = z.object({
  morale: MeterSchema,
  infamy: MeterSchema,
  reputationTally: ReputationTallySchema,
  payroll: PayrollStateSchema,
  /**
   * When the district's structures last paid out (§A1) — the one stored clock behind lazy
   * production, morale drift and the Generator's fuel burn.
   *
   * Nullable, and null means "start counting now" rather than "the epoch": a base minted before
   * production existed must not be handed three weeks of back pay the first time it is opened.
   */
  productionSettledAt: IsoDateTimeSchema.nullable().default(null),
});
export type EconomyState = z.infer<typeof EconomyStateSchema>;

export function startingEconomy(now: string): EconomyState {
  return {
    morale: STARTING_MORALE,
    infamy: STARTING_INFAMY,
    reputationTally: startingTally(now),
    payroll: startingPayroll(now),
    productionSettledAt: now,
  };
}

/**
 * Reputation is derived, never stored — one function both the server and the HUD call, so the
 * word a player sees is the word the game means.
 */
export function reputationOf(economy: EconomyState, now: Date): ReputationLabel {
  return deriveReputation({ infamy: economy.infamy, tally: economy.reputationTally }, now);
}
