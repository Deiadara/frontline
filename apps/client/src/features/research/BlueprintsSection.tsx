import {
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_CATEGORY_LABELS,
  BLUEPRINT_UNLOCK_MESSAGES,
  knownBlueprints,
  ITEM_RARITY_LABELS,
  pageRarity,
  type BlueprintCategory,
  type BlueprintUnlockRefusal,
  type BlueprintHolding,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { cn } from '../../lib/cn';
import { useMarket, useUnlockBlueprint } from '../../lib/queries';
import { RARITY_INK, RARITY_TONE } from '../../lib/rarity';
import { BlueprintGlyph, PageGlyph } from './BlueprintGlyph';

/**
 * The Blueprints tab of the research page (§D4 to §D11, §I1d).
 *
 * A blueprint is a document made of named pages, and this screen is the only place the collection
 * is visible. Its whole shape comes from §D5: **a document you hold no pages of is not on this
 * screen at all.** There is no greyed-out row, no "?? of 8", no count of what is left in the game.
 * The first page you find is the first time you learn the thing exists, and everything else here
 * follows from wanting that moment to land.
 *
 * ## One document per line, and the pages across it
 *
 * Three category panels side by side is what this was until the maintainer's 2026-09-10 call, and the
 * arithmetic killed it: a third of the frame is about 340px, and the Colossus has eight pages, so
 * the sheets went down the card one per line and a single document was most of a screen. A document
 * is a row now. The cover and its words hold a fixed column on the left, the pages run across the
 * middle as sheets, and the control sits on the right, which puts eight pages on one line at 1280
 * and reads as a drawer of documents rather than as three stacks of cards.
 *
 * The category is a choice rather than a column, and "Show unlocked" is a switch rather than a
 * second view: §D10 still says a finished document leaves the pile a player is working through, and
 * a switch says that without hiding the shelf behind a tab a player has to remember to check.
 * Neither is persisted, so both come back off by default, which is the state that answers "what am
 * I short of".
 *
 * ## Everything is read off the satchel
 *
 * Pages and finished documents are items, so this screen needs no endpoint of its own: it reads
 * `inventory` off the market payload, the same object the Satchel is drawn from. The one write is
 * Unlock. It lived inside the Satchel until §I1d moved it here, beside the programmes the Lab runs,
 * because both answer the same question: what can be opened next.
 */
export function BlueprintsSection() {
  const query = useMarket();
  const unlock = useUnlockBlueprint();
  const [showUnlocked, setShowUnlocked] = useState(false);
  /*
   * Null until the player picks, rather than 'unit' from the start.
   *
   * A crew whose only pages are recipes would otherwise open on an empty Unit drawer with two
   * populated ones beside it, which reads as a screen that failed to load. Null falls through to
   * the first drawer that has anything in it, and stops doing that the moment somebody chooses.
   */
  const [chosen, setChosen] = useState<BlueprintCategory | null>(null);

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
  const shown = showUnlocked ? known : known.filter((holding) => holding.status !== 'unlocked');
  const countIn = (category: BlueprintCategory) =>
    shown.filter((holding) => holding.blueprint.category === category).length;
  const category = chosen ?? BLUEPRINT_CATEGORIES.find((one) => countIn(one) > 0) ?? 'unit';
  const rows = shown.filter((holding) => holding.blueprint.category === category);

  return (
    <div className="flex flex-col gap-3" data-testid="blueprints-section">
      {/*
       * Said on the page, not folded into a note chip.
       *
       * `InfoNote` is a hover: collapsed, it is a 150px chip and nothing else, so a crew holding
       * no pages opened this door on an empty screen with one word on it and no way to tell that
       * from a failed read. The chip is right for a rule somebody might want and wrong for the
       * only sentence explaining why the screen is bare, which is the call the crew screen already
       * made for its own empty state.
       */}
      {known.length === 0 ? (
        <p
          className="max-w-prose font-body text-[13px] leading-relaxed text-ink-300"
          data-testid="blueprints-empty"
        >
          Nothing here yet. A blueprint is a set of named pages, and you have none of them. Pages
          come back from missions, turn up on the Black Market for infamy, and once in a while the
          Runner is carrying one. Collect every page of a document and you can unlock it for good.
        </p>
      ) : (
        <>
          {/* A rule between the archive's own strip and the cabinet under it. */}
          <span aria-hidden className="ink-rule block" />

          {/* The cabinet: an inner menu of its own (maintainer, 2026-09-10). A hand-ruled frame round the
              drawers and the list they open, so the three drawers and the switch read as one
              piece of furniture inside the archive rather than a second row of the archive's own
              tabs. The drawers are inked in verdigris, the archive's tabs in brass, for the same
              reason: they are not the same kind of door. */}
          <div
            className="ink-frame card-paper washed flex flex-col gap-3 p-3"
            data-testid="blueprint-cabinet"
          >
            <div className="flex flex-wrap items-center gap-2" data-testid="blueprint-categories">
              {BLUEPRINT_CATEGORIES.map((one) => (
                <CategoryButton
                  key={one}
                  category={one}
                  count={countIn(one)}
                  selected={one === category}
                  onSelect={() => setChosen(one)}
                />
              ))}
              <div className="ml-auto">
                <ShowUnlocked on={showUnlocked} onToggle={() => setShowUnlocked(!showUnlocked)} />
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="font-body text-[13px] leading-relaxed text-ink-300">
                {showUnlocked ? 'Nothing in this drawer at all.' : EMPTY_COPY[category]}
              </p>
            ) : (
              /*
               * `auto-rows-fr` rather than a height on the row.
               *
               * Every row has to be the same height, and what makes one tall is the page strip
               * wrapping, which only happens under 1280. A fixed height would either cut the second
               * line of sheets there or leave a band of empty paper at every width above it; equal
               * `fr` tracks in an auto-height grid come out at the tallest row's own content, so the
               * list squares up at every width without a number in it.
               */
              <ul
                className="drafting-grid edge-lit grid auto-rows-fr gap-2.5 rounded-sm border border-surface-500 p-3"
                data-testid={`blueprints-${category}`}
              >
                {rows.map((holding) => (
                  <DocumentRow
                    key={holding.blueprint.id}
                    holding={holding}
                    pending={unlock.isPending}
                    onUnlock={(blueprintId) => unlock.mutate({ blueprintId })}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
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
    </div>
  );
}

/**
 * The switch, drawn as a box somebody ticks rather than as a second tab.
 *
 * `role="switch"` rather than a checkbox input: it is a filter on a list, it takes effect on the
 * press, and there is no form here to submit. A real `<input type="checkbox">` would need its own
 * label plumbing to say the same thing to a screen reader that `aria-checked` says here.
 */
function ShowUnlocked({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      data-testid="show-unlocked"
      className={cn(
        'ink-box-verdigris flex w-fit items-center gap-2.5 px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.14em] transition-colors',
        on
          ? 'bg-verdigris-500/25 text-verdigris-100'
          : 'text-verdigris-300/80 hover:bg-verdigris-500/10 hover:text-verdigris-100',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'tick-box flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border',
          on ? 'border-verdigris-300/80' : 'border-verdigris-300/40',
        )}
      >
        {on && <Icon name="check" className="h-3 w-3" />}
      </span>
      Show unlocked
    </button>
  );
}

/** One drawer of the cabinet, with the paper flag on its side and how many documents are in it. */
function CategoryButton({
  category,
  count,
  selected,
  onSelect,
}: {
  category: BlueprintCategory;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid={`blueprint-category-${category}`}
      className={cn(
        // Hand-inked, in verdigris: the drawers are not the archive's tabs and must not look like
        // them. `ink-box-verdigris` is the stroke; the plate under it is the selected state.
        'ink-box-verdigris relative px-5 py-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] transition-colors',
        selected
          ? 'bg-verdigris-500/25 text-verdigris-100 [text-shadow:0_0_8px_rgb(95_188_175/0.45)]'
          : 'text-verdigris-300/80 hover:bg-verdigris-500/10 hover:text-verdigris-100',
      )}
    >
      {BLUEPRINT_CATEGORY_LABELS[category]}
      <span className="ml-2 tabular-nums opacity-80">{count}</span>
    </button>
  );
}

const EMPTY_COPY: Readonly<Record<BlueprintCategory, string>> = {
  unit: 'No pages for anything that fights or drives. Missions bring them back.',
  upgrade: 'Nothing for the yard yet.',
  consumable: 'No recipes. The ones worth having are made the night before a fight.',
};

/**
 * One document, across the row (§D6 to §D10).
 *
 * Three columns and they do three different jobs: what the thing is, what is missing, and what can
 * be done about it. Darkened while it is incomplete and lit once it is not, which is the whole of
 * §D6 and §D10's "the bar goes to normal colour". The lock sits on the document rather than on the
 * sheets: it is the blueprint that is shut, and the sheets are the reason.
 */
function DocumentRow({
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
    <li
      data-testid={`blueprint-${blueprint.id}`}
      data-status={status}
      className={cn(
        'edge-lit grid items-center gap-3 rounded-sm border p-3',
        'grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)_8.5rem]',
        // Every row carries a drawn edge and a plate of its own. The short ones used to sit at
        // 75% opacity on a half-transparent plate, which on the drafting grid read as a row that
        // had not loaded rather than a document still short of pages (maintainer, 2026-09-10).
        unlocked
          ? 'border-bile-300/70 bg-bile-300/15'
          : complete
            ? 'border-brass-300/80 bg-surface-800/90 shadow-brass'
            : 'border-surface-500/80 bg-surface-900/80',
      )}
    >
      {/*
       * The cover at 72px, beside the name and over the blurb.
       *
       * 72px is where the hull curve, the rotor and the gear stop being suggestions, and the column
       * is fixed so that every row on the list starts its page strip at the same x. Rarity is on
       * the glyph's ink and on the word under the name, not on the row's border: that border is
       * already saying the thing §D6 wants said, which is whether the document is short or
       * finished. Two meanings on one edge is one meaning.
       */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-start gap-2.5">
          <BlueprintGlyph
            blueprint={blueprint}
            size="lg"
            className="h-[72px] w-[72px] shrink-0 rounded-sm"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <h3 className="min-w-0 break-words font-display text-[14px] font-bold leading-tight text-ink-100">
                {blueprint.name}
              </h3>
              {!unlocked && (
                <Icon name="lock" label="Locked" className="h-4 w-4 shrink-0 text-ink-300" />
              )}
            </div>
            <p
              className={cn(
                'font-display text-[11px] font-bold uppercase tracking-[0.16em]',
                RARITY_INK[blueprint.rarity],
              )}
              data-testid={`rarity-${blueprint.id}`}
            >
              {ITEM_RARITY_LABELS[blueprint.rarity]}
            </p>
          </div>
        </div>
        <p className="break-words font-body text-[12px] leading-snug text-ink-200">
          {blueprint.blurb}
        </p>
      </div>

      <PageStrip holding={holding} />

      <div className="flex flex-col items-start gap-2 md:items-end">
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          {unlocked ? `${total} pages` : `${distinctHeld} of ${total} pages`}
        </span>
        {unlocked ? (
          <span className="rubber-stamp font-display text-[12px] font-bold uppercase tracking-[0.2em]">
            Unlocked
          </span>
        ) : (
          <Button size="sm" disabled={!complete || pending} onClick={() => onUnlock(blueprint.id)}>
            Unlock
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The pages, across the row (§D6, §D8).
 *
 * Sheets rather than squares. A square could answer one question, in or out, and that was the right
 * answer while every page looked and read the same. Pages have names, drawings and rarities of
 * their own now: at 44px the Reactor Housing and the Ignition Sequence are two different sheets
 * from across the room, and at 20px they were two identical dots.
 *
 * 88px of width per sheet, which is what puts the Colossus' eight on one line inside the middle
 * column at 1280 and lets the longest page name in the game ("Counterweights") set without
 * breaking. Under that the strip wraps, and the grid above squares the rows back up.
 *
 * Held or missing is carried by the tile rather than said in words: a held page is lit and a
 * missing one is dimmed to the edge of legible, so the shape of what is left reads across the row
 * without anybody having to read it.
 *
 * An unlocked document draws every sheet held. The pages were spent assembling it, so counting them
 * again would draw an empty strip under the one thing on this screen that is finished. A copy found
 * *after* it was assembled still gets its number, because that copy is spendable.
 */
function PageStrip({ holding }: { holding: BlueprintHolding }) {
  const { blueprint } = holding;
  const unlocked = holding.status === 'unlocked';
  return (
    <ul className="flex flex-wrap items-stretch gap-1.5" data-testid={`pages-${blueprint.id}`}>
      {holding.pages.map(({ page, held }) => {
        const filled = unlocked || held > 0;
        const rarity = pageRarity(blueprint, page);
        return (
          <li
            key={page.id}
            data-tip={`${page.name}. ${ITEM_RARITY_LABELS[rarity]}. ${page.description}`}
            data-held={filled ? 'yes' : 'no'}
            data-rarity={rarity}
            className={cn(
              // 84px: eight of these and their seven gaps have to fit the 734px the cabinet's
              // frame leaves the strip at 1280 (measured), which 88px tiles overran by twelve.
              'relative flex w-[5.25rem] flex-col items-center gap-1 rounded-[2px] border p-1',
              RARITY_TONE[rarity],
              filled ? 'bg-surface-800/70' : 'border-surface-700 bg-surface-950/50 opacity-45',
            )}
          >
            <PageGlyph page={page} blueprint={blueprint} size="md" className="h-10 w-10 shrink-0" />
            <span className="w-full break-words text-center font-display text-[10px] leading-[1.2]">
              {page.name}
            </span>
            <span className="sr-only">{filled ? 'held' : 'missing'}</span>
            {/* The threshold differs because "spare" does. On a document still being collected the
                first copy is doing a job, so two is one spare. On an unlocked one the pages were
                already spent assembling it, so every copy still in the satchel is spare and a
                single one is worth marking: Reimagining will take it. */}
            {held > (unlocked ? 0 : 1) && (
              <span
                aria-hidden
                className="absolute right-0.5 top-0.5 rounded-[2px] bg-surface-950/80 px-1 font-display text-[10px] font-bold leading-tight tabular-nums"
              >
                x{held}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
