import type { UnitTier } from '@frontline/shared';
import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';

/**
 * A roster card's portrait (GDD §A5): the painted master once `unit-<id>` has been delivered, and
 * a tier-tinted silhouette until then.
 *
 * The interim look is keyed to the **tier** rather than to the unit, because that is the one thing
 * about an undelivered unit the player can still be told at a glance — rabble are dim, legendaries
 * are lit. Twenty-seven distinguishable code-drawn figures would be a second art project, and the
 * card's name, stat block and blurb already separate them.
 */

const TIER_TINTS: Record<UnitTier, string> = {
  rabble: 'from-steel-800/60 text-steel-100/10',
  regular: 'from-ferrite-700/50 text-steel-100/12',
  specialist: 'from-hextech-500/25 text-steel-100/15',
  heavy: 'from-warning/20 text-steel-100/15',
  legendary: 'from-neon-magenta/25 text-steel-100/20',
};

export function UnitPortrait({
  unitId,
  tier,
  className,
}: {
  unitId: string;
  tier: UnitTier;
  className?: string;
}) {
  const painted = deliveredUrl({ type: 'unit', unitId });
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden border border-steel-800 bg-gradient-to-b to-night',
        'aspect-[3/4] w-14',
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
