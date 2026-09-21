import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

/**
 * Every dialog on the page, in mount order: its panel, which is also its identity.
 *
 * The last one is the one on top. A dialog portals to `document.body`, so mount order is document
 * order is paint order, and every window and every screen below the last one is under it.
 */
const MODAL_STACK: HTMLElement[] = [];

/** The window on top, or `null` when none is open. */
export function topDialog(): HTMLElement | null {
  return MODAL_STACK[MODAL_STACK.length - 1] ?? null;
}

/** Anything that has to know when a dialog opens or closes. `HoverCard` is the only one. */
const WATCHERS = new Set<() => void>();

/**
 * Called once whenever a dialog mounts or unmounts, and told nothing: what a watcher wants is in
 * the DOM by then.
 *
 * `HoverCard` is the caller and the reason. A tooltip trigger keeps focus after it has opened a
 * dialog, so the card it was showing stayed open behind, and a hover portal is `z-[200]` against
 * this backdrop's `z-[100]`: the card drew itself *over* the window it had just opened. Measured
 * on the unit chip at 1280x720 on 2026-09-20, the stranded card covered 720x230 of a 960x392
 * dialog. Nothing closed it either, because the pointer never left the trigger and, from a
 * keyboard, never touched it.
 *
 * What a watcher reads is {@link topDialog} rather than the document. A dialog's node is still in
 * the DOM while React runs the cleanup below, so a watcher that counted `[role="dialog"]` would be
 * told a window it had just been told about is still there, and every hover card on the page would
 * stay dark for good.
 */
export function watchDialogs(onChange: () => void): () => void {
  WATCHERS.add(onChange);
  return () => {
    WATCHERS.delete(onChange);
  };
}

function announce(): void {
  for (const watcher of [...WATCHERS]) watcher();
}

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Accessible dialog label. */
  labelledBy?: string;
  /** Names this window, for the screens that open one over another. */
  'data-testid'?: string;
  /**
   * How much of the frame the dialog takes.
   *
   * A *prop* rather than a `max-w-…` from the caller, because `cn` is `clsx`: it concatenates and
   * does not resolve Tailwind conflicts, so a caller's width and the default width both land on
   * the element and the generated stylesheet's order silently picks the winner. That is the same
   * trap the coloured tags fell into, and it is why width is chosen from a list here.
   */
  size?: 'default' | 'wide' | 'broad' | 'full' | 'room';
  className?: string;
  /**
   * Draws a close cross in the window's top right (maintainer, 2026-09-20).
   *
   * Opt-in rather than on every dialog, because most windows in this game already end in a
   * control that says what closing means: **Cancel**, **Send them**, **Never mind**. A cross over
   * one of those is a second way to do a thing the window already offers a word for.
   *
   * What it is for is a window that is only something to *read*: a unit's card opened off a chip
   * has nothing to press, so without this the only ways out are Escape and a click on the
   * backdrop, and neither is visible.
   */
  dismissible?: boolean;
  /**
   * A key handler that fires **only while this dialog is the one on top**.
   *
   * Escape already worked this way; nothing else did. The Bar's seat screen registered its own
   * arrow-key listener on `window`, so opening the negotiation over it left both live: moving the
   * text caret in the offer field with Left and Right paged the roster underneath, and a player
   * haggling with one person ended up looking at another one's record while they did it.
   *
   * Same stack, same rule, so a screen that opens another screen over itself cannot keep acting on
   * keys aimed at the one in front.
   */
  onKey?: (event: KeyboardEvent) => void;
}

const WIDTH: Record<NonNullable<ModalProps['size']>, string> = {
  default: 'max-w-lg',
  // Half the frame on a 1440px browser, which is what a character file wants: a portrait and a
  // thirty-five row sheet side by side, with neither of them truncating.
  wide: 'max-w-[52rem]',
  /*
   * A step past `wide`, and the widest a window can be and still keep a gutter at 1024.
   *
   * The plot window is a deck of panels in two columns, so a column is a little under half of
   * this: 386px at 52rem, 450px here. Measured on a district that has been played, the extra
   * 64px takes 17px off the Nexus deck and 26px off the Generator's, whose four-material price
   * goes from two lines to one. That is small on its own and decisive at the end: at 52rem the
   * Nexus window is 705px tall, which is 17px more than a 1280x720 frame has; at 60rem it is 688
   * and fits exactly, with 48px to spare at 1024x768.
   *
   * It is also the ceiling. The backdrop keeps 16px of padding either side, so at 1024 there are
   * 992px to be had, and 960 leaves the window looking like a window rather than like a page.
   */
  broad: 'max-w-[60rem]',
  // A whole report: seven panels of readouts that want two columns at any real viewport.
  full: 'max-w-[72rem]',
  // The screen takes the room, and there is a reason it has to: the Bar's seat screen puts all
  // four attribute groups in one row with an arrow either side of the card, and four groups need
  // about 210px each before `Communication` starts to truncate. 72rem does not have it.
  room: 'max-w-[86rem]',
};

/**
 * Fixed full-screen backdrop with a centred panel; closes on Escape / backdrop click.
 *
 * **Portalled to `document.body`, and it has to be.** The game shell stacks a routed `<main>` under
 * a floating chrome layer, and a `z-index` on `<main>` makes it a stacking context, so a dialog
 * rendered inside a screen can never rise above the scenery switcher, however large its own
 * `z-50` is. It looked fine and swallowed clicks on the primary button.
 */
export function Modal({
  onClose,
  children,
  labelledBy,
  size = 'default',
  className,
  dismissible = false,
  onKey,
  'data-testid': testId,
}: ModalProps) {
  /*
   * Escape closes the **topmost** window, not every open one.
   *
   * Each dialog listens on `window`, so a single Escape reached all of them: opening the
   * negotiation over the Bar's seat screen and pressing it once shut both, dropping the player
   * back into the room rather than back to the person they were talking to. A stack of the mounted
   * dialogs, in mount order, and only the last one acts.
   *
   * Module-level rather than context, because a dialog is portalled to `document.body` and has no
   * provider above it by construction: that is the whole point of the portal.
   *
   * The panel itself is what goes on the stack, so the same list answers the other question a
   * window raises: whether a given trigger is underneath it. See {@link watchDialogs}.
   */
  const panel = useRef<HTMLDivElement>(null);

  /*
   * A **layout** effect, so the watchers hear about this window before the browser paints it.
   *
   * `HoverCard` turns its card off on this signal, and a card turned off in a passive effect is
   * turned off one paint too late: measured on 2026-09-20, the stranded card was still on screen
   * in the frame the dialog appeared in and gone within 400ms, which is a flash of the same sheet
   * drawn twice, one copy over the other.
   */
  useLayoutEffect(() => {
    const self = panel.current;
    if (self === null) return;
    MODAL_STACK.push(self);
    announce();
    return () => {
      const at = MODAL_STACK.indexOf(self);
      if (at !== -1) MODAL_STACK.splice(at, 1);
      announce();
    };
  }, []);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      // The last mounted dialog is the one on top, and the only one any key is for.
      if (topDialog() !== panel.current) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      onKey?.(e);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose, onKey]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={testId}
        className={cn(
          'glass-strong washed rivets taped brushed relative flex max-h-[calc(100vh-2rem)] w-full min-w-0 flex-col rounded-sm shadow-panel',
          WIDTH[size],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {dismissible && (
          /* Over the content rather than above it, so a window that was laid out without a
             cross does not gain a row when it grows one. `z-10` clears the card behind it. */
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="modal-close"
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-sm border border-surface-600/80 bg-surface-950/80 text-ink-300 transition-colors hover:border-oxblood-500/70 hover:text-oxblood-300"
          >
            <Icon name="close" aria-hidden className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
