import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

/** Every dialog on the page, in mount order. The last one is the one on top. See the effect below. */
const MODAL_STACK: object[] = [];

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
  size?: 'default' | 'wide' | 'full';
  className?: string;
}

const WIDTH: Record<NonNullable<ModalProps['size']>, string> = {
  default: 'max-w-lg',
  // Half the frame on a 1440px browser, which is what a character file wants: a portrait and a
  // thirty-five row sheet side by side, with neither of them truncating.
  wide: 'max-w-[52rem]',
  // A whole report: seven panels of readouts that want two columns at any real viewport.
  full: 'max-w-[72rem]',
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
   */
  const self = useRef({}).current;

  useEffect(() => {
    MODAL_STACK.push(self);
    return () => {
      const at = MODAL_STACK.indexOf(self);
      if (at !== -1) MODAL_STACK.splice(at, 1);
    };
  }, [self]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The last mounted dialog is the one on top, and the only one Escape is for.
      if (MODAL_STACK[MODAL_STACK.length - 1] !== self) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
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
        {children}
      </div>
    </div>,
    document.body,
  );
}
