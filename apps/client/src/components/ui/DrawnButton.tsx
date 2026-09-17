import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { DrawnFace } from './DrawnMarks';

/**
 * A button drawn with a pen rather than pressed out of brass (maintainer, 2026-09-17).
 *
 * The kit's `Button` is a struck plate, which is the right affordance on a machine: a Train, a Buy,
 * a Deploy. It is the wrong one on a sheet of paper. The feats board established the alternative
 * and the archive followed it, and the maintainer then asked for the market and the workshops as
 * well, at which point three screens copying an inline `<DrawnFace>` and a set of padding classes is
 * three places for them to drift apart.
 *
 * So this is the drawn `Button`: the same `onClick`, `disabled` and `data-testid` a caller already
 * passes, with the hand-inked box behind the label and the press animated on the *face* rather than
 * on the frame, which reads as paper being pushed instead of a border changing colour.
 *
 * `ClaimButton` on the feats board stays its own component: it carries a pending label and an
 * aria-label that changes with what it is claiming, which is behaviour rather than skin.
 */

export type DrawnButtonSize = 'sm' | 'md';

/**
 * Padding and type per size, and the two are one decision.
 *
 * The horizontal padding is the part that matters and the reason it is generous: the drawn box is
 * an SVG stretched to the element, so its line sits a couple of pixels inside the edge whatever the
 * width, and a label that runs to the padding runs into the pen. See `DrawnFace`.
 */
const SIZE: Record<DrawnButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[11px] tracking-[0.14em]',
  md: 'px-3.5 py-[8.7px] text-[13px] tracking-[0.1em]',
};

export interface DrawnButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: DrawnButtonSize;
  /** A control nobody can press right now: drawn flat, with no lift and no brass in the face. */
  disabled?: boolean;
  children: ReactNode;
}

export function DrawnButton({
  size = 'md',
  disabled = false,
  className,
  children,
  type = 'button',
  ...rest
}: DrawnButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      // The sound every press that banks or spends makes, read by the delegated listener in
      // `lib/sound.ts` the same way `Button` declares its own.
      data-sound="confirm"
      className={cn(
        'group/drawn relative inline-flex shrink-0 items-center justify-center gap-1.5',
        'font-display font-bold uppercase leading-none transition-all duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300',
        SIZE[size],
        disabled
          ? 'cursor-not-allowed text-ink-400'
          : 'text-brass-300 hover:-translate-y-px hover:text-brass-100 active:translate-y-px',
        className,
      )}
      {...rest}
    >
      <DrawnFace
        face={cn(
          'transition-all duration-150',
          disabled
            ? 'fill-surface-950/50'
            : 'fill-brass-500/25 group-hover/drawn:fill-brass-500/40 group-active/drawn:fill-brass-500/15',
        )}
      />
      <span className="relative">{children}</span>
    </button>
  );
}
