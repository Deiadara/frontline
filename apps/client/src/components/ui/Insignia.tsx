import type { LocationHolderKind } from '@frontline/shared';
import { cn } from '../../lib/cn';
import { DrawnGlyph } from './DrawnMarks';
import type { IconName } from './Icon';

/**
 * The two parties that are nobody's crew, and the marks they fight under (maintainer, 2026-09-30).
 *
 * The Combine's winged cross and the looters' sprayed skull, drawn in the icon set's own stroke and
 * put through the pen (`DrawnGlyph`), so they sit beside the other glyphs as one hand. Wherever the
 * game names either party as the one standing on ground, in a fight or in a report, the mark goes
 * beside the name: a player learns to read who is there before reading the words.
 */
export type InsigniaHolder = Extract<LocationHolderKind, 'government' | 'looters'>;

const GLYPH: Record<InsigniaHolder, IconName> = { government: 'combine', looters: 'looters' };

/*
 * The holder colours from `city/holder.ts`: the Combine's tangerine and the looters' yellow. Kept
 * as literals here rather than imported, because that table is the city feature's and this is kit;
 * `Insignia.test.tsx` holds the two to the same ink.
 */
export const INSIGNIA_INK: Record<InsigniaHolder, string> = {
  government: 'text-tangerine-300',
  looters: 'text-ember-100',
};

export function hasInsignia(kind: LocationHolderKind): kind is InsigniaHolder {
  return kind === 'government' || kind === 'looters';
}

/**
 * The mark for `holder`, or nothing for a crew or empty ground.
 *
 * Decoration by default: it sits beside the party's name, and a reader would hear the name twice.
 * `label` makes it an image of its own, for the one place it stands in for the words.
 *
 * `tone` off keeps whatever colour the surrounding text is, for a line that is already coloured by
 * something else and would read as two parties if the mark wore its own ink.
 */
export function Insignia({
  holder,
  className,
  label,
  tone = true,
}: {
  holder: LocationHolderKind;
  /** Size classes. The mark has no default size: it has to match the text beside it. */
  className?: string;
  label?: string;
  tone?: boolean;
}) {
  if (!hasInsignia(holder)) return null;
  return (
    <span
      data-testid={`insignia-${holder}`}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={cn('inline-flex shrink-0', tone && INSIGNIA_INK[holder], className)}
    >
      <DrawnGlyph name={GLYPH[holder]} className="h-full w-full" />
    </span>
  );
}
