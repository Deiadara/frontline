import type { ReactNode } from 'react';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { RULE_CHIP, RULE_INK, ruleTone } from './rules';
import { AdHocArmyScrap } from './AdHocArmyRule';

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
/** The ANTI-COMBINE tag (maintainer, 2026-10-07), one rung a level, drawn as a positive rule. */
export function antiCombineRule(levels: number): {
  id: string;
  label: string;
  description: string;
} {
  const numeral = ['I', 'II', 'III', 'IV', 'V'][Math.min(5, Math.max(1, levels)) - 1] ?? 'I';
  const percent = 10 * levels;
  return {
    id: 'anti_combine',
    label: `Anti-Combine ${numeral}`,
    description: `Every unit of the crew fights a Combine force in a declared battle at +${percent}% offense and +${percent}% vitality: one rung for the Nave, and one for each city's last Combine district held whole. A battle job on the board does not count.`,
  };
}

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
 * `TAUNT` in the same verdigris chip as `CLOSE QUARTERS` will file it as another +25%. Brass,
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
  rule: {
    id: string;
    label: string;
    description: string;
    tone?: string;
    level?: number | undefined;
  };
}) {
  const tone = ruleTone(rule);
  // AD HOC ARMY shows the robot's whole card above its words, so it takes a card-sized hover.
  const robots = rule.id === 'ad_hoc_army';
  return (
    <HoverCard
      label={rule.label}
      {...(robots ? { size: 'card' as const } : {})}
      card={
        robots ? (
          <AdHocArmyScrap rule={rule} ink={RULE_INK[tone]} />
        ) : (
          <TagScrap title={rule.label} ink={RULE_INK[tone]}>
            {rule.description}
          </TagScrap>
        )
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

/**
 * A tag the unit gains from a location's level and has not unlocked yet (maintainer, 2026-10-09):
 * the same chip greyed out with a cross, and the hover says what it does and how to get it.
 */
export function LockedRuleTag({
  tag,
}: {
  tag: { label: string; description: string; unlock: string };
}) {
  return (
    <HoverCard
      label={`${tag.label}: locked`}
      card={
        <TagScrap title={tag.label} ink="text-ink-300">
          {tag.description} <span className="text-ink-400">{tag.unlock}.</span>
        </TagScrap>
      }
    >
      <span
        className={cn(
          'flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5',
          'border-surface-600/60 bg-surface-950/40 text-ink-400 opacity-70',
          'font-display text-[10px] font-semibold uppercase tracking-[0.08em]',
        )}
        data-locked="yes"
      >
        <Icon name="close" className="h-2.5 w-2.5" />
        {tag.label}
      </span>
    </HoverCard>
  );
}

/**
 * A modifier that is the sheet's signature (`UnitSpec.goldenModifiers`, the Breakers' Breaching,
 * maintainer 2026-10-09) draws in the gold the Bounty Wall's golden jobs wear: same size, same
 * hover, a different metal.
 */
const GOLDEN_CHIP =
  'border-ember-100 bg-ember-100/15 text-ember-100 shadow-[0_0_0_1px_rgba(255,209,102,0.6)]';
const PLAIN_CHIP = 'border-verdigris-500/60 bg-verdigris-700/25 text-verdigris-100';

export function ModifierTag({
  modifier,
}: {
  modifier: { label: string; description: string; when: string; golden?: boolean | undefined };
}) {
  return (
    <HoverCard
      label={modifier.label}
      card={
        <TagScrap
          title={modifier.label}
          ink={modifier.golden ? 'text-ember-100' : 'text-verdigris-100'}
        >
          {/*
           * The description alone (maintainer, 2026-10-13): the grey "Counts in ..." clause that
           * trailed it is gone from every unit tag. Each description names its own condition. The
           * one grey line a tag still carries is a locked tag's way to unlock it (`LockedRuleTag`).
           */}
          {modifier.description}
        </TagScrap>
      }
    >
      <span
        className={cn(
          'flex h-5 items-center whitespace-nowrap rounded-sm border px-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em]',
          modifier.golden ? GOLDEN_CHIP : PLAIN_CHIP,
        )}
        data-golden={modifier.golden ? 'yes' : undefined}
      >
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
  cancelledBy = null,
}: {
  affinity: { id: string; label: string; note: string; good: boolean };
  unitName: string;
  /**
   * What cancels this weakness for the crew's unit, by name (maintainer, 2026-10-15): a Tolling
   * Tower while its bells ring, a held place that makes the crew immune, or the unit's door. Drawn
   * in blue and struck through, the hover naming it.
   */
  cancelledBy?: string | null | undefined;
}) {
  const ignored = cancelledBy !== null && cancelledBy !== undefined;
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
          {ignored && (
            <p
              className="font-body text-[13px] leading-relaxed text-hextech-300"
              data-testid={`cancelled-by-${affinity.id}`}
            >
              Cancelled by {cancelledBy}: {unitName} ignore {affinity.label} in a fight.
            </p>
          )}
        </div>
      }
    >
      <span
        data-ignored={ignored ? 'yes' : undefined}
        className={cn(
          'flex h-5 items-center truncate rounded-sm border px-1.5',
          'font-display text-[10px] uppercase tracking-[0.08em]',
          ignored
            ? 'border-hextech-300/70 bg-hextech-700/25 text-hextech-300 line-through decoration-hextech-300'
            : affinity.good
              ? 'border-verdigris-500/60 bg-verdigris-700/25 text-verdigris-100'
              : 'border-oxblood-500/60 bg-oxblood-500/15 text-oxblood-300',
        )}
      >
        {affinity.label}
      </span>
    </HoverCard>
  );
}
