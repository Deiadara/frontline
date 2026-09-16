import type { LevelUp } from '@frontline/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon';

/**
 * The level-up, as a card that arrives, says what you got, and leaves.
 *
 * ## What was wrong with the old one
 *
 * It was a bordered box latched over the top of whatever screen was open, and the only way out of
 * it was a `Noted` link set at 11px in the bottom right corner. Nothing dismissed it on its own, so
 * on a page a player was reading it sat across the content until they found the link, which read
 * as stuck because functionally it was: an interruption with no timer and a hard-to-see exit.
 *
 * Three changes, and they are the whole of it. There is an **X** where every dismissible thing in
 * every game puts one, top right, at a real hit size rather than a text link. It **goes on its own
 * after five seconds**, with a hairline counting the time down so the disappearance is expected
 * rather than startling. And it is **drawn** rather than bordered, so it reads as a card somebody
 * slid onto the desk instead of a browser alert.
 *
 * ## Why the timer pauses
 *
 * Five seconds is enough to read `LEVEL 24` and glance at what came with it, and not enough to
 * read three unlock descriptions. Hovering or focusing the card holds the clock, so the one player
 * in ten who wants to actually read the unlock can, without the other nine having to dismiss
 * anything. Leaving resumes it rather than restarting it: a card the mouse crosses on its way
 * somewhere else should not get a fresh five seconds every time.
 */

/** How long a level-up sits there before it leaves, unattended. */
export const LEVEL_UP_DWELL_MS = 5_000;

export function LevelUpToast({ levelUp, onDismiss }: { levelUp: LevelUp; onDismiss: () => void }) {
  const { level, levelsGained, grants, unlocks } = levelUp;
  const id = useId();
  const [held, setHeld] = useState(false);

  /*
   * The countdown, in one effect that owns both the timer and the stroke.
   *
   * `left` is stored rather than recomputed from a start timestamp because the clock pauses: a
   * pause has to keep the remainder, and a start time cannot express "three of five seconds are
   * gone". The interval is 50ms, which is finer than the eye needs but coarse enough that a
   * five second life is a hundred renders of one hairline and nothing else.
   */
  const [left, setLeft] = useState(LEVEL_UP_DWELL_MS);
  const done = useRef(false);
  useEffect(() => {
    if (held) return;
    const tick = window.setInterval(() => {
      setLeft((was) => Math.max(0, was - 50));
    }, 50);
    return () => window.clearInterval(tick);
  }, [held]);

  useEffect(() => {
    // Guarded, because `onDismiss` clears the state this is rendered from: calling it twice on the
    // frame the timer hits zero would be a second setState on an unmounting tree.
    if (left > 0 || done.current) return;
    done.current = true;
    onDismiss();
  }, [left, onDismiss]);

  return (
    <section
      aria-label={`Level up: level ${level}`}
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
      className="relative w-full max-w-md overflow-hidden px-4 pb-3 pt-3.5 text-left"
      data-testid="level-up-toast"
    >
      {/*
       * The card itself, drawn. Same grammar as `ClaimButton`: a turbulence-displaced path inside
       * the element rather than a CSS border, so the stroke wobbles like a pen and stretches with
       * the box instead of staying a machined rectangle.
       */}
      <svg
        viewBox="0 0 400 160"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full text-brass-300"
        aria-hidden
      >
        <defs>
          <filter id={`lvl-${id}`} x="-6%" y="-10%" width="112%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" />
            <feDisplacementMap
              in="SourceGraphic"
              scale="2.2"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <g filter={`url(#lvl-${id})`}>
          <path d="M6 5 L394 4 L396 154 L5 156 Z" className="fill-surface-900/95" />
          <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 5 L394 4 L396 154 L5 156 Z" strokeWidth="1.6" opacity="0.9" />
            {/* The overshoot past the closing corner, which is what a hand does and a border
                cannot. */}
            <path d="M5 156 L12 151 L60 153" strokeWidth="1.1" opacity="0.5" />
            <path d="M394 4 L389 9" strokeWidth="1.1" opacity="0.4" />
          </g>
        </g>
      </svg>

      <div className="relative flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-hextech-100 [&_svg]:h-7 [&_svg]:w-7">
            <Icon name="level" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[10px] font-bold uppercase tracking-[0.22em] text-brass-300">
              Level up
              {levelsGained > 1 && (
                <span className="ml-2 tabular-nums text-hextech-100">+{levelsGained} levels</span>
              )}
            </p>
            <p
              className="font-stamp text-[26px] leading-none text-ink-100"
              data-testid="level-up-toast-level"
            >
              Level {level}
            </p>
          </div>

          {/*
           * The X, top right, at 28px square.
           *
           * A real button rather than the old text link, and outside the flow of the copy so it
           * never moves when an unlock makes the card taller.
           */}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss the level-up"
            data-testid="level-up-dismiss"
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm font-stamp text-[15px] leading-none text-ink-400 transition-colors hover:bg-surface-700/60 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300"
          >
            ✕
          </button>
        </div>

        {/* What the level is actually worth, which is the thing the old banner buried under a
            divider rule at the bottom. */}
        <p className="font-body text-[13px] leading-snug text-ink-200">
          Room for <span className="font-stamp text-ink-100">{grants.recruitSlots}</span> on the
          books now.
        </p>

        {unlocks.length > 0 && (
          <ul className="flex flex-col gap-1" data-testid="level-up-toast-unlocks">
            {unlocks.map((unlock) => (
              <li key={unlock.id} className="flex items-baseline gap-2">
                <span aria-hidden className="font-stamp text-[13px] leading-none text-brass-300">
                  ✦
                </span>
                <span className="min-w-0 font-body text-[13px] leading-snug text-ink-200">
                  <span className="font-stamp text-ink-100">{unlock.name}</span> is open.
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The clock, as a hairline along the foot. Held still while the card is hovered, which is
          also the signal that hovering is doing something. */}
      <span
        aria-hidden
        data-testid="level-up-timer"
        className="absolute bottom-[3px] left-[6px] h-[2px] bg-brass-300/70 transition-[width] duration-75 ease-linear"
        style={{ width: `calc(${(left / LEVEL_UP_DWELL_MS) * 100}% - 12px)` }}
      />
    </section>
  );
}
