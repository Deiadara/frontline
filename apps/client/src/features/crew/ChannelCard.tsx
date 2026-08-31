import {
  ATTRIBUTE_EFFECTS,
  ATTRIBUTE_LABELS,
  CHANNEL_LABELS,
  attributesDriving,
  type AttributeName,
  type EffectChannel,
} from '@frontline/shared';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { RATING_TEXT, ratingBand } from '../../lib/rating';

/**
 * One outcome the books are buying, as a card.
 *
 * Lifted out of the overseer's file when "what the crew is buying" became its own screen, unchanged
 * apart from the move. Read the comment inside about `painted` and `washed` before restyling it:
 * there is a visual gate that fails if either goes back on.
 */

const CHANNEL_GROUP: Readonly<Record<EffectChannel, 'fight' | 'district' | 'books' | 'intel'>> = {
  defensePercent: 'fight',
  unitOffensePercent: 'fight',
  unitVitalityPercent: 'fight',
  unitMoraleFlat: 'fight',
  unitSpeedPercent: 'fight',
  unitStealthPercent: 'fight',
  intimidationFlat: 'fight',
  casualtyRecoveryPercent: 'fight',
  cohesionPercent: 'fight',
  lootCapacityPercent: 'fight',
  travelSpeedPercent: 'fight',
  researchSpeedPercent: 'district',
  buildSpeedPercent: 'district',
  trainingSpeedPercent: 'district',
  trainingCostPercent: 'district',
  productionPercent: 'district',
  storageCapacityPercent: 'district',
  buildCostPercent: 'district',
  wageDiscountPercent: 'books',
  recruitPoolPercent: 'books',
  intelYieldPercent: 'intel',
  intelResistancePercent: 'intel',
};

const GROUP_STYLE: Readonly<
  Record<(typeof CHANNEL_GROUP)[EffectChannel], { icon: IconName; ink: string; edge: string }>
> = {
  fight: { icon: 'sword', ink: 'text-oxblood-300', edge: 'border-oxblood-500/40' },
  district: { icon: 'district', ink: 'text-verdigris-100', edge: 'border-verdigris-300/40' },
  books: { icon: 'crew', ink: 'text-brass-300', edge: 'border-brass-500/40' },
  intel: { icon: 'eye', ink: 'text-iris-100', edge: 'border-iris-300/40' },
};

/** One outcome, what it is worth, and who on the books is responsible for it. */
export function ChannelCard({
  channel,
  amount,
  sheet,
}: {
  channel: EffectChannel;
  amount: number;
  sheet: Record<string, number>;
}) {
  const { label, unit } = CHANNEL_LABELS[channel];
  const drivers = attributesDriving(channel);
  const style = GROUP_STYLE[CHANNEL_GROUP[channel]];

  return (
    <li
      data-testid={`channel-${channel}`}
      /*
       * `card-paper` and `edge-lit`, never `painted` or `washed`.
       *
       * Both of those are `mix-blend-mode: soft-light` layers. One over a panel is the intended
       * texture; twenty-two of them stacked down this list washed the whole column out to a pale
       * grey static field with the type barely readable through it. Measured, not guessed: dropping
       * them from these cards alone restores the page, with the same classes left in place on the
       * shell and on the portrait. `card-paper` is a plain gradient and `edge-lit` an inset shadow,
       * so neither blends and neither compounds. There is a gate for this in `visual.spec.ts`
       * (`expectSheetNotWashedOut`); put `painted` back here and it fails.
       */
      className={cn(
        'card-paper edge-lit flex min-w-0 flex-col gap-2 rounded-sm border p-2.5',
        style.edge,
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn('mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4', style.ink)}
          data-tip={CHANNEL_LABELS[channel].label}
        >
          <Icon name={style.icon} />
        </span>
        <span className="min-w-0 flex-1 break-words font-body text-[13px] leading-tight text-ink-100">
          {label}
        </span>
        {/* The figure on a plate: it is the one number on the card and what two outcomes are
            compared on. */}
        <span
          className={cn(
            'shrink-0 rounded-sm border px-1.5 py-0.5 font-display text-[12px] font-bold tabular-nums',
            style.edge,
            style.ink,
          )}
        >
          +{amount}
          {unit === 'percent' ? '%' : ''}
        </span>
      </div>
      {/* Who is responsible, as chips carrying their own rating colour rather than a row of grey
          `Label 15`s. The colour is the same four bands every rating in the game is read on, so
          "which of these is holding the number down" is answered without reading a digit. */}
      <div className="flex min-w-0 flex-wrap gap-1">
        {drivers.map((name: AttributeName) => (
          <span
            key={name}
            data-tip={ATTRIBUTE_EFFECTS[name].summary}
            className="flex items-center gap-1 rounded-sm border border-surface-600/70 bg-surface-950/40 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.1em] text-ink-300"
          >
            {ATTRIBUTE_LABELS[name]}
            <span
              className={cn('font-bold tabular-nums', RATING_TEXT[ratingBand(sheet[name] ?? 0)])}
            >
              {sheet[name] ?? 0}
            </span>
          </span>
        ))}
      </div>
    </li>
  );
}
