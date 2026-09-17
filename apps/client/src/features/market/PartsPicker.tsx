import { ITEM_CATALOG, ITEM_IDS, type Inventory, type ItemId } from '@frontline/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { Icon } from '../../components/ui/Icon';
import { RARITY_TEXT } from '../../lib/rarity';
import { cn } from '../../lib/cn';

/**
 * Putting parts into an offer (maintainer request, 2026-09-14).
 *
 * The composer was materials-only: the wire has always carried `items` on both sides of a bundle
 * and `offerRefusal` has always checked them for tradeability, but no screen ever filled the field.
 * So a crew sitting on four Ceramic Plates they would never fit had no way to turn them into the
 * Coolant Cell they were stuck on, and the only market for parts was the Runner's one-way barrow.
 *
 * ## Why a menu and not eight more tiles
 *
 * The resource row is eight tiles because there are six materials and they are the same six on
 * every offer anybody has ever made. Parts are different: there are eight of them, most crews hold
 * two or three, and which ones you hold is the whole question. Eight permanently-dimmed tiles would
 * put the answer to "what can I trade" behind reading every one of them. A single door that opens
 * on what is actually in the bin answers it in one press, and it costs the row no width.
 *
 * ## Drawn, because the market is paper
 *
 * The sheet is an `ink-frame card-paper` panel and the door is the `.ink-box` stroke, which is what
 * every other drawn control on this screen wears. The tally on the door is the count, so a player
 * can see there is something in the offer without opening it.
 */
export function PartsPicker({
  label,
  chosen,
  held,
  onChange,
  testId,
}: {
  /** The side this belongs to, for the labels a screen reader reads. */
  label: string;
  /** What is already in this side of the offer. */
  chosen: Inventory;
  /** What the crew is holding, which is what may be put in. */
  held: Inventory;
  onChange: (next: Inventory) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');

  /*
   * Shuts on a press anywhere else, the way `Dropdown` and the standings search do.
   *
   * A menu that only closes on its own button is a menu left hanging over the composer while a
   * player fills in the other half of the deal. `pointerdown` rather than `click`, so it shuts on
   * the way down and does not swallow the press that opened something else.
   */
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  const parts = ITEM_IDS.filter((one) => ITEM_CATALOG[one].kind === 'component');
  const inBin = parts.filter((one) => (held[one] ?? 0) > 0);
  const count = parts.reduce((sum, one) => sum + (chosen[one] ?? 0), 0);

  const set = (part: ItemId, amount: number): void => {
    const next = { ...chosen };
    if (amount <= 0) delete next[part];
    else next[part] = amount;
    onChange(next);
  };

  return (
    /*
     * `self-start`, and it is load-bearing rather than cosmetic.
     *
     * This wrapper is a flex item in the row of material tiles, so it stretches to the row's height
     * by default. The menu is positioned `top-full`, which is 100% of *this* element: measured, the
     * wrapper was 241px tall against a 44px button, and the menu opened 197px below the door it
     * belongs to, next to the other side's row. Shrink-wrapping the wrapper makes "below the door"
     * mean below the door.
     */
    <div ref={box} className="relative self-start">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Parts into ${label}`}
        data-testid={testId}
        data-sound="click"
        className={cn(
          'ink-box flex h-11 items-center gap-2 px-3 font-stamp text-[13px] leading-none',
          'transition-colors',
          count > 0 ? 'text-brass-100' : 'text-brass-300 hover:text-brass-100',
        )}
      >
        <Icon name="inventory" aria-hidden className="h-4 w-4" />
        Parts
        {count > 0 && (
          <span
            className="rounded-sm bg-brass-500/30 px-1.5 py-px font-display text-[11px] font-bold tabular-nums"
            data-testid={`${testId}-count`}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Parts into ${label}`}
          data-testid={`${testId}-menu`}
          /*
           * Below the door, on an opaque ground.
           *
           * Two things a screenshot caught and nothing else would have. It opened *upward* first,
           * which put it straight over the listing panel above the composer; the space on this
           * screen is below the form, not above it. And `.card-paper` is a stack of translucent
           * gradients (0.9 to 0.96 alpha) with no ground of its own, which is right for a panel
           * laid on the scene and wrong for a menu floating over other panels: the listing behind
           * it read straight through the sheet.
           *
           * So: `bg-surface-950` under the paper, and **no `washed` or `grain`**. Those two are the
           * cloud and the noise every panel wears, and both work with `mix-blend-mode`, which
           * blends an element with what is behind it. That is the effect on a panel lying on the
           * scene and a bug on a menu floating over other panels: the listing underneath came
           * through the blend however opaque the ground was. A popover is the one place in this
           * interface that has to be solid.
           */
          className="ink-frame card-paper absolute left-0 top-full z-30 mt-2 w-[19rem] rounded-sm shadow-panel"
          /*
           * Inline, because a utility class cannot win this one.
           *
           * `.card-paper` sets the `background` *shorthand*, and a shorthand resets
           * `background-color` to transparent as part of itself. `bg-surface-950` was measured at
           * `rgba(0, 0, 0, 0)` on the mounted element: the class was applied and did nothing. An
           * inline style is the only declaration that lands after the shorthand.
           */
          style={{ backgroundColor: 'rgb(23 19 32)' }}
        >
          <header className="relative flex items-baseline justify-between gap-2 px-3 pb-2 pt-2.5">
            <h4 className="font-stamp text-[14px] leading-none text-brass-300">The parts bin</h4>
            <span className="font-display text-[9px] font-bold uppercase tracking-[0.16em] text-ink-400">
              {label}
            </span>
            <span aria-hidden className="ink-rule absolute inset-x-3 -bottom-px" />
          </header>

          {inBin.length === 0 ? (
            <p
              className="px-3 py-5 text-center font-body text-[12.5px] italic leading-snug text-ink-300"
              data-testid={`${testId}-empty`}
            >
              Nothing in the bin. Parts turn up on long jobs and on the Runner&rsquo;s barrow.
            </p>
          ) : (
            <ul className="flex flex-col p-2">
              {inBin.map((part) => {
                const spec = ITEM_CATALOG[part];
                const taking = chosen[part] ?? 0;
                const stock = held[part] ?? 0;
                return (
                  <li
                    key={part}
                    data-testid={`${testId}-row-${part}`}
                    className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 hover:bg-brass-300/10"
                  >
                    <ItemGlyph id={part} className="h-6 w-6 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-stamp text-[13px] leading-tight text-ink-100">
                        {spec.name}
                      </span>
                      <span
                        className={cn(
                          'font-display text-[9px] font-bold uppercase tracking-[0.15em]',
                          RARITY_TEXT[spec.rarity],
                        )}
                      >
                        {stock} held
                      </span>
                    </span>

                    {/* Stepper rather than a free field: nobody types "7" into an offer, and a
                        number input here is a keyboard trap between two drawn controls. */}
                    <span className="flex shrink-0 items-center gap-1">
                      <Step
                        sign="-"
                        disabled={taking === 0}
                        onPress={() => set(part, taking - 1)}
                        label={`One less ${spec.name}`}
                        testId={`${testId}-less-${part}`}
                      />
                      <span
                        className="w-5 text-center font-stamp text-[14px] leading-none tabular-nums text-ink-100"
                        data-testid={`${testId}-taking-${part}`}
                      >
                        {taking}
                      </span>
                      <Step
                        sign="+"
                        // Never more than the bin holds: the server refuses it and the refusal
                        // would arrive after the listing had already escrowed the rest.
                        disabled={taking >= stock}
                        onPress={() => set(part, taking + 1)}
                        label={`One more ${spec.name}`}
                        testId={`${testId}-more-${part}`}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <span aria-hidden className="ink-rule mx-3 block" />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <button
              type="button"
              onClick={() => onChange({})}
              disabled={count === 0}
              data-testid={`${testId}-clear`}
              className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400 transition-colors hover:text-oxblood-100 disabled:opacity-40 disabled:hover:text-ink-400"
            >
              Take them out
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              data-testid={`${testId}-done`}
              className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-brass-300 transition-colors hover:text-brass-100"
            >
              Done
            </button>
          </div>

          {/* The drawn tail, so the sheet points at the door it came out of. */}
          <svg
            aria-hidden
            viewBox="0 0 24 12"
            className="absolute -top-[10px] left-6 h-3 w-6 rotate-180 text-brass-300"
          >
            <defs>
              <filter id={`tail-${id}`}>
                <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="4" />
                <feDisplacementMap in="SourceGraphic" scale="1.1" />
              </filter>
            </defs>
            <g filter={`url(#tail-${id})`}>
              <path d="M1 1 L12 10 L23 1" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}

function Step({
  sign,
  disabled,
  onPress,
  label,
  testId,
}: {
  sign: '+' | '-';
  disabled: boolean;
  onPress: () => void;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-sm border border-surface-500/70',
        'font-stamp text-[13px] leading-none text-ink-200 transition-colors',
        'hover:border-brass-300 hover:text-brass-100 disabled:opacity-30 disabled:hover:border-surface-500/70 disabled:hover:text-ink-200',
      )}
    >
      {sign}
    </button>
  );
}
