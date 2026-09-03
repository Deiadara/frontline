import {
  BUILDING_CATALOG,
  BUILDING_KINDS,
  type BuildingKind,
  type Resources,
  type ScrapyardEntry,
} from '@frontline/shared';
import { useState } from 'react';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/Icon';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBuildAddon, useScrapyard } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';

/**
 * The Scrapyard (§B9, §E1 to §E4): a screen with a menu, not a list on a shelf.
 *
 * What the yard sells is one kind of thing seen twice: a permanent add-on bolted to something the
 * crew already owns. A **modification** goes into one of a structure's three slots (§E) and is
 * fitted from that structure's own dialog; a **refit** applies to every unit of the roster forever.
 *
 * ## Why a rail rather than one column of panels
 *
 * The board's catalogue is sixty-four entries across twelve headings. As one scrolling grid the
 * page answered "what does the yard sell" and nothing else, and the question a player actually
 * arrives with is narrower: *what can I do for the Gauntlet*, or *what is my roster missing*. So
 * this is the same rail-plus-workspace frame the Lab and the training tab use (§E4): a menu of
 * benches on the left, one bench open on the right, and the controls for the bench pinned outside
 * the scroller so reading a long bench never carries them off the top of the screen.
 *
 * ## What decides whether a row is live (§E3)
 *
 * Nothing on this screen. Every entry arrives with its `blocker` already worded by the server, out
 * of the blueprint documents in the satchel and the projects the Lab has finished, so the count in
 * the rail and the dead button on the row are the same fact read twice rather than two guesses.
 * The **Ready to build** filter is the direct answer to §E3: it leaves exactly the entries the
 * crew's blueprints and research have opened.
 *
 * Every price here is scrap, plus high-quality metal on the advanced entries, and nothing else.
 * That is the board's rule and it is enforced on the server by the two price functions rather than
 * by this screen agreeing to show only two columns.
 */

/**
 * The glyph on each door: what the structure is *for*, not what it looks like.
 *
 * The district's own `StructureSprite` was the obvious choice and was measured and rejected. Those
 * silhouettes are drawn in dark ferrite on a 100x100 canvas for a plot two hundred pixels wide; in
 * a 36px rail tile on a dark plate every one of them collapsed to the same faint triangle with a
 * lamp on it, so eleven doors carried one indistinguishable smudge. The stroked icon set is drawn
 * for this size and reads at it, and pointing each structure at what it produces means the glyph
 * says something the label does not.
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

/** One bench in the menu: a heading, and the entries under it. */
interface Bench {
  id: string;
  label: string;
  blurb: string;
  /** The structure this bench belongs to. Null for the refit bench, which belongs to the roster. */
  building: BuildingKind | null;
  icon: IconName;
  entries: ScrapyardEntry[];
}

function benchesFrom(entries: readonly ScrapyardEntry[]): Bench[] {
  const refits = entries.filter((entry) => entry.kind === 'upgrade');
  const structures = BUILDING_KINDS.map((kind) => ({
    id: kind,
    label: BUILDING_CATALOG[kind].name,
    blurb: `Three slots on the ${BUILDING_CATALOG[kind].shortName}. Build them here, fit them there.`,
    building: kind,
    icon: BENCH_ICON[kind],
    entries: entries.filter((entry) => entry.kind === 'modification' && entry.building === kind),
  })).filter((bench) => bench.entries.length > 0);

  const benches: Bench[] = [];
  if (refits.length > 0) {
    benches.push({
      id: 'refits',
      label: 'Refits',
      blurb: 'Bought once, and every unit you will ever field carries it.',
      building: null,
      icon: 'units',
      entries: refits,
    });
  }
  return [...benches, ...structures];
}

const readyIn = (bench: Bench): number =>
  bench.entries.filter((entry) => entry.blocker === null).length;

export function ScrapyardPage() {
  const query = useScrapyard();
  const build = useBuildAddon();
  const [bench, setBench] = useState<string>('all');
  const [readyOnly, setReadyOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const data = query.data;
  if (!data) {
    /*
     * A screen that cannot load has to say so.
     *
     * This drew "Opening the yard..." for every state that was not data, so a 500 looked exactly
     * like a slow network and looked like it for ever. `GET /api/battles` shipped that way for
     * months and nobody could describe it well enough to report it, which is why `LoadFailure`
     * exists and why there is a permanent guard in `screens.spec.ts` walking every screen behind
     * the nav. This page and the Garage were both added without one.
     */
    return query.isError ? (
      <LoadFailure
        what="The yard's board"
        onRetry={() => void query.refetch()}
        detail="Nothing has been lost. Nothing was charged for."
      />
    ) : (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Opening the yard…
        </p>
      </div>
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

  const benches = benchesFrom(data.entries);
  const shown = bench === 'all' ? benches : benches.filter((entry) => entry.id === bench);
  const ready = benches.reduce((total, entry) => total + readyIn(entry), 0);

  return (
    <PageShell
      quote="Somebody has to take it apart before anybody can put it back together."
      wide
      fills
    >
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Panel title="The yard" className="min-h-0 border border-surface-500/70">
          <ul
            className="min-h-0 flex-1 divide-y divide-surface-700 overflow-y-auto"
            data-testid="scrapyard-menu"
          >
            <li>
              <BenchButton
                label="Everything"
                blurb="The whole board, refits and structures together."
                icon="workshop"
                ready={ready}
                total={data.entries.length}
                selected={bench === 'all'}
                onSelect={() => setBench('all')}
              />
            </li>
            {benches.map((entry) => (
              <li key={entry.id}>
                <BenchButton
                  label={entry.label}
                  blurb={entry.blurb}
                  icon={entry.icon}
                  ready={readyIn(entry)}
                  total={entry.entries.length}
                  selected={bench === entry.id}
                  onSelect={() => setBench(entry.id)}
                />
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/*
           * The strip is outside the scroller on purpose.
           *
           * The Lab learned this the expensive way: a filter that scrolls with sixty-four cards is
           * a control that disappears the moment you use the thing it controls.
           */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <InfoNote label="What the yard cuts">
              Everything here is scrap, and the heavy work wants good metal as well. The advanced
              entries need the drawings first: a structure retrofit is a blueprint you assemble out
              of pages, and the Lab still has to work out the bracket itself. Built modifications
              sit on the shelf until you fit them from the structure&rsquo;s own window.
            </InfoNote>
            <button
              type="button"
              onClick={() => setReadyOnly(!readyOnly)}
              aria-pressed={readyOnly}
              data-testid="scrapyard-ready-only"
              className={cn(
                'door-tile flex items-center gap-2 rounded-md border px-3 py-2 transition-all duration-150',
                'font-display text-[11px] font-bold uppercase tracking-[0.14em]',
                readyOnly
                  ? 'door-tile-active -translate-y-0.5 border-brass-300 text-brass-100'
                  : 'border-surface-500/70 text-ink-300 hover:-translate-y-0.5 hover:border-iris-300/80 hover:text-iris-100',
              )}
            >
              <span aria-hidden className="relative z-[2] [&_svg]:h-4 [&_svg]:w-4">
                <Icon name="check" />
              </span>
              <span className="relative z-[2]">Ready to build</span>
              <span className="relative z-[2] tabular-nums opacity-80">{ready}</span>
            </button>
          </div>

          {build.error !== null && (
            <p role="alert" className="shrink-0 font-body text-xs leading-relaxed text-oxblood-300">
              {build.error.message}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="scrapyard-workspace">
            {/* Two columns only when there is more than one bench to put in them: a single
                selected bench pinned to half the width leaves the other half empty. */}
            <div className={cn('grid items-start gap-4', shown.length > 1 && 'xl:grid-cols-2')}>
              {shown.map((entry) => (
                <BenchPanel
                  key={entry.id}
                  bench={entry}
                  readyOnly={readyOnly}
                  stock={data.resources}
                  open={open}
                  onToggle={(id) => setOpen(open === id ? null : id)}
                  onBuild={(target) => build.mutate({ kind: target.kind, id: target.id })}
                  pending={build.isPending}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

/**
 * One door in the menu.
 *
 * The count is `ready of total` rather than a bare total, because that pair is the whole of §E3: a
 * player wants to know what the drawings they hold have actually opened, and a bench where the
 * first number is zero is a bench to leave alone this evening.
 *
 */
function BenchButton({
  label,
  blurb,
  icon,
  ready,
  total,
  selected,
  onSelect,
}: {
  label: string;
  blurb: string;
  icon: IconName;
  ready: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`scrapyard-bench-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      className={cn(
        // A lit left edge on the chosen one, the same signal the Lab's rail uses.
        'flex w-full items-center gap-3 border-l-[3px] py-2.5 pl-2.5 pr-3 text-left transition-all duration-150',
        selected
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm',
          selected ? 'text-brass-300' : 'text-ink-300',
        )}
      >
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[14px] leading-[1.15] text-ink-100">
          {label}
        </span>
        <span className="block break-words font-body text-[11px] leading-snug text-ink-300">
          {blurb}
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

function BenchPanel({
  bench,
  readyOnly,
  stock,
  open,
  onToggle,
  onBuild,
  pending,
}: {
  bench: Bench;
  readyOnly: boolean;
  stock: Resources;
  open: string | null;
  onToggle: (id: string) => void;
  onBuild: (entry: ScrapyardEntry) => void;
  pending: boolean;
}) {
  const entries = readyOnly
    ? bench.entries.filter((entry) => entry.blocker === null)
    : bench.entries;

  return (
    <Panel
      title={bench.label}
      action={
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-brass-300">
          {readyIn(bench)} ready
        </span>
      }
    >
      <p className="px-4 pt-3 font-body text-[13px] leading-relaxed text-ink-300">{bench.blurb}</p>
      {entries.length === 0 ? (
        <p className="p-4 font-body text-[13px] leading-relaxed text-ink-300">
          Nothing on this bench the yard could cut today. The drawings come off the mission board
          and out of the Lab.
        </p>
      ) : (
        <ul
          className="flex flex-col gap-2.5 p-4"
          data-testid={bench.building === null ? 'scrapyard-refits' : `scrapyard-${bench.building}`}
        >
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              stock={stock}
              expanded={open === entry.id}
              onToggle={() => onToggle(entry.id)}
              onBuild={() => onBuild(entry)}
              pending={pending}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One entry, collapsed to its name and price until it is asked about.
 *
 * Sixty-four rows on one page is a wall, and most of what a row has to say (the description, what
 * the effect actually is, which blueprint is missing) is only wanted for the one a player is
 * considering. The line that is always visible is the one that decides: what it is, what it costs,
 * and whether the button is live.
 */
function EntryRow({
  entry,
  stock,
  expanded,
  onToggle,
  onBuild,
  pending,
}: {
  entry: ScrapyardEntry;
  stock: Resources;
  expanded: boolean;
  onToggle: () => void;
  onBuild: () => void;
  pending: boolean;
}) {
  const owned = entry.owned > 0;
  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-sm border px-3 py-2.5',
        owned ? 'border-brass-500/60 bg-brass-500/5' : 'border-surface-700',
      )}
      data-testid={`addon-${entry.id}`}
    >
      <button
        type="button"
        className="flex min-w-0 items-baseline justify-between gap-3 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="truncate font-display text-[13px] font-semibold text-ink-100">
          {entry.name}
        </span>
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.14em] text-brass-300">
          {owned ? `Built ×${entry.owned}` : entry.advanced ? 'Advanced' : 'Basic'}
        </span>
      </button>

      <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
        {entry.effect}
      </span>

      {expanded && (
        <p className="font-body text-[12px] italic leading-relaxed text-ink-300">
          {entry.description}
        </p>
      )}

      <CostLine cost={entry.cost} stock={stock} />

      {entry.blueprint !== null && (
        <span className="font-body text-[11px] leading-snug text-ink-300">
          Blueprint: {entry.blueprint}
        </span>
      )}

      {entry.blocker === null ? (
        <Button
          size="sm"
          disabled={pending}
          data-testid={`addon-build-${entry.id}`}
          onClick={onBuild}
        >
          {pending ? 'Cutting…' : 'Build'}
        </Button>
      ) : (
        <span
          className="font-display text-[11px] uppercase tracking-[0.14em] text-oxblood-300"
          data-testid={`addon-blocker-${entry.id}`}
        >
          {entry.blocker}
        </span>
      )}
    </li>
  );
}
