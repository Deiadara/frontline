import { ITEM_RARITY_LABELS, type ItemRarity } from '@frontline/shared';
import { cn } from './cn';

/**
 * The four bands as four colours (maintainer request, 2026-09-15): grey, purple, red, gold.
 *
 * One table for every door that grades anything. The game used to run two: this one on the
 * Scrapyard's benches and a verdigris/iris/brass one on the market's lots and the Blueprints
 * screen, which meant purple meant one band on a bench and another on a page. The ladders were
 * folded into one on 2026-09-16, so the colours had to fold with them.
 *
 * The four are drawn from the palette rather than invented: `ink` is the reading grey, `iris` the
 * selection purple, `oxblood` the one loud red, and `brass` the sodium gold every decision wears.
 * Every class names a shade `theme/tokens.ts` defines; `palette-classes.test.ts` fails the build
 * on one that does not.
 */

/** The colour on its own, for a glyph, a heading, or a line too small to carry a frame. */
export const RARITY_TEXT: Readonly<Record<ItemRarity, string>> = {
  basic: 'text-ink-300',
  intricate: 'text-iris-300',
  advanced: 'text-oxblood-300',
  masterpiece: 'text-brass-300',
};

/** The tag: a thin border in the colour with the word inside it, lit a step brighter. */
export const RARITY_TAG: Readonly<Record<ItemRarity, string>> = {
  basic: 'border-ink-500/70 text-ink-300',
  intricate: 'border-iris-300/60 text-iris-100',
  advanced: 'border-oxblood-300/60 text-oxblood-100',
  masterpiece: 'border-brass-300/60 text-brass-100',
};

/** A filled bracket on the roster: border and text in the colour. */
export const RARITY_BRACKET: Readonly<Record<ItemRarity, string>> = {
  basic: 'border-ink-500/70 text-ink-200',
  intricate: 'border-iris-300/60 text-iris-100',
  advanced: 'border-oxblood-300/60 text-oxblood-100',
  masterpiece: 'border-brass-300/60 text-brass-100',
};

/**
 * The word, stamped small in its colour.
 *
 * `testId` is here because two screens hang an assertion off this element and they want different
 * handles: the benches want the band, so a test can find every ADVANCED card at once, and the
 * Blueprints cabinet wants the document, because it has one tag per row and the row is what the
 * test is looking for.
 */
export function RarityTag({
  rarity,
  className,
  testId,
}: {
  rarity: ItemRarity;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId ?? `rarity-${rarity}`}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.1em]',
        RARITY_TAG[rarity],
        className,
      )}
    >
      {ITEM_RARITY_LABELS[rarity]}
    </span>
  );
}
