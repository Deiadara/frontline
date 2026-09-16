import {
  BUILDING_CATALOG,
  buildingLevel,
  describeBuildingRequirement,
  unmetForQueue,
  type Building,
  type BuildingKind,
  type BuildingRequirement,
  type BuildQueue,
} from '@frontline/shared';
import type { CSSProperties } from 'react';
import { deliveredUrl } from '../../assets/delivered';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { useMeasuredSize, type MeasuredSize } from '../../lib/useMeasuredHeight';
import { ramps } from '../../theme/tokens';
import {
  DISTRICT_ASPECT,
  DISTRICT_BACK_EDGE,
  DISTRICT_BAND,
  DISTRICT_SITES_BY_DEPTH,
  siteCentroid,
  siteDepth,
  type DistrictSite,
} from './plots';

/**
 * The district as a place (GDD §A1): one painted street, with twelve buildings in it and a name
 * plate under each one.
 *
 * The Grepolis arrangement, and the thing that changed with the delivered plate: the structures are
 * **not** cutouts pasted onto ground any more. `plate-district` is a finished painting of the whole
 * district, buildings included, so there is nothing to paste: what the scene adds is a row of
 * **controls**, one per building, hung at the ground line of the building it names.
 *
 * ## Why a plate rather than the building itself
 *
 * This replaced an interaction layer of traced polygons: each building's real silhouette,
 * hit-tested by the browser, lighting up under the pointer and carrying a dark scrim when it was
 * not built yet. It was accurate and it was a bad control, for three reasons a player feels in the
 * first minute.
 *
 *   * **Nothing said it was there.** The opening move of the game was moving a cursor over a
 *     painting hoping something would happen.
 *   * **It fought the artwork.** The wash and the scrim were composited over the plate, so the
 *     better the painting got, the worse the interface looked on top of it.
 *   * **It was work to hit.** A shape you have to find is a shape you have to find every time.
 *
 * A plate is legible at a glance, always in the same place, has an obvious hit box, and reads as a
 * sign on a building rather than as a hole cut in a picture. The outlines are still authored and
 * still earn their keep: `plots.ts` positions the plates from them, and `building-portraits` cuts
 * the dialog's art with them. They are simply not what the pointer talks to.
 *
 * ## Four states, and a locked one is still a control
 *
 * Standing, being worked on, empty and buildable, or locked. A locked plate wears a padlock and,
 * on hover, drops a note listing **every** clause still in the way (§I3): the Nexus rung, the
 * other structures, and the crew's own level. Clicking it opens the same dialog everything else
 * opens: a shut door that cannot be examined is the failure the whole gating system is trying to
 * avoid.
 */

interface DistrictSceneProps {
  buildings: readonly Building[];
  queue: BuildQueue;
  /**
   * §I3: the crew's own level, because half the ladder is gated on it rather than on the district.
   *
   * Passed in rather than read from a query here: the scene is drawn for somebody else's district
   * on the city screen too, and the level that decides what *you* may build is always yours.
   */
  playerLevel: number;
  selected: BuildingKind | null;
  onSelect: (kind: BuildingKind) => void;
  /**
   * Somebody else's ground: draw it, do not offer to build on it.
   *
   * The scene is reused to show a neighbour's district on the city screen. Everything is the same
   * except that a plot stops being a control. There is nothing on another crew's land for you to
   * order, so outlines become plain marks and the unbuilt ones are not drawn at all: a scrim on
   * somebody else's lot reads as an invitation.
   */
  readOnly?: boolean;
  /**
   * Fill the frame the way your own district does, rather than sitting inline inside a panel.
   *
   * Split out from {@link readOnly} because that flag was carrying three different meanings at
   * once: "not yours to build on", "draw only what is standing", and "this is a thumbnail in a
   * panel". Visiting a neighbour needs the first two and the *opposite* of the third: the maintainer
   * asked for another crew's ground to open as a full screen, exactly like your own.
   *
   * Defaults to the old behaviour, so the city screen's preview is unchanged.
   */
  fill?: boolean;
  /**
   * Labels are controls even on ground that is not yours.
   *
   * On your own district a plate opens the build dialog. On somebody else's it opens the fight you
   * could call on that building, which is the only thing you can do to it. Either way it is the
   * same plate in the same place, which is the point: a player learns one map, not two.
   */
  interactive?: boolean;
}

/** The four states a plot can be in, in the order the label prefers to report them. */
type PlotState = 'working' | 'standing' | 'vacant' | 'locked';

const PLATE_STYLES: Record<PlotState, string> = {
  working: 'border-ember-300/70 bg-surface-950/90 text-ember-300',
  standing: 'border-surface-600 bg-surface-950/90 text-ink-200',
  vacant: 'border-dashed border-surface-600 bg-surface-950/90 text-ink-300',
  locked: 'border-dashed border-surface-600 bg-surface-950 text-ink-300',
};

/**
 * The district's box: **edge to edge**, with the buildings in the clear.
 *
 * Two rules pull against each other here and both are real.
 *
 * The maintainer asked for a district that covers the screen it is in, and it is right to: fitting the
 * whole painting into the room the chrome left over drew a 1250px picture in a 1440px frame with a
 * ninety-pixel slab of background down each side, and the game's best artwork ended up looking like
 * a screenshot pasted on a page. But the floating HUD and the scenery switcher are bars, and a
 * building under one of them is a building the pointer cannot reach.
 *
 * What dissolves it is that the plate's top and bottom edges are *empty ground*. The structures
 * live in a band ({@link DISTRICT_BAND}) that is about nine tenths of the picture, so the picture
 * takes the full width of the frame and that band is centred in the room the bars leave. Roofline
 * and street slide under the chrome, which is exactly what a floating bar should be covering.
 *
 * On a frame short enough that the band still does not fit, the overflow is split evenly top and
 * bottom rather than being allowed to pile up at one end, and {@link plateTop} then pulls every
 * name plate back inside the clear band. That is the half that makes the bleed safe: the plates are
 * the controls, so as long as they are reachable, a roofline under the stockpile costs nothing.
 *
 * `band` is the height between the bars, measured from a probe laid on the CSS variables the shell
 * publishes; zero (jsdom, which has no layout) means no chrome, and the plate simply fills the room.
 */
export function fitted(room: MeasuredSize, band: MeasuredSize, bleed = true): CSSProperties {
  if (room.width <= 0 || room.height <= 0) {
    return { width: '100%', aspectRatio: DISTRICT_ASPECT };
  }
  // Not bleeding, the city screen's preview: the plain reading, the whole picture inside the box.
  // Only the district screen has bars over the world to hide margins under.
  if (!bleed) {
    const height = Math.min(room.height, room.width / DISTRICT_ASPECT);
    return { width: Math.round(height * DISTRICT_ASPECT), height: Math.round(height) };
  }
  const clear = band.height > 0 ? band.height : room.height;
  // A step back, so the far side of the district is not behind the stockpile.
  //
  // The target is the **building band** rather than the whole plate: the top and bottom of the
  // painting are empty ground, and hiding those under the bars is the whole point of the bleed.
  /*
   * The painting keeps its own shape, and the room gives way instead (maintainer request,
   * 2026-09-14).
   *
   * This used to pin the width to the frame and *squash* the picture vertically, up to
   * its old sixteen percent cap, so the building band fitted between the bars. Full bleed left and right was the
   * earlier rule and the squash was the price of it. On a monitor short enough to spend the whole
   * allowance the price is visible: 3780x1800 drawn at sixteen percent under its height is a
   * painting of a slum with squat buildings in it, and that is what a second screen showed.
   *
   * So the aspect is now inviolable and the shortfall is taken out of the *width*:
   *
   *   * where the band fits at full bleed, nothing changes and the picture still runs edge to edge;
   *   * where it does not, the picture shrinks until the band fits, leaving margin down the sides.
   *
   * That margin is not a slab of background: `DistrictScene` feathers the cut edges into a blurred
   * copy of the painting, which is exactly what the city and the Bar do through `PlateRoom`. The
   * twelve building outlines are positions on the picture and they ride the box, so they stay on
   * their buildings either way, which the squash could only promise by compensating for itself.
   */
  const full = room.width / DISTRICT_ASPECT;
  const fits = clear / BAND_SPAN;
  /*
   * The width-limited case is pinned to the frame exactly, not derived back from the height.
   *
   * Rounding the height down and multiplying up again lost a pixel: a 1024px frame came back 1023
   * wide, so a one-pixel strip of surround ran down the right-hand edge on a viewport that should
   * be full bleed. Where the picture is as wide as the room, `room.width` *is* the answer.
   */
  const bleeds = full <= fits;
  /*
   * Floored, never rounded up, on both branches.
   *
   * A sub-pixel is unavoidable: the frame is an integer width and 21:10 rarely divides it. Which
   * way it goes is not arbitrary. Rounding the height *up* draws the picture a hair taller than it
   * was painted, which is a vertical stretch, and vertical is the axis the eye reads on a skyline.
   * Flooring spends the remainder on a tenth of a percent of extra width instead, which nothing
   * can see. `plots.test.ts` pins the direction.
   */
  const height = Math.floor(bleeds ? full : fits);
  const width = bleeds ? Math.round(room.width) : Math.round(height * DISTRICT_ASPECT);
  return {
    width,
    height,
    marginTop: Math.round(bleedOffset(height, clear)),
    // Centred when it is narrower than the room. `auto` on both sides rather than a computed
    // offset, so the picture stays centred through a resize without a second measurement.
    marginLeft: 'auto',
    marginRight: 'auto',
  };
}

/**
 * How far the painting's cut edge is faded into the surround, in pixels.
 *
 * Wide enough that there is no line to find and narrow enough that no building is dimmed: the
 * outermost plates sit well inside this on every viewport the game is drawn at.
 */
const SCENE_FEATHER_PX = 56;

/** The share of the picture the buildings occupy: what actually has to fit between the bars. */
const BAND_SPAN = (DISTRICT_BAND.bottom - DISTRICT_BAND.top) / 100;

/**
 * How far up the picture is pulled inside the clear band, in pixels.
 *
 * Negative: the picture starts above the band, because the first thing down it is empty ground.
 *
 * With room to spare the buildings are centred in it, which is the arrangement the maintainer asked
 * for. Without, **the whole shortfall goes to the bottom**: the band's top edge lands exactly on
 * the top of the clear area, so the far side of the district, where the tallest buildings are, is
 * never cut. What slides under the scenery switcher instead is the front row, which is what a
 * floating bar should be covering, and `plateTop` pulls their name plates back inside so nothing
 * becomes unclickable.
 *
 * Splitting it evenly, which is what this used to do, cropped the back row on any viewport short
 * enough to overflow at all: the Quarters lost its roofline behind the stockpile on a 720p screen.
 */
function bleedOffset(height: number, clear: number): number {
  const top = (DISTRICT_BAND.top / 100) * height;
  const slack = clear - BAND_SPAN * height;
  return -top + Math.max(0, slack / 2);
}

/**
 * Room a name plate needs at the edge of the clear band, in pixels.
 *
 * The plate is a fixed 22px of type hung three quarters below its anchor, so a plate anchored this
 * far inside the band is a plate wholly inside it. Fixed rather than measured because it is: the
 * type size does not move with the viewport.
 */
const PLATE_CLEARANCE = 26;

/**
 * Where a structure's plate hangs, as a percentage of the picture, pulled inside the clear band.
 *
 * The anchor is the building's ground line and that is where the plate wants to be. What this adds
 * is a floor and a ceiling: on a frame short enough that the picture bleeds past the bars, a plate
 * at the front or the back of the district would otherwise sit under the scenery switcher or the
 * stockpile, visible and unclickable, which is the exact failure the traced-polygon version had.
 * A plate that has been pulled in is still under its own building; it is a few pixels higher up it.
 *
 * `insetTop` is what the *screen* puts over the picture on top of the shell's own bars: the
 * district's title row. The picture runs under it, deliberately, and a plate must not.
 */
export function plateTop(
  anchorPercent: number,
  height: number,
  clear: number,
  insetTop = 0,
): number {
  if (height <= 0 || clear <= 0) return anchorPercent;
  const offset = bleedOffset(height, clear);
  const asPercent = (pixels: number): number => ((pixels - offset) / height) * 100;
  const lowest = asPercent(clear - PLATE_CLEARANCE);
  const highest = asPercent(insetTop + PLATE_CLEARANCE);
  // A band too short to hold a plate at all would invert the two: leave the anchor alone rather
  // than clamping to a nonsense window.
  if (lowest <= highest) return anchorPercent;
  return Math.min(lowest, Math.max(highest, anchorPercent));
}

/**
 * Every plate's hanging point, with the ones the band crushed together fanned apart.
 *
 * {@link plateTop} floors each plate on its own, which is right until the band is short enough to
 * push *several* of them onto the same edge: they then share one line, their boxes overlap, and the
 * plate drawn last takes the clicks meant for the one under it. Measured at 1024x768 with a build
 * rail two rows deep, where the Lab, the Quarters and the Greenhouse all landed on 360 and the Lab
 * answered as the Apothecary (bug pass, 2026-09-15).
 *
 * Fanning rather than compressing the whole picture: only the plates the clamp already moved are
 * touched, so a band with room to spare draws exactly what it drew before, down to the pixel. The
 * fan opens away from the edge that crushed them, in the order they were anchored, and gives way to
 * the far bound: where even the fan does not fit, the gap shrinks to share out what there is.
 */
export function plateTops(
  anchors: readonly number[],
  height: number,
  clear: number,
  insetTop = 0,
): number[] {
  const tops = anchors.map((anchor) => plateTop(anchor, height, clear, insetTop));
  if (height <= 0 || clear <= 0) return tops;

  const offset = bleedOffset(height, clear);
  const asPercent = (pixels: number): number => ((pixels - offset) / height) * 100;
  const lowest = asPercent(clear - PLATE_CLEARANCE);
  const highest = asPercent(insetTop + PLATE_CLEARANCE);
  if (lowest <= highest) return tops;
  const gap = (PLATE_CLEARANCE / height) * 100;

  for (const edge of [highest, lowest]) {
    // The plates sitting on this edge, nearest-anchor first, so the fan keeps the order the
    // district is drawn in rather than the order the array happens to be in.
    const crowd = tops
      .map((top, index) => ({ top, index }))
      .filter((one) => Math.abs(one.top - edge) < 1e-9)
      .sort((a, b) => anchors[a.index]! - anchors[b.index]!);
    if (crowd.length < 2) continue;

    const room = edge === highest ? lowest - edge : edge - highest;
    const step = Math.min(gap, room / (crowd.length - 1));
    crowd.forEach((one, rank) => {
      tops[one.index] = edge + (edge === highest ? rank * step : -rank * step);
    });
  }
  return tops;
}

export function DistrictScene({
  buildings,
  queue,
  playerLevel,
  selected,
  onSelect,
  readOnly = false,
  fill = !readOnly,
  interactive = !readOnly,
}: DistrictSceneProps) {
  const plate = deliveredUrl({ type: 'plate', plate: 'district' });
  const [frameRef, room] = useMeasuredSize();
  const [bandRef, band] = useMeasuredSize();
  // A second probe, inset by whatever the screen itself floats over the picture. The band above is
  // what the *painting* gets; this is what a *control* gets, and the difference is the district's
  // title row, which the artwork runs under and a name plate may not.
  const [safeRef, safe] = useMeasuredSize();
  const scene = fitted(room, band, fill);
  /*
   * Which way the painting is short of the frame, so its cut edge can be faded into the surround.
   *
   * Only on the axis that has margin: feathering an edge that runs to the frame's own edge would
   * dim the artwork for nothing. With the aspect now inviolable the short axis is always the
   * width, but it is measured rather than assumed, because a room wider than 21:10 has none.
   */
  const sceneWidth = typeof scene.width === 'number' ? scene.width : 0;
  const feather =
    fill && sceneWidth > 0 && sceneWidth < room.width - 1
      ? `linear-gradient(to right, transparent, #000 ${SCENE_FEATHER_PX}px, #000 calc(100% - ${SCENE_FEATHER_PX}px), transparent)`
      : undefined;
  // What `plateTop` needs to pull a plate back inside the bars: the picture it is hung on, and the
  // room the chrome left. Zero for the city screen's preview, which has no chrome and no bleed.
  const pictureHeight = fill ? Number(scene.height) || 0 : 0;
  const clear = fill ? band.height : 0;
  const insetTop = fill ? Math.max(0, band.height - safe.height) : 0;

  const sites = DISTRICT_SITES_BY_DEPTH.map((site) => {
    const level = buildingLevel(buildings, site.kind);
    /*
     * Judged against the district the **queue** will produce, not the one standing right now.
     *
     * The same reading the plot dialog and the build route use, and they have to agree or the
     * screen contradicts itself: a player who has already paid for the Nexus level that opens the
     * Gate was shown a padlock and a note reading "You need: The Nexus at 4" over a dialog
     * offering to build it. The map was answering a question nobody had asked: what is possible
     * *this second*, while everything else answered what is possible once the orders you have
     * already placed land.
     *
     * Read once and carried, because the plate needs both answers: whether it is locked and what
     * by. Deriving the boolean here and the reasons again inside the plate would be two calls that
     * can disagree, and the one that disagrees is the one nobody is looking at.
     */
    const unmet = unmetForQueue(site.kind, buildings, queue, playerLevel);
    const state: PlotState = queue.some((entry) => entry.kind === site.kind)
      ? 'working'
      : level > 0
        ? 'standing'
        : unmet.length === 0
          ? 'vacant'
          : 'locked';
    return { site, level, state, unmet };
  }).filter(({ level }) => !readOnly || level > 0);

  // Hung as a set rather than one at a time, so a band too short to hold them all fans the crushed
  // ones apart instead of stacking them on one line (`plateTops`).
  const plateHangs = plateTops(
    sites.map(({ site }) => siteDepth(site) + (site.labelShift?.y ?? 0)),
    pictureHeight,
    clear,
    insetTop,
  );

  return (
    // The whole painting, edge to edge, and **never** cropped horizontally.
    //
    // Cover was the obvious way to fill a viewport of any shape and it is wrong here: it crops the
    // sides, and there is nothing across the width of this plate that can be cropped. Every outline
    // was traced on the whole painting, so a cut edge is not a lost margin. It is twelve polygons
    // pointing at pixels that have moved. What the frame *does* take is the empty ground off the
    // top and bottom, which is why the picture takes the full width and lets its own margins slide
    // under the bars.
    <div
      ref={frameRef}
      // No ground of its own. Where the picture cannot reach: a viewport too wide for the shape of
      // the plate: what shows through is the shell's own backdrop, which is this same painting
      // blurred and pushed back. A flat slab of `surface-950` there is the thing that made the
      // district read as a picture sitting on a page; the blur reads as the rest of the city.
      className="absolute inset-0 overflow-hidden"
      data-testid="district-frame"
    >
      {/* What a *control* is allowed to occupy: the chrome's room, less whatever the screen itself
          floats over the picture. Zero-sized and invisible; it exists to be measured. */}
      {fill && (
        <div
          ref={safeRef}
          aria-hidden
          className="pointer-events-none absolute left-0 right-0"
          style={{
            top: 'var(--scene-safe-top, var(--scene-top, var(--hud-h, 0px)))',
            bottom: 'var(--scene-bottom, var(--nav-h, 0px))',
          }}
        />
      )}

      {/* The room the floating chrome leaves, as a box rather than as arithmetic.
          `--hud-h` and `--nav-h` are published by the shell from its own measurements, so this
          tracks a HUD that wrapped to a second row or a nav that grew a door, on any viewport,
          without either component knowing the other exists. Read-only means the preview panel on
          the city screen, which has no chrome over it, and would otherwise inherit the shell's
          variables and inset itself inside somebody else's frame. */}
      <div
        ref={bandRef}
        className={cn(
          'absolute left-0 right-0 flex justify-center',
          fill ? 'items-start' : 'items-center',
        )}
        style={
          !fill
            ? { top: 0, bottom: 0 }
            : {
                // `--scene-top`/`--scene-bottom` are what the *screen* adds on top of the shell's
                // own bars: the district's title row, for one. Falling back to the shell's
                // variables keeps the scene correct anywhere it is used without one.
                top: 'var(--scene-top, var(--hud-h, 0px))',
                bottom: 'var(--scene-bottom, var(--nav-h, 0px))',
              }
        }
      >
        {/*
         * The surround, where the painting is narrower than the room.
         *
         * A blurred, dimmed copy of the plate rather than flat background, and the picture's own
         * edges feathered into it. A cut edge is what reads as a border: matching the surround's
         * brightness gets the two within a few values and the line is still there, because the eye
         * is not comparing greys, it is finding a straight vertical boundary between detail and no
         * detail. This is the same treatment `PlateRoom` gives the city and the Bar.
         */}
        {fill && plate !== null && feather !== undefined && (
          /*
           * The same two pieces `PlateRoom` uses for the city and the Bar, for the same reasons.
           *
           * The blurred copy is over-scaled so the blur's own soft edge falls outside the box
           * instead of showing as a pale rim. That costs 160px of image hanging past each side, so
           * it needs both: a clipping wrapper, so the blur cannot paint over whatever the screen
           * drew next to the scene, and `data-scenery`, because the layout gates measure layout
           * boxes rather than painted pixels and a clip does not move the rect they read. Scenery
           * is the one thing allowed to be bigger than its frame; the marks standing on it are not,
           * and the attribute exempts this element only.
           */
          <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <img
              src={plate}
              alt=""
              aria-hidden="true"
              data-scenery
              className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-[48px] saturate-[0.9]"
              data-testid="district-surround"
            />
          </span>
        )}

        <div
          // Sized in pixels, from a measurement, rather than by CSS.
          //
          // The obvious spelling, a percentage width with `aspect-ratio` and a `max-height`, is
          // subtly broken, and broken *silently*: `aspect-ratio` derives the height from the width,
          // and a `max-height` then clamps that height **without giving the width back**. On a short
          // viewport the box quietly stops being the plate's shape, and the image inside it crops to
          // fit. It cost a third of this painting's height once, with every gate green: the outlines
          // still laid out correctly *in the box*, and the box was no longer the picture.
          className="relative"
          style={scene}
          data-testid="district-scene"
        >
          {plate === null ? (
            <Ground />
          ) : (
            <img
              src={plate}
              alt=""
              aria-hidden="true"
              /*
               * `fill` is safe here because the box is now the painting's own shape.
               *
               * It used to be a box the frame needed rather than the one the plate was painted at,
               * and `object-fill` is what spent the difference as a stretch. `fitted` keeps the
               * 21:10 exactly now, so filling the box and preserving the aspect are the same thing,
               * and the twelve building outlines land where they were painted.
               */
              className="absolute inset-0 h-full w-full object-fill"
              style={
                feather === undefined ? undefined : { maskImage: feather, WebkitMaskImage: feather }
              }
              data-testid="district-plate"
            />
          )}

          {/*
           * The controls (§A1). Grepolis' arrangement: the painting shows the buildings, and a
           * **name plate under each one** is the thing you click.
           *
           * This replaced a traced polygon per building that lit up and answered the pointer. The
           * outlines were accurate, they hit-tested the real silhouette, and they were a bad
           * control for three reasons a player feels immediately. Nothing said they were there, so
           * the first minute of the game was moving a cursor over a painting hoping something
           * happened. The lit-up wash and the dark scrim were painted *over* the artwork, so the
           * better the plate got the worse the interface looked. And a shape you have to find is a
           * shape somebody on a laptop trackpad has to find twice.
           *
           * A label under the building is legible at a glance, always in the same place, has an
           * obvious hit box, and reads as a sign on a building rather than as a hole cut in a
           * picture. The outlines still exist and still earn their keep. They are what `plots.ts`
           * positions these from, and what `building-portraits` cuts the dialog art with.
           */}
          <div className="absolute inset-0" data-testid="district-plots">
            {sites.map(({ site, level, state, unmet }, index) => (
              <PlotLabel
                key={site.kind}
                site={site}
                level={level}
                state={state}
                unmet={unmet}
                selected={selected === site.kind}
                readOnly={!interactive}
                topPercent={plateHangs[index]!}
                onSelect={() => onSelect(site.kind)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One structure's name plate: the control the district is played through.
 *
 * Anchored at the **bottom** of the building's traced outline and hung below it, so it reads as a
 * sign under the thing it names rather than as a sticker over it. `siteDepth` is the lowest point
 * of the silhouette, which is the building's ground line, so this lands where a sign would.
 *
 * A single `<button>`, always: even locked. A locked plot that could not be clicked would be a
 * dead square with no way to find out anything about it, which is exactly the failure §I3 asks the
 * rest of the game to avoid; clicking one opens the same dialog and it explains itself.
 *
 * The hover note is `HoverCard` rather than a `title`: a native tooltip is slow, unstyleable,
 * invisible to touch and impossible to read at the bottom of a dark painting.
 */
function PlotLabel({
  site,
  level,
  state,
  unmet,
  selected,
  readOnly,
  topPercent,
  onSelect,
}: {
  site: DistrictSite;
  level: number;
  state: PlotState;
  unmet: readonly BuildingRequirement[];
  selected: boolean;
  readOnly: boolean;
  /** The building's ground line, pulled inside the clear band. See {@link plateTop}. */
  topPercent: number;
  onSelect: () => void;
}) {
  const spec = BUILDING_CATALOG[site.kind];
  const middle = siteCentroid(site);
  // A few buildings move their plate off their own middle, because their middle is the part of the
  // painting worth looking at (`labelShift`). The outline is untouched, so the pointer target and
  // the sign come apart by a few percent and nothing else changes.
  const centre = { x: middle.x + (site.labelShift?.x ?? 0) };
  const name = `${spec.name}, ${describe(state, level, unmet)}`;

  const face = (
    <span
      className={cn(
        'flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5',
        'font-display text-[11px] font-semibold uppercase tracking-[0.1em] shadow-lifted',
        PLATE_STYLES[state],
        selected && 'ring-1 ring-inset ring-brass-300',
      )}
    >
      {state === 'locked' && (
        <Icon name="lock" aria-hidden className="h-3 w-3 shrink-0 text-brass-300" />
      )}
      <span>{spec.shortName}</span>
      {plate_(state, level) !== '' && (
        <span className="tabular-nums opacity-75">{plate_(state, level)}</span>
      )}
    </span>
  );

  // Somebody else's ground: a caption, not a control.
  if (readOnly) {
    return (
      <span
        data-testid={`plot-${site.kind}`}
        aria-hidden="true"
        style={{ left: `${centre.x}%`, top: `${topPercent}%` }}
        className="pointer-events-none absolute z-10 -translate-x-1/2"
      >
        {face}
      </span>
    );
  }

  return (
    <span
      style={{ left: `${centre.x}%`, top: `${topPercent}%` }}
      // Three quarters of the plate hangs *below* the building's ground line, which is what makes
      // it read as a sign under the building rather than a sticker on it, and the quarter that
      // does not is what keeps it inside `LABEL_ALLOWANCE` at the smallest plate the game draws.
      className="absolute z-10 -translate-x-1/2 -translate-y-1/4"
    >
      <HoverCard
        data-testid={`plot-${site.kind}`}
        label={name}
        onActivate={onSelect}
        card={<PlotNote kind={site.kind} state={state} level={level} unmet={unmet} />}
        className="transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0"
      >
        {face}
      </HoverCard>
    </span>
  );
}

/**
 * The note that drops out of a plate on hover (§I3).
 *
 * For a locked plot this is the whole point of the feature: **every** unmet clause, in the
 * catalogue's own order, so a player learns the route rather than discovering it one refusal at a
 * time. A structure gated on the Nexus, another building and the crew's level says all three at
 * once, because "raise the Nexus" followed by "now build Quarters" followed by "now reach level 7"
 * is the same information delivered as three disappointments.
 *
 * Every other state gets a note too, and cheaply: the structure's own one-line job. A card that
 * only ever appeared on the things you cannot have would teach players to ignore it.
 */
function PlotNote({
  kind,
  state,
  level,
  unmet,
}: {
  kind: BuildingKind;
  state: PlotState;
  level: number;
  unmet: readonly BuildingRequirement[];
}) {
  const spec = BUILDING_CATALOG[kind];
  return (
    <div className="flex max-w-[15rem] flex-col gap-1.5">
      <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300">
        {spec.name}
        {state === 'standing' && ` · Lv ${level}`}
      </p>

      {state === 'locked' ? (
        <>
          <p className="font-body text-[12px] leading-relaxed text-ink-300">Not yet. You need:</p>
          <ul className="flex flex-col gap-0.5">
            {unmet.map((clause) => (
              <li
                key={describeBuildingRequirement(clause)}
                className="flex items-baseline gap-1.5 font-display text-[11px] uppercase tracking-[0.1em] text-ink-100"
              >
                <span aria-hidden className="text-brass-300">
                  ▸
                </span>
                {/* Its own element, so the clause is addressable as one string: by a test, and by
                    anything that has to read the list back out. */}
                <span>{describeBuildingRequirement(clause)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="font-body text-[12px] leading-relaxed text-ink-200">{spec.role}</p>
      )}

      <p className="font-body text-[11px] leading-relaxed text-ink-300">
        {state === 'working'
          ? 'Work is under way. Open it to see what is left.'
          : state === 'vacant'
            ? 'Ready to build. Open it for the price and the clock.'
            : state === 'locked'
              ? 'Open it anyway: a shut door still tells you what it is for.'
              : 'Open it for the price of the next level.'}
      </p>
    </div>
  );
}

/**
 * The trailing half of a name plate: the level, or the symbol standing in for one.
 *
 * A locked plate says nothing here: the padlock at the *front* of the plate already says it, and
 * a lock glyph at both ends was two marks for one fact.
 */
function plate_(state: PlotState, level: number): string {
  if (state === 'locked') return '';
  if (state === 'working') return level > 0 ? `Lv ${level} ▲` : '▲';
  return level > 0 ? `Lv ${level}` : '';
}

/** The same four states in words, for the accessible name. The plate's glyphs say nothing aloud. */
function describe(state: PlotState, level: number, unmet: readonly BuildingRequirement[]): string {
  switch (state) {
    case 'working':
      return level > 0 ? `level ${level}, upgrade under way` : 'under construction';
    case 'standing':
      return `level ${level}`;
    case 'vacant':
      return 'vacant plot';
    case 'locked':
      // Every clause, not the first: a screen reader gets the same route the hover note draws.
      return `locked, needs ${unmet.map(describeBuildingRequirement).join(', ')}`;
  }
}

/**
 * The interim ground, drawn until `plate-district` is delivered.
 *
 * No sky and no horizon: the camera looks down at the compound, so the whole frame is ground. What
 * the top of the frame shows is the perimeter the district ends at ({@link DISTRICT_BACK_EDGE}).
 *
 * Deliberately almost bare: a busy placeholder gets read as the design and then argued with. It is
 * a backstop for a missing file rather than a rehearsal of the painting: the outlines are traced
 * on the delivered plate and mean nothing without it, so what this has to do is be obviously not
 * the district rather than pretend to be it.
 *
 * Stretched to the scene box rather than fitted, so there is never a letterbox band of bare surface
 * at any aspect the frame ends up at.
 */
function Ground() {
  const { abyss, smog, ferrite } = ramps;
  return (
    <svg
      viewBox="0 0 200 100"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        {/* One gradient per band, each starting on the value the road above it ends on, so the
            three read as one slope away from the viewer rather than three stripes. */}
        <linearGradient id="district-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={smog[950]} />
          <stop offset="100%" stopColor={ferrite[950]} />
        </linearGradient>
        <linearGradient id="district-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={smog[700]} />
          <stop offset="100%" stopColor={ferrite[950]} />
        </linearGradient>
        <linearGradient id="district-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ferrite[700]} />
          <stop offset="100%" stopColor={abyss[950]} />
        </linearGradient>
      </defs>

      {/* The whole frame is dirt; the bands sit on top of it, so a road is the ground showing. */}
      <rect x="0" y="0" width="200" height="100" fill={abyss[700]} />
      <rect x="0" y="0" width="200" height={DISTRICT_BACK_EDGE} fill={abyss[950]} />

      {ROW_BANDS.map((band) => (
        <rect
          key={band.top}
          x="0"
          y={band.top}
          width="200"
          height={band.bottom - band.top}
          fill={band.fill}
        />
      ))}

      {/* The lanes between the rows, and the lit lip where each band steps down into one. */}
      {ROW_BANDS.map((band) => (
        <rect
          key={`lip-${band.bottom}`}
          x="0"
          y={band.bottom - 0.5}
          width="200"
          height="0.5"
          fill={ferrite[500]}
          opacity="0.28"
        />
      ))}

      {/* Ground furniture, kept faint: worn patches in the dirt. */}
      <g fill={abyss[950]} opacity="0.22">
        <ellipse cx="52" cy="35" rx="24" ry="2.5" />
        <ellipse cx="146" cy="68" rx="28" ry="3" />
        <ellipse cx="30" cy="99" rx="26" ry="2.5" />
      </g>
    </svg>
  );
}

/** Where each band of the stand-in ground starts and ends, percent of scene height. */
const ROW_BANDS = [
  { top: DISTRICT_BACK_EDGE, bottom: 30, fill: 'url(#district-far)' },
  { top: 36, bottom: 64, fill: 'url(#district-mid)' },
  { top: 70, bottom: 100, fill: 'url(#district-near)' },
] as const;
