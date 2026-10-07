import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { recentPress, type Press } from '../../lib/lastPress';
import { ErrorNote } from './ErrorNote';
import { Icon } from './Icon';

/**
 * A refusal the guard did not catch, beside the button that was pressed (maintainer, 2026-10-06).
 *
 * The rule has two halves. A press the server would refuse is greyed before it happens, with the
 * reason on hover; that is the button's job. What slips past (a race, another tab spending first)
 * shows here: a small box next to the button, with an X, gone on the X or the next click anywhere.
 * It takes no room where it is written, so nothing on the page moves. The inline notes it replaces
 * pushed grids and stacks down under the pointer.
 *
 * Written where the old note was, as `{x.error && <PressError onDismiss={x.reset}>...}`: the box
 * is portalled, and placed off the press `lib/lastPress.ts` recorded. With no press to go by (a
 * refusal that arrived on its own) it sits at the top of the frame.
 */
export function PressError({
  children,
  onDismiss,
  'data-testid': testId,
}: {
  children: ReactNode;
  /** Called when the box is closed: usually the mutation's `reset`, so the next refusal is new. */
  onDismiss?: () => void;
  'data-testid'?: string;
}) {
  const [open, setOpen] = useState(true);
  // Where the press was when the refusal came back, held: the page may scroll under the box.
  const [anchor] = useState<Press['rect'] | null>(() => recentPress()?.rect ?? null);

  const close = (): void => {
    setOpen(false);
    onDismiss?.();
  };
  // The latest `close` for the listener below, which is installed once per opening.
  const closeRef = useRef(close);
  closeRef.current = close;

  /*
   * The next click anywhere closes it. Listened for from the next frame, so the press whose answer
   * this is cannot close it on its own way out.
   */
  useEffect(() => {
    if (!open) return;
    let armed = false;
    const frame = requestAnimationFrame(() => {
      armed = true;
    });
    const onPress = (): void => {
      if (armed) closeRef.current();
    };
    document.addEventListener('pointerdown', onPress, { capture: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPress, { capture: true });
    };
  }, [open]);

  if (!open || children === '' || children === null || children === undefined) return null;
  return createPortal(
    <PlacedBox anchor={anchor} testId={testId} onClose={close}>
      {children}
    </PlacedBox>,
    document.body,
  );
}

/** The gap between the button and the box, in pixels. */
const GAP_PX = 6;
/** How close to the frame's edge the box may come. */
const EDGE_PX = 8;

/** Under the button, or over it when there is no room below; kept inside the frame. */
function PlacedBox({
  anchor,
  testId,
  onClose,
  children,
}: {
  anchor: Press['rect'] | null;
  testId: string | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (box === null) return;
    const { width, height } = box.getBoundingClientRect();
    const frameW = window.innerWidth;
    const frameH = window.innerHeight;
    if (anchor === null) {
      setPlace({ top: EDGE_PX * 8, left: Math.max(EDGE_PX, (frameW - width) / 2) });
      return;
    }
    const below = anchor.bottom + GAP_PX;
    const top =
      below + height <= frameH - EDGE_PX ? below : Math.max(EDGE_PX, anchor.top - GAP_PX - height);
    const left = Math.min(
      Math.max(EDGE_PX, anchor.left),
      Math.max(EDGE_PX, frameW - width - EDGE_PX),
    );
    setPlace({ top, left });
  }, [anchor, box]);

  return (
    <div
      ref={setBox}
      className="fixed z-[160] flex max-w-[min(22rem,calc(100vw-16px))] items-start gap-1 shadow-panel"
      // Measured before it is shown, so it never draws for a frame at the corner.
      style={place ?? { top: 0, left: 0, visibility: 'hidden' }}
      data-testid={testId}
    >
      <ErrorNote backdrop className="min-w-0">
        {children}
      </ErrorNote>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        data-testid="press-error-close"
        className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-oxblood-500/50 bg-surface-950/90 text-oxblood-300 hover:text-oxblood-100 [&_svg]:h-3.5 [&_svg]:w-3.5"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
