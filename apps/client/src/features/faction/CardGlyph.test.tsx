import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CARD_BY_SLOT, CardGlyph } from './CardGlyph';

/**
 * The deal is by seat, not by person: the ace of spades is the middle slot because the leader sits
 * there (`seats.ts`), the two court cards flank it, and the ends are the jack and the joker.
 */
describe('the cards on the table', () => {
  it('deals the leader the ace of spades, in the middle', () => {
    expect(CARD_BY_SLOT).toEqual([
      'joker',
      'king_diamonds',
      'ace_spades',
      'queen_hearts',
      'jack_clubs',
    ]);
  });

  it('names every card for a screen reader', () => {
    render(
      <>
        {CARD_BY_SLOT.map((card) => (
          <CardGlyph key={card} card={card} />
        ))}
      </>,
    );
    for (const name of [
      'The Joker',
      'King of diamonds',
      'Ace of spades',
      'Queen of hearts',
      'Jack of clubs',
    ]) {
      expect(screen.getByRole('img', { name })).toBeInTheDocument();
    }
  });
});
