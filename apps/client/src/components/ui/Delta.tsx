import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DeltaMark } from '../../lib/deltas';

/** Clear of the chip, and clear of the frame's edge. */
const GAP = 10;
const EDGE = 44;
/** One figure's row. Tall enough that two stacked figures do not touch at this face size. */
const LANE = 30;

/**
 * The figures that float off a readout when the number on it moves.
 *
 * Portalled to `document.body` and positioned in viewport coordinates, the way `HoverCard` is and
 * for the same reasons: the standing bar is a `flex-wrap` row that would grow to contain anything
 * drawn inside it, so a figure hanging under a chip would push the whole top of the screen down,
 * and the same component has to work on a unit count inside a scrolling column, where an in-flow
 * figure would be cut by the scroller rather than float over it.
 *
 * It hangs *below* the readout rather than above it. The chips it is drawn for are the top strip
 * of the screen, so a figure that rose out of the top of one would rise off the frame.
 */
export function DeltaFloat({
  marks,
  icon,
  unit,
  'data-testid': testId,
}: {
  marks: readonly DeltaMark[];
  /** The readout's own mark, so a figure that has floated away from its chip still says which. */
  icon?: ReactNode;
  /**
   * What the figure counts, when the number alone does not say it.
   *
   * The stockpiles do not need one: the icon on the plate is the resource. The level chip does,
   * because `+120` beside a level reads as a hundred and twenty levels.
   */
  unit?: string;
  'data-testid'?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const showing = marks.length > 0;

  const place = useCallback(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    setAt({
      top: box.bottom + GAP,
      // Centred on the chip and kept inside the frame. The figures are translated back by half
      // their own width, so this is the centre line rather than the left edge.
      left: Math.min(Math.max(EDGE, box.left + box.width / 2), window.innerWidth - EDGE),
    });
  }, []);

  useLayoutEffect(() => {
    if (!showing) {
      setAt(null);
      return;
    }
    place();
  }, [showing, place]);

  useEffect(() => {
    if (!showing) return;
    // The readout can be in a panel that scrolls under the figure. Capture phase, because the
    // scroller that matters is usually an inner column rather than the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [showing, place]);

  return (
    <>
      {/* Out of the flow and the size of the readout it sits in, so dropping this into a chip
          changes no layout and the portal has the chip's own box to hang from. The readout must be
          `relative` for that; every caller here is. */}
      <span ref={anchor} aria-hidden className="pointer-events-none absolute inset-0" />
      {showing &&
        at !== null &&
        createPortal(
          <div
            data-testid={testId}
            aria-hidden
            className="pointer-events-none z-[210] w-0"
            style={{ position: 'fixed', top: at.top, left: at.left }}
          >
            {marks.map((mark) => (
              <DeltaFigure key={mark.id} mark={mark} icon={icon} unit={unit} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** `-1,200` in oxblood, `+400` in verdigris, in the chrome's display face with tabular figures. */
function DeltaFigure({
  mark,
  icon,
  unit,
}: {
  mark: DeltaMark;
  icon?: ReactNode;
  unit?: string | undefined;
}) {
  const spend = mark.amount < 0;
  return (
    <span
      data-testid={`delta-${spend ? 'spend' : 'gain'}`}
      data-amount={mark.amount}
      className={
        // On its own plate, at 18px. The figure floats over whatever the screen happens to be
        // painting at that moment, and a small red number over a dim doorway is a number nobody
        // reads: the plate is what makes it the same figure over the city map and over a portrait.
        // The board's word was obvious, so it is the largest figure on the HUD while it lives.
        'delta-figure absolute left-0 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap ' +
        'rounded-sm border bg-surface-950/95 px-2 py-1 shadow-lifted ' +
        'font-display text-[18px] font-bold leading-none tabular-nums ' +
        (spend
          ? 'border-oxblood-500/70 text-oxblood-300'
          : 'border-verdigris-500/70 text-verdigris-300')
      }
      style={{ top: mark.lane * LANE }}
    >
      {icon !== undefined && (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center">{icon}</span>
      )}
      {/* The sign is written rather than implied: "1,200" going past in red is a number, and
          "-1,200" is a receipt. `toLocaleString` for the same reason every other figure in the
          game has it: 1200 and 1,200 are not equally readable at a glance. */}
      {spend ? '-' : '+'}
      {Math.abs(mark.amount).toLocaleString()}
      {unit !== undefined && <span className="text-[13px] font-bold">{unit}</span>}
    </span>
  );
}
