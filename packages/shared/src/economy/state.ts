import { z } from 'zod';
import { IsoDateTimeSchema } from '../primitives.js';
import { DisruptionSchema, noDisruption } from '../raid.js';
import { FractionalResourcesSchema } from '../resources.js';
import { InfamySacrificeSchema, InfamySchema, STARTING_INFAMY } from './infamy.js';
import { MeterSchema, STARTING_MORALE } from './meters.js';
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
  /**
   * §D7 — uncapped, and the only thing that lowers it is {@link EconomyState.sacrifice}. Written as
   * a plain number rather than a meter since the rework: a base stored under the old 0..100 schema
   * still parses, because every value it could hold is a legal point total.
   */
  infamy: InfamySchema,
  /**
   * The one sacrifice currently burning (§D7), or null. Defaulted so a base written before infamy
   * had a sink parses as having spent nothing.
   */
  sacrifice: InfamySacrificeSchema.nullable().default(null),
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
  /**
   * §A4 — what a raid left behind. A home district cannot be captured, but it can be robbed and
   * left running at reduced effectiveness for a while afterwards.
   *
   * Defaulted so a base written before raiding existed parses as undisrupted.
   */
  disruption: DisruptionSchema.default({ until: null, percent: 0 }),
  /**
   * What the district has made but not yet banked — fractions of a unit, per resource.
   *
   * The counterweight to an integral stockpile. `ResourcesSchema` is whole numbers now, and the
   * naive way to satisfy it is to round every settle, which robs a player whose client polls faster
   * than the rounding survives. Instead the whole units go to the stockpile and the remainder sits
   * here until it adds up to one, so a quarter-a-metal-an-hour Scrapyard still pays out four times
   * a day however many times the page was refreshed.
   *
   * Deliberately *not* integral itself — it is the only fractional number the economy stores, and
   * it exists precisely so that nothing else has to be. Defaulted so a base written before whole
   * numbers were enforced parses as owing nothing.
   */
  productionCarry: FractionalResourcesSchema.default({}),
});
export type EconomyState = z.infer<typeof EconomyStateSchema>;

export function startingEconomy(now: string): EconomyState {
  return {
    morale: STARTING_MORALE,
    infamy: STARTING_INFAMY,
    sacrifice: null,
    reputationTally: startingTally(now),
    payroll: startingPayroll(now),
    productionSettledAt: now,
    disruption: noDisruption(),
    productionCarry: {},
  };
}

/**
 * Reputation is derived, never stored — one function both the server and the HUD call, so the
 * word a player sees is the word the game means.
 */
export function reputationOf(economy: EconomyState, now: Date): ReputationLabel {
  return deriveReputation({ infamy: economy.infamy, tally: economy.reputationTally }, now);
}
