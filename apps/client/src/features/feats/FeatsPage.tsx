import { FEATS, findFeat } from '@frontline/shared';
import { useEffect, useMemo, useState } from 'react';
import { useClaimAllFeats, useClaimFeat, useClaimingFeats, useFeats } from '../../lib/queries';
import { ClaimButton } from './ClaimButton';
import { PageShell, ScreenLoadSheet } from '../game/PageShell';
import { FeatFilters } from './FeatFilters';
import { FeatLadder } from './FeatLadder';
import { FeatsLedger } from './FeatsLedger';
import { FeatsSidebar } from './FeatsSidebar';
import { RewardTally } from './RewardTally';
import { ALL_FEATS, countMatching, featBlocks, filterBlocks, type FeatFilter } from './featsList';
import { featRefusalText } from './refusal';

/**
 * The feats screen (maintainer request, 2026-09-13; rebuilt 2026-09-17).
 *
 * Four hundred things to go and do, which is far too many for a column of cards, so the page is
 * built out of three decisions:
 *
 *   * the catalogue is grouped into **ladders** (`featsList.ts`), so a chain of ten reads as one
 *     idea at ten sizes rather than as ten entries that happen to rhyme;
 *   * the ladders are an **index on the left and one open ladder on the right**. The board used to
 *     draw all seventy at once and then fold most of their rungs away to fit, which made a
 *     too-long page shorter without making anything easier to find. A list you can run your eye
 *     down, and the whole of whichever one you pressed, is the version that scales to ladders of
 *     ten;
 *   * one **box at the top** carrying the standing, the filters and the one button that pays out,
 *     because those three are the page's whole chrome and three separate panels for them was three
 *     frames' worth of edge for two figures and four chips.
 *
 * The page holds no copy of the feats. The catalogue is in `@frontline/shared` and the response is
 * progress only; everything drawn here is the join of the two, recomputed when either moves.
 */
export function FeatsPage() {
  const query = useFeats();
  const claim = useClaimFeat();
  const claimAll = useClaimAllFeats();
  /*
   * Every press still waiting for an answer, not just the newest one.
   *
   * `claim.isPending` reports the mutation the hook is currently watching, and a second CLAIM
   * replaces the first: the rung underneath the first press dropped back to a live button while
   * its own write was still on the wire. This comes off the mutation cache instead, so both rungs
   * stay pending until their own answers land. See `useClaimingFeats`.
   */
  const claiming = useClaimingFeats();
  const [filter, setFilter] = useState<FeatFilter>(ALL_FEATS);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const progress = query.data?.progress;
  // Both memos key off the response object: the live channel refetches this screen on almost every
  // nudge the game sends, and re-grouping four hundred entries on each is work nobody asked
  // for. Filtering is separate from grouping so that pressing a chip does not regroup.
  const blocks = useMemo(() => (progress === undefined ? [] : featBlocks(progress)), [progress]);
  const shown = useMemo(() => filterBlocks(blocks, filter), [blocks, filter]);

  /*
   * Which ladder is open, when the player has not said.
   *
   * The board must never be a sidebar beside an empty pane, and two things can empty it: arriving
   * (nothing chosen yet) and pressing a chip that filters the open ladder away. Both are the same
   * fix, so it is one effect keyed on the list rather than a default in `useState` plus a special
   * case in the chip handler.
   */
  const openIsShown = shown.some((block) => block.key === openKey);
  useEffect(() => {
    if (!openIsShown) setOpenKey(shown[0]?.key ?? null);
  }, [openIsShown, shown]);

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
  const open = shown.find((block) => block.key === openKey) ?? shown[0];

  /*
   * The receipt, from whichever button was pressed.
   *
   * Collecting one drew a receipt and collecting the lot drew nothing, because this only ever read
   * the single-claim response. The Collect-all button is the one a returning player presses, and it
   * is the one that pays the most, so the case with no feedback at all was the case that mattered
   * most: rungs restyled themselves somewhere down a very long page and the stockpile moved in the
   * HUD, with nothing anywhere saying what had just been handed over.
   *
   * Whichever mutation settled last wins, and neither is shown while its own claim is in flight.
   * `featIds.length === 0` is a real answer from claim-all (pressing it with nothing waiting is a
   * success, not a refusal) and draws nothing, because a receipt for nothing is noise.
   */
  const single = claim.isPending ? undefined : claim.data;
  const batch = claimAll.isPending ? undefined : claimAll.data;
  /*
   * What Collect-all could **not** hand over, and why the button is not dead.
   *
   * A feat that pays units is refused while the district has nowhere to put them (§A1), and it
   * stays ready. Without this the backlog does not empty, the count on the button's face does not
   * move, and pressing it again pays nothing and draws no receipt: a control that looks broken.
   * The list comes off the server because only it knows what the beds are doing.
   */
  const skipped = batch?.skipped ?? [];
  const newer = claim.submittedAt >= claimAll.submittedAt ? (single ?? batch) : (batch ?? single);
  const receipt =
    newer === undefined
      ? null
      : 'featId' in newer
        ? {
            name: findFeat(newer.featId)?.name ?? newer.featId,
            paid: newer.paid,
          }
        : newer.featIds.length === 0
          ? null
          : {
              name: `${newer.featIds.length} ${newer.featIds.length === 1 ? 'feat' : 'feats'}`,
              paid: newer.paid,
            };

  return (
    // `fills`, and no title: the sheet is a two-pane board that has to reach the foot of the
    // window, and the quotation is the whole of the heading (`PageShell` draws it in the body, the
    // way every screen with no door does).
    <PageShell fills wide quote="Evidence that you were here.">
      {/*
       * One box: the standing, the filters and the button that pays.
       *
       * These were three panels, which is three hand-inked frames across the top of the sheet for
       * two figures, four chips and one control. Joined, the ledger anchors the left, the chips
       * sit on the middle line, and the one thing on this page that spends anything is on the
       * right where a primary action goes.
       */}
      <div
        /*
         * A tenth off the height, taken out of the padding (maintainer, 2026-09-17).
         *
         * Measured: 140px, of which 104 is the seal, 24 is this padding and 12 is the ink frame's
         * own border. The seal and the controls are content and were asked to stay the size they
         * are (the controls grew, in fact), so the only place a tenth can come from is here.
         */
        className="ink-frame card-paper washed grain flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 rounded-sm px-4 py-[5px] shadow-panel"
        data-testid="feats-summary"
      >
        {/*
         * The ledger at a fixed measure, and the chips take the slack.
         *
         * It was the other way round for a version: the ledger grew and at 1920 its stroke ran
         * eleven hundred pixels with a hairline leader stretched under it, which is a rule across
         * a page rather than a measure of anything. A bar wants a length it can be read at, so it
         * has one, and what flexes is the space the chips sit centred in.
         */}
        <div className="w-[30rem] max-w-full shrink-0">
          <FeatsLedger total={FEATS.length} claimed={claimed} ready={ready} />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <FeatFilters
            filter={filter}
            onChange={setFilter}
            countFor={(probe) => countMatching(blocks, probe)}
          />
        </div>
        {/*
         * One press for the lot.
         *
         * A ladder unlocks on achievement rather than on collection, so a crew that has been
         * playing a while arrives here with a great many rungs waiting at once. Pressing CLAIM on
         * each would run into the write limiter, 120 writes a minute per account, and be refused by
         * a guard that knows nothing about feats. The route folds the whole backlog into one write;
         * this is the door to it. Only drawn when something is waiting, so it is never a button
         * that does nothing.
         */}
        {ready > 0 && (
          <ClaimButton
            onClick={() => claimAll.mutate()}
            pending={claimAll.isPending}
            label={`Collect all ${ready}`}
            ariaLabel={`Collect all ${ready} finished feats`}
            data-testid="feats-claim-all"
          />
        )}
      </div>

      {/*
       * What the button just paid, and why it would not.
       *
       * Both live here, under the box, rather than on the rung that was pressed. A claimed rung
       * changes state the moment the response lands, so a receipt drawn inside it would be a
       * receipt inside a row that has just restyled itself, and a rung near the foot of a scrolling
       * ladder is a refusal nobody will ever see. The faction screen puts its refusal in the same
       * kind of strip for the same reason.
       */}
      {receipt && (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-verdigris-300/50 bg-verdigris-500/10 px-3 py-2 font-body text-[13px] text-verdigris-100"
          data-testid="feats-receipt"
        >
          <span className="font-stamp text-[15px] leading-none">Collected: {receipt.name}</span>
          <RewardTally reward={receipt.paid} data-testid="feats-receipt-paid" />
        </div>
      )}
      {skipped.length > 0 && (
        <p
          role="status"
          className="shrink-0 rounded-sm border border-brass-500/50 bg-brass-300/10 px-3 py-2 font-body text-[13px] text-brass-100"
          data-testid="feats-no-room"
        >
          {skipped.length} {skipped.length === 1 ? 'feat is' : 'feats are'} still waiting:{' '}
          {featRefusalText('no_unit_slots')}
        </p>
      )}
      {claim.error && (
        <p
          role="alert"
          className="shrink-0 rounded-sm border border-oxblood-300/50 bg-oxblood-500/10 px-3 py-2 font-body text-[13px] text-oxblood-100"
          data-testid="feats-refusal"
        >
          {featRefusalText(claim.error.message)}
        </p>
      )}

      {open === undefined ? (
        <p
          className="card-paper washed rounded-sm border border-surface-600/70 px-4 py-6 text-center font-body text-[14px] italic text-ink-300"
          data-testid="feats-empty"
        >
          Nothing on the board answers to that. Try a different setting, or show everything.
        </p>
      ) : (
        /*
         * The index and the open ladder, side by side, both filling the sheet.
         *
         * One column below 1024, where a fixed-width sidebar beside a card leaves neither of them
         * a readable measure: the list goes on top at its own height and the ladder under it.
         */
        <div
          className="grid min-h-0 flex-1 grid-rows-[14rem_minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(13rem,20rem)_minmax(0,1fr)] lg:grid-rows-1"
          data-testid="feats-board"
          data-blocks={shown.length}
        >
          <FeatsSidebar blocks={shown} selected={open.key} onSelect={setOpenKey} />
          <FeatLadder
            key={open.key}
            block={open}
            claiming={claiming}
            onClaim={(featId) => claim.mutate({ featId })}
          />
        </div>
      )}
    </PageShell>
  );
}
