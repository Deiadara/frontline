import { ATTRIBUTE_GROUP_LABELS, type AttributeGroup } from '@frontline/shared';
import { ICON_GLYPHS, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';

/**
 * The mark each of the four training groups is known by, stamped rather than printed.
 *
 * The four columns of the sheet had the plain interface icon on a tin plate, which is the right
 * drawing in the wrong hand: everything else on this page is paper, ink and wash, and a square
 * plate with a crisp glyph on it reads as a button somebody screwed to the page. The research
 * tracks already solved this (`research/TrackSigil.tsx`): an open roundel and the glyph inside it,
 * both pushed through a displacement map so the line wobbles the way a pen does.
 *
 * Same filter and the same open roundel, so a player who has seen a track sigil recognises this as
 * the same hand. The glyph is the one the icon set already draws ({@link ICON_GLYPHS}), so the
 * four groups look the same here as they do in the drill dialog and anywhere else they appear.
 *
 * The wobble is the reason this is a sigil and not an icon: a roundel that closes exactly and a
 * stroke of constant width is a logo, and the only thing on this screen that is supposed to look
 * machine-made is the numbers.
 */

/** Which glyph stands for which group. The icon set's own names, so there is one drawing each. */
const GLYPH: Readonly<Record<AttributeGroup, IconName>> = {
  physical: 'physical',
  mental: 'mental',
  social: 'social',
  technical: 'technical',
};

export function DrillSigil({ group, className }: { group: AttributeGroup; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={`${ATTRIBUTE_GROUP_LABELS[group]} drills`}
    >
      <defs>
        {/*
         * One filter id per group rather than one shared one.
         *
         * All four sigils are on the page at once, and an id is document-wide: four `<defs>` under
         * one name is four redefinitions of the same filter, which browsers resolve to whichever
         * happened to mount last. It works by accident while the filters are identical and stops
         * working the moment one of them is not, so the ids are distinct from the start.
         */}
        <filter id={`drill-ink-${group}`} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="1.6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g
        filter={`url(#drill-ink-${group})`}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Open at the lower left, where a hand comes off the page. */}
        <path
          d="M50 8 A42 42 0 1 1 49.6 8 M16 73 A42 42 0 0 0 84 73"
          strokeWidth="3.6"
          opacity="0.72"
        />
        {/*
         * The glyph is drawn on a 24 grid, so it is scaled up and centred in the roundel.
         *
         * 2.4 rather than the 2 the track sigils use, which is a correction rather than a taste:
         * these are drawn at 32px against a track sigil's 48, and at that size a glyph filling
         * 57% of the roundel is a smudge with a ring round it. At 2.4 it fills about 69% and the
         * head, the bar and the board are all still readable.
         *
         * Each path in the icon set carries `strokeWidth: 1.6`, which comes out at 3.8 under this
         * scale and sits a touch heavier than the ring. That is the right way round: the ring is
         * the frame and the glyph is the subject.
         */}
        <g transform="translate(21.2 21.2) scale(2.4)">{ICON_GLYPHS[GLYPH[group]]}</g>
      </g>
    </svg>
  );
}
