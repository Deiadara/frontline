import type { OverseerArchetype } from '@frontline/shared';
import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';

/** On-brand gradient options (theme tokens only), picked deterministically by portraitId. */
const GRADIENTS = [
  'from-verdigris-500/40 via-surface-800 to-surface-950',
  'from-oxblood-500/40 via-surface-800 to-surface-950',
  'from-brass-500/35 via-surface-800 to-surface-950',
  'from-surface-500/50 via-surface-800 to-surface-950',
] as const;

function gradientFor(portraitId: string): string {
  let hash = 0;
  for (const ch of portraitId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length] ?? GRADIENTS[0];
}

interface OverseerPortraitProps {
  portraitId: string;
  /**
   * What they are good at, for the tag in the corner. Optional, and drawn only when `showTag` is
   * on and it is actually known: a faction roster row carries a portrait id and no archetype
   * (`FactionMemberSchema`), and the tag is the only thing on this component that wants one.
   */
  archetype?: OverseerArchetype;
  /**
   * Box shape.
   *
   * `portrait` (3:4) per the layout rules and `square` for compact avatars both *crop* to fill
   * their box, which is right for an avatar: the delivery is framed face-in-the-central-70% so a
   * crop always lands on the face.
   *
   * `fill` is the other kind of placement: take the whole box the parent gives it, both ways, and
   * crop to it. The shape is then the *caller's* to choose, which is the point. A framed picture
   * sets the shape on the frame and lets the painting take all of it, so the frame is the edge of
   * the picture rather than a box with a picture floating inside it.
   */
  aspect?: 'portrait' | 'square' | 'fill';
  /** Hide the archetype tag on tiny avatars. */
  showTag?: boolean;
  className?: string;
}

/** The interim look: an operative silhouette over the portrait's gradient (ADR 0001 §5.3). */
function Silhouette() {
  return (
    <svg
      viewBox="0 0 64 80"
      className="absolute inset-0 h-full w-full text-ink-100/15"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
    >
      <circle cx="32" cy="26" r="14" fill="currentColor" />
      <path d="M8 80c0-16 11-26 24-26s24 10 24 26z" fill="currentColor" />
    </svg>
  );
}

/**
 * Portrait locked to a fixed aspect box (per the layout rules). Shows the painted portrait once
 * `portrait-<portraitId>` has been delivered, and the deterministic gradient + silhouette until
 * then: the delivered-or-procedural call belongs to `deliveredUrl`, not to this component.
 */
export function OverseerPortrait({
  portraitId,
  archetype,
  aspect = 'portrait',
  showTag = true,
  className,
}: OverseerPortraitProps) {
  const painted = deliveredUrl({ type: 'portrait', portraitId });
  return (
    /*
     * A `<span>` with `display: block`, which lays out exactly as the `<div>` this was, and is
     * legal in one place a `<div>` is not: inside a `<button>`. The faction roster's rows are
     * `HoverCard` triggers, which are real buttons, and a button may hold phrasing content only.
     */
    <span
      className={cn(
        'relative block overflow-hidden border border-surface-600/70 bg-gradient-to-b',
        aspect !== 'fill' && 'w-full',
        aspect === 'portrait' && 'aspect-[3/4]',
        aspect === 'square' && 'aspect-square',
        /*
         * The whole box, both ways (maintainer request, 2026-09-13: the portrait leaves too much dead
         * space inside the template it sits in).
         *
         * The shape used to live here, as `aspect-[2/3] h-full`, and the frame around it was
         * whatever the panel was: on a 720-tall viewport that put a 120px-wide painting in the
         * middle of a 332px bordered box, which is the dead space the board is looking at. The
         * shape moved out to the caller's frame, and this takes all of whatever that frame is.
         *
         * Taking all of it means cropping to it, so the crop is aimed: `object-top` below. The
         * deliveries are 928x1392 with the head in the top half, and a box even slightly wider
         * than 2:3 takes its first bite off the top of the skull if the crop is centred.
         */
        aspect === 'fill' && 'h-full w-full',
        gradientFor(portraitId),
        className,
      )}
    >
      {painted ? (
        /*
         * Every crop is aimed at the **top**, in every shape (maintainer request, 2026-09-15: the
         * head has to fit comfortably at the size the standing bar draws it).
         *
         * The deliveries are 928x1392 with the head in the top half: the skull starts about 40px
         * down and the chin sits around 730. A centred crop therefore always takes its first bite
         * out of the top of the head, and the narrower the box the bigger the bite. Measured
         * against the delivery, a centred crop loses 232px at `square` and 77px at `portrait`,
         * so the one place the game drew a 40px avatar was the one place it cut the most.
         *
         * `object-top` only had the `fill` case before, where the same reasoning was already
         * written down. Nothing about that argument was specific to `fill`: it is a fact about how
         * the art is framed, so it belongs to all three shapes.
         *
         * This aims the crop rather than shrinking the picture, because it cannot do both: at
         * `object-cover` the scale is set by the box's narrow side, so in a square box the widest
         * view available *is* the full width of the delivery. Showing the face smaller than that
         * needs a taller box, which is the standing bar's layout rather than this component's.
         */
        <img
          src={painted}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        <Silhouette />
      )}
      <span className="grain pointer-events-none absolute inset-0 block opacity-60" />
      {showTag && archetype !== undefined && (
        <span className="absolute bottom-1.5 left-1.5 border border-brass-300/30 bg-surface-950/70 px-1.5 py-0.5 font-display text-[8px] uppercase tracking-[0.2em] text-brass-300">
          {archetype}
        </span>
      )}
    </span>
  );
}
