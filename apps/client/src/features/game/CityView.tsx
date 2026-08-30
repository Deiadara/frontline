import { CITY_DISTRICTS, districtDisplayName, plateAspect, type District } from '@frontline/shared';
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
 * Steelbelt belongs on the smokestacks, the Docks on the moored barges and the Spire on the one
 * cathedral. A district with no mark here would simply not be on the screen, so `CityView.test.tsx`
 * pins that the table covers every district in the city.
 */
const DISTRICT_MARKS: Readonly<Record<string, OnPlateAt>> = {
  // The mill roofs and their smoke, mid-left: the industry the Belt is named for.
  // Lifted clear of the parapet below it: the tag's lower edge was sitting exactly on the wall's
  // coping, which reads as a label stuck to the wall rather than one lying on the roofs it names.
  rustyard: { x: 0.387, y: 0.346 },
  // Off the cathedral itself and down to its left, at the foot of the tower rather than across it.
  // Board's placement: the Command Sector's tag belongs beside the building, not over it.
  'combine-spire': { x: 0.772, y: 0.345 },
  // The terraced sprawl climbing the right-hand slope.
  'ashen-terraces': { x: 0.655, y: 0.215 },
  // Packed roofs out on the far right, and carried down the slope from where it used to sit.
  //
  // A residential tag prints the *crew's* name (`districtDisplayName`), and a crew name is three or
  // four times the width of "Kettle Row": at the old mark it ran left across the cathedral's foot
  // and shouldered the CCS tag. Lower down the terraces it has the width it needs.
  // ...and carried up again when the Undergrid came off its ledge, so the two do not close up.
  'kettle-row': { x: 0.905, y: 0.43 },
  // The water, the cranes and the moored barges down the left.
  'neon-docks': { x: 0.157, y: 0.56 },
  // The far end of the graffitied slab wall: the hardest ground in frame.
  'blacksite-7': { x: 0.843, y: 0.722 },
  // The terraced blocks behind the wall, where the faculty annexes back onto the street.
  // Above the slab's coping rather than on it: the tag was overlapping the top course of the wall,
  // which reads as a label stuck to the concrete instead of one lying on the blocks it names.
  'datavault-sigma': { x: 0.637, y: 0.435 },
  // The wall's own service run, right of frame, where the power comes up out of the ground.
  // Up off the coping for the same reason as the Belt: on the wall, not on the ledge.
  undergrid: { x: 0.874, y: 0.546 },
  // The market: rows of coloured awnings across the bottom.
  'chrome-row': { x: 0.555, y: 0.81 },
  // The glasshouse roofs above the wall, left of the terraces. Board's nudge: a little further up
  // the slope, off the busiest band of roofs and onto the quieter ones behind them.
  'glasshouse-fields': { x: 0.546, y: 0.3 },
  // The two plots opened up alongside the Docks. Board's placements, read off an annotated
  // screenshot: the roofs high on the left and clear of the slab wall's coping, and the quay down
  // at the tail of the market where the awnings give out.
  'upper-roofs': { x: 0.284, y: 0.233 },
  'south-quay': { x: 0.787, y: 0.9 },
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
 * It used to hang a drawn leader and a ring under itself, on the argument that a label with a line
 * down to a roof is somebody *pointing* at that roof. Twelve of them made the painting look pinned
 * to a corkboard, and the tape already says the tag is a physical thing lying on the picture. The
 * tag sits on the place it names now and nothing dangles off it.
 */
function DistrictTag({
  district,
  label,
  mine,
  onOpen,
}: {
  district: District;
  /** What to print: a crew's name on residential ground, the district's own name otherwise. */
  label: string;
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
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-20 w-36 -translate-x-1/2 -translate-y-1/3 rounded-[50%] bg-brass-300/30 opacity-0 blur-2xl transition-opacity duration-200 group-hover:opacity-100"
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
            'tag-paper relative flex flex-col items-center gap-0.5 px-3 py-1.5 transition-transform duration-200',
            mine && 'ring-1 ring-inset ring-brass-500/50',
          )}
        >
          <span
            className={cn(
              /*
               * Wraps, with a ceiling on how wide it may get.
               *
               * It was `whitespace-nowrap`, which is right for a district name somebody authored
               * and wrong for a *crew* name, which the player types: a tag on the far-right plot
               * carrying a maximum-length name ran 222px wide and off the edge of a 1024 viewport.
               * A ceiling and two lines is what a scrap of paper does; truncating would break the
               * one rule this interface does not bend, and moving the mark only hides it until
               * somebody picks a longer name.
               */
              'max-w-[10rem] text-balance break-words text-center font-stamp text-[13px] leading-tight',
              // Ink on paper, not chrome text: the tag is a physical object on the picture.
              mine ? 'text-oxblood-500' : 'text-[rgb(28_22_18)]',
            )}
          >
            {label}
          </span>
          {mine && (
            <span className="flex items-center gap-1 font-display text-[8px] font-bold uppercase leading-none tracking-[0.18em] text-oxblood-500">
              <Icon name="district" aria-hidden className="h-2 w-2" />
              Yours
            </span>
          )}
        </span>
        {/* Over the paper, at `z-10`, and clear of the torn edge so the strip is not clipped by it.
            Two different angles and lengths: a matched pair reads as printed rather than stuck. */}
        <span
          aria-hidden
          className="tape-strip pointer-events-none absolute -left-1 -top-1 z-10 h-3 w-6 -rotate-[22deg]"
        />
        <span
          aria-hidden
          className="tape-strip pointer-events-none absolute -right-1.5 -top-1 z-10 h-3 w-6 rotate-[17deg]"
        />
      </span>
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
                /*
                 * Your own plot is called after your crew, live off the base rather than off a
                 * stored copy, so renaming the crew renames the tag on the next poll. The other
                 * three are numbered: see `plotName` for why they are not named after the people
                 * living on them.
                 */
                label={districtDisplayName(district, {
                  ownDistrictId: myBase.districtId,
                  ownName: myBase.name,
                })}
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
