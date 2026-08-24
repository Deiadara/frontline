import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * Buttons have weight.
 *
 * The old ones were outlines that lit up: legible on a flat dark page, invisible over a painting
 * with lamps in it. These are pressed metal: a filled face, a dark bottom edge that reads as
 * thickness, and the press taking the edge away so the button physically goes down. That borrows
 * from Hero Zero, where a primary action is unmistakably the thing to hit, and it survives being
 * put on top of artwork, which an outline does not.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'border-brass-500 bg-brass-500/90 text-surface-950 shadow-lifted hover:bg-brass-300 ' +
    'active:translate-y-px active:shadow-none',
  danger:
    'border-oxblood-500 bg-oxblood-500/90 text-ink-100 shadow-lifted hover:bg-oxblood-300 ' +
    'active:translate-y-px active:shadow-none',
  ghost:
    'border-surface-600 bg-surface-800/70 text-ink-200 hover:border-brass-500/70 ' +
    'hover:bg-surface-700/80 hover:text-brass-100 active:translate-y-px',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[12px]',
  md: 'px-5 py-2.5 text-xs',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        // `shrink-0 whitespace-nowrap`. A button label is two or three words with wide tracking on
        // it, and every one of these sits in a flex row beside prose that is allowed to be long.
        // Without both, the row's free space is taken from the *button*, and "Burn it" breaks
        // across two lines on the cards where the description happens to be a sentence longer,
        // which is why the infamy sacrifices had three buttons on one line and one on two. Letting
        // the text push the row wider instead is the correct trade: labels here are fixed copy, and
        // the horizontal-overflow gate is what would catch it if one ever were not.
        'brushed relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border font-display font-bold uppercase tracking-[0.14em] transition-all duration-100',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:active:translate-y-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
