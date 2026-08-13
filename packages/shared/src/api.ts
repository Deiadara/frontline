import { z } from 'zod';
import { ATTRIBUTE_NAMES, AttributesSchema } from './attributes.js';
import {
  ALIGNMENT_BANDS,
  AmbitionSchema,
  JOIN_BLOCKERS,
  JoinRequirementSchema,
  MoralCompassSchema,
  STANCE_MAX,
  STANCE_MIN,
} from './bar/index.js';
import { BaseSchema, BaseSummarySchema } from './base.js';
import { BattleResultSchema } from './battle/types.js';
import { DistrictSchema } from './city.js';
import { CommanderSchema } from './commander.js';
import { ReputationLabelSchema } from './economy/reputation.js';
import { MissionSchema } from './missions.js';
import { OverseerSchema } from './overseer.js';
import { IdSchema, IsoDateTimeSchema, UsernameSchema } from './primitives.js';
import {
  ActiveResearchSchema,
  DiscoveredFactSchema,
  ResearchProjectSchema,
} from './research/index.js';
import { ResourcesSchema } from './resources.js';
import { OfficerRoleSchema } from './roles.js';
import { TraitsSchema } from './traits.js';
import { UserSchema } from './user.js';

/**
 * API DTOs — the single source of truth for the REST contract in docs/SPEC-server.md.
 * The server validates request bodies with these schemas; the client parses responses with them.
 */

/** Every non-2xx response uses this envelope. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
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

// --- city map ---
export const CityResponseSchema = z.object({
  districts: z.array(DistrictSchema),
  bases: z.array(BaseSummarySchema),
});
export type CityResponse = z.infer<typeof CityResponseSchema>;

// --- base detail ---
export const BaseDetailResponseSchema = z.object({
  base: BaseSchema,
});
export type BaseDetailResponse = z.infer<typeof BaseDetailResponseSchema>;

// --- battle ---
export const BattleRequestSchema = z.object({
  targetDistrictId: IdSchema,
});
export type BattleRequest = z.infer<typeof BattleRequestSchema>;

export const BattleResponseSchema = z.object({
  result: BattleResultSchema,
  /** Attacker base resources AFTER rewards were applied. */
  resources: ResourcesSchema,
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
});
export type MissionsResponse = z.infer<typeof MissionsResponseSchema>;

export const LaunchMissionRequestSchema = z.object({
  templateId: IdSchema,
});
export type LaunchMissionRequest = z.infer<typeof LaunchMissionRequestSchema>;

export const LaunchMissionResponseSchema = z.object({
  mission: MissionSchema,
  serverNow: IsoDateTimeSchema,
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
  bonusAttributes: z.array(z.string()),
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
});
export type BarResponse = z.infer<typeof BarResponseSchema>;

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
 * The research screen in one call.
 *
 * Note what is *not* here: no fit score, no weight, no ordering, nothing keyed by role id. Every
 * scrap of role knowledge in this body is a `DiscoveredFact` the crew paid for (§B9, INTERFACES
 * R4), and `apps/server/src/research/discovery.leak.test.ts` asserts it over the real response.
 */
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
  caps: z.number(),
  costs: z.object({
    investigation: z.number().int().nonnegative(),
    training: z.number().int().nonnegative(),
  }),
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
