import { cn } from '../lib/cn';
import wordmarkUrl from './wordmark.webp';

/**
 * The game's wordmark.
 *
 * Deliberately *not* a manifest asset. `ART_MANIFEST` is an order sheet for art that can be
 * regenerated: every entry resolves to a domain id, carries a prompt, and must name a backend that
 * could produce it. A 64:27 transparent brand plate satisfies none of those: it has no domain id,
 * no backend renders that shape with alpha, and there is no interim look to fall back to because a
 * game with no name on the door is not a state worth modelling. So it ships as an ordinary import,
 * always present, versioned by git like any other source file.
 *
 * Redrawing it means replacing `wordmark.webp` (encode the master to 1024px wide, WebP q92).
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <img
      src={wordmarkUrl}
      alt="FRONTLINE"
      // No default width: `cn` is plain `clsx` and does not resolve Tailwind conflicts, so a
      // `w-full` here would race the caller's own width class in stylesheet order rather than
      // losing to it. The caller sizes it; this only guarantees it never overflows.
      className={cn('h-auto max-w-full object-contain', className)}
      data-testid="wordmark"
    />
  );
}
