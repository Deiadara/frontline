import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Keeping the bottom bar on one row (maintainer, 2026-09-29).
 *
 * Thirteen doors at their drawn size need 1040px, so at 1024 wide Settings dropped to a second row
 * of its own and every screen above the bar lost 80px of height at the one size where height is
 * scarcest. The ruling: "if it were to wrap, then make all the icons smaller so that they fit
 * there, and reduce the space in between. But don't change the normal behaviour of how they are
 * now on normal screens." So nothing here applies to a row that fits: {@link compactDoors} answers
 * `null` and the bar is drawn exactly as it always was. Only a row that would wrap is tightened,
 * gaps and padding first, then every door by one scale.
 */

/** A door at its drawn size, and the row around it: the classes `BottomNav` falls back to. */
export const DOOR = {
  width: 72,
  tile: 52,
  icon: 28,
  lock: 30,
  label: 11,
  gap: 6,
  pad: 16,
} as const;

/** The row's gap and side padding once it has to tighten. */
const TIGHT = { gap: 2, pad: 8 } as const;

/**
 * The largest a tightened door is drawn, as a share of its full size.
 *
 * A row that only just wraps would fit on the gaps alone, and the ruling asks for the icons to come
 * down as well, so a tightened row is visibly the smaller version rather than one that lost a few
 * pixels of air.
 */
const COMPACT_MAX_SCALE = 0.86;

/** The width a row of `doors` needs at the drawn size, padding included. */
export function naturalRowWidth(doors: number): number {
  return doors * DOOR.width + Math.max(0, doors - 1) * DOOR.gap + 2 * DOOR.pad;
}

export interface DoorSizes {
  width: number;
  tile: number;
  icon: number;
  lock: number;
  label: number;
  gap: number;
  pad: number;
}

/** The sizes that put `doors` on one row `rowWidth` wide, or `null` when they already fit. */
export function compactDoors(doors: number, rowWidth: number): DoorSizes | null {
  if (doors <= 0 || rowWidth <= 0 || naturalRowWidth(doors) <= rowWidth) return null;
  const room = rowWidth - 2 * TIGHT.pad - (doors - 1) * TIGHT.gap;
  const scale = Math.min(COMPACT_MAX_SCALE, room / (doors * DOOR.width));
  return {
    width: Math.floor(DOOR.width * scale),
    tile: Math.round(DOOR.tile * scale),
    icon: Math.round(DOOR.icon * scale),
    lock: Math.round(DOOR.lock * scale),
    // Half-pixel steps: a label is the one part a fraction of a pixel visibly blurs.
    label: Math.round(DOOR.label * scale * 2) / 2,
    gap: TIGHT.gap,
    pad: TIGHT.pad,
  };
}

/** The custom properties `BottomNav`'s classes read, set only on a row that has to tighten. */
export function doorStyle(sizes: DoorSizes | null): CSSProperties | undefined {
  if (sizes === null) return undefined;
  return {
    '--door-w': `${sizes.width}px`,
    '--door-tile': `${sizes.tile}px`,
    '--door-icon': `${sizes.icon}px`,
    '--door-lock': `${sizes.lock}px`,
    '--door-label': `${sizes.label}px`,
    '--door-gap': `${sizes.gap}px`,
    '--door-pad': `${sizes.pad}px`,
  } as CSSProperties;
}

/**
 * The width the bar is drawn across: the window's, which is what the bar spans edge to edge and
 * what the 1500px media query pinning Feats and Settings reads.
 *
 * Read during render rather than measured off the bar after it. A measurement forces the tiles to
 * be laid out at their full size first, and the change to the tightened size then plays the doors'
 * own 150ms transition on every load at 1024: a bar that visibly shrinks as the page opens.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const read = () => setWidth(window.innerWidth);
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return width;
}
