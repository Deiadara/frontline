import { CHANNEL_LABELS, EFFECT_CHANNELS } from '@frontline/shared';
import { Link } from 'react-router-dom';
import { AttributeRadar } from '../overseer/AttributeRadar';
import { ChannelCard } from './ChannelCard';
import { Icon } from '../../components/ui/Icon';
import { useCrewStanding } from '../../lib/queries';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { PageShell } from '../game/PageShell';

/**
 * What the crew is buying (board request): the outcomes the books are paying for.
 *
 * Its own screen, reached from the crew page, rather than the bottom two thirds of the overseer's
 * own file. It was on that file because the numbers are computed from the same sheet, which is a
 * reason about the code rather than about the reader: the file is *who you are*, and this is a
 * ledger of what nineteen people between them are worth to the district. Two subjects, two screens.
 *
 * Every number here is the **best** figure anybody on the books has, the reader included. That is
 * the rule the whole page rests on and it is the one thing a player has to be told, so it is said
 * in the lede rather than folded into a collapsed note that nobody opens.
 */
export function CrewEffectsPage() {
  const query = useCrewStanding();
  const data = query.data;

  if (!data) {
    return (
      <PageShell title="What the crew is buying" wide>
        {query.isError ? (
          <LoadFailure what="The books" onRetry={() => void query.refetch()} />
        ) : (
          <p className="p-6 font-display text-xs uppercase tracking-[0.2em] text-ink-300">
            Reading the books…
          </p>
        )}
      </PageShell>
    );
  }

  const { crewSheet, effects } = data;
  const live = EFFECT_CHANNELS.filter((channel) => (effects[channel] ?? 0) > 0);
  const dormant = EFFECT_CHANNELS.filter((channel) => (effects[channel] ?? 0) <= 0);

  return (
    <PageShell
      title="What the crew is buying"
      icon="spark"
      lede="Every figure is the best anyone on your books has, yourself included. Hiring a specialist raises it; so does an hour at the bench."
      action={
        <Link
          to="/game/crew"
          data-testid="back-to-crew"
          className="ink-box inline-flex items-center gap-1.5 px-3.5 py-1.5 font-stamp text-[13px] leading-none text-brass-300 transition-colors hover:text-brass-100"
        >
          <Icon name="crew" aria-hidden className="h-3.5 w-3.5" />
          The crew
        </Link>
      }
      wide
    >
      <div className="flex flex-col gap-4">
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <ul
            className="grid min-w-0 gap-2 md:grid-cols-2 [@media(min-width:1600px)]:grid-cols-3"
            data-testid="crew-effects"
          >
            {live.map((channel) => (
              <ChannelCard
                key={channel}
                channel={channel}
                amount={effects[channel] ?? 0}
                sheet={crewSheet}
              />
            ))}
          </ul>

          <section className="ink-frame card-paper washed flex flex-col gap-1.5 p-3">
            <h2 className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300">
              The shape of the crew
            </h2>
            <span aria-hidden className="ink-rule h-1 w-full" />
            <div className="h-52 w-full">
              <AttributeRadar attributes={crewSheet} />
            </div>
          </section>
        </div>

        {dormant.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
              Nothing there yet
            </h2>
            <span aria-hidden className="ink-rule h-1 w-full" />
            <p className="font-body text-[13px] text-ink-400">
              Channels nobody on the books can open. Hire for them, or train towards them.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {dormant.map((channel) => (
                <li
                  key={channel}
                  className="flex items-center gap-1.5 rounded-sm border border-surface-700 px-2 py-1 font-display text-[11px] uppercase tracking-[0.12em] text-ink-300"
                >
                  <Icon name="lock" className="h-3 w-3" />
                  {CHANNEL_LABELS[channel].label}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageShell>
  );
}
