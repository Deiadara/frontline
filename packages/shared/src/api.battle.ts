import { z } from 'zod';
import { BattleAnalysisSchema } from './battle/analysis.js';
import { BattleSideSchema, BattleTargetSchema, ScheduledBattleSchema } from './battle/scheduled.js';
import { BaseSchema } from './base.js';
import { LevelUpSchema } from './api.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { ArmySchema } from './units/index.js';

/**
 * The REST contract for declared battles, deployments, reports and the infamy sinks.
 *
 * A separate module from `api.ts` on purpose: this is a whole feature's worth of DTOs and it has its
 * own reasons for being shaped the way it is, most of which are about **what a payload is allowed to
 * contain**. Everything here is written from one side's point of view, the caller's, because the
 * fog is enforced by not sending things rather than by flagging them, exactly as the city view does.
 */

/** How the caller stands to a battle. `bystander` is a fight in a district they can merely see. */
export const BATTLE_ROLES = ['attacker', 'defender', 'bystander'] as const;
export const BattleRoleSchema = z.enum(BATTLE_ROLES);
export type BattleRole = z.infer<typeof BattleRoleSchema>;

/**
 * What the caller has standing on one side of a coming fight.
 *
 * Exact for their own, because it is theirs. The enemy's is a *count* and only when their
 * counter-intelligence lets it be one, see `battle/intel.ts`, which is why `enemySize` is
 * nullable and `enemyForce` does not exist at all. A composition field that was sometimes null
 * would be a field a client could learn something from by its shape.
 */
export const BattleMusterSchema = z.object({
  army: ArmySchema,
  perimeter: ArmySchema,
  /** Bodies, both forces counted. */
  size: z.number().int().nonnegative(),
});
export type BattleMuster = z.infer<typeof BattleMusterSchema>;

/**
 * One thing a name will buy for one fight (§D7), priced against what the caller currently has.
 *
 * Sent per battle rather than once for the screen, because affordability and reach are both facts
 * about *that* fight: the same boost is a different figure against a force of Razors and a force of
 * Juggernauts, and `reach` is what lets the drop-down say so before the money is spent.
 */
export const BattleBoostOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  cost: z.number().int().nonnegative(),
  /** What it does, in the player's words: "+30% attack for your heavy units". */
  effect: z.string(),
  /** Where it came from, or the empty string for the ones anybody may buy. */
  source: z.string(),
  /** 0..100: how much of what the caller has on the ground this one actually reaches. */
  reach: z.number().int().min(0).max(100),
  /** The crew has the points. */
  affordable: z.boolean(),
  /** The Lab or the right officer has put it on the table. */
  available: z.boolean(),
});
export type BattleBoostOption = z.infer<typeof BattleBoostOptionSchema>;

export const BattleViewSchema = z.object({
  battle: ScheduledBattleSchema,
  /** The location, the district gate or the structure, in the words on the map. */
  targetName: z.string(),
  districtName: z.string(),
  role: BattleRoleSchema,
  /** Which side the caller is on, or null for a bystander. */
  side: BattleSideSchema.nullable(),
  /** Whether people may still be moved. False from one second before the mark. */
  deploymentOpen: z.boolean(),
  /** The caller's own force, exact. Null when they are neither side. */
  muster: BattleMusterSchema.nullable(),
  /** What the caller can make out of the other side, or null when they cannot make out anything. */
  enemySize: z.number().int().nonnegative().nullable(),
  /** One line about how good that reading is. Always present: "nothing" is a reading. */
  enemyIntel: z.string(),
  /** Who the caller is up against, in the words the map uses. */
  opponentName: z.string(),
  /** §D7: every boost this crew could put on this fight. Empty for a bystander. */
  boosts: z.array(BattleBoostOptionSchema),
  /** The one already bought for this fight, or null. One per battle, and it is not refundable. */
  boostId: z.string().nullable(),
});
export type BattleView = z.infer<typeof BattleViewSchema>;

/**
 * A finished fight as one participant is told about it.
 *
 * `analysis` is null when the report did not reach them: the loser with nobody home. `redacted`
 * says which of the two it is, so a client can print the silence rather than an empty table.
 */
export const BattleReportViewSchema = z.object({
  battleId: IdSchema,
  targetName: z.string(),
  resolvedAt: IsoDateTimeSchema,
  side: BattleSideSchema,
  won: z.boolean(),
  analysis: BattleAnalysisSchema.nullable(),
  redacted: z.boolean(),
});
export type BattleReportView = z.infer<typeof BattleReportViewSchema>;

/** One structure of the caller's own, as the defence screen shows it. */
export const StructureDefenceSchema = z.object({
  buildingId: IdSchema,
  kind: z.string(),
  label: z.string(),
  level: z.number().int().positive(),
  damage: z.number().min(0).max(100),
  /** 0..1: how much of its job it is still doing. */
  effectiveness: z.number().min(0).max(1),
  garrisons: z.number().int().min(0),
});
export type StructureDefence = z.infer<typeof StructureDefenceSchema>;

/** A trap the caller could lay, and whether they can. */
export const TrapOptionSchema = z.object({
  trapId: z.string().min(1),
  name: z.string(),
  description: z.string(),
  available: z.boolean(),
  /** Why not, in the player's words. Empty when `available`. */
  blocker: z.string(),
});
export type TrapOption = z.infer<typeof TrapOptionSchema>;

/**
 * One district's front door, as the caller can see it.
 *
 * Sent for every district this crew can see into, because "may I attack a location here, or only the
 * gate" is a question the district screen has to answer *before* the player presses anything, and
 * deriving it on the client from who holds what would be a second copy of the rule.
 */
export const DistrictGateViewSchema = z.object({
  districtId: IdSchema,
  name: z.string(),
  /** One party holds every location in it, so the only legal call is on the way in. */
  shut: z.boolean(),
  /** When the current breach runs out, or null when the gate is standing. */
  brokenUntil: IsoDateTimeSchema.nullable(),
});
export type DistrictGateView = z.infer<typeof DistrictGateViewSchema>;

/**
 * One column on the road, as the Actions screen shows it (§A4).
 *
 * Named places rather than ids, because the screen is a list a player reads rather than a table it
 * joins: "The Rustyard to Datavault Sigma" is the sentence, and the client should not have to look
 * two districts up to write it.
 */
export const MovementViewSchema = z.object({
  id: IdSchema,
  battleId: IdSchema,
  /** What the fight is over, in the words the map uses. */
  targetName: z.string(),
  fromName: z.string(),
  toName: z.string(),
  side: BattleSideSchema,
  army: ArmySchema,
  perimeter: ArmySchema,
  /** Bodies, both halves counted. */
  size: z.number().int().nonnegative(),
  departedAt: IsoDateTimeSchema,
  arrivesAt: IsoDateTimeSchema,
  /** Whether the column can still be turned around. See `movementCancellable`. */
  recallable: z.boolean(),
});
export type MovementView = z.infer<typeof MovementViewSchema>;

export const ActionsResponseSchema = z.object({
  /** Everything this crew has walking, soonest to arrive first. */
  movements: z.array(MovementViewSchema),
  serverNow: IsoDateTimeSchema,
});
export type ActionsResponse = z.infer<typeof ActionsResponseSchema>;

export const RecallColumnRequestSchema = z.object({ movementId: IdSchema });
export type RecallColumnRequest = z.infer<typeof RecallColumnRequestSchema>;

export const BattlesResponseSchema = z.object({
  /** Fights still coming that the caller is in or can see, soonest first. */
  coming: z.array(BattleViewSchema),
  /** Fights that have happened, most recent first. */
  reports: z.array(BattleReportViewSchema),
  /** The half-hour marks a declaration could name right now. */
  slots: z.array(IsoDateTimeSchema),
  /** §D7: what the caller's name is worth. Boosts are priced per fight, on each `BattleView`. */
  infamy: z.number().int().nonnegative(),
  /** Every district this crew can see into, and whether its gate is armed or down. */
  gates: z.array(DistrictGateViewSchema),
  structures: z.array(StructureDefenceSchema),
  traps: z.array(TrapOptionSchema),
  serverNow: IsoDateTimeSchema,
});
export type BattlesResponse = z.infer<typeof BattlesResponseSchema>;

export const DeclareBattleRequestSchema = z.object({
  target: BattleTargetSchema,
  scheduledFor: IsoDateTimeSchema,
  /**
   * Tick to leave the survivors holding the ground they take (§A4).
   *
   * Optional, and false when it is not sent: an old client asking for a fight gets the fight it has
   * always got. See `ScheduledBattle.holdAfterCapture` for why it is asked at declaration.
   */
  holdAfterCapture: z.boolean().optional(),
});
export type DeclareBattleRequest = z.infer<typeof DeclareBattleRequestSchema>;

/**
 * Moving people to or from a coming fight.
 *
 * Deltas rather than an absolute force, the same shape the garrison call uses. Two crews' worth of
 * reasons: a client that sends absolutes overwrites whatever a second tab did, and a delta of `-3`
 * is the withdraw the board asked for without a second endpoint for it.
 */
export const DeployRequestSchema = z.object({
  battleId: IdSchema,
  /** Positive sends units to the ground; negative brings them home. */
  changes: z.record(z.string(), z.number().int()).default({}),
  /** The same, for the ring outside the fight. */
  perimeterChanges: z.record(z.string(), z.number().int()).default({}),
});
export type DeployRequest = z.infer<typeof DeployRequestSchema>;

export const LayTrapRequestSchema = z.object({
  locationId: z.string().min(1),
  trapId: z.string().min(1),
});
export type LayTrapRequest = z.infer<typeof LayTrapRequestSchema>;

export const GarrisonStructureRequestSchema = z.object({
  buildingId: IdSchema,
  /** Positive stations another watch in it; negative stands one down. */
  delta: z.number().int(),
});
export type GarrisonStructureRequest = z.infer<typeof GarrisonStructureRequestSchema>;

/**
 * Buying the one boost a fight is allowed (§D7).
 *
 * `boostId` is never null: there is no un-buying. A crew that has picked one has already spent the
 * name, and offering a refund would make the drop-down a browser rather than a decision.
 */
export const BuyBattleBoostRequestSchema = z.object({
  battleId: IdSchema,
  boostId: z.string().min(1),
});
export type BuyBattleBoostRequest = z.infer<typeof BuyBattleBoostRequestSchema>;

/** Every write on this feature answers with the whole screen plus the caller's own crew. */
export const BattleMutationResponseSchema = z.object({
  battles: BattlesResponseSchema,
  base: BaseSchema,
  levelUp: LevelUpSchema.optional(),
});
export type BattleMutationResponse = z.infer<typeof BattleMutationResponseSchema>;
