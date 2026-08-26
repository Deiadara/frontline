import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * Every `data-tip` in the game, drawn once.
 *
 * The `title` attribute was doing this job and it is the one piece of chrome the game does not
 * draw: it arrives after a second of stillness, in the operating system's own font on its own
 * grey, it cannot be styled, it cannot be reached by a keyboard, and it is invisible on the way
 * past. Six painted resource chips and a hand-inked frame, and then a Windows tooltip.
 *
 * ## Why one listener rather than a wrapper per site
 *
 * The obvious shape is a `<Tooltip>` that wraps its trigger, and it is the wrong one here. Names
 * sit on things that are already something else: a `NavLink` in the HUD, a `<span>` in a table, a
 * card that is itself a button. Wrapping seventy of those means seventy structural edits to
 * layouts that have been fitted to the pixel, and a wrapper that draws no box is still a node the
 * next `flex` rule has to know about.
 *
 * Delegation makes the per-site change a rename: `title=` becomes `data-tip=`, nothing moves, and
 * there is one place that decides what a name looks like. It also picks up anything rendered
 * later, which a wrapper cannot.
 *
 * Mounted once, at the root. `aria-label` is left wherever it already was: this draws the name,
 * it does not take over announcing it.
 */

/** Clear of the trigger, and clear of the frame's edge. Matched to `HoverCard`. */
const GAP = 8;
const EDGE = 10;

interface Tip {
  text: string;
  anchor: DOMRect;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const host = target.closest('[data-tip]');
      const text = host?.getAttribute('data-tip')?.trim();
      if (!host || !text) return;
      setTip({ text, anchor: host.getBoundingClientRect() });
    };
    /*
     * `pointerout` bubbles, and it fires when the pointer crosses from a trigger onto a child of
     * that same trigger: the icon inside a button, the text inside a chip. Closing on that makes
     * the name flicker every time somebody moves across the thing it labels. So a move that lands
     * inside the same `[data-tip]` is not a leave at all.
     */
    const shut = (event?: Event): void => {
      if (event instanceof PointerEvent || event instanceof FocusEvent) {
        const going = event.relatedTarget;
        const from = event.target;
        if (
          going instanceof Element &&
          from instanceof Element &&
          going.closest('[data-tip]') === from.closest('[data-tip]') &&
          from.closest('[data-tip]') !== null
        ) {
          return;
        }
      }
      setTip(null);
    };

    document.addEventListener('pointerover', open);
    document.addEventListener('focusin', open);
    document.addEventListener('pointerout', shut);
    document.addEventListener('focusout', shut);
    // A tip is about where a thing *was*: anything that moves it, or any intent to act, ends it.
    document.addEventListener('pointerdown', shut);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('blur', shut);
    return () => {
      document.removeEventListener('pointerover', open);
      document.removeEventListener('focusin', open);
      document.removeEventListener('pointerout', shut);
      document.removeEventListener('focusout', shut);
      document.removeEventListener('pointerdown', shut);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('blur', shut);
    };
  }, []);

  useLayoutEffect(() => {
    if (tip === null) {
      setAt(null);
      return;
    }
    const box = boxRef.current;
    if (!box) return;
    const size = box.getBoundingClientRect();
    const left = Math.min(
      Math.max(EDGE, tip.anchor.left + tip.anchor.width / 2 - size.width / 2),
      Math.max(EDGE, window.innerWidth - size.width - EDGE),
    );
    // Below by default, above when there is no room: a name that hangs off the bottom of the
    // frame is a name nobody reads.
    const below = tip.anchor.bottom + GAP;
    const top =
      below + size.height + EDGE > window.innerHeight ? tip.anchor.top - size.height - GAP : below;
    setAt({ top: Math.max(EDGE, top), left });
  }, [tip]);

  if (tip === null) return null;
  return (
    <div
      ref={boxRef}
      role="tooltip"
      data-testid="tooltip"
      className={cn(
        // The same dark glass the chrome is made of, so a name reads as part of the game rather
        // than as the operating system talking over it.
        'pointer-events-none fixed z-[70] max-w-xs rounded-md px-2.5 py-1.5',
        'border border-iris-300/25 bg-surface-950/95 shadow-panel backdrop-blur-sm',
        'font-display text-[11px] font-bold uppercase leading-tight tracking-[0.16em] text-ink-100',
        // Drawn transparent until it has been measured, so it cannot flash in the corner first.
        at === null && 'opacity-0',
      )}
      style={at === null ? { top: 0, left: 0 } : { top: at.top, left: at.left }}
    >
      {tip.text}
    </div>
  );
}
