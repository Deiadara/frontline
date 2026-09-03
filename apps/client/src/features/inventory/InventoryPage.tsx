import {
  ITEM_CATALOG,
  ITEM_KINDS,
  ITEM_KIND_LABELS,
  ITEM_RARITY_LABELS,
  heldItems,
  inventorySize,
  type ItemId,
  type ItemKind,
} from '@frontline/shared';
import { Link } from 'react-router-dom';
import { HoverCard } from '../../components/ui/HoverCard';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useMarket } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { ItemWindow } from '../market/MarketPage';
import { ItemGlyph } from './ItemGlyph';

/**
 * The satchel: everything held that is not a resource.
 *
 * Grouped by kind rather than listed flat, because the three kinds are three different *questions*.
 * A blueprint is "what can I unlock"; a component is "what can I build"; a relic is "what is this
 * worth". A single alphabetical list makes a player read every row to answer any of them.
 *
 * Read off the market payload rather than its own endpoint. The satchel is small, it is already on
 * that response for the trading forms, and a second request would be a second thing that can be
 * stale relative to the first.
 */
export function InventoryPage() {
  const query = useMarket();

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoad
        what="Your satchel"
        loading="Turning out the satchel…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const held = heldItems(data.inventory);
  const total = inventorySize(data.inventory);

  return (
    <PageShell quote="Down here you are exactly what you can carry out." wide>
      {total === 0 && (
        <InfoNote label="How the satchel fills">
          Nothing yet. Missions bring things back, and the Runner sells what the city has not
          already taken.{' '}
          <Link to="/game/market" className="text-brass-300 underline">
            Go and look.
          </Link>
        </InfoNote>
      )}

      <BlueprintsLink pages={held.filter(([id]) => ITEM_CATALOG[id].kind === 'page').length} />

      <div className="grid items-start gap-5 xl:grid-cols-3">
        {SATCHEL_KINDS.map((kind) => (
          <KindPanel
            key={kind}
            kind={kind}
            entries={held.filter(([id]) => ITEM_CATALOG[id].kind === kind)}
          />
        ))}
      </div>
    </PageShell>
  );
}

/**
 * Pages are not listed here, and that is the point of the Blueprints page.
 *
 * A page on its own means nothing: what a player wants to know is which document it belongs to and
 * how many of that document's pages are still out there, which is a row of squares rather than a
 * satchel line. Listing them twice would also make the satchel mostly pages by the mid game.
 */
const SATCHEL_KINDS = ITEM_KINDS.filter((kind) => kind !== 'page');

/** The door to §D4, with the count that says whether it is worth opening today. */
function BlueprintsLink({ pages }: { pages: number }) {
  return (
    <Link
      to="/game/inventory/blueprints"
      className="flex items-center justify-between gap-3 rounded-sm border border-surface-600 bg-surface-800/70 px-4 py-3 transition-colors hover:border-brass-500/70"
    >
      <span className="min-w-0">
        <span className="block font-display text-[14px] font-bold text-brass-300">Blueprints</span>
        <span className="block font-body text-[13px] leading-snug text-ink-300">
          Pages you are holding, and what they add up to.
        </span>
      </span>
      <span className="shrink-0 font-display text-[12px] uppercase tracking-[0.14em] tabular-nums text-ink-200">
        {pages === 0 ? 'no pages' : `${pages} ${pages === 1 ? 'page' : 'pages'}`}
      </span>
    </Link>
  );
}

const EMPTY_COPY: Record<ItemKind, string> = {
  blueprint: 'No blueprints. Everything past the first tier of the workshop is waiting on one.',
  page: 'No pages. They belong on the Blueprints page rather than in here.',
  component: 'No parts. The Runner carries them, and so does anything you pull apart.',
  relic: 'Nothing worth selling on. That is not the worst problem to have.',
};

function KindPanel({ kind, entries }: { kind: ItemKind; entries: [ItemId, number][] }) {
  return (
    <Panel
      title={ITEM_KIND_LABELS[kind]}
      action={
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-ink-300">
          {entries.length}
        </span>
      }
    >
      {entries.length === 0 ? (
        <p className="p-4 font-body text-[13px] leading-relaxed text-ink-300">{EMPTY_COPY[kind]}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-surface-700" data-testid={`satchel-${kind}`}>
          {entries.map(([id, count]) => (
            <li key={id}>
              <HoverCard
                label={ITEM_CATALOG[id].name}
                size="window"
                card={<ItemWindow id={id} />}
                className="w-full"
              >
                <span className="flex w-full items-center gap-3 px-4 py-3">
                  <span className="icon-tile flex h-12 w-12 shrink-0 items-center justify-center rounded-sm">
                    <ItemGlyph id={id} className="h-9 w-9" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-display text-[14px] font-bold text-ink-100">
                      {ITEM_CATALOG[id].name}
                    </span>
                    <span className="block font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
                      {ITEM_RARITY_LABELS[ITEM_CATALOG[id].rarity]} ·{' '}
                      {/* A price on a thing nobody will buy is a lie. An unlocked blueprint is
                          knowledge somebody has, and it is the one untradeable kind in here. */}
                      {ITEM_CATALOG[id].tradeable
                        ? `${ITEM_CATALOG[id].capsValue.toLocaleString()} caps each`
                        : 'not for sale'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-sm border border-surface-600 px-2.5 py-1',
                      'font-display text-[15px] font-bold tabular-nums text-ink-100',
                    )}
                  >
                    {count}
                  </span>
                </span>
              </HoverCard>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
