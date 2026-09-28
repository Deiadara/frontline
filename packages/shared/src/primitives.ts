import { z } from 'zod';

/** Opaque entity id (uuid or similar): always a non-empty string. */
/**
 * Any id the server stores or looks up. Capped because a client can send one: an uncapped string
 * is a megabyte of body walked by every `Map.get` and echoed back in refusals. The longest real id
 * (`enforcer:<uuid>`, a Bar seat) is under sixty characters.
 */
export const ID_MAX = 128;

/**
 * A quantity a client names: a bid, a trade, a purchase. Every one is checked against what the crew
 * holds before anything is paid, so the cap is not the rule; it keeps a crafted 9e15 from reaching
 * arithmetic at all, and it is far past anything the economy produces.
 */
export const REQUEST_AMOUNT_MAX = 1_000_000_000_000;
export const RequestAmountSchema = z.number().int().positive().max(REQUEST_AMOUNT_MAX);
export const IdSchema = z.string().min(1).max(ID_MAX);
export type Id = z.infer<typeof IdSchema>;

/** ISO-8601 datetime string (UTC), e.g. `2026-08-12T10:00:00.000Z`. */
export const IsoDateTimeSchema = z.iso.datetime();

/** 3-24 chars, alphanumeric + underscore. */
export const UsernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, digits and underscores');
export type Username = z.infer<typeof UsernameSchema>;
