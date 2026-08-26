import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

/**
 * A small explanation that appears under the thing it explains.
 *
 * The HUD is a row of numbers with no words on it, which is what lets it stay one line over the
 * artwork and also what makes it unreadable to anyone who has not already learned it. A chip
 * reading `39K` with a drum on it does not say oil, does not say what the ceiling is, and does not
 * say that production stops when you reach it. So the compact form stays and the explanation is one
 * hover away.
 *
 * **The card is portalled to `document.body` and positioned in viewport coordinates.** Rendered in
 * place it was a child of the stockpile bar, and a bar built on `flex-wrap` grew to contain it: the
 * whole top of the screen pushed down every time a pointer crossed a resource. Nothing about a
 * tooltip should be able to reflow the page it is explaining, and a portal is the only version of
 * that which cannot be undone by a later layout change. It also lets the card hang over the world
 * below the bar, which is where there is room for it.
 *
 * It opens on hover **and on focus**, and the trigger is a real `<button>`: a tooltip a keyboard
 * cannot reach is a tooltip half the people who need it will never see. `aria-describedby` ties the
 * two together so the card is announced rather than merely drawn.
 */

/** Clear of the trigger, and clear of the frame's edge. */
const GAP = 8;
const EDGE = 10;

/** How long an interactive card survives the pointer leaving it. Long enough to cross the gap. */
const LEAVE_GRACE_MS = 160;

export interface HoverCardProps {
  /** What the card says. Rendered only while open, so its content can be as rich as it likes. */
  card: ReactNode;
  /** The thing being explained. */
  children: ReactNode;
  className?: string;
  /**
   * What the trigger is called, for anyone who cannot see it.
   *
   * An `aria-label`, deliberately **not** a visually-hidden span. `sr-only` clips its own text to a
   * 1px box by design, which is precisely the shape every "is any text cut off?" gate in the suite
   * looks for, and a hidden label inside a chip has the whole layout suite reporting the HUD broken.
   */
  label?: string;
  /** Which side of the trigger the card hangs from. Defaults to below. */
  side?: 'top' | 'bottom';
  /**
   * What clicking the trigger does, when it does something.
   *
   * Given, the trigger stops being help-only and becomes a real control that also explains itself.
   * It stays a single `<button>` either way: a clickable element *inside* a tooltip trigger is
   * nested interactive content, which is invalid, unreachable by keyboard in the order anybody
   * expects, and ambiguous about which of the two a click landed on.
   */
  onActivate?: () => void;
  /** Only meaningful alongside `onActivate`. The card still opens, so the reason is readable. */
  disabled?: boolean;
  /**
   * How much room the card takes.
   *
   * `tip` is a sentence or two beside the thing it explains. `window` is a framed panel roughly
   * six times its area, for the handful of things worth a proper look: a resource, a unit, an
   * item. The frame is drawn by the caller; this only sets the width and drops the tooltip's
   * padding, since a window supplies its own.
   */
  size?: 'tip' | 'window';
  /**
   * Whether the card itself can be pointed at.
   *
   * Off by default, and that is the right default: a card that eats pointer events sits over the
   * thing behind it, and almost every card here is prose. Turn it on when the card carries a
   * control of its own: the notoriety ladder's Upgrade Tier button is the case it exists for.
   * The card then stays open while the pointer is on its way across the gap, which is the whole
   * difference between a button and a button nobody can reach.
   */
  interactive?: boolean;
  'data-testid'?: string;
}

interface Placement {
  top: number;
  left: number;
}

export function HoverCard({
  card,
  children,
  className,
  label,
  side = 'bottom',
  onActivate,
  disabled = false,
  size = 'tip',
  interactive = false,
  'data-testid': testId,
}: HoverCardProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  /**
   * Leaving an interactive card is a *delayed* close, because the pointer has to cross the gap
   * between the chip and the card to reach the control inside it. Everything else closes at once.
   */
  const cancelClose = useCallback(() => {
    if (closing.current !== null) {
      clearTimeout(closing.current);
      closing.current = null;
    }
  }, []);

  const show = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  const hide = useCallback(() => {
    if (!interactive) {
      setOpen(false);
      return;
    }
    cancelClose();
    closing.current = setTimeout(() => setOpen(false), LEAVE_GRACE_MS);
  }, [cancelClose, interactive]);

  useEffect(() => cancelClose, [cancelClose]);

  /**
   * Measured after paint, not guessed.
   *
   * The card's width depends on its own content, so the only way to keep it inside the frame is to
   * lay it out and then move it. Placed by arithmetic on the trigger alone, the last chip in the
   * bar hangs its card off the right of the screen.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const box = cardRef.current;
    if (!trigger || !box) return;
    const at = trigger.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE, at.left), window.innerWidth - size.width - EDGE);
    const top = side === 'bottom' ? at.bottom + GAP : at.top - size.height - GAP;
    setPlacement({ top, left });
  }, [side]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // The world behind the card scrolls and resizes under it. Capture phase, because the scroll
    // that matters is usually on an inner panel rather than on the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        // A help cursor rather than a pointer: this reveals information, it does not navigate.
        // Saying "clickable" about something that only explains itself is a promise it cannot keep.
        // One that *does* something says so.
        className={cn(
          'block shrink-0 text-left',
          onActivate === undefined || disabled ? 'cursor-help' : 'cursor-pointer',
          className,
        )}
        // Disabled rather than `disabled`: a disabled button takes no pointer events at all, so
        // the card explaining *why* it is disabled would never open, which is the one moment it
        // is worth reading.
        aria-disabled={onActivate !== undefined && disabled ? true : undefined}
        onClick={onActivate !== undefined && !disabled ? onActivate : undefined}
        aria-label={label}
        /*
         * Deliberately no `data-tip`. This *is* the tooltip: `TooltipLayer` draws the one-word
         * name for everything that has no card of its own, and a trigger carrying both opened a
         * pill on top of its own window. The label stays on `aria-label`, which is what it was
         * for.
         */
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        data-testid={testId}
      >
        {children}
      </button>

      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={id}
            role="tooltip"
            onMouseEnter={interactive ? show : undefined}
            onMouseLeave={interactive ? hide : undefined}
            className={cn(
              'z-[200] w-max',
              interactive ? 'pointer-events-auto' : 'pointer-events-none',
              size === 'window'
                ? 'max-w-[26rem]'
                : // A torn scrap of paper with a hand-inked rule round it, not a rounded rectangle
                  // with a hairline border. The card is the game's most-read surface and it was the
                  // one that looked most like a form.
                  'scrap max-w-[17rem] px-4 py-3.5',
              // Invisible for the one frame between mounting and being measured, so it never
              // flashes at the top-left corner on its way to where it belongs.
              placement === null && 'opacity-0',
            )}
            /*
             * `position` inline rather than via the `fixed` class. `.glass-strong` declares
             * `position: relative` and is authored in `index.css`'s `@layer utilities`, which
             * Tailwind appends after its own: equal specificity, later source, so the class loses.
             * The card then positions against the document rather than the viewport, which happens
             * to look correct on a short page and drops it below the fold on a long one.
             */
            style={{ position: 'fixed', ...(placement ?? { top: 0, left: 0 }) }}
          >
            {card}
          </div>,
          document.body,
        )}
    </>
  );
}
