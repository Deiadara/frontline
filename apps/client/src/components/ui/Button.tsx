import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import type { SoundKind } from '../../lib/sound';

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
  // `brushed-deep`: the drawn line round a brass face has to be a darker orange or it is the face.
  primary:
    'brushed-deep border-brass-500 bg-brass-500/90 text-surface-950 shadow-lifted hover:bg-brass-300 ' +
    'active:translate-y-px active:shadow-none',
  danger:
    'border-oxblood-500 bg-oxblood-500/90 text-ink-100 shadow-lifted hover:bg-oxblood-300 ' +
    'active:translate-y-px active:shadow-none',
  ghost:
    'border-surface-600 bg-surface-800/70 text-ink-200 hover:border-brass-500/70 ' +
    'hover:bg-surface-700/80 hover:text-brass-100 active:translate-y-px',
};

/**
 * What each variant sounds like when it is pressed.
 *
 * A press that spends, commits or destroys gets the firmer confirm; a ghost is a secondary action
 * (cancel, close, switch tab) and gets the ordinary click. Read by the delegated listener in
 * `lib/sound.ts`, which is why it is an attribute rather than an `onClick` here: a `Button` whose
 * caller passes its own `data-sound` overrides this, and `buttonSkin` sites carry theirs on the
 * element they dress.
 */
const SOUNDS: Record<Variant, SoundKind> = {
  primary: 'confirm',
  danger: 'confirm',
  ghost: 'click',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[12px]',
  md: 'px-5 py-2.5 text-xs',
};

/**
 * A button's dressing, without the `<button>`.
 *
 * For the places that must look like one of these and must not *be* one: a `HoverCard` trigger is
 * already a button, and nesting a second inside it is invalid markup that no keyboard reaches in
 * the order anybody expects. Those sites put this on a `<span>` inside the trigger, which is how
 * "Station units in the periphery" sits level with "Move people" beside it and still carries its
 * own explanation.
 */
export function buttonSkin({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: Variant | undefined;
  size?: Size | undefined;
  className?: string | undefined;
} = {}): string {
  return cn(
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
  );
}

/**
 * The dressing for a tab or a toggle: the same drawn line the buttons carry, on a control that
 * picks rather than acts (maintainer request, 2026-09-11).
 *
 * Every screen with tabs had its own copy of this class list, and none of them carried the
 * `brushed` stroke, so a row of tabs sat over a row of drawn buttons looking like a different
 * program. One skin, so the tabs on the battle board, the units roster and the market read as the
 * same hand that drew Withdraw.
 */
export function tabSkin({
  active,
  className,
}: {
  active: boolean;
  className?: string | undefined;
}): string {
  return cn(
    'brushed relative flex items-center gap-2 rounded-sm border px-3 py-2 transition-colors duration-150',
    'font-display text-[12px] font-bold uppercase tracking-[0.14em]',
    active
      ? 'border-brass-300/80 bg-brass-300/15 text-brass-100'
      : 'border-surface-600 bg-surface-800/70 text-ink-300 hover:border-iris-300/60 hover:text-ink-100',
    className,
  );
}

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
      data-sound={SOUNDS[variant]}
      className={buttonSkin({ variant, size, className })}
      {...rest}
    />
  );
}
