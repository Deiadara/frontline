import type { FactionCard } from './factions.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ATTRIBUTES, type Attributes } from '../attributes.js';
import { OFFICER_MARKS } from '../crew/marks.js';
import {
  CARD_BY_SLOT,
  FACTION_CARD_SPECS,
  SEAT_SLOT_ORDER,
  cardBonusPercent,
  cardMark,
  cardPoints,
  dealCards,
  describeCardBonus,
  describeCardReads,
  seatOrder,
} from './cards.js';
import { FACTION_CARDS } from './factions.js';

/**
 * The deal is by seat, and a seat's worth is its holder's sheet.
 *
 * Two things can go quietly wrong here. The card can be dealt to the wrong person, which the room
 * would still draw plausibly; and the mark can read the wrong attributes, which would still print
 * a letter. Both are pinned against hand-worked cases.
 */

/** `joined` is a day of September: the smaller, the earlier they sat down. */
const seat = (
  username: string,
  rank: 'leader' | 'chief' | 'member',
  joined: number,
  card: FactionCard | null = null,
) => ({
  userId: `u-${username}`,
  username,
  rank,
  joinedAt: `2026-09-${String(joined).padStart(2, '0')}T12:00:00.000Z`,
  seat: card,
});

const sheet = (overrides: Partial<Attributes>): Attributes => ({
  ...DEFAULT_ATTRIBUTES,
  ...overrides,
});

describe('dealing the cards', () => {
  it('gives every card a slot, and the leader the ace of spades in the middle', () => {
    expect(CARD_BY_SLOT).toHaveLength(5);
    expect(new Set(CARD_BY_SLOT).size).toBe(5);
    expect(CARD_BY_SLOT[SEAT_SLOT_ORDER[0] ?? -1]).toBe('ace_spades');
    expect(SEAT_SLOT_ORDER[0]).toBe(2);
  });

  it('deals the unseated by rank, then by who sat down first, then by name', () => {
    const dealt = dealCards([
      seat('Marrow', 'member', 3),
      seat('Zed', 'member', 3),
      seat('Sable', 'chief', 20),
      seat('Nikos', 'leader', 1),
      seat('Abel', 'member', 3),
    ]);
    expect(dealt.get('u-Nikos')).toBe('ace_spades');
    expect(dealt.get('u-Sable')).toBe('king_diamonds');
    // The three members sat down the same day and fall back to the name: Abel, Marrow, Zed.
    expect(dealt.get('u-Abel')).toBe('queen_hearts');
    expect(dealt.get('u-Marrow')).toBe('joker');
    expect(dealt.get('u-Zed')).toBe('jack_clubs');
  });

  /**
   * The leader assigns the seats (maintainer ruling P3-C, 2026-10-02). Cards were dealt by the
   * army at home, so a member who marched out to a table-mate's fight lost theirs mid-fight.
   */
  it('keeps the seats the leader set and deals what is left to the rest', () => {
    const dealt = dealCards([
      seat('Nikos', 'leader', 1, 'joker'),
      seat('Sable', 'chief', 2),
      seat('Abel', 'member', 3, 'ace_spades'),
      seat('Marrow', 'member', 4),
    ]);
    expect(dealt.get('u-Nikos')).toBe('joker');
    expect(dealt.get('u-Abel')).toBe('ace_spades');
    // The rest of the row in its usual order, the middle first: king, then queen.
    expect(dealt.get('u-Sable')).toBe('king_diamonds');
    expect(dealt.get('u-Marrow')).toBe('queen_hearts');
  });

  it('gives a card two rows name to the higher seat and deals the other one a free card', () => {
    const dealt = dealCards([
      seat('Nikos', 'leader', 1, 'joker'),
      seat('Abel', 'member', 3, 'joker'),
    ]);
    expect(dealt.get('u-Nikos')).toBe('joker');
    expect(dealt.get('u-Abel')).toBe('ace_spades');
  });

  it('deals nothing to a sixth chair', () => {
    const six = Array.from({ length: 6 }, (_, at) => seat(`P${at}`, 'member', at + 1));
    const dealt = dealCards(six);
    expect(dealt.size).toBe(5);
    expect(dealt.has('u-P5')).toBe(false);
  });

  it('orders the table the way the roster reads', () => {
    const order = seatOrder([
      seat('Marrow', 'member', 1),
      seat('Sable', 'chief', 10),
      seat('Nikos', 'leader', 20),
    ]).map((entry) => entry.username);
    expect(order).toEqual(['Nikos', 'Sable', 'Marrow']);
  });
});

describe('what a card is worth', () => {
  it('reads three named attributes and nothing else', () => {
    for (const card of FACTION_CARDS) {
      const spec = FACTION_CARD_SPECS[card];
      expect(spec.reads).toHaveLength(3);
      expect(new Set(spec.reads).size).toBe(3);
    }
    // The ace is the plain mean of its three: 30, 60 and 90 make 60.
    expect(cardPoints('ace_spades', sheet({ strength: 30, strategy: 60, authority: 90 }))).toBe(60);
    // ...and an attribute the card does not read moves nothing.
    expect(
      cardPoints('ace_spades', sheet({ strength: 30, strategy: 60, authority: 90, logic: 100 })),
    ).toBe(60);
  });

  it('marks on the officer ladder, and pays half a point a band', () => {
    expect(cardMark('king_diamonds', sheet({ toughness: 10, organization: 10, resolve: 10 }))).toBe(
      'F-',
    );
    expect(
      cardMark('king_diamonds', sheet({ toughness: 100, organization: 100, resolve: 100 })),
    ).toBe('S+');
    expect(cardBonusPercent('F-')).toBe(0);
    expect(cardBonusPercent('B')).toBe(7);
    expect(cardBonusPercent('S+')).toBe(Math.round((OFFICER_MARKS.length - 1) / 2));
  });

  it('says what it reads and what it pays, in words', () => {
    expect(describeCardReads('queen_hearts')).toBe('Logic, Analysis and Logistics');
    expect(describeCardBonus('jack_clubs', 'B')).toBe('+7% Infamy off everything that earns it');
  });

  it('pushes five different channels', () => {
    expect(new Set(FACTION_CARDS.map((card) => FACTION_CARD_SPECS[card].channel)).size).toBe(5);
  });
});
