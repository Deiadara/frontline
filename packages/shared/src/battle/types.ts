import { z } from 'zod';
import { AttributesSchema } from '../attributes.js';
import { IdSchema } from '../primitives.js';
import { PartialResourcesSchema } from '../resources.js';

export const BattleInputSchema = z.object({
  attackerBaseId: IdSchema,
  /** Display name of the attacking base. Ids never reach the narration log. */
  attackerBaseName: z.string().min(1),
  targetDistrictId: IdSchema,
  /**
   * The attacking Overseer's *effective* sheet (§F1) — traits already folded in, exactly as
   * `OverseerSchema` stores it. This is what the raid is led with, and the only thing the player
   * can grow that the engine reads.
   */
  attackerAttributes: AttributesSchema,
  /**
   * Persisted on the battle row, so the fight replays from it. Opaque to the engine: any stable
   * string works, and the server mints a fresh one per battle.
   */
  seed: z.string().min(1),
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
