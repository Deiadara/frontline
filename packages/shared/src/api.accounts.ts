import { z } from 'zod';
import { DEFAULT_CITY_ID } from './city/cities.js';
import { MAX_NOTORIETY } from './economy/notoriety.js';
import { BlueprintCategorySchema } from './blueprints/catalog.js';
import { BuildingKindSchema } from './building/index.js';
import { OfficerRoleSchema } from './roles.js';
import { AutomationOrderSchema, AutomationSchema } from './automations/automations.js';
import { ResourceKeySchema } from './resources.js';
import {
  BlackMarketLotSchema,
  BlackMarketSlotSchema,
  BoostStashSchema,
} from './market/blackmarket.js';
import { IdSchema, IsoDateTimeSchema, UsernameSchema } from './primitives.js';
import { PLAYER_LEVEL_UNLOCKS } from './progression/unlocks.js';
import { PartialResourcesSchema } from './resources.js';
import { TimezoneSchema } from './time/zone.js';
import { PlayerIconSchema, SoundVolumeSchema, UserSchema } from './user.js';

/**
 * The account half of the REST contract: who you are, what you have set, what the back room is
 * selling, and the knobs the testing build exposes.
 *
 * A second DTO module rather than more of `api.ts`. That file is the game's contract: districts,
 * battles, missions, and these are the screens *around* the game: settings, the admin bench and
 * the black market's shelf. Keeping them apart means a change to how a password is set cannot
 * touch the file every gameplay route parses its body with.
 */

// --- settings (the player's own record) ---

/**
 * What a player may change about themselves.
 *
 * Every field is optional and the request is refused if all of them are absent, so a form that
 * only changes the icon does not have to resend the username, and a client that sends an empty
 * body gets told it did nothing rather than silently succeeding.
 */
export const UpdateProfileRequestSchema = z
  .object({
    username: UsernameSchema.optional(),
    /**
     * `null` is a real value here, and it is the only way to take a display name off.
     *
     * `undefined` means "leave it" (`db/repos/users.ts` loops with `if (value === undefined)
     * continue`), so a client that cleared the box and omitted the field got the old name written
     * straight back into it on the next `/me`. `.nullable()` gives that instruction somewhere to
     * live on the wire; the repo already understood it.
     */
    displayName: z.string().trim().min(1).max(32).nullable().optional(),
    /**
     * The account's mark.
     *
     * Nothing draws one since 2026-09-22 (maintainer: the mark glyph goes everywhere) and no
     * screen offers it, so nothing sends this today. Left on the write path rather than deleted
     * with the pickers: the column is still on the account, and a route that quietly refused a
     * field the record has is a worse shape than one nobody calls.
     */
    icon: PlayerIconSchema.optional(),
    timezone: TimezoneSchema.optional(),
    /** How loud the interface is, 0 to 100. See {@link SoundVolumeSchema}. */
    soundVolume: SoundVolumeSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

/**
 * Marking opening tutorial cards as shown (`tutorial/steps.ts`).
 *
 * A list rather than one id, because Skip is this call with every step in it: one route and one
 * write for both gestures, instead of a `seen` endpoint and a `skip` endpoint that have to agree
 * about what skipping means. The server unions what arrives with what it holds, so the call is
 * idempotent and two tabs cannot erase each other's progress.
 *
 * Unknown ids are accepted rather than refused. They cost a few bytes in a JSON column and the
 * alternative is a client one version ahead of the server being unable to record anything at all.
 */
export const TutorialSeenRequestSchema = z.object({
  steps: z.array(z.string().min(1).max(64)).min(1).max(64),
});
export type TutorialSeenRequest = z.infer<typeof TutorialSeenRequestSchema>;

/**
 * The Right Hand's standing orders, as a screen reads and writes them (§C2b).
 *
 * The whole slot goes over the wire, not a patch: the screen holds a form and posts what the form
 * says, and a partial write would need a merge rule on both sides that nobody can see. What the
 * crew's research allows is answered by the server, so a client one version ahead cannot talk its
 * way into a rung it has not earned.
 */
export const AutomationsResponseSchema = z.object({
  /** What the ladder currently allows. Everything the screen draws is gated on this. */
  powers: z.object({
    unlocked: z.boolean(),
    slots: z.number().int().nonnegative(),
    cooldownMs: z.number().int().nonnegative(),
    bestFit: z.boolean(),
    optimise: z.boolean(),
    orders: z.array(AutomationOrderSchema),
  }),
  slots: z.array(AutomationSchema),
  /** Officers who could be named as a leader: on the books, not out, not hurt. */
  officers: z.array(z.object({ id: IdSchema, name: z.string(), role: z.string().nullable() })),
  serverNow: IsoDateTimeSchema,
});
export type AutomationsResponse = z.infer<typeof AutomationsResponseSchema>;

export const SaveAutomationRequestSchema = z.object({
  slot: z.number().int().min(0).max(1),
  enabled: z.boolean(),
  order: AutomationOrderSchema,
  force: z.record(z.string(), z.number().int().positive()).default({}),
  officerId: IdSchema.nullable().default(null),
  unitSlots: z.number().int().positive().nullable().default(null),
  optimiseFor: ResourceKeySchema.nullable().default(null),
});
export type SaveAutomationRequest = z.infer<typeof SaveAutomationRequestSchema>;

/**
 * Changing a password needs the old one, always.
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
  /** The server's own instant, so the settings clock agrees with every other clock in the game. */
  serverNow: IsoDateTimeSchema,
  /** The house clock, so the picker can mark it. */
  gameTimezone: z.string().min(1),
});
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

// --- the black market ---

export const BlackMarketOfferSchema = z.object({
  slot: BlackMarketSlotSchema,
  /** Whether this crew could bid on it right now: rank, price and purse all considered. */
  affordable: z.boolean(),
  /**
   * What it opens at *here*, in infamy: the catalogue price weighted by the city's average level.
   *
   * On the response rather than derived on the screen, because the same weighting decides where the
   * lot's reserve sits. A client that multiplied the catalogue figure itself would be a second copy
   * of the rule, and the day the two disagreed a player would be quoted one floor and refused at
   * another.
   */
  price: z.number().int().positive(),
  /** The rank the fence wants, so a card can say why rather than just refusing. */
  minNotoriety: z.number().int().nonnegative(),
  /** What it does *here*, in the player's own words, with this city's figures already in it. */
  effect: z.string().min(1),
  /**
   * The slot's lot: every bid on it, who is in front and when the fence settles.
   *
   * Nullable for the one state that has no lot in it: a slot holding an id this build's catalogue
   * has never heard of, which the shelf draws as a dead card rather than throwing.
   */
  lot: BlackMarketLotSchema.nullable(),
});
export type BlackMarketOffer = z.infer<typeof BlackMarketOfferSchema>;

export const BlackMarketResponseSchema = z.object({
  /** The Athens calendar day this shelf belongs to. */
  day: z.string().min(1),
  offers: z.array(BlackMarketOfferSchema),
  /** What the crew has to spend. */
  infamy: z.number().int().nonnegative(),
  /** How many lots this crew has won at today's close, and how many it may win. */
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
  /**
   * Whose back room this is, and every room this crew may walk into (maintainer, 2026-09-17).
   *
   * The same pair the barrow and the Bar carry, for the same rule: hold one location in a city and
   * its rooms open to you (`city/access.ts`). The fence was the last of the three to get a door
   * rather than a label, because its lots are keyed by the day and the slot and had to be keyed by
   * the room as well before the picker could change anything but the word over the crates.
   *
   * `cities` is sent rather than worked out on the client, which cannot see who holds what.
   */
  cityId: z.string().min(1).default(DEFAULT_CITY_ID),
  cities: z.array(z.string().min(1)).default([]),
  serverNow: IsoDateTimeSchema,
});
export type BlackMarketResponse = z.infer<typeof BlackMarketResponseSchema>;

/*
 * Bidding on a slot is `PlaceBlackMarketBidRequestSchema`, in `market/blackmarket.ts` beside the
 * rules that judge it. `TakeBlackMarketRequestSchema` lived here until 2026-09-17, when the shelf
 * stopped being something a crew could take off and became five lots that settle at midnight.
 */

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

/**
 * How high the level knob goes: the deepest level the game authors content at.
 *
 * Derived rather than written down. The bound used to be a hand-typed 60, and the §I3 ladder had
 * already grown two rungs past it: Deep Pockets at 70 (which `market/supply.ts` spends) and A
 * Third Crew at 80 (which `missions.areas.ts` spends). Both are reachable by play and neither was
 * reachable from the bench, so the one tool for setting a stage could not set the last two stages.
 * Reading the catalogue means the next rung cannot fall off the end the same way.
 */
export const ADMIN_MAX_PLAYER_LEVEL = PLAYER_LEVEL_UNLOCKS.reduce(
  (deepest, unlock) => Math.max(deepest, unlock.level),
  1,
);

export const AdminKnobsRequestSchema = z
  .object({
    /** Put every structure at this level, or one named structure if `structure` is given. */
    buildingLevel: z.number().int().min(0).max(20).optional(),
    structure: BuildingKindSchema.optional(),
    /** The player level (§I), which is what most of the game's gates read. */
    playerLevel: z.number().int().min(1).max(ADMIN_MAX_PLAYER_LEVEL).optional(),
    /** Set the stockpile. Absent keys are left alone. */
    resources: PartialResourcesSchema.optional(),
    /** Set the infamy balance, which is what the black market spends. */
    infamy: z.number().int().min(0).optional(),
    /**
     * Set the rank (§D7), which is a different number from the wallet above it.
     *
     * On the bench because it is now a *stage*: since the ladder pays combat bonuses per rung and
     * gates the good drawings, the top two modification bands and the fence's best stock, a crew
     * at rank 0 and a crew at rank 8 are two different points in the game. Setting infamy alone
     * could not reach either of them, because a rank is bought and kept rather than held.
     *
     * Bounded by hand rather than through `NotorietySchema`, which carries `.default(0)`: optional
     * or not, a defaulted field parses an **absent** key into a present zero, so every knobs call
     * that did not mention a rank would have quietly reset one. `admin.test.ts` caught it on the
     * one assertion that sends an empty payload and expects a refusal.
     */
    notoriety: z.number().int().min(0).max(MAX_NOTORIETY).optional(),
    /** Empty every queue: build, training, research. For getting back to a clean bench. */
    clearQueues: z.boolean().optional(),
    /**
     * Seat this many officers, one per role, at the given rating.
     *
     * The Bar is the only door to an officer and its auctions settle at midnight, so a server on
     * its first day has nobody who can scout, lead a fight or sit a chair: every system that reads
     * the crew's sheet is unreachable until a day has passed. That makes a whole half of the game
     * untestable on a fresh world, which is exactly what the bench is for.
     *
     * Rated rather than rolled, so a test that measures what an officer is worth gets a number it
     * chose rather than a draw.
     */
    officers: z
      .object({ count: z.number().int().min(0).max(19), rating: z.number().int().min(1).max(100) })
      .optional(),
    /**
     * Clear the rest on every standing order, so the next party may leave on the next tick.
     *
     * The gap between automated parties is the one clock admin mode does not flatten (maintainer,
     * 2026-09-23), which is right for a player and slow for a bench: a test that wants to watch a
     * second party go would otherwise wait fifteen real minutes for it. This is the Console's
     * way round that, and nothing else touches `restingSince` from outside the world clock.
     */
    automationsRested: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to set');
export type AdminKnobsRequest = z.infer<typeof AdminKnobsRequestSchema>;

/**
 * The Console's grants (maintainer request, 2026-09-11): the things a reviewer cannot knob into
 * existence and cannot reach honestly in an afternoon. Every Scrapyard bench now shows only what
 * the crew holds the drawings for, so testing the yard at mid and late game means holding mid
 * and late game documents; and a trap wants a Lab rung as well.
 *
 * Each field is optional and independent. `blueprints` puts the finished document (not its pages)
 * in the inventory, so the row unlocks at once; `pages` hands over one copy of every page in the
 * game, for the Blueprints and Reimagining screens; `parts` is that many of every component the
 * Runner carries, for refits; `technologies` marks every rung of one track, or of all of them,
 * as finished. Admin mode only, refused as NOT_FOUND otherwise, like every other console route.
 */
export const AdminGrantRequestSchema = z
  .object({
    /** Every finished document, or every document of one category, or the named ones. */
    blueprints: z
      .union([z.literal('all'), BlueprintCategorySchema, z.array(z.string())])
      .optional(),
    /** One copy of every page in the catalogue. */
    pages: z.literal('all').optional(),
    /** This many of every component good. */
    parts: z.number().int().min(1).max(999).optional(),
    /** Every rung on every track, or on one track. */
    technologies: z.union([z.literal('all'), OfficerRoleSchema]).optional(),
    /**
     * Every rung up to and including this step, on every track (maintainer request, 2026-09-14).
     *
     * A programme is ten rungs deep, and the presets want a crew standing part-way up all nineteen
     * of them rather than at the top of one. `technologies` cannot say that: it is all-or-one-track
     * by construction, so "seven of ten everywhere" had no spelling before this.
     *
     * Both may be sent; they union, and the deeper answer wins, because a grant is additive
     * everywhere else on this route and a rung already taken cannot be untaken.
     */
    researchDepth: z.number().int().min(1).max(10).optional(),
    /** This many of every trap the Scrapyard cuts, into the inventory. */
    consumables: z.number().int().min(1).max(99).optional(),
    /** This many of every battle boost the back room sells, onto the shelf. */
    boosts: z.number().int().min(1).max(99).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to grant');
export type AdminGrantRequest = z.infer<typeof AdminGrantRequestSchema>;

export const AdminSnapshotSchema = z.object({
  state: AdminStateSchema,
  baseId: IdSchema,
  playerLevel: z.number().int().positive(),
  infamy: z.number().int().nonnegative(),
  /** Every structure and the level it currently stands at, so the console can show what it is moving. */
  buildings: z.array(z.object({ kind: BuildingKindSchema, level: z.number().int().min(0) })),
  /**
   * The Console's fog of war: every district, and whether this crew can see into it right now.
   *
   * In admin mode everything is scouted unless the admin has un-ticked it, so `visible` is the
   * effective answer rather than what the crew's scouts have actually seen.
   */
  fog: z
    .array(
      z.object({
        districtId: IdSchema,
        name: z.string(),
        visible: z.boolean(),
        /** The crew's own district: listed, ticked, and not a knob. You live there. */
        home: z.boolean(),
      }),
    )
    .default([]),
  /** The last backups on disk, newest first: the recovery path, visible rather than documented. */
  backups: z.array(
    z.object({ file: z.string().min(1), takenAt: IsoDateTimeSchema, bytes: z.number().int() }),
  ),
});
export type AdminSnapshot = z.infer<typeof AdminSnapshotSchema>;

/** One district shown or hidden on the Console. */
export const AdminFogRequestSchema = z.object({
  districtId: IdSchema,
  visible: z.boolean(),
});
export type AdminFogRequest = z.infer<typeof AdminFogRequestSchema>;

export const AdminMutationResponseSchema = z.object({ admin: AdminSnapshotSchema });
export type AdminMutationResponse = z.infer<typeof AdminMutationResponseSchema>;
