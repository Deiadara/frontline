import {
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_CATEGORY_BLURBS,
  BLUEPRINT_CATEGORY_LABELS,
  BLUEPRINT_UNLOCK_MESSAGES,
  REIMAGINING_PAGES_SPENT,
  knownBlueprints,
  reimaginingAvailable,
  reimaginingRefusal,
  reimaginingRequirements,
  BLUEPRINTS,
  sparePages,
  type BlueprintCategory,
  type BlueprintUnlockRefusal,
  type BlueprintHolding,
  type Inventory,
  type ReimaginingContext,
  type ReimaginingRefusal,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { PanelSection } from '../../components/ui/PanelSection';
import { cn } from '../../lib/cn';
import { useMarket, useReimagine, useUnlockBlueprint } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { BlueprintGlyph } from './BlueprintGlyph';

/**
 * The Blueprints page, inside the Satchel (§D4 to §D11).
 *
 * A blueprint is a document made of named pages, and this screen is the only place the collection
 * is visible. Its whole shape comes from §D5: **a document you hold no pages of is not on this
 * screen at all.** There is no greyed-out row, no "?? of 8", no count of what is left in the game.
 * The first page you find is the first time you learn the thing exists, and everything else here
 * follows from wanting that moment to land.
 *
 * ## Two views, not one long list
 *
 * §D10 says an unlocked blueprint *moves to the unlocked blueprints page*, and it means it: what a
 * player wants from the collecting view is "what am I short of", and once a document is finished
 * it never answers that question again. So the two are separate views over the same three
 * categories, and the switch carries a count so the second one is not a place you have to go and
 * check.
 *
 * ## Everything is read off the satchel
 *
 * Pages and finished documents are items, so this screen needs no endpoint of its own: it reads
 * `inventory` off the market payload, the same object the satchel behind it is drawn from. The one
 * write is Unlock.
 */
export function BlueprintsPage() {
  const query = useMarket();
  const unlock = useUnlockBlueprint();
  const [showUnlocked, setShowUnlocked] = useState(false);

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoad
        what="Your blueprints"
        loading="Spreading the drawings out…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
        detail="Nothing has been lost. The pages are where you left them."
      />
    );
  }

  const known = knownBlueprints(data.inventory);
  const unlocked = known.filter((holding) => holding.status === 'unlocked');
  const collecting = known.filter((holding) => holding.status !== 'unlocked');
  const shown = showUnlocked ? unlocked : collecting;

  return (
    <PageShell
      quote="Half a drawing is somebody else's problem until you find the other half."
      wide
    >
      {known.length === 0 && (
        <InfoNote label="How a blueprint is put together">
          Nothing here yet. A blueprint is a set of named pages, and you have none of them. Pages
          come back from missions, turn up on the Black Market for infamy, and once in a while the
          Runner is carrying one. Collect every page of a document and you can unlock it for good.
        </InfoNote>
      )}

      {known.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Blueprints">
          <ViewTab
            label="Collecting"
            count={collecting.length}
            selected={!showUnlocked}
            onSelect={() => setShowUnlocked(false)}
          />
          <ViewTab
            label="Unlocked"
            count={unlocked.length}
            selected={showUnlocked}
            onSelect={() => setShowUnlocked(true)}
          />
        </div>
      )}

      {known.length > 0 && (
        <div className="grid items-start gap-5 xl:grid-cols-3">
          {BLUEPRINT_CATEGORIES.map((category) => (
            <CategoryPanel
              key={category}
              category={category}
              holdings={shown.filter((holding) => holding.blueprint.category === category)}
              showUnlocked={showUnlocked}
              pending={unlock.isPending}
              onUnlock={(blueprintId) => unlock.mutate({ blueprintId })}
            />
          ))}
        </div>
      )}

      {/* The route answers with the machine name (`missing_pages`, and the two others), so the
          banner puts it through the catalogue's own wording map. It printed the raw string until
          now: a player one page short of a document read the literal word `missing_pages`. */}
      {unlock.error !== null && (
        <p role="alert" className="font-body text-[13px] text-oxblood-300">
          {BLUEPRINT_UNLOCK_MESSAGES[unlock.error.message as BlueprintUnlockRefusal] ??
            unlock.error.message}
        </p>
      )}

      <ReimaginingPanel inventory={data.inventory} context={data.reimagining} />
    </PageShell>
  );
}

function ViewTab({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'brushed rounded-sm border px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] transition-colors',
        selected
          ? 'border-brass-500 bg-brass-500/90 text-surface-950'
          : 'border-surface-600 bg-surface-800/70 text-ink-200 hover:text-brass-100',
      )}
    >
      {label}
      <span className="ml-2 tabular-nums opacity-80">{count}</span>
    </button>
  );
}

const EMPTY_COPY: Record<BlueprintCategory, string> = {
  unit: 'No pages for anything that fights or drives. Missions bring them back.',
  upgrade: 'Nothing for the yard or the workshop yet.',
  consumable: 'No recipes. The ones worth having are made the night before a fight.',
};

function CategoryPanel({
  category,
  holdings,
  showUnlocked,
  pending,
  onUnlock,
}: {
  category: BlueprintCategory;
  holdings: readonly BlueprintHolding[];
  showUnlocked: boolean;
  pending: boolean;
  onUnlock: (blueprintId: string) => void;
}) {
  return (
    <Panel
      title={BLUEPRINT_CATEGORY_LABELS[category]}
      action={
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-ink-300">
          {holdings.length}
        </span>
      }
    >
      <p className="px-4 pt-3 font-body text-[13px] leading-relaxed text-ink-300">
        {BLUEPRINT_CATEGORY_BLURBS[category]}
      </p>
      {holdings.length === 0 ? (
        <p className="p-4 font-body text-[13px] leading-relaxed text-ink-300">
          {showUnlocked ? 'Nothing unlocked in here yet.' : EMPTY_COPY[category]}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5 p-4" data-testid={`blueprints-${category}`}>
          {holdings.map((holding) => (
            <li key={holding.blueprint.id}>
              <BlueprintCard holding={holding} pending={pending} onUnlock={onUnlock} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One document (§D6 to §D10).
 *
 * Darkened while it is incomplete and lit once it is not, which is the whole of §D6 and §D10's
 * "the bar goes to normal colour". The lock sits on the document rather than on the squares: it is
 * the blueprint that is shut, and the squares are the reason.
 */
function BlueprintCard({
  holding,
  pending,
  onUnlock,
}: {
  holding: BlueprintHolding;
  pending: boolean;
  onUnlock: (blueprintId: string) => void;
}) {
  const { blueprint, status, pages, distinctHeld } = holding;
  const total = pages.length;
  const complete = status === 'complete';
  const unlocked = status === 'unlocked';

  return (
    <article
      data-testid={`blueprint-${blueprint.id}`}
      data-status={status}
      className={cn(
        'flex gap-3 rounded-sm border p-3',
        unlocked
          ? 'border-bile-300/50 bg-bile-300/10'
          : complete
            ? 'border-brass-500/60 bg-surface-800/70'
            : 'border-surface-700 bg-surface-900/50 opacity-75',
      )}
    >
      <span className="icon-tile flex h-14 w-14 shrink-0 items-center justify-center rounded-sm">
        <BlueprintGlyph blueprint={blueprint} className="h-11 w-11" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 font-display text-[14px] font-bold text-ink-100">
            {blueprint.name}
          </h3>
          {!unlocked && (
            <Icon name="lock" label="Locked" className="h-4 w-4 shrink-0 text-ink-300" />
          )}
        </header>

        <p className="font-body text-[13px] leading-snug text-ink-200">{blueprint.blurb}</p>

        <PageSquares holding={holding} />

        <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {unlocked ? `${total} pages` : `${distinctHeld} of ${total} pages`}
        </p>

        {unlocked ? (
          <p className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-bile-300">
            Unlocked
          </p>
        ) : (
          complete && (
            <div>
              <Button size="sm" disabled={pending} onClick={() => onUnlock(blueprint.id)}>
                Unlock
              </Button>
            </div>
          )
        )}
      </div>
    </article>
  );
}

/**
 * The row of squares (§D6).
 *
 * One per page, in the document's own order, filled for what is held and empty for what is not. A
 * spare copy is marked rather than counted out: the square is about whether the page is *in*, and
 * a player with two of one page wants to know they have something to trade, not a second box.
 *
 * An unlocked document draws every square filled. The pages were spent assembling it, so counting
 * them again would draw an empty row under the one thing on this page that is finished. A copy
 * found *after* it was assembled still gets its number, because that copy is spendable.
 */
function PageSquares({ holding }: { holding: BlueprintHolding }) {
  const unlocked = holding.status === 'unlocked';
  return (
    <ul className="flex flex-wrap gap-1" data-testid={`pages-${holding.blueprint.id}`}>
      {holding.pages.map(({ page, held }) => {
        const filled = unlocked || held > 0;
        return (
          <li
            key={page.id}
            title={page.name}
            data-held={filled ? 'yes' : 'no'}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-[2px] border',
              filled
                ? 'border-brass-500/70 bg-brass-500/70'
                : 'border-surface-600 bg-surface-950/60',
            )}
          >
            <span className="sr-only">
              {page.name}: {filled ? 'held' : 'missing'}
            </span>
            {/* The threshold differs because "spare" does. On a document still being collected the
                first copy is doing a job, so two is one spare. On an unlocked one the pages were
                already spent assembling it, so every copy still in the satchel is spare and a
                single one is worth marking: Reimagining will take it. */}
            {held > (unlocked ? 0 : 1) && (
              <span
                aria-hidden
                className="font-display text-[9px] font-bold leading-none text-surface-950"
              >
                {held}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Why the button is there but will not do anything yet, in the player's words. */
const REIMAGINING_REFUSALS: Readonly<Record<ReimaginingRefusal, string>> = {
  not_available: 'The Lab is not doing this yet.',
  not_enough_spare_pages: `The Lab wants ${REIMAGINING_PAGES_SPENT} pages you do not need. You are short.`,
  nothing_left_to_find:
    'Every page there is, you either hold or have already bound into a document. Nothing left to want.',
};

/** Page ids into their written names, counted, so a trade reads as a sentence. */
function pageName(pageIds: readonly string[]): string {
  const names = new Map<string, string>();
  for (const spec of BLUEPRINTS) {
    for (const page of spec.pages) names.set(page.id, page.name);
  }
  const counted = new Map<string, number>();
  for (const id of pageIds) counted.set(id, (counted.get(id) ?? 0) + 1);
  return [...counted]
    .map(([id, count]) => {
      const name = names.get(id) ?? id;
      return count > 1 ? `${name} x${count}` : name;
    })
    .join(', ');
}

/**
 * §G2/§G4: Reimagining, locked with its requirements stated until the Lab opens it.
 *
 * The section is on the page either way, which is the part of §G4 that is easy to lose: a player
 * who cannot use this yet still needs to know it exists, because it is the reason to keep a page
 * they have three of instead of selling it.
 *
 * The two booleans come off the market payload rather than being worked out here. The seat is on
 * the crew and the research is on the base, neither of which this screen loads, and the route
 * re-checks the same predicate before it trades: one answer, computed once.
 */
function ReimaginingPanel({
  inventory,
  context,
}: {
  inventory: Inventory;
  context: ReimaginingContext;
}) {
  const requirements = reimaginingRequirements(context);
  const spare = sparePages(inventory).reduce((total, entry) => total + entry.spare, 0);
  const trade = useReimagine();
  const refusal = reimaginingRefusal({ inventory, context, seed: '' });
  const open = reimaginingAvailable(context);
  const traded = trade.data ?? null;

  return (
    <Panel
      title="Reimagining"
      action={
        open ? (
          <Button
            size="sm"
            onClick={() => trade.mutate()}
            disabled={refusal !== null || trade.isPending}
            data-testid="reimagine"
          >
            {trade.isPending ? 'At the bench…' : `Trade ${REIMAGINING_PAGES_SPENT}`}
          </Button>
        ) : (
          <Icon name="lock" label="Locked" className="h-4 w-4 text-ink-300" />
        )
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="font-body text-[13px] leading-relaxed text-ink-200">
          Take {REIMAGINING_PAGES_SPENT} pages you do not need to the Lab and come away with one you
          do not have, from any of the three categories. Guaranteed, and not cheap.
        </p>
        {!open && (
          <PanelSection label="What it takes" note="Both, at the same time">
            <ul className="flex flex-col gap-1.5 p-2.5">
              {requirements.map((line) => (
                <li key={line.label} className="flex items-center gap-2">
                  <Icon
                    name={line.met ? 'check' : 'close'}
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      line.met ? 'text-bile-300' : 'text-ink-300',
                    )}
                  />
                  <span className="font-body text-[13px] leading-snug text-ink-200">
                    {line.label}
                  </span>
                </li>
              ))}
            </ul>
          </PanelSection>
        )}
        {/* What just happened comes first. A report printed under the line saying why the button
            is now off reads as a failure: the player sees "you are short" and stops looking. The
            order here is the order of the sentence: the trade, what is left, then why they
            cannot go again. */}
        {traded !== null && (
          <PanelSection label="Off the bench">
            <p
              className="p-2.5 font-body text-[13px] leading-relaxed text-ink-100"
              data-testid="reimagine-result"
              role="status"
            >
              {pageName(traded.spent)} went in. {pageName([traded.gained])} came out.
            </p>
          </PanelSection>
        )}
        <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {spare === 0
            ? 'No spare pages to trade with yet'
            : `${spare} spare ${spare === 1 ? 'page' : 'pages'} in the satchel`}
        </p>
        {open && refusal !== null && (
          <p
            className="font-body text-[13px] leading-snug text-ink-300"
            data-testid="reimagine-refusal"
          >
            {REIMAGINING_REFUSALS[refusal]}
          </p>
        )}
        {/* A refusal from the server, which is a different thing from the one above: this crew
            passed the check the page could make and something changed underneath it. Unseating the
            Head of Research in another tab is the ordinary way to get here. The message is put
            through the same map, because the route answers with the machine name and a panel that
            printed `not_available` at a player would be telling them nothing. */}
        {trade.error !== null && (
          <p role="alert" className="font-body text-[13px] text-oxblood-300">
            {REIMAGINING_REFUSALS[trade.error.message as ReimaginingRefusal] ?? trade.error.message}
          </p>
        )}
      </div>
    </Panel>
  );
}
