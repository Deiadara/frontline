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

  /**
   * The board's ask: the joker says `JOKER`, not `JKR`.
   *
   * Three initials in a corner read as an abbreviation of something rather than as the card, and
   * the joker is the one seat at the table whose name is the whole point of it.
   */
  it('writes the joker out in full across the top of its face', () => {
    render(<CardGlyph card="joker" />);
    const marks = screen.getByRole('img', { name: 'The Joker' }).querySelectorAll('text');
    const word = [...marks].find((mark) => mark.textContent === 'JOKER');
    expect(word, 'the joker carries its word, not an abbreviation').toBeDefined();
    // Centred on the face rather than tucked in a corner, which is what makes room for five caps.
    expect(word?.getAttribute('text-anchor')).toBe('middle');
    expect(Number(word?.getAttribute('x'))).toBeCloseTo(FACE_MIDDLE, 0);
    expect([...marks].some((mark) => mark.textContent === '★')).toBe(true);
  });

  /**
   * ...and it fits, with the border clear at both ends.
   *
   * jsdom cannot measure a glyph, so the width is the type's own arithmetic: five caps of a bold
   * grotesque average about 0.62 of the point size each, plus the tracking between them. That is
   * an over-estimate for `JOKER` (the `J` is narrow), which is the direction a guard should err
   * in. The screenshots at 44px and 64px are what confirm the arithmetic against a real renderer.
   */
  it('sets the word narrow enough to clear both edges of the card', () => {
    render(<CardGlyph card="joker" />);
    const word = [...screen.getByRole('img', { name: 'The Joker' }).querySelectorAll('text')].find(
      (mark) => mark.textContent === 'JOKER',
    )!;
    const size = Number(word.getAttribute('font-size'));
    const tracking = Number(word.getAttribute('letter-spacing'));
    const width = 'JOKER'.length * size * CAP_ADVANCE + ('JOKER'.length - 1) * tracking;
    expect(width).toBeLessThanOrEqual(FACE_WIDTH - 2 * MARGIN);
    // And big enough to read at a 44px seat plate: 5.4 of 42 units is about six pixels of cap.
    expect(size).toBeGreaterThanOrEqual(5);
  });

  /**
   * The faces are inverted: dark card, white marks. The first cut drew a parchment face with
   * parchment marks, which rendered as a blank grey tile at every seat and told nobody anything.
   */
  it('knocks white marks out of a dark face on every card', () => {
    const { container } = render(
      <>
        {CARD_BY_SLOT.map((card) => (
          <CardGlyph key={card} card={card} />
        ))}
      </>,
    );
    const cards = container.querySelectorAll('svg');
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      const face = luminance(card.querySelector('rect')?.getAttribute('fill') ?? '');
      expect(face).toBeLessThan(0.25);
      for (const mark of card.querySelectorAll('text')) {
        expect(luminance(mark.getAttribute('fill') ?? '')).toBeGreaterThan(0.85);
      }
    }
  });
});

/** The face inside the border, off the `0 0 30 42` viewBox the card is drawn in. */
const FACE_WIDTH = 28.5;
const FACE_MIDDLE = 15;
/** How much of the face a word has to leave alone at each end to not read as touching the edge. */
const MARGIN = 2;
/** Average advance of a bold grotesque capital, as a share of the point size. */
const CAP_ADVANCE = 0.62;

/** Relative luminance of a `#rrggbb` fill, 0 for black and 1 for white. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a hex fill: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(match[1]!.slice(at, at + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
