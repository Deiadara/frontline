import { z } from 'zod';
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
});
export type EconomyState = z.infer<typeof EconomyStateSchema>;

export function startingEconomy(now: string): EconomyState {
  return {
    morale: STARTING_MORALE,
    infamy: STARTING_INFAMY,
    reputationTally: startingTally(now),
    payroll: startingPayroll(now),
  };
}

/**
 * Reputation is derived, never stored — one function both the server and the HUD call, so the
 * word a player sees is the word the game means.
 */
export function reputationOf(economy: EconomyState, now: Date): ReputationLabel {
  return deriveReputation({ infamy: economy.infamy, tally: economy.reputationTally }, now);
}
