import { z } from 'zod';
import { BattleAnalysisSchema } from './battle/analysis.js';
import { BattlefieldSchema } from './battle/battlefield.js';
import {
  BattleSideSchema,
  BattleTargetSchema,
  ScheduledBattleSchema,
  type BattleTarget,
} from './battle/scheduled.js';
import { BaseSchema } from './base.js';
import { FleetSchema } from './building/vehicles.js';
import { LevelUpSchema, ScoutingRunViewSchema } from './api.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { OfficerRoleSchema } from './roles.js';
import { ArmySchema, UnitIdSchema, UnitStatsSchema } from './units/index.js';

/**
 * The REST contract for declared battles, deployments, reports and the infamy sinks.
 *
 * A separate module from `api.ts` on purpose: this is a whole feature's worth of DTOs and it has its
 * own reasons for being shaped the way it is, most of which are about **what a payload is allowed to
 * contain**. Everything here is written from one side's point of view, the caller's, because the
 * fog is enforced by not sending things rather than by flagging them, exactly as the city view does.
 */

/** One officer a crew could put at the front of this column (§D1). */
export const BattleLeaderSchema = z.object({
  officerId: IdSchema,
  name: z.string(),
  /** The chair they sit in, or null on the bench. Shown so the picker is not nineteen bare names. */
  role: OfficerRoleSchema.nullable(),
  /** What they would fight as, so the player can compare them to a unit before sending them. */
  stats: UnitStatsSchema,
  /**
   * §D1: whole minutes this one would take to reach the fight (maintainer request, 2026-09-15).
   *
   * A leader has to get there like everybody else, at their own `speed` and in whatever machine
   * this crew has committed to the fight, so the picker's choice is between a better sheet and a
   * shorter road rather than between two sheets. Per officer rather than one figure for the crew,
   * because the pace is the person: the Head of Finance and the Scout are not the same number.
   *
   * Defaulted so a payload written before the field existed still parses.
   */
  travelMinutes: z.number().int().nonnegative().default(0),
});
export type BattleLeader = z.infer<typeof BattleLeaderSchema>;

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
  /** Units, both forces counted. */
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
  /**
   * Contraband the crew already owns, rather than a name they can burn infamy on.
   *
   * The black market's crates used to sit in a bag on the market screen and apply themselves to
   * whatever fight happened next, on both sides, whether or not the player wanted them spent on
   * it. They are on this list now: bought days ago, held, and *applied at the moment a battle is
   * set up, by a player who has already read the intel on it*. `cost` is 0 for these, because it
   * was paid at the shelf; what a held boost costs is the crate.
   */
  held: z.boolean().default(false),
});
export type BattleBoostOption = z.infer<typeof BattleBoostOptionSchema>;

/**
 * A trap the caller could set under this fight, and whether they can (§I4).
 *
 * Every trap in the catalogue is on the list, including the ones the crew holds none of, for the
 * reason the boost list gives: a thing you never see is a thing you never build. `held` is the
 * count in the inventory and `available` is `held > 0`, because by the time a trap is an item the
 * document and the Lab rung have already been answered at the Scrapyard.
 */
export const TrapOptionSchema = z.object({
  trapId: z.string().min(1),
  name: z.string(),
  description: z.string(),
  /** How many of these the crew is carrying. */
  held: z.number().int().nonnegative(),
  available: z.boolean(),
  /** Why not, in the player's words. Empty when `available`. */
  blocker: z.string(),
});
export type TrapOption = z.infer<typeof TrapOptionSchema>;

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
  /**
   * The ground the fight will happen on, so the client can forecast it honestly.
   *
   * Without this the client could still run `battle/forecast.ts`, and it would run it on
   * `bareBattlefield()`: open ground, full frontage, no context bonuses, nothing dug in. That is
   * not a slightly worse estimate, it is a confident one about a different fight. Combat width
   * alone swings identical forces from a certain win to a certain loss (twenty Razors take the
   * Fence Camp every time and lose at the Long Ladle every time, against the same five defenders,
   * because one has a frontage of 21 and the other of 9), and a forecast that cannot see it is
   * exactly the lie `forecast.ts` was written to avoid.
   *
   * Sent for everybody, attacker and defender alike: the ground is not a secret. What the enemy
   * has on it is, and that is `enemySize` and `enemyIntel`.
   */
  battlefield: BattlefieldSchema,
  /** §D7: every boost this crew could put on this fight. Empty for a bystander. */
  boosts: z.array(BattleBoostOptionSchema),
  /**
   * The names already burned on this fight. Locked: nothing here can be given back.
   *
   * A list since the maintainer's 2026-09-12 call. `boostSlots` is how many this crew may burn at all,
   * which is one plus whatever the Field Commander's track has bought.
   */
  boostIds: z.array(z.string()).default([]),
  boostSlots: z.number().int().positive().default(1),
  /**
   * §D1: the officer this crew is sending to lead, or null for a fight nobody leads.
   *
   * Free to change right up to the mark, unlike the boost: nothing is spent by naming somebody, and
   * what it costs is the risk that they come home hurt (§D4).
   */
  officerId: IdSchema.nullable().default(null),
  /** §C3: the machines this crew has committed to this fight. */
  vehicles: FleetSchema.default({}),
  /** ...and what is still parked in the yard, so the picker can offer it. */
  yard: FleetSchema.default({}),
  /**
   * Who this crew could send: everybody on the books who is fit to go.
   *
   * An injured officer is simply absent from the list rather than present and greyed, because
   * "unavailable until 14:20 tomorrow" is a fact about a person the crew screen already shows and
   * a second copy of it here is a second place for it to be wrong. Empty for a bystander.
   */
  leaders: z.array(BattleLeaderSchema).default([]),
  /**
   * §I4: the traps this crew could set under this fight. **Empty unless the caller is defending.**
   *
   * A trap is laid on ground you are holding, so an attacker has nothing to set and a bystander is
   * not in the fight at all. Empty rather than absent for the same reason the boost list is: a
   * field that only existed for one side would leak which side the reader is on by its own shape,
   * and this payload already says that outright in `side`.
   */
  traps: z.array(TrapOptionSchema).default([]),
  /** The one already set for this fight, or null. Free to change up to the mark. */
  trapId: z.string().nullable().default(null),
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
  /**
   * What it is worth to a defence right now, for the one structure that is bought *for* that.
   *
   * Only the Gate carries these (maintainer request, 2026-09-12: the section says what the gate
   * provides rather than only what level it is). Null on everything else, which defends a
   * district by standing in it rather than by a percentage of its own.
   */
  defensePercent: z.number().nullable().default(null),
  intelResistancePercent: z.number().nullable().default(null),
});
export type StructureDefence = z.infer<typeof StructureDefenceSchema>;

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
 * joins: "Steelbelt to The Annexes" is the sentence, and the client should not have to look
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
  /** Units, both halves counted. */
  size: z.number().int().nonnegative(),
  departedAt: IsoDateTimeSchema,
  arrivesAt: IsoDateTimeSchema,
  /** Whether the column can still be turned around. See `movementCancellable`. */
  recallable: z.boolean(),
  /**
   * §C3: the machines under this column, read off the crew's deployment for the fight.
   *
   * The road screen listed every unit walking and nothing it was riding in, so a crew that had
   * committed the yard to a fight could not see the machines anywhere between the picker and the
   * settle. Defaulted, so a payload from before the field parses as a column that walks.
   */
  vehicles: FleetSchema.default({}),
});
export type MovementView = z.infer<typeof MovementViewSchema>;

export const ActionsResponseSchema = z.object({
  /** Everything this crew has walking, soonest to arrive first. */
  movements: z.array(MovementViewSchema),
  /**
   * The scout this crew has out, or null. The road page is "where is everybody right now", and a
   * scout on their way to a dark district is somebody. Defaulted so a fixture written before it
   * still parses.
   */
  scoutingRun: ScoutingRunViewSchema.nullable().default(null),
  serverNow: IsoDateTimeSchema,
});
export type ActionsResponse = z.infer<typeof ActionsResponseSchema>;

export const RecallColumnRequestSchema = z.object({ movementId: IdSchema });
export type RecallColumnRequest = z.infer<typeof RecallColumnRequestSchema>;

/**
 * §D7: what calling a fight costs, on every piece of ground this crew can see.
 *
 * Only charged ground is listed, and a target that is not here is free to call. Keyed by location
 * id for a location, and by district id for a gate or a raid, both of which are a call on the
 * same party (whoever lives there, or failing that whoever holds the whole of it). The server
 * prices each entry through `declareInfamyCost`, so the dialog quotes a number it was handed
 * rather than one it worked out from a holder plate.
 */
export const CallPricesSchema = z.object({
  locations: z.record(z.string(), z.number().int().nonnegative()),
  districts: z.record(z.string(), z.number().int().nonnegative()),
});
export type CallPrices = z.infer<typeof CallPricesSchema>;

/** The price the board quotes for one target. Absent is free. */
export function callPriceOf(target: BattleTarget, prices: CallPrices): number {
  return target.kind === 'location'
    ? (prices.locations[target.locationId] ?? 0)
    : (prices.districts[target.districtId] ?? 0);
}

export const BattlesResponseSchema = z.object({
  /** Fights still coming that the caller is in or can see, soonest first. */
  coming: z.array(BattleViewSchema),
  /** Fights that have happened, most recent first. */
  reports: z.array(BattleReportViewSchema),
  /** The half-hour marks a declaration could name right now. */
  slots: z.array(IsoDateTimeSchema),
  /** §D7: what the caller's name is worth. Boosts are priced per fight, on each `BattleView`. */
  infamy: z.number().int().nonnegative(),
  callPrices: CallPricesSchema,
  /** Every district this crew can see into, and whether its gate is armed or down. */
  gates: z.array(DistrictGateViewSchema),
  structures: z.array(StructureDefenceSchema),
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
 * is the withdraw the maintainer asked for without a second endpoint for it.
 */
/**
 * §D1: put one officer at the front of this column, or take them back off it.
 *
 * `officerId: null` is the un-send, and it is free. Naming somebody costs nothing either: what a
 * player is committing to is the risk in §D4, not a price.
 */
export const LeadBattleRequestSchema = z.object({
  battleId: IdSchema,
  officerId: IdSchema.nullable(),
});
export type LeadBattleRequest = z.infer<typeof LeadBattleRequestSchema>;

export const DeployRequestSchema = z.object({
  battleId: IdSchema,
  /**
   * Positive sends units to the ground; negative brings them home.
   *
   * Keyed by {@link UnitIdSchema} rather than by `z.string()`, the same way {@link ArmySchema} is.
   * With a plain string key, `constructor` and `toString` arrive as ordinary own properties (Zod
   * drops `__proto__`, but not those), and the withdrawal path read `force[key]` before checking
   * that the key named a unit: on a plain object that is a *function*, `Math.min(-delta, fn)` is
   * `NaN`, and a `NaN` count went into the roster, where it serialises to `null` and poisons every
   * `forceSize` that touches it. A deployment names units, so the schema says so.
   */
  changes: z.record(UnitIdSchema, z.number().int()).default({}),
  /** The same, for the ring outside the fight. */
  perimeterChanges: z.record(UnitIdSchema, z.number().int()).default({}),
});
export type DeployRequest = z.infer<typeof DeployRequestSchema>;

/**
 * §I4: set the one trap this side is allowed under a fight, or take it back up.
 *
 * `trapId: null` is the un-set, and it is free, exactly as {@link LeadBattleRequestSchema}'s is.
 * Nothing leaves the inventory until the fight resolves, so there is nothing to refund and nothing
 * to punish: a player who changes their mind about which of two fights gets the shell has to be
 * able to say so.
 *
 * A trap used to be armed on a *location* and to sit there waiting for whoever came. It is on the
 * fight now, which is why this names a battle: the decision belongs beside the boost and the
 * officer, made against intel the defender has already read.
 */
export const LayTrapRequestSchema = z.object({
  battleId: IdSchema,
  trapId: z.string().min(1).nullable(),
});
export type LayTrapRequest = z.infer<typeof LayTrapRequestSchema>;

/**
 * Burning a name on a fight (§D7).
 *
 * There is no un-buying: a crew that has taken one has already spent the name, and a boost cannot
 * be swapped, cleared or refunded. That is what makes the drop-down a decision rather than a
 * browser, and it is why the screen asks before it sends. How many a crew may burn on one fight is
 * `BattleView.boostSlots`: one, plus whatever the Field Commander's track has bought.
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
  /**
   * §A4: who the other side's ring took off a withdrawal, on the request that pulled them out.
   *
   * The toll has always been charged and never reported: the units came off the roster and the
   * screen said nothing, so a crew that pulled forty people back out of a fight and got thirty
   * four home had no way to know the other six had not simply been miscounted. Only ever on the
   * response to the pull-out itself, because that is the one moment it is news.
   */
  caughtLeaving: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type BattleMutationResponse = z.infer<typeof BattleMutationResponseSchema>;
