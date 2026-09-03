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
  archetype: OverseerArchetype;
  /**
   * Box shape.
   *
   * `portrait` (3:4) per the layout rules and `square` for compact avatars both *crop* to fill
   * their box, which is right for an avatar: the delivery is framed face-in-the-central-70% so a
   * crop always lands on the face.
   *
   * `fill` is the other kind of placement. The box is whatever height the parent has left, and the
   * whole painting is fitted inside it rather than cropped to it, so nothing is ever cut off. For
   * the one screen that is *about* the portrait rather than using it as a label. Its box is the
   * *delivery's* shape rather than the layout's, which is what makes that true: see below.
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
    <div
      className={cn(
        'relative overflow-hidden border border-surface-600/70 bg-gradient-to-b',
        aspect !== 'fill' && 'w-full',
        aspect === 'portrait' && 'aspect-[3/4]',
        aspect === 'square' && 'aspect-square',
        /*
         * Height from the parent, width from the picture, and **2:3 because that is the picture**.
         *
         * The leftover height decides how big the portrait is and the width follows from it, so the
         * frame is exactly the shape of the painting. The first version filled the parent's width
         * and fitted the image inside with `object-contain`, which showed the whole picture but
         * left a bar of panel down each side of it: a framed picture in a frame the wrong shape.
         *
         * The second version had the right idea and the wrong number. The box was `aspect-[3/4]`
         * and the delivered portraits are 928x1392, which is 2:3 (`ASSET_CLASS_SPECS.portrait` is
         * 1024x1536, the same ratio, mislabelled `'3:4'` beside its own numbers). Covering a 0.75
         * box with a 0.667 picture scales it by 1.125, so 11% of the height went: 5.6% off the top
         * of the head and 5.6% off the bottom, on the one screen whose comment promises nothing is
         * cut at any size.
         */
        aspect === 'fill' && 'aspect-[2/3] h-full max-w-full',
        gradientFor(portraitId),
        className,
      )}
    >
      {painted ? (
        // The 3:4 delivery is framed face-in-the-central-70%, so a square avatar can crop to fill.
        <img src={painted} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Silhouette />
      )}
      <div className="grain pointer-events-none absolute inset-0 opacity-60" />
      {showTag && (
        <span className="absolute bottom-1.5 left-1.5 border border-brass-300/30 bg-surface-950/70 px-1.5 py-0.5 font-display text-[8px] uppercase tracking-[0.2em] text-brass-300">
          {archetype}
        </span>
      )}
    </div>
  );
}
