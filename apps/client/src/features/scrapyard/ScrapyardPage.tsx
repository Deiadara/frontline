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
  findBuilding,
  findModification,
  PLAYER_UNITS,
  UNIT_UPGRADE_SLOTS,
  findUnitModification,
  modificationSlots,
  MAX_SCRAPYARD_DISCOUNT,
  SCRAPYARD_DISCOUNT_PER_LEVEL,
  SCRAPYARD_LEVEL_FOR_ADVANCED_MODIFICATION,
  SCRAPYARD_LEVEL_FOR_BASIC,
  SCRAPYARD_LEVEL_FOR_RARITY,
  nextScrapyardUnlock,
  scrapyardUnlockLadder,
  type Base,
  type BuildingKind,
  type ItemId,
  type ModificationRarity,
  type Resources,
  type ScrapyardEntry,
  type UnitOption,
  type UnitSpec,
  type ScrapyardResponse,
} from '@frontline/shared';
import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CostLine } from '../../components/Resources';
import { Confirm } from '../../components/ui/Confirm';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { DrawnFace } from '../../components/ui/DrawnMarks';
import { UnitCard } from '../units/UnitCard';
import { cn } from '../../lib/cn';
import {
  useBuildAddon,
  useBurnUpgrade,
  useClearModification,
  useMe,
  useScrapyard,
  useUnits,
} from '../../lib/queries';
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
 * The one rule about traps a player gets wrong, written once.
 *
 * `api.battle.ts` offers traps only to a crew that is defending, so without a word on this bench
 * somebody buys one, goes to set it on a raid, finds an empty list and has nothing to read. It
 * rides at the top right of the yard's heading row on the traps bench and nowhere else.
 */
const TRAPS_NOTE = (
  <InfoNote label="How traps work">
    A trap is set on ground you are holding and spent on the fight it catches. You cannot take one
    with you: a raiding force carries units and boosts, and the bench is for the night somebody
    comes to you.
  </InfoNote>
);

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
/**
 * Whether the yard would cut this one **for the target the player is looking at**.
 *
 * A row's answer depends on where it is going as of 2026-09-16: the same Priority Bus is buildable
 * for the Nexus you raised and refused by the one you have not. A trap is the one row that belongs
 * to no target and keeps its own plain blocker.
 */
const targetOf = (entry: ScrapyardEntry, target: string | null): TargetRow | null =>
  target === null ? null : (entry.targets.find((one) => one.id === target) ?? null);

const buildable = (entry: ScrapyardEntry, target: string | null): boolean => {
  if (entry.kind === 'trap') return entry.blocker === null;
  const row = targetOf(entry, target);
  return row !== null && !row.fitted && row.blocker === null;
};

const readyIn = (entries: readonly ScrapyardEntry[], target: string | null): number =>
  entries.filter((entry) => buildable(entry, target)).length;

/** One row of `ScrapyardEntry.targets`: a structure or a unit this card could go on. */
type TargetRow = ScrapyardEntry['targets'][number];

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

/**
 * The empty state of a bench whose rows are all behind documents the crew has not assembled.
 *
 * It used to show whenever anything was withheld, which on a full bench put "go and find some
 * more" under thirty cards a player already holds (maintainer report, 2026-09-16). A player with
 * cards on the bench has something to do here; the line is for the player who opened a bench and
 * found it bare, so it is drawn only when the crew holds none of this bench and there is something
 * out there to go and find.
 */
function Withheld({
  heldCount,
  withheldCount,
  bench,
}: {
  heldCount: number;
  withheldCount: number;
  bench: string;
}) {
  if (heldCount > 0 || withheldCount === 0) return null;
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
   * The other half of one press: taking one out, which destroys it.
   *
   * Two routes because the two benches write different columns, and both of them existed already:
   * this screen is now where they are called from, rather than the district window and the Units
   * page. Both are asked for twice (`asking` below holds the card until the player says yes),
   * because nothing comes back.
   */
  const clear = useClearModification(me.data?.base?.id);
  const burn = useBurnUpgrade();
  const [asking, setAsking] = useState<{
    entry: ScrapyardEntry;
    target: string;
    /** Bolting it in and taking it out are both asked for, and they ask different questions. */
    act: 'bolt' | 'dismantle';
  } | null>(null);
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
   * Which unit the refits bench is open on, the same way `?bench=` names the structure.
   *
   * The unit bench is the structure bench with units down the left as of 2026-09-16, so it needs
   * the same deep link: a bracket on the Units page points here at the unit whose bracket it is.
   */
  const unit = params.get('unit');
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
        ...(unit === null ? {} : { unit }),
      },
      { replace: true },
    );
  const setStructure = (kind: BuildingKind) =>
    setParams(
      {
        bench: kind,
        ...(view === 'modifications' ? {} : { view }),
        ...(unit === null ? {} : { unit }),
      },
      { replace: true },
    );
  const setUnit = (unitId: string) =>
    setParams(
      {
        unit: unitId,
        ...(view === 'refits' ? {} : { view }),
        ...(isBuildingKind(bench) ? { bench } : {}),
        ...(view === 'refits' ? { view: 'refits' } : {}),
      },
      { replace: true },
    );
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

  /*
   * Every unit the refits bench can be opened on, and the one it is open on now.
   *
   * Taken off the cards rather than off the roster: a unit nothing in the catalogue fits has an
   * empty bench, and a rail door onto an empty bench is a door onto nothing. The server decides
   * *whether* a card may go on (`cannot_train` is one of its refusals), so the rail shows the unit
   * either way and the card says why.
   */
  const unitRail = PLAYER_UNITS.filter((one) =>
    entriesOf('upgrade').some((entry) => entry.targets.some((target) => target.id === one.id)),
  );
  const openUnit = unitRail.some((one) => one.id === unit) ? unit : (unitRail[0]?.id ?? null);

  /** What the bench in front of the player is bolting to. Null on the two benches that bolt to nothing. */
  const target = view === 'modifications' ? structure : view === 'refits' ? openUnit : null;
  const shown = (entries: readonly ScrapyardEntry[], on: string | null = target) =>
    readyOnly ? entries.filter((entry) => buildable(entry, on)) : entries;
  const ready = readyIn(held(data.entries), target);
  const base = me.data?.base ?? null;

  /*
   * One press: the yard cuts it and bolts it to whatever the bench is open on.
   *
   * `target` rides on the request because building and fitting are one act now (maintainer rule,
   * 2026-09-16). A trap sends none: it goes into the bag and belongs to no structure.
   */
  const onBuild = (entry: ScrapyardEntry) =>
    build.mutate({
      kind: entry.kind,
      id: entry.id,
      ...(entry.kind === 'trap' || target === null ? {} : { target }),
    });

  /** What the confirm calls the thing it is going onto: "the Nexus", "the Razors". */
  const targetName = (one: { entry: ScrapyardEntry; target: string }): string =>
    one.entry.targets.find((row) => row.id === one.target)?.name ?? 'it';

  /** Which bracket of `structure` is wearing this card, for the clear route. */
  const slotOf = (entry: ScrapyardEntry): number =>
    (base ? findBuilding(base.buildings, structure)?.modifications : [])?.indexOf(entry.id) ?? -1;

  const dismantle = (entry: ScrapyardEntry): void => {
    if (entry.kind === 'upgrade') {
      burn.mutate({ upgradeId: entry.id });
    } else {
      const slot = slotOf(entry);
      if (slot >= 0) clear.mutate({ building: structure, slot });
    }
    setAsking(null);
  };

  return (
    <PageShell
      quote="A version of recycling that actually works."
      /*
       * The traps rule on the quote's line, at the top right (maintainer, 2026-09-22).
       *
       * It sat on a line of its own above the bench, which cost the board a row and put the one
       * rule players get wrong below the fold on a short viewport. `PageShell`'s `action` is the
       * far end of the heading row, which is where a reader goes looking for a note.
       *
       * Only on this bench: the rule is about traps, and a note about traps hanging over the
       * structures board is furniture that means nothing there.
       */
      {...(view === 'traps' ? { action: TRAPS_NOTE } : {})}
      wide
      fills
    >
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
                    // Each bench counts against its own target: the structure the rail is on for
                    // modifications, the unit for refits, and nothing at all for traps.
                    entry.id === 'refits' ? openUnit : entry.id === 'traps' ? null : structure,
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
                  'group/tab relative flex items-center gap-1.5 px-3 py-2 transition-all duration-150',
                  'font-display text-[12px] font-bold uppercase tracking-[0.16em]',
                  'hover:-translate-y-px active:translate-y-px',
                  view === entry.id ? 'text-brass-100' : 'text-ink-300 hover:text-brass-100',
                )}
              >
                {/* The board's own box (maintainer, 2026-09-17). The yard is a bench with paper on
                    it now, and a pressed door-tile over a drawn sheet was the last piece of another
                    room left in this one. */}
                <DrawnFace
                  face={cn(
                    'transition-all duration-150',
                    view === entry.id
                      ? 'fill-brass-500/30 group-hover/tab:fill-brass-500/40'
                      : 'fill-surface-900/50 group-hover/tab:fill-brass-500/15',
                  )}
                />
                <span aria-hidden className="relative [&_svg]:h-4 [&_svg]:w-4">
                  <Icon name={entry.icon} />
                </span>
                <span className="relative">{entry.label}</span>
                <span className="relative tabular-nums opacity-80">{count}</span>
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
        {/*
          The line every other screen's head carries now (maintainer, 2026-09-21), running from
          the last bench to whatever the right-hand group starts with. On the Components tab,
          where Ready to build is not drawn at all, it simply runs on to the yard's own box
          instead of stopping short of a gap.

          The rule and the boxes share a wrapper, and that is structural rather than tidy. The
          rule takes the slack with `flex-1`; the boxes were held against the right edge by
          `ml-auto`, and the two cannot sit in one flex line together, because an auto margin
          absorbs the free space *before* `flex-grow` is applied and the line would collapse to
          nothing. Dropping the auto margin instead is what broke `visual.spec.ts`: at 1024x768
          the benches want 719px and the boxes 447 of a 950px head, so the boxes have always
          wrapped to a second line there, and `ml-auto` is what kept them on its right edge. The
          wrapper is that second line: it wraps as one, keeps `justify-end` inside it, and the
          rule fills whatever is left of it on either arrangement.

          No `min-w-0` on the wrapper, deliberately, though every other rule in this pass carries
          one. Its default `min-width: auto` is what makes its minimum the boxes' own width, so
          the head wraps it whole; with `min-w-0` it shrank under the `shrink-0` boxes inside it
          and they were drawn straight across the benches, overlapping them by 216px.
        */}
        <div className="flex flex-1 items-stretch justify-end gap-2">
          <span aria-hidden className="ink-rule my-auto block min-w-0 flex-1" />
          <div className="flex shrink-0 items-stretch gap-2" data-testid="scrapyard-head-boxes">
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
            onBuild={(entry) => setAsking({ entry, target: structure, act: 'bolt' })}
            onDismantle={(entry) => setAsking({ entry, target: structure, act: 'dismantle' })}
          />
        )}
        {view === 'refits' && (
          <UnitBench
            entries={shown(entriesOf('upgrade'), openUnit)}
            heldCount={entriesOf('upgrade').length}
            keptBack={keptBack('upgrade')}
            rail={unitRail}
            unitId={openUnit}
            onUnit={setUnit}
            stock={data.resources}
            pending={build.isPending}
            onBuild={(entry) => setAsking({ entry, target: openUnit ?? '', act: 'bolt' })}
            onDismantle={(entry) => setAsking({ entry, target: openUnit ?? '', act: 'dismantle' })}
          />
        )}
        {view === 'traps' && (
          <TrapsBench
            entries={shown(entriesOf('trap'))}
            heldCount={entriesOf('trap').length}
            keptBack={keptBack('trap')}
            stock={data.resources}
            pending={build.isPending}
            onBuild={onBuild}
          />
        )}
        {view === 'components' && <PartsBench held={base?.inventory ?? {}} />}
      </div>

      {/*
       * Asked before it happens, because it cannot be undone.
       *
       * Dismantling destroys the card (maintainer ruling, 2026-09-16): nothing comes back and
       * putting the same one on again means paying the yard again. That is exactly the shape the
       * kit's `Confirm` exists for, and it is the same dialog the district window uses, so the
       * sentence a player reads is the same wherever they press it.
       */}
      {asking !== null &&
        (asking.act === 'dismantle' ? (
          <Confirm
            title={`Dismantle ${asking.entry.name}?`}
            body="It comes off in pieces. Nothing is refunded, and putting one back means the yard cuts a new one at full price."
            confirm="Dismantle it"
            testId="scrapyard-dismantle"
            onConfirm={() => dismantle(asking.entry)}
            onCancel={() => setAsking(null)}
          />
        ) : (
          <Confirm
            title={`Bolt in ${asking.entry.name}?`}
            body={`The yard cuts it and bolts it straight into ${targetName(asking)}. The bill is spent on the press, and taking it out again destroys it.`}
            confirm="Bolt it in"
            testId="scrapyard-bolt"
            onConfirm={() => {
              onBuild(asking.entry);
              setAsking(null);
            }}
            onCancel={() => setAsking(null)}
          />
        ))}
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
  onDismantle,
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
  onDismantle: (entry: ScrapyardEntry) => void;
}) {
  /*
   * Which cards this bench shows, and it is no longer "the ones that belong to this structure".
   *
   * A card is fittable in a set of structures (`ModificationSpec.fits`), and the maintainer's rule
   * of 2026-09-16 is that a blueprint you have unlocked is available on every bench it fits. So the
   * bench asks the card where it may go rather than where it was authored: a plumbing run cut for
   * the Quarters is on the Quarters bench and on the Nexus bench, and the same press bolts it to
   * whichever one is open.
   */
  const forKind = (kind: BuildingKind) =>
    entries.filter((entry) => entry.targets.some((target) => target.id === kind));
  const chosen = forKind(structure);
  const shown = readyOnly ? chosen.filter((entry) => buildable(entry, structure)) : chosen;
  const hidden = keptBack.filter((entry) => entry.building === structure).length;

  return (
    <div className="grid h-full min-h-0 items-stretch gap-4 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      {/*
       * A dense head, because this panel shares a frame that does not scroll: eleven doors have to
       * stand in whatever the scene leaves, and a full head is most of a door.
       */}
      {/* No rule under the heading: the first door sits hard against it and the drawn line read
          as a yellow stripe behind the Nexus card (maintainer, 2026-09-22). */}
      <Panel tone="paper" title="Structures" dense rule={false} className="min-h-0">
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
          // Gaps and boxes rather than a divided list, which is what the rows became: a rule between
          // two bordered boxes is a third line doing nothing.
          // Boxes rather than a divided list, and no gap between them: see `StructureDoor` for the
          // eleven-doors-and-no-scrollbar constraint this rail is sized by.
          className="grid min-h-0 flex-1 auto-rows-[minmax(min-content,1fr)] overflow-y-auto px-1 py-0.5"
          data-testid="scrapyard-menu"
        >
          {BUILDING_KINDS.map((kind) => (
            <li key={kind} className="flex min-h-0">
              <StructureDoor
                kind={kind}
                base={base}
                ready={readyIn(forKind(kind), kind)}
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
        {/* `chosen`, not `shown`: the Ready-to-build filter hides rows the crew does hold, and a
            bench emptied by a filter is not a bench with nothing on it. */}
        <Withheld heldCount={chosen.length} withheldCount={hidden} bench={structure} />
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
                target={targetOf(entry, structure)}
                stock={stock}
                pending={pending}
                onBuild={() => onBuild(entry)}
                onDismantle={() => onDismantle(entry)}
                // How many other structures are already wearing one, which is the fact a player
                // deciding where to put the next one wants. Silent when this is the only one.
                ownedLabel={entry.owned > 1 ? `On ${entry.owned} structures` : null}
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
        /*
         * Tight on purpose, and tighter than the board's own row.
         *
         * Eleven doors have to stand in the height the scene leaves the rail with no scrollbar
         * (`scrapyard.spec.ts` measures it at 1280x800, which is the tightest viewport where that
         * is expected to hold). The board's box came over with the colours (maintainer,
         * 2026-09-17) and its spacing did not: gaps between eleven rows and a line of 14px type
         * were 89px more than the rail has, so the box is the board's and the density is the
         * rail's own.
         */
        'flex h-full w-full items-center gap-2 rounded-sm border px-2 text-left transition-colors',
        selected
          ? 'border-brass-300 bg-brass-500/30 text-brass-100'
          : 'border-surface-600/60 bg-surface-900/40 text-ink-200 hover:bg-surface-800/60',
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
        <span className="block break-words font-stamp text-[13px] leading-[1.1]">
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
 * §I3b: the structure's brackets, at the head of its bench.
 *
 * It read the whole picture off `/me`, which every screen behind `/game` has already resolved, so
 * it costs a cache read and no new route. A bracket with something in it, an open empty one and one
 * the level has not opened yet are three different chips.
 *
 * The shelf and the door to the district are gone (maintainer rule, 2026-09-16). There is nothing
 * "cut for it and waiting" any more, because the press that cuts a card bolts it in, and the
 * district is no longer where that happens: this bench is. What is left is the state of the three
 * brackets, which is the thing a player is deciding against.
 */
function BracketRack({ kind, base }: { kind: BuildingKind; base: Base | null }) {
  const spec = BUILDING_CATALOG[kind];
  const standing = base ? findBuilding(base.buildings, kind) : undefined;
  const slots = modificationSlots(standing);

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
  heldCount,
  keptBack,
  rail,
  unitId,
  onUnit,
  stock,
  pending,
  onBuild,
  onDismantle,
}: {
  entries: readonly ScrapyardEntry[];
  /** Held rows on this bench before the Ready-to-build filter, which is what "bare" means here. */
  heldCount: number;
  keptBack: number;
  /** Every unit a card in the catalogue fits, which is the rail down the left. */
  rail: readonly UnitSpec[];
  /** The one the bench is open on, or null when the catalogue fits nothing at all. */
  unitId: string | null;
  onUnit: (unitId: string) => void;
  stock: Resources;
  pending: boolean;
  onBuild: (entry: ScrapyardEntry) => void;
  onDismantle: (entry: ScrapyardEntry) => void;
}) {
  /*
   * The same shape as the structures bench (maintainer request, 2026-09-16).
   *
   * "Make the unit modifications exactly the same as the building modifications, just showing units
   * on the left." So: a rail of doors, a bench per door, and the same card with the same press. The
   * two screens were different mechanics wearing one page before this, and a player who had learned
   * the structure bench had to learn the other one from scratch.
   */
  const forUnit = (one: string) =>
    entries.filter((entry) => entry.targets.some((target) => target.id === one));
  const chosen = unitId === null ? [] : forUnit(unitId);

  /*
   * The roster, for the card a door shows on hover.
   *
   * Read here rather than in the door: nineteen doors asking for the same response is nineteen
   * subscriptions to one query, and the counts a card prints (garrisoned, abroad) are one answer
   * about the crew rather than one per unit. `useUnits` is already polling wherever it is mounted,
   * so this costs a read the page did not make and nothing else.
   */
  const roster = useUnits();
  const sheetFor = (id: string) => {
    const option = roster.data?.units.find((one) => one.id === id);
    if (option === undefined) return null;
    return {
      option,
      garrisoned: roster.data?.garrisoned[id] ?? 0,
      abroad: roster.data?.abroad[id] ?? 0,
      // §E: the card locks a carrier's combat figures until the crew has the programme.
      carriersFight: roster.data?.carriersFight ?? false,
    };
  };

  return (
    <div className="grid h-full min-h-0 items-stretch gap-4 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <Panel tone="paper" title="Units" dense className="min-h-0">
        <ul
          // Gaps and boxes rather than a divided list, which is what the rows became: a rule between
          // two bordered boxes is a third line doing nothing.
          className="grid min-h-0 flex-1 auto-rows-[minmax(min-content,1fr)] gap-1 overflow-y-auto px-1.5 py-1.5"
          data-testid="scrapyard-unit-menu"
        >
          {rail.map((unit) => (
            <li key={unit.id} className="flex min-h-0">
              <UnitDoor
                unit={unit}
                sheet={sheetFor(unit.id)}
                ready={readyIn(forUnit(unit.id), unit.id)}
                total={forUnit(unit.id).length}
                fitted={forUnit(unit.id).filter((entry) => targetOf(entry, unit.id)?.fitted).length}
                selected={unit.id === unitId}
                onSelect={() => onUnit(unit.id)}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <section
        className={cn(BENCH_BOARD, 'flex min-h-0 flex-col gap-3 overflow-y-auto p-4')}
        data-testid="scrapyard-refits"
      >
        <Withheld heldCount={heldCount} withheldCount={keptBack} bench="refits" />
        {chosen.length === 0 ? (
          <p className="py-6 text-center font-body text-[13px] leading-relaxed text-ink-300">
            Nothing on this bench the yard could cut today. The drawings come off the mission board
            and out of the Lab.
          </p>
        ) : (
          <RarityTray
            entries={chosen}
            columns={UNIT_COLUMNS}
            blurbs={UNIT_MODIFICATION_RARITY_BLURBS}
            testId="scrapyard-unit-modifications"
            card={(entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                target={targetOf(entry, unitId)}
                stock={stock}
                pending={pending}
                onBuild={() => onBuild(entry)}
                onDismantle={() => onDismantle(entry)}
                ownedLabel={entry.owned > 1 ? `On ${entry.owned} sheets` : null}
              />
            )}
          />
        )}
      </section>
    </div>
  );
}

/**
 * One door on the unit rail: the sheet, what it is wearing, and what the yard could cut for it.
 *
 * The structure rail's own door (`StructureDoor`) with a unit in it. Kept as its own component
 * rather than made generic, because the two read different things off different catalogues and a
 * shared one would take four props to say which.
 */
function UnitDoor({
  unit,
  sheet,
  ready,
  total,
  fitted,
  selected,
  onSelect,
}: {
  unit: UnitSpec;
  /**
   * The same unit off `GET /units`, which is the half a card needs and a catalogue row has not: the
   * crew's own numbers after everything territory, research and the officers are doing to them.
   * Null while that read is in flight, and then the door is a door with no card behind it.
   */
  sheet: {
    option: UnitOption;
    garrisoned: number;
    abroad: number;
    carriersFight: boolean;
  } | null;
  ready: number;
  total: number;
  /** Brackets on this sheet already wearing something, out of the three it has. */
  fitted: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const row = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-stamp text-[14px] leading-tight">{unit.name}</span>
        <span className="block truncate font-body text-[11px] text-ink-300">
          {fitted} of {UNIT_UPGRADE_SLOTS} brackets worn
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 font-display text-[10px] tabular-nums tracking-[0.12em]',
          ready > 0 ? 'text-verdigris-300' : 'text-ink-300',
        )}
      >
        {ready}/{total}
      </span>
    </>
  );

  const skin = cn(
    'flex w-full min-w-0 items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors',
    selected
      ? 'border-brass-300 bg-brass-500/30 text-brass-100'
      : 'border-surface-600/60 bg-surface-900/40 text-ink-200 hover:bg-surface-800/60',
  );

  /*
   * The sheet on a hover, and the door still a door (maintainer, 2026-09-17).
   *
   * "Make it so their unit card appears with portrait etc, but it does not stop you from clicking,
   * so it appears below or above depending." `HoverCard` is all three of those already: the card is
   * portalled and takes no pointer events unless asked, `side` is a preference it flips when the
   * card does not fit where it was asked for, and `onActivate` keeps the trigger a real control.
   * What it must **not** be is a button inside a button, which is invalid and unreachable by
   * keyboard, so the row's skin moves onto the trigger rather than wrapping one.
   *
   * With no sheet to show it stays the plain door it was: a hover that opens an empty frame is
   * worse than a hover that does nothing.
   */
  if (sheet === null) {
    return (
      <button
        type="button"
        data-testid={`scrapyard-unit-${unit.id}`}
        aria-pressed={selected}
        onClick={onSelect}
        className={skin}
      >
        {row}
      </button>
    );
  }

  return (
    <HoverCard
      size="card"
      label={unit.name}
      className={skin}
      onActivate={onSelect}
      pressed={selected}
      data-testid={`scrapyard-unit-${unit.id}`}
      card={
        <UnitCard
          unit={sheet.option}
          garrisoned={sheet.garrisoned}
          abroad={sheet.abroad}
          carriersFight={sheet.carriersFight}
        />
      }
    >
      {row}
    </HoverCard>
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
  heldCount,
  keptBack,
  stock,
  pending,
  onBuild,
}: {
  entries: readonly ScrapyardEntry[];
  /** Held rows on this bench before the Ready-to-build filter, which is what "bare" means here. */
  heldCount: number;
  keptBack: number;
  stock: Resources;
  pending: boolean;
  onBuild: (entry: ScrapyardEntry) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/*
       * The one rule a player gets wrong, back as a chip (maintainer, 2026-09-17).
       *
       * It was a paragraph pinned above the cards and came off with the rest of the pinned prose.
       * The *rule* still has to be somewhere: `api.battle.ts` only offers traps to a crew that is
       * defending, so without a word on this bench a player buys one, goes to set it on a raid,
       * and finds an empty list with nothing anywhere to say why.
       */}
      {/* The rule itself now sits at the top right of the page, on the quote's own line
          (maintainer, 2026-09-22): see `TRAPS_NOTE` and the `action` this page hands its shell.
          What is left here is the count, which reads from the left like every other line on this
          bench. */}
      <Withheld heldCount={heldCount} withheldCount={keptBack} bench="traps" />
      {entries.length === 0 ? (
        <p className="py-6 text-center font-body text-[13px] leading-relaxed text-ink-300">
          Nothing on this bench the yard could cut today. The drawings come off the mission board
          and the rungs out of the Lab.
        </p>
      ) : (
        /*
         * The board is the scroller, the way the structures bench does it (maintainer report,
         * 2026-09-16).
         *
         * With the scroll on the bench instead, the track ran the full height of the workspace:
         * the brass thumb started level with the line above, over the page's own ground, and the
         * board it belonged to began 33px below it. The withheld line above it stays put, which is
         * the right behaviour for a count of what is being kept back.
         */
        <div className={cn(BENCH_BOARD, 'min-h-0 overflow-y-auto p-4')}>
          <ul
            className={cn(BENCH_TRAY, 'md:grid-cols-2 xl:grid-cols-3')}
            data-testid="scrapyard-traps"
          >
            {entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                // A trap belongs to no structure and no unit: it goes into the bag.
                target={null}
                stock={stock}
                pending={pending}
                onBuild={() => onBuild(entry)}
                onDismantle={() => undefined}
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
  target,
  stock,
  pending,
  onBuild,
  onDismantle,
  ownedLabel,
}: {
  entry: ScrapyardEntry;
  /**
   * The structure or unit this bench is open on, and what this card can do for it.
   *
   * Null on the traps bench, which belongs to nothing. Everywhere else the card is a decision
   * about one target: the button reads Bolt It In for a card that can go on, Dismantle for one
   * that is already on, and a reason for one that cannot.
   */
  target: TargetRow | null;
  stock: Resources;
  pending: boolean;
  onBuild: () => void;
  onDismantle: () => void;
  /** What owning one reads as on this bench: "Built", "Cut ×2". Traps count on the mark instead. */
  ownedLabel: string | null;
}) {
  const fitted = target?.fitted ?? false;
  const owned = entry.owned > 0;
  const live = target === null ? entry.blocker === null : !fitted && target.blocker === null;
  const blocker = target === null ? entry.blocker : (target.blocker ?? null);
  const tone = fitted || owned ? 'bile' : live ? 'brass' : 'ink';
  const upgrade = entry.kind === 'upgrade' ? findUnitModification(entry.id) : undefined;
  const rarity = rarityOf(entry);
  const levelShut = blocker?.startsWith('Needs the Scrapyard at level') ?? false;
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
        fitted || owned
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

      {/*
        What a crew has to be, not only what it has to hold (maintainer rule, 2026-09-16).
        
        A card asks four things at once now and the yard refuses on the first one that fails, so a
        player reading only the refusal would learn them one press at a time. The whole list is on
        the card, quiet, under the bill: the document it wants and the three gates from
        `building/requirements.ts`, worded by the server so the bench and the district window
        cannot say it differently.
      */}
      <ul
        className="min-w-0 space-y-0.5 font-body text-[11px] leading-snug text-ink-300"
        data-testid={`addon-requires-${entry.id}`}
      >
        {entry.blueprint !== null && <li className="break-words">Blueprint: {entry.blueprint}</li>}
        {entry.requirement.map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
      </ul>

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
          {fitted ? (
            /*
             * Dismantle, and it destroys the card (maintainer ruling, 2026-09-16): nothing comes
             * back and putting the same one on again means paying the yard again. The confirm is
             * the caller's, for that reason.
             */
            <DrawnButton
              size="sm"
              disabled={pending}
              data-testid={`addon-dismantle-${entry.id}`}
              onClick={onDismantle}
              // The one destructive door on the bench keeps its oxblood, drawn rather than struck.
              className="!text-oxblood-300 hover:!text-oxblood-100"
            >
              Dismantle
            </DrawnButton>
          ) : live ? (
            <DrawnButton
              size="sm"
              disabled={pending}
              data-testid={`addon-build-${entry.id}`}
              onClick={onBuild}
            >
              {pending
                ? 'Cutting…'
                : entry.kind === 'trap'
                  ? 'Put one together'
                  : entry.kind === 'upgrade'
                    ? 'Bolt It On'
                    : 'Bolt It In'}
            </DrawnButton>
          ) : (
            blocker !== null && (
              <span
                className="break-words font-display text-[11px] uppercase tracking-[0.14em] text-oxblood-300"
                data-testid={`addon-blocker-${entry.id}`}
              >
                {blocker}
              </span>
            )
          )}
        </div>
      </div>
    </li>
  );
}
