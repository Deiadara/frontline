import { BUILDING_CATALOG, type BuildingKind, type ScrapyardEntry } from '@frontline/shared';
import { useState } from 'react';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBuildAddon, useScrapyard } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';

/**
 * The Scrapyard (§B9): its own page, not a modal on the district.
 *
 * What the yard sells is one kind of thing seen twice: a permanent add-on bolted to something the
 * crew already owns. A **modification** goes into one of a structure's three slots (§E) and is
 * fitted from that structure's own dialog; a **refit** applies to every unit of the roster forever.
 * They are listed together because the decision is the same one, and grouped by what they attach to
 * because that is how a player thinks about it: "what can I do for the Lab", not "what costs 4000".
 *
 * Every price on this page is scrap, plus high-quality metal on the advanced entries, and nothing
 * else. That is the board's rule and it is enforced on the server by the two price functions rather
 * than by this screen agreeing to show only two columns.
 */
export function ScrapyardPage() {
  const query = useScrapyard();
  const build = useBuildAddon();
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
     * the nav. This page and the Scrapyard were both added without one.
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

  const refits = data.entries.filter((entry) => entry.kind === 'upgrade');
  const byBuilding = new Map<BuildingKind, ScrapyardEntry[]>();
  for (const entry of data.entries) {
    if (entry.kind !== 'modification' || entry.building === null) continue;
    const list = byBuilding.get(entry.building) ?? [];
    list.push(entry);
    byBuilding.set(entry.building, list);
  }

  return (
    <PageShell quote="Somebody has to take it apart before anybody can put it back together." wide>
      <InfoNote label="What the yard cuts">
        Everything here is scrap, and the heavy work wants good metal as well. The advanced entries
        need a blueprint first: a modification's comes out of the Lab, a refit's off the Runner.
        Built modifications sit on the shelf until you fit them from the structure's own window.
      </InfoNote>

      <div className="grid items-start gap-5 xl:grid-cols-3">
        <Panel title="Refits: the whole roster">
          <p className="px-4 pt-3 font-body text-[13px] leading-relaxed text-ink-300">
            Bought once, and every unit you will ever field carries it.
          </p>
          <ul className="flex flex-col gap-2.5 p-4" data-testid="scrapyard-refits">
            {refits.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                stock={data.resources}
                expanded={open === entry.id}
                onToggle={() => setOpen(open === entry.id ? null : entry.id)}
                onBuild={() => build.mutate({ kind: entry.kind, id: entry.id })}
                pending={build.isPending}
              />
            ))}
          </ul>
        </Panel>

        {[...byBuilding.entries()].map(([kind, entries]) => (
          <Panel key={kind} title={BUILDING_CATALOG[kind].name}>
            <p className="px-4 pt-3 font-body text-[13px] leading-relaxed text-ink-300">
              Three slots on the {BUILDING_CATALOG[kind].shortName}. Build them here, fit them
              there.
            </p>
            <ul className="flex flex-col gap-2.5 p-4" data-testid={`scrapyard-${kind}`}>
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  stock={data.resources}
                  expanded={open === entry.id}
                  onToggle={() => setOpen(open === entry.id ? null : entry.id)}
                  onBuild={() => build.mutate({ kind: entry.kind, id: entry.id })}
                  pending={build.isPending}
                />
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      {build.error !== null && (
        <p role="alert" className="mt-4 font-body text-xs leading-relaxed text-oxblood-300">
          {build.error.message}
        </p>
      )}
    </PageShell>
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
  stock: Parameters<typeof CostLine>[0]['stock'];
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
