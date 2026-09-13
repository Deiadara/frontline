import { FEATS, findFeat } from '@frontline/shared';
import { useMemo, useState } from 'react';
import { Icon } from '../../components/ui/Icon';
import { useClaimAllFeats, useClaimFeat, useFeats } from '../../lib/queries';
import { ClaimButton } from './ClaimButton';
import { PageShell, ScreenLoadSheet } from '../game/PageShell';
import { FeatFilters } from './FeatFilters';
import { FeatLadder } from './FeatLadder';
import { FeatsLedger } from './FeatsLedger';
import { RewardTally } from './RewardTally';
import { ALL_FEATS, countMatching, featBlocks, filterBlocks, type FeatFilter } from './featsList';
import { featRefusalText } from './refusal';

/**
 * The feats screen (maintainer request, 2026-09-13).
 *
 * A hundred and sixty things to go and do, which is far too many for one column of rows, so the
 * page is built out of three decisions:
 *
 *   * the catalogue is grouped into **ladders** (`featsList.ts`), so a chain of four reads as one
 *     idea at four sizes rather than as four entries that happen to rhyme;
 *   * the **filters** are the navigation, not a refinement, and they carry the count each setting
 *     would leave so a player can see where the work is before pressing anything;
 *   * the cards go into **two columns** past 1280, because sixty-two of them in one column is a
 *     page nobody scrolls to the bottom of even once.
 *
 * The page holds no copy of the feats. The catalogue is in `@frontline/shared` and the response is
 * progress only; everything drawn here is the join of the two, recomputed when either moves.
 */
export function FeatsPage() {
  const query = useFeats();
  const claim = useClaimFeat();
  const claimAll = useClaimAllFeats();
  const [filter, setFilter] = useState<FeatFilter>(ALL_FEATS);

  const progress = query.data?.progress;
  // Both memos key off the response object: the live channel refetches this screen on almost every
  // nudge the game sends, and re-grouping a hundred and sixty entries on each is work nobody asked
  // for. Filtering is separate from grouping so that pressing a chip does not regroup.
  const blocks = useMemo(() => (progress === undefined ? [] : featBlocks(progress)), [progress]);
  const shown = useMemo(() => filterBlocks(blocks, filter), [blocks, filter]);
  const rungsShown = useMemo(() => countMatching(blocks, filter), [blocks, filter]);

  if (!query.data) {
    return (
      <ScreenLoadSheet
        what="The feats"
        loading="Reading the book…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { ready, claimed } = query.data;
  const collected = claim.data;
  const collectedName = collected ? (findFeat(collected.featId)?.name ?? collected.featId) : null;
  const claimingId = claim.isPending ? (claim.variables?.featId ?? null) : null;

  return (
    <PageShell
      wide
      title="Feats"
      lede="Things worth writing down, and what the city pays for them."
      action={
        ready > 0 ? (
          <span className="flex items-center gap-2">
            <span
              className="flex items-center gap-1.5 rounded-sm border border-oxblood-300/60 bg-oxblood-500/15 px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-oxblood-100"
              data-testid="feats-ready-chip"
            >
              <Icon name="alert" aria-hidden className="h-3.5 w-3.5" />
              {ready} to collect
            </span>
            {/*
             * One press for the lot, beside the count rather than at the foot of the board.
             *
             * A ladder unlocks on achievement rather than on collection, so a crew that has been
             * playing a while arrives here with a great many rungs waiting at once. Pressing CLAIM
             * on each would run into the write limiter, 120 writes a minute per account, and be
             * refused by a guard that knows nothing about feats. The route folds the whole backlog
             * into one write; this is the door to it.
             *
             * Only drawn when something is waiting, so it is never a button that does nothing.
             */}
            <ClaimButton
              onClick={() => claimAll.mutate()}
              pending={claimAll.isPending}
              label={`Collect all ${ready}`}
              ariaLabel={`Collect all ${ready} finished feats`}
              data-testid="feats-claim-all"
            />
          </span>
        ) : undefined
      }
    >
      {/*
       * The ledger and the filters on one row where the sheet is wide enough for it.
       *
       * Stacked, each of them was a band running the full width of a 1660px sheet with a couple of
       * hundred pixels of content in it, and the progress stroke inside the first was a metre of
       * track at three percent. Side by side they are two objects that fill the width between
       * them. Below 1280 they stack, which is the only thing that fits there.
       */}
      <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <FeatsLedger total={FEATS.length} claimed={claimed} ready={ready} />
        <FeatFilters
          filter={filter}
          onChange={setFilter}
          countFor={(probe) => countMatching(blocks, probe)}
        />
      </div>

      {/*
       * What the button just paid, and why it would not.
       *
       * Both live here, under the filters, rather than on the rung that was pressed. A claimed rung
       * changes state the moment the response lands, so a receipt drawn inside it would be a
       * receipt inside a row that has just restyled itself, and a rung near the foot of a ten
       * thousand pixel page is a refusal nobody will ever see. The faction screen puts its refusal
       * in the same kind of strip for the same reason.
       */}
      {collected && !claim.isPending && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-verdigris-300/50 bg-verdigris-500/10 px-3 py-2 font-body text-[13px] text-verdigris-100"
          data-testid="feats-receipt"
        >
          <span className="font-stamp text-[15px] leading-none">Collected: {collectedName}</span>
          <RewardTally reward={collected.paid} data-testid="feats-receipt-paid" />
        </div>
      )}
      {claim.error && (
        <p
          role="alert"
          className="rounded-sm border border-oxblood-300/50 bg-oxblood-500/10 px-3 py-2 font-body text-[13px] text-oxblood-100"
          data-testid="feats-refusal"
        >
          {featRefusalText(claim.error.message)}
        </p>
      )}

      {shown.length === 0 ? (
        <p
          className="card-paper washed rounded-sm border border-surface-600/70 px-4 py-6 text-center font-body text-[14px] italic text-ink-300"
          data-testid="feats-empty"
        >
          Nothing on the board answers to that. Try a different era, or show everything.
        </p>
      ) : (
        <>
          <p
            className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-ink-400"
            data-testid="feats-shown"
          >
            {rungsShown} of {FEATS.length} feats
          </p>
          {/*
           * Two columns past 1280 and one below it. `items-start`, so a two-rung card beside a
           * five-rung one keeps its own height instead of stretching to the row: a stretched card
           * is a frame with a foot of empty paper under its last rung.
           */}
          <div
            className="grid items-start gap-3 xl:grid-cols-2"
            data-testid="feats-board"
            data-blocks={shown.length}
          >
            {shown.map((block) => (
              <FeatLadder
                key={block.key}
                block={block}
                claimingId={claimingId}
                onClaim={(featId) => claim.mutate({ featId })}
              />
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
