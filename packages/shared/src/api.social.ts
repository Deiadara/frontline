import { z } from 'zod';
import { ArmySchema } from './units/training.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import {
  FactionBlurbSchema,
  FactionInviteSchema,
  FactionMemberSchema,
  FactionNameSchema,
  FactionRankSchema,
  FactionSchema,
} from './factions/factions.js';
import { BadgeSchema } from './factions/badge.js';
import {
  MessageBodySchema,
  MessageSchema,
  MessageSubjectSchema,
  SentMessageSchema,
} from './social/messages.js';
import { NotificationSchema, NotificationSettingsSchema } from './social/notifications.js';

/**
 * What the faction screen, the mailbox and the bell put on the wire (GDD, board request).
 *
 * Kept apart from `api.ts` for the reason `api.battle.ts` is: these three are one feature area with
 * a dozen DTOs between them, and a single file with every response in the game in it is a file
 * nobody can find anything in.
 */

// --- factions ---

/**
 * One ally's battle, as the faction screen shows it.
 *
 * Carries enough to decide whether to help without opening anything: who called it, what it is
 * against, when the mark is, and what is already standing on their side. `canReinforce` is computed
 * server-side because the rule ("their fight, not yet resolved, mark not passed") is the server's
 * and a client that re-derived it would be a second copy free to drift.
 */
export const AllyBattleSchema = z.object({
  battleId: IdSchema,
  /** Whose fight it is. */
  memberUserId: IdSchema,
  memberName: z.string().min(1),
  districtName: z.string().min(1),
  targetName: z.string().min(1),
  districtLabel: z.string().min(1),
  scheduledFor: IsoDateTimeSchema,
  /** `attacker` when the ally called it, `defender` when they are being come for. */
  side: z.enum(['attacker', 'defender']),
  /** Bodies already committed on the ally's side, allies of theirs included. */
  committed: z.number().int().nonnegative(),
  /** What this player has already put in, so the screen can say "you sent 12" rather than nothing. */
  yourContribution: z.number().int().nonnegative(),
  canReinforce: z.boolean(),
});
export type AllyBattle = z.infer<typeof AllyBattleSchema>;

/** What one member can field, for the "who could help me" question the screen exists to answer. */
export const AllyArmySchema = z.object({
  memberUserId: IdSchema,
  memberName: z.string().min(1),
  army: ArmySchema,
  /** Bodies, so a row can be read without adding the record up. */
  size: z.number().int().nonnegative(),
});
export type AllyArmy = z.infer<typeof AllyArmySchema>;

export const FactionResponseSchema = z.object({
  /** Null when this player is in no faction: the screen then offers founding one. */
  faction: FactionSchema.nullable(),
  members: z.array(FactionMemberSchema),
  /** This player's own rank, so the screen knows which controls to draw. Null with no faction. */
  rank: FactionRankSchema.nullable(),
  /** Open invitations *to this player*, which are the only way in. */
  invites: z.array(FactionInviteSchema),
  /** Invitations this faction has sent and nobody has answered yet. */
  pending: z.array(FactionInviteSchema),
  battles: z.array(AllyBattleSchema),
  armies: z.array(AllyArmySchema),
  serverNow: IsoDateTimeSchema,
});
export type FactionResponse = z.infer<typeof FactionResponseSchema>;

export const CreateFactionRequestSchema = z.object({
  name: FactionNameSchema,
  badge: BadgeSchema,
  blurb: FactionBlurbSchema.default(''),
});
export type CreateFactionRequest = z.infer<typeof CreateFactionRequestSchema>;

/**
 * Two edit routes, not one, because they are two different permissions.
 *
 * The name and the badge are the faction's identity and only the leader touches them; the
 * description is the recruiting pitch and a chief keeps it current. A single route taking all
 * three would have to check a permission per field and would send the two the caller is not
 * allowed to change on every save of the one they are.
 */
export const EditFactionIdentityRequestSchema = z.object({
  name: FactionNameSchema,
  badge: BadgeSchema,
});
export type EditFactionIdentityRequest = z.infer<typeof EditFactionIdentityRequestSchema>;

export const EditFactionDescriptionRequestSchema = z.object({ blurb: FactionBlurbSchema });
export type EditFactionDescriptionRequest = z.infer<typeof EditFactionDescriptionRequestSchema>;

export const InviteToFactionRequestSchema = z.object({ username: z.string().trim().min(1) });
export type InviteToFactionRequest = z.infer<typeof InviteToFactionRequestSchema>;

export const AnswerInviteRequestSchema = z.object({
  inviteId: IdSchema,
  accept: z.boolean(),
});
export type AnswerInviteRequest = z.infer<typeof AnswerInviteRequestSchema>;

export const FactionMemberActionRequestSchema = z.object({
  userId: IdSchema,
  /** `kick` removes them; `promote`/`demote` move somebody in and out of chief; `hand_over`
   *  makes them the leader and steps the caller down to chief. */
  action: z.enum(['kick', 'promote', 'demote', 'hand_over']),
});
export type FactionMemberActionRequest = z.infer<typeof FactionMemberActionRequestSchema>;

/** Sending units to an ally's fight: the same shape as a deployment, against somebody else's battle. */
export const ReinforceRequestSchema = z.object({
  battleId: IdSchema,
  army: ArmySchema,
});
export type ReinforceRequest = z.infer<typeof ReinforceRequestSchema>;

/** Every faction write answers with the refreshed screen, so nothing is re-derived on the client. */
export const FactionMutationResponseSchema = z.object({ faction: FactionResponseSchema });
export type FactionMutationResponse = z.infer<typeof FactionMutationResponseSchema>;

// --- messages ---

export const MessagesResponseSchema = z.object({
  inbox: z.array(MessageSchema),
  sent: z.array(SentMessageSchema),
  unread: z.number().int().nonnegative(),
  /** Whether this player has a faction to write to, so the compose form knows what to offer. */
  hasFaction: z.boolean(),
  serverNow: IsoDateTimeSchema,
});
export type MessagesResponse = z.infer<typeof MessagesResponseSchema>;

export const SendMessageRequestSchema = z.object({
  /** A username, or null to write to the whole faction. */
  toUsername: z.string().trim().min(1).nullable(),
  subject: MessageSubjectSchema,
  body: MessageBodySchema,
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const MessageMutationResponseSchema = z.object({ messages: MessagesResponseSchema });
export type MessageMutationResponse = z.infer<typeof MessageMutationResponseSchema>;

// --- notifications ---

export const NotificationsResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  unread: z.number().int().nonnegative(),
  settings: NotificationSettingsSchema,
  serverNow: IsoDateTimeSchema,
});
export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;

export const NotificationSettingsRequestSchema = NotificationSettingsSchema;
export type NotificationSettingsRequest = z.infer<typeof NotificationSettingsRequestSchema>;

export const NotificationMutationResponseSchema = z.object({
  notifications: NotificationsResponseSchema,
});
export type NotificationMutationResponse = z.infer<typeof NotificationMutationResponseSchema>;

/**
 * The two counts the HUD draws, on every read of the game.
 *
 * Folded into `/me` rather than polled separately: the HUD is on every screen, and two more
 * intervals against two more endpoints to draw two numbers is three requests where one will do.
 */
export const UnreadCountsSchema = z.object({
  messages: z.number().int().nonnegative(),
  notifications: z.number().int().nonnegative(),
});
export type UnreadCounts = z.infer<typeof UnreadCountsSchema>;
