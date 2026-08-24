import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, UsernameSchema } from './primitives.js';
import { GAME_TIMEZONE } from './time/zone.js';

/**
 * The glyphs a player may wear.
 *
 * Drawn from the icon set the interface already has rather than from a new sheet of portraits: the
 * point of an avatar here is to be recognisable at 24px next to a name in a market listing, and a
 * hard-edged symbol does that better than a face does. Ids, not files, so the board can replace
 * what each one draws without a migration.
 */
export const PLAYER_ICONS = [
  'shield',
  'sword',
  'eye',
  'spark',
  'flask',
  'gear',
  'city',
  'units',
  'crew',
  'market',
  'research',
  'infamy',
] as const;
export const PlayerIconSchema = z.enum(PLAYER_ICONS);
export type PlayerIcon = z.infer<typeof PlayerIconSchema>;

export const DEFAULT_PLAYER_ICON: PlayerIcon = 'shield';

/**
 * Client-facing user. The password hash is deliberately NOT part of this type:
 * it lives in a server-only type (see apps/server/src/types.ts).
 *
 * The three settings fields are **defaulted rather than required**, for the reason `Base.training`
 * and `Base.inventory` are: accounts existed before Settings did, and a schema that refused to
 * parse a row written last week would take those players offline instead of showing them a shield
 * and the house clock.
 */
export const UserSchema = z.object({
  id: IdSchema,
  username: UsernameSchema,
  overseerId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  /**
   * What other players see. Separate from `username` on purpose: the username is the credential
   * and has to stay unique and typeable, and a display name is neither.
   */
  displayName: z.string().trim().min(1).max(32).nullable().default(null),
  icon: PlayerIconSchema.default(DEFAULT_PLAYER_ICON),
  /** The IANA zone every clock is drawn in for this player. Athens unless they say otherwise. */
  timezone: z.string().min(1).default(GAME_TIMEZONE),
});
export type User = z.infer<typeof UserSchema>;

/** The name to put on screen: what they chose to be called, or the one they log in with. */
export function displayNameOf(user: Pick<User, 'username' | 'displayName'>): string {
  return user.displayName ?? user.username;
}
