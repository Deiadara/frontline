import {
  FACTION_SEAT_ONBOARDING_MS,
  cardMark,
  dealCards,
  type FactionCard,
  type OfficerMark,
  type Seatable,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { overseerSheetAsFielded } from '../crew/overseer-lift.js';

/** What one seat at a table is holding, and how well. */
export interface DealtCard {
  readonly card: FactionCard;
  readonly mark: OfficerMark;
  /** When the seat's Onboarding ends, or null when settled: the card pays nothing until then. */
  readonly onboardingUntil: string | null;
}

/**
 * The cards dealt at a table, by member, with each holder's mark on theirs.
 *
 * Dealt off the same order the room draws (`seatOrder`, shared), so the card on a plate is the
 * card the server pays out on. The mark reads the holder's Overseer as the crew fields them: their
 * own sheet lifted by their Right Hand, the sheet the crew screen prints (maintainer, 2026-10-15).
 * Read by the faction screen, to say it, and by the standing fold, to pay it, and it is one
 * function so the two cannot drift.
 */
export function cardsAtTable(
  repos: Repositories,
  factionId: string,
  /** When the Right Hand is read: seated, out of bed and settled in at this moment. */
  now: Date = new Date(),
): Map<string, DealtCard> {
  /*
   * Whether each member has a district, off the summaries (bug pass, 2026-10-06). It was a full
   * parse of every member's crew row on every standing fold, which every settle runs: one
   * unreadable row broke every route for the whole faction, and a full table parsed thirty crews
   * per `/me`.
   */
  const housed = new Set(repos.bases.listSummaries().map((summary) => summary.ownerId));
  const seatable = repos.factions.members(factionId).flatMap((row) => {
    const user = repos.users.findById(row.userId);
    if (!user || !housed.has(row.userId)) return [];
    const seat: Seatable & { userId: string; overseerId: string | null } = {
      userId: row.userId,
      username: user.username,
      rank: row.rank,
      joinedAt: row.joinedAt,
      seat: row.seat,
      overseerId: user.overseerId ?? null,
    };
    return [seat];
  });
  const dealt = dealCards(seatable);
  const since = settleCardHolders(repos, factionId, dealt, seatable, now);
  const held = new Map<string, DealtCard>();
  for (const seat of seatable) {
    const card = dealt.get(seat.userId);
    const overseer = seat.overseerId ? repos.overseers.findById(seat.overseerId) : undefined;
    if (card === undefined || !overseer) continue;
    const sheet = overseerSheetAsFielded(
      overseer.attributes,
      repos.bases.commandersOfOwner(seat.userId),
      now,
    );
    held.set(seat.userId, {
      card,
      mark: cardMark(card, sheet),
      onboardingUntil: onboardingUntil(since.get(card), now),
    });
  }
  return held;
}

/** When a seat taken at `since` finishes Onboarding, or null when it already has. */
export function onboardingUntil(since: string | undefined, now: Date): string | null {
  if (since === undefined) return null;
  const until = Date.parse(since) + FACTION_SEAT_ONBOARDING_MS;
  return until > now.getTime() ? new Date(until).toISOString() : null;
}

/**
 * Records who holds each card now, and returns since when (Onboarding, maintainer 2026-10-15).
 *
 * The deal is code (`dealCards`), so a change of holder is found by comparing it with the last one
 * recorded: a reseat, a new member taking a free card, or anybody leaving and the deal moving.
 * A card whose holder changed starts from `now`. A table with nothing recorded yet (every table
 * when Onboarding arrived) records each holder from the day they joined, so a table that has sat
 * together for weeks is not locked on the day the rule lands, and a founder's own first seat
 * starts the day the table was founded.
 */
export function settleCardHolders(
  repos: Repositories,
  factionId: string,
  dealt: ReadonlyMap<string, FactionCard>,
  members: readonly { userId: string; joinedAt: string }[],
  now: Date,
): Map<FactionCard, string> {
  const recorded = repos.factions.cardHolders(factionId);
  const fresh = recorded.size === 0;
  const joined = new Map(members.map((member) => [member.userId, member.joinedAt]));
  const since = new Map<FactionCard, string>();
  const holderOf = new Map([...dealt].map(([userId, card]) => [card, userId]));
  for (const [card, was] of recorded) {
    if (!holderOf.has(card)) repos.factions.setCardHolder(factionId, card, null);
    else if (holderOf.get(card) === was.userId) since.set(card, was.since);
  }
  for (const [card, userId] of holderOf) {
    if (since.has(card)) continue;
    const from = fresh ? (joined.get(userId) ?? now.toISOString()) : now.toISOString();
    repos.factions.setCardHolder(factionId, card, { userId, since: from });
    since.set(card, from);
  }
  return since;
}
