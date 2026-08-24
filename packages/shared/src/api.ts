import { z } from 'zod';
import { MAX_ASSIGNEES_PER_OFFICER } from './assignees/index.js';
import { ATTRIBUTE_NAMES, AttributeNameSchema, AttributesSchema } from './attributes.js';
import {
  ALIGNMENT_BANDS,
  AmbitionSchema,
  JOIN_BLOCKERS,
  JoinRequirementSchema,
  MoralCompassSchema,
  NegotiationSchema,
  STANCE_MAX,
  STANCE_MIN,
} from './bar/index.js';
import { BaseSchema, BaseSummarySchema, FactionNameSchema } from './base.js';
import { BattleResultSchema } from './battle/types.js';
import { ArmySchema, TrainingQueueSchema, UnitStatsSchema, UnitTierSchema } from './units/index.js';
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
import { CommanderSchema } from './commander.js';
import { ReputationLabelSchema } from './economy/reputation.js';
import { MissionSchema } from './missions.js';
import { OverseerSchema } from './overseer.js';
import { TrainingSessionSchema } from './crew/training.js';
import { InventorySchema } from './items/inventory.js';
import { ResourceKeySchema } from './resources.js';
import { MarketOfferSchema, TradeBundleSchema } from './market/offers.js';
import { SupplyBoardSchema } from './market/supply.js';
import { VendorLineSchema, VendorSessionSchema } from './market/vendor.js';
import { UpgradeLineSchema } from './units/upgrades.js';
import { TechTrackSchema } from './research/tech.js';
import { IdSchema, IsoDateTimeSchema, UsernameSchema } from './primitives.js';
import { PlayerLevelGrantsSchema, PlayerLevelUnlockSchema } from './progression/index.js';
import {
  ActiveResearchSchema,
  DiscoveredFactSchema,
  ResearchProjectSchema,
} from './research/index.js';
import { PartialResourcesSchema, ResourcesSchema } from './resources.js';
import { OfficerRoleSchema } from './roles.js';
import { TraitsSchema } from './traits.js';
import { UserSchema } from './user.js';

/**
 * API DTOs — the single source of truth for the REST contract in docs/SPEC-server.md.
 * The server validates request bodies with these schemas; the client parses responses with them.
 */

// --- player levelling (GDD §I) ---

/**
 * A level-up the *caller's own request* just paid for, so the path that caused it can announce it.
 *
 * Carried on every response whose call can award XP, and **present only when a level was actually
 * crossed** — presence is the whole signal, so no client compares two numbers to work out whether
 * something happened. `levelsGained > 1` when one settlement crossed several levels.
 *
 * §I3 unlocks ride along now that the board has filed the catalogue. Usually empty — most levels
 * open nothing — and that is the point: the levels that *do* open something are the ones a player
 * should be able to feel arriving, so the announcement names them rather than leaving a player to
 * notice that a door has stopped being locked.
 */
export const LevelUpSchema = z.object({
  /** `Base.level` after the award. */
  level: z.number().int().positive(),
  levelsGained: z.number().int().positive(),
  /** §I2 grants at the new level — what the level is actually worth. */
  grants: PlayerLevelGrantsSchema,
  /** §I3 — every unlock this award crossed, oldest level first. Empty on most level-ups. */
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
   * MOU-280 — a refusal can still have banked a level-up on its way to refusing.
   *
   * The write routes settle lazily (`resolveDueMissions`, `economy/settle.ts`), so a request that
   * is about to be rejected may already have brought a crew home and crossed a threshold. That
   * write is not rolled back, and no later read re-resolves it, so the *refusal* is the only place
   * it can ever be announced. A sibling of `error` rather than a field inside it, because it is not
   * part of why the call failed.
   *
   * `.catch` for that same reason: this is an extra riding along, so a malformed one must not fail
   * the whole envelope and cost the player the refusal *message* — the client falls back to
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
export const MeResponseSchema = z.object({
  user: UserSchema,
  overseer: OverseerSchema.nullable(),
  base: BaseSchema.nullable(),
  /**
   * Set when *this read's* settlement crossed a level (§I1).
   *
   * `/me` is the call the game shell polls, so it is where a build that finished while the player
   * was looking at another page gets announced. Without it the XP is banked and the level-up is
   * silently lost — MOU-227's rule is that presence is the whole signal, and a settle nobody
   * announces has no second chance to.
   */
  levelUp: LevelUpSchema.optional(),
  /**
   * Whether this build has an admin bench.
   *
   * On `/me` rather than discovered by calling the bench and catching a 404. The nav has to decide
   * whether to draw the door on every screen, so a 404-as-answer meant every production session
   * logged a failed request on every page — which is both noise in a console the board reads and
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
 * is false every count below is null — not zero. Zero is a fact about the world; null is a fact
 * about what you know, and a map that reported "0 / 4 held" for ground nobody has walked into
 * would be telling the player something it has no business knowing.
 */
export const DistrictSummarySchema = z.object({
  district: DistrictSchema,
  scouted: z.boolean(),
  /** Minutes from this crew's home district, with their travel bonuses already applied. */
  travelMinutes: z.number().int().nonnegative(),
  /** Who holds the whole district, if anyone does. Null when it is split — or unscouted. */
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
  serverNow: IsoDateTimeSchema,
});
export type CityResponse = z.infer<typeof CityResponseSchema>;

/** One place inside a district, as the district view shows it. */
export const LocationViewSchema = z.object({
  location: LocationSchema,
  holder: LocationHolderSchema,
  /** Who that is in words — a crew's name, or "The Combine". */
  holderName: z.string().min(1),
  /** 1..`MAX_LOCATION_LEVEL` — how far the current holder has worked it up (§A4). */
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
   * Exactly who is standing here — **only** for locations this crew holds. Null otherwise, because
   * the composition of somebody else's garrison is the thing scouting would be for.
   */
  garrison: ArmySchema.nullable(),
  /** Each hold bonus in one line, at this location's current level. */
  bonuses: z.array(z.string().min(1)),
  reward: z.string().min(1),
  /**
   * What the ground is like right now (§A4) — the location's own labels folded with the day's
   * weather and the hour. This is what the player reads to decide what to bring.
   */
  labels: z.array(EnvLabelSchema),
  /** Names of units holding this kind of location would unlock. Usually empty. */
  unlocks: z.array(z.string()),
});
export type LocationView = z.infer<typeof LocationViewSchema>;

export const DistrictDetailResponseSchema = z.object({
  district: DistrictSchema,
  scouted: z.boolean(),
  travelMinutes: z.number().int().nonnegative(),
  /** Empty when the district has not been scouted — the fog is enforced server-side. */
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
   * far it has been built up. What stays hidden is everything a crew *knows* — the roles they have
   * worked out, the facts they have discovered, what is in their stockpile — none of which is here.
   *
   * Empty on ground nobody lives on, and on unscouted ground: you cannot describe a place you have
   * not been to.
   */
  residentBuildings: z.array(BuildingSchema),
  raidable: z.boolean(),
  serverNow: IsoDateTimeSchema,
});
export type DistrictDetailResponse = z.infer<typeof DistrictDetailResponseSchema>;

/*
 * `AttackPlaceRequest`, `AttackPlaceResponse`, `RaidDistrictRequest` and `RaidDistrictResponse`
 * were here, and they are gone with the routes that carried them (board, battle rework).
 *
 * They described a fight resolved the instant a button was pressed. §A4 now says a fight is
 * declared in advance on a mark both sides can read, which is `api.battle.ts` — declare, deploy,
 * and a settler that runs when the mark passes. An instant path beside it would have been the only
 * path anybody used.
 */

/** Leave units on a place you hold, or take them home again. */
export const GarrisonRequestSchema = z.object({
  locationId: z.string().min(1),
  /** Positive leaves units there; negative brings them back. */
  changes: z.record(z.string(), z.number().int()),
});
export type GarrisonRequest = z.infer<typeof GarrisonRequestSchema>;

export const FortifyRequestSchema = z.object({
  locationId: z.string().min(1),
});
export type FortifyRequest = z.infer<typeof FortifyRequestSchema>;

/** §A4 — work a location you hold up one level. */
export const UpgradeLocationRequestSchema = z.object({
  locationId: z.string().min(1),
});
export type UpgradeLocationRequest = z.infer<typeof UpgradeLocationRequestSchema>;

export const ScoutRequestSchema = z.object({
  districtId: IdSchema,
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
   * §A4 — the ground this unit is unusually good or bad in.
   *
   * Only the labels where it differs from what its own sheet would predict: the Juggernaut's
   * misery in the heat is already legible from ninety-five points of armour, and listing it here
   * as well would bury the one line that is genuinely a surprise. What survives is the handful of
   * cases the sheet cannot say — Anodics fighting *better* in a room full of noise, the
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
  unlocked: z.boolean(),
  /** The clauses this crew has not met, in the player's words. Empty when unlocked. */
  missing: z.array(z.string()),
  /** How many are at home. Garrisoned units are counted separately. */
  owned: z.number().int().nonnegative(),
});
export type UnitOption = z.infer<typeof UnitOptionSchema>;

export const UnitsResponseSchema = z.object({
  serverNow: IsoDateTimeSchema,
  units: z.array(UnitOptionSchema),
  army: ArmySchema,
  /** Units standing on captured places, summed across the city. */
  garrisoned: ArmySchema,
  supplyUsed: z.number().int().nonnegative(),
  supplyCap: z.number().int().nonnegative(),
  queue: TrainingQueueSchema,
  resources: ResourcesSchema,
  /** Everything territory is doing to training right now, so the page can explain a price. */
  trainingCostReduction: z.number(),
  trainingSpeedBonus: z.number(),
});
export type UnitsResponse = z.infer<typeof UnitsResponseSchema>;

export const TrainUnitsRequestSchema = z.object({
  unitId: z.string().min(1),
  count: z.number().int().positive().max(50),
});
export type TrainUnitsRequest = z.infer<typeof TrainUnitsRequestSchema>;

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
 * Put one structure's next level into the build queue — construction when the plot is empty, an
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
  /** The whole base after the order — the queue, the stockpile and anything that just landed. */
  base: BaseSchema,
  /** §I1 pays for building things: set when a *completed* build's XP crossed a level. */
  levelUp: LevelUpSchema.optional(),
});
export type BuildStructureResponse = z.infer<typeof BuildStructureResponseSchema>;

/**
 * Name the faction (§A1).
 *
 * The name is the crew's, not the district's, and it is the one thing about a player every other
 * player sees. Trimmed and length-bounded by `FactionNameSchema` rather than by the input control,
 * so a name that came from anywhere other than the form is held to the same rule.
 */
export const RenameFactionRequestSchema = z.object({
  name: FactionNameSchema,
});
export type RenameFactionRequest = z.infer<typeof RenameFactionRequestSchema>;

export const RenameFactionResponseSchema = z.object({
  base: BaseSchema,
});
export type RenameFactionResponse = z.infer<typeof RenameFactionResponseSchema>;

// --- battle ---
export const BattleRequestSchema = z.object({
  targetDistrictId: IdSchema,
});
export type BattleRequest = z.infer<typeof BattleRequestSchema>;

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
 * the same remaining time as everyone else — and still cannot make a mission land early.
 */
export const MissionsResponseSchema = z.object({
  missions: z.array(MissionSchema),
  /** Anything that came home on this read, so the UI can show what was banked. */
  justResolved: z.array(MissionSchema),
  resources: ResourcesSchema,
  activeLimit: z.number().int().positive(),
  serverNow: IsoDateTimeSchema,
  /** Set when the crews *this read* banked levelled the player up (§I1). */
  levelUp: LevelUpSchema.optional(),
});
export type MissionsResponse = z.infer<typeof MissionsResponseSchema>;

export const LaunchMissionRequestSchema = z.object({
  templateId: IdSchema,
  /**
   * §G6 — the officer leading the run. Optional: an *easy* mission can go out on a delegation of
   * assignees alone, slower and with worse odds. A hard one without an officer is refused.
   */
  officerId: IdSchema.optional(),
});
export type LaunchMissionRequest = z.infer<typeof LaunchMissionRequestSchema>;

export const LaunchMissionResponseSchema = z.object({
  mission: MissionSchema,
  serverNow: IsoDateTimeSchema,
  /**
   * A launch settles the board first, so a crew can land on this very call — and the next
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
  traits: TraitsSchema,
  /** §H4 — what they want and how far they will go for it. */
  ambition: AmbitionSchema,
  moralCompass: MoralCompassSchema,
  /** §H3 — what the crew has to be before they will consider signing. */
  requirement: JoinRequirementSchema,
  /** §H3 + §H4 judged against *this* crew, so the client never re-derives the gate. */
  assessment: z.object({
    meetsRequirement: z.boolean(),
    stance: z.number().int().min(STANCE_MIN).max(STANCE_MAX),
    interested: z.boolean(),
    blockers: z.array(z.enum(JOIN_BLOCKERS)),
  }),
  /** §H7 — the weekly wage in caps they open at. Absent until they are interested. */
  askingWage: z.number().int().positive().nullable(),
  /** Already on this crew's books — the roster is global, the hiring is not (§H2). */
  hired: z.boolean(),
});
export type BarRecruit = z.infer<typeof BarRecruitSchema>;

/** A held officer as the Bar shows them: their sheet, their §H5 standing and their §H6 level. */
export const BarOfficerSchema = z.object({
  commander: CommanderSchema,
  /** §H5 — the sheet as it performs, with the alignment bonus folded in. */
  effectiveAttributes: AttributesSchema,
  band: z.enum(ALIGNMENT_BANDS),
  /** §H5 — "too low → they threaten to leave". */
  threateningToLeave: z.boolean(),
  /** §H5 — attribute points the alignment bonus is currently worth, and where they land. */
  skillBonus: z.number().int().nonnegative(),
  bonusAttributes: z.array(z.enum(ATTRIBUTE_NAMES)),
  /** §H7 — the agreed weekly wage, read back out of the payroll book W2 owns. */
  weeklyWage: z.number().nonnegative(),
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
  /** §H8 — recruit slots, `2 + level - 1`, read off W6's grant table. */
  slotsUsed: z.number().int().nonnegative(),
  slotsTotal: z.number().int().nonnegative(),
  /** The two crew facts §H3/§H4 judge against, so the client can explain a refusal. */
  infamy: z.number(),
  reputation: ReputationLabelSchema,
  caps: z.number(),
  /** Roles §C3 says are already filled, so the hire form cannot offer them. */
  filledRoles: z.array(OfficerRoleSchema),
  /** §H2b — how many hires this player has left today, and when the limit resets. */
  hiresLeftToday: z.number().int().nonnegative(),
  /**
   * §H7 — conversations already under way today, keyed by recruit id.
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

/** §H7 — one exchange in a negotiation. The offer, and nothing else: the state is the server's. */
export const NegotiateRequestSchema = z.object({
  recruitId: IdSchema,
  offerWage: z.number().int().nonnegative(),
});
export type NegotiateRequest = z.infer<typeof NegotiateRequestSchema>;

/**
 * §H7 — what they said back.
 *
 * `line` is the character speaking and is the point of the whole exchange; `negotiation` is the
 * state the window draws. An accepted offer does **not** hire anybody — agreeing a number and
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
  /** §C2/§C3 — a character is hired *into* a role, and a role holds one officer. */
  role: OfficerRoleSchema,
  /** §H7 — the weekly wage in caps being offered. */
  offerWage: z.number().int().nonnegative(),
});
export type HireRecruitRequest = z.infer<typeof HireRecruitRequestSchema>;

/**
 * §H7 — the answer to an offer. A rejected offer is a 200, not an error: the character countering
 * is the negotiation working, and `wage` is what they came back with.
 */
export const HireRecruitResponseSchema = z.object({
  accepted: z.boolean(),
  wage: z.number().int().nonnegative(),
  /** Present only when the offer was accepted. */
  officer: CommanderSchema.nullable(),
  /** §H7 — the prorated first payment, taken at recruitment for the rest of this pay week. */
  firstPayment: z.number().nonnegative(),
  resources: ResourcesSchema.nullable(),
  /** §I1 — signing somebody pays, so a hire can be the thing that crosses a level. */
  levelUp: LevelUpSchema.optional(),
});
export type HireRecruitResponse = z.infer<typeof HireRecruitResponseSchema>;

/** §H6 — spend one of the level-up points the player was given to assign by hand. */
export const AssignPointRequestSchema = z.object({
  officerId: IdSchema,
  attribute: z.enum(ATTRIBUTE_NAMES),
});
export type AssignPointRequest = z.infer<typeof AssignPointRequestSchema>;

export const AssignPointResponseSchema = z.object({
  officer: CommanderSchema,
});
export type AssignPointResponse = z.infer<typeof AssignPointResponseSchema>;

// --- research and discovery (GDD §B9, §F2-§F5) ---

/**
 * An officer the crew could put on an investigation (§B9/§C4), with what their own sheet buys.
 *
 * `crossReference` is §F4's worked example on the wire: the option is *reported* as unlocked or
 * not, so the client can offer it, and the server re-checks it on the way in. The Imagination
 * rating behind it is already on the officer's sheet — this adds no new knowledge, only the
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
/** One standing programme at the Lab, as the screen shows it. */
export const LabTechSchema = z.object({
  id: z.string(),
  track: TechTrackSchema,
  tier: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  cost: PartialResourcesSchema,
  parts: InventorySchema,
  /** What it lands on, and how much, in the player's words. */
  effect: z.string(),
  known: z.boolean(),
  blocker: z.string().nullable(),
});
export type LabTech = z.infer<typeof LabTechSchema>;

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
  /** Roles with something left to learn — the rest are at `MAX_ROLE_FACTS`. */
  openRoles: z.array(OfficerRoleSchema),
  /** True once `MAX_PAIRINGS` is reached and cross-referencing has nothing left to find. */
  pairingsExhausted: z.boolean(),
  /** §F2 — the Overseer's sheet, which is what a training project moves. */
  overseerAttributes: AttributesSchema,
  /** The Lab's standing programmes — what is finished, what is reachable, and why not. */
  technologies: z.array(LabTechSchema).default([]),
  caps: z.number(),
  costs: z.object({
    investigation: z.number().int().nonnegative(),
    training: z.number().int().nonnegative(),
    modification: z.number().int().nonnegative(),
  }),
  /** §A1 — modification work needs a Lead Engineer on the books to run it. */
  canModify: z.boolean(),
  /** Every modification this district could start right now, with why it can or cannot. */
  modifications: z.array(ModificationOptionSchema),
  /** Set when this read's settlement crossed a level (§I1). */
  levelUp: LevelUpSchema.optional(),
});
export type ResearchResponse = z.infer<typeof ResearchResponseSchema>;

/** Starting a project is just naming it — the server prices, clocks and validates it. */
export const StartResearchRequestSchema = ResearchProjectSchema;
export type StartResearchRequest = z.infer<typeof StartResearchRequestSchema>;

export const StartResearchResponseSchema = z.object({
  active: ActiveResearchSchema,
  completesAt: IsoDateTimeSchema,
  resources: ResourcesSchema,
});
export type StartResearchResponse = z.infer<typeof StartResearchResponseSchema>;
// --- assignees (GDD §G) ---

/** One officer on the §G screen: who stands under them, and what §G7 pays for it. */
export const AssigneeOfficerSchema = z.object({
  officerId: IdSchema,
  name: z.string(),
  role: OfficerRoleSchema,
  assignees: z.number().int().nonnegative(),
  /** §G7 — the bonus this many assignees give, applied to both time and power. */
  bonusPercent: z.number().nonnegative(),
  /** What one more would pay, or null when this officer is at the §G3 cap. */
  nextBonusPercent: z.number().nonnegative().nullable(),
  /**
   * Who this person actually is (§B6, §B7, §H6).
   *
   * The crew screen used to be a list of names with a pip counter beside each, which is a
   * spreadsheet of a roster rather than a roster: the whole reason a player agonised over hiring
   * somebody at the Bar is on their sheet, and the screen where that person lives never showed it.
   * Carried on the same payload rather than fetched per officer — it is one small object and the
   * alternative is nineteen round trips to open nineteen cards.
   */
  attributes: AttributesSchema,
  traits: TraitsSchema,
  /** §H5 — how much they still agree with the crew, and what that reads as. */
  alignment: z.number(),
  alignmentBand: z.enum(ALIGNMENT_BANDS),
  /** §H6 — their own level, which is not the player's. */
  level: z.number().int().positive(),
});
export type AssigneeOfficer = z.infer<typeof AssigneeOfficerSchema>;

/**
 * The whole assignee layer in one call (GDD §G).
 *
 * Every number here is derived server-side from `Base.level` and the stored placement map — the
 * client renders them and never recomputes them, so the §G8 pool formula and the §G7 table have
 * exactly one home.
 */
export const AssigneesResponseSchema = z.object({
  /** `Base.level` (INTERFACES R1) — echoed so the page can explain where the cap came from. */
  level: z.number().int().min(1),
  /** §G8 — the whole pool at this level. */
  pool: z.number().int().nonnegative(),
  placed: z.number().int().nonnegative(),
  /** §G2 — what a level-up handed over that the player has not placed yet. */
  unplaced: z.number().int().nonnegative(),
  /** §G3/§G3a, capped at the §G7 table's twelve rows. */
  capPerOfficer: z.number().int().min(1).max(MAX_ASSIGNEES_PER_OFFICER),
  /** The best §G7 bonus reachable at this level — not always 50%, because the cap bites first. */
  maxBonusPercent: z.number().nonnegative(),
  /** §C4/§G4 — whether a Professor is on the books to run reskilling. */
  canReskill: z.boolean(),
  /**
   * §A1 — the Quarters' ceiling and what is standing under it, officers included.
   *
   * Reported rather than derived client-side because the same two numbers gate hiring at the Bar,
   * and a screen that computed its own would be the second place the rule lives.
   */
  housing: z.object({
    used: z.number().int().nonnegative(),
    capacity: z.number().int().nonnegative(),
  }),
  officers: z.array(AssigneeOfficerSchema),
});
export type AssigneesResponse = z.infer<typeof AssigneesResponseSchema>;

/** §G2 — place some of the unplaced pool under one officer. Placement only ever adds. */
export const PlaceAssigneesRequestSchema = z.object({
  officerId: IdSchema,
  count: z.number().int().min(1).max(MAX_ASSIGNEES_PER_OFFICER),
});
export type PlaceAssigneesRequest = z.infer<typeof PlaceAssigneesRequestSchema>;

/**
 * §G4 — reskilling reassigns *every* assignee at once, so the request is the whole new map rather
 * than a move. An officer left out of it ends with nobody.
 */
export const ReskillRequestSchema = z.object({
  placements: z.record(IdSchema, z.number().int().nonnegative()),
});
export type ReskillRequest = z.infer<typeof ReskillRequestSchema>;

/** Both writes answer with the same refreshed screen, so the client never re-derives state. */
export const AssigneesMutationResponseSchema = z.object({
  assignees: AssigneesResponseSchema,
});
export type AssigneesMutationResponse = z.infer<typeof AssigneesMutationResponseSchema>;

// --- training (§F2) ---

/**
 * One person the Training tab can put through an hour.
 *
 * The Overseer and the officers are the same shape here on purpose: the tab treats them
 * identically, and a screen that branched on which kind of person it was drawing would have two
 * of every control. `role` is already written for a player — "Overseer", or the officer's title —
 * so nothing on the client maps an enum to a word a second time.
 */
export const TrainingSubjectSchema = z.object({
  /** `OVERSEER_SUBJECT`, or the officer's id. */
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  /** The Overseer has a portrait; officers do not have one yet. */
  portraitId: z.string().nullable(),
  attributes: AttributesSchema,
  traits: TraitsSchema,
  /** What they are doing right now, if anything. */
  session: TrainingSessionSchema.nullable(),
  /** What they did last, which is the one thing they may not do next. */
  lastAttribute: AttributeNameSchema.nullable(),
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
 * nothing about role requirements (§B8a) — the hidden table is a different thing entirely.
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
  /** §Market — the Runner's hours today, whether he is in, and when he next is. */
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
});
export type MarketResponse = z.infer<typeof MarketResponseSchema>;

/** The supply run: caps out, one material in, inside the day's ration. */
export const BuySupplyRequestSchema = z.object({
  key: z.enum(['food', 'oil', 'scrap', 'highQualityMetal']),
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
export type MarketMutationResponse = z.infer<typeof MarketMutationResponseSchema>;

/** The workshop screen: what is fitted, what could be, and why not. */
export const WorkshopUpgradeSchema = z.object({
  id: z.string(),
  line: UpgradeLineSchema,
  tier: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  cost: PartialResourcesSchema,
  parts: InventorySchema,
  effect: z.record(z.string(), z.number()),
  fitted: z.boolean(),
  /** Player-facing reason it cannot be fitted, or null. */
  blocker: z.string().nullable(),
});
export type WorkshopUpgrade = z.infer<typeof WorkshopUpgradeSchema>;

export const WorkshopVehicleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  cost: PartialResourcesSchema,
  parts: InventorySchema,
  owned: z.number().int().nonnegative(),
  travelSpeedPercent: z.number(),
  blocker: z.string().nullable(),
});
export type WorkshopVehicle = z.infer<typeof WorkshopVehicleSchema>;

export const WorkshopResponseSchema = z.object({
  resources: ResourcesSchema,
  inventory: InventorySchema,
  upgrades: z.array(WorkshopUpgradeSchema),
  vehicles: z.array(WorkshopVehicleSchema),
  /** What the fleet is currently taking off the road. */
  fleetTravelSpeedPercent: z.number(),
});
export type WorkshopResponse = z.infer<typeof WorkshopResponseSchema>;

export const FitUpgradeRequestSchema = z.object({ upgradeId: z.string().min(1) });
export type FitUpgradeRequest = z.infer<typeof FitUpgradeRequestSchema>;

export const BuildVehicleRequestSchema = z.object({ vehicleId: z.string().min(1) });
export type BuildVehicleRequest = z.infer<typeof BuildVehicleRequestSchema>;

export const WorkshopMutationResponseSchema = z.object({ workshop: WorkshopResponseSchema });
export type WorkshopMutationResponse = z.infer<typeof WorkshopMutationResponseSchema>;

/** §E — turn a crew around. They walk back the way they came and arrive with nothing. */
export const RecallMissionRequestSchema = z.object({ missionId: IdSchema });
export type RecallMissionRequest = z.infer<typeof RecallMissionRequestSchema>;

/** §C2 — move an officer into a different position. The Overseer is not a position. */
export const ReassignOfficerRequestSchema = z.object({
  officerId: IdSchema,
  role: OfficerRoleSchema,
});
export type ReassignOfficerRequest = z.infer<typeof ReassignOfficerRequestSchema>;
