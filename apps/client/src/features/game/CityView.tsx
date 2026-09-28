import {
  DEFAULT_CITY_ID,
  cancelWindowMs,
  cityOf,
  districtDisplayName,
  districtsOfCity,
  plateAspect,
  type CapturedGateView,
  type District,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { CancelMark } from '../../components/ui/CancelMark';
import { useCancelGateRaise, useCity, useMe, useRaiseGate } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { OnPlate, PlateRoom, type OnPlateAt } from './PlateRoom';
import { Tutorial } from '../tutorial/Tutorial';
import { ScoutMenu } from '../city/ScoutMenu';
import { useViewedCity } from '../../store/viewedCity';
import { ErrorNote } from '../../components/ui/ErrorNote';

/**
 * The `/game` index: the city itself, painted, with a tag on every district (GDD §A4).
 *
 * It was a pan-and-zoom Pixi map with markers on it, and the trouble with that was never the
 * markers: it was that a map of a place is a diagram, and this game is trying to be a city you are
 * standing over. The painting is the city, the tags are the ten ways in, and the screen's whole job
 * is getting a player to one of them. Everything about what is *inside* a district still lives at
 * `/game/city/:id`.
 *
 * Each playable city has its own aerial, painted at 21:10 for this screen: strip the standing bar
 * and the switcher off a browser window and what is left runs between 1.92 and 2.54 wide-to-tall,
 * so at 2.1 the painting fills an ordinary desktop frame with nothing cropped off it. The box the
 * tags are positioned in is the picture rather than the frame, so a tag stays on the roof it names.
 *
 * Which city is being drawn is the one the player is looking at (`useViewedCity`), falling back to
 * the crew's own. The read is asked for that city and answers with a `cityId` of its own, so the
 * screen no longer has to put the crew's district back through the atlas to work out what it is
 * holding: what the fog and the holdings on this screen are about is a thing the server says.
 */
/**
 * Which painting each playable city opens on.
 *
 * `city` is Ashfall's and keeps the name it had while Ashfall was the world; Terminus has its own
 * aerial. A city absent from here has no map screen at all, so the table doubles as the list of
 * cities this screen can draw, and `CityView.test.tsx` checks it against the atlas.
 */
export const CITY_PLATES: Readonly<Record<string, string>> = {
  ashfall: 'city',
  terminus: 'city-terminus',
};

/** The cities with both a painting and a table of marks on it. */
export const PAINTED_CITY_IDS: readonly string[] = Object.keys(CITY_PLATES);

/**
 * Which city this screen draws: the one being looked at, or the crew's own.
 *
 * The remembered city is not taken at its word, because the store it comes from is shared with the
 * rooms and the rooms will happily remember a city this screen cannot paint. A city with no plate
 * has no marks either, so it would draw as the default painting with no tags on it: a map of
 * nowhere, with no way off it except the world screen. Falling back to the crew's own city is a
 * screen a player can always act on.
 */
export function paintedCity(looking: string | null, home: string): string {
  return looking !== null && CITY_PLATES[looking] !== undefined ? looking : home;
}

/**
 * Where each district stands on its city's painting, in fractions of it.
 *
 * Hand-placed against real features rather than derived from the districts' own map coordinates:
 * those were laid out for a generated diagram, and these are paintings somebody made, so the
 * Steelbelt belongs on the smokestacks, the Docks on the moored barges and the Spire on the one
 * cathedral. A district with no mark here would simply not be on the screen, so `CityView.test.tsx`
 * pins that the table covers every district in every city it can draw.
 *
 * Keyed by city, because the second city arrived and a flat record over district ids would have
 * been one namespace holding two unrelated pictures' coordinates: nothing would have failed if a
 * Terminus mark were read against Ashfall's painting, it would just have stood somewhere wrong.
 */
export const DISTRICT_MARKS: Readonly<Record<string, Readonly<Record<string, OnPlateAt>>>> = {
  ashfall: {
    // The mill roofs and their smoke, mid-left: the industry the Belt is named for.
    // Lifted clear of the parapet below it: the tag's lower edge was sitting exactly on the wall's
    // coping, which reads as a label stuck to the wall rather than one lying on the roofs it names.
    steelbelt: { x: 0.387, y: 0.346 },
    /*
     * Off the cathedral itself and at the foot of the tower rather than across it. The board's
     * placement: the Command Sector's tag belongs beside the building, not over it.
     *
     * Moved up and to the right on 2026-09-20, from `0.772, 0.345`, to sit between where it was and
     * the cathedral's lowest point rather than out on the roofs to its left. Measured at 1440x900,
     * where the painting is 1440x686 and the mark is the tag's anchor: it was at (1112, 352) and the
     * spire comes down to about (1225, 275), so this is a little under halfway along that line.
     * Deliberately short of the midpoint, because the ask was "not too much": the tag has to stay
     * clear of the building it names, which is the whole reason it is not on it.
     */
    ccs: { x: 0.8, y: 0.3 },
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
    blacksite: { x: 0.843, y: 0.722 },
    // The terraced blocks behind the wall, where the faculty annexes back onto the street.
    // Above the slab's coping rather than on it: the tag was overlapping the top course of the wall,
    // which reads as a label stuck to the concrete instead of one lying on the blocks it names.
    annexes: { x: 0.637, y: 0.435 },
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
    // Up one tag height from 0.9 (maintainer, 2026-09-25): the mark is the tag's *bottom* edge
    // (`OnPlate anchor="bottom"`), so this puts the plate's foot where its head was and lifts the
    // whole thing off the bottom of the quay. 0.029 of the painting is 20px at 1440 wide, which is
    // the plate's own height.
    'south-quay': { x: 0.787, y: 0.871 },
  },
  /*
   * Terminus, read off `plate-city-terminus` against a twentieth grid (2026-09-24).
   *
   * The painting is one night rail city stacked along a single line, so the quarters are what a
   * tag can stand on: the viaduct, the station shed, the walled garrison, the sidings, the gorge
   * and the terraces below it. Placed by eye against the picture rather than off `District.position`,
   * which is the travel-time coordinate and is laid out for a diagram: the Yards' coordinate puts
   * them in the middle of the frame, and every siding in the painting is on the right.
   *
   * Kept inside y 0.232..0.873 and x 0.085..0.915 on purpose. `OnPlate` clamps a mark into the
   * part of the painting the bars leave on screen, and those are the bounds of that window at the
   * worst band in the matrix (1280x720), so a mark outside them is a tag that slides off the thing
   * it names rather than one that goes missing. `cityFit.test.ts` measures exactly that.
   */
  terminus: {
    // The west end of the line: the arcaded terrace at the left edge, where the rails come in off
    // forty miles of nothing and the town is still one platform wide.
    'coldwater-halt': { x: 0.095, y: 0.295 },
    // The cutting at the bottom left, beside the chapel's spire and the roofs packed round it.
    // Not lower down the terraces, where it belongs by the picture: the captured-gate panel a crew
    // sees once it holds a district whole is drawn over the painting's bottom-left corner, and at
    // 1280x720 it covers x 0..0.41 from y 0.69 down. A tag hangs 78px above its mark, so anything
    // marked below 0.69 on that side goes under the panel for exactly the crews who have earned it.
    ironmouth: { x: 0.105, y: 0.655 },
    // The great glass train shed, the biggest roof in the painting, and its concourse.
    'last-platform': { x: 0.4, y: 0.26 },
    // The brick arches carrying the line over the gorge, each one bricked up into something.
    viaduct: { x: 0.575, y: 0.7 },
    // The masts and the dish on the rock above the garrison: the only rise for forty miles.
    'telemetry-hill': { x: 0.725, y: 0.245 },
    // The garrison itself, at its barred gate under the red banners.
    blockhouse: { x: 0.8, y: 0.41 },
    // The bonded warehouses east of the garrison, where the freight stopped moving.
    'bonded-row': { x: 0.915, y: 0.46 },
    // The sidings, the standing wagons and the turning loop that fill the right of the frame.
    'marshalling-yards': { x: 0.845, y: 0.625 },
    // The four plots, on the ground people actually live on: the terraces behind the lit market,
    // the embankment under the arches, the cottages on the hill under the garrison, and the row of
    // carriages set on blocks beside the running lines.
    // Both carried right of the captured-gate panel's corner for the reason above: a tag centred
    // at x 0.485 clears its right edge by a tag's own half-width at the worst band.
    watertower: { x: 0.485, y: 0.845 },
    embankment: { x: 0.635, y: 0.865 },
    signalrow: { x: 0.905, y: 0.26 },
    carriage: { x: 0.895, y: 0.845 },
  },
};

/**
 * Every district on a city's painting has to have a mark, or it is a place with no way in.
 *
 * Takes the city rather than answering for all of them at once, so a caller has to say which
 * painting it means. `CityView.test.tsx` asks it of every city in {@link CITY_PLATES}.
 */
export function districtsWithoutAMark(cityId: string): readonly string[] {
  const marks = DISTRICT_MARKS[cityId] ?? {};
  return districtsOfCity(cityId)
    .filter((district) => marks[district.id] === undefined)
    .map((district) => district.id);
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
       * The same plate the district screen puts under a building (maintainer request).
       *
       * These were scraps of light card stock with tape over the corners, and against a night
       * painting they were the brightest thing on the screen: ten cream stickers over the artwork,
       * competing with it rather than labelling it. The district screen had already solved the same
       * problem the other way, with a dark plate and small uppercase type that sits *in* the
       * picture, and two maps in one game reading as two different games is the worse bug.
       *
       * Name only, and nothing else on it. The tag's job on this screen is to say which ground is
       * which; everything a player wants after that is one click away on the district itself.
       *
       * **Every authored name on one line** (maintainer, 2026-09-25). The cap was `10rem`, which
       * every Ashfall name happened to fit inside; Terminus's Marshalling Yards is twenty-one
       * characters and wrapped, so one tag on the map was two lines tall and read as a different
       * kind of object from the eleven beside it.
       *
       * The cap is wider rather than gone, and that is the whole of the design. A district's name
       * is not always ours: a crew names its own ground, and `DistrictNameSchema` lets that be far
       * longer than anything in the catalogue. With no cap at all the longest legal name ran off
       * the side of the screen at 1024x768, which the viewport sweep caught. So: wide enough that
       * nothing the game authors ever wraps, and still a wall for a name a player invents.
       *
       * It missed by **one pixel**. Measured at the tag's own font, the widest authored name comes
       * to 143px of text and 159px with its padding, against a cap of 160px, which is why the map
       * looked right for a year and then did not the day a twenty-one character district opened.
       * `11rem` leaves seventeen pixels over, and `cities.spec.ts` measures the rendered box of
       * every authored tag rather than trusting this sum.
       */}
      <span
        className={cn(
          'flex items-center whitespace-normal rounded-sm border px-2 py-0.5 shadow-lifted',
          'max-w-[11rem] text-balance break-words text-center',
          'font-display text-[11px] font-semibold uppercase leading-tight tracking-[0.1em]',
          'transition-colors duration-200',
          /*
           * Your own ground is the one tag that leads somewhere different, so it stays legible as
           * yours without a second line saying so: the plate takes the working state's amber, the
           * same colour the district screen gives a building that is doing something.
           */
          mine
            ? 'border-ember-300/70 bg-surface-950/90 text-ember-300'
            : 'border-surface-600 bg-surface-950/90 text-ink-200 group-hover:border-brass-300/70 group-hover:text-brass-100',
        )}
      >
        {label}
      </span>
    </button>
  );
}

export function CityView() {
  const me = useMe();
  const navigate = useNavigate();
  const myBase = me.data?.base ?? null;
  // Which city this crew is standing in. Ashfall is the fallback for a district the atlas does not
  // know, which is the same answer as before.
  const homeCity = cityOf(myBase?.districtId ?? '') ?? DEFAULT_CITY_ID;
  /*
   * Which city is being **looked at**, which is not always the one the crew lives in.
   *
   * Picking a city on the world screen brings you here, to that city's painting (maintainer,
   * 2026-09-24: "when players are in two different cities they can switch between the two"). It
   * used to close the world screen and drop the player back on their own map whichever card they
   * pressed, so the only two playable cities were one screen apart and indistinguishable.
   *
   * State rather than a route, for the same reason the world screen itself is state: this is the
   * same screen at a different zoom, and a second URL for it would be a second back button.
   *
   * The state is in a store rather than in this component (maintainer, 2026-09-24: "it should take
   * you back to the city you were viewing, not necessarily your home city"). It was `useState`,
   * which a route change throws away, so opening a district in Terminus and pressing the X came
   * back to Ashfall. The Bar, the market, the back room and the mission board read the same store,
   * which is what makes switching city in one of them agree with the map.
   */
  const looking = useViewedCity((state) => state.cityId);
  // Clamped to a city this screen can actually paint. See `paintedCity`. The store is not
  // corrected, only read: rewriting it here would reach into the rooms as well.
  const cityId = paintedCity(looking, homeCity);
  const plate = CITY_PLATES[cityId] ?? CITY_PLATES[DEFAULT_CITY_ID] ?? 'city';
  const marks = DISTRICT_MARKS[cityId] ?? {};
  /*
   * The map of the city on the screen, not of the crew's own.
   *
   * The read used to answer for the crew's city whatever was being painted, so every district of
   * an away city arrived with no summary: no fog, no holdings, no crew names, and, worse, no
   * answer for the tag to act on. Asked bare for the crew's own city, which is what keeps a player
   * who has never left home sending no `?city=` on anything.
   */
  const city = useCity(cityId === homeCity ? undefined : cityId);
  /*
   * The districts of the city being painted, or null while there is no answer for it.
   *
   * Checked against the city the *server* says it answered for rather than taken on trust. The two
   * agree by construction, since the read is keyed per city, and a tag deciding what to open off
   * another city's fog is the mistake worth one comparison to rule out.
   */
  const summaries = city.data?.cityId === cityId ? city.data.districts : null;
  /*
   * The gates on districts this crew holds outright, in the city being looked at.
   *
   * Filtered by city because this panel is drawn over the painting, and the painting is not always
   * the crew's own any more: picking a second city on the world screen brought the home city's
   * gate panel across with it, so "The Rustyard Gate" was offered over a map the Rustyard is not
   * on. The read answers for the crew, which is right; the screen has to say where it is standing.
   */
  const gates = (city.data?.capturedGates ?? []).filter(
    (gate) => cityOf(gate.districtId) === cityId,
  );
  const raise = useRaiseGate();
  const cancel = useCancelGateRaise();
  // The city read's clock, for the gate panel's countdown and its first-tenth window.
  const now = useServerClock(city.data?.serverNow, city.dataUpdatedAt);

  /*
   * The scout sheet over the map (maintainer, 2026-09-23): which unscouted district it is open
   * for, or null. Unscouted ground does not open as a page; its tag opens this instead.
   *
   * `DistrictView` used to bounce here with `?scout=<id>` for a link that arrived at unscouted
   * ground, and that bounce is gone (2026-09-25): it draws the sheet at its own route instead, so
   * nothing flashes past. The parameter is still read once and stripped, the way the mailbox reads
   * `?to=`, because an old link or a notification may still carry it and a refresh or a back button
   * must not re-open a sheet the player has closed.
   */
  const [scouting, setScouting] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const asked = params.get('scout');
  useEffect(() => {
    if (asked === null || asked === '') return;
    setScouting(asked);
    const next = new URLSearchParams(params);
    next.delete('scout');
    setParams(next, { replace: true });
  }, [asked, params, setParams]);

  if (!myBase) return null;

  return (
    <div className="relative h-full w-full bg-surface-950">
      {/* The opening three land here: this is the game's index route, so it is where a player
          arrives straight off the character screen. */}
      <Tutorial screen="city" />
      {scouting !== null && (
        <ScoutMenu
          districtId={scouting}
          onClose={() => setScouting(null)}
          // The sheet was opened because the map did not know. If its own read says the crew has
          // been here, the district is what they asked for, so hand them on.
          onScouted={() => {
            setScouting(null);
            void navigate(`/game/city/${scouting}`);
          }}
        />
      )}
      <PlateRoom plate={plate} aspect={plateAspect(plate)} fit="width" testId="city-room">
        {districtsOfCity(cityId).map((district) => {
          const at = marks[district.id];
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
                onOpen={() => {
                  if (mine) {
                    void navigate('/game/base');
                    return;
                  }
                  /*
                   * A page is opened only for ground this crew has **positively been to**.
                   *
                   * Anything else opens the sheet over the map, including "the read has not landed
                   * yet". That is the maintainer's rule in as many words (2026-09-25): "just have a
                   * window pop up there without changing page, you only change if its scouted cause
                   * you go into the location."
                   *
                   * The default used to point the other way: unknown fell through to the page, the
                   * page read the district, found it unscouted and bounced back here with the sheet
                   * open. Fixing the away map removed most of the unknowns and not the last of
                   * them, because the read still has to land once per city and a tag is clickable
                   * before it does. So the fall-through is gone rather than narrowed: an unknown is
                   * now a sheet, which is recoverable in a way a page flashing past is not, and
                   * `ScoutMenu` reads the district itself and says what it finds. `DistrictView`
                   * keeps its bounce for a pasted URL; no click reaches it any more.
                   */
                  const summary = summaries?.find((entry) => entry.district.id === district.id);
                  if (summary?.scouted !== true) {
                    setScouting(district.id);
                    return;
                  }
                  void navigate(`/game/city/${district.id}`);
                }}
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
          onClick={() => void navigate('/game/city')}
          data-testid="all-cities"
          className="glass edge-lit brushed pointer-events-auto flex items-center gap-2 rounded-sm border border-surface-600 px-3 py-2 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-ink-200 transition-colors hover:border-brass-300/70 hover:text-brass-100"
        >
          <Icon name="city" aria-hidden className="h-4 w-4" />
          All cities
        </button>
      </div>

      {/*
       * §B7: the gates on ground this crew holds outright (maintainer request).
       *
       * Bottom-left, over the map, and drawn only when there is one. A crew that has never taken a
       * district whole sees the screen it has always seen; taking the last location in one makes a
       * panel appear, which is the clearest way to tell a player that the sweep bought them
       * something beyond the location.
       */}
      {gates.length > 0 && (
        <div
          className="pointer-events-none absolute bottom-0 left-0 z-10 flex flex-col gap-2 px-3"
          style={{ paddingBottom: 'calc(var(--nav-h, 96px) + 12px)' }}
          data-testid="captured-gates"
        >
          {gates.map((gate) => (
            <CapturedGatePanel
              key={gate.districtId}
              gate={gate}
              stock={myBase?.resources ?? {}}
              now={now}
              pending={raise.isPending || cancel.isPending}
              onRaise={() => raise.mutate({ districtId: gate.districtId })}
              onCancel={() => cancel.mutate({ districtId: gate.districtId })}
            />
          ))}
          {(raise.error ?? cancel.error) && (
            <ErrorNote backdrop className="pointer-events-auto">
              {(raise.error ?? cancel.error)?.message}
            </ErrorNote>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One gate a crew holds, and the one thing they can do about it.
 *
 * Drawn as a plate over the map rather than as a page of its own, because it is a fact about a
 * district on the screen already showing the districts, and a wall with one button does not earn a
 * route. What it prints is what it is worth right now, in the two units the player cares about:
 * how much harder the ground is to take, and how much less a scout comes away with.
 */
function CapturedGatePanel({
  gate,
  stock,
  now,
  pending,
  onRaise,
  onCancel,
}: {
  gate: CapturedGateView;
  /** What is in the stockpile, so the price reads red when it cannot be paid. */
  stock: Parameters<typeof CostLine>[0]['stock'];
  now: Date;
  pending: boolean;
  onRaise: () => void;
  onCancel: () => void;
}) {
  const working = gate.upgradingUntil !== null;
  // The first tenth of the level's own clock, read off the two marks the view carries.
  const windowMs =
    gate.upgradingSince !== null && gate.upgradingUntil !== null
      ? cancelWindowMs(
          Date.parse(gate.upgradingSince),
          Date.parse(gate.upgradingUntil) - Date.parse(gate.upgradingSince),
          now.getTime(),
        )
      : 0;
  return (
    <div
      data-testid={`captured-gate-${gate.districtId}`}
      className="glass edge-lit pointer-events-auto flex min-w-[15rem] flex-col gap-1.5 rounded-sm border border-surface-600 px-3 py-2.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300">
          {gate.districtName} gate
        </span>
        <span className="font-display text-[12px] font-bold tabular-nums text-ink-100">
          Lv {gate.level}
        </span>
      </div>
      <p className="font-body text-[12px] leading-snug text-ink-300">
        +{Math.round(gate.defensePercent)}% holding it, and{' '}
        {Math.round(gate.intelResistancePercent)} points against anybody spying on it.
      </p>
      {working ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-display text-[11px] uppercase tracking-[0.14em] tabular-nums text-ember-300">
            Being raised, {formatRemaining(Date.parse(gate.upgradingUntil ?? '') - now.getTime())}{' '}
            left
          </span>
          <CancelMark
            windowMs={windowMs}
            label={`Call off raising the ${gate.districtName} gate`}
            pending={pending}
            onCancel={onCancel}
            data-testid={`cancel-gate-${gate.districtId}`}
          />
        </div>
      ) : gate.nextCost === null ? (
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-400">
          As high as it goes
        </span>
      ) : (
        <div className="flex flex-col gap-1.5">
          <CostLine cost={gate.nextCost} stock={stock} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={gate.refusal !== null || pending}
              onClick={onRaise}
              data-testid={`raise-gate-${gate.districtId}`}
            >
              Raise it
            </Button>
            {gate.refusal !== null && (
              <span className="font-display text-[11px] text-oxblood-300">{gate.refusal}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
