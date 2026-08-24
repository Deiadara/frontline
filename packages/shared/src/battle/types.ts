import { z } from 'zod';
import { PartialResourcesSchema } from '../resources.js';

/**
 * What a fight leaves on the record.
 *
 * One shape for both kinds of fight — taking a location (§A4) and raiding a home district — because
 * both end up on the same `battles` row and both are read back the same way. What differs is the
 * *target*, which the row carries separately.
 *
 * The engine that produces these is `battle/skirmish.ts`, which delegates to the round simulation
 * in `battle/engine.ts`. `log` is the narrative `battle/report.ts` builds; the numbers behind it
 * are on the `SkirmishOutcome` the engine returns.
 */
export const BattleWinnerSchema = z.enum(['attacker', 'defender']);
export type BattleWinner = z.infer<typeof BattleWinnerSchema>;

export const BattleResultSchema = z.object({
  winner: BattleWinnerSchema,
  log: z.array(z.string()),
  /** What came home. Empty on a loss, and bounded by what the force could carry on a win. */
  rewards: PartialResourcesSchema,
});
export type BattleResult = z.infer<typeof BattleResultSchema>;
