import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { BadgeSchema } from './badge.js';

/**
 * Factions: the team a player belongs to.
 *
 * The word was in use, for a district's own name and for a map holder kind, and both of those were
 * renamed out of the way (migrations `0044`, and the `DistrictName*` rename) because this is what
 * players mean by it. A faction is **up to five people who fight together**, and the whole of what
 * it buys is that their armies are visible to each other and can be sent to each other's battles.
 *
 * ## Five, and why the cap is in the domain rather than in a route
 *
 * `MAX_FACTION_MEMBERS` is read by the join path, the invite path and the screen that draws the
 * roster. A cap enforced only at the route is a cap that holds until somebody adds a second way in,
 * which is exactly what an invite *is*: a second door onto the same table.
 *
 * ## Ranks
 *
 * Three, and they are about permissions rather than prestige.
 *
 * | | Leader | Chief | Member |
 * | --- | --- | --- | --- |
 * | See everything, fight in every battle | yes | yes | yes |
 * | Invite, and remove a member | yes | yes | no |
 * | Rewrite the description | yes | yes | no |
 * | Rename, re-badge | yes | no | no |
 * | Promote, demote, remove a chief | yes | no | no |
 * | Hand the faction over, disband it | yes | no | no |
 *
 * There is always exactly one leader, so a faction can never be left with nobody able to admit
 * anyone. A chief outranks a member and nothing else: the line that matters is that a chief cannot
 * touch another chief, which is what stops two of them from removing each other in a disagreement.
 *
 * Each row above is a named function below rather than a condition spelled out at the call site,
 * because every one of them is asked in both the route that enforces it and the screen that greys
 * out the button, and those two disagreeing is the whole class of bug this table exists to stop.
 */

export const MAX_FACTION_MEMBERS = 5;

/** Long enough to be a name, short enough to sit in a roster row beside a district's. */
export const FACTION_NAME_MAX = 28;
export const FACTION_NAME_MIN = 3;
export const FACTION_BLURB_MAX = 240;

export const FactionNameSchema = z.string().trim().min(FACTION_NAME_MIN).max(FACTION_NAME_MAX);
export const FactionBlurbSchema = z.string().trim().max(FACTION_BLURB_MAX);

export const FACTION_RANKS = ['leader', 'chief', 'member'] as const;
export const FactionRankSchema = z.enum(FACTION_RANKS);
export type FactionRank = z.infer<typeof FactionRankSchema>;

export const FACTION_RANK_LABELS: Record<FactionRank, string> = {
  leader: 'Leader',
  chief: 'Chief',
  member: 'Member',
};

/** What each rank is allowed to do, in one line, for the screen that lists them. */
export const FACTION_RANK_BLURBS: Record<FactionRank, string> = {
  leader: 'Runs the faction. The only rank that can rename it, re-badge it or hand it on.',
  chief: 'Invites people, removes members, keeps the description current.',
  member: 'Sees everything and fights in everything.',
};

/** Whether this rank can send an invitation. */
export function canInvite(rank: FactionRank): boolean {
  return rank === 'leader' || rank === 'chief';
}

/**
 * Whether this rank can rewrite what the faction says it is for.
 *
 * Chiefs can, and that is deliberate rather than an oversight: the description is the recruiting
 * pitch, chiefs are the ones doing the recruiting, and a pitch only the leader can touch goes
 * stale the first week the leader is busy.
 */
export function canEditDescription(rank: FactionRank): boolean {
  return rank === 'leader' || rank === 'chief';
}

/**
 * Whether this rank can change the name or the badge.
 *
 * Leader only. These two are the faction's identity to everybody outside it: a chief renaming it
 * is not an edit, it is a different faction wearing the same members.
 */
export function canEditIdentity(rank: FactionRank): boolean {
  return rank === 'leader';
}

/**
 * Whether `actor` can remove `target`.
 *
 * Two arguments, because rank alone cannot answer it. A chief may remove a member and nobody else,
 * which is what keeps a disagreement between two chiefs from being settled by whoever clicks
 * first. Nobody removes a leader, including the leader: leaving is the leader's own door
 * ({@link leavingDisbands}), and it has consequences a kick does not.
 */
export function canKick(actor: FactionRank, target: FactionRank): boolean {
  if (target === 'leader') return false;
  if (actor === 'leader') return true;
  return actor === 'chief' && target === 'member';
}

/** Whether this rank can promote and demote. Leader only: chiefs do not make chiefs. */
export function canSetRank(rank: FactionRank): boolean {
  return rank === 'leader';
}

/** Only the leader may hand the faction over or disband it. */
export function canAdminister(rank: FactionRank): boolean {
  return rank === 'leader';
}

/**
 * Whether this person walking out takes the faction with them.
 *
 * The board's rule, and it is the one players expect from every other game with teams: a leader
 * who leaves disbands it, *unless* they hand it to somebody first, and a last member out disbands
 * it whatever their rank. Expressed as one function rather than as a branch in the leave route,
 * because the screen has to warn about exactly the case the route is about to perform, and the
 * warning being right is the whole point of the warning.
 */
export function leavingDisbands(rank: FactionRank, memberCount: number): boolean {
  return rank === 'leader' || memberCount <= 1;
}

export const FactionSchema = z.object({
  id: IdSchema,
  name: FactionNameSchema,
  badge: BadgeSchema,
  blurb: FactionBlurbSchema,
  /**
   * §J8: every scrap of infamy won in battle by somebody wearing this badge, ever.
   *
   * Append-only. It is not the sum of the members' wallets and it is not the sum of the members'
   * contributions either: somebody leaving takes their seat, not the fights they won while they sat
   * in it. The number only goes up, and it is what the standings rank factions by.
   */
  infamyEarned: z.number().nonnegative(),
  foundedAt: IsoDateTimeSchema,
});
export type Faction = z.infer<typeof FactionSchema>;

/**
 * One person at the table, as any screen in the game needs them.
 *
 * Carries the member's *district* as well as their account, because everything a faction does is
 * about the district: its army, its battles, where it sits on the map. A member with no district is
 * not a state the game can reach (you choose an Overseer before anything else), but the id is
 * carried explicitly rather than looked up so a roster row is one object.
 */
export const FactionMemberSchema = z.object({
  userId: IdSchema,
  baseId: IdSchema,
  username: z.string().min(1),
  /** What their district is called: the name they picked, which is what other screens show. */
  districtName: z.string().min(1),
  districtId: z.string().min(1),
  rank: FactionRankSchema,
  joinedAt: IsoDateTimeSchema,
  level: z.number().int().positive(),
  /** §D7: their name in the city, so the roster can be read as a pecking order. */
  infamy: z.number().nonnegative(),
  /**
   * What *this member* has won for the faction since sitting down (§J8).
   *
   * Their share of the faction's total, not the total: the faction keeps what a leaver won, and
   * this row goes with them. Not a slice of the wallet above either, which falls when they buy
   * notoriety while this never does.
   */
  infamyEarned: z.number().nonnegative(),
  /** Bodies on their roster right now. The number an ally is actually deciding about. */
  armySize: z.number().int().nonnegative(),
  /** Supply their army is standing on, so a big number and a thin one read differently. */
  supplyUsed: z.number().int().nonnegative(),
  /** Never live: a hardcoded neighbour who is in the faction but does not play (see `seed/`). */
  isBot: z.boolean().default(false),
});
export type FactionMember = z.infer<typeof FactionMemberSchema>;

/** An invitation, which is the only way in. */
export const FactionInviteSchema = z.object({
  id: IdSchema,
  factionId: IdSchema,
  factionName: FactionNameSchema,
  factionBadge: BadgeSchema,
  /** Who sent it, for the line the invited player reads. */
  invitedBy: z.string().min(1),
  invitedUserId: IdSchema,
  sentAt: IsoDateTimeSchema,
});
export type FactionInvite = z.infer<typeof FactionInviteSchema>;

/**
 * §B1: what a crew has to be before it can put its own name over a table.
 *
 * Two gates, and they say different things. The player level is about the *person*: somebody who
 * has run a handful of jobs has seen enough of the city to be worth following. The Nexus level is
 * about the *place*: a faction is administered from somewhere, and a crew whose command post is a
 * shipping container is not administering anybody. The refusal names both, because a player who is
 * short of one and not the other has one thing to go and do.
 */
export const FOUND_FACTION_PLAYER_LEVEL = 5;
export const FOUND_FACTION_NEXUS_LEVEL = 3;

export const FACTION_REFUSALS = [
  'not_established',
  'already_in_a_faction',
  'faction_full',
  'name_taken',
  'not_a_member',
  'not_allowed',
  'no_such_player',
  'already_invited',
  'already_a_member',
  'no_such_invite',
] as const;
export const FactionRefusalSchema = z.enum(FACTION_REFUSALS);
export type FactionRefusal = z.infer<typeof FactionRefusalSchema>;

/** One sentence a player can act on, for every way this can be turned down. */
export const FACTION_REFUSAL_TEXT: Record<FactionRefusal, string> = {
  not_established: `Founding a faction takes crew level ${FOUND_FACTION_PLAYER_LEVEL} and the Nexus at ${FOUND_FACTION_NEXUS_LEVEL}.`,
  already_in_a_faction: 'You are already in a faction. Leave it first.',
  faction_full: `A faction holds ${MAX_FACTION_MEMBERS} people. This one is full.`,
  name_taken: 'Another faction already goes by that name.',
  not_a_member: 'You are not in that faction.',
  not_allowed: 'Your rank does not carry that.',
  no_such_player: 'Nobody in this city goes by that name.',
  already_invited: 'They already have an invitation from you.',
  already_a_member: 'They are already at your table.',
  no_such_invite: 'That invitation is no longer open.',
};

/** Whether one more person fits. */
export function factionHasRoom(memberCount: number): boolean {
  return memberCount < MAX_FACTION_MEMBERS;
}

/**
 * Two faction names are the same name if they paint the same pixels.
 *
 * The same rule as district names (`city/districts.ts`), and for the same reason: HTML collapses
 * runs of whitespace, so two names differing only by a double space are one name on screen.
 */
export function sameFactionName(a: string, b: string): boolean {
  return (
    a.trim().replace(/\s+/g, ' ').toLocaleLowerCase() ===
    b.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  );
}
