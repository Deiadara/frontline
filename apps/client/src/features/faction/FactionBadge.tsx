import { useId } from 'react';
import {
  BADGE_COLOR_VALUES,
  type BadgeField,
  type BadgeProp,
  type BadgeShape,
  type FactionBadge as Badge,
} from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * A faction's badge, drawn.
 *
 * Code-generated art, which is the board's standing policy for everything that is not a painted
 * master: five stored identifiers in, one SVG out. Nothing here is an asset, so a badge costs no
 * network request, scales to any size without a second file, and a player inventing a new
 * combination needs nothing shipped to them.
 *
 * ## Drawn on a 100 x 120 field
 *
 * Every shape, pattern and emblem below is authored against the same box, so they compose without
 * per-shape special cases: the outline clips, the pattern fills, the emblem sits in the middle at a
 * fixed size. An emblem that looked right on the shield and wrong on the roundel would mean 6 x 18
 * placements to maintain rather than 24 drawings.
 *
 * ## The wobble
 *
 * A displacement filter over the whole thing, the same trick `.ink-box` and the ruled lines use
 * (`index.css`): straight vector edges read as printed, and this game is drawn. The filter is what
 * makes a badge somebody chose from six shapes look hand-inked rather than picked from a menu.
 * It is skipped at small sizes, where the displacement is larger than the details it would move.
 */

const SHAPES: Record<BadgeShape, string> = {
  shield: 'M50 3 L97 17 L97 62 C97 92 76 111 50 118 C24 111 3 92 3 62 L3 17 Z',
  roundel: 'M50 6 a54 54 0 1 0 0.1 0 z',
  banner: 'M7 5 H93 V94 L50 117 L7 94 Z',
  lozenge: 'M50 2 L98 60 L50 118 L2 60 Z',
  tower: 'M9 9 H27 V21 H41 V9 H59 V21 H73 V9 H91 V112 H9 Z',
  wedge: 'M3 8 H97 V46 L50 116 L3 46 Z',
};

/**
 * The pattern over the ground, in the second colour.
 *
 * Each one is a slab drawn well outside the 100 x 120 box and clipped back to the outline, so a
 * diagonal band meets the edge of a shield and the edge of a roundel equally well without knowing
 * which it is in.
 */
const FIELDS: Record<BadgeField, string | null> = {
  plain: null,
  bend: 'M-30 130 L70 -30 L130 -30 L30 130 Z',
  chevron: 'M50 34 L130 118 L130 148 L50 64 L-30 148 L-30 118 Z',
  quarters: 'M-30 -30 H50 V60 H130 V150 H50 V60 H-30 Z',
  pale: 'M35 -30 H65 V150 H35 Z',
  fess: 'M-30 46 H130 V80 H-30 Z',
};

/**
 * The emblems, each one path on a 0..100 box, `evenodd` so a hole is a hole.
 *
 * Bold silhouettes rather than line drawings, and that is the constraint the whole set is designed
 * to: this is read at 22px in a message header far more often than at 200px in the builder, and a
 * drawing with interior detail turns to mud at that size while a silhouette survives.
 */
const PROPS: Record<BadgeProp, string | null> = {
  blank: null,
  skull:
    'M50 6 C26 6 12 24 12 44 C12 58 19 66 26 72 L26 88 C26 93 30 96 35 96 L65 96 C70 96 74 93 74 88 L74 72 C81 66 88 58 88 44 C88 24 74 6 50 6 Z M33 40 C39 40 43 45 43 51 C43 57 39 61 33 61 C27 61 23 57 23 51 C23 45 27 40 33 40 Z M67 40 C73 40 77 45 77 51 C77 57 73 61 67 61 C61 61 57 57 57 51 C57 45 61 40 67 40 Z M44 68 L56 68 L53 82 L47 82 Z',
  cog: 'M50 2 L60 12 L74 8 L78 22 L92 26 L88 40 L98 50 L88 60 L92 74 L78 78 L74 92 L60 88 L50 98 L40 88 L26 92 L22 78 L8 74 L12 60 L2 50 L12 40 L8 26 L22 22 L26 8 L40 12 Z M50 32 C40 32 32 40 32 50 C32 60 40 68 50 68 C60 68 68 60 68 50 C68 40 60 32 50 32 Z',
  bolt: 'M58 2 L18 56 L44 56 L38 98 L82 40 L54 40 Z',
  star: 'M50 2 L62 36 L98 36 L69 58 L80 94 L50 72 L20 94 L31 58 L2 36 L38 36 Z',
  crown: 'M8 78 L2 22 L26 42 L50 8 L74 42 L98 22 L92 78 Z M8 84 L92 84 L92 96 L8 96 Z',
  fist: 'M18 50 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0 L78 70 C78 86 66 96 50 96 C34 96 18 86 18 70 Z M18 54 C8 54 2 60 2 68 C2 78 10 82 18 82 Z',
  wolf: 'M12 6 L30 30 L70 30 L88 6 L92 44 C92 70 74 96 50 96 C26 96 8 70 8 44 Z M30 46 L42 46 L36 58 Z M58 46 L70 46 L64 58 Z M44 70 L56 70 L50 82 Z',
  eye: 'M2 50 C18 22 34 12 50 12 C66 12 82 22 98 50 C82 78 66 88 50 88 C34 88 18 78 2 50 Z M50 29 a21 21 0 1 0 0.1 0 z M50 39 a11 11 0 1 1 -0.1 0 z',
  anvil:
    'M6 22 H60 C60 34 52 42 40 44 L62 44 C78 44 90 32 94 22 L94 42 C94 52 84 58 74 60 L70 76 L86 76 L92 96 L14 96 L20 76 L34 76 L30 44 L18 44 C10 44 6 36 6 30 Z',
  flame:
    'M50 2 C50 22 30 30 30 52 C30 62 34 70 40 76 C36 66 40 58 48 52 C48 66 58 70 58 82 C58 88 55 93 50 96 C68 92 78 76 78 58 C78 34 62 18 50 2 Z',
  key: 'M34 2 C48 2 60 14 60 28 C60 39 53 49 43 53 L43 74 L54 74 L54 84 L43 84 L43 96 L25 96 L25 53 C15 49 8 39 8 28 C8 14 20 2 34 2 Z M34 16 C27 16 22 21 22 28 C22 35 27 40 34 40 C41 40 46 35 46 28 C46 21 41 16 34 16 Z',
  antenna:
    'M45 34 H55 L64 98 H36 Z M50 12 a11 11 0 1 1 -0.1 0 z M27 8 C17 17 12 30 14 44 L25 40 C24 30 27 22 34 15 Z M73 8 L66 15 C73 22 76 30 75 40 L86 44 C88 30 83 17 73 8 Z',
  syringe: 'M44 0 H56 V6 H74 V18 H66 V64 L56 76 V100 H44 V76 L34 64 V18 H26 V6 H44 Z',
  crosshair:
    'M50 2 C76 2 98 24 98 50 C98 76 76 98 50 98 C24 98 2 76 2 50 C2 24 24 2 50 2 Z M50 16 C31 16 16 31 16 50 C16 69 31 84 50 84 C69 84 84 69 84 50 C84 31 69 16 50 16 Z M46 22 H54 V44 H46 Z M46 56 H54 V78 H46 Z M22 46 H44 V54 H22 Z M56 46 H78 V54 H56 Z',
  moth: 'M50 18 C44 4 24 0 13 13 C2 26 7 46 24 52 C9 58 5 77 17 89 C30 100 46 89 50 74 C54 89 70 100 83 89 C95 77 91 58 76 52 C93 46 98 26 87 13 C76 0 56 4 50 18 Z M46 22 H54 L51 98 H49 Z',
  drop: 'M50 2 C50 2 84 44 84 66 C84 84 69 98 50 98 C31 98 16 84 16 66 C16 44 50 2 50 2 Z',
  spade:
    'M50 2 C50 2 88 38 88 62 C88 76 78 86 66 86 C60 86 55 83 52 79 L58 96 L42 96 L48 79 C45 83 40 86 34 86 C22 86 12 76 12 62 C12 38 50 2 50 2 Z',
};

/**
 * One emblem on its own, with no badge behind it.
 *
 * The emblem picker needs this and the shape and pattern pickers do not, which is the difference
 * between *what is being chosen* and *what it looks like in place*. A shape swatch showing the
 * whole badge is right: the silhouette is the decision. An emblem swatch showing the whole badge is
 * wrong: on a patterned ground at 26px the emblem is four pixels of detail, and eighteen of them
 * are visibly identical. Asked and answered by looking at a screenshot of the row.
 */
export function PropGlyph({
  prop,
  color,
  size = 22,
}: {
  prop: BadgeProp;
  color: string;
  size?: number;
}) {
  const path = PROPS[prop];
  if (!path) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className="flex items-center justify-center font-display text-[10px] uppercase tracking-[0.1em] text-ink-400"
      >
        none
      </span>
    );
  }
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="shrink-0">
      <path d={path} fill={color} fillRule="evenodd" />
    </svg>
  );
}

export function FactionBadge({
  badge,
  size = 48,
  className,
  title,
}: {
  badge: Badge;
  size?: number;
  className?: string;
  /** Given to the SVG as its accessible name. Omit inside a control that already names it. */
  title?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const clipId = `badge-clip-${uid}`;
  const inkId = `badge-ink-${uid}`;
  const ground = BADGE_COLOR_VALUES[badge.ground].hex;
  const fieldColor = BADGE_COLOR_VALUES[badge.fieldColor].hex;
  const ink = BADGE_COLOR_VALUES[badge.ink].hex;
  const field = FIELDS[badge.field];
  const prop = PROPS[badge.prop];
  // Below this the wobble moves more than the line it is wobbling, and a 20px badge just smears.
  const drawn = size >= 28;

  return (
    <svg
      viewBox="0 0 100 120"
      width={size}
      height={(size * 120) / 100}
      className={cn('shrink-0 overflow-visible', className)}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={SHAPES[badge.shape]} />
        </clipPath>
        {drawn && (
          <filter id={inkId} x="-12%" y="-12%" width="124%" height="124%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="11" />
            <feDisplacementMap in="SourceGraphic" scale="1.7" />
          </filter>
        )}
      </defs>

      <g filter={drawn ? `url(#${inkId})` : undefined}>
        <g clipPath={`url(#${clipId})`}>
          <path d={SHAPES[badge.shape]} fill={ground} />
          {field && <path d={field} fill={fieldColor} />}
          {prop && (
            // The emblem, dropped into the middle of the field at a fixed size. `evenodd` is what
            // makes the skull's eyes holes rather than shapes painted over it in the same colour.
            <g transform="translate(20 27) scale(0.6)">
              <path d={prop} fill={ink} fillRule="evenodd" />
            </g>
          )}
        </g>
        {/* The rule around the edge, drawn last so it sits over the pattern rather than under it. */}
        <path
          d={SHAPES[badge.shape]}
          fill="none"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
