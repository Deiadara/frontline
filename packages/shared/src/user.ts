import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, UsernameSchema } from './primitives.js';

/**
 * Client-facing user. The password hash is deliberately NOT part of this type —
 * it lives in a server-only type (see apps/server/src/types.ts).
 */
export const UserSchema = z.object({
  id: IdSchema,
  username: UsernameSchema,
  overseerId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;
