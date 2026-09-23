import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A picture frame round the Overseer's painting, drawn like a real one (maintainer, 2026-09-23).
 *
 * `PortraitFrame` is a console frame: brackets, bolts and a cold hairline, the same hand that drew
 * the buttons. The maintainer asked for the other thing on this one page: a frame the way a
 * painting is framed, moulding, mat and all, and drawn rather than machined. So, from the outside
 * in:
 *
 * - **The moulding.** A brass sheet lit from the top-left, drawn with a gradient for the bevel
 *   and a run of short diagonal hatching over it, the way a pen shades a carved edge. Two ink
 *   rules run along it, one at the outer edge and one at the inner, both put through the same
 *   fractal-noise displacement `DrawnRule` uses, so neither is straight.
 * - **The corners.** A rosette in each, a few strokes each, turned so the four are one drawing.
 * - **No mat.** There was a band of paper between the moulding and the picture, and it read as
 *   a gap of background rather than a mount (maintainer, 2026-09-23), so the picture meets the
 *   brass, with only a dark bevel line between them. The moulding has been narrowed twice since,
 *   by the same hand.
 *
 * The child is the picture and sets the size: the frame wraps it, so a 2:3 painting stays 2:3 and
 * uncropped inside a frame that is 2:3 plus one band.
 */
// 16 at first, then a quarter off, then a fifth off again (maintainer, 2026-09-23): 9.6, drawn
// as the nearest whole pixel.
const MOULDING = 10;

export function PictureFrame({ children, className }: { children: ReactNode; className?: string }) {
  const id = useId();
  const filterId = `frame-${id}`;
  const hatchId = `hatch-${id}`;

  return (
    <span
      className={cn('relative inline-block h-full rounded-[3px] shadow-panel', className)}
      style={{ padding: MOULDING }}
      data-testid="picture-frame"
    >
      {/* The moulding: brass, bevelled by the light. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-[3px]"
        style={{
          background:
            'linear-gradient(135deg, #a8742a 0%, #e0b264 18%, #8d5f1c 40%, #d9a955 58%, #77500f 82%, #b8843a 100%)',
          boxShadow:
            'inset 0 0 0 1px rgb(255 228 174 / 0.35), inset 0 0 0 3px rgb(60 38 8 / 0.35), 0 12px 28px -14px rgb(0 0 0 / 0.9)',
        }}
      />
      {/* The ink over the brass: hatching on the moulding and two rules that are not straight. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <defs>
          <filter id={filterId} x="-2%" y="-2%" width="104%" height="104%">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="17" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="0.9"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <pattern
            id={hatchId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <path d="M0 3 H6" stroke="#3d2606" strokeWidth="0.7" strokeOpacity="0.28" />
          </pattern>
        </defs>
        {/* The hatching sits only on the moulding: a ring, not a sheet. */}
        <path
          fillRule="evenodd"
          fill={`url(#${hatchId})`}
          d="M0 0 H100 V100 H0 Z M2.2 2.2 H97.8 V97.8 H2.2 Z"
        />
        <g
          fill="none"
          stroke="#2a1804"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${filterId})`}
          vectorEffect="non-scaling-stroke"
        >
          <path
            d="M1.2 1.4 L98.6 1 L99 98.8 L1 99.2 Z"
            strokeWidth="1.3"
            strokeOpacity="0.75"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M2.8 2.6 L97.4 3 L97 97.2 L3 97.4 Z"
            strokeWidth="0.9"
            strokeOpacity="0.5"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
      {/* The rosettes, one drawing turned four ways. */}
      {[
        'left-0 top-0',
        'right-0 top-0 rotate-90',
        'bottom-0 right-0 rotate-180',
        'bottom-0 left-0 -rotate-90',
      ].map((corner) => (
        <svg
          key={corner}
          aria-hidden
          viewBox="0 0 30 30"
          className={cn('pointer-events-none absolute h-[30px] w-[30px]', corner)}
        >
          <g
            fill="none"
            stroke="#2a1804"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeOpacity="0.8"
          >
            <path d="M6.5 6.2 C9 4.4 12.4 4.6 14.6 6.9 C16.5 9 16.1 12.2 13.8 14.1 C11.6 15.9 8.6 15.5 6.9 13.5 C5.1 11.4 5.2 8.3 6.5 6.2 Z" />
            <path d="M9.1 8.9 C10.3 8 11.8 8.3 12.5 9.4 C13.2 10.6 12.6 12 11.3 12.6 C10 13.1 8.7 12.4 8.4 11.2" />
            <path d="M15.6 5.2 C19.3 4.6 23.2 4.9 26.4 5.6" strokeOpacity="0.55" />
            <path d="M5.1 15.4 C4.6 19.2 4.8 23.1 5.5 26.5" strokeOpacity="0.55" />
            <path d="M16.2 10.4 C18.6 8.9 21.3 8.7 23.6 9.9" strokeOpacity="0.4" />
            <path d="M10.2 16.3 C8.8 18.7 8.6 21.4 9.7 23.7" strokeOpacity="0.4" />
          </g>
          <circle cx="10.4" cy="10.4" r="1.1" fill="#ffe4ae" fillOpacity="0.9" />
        </svg>
      ))}
      {/* The picture, on top of all of it. */}
      <span
        className="relative block h-full overflow-hidden rounded-[1px]"
        // The rebate: a dark line where the brass steps down to the picture, so the two meet as
        // a frame and a painting rather than as two rectangles.
        style={{ boxShadow: 'inset 0 0 0 1px rgb(42 24 4 / 0.8), inset 0 0 8px rgb(0 0 0 / 0.45)' }}
      >
        {children}
      </span>
    </span>
  );
}
