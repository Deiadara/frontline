import type { OverseerArchetype } from '@frontline/shared';
import { cn } from '../../lib/cn';

/** On-brand gradient options (theme tokens only), picked deterministically by portraitId. */
const GRADIENTS = [
  'from-neon-cyan/30 via-night-overlay to-night',
  'from-neon-magenta/30 via-night-overlay to-night',
  'from-warning/25 via-night-overlay to-night',
  'from-steel-500/30 via-night-overlay to-night',
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

/**
 * Portrait placeholder locked to a fixed aspect box (per the layout rules). No
 * real art yet, so a deterministic gradient + operative silhouette keyed to
 * portraitId.
 */
export function OverseerPortrait({
  portraitId,
  archetype,
  aspect = 'portrait',
  showTag = true,
  className,
}: OverseerPortraitProps) {
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden border border-neon-cyan/20 bg-gradient-to-b',
        aspect === 'portrait' ? 'aspect-[3/4]' : 'aspect-square',
        gradientFor(portraitId),
        className,
      )}
    >
      <div className="grain pointer-events-none absolute inset-0 opacity-60" />
      <svg
        viewBox="0 0 64 80"
        className="absolute inset-0 h-full w-full text-steel-100/15"
        preserveAspectRatio="xMidYMax meet"
        aria-hidden="true"
      >
        <circle cx="32" cy="26" r="14" fill="currentColor" />
        <path d="M8 80c0-16 11-26 24-26s24 10 24 26z" fill="currentColor" />
      </svg>
      {showTag && (
        <span className="absolute bottom-1.5 left-1.5 border border-neon-cyan/30 bg-night/70 px-1.5 py-0.5 font-display text-[8px] uppercase tracking-[0.2em] text-neon-cyan">
          {archetype}
        </span>
      )}
    </div>
  );
}
