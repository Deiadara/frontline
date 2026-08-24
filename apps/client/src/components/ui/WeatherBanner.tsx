import {
  WEATHER_CATALOG,
  isNight,
  isPlainDay,
  weatherAt,
  weatherLabels,
  type WeatherKind,
} from '@frontline/shared';
import { LabelRow } from './LabelChip';
import { cn } from '../../lib/cn';

/**
 * The sky, and what it is doing to every fight in the city today (GDD §A4).
 *
 * One roll a day for the whole map, so this is deliberately *not* per-location: it belongs at the
 * top of the district screen where it reads as a fact about the day rather than about the ground.
 * A player planning a push at 23:50 has to be able to see that the ground is about to change under
 * them, and that the same yard is a different fight after dark.
 *
 * **Seven days in ten it renders nothing at all.** An ordinary day carries no labels and gets no
 * banner: a strip that is always there saying "Ordinary" would make the one morning it says "Fog"
 * indistinguishable from the wallpaper.
 */
export function WeatherBanner({ at, className }: { at: Date; className?: string }) {
  const kind: WeatherKind = weatherAt(at);
  const night = isNight(at);
  const labels = weatherLabels(kind, night);
  if (isPlainDay(kind) && !night) return null;

  const spec = WEATHER_CATALOG[kind];
  return (
    <div
      data-testid="weather"
      data-weather={kind}
      className={cn(
        'glass flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-surface-600/70 px-3 py-2',
        className,
      )}
    >
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
        {isPlainDay(kind) ? 'After dark' : spec.name}
      </span>
      <p className="min-w-0 flex-1 font-body text-[12px] leading-relaxed text-ink-300">
        {isPlainDay(kind)
          ? 'Nothing in the sky worth naming, and no light to see the ground by.'
          : spec.blurb}
      </p>
      <LabelRow labels={labels} size="sm" />
    </div>
  );
}
