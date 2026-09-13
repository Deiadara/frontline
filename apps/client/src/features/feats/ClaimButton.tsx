import { useId } from 'react';
import { cn } from '../../lib/cn';

/**
 * CLAIM: the one control on the feats screen, drawn rather than pressed out of metal.
 *
 * The kit already has two buttons and neither is right here. `Button` is a struck brass plate, the
 * machine affordance a Train or a Buy wants; `InkButton` is the drawn box, but it is a `Link` and
 * this commits a write. So this is the third: the ink box's own grammar (a rectangle gone round
 * one and a bit times, overshooting the corner it started at) on a real `<button>`, with the face
 * behind it filled so that it is unmistakably the thing to hit on a card of six.
 *
 * The wobble is a `feTurbulence` and `feDisplacementMap` pair, the same one `PortraitFrame` and
 * `MissionGauge` use, on a path drawn *inside* the element rather than as a `border-image`. That
 * is what lets the stroke keep its thickness when the label is two characters longer: the box is
 * `preserveAspectRatio="none"`, so the drawing stretches, and the deliberate second pass along the
 * bottom edge is what a hand does rather than something the stretch introduced.
 *
 * Pressing it is animated on the *face*, not on the frame: the whole button drops a pixel and the
 * fill dims, which reads as paper being pushed rather than as a border changing colour.
 */
export function ClaimButton({
  onClick,
  pending = false,
  label = 'CLAIM',
  ariaLabel = 'Claim this feat',
  className,
  'data-testid': testId,
}: {
  onClick: () => void;
  /** The claim is in flight. The button stays in place and stops taking a second press. */
  pending?: boolean;
  label?: string;
  /**
   * What a screen reader says, which is not always the four letters on the face.
   *
   * `CLAIM` alone is meaningless read aloud out of the row it sits in, so the default spells out
   * what is being claimed. It is a prop rather than a constant because this button is also the
   * collect-everything door at the head of the board, and two buttons on one screen announcing
   * themselves identically is the exact confusion the label exists to prevent.
   */
  ariaLabel?: string;
  className?: string;
  'data-testid'?: string;
}) {
  const id = useId();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      // `confirm`, the sound every press that banks or spends makes. Read by the delegated
      // listener in `lib/sound.ts`, the same way `Button` declares its own.
      data-sound="confirm"
      data-testid={testId}
      aria-label={ariaLabel}
      className={cn(
        'group/claim relative inline-flex shrink-0 items-center justify-center',
        'px-3.5 py-1.5 font-stamp text-[15px] leading-none tracking-[0.08em]',
        'text-brass-100 transition-all duration-150 ease-out',
        'hover:-translate-y-px hover:text-ink-100 active:translate-y-px',
        'disabled:cursor-progress disabled:opacity-60 disabled:hover:translate-y-0',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300',
        className,
      )}
    >
      <svg
        viewBox="0 0 120 40"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <filter id={`claim-${id}`} x="-10%" y="-20%" width="120%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="13" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="1.8"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <g filter={`url(#claim-${id})`}>
          {/* The face. Brass at a low alpha rather than a solid fill: the sheet under it is paper
              with a wash on it, and a flat brass rectangle would read as a sticker on top of it. */}
          <path
            d="M5 4 L115 3 L117 36 L4 37 Z"
            className="fill-brass-500/25 transition-all duration-150 group-hover/claim:fill-brass-500/40 group-active/claim:fill-brass-500/15"
          />
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4 L115 3 L117 36 L4 37 Z" strokeWidth="1.8" opacity="0.95" />
            {/* The overshoot: the pen carries on past the corner it closed at, twice along the
                bottom, which is the tell that separates a drawn box from a rounded one. */}
            <path d="M4 37 L9 34 L34 35" strokeWidth="1.3" opacity="0.6" />
            <path d="M115 3 L112 6" strokeWidth="1.2" opacity="0.45" />
          </g>
        </g>
      </svg>
      <span className="relative">{pending ? 'TAKING' : label}</span>
    </button>
  );
}
