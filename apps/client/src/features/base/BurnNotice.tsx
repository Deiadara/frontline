import { BUILD_BOOST_PERCENT, buildBoostRemainingMs, type EconomyState } from '@frontline/shared';
import { formatDuration } from './format';

/**
 * The Generator's burn, while it is lit (maintainer, 2026-09-28).
 *
 * The burn is bought on the Generator's window and paid for once, and then nothing on the
 * district said it was running: the countdown lived in the window it was bought from. This is
 * the pop-up that says so, at the top of the district and of every location the crew holds,
 * because those are the places the faster clock is felt. Nothing while it is out.
 *
 * Read off the district's stored timestamp against the caller's clock rather than ticked here, so
 * it is right after a reload and after the tab has slept.
 */
export function BurnNotice({ economy, now }: { economy: EconomyState; now: Date }) {
  const remainingMs = buildBoostRemainingMs(economy.buildBoostUntil, now);
  if (remainingMs <= 0) return null;
  return (
    <section
      aria-label="The tanks are burning"
      data-testid="burn-notice"
      // Opaque, because it is drawn over the painted district: a wash of brass over the scene
      // read as part of the scenery, and the sentence in it could not be read.
      className="border border-brass-500/70 bg-surface-950/95 px-3 py-2 shadow-panel"
    >
      <p className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
        The tanks are burning
      </p>
      <p className="font-body text-[12px] leading-snug text-ink-100">
        Every building upgrade runs {BUILD_BOOST_PERCENT}% faster for another{' '}
        <span className="tabular-nums">{formatDuration(remainingMs / 1000)}</span>.
      </p>
    </section>
  );
}
