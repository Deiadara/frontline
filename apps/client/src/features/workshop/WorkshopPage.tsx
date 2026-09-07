import {
  BUILDING_CATALOG,
  BUILDING_KINDS,
  ITEM_CATALOG,
  MAX_MODIFICATION_SLOTS,
  UNIT_STAT_LABELS,
  UPGRADE_LINES,
  UPGRADE_LINE_BLURBS,
  UPGRADE_LINE_LABELS,
  addonsOf,
  describeAddonEffect,
  findBuilding,
  findModification,
  modificationSlots,
  modificationsFor,
  shelvedModifications,
  type Base,
  type BuildingKind,
  type ItemId,
  type UpgradeLine,
  type WorkshopUpgrade,
} from '@frontline/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { HoverCard } from '../../components/ui/HoverCard';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useFitUpgrade, useMe, useWorkshop } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { ItemWindow } from '../market/MarketPage';

/**
 * The workshop (workshop extension, §I3b).
 *
 * Two views over the same idea, that a thing is *built* in one place and *bolted on* in another.
 *
 * **Refits** are the unit half: built here, into the crew's stock, until they go into a unit's
 * brackets over on the roster. Laid out as ladders rather than as a shopping list, because the
 * shape of the decision is which line to climb, not which item to buy.
 *
 * **Modifications** are the structure half, and this page does not build them: the Scrapyard does
 * (§E), and each structure's own window fits them. What was missing was anywhere to see the whole
 * picture at once, so a player who wanted to know which of twelve structures had something waiting
 * on the shelf had to open twelve windows. This is that view, and it points at both ends.
 *
 * The yard was here too until §B11 gave the Garage a page of its own. See `features/garage`.
 */
const VIEWS = [
  { id: 'refits', label: 'Refits' },
  { id: 'modifications', label: 'Modifications' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

export function WorkshopPage() {
  const query = useWorkshop();
  const me = useMe();
  const fit = useFitUpgrade();
  const [view, setView] = useState<ViewId>('refits');

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoad
        what="The workshop"
        loading="Opening the workshop…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const base = me.data?.base ?? null;

  return (
    <PageShell quote="Nothing down here is broken. It is between jobs." wide>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="The workshop">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={view === entry.id}
            onClick={() => setView(entry.id)}
            data-testid={`workshop-view-${entry.id}`}
            className={cn(
              'brushed rounded-sm border px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] transition-colors',
              view === entry.id
                ? 'border-brass-500 bg-brass-500/90 text-surface-950'
                : 'border-surface-600 bg-surface-800/70 text-ink-200 hover:text-brass-100',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {view === 'modifications' ? (
        <ModificationsView base={base} />
      ) : (
        <>
          <InfoNote label="How a line opens">
            Every line's first rung is open to anybody. Past that you need the line's blueprint, and
            the Runner is the only one who sells them. Parts come out of your satchel.
          </InfoNote>

          <div className="grid items-start gap-5 xl:grid-cols-3">
            {UPGRADE_LINES.map((line) => (
              <Panel key={line} title={UPGRADE_LINE_LABELS[line]}>
                <p className="px-4 pt-3 font-body text-[13px] leading-relaxed text-ink-300">
                  {UPGRADE_LINE_BLURBS[line]}
                </p>
                <ul className="flex flex-col gap-2.5 p-4">
                  {data.upgrades
                    .filter((upgrade) => upgrade.line === line)
                    .map((upgrade) => (
                      <li key={upgrade.id}>
                        <UpgradeCard
                          upgrade={upgrade}
                          resources={data.resources}
                          pending={fit.isPending}
                          onFit={() => fit.mutate({ upgradeId: upgrade.id })}
                        />
                      </li>
                    ))}
                </ul>
              </Panel>
            ))}
          </div>

          {fit.error !== null && (
            <p role="alert" className="font-body text-[13px] text-oxblood-300">
              {fit.error.message}
            </p>
          )}
        </>
      )}
    </PageShell>
  );
}

/**
 * §I3b: every structure's brackets, its shelf, and the two doors that change either.
 *
 * Read off `/me`, which every screen behind `/game` has already resolved, so this costs a cache
 * read and no new route. Every structure is listed, standing or not: what a structure would open
 * is exactly what a player wants to know before they raise it, and a list that hid the unbuilt
 * ones would hide precisely that.
 */
function ModificationsView({ base }: { base: Base | null }) {
  if (!base) {
    return (
      <p className="font-body text-[13px] leading-relaxed text-ink-300">
        Your district is still loading.
      </p>
    );
  }

  const shelf = shelvedModifications(addonsOf(base), base.buildings);

  return (
    <>
      <InfoNote label="Where a modification comes from">
        The Scrapyard cuts them, out of scrap and the structure&rsquo;s retrofit blueprint. They sit
        on the shelf until you bolt one into a bracket from the structure&rsquo;s own window, and a
        bracket can be emptied again without losing what was in it.
      </InfoNote>

      <div className="grid items-start gap-5 xl:grid-cols-3" data-testid="workshop-modifications">
        {BUILDING_KINDS.map((kind) => (
          <StructureAddons
            key={kind}
            kind={kind}
            base={base}
            waiting={shelf.filter((id) => findModification(id)?.building === kind)}
          />
        ))}
      </div>
    </>
  );
}

/** One structure: what is in its brackets, what is waiting, and how many it will ever hold. */
function StructureAddons({
  kind,
  base,
  waiting,
}: {
  kind: BuildingKind;
  base: Base;
  waiting: readonly string[];
}) {
  const standing = findBuilding(base.buildings, kind);
  const slots = modificationSlots(standing);
  const fitted = slots.filter((slot) => slot.modificationId !== null).length;

  return (
    <Panel
      title={BUILDING_CATALOG[kind].name}
      action={
        <span
          data-testid={`workshop-fitted-${kind}`}
          className="font-display text-[11px] font-bold uppercase tracking-[0.14em] tabular-nums text-ink-300"
        >
          {fitted} of {MAX_MODIFICATION_SLOTS}
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-4" data-testid={`workshop-addons-${kind}`}>
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          {standing
            ? `Level ${standing.level}. ${modificationsFor(kind).length} modifications exist for it.`
            : 'Not built yet, so none of its brackets are open.'}
        </p>

        <ul className="flex flex-col gap-1.5">
          {slots.map((slot) => (
            <li
              key={slot.index}
              data-testid={`workshop-slot-${kind}-${slot.index}`}
              className={cn(
                'flex items-center justify-between gap-3 rounded-sm border px-2.5 py-1.5 font-display text-[11px] uppercase tracking-[0.12em]',
                slot.modificationId !== null
                  ? 'border-bile-300/50 bg-bile-300/10 text-bile-300'
                  : slot.open
                    ? 'border-surface-600 bg-surface-900/50 text-ink-300'
                    : 'border-surface-700 bg-surface-950/40 text-ink-400',
              )}
            >
              <span className="min-w-0 break-words">
                {slot.modificationId !== null
                  ? (findModification(slot.modificationId)?.name ?? slot.modificationId)
                  : slot.open
                    ? 'Empty'
                    : `Opens at level ${slot.opensAtLevel}`}
              </span>
              <span className="shrink-0 tabular-nums text-ink-400">{slot.index + 1}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-1">
          <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
            On the shelf
          </span>
          {waiting.length === 0 ? (
            <p className="font-body text-[13px] leading-snug text-ink-300">
              Nothing built for it and waiting.
            </p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid={`workshop-shelf-${kind}`}>
              {waiting.map((id, index) => {
                const spec = findModification(id);
                return (
                  <li key={`${id}-${index}`} className="flex flex-col">
                    <span className="break-words font-display text-[12px] font-bold text-ink-100">
                      {spec?.name ?? id}
                    </span>
                    {spec && (
                      <span className="break-words font-display text-[12px] tabular-nums text-brass-300">
                        {describeAddonEffect(spec)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/*
         * Both ends of the same job: the yard cuts it, the structure's own window bolts it in.
         *
         * The yard opens on this structure's bench, which it reads off `?bench` (`ScrapyardPage`).
         * The district does not take a structure on the URL, so that door opens it whole.
         */}
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/game/scrapyard?bench=${kind}`}
            data-testid={`workshop-yard-${kind}`}
            className="rounded-sm border border-surface-600 px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-ink-200 transition-colors hover:border-brass-500/70 hover:text-brass-100"
          >
            Build more
          </Link>
          <Link
            to="/game/base"
            data-testid={`workshop-fit-${kind}`}
            className="rounded-sm border border-surface-600 px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-ink-200 transition-colors hover:border-brass-500/70 hover:text-brass-100"
          >
            Fit in the district
          </Link>
        </div>
      </div>
    </Panel>
  );
}

/** What a refit does, as a row of deltas rather than a paragraph. */
function EffectRow({ effect }: { effect: Record<string, number> }) {
  const entries = Object.entries(effect);
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
      {entries.map(([key, delta]) => (
        <li
          key={key}
          className={cn(
            'font-display text-[12px] uppercase tracking-[0.08em] tabular-nums',
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

/** The parts a thing needs, each one hoverable so nobody has to remember what a Gyro Assembly is. */
function PartsRow({ parts }: { parts: Partial<Record<ItemId, number>> }) {
  const entries = Object.entries(parts) as [ItemId, number][];
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {entries.map(([id, count]) => (
        <li key={id}>
          <HoverCard label={ITEM_CATALOG[id].name} size="window" card={<ItemWindow id={id} />}>
            <span className="flex items-center gap-1.5 rounded-sm border border-surface-600 bg-surface-900/60 px-2 py-1">
              <ItemGlyph id={id} className="h-5 w-5" />
              <span className="font-display text-[12px] font-semibold tabular-nums text-ink-100">
                {count}× {ITEM_CATALOG[id].name}
              </span>
            </span>
          </HoverCard>
        </li>
      ))}
    </ul>
  );
}

function UpgradeCard({
  upgrade,
  resources,
  pending,
  onFit,
}: {
  upgrade: WorkshopUpgrade;
  resources: Parameters<typeof CostLine>[0]['stock'];
  pending: boolean;
  onFit: () => void;
}) {
  return (
    <article
      data-testid={`upgrade-${upgrade.id}`}
      className={cn(
        'flex flex-col gap-2 rounded-sm border p-3',
        upgrade.built
          ? 'border-bile-300/50 bg-bile-300/10'
          : upgrade.blocker === null
            ? 'border-surface-600 bg-surface-800/60'
            : 'border-surface-700 bg-surface-900/50 opacity-75',
      )}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 font-display text-[14px] font-bold text-ink-100">{upgrade.name}</h3>
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          Tier {upgrade.tier}
        </span>
      </header>

      <p className="font-body text-[13px] leading-snug text-ink-200">{upgrade.description}</p>
      <EffectRow effect={upgrade.effect} />

      {upgrade.built ? (
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-bile-300">
          Built
        </p>
      ) : (
        <>
          <CostLine cost={upgrade.cost} stock={resources} />
          <PartsRow parts={upgrade.parts} />
          <div className="flex items-center gap-2.5">
            <Button size="sm" disabled={upgrade.blocker !== null || pending} onClick={onFit}>
              Build it
            </Button>
            {upgrade.blocker !== null && (
              <span className="font-display text-[12px] text-oxblood-300">{upgrade.blocker}</span>
            )}
          </div>
        </>
      )}
    </article>
  );
}

/** Re-exported so the units page can link straight into the line a player is looking at. */
export type { UpgradeLine };
