import {
  BLACK_MARKET_GOODS,
  CONSUMABLE_ITEM_IDS,
  ITEM_CATALOG,
  findBlackMarketGood,
  type BoostStash as Stash,
  type Inventory,
} from '@frontline/shared';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { YardGlyph } from '../scrapyard/YardGlyph';
import { StashGlyph } from './StashGlyph';

/**
 * Every boost the back room deals in, in catalogue order.
 *
 * Derived rather than hand-listed: `BLACK_MARKET_GOODS` also carries crates, refit kits, documents
 * and a hundred and sixty blueprint pages, and only the `battle_boost` rows are ever spent on a
 * fight. A hand-written array here would be a second list to keep in step with that one.
 */
const BOOST_IDS: readonly string[] = Object.values(BLACK_MARKET_GOODS)
  .filter((good) => good.kind === 'battle_boost')
  .map((good) => good.id);

/**
 * What is on the shelf at home, waiting for a fight (maintainer request, 2026-09-14).
 *
 * A boost is bought in the back room with infamy and spent on one declared fight. Until this tab
 * there was nowhere to *look* at what you were holding: the only sight of the stash was the
 * drop-down on a fight you had already opened, which answers "what can I put on this one" and not
 * "what have I got". A player deciding whether to call a fight at all was being asked to open one
 * to find out.
 *
 * It lives here rather than on the Inventory page, which is gone. A boost is not a thing you
 * carry: it is a favour owed by somebody in the back room, and the only screen it is ever spent
 * from is this one.
 *
 * Read-only. A boost is attached to a fight from that fight's own panel, where the choice is in
 * front of the thing it affects; a second way to spend one from here would be a decision taken
 * away from its consequences.
 */

/**
 * One thing held, in the shape this tab draws, whichever shelf it came off.
 *
 * Boosts arrive from the back room's ledger and traps out of the inventory, through two different
 * catalogues with two different field names for the same sentence (`effect` against `usedFor`).
 * Flattening both to this at the door is what lets one row component and one opened card serve
 * the whole tab, rather than each shelf growing its own pair that drift apart.
 */
interface Held {
  id: string;
  name: string;
  /** What it does, in the player's words. */
  what: string;
  /** The flavour line, where the catalogue carries one. Only the opened card shows it. */
  flavour?: string;
  /** How many are held. **Zero is a real value here**: an empty slot is still drawn. */
  count: number;
  /** Which shelf, for the tag on the opened card. */
  shelf: 'Boost' | 'Trap';
}

export function BoostStash({ stash, inventory }: { stash: Stash; inventory: Inventory }) {
  /** Which one is open, by id. Null is the shelf itself. */
  const [open, setOpen] = useState<string | null>(null);

  /*
   * Walked off the stash rather than off the catalogue.
   *
   * The catalogue is a record of everything the back room has ever sold, boosts and crates alike,
   * and most of it is not a boost at all. What a crew is holding is the smaller, truer list, and
   * an id the catalogue no longer knows is dropped rather than crashing the tab it is on.
   */
  const boosts: Held[] = BOOST_IDS.flatMap((id) => {
    const good = findBlackMarketGood(id);
    if (good === undefined) return [];
    return [
      {
        id,
        name: good.name,
        what: good.effect,
        flavour: good.description,
        count: stash[id] ?? 0,
        shelf: 'Boost' as const,
      },
    ];
  });

  /*
   * The traps, which are the other half of "what can I take into a fight".
   *
   * A trap is an item in the inventory rather than a boost in the back room's ledger, so it arrives
   * through a different door and reads out of a different object. To a player they are one
   * question: a boost makes the fight go better and a trap makes the approach worse, and both are
   * bought, held, and spent on exactly one fight. Splitting them across two screens was what the
   * retired Inventory page was doing.
   */
  // `CONSUMABLE_ITEM_IDS`, not `ITEM_IDS`. The traps are deliberately kept out of that array so the
  // Runner's barrow and the salvage table cannot deal in them; walking it here found nothing at all.
  const traps: Held[] = CONSUMABLE_ITEM_IDS.map((id) => {
    const spec = ITEM_CATALOG[id];
    return {
      id,
      name: spec.name,
      what: spec.usedFor ?? '',
      flavour: spec.description,
      count: inventory[id] ?? 0,
      shelf: 'Trap' as const,
    };
  });

  const all = [...boosts, ...traps];
  const total = all.reduce((sum, one) => sum + one.count, 0);
  const opened = all.find((one) => one.id === open);

  return (
    <section
      className="ink-frame card-paper washed grain flex min-h-0 flex-col rounded-sm shadow-panel"
      data-testid="battle-stash"
    >
      <header className="relative flex items-baseline justify-between gap-3 px-4 pb-2.5 pt-3">
        <h3 className="font-stamp text-[15px] leading-none text-brass-300">On the shelf</h3>
        <span
          className="font-display text-[10px] font-bold uppercase tracking-[0.16em] tabular-nums text-ink-300"
          data-testid="battle-stash-total"
        >
          {total} held
        </span>
        <span aria-hidden className="ink-rule absolute inset-x-4 -bottom-px" />
      </header>

      <Slots held={boosts} onOpen={setOpen} testId="battle-stash-slots" />

      <span aria-hidden className="ink-rule mx-4 block" />
      <header className="relative flex items-baseline justify-between gap-3 px-4 pb-2 pt-3">
        <h3 className="font-stamp text-[15px] leading-none text-brass-300">Traps, ready to lay</h3>
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] tabular-nums text-ink-300">
          {traps.reduce((sum, one) => sum + one.count, 0)} held
        </span>
      </header>

      <Slots held={traps} onOpen={setOpen} testId="battle-traps" />
      {traps.every((one) => one.count === 0) && (
        <p
          className="px-4 pb-4 text-center font-body text-[13px] italic leading-snug text-ink-300"
          data-testid="battle-traps-empty"
        >
          Build some more in the Scrapyard.
        </p>
      )}

      {opened !== undefined && <StashCard held={opened} onClose={() => setOpen(null)} />}
    </section>
  );
}

/**
 * A rack of slots, one per thing the shelf can hold (maintainer request, 2026-09-15).
 *
 * Every boost and every trap gets a slot whether the crew holds one or not, which is the whole
 * point of drawing it this way. A list of only what you have answers "what have I got" and cannot
 * answer "what is there", and the second question is the one a player asks before a fight they are
 * deciding whether to call. An empty slot is a thing to go and get.
 *
 * The same shape as the district's modification brackets, for the same reason: a fixed set of
 * places, some filled, is a thing a player learns the size of once.
 */
function Slots({
  held,
  onOpen,
  testId,
}: {
  held: Held[];
  onOpen: (id: string) => void;
  testId: string;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 xl:grid-cols-6" data-testid={testId}>
      {held.map((one) => (
        <Slot key={one.id} held={one} onOpen={() => onOpen(one.id)} />
      ))}
    </ul>
  );
}

/**
 * One slot: the mark, how many, and the name under it.
 *
 * An empty slot is drawn and **not** clickable. There is nothing to say about a thing you do not
 * have that the slot has not already said by being empty, and a card that opened onto "you have 0
 * of these" would be a dead end a player can reach six ways.
 *
 * The trap marks come from `YardGlyph`, the Scrapyard's own (maintainer request, 2026-09-15). A
 * trap is cut on that bench and waits on this shelf, and it has to be the same object in both
 * places; the boosts use `StashGlyph`, because nothing in the yard sells one.
 */
function Slot({ held, onOpen }: { held: Held; onOpen: () => void }) {
  const empty = held.count === 0;
  const mark =
    held.shelf === 'Trap' ? (
      <YardGlyph mark={{ kind: 'trap', id: held.id }} className="h-7 w-7" />
    ) : (
      <StashGlyph id={held.id} className="h-7 w-7" />
    );

  return (
    <li>
      <button
        type="button"
        disabled={empty}
        onClick={onOpen}
        data-testid={`battle-stash-${held.id}`}
        data-held={empty ? undefined : 'true'}
        data-sound={empty ? undefined : 'tap'}
        className={cn(
          'group flex w-full flex-col items-center gap-1.5 rounded-sm border px-2 py-2.5',
          'transition-colors',
          empty
            ? 'cursor-default border-dashed border-surface-600/60 bg-surface-900/30'
            : cn(
                'border-surface-600/70 bg-surface-900/60',
                'hover:border-brass-300/70 hover:bg-surface-800/70',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300',
              ),
        )}
      >
        <span
          className={cn(
            'relative',
            empty ? 'text-ink-500/60' : 'text-tangerine-300 group-hover:text-brass-100',
          )}
        >
          {mark}
          {/* The count sits on the mark rather than beside it, so the row of names below stays a
              row of names. Only past one: `x1` on every filled slot is noise. */}
          {held.count > 1 && (
            <span
              className="absolute -right-2.5 -top-1.5 font-stamp text-[13px] leading-none tabular-nums text-brass-100"
              data-testid={`battle-stash-count-${held.id}`}
            >
              {held.count}
            </span>
          )}
        </span>
        <span
          className={cn(
            'w-full text-center font-display text-[9px] font-bold uppercase leading-tight tracking-[0.1em]',
            empty ? 'text-ink-500' : 'text-ink-200',
          )}
        >
          {held.name}
        </span>
      </button>
    </li>
  );
}

/**
 * The opened card: one template for everything on this tab (maintainer request, 2026-09-14).
 *
 * A boost and a trap are different objects out of different catalogues, and drawing them two ways
 * would say they are two kinds of thing to a player who is asking one question about both: what is
 * this, and what does it do to my next fight. So they share a card, and `Held` above is the shape
 * that makes that possible.
 *
 * The mark is the point of it. On the shelf it is 24px and doing the work of a bullet; here it is
 * drawn at 64 on its own plate with a hand-inked frame round it, which is the size the drawing was
 * actually made at and the only place a player gets to look at it.
 */
function StashCard({ held, onClose }: { held: Held; onClose: () => void }) {
  return (
    <Modal onClose={onClose} labelledBy={`stash-card-${held.id}`} data-testid="stash-card">
      <div className="flex flex-col gap-3.5 p-5">
        <div className="flex items-start gap-4">
          {/* The plate the mark stands on: the same drawn frame the district's structures wear, so
              an item reads as a thing in the world rather than as a row in a table. */}
          <span className="ink-frame card-paper flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-sm">
            <StashGlyph id={held.id} className="h-16 w-16 text-tangerine-300" />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-brass-300">
              {held.shelf}
            </span>
            <h2
              id={`stash-card-${held.id}`}
              className="break-words font-stamp text-[21px] leading-tight text-ink-100"
            >
              {held.name}
            </h2>
            <span
              className="font-display text-[11px] font-bold uppercase tracking-[0.16em] tabular-nums text-ink-300"
              data-testid="stash-card-count"
            >
              {held.count} held
            </span>
          </div>
        </div>

        <span aria-hidden className="ink-rule block w-full" />

        <p
          className="font-body text-[14px] leading-relaxed text-ink-100"
          data-testid="stash-card-what"
        >
          {held.what}
        </p>

        {/* The flavour line, under a rule and in the quieter ink: it is the thing the catalogue says
            about the object rather than about the fight, and a player reading for numbers should be
            able to stop before it. */}
        {held.flavour !== undefined && held.flavour !== '' && (
          <p className="font-body text-[13px] italic leading-relaxed text-ink-300">
            {held.flavour}
          </p>
        )}
      </div>
    </Modal>
  );
}
