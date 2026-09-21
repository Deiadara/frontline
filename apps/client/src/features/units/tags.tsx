import type { ReactNode } from 'react';
import { HoverCard } from '../../components/ui/HoverCard';
import { cn } from '../../lib/cn';
import { RULE_CHIP, RULE_INK, ruleTone } from './rules';

/**
 * The three chips a unit's marks band is made of, each explaining itself on a pointer.
 *
 * They were private to `UnitCard.tsx` and are here because a second card now draws the same band.
 * `UnitSheet` is the dossier for a unit nobody can hold, which is every Combine sheet, and it drew
 * the marks as **dead** chips: the same words in the same colours with nothing behind them. That
 * was not an oversight in the sheet, it was the only thing it could do, because it only ever
 * rendered inside a `pointer-events-none` hover portal where no chip can be pointed at.
 *
 * Now that the leaders' card opens on a click, the band is somewhere a pointer can reach, and a
 * second hand-written copy of these three would be two places for `Counts in the city.` to drift.
 *
 * The props are structural rather than `UnitOption['rules'][number]`, which is what lets both
 * callers pass what they have: the roster card passes the server's projection, and the dossier
 * passes `unitRules(spec)` and `UNIT_MODIFIERS` straight off the catalogue. The fields are the
 * same fields; only the road they arrived by differs.
 */

/**
 * The scrap a tag's hover is written on. Private: the three tags below are its only callers.
 *
 * The tone stays on the *name* rather than on a frame. A rule that takes something away (§ the
 * Colossus, which cannot ride) has to keep reading as a cost, and the red word does that without
 * a coloured bar that made a two-line hover look like a dialog.
 */
function TagScrap({ title, ink, children }: { title: string; ink: string; children: ReactNode }) {
  return (
    <>
      <h4 className={cn('font-stamp text-[14px] leading-none', ink)}>{title}</h4>
      <span aria-hidden className="ink-rule mt-2 block" />
      <p className="mt-2 font-body text-[13px] leading-relaxed text-ink-200">{children}</p>
    </>
  );
}

/**
 * A rule, which is not a modifier and must not look like one.
 *
 * `taunts` and `mends` change what *happens* rather than what a number is, and a player who reads
 * `SHIELD LINE` in the same verdigris chip as `CLOSE QUARTERS` will file it as another +25%. Brass,
 * which is the chrome the interface already uses for "this is a mechanism", and always first in the
 * row: a rule outranks a percentage.
 *
 * A rule can also take something away, and then it is oxblood (maintainer request, 2026-09-08): the
 * Colossus is too big to ride, and a red chip is the difference between reading that as a perk and
 * reading it as the reason the column is walking. Same red as the locked box and the missing
 * clauses, so the card has one colour for "this is against you".
 */
export function RuleTag({
  rule,
}: {
  rule: { id: string; label: string; description: string; tone?: string };
}) {
  const tone = ruleTone(rule);
  return (
    <HoverCard
      label={rule.label}
      card={
        <TagScrap title={rule.label} ink={RULE_INK[tone]}>
          {rule.description}
        </TagScrap>
      }
    >
      <span
        className={cn(
          'flex h-5 items-center whitespace-nowrap rounded-sm border px-1.5',
          'font-display text-[10px] font-semibold uppercase tracking-[0.08em]',
          RULE_CHIP[tone],
        )}
      >
        {rule.label}
      </span>
    </HoverCard>
  );
}

export function ModifierTag({
  modifier,
}: {
  modifier: { label: string; description: string; when: string };
}) {
  return (
    <HoverCard
      label={modifier.label}
      card={
        <TagScrap title={modifier.label} ink="text-verdigris-100">
          {modifier.description}{' '}
          {/*
           * The condition, folded into the sentence rather than filed under its own heading.
           *
           * It had one ("When it happens"), and the heading was longer than the answer: `when` is a
           * clause, "in the city" or "when holding ground", never a sentence. Dropping it outright
           * would have been the easy reading of the ask and the wrong one, because Ambush without
           * "in the city" is a flat +25% and the whole point of the modifier is that it is not.
           */}
          <span className="text-ink-400">Counts {modifier.when}.</span>
        </TagScrap>
      }
    >
      <span className="flex h-5 items-center whitespace-nowrap rounded-sm border border-verdigris-500/60 bg-verdigris-700/25 px-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-verdigris-100">
        {modifier.label}
      </span>
    </HoverCard>
  );
}

/**
 * A characteristic this unit reacts to unusually, good or bad.
 *
 * The sentence names the unit because the chip does not: a row of `FOG` and `OPEN` chips under a
 * portrait says which labels matter and nothing about which way, and "Suppressors suffer where
 * this holds" is the half a player is actually asking for.
 */
export function AffinityTag({
  affinity,
  unitName,
}: {
  affinity: { id: string; label: string; note: string; good: boolean };
  unitName: string;
}) {
  return (
    <HoverCard
      label={`${affinity.label}: ${affinity.note}`}
      card={
        <div className="flex flex-col gap-1">
          <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
            {affinity.label}
          </p>
          <p className="font-body text-[13px] leading-relaxed text-ink-100">
            {affinity.good
              ? `${unitName} fight better where this holds: ${affinity.note}.`
              : `${unitName} suffer where this holds: ${affinity.note}.`}
          </p>
        </div>
      }
    >
      <span
        className={cn(
          'flex h-5 items-center truncate rounded-sm border px-1.5',
          'font-display text-[10px] uppercase tracking-[0.08em]',
          affinity.good
            ? 'border-verdigris-500/60 bg-verdigris-700/25 text-verdigris-100'
            : 'border-oxblood-500/60 bg-oxblood-500/15 text-oxblood-300',
        )}
      >
        {affinity.label}
      </span>
    </HoverCard>
  );
}
