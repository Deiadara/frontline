import {
  BUILDING_CATALOG,
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  ITEM_CATALOG,
  MAX_MODIFICATION_SLOTS,
  MODIFICATIONS,
  MODIFICATION_RARITIES,
  MODIFICATION_RARITY_LABELS,
  TRAP_CATALOG,
  UNIT_MODIFICATIONS,
  UNIT_MODIFICATION_RARITY_BLURBS,
  UNIT_STAT_LABELS,
  addonsOf,
  findBuilding,
  findModification,
  findUnitModification,
  modificationSlots,
  MAX_SCRAPYARD_DISCOUNT,
  SCRAPYARD_DISCOUNT_PER_LEVEL,
  SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION,
  SCRAPYARD_LEVEL_FOR_BASIC,
  SCRAPYARD_LEVEL_FOR_RARITY,
  nextScrapyardUnlock,
  scrapyardUnlockLadder,
  shelvedModifications,
  type Base,
  type BuildingKind,
  type ItemId,
  type ModificationRarity,
  type Resources,
  type ScrapyardEntry,
  type ScrapyardResponse,
} from '@frontline/shared';
import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBuildAddon, useMe, useScrapyard } from '../../lib/queries';
import { InfoNote, PageShell, ScreenLoadSheet } from '../game/PageShell';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { PartsBench } from './PartsBench';
import { BENCH_BOARD, BENCH_TRAY, SLOT_WELL } from './template';
import { ItemWindow } from '../market/MarketPage';
import { RARITY_TEXT, RarityTag } from './rarity';
import { YardGlyph, YardPlate, type YardMark } from './YardGlyph';

/**
 * The Scrapyard (§B9, §E1 to §E4, §I3b; reworked at the maintainer's request, 2026-09-10).
 *
 * The one shop for everything bolted onto something the crew already owns. It used to be two
 * screens: a Workshop page that sold the nine refits and listed every structure's brackets, and
 * this page, which sold the same refits at a different price beside the modifications and the
 * traps. Two doors to one purchase is a bug wearing a floor plan, so the Workshop is gone and its
 * two jobs are here.
 *
 * ## Three benches, one strip of tabs
 *
 * **Building Modifications** is the structure half: a rail of the eleven structures on the left,
 * and the one chosen open on the right with its brackets (fitted, empty, or waiting on a level),
 * its shelf, and the seven things the yard can cut for it. **Unit Modifications** is the roster
 * half: thirty cards with no ladder between them. **Traps** is the consumable half: cut for one
 * night, set under one fight.
 *
 * ## Four grades, four colours
 *
 * Both catalogues of cards are grouped by rarity (maintainer request, 2026-09-15): BASIC, INTRICATE,
 * ADVANCED, MASTERPIECE, each group under its label, and the grade carried as a colour on the card
 * (`rarity.tsx`). The four refit ladders this replaced were a shape for a decision the game no
 * longer asks; a card has no rung above or below it, so the only order worth drawing is how much
 * engineering went into it, which is also the order the yard's level opens them in.
 *
 * ## What the yard's own level buys
 *
 * The info box beside the tabs says it: what the level takes off every bill, and what the next
 * level worth reaching opens. Both come off `building/scrapyard.ts`, which is also what the server
 * prices and gates with, so the box and the bill cannot disagree.
 *
 * Nothing on this screen derives a rule. Every entry arrives with its `blocker` already worded by
 * the server, out of the yard's level, the documents in the inventory and the Lab's finished rungs.
 * The **Ready to build** filter is the direct answer to §E3: it leaves exactly the entries the crew
 * could cut this evening.
 */

/*
 * The labels say what the bench bolts things onto (maintainer request, 2026-09-15).
 *
 * "Modifications" and "Refits" were two words for the same verb, and nothing in either said which
 * half of the game it touched. The ids are untouched: `?view=` links, the `scrapyard-view-*`
 * testids and the `?bench=refits` deep link all hang off them.
 */
const VIEWS = [
  { id: 'modifications', label: 'Building Modifications', icon: 'build' },
  { id: 'refits', label: 'Unit Modifications', icon: 'units' },
  { id: 'traps', label: 'Traps', icon: 'shield' },
  // The parts bin, which came off the retired Inventory page. Last, because it is the only tab with
  // nothing to press: the three before it build things, this one says what there is to build with.
  { id: 'components', label: 'Components', icon: 'inventory' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];
type ViewId = (typeof VIEWS)[number]['id'];

/**
 * The benches that build something, which is every one except the parts bin.
 *
 * `readyOnly` filters entries, and the bin has none: a filter over a list it cannot touch is a
 * control that lies about having worked.
 */
const BUILDS: ReadonlySet<string> = new Set(['modifications', 'refits', 'traps']);

const isView = (value: string | null): value is ViewId => VIEWS.some((view) => view.id === value);
const isBuildingKind = (value: string | null): value is BuildingKind =>
  (BUILDING_KINDS as readonly string[]).includes(value ?? '');

/**
 * The glyph on each structure's door: what the structure is *for*, not what it looks like.
 *
 * The district's `StructureSprite` was measured and rejected for this: drawn in dark ferrite for a
 * plot two hundred pixels wide, eleven of them collapsed to the same smudge in a 36px rail tile.
 */
const BENCH_ICON: Readonly<Record<BuildingKind, IconName>> = {
  nexus: 'district',
  quarters: 'unit-slots',
  greenhouse: 'supplies',
  generator: 'power',
  scrapyard: 'scrap',
  apothecary: 'flask',
  gate: 'shield',
  lab: 'research',
  gauntlet: 'training',
  infirmary: 'physical',
  garage: 'build',
};

/** The ladder is a property of the catalogues, not of this crew: computed once. */
const LADDER = scrapyardUnlockLadder({
  modifications: MODIFICATIONS,
  upgrades: UNIT_MODIFICATIONS,
  traps: TRAP_CATALOG,
});

/**
 * The grade of a card, or null for a trap, which has none.
 *
 * A unit card's rarity is on the wire. A building card's is not (`rarity` is null on a
 * `modification` row), so it is read off the catalogue by id, the same way the card's mark is.
 */
function rarityOf(entry: ScrapyardEntry): ModificationRarity | null {
  if (entry.kind === 'trap') return null;
  if (entry.kind === 'upgrade')
    return entry.rarity ?? findUnitModification(entry.id)?.rarity ?? null;
  return findModification(entry.id)?.rarity ?? null;
}

/** Which mark an entry wears, read off the catalogue it came from. */
function markOf(entry: ScrapyardEntry): YardMark {
  if (entry.kind === 'trap') return { kind: 'trap', id: entry.id };
  if (entry.kind === 'upgrade') return { kind: 'rarity', rarity: rarityOf(entry) ?? 'basic' };
  return { kind: 'effect', effect: findModification(entry.id)?.effect ?? 'production_percent' };
}

/**
 * Whether the yard would cut this one now.
 *
 * The server leaves `blocker` null on a unit card the crew has already built (there is nothing
 * left to refuse), but a card is built once, so it is not something the yard can cut again: it is neither
 * "ready" in the count nor kept by the filter. A modification or a trap the crew owns can be cut
 * again, and is.
 */
const buildable = (entry: ScrapyardEntry): boolean =>
  entry.blocker === null && !(entry.kind === 'upgrade' && entry.owned > 0);

const readyIn = (entries: readonly ScrapyardEntry[]): number => entries.filter(buildable).length;

/**
 * Only what the crew holds the drawings for is on the board (maintainer request, 2026-09-11).
 *
 * The same rule the Blueprints page keeps: a document you hold no pages of is not on that screen,
 * and an add-on whose document you have not assembled is not on this one. The rows are still on
 * the wire so a bench can say how many it is keeping back, which is what stops a bench with one
 * plain bolt-on on it from reading as a structure with one modification.
 */
const held = (entries: readonly ScrapyardEntry[]): ScrapyardEntry[] =>
  entries.filter((entry) => entry.documentHeld);
const withheld = (entries: readonly ScrapyardEntry[]): number =>
  entries.filter((entry) => !entry.documentHeld).length;

/** The line under a bench saying what its blueprints are keeping off it. */
function Withheld({ count, bench }: { count: number; bench: string }) {
  if (count === 0) return null;
  return (
    <p
      className="flex items-center gap-1.5 font-body text-[12px] leading-snug text-ink-300"
      data-testid={`scrapyard-hidden-${bench}`}
    >
      <Icon name="lock" className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      {/* One sentence for both counts (maintainer request, 2026-09-15). The number was the whole
          message and it is the half a player can do nothing about; where to go is the other half. */}
      Go out there and find some more blueprints.
    </p>
  );
}

export function ScrapyardPage() {
  const query = useScrapyard();
  const me = useMe();
  const build = useBuildAddon();
  /*
   * Which bench is open lives in the URL, so a door somewhere else can open it.
   *
   * A structure's dialog links here with `?bench=<kind>` and the old Workshop's deep links carried
   * `?bench=refits` and `?bench=traps`; both still land where they say. `replace`, because picking
   * through the benches is browsing rather than navigating.
   */
  const [params, setParams] = useSearchParams();
  const bench = params.get('bench');
  const view: ViewId = isView(params.get('view'))
    ? (params.get('view') as ViewId)
    : bench === 'refits' || bench === 'traps'
      ? bench
      : 'modifications';
  const structure: BuildingKind = isBuildingKind(bench) ? bench : 'nexus';
  /*
   * Both writers keep the other's parameter, which the first version did not.
   *
   * `setParams` replaces the whole query string, so writing `{ view }` dropped `?bench=<kind>`:
   * pick the Gauntlet, look at Refits, come back, and you were on the Nexus. A rail of eleven
   * doors is exactly the place not to lose which one was open.
   */
  const setView = (id: ViewId) =>
    setParams(
      {
        ...(id === 'modifications' ? {} : { view: id }),
        ...(isBuildingKind(bench) ? { bench } : {}),
      },
      { replace: true },
    );
  const setStructure = (kind: BuildingKind) =>
    setParams({ bench: kind, ...(view === 'modifications' ? {} : { view }) }, { replace: true });
  const [readyOnly, setReadyOnly] = useState(false);

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoadSheet
        what="The yard's board"
        loading="Opening the yard…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
        detail="Nothing has been lost. Nothing was charged for."
      />
    );
  }

  if (data.scrapyardLevel <= 0) {
    return (
      <PageShell quote="A version of recycling that actually works.">
        <InfoNote label="No yard yet">
          The Scrapyard has not been built. Lay it on the district and come back: add-ons are cut,
          pressed and welded here and nowhere else.
        </InfoNote>
      </PageShell>
    );
  }

  const entriesOf = (kind: ScrapyardEntry['kind']) =>
    held(data.entries.filter((entry) => entry.kind === kind));
  const keptBack = (kind: ScrapyardEntry['kind']) =>
    withheld(data.entries.filter((entry) => entry.kind === kind));
  const shown = (entries: readonly ScrapyardEntry[]) =>
    readyOnly ? entries.filter(buildable) : entries;
  const ready = readyIn(held(data.entries));
  const base = me.data?.base ?? null;

  const onBuild = (entry: ScrapyardEntry) => build.mutate({ kind: entry.kind, id: entry.id });

  return (
    <PageShell quote="A version of recycling that actually works." wide fills>
      {/*
       * The head of the page: the benches, the filter and the yard's own plate, all on one line.
       * Outside the scroller on purpose, the way the Lab learned the expensive way: a control that
       * scrolls with sixty rows disappears the moment you use the thing it controls.
       *
       * One row, with the two boxes pushed to the right edge (maintainer request, 2026-09-15). It
       * was two rows, and the row this replaces was worth a whole line of vertical space to a
       * screen whose bench is the thing a player is actually reading: the workspace below is
       * `flex-1`, so the line the filter used to occupy goes straight to the benches.
       *
       * It wraps rather than overflows, and that is deliberate. The four tabs are 765px and the two
       * boxes 454px, so at 1024 there is no one-line reading to have and the boxes drop to a line of
       * their own, which is where they used to live anyway. `scrapyard.spec.ts` sweeps the widths.
       */}
      <div className="flex shrink-0 flex-wrap items-center gap-2" data-testid="scrapyard-head">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="The yard">
          {VIEWS.map((entry) => {
            /*
             * The parts bin counts what is held, not what is ready to build.
             *
             * The three building benches badge "how many of these can I afford right now", which is
             * the useful number for a bench. Components have nothing to build, so the same question
             * has no answer: the fall-through gave them the *modifications* count, and the tab read
             * `COMPONENTS 66` on a crew holding none at all.
             */
            const count =
              entry.id === 'components'
                ? Object.entries(base?.inventory ?? {}).reduce(
                    (sum, [id, n]) =>
                      ITEM_CATALOG[id as ItemId]?.kind === 'component' ? sum + (n ?? 0) : sum,
                    0,
                  )
                : readyIn(
                    entriesOf(
                      entry.id === 'refits'
                        ? 'upgrade'
                        : entry.id === 'traps'
                          ? 'trap'
                          : 'modification',
                    ),
                  );
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={view === entry.id}
                onClick={() => setView(entry.id)}
                data-testid={`scrapyard-view-${entry.id}`}
                data-sound="click"
                className={cn(
                  'door-tile flex items-center gap-1.5 rounded-md border px-3 py-2 transition-all duration-150',
                  'font-display text-[12px] font-bold uppercase tracking-[0.16em]',
                  view === entry.id
                    ? 'door-tile-active -translate-y-0.5 border-brass-300 text-brass-100'
                    : 'border-surface-500/70 text-ink-300 hover:-translate-y-0.5 hover:border-iris-300/80 hover:text-iris-100',
                )}
              >
                <span aria-hidden className="relative z-[2] [&_svg]:h-4 [&_svg]:w-4">
                  <Icon name={entry.icon} />
                </span>
                <span className="relative z-[2]">{entry.label}</span>
                <span className="relative z-[2] tabular-nums opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
        {/*
         * Ready to build, beside the plate rather than at the end of the bench row, and only on a
         * bench that builds things.
         *
         * It filtered the *entries*, so on the Components tab it was a control over a list it does
         * not touch: pressing it there narrowed nothing and left a lit button suggesting it had
         * (maintainer request, 2026-09-14). The parts bin is a bin. Moving it here also puts it
         * next to the discount, which is the other fact on this screen about what a crew can
         * afford right now.
         */}
        <div className="ml-auto flex items-stretch gap-2" data-testid="scrapyard-head-boxes">
          {BUILDS.has(view) && (
            <button
              type="button"
              onClick={() => setReadyOnly(!readyOnly)}
              aria-pressed={readyOnly}
              data-testid="scrapyard-ready-only"
              className={cn(
                'brushed relative flex shrink-0 items-center gap-2 rounded-md border px-3',
                'font-display text-[11px] font-bold uppercase tracking-[0.14em] transition-colors',
                readyOnly
                  ? 'border-bile-300/70 bg-bile-300/10 text-bile-300'
                  : 'border-surface-600 bg-surface-800/60 text-ink-300 hover:border-bile-300/50 hover:text-bile-300',
              )}
            >
              <Icon name="check" className="h-3.5 w-3.5" />
              Ready to build
              <span className="tabular-nums opacity-80">{ready}</span>
            </button>
          )}
          <YardInfoBox data={data} />
        </div>
      </div>

      {build.error !== null && (
        <p role="alert" className="shrink-0 font-body text-xs leading-relaxed text-oxblood-300">
          {build.error.message}
        </p>
      )}

      <div className="min-h-0 flex-1" data-testid="scrapyard-workspace">
        {view === 'modifications' && (
          <ModificationsBench
            entries={entriesOf('modification')}
            keptBack={data.entries.filter(
              (entry) => entry.kind === 'modification' && !entry.documentHeld,
            )}
            base={base}
            structure={structure}
            onStructure={setStructure}
            readyOnly={readyOnly}
            stock={data.resources}
            pending={build.isPending}
            onBuild={onBuild}
          />
        )}
        {view === 'refits' && (
          <UnitBench
            entries={shown(entriesOf('upgrade'))}
            keptBack={keptBack('upgrade')}
            stock={data.resources}
            pending={build.isPending}
            onBuild={onBuild}
          />
        )}
        {view === 'traps' && (
          <TrapsBench
            entries={shown(entriesOf('trap'))}
            keptBack={keptBack('trap')}
            stock={data.resources}
            pending={build.isPending}
            onBuild={onBuild}
          />
        )}
        {view === 'components' && <PartsBench held={base?.inventory ?? {}} />}
      </div>
    </PageShell>
  );
}

/**
 * The yard's own plate: its level, what the level takes off every bill, and the next rung worth
 * reaching. The one thing on the page that is about the yard rather than about what it sells.
 */
function YardInfoBox({ data }: { data: ScrapyardResponse }) {
  const next = nextScrapyardUnlock(data.scrapyardLevel, LADDER);
  const opens = next
    ? [
        next.modifications > 0 && `${next.modifications} modifications`,
        next.upgrades > 0 && `${next.upgrades} unit modifications`,
        next.traps > 0 && `${next.traps} ${next.traps === 1 ? 'trap' : 'traps'}`,
      ]
        .filter((part): part is string => typeof part === 'string')
        .join(', ')
    : null;

  return (
    <div
      data-testid="scrapyard-info"
      className="steel-plate hazard-edge flex min-w-0 items-center gap-3 rounded-md px-3 py-1.5"
    >
      <span aria-hidden className="text-brass-300">
        <YardGlyph mark={{ kind: 'yard' }} className="h-8 w-8" />
      </span>
      {/*
       * Every section says what it is worth, on hover.
       *
       * The "How the yard works" note that used to sit over this plate was three paragraphs of
       * rules a player had to read *before* the numbers meant anything, and it was gone from the
       * screen the moment they looked away. It is retired (maintainer request, 2026-09-14) and what
       * it said now lives on the figures it was explaining: hover the level and it tells you what
       * that level has opened, hover the discount and it tells you where the cut comes from and
       * where it stops. `data-tip` is the same hover the rest of the interface uses.
       */}
      <dl className="grid min-w-0 grid-cols-[auto_auto] gap-x-4 gap-y-0 font-display">
        <dt
          className="cursor-help text-[9px] uppercase tracking-[0.18em] text-ink-400"
          // Two ladders, not one. A unit card opens at its grade's rung; a building card opens
          // with the yard or, once it is engineering (`ADVANCED_MODIFICATION_MAGNITUDE`), at the
          // rung the advanced bracket shares with the ADVANCED unit cards. This used to say the
          // grades opened "for building and unit cards alike", which put INTRICATE brackets at
          // level 3 in the tip while a level-1 yard was cutting them.
          data-tip={`The Scrapyard's level opens the catalogue a grade at a time. Unit cards: BASIC at ${SCRAPYARD_LEVEL_FOR_RARITY.basic}, INTRICATE at ${SCRAPYARD_LEVEL_FOR_RARITY.intricate}, ADVANCED at ${SCRAPYARD_LEVEL_FOR_RARITY.advanced}, MASTERPIECE at ${SCRAPYARD_LEVEL_FOR_RARITY.masterpiece}. Building cards: BASIC and INTRICATE at ${SCRAPYARD_LEVEL_FOR_BASIC}, ADVANCED and MASTERPIECE at ${SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION}. Each trap opens at a level of its own.`}
          data-testid="scrapyard-level-tip"
        >
          Scrapyard
        </dt>
        <dt
          className="cursor-help text-[9px] uppercase tracking-[0.18em] text-ink-400"
          data-tip={`Every level above the first takes ${SCRAPYARD_DISCOUNT_PER_LEVEL}% off every bill on this screen: building cards, unit cards and traps alike. The Scrapyard caps at level ${BUILDING_MAX_LEVEL}, which is ${MAX_SCRAPYARD_DISCOUNT}% off.`}
          data-testid="scrapyard-discount-tip"
        >
          Every bill
        </dt>
        <dd
          className="text-[13px] font-bold tabular-nums text-ink-100"
          data-testid="scrapyard-level"
        >
          Level {data.scrapyardLevel}
        </dd>
        <dd
          className="text-[13px] font-bold tabular-nums text-brass-300"
          data-testid="scrapyard-discount"
        >
          {data.discountPercent > 0 ? `${data.discountPercent}% off` : 'List price'}
        </dd>
        {/* Only while there is a rung left to reach (maintainer request, 2026-09-11): a yard at the
            top of its ladder said "Everything the yard can cut is open", which is a line about
            nothing, and the plate is narrower without it. */}
        {next && opens && (
          <dd
            className="col-span-2 cursor-help break-words text-[10px] uppercase tracking-[0.12em] text-ink-300"
            data-tip={`Raising the Scrapyard to ${next.level} puts ${opens} on the benches. A row is drawn only once its blueprint is assembled, so the count is what the level opens rather than what you can build today.`}
            data-testid="scrapyard-next"
          >
            Level {next.level} opens {opens}
          </dd>
        )}
      </dl>
    </div>
  );
}

// --- Modifications ------------------------------------------------------------------------------

function ModificationsBench({
  entries,
  keptBack,
  base,
  structure,
  onStructure,
  readyOnly,
  stock,
  pending,
  onBuild,
}: {
  entries: readonly ScrapyardEntry[];
  /** The rows whose retrofit document the crew has not assembled: counted, never drawn. */
  keptBack: readonly ScrapyardEntry[];
  base: Base | null;
  structure: BuildingKind;
  onStructure: (kind: BuildingKind) => void;
  readyOnly: boolean;
  stock: Resources;
  pending: boolean;
  onBuild: (entry: ScrapyardEntry) => void;
}) {
  const forKind = (kind: BuildingKind) => entries.filter((entry) => entry.building === kind);
  const chosen = forKind(structure);
  const shown = readyOnly ? chosen.filter(buildable) : chosen;
  const hidden = keptBack.filter((entry) => entry.building === structure).length;

  return (
    <div className="grid h-full min-h-0 items-stretch gap-4 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      {/*
       * A dense head, because this panel shares a frame that does not scroll: eleven doors have to
       * stand in whatever the scene leaves, and a full head is most of a door.
       */}
      <Panel title="Structures" dense className="min-h-0 border border-surface-500/70">
        {/*
         * The eleven doors share the whole column (maintainer request, 2026-09-15).
         *
         * Stacked at their natural height they left the rail short: 19px of nothing under the
         * last door at 1440x900 and 257px at 1920x1080, a list that stopped where its content ran
         * out inside a panel that did not. `minmax(min-content, 1fr)` rows stretch every door by
         * the same share of whatever is left, so the rail is full at any height that fits them.
         *
         * `min-content` is the floor, and it is what keeps 1280x720 honest: eleven two-line doors
         * want 450px and the scene leaves 289, so the rows refuse to shrink below their text and
         * the list scrolls, which is the behaviour it had before and the only correct one there.
         * A plain `1fr` would have crushed the doors into each other instead.
         */}
        <ul
          className="grid min-h-0 flex-1 auto-rows-[minmax(min-content,1fr)] divide-y divide-surface-700 overflow-y-auto"
          data-testid="scrapyard-menu"
        >
          {BUILDING_KINDS.map((kind) => (
            <li key={kind} className="flex min-h-0">
              <StructureDoor
                kind={kind}
                base={base}
                ready={readyIn(forKind(kind))}
                total={forKind(kind).length}
                selected={kind === structure}
                onSelect={() => onStructure(kind)}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <section
        className={cn(BENCH_BOARD, 'flex min-h-0 flex-col gap-3 overflow-y-auto p-4')}
        data-testid={`scrapyard-bench-${structure}`}
      >
        <BracketRack kind={structure} base={base} />
        <Withheld count={hidden} bench={structure} />
        {shown.length === 0 ? (
          <p className="p-4 text-center font-body text-[13px] leading-relaxed text-ink-300">
            Nothing on this bench the yard could cut today. The drawings come off the mission board
            and out of the Lab.
          </p>
        ) : (
          <RarityTray
            entries={shown}
            columns={STRUCTURE_COLUMNS}
            testId={`scrapyard-${structure}`}
            card={(entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                stock={stock}
                pending={pending}
                onBuild={() => onBuild(entry)}
                ownedLabel={entry.owned > 0 ? `Cut ×${entry.owned}` : null}
              />
            )}
          />
        )}
      </section>
    </div>
  );
}

/** One structure in the rail: its door, how tall it stands, and how many of its five are open. */
function StructureDoor({
  kind,
  base,
  ready,
  total,
  selected,
  onSelect,
}: {
  kind: BuildingKind;
  base: Base | null;
  ready: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const standing = base ? findBuilding(base.buildings, kind) : undefined;
  const slots = modificationSlots(standing);
  const fitted = slots.filter((slot) => slot.modificationId !== null).length;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`scrapyard-bench-${BUILDING_CATALOG[kind].name.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      data-sound="click"
      className={cn(
        // Tight on purpose. Eleven doors have to stand in the height the scene leaves the rail, so
        // the padding and the plate are the smallest that still read as a door rather than a row.
        'flex h-full w-full items-center gap-2 border-l-[3px] py-0.5 pl-2 pr-2.5 text-left transition-all duration-150',
        selected
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'icon-plate flex h-7 w-7 shrink-0 items-center justify-center rounded-sm',
          selected ? 'text-brass-300' : standing ? 'text-ink-200' : 'text-ink-400',
        )}
      >
        <Icon name={BENCH_ICON[kind]} className="h-[1.125rem] w-[1.125rem]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[13px] leading-[1.1] text-ink-100">
          {BUILDING_CATALOG[kind].shortName}
        </span>
        <span
          className={cn(
            'block break-words font-body text-[10px] leading-tight',
            standing ? 'text-ink-300' : 'text-oxblood-300',
          )}
          data-testid={`scrapyard-fitted-${kind}`}
        >
          {standing
            ? `Level ${standing.level} · ${fitted} of ${MAX_MODIFICATION_SLOTS} brackets filled`
            : 'Not built yet'}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 font-display text-[10px] tabular-nums tracking-[0.12em]',
          ready > 0 ? 'text-bile-300' : 'text-ink-300',
        )}
      >
        {ready}/{total}
      </span>
    </button>
  );
}

/**
 * §I3b: the structure's brackets and its shelf, at the head of its bench.
 *
 * This was the Workshop's Modifications view, twelve panels wide. It reads the whole picture off
 * `/me`, which every screen behind `/game` has already resolved, so it costs a cache read and no
 * new route. A bracket with something in it, an open empty one and one the level has not opened
 * yet are three different chips, and what is waiting on the shelf sits under them with the door
 * to the district where it gets bolted in.
 */
function BracketRack({ kind, base }: { kind: BuildingKind; base: Base | null }) {
  const spec = BUILDING_CATALOG[kind];
  const standing = base ? findBuilding(base.buildings, kind) : undefined;
  const slots = modificationSlots(standing);
  const waiting = base
    ? shelvedModifications(addonsOf(base), base.buildings).filter(
        (id) => findModification(id)?.building === kind,
      )
    : [];

  return (
    <header className="flex flex-col gap-3 border-b border-surface-600/70 pb-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="icon-plate flex h-12 w-12 shrink-0 items-center justify-center rounded-sm text-brass-300"
        >
          <Icon name={BENCH_ICON[kind]} className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-stamp text-[19px] leading-tight text-ink-100">
            {spec.name}
          </h3>
          <p className="break-words font-body text-[12px] leading-relaxed text-ink-300">
            {standing
              ? `Level ${standing.level}. ${spec.role}`
              : 'Not built yet, so none of its brackets are open. What it would take is listed all the same.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
            Brackets
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {slots.map((slot) => {
              const fitted =
                slot.modificationId !== null ? findModification(slot.modificationId) : undefined;
              return (
                <li
                  key={slot.index}
                  data-testid={`scrapyard-slot-${kind}-${slot.index}`}
                  className={cn(
                    'flex items-center gap-1.5 rounded-sm border px-2 py-1 font-display text-[11px] uppercase tracking-[0.1em]',
                    fitted
                      ? 'border-bile-300/50 bg-bile-300/10 text-bile-300'
                      : slot.open
                        ? 'border-dashed border-surface-500 bg-surface-900/50 text-ink-300'
                        : 'border-surface-700 bg-surface-950/40 text-ink-400',
                  )}
                >
                  {fitted ? (
                    <YardGlyph
                      mark={{ kind: 'effect', effect: fitted.effect }}
                      className="h-3.5 w-3.5"
                    />
                  ) : (
                    <Icon name={slot.open ? 'build' : 'lock'} className="h-3.5 w-3.5" />
                  )}
                  <span className="break-words">
                    {fitted
                      ? fitted.name
                      : slot.open
                        ? 'Empty'
                        : `Opens at level ${slot.opensAtLevel}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
            On the shelf
          </span>
          {waiting.length === 0 ? (
            <p className="font-body text-[12px] leading-snug text-ink-300">
              Nothing cut for it and waiting.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" data-testid={`scrapyard-shelf-${kind}`}>
              {waiting.map((id, index) => {
                const mod = findModification(id);
                return (
                  <li
                    key={`${id}-${index}`}
                    className="flex items-center gap-1.5 rounded-sm border border-brass-500/50 bg-brass-500/10 px-2 py-1 font-display text-[11px] text-brass-100"
                  >
                    {mod && (
                      <YardGlyph
                        mark={{ kind: 'effect', effect: mod.effect }}
                        className="h-3.5 w-3.5"
                      />
                    )}
                    <span className="break-words">{mod?.name ?? id}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* The other end of the same job: the yard cuts it, the structure's own window bolts it in. */}
        <Link
          to="/game/base"
          data-testid={`scrapyard-fit-${kind}`}
          className="self-end rounded-sm border border-surface-600 px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-ink-200 transition-colors hover:border-brass-500/70 hover:text-brass-100"
        >
          Fit in the district
        </Link>
      </div>
    </header>
  );
}

// --- Unit modifications ---------------------------------------------------------------------------

/**
 * The columns a grouped tray runs at each width, and the classes that draw them.
 *
 * Both halves of the same fact, kept side by side because `RarityTray` needs the count to work out
 * how many rows each group takes and Tailwind needs the class written out to generate it. A
 * mismatch here draws blank rows or none.
 */
interface TrayColumns {
  /** Cards per row below `md`, at `md`, at `xl`, and at `2xl`. */
  counts: readonly [number, number, number, number];
  classes: string;
}

/** The structure bench shares its width with the rail, so it holds one card fewer per row. */
const STRUCTURE_COLUMNS: TrayColumns = {
  counts: [1, 2, 2, 3],
  classes: 'md:grid-cols-2 2xl:grid-cols-3',
};

/** The unit bench has the whole width. */
const UNIT_COLUMNS: TrayColumns = {
  counts: [1, 2, 3, 4],
  classes: 'md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
};

/**
 * The thirty unit cards, grouped by grade, each group under its label.
 *
 * This was four ladders, one per refit line, with the tiers subgridded so that tier N started on
 * one line across all four. The refits are gone (2026-09-15) and nothing in the catalogue that
 * replaced them is a rung: a Scrap Vest is not the first step towards a Hardshell Exoframe, it is a
 * different card. So the bench is one tray, and the only structure in it is the grade.
 */
function UnitBench({
  entries,
  keptBack,
  stock,
  pending,
  onBuild,
}: {
  entries: readonly ScrapyardEntry[];
  keptBack: number;
  stock: Resources;
  pending: boolean;
  onBuild: (entry: ScrapyardEntry) => void;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto"
      data-testid="scrapyard-refits"
    >
      <Withheld count={keptBack} bench="refits" />
      {entries.length === 0 ? (
        <p className="py-6 text-center font-body text-[13px] leading-relaxed text-ink-300">
          Nothing on this bench the yard could cut today. The drawings come off the mission board
          and out of the Lab.
        </p>
      ) : (
        <div className={cn(BENCH_BOARD, 'p-4')}>
          <RarityTray
            entries={entries}
            columns={UNIT_COLUMNS}
            blurbs={UNIT_MODIFICATION_RARITY_BLURBS}
            testId="scrapyard-unit-modifications"
            card={(entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                stock={stock}
                pending={pending}
                onBuild={() => onBuild(entry)}
                ownedLabel={entry.owned > 0 ? 'Built' : null}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The yard level a group's cards open at, read off the rows rather than off the grade.
 *
 * The two benches climb the yard's ladder differently. A unit card opens at its grade's rung
 * (`SCRAPYARD_LEVEL_FOR_RARITY`: 1, 3, 4, 7). A building card opens with the yard until it is
 * engineering, then at the advanced rung (`scrapyardLevelForModification`: 1 or 4), so an
 * INTRICATE bracket is open on day one and a MASTERPIECE one at level 4. This heading read the
 * unit ladder for both benches and printed "opens at yard level 3" over Nexus brackets a level-1
 * yard was cutting, with no "Yard 3" stamp on any card under it. `requiresLevel` is the level the
 * server gated each row with, so it is the number the heading says. Every row in a group shares
 * one level on both benches today; the minimum is what the heading would have to say if that
 * ever stopped being true, since it is the level at which the first of them opens.
 */
function opensAt(entries: readonly ScrapyardEntry[]): number {
  return Math.min(...entries.map((entry) => entry.requiresLevel));
}

/**
 * One tray, four groups, every card the same height (maintainer request, 2026-09-15).
 *
 * The cards are grouped by grade in the order the yard opens them, each group under a heading in
 * its colour. The obvious layout is four trays, one per group, and it fails the one measurement
 * the template exists for: `BENCH_TRAY` equalises card heights through `grid-auto-rows: 1fr`, and
 * a `1fr` row only knows about the grid it is in, so a MASTERPIECE bill that wraps would lift its
 * own group's cards by a line and leave the BASIC cards above them shorter. Every card on a bench
 * is meant to come out of the same press.
 *
 * So it is one grid. The headings span the full row, and the rows are declared rather than left
 * implicit: `auto` for each heading and `repeat(n, 1fr)` for the rows its cards fill, with `n`
 * worked out from the card count and the column count at each breakpoint. Every `1fr` row in a
 * grid resolves to the same height, so every card on the bench does too, across group boundaries.
 * The template is handed in through four custom properties because it depends on the column
 * count, which is a media query, and an inline style cannot carry one: the class names stay
 * static for Tailwind to find and the values change per render.
 *
 * A group with nothing to show is not drawn. Under **Ready to build** that is what the filter
 * means; on a structure's bench it is a grade the structure has no card of, which is not a fact
 * worth a heading.
 */
function RarityTray({
  entries,
  columns,
  blurbs,
  testId,
  card,
}: {
  entries: readonly ScrapyardEntry[];
  columns: TrayColumns;
  /** A line under each heading. The unit bench has one per grade; the structure bench has none. */
  blurbs?: Readonly<Record<ModificationRarity, string>>;
  testId: string;
  card: (entry: ScrapyardEntry) => ReactNode;
}) {
  const groups = MODIFICATION_RARITIES.map((rarity) => ({
    rarity,
    entries: entries.filter((entry) => rarityOf(entry) === rarity),
  })).filter((group) => group.entries.length > 0);

  const rowsAt = (perRow: number) =>
    groups
      .map((group) => `auto repeat(${Math.ceil(group.entries.length / perRow)}, 1fr)`)
      .join(' ');
  const rows = {
    '--rows-1': rowsAt(columns.counts[0]),
    '--rows-2': rowsAt(columns.counts[1]),
    '--rows-3': rowsAt(columns.counts[2]),
    '--rows-4': rowsAt(columns.counts[3]),
  } as CSSProperties;

  return (
    <ul
      className={cn(
        BENCH_TRAY,
        columns.classes,
        '[grid-template-rows:var(--rows-1)] md:[grid-template-rows:var(--rows-2)]',
        'xl:[grid-template-rows:var(--rows-3)] 2xl:[grid-template-rows:var(--rows-4)]',
      )}
      style={rows}
      data-testid={testId}
    >
      {groups.map((group) => (
        <Fragment key={group.rarity}>
          <li
            className="col-span-full flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-surface-600/70 pb-1.5 [&:not(:first-child)]:mt-2"
            data-testid={`scrapyard-rarity-${group.rarity}`}
          >
            <h3 className={cn('font-stamp text-[17px] leading-tight', RARITY_TEXT[group.rarity])}>
              {MODIFICATION_RARITY_LABELS[group.rarity]}
            </h3>
            <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-400">
              {group.entries.length} {group.entries.length === 1 ? 'card' : 'cards'} · opens at yard
              level {opensAt(group.entries)}
            </span>
            {blurbs && (
              <span className="min-w-0 basis-full break-words font-body text-[12px] italic leading-snug text-ink-300">
                {blurbs[group.rarity]}
              </span>
            )}
          </li>
          {group.entries.map(card)}
        </Fragment>
      ))}
    </ul>
  );
}

// --- Traps --------------------------------------------------------------------------------------

function TrapsBench({
  entries,
  keptBack,
  stock,
  pending,
  onBuild,
}: {
  entries: readonly ScrapyardEntry[];
  keptBack: number;
  stock: Resources;
  pending: boolean;
  onBuild: (entry: ScrapyardEntry) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      {/* One rule, which is the one a player gets wrong: a trap is not something you take with you
          on a raid (maintainer request, 2026-09-15). */}
      <p className="shrink-0 font-body text-[13px] leading-relaxed text-ink-300">
        Traps can only be used when defending a location.
      </p>
      <Withheld count={keptBack} bench="traps" />
      {entries.length === 0 ? (
        <p className="py-6 text-center font-body text-[13px] leading-relaxed text-ink-300">
          Nothing on this bench the yard could cut today. The drawings come off the mission board
          and the rungs out of the Lab.
        </p>
      ) : (
        <div className={cn(BENCH_BOARD, 'p-4')}>
          <ul
            className={cn(BENCH_TRAY, 'md:grid-cols-2 xl:grid-cols-3')}
            data-testid="scrapyard-traps"
          >
            {entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                stock={stock}
                pending={pending}
                onBuild={() => onBuild(entry)}
                ownedLabel={null}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- One entry ----------------------------------------------------------------------------------

/** A unit card's parts, each hoverable so nobody has to remember what a Gyro Assembly is. */
function PartsRow({ parts }: { parts: Partial<Record<ItemId, number>> }) {
  const entries = Object.entries(parts) as [ItemId, number][];
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {entries.map(([id, count]) => (
        <li key={id}>
          <HoverCard label={ITEM_CATALOG[id].name} size="window" card={<ItemWindow id={id} />}>
            <span className="flex items-center gap-1.5 rounded-sm border border-surface-600 bg-surface-900/60 px-2 py-0.5">
              <ItemGlyph id={id} className="h-4 w-4" />
              <span className="font-display text-[11px] font-semibold tabular-nums text-ink-100">
                {count}× {ITEM_CATALOG[id].name}
              </span>
            </span>
          </HoverCard>
        </li>
      ))}
    </ul>
  );
}

/** What a unit card does to a sheet, as a row of deltas rather than a sentence. */
function DeltaRow({ effect }: { effect: Record<string, unknown> }) {
  const deltas = Object.entries(effect).filter(
    (pair): pair is [string, number] => typeof pair[1] === 'number',
  );
  if (deltas.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
      {deltas.map(([key, delta]) => (
        <li
          key={key}
          className={cn(
            'font-display text-[11px] uppercase tracking-[0.08em] tabular-nums',
            delta > 0 ? 'text-bile-300' : 'text-oxblood-300',
          )}
        >
          {delta > 0 ? '+' : ''}
          {delta} {UNIT_STAT_LABELS[key as keyof typeof UNIT_STAT_LABELS] ?? key}
        </li>
      ))}
    </ul>
  );
}

/** A small stamped fact on a row: the yard level, whether a trap's bill wants metal. */
function Stamp({
  tone,
  children,
}: {
  tone: 'ink' | 'brass' | 'oxblood' | 'iris';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-sm border px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.1em]',
        tone === 'brass'
          ? 'border-brass-300/50 text-brass-100'
          : tone === 'oxblood'
            ? 'border-oxblood-300/50 text-oxblood-100'
            : tone === 'iris'
              ? 'border-iris-300/50 text-iris-100'
              : 'border-surface-600 text-ink-300',
      )}
    >
      {children}
    </span>
  );
}
/**
 * The six rows every card on every bench is cut to (maintainer request, 2026-09-15).
 *
 * A card used to size itself off its own content, so on the Traps bench a trap with five resources
 * in its bill and a requirement line under it stood half a card taller than the one beside it, and
 * six of them read as a broken fence. The regions are declared here instead: the head, what it
 * does, what it is, what it costs, which document it wants, and the control. Every card puts the
 * same thing in the same place, so a player comparing two of them is comparing the contents rather
 * than hunting for where the price went.
 *
 * `minmax(reserve, auto)` is a floor, not a clamp. The reserve is what the region needs in the
 * usual case at 1280, which is the narrowest column the game is drawn at; a bill that wraps to a
 * second line still gets its second line rather than being cut off, and `BENCH_TRAY` carries that
 * extra height to every other card on the bench.
 *
 * `content-start` with a `1fr` last track is what decides where the slack goes. Left at the default
 * the grid stretched every `auto` track a little, which put the same six regions at six slightly
 * different heights on every card: the bill sat three pixels lower on the trap with four resources
 * in it than on the trap with three. Pinned to the start, each region is exactly its reserve or
 * exactly its content, and all of the slack lands in the footer track under the button.
 */
const CARD_ROWS =
  '[grid-template-rows:minmax(3rem,auto)_minmax(2.25rem,auto)_minmax(3.25rem,auto)_minmax(3.25rem,auto)_minmax(1.25rem,auto)_minmax(2.4375rem,1fr)] content-start';

/**
 * One entry on any bench: the mark, what it is, what it does, what it costs, and the one control.
 *
 * The line that is always visible is the one that decides. The description sits under it in the
 * same card because a card is wide enough for a sentence now; the old rows hid it behind a press.
 */
function EntryCard({
  entry,
  stock,
  pending,
  onBuild,
  ownedLabel,
}: {
  entry: ScrapyardEntry;
  stock: Resources;
  pending: boolean;
  onBuild: () => void;
  /** What owning one reads as on this bench: "Built", "Cut ×2". Traps count on the mark instead. */
  ownedLabel: string | null;
}) {
  const owned = entry.owned > 0;
  const live = buildable(entry);
  const tone = owned ? 'bile' : live ? 'brass' : 'ink';
  const upgrade = entry.kind === 'upgrade' ? findUnitModification(entry.id) : undefined;
  const rarity = rarityOf(entry);
  const levelShut = entry.blocker?.startsWith('Needs the Scrapyard at level') ?? false;
  /*
   * How many are held rides on the mark rather than in a line of its own (maintainer request,
   * 2026-09-15). It is one number about the thing the glyph is already showing, and a sentence
   * spent saying it pushed the button down a line on exactly the cards that had the longest bill.
   */
  const heldOnMark = entry.kind === 'trap' && entry.owned > 0 ? entry.owned : null;

  return (
    <li
      data-testid={`addon-${entry.id}`}
      className={cn(
        'relative grid h-full min-w-0 gap-1.5 rounded-sm border p-3 transition-colors',
        CARD_ROWS,
        SLOT_WELL,
        owned
          ? 'border-bile-300/50'
          : live
            ? 'border-brass-300/40'
            : 'border-surface-700 opacity-85',
        // No grade stripe down the left edge (maintainer request, 2026-09-15). It was a 3px band
        // in the grade's colour, and on a BASIC card that colour is grey: the card read as a brass
        // frame with one grey side, which looks like a rendering fault rather than a code. The
        // grade is still on the card, in the tag beside the name, where it is a word rather than a
        // stripe a player has to learn.
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <YardPlate mark={markOf(entry)} tone={tone} size="md" count={heldOnMark} />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h4 className="min-w-0 break-words font-display text-[14px] font-bold text-ink-100">
            {entry.name}
          </h4>
          {/* A card has a grade; a trap only has whether its bill wants high-quality metal. */}
          {/* Traps carry no grade. Their `advanced` flag means one thing (the bill wants
              high-quality metal, `api.district.ts`), so the stamp says that, and says nothing for a
              trap that wants none: "Advanced" here read as the ADVANCED grade the unit bench one
              tab over uses for a different fact (bug pass, 2026-09-15). */}
          {rarity !== null ? (
            <RarityTag rarity={rarity} />
          ) : (
            entry.advanced && <Stamp tone="iris">Good metal</Stamp>
          )}
          {entry.requiresLevel > 1 && (
            <Stamp tone={levelShut ? 'oxblood' : 'ink'}>Yard {entry.requiresLevel}</Stamp>
          )}
          {/* The plate's multiplier is `aria-hidden` with the rest of the glyph, so the count is
              said once here for anybody who is not looking at it. */}
          {heldOnMark !== null && (
            <span className="sr-only" data-testid={`addon-owned-${entry.id}`}>
              {heldOnMark} held
            </span>
          )}
        </div>
      </div>

      {/* A unit card's effect is a row of deltas off the catalogue; the server's one-line wording
          of the same numbers would print them twice. */}
      <div className="min-w-0">
        {upgrade ? (
          <DeltaRow effect={upgrade.effect} />
        ) : (
          <p className="break-words font-display text-[12px] uppercase tracking-[0.08em] text-brass-300">
            {entry.effect}
          </p>
        )}
      </div>

      <p className="min-w-0 break-words font-body text-[12px] italic leading-snug text-ink-300">
        {entry.description}
      </p>

      <div className="flex min-w-0 flex-col justify-start gap-1.5 border-t border-surface-700/60 pt-1.5">
        <CostLine cost={entry.cost} stock={stock} />
        {upgrade && <PartsRow parts={upgrade.parts} />}
      </div>

      <span className="min-w-0 break-words font-body text-[11px] leading-snug text-ink-300">
        {entry.blueprint !== null ? `Blueprint: ${entry.blueprint}` : ''}
      </span>

      {/*
       * The control's row is reserved whatever is standing in it: Build, Built, or a blocker.
       *
       * `min-h-8` is the height of the `sm` Button, and it is on the inner row rather than on the
       * bordered box: building a unit card swaps a 32px button for a 16px "Built", and with the rule
       * and its padding on the same element the box came out 39px one way and 32px the other, so
       * the footer sat seven pixels lower on a built card than on a buildable one.
       */}
      <div className="self-end border-t border-surface-700/60 pt-1.5">
        <div className="flex min-h-8 flex-wrap items-center gap-2.5">
          {ownedLabel !== null && (
            <span
              className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-bile-300"
              data-testid={`addon-owned-${entry.id}`}
            >
              {ownedLabel}
            </span>
          )}
          {live ? (
            <Button
              size="sm"
              disabled={pending}
              data-testid={`addon-build-${entry.id}`}
              onClick={onBuild}
            >
              {pending ? 'Cutting…' : entry.kind === 'trap' ? 'Put one together' : 'Build'}
            </Button>
          ) : (
            entry.blocker !== null && (
              <span
                className="break-words font-display text-[11px] uppercase tracking-[0.14em] text-oxblood-300"
                data-testid={`addon-blocker-${entry.id}`}
              >
                {entry.blocker}
              </span>
            )
          )}
        </div>
      </div>
    </li>
  );
}
