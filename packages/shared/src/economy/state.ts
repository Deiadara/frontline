import { z } from 'zod';
import { IsoDateTimeSchema } from '../primitives.js';
import { DisruptionSchema, noDisruption } from '../raid.js';
import { FractionalResourcesSchema } from '../resources.js';
import { InfamySchema, STARTING_INFAMY } from './infamy.js';
import { NotorietySchema, STARTING_NOTORIETY } from './notoriety.js';
import { PayrollStateSchema, startingPayroll } from './payroll.js';

/**
 * Everything about a base that is neither a stockpile nor a structure: the name the city knows
 * (§D7) and the payroll book officers are committed against (§H7).
 *
 * This is the *only* copy of these counters in the system: nothing else may tally infamy.
 *
 * Two things used to live here and no longer do. District morale is gone outright: it was a meter
 * that drifted on its own, that a player could not act on directly, and that nothing downstream
 * read except itself. Morale survives where it always meant something, on a unit in a fight
 * (`battle/morale.ts`). Reputation went with it: a one-word verdict on the crew that gated who
 * would sign, which turned recruitment into a quiz about a label rather than a negotiation. What
 * an officer judges now is the crew's rank, its level and its caps, and all three are numbers the
 * player can see and move.
 */
export const EconomyStateSchema = z.object({
  /**
   * §D7: uncapped, and the only thing that lowers it is the crew spending it: a rung of the
   * notoriety ladder, or a boost on a declared fight. Written as a plain number rather than a meter
   * since the rework: a base stored under the old 0..100 schema still parses, because every value
   * it could hold is a legal point total.
   */
  infamy: InfamySchema,
  /**
   * §D7: the rank the crew has bought with its name, as an index into `NOTORIETY_TIERS`.
   *
   * Separate from the points beside it, and that separation is the whole rework: `infamy` is a
   * wallet that rises and falls, `notoriety` is a rank that only rises. Every gate in the game
   * reads this one. Defaulted to 0 so a base written before the ladder existed parses as a Nobody,
   * which is what it was.
   */
  notoriety: NotorietySchema,
  payroll: PayrollStateSchema,
  /**
   * When the district's structures last paid out (§A1): the one stored clock behind lazy
   * production and the Generator's fuel burn.
   *
   * Nullable, and null means "start counting now" rather than "the epoch": a base minted before
   * production existed must not be handed three weeks of back pay the first time it is opened.
   */
  productionSettledAt: IsoDateTimeSchema.nullable().default(null),
  /**
   * §A4: what a raid left behind. A home district cannot be captured, but it can be robbed and
   * left running at reduced effectiveness for a while afterwards.
   *
   * Defaulted so a base written before raiding existed parses as undisrupted.
   */
  disruption: DisruptionSchema.default({ until: null, percent: 0 }),
  /**
   * What the district has made but not yet banked: fractions of a unit, per resource.
   *
   * The counterweight to an integral stockpile. `ResourcesSchema` is whole numbers now, and the
   * naive way to satisfy it is to round every settle, which robs a player whose client polls faster
   * than the rounding survives. Instead the whole units go to the stockpile and the remainder sits
   * here until it adds up to one, so a quarter-a-metal-an-hour Scrapyard still pays out four times
   * a day however many times the page was refreshed.
   *
   * Deliberately *not* integral itself. It is the only fractional number the economy stores, and
   * it exists precisely so that nothing else has to be. Defaulted so a base written before whole
   * numbers were enforced parses as owing nothing.
   */
  productionCarry: FractionalResourcesSchema.default({}),
});
export type EconomyState = z.infer<typeof EconomyStateSchema>;

export function startingEconomy(now: string): EconomyState {
  return {
    infamy: STARTING_INFAMY,
    notoriety: STARTING_NOTORIETY,
    payroll: startingPayroll(now),
    productionSettledAt: now,
    disruption: noDisruption(),
    productionCarry: {},
  };
}
