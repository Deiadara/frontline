import { useState } from 'react';
import { CITIES } from '@frontline/shared';
import { cn } from '../../lib/cn';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { DrawnFace } from '../../components/ui/DrawnMarks';

/**
 * Which city's room you are standing in (maintainer request, 2026-09-17).
 *
 * "If you own even a single location in a district, you can access its bar and its market. So in
 * the bar and in the market have a Choose City button that can change the city you want to access.
 * The default is yours."
 *
 * The rule behind it is `city/access.ts` in `@frontline/shared` and the server is what applies it:
 * this takes the list of cities it was told the crew may enter and does nothing clever with it. A
 * client that worked the list out for itself would be a client guessing at who holds what, which it
 * cannot see.
 *
 * ## Why it is drawn even with one city in it
 *
 * A crew starts in the city it picked (2026-09-24) and gets into the other by marching across and
 * taking ground, so most crews will press this and find one room for a while. It is still drawn,
 * and it still says which city it is: a player who has never left needs to know the door exists
 * before the day they take a place abroad, and a control that appears only once it has two things
 * in it is a control nobody discovers.
 *
 * ## The `readOnly` tag that used to be here
 *
 * There was a second mode that drew this as a label rather than a door, for the Black Market, on
 * the grounds that the back room was one shelf for the whole world. That stopped being true when
 * black-market lot ids grew a room prefix: the shelf, its reserve and its bids are per city now and
 * that screen has been switching for a while. Nothing passed the prop, so the only thing it was
 * still doing was documenting something false. Removed on 2026-09-24.
 */

const NAMES = new Map(CITIES.map((city) => [city.id, city]));

/** What to call a city id the map has forgotten. Better than an empty button. */
function nameOf(cityId: string): string {
  return NAMES.get(cityId)?.name ?? cityId;
}

export function CityPicker({
  cityId,
  cities,
  onChoose,
  size = 'sm',
  className,
}: {
  /** The city whose room is open. */
  cityId: string;
  /** Every city this crew may walk into, their own first. From the server. */
  cities: readonly string[];
  onChoose: (next: string) => void;
  /**
   * How big the door is drawn.
   *
   * `sm` on a sheet, where it shares a line with a quotation and should not shout over it. `md` on
   * the Bar (maintainer, 2026-09-17), which is a painted room rather than a sheet: a chip that
   * reads as a control on paper reads as a smudge over artwork, so it takes the larger of the two.
   */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const alone = cities.length <= 1;

  return (
    <div className={cn('relative', className)} data-testid="city-picker">
      <DrawnButton
        size={size}
        data-sound="click"
        data-testid="city-picker-open"
        // No tip while the list is open: it hangs where the list does and covered it.
        data-tip={
          open
            ? undefined
            : alone
              ? 'You hold ground in one city. Take a place in another and its rooms open to you.'
              : 'Which city’s room to stand in'
        }
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {nameOf(cityId)}
      </DrawnButton>

      {open && !alone && (
        /*
         * Hung off the button rather than portalled.
         *
         * Every screen this sits on is a full-height frame with room under the control, and a list
         * of three is not a menu worth a portal. `z-30` clears the art overlays on the Bar, which
         * are the only things it can land on.
         *
         * The float is its own wrapper (maintainer, 2026-09-28): `card-paper` and `washed` both set
         * `position: relative` later in the cascade than `absolute`, so on the list itself they won
         * and the list opened in the flow, pushing the sheet under it down by its own height.
         */
        <div className="absolute right-0 top-full z-30 mt-1.5 w-max">
          <ul
            className="ink-frame card-paper washed grain flex min-w-[11rem] flex-col gap-1 rounded-sm p-1.5 shadow-panel"
            data-testid="city-picker-list"
          >
            {cities.map((id) => {
              const here = id === cityId;
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-sound="click"
                    data-testid={`city-choose-${id}`}
                    aria-pressed={here}
                    onClick={() => {
                      onChoose(id);
                      setOpen(false);
                    }}
                    className={cn(
                      'relative flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-all duration-150',
                      'hover:-translate-y-px active:translate-y-px',
                      here ? 'text-brass-100' : 'text-ink-200 hover:text-brass-100',
                    )}
                  >
                    <DrawnFace face={here ? 'fill-brass-500/30' : 'fill-surface-900/50'} />
                    {/* The name only, no nickname (maintainer, 2026-10-04). */}
                    <span className="relative font-stamp text-[14px] leading-tight">
                      {nameOf(id)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
