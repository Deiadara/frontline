import { garrisonOf, isPlainDay, weatherAt, type District } from '@frontline/shared';
import type { ReactNode } from 'react';
import { Icon } from '../../components/ui/Icon';
import { WeatherBanner } from '../../components/ui/WeatherBanner';
import { cn } from '../../lib/cn';

/**
 * What is true of the whole district rather than of one thing on it (maintainer request, 2026-09-11).
 *
 * The sky, who is standing here, and what holding the whole place pays. It was one paragraph with
 * the bonus's title run into its effect on the same line ("THE FACULTY ANSWERS TO YOU +20%
 * research..."), which read as one long sentence in two typefaces. It is a ruled box now: three
 * facts, each behind its own label, and the bonus's name on a line of its own with the figure and
 * the description starting under it, the way the location sheets lay their own facts out.
 */
export function GroundBox({
  district,
  unified,
  at,
  className,
}: {
  district: District;
  unified: { title: string; effect: string } | null;
  /** The server's clock, so the sky is the sky the rules are using. */
  at: Date;
  className?: string;
}) {
  const plain = isPlainDay(weatherAt(at));
  return (
    <div
      className={cn(
        'flex flex-col rounded-sm border border-surface-600/70 bg-surface-950/85 backdrop-blur-sm',
        className,
      )}
      data-testid="district-standing"
    >
      <GroundRow label="Sky">
        {/* The banner says nothing on an ordinary day, on purpose: a strip that is always there
            is a strip nobody reads. The row still has to hold something, or the box opens on a
            label with a hole under it. */}
        {plain ? (
          <p className="font-body text-[12px] leading-relaxed text-ink-300">
            Clear. Nothing the weather puts on the ground today.
          </p>
        ) : (
          <WeatherBanner at={at} />
        )}
      </GroundRow>
      <GroundRow label="Garrison">
        <p className="font-body text-[12px] leading-relaxed text-ink-300">
          Expect {garrisonOf(district)}.
        </p>
      </GroundRow>
      <GroundRow label="Hold every location">
        {unified ? (
          <UnifiedBonusLines unified={unified} />
        ) : (
          <p className="font-body text-[12px] leading-relaxed text-ink-300">
            Nothing extra for taking the whole of this ground.
          </p>
        )}
      </GroundRow>
    </div>
  );
}

/**
 * The §A4 unified bonus, on three lines: its name, its figure, and what the figure is on top of.
 *
 * Shared with the unpainted district page, which had the same run-on sentence.
 */
export function UnifiedBonusLines({ unified }: { unified: { title: string; effect: string } }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid="unified-bonus">
      <p className="font-stamp text-[15px] leading-tight text-brass-100">{unified.title}</p>
      <p className="font-display text-[13px] font-bold tabular-nums tracking-[0.04em] text-verdigris-100">
        {unified.effect}
      </p>
      <p className="font-body text-[11px] leading-snug text-ink-300">
        On top of what the locations themselves pay. Take every location here to earn it.
      </p>
    </div>
  );
}

function GroundRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-surface-700/70 px-3 py-2 last:border-b-0">
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-brass-300">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The button that opens the box, drawn to sit directly over it.
 *
 * It lived in the strip at the top left while the box opened at the top right, so the control and
 * the thing it controlled were the width of the screen apart. They are one column now.
 */
export function GroundToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="district-standing-toggle"
      aria-expanded={open}
      className={cn(
        'brushed relative flex items-center gap-2 rounded-sm border px-3 py-1.5 font-display text-[11px] uppercase tracking-[0.16em] backdrop-blur-sm transition-colors',
        open
          ? 'border-brass-300/60 bg-surface-950/85 text-brass-100'
          : 'border-transparent bg-surface-950/70 text-brass-300 hover:border-brass-300/40 hover:text-brass-100',
      )}
    >
      <span aria-hidden className="[&_svg]:h-3.5 [&_svg]:w-3.5">
        <Icon name="info" />
      </span>
      {open ? 'Hide the ground' : 'The ground'}
    </button>
  );
}
