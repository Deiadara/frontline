import { PERK_CATEGORY_LABELS, describePerkBonus, findPerk } from '@frontline/shared';
import { DescribedTag } from './ui/DescribedTag';

/**
 * Somebody's perks, as a row of chips with the bonus one hover away.
 *
 * This was `TraitTags`, and the change is what a keyword *means*. A trait moved two of the
 * carrier's own attributes, so its hover restated numbers already printed on the same card. A perk
 * moves the **crew's** numbers, so the hover is the only place the bonus appears at all: the chip
 * is the whole reason to hire this person over the one next to them.
 *
 * Three screens draw this: the Bar's recruit card, the crew list and the Overseer's profile. All
 * three carried their own copy of the row byte for byte, and the copies had already begun to
 * drift, which is why this takes a `tone` rather than a `className`. The three looks were
 * deliberate (a keyword on a lilac profile panel is not one on a dark roster card), so they are
 * kept, but as named options rather than hand-typed class strings nobody can diff.
 */

/** The three grounds a perk row is drawn on. */
export const PERK_TONES = {
  /** On a dark card, beside a portrait. */
  card: 'border-surface-600 text-ink-200',
  /** On a dark panel, in a field. One step quieter, because the row is denser there. */
  panel: 'border-surface-600 text-ink-300',
  /** On the Overseer's own profile, where the chrome is brass throughout. */
  profile: 'border-brass-300/50 text-brass-300',
} as const;
export type PerkTone = keyof typeof PERK_TONES;

/**
 * What a perk is worth, in one line.
 *
 * Delegated to `describePerkBonus`, which shares its wording with the district screen's describer for
 * captured location pays. A perk and a plot of ground granting `+6% build speed` are the same
 * sentence and they should read as the same sentence; writing a second describer here is how the
 * two come to disagree about whether it is "build speed" or "faster builds".
 */
export function perkDetail(id: string): string {
  const perk = findPerk(id);
  return perk ? describePerkBonus(perk.bonus) : '';
}

export interface PerkTagsProps {
  perks: readonly string[];
  tone?: PerkTone;
  /** Which side the hover card hangs from, for a row near the bottom of a frame. */
  side?: 'top' | 'bottom';
}

/** Renders nothing at all for somebody with no perks, so a caller needs no guard of its own. */
export function PerkTags({ perks, tone = 'card', side }: PerkTagsProps) {
  const found = perks.map(findPerk).filter((perk) => perk !== undefined);
  if (found.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {found.map((perk) => (
        <DescribedTag
          key={perk.id}
          label={perk.name}
          description={`${PERK_CATEGORY_LABELS[perk.category]}. ${perk.description}`}
          detail={perkDetail(perk.id)}
          {...(side ? { side } : {})}
          className={PERK_TONES[tone]}
        />
      ))}
    </div>
  );
}
