import { CITIES, cityCounts, type City } from '@frontline/shared';
import { Icon } from '../../components/ui/Icon';
import { Quote } from '../../components/ui/Quote';
import { cn } from '../../lib/cn';
import { CityPortrait } from './CityPortrait';

/**
 * The world: every city there is, as a wall of portraits (maintainer request, 2026-09-14).
 *
 * ## What this replaced
 *
 * One `InfoWindow` saying "The City, 12 districts" beside a panel saying "Coming soon". That was
 * honest when there was one city and nothing to compare it to. There are three now, and a list is
 * the wrong shape for a choice between places: a player picking where to work is picking between
 * *somewhere drowned* and *somewhere at the end of a railway*, and neither of those is a row.
 *
 * So: portraits, the way the crew screen draws people. Each card is a tall picture with the name
 * over it and what the place is under it, because that is the shape the eye reads as "pick one of
 * these" rather than "read this table". The pictures are procedural skylines seeded off the city id
 * (`CityPortrait`) and are a placeholder for the maintainer's own paintings, which drop in without
 * touching this file.
 *
 * ## Locked cities are drawn, not hidden
 *
 * Saltmarch and Verge Station have authored ground and no server behind them yet. A screen that
 * hid them would be the old "coming soon" panel with extra steps, and one that let a player press
 * into them would be a door onto an empty room. They are drawn dimmer, with what is in them and a
 * plain word about why the door is shut, which is the most useful true thing the screen can say.
 */
export function CitiesView({ onEnterCity }: { onEnterCity: () => void }) {
  return (
    // No `data-testid` here: the scroller in `CityView` that wraps this already carries
    // `cities-view`, and two elements answering one id is a locator that silently picks one.
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Quote className="max-w-prose">
        Somebody drew a line around this place and called it a city. There are two more lines out
        there, and people living inside both of them.
      </Quote>

      <ul className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CITIES.map((city) => (
          <li key={city.id} className="flex">
            <CityCard city={city} onEnter={onEnterCity} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CityCard({ city, onEnter }: { city: City; onEnter: () => void }) {
  const counts = cityCounts(city.id);
  const Tag = city.open ? 'button' : 'div';

  return (
    <Tag
      {...(city.open
        ? { type: 'button' as const, onClick: onEnter, 'data-sound': 'confirm' }
        : { 'aria-disabled': true })}
      data-testid={`city-card-${city.id}`}
      data-open={city.open ? 'true' : undefined}
      className={cn(
        'ink-frame card-paper group relative flex w-full flex-col overflow-hidden rounded-sm text-left shadow-panel',
        'transition-transform duration-150',
        city.open
          ? 'cursor-pointer hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300'
          : 'cursor-default',
      )}
    >
      {/*
       * The picture, portrait, with the name laid over its foot.
       *
       * `aspect-[3/4]` rather than a fixed height: the three cards sit in a grid that reflows from
       * one column to three, and a pinned height is the thing that makes the middle one taller
       * than its neighbours at exactly one width.
       */}
      <span className="relative block aspect-[3/4] w-full overflow-hidden">
        <CityPortrait cityId={city.id} dim={!city.open} />

        {/* The wash under the lettering. Without it the name sits on whatever the skyline happens
            to put there, which is a lit window as often as not. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-surface-950 via-surface-950/80 to-transparent"
        />

        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 px-3.5 pb-3">
          <span className="font-stamp text-[20px] leading-none text-ink-100">{city.name}</span>
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-brass-300">
            {city.nickname}
          </span>
        </span>

        {/* Whether you can go, said in the corner where a state badge belongs. */}
        <span
          className={cn(
            'absolute right-2.5 top-2.5 rounded-sm border px-1.5 py-px',
            'font-display text-[9px] font-bold uppercase tracking-[0.16em]',
            city.open
              ? 'border-verdigris-300/60 bg-verdigris-500/15 text-verdigris-100'
              : 'border-surface-500/70 bg-surface-950/70 text-ink-400',
          )}
          data-testid={`city-state-${city.id}`}
        >
          {city.open ? 'Open' : 'Shut'}
        </span>
      </span>

      <span className="flex flex-1 flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
        <span className="font-body text-[13px] leading-snug text-ink-200">{city.blurb}</span>

        <span aria-hidden className="ink-rule block" />

        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-3">
            <Count
              label="Contested"
              value={counts.contested}
              testId={`city-contested-${city.id}`}
            />
            <Count label="Plots" value={counts.plots} testId={`city-plots-${city.id}`} />
          </span>

          <span
            className={cn(
              'flex shrink-0 items-center gap-1.5 font-display text-[10px] font-bold uppercase tracking-[0.16em]',
              city.open ? 'text-brass-300 group-hover:text-brass-100' : 'text-ink-500',
            )}
          >
            {city.open ? (
              <>
                <Icon name="city" aria-hidden className="h-3.5 w-3.5" />
                Go there
              </>
            ) : (
              'No road yet'
            )}
          </span>
        </span>
      </span>
    </Tag>
  );
}

function Count({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className="font-stamp text-[15px] leading-none tabular-nums text-ink-100"
        data-testid={testId}
      >
        {value}
      </span>
      <span className="font-display text-[9px] font-bold uppercase tracking-[0.16em] text-ink-400">
        {label}
      </span>
    </span>
  );
}
