import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';

/**
 * An officer's face, from the pool (§C).
 *
 * Separate from `OverseerPortrait` and not a prop on it, because the two are different objects. An
 * overseer portrait is one of four the player *chose* and is shown as a hero image; an officer's is
 * one of thirty-three drawn from a pool by their id, at 4:5, on a roster card. Sharing a component
 * would mean a prop deciding the aspect, the fallback and the frame, which is three components
 * wearing one name.
 *
 * The fallback is the officer's initial rather than a silhouette: thirty-three identical
 * silhouettes on a crew screen say nothing, and a letter at least tells them apart while the art
 * is still landing.
 */
export function OfficerPortrait({
  portraitId,
  name,
  className,
}: {
  /** From `officerPortraitId(officer.id)`. Null while a caller has not resolved one. */
  portraitId: string | null;
  /** For the fallback letter and the accessible name. */
  name: string;
  className?: string;
}) {
  const painted = portraitId === null ? null : deliveredUrl({ type: 'officer', portraitId });
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-sm border border-surface-600/70 bg-surface-900',
        className,
      )}
    >
      {painted ? (
        <img
          src={painted}
          alt=""
          // The delivery frames the face in the central seventy percent, so any crop keeps it.
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center font-stamp text-[28px] text-ink-100/25"
        >
          {name.slice(0, 1)}
        </span>
      )}
    </div>
  );
}
