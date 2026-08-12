import { z } from 'zod';
import { IdSchema } from '../primitives.js';
import { PartialResourcesSchema } from '../resources.js';

export const BattleInputSchema = z.object({
  attackerBaseId: IdSchema,
  /** Display name of the attacking base. Ids never reach the narration log. */
  attackerBaseName: z.string().min(1),
  targetDistrictId: IdSchema,
});
export type BattleInput = z.infer<typeof BattleInputSchema>;

export const BattleWinnerSchema = z.enum(['attacker', 'defender']);
export type BattleWinner = z.infer<typeof BattleWinnerSchema>;

export const BattleResultSchema = z.object({
  winner: BattleWinnerSchema,
  log: z.array(z.string()),
  rewards: PartialResourcesSchema,
});
export type BattleResult = z.infer<typeof BattleResultSchema>;

/** Pluggable combat model. The server must depend on this interface, never on a concrete engine. */
export interface BattleEngine {
  simulate(input: BattleInput): BattleResult;
}
