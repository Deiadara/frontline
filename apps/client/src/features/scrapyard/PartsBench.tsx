import { ITEM_CATALOG, ITEM_IDS, type ItemCost } from '@frontline/shared';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { RARITY_INK } from '../../lib/rarity';
import { cn } from '../../lib/cn';
import { BENCH_BOARD, BENCH_TRAY, SLOT_WELL } from './template';

/**
 * What is in the parts bin, on the bench that spends it (maintainer request, 2026-09-14).
 *
 * Components used to live on the Inventory page, which was a screen whose whole job was to be a list of
 * four unrelated kinds of thing. They belong here: the Scrapyard is the only place in the game that
 * *consumes* a component, through refits, and the district's build gates are the only other sink.
 * A player looking at a Hardshell Rig that wants eight Ceramic Plates should be one tab away from
 * seeing that they hold two, rather than on another screen entirely.
 *
 * Read-only on purpose. There is nothing to press: a component is spent by building the thing that
 * needs it, and a button here would be a second way to do what the bench beside it already does.
 *
 * ## Only what is in the bin
 *
 * The first cut drew every component in the game, including the ones held at zero, on the argument
 * that "what am I short of" is the useful question. It is not what a bin is for: a row reading
 * `Gyro Assembly 0` is a row about nothing, and eight of them is a screen that looks full and says
 * nothing (maintainer request, 2026-09-14). A part appears when the crew has one and goes when the
 * last is spent, so the bin always describes what is actually in it.
 *
 * What a refit needs and whether you have it is answered where the question is asked, on the refit
 * itself, which prices every part it wants against the bin.
 */
export function PartsBench({ held }: { held: ItemCost }) {
  const parts = ITEM_IDS.filter(
    (id) => ITEM_CATALOG[id].kind === 'component' && (held[id] ?? 0) > 0,
  );
  const total = parts.reduce((sum, id) => sum + (held[id] ?? 0), 0);

  return (
    <section className={cn(BENCH_BOARD, 'flex flex-col gap-3')} data-testid="scrapyard-parts">
      <header className="relative flex items-baseline justify-between gap-3 px-4 pb-2.5 pt-3">
        <h3 className="font-stamp text-[15px] leading-none text-brass-300">The parts bin</h3>
        <span
          className="font-display text-[10px] font-bold uppercase tracking-[0.16em] tabular-nums text-ink-300"
          data-testid="scrapyard-parts-total"
        >
          {total} held
        </span>
        <span aria-hidden className="absolute inset-x-4 -bottom-px h-px bg-surface-600/70" />
      </header>

      {/* No standing blurb over the bin (maintainer request, 2026-09-15). Where parts come from is
          already said by the empty state, and the bin's job is to say what is in it. */}
      {parts.length === 0 ? (
        <p
          className="px-4 pb-5 pt-2 text-center font-body text-[13px] italic leading-snug text-ink-300"
          data-testid="scrapyard-parts-empty"
        >
          The bin is empty. Parts turn up on long jobs, on the Runner&rsquo;s barrow, and in the
          back room.
        </p>
      ) : (
        <ul className={cn(BENCH_TRAY, 'px-4 pb-4 sm:grid-cols-2 xl:grid-cols-4')}>
          {parts.map((id) => {
            const spec = ITEM_CATALOG[id];
            const count = held[id] ?? 0;
            return (
              <li
                key={id}
                data-testid={`scrapyard-part-${id}`}
                className={cn(
                  SLOT_WELL,
                  'flex items-center gap-2.5 rounded-sm border border-surface-700 px-2.5 py-2',
                )}
              >
                <ItemGlyph id={id} className="h-7 w-7 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-stamp text-[13px] leading-tight text-ink-100">
                    {spec.name}
                  </span>
                  <span
                    className={cn(
                      'font-display text-[9px] font-bold uppercase tracking-[0.16em]',
                      RARITY_INK[spec.rarity],
                    )}
                  >
                    {spec.rarity}
                  </span>
                </span>
                <span
                  className="shrink-0 font-stamp text-[16px] leading-none tabular-nums text-ink-100"
                  data-testid={`scrapyard-part-count-${id}`}
                >
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
