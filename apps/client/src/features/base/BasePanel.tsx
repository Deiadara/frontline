import {
  BUILDING_CATALOG,
  MAX_BUILD_QUEUE,
  RESOURCE_KEYS,
  districtProduction,
  unitSlotCapacity,
  unitSlotDraw,
  playerLevelGrants,
  playerXpToNextLevel,
  queueCancelWindowMs,
  queueProgressAt,
  queueRemainingMs,
  storageCapacity,
  storageCapacityFor,
  payrollLedger,
  payrollBonusPercent,
  buildingLevel,
  committedPayroll,
  type Base,
  type BuildingKind,
} from '@frontline/shared';
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { LevelUpBanner } from '../../components/LevelUp';
import { StandingReadout } from '../../components/Meters';
import { RESOURCE_META, ResourceGrid } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { CancelMark } from '../../components/ui/CancelMark';
import { Modal } from '../../components/ui/Modal';
import { Panel } from '../../components/ui/Panel';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { announceWaived } from '../../lib/deltas';
import {
  useBase,
  useBuildStructure,
  useBuyBuildBoost,
  useCancelBuild,
  useClearModification,
  useCrewStanding,
  useMe,
  useUnits,
} from '../../lib/queries';
import { useNavigate } from 'react-router-dom';
import { useMeasuredSize, type MeasuredSize } from '../../lib/useMeasuredHeight';
import { useServerClock } from '../missions/useServerClock';
import { StructureDialog } from './StructureDialog';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { DistrictScene } from './DistrictScene';
import { formatRate, formatRemaining } from './format';

/**
 * The district (GDD §A1): a place you look at and click, not a list of structure rows.
 *
 * Everything under the scene is a readout of something the scene cannot show: what is being built,
 * who the district is housing, what the structures are making, and the W2/W6 numbers that were
 * already on this page. Nothing here computes a game rule: every figure comes from a shared function the
 * server calls too.
 */
export function BasePanel() {
  const me = useMe();
  // §F2: the store is filled to the structure plus the crew's Logistics, so the shelves quoted
  // here are computed the way `accrueProduction` fills them rather than off the buildings alone.
  const crewStorage = useCrewStanding().data?.effects['storageCapacityPercent'] ?? 0;
  const baseId = me.data?.base?.id;
  const baseQuery = useBase(baseId);
  const base = baseQuery.data?.base ?? me.data?.base ?? null;
  const build = useBuildStructure(baseId);
  /*
   * Read off the refusal too. `POST /base/build` settles first and refuses second, and the
   * level-up a build that finished overnight crossed rides on the 409 (`routes/base.ts`, MOU-280):
   * that refusal is the only response that ever carries it, and reading `build.data` alone dropped
   * it whenever the next press was for something the crew could not afford.
   */
  const levelUp =
    build.data?.levelUp ??
    (build.error instanceof ApiRequestError ? build.error.levelUp : undefined);
  // §B4 and §E: the two writes the plot dialog makes, both answering with the whole base. Filling
  // a bracket is not one of them any more: the yard cuts a card straight into it (2026-09-16).
  const boost = useBuyBuildBoost(baseId);
  const clear = useClearModification(baseId);
  const navigate = useNavigate();
  const [selectedPlot, setSelectedPlot] = useState<BuildingKind | null>(null);
  /*
   * The frame, measured, so the rail can re-read where the name plates are when it changes shape.
   *
   * The rail is bounded by the plates it would otherwise cover (`useRailCeiling`), and those move
   * with every resize: the picture is fitted to whatever the floating chrome leaves. Nothing here
   * uses the numbers directly; they are the rail's cue to measure again.
   */
  const [roomRef, room] = useMeasuredSize<HTMLDivElement>();
  // How far down the picture the rail reaches when it is laid across the top. Zero down the side,
  // where it is bounded instead of given room. See `BuildQueueRail`.
  const [railStripHeight, setRailStripHeight] = useState(0);

  if (!base) {
    /* Either read can be the one that failed: the district falls back to the session's own copy,
       so a player only sees nothing when both are gone. Retry asks for both. */
    return (
      <ScreenLoad
        what="Your district"
        loading="Loading district…"
        isError={baseQuery.isError || me.isError}
        onRetry={() => {
          void me.refetch();
          void baseQuery.refetch();
        }}
      />
    );
  }

  // A fresh plot starts with a clean slate: the refusal from the last one is not about this one.
  const selectPlot = (kind: BuildingKind) => {
    build.reset();
    boost.reset();
    clear.reset();
    setSelectedPlot(kind);
  };

  return (
    // The district *is* the screen. It fills the viewport behind the floating chrome, and
    // everything written about it scrolls in a column over the top: the readouts are a report on
    // the place, so they belong on it rather than under it in a document that pushes it off-screen.
    <div
      ref={roomRef}
      className="relative h-full w-full"
      // What the district has to lay itself out under: the HUD, and nothing else.
      //
      // The title row used to be in here too, and it cost the painting forty-odd pixels of height
      // at every viewport for a strip of three chips. It floats *over* the artwork now, the way a
      // town view's does in Grepolis, so the picture starts at the bottom of the stockpile: the
      // scrim behind the row is what keeps the type legible on a bright roof.
      //
      // Published as a variable rather than passed as a prop because the scene is the thing that
      // has to know and it is two components down.
      style={
        {
          // The HUD, and nothing else. The district used to dock its own title bar under the
          // stockpile, carrying the allegiance plaque and three tags, and it cost the painting forty
          // pixels of height on every viewport for information that belongs to the *player* rather
          // than to this screen. The plaque is in the standing bar now (`DistrictPlaque`), where it
          // is on every screen instead of only this one, and the district is just the district.
          '--scene-top': 'var(--hud-h, 0px)',
          // What a *control* has to clear when that is more than the HUD: the rail laid across the
          // top of the picture on a narrow frame. `DistrictScene` reads it to hang every name
          // plate below the rail (`plateTop`); the painting itself still runs under it, which is
          // the point of floating it. Kept small by the rail staying one row deep: `plateTop`
          // clamps rather than scales, so a deep enough inset puts two plates on one line.
          ...(railStripHeight > 0
            ? { '--scene-safe-top': `calc(var(--hud-h, 0px) + ${railStripHeight}px)` }
            : {}),
        } as React.CSSProperties
      }
    >
      <DistrictScene
        buildings={base.buildings}
        queue={base.buildQueue}
        playerLevel={base.level}
        selected={selectedPlot}
        onSelect={selectPlot}
      />

      {/*
       * §A1: what is under way, down the left of the district (maintainer request).
       *
       * It was inside the Reports drawer, which is a button at the bottom of the screen: the one
       * thing on this page that is *happening* was the one thing you had to go and open a panel to
       * see. A build is a clock, and a clock belongs where it can be glanced at.
       *
       * Over the painting rather than beside it, because the district is edge-to-edge by design
       * (see `DistrictScene`) and giving the rail its own column would take a fifth of the
       * artwork on every viewport for something that is empty most of the time.
       */}
      {base.buildQueue.length > 0 && (
        <BuildQueueRail
          base={base}
          serverNow={baseQuery.data?.serverNow}
          receivedAt={baseQuery.dataUpdatedAt}
          room={room}
          onStripHeight={setRailStripHeight}
        />
      )}

      {/* §I1 pays for building things, and the response is the only thing that knows this build is
          what crossed the threshold (MOU-227), so the banner lives with the district, over it, and
          not folded into a drawer the player would have to open to find out they levelled. */}
      {levelUp && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 pt-3"
          // Under the title row, whatever the title row turned out to be. It used to clear the
          // chrome by a hard-coded 96px, measured against a taller plaque that no longer exists:
          // the kind of constant that is right on the day it is typed and silently wrong after the
          // next layout change.
          style={{ top: 'var(--scene-top, var(--hud-h, 0px))' }}
        >
          <div className="pointer-events-auto w-full max-w-2xl">
            <LevelUpBanner levelUp={levelUp} />
          </div>
        </div>
      )}

      <ReportsDrawer>
        <Panel title={`Build queue (${base.buildQueue.length} / ${MAX_BUILD_QUEUE})`}>
          <BuildQueue
            base={base}
            serverNow={baseQuery.data?.serverNow}
            receivedAt={baseQuery.dataUpdatedAt}
          />
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="The district">
            <HousingReadout base={base} />
          </Panel>
          <Panel title="Production">
            <ProductionRows base={base} />
          </Panel>
        </div>

        <Panel title="Stockpile">
          <ResourceGrid resources={base.resources} className="p-4" />
          {/* Three shelves and three figures. One number for "of each" was true when there was
              one ceiling; now the bulk shelf holds three times what the metal shelf does, and a
              single figure would be wrong for four of the five capped resources. */}
          <p className="border-t border-surface-700 px-4 py-2 font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
            The Apothecary holds{' '}
            {storageCapacityFor(
              base.buildings,
              'scrap',
              storageCapacity(base.buildings, crewStorage),
            ).toLocaleString()}{' '}
            scrap or planks,{' '}
            {storageCapacityFor(
              base.buildings,
              'oil',
              storageCapacity(base.buildings, crewStorage),
            ).toLocaleString()}{' '}
            oil or supplies and{' '}
            {storageCapacityFor(
              base.buildings,
              'highQualityMetal',
              storageCapacity(base.buildings, crewStorage),
            ).toLocaleString()}{' '}
            HQ metal. Production stops there. Raids and pay do not. Caps have no ceiling.
          </p>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Standing">
            <StandingReadout
              economy={base.economy}
              level={base.level}
              xpIntoLevel={base.progression.xpIntoLevel}
              xpToNextLevel={playerXpToNextLevel(base.level)}
            />
          </Panel>
          <Panel title="Payroll">
            <PayrollRows base={base} />
          </Panel>
        </div>

        <Panel title="Progression">
          <ProgressionRows base={base} />
        </Panel>
      </ReportsDrawer>

      {selectedPlot !== null && (
        <StructureDialog
          kind={selectedPlot}
          base={base}
          // The server's own price for every plot, off the call the shell polls. See the prop.
          quotes={me.data?.buildQuotes}
          clocks={me.data?.buildClocks}
          serverNow={baseQuery.data?.serverNow}
          receivedAt={baseQuery.dataUpdatedAt}
          pending={build.isPending}
          error={build.error ?? boost.error ?? clear.error}
          onBuild={() =>
            build.mutate(
              { kind: selectedPlot },
              {
                // The testing build waives the bill it quoted: say what it was. See `announceWaived`.
                onSuccess: () => {
                  const quote = me.data?.buildQuotes?.[selectedPlot];
                  if (me.data?.admin === true && quote !== undefined) announceWaived(quote);
                },
              },
            )
          }
          onClose={() => setSelectedPlot(null)}
          onBoost={() => boost.mutate({})}
          boostPending={boost.isPending}
          onClearSlot={(slot) => clear.mutate({ building: selectedPlot, slot })}
          onGo={(path) => {
            setSelectedPlot(null);
            void navigate(path);
          }}
        />
      )}
    </div>
  );
}

interface BuildQueueProps {
  base: Base;
  /** `useServerClock`'s two arguments, off the district read (`BaseDetailResponse.serverNow`). */
  serverNow: string | undefined;
  receivedAt: number | undefined;
}

/**
 * What is being built, in the order it will land (§A1).
 *
 * The countdown ticks against the *server's* clock, like the mission board's: a machine with a
 * skewed clock shows the same remaining time as everyone else, and still cannot make a build land
 * early. `serverNow` and `receivedAt` are the district read's clock and when it arrived; both were
 * passed as `undefined` before `/base/:id` carried one, which made this the browser's clock.
 */
function BuildQueue({ base, serverNow, receivedAt }: BuildQueueProps) {
  const now = useServerClock(serverNow, receivedAt);
  const cancel = useCancelBuild(base.id);

  if (base.buildQueue.length === 0) {
    return (
      <p className="p-4 font-body text-xs leading-relaxed text-ink-300">
        Nothing under way. Click a plot to order a level. Up to {MAX_BUILD_QUEUE} at a time, worked
        one after another.
      </p>
    );
  }

  return (
    <>
      {cancel.error && (
        <p role="alert" className="px-4 pt-3 font-body text-xs text-oxblood-300">
          {cancel.error.message}
        </p>
      )}
      <ol className="flex flex-col divide-y divide-surface-700" data-testid="build-queue">
        {base.buildQueue.map((entry, index) => {
          const progress = queueProgressAt(entry, now);
          const remaining = queueRemainingMs(entry, now);
          return (
            <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="truncate font-display text-[12px] uppercase tracking-[0.18em] text-ink-200">
                  {index + 1}. {BUILDING_CATALOG[entry.kind].name} → Lv {entry.level}
                </span>
                <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-brass-300">
                  {formatRemaining(remaining)}
                </span>
              </div>
              <span className="block h-1.5 w-full bg-surface-700">
                <span
                  className={cn('block h-full', index === 0 ? 'bg-brass-300' : 'bg-surface-600')}
                  style={{ width: `${progress * 100}%` }}
                />
              </span>
              {/* Inside the first tenth, or before the clock has started at all: the order can
                  still be called off, and ninety percent of what it took comes back. */}
              <CancelMark
                windowMs={queueCancelWindowMs(entry, now)}
                label={`Call off ${BUILDING_CATALOG[entry.kind].name} level ${entry.level}`}
                pending={cancel.isPending}
                onCancel={() => cancel.mutate({ orderId: entry.id })}
                data-testid={`queue-cancel-build-${entry.id}`}
              />
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * The narrowest frame on which the rail is a column down the left, in CSS pixels.
 *
 * The plates are positions on the picture and the rail is a fixed fifteen rems over it, so whether
 * the two meet is a fact about the viewport. At full bleed the Quarters' plate, the leftmost
 * control on the back row, has its left edge at about 17% of the frame's width (`DISTRICT_SITES`:
 * centroid at 22%, less half a plate). A 15rem column with its own gutter reaches 228px, which is
 * 17% of 1330px: on a 1024px frame the column stood 51px over the Quarters and swallowed its click
 * (visual sweep, 2026-09-15). 1280px is Tailwind's `xl`, the nearest rung the rest of the client
 * already reflows at, and the plate clears the column there by a few pixels; under it the rail runs
 * across the top instead (`BuildQueueRail`).
 */
export const RAIL_COLUMN_MIN_WIDTH_PX = 1280;

const railColumnMedia = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia(`(min-width: ${RAIL_COLUMN_MIN_WIDTH_PX}px)`)
    : null;

/**
 * Whether the frame is wide enough for the rail to stand as a column.
 *
 * A media query rather than a measurement of the panel, because the breakpoint is a fact about the
 * *viewport*, the same one Tailwind's `xl:` utilities answer to, and reading it the same way keeps
 * the two from disagreeing by a pixel. Where there is no `matchMedia` (jsdom) the answer is the
 * column, which is the layout every other test in this file was written against.
 */
function useRailColumn(): boolean {
  const [column, setColumn] = useState(() => railColumnMedia()?.matches ?? true);
  useEffect(() => {
    const media = railColumnMedia();
    if (!media) return;
    const onChange = () => setColumn(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return column;
}

/** The gap between the top of the scene and the rail's first plate, in pixels. */
const RAIL_INSET_PX = 12;

/** Room the rail leaves between its last order and the name plate underneath it, in pixels. */
const RAIL_PLATE_GAP_PX = 8;

/**
 * How near a plate has to pass the column's side to count as standing in its way, in pixels.
 *
 * Boxes here are fractional and the margin that decides this is real: at 1280x800 the Quarters'
 * plate clears the orders by four pixels. Two is enough that a plate which only just misses is
 * treated as a miss, without letting a rounding difference decide it.
 */
const RAIL_PLATE_TOUCH_PX = 2;

/**
 * How tall the column may be before it stands on a name plate, in pixels, or null for no ceiling.
 *
 * Only down the side. Across the top the rail spans the whole picture, so there is no "beside the
 * plates" to be had and the plates are given room instead ({@link BuildQueueRail}).
 *
 * ## Why this is measured and not derived
 *
 * The obvious move is arithmetic: `plots.ts` holds every outline and `DistrictScene` exports the
 * `fitted`/`plateTop` pair that puts them on screen, so the topmost plate in the column's own band
 * could be computed without touching the DOM. It would be wrong in the direction that costs the
 * most. A plate's *width* is type, not data: the box is as wide as `QUARTERS ▲` sets, and at
 * 1280x800 the Quarters plate clears the column by four pixels (232 against 228). A derivation has
 * to assume a worst-case width, which puts the Quarters in the band and drops the ceiling from the
 * Scrapyard's 657 to the Quarters' 293: room for one order on a screen where four fit. Measuring
 * the laid-out boxes asks the only thing that knows.
 *
 * The published safe box is not enough on its own either. It says where the *chrome* is, and the
 * plate that bounds the column is the Scrapyard's, which sits in the middle of the picture, three
 * hundred pixels clear of the scenery switcher.
 *
 * ## When it is read
 *
 * On mount, and again every time the picture moves under the rail. A single reading is a reading
 * of the frame before the chrome had measured itself: on mount the HUD has no height yet, so the
 * plates sit 126px higher than they end up and the ceiling comes back far too low.
 *
 * Two watches, because the picture settles in two ways and only one of them is a resize. Where the
 * painting runs full bleed its height is fixed by the frame's *width*, so as the scenery switcher
 * reports its own height the picture does not change size at all: it slides, on a margin, and a
 * `ResizeObserver` hears nothing. That is what left the ceiling reading the Quarters' pre-settle
 * position, and a full queue still standing on the Scrapyard at 1440x900. So the scene's size is
 * observed *and* the inline styles under the frame are: `fitted` writes the picture's box into a
 * style attribute, and `plateTop` writes every plate's percentage into one.
 */
function useRailCeiling(
  rail: RefObject<HTMLElement>,
  room: MeasuredSize,
  orders: number,
  active: boolean,
): number | null {
  const [ceiling, setCeiling] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = rail.current;
    if (node === null || !active) {
      setCeiling(null);
      return;
    }
    const measure = () => {
      const box = node.getBoundingClientRect();
      // The orders' own box, not the rail's: the rail carries a gutter either side, and counting
      // that in puts the Quarters' plate in the column's path at 1280x800, where the orders in
      // fact clear it. The difference is a ceiling at the Scrapyard's 657 against the Quarters'
      // 293, which is four orders against one.
      const band = node.querySelector('[data-testid="build-rail-orders"]')?.getBoundingClientRect();
      const left = (band ?? box).left - RAIL_PLATE_TOUCH_PX;
      const right = (band ?? box).right + RAIL_PLATE_TOUCH_PX;
      // This district's plates, not every plate in the document: the city screen draws a second,
      // read-only scene from the same component.
      const plates = node.parentElement?.querySelectorAll<HTMLElement>('[data-testid^="plot-"]');
      let highest = Number.POSITIVE_INFINITY;
      for (const plate of plates ?? []) {
        const p = plate.getBoundingClientRect();
        // jsdom measures every box at zero, and a plate beside or above the rail is not one the
        // rail can come down on.
        if (p.width <= 0 || p.right <= left || p.left >= right || p.top <= box.top) continue;
        highest = Math.min(highest, p.top);
      }
      setCeiling(
        Number.isFinite(highest) ? Math.max(0, highest - RAIL_PLATE_GAP_PX - box.top) : null,
      );
    };
    measure();
    const frame = node.parentElement?.querySelector('[data-testid="district-frame"]');
    const scene = frame?.querySelector('[data-testid="district-scene"]');
    if (!frame || !scene) return;
    const sized = new ResizeObserver(measure);
    sized.observe(scene);
    const moved = new MutationObserver(measure);
    moved.observe(frame, { attributes: true, attributeFilter: ['style'], subtree: true });
    return () => {
      sized.disconnect();
      moved.disconnect();
    };
    // The rail's own height is deliberately not a dependency: it is the thing being bounded, and
    // reading it back would be a loop. Its top and sides move only with the frame.
  }, [rail, room.width, room.height, orders, active]);

  return ceiling;
}

interface BuildQueueRailProps extends BuildQueueProps {
  /** The frame the district is drawn in. See {@link useRailCeiling}. */
  room: MeasuredSize;
  /**
   * How far down the picture the rail reaches when it is laid across the top, or zero when it is
   * a column. The panel publishes it as `--scene-safe-top` so `DistrictScene` keeps every name
   * plate below it.
   */
  onStripHeight: (px: number) => void;
}

/**
 * The build queue as a rail over the district (§A1, maintainer request).
 *
 * One rectangle per order, each carrying the structure it is raising and how long it has left.
 * Collapsible, because a full queue is six plates and a player reading the map wants the map: the
 * header stays so the count is legible even when it is folded away.
 *
 * ## Down the left, or across the top
 *
 * The maintainer asked for it down the left, and that is where it stands from
 * {@link RAIL_COLUMN_MIN_WIDTH_PX} up. Narrower than that the column lands on the Quarters' plate
 * (the arithmetic is on the constant), and a plate a player cannot click is worse than a rail that
 * is not where it usually is. So on a narrow frame the same plates run left to right under the
 * stockpile instead.
 *
 * ## Why it scrolls, and what keeps it off the plates
 *
 * A full queue is six orders, which is 622px of rail: taller than the room beside the picture at
 * every viewport under 1920, and deeper than the top of the picture anywhere. So the rail is
 * bounded and the orders that do not fit are scrolled to, down the column and across the strip,
 * with the header outside the scroller so the count and the fold stay where the player left them.
 *
 * What bounds it differs with the direction, because the geometry does:
 *
 *   * **Down the side** it stops above the first name plate in its path
 *     ({@link useRailCeiling}) and the picture is left alone. A full queue stood on the Scrapyard's
 *     plate at 1280x800 and 1440x900 before this (visual sweep, 2026-09-15).
 *   * **Across the top** there is nothing to stand beside: the rail spans the picture, so the
 *     plates are given room instead, through `--scene-safe-top`. That inset has to stay shallow.
 *     `plateTop` clamps a plate into the clear band rather than scaling the picture, so every plate
 *     above the line lands *on* the line: at 1024x768 a queue deep enough to wrap the strip to two
 *     rows flattened the Lab, the Quarters and the Greenhouse onto one, where the Lab's box and the
 *     Apothecary's overlapped and the Lab could not be clicked. One row deep, always, is what keeps
 *     the inset inside what the clamp can absorb.
 *
 * Mounted only while there is something in it (the parent checks). An empty rail is a label for a
 * thing that is not happening, and the district screen already says where orders are placed.
 */
function BuildQueueRail({ base, serverNow, receivedAt, room, onStripHeight }: BuildQueueRailProps) {
  const now = useServerClock(serverNow, receivedAt);
  const cancel = useCancelBuild(base.id);
  const [open, setOpen] = useState(true);
  const column = useRailColumn();
  const [railRef, rail] = useMeasuredSize<HTMLDivElement>();
  const ceiling = useRailCeiling(railRef, room, base.buildQueue.length, column);

  // Across the top: the inset above the first order is added back, so the published figure is
  // where the rail *ends*. Reset on unmount, or a queue that has just emptied would leave the
  // plates hanging clear of a rail that is no longer there.
  useEffect(() => {
    // jsdom lays nothing out and reads an unset padding as NaN, which would publish `calc(NaN)`.
    const reach = Number.isFinite(rail.height) ? rail.height : 0;
    onStripHeight(column ? 0 : reach + RAIL_INSET_PX);
    return () => onStripHeight(0);
  }, [column, rail.height, onStripHeight]);

  return (
    <div
      ref={railRef}
      className={cn(
        'pointer-events-none absolute left-0 z-20 flex gap-1.5 px-3',
        column ? 'w-[15rem] flex-col' : 'right-0 flex-row items-start',
      )}
      // Placed, not padded: with the inset as position the box the ceiling is measured against is
      // the orders themselves.
      style={{
        top: `calc(var(--scene-top, var(--hud-h, 0px)) + ${RAIL_INSET_PX}px)`,
        ...(ceiling !== null ? { maxHeight: ceiling } : {}),
      }}
      data-testid="build-rail"
      data-layout={column ? 'column' : 'strip'}
    >
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        data-testid="build-rail-toggle"
        className="glass edge-lit pointer-events-auto flex shrink-0 items-center justify-between gap-2 rounded-sm border border-surface-600 px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200 transition-colors hover:border-brass-300/70 hover:text-brass-100"
      >
        <span>
          Under way
          <span className="ml-1.5 tabular-nums text-brass-300">
            {base.buildQueue.length}/{MAX_BUILD_QUEUE}
          </span>
        </span>
        <span aria-hidden className={cn('transition-transform', open ? 'rotate-90' : '')}>
          ›
        </span>
      </button>

      {open && (
        <div
          className={cn(
            // The scroller carries the pointer, so a wheel over the orders moves them rather than
            // the page behind them. It is content-sized until the ceiling bites, so it covers no
            // more of the painting than the orders themselves do.
            'pointer-events-auto flex min-h-0 min-w-0 flex-1 gap-1.5',
            column ? 'flex-col overflow-y-auto' : 'flex-row overflow-x-auto',
          )}
          data-testid="build-rail-orders"
        >
          {base.buildQueue.map((entry, index) => (
            <div
              key={entry.id}
              data-testid={`build-rail-${entry.kind}`}
              className={cn(
                'glass edge-lit pointer-events-auto flex flex-col gap-1 rounded-sm border px-3 py-2',
                // Never squashed to fit: inside a scroller a flex child gives up its own height
                // first, which would have compressed six orders into the room for four instead of
                // letting them scroll.
                'shrink-0',
                // Across the top, each plate keeps the width the column gave it, so an order reads
                // the same whichever way the rail is running.
                !column && 'w-[13.5rem]',
                // The one being worked reads differently from the ones waiting behind it: a queue
                // where every plate looks the same does not say which is moving.
                index === 0 ? 'border-brass-300/60' : 'border-surface-600/80 opacity-80',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-display text-[11px] uppercase tracking-[0.14em] text-ink-200">
                  {BUILDING_CATALOG[entry.kind].name}
                </span>
                <span className="shrink-0 font-display text-[12px] font-bold tabular-nums text-brass-300">
                  {formatRemaining(queueRemainingMs(entry, now))}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-400">
                  to level {entry.level}
                </span>
              </div>
              <span className="block h-1 w-full bg-surface-700">
                <span
                  className={cn('block h-full', index === 0 ? 'bg-brass-300' : 'bg-surface-600')}
                  style={{ width: `${queueProgressAt(entry, now) * 100}%` }}
                />
              </span>
              {/* On its own row rather than beside "to level N": the plate is 13.5rem wide and the
                X with its countdown is most of that. */}
              <CancelMark
                className="mt-0.5"
                windowMs={queueCancelWindowMs(entry, now)}
                label={`Call off ${BUILDING_CATALOG[entry.kind].name} level ${entry.level}`}
                pending={cancel.isPending}
                onCancel={() => cancel.mutate({ orderId: entry.id })}
                data-testid={`cancel-build-${entry.id}`}
              />
            </div>
          ))}
          {cancel.error && (
            <p
              role="alert"
              className="glass shrink-0 rounded-sm border border-oxblood-500/60 px-3 py-2 font-body text-xs text-oxblood-300"
            >
              {cancel.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Who the district is housing, against how many it can (§A1).
 *
 * What used to be here was the power grid: supply against draw, with a brownout warning under it.
 * The grid is gone (§A1) and so is the readout; what is left is the one district-wide figure a
 * player has to keep an eye on, which used to be a row inside it.
 */
function HousingReadout({ base }: { base: Base }) {
  const draw = unitSlotDraw(base);
  /*
   * The roster's figures where the server has answered, the local sum until it has.
   *
   * `unitSlotDraw(base)` only knows what the district row carries: officers, the army at home,
   * the bench and the yard. The server's `districtUnitSlots` also counts garrisons on held ground,
   * units and machines on the road and the territory's slot bonus, and it is what the Units page
   * prints and what the training door refuses on. Two screens reading two totals for one budget is
   * the bug (bug pass, 2026-09-15); the fallback exists so the panel never draws a zero while the
   * roster is still loading.
   */
  const roster = useUnits();
  const total = roster.data?.unitSlotsUsed ?? draw.total;
  const capacity = roster.data?.unitSlotsCap ?? unitSlotCapacity(base.buildings);
  const filled = capacity <= 0 ? 1 : Math.min(1, total / capacity);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
          Housed
        </span>
        <span
          data-testid="housing-balance"
          className={cn(
            'font-display text-sm font-semibold tabular-nums',
            filled >= 1 ? 'text-oxblood-300' : 'text-brass-300',
          )}
        >
          {total} / {capacity}
        </span>
      </div>
      <span className="block h-1.5 w-full bg-surface-700">
        <span
          className={cn('block h-full', filled >= 1 ? 'bg-oxblood-300' : 'bg-brass-300')}
          style={{ width: `${filled * 100}%` }}
        />
      </span>
      <p className="font-body text-xs leading-relaxed text-ink-300">
        {filled >= 1
          ? 'Every unit slot is taken. Raise the Quarters before you order anybody else.'
          : `${capacity - total} unit slots spare. The army is ${draw.army} of what is taken.`}
      </p>
    </div>
  );
}

/** Net hourly output and modifications already folded in by the shared function. */
function ProductionRows({ base }: { base: Base }) {
  const { perHour } = districtProduction(base.buildings);
  const producing = RESOURCE_KEYS.filter((key) => (perHour[key] ?? 0) !== 0);

  if (producing.length === 0) {
    return (
      <p className="p-4 font-body text-xs leading-relaxed text-ink-300">
        Nothing is being made yet. The Greenhouse grows supplies and timber, the Scrapyard strips
        salvage into scrap and good metal, and the Generator refines oil.
      </p>
    );
  }

  return (
    <dl className="flex flex-col divide-y divide-surface-700" data-testid="production">
      {producing.map((key) => (
        <StatRow
          key={key}
          label={RESOURCE_META[key].label}
          value={formatRate(perHour[key] ?? 0)}
          tone={(perHour[key] ?? 0) < 0 ? 'bad' : 'good'}
        />
      ))}
    </dl>
  );
}

/**
 * The wage book (GDD §H7): how much of the crew's standing capacity is spoken for.
 *
 * No date on it, because nothing leaves on one. The book is a ceiling checked when somebody signs,
 * not a bill that comes due.
 */
function PayrollRows({ base }: { base: Base }) {
  const officers = base.commanders.length;
  const ledger = payrollLedger(
    base.economy.payroll,
    buildingLevel(base.buildings, 'nexus'),
    payrollBonusPercent(base.buildings),
  );

  return (
    <dl className="flex flex-col divide-y divide-surface-700">
      <StatRow label="Officers on the books" value={String(officers)} />
      {/* Grouped, like every other cap figure. The book runs past a thousand as soon as a crew
          buys a handful of steps (`PAYROLL_STEP`), and `1150 / 1450 caps` is the one row on this
          panel a player is doing arithmetic on. */}
      <StatRow
        label="Payroll committed"
        value={`${committedPayroll(base.economy.payroll.commitments).toLocaleString()} / ${ledger.capacity.toLocaleString()} caps`}
      />
      <StatRow label="Payroll left" value={`${ledger.available.toLocaleString()} caps`} />
    </dl>
  );
}

/**
 * Player progression (GDD §I). The bar is XP banked towards the next level: `base.progression`
 * holds progress only, never a second copy of the level. The three rows under it are the §I2
 * grants (§G8 pool, §G3 per-officer cap, §H8 recruit slots), read straight off the shared formula
 * so the screen cannot drift from what the server grants.
 */
function ProgressionRows({ base }: { base: Base }) {
  const needed = playerXpToNextLevel(base.level);
  const banked = base.progression.xpIntoLevel;
  const pct = Math.max(0, Math.min(100, (banked / needed) * 100));
  const grants = playerLevelGrants(base.level);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
            Level {base.level} → {base.level + 1}
          </span>
          <span className="font-display text-sm font-semibold tabular-nums text-brass-300">
            {banked} / {needed} XP
          </span>
        </div>
        <span className="block h-1.5 w-full bg-surface-700">
          <span className="block h-full bg-brass-300" style={{ width: `${pct}%` }} />
        </span>
      </div>
      <dl className="flex flex-col divide-y divide-surface-700 border-t border-surface-700">
        <StatRow label="Recruit slots" value={String(grants.recruitSlots)} />
      </dl>
    </div>
  );
}

function StatRow({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'good' | 'bad';
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">{label}</dt>
      <dd
        className={cn(
          'font-display text-sm font-semibold tabular-nums',
          tone === 'good' && 'text-brass-300',
          tone === 'bad' && 'text-oxblood-300',
          tone === 'plain' && 'text-ink-100',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Everything written *about* the district, folded away until it is asked for.
 *
 * The district page used to be a three-thousand-pixel document with a picture at the top: build
 * queue, housing, production, stockpile, standing, payroll, progression. All of it is worth reading and
 * none of it is worth losing the place to: a player who opens their district wants to look at it
 * and click a building, and scrolling the town off the top of the screen to reach a payroll table
 * is what makes a game read as a spreadsheet.
 *
 * ## Why a window and not a drawer
 *
 * It used to slide up from the bottom edge and stop at 62% of the viewport, which put its own
 * scrollbar inside a panel that was itself pinned to a moving bar, over a picture that had just
 * been resized around it. Three overlapping scroll boxes, and on a short frame the top of the first
 * panel was already under the stockpile: the thing being read was cut before it was opened.
 *
 * A centred window has none of that. It is the same dialog every other report in the game uses, it
 * closes the way it opened, on the button, on the backdrop and on Escape, and the district is
 * visible around it rather than squeezed above it.
 */
function ReportsDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Only while it is shut. Open, the window is over it and the same control is in the window's
          own header: a button behind a backdrop is a button that says "Close reports" and does
          nothing when you press it. */}
      {!open && (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4"
          style={{ bottom: 'calc(var(--nav-h, 88px) + 10px)' }}
        >
          <Button
            variant="primary"
            size="sm"
            className="pointer-events-auto"
            aria-expanded={false}
            aria-controls="district-reports"
            onClick={() => setOpen(true)}
            data-testid="reports-toggle"
          >
            Reports
          </Button>
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy="district-reports-title" size="full">
          <header className="flex items-center justify-between gap-3 border-b border-brass-500/30 px-5 py-3">
            <h2
              id="district-reports-title"
              className="font-display text-lg font-bold tracking-[0.08em] text-brass-300"
            >
              The district, in numbers
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              data-testid="reports-close"
            >
              Close reports
            </Button>
          </header>
          <div
            id="district-reports"
            data-testid="district-reports"
            className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
          >
            <div className="flex flex-col gap-5">{children}</div>
          </div>
        </Modal>
      )}
    </>
  );
}
