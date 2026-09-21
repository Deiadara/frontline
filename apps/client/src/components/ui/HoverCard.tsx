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
import { topDialog, watchDialogs } from './Modal';

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
   * Whether this control is the one currently chosen, for a trigger that is also a tab or a door.
   *
   * Only meaningful alongside `onActivate`, and it exists because a rail row that grew a hover card
   * stopped announcing its own state: the trigger here is the button, so `aria-pressed` has to be
   * its, and a caller wrapping one in a `<span>` to carry the attribute would be describing a thing
   * nobody can press (maintainer, 2026-09-17).
   */
  pressed?: boolean;
  /**
   * How much room the card takes.
   *
   * `tip` is a sentence or two beside the thing it explains. `window` is a framed panel roughly
   * six times its area, for the handful of things worth a proper look: a resource, a unit, an
   * item. `card` is wider again, and it exists for one thing: a roster card, which is a portrait
   * beside a two-column sheet of twelve stats and needs about 42rem before the stat labels start
   * crossing their own bars. The frame is drawn by the caller in all three; this only sets the
   * width and, past `tip`, drops the tooltip's padding, since the caller supplies its own.
   */
  size?: 'tip' | 'window' | 'card';
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

/**
 * Whether the window on top has `trigger` underneath it.
 *
 * A trigger inside that window is on top with it and keeps its card; anything else is behind the
 * backdrop, where a card is a panel floating over a window nobody opened it from.
 */
function buriedByADialog(trigger: Element | null): boolean {
  const top = topDialog();
  return top !== null && !top.contains(trigger);
}

/**
 * The nearest x that puts a card of this width next to the trigger rather than across it, or the
 * clamped x it already had when the frame has room for neither side.
 */
function beside(at: DOMRect, width: number, clamped: number): number {
  const toTheRight = at.right + GAP;
  const toTheLeft = at.left - GAP - width;
  if (toTheRight + width <= window.innerWidth - EDGE) return toTheRight;
  if (toTheLeft >= EDGE) return toTheLeft;
  return clamped;
}

export function HoverCard({
  card,
  children,
  className,
  label,
  side = 'bottom',
  onActivate,
  disabled = false,
  pressed,
  size = 'tip',
  interactive = false,
  'data-testid': testId,
}: HoverCardProps) {
  const [open, setOpen] = useState(false);
  const [buried, setBuried] = useState(false);
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

  /*
   * A card goes out while a dialog stands over its trigger, and comes back when the dialog goes.
   *
   * The trigger that *opened* the dialog is the case this exists for: a press leaves the pointer
   * on it and a keyboard leaves the focus on it, so nothing ever fired the leave that would have
   * closed the card, and the card outranks the window (`z-[200]` against `z-[100]`). A player
   * pressing a unit chip got the same card twice, the top one over the dialog it had just opened.
   *
   * State rather than a read at render time, because the DOM this asks about changes in another
   * component: `Modal` says when.
   */
  useEffect(() => {
    const look = () => setBuried(buriedByADialog(triggerRef.current));
    look();
    return watchDialogs(look);
  }, []);
  const showing = open && !buried;

  /**
   * Measured after paint, not guessed.
   *
   * The card's width depends on its own content, so the only way to keep it inside the frame is to
   * lay it out and then move it. Placed by arithmetic on the trigger alone, the last chip in the
   * bar hangs its card off the right of the screen.
   *
   * `side` is a preference, not an instruction, and it has to be. The Bar's standing note is a chip
   * on the floor of the room, so its card opened below the chip and ran off the bottom of the
   * screen: the half of the rule a player most needs was the half they could not read. So the
   * requested side is taken when the card fits there, the opposite side when it does not, and
   * whatever is left is clamped into the frame the same way the horizontal axis already was.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const box = cardRef.current;
    if (!trigger || !box) return;
    const at = trigger.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE, at.left), window.innerWidth - size.width - EDGE);

    const below = at.bottom + GAP;
    const above = at.top - size.height - GAP;
    const fitsBelow = below + size.height <= window.innerHeight - EDGE;
    const fitsAbove = above >= EDGE;
    const wanted = side === 'bottom' ? below : above;
    const other = side === 'bottom' ? above : below;
    const fitsWanted = side === 'bottom' ? fitsBelow : fitsAbove;
    const fitsOther = side === 'bottom' ? fitsAbove : fitsBelow;

    const top = Math.max(
      EDGE,
      Math.min(fitsWanted || !fitsOther ? wanted : other, window.innerHeight - size.height - EDGE),
    );
    /*
     * A tall card over a short trigger fits neither above nor below, so the clamp on the line above
     * has just laid it *over* the thing it explains. A unit chip is the case that found it: the
     * sheet is taller than the room under a chip halfway down a 768px screen, and the card it
     * opened covered the chip, its count and its neighbours. Step it sideways when the frame has
     * room, right first because that is where reading leaves the eye.
     *
     * Only ever in that case. When the card is already clear above or below the trigger, this is
     * false and nothing moves, so no placement that was right becomes something else.
     */
    const lyingOnTrigger = top < at.bottom && top + size.height > at.top;
    setPlacement({ top, left: lyingOnTrigger ? beside(at, size.width, left) : left });
  }, [side]);

  useLayoutEffect(() => {
    if (!showing) {
      setPlacement(null);
      return;
    }
    place();
  }, [showing, place]);

  useEffect(() => {
    if (!showing) return;
    // The world behind the card scrolls and resizes under it. Capture phase, because the scroll
    // that matters is usually on an inner panel rather than on the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [showing, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        // A press on a trigger that only explains itself does nothing, so it says nothing: the
        // sound layer plays for a press that did something, and this one reveals a card on hover.
        data-sound={onActivate === undefined ? 'none' : undefined}
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
        aria-pressed={pressed}
        onClick={onActivate !== undefined && !disabled ? onActivate : undefined}
        aria-label={label}
        /*
         * Deliberately no `data-tip`. This *is* the tooltip: `TooltipLayer` draws the one-word
         * name for everything that has no card of its own, and a trigger carrying both opened a
         * pill on top of its own window. The label stays on `aria-label`, which is what it was
         * for.
         */
        aria-describedby={showing ? id : undefined}
        aria-expanded={showing}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        data-testid={testId}
      >
        {children}
      </button>

      {showing &&
        createPortal(
          <div
            ref={cardRef}
            id={id}
            role="tooltip"
            onMouseEnter={interactive ? show : undefined}
            onMouseLeave={interactive ? hide : undefined}
            className={cn(
              'z-[200]',
              interactive ? 'pointer-events-auto' : 'pointer-events-none',
              size === 'card'
                ? /*
                   * One width for every unit card, not a ceiling (maintainer, 2026-09-17: "make
                   * the unit cards all be equally as big in size so that it all comfortably fits").
                   *
                   * `w-max` under a `max-w` gave each card its own content's width, and the roster
                   * is exactly the content that varies: measured across the twenty-four doors on
                   * the Scrapyard's unit rail, the cards ran 547px for a Razor to 720px for a Cyber
                   * Dog, so moving down the rail resized the card under the pointer every row. The
                   * 42rem ceiling made it worse rather than better, since it clipped the two widest
                   * to 672 and wrapped their marks band instead of letting it run.
                   *
                   * 45rem is the widest of them at its natural width, so the roomiest card is the
                   * one that sets the box and nothing wraps that did not want to. The viewport
                   * clamp is for the narrow end: `HoverCard` places the card by subtracting its
                   * width from the window, and a card wider than the window places at a negative
                   * left.
                   */
                  //
                  // `rounded-sm` and a ground of its own, because a locked unit's card carries
                  // `opacity-75` (the roster's way of saying "you cannot have this yet") and on a
                  // portal over artwork that is not a dim card, it is a transparent one: the
                  // Scrapyard's benches and the bar behind read straight through it. Dimming
                  // against this ground keeps the signal and loses the window.
                  'w-[45rem] max-w-[calc(100vw-2rem)] rounded-sm bg-[rgb(18_18_22)]'
                : size === 'window'
                  ? 'w-max max-w-[26rem]'
                  : // A torn scrap of paper with a hand-inked rule round it, not a rounded
                    // rectangle with a hairline border. The card is the game's most-read surface
                    // and it was the one that looked most like a form.
                    'scrap w-max max-w-[17rem] px-4 py-3.5',
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
