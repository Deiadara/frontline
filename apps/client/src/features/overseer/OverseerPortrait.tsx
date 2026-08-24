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
  /** Box shape. Portrait (3:4) per the layout rules; square for compact avatars. */
  aspect?: 'portrait' | 'square';
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
        'relative w-full overflow-hidden border border-surface-600/70 bg-gradient-to-b',
        aspect === 'portrait' ? 'aspect-[3/4]' : 'aspect-square',
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
