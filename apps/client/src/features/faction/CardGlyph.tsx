import { CARD_BY_SLOT, type FactionCard } from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * The five cards the table is dealt, one per seat.
 *
 * A seat is known by its card rather than by the person in it: the leader's chair is the ace of
 * spades whoever the leader is, the two beside it the king of diamonds and the queen of hearts,
 * the two ends the jack of clubs and the joker. Drawn rather than fetched, the way the sigils are:
 * five small cards is not a request for art, and a card reads at 44px where a face does not. The
 * faces are solid, black or red, with the marks knocked out of them: a white card on a dark room
 * is a hole in the painting.
 */
export type CardId = FactionCard;

/** Re-exported from shared, where the server deals off the same table. */
export { CARD_BY_SLOT };

interface CardSpec {
  readonly name: string;
  /** The corner rank. */
  readonly rank: string;
  /** The suit mark, drawn in the centre. */
  readonly suit: '♠' | '♥' | '♦' | '♣' | '★';
  /** The face: solid black for the black suits and the joker, solid red for the red ones. */
  readonly face: string;
  /** The marks, inverted on the face: parchment on both, brass for the joker's star. */
  readonly ink: string;
}

/** The game's own black and red, off the palette rather than a printer's. */
const BLACK = '#100c16';
const RED = '#8f2622';
const PARCHMENT = '#ece5d5';
const BRASS = '#d9b26a';

const CARDS: Readonly<Record<CardId, CardSpec>> = {
  ace_spades: { name: 'Ace of spades', rank: 'A', suit: '♠', face: BLACK, ink: PARCHMENT },
  king_diamonds: { name: 'King of diamonds', rank: 'K', suit: '♦', face: RED, ink: PARCHMENT },
  queen_hearts: { name: 'Queen of hearts', rank: 'Q', suit: '♥', face: RED, ink: PARCHMENT },
  jack_clubs: { name: 'Jack of clubs', rank: 'J', suit: '♣', face: BLACK, ink: PARCHMENT },
  joker: { name: 'The Joker', rank: 'JKR', suit: '★', face: BLACK, ink: BRASS },
};

export function CardGlyph({ card, className }: { card: CardId; className?: string }) {
  const spec = CARDS[card];
  return (
    <svg
      viewBox="0 0 30 42"
      role="img"
      aria-label={spec.name}
      className={cn('shrink-0 drop-shadow-[0_1px_2px_rgba(6,5,10,0.8)]', className)}
    >
      <title>{spec.name}</title>
      <rect
        x="0.75"
        y="0.75"
        width="28.5"
        height="40.5"
        rx="3"
        fill="#ece5d5"
        stroke="#8a7f6a"
        strokeWidth="1.2"
      />
      <text
        x="3"
        y={spec.rank.length > 1 ? '9' : '10.5'}
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700"
        fontSize={spec.rank.length > 1 ? '6.5' : '10'}
        fill={spec.ink}
      >
        {spec.rank}
      </text>
      <text
        x="15"
        y="31"
        textAnchor="middle"
        fontFamily="'Apple Symbols', 'Segoe UI Symbol', 'DejaVu Sans', sans-serif"
        fontSize={spec.suit === '★' ? '18' : '21'}
        fill={spec.ink}
      >
        {spec.suit}
      </text>
    </svg>
  );
}
