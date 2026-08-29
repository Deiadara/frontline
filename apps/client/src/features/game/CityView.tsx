import { CITY_DISTRICTS, plateAspect, type District } from '@frontline/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../../lib/queries';
import { Icon } from '../../components/ui/Icon';
import { CitiesView } from '../cities/CitiesView';
import { cn } from '../../lib/cn';
import { OnPlate, PlateRoom, type OnPlateAt } from './PlateRoom';

/**
 * The `/game` index: the city itself, painted, with a tag on every district (GDD §A4).
 *
 * It was a pan-and-zoom Pixi map with markers on it, and the trouble with that was never the
 * markers: it was that a map of a place is a diagram, and this game is trying to be a city you are
 * standing over. The painting is the city, the tags are the ten ways in, and the screen's whole job
 * is getting a player to one of them. Everything about what is *inside* a district still lives at
 * `/game/city/:id`.
 *
 * `plate-city` is the board's aerial, painted at 21:10 for this screen: strip the standing bar and
 * the switcher off a browser window and what is left runs between 1.92 and 2.54 wide-to-tall, so at
 * 2.1 the painting fills an ordinary desktop frame with nothing cropped off it. The box the tags are
 * positioned in is the picture rather than the frame, so a tag stays on the roof it names.
 */
const CITY_ASPECT = plateAspect('city');

/**
 * Where each district stands on the painting, in fractions of it.
 *
 * Hand-placed against real features rather than derived from the districts' own map coordinates:
 * those were laid out for a generated diagram, and this is a painting somebody made, so the
 * Rustyard belongs on the smokestacks, the Docks on the moored barges and the Spire on the one
 * cathedral. A district with no mark here would simply not be on the screen, so `CityView.test.tsx`
 * pins that the table covers every district in the city.
 */
const DISTRICT_MARKS: Readonly<Record<string, OnPlateAt>> = {
  // The chimney stacks and their smoke, top left: the industry the Scrapfields are cut out of.
  rustyard: { x: 0.245, y: 0.155 },
  // The one cathedral in the city, and the tallest thing in the painting.
  'combine-spire': { x: 0.85, y: 0.13 },
  // The terraced sprawl climbing the right-hand slope.
  'ashen-terraces': { x: 0.655, y: 0.215 },
  // Packed roofs out on the far right edge.
  'kettle-row': { x: 0.915, y: 0.35 },
  // The water, the cranes and the moored barges down the left.
  'neon-docks': { x: 0.105, y: 0.55 },
  // The graffitied slab walls across the middle, the only fortifications in frame.
  'blacksite-7': { x: 0.575, y: 0.49 },
  // The densest neon in the painting, up on the right-hand roofs.
  'datavault-sigma': { x: 0.735, y: 0.3 },
  // The lit crossroads under the walls, where the power runs in.
  undergrid: { x: 0.415, y: 0.55 },
  // The market: rows of coloured awnings across the bottom.
  'chrome-row': { x: 0.55, y: 0.78 },
  // The lamplit plaza and its fountain, bottom left, with the walkers standing off it.
  'glasshouse-fields': { x: 0.34, y: 0.86 },
};

/** Every district on the painting has to have a mark, or it is a place with no way in. */
export function districtsWithoutAMark(): readonly string[] {
  return CITY_DISTRICTS.filter((district) => DISTRICT_MARKS[district.id] === undefined).map(
    (district) => district.id,
  );
}

/**
 * One district's tag: a scrap of paper taped to the painting over the place it names.
 *
 * The leader and the ring under it are the point. A label floating above a city is a caption; a
 * label with a line down to a ring drawn *on* a roof is somebody pointing at that roof, and the
 * difference is whether a player reads the tag as being about the picture or about the screen.
 */
function DistrictTag({
  district,
  mine,
  onOpen,
}: {
  district: District;
  /** This crew's own ground, which is the one tag that leads somewhere different. */
  mine: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`district-tag-${district.id}`}
      data-mine={mine ? 'yes' : undefined}
      className="group relative flex flex-col items-center transition-transform duration-200 hover:-translate-y-1"
    >
      {/* Lamplight behind the tag, lit only on hover: ten of these glowing at once would wash out
          the painting they are standing on. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-24 w-44 -translate-x-1/2 -translate-y-1/3 rounded-[50%] bg-brass-300/30 opacity-0 blur-2xl transition-opacity duration-200 group-hover:opacity-100"
      />

      {/*
       * Light card stock with the tape **over** it, which is the way round tape works.
       *
       * The tag was dark paper with two amber tabs tucked behind its edges, and on a painting of a
       * city at night that is a smudge with a word in it and two bright wings sticking out. Light
       * stock reads instantly against the dark, and a translucent strip laid across each top corner
       * reads as something holding the label down, because it is on top of it.
       */}
      <span className="relative flex items-center">
        <span
          className={cn(
            'tag-paper relative flex flex-col items-center gap-0.5 px-4 py-2 transition-transform duration-200',
            mine && 'ring-1 ring-inset ring-brass-500/50',
          )}
        >
          <span
            className={cn(
              'whitespace-nowrap font-stamp text-[16px] leading-none',
              // Ink on paper, not chrome text: the tag is a physical object on the picture.
              mine ? 'text-oxblood-500' : 'text-[rgb(28_22_18)]',
            )}
          >
            {district.name}
          </span>
          {mine && (
            <span className="flex items-center gap-1 font-display text-[9px] font-bold uppercase leading-none tracking-[0.2em] text-oxblood-500">
              <Icon name="district" aria-hidden className="h-2.5 w-2.5" />
              Yours
            </span>
          )}
        </span>
        {/* Over the paper, at `z-10`, and clear of the torn edge so the strip is not clipped by it.
            Two different angles and lengths: a matched pair reads as printed rather than stuck. */}
        <span
          aria-hidden
          className="tape-strip pointer-events-none absolute -left-1.5 -top-1.5 z-10 h-3.5 w-8 -rotate-[22deg]"
        />
        <span
          aria-hidden
          className="tape-strip pointer-events-none absolute -right-2 -top-1 z-10 h-3.5 w-7 rotate-[17deg]"
        />
      </span>

      {/* The leader down to the roof it names, drawn rather than ruled. */}
      <span
        aria-hidden
        className="ink-leader h-4 w-2 opacity-70 transition-opacity duration-200 group-hover:opacity-100"
      />
      <span
        aria-hidden
        className={cn(
          'ink-disc h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-125',
          mine && 'scale-125',
        )}
      />
    </button>
  );
}

export function CityView() {
  const me = useMe();
  const navigate = useNavigate();
  const myBase = me.data?.base ?? null;

  /**
   * Which zoom the camera is at: the city, or the step back from it.
   *
   * State rather than a route. "All cities" and "the city" are the same place at two distances, and
   * making the wider one a page meant a navigation, a fresh mount and a lost selection every time a
   * player looked at it. See `CitiesView`.
   */
  const [pulledOut, setPulledOut] = useState(false);

  if (!myBase) return null;

  if (pulledOut) {
    return (
      <div
        className="h-full w-full overflow-y-auto px-5"
        style={{
          paddingTop: 'calc(var(--hud-h, 96px) + 20px)',
          paddingBottom: 'calc(var(--nav-h, 104px) + 20px)',
        }}
        data-testid="cities-view"
      >
        <CitiesView onEnterCity={() => setPulledOut(false)} />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-surface-950">
      <PlateRoom plate="city" aspect={CITY_ASPECT} fit="whole" testId="city-room">
        {CITY_DISTRICTS.map((district) => {
          const at = DISTRICT_MARKS[district.id];
          if (at === undefined) return null;
          const mine = district.id === myBase.districtId;
          return (
            <OnPlate key={district.id} at={at} anchor="bottom">
              <DistrictTag
                district={district}
                mine={mine}
                /*
                 * Your own ground is the one tag that does not lead to the district screen. That
                 * screen is for reading a place you do not hold: who is on it, what it would take.
                 * Standing on your own, the thing you actually want is the base.
                 */
                onOpen={() => void navigate(mine ? '/game/base' : `/game/city/${district.id}`)}
              />
            </OnPlate>
          );
        })}
      </PlateRoom>

      {/* The camera control, on the painting rather than in the row of places: pulling back from
          the city is a thing you do *to this screen*, not a different screen to walk to. */}
      <div
        className="pointer-events-none absolute left-0 top-0 z-10 flex px-3"
        style={{ paddingTop: 'calc(var(--hud-h, 64px) + 12px)' }}
      >
        <button
          type="button"
          onClick={() => setPulledOut(true)}
          data-testid="all-cities"
          className="glass edge-lit pointer-events-auto flex items-center gap-2 rounded-sm border border-surface-600 px-3 py-2 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-ink-200 transition-colors hover:border-brass-300/70 hover:text-brass-100"
        >
          <Icon name="city" aria-hidden className="h-4 w-4" />
          All cities
        </button>
      </div>
    </div>
  );
}
