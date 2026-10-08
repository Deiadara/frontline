import { CITIES, type City, type CityHomeOffer } from '@frontline/shared';
import { cn } from '../../lib/cn';
import { CityPortrait } from './CityPortrait';

/**
 * The two modes, as a type: a wall of doors, or a wall of things to pick between.
 *
 * A union rather than two optional callbacks, so neither screen can be built half way. The world
 * screen has to have somewhere for a press to go, and the choose screen must not be given a door.
 */
type CitiesViewProps =
  | { onEnterCity: (cityId: string) => void; choosing?: undefined }
  | { onEnterCity?: undefined; choosing: CityChoosing };

/** The choose-a-home mode: what the server is offering, and what the player has pressed so far. */
export interface CityChoosing {
  /** One entry per city, off `GET /overseer/choices`. A city with no entry cannot be chosen. */
  offers: readonly CityHomeOffer[];
  selectedId: string | null;
  onSelect: (cityId: string) => void;
}

/**
 * The world: every city there is, as a wall of portraits (maintainer request, 2026-09-24).
 *
 * ## The shape
 *
 * Five tall pictures in a row, staggered so the first, third and fifth ride high and the second and
 * fourth ride low. The stagger is the whole reason the screen reads as a wall of portraits rather
 * than as a filmstrip: five identical rectangles on one baseline is a table with the lines rubbed
 * out, and a row that rises and falls is something you look along. It is symmetric because the
 * count is odd, which is also why the count is odd: when Arca arrived it took Saltmarch's
 * place rather than a sixth column (maintainer, 2026-10-06).
 *
 * Each card carries three things and nothing else: the name, what the street calls it, and what the
 * place is. The counts of contested ground and plots that used to sit under the blurb are gone
 * (maintainer, 2026-09-24). They were the most table-like thing on a screen whose job is a choice
 * between places, and four of the five cities are shut, so for four of them the numbers described
 * ground nobody can stand on.
 *
 * ## Why the row is one grid and not five cards
 *
 * The five blurbs are different lengths, and at a given width they run to different numbers of
 * lines: three for Verge Station, four for Deepcut. Five cards that each sized their own picture
 * would then put five names at five different heights, which on a staggered row reads as a mistake
 * rather than as a stagger. So the row is a **subgrid**: two rows, the picture at `1fr` and the
 * text below it at `auto`, and every card spans both. One row height is negotiated across all five,
 * so the longest blurb sets the text band and every picture is the same height as every other. No
 * magic number anywhere, and it stays true at any width and for any blurb somebody writes later.
 *
 * The stagger is a transform rather than `self-start` / `self-end` for the same reason: aligning
 * the cards differently inside the track would take them out of the shared rows.
 *
 * ## Which of them are doors
 *
 * The ones with a painted map, a seeded world and a mission board: Ashfall, and Terminus since
 * 2026-09-24. Pressing one takes you to that city's map, which is the only way to look at a city
 * you do not live in. The rest are drawn at full strength and are simply not pressable: no badge,
 * no greyed-out word, nothing that explains itself. A player who presses one and gets nothing has
 * learned the same thing the badge would have told them, and the screen stays a wall of paintings
 * instead of a status board.
 *
 * ## Choosing one instead of entering it (maintainer, 2026-09-24)
 *
 * A new player picks the city they will live in off this same wall, with the same paintings, right
 * after they pick their overseer. `choosing` is that mode, and it is a mode rather than a second
 * component on purpose: the two screens have to stay the same picture, and a copy would drift the
 * first time either one is retouched.
 *
 * What changes with it is what a press means and what a card may say. Pressing selects rather than
 * navigates, the selected card is ringed, and a card the server will not seat a crew on is
 * unpressable with a line saying which of the two reasons it is: no map yet, or four crews already
 * live there. That line is the one departure from "the screen stays a wall of paintings instead of
 * a status board", and it is the maintainer's: "if a city is full it will show it but as locked".
 * Every card carries one, including the ones on offer, so the five text bands stay the same height
 * and the row does not go ragged.
 *
 * This screen used to suppress the shell's corner sprites while it was mounted, because a robot arm
 * lying across the bottom-left card read as part of the picture rather than as furniture in the
 * room behind it. The sprites came off the game entirely on 2026-09-25, so there is nothing left to
 * suppress. The district backdrop stays: it is the room these paintings are hung in.
 */
export function CitiesView({ onEnterCity, choosing }: CitiesViewProps) {
  return (
    // No `data-testid` here: the scroller in `CityView` that wraps this already carries
    // `cities-view`, and two elements answering one id is a locator that silently picks one.
    <div className="mx-auto flex h-full w-full max-w-[1800px] items-start lg:items-center">
      <div
        className={cn(
          'grid w-full grid-cols-2 gap-4 sm:grid-cols-3',
          // The wall proper. 86% of the frame leaves 7% of slack above and below for the cards to
          // ride into, which is exactly what the stagger below spends.
          'lg:h-[86%] lg:grid-cols-5 lg:grid-rows-[1fr_auto] lg:gap-x-5 lg:gap-y-0',
        )}
      >
        {CITIES.map((city, at) => (
          <CityCard
            key={city.id}
            city={city}
            high={at % 2 === 0}
            onEnter={() => onEnterCity?.(city.id)}
            choosing={choosing}
          />
        ))}
      </div>
    </div>
  );
}

/** What a card says about itself while a player is picking somewhere to live. */
function homeLine(offer: CityHomeOffer | undefined): string {
  if (offer === undefined || offer.refusal === 'unbuilt') return 'No map here yet';
  // The city's own plot count, which is data: not every map will have four.
  if (offer.refusal === 'full') return `Full: ${offer.plots} crews already live here`;
  return offer.free === 1 ? 'One plot left' : `${offer.free} of ${offer.plots} plots free`;
}

function CityCard({
  city,
  high,
  onEnter,
  choosing,
}: {
  city: City;
  /** Rides above the line rather than below it. The first, third and fifth do. */
  high: boolean;
  onEnter: () => void;
  /** Explicitly `undefined` on the world screen: this project runs `exactOptionalPropertyTypes`. */
  choosing: CityChoosing | undefined;
}) {
  const offer = choosing?.offers.find((one) => one.cityId === city.id);
  /*
   * Pressable for two different reasons, and the offer wins where there is one.
   *
   * On the world screen a card is a door, and a city with a map is a door. While choosing, a city
   * with a map that is full is not somewhere a crew can move in, so the server's answer is what
   * decides: the client cannot see who lives where and must not guess.
   */
  const pressable = choosing === undefined ? city.open : offer?.available === true;
  // Only while it can still be taken (bug pass, 2026-10-06): a city that filled while it was the
  // pick went on saying "Chosen" on a card drawn shut.
  const chosen = pressable && choosing !== undefined && choosing.selectedId === city.id;
  const press = choosing === undefined ? onEnter : () => choosing.onSelect(city.id);
  const Tag = pressable ? 'button' : 'div';

  return (
    <Tag
      {...(pressable
        ? {
            type: 'button' as const,
            onClick: press,
            'data-sound': 'confirm' as const,
            ...(choosing === undefined ? {} : { 'aria-pressed': chosen }),
          }
        : { 'aria-disabled': true })}
      data-testid={`city-card-${city.id}`}
      data-open={pressable ? 'true' : undefined}
      data-chosen={chosen ? 'true' : undefined}
      className={cn(
        'card-paper group relative flex w-full flex-col overflow-hidden text-left shadow-panel',
        /*
         * A rounded rectangle rather than the game's `ink-frame`, and the one place in the app
         * that departs from it. The maintainer asked for this shape by picture, and `ink-frame`
         * cannot make it: it is a `border-image`, and a border image is not clipped by
         * `border-radius`, so a card wearing both gets a square drawn frame around rounded
         * artwork. The stroke here is `ink-frame`'s own colour and opacity at its own weight, so
         * the five cards still read as the same hand that drew every other panel.
         */
        'rounded-2xl border-2 border-[#e6c99a]/[0.38]',
        // Both rows of the wall, so the picture and the text land in the shared tracks.
        'lg:grid lg:row-span-2 lg:grid-rows-subgrid',
        /*
         * The stagger, and the only place it is expressed. A percentage of the card rather than a
         * pixel offset, so the rise and fall scales with the screen: a 40px step is a shove at 1920
         * and a shrug at 1024. Below `lg` the row has wrapped into two or three columns and a
         * stagger there would just be a ragged grid, so it goes with the fifth column.
         */
        high ? 'lg:-translate-y-[7%]' : 'lg:translate-y-[7%]',
        'transition-transform duration-150',
        pressable
          ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300'
          : 'cursor-default',
        // The one the player has pressed. A ring in the brass the whole game answers in, drawn
        // inside the card's own radius so it follows the rounded corner rather than boxing it.
        chosen && 'ring-2 ring-brass-300 ring-offset-0',
      )}
    >
      {/*
       * The picture, with the name laid over its foot.
       *
       * Above `lg` it is the `1fr` row of the wall, so its height is negotiated with the other four
       * and it has none of its own. Below `lg` the row has wrapped and there is no wall to
       * negotiate with, so it falls back to a fixed 3:4 and the card sizes itself. The floor of
       * 140px is there so a very short window cannot squeeze it to nothing: an image collapsed to
       * zero is a defect the layout gates look for.
       */}
      <span className="relative block aspect-[3/4] w-full overflow-hidden lg:aspect-auto lg:min-h-[140px]">
        <span
          className={cn(
            'absolute inset-0 block',
            // Locked, while choosing: the painting is still the painting, drained and pushed back
            // so the eye goes to the ones a crew can actually move into. The world screen draws
            // every city at full strength, shut ones included, and keeps doing so.
            choosing !== undefined && !pressable && 'opacity-60 grayscale',
          )}
        >
          <CityPortrait cityId={city.id} />
        </span>

        {/* The wash under the lettering. Without it the name sits on whatever the picture happens
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
      </span>

      <span className="block px-3.5 pb-3.5 pt-3 font-body text-[13px] leading-snug text-ink-200">
        {choosing !== undefined && (
          <span
            data-testid={`city-status-${city.id}`}
            className={cn(
              'mb-1.5 block font-display text-[10px] font-bold uppercase tracking-[0.18em]',
              pressable ? 'text-brass-300' : 'text-ink-300',
            )}
          >
            {chosen ? 'Chosen' : homeLine(offer)}
          </span>
        )}
        {city.blurb}
      </span>
    </Tag>
  );
}
