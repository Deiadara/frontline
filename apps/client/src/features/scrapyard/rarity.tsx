import { MODIFICATION_RARITY_LABELS, type ModificationRarity } from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * The four rarities as four colours (maintainer request, 2026-09-15): grey, purple, red, gold.
 *
 * One table for every door that shows a card: the two Scrapyard benches, the roster's brackets and
 * their picker, and the structure dialog's picker. A player who learns that purple means INTRICATE
 * on the bench must find purple meaning INTRICATE on the bracket, so the classes live here and
 * nowhere else.
 *
 * The four are drawn from the palette rather than invented: `ink` is the reading grey, `iris` the
 * selection purple, `oxblood` the one loud red, and `brass` the sodium gold every decision wears.
 * Every class names a shade `theme/tokens.ts` defines; `palette-classes.test.ts` fails the build
 * on one that does not.
 */

/** The colour on its own, for a glyph or a heading. */
export const RARITY_TEXT: Readonly<Record<ModificationRarity, string>> = {
  basic: 'text-ink-300',
  intricate: 'text-iris-300',
  advanced: 'text-oxblood-300',
  masterpiece: 'text-brass-300',
};

/** The tag: a thin border in the colour with the word inside it, lit a step brighter. */
const RARITY_TAG: Readonly<Record<ModificationRarity, string>> = {
  basic: 'border-ink-500/70 text-ink-300',
  intricate: 'border-iris-300/60 text-iris-100',
  advanced: 'border-oxblood-300/60 text-oxblood-100',
  masterpiece: 'border-brass-300/60 text-brass-100',
};

/** A filled bracket on the roster: border and text in the colour. */
export const RARITY_BRACKET: Readonly<Record<ModificationRarity, string>> = {
  basic: 'border-ink-500/70 text-ink-200',
  intricate: 'border-iris-300/60 text-iris-100',
  advanced: 'border-oxblood-300/60 text-oxblood-100',
  masterpiece: 'border-brass-300/60 text-brass-100',
};

/** The word, stamped small in its colour. */
export function RarityTag({
  rarity,
  className,
}: {
  rarity: ModificationRarity;
  className?: string;
}) {
  return (
    <span
      data-testid={`rarity-${rarity}`}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.1em]',
        RARITY_TAG[rarity],
        className,
      )}
    >
      {MODIFICATION_RARITY_LABELS[rarity]}
    </span>
  );
}
