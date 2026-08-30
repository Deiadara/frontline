import { useId, type KeyboardEventHandler } from 'react';
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
 * chrome's own brass, with the field's own border around all three. The input stays a real
 * `type="number"` underneath, so a keyboard still gets arrow keys, a phone still gets the numeric
 * pad, and assistive tech still hears a spinbutton.
 */

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

  const step = (delta: number) => () => onChange(clamp(value + delta));

  return (
    <span
      className={cn(
        'edge-lit flex items-stretch overflow-hidden rounded-sm border border-surface-600 bg-surface-950',
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
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
        onKeyDown={onKeyDown}
        data-testid={testId}
        // `appearance-none` is the whole point: it takes the browser's own spinners out, and the
        // two `::-webkit-*` rules in `index.css` take them out of Chromium, which ignores it.
        className="no-spinner w-12 grow appearance-none border-x border-surface-600 bg-transparent px-1 py-1.5 text-center font-display text-[14px] font-bold tabular-nums text-ink-100 focus-visible:outline-none"
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
