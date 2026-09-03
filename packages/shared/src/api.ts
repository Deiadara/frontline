import { z } from 'zod';
import { FleetSchema } from './building/vehicles.js';
import { CapturedGateViewSchema } from './api.district.js';
import { MissionDifficultySchema } from './delegation/index.js';
import { MissionStanceSchema } from './allegiance.js';
import { UnreadCountsSchema } from './api.social.js';
import { AttributeNameSchema, AttributesSchema } from './attributes.js';
import {
  JOIN_BLOCKERS,
  JoinRequirementSchema,
  NegotiationSchema,
  StandoffSchema,
} from './bar/index.js';
import { BaseSchema, BaseSummarySchema, DistrictNameSchema } from './base.js';
import { PayrollLedgerSchema } from './economy/payroll.js';
import { BattleResultSchema } from './battle/types.js';
import {
  UnitIdSchema,
  ArmySchema,
  TrainingQueueSchema,
  UnitStatsSchema,
  UnitTierSchema,
  UNIT_UPGRADE_SLOTS,
} from './units/index.js';
import {
  BuildingKindSchema,
  BuildingSchema,
  ModificationBlockerSchema,
  ModificationEffectSchema,
} from './building/index.js';
import {
  DistrictSchema,
  EnvLabelIdSchema,
  EnvLabelSchema,
  LocationHolderSchema,
  LocationSchema,
} from './city/index.js';
import { BlueprintCategorySchema } from './blueprints/catalog.js';
import { CommanderSchema } from './commander.js';
import { OfficerMarkSchema } from './crew/marks.js';
import { MissionAreaIdSchema, MissionKindSchema, MissionSchema } from './missions.js';
import { OverseerSchema } from './overseer.js';
import { TrainingSessionSchema } from './crew/training.js';
import { InventorySchema } from './items/inventory.js';
import { ResourceKeySchema } from './resources.js';
import { MarketOfferSchema, TradeBundleSchema } from './market/offers.js';
import { SupplyBoardSchema, SupplyResourceSchema } from './market/supply.js';
import { VendorLineSchema, VendorSessionSchema } from './market/vendor.js';
import { UpgradeLineSchema } from './units/upgrades.js';
import { IdSchema, IsoDateTimeSchema, UsernameSchema } from './primitives.js';
import { PlayerLevelGrantsSchema, PlayerLevelUnlockSchema } from './progression/index.js';
import {
  ActiveResearchSchema,
  DiscoveredFactSchema,
  ResearchProjectSchema,
} from './research/index.js';
import { PartialResourcesSchema, ResourcesSchema } from './resources.js';
import { OfficerRoleSchema } from './roles.js';
import { PerksSchema } from './crew/perks.js';
import { UserSchema } from './user.js';

/**
 * API DTOs: the single source of truth for the REST contract in docs/SPEC-server.md.
 * The server validates request bodies with these schemas; the client parses responses with them.
 */

// --- player levelling (GDD §I) ---

/**
 * A level-up the *caller's own request* just paid for, so the path that caused it can announce it.
 *
 * Carried on every response whose call can award XP, and **present only when a level was actually
 * crossed**: presence is the whole signal, so no client compares two numbers to work out whether
 * something happened. `levelsGained > 1` when one settlement crossed several levels.
 *
 * §I3 unlocks ride along now that the board has filed the catalogue. Usually empty: most levels
 * open nothing, and that is the point: the levels that *do* open something are the ones a player
 * should be able to feel arriving, so the announcement names them rather than leaving a player to
 * notice that a door has stopped being locked.
 */
export const LevelUpSchema = z.object({
  /** `Base.level` after the award. */
  level: z.number().int().positive(),
  levelsGained: z.number().int().positive(),
  /** §I2 grants at the new level: what the level is actually worth. */
  grants: PlayerLevelGrantsSchema,
  /** §I3: every unlock this award crossed, oldest level first. Empty on most level-ups. */
  unlocks: z.array(PlayerLevelUnlockSchema).default([]),
});
export type LevelUp = z.infer<typeof LevelUpSchema>;

/** Every non-2xx response uses this envelope. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
  /**
   * MOU-280: a refusal can still have banked a level-up on its way to refusing.
   *
   * The write routes settle lazily (`resolveDueMissions`, `economy/settle.ts`), so a request that
   * is about to be rejected may already have brought a crew home and crossed a threshold. That
   * write is not rolled back, and no later read re-resolves it, so the *refusal* is the only place
   * it can ever be announced. A sibling of `error` rather than a field inside it, because it is not
   * part of why the call failed.
   *
   * `.catch` for that same reason: this is an extra riding along, so a malformed one must not fail
   * the whole envelope and cost the player the refusal *message*: the client falls back to
   * `UNKNOWN`/`statusText` when this schema does not parse. The success responses keep a plain
   * `.optional()`: there the body is the contract and a bad one should be rejected loudly.
   */
  levelUp: LevelUpSchema.optional().catch(undefined),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PasswordSchema = z.string().min(8).max(128);

// --- auth ---
export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthResponseSchema = z.object({
  token: z.string().min(1),
  user: UserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// --- session ---
/**
 * What the next level of each structure will actually cost this crew.
 *
 * On the wire because the client cannot work it out. The build dialog quoted
 * `buildingCost(kind, level, buildings)` off the catalogue, while the server charges that price
 * with two discounts taken off it: `buildCostPercent` (everything) and `buildingCostPercent[kind]`
 * (the §B7 perks that name a single structure). The second is a per-structure record and the
 * effects on the wire are flat numbers, so no client-side fix existed. Same shape as the Downtown
 * Market bug, where the shelf quoted the catalogue price and the till charged the discounted one,
 * and fixed the same way: the server does the arithmetic once and the screen reads the answer.
 *
 * A structure with nothing left to queue is absent rather than present and empty.
 */
export const BuildQuotesSchema = z.partialRecord(BuildingKindSchema, PartialResourcesSchema);
export type BuildQuotes = z.infer<typeof BuildQuotesSchema>;

export const MeResponseSchema = z.object({
  user: UserSchema,
  overseer: OverseerSchema.nullable(),
  base: BaseSchema.nullable(),
  /**
   * Set when *this read's* settlement crossed a level (§I1).
   *
   * `/me` is the call the game shell polls, so it is where a build that finished while the player
   * was looking at another page gets announced. Without it the XP is banked and the level-up is
   * silently lost: MOU-227's rule is that presence is the whole signal, and a settle nobody
   * announces has no second chance to.
   */
  levelUp: LevelUpSchema.optional(),
  /**
   * The discounted price of each structure's next level. See {@link BuildQuotesSchema}.
   *
   * Optional so a response written before this existed still parses; a client with no quote falls
   * back to the catalogue price, which is what it drew before.
   */
  buildQuotes: BuildQuotesSchema.optional(),
  /**
   * The two badges the HUD draws, on every screen.
   *
   * Folded into `/me` rather than polled separately, because the HUD is on every page and two more
   * intervals against two more endpoints to draw two numbers is three requests where one will do.
   * Optional so a response written before the mailbox existed still parses as "nothing waiting".
   */
  unread: UnreadCountsSchema.optional(),
  /**
   * Whether this build has an admin bench.
   *
   * On `/me` rather than discovered by calling the bench and catching a 404. The nav has to decide
   * whether to draw the door on every screen, so a 404-as-answer meant every production session
   * logged a failed request on every page, which is both noise in a console the board reads and
   * the kind of thing a monitor eventually pages somebody about. `/me` is already the call the
   * shell polls, so this costs nothing and is never wrong.
   */
  admin: z.boolean().default(false),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// --- overseer creation ---
export const CreateOverseerRequestSchema = z.object({
  presetId: IdSchema,
});
export type CreateOverseerRequest = z.infer<typeof CreateOverseerRequestSchema>;

export const CreateOverseerResponseSchema = z.object({
  user: UserSchema,
  overseer: OverseerSchema,
  base: BaseSchema,
});
export type CreateOverseerResponse = z.infer<typeof CreateOverseerResponseSchema>;

// --- the city (GDD §A4) ---

/**
 * One district as the map shows it *to this crew*.
 *
 * The fog is the interesting field. `scouted` is false until the crew has been there, and while it
 * is false every count below is null, not zero. Zero is a fact about the world; null is a fact
 * about what you know, and a map that reported "0 / 4 held" for ground nobody has walked into
 * would be telling the player something it has no business knowing.
 */
export const DistrictSummarySchema = z.object({
  district: DistrictSchema,
  scouted: z.boolean(),
  /** Minutes from this crew's home district, with their travel bonuses already applied. */
  travelMinutes: z.number().int().nonnegative(),
  /** Who holds the whole district, if anyone does. Null when it is split, or unscouted. */
  holder: LocationHolderSchema.nullable(),
  /** How many places here this crew holds, of how many there are. Null until scouted. */
  held: z
    .object({ mine: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
    .nullable(),
  /** The crew living here, for residential ground. Null for contested ground. */
  base: BaseSummarySchema.nullable(),
  /** This crew's own home. Exactly one district on the map has this set. */
  isHome: z.boolean(),
});
export type DistrictSummary = z.infer<typeof DistrictSummarySchema>;

export const CityResponseSchema = z.object({
  districts: z.array(DistrictSummarySchema),
  homeDistrictId: IdSchema,
  /**
   * §B7: the gates on districts this crew holds outright, one per district and none otherwise.
   *
   * Defaulted so a response written before captured gates existed still parses as a crew that
   * holds nothing whole, which is what those saves meant.
   */
  capturedGates: z.array(CapturedGateViewSchema).default([]),
  serverNow: IsoDateTimeSchema,
});
export type CityResponse = z.infer<typeof CityResponseSchema>;

/** One place inside a district, as the district view shows it. */
export const LocationViewSchema = z.object({
  location: LocationSchema,
  holder: LocationHolderSchema,
  /** Who that is in words: a crew's name, or "The Combine". */
  holderName: z.string().min(1),
  /** 1..`MAX_LOCATION_LEVEL`: how far the current holder has worked it up (§A4). */
  level: z.number().int().min(1),
  /** Set while a level is being worked on; null when nothing is under way. */
  upgradingUntil: IsoDateTimeSchema.nullable(),
  /** What the next level costs and what it actually *is*. Null at the ceiling. */
  upgrade: z
    .object({
      toLevel: z.number().int().min(2),
      cost: PartialResourcesSchema,
      note: z.string().min(1),
      seconds: z.number().int().positive(),
    })
    .nullable(),
  fortification: z.number().int().min(0),
  fortifyingUntil: IsoDateTimeSchema.nullable(),
  /** What an attacker has to beat: the ground, the digging and whoever is standing on it. */
  defense: z.number().nonnegative(),
  garrisonSize: z.number().int().nonnegative(),
  /**
   * Exactly who is standing here: **only** for locations this crew holds. Null otherwise, because
   * the composition of somebody else's garrison is the thing scouting would be for.
   */
  garrison: ArmySchema.nullable(),
  /** Each hold bonus in one line, at this location's current level. */
  bonuses: z.array(z.string().min(1)),
  reward: z.string().min(1),
  /**
   * What the ground is like right now (§A4): the location's own labels folded with the day's
   * weather and the hour. This is what the player reads to decide what to bring.
   */
  labels: z.array(EnvLabelSchema),
  /** Names of units holding this kind of location would unlock. Usually empty. */
  unlocks: z.array(z.string()),
});
export type LocationView = z.infer<typeof LocationViewSchema>;

/**
 * A scouting run in flight, as the city screen reads it.
 *
 * The whole run is one mark: `returnsAt` is when they are home *and* when the ground opens, because
 * a scout who has arrived but not reported has told you nothing. Two marks would be two countdowns
 * on one card for no decision the player can make in between.
 */
export const ScoutingRunViewSchema = z.object({
  districtId: IdSchema,
  districtName: z.string(),
  officerId: IdSchema,
  officerName: z.string(),
  departedAt: IsoDateTimeSchema,
  returnsAt: IsoDateTimeSchema,
});
export type ScoutingRunView = z.infer<typeof ScoutingRunViewSchema>;

export const DistrictDetailResponseSchema = z.object({
  district: DistrictSchema,
  scouted: z.boolean(),
  travelMinutes: z.number().int().nonnegative(),
  /** Empty when the district has not been scouted: the fog is enforced server-side. */
  locations: z.array(LocationViewSchema),
  holder: LocationHolderSchema.nullable(),
  /** The §A4 unified bonus for taking every location here, named and described. */
  unified: z.object({ title: z.string(), effect: z.string() }).nullable(),
  /** Set on residential ground: the crew that lives here, and whether they can be raided. */
  base: BaseSummarySchema.nullable(),
  /**
   * What is standing on their ground, for the district view to draw.
   *
   * Public by nature: a structure is a building on a street, and anyone who walks past can see how
   * far it has been built up. What stays hidden is everything a crew *knows*: the roles they have
   * worked out, the facts they have discovered, what is in their stockpile: none of which is here.
   *
   * Empty on ground nobody lives on, and on unscouted ground: you cannot describe a place you have
   * not been to.
   */
  residentBuildings: z.array(BuildingSchema),
  raidable: z.boolean(),
  /**
   * The scouting run this crew has out, wherever it is going, or `null`.
   *
   * Not scoped to *this* district on purpose. Only one run is allowed at a time, so a player
   * looking at a second dark district needs to know somebody is already out and where, or the
   * refusal when they press the button is the first they hear of it.
   */
  scoutingRun: ScoutingRunViewSchema.nullable(),
  /**
   * What sending somebody here would cost, or `null` when there is nobody to send.
   *
   * Quoted before it is committed to, like every other price in the game. A four-hour run is a
   * decision about the evening, and finding out how long it was after pressing the button is not
   * a decision.
   */
  scoutPlan: z
    .object({
      officerId: IdSchema,
      officerName: z.string(),
      /** There, on the ground, and back. */
      minutes: z.number().int().nonnegative(),
    })
    .nullable(),
  serverNow: IsoDateTimeSchema,
});
export type DistrictDetailResponse = z.infer<typeof DistrictDetailResponseSchema>;

/*
 * `AttackPlaceRequest`, `AttackPlaceResponse`, `RaidDistrictRequest` and `RaidDistrictResponse`
 * were here, and they are gone with the routes that carried them (board, battle rework).
 *
 * They described a fight resolved the instant a button was pressed. §A4 now says a fight is
 * declared in advance on a mark both sides can read, which is `api.battle.ts`: declare, deploy,
 * and a settler that runs when the mark passes. An instant path beside it would have been the only
 * path anybody used.
 */

/** Leave units on a place you hold, or take them home again. */
export const GarrisonRequestSchema = z.object({
  locationId: z.string().min(1),
  /**
   * Positive leaves units there; negative brings them back.
   *
   * Keyed by {@link UnitIdSchema}, the same way {@link ArmySchema} and the deployment request are.
   * With a plain string key, `constructor` and `toString` arrive as ordinary own properties (Zod
   * drops `__proto__`, but not those), and the withdrawal branch in `city/actions.ts` read
   * `garrison[key]` before checking that the key named a unit: on a plain object that is a
   * *function*, `Math.min(-delta, fn)` is `NaN`, and a `NaN` count went into both the roster and
   * the garrison column.
   *
   * This is the twin of the same bug in `DeployRequestSchema`. That one was found and fixed first;
   * this door was missed, which is the usual way a two-site fix leaves one site broken.
   */
  changes: z.record(UnitIdSchema, z.number().int()),
});
export type GarrisonRequest = z.infer<typeof GarrisonRequestSchema>;

export const FortifyRequestSchema = z.object({
  locationId: z.string().min(1),
});
export type FortifyRequest = z.infer<typeof FortifyRequestSchema>;

/** §A4: work a location you hold up one level. */
export const UpgradeLocationRequestSchema = z.object({
  locationId: z.string().min(1),
});
export type UpgradeLocationRequest = z.infer<typeof UpgradeLocationRequestSchema>;

export const ScoutRequestSchema = z.object({
  districtId: IdSchema,
  /**
   * Who goes. Omitted, the crew sends its Scout, or its best sheet if the chair is empty.
   *
   * Optional rather than required because the default is nearly always the right answer and a
   * required field would make the common case a two-step decision. See `defaultScout`.
   */
  officerId: IdSchema.optional(),
});
export type ScoutRequest = z.infer<typeof ScoutRequestSchema>;

/** Every city write answers with the district it touched, so the client never re-derives state. */
export const CityMutationResponseSchema = z.object({
  district: DistrictDetailResponseSchema,
  base: BaseSchema,
});
export type CityMutationResponse = z.infer<typeof CityMutationResponseSchema>;

// --- units (GDD §A5) ---

/** One unit as the roster shows it: the sheet, and whether this crew can field it. */
/** What is in one bracket: an upgrade the crew has built, or room for one. */
export const FittedSlotSchema = z.object({
  upgradeId: z.string().nullable(),
  name: z.string(),
  line: UpgradeLineSchema.nullable(),
  tier: z.number().int().nonnegative(),
  /** Already folded into `stats`; here so the bracket can say what it is paying for. */
  effect: z.record(z.string(), z.number()),
});
export type FittedSlot = z.infer<typeof FittedSlotSchema>;

export const UnitOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: UnitTierSchema,
  blurb: z.string().min(1),
  trainedAt: BuildingKindSchema,
  unique: z.boolean(),
  stats: UnitStatsSchema,
  modifiers: z.array(z.object({ label: z.string(), description: z.string(), when: z.string() })),
  /**
   * The flags that are rules rather than percentages (`units/catalog.ts` `UNIT_RULES`).
   *
   * Separate from `modifiers` because they are a different kind of thing and the roster draws them
   * differently: a modifier is "+25% somewhere", a rule is "the enemy has to shoot this first".
   * They were on the unit sheet and on no screen at all, so a player could field an Ironside
   * without ever learning that it is a shield line.
   */
  rules: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
  /**
   * §A4: the ground this unit is unusually good or bad in.
   *
   * Only the labels where it differs from what its own sheet would predict: the Juggernaut's
   * misery in the heat is already legible from ninety-five points of armour, and listing it here
   * as well would bury the one line that is genuinely a surprise. What survives is the handful of
   * cases the sheet cannot say: Anodics fighting *better* in a room full of noise, the
   * Abomination not caring about chlorine.
   */
  affinities: z.array(
    z.object({
      id: EnvLabelIdSchema,
      label: z.string().min(1),
      /** `+11` / `−8` per tier, or `Immune`. */
      note: z.string().min(1),
      good: z.boolean(),
    }),
  ),
  cost: PartialResourcesSchema,
  trainSeconds: z.number().int().positive(),
  supply: z.number().int().positive(),
  /**
   * §A4: percentage points this unit's *own* ground takes off, on top of `trainingCostReduction`.
   *
   * Per unit rather than on the response, because that is what the rule is: working the Doghouse
   * up makes Cyberhounds cheaper and quicker and does nothing at all for a Razor. The crew-wide
   * figures stay where they are; these two are added to them for this row and no other.
   *
   * Optional out of the parser like `trainingSuppliesReduction`: the server always sends them, and
   * requiring them would mean writing two zeroes into every roster fixture in the tree. Read as
   * `?? 0`.
   */
  homeCostReduction: z.number().optional(),
  homeSpeedBonus: z.number().optional(),
  unlocked: z.boolean(),
  /** The clauses this crew has not met, in the player's words. Empty when unlocked. */
  missing: z.array(z.string()),
  /** How many are at home. Garrisoned units are counted separately. */
  owned: z.number().int().nonnegative(),
  /**
   * The three brackets on this unit, in slot order (`units/loadout.ts`).
   *
   * Always three, empty ones included, because the empty bracket is the thing the screen is for:
   * a unit with nothing in it should read as "there is room here" rather than as an absence.
   */
  slots: z.array(FittedSlotSchema).length(UNIT_UPGRADE_SLOTS),
});
export type UnitOption = z.infer<typeof UnitOptionSchema>;

/** One line of the crew's stock, as the bracket picker needs it. */
export const BuiltUpgradeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  line: UpgradeLineSchema,
  tier: z.number().int().positive(),
  description: z.string().min(1),
  effect: z.record(z.string(), z.number()),
  /**
   * §D5c: the unit this one is bolted to, or null while it is still on the shelf.
   *
   * On the payload rather than derived on the client, because "is it fitted" is a fact about the
   * whole roster and the units page only ever holds one unit's brackets at a time. Without it the
   * picker could tell a player an upgrade was free when it was already on the Breakers, and the
   * server would refuse the press.
   *
   * Defaulted so a response written before the one-of-each rule still parses.
   */
  fittedTo: z.string().nullable().default(null),
  /** Its name, for the line the picker prints. Empty while it is on the shelf. */
  fittedToName: z.string().default(''),
});
export type BuiltUpgrade = z.infer<typeof BuiltUpgradeSchema>;

export const UnitsResponseSchema = z.object({
  serverNow: IsoDateTimeSchema,
  units: z.array(UnitOptionSchema),
  army: ArmySchema,
  /** Units standing on captured places, summed across the city. */
  garrisoned: ArmySchema,
  /**
   * Units committed to a fight: a muster on the ground, or a column still walking to one.
   *
   * Sent for the same reason `garrisoned` is. Both are away and both are counted in `supplyUsed`
   * (§A1: they are still people this crew feeds), so a roster that showed neither would report a
   * population the player could not account for from anything on the screen.
   */
  abroad: ArmySchema,
  supplyUsed: z.number().int().nonnegative(),
  supplyCap: z.number().int().nonnegative(),
  queue: TrainingQueueSchema,
  resources: ResourcesSchema,
  /** Everything territory is doing to training right now, so the page can explain a price. */
  trainingCostReduction: z.number(),
  trainingSpeedBonus: z.number(),
  /**
   * §B5: the Greenhouse's cut, which lands on the **supplies** line and on no other.
   *
   * A second field rather than a bigger `trainingCostReduction`, for the same reason
   * `trainingCost` takes it as a second argument: folding the two together would quote a Razor's
   * scrap as cheaper than the route charges for it.
   *
   * Optional on the way *out* of the parser, like `Base.addons`: the server always sends it, and
   * making it required would mean writing a zero into every roster fixture in the tree to say what
   * "absent" already says. Read it as `?? 0`.
   */
  trainingSuppliesReduction: z.number().optional(),
  /**
   * Everything the workshop has built, whether or not it is in a bracket somewhere.
   *
   * The stock, in other words. Sent with the roster rather than fetched from `/workshop` when a
   * bracket is opened, because the one question the picker has to answer is "what can I put in
   * here", and a screen that has to go and ask cannot answer it while the menu is opening.
   */
  built: z.array(BuiltUpgradeSchema),
});
export type UnitsResponse = z.infer<typeof UnitsResponseSchema>;

/** Put something in a bracket, or empty it (`upgradeId: null`). */
export const FitSlotRequestSchema = z.object({
  unitId: z.string().min(1),
  slot: z
    .number()
    .int()
    .min(0)
    .max(UNIT_UPGRADE_SLOTS - 1),
  /**
   * §D5c: not nullable any more.
   *
   * `null` used to empty a bracket and hand the modification back, which made fitting free and
   * reversible. The only way one comes off now is `POST /units/burn`, which destroys it.
   */
  upgradeId: z.string().min(1),
});
export type FitSlotRequest = z.infer<typeof FitSlotRequestSchema>;

/** §D5c: burn a fitted modification off the roster. It is destroyed, not returned. */
export const BurnUpgradeRequestSchema = z.object({ upgradeId: z.string().min(1) });
export type BurnUpgradeRequest = z.infer<typeof BurnUpgradeRequestSchema>;

export const TrainUnitsRequestSchema = z.object({
  unitId: z.string().min(1),
  count: z.number().int().positive().max(50),
});
export type TrainUnitsRequest = z.infer<typeof TrainUnitsRequestSchema>;

/** §A5: which batch on the bench to call off. See `trainingCancellable` for when it is allowed. */
export const CancelTrainingRequestSchema = z.object({ orderId: IdSchema });
export type CancelTrainingRequest = z.infer<typeof CancelTrainingRequestSchema>;

export const TrainUnitsResponseSchema = z.object({
  base: BaseSchema,
  queue: TrainingQueueSchema,
});
export type TrainUnitsResponse = z.infer<typeof TrainUnitsResponseSchema>;

// --- base detail ---
export const BaseDetailResponseSchema = z.object({
  base: BaseSchema,
});
export type BaseDetailResponse = z.infer<typeof BaseDetailResponseSchema>;

// --- the district (GDD §A1, §D3) ---

/**
 * Put one structure's next level into the build queue: construction when the plot is empty, an
 * upgrade when it is not. One request for both, because the district has one action per plot: the
 * order is placed, the materials come out immediately (§D3, oil among them on every structure) and
 * the level lands when the clock runs out.
 *
 * The structure is named by `kind` rather than by id since a district holds at most one of each,
 * and an id the client had to look up first would only be a second way to say the same thing. Note
 * there is no level on the request either: what a repeat order produces is the queue's business
 * (`nextQueuedLevel`), and letting the client name a level would be letting it name the wrong one.
 */
export const BuildStructureRequestSchema = z.object({
  kind: BuildingKindSchema,
});
export type BuildStructureRequest = z.infer<typeof BuildStructureRequestSchema>;

export const BuildStructureResponseSchema = z.object({
  /** The whole base after the order: the queue, the stockpile and anything that just landed. */
  base: BaseSchema,
  /** §I1 pays for building things: set when a *completed* build's XP crossed a level. */
  levelUp: LevelUpSchema.optional(),
});
export type BuildStructureResponse = z.infer<typeof BuildStructureResponseSchema>;

/**
 * Name the allegiance (§A1).
 *
 * The name is the crew's, not the district's, and it is the one thing about a player every other
 * player sees. Trimmed and length-bounded by `DistrictNameSchema` rather than by the input control,
 * so a name that came from anywhere other than the form is held to the same rule.
 */
export const RenameDistrictRequestSchema = z.object({
  name: DistrictNameSchema,
});
export type RenameDistrictRequest = z.infer<typeof RenameDistrictRequestSchema>;

export const RenameDistrictResponseSchema = z.object({
  base: BaseSchema,
});
export type RenameDistrictResponse = z.infer<typeof RenameDistrictResponseSchema>;

// --- battle ---
// `BattleRequestSchema` used to live here: one field, `targetDistrictId`, and no reader on either
// side. A fight is declared through `DeclareBattleRequestSchema` in `api.battle.ts`, which takes a
// `BattleTarget` and can name a location rather than a whole district. Removed rather than left as
// a second, wrong way to ask for the same thing.
export const BattleResponseSchema = z.object({
  result: BattleResultSchema,
  /** Attacker base resources AFTER rewards were applied. */
  resources: ResourcesSchema,
  /** §I1 pays for the raid: set when this raid's XP crossed a level. */
  levelUp: LevelUpSchema.optional(),
});
export type BattleResponse = z.infer<typeof BattleResponseSchema>;

// --- missions (GDD §E) ---

/**
 * The mission board plus everything in flight. One call backs both §E3 (the timers page) and
 * §E4 (the pre-commit screen), because the two are the same screen with different selections.
 *
 * `serverNow` is what makes the timers honest: the client renders every countdown against the
 * server's clock offset rather than its own, so a machine with a skewed or nudged clock shows
 * the same remaining time as everyone else, and still cannot make a mission land early.
 */
/**
 * One job on offer, priced and timed for the area it is offered in (§E4).
 *
 * Everything a card needs and nothing a player could not be told: the odds are deliberately
 * absent, as they always have been, and `missions.test.ts` asserts the board ships no
 * `successChance` at all.
 */
export const MissionOfferSchema = z.object({
  templateId: IdSchema,
  name: z.string().min(1),
  brief: z.string().min(1),
  kind: MissionKindSchema,
  difficulty: MissionDifficultySchema,
  stance: MissionStanceSchema,
  /** §E6/§E8, broken out the way the card shows it. */
  travelMinutes: z.number().int().nonnegative(),
  durationMinutes: z.number().int().positive(),
  totalMinutes: z.number().int().positive(),
  /** What it pays on a clean run, with the area's and the crew's own premium already on it. */
  rewards: PartialResourcesSchema,
  /** Loot slots that payout takes up, so a player can size the crew before they send it. */
  payoutSlots: z.number().int().nonnegative(),
  /** §I1: allegiance XP a clean run pays. On the card, because it is half of what a job is worth. */
  xp: z.number().int().positive(),
  /** And what a run that came home empty still pays: `FAILED_MISSION_XP_SHARE` of it. */
  failedXp: z.number().int().nonnegative(),
  /**
   * §F1b: a blueprint page on the table, as a **category and nothing more**.
   *
   * Null on most offers. When it is set the card may say "a Unit Blueprint's Page" and may not say
   * which one: which page it turns out to be is not decided until the crew is home (§F1c), so a
   * player sizing a run knows there is something worth having on it and cannot shop for a specific
   * document.
   */
  pagePrize: BlueprintCategorySchema.nullable().default(null),
});
export type MissionOffer = z.infer<typeof MissionOfferSchema>;

/** One board: a district, or the miscellaneous work that belongs to nobody's ground. */
export const MissionAreaSchema = z.object({
  id: MissionAreaIdSchema,
  name: z.string().min(1),
  /** One line about the ground, so the board says where the crew is going. */
  blurb: z.string().min(1),
  /** 1..10 for a district; the miscellaneous board is always 1. */
  difficulty: z.number().int().positive(),
  /** Percentage points the ground adds to every payout here. */
  payPercent: z.number().nonnegative(),
  /** The three on offer. Empty while a crew of this crew's is already working the area. */
  offers: z.array(MissionOfferSchema),
  /** The one that is running here, if any: the reason `offers` is empty. */
  activeMissionId: IdSchema.nullable(),
});
export type MissionArea = z.infer<typeof MissionAreaSchema>;

export const MissionsResponseSchema = z.object({
  missions: z.array(MissionSchema),
  /** Anything that came home on this read, so the UI can show what was banked. */
  justResolved: z.array(MissionSchema),
  resources: ResourcesSchema,
  activeLimit: z.number().int().positive(),
  /**
   * Every board this crew may read, `misc` first and then the districts in map order.
   *
   * Only the ones they have scouted and do not already own outright: a district with every
   * location taken and its gate down has nothing left in it worth being paid for.
   */
  areas: z.array(MissionAreaSchema),
  /** What is at home to send, after everything already out has been taken off it. */
  army: ArmySchema,
  serverNow: IsoDateTimeSchema,
  /** Set when the crews *this read* banked levelled the player up (§I1). */
  levelUp: LevelUpSchema.optional(),
});
export type MissionsResponse = z.infer<typeof MissionsResponseSchema>;

export const LaunchMissionRequestSchema = z.object({
  templateId: IdSchema,
  /** Which board it was taken off. The area is locked until this crew is home. */
  areaId: MissionAreaIdSchema,
  /** §A5: the units going. A battle job needs at least one of them able to fight. */
  force: ArmySchema,
  /**
   * §G6: the officer leading the run. Optional: an *easy* mission can go out with nobody leading
   * it, slower and with worse odds. A hard one without an officer is refused.
   */
  officerId: IdSchema.optional(),
  /**
   * §C3: the machines carrying them, out of the Garage for the run.
   *
   * Optional and defaulted, so a client that has never heard of the Garage still launches a run on
   * foot. Empty is the walk, which is what every mission was before this.
   */
  vehicles: FleetSchema.default({}),
});
export type LaunchMissionRequest = z.infer<typeof LaunchMissionRequestSchema>;
/**
 * The same request as a *caller* writes it, with the defaulted fields optional.
 *
 * `z.infer` is the shape after parsing, where `vehicles` has already been filled in with `{}`.
 * That is the right type for the route, which reads a parsed body, and the wrong one for the
 * client, which writes an unparsed one: it made every call site that does not send vehicles a type
 * error, including the ones that predate the Garage. The wire has always accepted a body without
 * it, and this is the type that says so.
 */
export type LaunchMissionInput = z.input<typeof LaunchMissionRequestSchema>;

export const LaunchMissionResponseSchema = z.object({
  mission: MissionSchema,
  serverNow: IsoDateTimeSchema,
  /**
   * A launch settles the board first, so a crew can land on this very call, and the next
   * `GET /missions` re-resolves nothing. Without this field that level-up is lost, not deferred.
   */
  levelUp: LevelUpSchema.optional(),
});
export type LaunchMissionResponse = z.infer<typeof LaunchMissionResponseSchema>;

// --- the Bar (GDD §H) ---

/**
 * One character on the Bar's roster.
 *
 * Everything here is either rolled onto the visible sheet or a judgement made *from* it. There is
 * deliberately no role, no affinity and no fit score: the roster is where role data would first
 * reach a player, and §B8a/INTERFACES R4 say it must not. A recruit has no role until the player
 * hires them into one (§C2), which is why `role` is on the hire request rather than on this DTO.
 */
export const BarRecruitSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  attributes: AttributesSchema,
  /** §B7: nought to three perks, the bonuses this person would bring to the whole crew. */
  perks: PerksSchema,
  /** §H3: what the crew has to be before they will consider signing. */
  requirement: JoinRequirementSchema,
  /** §H3 judged against *this* crew, so the client never re-derives the gate. */
  assessment: z.object({
    meetsNotoriety: z.boolean(),
    meetsLevel: z.boolean(),
    interested: z.boolean(),
    blockers: z.array(z.enum(JOIN_BLOCKERS)),
  }),
  /** §H7: the weekly fee in caps they open at. Absent until they are interested. */
  askingWage: z.number().int().positive().nullable(),
  /** Already on this crew's books: the roster is global, the hiring is not (§H2). */
  hired: z.boolean(),
  /**
   * Set while this crew has walked out on them and they will not sit down again yet.
   *
   * On the wire rather than derived, because the screen has to say *when* rather than only that
   * the chair is cold, and the clock the countdown runs against is the server's.
   */
  standoff: StandoffSchema.nullable(),
});
export type BarRecruit = z.infer<typeof BarRecruitSchema>;

/**
 * A held officer as the Bar shows them: their sheet, and what they cost.
 *
 * The §H5 standing and the §H6 level used to be here too: a band, a threat to leave, and the
 * attribute points their mood was currently worth. All of it is gone with those mechanics. An
 * officer's sheet is now the sheet they were hired with, so there is no "effective" version of it
 * to send and nothing about them changes between reads except the wage the book is charged.
 */
export const BarOfficerSchema = z.object({
  commander: CommanderSchema,
  /** §H7: the agreed weekly fee, read back out of the payroll book. */
  weeklyWage: z.number().nonnegative(),
  /** What releasing them costs in caps, right now: `DISMISSAL_WEEKS` of the fee above. */
  dismissalFee: z.number().int().nonnegative(),
});
export type BarOfficer = z.infer<typeof BarOfficerSchema>;

/**
 * The Bar screen in one call (GDD §H).
 *
 * `day` is the UTC date the roster was generated from and `serverNow` is the clock it came from:
 * §H2a makes the roster a pure function of the date, so a client with a skewed clock must still
 * be told which day it is looking at rather than working it out locally.
 */
export const BarResponseSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serverNow: IsoDateTimeSchema,
  recruits: z.array(BarRecruitSchema),
  officers: z.array(BarOfficerSchema),
  /** §H8: recruit slots, `2 + level - 1`, read off W6's grant table. */
  slotsUsed: z.number().int().nonnegative(),
  slotsTotal: z.number().int().nonnegative(),
  /** The three crew facts §H3 judges against, so the client can explain a refusal. */
  infamy: z.number(),
  notoriety: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  caps: z.number(),
  /** §H7: the payroll book, so the Bar can refuse a fee that will not fit before it is offered. */
  payroll: PayrollLedgerSchema,
  /** Roles §C3 says are already filled, so the hire form cannot offer them. */
  filledRoles: z.array(OfficerRoleSchema),
  /** §H2b: how many hires this player has left today, and when the limit resets. */
  hiresLeftToday: z.number().int().nonnegative(),
  /**
   * §H7: conversations already under way today, keyed by recruit id.
   *
   * Only the ones that have been opened, so a fresh Bar sends nothing. A character who has walked
   * out is in here with `closed` set, which is how the screen knows to grey the chair rather than
   * offering the player a conversation the server would refuse.
   */
  negotiations: z.record(IdSchema, NegotiationSchema),
  /** Set when this read's settlement crossed a level (§I1). */
  levelUp: LevelUpSchema.optional(),
});
export type BarResponse = z.infer<typeof BarResponseSchema>;

/** §H7: one exchange in a negotiation. The offer, and nothing else: the state is the server's. */
export const NegotiateRequestSchema = z.object({
  recruitId: IdSchema,
  offerWage: z.number().int().nonnegative(),
});
export type NegotiateRequest = z.infer<typeof NegotiateRequestSchema>;

/**
 * §H7: what they said back.
 *
 * `line` is the character speaking and is the point of the whole exchange; `negotiation` is the
 * state the window draws. An accepted offer does **not** hire anybody: agreeing a number and
 * signing a contract are two acts, and the second one still has to clear §H8 housing, the §H2b
 * daily limit and the first payment. The screen sends the agreed number to `/bar/hire`.
 */
export const NegotiateResponseSchema = z.object({
  negotiation: NegotiationSchema,
  /** What the character says this turn. */
  line: z.string().min(1),
  accepted: z.boolean(),
  walkedAway: z.boolean(),
});
export type NegotiateResponse = z.infer<typeof NegotiateResponseSchema>;

export const HireRecruitRequestSchema = z.object({
  recruitId: IdSchema,
  /**
   * §C2/§C3: a character is hired *into* a role, and a role holds one officer.
   *
   * `null` signs them to the bench instead (board request): on the books, drawing a wage, in no
   * chair. The Bar's whole pressure is that a good sheet walks away at dawn, and before this the
   * only way to keep one was to have a chair free *and* to have decided which; now the decision
   * can be made later, at the price of the off-duty share until it is.
   */
  role: OfficerRoleSchema.nullable(),
  /** §H7: the weekly wage in caps being offered. */
  offerWage: z.number().int().nonnegative(),
});
export type HireRecruitRequest = z.infer<typeof HireRecruitRequestSchema>;

/**
 * §H7: the answer to an offer. A rejected offer is a 200, not an error: the character countering
 * is the negotiation working, and `wage` is what they came back with.
 */
export const HireRecruitResponseSchema = z.object({
  accepted: z.boolean(),
  wage: z.number().int().nonnegative(),
  /** Present only when the offer was accepted. */
  officer: CommanderSchema.nullable(),
  /** §H7: the book after the signing. Nothing is charged; a slice of it is spoken for. */
  payroll: PayrollLedgerSchema.nullable(),
  /** §I1: signing somebody pays, so a hire can be the thing that crosses a level. */
  levelUp: LevelUpSchema.optional(),
});
export type HireRecruitResponse = z.infer<typeof HireRecruitResponseSchema>;

/** §H7: let an officer go. Frees their slice of the book and charges five weeks of it in caps. */
export const ReleaseOfficerRequestSchema = z.object({ officerId: IdSchema });
export type ReleaseOfficerRequest = z.infer<typeof ReleaseOfficerRequestSchema>;

export const ReleaseOfficerResponseSchema = z.object({
  officerId: IdSchema,
  /** Caps taken on the spot: `DISMISSAL_WEEKS` of what they were on. */
  fee: z.number().int().nonnegative(),
  resources: ResourcesSchema,
  payroll: PayrollLedgerSchema,
});
export type ReleaseOfficerResponse = z.infer<typeof ReleaseOfficerResponseSchema>;

/**
 * §H7: buy one more step of standing payroll at the Nexus.
 *
 * No amount on the request. A step is a fixed size at a price the server quotes, so a client that
 * could name its own number would be naming its own price.
 */
export const IncreasePayrollRequestSchema = z.object({});
export type IncreasePayrollRequest = z.infer<typeof IncreasePayrollRequestSchema>;

export const IncreasePayrollResponseSchema = z.object({
  /** Caps it cost. */
  spent: z.number().int().positive(),
  resources: ResourcesSchema,
  payroll: PayrollLedgerSchema,
});
export type IncreasePayrollResponse = z.infer<typeof IncreasePayrollResponseSchema>;

// --- research and discovery (GDD §B9, §F2-§F5) ---

/**
 * An officer the crew could put on an investigation (§B9/§C4), with what their own sheet buys.
 *
 * `crossReference` is §F4's worked example on the wire: the option is *reported* as unlocked or
 * not, so the client can offer it, and the server re-checks it on the way in. The Imagination
 * rating behind it is already on the officer's sheet: this adds no new knowledge, only the
 * consequence.
 */
export const ResearchLeadSchema = z.object({
  officerId: IdSchema,
  name: z.string().min(1),
  role: OfficerRoleSchema,
  crossReference: z.boolean(),
});
export type ResearchLead = z.infer<typeof ResearchLeadSchema>;

/**
 * One of the sixty-five modifications, as the research screen shows it (§A1).
 *
 * The whole catalogue is shipped every read rather than only the startable ones: a player deciding
 * which structure to raise next needs to see what raising it would unlock, and a list that hid
 * everything unavailable would hide exactly that. `blocker` is why this one is not startable, or
 * null when it is.
 */
export const ModificationOptionSchema = z.object({
  id: z.string().min(1),
  building: BuildingKindSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  effect: ModificationEffectSchema,
  magnitude: z.number(),
  /** Already fitted to the structure. */
  installed: z.boolean(),
  blocker: ModificationBlockerSchema.nullable(),
});
export type ModificationOption = z.infer<typeof ModificationOptionSchema>;

/**
 * The research screen in one call.
 *
 * Note what is *not* here: no fit score, no weight, no ordering, nothing keyed by role id. Every
 * scrap of role knowledge in this body is a `DiscoveredFact` the crew paid for (§B9, INTERFACES
 * R4), and `apps/server/src/research/discovery.leak.test.ts` asserts it over the real response.
 */
/**
 * One rung of one of §C's nineteen role tracks, as the screen shows it.
 *
 * `cost` is what this crew would actually pay: the catalogue price with the track officer's own cut
 * already taken off (§C1d, §C3b), so the number on the card is the number that leaves the
 * stockpile. The two marks are the thresholds (§C2a, §C2e); `blocker` is the first of them this
 * crew fails, in words.
 */
export const LabTechSchema = z.object({
  id: z.string(),
  track: OfficerRoleSchema,
  /** 1 to 10, bottom rung first. */
  step: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  cost: PartialResourcesSchema,
  /** The clock this crew would get, after the Lab, the crew and the Head of Research. */
  minutes: z.number().int().positive(),
  /** What it lands on, and how much, in the player's words. */
  effect: z.string(),
  requiresMark: OfficerMarkSchema,
  requiresHeadMark: OfficerMarkSchema.nullable(),
  known: z.boolean(),
  blocker: z.string().nullable(),
});
export type LabTech = z.infer<typeof LabTechSchema>;

/**
 * One track, and who is standing on it.
 *
 * An array on the response rather than a record keyed by role: role-keyed structured data is a fit
 * hint by shape (§B8a) and the leak guard refuses it wholesale. Nothing here is the score itself.
 * `costCutPercent` is derived from it, which is the point of §C3b: a bonus that reads the points
 * has to be visible or the player cannot tell training worked.
 */
export const ResearchTrackStatusSchema = z.object({
  role: OfficerRoleSchema,
  /** The officer in that chair, or null when it is empty. */
  officerName: z.string().nullable(),
  mark: OfficerMarkSchema.nullable(),
  /** §C1d: what that officer's own sheet takes off every price on their track. */
  costCutPercent: z.number(),
  /** How many of the ten are finished. */
  done: z.number().int().nonnegative(),
});
export type ResearchTrackStatus = z.infer<typeof ResearchTrackStatusSchema>;

/** §C1c/§C3a: the one officer every track needs, and what their sheet is worth to the clock. */
export const ResearchHeadSchema = z.object({
  name: z.string(),
  mark: OfficerMarkSchema,
  timeCutPercent: z.number(),
});
export type ResearchHead = z.infer<typeof ResearchHeadSchema>;

export const StartTechRequestSchema = z.object({ techId: z.string().min(1) });
export type StartTechRequest = z.infer<typeof StartTechRequestSchema>;

export const ResearchResponseSchema = z.object({
  serverNow: IsoDateTimeSchema,
  active: ActiveResearchSchema.nullable(),
  /** When `active` lands. Null when nothing is running. */
  completesAt: IsoDateTimeSchema.nullable(),
  /** Facts banked by *this* read's settlement, so the page can call out what just came in. */
  justDiscovered: z.array(DiscoveredFactSchema),
  /** Everything the crew knows, discovered facts only. */
  facts: z.array(DiscoveredFactSchema),
  leads: z.array(ResearchLeadSchema),
  /** Roles with something left to learn: the rest are at `MAX_ROLE_FACTS`. */
  openRoles: z.array(OfficerRoleSchema),
  /** True once `MAX_PAIRINGS` is reached and cross-referencing has nothing left to find. */
  pairingsExhausted: z.boolean(),
  /** §F2: the Overseer's sheet, which is what a training project moves. */
  overseerAttributes: AttributesSchema,
  /** §C: every rung of every track, with what is finished, what is reachable and why not. */
  technologies: z.array(LabTechSchema).default([]),
  /** §C1b: the nineteen tracks in `OFFICER_ROLES` order, with who is standing on each. */
  tracks: z.array(ResearchTrackStatusSchema).default([]),
  /** §C1c: null when nobody holds the post, which shuts every track at once. */
  head: ResearchHeadSchema.nullable().default(null),
  caps: z.number(),
  costs: z.object({
    investigation: z.number().int().nonnegative(),
    training: z.number().int().nonnegative(),
    modification: z.number().int().nonnegative(),
  }),
  /** §A1: modification work needs a Lead Engineer on the books to run it. */
  canModify: z.boolean(),
  /** Every modification this district could start right now, with why it can or cannot. */
  modifications: z.array(ModificationOptionSchema),
  /** Set when this read's settlement crossed a level (§I1). */
  levelUp: LevelUpSchema.optional(),
});
export type ResearchResponse = z.infer<typeof ResearchResponseSchema>;

/** Starting a project is just naming it: the server prices, clocks and validates it. */
export const StartResearchRequestSchema = ResearchProjectSchema;
export type StartResearchRequest = z.infer<typeof StartResearchRequestSchema>;

export const StartResearchResponseSchema = z.object({
  active: ActiveResearchSchema,
  completesAt: IsoDateTimeSchema,
  resources: ResourcesSchema,
});
export type StartResearchResponse = z.infer<typeof StartResearchResponseSchema>;
// --- the crew (GDD §G) ---

/** One officer on the §G screen: who stands under them, and what §G7 pays for it. */
export const CrewOfficerSchema = z.object({
  officerId: IdSchema,
  name: z.string(),
  /** `null` for somebody on the bench: signed and unassigned. */
  role: OfficerRoleSchema.nullable(),
  /**
   * Who this person actually is (§B6, §B7, §H6).
   *
   * The crew screen used to be a list of names with a pip counter beside each, which is a
   * spreadsheet of a roster rather than a roster: the whole reason a player agonised over hiring
   * somebody at the Bar is on their sheet, and the screen where that person lives never showed it.
   * Carried on the same payload rather than fetched per officer. It is one small object and the
   * alternative is nineteen round trips to open nineteen cards.
   */
  attributes: AttributesSchema,
  /** §B7: the nought-to-three bonuses they bring, which is what the card leads with. */
  perks: PerksSchema,
  /**
   * How well they fit the chair they are in, as a mark (board brief, 2026-09-03).
   *
   * `null` on the bench, because a mark is about a *fit* and somebody with no chair has nothing to
   * fit: the same person reads differently in two different roles, which is the whole point of
   * showing it. Computed by the server, because the weights behind the score are
   * server-side only (B8/B8a) and a client that could compute this could reconstruct the table.
   */
  mark: OfficerMarkSchema.nullable(),
  /**
   * §H7: the weekly fee agreed when they signed, in caps.
   *
   * On the crew payload rather than only on the Bar's, because "what am I paying this person" is a
   * question about somebody already on the books, and the screen that lists the books is where it
   * gets asked.
   */
  weeklyWage: z.number().int().nonnegative(),
  /** §D4: when they are back on their feet, or null while they are fit. */
  injuredUntil: IsoDateTimeSchema.nullable().default(null),
});
export type CrewOfficer = z.infer<typeof CrewOfficerSchema>;

/**
 * The crew in one call (GDD §G): who is in which chair, and everything about them.
 *
 * It used to be the assignee layer, and most of it was pool arithmetic: a level-granted body count,
 * how much of it was placed, what one more body under an officer would pay. All of that is gone.
 * What is left is the part a player was ever actually looking at, which is the people.
 */
export const CrewResponseSchema = z.object({
  /** `Base.level` (INTERFACES R1): echoed so the page can explain where the cap came from. */
  level: z.number().int().min(1),
  /**
   * §A1: the Quarters' ceiling and what is standing under it, officers included.
   *
   * Reported rather than derived client-side because the same two numbers gate hiring at the Bar,
   * and a screen that computed its own would be the second place the rule lives.
   */
  housing: z.object({
    used: z.number().int().nonnegative(),
    capacity: z.number().int().nonnegative(),
  }),
  officers: z.array(CrewOfficerSchema),
});
export type CrewResponse = z.infer<typeof CrewResponseSchema>;

/** The one write answers with the refreshed screen, so the client never re-derives state. */
export const CrewMutationResponseSchema = z.object({
  crew: CrewResponseSchema,
});
export type CrewMutationResponse = z.infer<typeof CrewMutationResponseSchema>;

// --- training (§F2) ---

/**
 * One person the Training tab can put through an hour.
 *
 * The Overseer and the officers are the same shape here on purpose: the tab treats them
 * identically, and a screen that branched on which kind of person it was drawing would have two
 * of every control. `role` is already written for a player: "Overseer", or the officer's title,
 * so nothing on the client maps an enum to a word a second time.
 */
export const TrainingSubjectSchema = z.object({
  /** `OVERSEER_SUBJECT`, or the officer's id. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** What their chair is called, for the screen. */
  role: z.string().min(1),
  /**
   * ...and which chair it *is*, for anything that has to look it up.
   *
   * `null` for the Overseer, who is in no seat. Separate from `role` above because that one is a
   * display label and this one is a key: the training sheet edges every skill by how much the
   * chair cares (`ROLE_IMPORTANCE`), and a label cannot be looked up in a table.
   */
  officerRole: OfficerRoleSchema.nullable(),
  /** Everybody has a portrait: the Overseer's preset, or one off the officer pool. */
  portraitId: z.string().nullable(),
  attributes: AttributesSchema,
  perks: PerksSchema,
  /** What they are doing right now, if anything. */
  session: TrainingSessionSchema.nullable(),
  /** What they did last, which is the one thing they may not do next. */
  lastAttribute: AttributeNameSchema.nullable(),
  /** §D4: when they are back on their feet, or null while they are fit. Always null for the Overseer. */
  injuredUntil: IsoDateTimeSchema.nullable().default(null),
});
export type TrainingSubject = z.infer<typeof TrainingSubjectSchema>;

export const TrainingResponseSchema = z.object({
  serverNow: IsoDateTimeSchema,
  /** Sessions still available today, and the daily allowance they come out of. */
  sessionsLeft: z.number().int().nonnegative(),
  perDay: z.number().int().positive(),
  gainPerSession: z.number().int().positive(),
  sessionSeconds: z.number().int().positive(),
  subjects: z.array(TrainingSubjectSchema),
});
export type TrainingResponse = z.infer<typeof TrainingResponseSchema>;

export const StartTrainingRequestSchema = z.object({
  subjectId: z.string().min(1),
  attribute: AttributeNameSchema,
});
export type StartTrainingRequest = z.infer<typeof StartTrainingRequestSchema>;

/**
 * What the crew's attributes are currently worth, channel by channel.
 *
 * Sent as the whole {@link CrewEffects} struct rather than a hand-picked few, so the profile can
 * show every lever a player has moved. It is derived from the player's own sheets and leaks
 * nothing about role requirements (§B8a): the hidden table is a different thing entirely.
 */
export const CrewStandingResponseSchema = z.object({
  overseer: OverseerSchema,
  /** Best-of across the Overseer and every officer: the sheet the effects are computed from. */
  crewSheet: AttributesSchema,
  effects: z.record(z.string(), z.number()),
});
export type CrewStandingResponse = z.infer<typeof CrewStandingResponseSchema>;

// --- the market, the satchel and the workshop ---

/** One line on the Runner's barrow, as a player sees it. */
export const VendorOfferSchema = z.object({
  line: VendorLineSchema,
  /** Whether this crew can pay for one right now. */
  affordable: z.boolean(),
});
export type VendorOffer = z.infer<typeof VendorOfferSchema>;

export const MarketResponseSchema = z.object({
  serverNow: IsoDateTimeSchema,
  caps: z.number().nonnegative(),
  resources: ResourcesSchema,
  inventory: InventorySchema,
  /** §Market: the Runner's hours today, whether he is in, and when he next is. */
  vendor: z.object({
    open: z.boolean(),
    sessions: z.array(VendorSessionSchema),
    closesAt: IsoDateTimeSchema.nullable(),
    opensAt: IsoDateTimeSchema,
    stock: z.array(VendorOfferSchema),
  }),
  /** The public board, plus any counter aimed at this crew. */
  offers: z.array(MarketOfferSchema),
  /** This crew's own standing listings. */
  mine: z.array(MarketOfferSchema),
  /** Caps into materials, and how much of today's run is left. */
  supply: SupplyBoardSchema,
  /** What the Broker gives back, at this crew's level. Quoted so the client cannot guess wrong. */
  barterRate: z.number().positive(),
  /*
   * §G4: whether the Lab will do the Reimagining trade for this crew, decided on the server.
   *
   * Both halves live somewhere the Blueprints screen cannot see: the seat is on the crew and the
   * research is on the base. Sending the booleans rather than the raw sheets keeps the panel from
   * having to load two more screens' worth of payload to draw one lock icon, and keeps the answer
   * to "is it open" in one place, since the route re-checks the same predicate before trading.
   */
  reimagining: z.object({
    hasHeadOfResearch: z.boolean(),
    hasReimaginingResearch: z.boolean(),
  }),
});
export type MarketResponse = z.infer<typeof MarketResponseSchema>;

/** The supply run: caps out, one material in, inside the day's ration. */
export const BuySupplyRequestSchema = z.object({
  // Same derived enum the board's own lines are parsed with: see `market/supply.ts`.
  key: SupplyResourceSchema,
  units: z.number().int().positive(),
});
export type BuySupplyRequest = z.infer<typeof BuySupplyRequestSchema>;

export const BuyFromVendorRequestSchema = z.object({
  lineId: z.string().min(1),
  count: z.number().int().min(1).max(20),
});
export type BuyFromVendorRequest = z.infer<typeof BuyFromVendorRequestSchema>;

/** The Broker: give one resource, take half as much of another. */
export const BarterRequestSchema = z.object({
  give: ResourceKeySchema,
  want: ResourceKeySchema,
  amount: z.number().int().positive(),
});
export type BarterRequest = z.infer<typeof BarterRequestSchema>;

export const PostOfferRequestSchema = z.object({
  give: TradeBundleSchema,
  want: TradeBundleSchema,
  /** Set to counter somebody else's listing rather than post a public one. */
  counterTo: IdSchema.optional(),
});
export type PostOfferRequest = z.infer<typeof PostOfferRequestSchema>;

export const OfferActionRequestSchema = z.object({ offerId: IdSchema });
export type OfferActionRequest = z.infer<typeof OfferActionRequestSchema>;

/** Every market write answers with the refreshed board, so the client never re-derives it. */
export const MarketMutationResponseSchema = z.object({ market: MarketResponseSchema });

/**
 * §G2/§G3: the Reimagining trade.
 *
 * The request names nothing. Which pages go is not the player's choice (the Lab takes the most
 * duplicated first, `reimagine`), and which page comes back is not either: letting the client name
 * either one would turn a guaranteed trade into a shopping trip, and would let a refused request
 * be retried until it offered something better.
 */
export const ReimagineResponseSchema = z.object({
  market: MarketResponseSchema,
  /** The page ids spent, so the report can name them. Three of them, possibly the same one thrice. */
  spent: z.array(z.string()),
  /** ...and the one that came back. */
  gained: z.string(),
});
export type ReimagineResponse = z.infer<typeof ReimagineResponseSchema>;
export type MarketMutationResponse = z.infer<typeof MarketMutationResponseSchema>;

/** The workshop screen: what the crew has built, what it could build, and why not. */
export const WorkshopUpgradeSchema = z.object({
  id: z.string(),
  line: UpgradeLineSchema,
  tier: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  cost: PartialResourcesSchema,
  parts: InventorySchema,
  effect: z.record(z.string(), z.number()),
  /**
   * In the crew's stock. Built once and kept: it improves nobody by itself, and pays wherever
   * the player then bolts it (`units/loadout.ts`, three brackets per unit).
   */
  built: z.boolean(),
  /** Player-facing reason it cannot be built, or null. */
  blocker: z.string().nullable(),
});
export type WorkshopUpgrade = z.infer<typeof WorkshopUpgradeSchema>;

export const WorkshopResponseSchema = z.object({
  resources: ResourcesSchema,
  inventory: InventorySchema,
  upgrades: z.array(WorkshopUpgradeSchema),
});
export type WorkshopResponse = z.infer<typeof WorkshopResponseSchema>;

export const FitUpgradeRequestSchema = z.object({ upgradeId: z.string().min(1) });
export type FitUpgradeRequest = z.infer<typeof FitUpgradeRequestSchema>;

/**
 * §D10: turn a complete set of pages into the blueprint itself.
 *
 * Answers with the refreshed market board, the same as every other write that moves the satchel.
 * The Blueprints page reads its pages off `MarketResponse.inventory`, so one payload puts the row
 * in its unlocked state, empties the pages it spent and updates the satchel behind it.
 */
export const UnlockBlueprintRequestSchema = z.object({ blueprintId: z.string().min(1) });
export type UnlockBlueprintRequest = z.infer<typeof UnlockBlueprintRequestSchema>;

// The yard's own request lives in `api.garage.ts` now: §B11 gave the Garage a page of its own.

export const WorkshopMutationResponseSchema = z.object({ workshop: WorkshopResponseSchema });
export type WorkshopMutationResponse = z.infer<typeof WorkshopMutationResponseSchema>;

/** §E: turn a crew around. They walk back the way they came and arrive with nothing. */
export const RecallMissionRequestSchema = z.object({ missionId: IdSchema });
export type RecallMissionRequest = z.infer<typeof RecallMissionRequestSchema>;

/** §C2: move an officer into a different position. The Overseer is not a position. */
export const ReassignOfficerRequestSchema = z.object({
  officerId: IdSchema,
  /** `null` takes them out of the chair and puts them on the bench, without ending their job. */
  role: OfficerRoleSchema.nullable(),
});
export type ReassignOfficerRequest = z.infer<typeof ReassignOfficerRequestSchema>;
