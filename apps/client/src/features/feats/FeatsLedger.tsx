import { ProgressBar } from '../../components/ui/ProgressBar';
import { FeatSeal } from './marks';

/**
 * The page's own standing, in one object at the top of the sheet.
 *
 * Three figures, and they are not the same question asked three ways. **Collected** is the whole
 * of what this screen has ever paid out. **Waiting** is what is finished and unpaid, which is the
 * number in the red square on the bottom bar and the only one that is asking a player to do
 * something. **On the board** is the rest, so that the first two have a denominator.
 *
 * Drawn round the seal rather than as a row of tiles, because this is the one place on a screen of
 * two hundred rows where the page gets to be a picture.
 *
 * ## Why the three stack
 *
 * They were a wrapping row, and a wrapping row of label-value pairs is the worst of both: at one
 * width it is three pairs on a line, at another it is two and an orphan, and at no width can the
 * eye run down the values and compare them, which is the only reason to print three numbers
 * together. Stacked, they are a small table with the values in one column, right-aligned on
 * `tabular-nums` so 5, 30 and 165 line up on their last digit. The leader rule between label and
 * figure is what a ledger does, and it is what keeps a two-character value attached to its name
 * across four inches of card.
 *
 * The sentence that used to sit above the bar ("30 feats are finished and waiting to be
 * collected") is gone. It was the **Waiting** row read aloud, one line under the figure it was
 * restating, next to a Collect-all button carrying the same number a third time.
 */
export function FeatsLedger({
  total,
  claimed,
  ready,
}: {
  /** Everything in the catalogue this build knows about. */
  total: number;
  claimed: number;
  ready: number;
}) {
  const share = total > 0 ? claimed / total : 0;
  const lines = [
    {
      label: 'Collected',
      value: claimed,
      testId: 'feats-count-claimed',
      tone: 'text-verdigris-100',
    },
    { label: 'Waiting', value: ready, testId: 'feats-count-ready', tone: 'text-brass-100' },
    {
      label: 'On the board',
      value: Math.max(0, total - claimed - ready),
      testId: 'feats-count-left',
      tone: 'text-ink-200',
    },
  ];

  return (
    <section
      className="ink-frame card-paper washed grain flex flex-wrap items-center gap-x-5 gap-y-3 rounded-sm px-4 py-3 shadow-panel"
      data-testid="feats-ledger"
    >
      <FeatSeal>
        <span
          className="font-stamp text-[30px] leading-none text-brass-100"
          data-testid="feats-ledger-claimed"
        >
          {claimed}
        </span>
        <span className="mt-0.5 font-display text-[10px] font-bold uppercase tracking-[0.16em] text-brass-300">
          of {total}
        </span>
      </FeatSeal>

      <div className="flex min-w-[13rem] flex-1 flex-col gap-2">
        {/*
         * No `remaining` on the bar.
         *
         * It carried the percentage, and `ProgressBar` draws that at the far end of the track: on
         * a sheet a thousand pixels wide it left `3%` marooned at the right-hand edge of the card,
         * a foot from the stroke it was describing. The seal says five of two hundred an inch to
         * the left, which is the same fact in the place the eye already is.
         */}
        <ProgressBar
          progress={share}
          label="Feats collected"
          tone="brass"
          size="md"
          data-testid="feats-ledger-bar"
        />
        <dl className="flex flex-col gap-[3px]">
          {lines.map((line) => (
            <div key={line.label} className="flex items-baseline gap-2">
              <dt className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">
                {line.label}
              </dt>
              {/* The leader. A hairline rather than printed dots: at 10px a dot leader reads as
                  dirt on the paper, and the job is only to carry the eye across the gap. */}
              <span aria-hidden className="ink-rule min-w-0 flex-1 translate-y-[-2px]" />
              <dd
                className={`shrink-0 font-stamp text-[15px] leading-none tabular-nums ${line.tone}`}
                data-testid={line.testId}
              >
                {line.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
