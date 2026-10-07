import {
  EFFECT_CHANNELS,
  OFFICER_ROLE_LABELS,
  PRIVATE_CHANNELS,
  type CrewStandingResponse,
  type OfficerMark,
} from '@frontline/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChannelCard } from './ChannelCard';
import { Icon } from '../../components/ui/Icon';
import { MarkStamp } from '../../components/ui/MarkStamp';
import { useCrewStanding } from '../../lib/queries';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { PageShell } from '../game/PageShell';
import { formatRemaining } from '../base/format';

/**
 * What the crew is buying (maintainer request): the outcomes the books are paying for.
 *
 * Its own screen, reached from the crew page, rather than the bottom two thirds of the overseer's
 * own file. It was on that file because the numbers are computed from the same sheet, which is a
 * reason about the code rather than about the reader: the file is *who you are*, and this is a
 * ledger of what thirteen people between them are worth to the district. Two subjects, two screens.
 *
 * Two halves since the chair rework (maintainer, 2026-10-04). The cards are what the perks on the
 * books add up to: every perk sums across the room. The list beside them is what each chair pays,
 * which is one passive per seated officer sized by how well they fit the seat, with the Overseer's
 * own grade first. Attributes no longer feed a crew-wide channel, so there is no best-of sheet to
 * draw any more.
 */

/** One line of "What the chairs give": who, their grade, and the one passive it pays. */
function ChairGift({
  testId,
  chair,
  name,
  mark,
  passive,
  chairFrom = null,
  onSettled,
}: {
  testId: string;
  chair: string;
  name: string;
  mark: OfficerMark;
  passive: string;
  /** When a chair taken a moment ago starts giving (`chairSettlesAt`), or null when it does. */
  chairFrom?: string | null;
  /** Called once a settling chair starts giving, so the channels can be read again. */
  onSettled?: () => void;
}) {
  const left = useCountdown(chairFrom, onSettled);
  return (
    <li data-testid={testId} className="flex min-w-0 flex-col gap-1 py-2 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em] text-brass-300">
            {chair}
          </span>
          <span className="break-words font-stamp text-[14px] leading-tight text-ink-100">
            {name}
          </span>
        </div>
        <span className="relative h-9 w-9 shrink-0 text-oxblood-300">
          <MarkStamp mark={mark} className="inset-0 h-full w-full" tip={`${chair}: ${mark}`} />
        </span>
      </div>
      <p className="break-words font-body text-[12px] leading-snug text-ink-300">{passive}</p>
      {left > 0 && (
        <p className="break-words font-body text-[12px] italic leading-snug text-oxblood-300">
          Settling in: nothing for another {formatRemaining(left)}.
        </p>
      )}
    </li>
  );
}

/**
 * Milliseconds left until `until`, ticking each second while it is ahead, and `onPassed` once it
 * lands (bug pass, 2026-10-06). Read once per render, the settling line never moved and stayed up
 * after the chair had started giving, until something else happened to refetch the page.
 */
function useCountdown(until: string | null, onPassed?: () => void): number {
  const end = until === null ? null : Date.parse(until);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end === null || !(end > Date.now())) return;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= end) {
        clearInterval(id);
        onPassed?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [end, onPassed]);
  return end === null ? 0 : end - now;
}

/** The Overseer's grade, then every working chair in `OFFICER_ROLES` order. */
function ChairGifts({ data, onSettled }: { data: CrewStandingResponse; onSettled: () => void }) {
  return (
    <ul className="flex flex-col divide-y divide-surface-700/70" data-testid="chair-gifts">
      <ChairGift
        testId="chair-gift-overseer"
        chair="Overseer"
        name={data.overseer.name}
        mark={data.overseerGrade.mark}
        passive={data.overseerGrade.passive}
      />
      {data.chairs.map((line) => (
        <ChairGift
          key={line.role}
          testId={`chair-gift-${line.role}`}
          chair={OFFICER_ROLE_LABELS[line.role]}
          name={line.officerName}
          mark={line.mark}
          passive={line.passive}
          chairFrom={line.chairFrom ?? null}
          onSettled={onSettled}
        />
      ))}
    </ul>
  );
}

export function CrewEffectsPage() {
  const query = useCrewStanding();
  const data = query.data;
  // A chair that has settled changes what the crew is buying: read the books again.
  const { refetch } = query;
  const reread = useCallback(() => void refetch(), [refetch]);

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

  const { effects } = data;
  const live = EFFECT_CHANNELS.filter(
    // The spy totals are never sent (`PRIVATE_CHANNELS`); this holds if one ever is.
    (channel) => !PRIVATE_CHANNELS.has(channel) && (effects[channel] ?? 0) > 0,
  );

  return (
    <PageShell
      title="What the crew is buying"
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
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <ul
            className="grid min-w-0 gap-2 md:grid-cols-2 [@media(min-width:1600px)]:grid-cols-3"
            data-testid="crew-effects"
          >
            {live.map((channel) => (
              <ChannelCard key={channel} channel={channel} amount={effects[channel] ?? 0} />
            ))}
          </ul>

          <section className="ink-frame card-paper washed flex flex-col gap-1.5 p-3">
            <h2 className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300">
              What the chairs give
            </h2>
            <span aria-hidden className="ink-rule h-1 w-full" />
            <ChairGifts data={data} onSettled={reread} />
          </section>
        </div>
      </div>
    </PageShell>
  );
}
