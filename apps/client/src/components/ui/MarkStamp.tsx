import { type OfficerMark } from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * An officer's mark for the chair they are in, stamped over their portrait.
 *
 * A stamp rather than a badge, and drawn rather than typed. The rest of this interface is printed
 * matter: plates, rules, stencilled labels. A mark is the one thing on a crew card that somebody
 * *did* to the file after it was filed, so it reads as ink pressed onto the picture, off the square,
 * with the ring broken where a real one lifts early.
 *
 * Red because nothing else on these screens is. Brass is the interface, verdigris is ownership,
 * oxblood is loss; a mark is none of those and needs to be findable at a glance across a grid of
 * nineteen faces.
 *
 * Deliberately not a rating bar. The score behind this moves whenever a single attribute is
 * trained, and a bar would invite reading a precision that is not there: the letter is coarse on
 * purpose, and everything an officer actually pays out is computed from the points instead.
 */
export function MarkStamp({
  mark,
  className,
  title,
}: {
  mark: OfficerMark;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cn('pointer-events-none absolute select-none', className)}
      data-testid={`mark-stamp-${mark}`}
      title={title ?? `Fit for this chair: ${mark}`}
    >
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={`Mark ${mark}`}
      >
        <defs>
          {/*
           * The ink itself. A stamp is never flat: the pad loads unevenly, so the fill is roughed
           * up with turbulence and the edges bitten into rather than drawn clean.
           */}
          <filter id="mark-ink" x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="2.4"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <g
          filter="url(#mark-ink)"
          transform="rotate(-13 50 50)"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        >
          {/* Two rings, neither of them closed: a hand lifts before it comes back round. */}
          <path
            d="M 50 8 A 42 42 0 1 1 49.6 8 M 12 62 A 42 42 0 0 0 88 62"
            strokeWidth="5"
            opacity="0.92"
          />
          <path d="M 50 17 A 33 33 0 1 1 49.7 17" strokeWidth="2" opacity="0.55" />
        </g>
        <text
          x="50"
          y="50"
          transform="rotate(-13 50 50)"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          filter="url(#mark-ink)"
          className="font-display font-bold"
          // Sized in user units so the letter fills the ring at any rendered size. Two characters
          // ("S+") and one ("S") have to sit on the same baseline and neither may touch the ring.
          style={{ fontSize: mark.length > 1 ? '40px' : '48px', letterSpacing: '-0.04em' }}
        >
          {mark}
        </text>
      </svg>
    </span>
  );
}
