import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

/**
 * A painted picker, in place of the browser's.
 *
 * A native `<select>` is the one control no amount of CSS reaches: the closed box can be styled and
 * the *list* cannot. So on every screen in this game the moment a player opened a role picker or a
 * resource picker, a plain white operating-system menu appeared over the artwork: thirteen of
 * them, and the single most jarring thing in the interface.
 *
 * This draws the list itself: the trigger is the same torn, riveted metal as everything else, and
 * the menu that drops out of it is a painted window with the same frame a hover card gets. The
 * lettering is the hand face at a size that can carry it, because the whole complaint about the
 * native control was that it looked like a form.
 *
 * ## What was kept from the native control, deliberately
 *
 * - **Keyboard.** Up, down, home, end, enter, space and escape all do what they do in a `<select>`,
 *   and typing a letter jumps to the first option starting with it.
 * - **Announcement.** A real `listbox` with `aria-activedescendant`, `aria-selected` and a labelled
 *   button, so this is not a div that a screen reader has to guess at.
 * - **Portalled and viewport-positioned**, exactly like `HoverCard` and for the same reason: a menu
 *   that reflowed the panel it belongs to would push the thing being chosen off the screen.
 *
 * The one native behaviour not reproduced is the operating system's own long-list virtualisation.
 * Nothing in this game picks from more than about twenty things, and the menu scrolls.
 */

const GAP = 6;
const EDGE = 10;

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** A second line under the label: a count, a price, a reason. Optional and usually absent. */
  hint?: string;
  /**
   * The heading this option sits under, for a list long enough to need sections.
   *
   * The native equivalent is `<optgroup>`, and the research page's thirty-four-attribute picker is
   * unusable without it. Options are expected to arrive already sorted into their groups: a
   * heading is drawn wherever the group *changes*, exactly as an `<optgroup>` is authored, rather
   * than by this component re-sorting a list somebody else put in a deliberate order.
   */
  group?: string;
  disabled?: boolean;
}

export interface DropdownProps<T extends string> {
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  /** What is being chosen. Required: an unlabelled picker is unusable without sight of it. */
  label: string;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose',
  disabled = false,
  className,
  'data-testid': testId,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selected = options.find((option) => option.value === value);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list) return;
    const at = trigger.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    // Flipped above the trigger when there is no room below it. A picker at the bottom of a sheet
    // is the common case on this game's screens, not the edge case.
    const below = at.bottom + GAP;
    const fitsBelow = below + box.height <= window.innerHeight - EDGE;
    setPlacement({
      top: fitsBelow ? below : Math.max(EDGE, at.top - box.height - GAP),
      left: Math.min(Math.max(EDGE, at.left), window.innerWidth - at.width - EDGE),
      width: at.width,
    });
  }, []);

  /**
   * Placement, and *only* placement.
   *
   * `options` is a fresh array on every render at every call site: nobody memoises a `.map()` into
   * a picker, so listing it as a dependency ran this effect on every render, and `setPlacement`
   * writes a new object each time, which renders again. The list never settled and never painted.
   * `place` is a `useCallback` over nothing, so `[open, place]` is the honest dependency set: the
   * position depends on where the trigger is, not on what is in the menu.
   *
   * Which option starts highlighted is decided when the menu is opened instead, which is also where
   * that fact actually comes from.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Capture phase for scroll, because the scroll that matters is usually an inner panel's.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('pointerdown', close);
    };
  }, [open, place]);

  /** The next option in `step`'s direction that is not disabled, wrapping at both ends. */
  const step = (from: number, direction: 1 | -1): number => {
    for (let hop = 1; hop <= options.length; hop++) {
      const at = (from + direction * hop + options.length * hop) % options.length;
      if (!options[at]?.disabled) return at;
    }
    return from;
  };

  const choose = (index: number): void => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** Opening highlights whatever is currently chosen, exactly as a native menu does. */
  const openMenu = (): void => {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      case 'ArrowDown':
        event.preventDefault();
        setActive((at) => step(at, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((at) => step(at, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(step(options.length - 1, 1));
        return;
      case 'End':
        event.preventDefault();
        setActive(step(0, -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      default:
        break;
    }
    // Type-ahead: one letter jumps to the next option that starts with it, as a `<select>` does.
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      const found = options.findIndex(
        (option, index) =>
          index > active && !option.disabled && option.label.toLowerCase().startsWith(letter),
      );
      const wrapped =
        found >= 0
          ? found
          : options.findIndex(
              (option) => !option.disabled && option.label.toLowerCase().startsWith(letter),
            );
      if (wrapped >= 0) setActive(wrapped);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        disabled={disabled}
        data-testid={testId}
        onKeyDown={onKeyDown}
        // `pointerdown` closes any open menu at the window level, so the trigger's own toggle has
        // to stop the event reaching it: otherwise a click on an open trigger closes and reopens.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        className={cn(
          'brushed edge-lit relative flex w-full min-w-0 items-center justify-between gap-2',
          'rounded-sm border border-surface-600 bg-surface-800/80 px-3 py-2 text-left',
          'transition-colors duration-100',
          disabled
            ? 'cursor-not-allowed opacity-40'
            : 'hover:border-brass-500/70 hover:bg-surface-700/80',
          open && 'border-brass-300/80',
          className,
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate font-stamp text-[14px] leading-tight',
            selected ? 'text-ink-100' : 'text-ink-300',
          )}
        >
          {selected?.label ?? placeholder}
        </span>
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          className="h-4 w-4 shrink-0 text-brass-300"
        />
      </button>

      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={id}
            role="listbox"
            aria-label={label}
            aria-activedescendant={`${id}-${active}`}
            tabIndex={-1}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
              'glass-strong painted rivets brushed z-[210] max-h-[18rem] overflow-y-auto',
              'rounded-md border-2 border-brass-300/60 py-1 shadow-panel',
              placement === null && 'pointer-events-none opacity-0',
            )}
            /*
             * `position` is set inline, not by the `fixed` class.
             *
             * `.glass-strong` declares `position: relative`, and it is authored inside
             * `@layer utilities` in `index.css`, which Tailwind appends *after* its generated
             * utilities. Equal specificity, later source, so it wins, and the menu was laid out in
             * the document flow with `top`/`left` measured against the viewport: on a short page it
             * looked right and on the market it landed 1100px below the fold. An inline style beats
             * every class and is the only version of this that cannot be undone by a stylesheet
             * ordering nobody is looking at.
             */
            style={
              placement === null
                ? { position: 'fixed', top: 0, left: 0 }
                : {
                    position: 'fixed',
                    top: placement.top,
                    left: placement.left,
                    minWidth: placement.width,
                  }
            }
          >
            {options.map((option, index) => (
              <Fragment key={option.value}>
                {option.group !== undefined && option.group !== options[index - 1]?.group && (
                  <li
                    role="presentation"
                    className="px-3.5 pb-1 pt-2 font-display text-[10px] uppercase tracking-[0.2em] text-brass-300"
                  >
                    {option.group}
                  </li>
                )}
                <li
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled}
                  onPointerEnter={() => !option.disabled && setActive(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    'flex cursor-pointer flex-col gap-0.5 px-3.5 py-2',
                    option.disabled && 'cursor-not-allowed opacity-40',
                    index === active && !option.disabled && 'bg-brass-300/15',
                    option.value === value && 'border-l-2 border-brass-300',
                    option.value !== value && 'border-l-2 border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'font-stamp text-[14px] leading-tight',
                      option.value === value ? 'text-brass-100' : 'text-ink-100',
                    )}
                  >
                    {option.label}
                  </span>
                  {option.hint !== undefined && (
                    <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
                      {option.hint}
                    </span>
                  )}
                </li>
              </Fragment>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
