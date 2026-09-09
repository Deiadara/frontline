import { CARD_BY_SLOT, type FactionCard } from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * The five cards the table is dealt, one per seat.
 *
 * A seat is known by its card rather than by the person in it: the leader's chair is the ace of
 * spades whoever the leader is, the two beside it the king of diamonds and the queen of hearts,
 * the two ends the jack of clubs and the joker. Drawn rather than fetched, the way the sigils are:
 * five small cards is not a request for art, and a card reads at 44px where a face does not. The
 * faces are inverted: the room's own dark purple, near black for the black suits, with the marks
 * knocked out of them in white. A white card on a dark room is a hole in the painting.
 */
export type CardId = FactionCard;

/** Re-exported from shared, where the server deals off the same table. */
export { CARD_BY_SLOT };

interface CardSpec {
  readonly name: string;
  /**
   * What is written on the face.
   *
   * Four of the five carry a rank in the corner, which is what a rank is for: one or two
   * characters, read at a glance off a fanned hand. The joker has no rank, and abbreviating it to
   * `JKR` in the corner was reading as three initials rather than as a card. The board asked for
   * the word, so it is set across the top of the face where there is room for it.
   */
  readonly legend:
    | { readonly kind: 'rank'; readonly text: string }
    | { readonly kind: 'banner'; readonly text: string };
  /** The suit mark, drawn in the centre. */
  readonly suit: '♠' | '♥' | '♦' | '♣' | '★';
  /** The face: near black for the black suits and the joker, the room's purple for the red ones. */
  readonly face: string;
}

/** The game's own darks, off the palette (`theme/tokens.ts` surface-950) rather than a printer's. */
const BLACK = '#0d0a12';
const PURPLE = '#2a2140';
/** Every mark, on every face. */
const INK = '#f4f0e8';
/** The edge that lifts a dark card off a dark plate. */
const EDGE = '#6f6588';

const rank = (text: string) => ({ kind: 'rank', text }) as const;

const CARDS: Readonly<Record<CardId, CardSpec>> = {
  ace_spades: { name: 'Ace of spades', legend: rank('A'), suit: '♠', face: BLACK },
  king_diamonds: { name: 'King of diamonds', legend: rank('K'), suit: '♦', face: PURPLE },
  queen_hearts: { name: 'Queen of hearts', legend: rank('Q'), suit: '♥', face: PURPLE },
  jack_clubs: { name: 'Jack of clubs', legend: rank('J'), suit: '♣', face: BLACK },
  joker: { name: 'The Joker', legend: { kind: 'banner', text: 'JOKER' }, suit: '★', face: PURPLE },
};

/**
 * The word across the top of the joker, sized to the 28.5-unit face.
 *
 * Five caps at 5.4 units with 0.55 of tracking measures about 19 of the 28.5 the face is wide, so
 * it clears the border by four units at each end at every size the card is drawn (44px at a seat
 * plate, 64px in the member window). Tracked out because five bold caps set solid at this size
 * read as one dark smudge; a sans face because a serif's brackets and thin strokes are the first
 * things to go when the whole word is six pixels tall on a seat plate.
 *
 * `textAnchor="middle"` centres the advance width, and the tracking after the final letter is
 * part of that width, so the word sits half a step of tracking left of the centre line: `x` puts
 * it back. Measured in the screenshots the board asked for rather than derived.
 */
const BANNER_TRACKING = 0.55;

export function CardGlyph({ card, className }: { card: CardId; className?: string }) {
  const spec = CARDS[card];
  return (
    <svg
      viewBox="0 0 30 42"
      role="img"
      aria-label={spec.name}
      className={cn('shrink-0 drop-shadow-[0_1px_2px_rgba(6,5,10,0.8)]', className)}
    >
      <rect
        x="0.75"
        y="0.75"
        width="28.5"
        height="40.5"
        rx="3"
        fill={spec.face}
        stroke={EDGE}
        strokeWidth="1.2"
      />
      {spec.legend.kind === 'rank' ? (
        <text
          x="3"
          y="10.5"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontWeight="700"
          fontSize="10"
          fill={INK}
        >
          {spec.legend.text}
        </text>
      ) : (
        <text
          x={15 + BANNER_TRACKING / 2}
          y="8.5"
          textAnchor="middle"
          fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontWeight="700"
          fontSize="5.4"
          letterSpacing={BANNER_TRACKING}
          fill={INK}
        >
          {spec.legend.text}
        </text>
      )}
      <text
        x="15"
        y="31"
        textAnchor="middle"
        fontFamily="'Apple Symbols', 'Segoe UI Symbol', 'DejaVu Sans', sans-serif"
        fontSize={spec.suit === '★' ? '18' : '21'}
        fill={INK}
      >
        {spec.suit}
      </text>
    </svg>
  );
}
