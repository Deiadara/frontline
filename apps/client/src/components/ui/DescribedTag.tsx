import { HoverCard } from './HoverCard';
import { cn } from '../../lib/cn';

/**
 * A one-word tag that can say what it means.
 *
 * Ambitions, moral compasses and traits are all the same shape on a card: a single word in a box,
 * carrying a rule the player is expected to know. `Justice` decides who will sign with a
 * revolutionary crew and who will not; `Marked Face` takes eight points off stealth. None of that
 * is guessable from the word, and a `title` attribute is not an answer. It arrives after a second
 * of stillness, on a delay no player waits through, and is invisible on the way past.
 *
 * So the word stays short and the explanation is one hover away, in the same card the HUD uses.
 * `HoverCard` portals it, so a tag can sit anywhere without its explanation resizing the card it
 * is on.
 */

export interface DescribedTagProps {
  label: string;
  description: string;
  /** A line under the description: what it does mechanically, when that is worth spelling out. */
  detail?: string;
  /** Colour only. The base carries layout, so a caller's colour is the only colour in play. */
  className?: string;
  /** Which side the card hangs from. Cards near the bottom of the frame want `top`. */
  side?: 'top' | 'bottom';
  /** Fill the width it is given, for a stacked list rather than a wrapping row of chips. */
  block?: boolean;
  /**
   * For a tag that sits **inside** another control.
   *
   * `HoverCard`'s trigger is a real `<button>`, which is right for a tag standing on its own: a
   * tooltip a keyboard cannot reach is a tooltip half the players never see. Inside a button it is
   * invalid HTML (`<button>` inside `<button>`), the browser's own recovery is unpredictable, and
   * the nested control competes with the card's click for the same pointer.
   *
   * So a nested tag drops to a plain `<span>` carrying `data-tip`, the delegated tooltip the rest
   * of the game uses. The word still explains itself on hover; the detail is behind the card's own
   * click, which is where a nested tag's reader was going anyway.
   */
  nested?: boolean;
}

export function DescribedTag({
  label,
  description,
  detail,
  className = 'border-surface-600 text-ink-300',
  side = 'bottom',
  block = false,
  nested = false,
}: DescribedTagProps) {
  const face = cn(
    'inline-flex items-center border px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.16em]',
    block ? 'w-full justify-center' : 'shrink-0',
    className,
  );

  if (nested) {
    return (
      <span className={face} data-tip={detail ? `${description} ${detail}` : description}>
        {label}
      </span>
    );
  }

  return (
    <HoverCard
      label={label}
      side={side}
      {...(block ? { className: 'w-full' } : {})}
      card={
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300">
            {label}
          </p>
          <p className="font-body text-xs leading-relaxed text-ink-100">{description}</p>
          {detail !== undefined && (
            <p className="font-display text-[11px] uppercase leading-relaxed tracking-[0.1em] text-ink-300">
              {detail}
            </p>
          )}
        </div>
      }
    >
      <span className={face}>{label}</span>
    </HoverCard>
  );
}
