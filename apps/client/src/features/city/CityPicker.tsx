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
 * Ashfall is the only city with `open: true` today, so most crews will press this and find one
 * room. It is still drawn, and it still says which city it is: a player who has never left needs to
 * know the door exists before the day they take a place in Saltmarch, and a control that appears
 * only once it has two things in it is a control nobody discovers.
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
  readOnly = false,
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
  /**
   * Drawn as a tag rather than a door.
   *
   * The Black Market's shelf, its lot ids and its turnover counter are keyed by the day and the slot
   * alone, so it is one shelf for the world and cannot yet be switched (maintainer, 2026-09-17: the
   * tag was asked for on that screen, and a picker that changed the label without changing the
   * crates would be a lie). It still says which city the reader is standing in, in the same hand as
   * the two screens that can switch.
   */
  readOnly?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const alone = readOnly || cities.length <= 1;

  return (
    <div className={cn('relative', className)} data-testid="city-picker">
      <DrawnButton
        size={size}
        data-sound="click"
        data-testid="city-picker-open"
        data-tip={
          readOnly
            ? 'The city you are standing in. The back room is the same shelf wherever you read it.'
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
         */
        <ul
          className="ink-frame card-paper washed grain absolute right-0 z-30 mt-1.5 flex min-w-[11rem] flex-col gap-1 rounded-sm p-1.5 shadow-panel"
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
                  <span className="relative font-stamp text-[14px] leading-tight">
                    {nameOf(id)}
                  </span>
                  <span className="relative font-body text-[11px] opacity-70">
                    {NAMES.get(id)?.nickname ?? ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
