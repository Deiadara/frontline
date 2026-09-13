import {
  BUILDING_CATALOG,
  BUILDING_KINDS,
  ITEM_CATALOG,
  MAX_MODIFICATION_SLOTS,
  MODIFICATIONS,
  TRAP_CATALOG,
  UNIT_STAT_LABELS,
  UNIT_UPGRADES,
  UPGRADE_LINES,
  UPGRADE_LINE_BLURBS,
  UPGRADE_LINE_LABELS,
  addonsOf,
  findBuilding,
  findModification,
  findUpgrade,
  modificationSlots,
  MAX_SCRAPYARD_DISCOUNT,
  SCRAPYARD_DISCOUNT_PER_LEVEL,
  SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION,
  SCRAPYARD_LEVEL_FOR_BASIC,
  SCRAPYARD_LEVEL_FOR_UPGRADE_TIER,
  nextScrapyardUnlock,
  scrapyardUnlockLadder,
  shelvedModifications,
  type Base,
  type BuildingKind,
  type ItemId,
  type Resources,
  type ScrapyardEntry,
  type ScrapyardResponse,
  type UpgradeLine,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
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
import { ItemWindow } from '../market/MarketPage';
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
 * **Modifications** is the structure half: a rail of the eleven structures on the left, and the
 * one chosen open on the right with its brackets (fitted, empty, or waiting on a level), its shelf,
 * and the five things the yard can cut for it. **Refits** is the roster half, laid out as three
 * ladders because the decision is which line to climb rather than which item to buy. **Traps** is
 * the consumable half: cut for one night, set under one fight.
 *
 * ## What the yard's own level buys
 *
 * The info box beside the tabs says it: what the level takes off every bill, and what the next
 * level worth reaching opens. Both come off `building/scrapyard.ts`, which is also what the server
 * prices and gates with, so the box and the bill cannot disagree.
 *
 * Nothing on this screen derives a rule. Every entry arrives with its `blocker` already worded by
 * the server, out of the yard's level, the documents in the satchel and the Lab's finished rungs.
 * The **Ready to build** filter is the direct answer to §E3: it leaves exactly the entries the crew
 * could cut this evening.
 */

const VIEWS = [
  { id: 'modifications', label: 'Modifications', icon: 'build' },
  { id: 'refits', label: 'Refits', icon: 'units' },
  { id: 'traps', label: 'Traps', icon: 'shield' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];
type ViewId = (typeof VIEWS)[number]['id'];

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
  quarters: 'population',
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
  upgrades: UNIT_UPGRADES,
  traps: TRAP_CATALOG,
});

/** Which mark an entry wears, read off the catalogue it came from. */
function markOf(entry: ScrapyardEntry): YardMark {
  if (entry.kind === 'trap') return { kind: 'trap', id: entry.id };
  if (entry.kind === 'upgrade') {
    return { kind: 'line', line: findUpgrade(entry.id)?.line ?? 'armour' };
  }
  return { kind: 'effect', effect: findModification(entry.id)?.effect ?? 'production_percent' };
}

/**
 * Whether the yard would cut this one now.
 *
 * The server leaves `blocker` null on a refit the crew has already built (there is nothing left to
 * refuse), but a refit is built once, so it is not something the yard can cut again: it is neither
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
      {count === 1
        ? 'One more waits on a blueprint you have not assembled.'
        : `${count} more wait on blueprints you have not assembled.`}
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
      <PageShell quote="Somebody has to take it apart before anybody can put it back together.">
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
    <PageShell
      quote="Somebody has to take it apart before anybody can put it back together."
      wide
      fills
    >
      {/*
       * How the yard works, on the quote's own line at the top right (maintainer request, 2026-09-11),
       * directly over the yard's plate. Positioned rather than placed in the strip, so nothing in
       * the strip moves to make room for it: the sheet's body is the positioned ancestor and the
       * quote is the first thing in it, so `top-4` is the quote's line.
       */}
      <div className="absolute right-5 top-4 z-10" data-testid="scrapyard-how">
        <InfoNote label="How the yard works" size="sm">
          <p>
            The yard's level opens the catalogue a rung at a time: basic modifications and the first
            refit tier from level {SCRAPYARD_LEVEL_FOR_BASIC}, advanced modifications from level{' '}
            {SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION}, the second and third refit tiers at levels{' '}
            {SCRAPYARD_LEVEL_FOR_UPGRADE_TIER[1]} and {SCRAPYARD_LEVEL_FOR_UPGRADE_TIER[2]}, and
            each trap at its own.
          </p>
          <p className="mt-2">
            Every level above the first takes {SCRAPYARD_DISCOUNT_PER_LEVEL}% off every bill, to{' '}
            {MAX_SCRAPYARD_DISCOUNT}% at most. The plate under this says where the yard stands.
          </p>
          <p className="mt-2">
            A row is drawn only once its blueprint is assembled; the line under the benches counts
            what is waiting on paper. Refits fit every unit of their tier at once. Traps go to the
            satchel and are spent under one fight you are defending.
          </p>
        </InfoNote>
      </div>

      {/*
       * One strip: the three benches, the filter, and the yard's own plate on the right. Outside
       * the scroller on purpose, the way the Lab learned the expensive way: a control that scrolls
       * with sixty rows disappears the moment you use the thing it controls.
       */}
      <div className="flex shrink-0 flex-wrap items-stretch gap-2">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="The yard">
          {VIEWS.map((entry) => {
            const count = readyIn(
              entriesOf(
                entry.id === 'refits' ? 'upgrade' : entry.id === 'traps' ? 'trap' : 'modification',
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
                  'door-tile flex items-center gap-2 rounded-md border px-3.5 py-2 transition-all duration-150',
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
          <button
            type="button"
            onClick={() => setReadyOnly(!readyOnly)}
            aria-pressed={readyOnly}
            data-testid="scrapyard-ready-only"
            className={cn(
              'brushed relative flex items-center gap-2 rounded-md border px-3 py-2 transition-colors',
              'font-display text-[11px] font-bold uppercase tracking-[0.14em]',
              readyOnly
                ? 'border-bile-300/70 bg-bile-300/10 text-bile-300'
                : 'border-surface-600 bg-surface-800/60 text-ink-300 hover:border-bile-300/50 hover:text-bile-300',
            )}
          >
            <Icon name="check" className="h-3.5 w-3.5" />
            Ready to build
            <span className="tabular-nums opacity-80">{ready}</span>
          </button>
        </div>
        <YardInfoBox data={data} />
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
          <RefitsBench
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
        next.upgrades > 0 && `${next.upgrades} refits`,
        next.traps > 0 && `${next.traps} ${next.traps === 1 ? 'trap' : 'traps'}`,
      ]
        .filter((part): part is string => typeof part === 'string')
        .join(', ')
    : null;

  return (
    <div
      data-testid="scrapyard-info"
      className="steel-plate hazard-edge ml-auto flex min-w-0 items-center gap-3 rounded-md px-3 py-1.5"
    >
      <span aria-hidden className="text-brass-300">
        <YardGlyph mark={{ kind: 'yard' }} className="h-8 w-8" />
      </span>
      <dl className="grid min-w-0 grid-cols-[auto_auto] gap-x-4 gap-y-0 font-display">
        <dt className="text-[9px] uppercase tracking-[0.18em] text-ink-400">The yard</dt>
        <dt className="text-[9px] uppercase tracking-[0.18em] text-ink-400">Every bill</dt>
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
            className="col-span-2 break-words text-[10px] uppercase tracking-[0.12em] text-ink-300"
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
    <div className="grid h-full min-h-0 items-stretch gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <Panel title="Structures" className="min-h-0 border border-surface-500/70">
        <ul
          className="min-h-0 flex-1 divide-y divide-surface-700 overflow-y-auto"
          data-testid="scrapyard-menu"
        >
          {BUILDING_KINDS.map((kind) => (
            <li key={kind}>
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
        className="steel-plate rivets edge-lit flex min-h-0 flex-col gap-3 overflow-y-auto rounded-sm border border-surface-500/70 p-4 shadow-panel"
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
          <ul className="flex flex-col gap-2" data-testid={`scrapyard-${structure}`}>
            {shown.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                stock={stock}
                pending={pending}
                onBuild={() => onBuild(entry)}
                ownedLabel={entry.owned > 0 ? `Cut ×${entry.owned}` : null}
              />
            ))}
          </ul>
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
        'flex w-full items-center gap-3 border-l-[3px] py-2 pl-2.5 pr-3 text-left transition-all duration-150',
        selected
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm',
          selected ? 'text-brass-300' : standing ? 'text-ink-200' : 'text-ink-400',
        )}
      >
        <Icon name={BENCH_ICON[kind]} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[14px] leading-[1.15] text-ink-100">
          {BUILDING_CATALOG[kind].shortName}
        </span>
        <span
          className={cn(
            'block break-words font-body text-[11px] leading-snug',
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

// --- Refits -------------------------------------------------------------------------------------

const TIER_MARKS = ['I', 'II', 'III'] as const;

/**
 * Three ladders, side by side: the shape of the decision is which line to climb.
 *
 * Every rung in a line is built in order (`Build Scrap Plate first`), so the rungs hang off one
 * rail with the tier cut into it, and a built rung lights the rail up to the next.
 */
function RefitsBench({
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
  const inLine = (line: UpgradeLine) =>
    entries
      .filter((entry) => findUpgrade(entry.id)?.line === line)
      .sort((a, b) => (findUpgrade(a.id)?.tier ?? 0) - (findUpgrade(b.id)?.tier ?? 0));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <Withheld count={keptBack} bench="refits" />
      {/* Four ladders since the Discipline line (2026-09-11): one per column from 1280 up, two by
          two under it, so no line hides below the fold on the widths the game is drawn at. */}
      <div
        className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4"
        data-testid="scrapyard-refits"
      >
        {UPGRADE_LINES.map((line) => {
          const rungs = inLine(line);
          return (
            <section
              key={line}
              className="steel-plate rivets edge-lit flex min-w-0 flex-col gap-3 rounded-sm border border-surface-500/70 p-4 shadow-panel"
              data-testid={`scrapyard-line-${line}`}
            >
              <header className="flex items-start gap-3 border-b border-surface-600/70 pb-3">
                <YardPlate mark={{ kind: 'line', line }} tone="brass" size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-stamp text-[19px] leading-tight text-ink-100">
                    {UPGRADE_LINE_LABELS[line]}
                  </h3>
                  <p className="break-words font-body text-[12px] leading-relaxed text-ink-300">
                    {UPGRADE_LINE_BLURBS[line]}
                  </p>
                </div>
              </header>
              {rungs.length === 0 ? (
                <p className="py-4 text-center font-body text-[13px] leading-relaxed text-ink-300">
                  Nothing on this line the yard could cut today.
                </p>
              ) : (
                <ol className="relative ml-3 flex flex-col gap-3 border-l-2 border-dashed border-surface-500/70 pl-5">
                  {rungs.map((entry) => {
                    const tier = findUpgrade(entry.id)?.tier ?? 1;
                    return (
                      <li key={entry.id} className="relative">
                        <span
                          aria-hidden
                          className={cn(
                            'absolute -left-[2.05rem] top-3 flex h-6 w-6 items-center justify-center rounded-full border font-display text-[10px] font-bold',
                            entry.owned > 0
                              ? 'border-bile-300/70 bg-surface-900 text-bile-300'
                              : entry.blocker === null
                                ? 'border-brass-300/70 bg-surface-900 text-brass-300'
                                : 'border-surface-600 bg-surface-900 text-ink-400',
                          )}
                        >
                          {TIER_MARKS[tier - 1] ?? tier}
                        </span>
                        <EntryCard
                          entry={entry}
                          stock={stock}
                          pending={pending}
                          onBuild={() => onBuild(entry)}
                          ownedLabel={entry.owned > 0 ? 'Built' : null}
                          tag={`Tier ${tier}`}
                          withPlate={false}
                        />
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    </div>
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
      <p className="shrink-0 font-body text-[13px] leading-relaxed text-ink-300">
        Cut for one night. A trap goes into the satchel and is set under a fight you are defending;
        the attack still comes, a piece of it does not. Priced in whatever is lying around rather
        than in scrap alone.
      </p>
      <Withheld count={keptBack} bench="traps" />
      {entries.length === 0 ? (
        <p className="py-6 text-center font-body text-[13px] leading-relaxed text-ink-300">
          Nothing on this bench the yard could cut today. The drawings come off the mission board
          and the rungs out of the Lab.
        </p>
      ) : (
        <ul
          className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3"
          data-testid="scrapyard-traps"
        >
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              stock={stock}
              pending={pending}
              onBuild={() => onBuild(entry)}
              ownedLabel={entry.owned > 0 ? `${entry.owned} in the satchel` : null}
              tall
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// --- One entry ----------------------------------------------------------------------------------

/** A refit's parts, each hoverable so nobody has to remember what a Gyro Assembly is. */
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

/** What a refit does to a sheet, as a row of deltas rather than a sentence. */
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

/** A small stamped fact on a row: the tier, the yard level, the document. */
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
  tag,
  withPlate = true,
  tall = false,
}: {
  entry: ScrapyardEntry;
  stock: Resources;
  pending: boolean;
  onBuild: () => void;
  /** What owning one reads as on this bench: "Built", "Cut ×2", "3 in the satchel". */
  ownedLabel: string | null;
  tag?: string;
  withPlate?: boolean;
  /** A tile rather than a row: the plate above the words, for a bench of three. */
  tall?: boolean;
}) {
  const owned = entry.owned > 0;
  const live = buildable(entry);
  const tone = owned ? 'bile' : live ? 'brass' : 'ink';
  const upgrade = entry.kind === 'upgrade' ? findUpgrade(entry.id) : undefined;
  const levelShut = entry.blocker?.startsWith('Needs the Scrapyard at level') ?? false;

  return (
    <li
      data-testid={`addon-${entry.id}`}
      className={cn(
        'card-paper washed relative flex min-w-0 gap-3 rounded-sm border p-3 transition-colors',
        tall ? 'flex-col items-center text-center' : 'items-start',
        owned
          ? 'border-bile-300/50 bg-bile-300/10'
          : live
            ? 'border-brass-300/40'
            : 'border-surface-700 opacity-85',
      )}
    >
      {withPlate && <YardPlate mark={markOf(entry)} tone={tone} size={tall ? 'lg' : 'md'} />}

      <div className={cn('flex min-w-0 flex-1 flex-col gap-1.5', tall && 'w-full items-center')}>
        <div
          className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', tall && 'justify-center')}
        >
          <h4 className="min-w-0 break-words font-display text-[14px] font-bold text-ink-100">
            {entry.name}
          </h4>
          {tag && <Stamp tone="ink">{tag}</Stamp>}
          <Stamp tone={entry.advanced ? 'iris' : 'ink'}>
            {entry.advanced ? 'Advanced' : 'Basic'}
          </Stamp>
          {entry.requiresLevel > 1 && (
            <Stamp tone={levelShut ? 'oxblood' : 'ink'}>Yard {entry.requiresLevel}</Stamp>
          )}
        </div>

        {/* A refit's effect is a row of deltas off the catalogue; the server's one-line wording
            of the same numbers would print them twice. */}
        {upgrade ? (
          <DeltaRow effect={upgrade.effect} />
        ) : (
          <p className="break-words font-display text-[12px] uppercase tracking-[0.08em] text-brass-300">
            {entry.effect}
          </p>
        )}
        <p className="break-words font-body text-[12px] italic leading-snug text-ink-300">
          {entry.description}
        </p>

        <div
          className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', tall && 'justify-center')}
        >
          <CostLine cost={entry.cost} stock={stock} />
          {upgrade && <PartsRow parts={upgrade.parts} />}
        </div>

        {entry.blueprint !== null && (
          <span className="break-words font-body text-[11px] leading-snug text-ink-300">
            Blueprint: {entry.blueprint}
          </span>
        )}

        <div className={cn('mt-0.5 flex flex-wrap items-center gap-2.5', tall && 'justify-center')}>
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
              {pending ? 'Cutting…' : entry.kind === 'trap' ? 'Cut one' : 'Build'}
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
