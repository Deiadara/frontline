import { ENV_LABEL_CATALOG, tierNumeral, type EnvLabel, type LabelTone } from '@frontline/shared';
import { HoverCard } from './HoverCard';
import { cn } from '../../lib/cn';

/**
 * One environment label, drawn (GDD §A4).
 *
 * The chip is how a player reads a piece of ground before deciding what to send at it, so it has
 * to survive being glanced at: a colour that says *what kind* of problem this is, a word, and the
 * tier in Latin numerals. `Toxic III` and `Toxic I` are the same chip at different weights, which
 * is the whole reason the tier is a numeral rather than three copies of the word.
 *
 * Eight tones rather than thirteen. Labels that mean the same kind of thing to a player wear the
 * same colour, Cold and Snowy are both the frost tone, Hot and Noisy are both ember, so the row
 * reads as two or three *sorts* of trouble rather than as thirteen unrelated stickers. A player
 * scanning six districts is looking for "is this the cold one or the poisonous one", not for a
 * legend.
 */

/** Border, ground and ink per tone. Deliberately low-contrast grounds: these sit over artwork. */
const TONES: Record<LabelTone, string> = {
  stone: 'border-surface-600 bg-surface-900/80 text-ink-200',
  sky: 'border-iris-300/50 bg-iris-300/10 text-iris-100',
  gold: 'border-brass-500/60 bg-brass-300/10 text-brass-100',
  violet: 'border-iris-500/60 bg-iris-500/15 text-iris-100',
  ember: 'border-ember-300/60 bg-ember-300/10 text-ember-300',
  toxic: 'border-verdigris-500/60 bg-verdigris-700/20 text-verdigris-100',
  frost: 'border-verdigris-300/50 bg-verdigris-300/10 text-verdigris-100',
  rust: 'border-tangerine-300/50 bg-tangerine-300/10 text-tangerine-100',
};

/**
 * The tier, as weight rather than as a second number.
 *
 * A `Toxic IV` has to look worse than a `Toxic I` from across the screen or the numeral is doing
 * all the work and nobody is reading it. Four steps of border and glow, so the strongest label in
 * a row is the one the eye lands on first.
 */
const WEIGHTS: readonly string[] = [
  'opacity-80',
  '',
  'font-bold shadow-lifted',
  'font-bold shadow-lifted ring-1 ring-inset ring-current',
];

export function LabelChip({ label, size = 'md' }: { label: EnvLabel; size?: 'sm' | 'md' }) {
  const spec = ENV_LABEL_CATALOG[label.id];
  return (
    <HoverCard
      label={spec.name}
      card={
        <div className="flex max-w-xs flex-col gap-1.5 p-3">
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
            {spec.name} {tierNumeral(label.tier)}
          </p>
          <p className="font-body text-[12px] leading-relaxed text-ink-200">{spec.description}</p>
          <p className="font-body text-[12px] leading-relaxed text-ink-300">{spec.bites}</p>
        </div>
      }
    >
      <span
        data-testid={`label-${label.id}`}
        data-tier={label.tier}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-sm border font-display uppercase tracking-[0.12em]',
          size === 'sm' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]',
          TONES[spec.tone],
          WEIGHTS[Math.min(WEIGHTS.length, Math.max(1, label.tier)) - 1],
        )}
      >
        {spec.name}
        <span className="tabular-nums opacity-70">{tierNumeral(label.tier)}</span>
      </span>
    </HoverCard>
  );
}

/** A row of them. Empty renders nothing at all rather than an empty box. */
export function LabelRow({
  labels,
  size = 'md',
  className,
}: {
  labels: readonly EnvLabel[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (labels.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} data-testid="labels">
      {labels.map((label) => (
        <LabelChip key={label.id} label={label} size={size} />
      ))}
    </div>
  );
}
