import { z } from 'zod';

/** Opaque entity id (uuid or similar) — always a non-empty string. */
export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

/** ISO-8601 datetime string (UTC), e.g. `2026-08-12T10:00:00.000Z`. */
export const IsoDateTimeSchema = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** 3-24 chars, alphanumeric + underscore. */
export const UsernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, digits and underscores');
export type Username = z.infer<typeof UsernameSchema>;
