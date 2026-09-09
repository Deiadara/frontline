import { ENV_LABEL_CATALOG, tierNumeral, type EnvLabel, type LabelTone } from '@frontline/shared';
import { HoverCard } from './HoverCard';
import { cn } from '../../lib/cn';

/**
 * One **location characteristic**, drawn (GDD §A4).
 *
 * The board's name for these is location characteristics, and every screen that names the concept
 * uses it: they were "ground" on the unit card and unnamed everywhere else, which left the one
 * mechanic that decides what to bring to a fight without a word a player could ask about.
 *
 * The chip is how somebody reads a place before deciding what to send at it, so it has to survive
 * being glanced at: a colour that says *what kind* of problem this is, a word, and the tier in
 * Latin numerals. `Toxic III` and `Toxic I` are the same chip at different weights, which is the
 * whole reason the tier is a numeral rather than three copies of the word.
 *
 * Eight tones rather than thirteen. Characteristics that mean the same kind of thing to a player
 * wear the same colour, Cold and Snowy are both the frost tone, Hot and Noisy are both ember, so
 * the row reads as two or three *sorts* of trouble rather than as thirteen unrelated stickers. A
 * player scanning six districts is looking for "is this the cold one or the poisonous one", not for
 * a legend.
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

export function LabelChip({
  label,
  size = 'md',
  when,
}: {
  label: EnvLabel;
  size?: 'sm' | 'md';
  /**
   * When this one holds, for a characteristic that is not permanent.
   *
   * The sky is one roll a day over the whole city (`city/weather.ts`), so Wet and Foggy are true of
   * a place this afternoon and not tomorrow, while Crammed and Dark are true of it for ever. A
   * player planning a push has to be able to tell those apart, and the chip is identical either
   * way. Absent means the characteristic is the ground's own and says nothing extra.
   */
  when?: string | undefined;
}) {
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
          {when !== undefined && (
            <p className="font-display text-[11px] uppercase tracking-[0.14em] text-brass-300">
              {when}
            </p>
          )}
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
        {/* A real space between the word and the numeral. `gap-1` puts one on the screen and none
            in `textContent`, so the chip read as "NoisyIII" to a screen reader and to every gate
            that measures text rather than pixels. */}
        {spec.name} <span className="tabular-nums opacity-70">{tierNumeral(label.tier)}</span>
      </span>
    </HoverCard>
  );
}

/** When a characteristic holds, by id. Absent, or undefined for one, means "always". */
export type LabelWhen = (label: EnvLabel) => string | undefined;

/** A row of them. Empty renders nothing at all rather than an empty box. */
export function LabelRow({
  labels,
  size = 'md',
  className,
  when,
}: {
  labels: readonly EnvLabel[];
  size?: 'sm' | 'md';
  className?: string;
  when?: LabelWhen | undefined;
}) {
  if (labels.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} data-testid="labels">
      {labels.map((label) => (
        <LabelChip key={label.id} label={label} size={size} when={when?.(label)} />
      ))}
    </div>
  );
}

/**
 * The same row, titled, for the two screens where the characteristics are the point.
 *
 * A location's card and a coming fight both used to print the chips bare, which reads as decoration
 * beside a name and a defence figure. Titled, they read as a section a player can learn: this is
 * what the place *is*, and it is what decides who to send. Empty says so out loud rather than
 * disappearing, because "nothing notable here" is a real and useful answer about a stretch of open
 * street, and a missing row is indistinguishable from a screen that forgot to draw one.
 */
export function Characteristics({
  labels,
  size = 'sm',
  className,
  when,
  'data-testid': testId = 'characteristics',
}: {
  labels: readonly EnvLabel[];
  size?: 'sm' | 'md';
  className?: string;
  when?: LabelWhen;
  'data-testid'?: string | undefined;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)} data-testid={testId}>
      <span className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
        Characteristics
      </span>
      {labels.length === 0 ? (
        <span className="font-body text-[12px] leading-snug text-ink-300">
          Nothing notable. Whoever you send fights on their own sheet.
        </span>
      ) : (
        <LabelRow labels={labels} size={size} when={when} />
      )}
    </div>
  );
}
