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
 * a hundred and sixty rows where the page gets to be a picture.
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

      <div className="flex min-w-[14rem] flex-1 flex-col gap-2">
        <p className="font-body text-[13px] leading-snug text-ink-200">
          {ready > 0
            ? `${ready} ${ready === 1 ? 'feat is' : 'feats are'} finished and waiting to be collected.`
            : 'Nothing is waiting. Go and do something worth writing down.'}
        </p>
        {/*
         * No `remaining` on the bar.
         *
         * It carried the percentage, and `ProgressBar` draws that at the far end of the track: on
         * a sheet a thousand pixels wide it left `3%` marooned at the right-hand edge of the card,
         * a foot from the stroke it was describing. The seal says five of a hundred and sixty one
         * two inches to the left, which is the same fact in the place the eye already is.
         */}
        <ProgressBar
          progress={share}
          label="Feats collected"
          tone="brass"
          size="md"
          data-testid="feats-ledger-bar"
        />
        <dl className="flex flex-wrap gap-x-4 gap-y-1">
          {[
            { label: 'Collected', value: claimed, testId: 'feats-count-claimed' },
            { label: 'Waiting', value: ready, testId: 'feats-count-ready' },
            {
              label: 'On the board',
              value: Math.max(0, total - claimed - ready),
              testId: 'feats-count-left',
            },
          ].map((line) => (
            <div key={line.label} className="flex items-baseline gap-1.5">
              <dt className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">
                {line.label}
              </dt>
              <dd
                className="font-stamp text-[15px] leading-none tabular-nums text-ink-100"
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
