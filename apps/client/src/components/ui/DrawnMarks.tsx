import { useId } from 'react';
import { cn } from '../../lib/cn';
import { ICON_GLYPHS, type IconName } from './Icon';

/**
 * The drawn furniture the paper screens share (maintainer, 2026-09-17).
 *
 * These started on the feats board, which is where the reasoning for them is: the kit has a
 * struck brass plate (`Button`) and a drawn box that is a link (`InkButton`), and neither is right
 * for a control on a sheet of paper that commits a write. The archive was asked for the same hand,
 * and two copies of a hand-inked rectangle is one copy too many, so the drawings live here and the
 * screens keep their own colours.
 *
 * Every one of them carries a `useId` suffix on its filter. A screen draws a dozen of these, and a
 * hard-coded filter id would have all of them referencing whichever one the browser saw first: on a
 * page that mounts and unmounts as a list changes, that is a drawing that loses its wobble the
 * moment its owner is scrolled past.
 */

/**
 * Any icon in the set, put through the pen (maintainer, 2026-09-22).
 *
 * The training sigils (`DrillSigil`) already do this for four glyphs: take the icon set's own
 * drawing and push it through a displacement map so the line wobbles the way a pen does. This is
 * that, for any name, without the roundel. It exists so the big marks on a shut door, the red
 * padlock on a nav tile and the slot figure on a unit card are all the *same* drawings the icon
 * set draws small, rather than a second set that resembles them; a player who has learnt one mark
 * has learnt the other.
 *
 * Sized and coloured by whatever it is dropped into. Filled glyphs (the infamy spade) keep their
 * fill; the wobble moves the edge either way.
 */
export function DrawnGlyph({ name, className }: { name: IconName; className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" className={cn('overflow-visible', className)} aria-hidden>
      <defs>
        <filter id={`glyph-${id}`} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="0.9"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#glyph-${id})`} strokeLinecap="round" strokeLinejoin="round">
        {ICON_GLYPHS[name]}
      </g>
    </svg>
  );
}

/** The ink every mark is drawn in, so one screen reads as one hand. */
const INK = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * A disc somebody ringed on a page: round one and a bit times, overshooting where it started.
 *
 * Sized and coloured by whatever it is dropped into, so a 36px rung mark and a 32px step number
 * are the same drawing at two sizes rather than two drawings that resemble each other.
 */
export function DrawnDisc() {
  const id = useId();

  return (
    <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <filter id={`disc-${id}`} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="23" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="1.7"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#disc-${id})`} {...INK}>
        <path d="M18 2.4 A15.6 15.6 0 1 1 17.4 2.4" strokeWidth="1.7" opacity="0.9" />
        <path d="M18 5.4 A12.6 12.6 0 0 1 30.4 20" strokeWidth="1" opacity="0.4" />
      </g>
    </svg>
  );
}

/**
 * The drawn box behind a pressable face (maintainer, 2026-09-17).
 *
 * Lifted out of `ClaimButton`, which is where the drawing and the reasoning for it started: the kit
 * has a struck brass plate (`Button`) and a drawn box that is a link (`InkButton`), and neither is
 * right for a control on a sheet of paper that commits a write. The maintainer asked for the
 * filters to be drawn the same way, and two copies of a hand-inked rectangle is one copy too many,
 * so the drawing lives here with the rest of this screen's furniture.
 *
 * `preserveAspectRatio="none"` is what lets one path serve a four-letter chip and a fourteen-letter
 * button: the box stretches to whatever it is put on. The deliberate second pass along the bottom
 * edge is the tell that separates a drawn box from a rounded one, and it survives the stretch
 * because it is drawn inside the element rather than as a `border-image`.
 *
 * ## Why the line hugs the edge, and why the stroke does not scale
 *
 * The first version was inset five units of a hundred and twenty, which is four per cent of the
 * width rather than four pixels of it. On a chip that is nothing; on `YOUR HEAD SPY MUST BE B OR
 * BETTER`, three hundred pixels wide, it is thirteen pixels, and the pen came down **on the label**
 * (maintainer, 2026-09-17). `.ink-field` in `index.css` records the same failure from the other
 * direction and the same fix: bring the path to the edge and halve the wobble, so what is left for
 * the text to clear is a couple of pixels rather than a share of the width.
 *
 * `vectorEffect="non-scaling-stroke"` is the other half. A stroke drawn in user units is stretched
 * with everything else, so a box three times wider than its viewBox had sides three times heavier
 * than its top and bottom: a drawn rectangle with two fat edges reads as a mistake rather than as a
 * hand. Kept out of the filter's way by sitting on the paths themselves.
 *
 * `face` is the fill, passed in rather than fixed, because the same drawing has to read as pressed,
 * unpressed and hovered without a second copy of the path.
 */
/** The box itself, a couple of units off the edge so the stroke is not clipped by the viewBox. */
const BOX = 'M3 3 L117 2 L118 37 L2 38 Z';

export function DrawnFace({ face }: { face: string }) {
  const id = useId();

  return (
    <svg
      viewBox="0 0 120 40"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <filter id={`face-${id}`} x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="13" />
          {/* Half the displacement the first version used: the wobble is in user units too, so on
              a wide button it was stretched into the label along with the line. */}
          <feDisplacementMap
            in="SourceGraphic"
            scale="1"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#face-${id})`}>
        {/* The face. A low alpha rather than a solid fill: the sheet under it is paper with a wash
            on it, and a flat rectangle would read as a sticker stuck on top of it. */}
        <path d={BOX} className={face} />
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        >
          <path d={BOX} strokeWidth="1.8" opacity="0.95" vectorEffect="non-scaling-stroke" />
          {/* The overshoot: the pen carries on past the corner it closed at, twice along the
              bottom, which is the tell that separates a drawn box from a rounded one. */}
          <path
            d="M2 38 L6 35.5 L28 36.5"
            strokeWidth="1.3"
            opacity="0.6"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M117 2 L114.5 4.5"
            strokeWidth="1.2"
            opacity="0.45"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </g>
    </svg>
  );
}

/**
 * A circled "i", inked rather than set (maintainer, 2026-09-17).
 *
 * "Make the info icon a hand drawn graphic." The kit's `info` glyph is a geometric circle with a
 * geometric stem in it, which is correct on a form and wrong beside a `font-stamp` title on paper:
 * it is the one mark on those chips that plainly came out of a different pen.
 *
 * Same ring as `DrawnDisc`, drawn once round and overshooting, with the stem and its dot as two
 * more strokes. It takes its size and its colour from whatever it is dropped into, so the chip's
 * `h-3 w-3` and the window header's larger alcove are one drawing at two sizes.
 */
export function DrawnInfo() {
  const id = useId();

  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <defs>
        <filter id={`info-${id}`} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="7" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="1.35"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#info-${id})`} {...INK}>
        {/* The ring, carried a little past where it started, the way a pen does. */}
        <path d="M12 2.2 A9.8 9.8 0 1 1 11.5 2.25" strokeWidth="1.8" opacity="0.95" />
        {/* The stem, and the dot over it. Two strokes, not a glyph. */}
        <path d="M12 10.6 L11.8 17.2" strokeWidth="1.9" opacity="0.95" />
        <path d="M12 6.7 L12 7.1" strokeWidth="2.1" opacity="0.95" />
      </g>
    </svg>
  );
}

/**
 * A ruled-off line, the way somebody totalling a column draws one.
 *
 * `preserveAspectRatio="none"` for the same reason `DrawnFace` uses it: one path has to serve a
 * narrow card and a wide sheet. The second, shorter pass under the first is the tell, the same
 * overshoot the drawn box carries along its bottom edge, and `non-scaling-stroke` keeps both at
 * one weight however far the line is stretched.
 */
export function DrawnRule() {
  const id = useId();

  return (
    <svg viewBox="0 0 200 8" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <filter id={`rule-${id}`} x="-5%" y="-60%" width="110%" height="220%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="31" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="1.4"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#rule-${id})`} {...INK} vectorEffect="non-scaling-stroke">
        <path
          d="M2 3.4 L198 2.8"
          strokeWidth="1.6"
          opacity="0.9"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M6 5.6 L74 5.2"
          strokeWidth="1.1"
          opacity="0.45"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
