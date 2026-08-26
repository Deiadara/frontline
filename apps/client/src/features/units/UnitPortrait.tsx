import type { UnitTier } from '@frontline/shared';
import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';

/**
 * A roster card's portrait (GDD §A5): the painted master once `unit-<id>` has been delivered, and
 * a tier-tinted silhouette until then.
 *
 * The interim look is keyed to the **tier** rather than to the unit, because that is the one thing
 * about an undelivered unit the player can still be told at a glance: rabble are dim, legendaries
 * are lit. Twenty-seven distinguishable code-drawn figures would be a second art project, and the
 * card's name, stat block and blurb already separate them.
 */

const TIER_TINTS: Record<UnitTier, string> = {
  // Dimmer than rabble, and deliberately: a porter is the one tier that is not a soldier at all.
  support: 'from-surface-800/60 text-ink-100/8',
  rabble: 'from-surface-700/60 text-ink-100/10',
  regular: 'from-ferrite-700/50 text-ink-100/12',
  specialist: 'from-hextech-500/25 text-ink-100/15',
  heavy: 'from-warning/20 text-ink-100/15',
  legendary: 'from-oxblood-300/25 text-ink-100/20',
};

export function UnitPortrait({
  unitId,
  tier,
  className,
  /**
   * Take the height from the box and work the width out from the aspect, rather than the reverse.
   *
   * The roster card is a fixed frame so that every Train button lands on the same line, and its
   * height is a constant. Given that, `h-full` plus the picture's own 3:4 gives a frame that is
   * exactly the shape of the painting: nothing cropped, and no band of card showing above or below
   * it. The two earlier readings each lost one of those, cropping the chin off in one and leaving a
   * mat in the other.
   */
  fill = false,
}: {
  unitId: string;
  tier: UnitTier;
  className?: string;
  fill?: boolean;
}) {
  const painted = deliveredUrl({ type: 'unit', unitId });
  return (
    <div
      className={cn(
        // No fixed width: the roster card gives the portrait a whole column and it fills it. The
        // old `w-14` made it a thumbnail beside a heading whatever the card did.
        'relative shrink-0 overflow-hidden border border-surface-700 bg-gradient-to-b to-surface-950',
        fill ? 'aspect-[3/4] h-full' : 'aspect-[3/4] w-full',
        TIER_TINTS[tier],
        className,
      )}
      data-testid={`unit-portrait-${unitId}`}
    >
      {painted === null ? (
        // The same head-and-shoulders mark the overseer avatar falls back to, at roster scale.
        <svg
          viewBox="0 0 48 64"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMax meet"
          aria-hidden="true"
        >
          <circle cx="24" cy="22" r="11" fill="currentColor" />
          <path d="M4 64c0-13 9-21 20-21s20 8 20 21z" fill="currentColor" />
        </svg>
      ) : (
        <img
          src={painted}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          data-testid={`unit-art-${unitId}`}
        />
      )}
    </div>
  );
}
