import { z } from 'zod';
import { BaseSchema, BaseSummarySchema } from './base.js';
import { BattleResultSchema } from './battle/types.js';
import { DistrictSchema } from './city.js';
import { OverseerSchema } from './overseer.js';
import { IdSchema, UsernameSchema } from './primitives.js';
import { ResourcesSchema } from './resources.js';
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
