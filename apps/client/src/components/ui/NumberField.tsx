import { useEffect, useId, useState, type KeyboardEventHandler } from 'react';
import { Icon } from './Icon';
import { cn } from '../../lib/cn';

/**
 * A number field with the game's own steppers on it.
 *
 * `<input type="number">` draws its spinners itself, and what the browser draws is a pair of grey
 * chevrons in a 12px column: system chrome, at system scale, in system colours, sitting inside a
 * panel made of painted tin. They are also the only control in the interface that appears on hover
 * and vanishes again, which is the one behaviour an affordance must not have.
 *
 * So the native spinners are hidden and two real buttons take their place: full-height, in the
 * chrome's own brass, with the field's own border around all three.
 *
 * ## Typing (board request, 2026-09-09)
 *
 * The input is text with a numeric keypad, not `type="number"`, and it holds a **draft** while it
 * has focus. A controlled number input cannot be emptied: the moment the last digit went, the
 * empty string parsed to zero, zero clamped to the floor, and the floor was written back, so a
 * player who cleared a field to type an exact figure got the floor's digit in front of whatever
 * they typed. Now the draft is what the player typed, digits only, leading zeros dropped, and the
 * field opens with its figure selected so the first keystroke replaces it. The value the screen
 * reads follows every keystroke (capped at the ceiling, so a quote beside the field is live), and
 * the floor is applied when the field is left or Enter is pressed: a figure under the floor is a
 * figure still being typed, not a mistake to correct mid-word.
 *
 * ## Width
 *
 * Six digits, always. The field is sized to `MAX_DIGITS` in tabular figures rather than to the
 * number in it, so a count growing from 1 to 100,000 changes nothing around it: the digits fill
 * more of the same box. A caller may still set the outer width; the box never gets narrower than
 * the digits it promises.
 */

/** How many digits the box is sized for. Six covers every count and price a field holds. */
export const MAX_DIGITS = 6;

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /**
   * How much a stepper moves the value. One for a count of soldiers; more where the field holds a
   * figure in caps and a single point is below what anybody would haggle over.
   */
  step?: number;
  /** What the field is called, for anyone who cannot see the thing it sits next to. */
  label: string;
  disabled?: boolean;
  /** For a field whose panel treats Enter as "submit". Passed through to the input. */
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  className?: string;
  'data-testid'?: string;
}

/** Digits only, leading zeros gone, at most the digits the box holds. */
export function digitsOf(raw: string): string {
  return raw
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, MAX_DIGITS);
}

/**
 * What the box shows while it is typed in: the digits, behind a minus where the floor allows one.
 *
 * A field whose floor is under zero is a field of deltas (the deploy dialog pulls bodies off a
 * ring by typing a negative count), so the sign is kept there and only there. A bare minus is a
 * draft with no figure in it yet.
 */
export function draftOf(raw: string, negative: boolean): string {
  const sign = negative && raw.trimStart().startsWith('-') ? '-' : '';
  return sign + digitsOf(raw);
}

export function NumberField({
  value,
  onChange,
  min = 1,
  max = 99,
  step: by = 1,
  label,
  disabled = false,
  onKeyDown,
  className,
  'data-testid': testId,
}: NumberFieldProps) {
  const id = useId();
  const clamp = (next: number): number =>
    Math.min(max, Math.max(min, Number.isFinite(next) ? Math.trunc(next) : min));

  /*
   * The draft: null while the field is not being typed in, so the input shows `value`; a string
   * of digits while it is. Reset whenever the value moves from outside (a stepper, a quick
   * fraction, the table's floor rising under the bid window), or the field would go on showing
   * what was typed over a figure the screen has since changed.
   */
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    setDraft((current) => (current === null ? null : current === String(value) ? current : null));
  }, [value]);

  const step = (delta: number) => () => {
    setDraft(null);
    onChange(clamp(value + delta));
  };

  const type = (raw: string) => {
    const next = draftOf(raw, min < 0);
    setDraft(next);
    const digits = next.replace('-', '');
    if (digits === '') return;
    const typed = Number(next);
    /*
     * Live for the screen, and the floor applied once the figure is as long as the floor: "7" in
     * a field whose floor is 10 is a figure still being typed, but "75" is not, and "-5" against
     * a floor of -3 is a delta the screen should refuse now rather than after the press. A lone
     * zero is never clamped, or the zero a player typed over would come back as the floor.
     */
    const settled = digits !== '0' && digits.length >= String(Math.abs(min)).length;
    onChange(settled ? clamp(typed) : Math.min(max, typed));
  };

  const settle = () => {
    setDraft(null);
    onChange(clamp(draft === null || draft === '' ? value : Number(draft)));
  };

  const keys: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      step(by)();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      step(-by)();
    } else if (event.key === 'Enter') {
      settle();
    }
    onKeyDown?.(event);
  };

  return (
    <span
      className={cn(
        'edge-lit inline-flex items-stretch overflow-hidden rounded-sm border border-surface-600 bg-surface-950',
        disabled && 'opacity-50',
        className,
      )}
    >
      <Step
        direction="down"
        onClick={step(-by)}
        disabled={disabled || value <= min}
        label={by === 1 ? `One fewer ${label}` : `${by} fewer ${label}`}
      />
      {/*
       * Named on the input rather than by a clipped `<label>`. `sr-only` clips its text to a 1px
       * box, which is the exact shape every "is any text cut off?" gate looks for, so a stepper
       * on a gated screen read as a cut word. `aria-label` names it the same to a reader and to
       * `getByLabelText`, and draws nothing. `role="spinbutton"` with the three values is what a
       * reader heard from the number input this replaces.
       */}
      <input
        aria-label={label}
        id={id}
        type="text"
        role="spinbutton"
        inputMode="numeric"
        pattern="[0-9]*"
        min={min}
        max={max}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        value={draft ?? String(value)}
        disabled={disabled}
        onChange={(event) => type(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={settle}
        onKeyDown={keys}
        data-testid={testId}
        // Sized to the digits, not to the number: see the note on width above. `min-w` rather than
        // `w`, so a caller's wider frame still stretches the box and a narrower one cannot squeeze
        // a six-figure count.
        className="no-spinner min-w-[4.25rem] grow appearance-none border-x border-surface-600 bg-transparent px-1 py-1.5 text-center font-display text-[14px] font-bold tabular-nums text-ink-100 focus-visible:outline-none"
      />
      <Step
        direction="up"
        onClick={step(by)}
        disabled={disabled || value >= max}
        label={by === 1 ? `One more ${label}` : `${by} more ${label}`}
      />
    </span>
  );
}

function Step({
  direction,
  onClick,
  disabled,
  label,
}: {
  direction: 'up' | 'down';
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      tabIndex={-1}
      className={cn(
        'flex w-7 items-center justify-center bg-surface-800/80 text-brass-300 transition-colors',
        'hover:bg-brass-300/15 hover:text-brass-100 active:bg-brass-300/25',
        'disabled:cursor-not-allowed disabled:text-ink-500 disabled:hover:bg-surface-800/80',
      )}
    >
      <Icon name={direction === 'up' ? 'chevron-up' : 'chevron-down'} className="h-3.5 w-3.5" />
    </button>
  );
}
