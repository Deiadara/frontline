import {
  ITEM_CATALOG,
  UNIT_STAT_LABELS,
  UPGRADE_LINES,
  UPGRADE_LINE_BLURBS,
  UPGRADE_LINE_LABELS,
  type ItemId,
  type UpgradeLine,
  type WorkshopUpgrade,
} from '@frontline/shared';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { HoverCard } from '../../components/ui/HoverCard';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useFitUpgrade, useWorkshop } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { ItemWindow } from '../market/MarketPage';

/**
 * The workshop (workshop extension).
 *
 * Refits, which go into the crew's stock until they are bolted into a unit's brackets over in the
 * roster. Laid out as *ladders* rather than as a shopping list, because the shape of the decision
 * is which line to climb, not which item to buy, and a ladder with its second rung greyed out and
 * labelled "needs the Composite Armour blueprint" is the clearest possible statement of what the
 * market is for.
 *
 * The yard was here too until §B11 gave the Garage a page of its own. See `features/garage`.
 */
export function WorkshopPage() {
  const query = useWorkshop();
  const fit = useFitUpgrade();

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

  return (
    <PageShell quote="Nothing down here is broken. It is between jobs." wide>
      <InfoNote label="How a line opens">
        Every line's first rung is open to anybody. Past that you need the line's blueprint, and the
        Runner is the only one who sells them. Parts come out of your satchel.
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
    </PageShell>
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
