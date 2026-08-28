import { createContext, useContext, type ReactNode } from 'react';
import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';
import { useMeasuredSize, type MeasuredSize } from '../../lib/useMeasuredHeight';

/**
 * A painting that *is* the screen, with controls standing on it.
 *
 * The Bar and the City are both this: a place you are looking at rather than a document about one,
 * with the interactive parts drawn where the thing they act on is. The plate runs full bleed under
 * the standing bar and the nav, and every control is positioned in fractions of the **painting**
 * rather than of the frame, so a button drawn on a stool or a district stays on it at every
 * viewport instead of sliding off the moment somebody resizes a window.
 */

/** Where something stands on the painting, as a fraction of it. */
export interface OnPlateAt {
  readonly x: number;
  readonly y: number;
}

/**
 * How the painting is fitted into the frame.
 *
 * `cover` fills the frame and throws away whatever hangs off it, which is right for a plate that
 * was not painted for this screen's shape: the alternative there is a small picture in a big empty
 * box. `whole` shows the entire painting at its true aspect, every time, on every monitor.
 *
 * `whole` is what a plate painted *for* a screen wants, and the reason is consistency rather than
 * composition. Under `cover`, which slice of the picture you get depends on the shape of your
 * window, so the same screen is a different picture windowed, full screen, and on a second monitor.
 * A player cannot learn where anything is. The city is painted at 21:10 for exactly this frame, so
 * it is drawn `whole` and the surround is filled rather than cropped into.
 */
export type PlateFit = 'cover' | 'whole';

/**
 * How far a `whole` painting's cut edge fades into the surround, in frame pixels.
 *
 * A cut edge is what actually reads as a border. Matching the surround's brightness to the
 * painting's got the two within a few values of each other and the line was still there, because
 * the eye is not comparing greys, it is finding a straight boundary between detail and no detail.
 * Fade the last few pixels and there is no boundary to find.
 */
const FEATHER_PX = 36;

/**
 * The box the painting is drawn in, centred on the frame.
 *
 * Never distorted, in either mode: the aspect the picture is drawn at is always its own. That is
 * load-bearing rather than cosmetic, because everything on the plate is positioned as a fraction of
 * this box, and a stretch that varied with the window would slide the Bar's stool off its seat and
 * the city's tags off their roofs by an amount nobody could predict.
 */
export function fitting(
  room: MeasuredSize,
  aspect: number,
  fit: PlateFit,
): { width: number; height: number } {
  if (room.width <= 0 || room.height <= 0) return { width: 0, height: 0 };
  const byWidth = { width: room.width, height: room.width / aspect };
  const byHeight = { width: room.height * aspect, height: room.height };
  const fillsFrame = byWidth.height >= room.height;
  if (fit === 'cover') return fillsFrame ? byWidth : byHeight;
  return fillsFrame ? byHeight : byWidth;
}

/**
 * The part of the painting the frame is actually showing, in fractions of the painting.
 *
 * Not called `Window`, and the local is not called `window`: both did, and a type and a variable
 * that shadow the two DOM globals of the same names inside a React component are a trap laid for
 * whoever next reaches for `window.innerWidth` in here and silently gets a crop rectangle.
 *
 * Cover-cropping means a mark at `y: 0.12` can be off the top of the screen: the picture is taller
 * than the frame and its first tenth is cut away. The old Pixi map called this a `safeArea` and had
 * the same bug before it, with two districts sitting under the standing bar at 1024, visible in the
 * artwork and impossible to click.
 */
interface PlateView {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** The painting's rendered size, so a control can express its clearance in its own pixels. */
  readonly width: number;
  readonly height: number;
}

const WHOLE: PlateView = { minX: 0, maxX: 1, minY: 0, maxY: 1, width: 0, height: 0 };
const PlateWindow = createContext<PlateView>(WHOLE);

function visibleWindow(room: MeasuredSize, picture: { width: number; height: number }): PlateView {
  if (picture.width <= 0 || picture.height <= 0) return WHOLE;
  const cutX = Math.max(0, (picture.width - room.width) / 2) / picture.width;
  const cutY = Math.max(0, (picture.height - room.height) / 2) / picture.height;
  return {
    minX: cutX,
    maxX: 1 - cutX,
    minY: cutY,
    maxY: 1 - cutY,
    width: picture.width,
    height: picture.height,
  };
}

/** A control that floats on the painting: dark glass, a lit edge, and enough contrast to read. */
export function OnArt({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'glass-strong edge-lit rivets pointer-events-auto rounded-md border border-surface-500/70 shadow-panel',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PlateRoom({
  plate,
  aspect,
  fit = 'cover',
  testId,
  children,
}: {
  /** The plate key, already resolved to a `deliveredUrl` ref by the caller's screen. */
  plate: string;
  /** The painting's own shape, `width / height`. */
  aspect: number;
  /** See {@link PlateFit}. `whole` for a plate painted for this screen's shape. */
  fit?: PlateFit;
  testId: string;
  /** Drawn inside the painting's box, so `absolute` children position against the picture. */
  children: ReactNode;
}) {
  const [roomRef, room] = useMeasuredSize<HTMLDivElement>();
  const url = deliveredUrl({ type: 'plate', plate });
  const picture = fitting(room, aspect, fit);
  const view = visibleWindow(room, picture);
  /*
   * Which way the painting is short of the frame, so its cut edge can be feathered into the
   * surround on that axis only.
   *
   * A cut edge is what actually reads as a border. Matching the surround's brightness to the
   * painting's got the two within a few values of each other and the line was still there, because
   * the eye is not comparing greys, it is finding a straight vertical boundary between detail and
   * no detail. Fade the last few pixels out and there is no boundary to find. Only where there is
   * margin: feathering an edge that runs to the frame's own edge would dim the artwork for nothing.
   */
  const short: 'x' | 'y' | null =
    fit !== 'whole'
      ? null
      : picture.width < room.width - 1
        ? 'x'
        : picture.height < room.height - 1
          ? 'y'
          : null;
  // At most one axis, always: a contained box touches the frame on the other one by construction.
  const feather =
    short === null
      ? undefined
      : `linear-gradient(to ${short === 'x' ? 'right' : 'bottom'}, transparent, #000 ${FEATHER_PX}px, #000 calc(100% - ${FEATHER_PX}px), transparent)`;

  return (
    <div
      ref={roomRef}
      className="absolute inset-0 overflow-hidden bg-surface-950"
      data-testid={testId}
      style={{ paddingTop: 'var(--hud-h, 0px)', paddingBottom: 'var(--nav-h, 0px)' }}
    >
      {/*
       * `isolate`, and it is load-bearing.
       *
       * The vignette below is a sibling of the picture at `z-10` so the tags on the painting can
       * rise over it. Without a stacking context here, this box is `z-auto` and that `z-10` is
       * measured against the *page*, so it also rose over anything a screen drew after the room:
       * the Bar's payroll readout and its standing note went dark under it, which is what a
       * vignette does. Isolating keeps both z-values local to the picture, where they mean what
       * they were written to mean.
       */}
      <div className="relative isolate h-full w-full overflow-hidden">
        {/*
         * What fills the frame around a `whole` painting.
         *
         * A picture shown entire cannot also fill a frame of a different shape, so something has to
         * occupy the margin. Flat ground would read as two black bars, which is the letterboxing
         * this mode is otherwise worth avoiding. The same painting, over-scaled and blurred to
         * nothing, reads as the light of the place carrying on past the edge of the canvas, so the
         * frame is full and the picture inside it is still exactly the picture.
         */}
        {url !== null && fit === 'whole' && (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            data-scenery
            className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-[48px] saturate-[0.9]"
          />
        )}
        {/* Sized in pixels from a measurement rather than by CSS, for the reason the district
            scene spells out: `aspect-ratio` plus a `max-height` clamps the height without giving
            the width back, and the box quietly stops being the picture's shape. */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: picture.width, height: picture.height }}
        >
          {url !== null && (
            <img
              src={url}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-fill"
              style={
                feather === undefined ? undefined : { maskImage: feather, WebkitMaskImage: feather }
              }
            />
          )}
          {/* The tags ride above the frame's vignette, which is a sibling of this box rather than a
              child of it. `z-20` against the vignette's `z-10`: this box is `z-auto`, so its
              children share the frame's stacking context and can rise over it. */}
          <PlateWindow.Provider value={view}>
            <div className="absolute inset-0 z-20">{children}</div>
          </PlateWindow.Provider>
        </div>

        {/*
         * Darker at the edges than the plate paints, so the controls on it read without a scrim
         * over the middle of the picture.
         *
         * Over the **frame**, not over the picture, and that is what stops a `whole` painting
         * looking like it has been pasted onto a page. Confined to the picture it darkened the
         * artwork to near black at the edge and then stopped dead at the boundary, leaving the
         * lighter surround beside it: a straight vertical line between two greys, which the eye
         * reads as a border even when it is four pixels of difference. Carried across the whole
         * frame it darkens both the same, and there is no line to see.
         */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 50% 55%, transparent 35%, rgb(6 5 10 / 0.72) 100%)',
          }}
        />
      </div>
    </div>
  );
}

/**
 * How much room a control needs inside the visible window, **in pixels of the painting**.
 *
 * Pixels rather than a share of the picture, and that is the whole point. A fraction is the wrong
 * unit here: cover-cropping makes the painting shortest exactly when the frame is shortest, so a
 * constant fraction shrinks precisely when a tag needs the most room, and 9% of a 580px picture is
 * 52px against a tag that is 64px tall. It clipped the two top tags at 1024x768 and nowhere else.
 *
 * Taller above than below, because a bottom-anchored tag hangs upward off its own mark.
 */
const CLEARANCE_PX = { x: 100, above: 78, below: 14 } as const;

function clamp(value: number, low: number, high: number): number {
  return low > high ? (low + high) / 2 : Math.max(low, Math.min(high, value));
}

/**
 * Puts one control at a fraction of the painting, kept inside the part of it that is on screen.
 *
 * `centre` for a control that *is* the thing it acts on, like the Bar's stool. `bottom` for one
 * that points at something: a tag with a leader hanging under it wants its **tip** on the roof it
 * names, not its middle, or the tag ends up sitting on the thing and the line pointing past it.
 */
export function OnPlate({
  at,
  anchor = 'centre',
  children,
}: {
  at: OnPlateAt;
  anchor?: 'centre' | 'bottom';
  children: ReactNode;
}) {
  const view = useContext(PlateWindow);
  const share = (px: number, of: number) => (of > 0 ? px / of : 0);
  const padX = share(CLEARANCE_PX.x, view.width);
  const above = share(anchor === 'bottom' ? CLEARANCE_PX.above : CLEARANCE_PX.x, view.height);
  const below = share(anchor === 'bottom' ? CLEARANCE_PX.below : CLEARANCE_PX.x, view.height);
  const left = clamp(at.x, view.minX + padX, view.maxX - padX);
  const top = clamp(at.y, view.minY + above, view.maxY - below);

  return (
    <div
      className={cn(
        'absolute -translate-x-1/2',
        anchor === 'centre' ? '-translate-y-1/2' : '-translate-y-full',
      )}
      style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
    >
      {children}
    </div>
  );
}
