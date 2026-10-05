import { ATTRIBUTE_LABELS, type AttributeName, type Attributes } from '../attributes.js';
import type { NumericEffectChannel } from '../crew/effects.js';
import { markFromPoints, markIndex, type OfficerMark } from '../crew/marks.js';
import { FACTION_RANKS, type FactionCard, type FactionRank } from './factions.js';

/**
 * The five cards a table is dealt, and what each one does for the faction.
 *
 * A seat at the table is a card, and the card is dealt by *seat* rather than by person: the
 * leader's chair in the middle is the ace of spades whoever the leader is, the two beside it are
 * the king of diamonds and the queen of hearts, and the two ends are the jack of clubs and the
 * joker. Each card is responsible for one aspect of the faction and reads three of its holder's
 * attributes to say how well: the mean of the three is a score on the same scale an officer's role
 * fit is read on, so the mark on a card and the mark on an officer are the same kind of thing. The
 * mark decides how much the card is worth to everybody at the table, and an empty seat is worth
 * nothing.
 *
 * The attributes a card reads are public, unlike a role's weights: a player is meant to see what
 * their seat asks of them and train for it. That is the whole loop.
 */

export interface FactionCardSpec {
  readonly card: FactionCard;
  readonly name: string;
  /** What the card is responsible for, in one word the members list can head a column with. */
  readonly aspect: string;
  /** What holding it well does for the table, in the player's words. */
  readonly blurb: string;
  /** The three attributes it reads. Public, so the holder knows what to train. */
  readonly reads: readonly [AttributeName, AttributeName, AttributeName];
  /** The standing-effects channel every member of the table is paid on. */
  readonly channel: NumericEffectChannel;
  /** The channel in the player's words, for the line under the mark. */
  readonly channelLabel: string;
  /** Paid in points rather than percent: the medics' channel goes through a curve (`crew/effects.ts`). */
  readonly points?: true;
}

export const FACTION_CARD_SPECS: Readonly<Record<FactionCard, FactionCardSpec>> = {
  ace_spades: {
    card: 'ace_spades',
    name: 'Ace of spades',
    aspect: 'Attacks',
    blurb: 'The one who calls the fights. Everybody at the table hits harder for it.',
    reads: ['strength', 'strategy', 'authority'],
    channel: 'unitOffensePercent',
    channelLabel: 'What your people hit for',
  },
  king_diamonds: {
    card: 'king_diamonds',
    name: 'King of diamonds',
    aspect: 'Defences',
    blurb: 'The one who holds the door. Everything the table holds is harder to take off it.',
    reads: ['toughness', 'organization', 'resolve'],
    channel: 'defensePercent',
    channelLabel: 'Holding your ground',
  },
  queen_hearts: {
    card: 'queen_hearts',
    name: 'Queen of hearts',
    aspect: 'Planning',
    blurb: 'The one with the map. Every run the table sends out comes home sooner.',
    reads: ['logic', 'analysis', 'logistics'],
    channel: 'missionSpeedPercent',
    channelLabel: "Off every run's clock",
  },
  jack_clubs: {
    card: 'jack_clubs',
    name: 'Jack of clubs',
    aspect: 'Infamy',
    blurb: 'The one whose name gets around. Everything the table does is talked about more.',
    reads: ['intimidation', 'charisma', 'deception'],
    channel: 'infamyGainPercent',
    channelLabel: 'Infamy off everything that earns it',
  },
  joker: {
    card: 'joker',
    name: 'The Joker',
    aspect: 'Luck',
    blurb: 'The one who walks away from things. More of the table walks away with them.',
    reads: ['improvisation', 'intuition', 'stealth'],
    channel: 'casualtyRecoveryPercent',
    channelLabel: 'Medic points',
    points: true,
  },
};

/** Which card each slot of the row holds, left to right. The leader sits at slot 2. */
export const CARD_BY_SLOT: readonly FactionCard[] = [
  'joker',
  'king_diamonds',
  'ace_spades',
  'queen_hearts',
  'jack_clubs',
];

/**
 * Which slot each rank-ordered member takes: the leader in the middle, then the two beside it,
 * then the two ends. Empty places are whatever is left, so a table of two is the leader and the
 * chief in the middle with three spare chairs round them.
 */
export const SEAT_SLOT_ORDER: readonly number[] = [2, 1, 3, 0, 4];

/** What `seatOrder` needs to know about somebody. `FactionMember` has all of it. */
export interface Seatable {
  readonly username: string;
  readonly rank: FactionRank;
  readonly joinedAt: string;
  /** The card the leader seated them at, or null (or absent) when the deal places them. */
  readonly seat?: FactionCard | null;
}

const RANK_ORDER = new Map(FACTION_RANKS.map((rank, at) => [rank, at]));

/**
 * The table: the leader at the head of it, then the chiefs, then everybody else.
 *
 * Inside a rank, whoever sat down first stands first, and ties fall back to the name. It ordered
 * by the army at home until 2026-10-02 (maintainer ruling P3-C), and units leave home the moment
 * they march, so sending troops to a table-mate's fight passed a card to a weaker Overseer while
 * the fight was on. Shared between the server, which deals the cards off it, and the client,
 * which draws the roster off it.
 */
export function seatOrder<T extends Seatable>(members: readonly T[]): T[] {
  return [...members].sort((left, right) => {
    const byRank = (RANK_ORDER.get(left.rank) ?? 0) - (RANK_ORDER.get(right.rank) ?? 0);
    if (byRank !== 0) return byRank;
    if (left.joinedAt !== right.joinedAt) return left.joinedAt < right.joinedAt ? -1 : 1;
    return left.username.localeCompare(right.username);
  });
}

/**
 * The card each member holds (maintainer ruling P3-C, 2026-10-02: the leader assigns the seats).
 *
 * A seat the leader set is kept, the first claim on a card winning if two rows name the same one.
 * Everybody the leader has not seated is dealt the cards left over, in {@link seatOrder} and in
 * the row's usual order (the middle first), so a table whose leader never touches the seats still
 * has every card held. Anybody past the fifth chair holds nothing.
 */
export function dealCards<T extends Seatable & { readonly userId: string }>(
  members: readonly T[],
): Map<string, FactionCard> {
  const dealt = new Map<string, FactionCard>();
  const taken = new Set<FactionCard>();
  for (const member of seatOrder(members)) {
    if (!member.seat || taken.has(member.seat)) continue;
    dealt.set(member.userId, member.seat);
    taken.add(member.seat);
  }
  const free = SEAT_SLOT_ORDER.map((slot) => CARD_BY_SLOT[slot]).filter(
    (card): card is FactionCard => card !== undefined && !taken.has(card),
  );
  for (const member of seatOrder(members)) {
    if (dealt.has(member.userId)) continue;
    const card = free.shift();
    if (card === undefined) break;
    dealt.set(member.userId, card);
  }
  return dealt;
}

/** The score a sheet earns on a card: the plain mean of the three attributes it reads. */
export function cardPoints(card: FactionCard, attributes: Attributes): number {
  const reads = FACTION_CARD_SPECS[card].reads;
  return reads.reduce((total, name) => total + attributes[name], 0) / reads.length;
}

/** The mark on the card, on the same ladder an officer's role fit is read on. */
export function cardMark(card: FactionCard, attributes: Attributes): OfficerMark {
  return markFromPoints(cardPoints(card, attributes));
}

/**
 * What a mark is worth to the table, in percent on the card's channel.
 *
 * Half a point per band, whole numbers: a fresh recruit's F+ is worth one, a B is seven, and the
 * S+ nobody has reached yet is ten. Rounded rather than floored so the odd bands count too.
 */
export function cardBonusPercent(mark: OfficerMark): number {
  return Math.round(markIndex(mark) / 2);
}

/** "+7% What your people hit for": the effect line under a card. */
export function describeCardBonus(card: FactionCard, mark: OfficerMark): string {
  const spec = FACTION_CARD_SPECS[card];
  return `+${cardBonusPercent(mark)}${spec.points ? '' : '%'} ${spec.channelLabel}`;
}

/** "Strength, Strategy and Authority": what the card reads, for the members list. */
export function describeCardReads(card: FactionCard): string {
  const [a, b, c] = FACTION_CARD_SPECS[card].reads;
  return `${ATTRIBUTE_LABELS[a]}, ${ATTRIBUTE_LABELS[b]} and ${ATTRIBUTE_LABELS[c]}`;
}
