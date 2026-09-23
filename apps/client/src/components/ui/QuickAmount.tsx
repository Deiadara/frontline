import { cn } from '../../lib/cn';

/**
 * A one-press amount beside a {@link NumberField}: drawn, because it is a note rather than a
 * machine.
 *
 * "Half" and "Max" are the two counts a player actually picks off a stack, and stepping to either
 * one arrow-press at a time on forty Razors is typing rather than a decision. It lives here rather
 * than in the mission board because the Right Hand's standing orders pick a party the same way and
 * must look the same doing it (maintainer, 2026-09-23).
 */
export function QuickAmount({
  label,
  onClick,
  disabled,
  testId,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  testId: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'ink-box px-2 py-1 font-stamp text-[11px] leading-none text-brass-300 transition-colors',
        'hover:text-brass-100 disabled:opacity-40',
        className,
      )}
    >
      {label}
    </button>
  );
}
