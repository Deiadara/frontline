import type { ReactNode } from 'react';
import {
  SPY_TIERS,
  SPY_TIER_SPECS,
  armySize,
  spyRecallWindowMs,
  type DistrictDetailResponse,
  type SpyReport,
  type SpyRunView,
  type SpyTarget,
  type SpyTier,
} from '@frontline/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { CancelMark } from '../../components/ui/CancelMark';
import { DrawnGlyph } from '../../components/ui/DrawnMarks';
import { cn } from '../../lib/cn';
import { useRecallSpy, useSpy } from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';

/**
 * Spying, from the player's side (maintainer ruling, 2026-09-22).
 *
 * One panel for both things a job can point at: a location on open ground, and a district read
 * at its gate. It has the same three states the scout panel has, and for the same reason: the
 * two ways the route can refuse are said here in the route's own words, a job already out is
 * shown rather than discovered on the press, and otherwise the tier is the choice.
 *
 * The tiers are cards rather than a dropdown because the price is the decision: a player picking
 * between a hundred caps and ten thousand wants both numbers in front of them, and the blurb
 * under the chosen one says what the caps buy in words rather than points.
 */

export interface SpyingProps {
  run: SpyRunView | null;
  quote: DistrictDetailResponse['spyQuote'];
  blocker: DistrictDetailResponse['spyBlocker'];
}

export function SpyPanel({
  target,
  placeName,
  districtId,
  baseId,
  caps,
  spying,
  latest,
  now,
  testId,
  actions,
}: {
  target: SpyTarget;
  placeName: string;
  districtId: string;
  baseId: string | undefined;
  /** What the crew can spend, so a tier it cannot afford is drawn as such rather than refused. */
  caps: number;
  spying: SpyingProps;
  /** The last report on this place, or null. The sheet quotes it under the picker. */
  latest?: SpyReport | null;
  now: Date;
  testId: string;
  /** Put beside the send button, on its line. The dialog passes its Close here. */
  actions?: ReactNode;
}) {
  const [tier, setTier] = useState<SpyTier>('loose_ears');
  const spy = useSpy(baseId, districtId);
  const recall = useRecallSpy(spying.run?.districtId);
  const { run, quote, blocker } = spying;

  return (
    <div className="flex flex-col gap-2.5" data-testid={testId}>
      <SpyLine latest={latest ?? null} />

      {blocker !== null ? (
        <p
          className="font-body text-xs leading-relaxed text-oxblood-300"
          data-testid={`${testId}-blocked`}
        >
          Nobody is in the Master of Whispers chair. Spying is their work: sign one at the Bar and
          seat them. Nothing else is needed, and the caps are the price.
        </p>
      ) : run !== null ? (
        <RunUnderway
          run={run}
          now={now}
          here={sameTarget(run.target, target)}
          pending={recall.isPending}
          onRecall={() => recall.mutate({})}
          testId={testId}
          actions={actions}
        />
      ) : quote === null ? (
        <p className="font-body text-xs leading-relaxed text-ink-300">
          There is no road between here and home for the runners to walk.
        </p>
      ) : (
        <>
          <TierPicker tier={tier} caps={caps} onPick={setTier} testId={testId} />
          <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-400">
            <span className="text-brass-300">The runners</span> would be gone{' '}
            <span className="tabular-nums text-brass-300">
              {formatDuration(quote.minutes * 60)}
            </span>
            . The caps go now and do not come back.
          </p>
          {spy.error && (
            <p className="font-body text-xs text-oxblood-300" data-testid={`${testId}-error`}>
              {spy.error.message}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              size="sm"
              disabled={spy.isPending || caps < SPY_TIER_SPECS[tier].caps}
              onClick={() => spy.mutate({ target, tier })}
              data-testid={`${testId}-send`}
            >
              {spy.isPending ? 'Sending…' : `Spy on ${placeName}`}
            </Button>
            {actions}
          </div>
        </>
      )}
      {/*
       * The way out, on the send button's own line when there is one and on a line of its own
       * when there is not (maintainer, 2026-09-22).
       *
       * It used to sit in a row of its own under the whole panel, so the window ended with a
       * button floating alone under another button. Rendered here rather than by the dialog so
       * the two are siblings in one flex row; every branch above that draws no send button falls
       * through to this, which is why the blocked and already-out states still have a Close.
       */}
      {blocker !== null || (run === null && quote === null) ? (
        <div className="flex justify-end">{actions}</div>
      ) : null}
    </div>
  );
}

function sameTarget(a: SpyTarget, b: SpyTarget): boolean {
  if (a.kind === 'location' && b.kind === 'location') return a.locationId === b.locationId;
  if (a.kind === 'gate' && b.kind === 'gate') return a.districtId === b.districtId;
  return false;
}

function TierPicker({
  tier,
  caps,
  onPick,
  testId,
}: {
  tier: SpyTier;
  caps: number;
  onPick: (tier: SpyTier) => void;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="radiogroup"
        aria-label="How much to spend"
        className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
      >
        {SPY_TIERS.map((id) => {
          const spec = SPY_TIER_SPECS[id];
          const picked = id === tier;
          const short = caps < spec.caps;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={picked}
              onClick={() => onPick(id)}
              data-testid={`${testId}-tier-${id}`}
              className={cn(
                'flex min-w-0 flex-col items-start gap-0.5 rounded-sm border px-2 py-1.5 text-left transition-colors',
                picked
                  ? 'border-brass-300 bg-brass-300/10'
                  : 'border-surface-600 bg-surface-950/40 hover:border-brass-500/60',
                short && 'opacity-60',
              )}
            >
              <span
                className={cn(
                  'block w-full font-display text-[11px] uppercase leading-tight tracking-[0.12em]',
                  picked ? 'text-brass-100' : 'text-ink-200',
                )}
              >
                {spec.label}
              </span>
              <span
                className={cn(
                  'font-display text-[12px] font-bold tabular-nums',
                  short ? 'text-oxblood-300' : 'text-brass-300',
                )}
              >
                {spec.caps.toLocaleString()} caps
              </span>
            </button>
          );
        })}
      </div>
      <p
        className="font-body text-[12px] leading-relaxed text-ink-300"
        data-testid={`${testId}-blurb`}
      >
        {SPY_TIER_SPECS[tier].blurb}
      </p>
    </div>
  );
}

function RunUnderway({
  run,
  now,
  here,
  pending,
  onRecall,
  testId,
  actions,
}: {
  run: SpyRunView;
  now: Date;
  /** Whether the job out is on this very place, or somewhere else. */
  here: boolean;
  pending: boolean;
  onRecall: () => void;
  testId: string;
  actions?: ReactNode;
}) {
  const left = Math.max(0, Date.parse(run.returnsAt) - now.getTime());
  const turned = run.recalledAt !== null;
  return (
    <div className="flex flex-col gap-2" data-testid={`${testId}-underway`}>
      <p className="font-body text-xs leading-relaxed text-ink-300">
        {turned ? (
          <>
            The runners turned round and are walking home from{' '}
            <span className="text-ink-100">
              {run.placeName}, {run.districtName}
            </span>
            . No report, and the caps are spent.
          </>
        ) : here ? (
          <>
            Your runners are here, on <span className="text-ink-100">{run.placeName}</span>. The
            report is on the battle board when they are back.
          </>
        ) : (
          <>
            Your runners are already out at{' '}
            <span className="text-ink-100">
              {run.placeName}, {run.districtName}
            </span>
            . One job at a time.
          </>
        )}
      </p>
      <p
        className="font-display text-[15px] font-bold tabular-nums text-brass-300"
        data-testid={`${testId}-countdown`}
      >
        {left <= 0 ? 'Walking back in' : formatRemaining(left)}
      </p>
      {/* The way out shares the line with the way back, rather than sitting under it. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {spyRecallWindowMs(run, now) > 0 ? (
          <CancelMark
            windowMs={spyRecallWindowMs(run, now)}
            label="Turn the runners round"
            pending={pending}
            onCancel={onRecall}
            data-testid={`${testId}-recall`}
          />
        ) : (
          <span />
        )}
        {actions}
      </div>
    </div>
  );
}

/** The last report on this place, in one line, with the door to the whole of it. */
function LastReport({ report }: { report: SpyReport }) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-[12px] leading-relaxed text-ink-200"
      data-testid="spy-last-report"
    >
      <DrawnGlyph name="eye" className="h-4 w-4 shrink-0 text-brass-300" />
      <span>
        {report.failed
          ? 'Last look: nothing they would put their name to.'
          : `Last look: ${armySize(report.exposed)} seen, ${report.writtenAt.slice(0, 10)}.`}
      </span>
      <Link
        to={`/game/battles?spy=${encodeURIComponent(report.id)}`}
        className="font-display text-[11px] uppercase tracking-[0.14em] text-brass-300 hover:underline"
      >
        Read the report
      </Link>
    </p>
  );
}

/**
 * The panel as a window (2026-09-22), for the location sheet and the visited plot alike.
 *
 * A window rather than a sheet inside the sheet: the location window has to fit at 1024x768 with
 * nothing cut, and five tier cards plus the clock and the send do not. The sheet keeps one line,
 * the last look and the door, and the door opens this.
 */
export function SpyDialog({
  target,
  title,
  eyebrow,
  placeName,
  districtId,
  baseId,
  caps,
  spying,
  latest,
  now,
  testId,
  onClose,
}: {
  target: SpyTarget;
  title: string;
  eyebrow: string;
  placeName: string;
  districtId: string;
  baseId: string | undefined;
  caps: number;
  spying: SpyingProps;
  latest?: SpyReport | null;
  now: Date;
  testId: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} labelledBy={`${testId}-title`} data-testid={`${testId}-window`}>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <DrawnGlyph name="eye" className="mt-0.5 h-6 w-6 shrink-0 text-brass-300" />
          <div className="min-w-0">
            <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
              {eyebrow}
            </p>
            <h2
              id={`${testId}-title`}
              className="font-display text-lg font-bold tracking-[0.08em] text-ink-100"
            >
              {title}
            </h2>
          </div>
        </div>
        <SpyPanel
          target={target}
          placeName={placeName}
          districtId={districtId}
          baseId={baseId}
          caps={caps}
          spying={spying}
          latest={latest ?? null}
          now={now}
          testId={testId}
          actions={
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          }
        />
      </div>
    </Modal>
  );
}

/**
 * The sheet's one line about spying: what the last look said, or nothing at all.
 *
 * Nothing, literally, when there is no report (maintainer, 2026-09-22). It used to print "Nobody
 * of yours has had a look at it. What is standing here is theirs to know until you pay to find
 * out", which is two sentences to say that a line is absent. The absence says it.
 */
export function SpyLine({ latest }: { latest: SpyReport | null }) {
  return latest ? <LastReport report={latest} /> : null;
}
