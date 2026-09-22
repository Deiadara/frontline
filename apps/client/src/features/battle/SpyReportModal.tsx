import { SPY_TIER_SPECS, armySize, type SpyReport } from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { DrawnGlyph } from '../../components/ui/DrawnMarks';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { UnitChip } from '../units/UnitChip';

/**
 * One spy report, read (maintainer ruling, 2026-09-22).
 *
 * Headed with where, whose and what it cost, because those are frozen onto the report the night
 * it was written and the ground may have changed hands since. The body is the one sentence the
 * maintainer asked for and the list under it: what the spies were able to uncover, never a unit
 * that was not there. The two readouts under the list, the accuracy and the estimate of what was
 * missed, are printed only when the report carries them, which is a matter of the crew's track at
 * the time and not of the reader's now.
 */
export function SpyReportModal({ report, onClose }: { report: SpyReport; onClose: () => void }) {
  const seen = armySize(report.exposed);
  const units = Object.entries(report.exposed).filter(([, count]) => count > 0);
  const tier = SPY_TIER_SPECS[report.tier];
  const day = report.writtenAt.slice(0, 10);
  const holder =
    report.holder.kind === 'crew'
      ? `${report.holder.name}${report.holder.player ? ` (${report.holder.player})` : ''}`
      : report.holder.name;

  return (
    <Modal
      onClose={onClose}
      labelledBy="spy-report-title"
      size="wide"
      className={report.failed ? 'border-oxblood-500/30' : 'border-brass-500/30'}
      data-testid="spy-report"
    >
      <div className="flex shrink-0 flex-col gap-1 border-b border-surface-700 px-5 py-4">
        <p
          className={cn(
            'font-display text-[11px] uppercase tracking-[0.22em]',
            report.failed ? 'text-oxblood-300' : 'text-brass-300',
          )}
        >
          {report.failed ? 'Nothing' : `${seen} seen`} · {tier.label} ·{' '}
          <span className="tabular-nums">{report.capsPaid.toLocaleString()}</span> caps
        </p>
        <h2
          id="spy-report-title"
          className="flex items-center gap-2 font-display text-lg font-bold tracking-[0.08em] text-ink-100"
        >
          <DrawnGlyph name="eye" className="h-5 w-5 shrink-0 text-brass-300" />
          <span>
            {report.placeName}, {report.districtName}
          </span>
        </h2>
        <dl
          className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4"
          data-testid="spy-report-head"
        >
          <Head label="Held by" value={holder} />
          <Head label="Faction" value={report.holder.faction ?? 'None'} />
          <Head label="Written" value={day} />
          <Head label="Paid" value={`${report.capsPaid.toLocaleString()} caps`} />
        </dl>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4">
        {report.failed ? (
          <p
            className="font-body text-[13px] leading-relaxed text-ink-300"
            data-testid="spy-failed"
          >
            Your spies came back with nothing they would put their name to. Whoever holds this place
            keeps it quiet, or the job was too small for it. The caps are gone either way.
          </p>
        ) : (
          <>
            <p className="font-body text-[13px] leading-relaxed text-ink-200">
              Your spies were able to uncover:
            </p>
            {units.length === 0 ? (
              <p className="font-body text-[13px] leading-relaxed text-ink-300">
                Nobody. The place was empty when they looked.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2" data-testid="spy-exposed">
                {units.map(([unitId, count]) => (
                  <li key={unitId}>
                    <UnitChip unitId={unitId} count={count} data-testid={`spy-unit-${unitId}`} />
                  </li>
                ))}
              </ul>
            )}
            {(report.accuracyShown || report.unseen !== null) && (
              <dl className="flex flex-wrap gap-x-6 gap-y-1" data-testid="spy-readouts">
                {report.accuracyShown && (
                  <Head label="Accuracy" value={`${Math.round(report.accuracy * 100)}%`} />
                )}
                {report.unseen !== null && (
                  <Head
                    label="Unseen"
                    value={report.unseen === 0 ? 'Nobody' : `Roughly ${report.unseen}`}
                  />
                )}
              </dl>
            )}
          </>
        )}
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Head({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="truncate font-display text-[12px] tabular-nums text-ink-100">{value}</dd>
    </div>
  );
}
