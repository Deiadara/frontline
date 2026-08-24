import { z } from 'zod';
import { BuildingKindSchema } from './building/index.js';
import { BlackMarketSlotSchema, BoostStashSchema } from './market/blackmarket.js';
import { IdSchema, IsoDateTimeSchema, UsernameSchema } from './primitives.js';
import { PartialResourcesSchema } from './resources.js';
import { TimezoneSchema } from './time/zone.js';
import { PLAYER_ICONS, PlayerIconSchema, UserSchema } from './user.js';

/**
 * The account half of the REST contract: who you are, what you have set, what the back room is
 * selling, and the knobs the testing build exposes.
 *
 * A second DTO module rather than more of `api.ts`. That file is the game's contract — districts,
 * battles, missions — and these are the screens *around* the game: settings, the admin bench and
 * the black market's shelf. Keeping them apart means a change to how a password is set cannot
 * touch the file every gameplay route parses its body with.
 */

// --- settings (the player's own record) ---

/**
 * What a player may change about themselves.
 *
 * Every field is optional and the request is refused if all of them are absent, so a form that
 * only changes the icon does not have to resend the username — and a client that sends an empty
 * body gets told it did nothing rather than silently succeeding.
 */
export const UpdateProfileRequestSchema = z
  .object({
    username: UsernameSchema.optional(),
    displayName: z.string().trim().min(1).max(32).optional(),
    icon: PlayerIconSchema.optional(),
    timezone: TimezoneSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

/**
 * Changing a passphrase needs the old one, always.
 *
 * The session token proves the browser had the password *once*. It does not prove the person at
 * the keyboard is the one who typed it, and a token lifted off a shared machine should not be
 * enough to lock the owner out of their own account.
 */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const SettingsResponseSchema = z.object({
  user: UserSchema,
  /** Offered in the picker. Sent rather than hardcoded client-side so one list governs both ends. */
  icons: z.array(PlayerIconSchema),
  /** The server's own instant, so the settings clock agrees with every other clock in the game. */
  serverNow: IsoDateTimeSchema,
  /** The house clock, so the picker can mark it. */
  gameTimezone: z.string().min(1),
});
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

export { PLAYER_ICONS };

// --- the black market ---

export const BlackMarketOfferSchema = z.object({
  slot: BlackMarketSlotSchema,
  /** Whether this crew could take it right now, price and daily limit both considered. */
  affordable: z.boolean(),
  /**
   * What it costs *here*, in infamy — the catalogue price weighted by the city's average level.
   *
   * On the response rather than derived on the screen, because the same weighting decides what the
   * server charges. A client that multiplied the catalogue figure itself would be a second copy of
   * the rule, and the day the two disagreed a player would be quoted one number and billed another.
   */
  price: z.number().int().positive(),
  /** What it does *here*, in the player's own words, with this city's figures already in it. */
  effect: z.string().min(1),
});
export type BlackMarketOffer = z.infer<typeof BlackMarketOfferSchema>;

export const BlackMarketResponseSchema = z.object({
  /** The Athens calendar day this shelf belongs to. */
  day: z.string().min(1),
  offers: z.array(BlackMarketOfferSchema),
  /** What the crew has to spend. */
  infamy: z.number().int().nonnegative(),
  /** How many things this crew has taken today, and the ceiling. */
  takenToday: z.number().int().nonnegative(),
  takesPerDay: z.number().int().positive(),
  /** Boosts bought and not yet spent on a fight. */
  stash: BoostStashSchema,
  /** When the shelf turns over, as an instant. The client counts down to it in the player's zone. */
  refreshesAt: IsoDateTimeSchema,
  /**
   * The city's average player level, which is what the prices and the potency are weighted by.
   *
   * Quoted so the screen can *say so*. A shelf whose prices move for reasons a player cannot see is
   * a shelf they will assume is broken.
   */
  cityLevel: z.number().positive(),
  serverNow: IsoDateTimeSchema,
});
export type BlackMarketResponse = z.infer<typeof BlackMarketResponseSchema>;

/**
 * Taking something names the slot *and* what was believed to be in it.
 *
 * The shelf is shared, so between a player's read and their click somebody else in the city may
 * have emptied that slot and had it refilled with something else. Naming both lets the server
 * refuse the mismatch instead of charging infamy for a thing nobody asked for.
 */
export const TakeBlackMarketRequestSchema = z.object({
  slotIndex: z.number().int().min(0),
  goodId: z.string().min(1),
});
export type TakeBlackMarketRequest = z.infer<typeof TakeBlackMarketRequestSchema>;

export const BlackMarketMutationResponseSchema = z.object({
  blackMarket: BlackMarketResponseSchema,
});
export type BlackMarketMutationResponse = z.infer<typeof BlackMarketMutationResponseSchema>;

// --- admin / testing mode ---

/**
 * What the testing build is doing, as the client sees it.
 *
 * `enabled` is the whole gate: the admin bench is not rendered without it, and neither is the badge
 * that tells a player why everything is free. `actionSeconds` is sent rather than assumed because
 * the countdown a screen draws has to be the one the server actually applied.
 */
export const AdminStateSchema = z.object({
  enabled: z.boolean(),
  /** What every clock in the game is flattened to while admin mode is on. */
  actionSeconds: z.number().int().positive(),
  /** Whether a click actually costs the resources the UI shows. */
  chargesResources: z.boolean(),
});
export type AdminState = z.infer<typeof AdminStateSchema>;

export const AdminKnobsRequestSchema = z
  .object({
    /** Put every structure at this level, or one named structure if `structure` is given. */
    buildingLevel: z.number().int().min(0).max(20).optional(),
    structure: BuildingKindSchema.optional(),
    /** The player level (§I), which is what most of the game's gates read. */
    playerLevel: z.number().int().min(1).max(60).optional(),
    /** Set the stockpile. Absent keys are left alone. */
    resources: PartialResourcesSchema.optional(),
    /** Set the infamy balance, which is what the black market spends. */
    infamy: z.number().int().min(0).optional(),
    /** Empty every queue: build, training, research. For getting back to a clean bench. */
    clearQueues: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to set');
export type AdminKnobsRequest = z.infer<typeof AdminKnobsRequestSchema>;

export const AdminSnapshotSchema = z.object({
  state: AdminStateSchema,
  baseId: IdSchema,
  playerLevel: z.number().int().positive(),
  infamy: z.number().int().nonnegative(),
  /** Every structure and the level it currently stands at, so the bench can show what it is moving. */
  buildings: z.array(z.object({ kind: BuildingKindSchema, level: z.number().int().min(0) })),
  /** The last backups on disk, newest first — the recovery path, visible rather than documented. */
  backups: z.array(
    z.object({ file: z.string().min(1), takenAt: IsoDateTimeSchema, bytes: z.number().int() }),
  ),
});
export type AdminSnapshot = z.infer<typeof AdminSnapshotSchema>;

export const AdminMutationResponseSchema = z.object({ admin: AdminSnapshotSchema });
export type AdminMutationResponse = z.infer<typeof AdminMutationResponseSchema>;
