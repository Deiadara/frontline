import {
  ITEM_RARITY_LABELS,
  OFFICER_ROLE_LABELS,
  REIMAGINING_PAGES_SPENT,
  REIMAGINING_REFUSAL_MESSAGES,
  REIMAGINING_RESEARCH_ID,
  blueprintOfPage,
  findBlueprintPage,
  findResearchItem,
  heldPages,
  pageRarity,
  reimaginingAvailable,
  reimaginingRefusal,
  sparePages,
  type Inventory,
  type ReimaginingContext,
  type ReimaginingRefusal,
} from '@frontline/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { buttonSkin } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { cn } from '../../lib/cn';
import { RARITY_TEXT } from '../../lib/rarity';
import { useMarket, useReimagine } from '../../lib/queries';
import { PageGlyph } from './BlueprintGlyph';

/**
 * The Reimagining tab (§G2, §G3): three pages into the machine, one you have never seen out.
 *
 * The trade was a button on the Blueprints panel until the maintainer's 2026-09-10 call, and a button
 * is the wrong shape for it. What the Lab does here is take three specific sheets off a player, so
 * the screen has to be the place they *choose* the three: a tray of what is in the inventory, three
 * sockets to drop them in, and a fourth socket where the new page lands. Which pages go is the
 * player's now (`ReimagineRequestSchema`); which one comes back is still the Lab's, seeded on the
 * server so a dropped connection cannot be retried into a better answer.
 *
 * ## The bench is drawn, not implied
 *
 * The first build of this screen was three dark boxes joined by two hairlines, and the board sent
 * it back: a machine that eats a player's collection has to look like a machine. So the left panel
 * is a bolted plate carrying a real apparatus, and every part of it is doing a job a label would
 * otherwise have to do. An empty well shows the outline of the sheet that belongs in it. Pipes run
 * from each socket to a gear train and out to the outfeed, so where a page goes is drawn rather
 * than explained. The gauges, the flow in the pipes and the gear rates are the state of the bench
 * said three more times, which is what stops a player pressing a dead lever and wondering.
 *
 * The whole apparatus is one drawing on a 620 by 300 grid, scaled by `--sock` (see the research
 * section at the foot of `index.css`): the sockets are HTML because they are buttons carrying page
 * glyphs, the linkage is one SVG on the same grid, and the two line up because both are placed in
 * percentages of the same box. Moving a fitting means moving its percentage *and* its pipe.
 *
 * Everything that moves is off under `prefers-reduced-motion`: the sheets do not travel, the gears
 * and the flow hold still, and the states change on the same presses at the same moments.
 */
export function ReimaginingSection() {
  const query = useMarket();
  const data = query.data;
  if (!data) {
    return (
      <ScreenLoad
        what="The bench"
        loading="Warming the bench up…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
        detail="Nothing has been lost. The pages are where you left them."
      />
    );
  }
  return <Bench inventory={data.inventory} context={data.reimagining} />;
}

/** How long the sheets take to travel, and the gears to spin, before the new page lands. */
const SPIN_MS = 620;

type Phase = 'idle' | 'running' | 'done';

/** One class per socket, because the three of them leave the plate in three directions. */
const DRAWN_IN = ['lab-drawn-0', 'lab-drawn-1', 'lab-drawn-2'] as const;

function Bench({ inventory, context }: { inventory: Inventory; context: ReimaginingContext }) {
  const trade = useReimagine();
  const reduced = usePrefersReducedMotion();
  const [slots, setSlots] = useState<readonly (string | null)[]>([null, null, null]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [gained, setGained] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (!reimaginingAvailable(context)) return <LockedBench context={context} />;

  const chosen = slots.filter((pageId): pageId is string => pageId !== null);
  const ready = chosen.length === REIMAGINING_PAGES_SPENT;
  const refusal = reimaginingRefusal({ inventory, context, pages: chosen, seed: '' });
  /** The refusal worth printing: everything except the one the three empty sockets already say. */
  const said = refusal === 'wrong_page_count' ? null : refusal;
  const running = phase === 'running';

  const put = (pageId: string) => {
    const empty = slots.indexOf(null);
    if (empty === -1 || running) return;
    setSlots(slots.map((held, index) => (index === empty ? pageId : held)));
  };
  const clear = (index: number) => {
    if (running) return;
    setSlots(slots.map((held, at) => (at === index ? null : held)));
  };

  /*
   * The press, and why it waits.
   *
   * The animation is the feedback: sheets along the pipes, gears round, a flash, a page in the
   * outfeed. Against a fast server the mutation lands in under a frame, so tying the result to the
   * response alone would swap the sockets out with no travel at all and the whole thing would read
   * as a jump. Waiting for the slower of the two keeps the sequence intact without ever making a
   * player wait on an animation that has already finished. Reduced motion waits for neither.
   */
  const run = async () => {
    if (!ready || running) return;
    const [first, second, third] = chosen;
    if (first === undefined || second === undefined || third === undefined) return;
    setPhase('running');
    setGained(null);
    const spun = new Promise<void>((resolve) => {
      window.setTimeout(resolve, reduced ? 0 : SPIN_MS);
    });
    try {
      const [answer] = await Promise.all([
        trade.mutateAsync({ pages: [first, second, third] }),
        spun,
      ]);
      if (!alive.current) return;
      setGained(answer.gained);
      setSlots([null, null, null]);
      setPhase('done');
    } catch {
      // The message is rendered off `trade.error` rather than caught into state of its own.
      if (alive.current) setPhase('idle');
    }
  };

  const held = heldPages(inventory);
  const total = held.reduce((sum, entry) => sum + entry.held, 0);
  const spare = sparePages(inventory).reduce((sum, entry) => sum + entry.spare, 0);

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:h-full" data-testid="reimagining-section">
      <p className="max-w-prose font-body text-[14px] leading-relaxed text-ink-200">
        If you look at {REIMAGINING_PAGES_SPENT} random pages hard enough, you are guaranteed to
        come up with some new research. That&rsquo;s how it usually works anyway.
      </p>

      {/*
       * The bench on the left, the inventory on the right, once there is width for both.
       *
       * Stacked, the machine is most of the frame and the tray starts under the fold at 1280x720:
       * a player would be choosing pages they had to scroll away from the sockets to see. Side by
       * side, the whole transaction is one screen at every width the game supports, and under
       * 1024 the column order is the order of the sentence: this is the machine, these are the
       * pages that go in it.
       */}
      <div className="grid items-start gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[56%_minmax(0,1fr)] lg:items-stretch">
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          <div
            className={cn(
              // `rivets` and `brushed` are the game's own bolted-plate pair, so the bench is made
              // of the same tin every panel in the district is.
              'lab-bench lab-plate rivets brushed relative flex min-h-0 flex-1 items-center justify-center',
              'overflow-hidden rounded-sm border border-surface-600/60 p-3',
            )}
            data-testid="reimagine-machine"
            data-lit={ready ? 'yes' : 'no'}
            data-phase={phase}
          >
            <div className="lab-apparatus">
              <Linkage />
              <Slot index={0} pageId={slots[0] ?? null} running={running} onClear={clear} />
              <Slot index={1} pageId={slots[1] ?? null} running={running} onClear={clear} />
              <Slot index={2} pageId={slots[2] ?? null} running={running} onClear={clear} />
              <ResultSocket pageId={gained} flashing={phase === 'done'} />
              <button
                type="button"
                data-testid="reimagine"
                data-sound="confirm"
                disabled={refusal !== null || running}
                onClick={() => void run()}
                className="lab-lever lab-slot-lever font-display font-bold uppercase"
              >
                {running ? 'Running' : 'Reimagine'}
              </button>
            </div>
          </div>

          {/* Left out entirely when there is nothing to say, rather than rendered empty: an empty
              row still takes the column's gap, and that gap is what pushes the tray's first line
              off a short frame. */}
          {(said !== null || gained !== null || trade.error !== null) && (
            <div className="flex flex-wrap items-center gap-3">
              {/* The count refusal is left unsaid: three empty sockets are already the sentence,
                  and a line reading "the machine takes three pages" under a machine with three
                  holes in it is the screen explaining its own drawing. Every other refusal is a
                  fact about the crew. */}
              {said !== null && (
                <p
                  className="font-body text-[13px] leading-snug text-ink-300"
                  data-testid="reimagine-refusal"
                >
                  {REIMAGINING_REFUSAL_MESSAGES[said]}
                </p>
              )}
              {gained !== null && (
                <p
                  className="font-body text-[13px] leading-snug text-bile-300"
                  data-testid="reimagine-report"
                  role="status"
                >
                  {nameOf(gained)} came out of the bench.
                </p>
              )}
              {/* A refusal from the server, which is a different thing from the one above: this
                  crew passed the check the page could make and something changed underneath it.
                  Unseating the Head of Research in another tab is the ordinary way to get here. */}
              {trade.error !== null && (
                <p role="alert" className="font-body text-[13px] text-oxblood-300">
                  {REIMAGINING_REFUSAL_MESSAGES[trade.error.message as ReimaginingRefusal] ??
                    trade.error.message}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 lg:overflow-y-auto">
          <Tray held={held} slots={slots} total={total} spare={spare} full={ready} onPut={put} />
        </div>
      </div>
    </div>
  );
}

/**
 * Where the rung that opens this bench is, which today is the Fabricator's track and not the Head
 * of Research's.
 *
 * Read off the catalogue rather than written down, because `tracks.ts` says in as many words that
 * it keeps the right to move the item. A hard-coded `head_of_research` here would keep sending
 * players to an empty rail the day it did, and nothing would fail until somebody looked.
 */
const REIMAGINING_TRACK = findResearchItem(REIMAGINING_RESEARCH_ID)?.track ?? null;

/** What a shut bench asks the player to go and do, and where that is. */
function nextDoor(hasHeadOfResearch: boolean): { to: string; label: string } | null {
  // The chair first, always. Without somebody in the Head of Research post every rung on every
  // trade is shut (§C1c), so a crew missing both cannot start the research either: sending them at
  // the rung would be sending them at a button that refuses. One door, and it is the next thing.
  if (!hasHeadOfResearch) {
    return { to: '/game/bar', label: `Hire a ${OFFICER_ROLE_LABELS.head_of_research} at the Bar` };
  }
  if (REIMAGINING_TRACK === null) return null;
  return {
    to: `/game/research?track=${REIMAGINING_TRACK}`,
    label: `Research it on the ${OFFICER_ROLE_LABELS[REIMAGINING_TRACK]}'s track`,
  };
}

/**
 * §G4 shut: the lock, one sentence saying what is missing, and the door out of it.
 *
 * The sentence on its own was a dead end. A player who reads that nobody is in the Head of Research
 * chair still has to know that chairs are filled at the Bar, and a player who reads that the Lab has
 * not worked Reimagining out has to know which of nineteen trades the rung is on. Both are one press
 * now, and the second one opens the rail on the right trade rather than on the first one.
 */
function LockedBench({ context }: { context: ReimaginingContext }) {
  const { hasHeadOfResearch, hasReimaginingResearch } = context;
  const sentence =
    !hasHeadOfResearch && !hasReimaginingResearch
      ? 'The Lab has not worked Reimagining out yet, and there is nobody in the Head of Research chair to run it.'
      : !hasHeadOfResearch
        ? 'Nobody is sitting in the Head of Research chair, and the bench does not run without one.'
        : 'The Lab has not worked Reimagining out yet.';
  const door = nextDoor(hasHeadOfResearch);
  return (
    <div
      className="lab-bench rivets brushed relative flex flex-col items-center justify-center gap-5 rounded-sm border border-surface-600/60 py-20"
      data-testid="reimagining-locked"
    >
      <span className="lab-socket flex h-28 w-28 items-center justify-center text-ink-300">
        <Icon name="lock" label="Locked" className="h-12 w-12" />
      </span>
      <p className="max-w-prose text-center font-body text-[14px] leading-relaxed text-ink-300">
        {sentence}
      </p>
      {door !== null && (
        <Link
          to={door.to}
          data-testid="reimagining-door"
          data-sound="click"
          className={buttonSkin({ variant: 'primary', size: 'sm' })}
        >
          {door.label}
        </Link>
      )}
    </div>
  );
}

/** Which fitting sits where on the 620 by 300 grid. Matched by the pipe ends in {@link Linkage}. */
const SLOT_PLACE = ['lab-slot-apex', 'lab-slot-left', 'lab-slot-right'] as const;

/** One socket in the triangle. Filled it holds the sheet; pressed it hands the sheet back. */
function Slot({
  index,
  pageId,
  running,
  onClear,
}: {
  index: number;
  pageId: string | null;
  running: boolean;
  onClear: (index: number) => void;
}) {
  const filled = pageId !== null;
  return (
    <button
      type="button"
      disabled={!filled || running}
      onClick={() => onClear(index)}
      data-testid={`reimagine-slot-${index}`}
      data-filled={filled ? 'yes' : 'no'}
      aria-label={
        filled ? `Take ${nameOf(pageId)} back out of the machine` : `Socket ${index + 1}, empty`
      }
      className={cn('lab-socket lab-slot', SLOT_PLACE[index])}
    >
      {/* Absolute and filling the well, so the travel percentages are percentages of the socket
          rather than of whatever width the page's name happened to give this span. */}
      <span
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center gap-1 px-1',
          running && DRAWN_IN[index],
        )}
        data-testid={`reimagine-slot-sheet-${index}`}
      >
        {filled ? <PageFace pageId={pageId} where="socket" /> : <EmptyWell />}
      </span>
    </button>
  );
}

/** What an empty well shows: the sheet that belongs in it, printed on the plate. */
function EmptyWell() {
  return (
    <>
      <svg
        aria-hidden
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="lab-page-glyph lab-socket-empty shrink-0 opacity-50"
      >
        <path d="M13 42.5V5.5h19L38 11.5V42.5z" strokeWidth="1.8" strokeDasharray="5 4" />
        <path d="M32 5.5v6h6" strokeWidth="1.4" />
        <path d="M18 21h12M18 27h12M18 33h7" strokeWidth="1.4" opacity="0.55" />
      </svg>
      <span className="lab-socket-empty font-display uppercase tracking-[0.16em]">Empty</span>
    </>
  );
}

/** Where the new page lands, at the end of the main feed. */
function ResultSocket({ pageId, flashing }: { pageId: string | null; flashing: boolean }) {
  return (
    <div
      data-testid="reimagine-result"
      data-filled={pageId === null ? 'no' : 'yes'}
      data-page={pageId ?? ''}
      className="lab-socket lab-socket-out lab-slot lab-slot-out"
    >
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1">
        {pageId === null ? (
          <span className="lab-socket-empty font-display uppercase tracking-[0.18em]">Out</span>
        ) : (
          // Keyed on the page so a second trade runs the flash again rather than sitting on the
          // frame the first one ended at.
          <span
            key={pageId}
            className={cn('flex flex-col items-center gap-1', flashing && 'lab-flash')}
          >
            <PageFace pageId={pageId} where="out" />
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * One gear, as a real toothed wheel.
 *
 * Drawn rather than iconified: at 84px across, a circle with eight spikes on it reads as a
 * cartoon, and the trapezoidal tooth with a flat tip is what makes a wheel look cut rather than
 * drawn. Straight segments, because a 2px stroke at this size hides the difference between a
 * flank and an involute and nothing here is being machined.
 */
function gearPath(radius: number, teeth: number, depth: number): string {
  const step = (Math.PI * 2) / teeth;
  const at = (angle: number, r: number) =>
    `${(Math.cos(angle) * r).toFixed(2)} ${(Math.sin(angle) * r).toFixed(2)}`;
  const parts: string[] = [];
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const start = tooth * step;
    parts.push(
      `${tooth === 0 ? 'M' : 'L'}${at(start, radius)}`,
      `L${at(start + step * 0.16, radius + depth)}`,
      `L${at(start + step * 0.34, radius + depth)}`,
      `L${at(start + step * 0.5, radius)}`,
    );
  }
  return `${parts.join('')}Z`;
}

interface GearSpec {
  cx: number;
  cy: number;
  r: number;
  teeth: number;
  /** Which of the four rates and directions this wheel runs at. */
  rate: 'a' | 'b' | 'c' | 'd';
}

/** Four wheels, each seated on the last one's pitch circle so the train reads as meshed. */
const GEARS: readonly GearSpec[] = [
  { cx: 420, cy: 150, r: 42, teeth: 18, rate: 'a' },
  { cx: 458, cy: 96, r: 24, teeth: 12, rate: 'b' },
  { cx: 472, cy: 187, r: 22, teeth: 11, rate: 'c' },
  { cx: 400, cy: 94, r: 18, teeth: 9, rate: 'd' },
];

function Gear({ cx, cy, r, teeth, rate }: GearSpec): JSX.Element {
  const hub = Math.max(6, r * 0.28);
  const spoke = r - hub - 4;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      {/* The rotation is on a nested group: a CSS `transform` replaces the attribute one, so a
          wheel that carried both its position and its spin would fly to the origin the moment the
          animation started. */}
      <g className={`lab-gear lab-gear-${rate}`}>
        <path
          d={gearPath(r, teeth, r * 0.17)}
          fill="currentColor"
          fillOpacity="0.16"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle r={hub} fill="#141019" stroke="currentColor" strokeWidth="2.2" />
        <circle r={hub * 0.36} fill="currentColor" fillOpacity="0.6" />
        <path
          d={`M0 ${-hub - 2}V${-hub - 2 - spoke}M0 ${hub + 2}V${hub + 2 + spoke}M${-hub - 2} 0H${-hub - 2 - spoke}M${hub + 2} 0H${hub + 2 + spoke}`}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeOpacity="0.7"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

/** A pressure dial on a stub off the pipework, with a needle that swings when the bench charges. */
function Gauge({
  cx,
  cy,
  r,
  stub,
  needle,
}: {
  cx: number;
  cy: number;
  r: number;
  stub: string;
  needle?: string;
}) {
  return (
    <>
      <path d={stub} stroke="#12100c" strokeWidth="11" strokeLinecap="round" />
      <path d={stub} stroke="#6b4f24" strokeWidth="7" strokeLinecap="round" />
      <g transform={`translate(${cx} ${cy})`}>
        <circle r={r} fill="#0c0e15" stroke="#8a6a2f" strokeWidth="3.2" />
        <circle r={r - 4} fill="none" stroke="#e8cf9e" strokeOpacity="0.18" strokeWidth="1" />
        <path
          d={`M${-r * 0.62} ${-r * 0.42}l${r * 0.14} ${r * 0.1}M0 ${-r * 0.74}v${r * 0.16}M${r * 0.62} ${-r * 0.42}l${-r * 0.14} ${r * 0.1}`}
          stroke="#e8cf9e"
          strokeOpacity="0.45"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <g className={cn('lab-needle', needle)}>
          <path d={`M0 0V${-r * 0.68}`} stroke="#f0ad4c" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <circle r="2.4" fill="#f0ad4c" />
      </g>
    </>
  );
}

/**
 * The pipework, the gauges and the gear train, on the apparatus' own 620 by 300 grid.
 *
 * Every run is drawn three times over the same path: a near-black outline that reads as the shadow
 * under the pipe, the brass unit, and a thin highlight offset up and left, which is the whole of
 * why a flat stroke reads as a round pipe lit from above. The flow is a fourth pass, dashed, and
 * it only appears once all three sockets are full.
 */
const PIPES = 'M220 60H350 M320 200H350 M60 260V282H350 M350 60V282 M350 150H378 M462 150H500';

/** Where a run meets a fitting or turns a corner. A pipe with no flanges is a drawn line. */
const FLANGES: readonly [number, number][] = [
  [220, 60],
  [350, 60],
  [320, 200],
  [350, 200],
  [60, 260],
  [60, 282],
  [350, 282],
  [350, 150],
  [462, 150],
  [500, 150],
];

function Linkage() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 620 300"
      fill="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <path
        d={PIPES}
        stroke="#12100c"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={PIPES}
        stroke="#6b4f24"
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={PIPES}
        stroke="#f2dcb2"
        strokeOpacity="0.4"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(-1 -4.5)"
      />
      <path
        d={PIPES}
        className="lab-flow"
        stroke="#ffd98a"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {FLANGES.map(([cx, cy]) => (
        <g key={`${cx}-${cy}`} transform={`translate(${cx} ${cy})`}>
          <circle r="10.5" fill="#1a150f" stroke="#8a6a2f" strokeWidth="2.6" />
          <circle r="4" fill="#0d0b08" stroke="#e8cf9e" strokeOpacity="0.22" strokeWidth="1" />
        </g>
      ))}

      <Gauge cx={285} cy={22} r={18} stub="M285 60V34" />
      <Gauge cx={170} cy={244} r={16} stub="M170 282V254" needle="lab-needle-b" />

      {/* The train. Its ink is the state of the bench (`.lab-gears`): dull iron until all three
          are in, brass once the machine will run. */}
      <g data-testid="reimagine-gears" className="lab-gears">
        {GEARS.map((gear) => (
          <Gear key={gear.rate} {...gear} />
        ))}
      </g>
    </svg>
  );
}

/**
 * What is in the inventory, one tile per page.
 *
 * The count on a tile is what is **left** to put in rather than what is held, so a player who has
 * put two of their three Slab Armours in the machine can see they have one more. A tile with
 * nothing left goes dark rather than disappearing: a page vanishing off the tray while somebody is
 * looking at it reads as a bug, and the tile comes back the moment a socket is emptied.
 */
function Tray({
  held,
  slots,
  total,
  spare,
  full,
  onPut,
}: {
  held: ReturnType<typeof heldPages>;
  slots: readonly (string | null)[];
  total: number;
  spare: number;
  full: boolean;
  onPut: (pageId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-stamp text-[15px] leading-tight text-ink-100">
          Pages in the inventory
        </h3>
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          {total === 0
            ? 'Nothing to feed it'
            : `${total} ${total === 1 ? 'page' : 'pages'}, ${spare} spare`}
        </span>
      </div>
      {held.length === 0 ? (
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          The bench eats pages and you are carrying none. Missions bring them back, the Black Market
          sells them for infamy, and the Runner turns up with one now and again.
        </p>
      ) : (
        <ul
          className="drafting-grid flex flex-wrap gap-1.5 rounded-sm border border-surface-600/60 p-3"
          data-testid="reimagine-tray"
        >
          {held.map((entry) => {
            const inMachine = slots.filter((pageId) => pageId === entry.page.id).length;
            const left = entry.held - inMachine;
            return (
              <li key={entry.page.id}>
                <button
                  type="button"
                  disabled={left === 0 || full}
                  onClick={() => onPut(entry.page.id)}
                  data-testid={`tray-${entry.page.id}`}
                  data-left={left}
                  aria-label={`Put ${entry.page.name} in the machine`}
                  className={cn(
                    'relative flex h-full w-[5.5rem] flex-col items-center gap-1 rounded-[2px] border p-1 transition-colors',
                    left === 0
                      ? 'border-surface-700 bg-surface-950/50 opacity-40'
                      : 'border-surface-600 bg-surface-800/70 hover:border-brass-300/70',
                  )}
                >
                  <PageFace pageId={entry.page.id} where="tray" />
                  {entry.held > 1 && (
                    <span
                      aria-hidden
                      className="absolute right-0.5 top-0.5 rounded-[2px] bg-surface-950/80 px-1 font-display text-[10px] font-bold leading-tight tabular-nums"
                    >
                      x{left}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The sheet and its name, which is what a page looks like everywhere on this screen.
 *
 * The tray's tiles are a fixed 88px and set their own type; the ones in the wells scale with
 * `--sock`, so they take their size from the stylesheet rather than from a utility class. The
 * outfeed adds the rarity word: that page is the one thing on the screen a player has not seen
 * before, and what it is worth is the first thing they will want to know.
 */
function PageFace({ pageId, where }: { pageId: string; where: 'tray' | 'socket' | 'out' }) {
  const blueprint = blueprintOfPage(pageId);
  const page = findBlueprintPage(pageId);
  if (!blueprint || !page) return null;
  const rarity = pageRarity(blueprint, page);
  return (
    <>
      <PageGlyph
        page={page}
        blueprint={blueprint}
        size="md"
        className={cn(
          'shrink-0',
          where === 'tray'
            ? 'h-10 w-10'
            : where === 'out'
              ? 'lab-page-glyph-out'
              : 'lab-page-glyph',
        )}
      />
      <span
        className={cn(
          'w-full break-words text-center font-display leading-[1.15] text-ink-100',
          where === 'tray' && 'text-[10px]',
        )}
      >
        {page.name}
      </span>
      {where === 'out' && (
        <span
          className={cn(
            'font-display uppercase leading-none tracking-[0.14em]',
            'text-[0.82em]',
            RARITY_TEXT[rarity],
          )}
        >
          {ITEM_RARITY_LABELS[rarity]}
        </span>
      )}
    </>
  );
}

/** A page id in the words a player reads, for the labels and the report line. */
function nameOf(pageId: string): string {
  return findBlueprintPage(pageId)?.name ?? pageId;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Whether this player has asked the machine to hold still.
 *
 * Read in TypeScript rather than left to the media query in `index.css`, because the timing is the
 * other half of it: with the animation off, waiting {@link SPIN_MS} for it would just be a delay
 * before the answer with nothing happening on screen.
 */
function usePrefersReducedMotion(): boolean {
  const query = useCallback(
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null),
    [],
  );
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const list = query();
    if (!list) return;
    const onChange = () => setReduced(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return reduced;
}
