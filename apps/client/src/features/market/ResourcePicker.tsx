import { RESOURCE_LABELS, RESOURCE_ORDER, type ResourceKey } from '@frontline/shared';
import type { ReactNode } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { cn } from '../../lib/cn';

/**
 * Pick a material by pointing at it.
 *
 * There are six materials and every one of them has painted art the game already draws in the
 * standing bar. A dropdown of six words is a control that hides art behind a label, costs two
 * clicks instead of one, and puts an operating-system-shaped list over a painted panel. A row of
 * six tiles is one click, and the thing a player is choosing is the thing they can see.
 *
 * The held amount rides on each tile, because "which of these do I have too much of" is the
 * question a market screen is actually being asked, and the answer used to be somewhere else. A
 * counter that sells rather than swaps passes `caption` and puts its price there instead; the
 * stockpile stays on the tooltip either way.
 */
export function ResourcePicker({
  value,
  onChange,
  held,
  keys = RESOURCE_ORDER,
  disabled,
  caption,
  label,
  'data-testid': testId,
}: {
  value: ResourceKey;
  onChange: (key: ResourceKey) => void;
  /** The crew's stockpile, so each tile can say what is behind it. */
  held: Partial<Record<ResourceKey, number>>;
  /** Which materials are on offer here. The supply run does not sell every one of them. */
  keys?: readonly ResourceKey[];
  /** Materials that cannot be picked right now, and why they are drawn anyway. */
  disabled?: (key: ResourceKey) => boolean;
  /** What to print under the art instead of the held amount. */
  caption?: (key: ResourceKey) => ReactNode;
  label: string;
  'data-testid'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1.5"
      data-testid={testId}
    >
      {keys.map((key) => {
        const chosen = key === value;
        const off = disabled?.(key) ?? false;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={RESOURCE_LABELS[key]}
            disabled={off}
            onClick={() => onChange(key)}
            data-tip={`${RESOURCE_LABELS[key]} · ${(held[key] ?? 0).toLocaleString()} held`}
            data-testid={testId === undefined ? undefined : `${testId}-${key}`}
            className={cn(
              'door-tile group relative flex w-[4.5rem] flex-col items-center gap-1 rounded-lg border px-1 py-1.5',
              'transition-all duration-150 ease-out focus-visible:outline-none',
              chosen
                ? 'door-tile-active z-10 -translate-y-0.5 border-brass-300 text-brass-100'
                : 'border-surface-500/70 text-ink-200 hover:-translate-y-0.5 hover:border-iris-300/80 hover:text-iris-100',
              off &&
                'cursor-not-allowed opacity-40 hover:translate-y-0 hover:border-surface-500/70',
            )}
          >
            <ResourceIcon
              kind={key}
              className="relative z-[2] h-8 w-8 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]"
            />
            <span className="relative z-[2] flex items-center gap-0.5 font-display text-[10px] font-bold leading-none tabular-nums">
              {caption?.(key) ?? (held[key] ?? 0).toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
