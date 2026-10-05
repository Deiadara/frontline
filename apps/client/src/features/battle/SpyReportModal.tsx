import { dayInZone, spyReportSource, spyReportSummary, type SpyReport } from '@frontline/shared';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { DrawnGlyph } from '../../components/ui/DrawnMarks';
import { Insignia } from '../../components/ui/Insignia';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { UnitChip } from '../units/UnitChip';
import { usePlayerZone } from '../settings/usePlayerZone';

/**
 * One spy report, read (maintainer ruling, 2026-09-22).
 *
 * Headed with where, whose and what it cost, because those are frozen onto the report the night
 * it was written and the ground may have changed hands since. The body is the one sentence the
 * maintainer asked for and the list under it: what the spies were able to uncover, never a unit
 * that was not there. The two readouts under the list, the accuracy and the estimate of what was
 * missed, are printed only when the report carries them, which is a matter of the crew's track at
 * the time and not of the reader's now.
 *
 * The Master of Whispers' track decides the rest (maintainer, 2026-09-28): before Written Reports
 * the body is a count of unit slots and nothing else, The Whole Wire adds the exact slots standing
 * there whatever the job managed, and the courier's daily report is headed with his rung rather
 * than a tier nobody bought.
 */
export function SpyReportModal({ report, onClose }: { report: SpyReport; onClose: () => void }) {
  const zone = usePlayerZone();
  const units = Object.entries(report.exposed).filter(([, count]) => count > 0);
  const courier = report.tier === null;
  // The player's day, not the UTC one: a report written at 01:30 Athens was dated yesterday.
  const day = dayInZone(new Date(report.writtenAt), zone);
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
          {report.failed ? 'Nothing' : spyReportSummary(report)} · {spyReportSource(report)}
          {courier ? null : (
            <>
              {' · '}
              <span className="tabular-nums">{report.capsPaid.toLocaleString()}</span> caps
            </>
          )}
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
          <Head
            label="Held by"
            value={holder}
            mark={
              <Insignia holder={report.holder.kind} className="mr-1 h-3.5 w-3.5 align-[-3px]" />
            }
          />
          <Head label="Faction" value={report.holder.faction ?? 'None'} />
          <Head label="Written" value={day} />
          <Head
            label="Paid"
            value={courier ? 'Nothing: the courier' : `${report.capsPaid.toLocaleString()} caps`}
          />
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
        ) : report.heldFromAway === true ? (
          <p
            className="font-body text-[13px] leading-relaxed text-ink-200"
            data-testid="spy-held-from-away"
          >
            Nobody is standing at the gate right now. Whoever holds it lives elsewhere and brings
            what they send to a fight, so nothing here says what would meet one.
          </p>
        ) : !report.unitsShown ? (
          <p
            className="font-body text-[13px] leading-relaxed text-ink-200"
            data-testid="spy-slots-only"
          >
            Your spies counted{' '}
            <span className="font-display font-bold tabular-nums text-brass-300">
              {report.exposedSlots}
            </span>{' '}
            unit slots' worth of people there, and nobody wrote down who. Written Reports puts the
            units themselves on a report.
          </p>
        ) : (
          <>
            <p className="font-body text-[13px] leading-relaxed text-ink-200">
              {courier ? 'The courier carried word of:' : 'Your spies were able to uncover:'}
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
          </>
        )}
        <Readouts report={report} />
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The figures under the body: the accuracy and the estimate on their rungs, the exact slots from
 * The Whole Wire (printed on a failed report too, which is the point of it), and whether the
 * holder knows who came.
 */
function Readouts({ report }: { report: SpyReport }) {
  const lines: { label: string; value: string }[] = [];
  if (report.totalSlots !== null) {
    lines.push({ label: 'Standing there', value: `${report.totalSlots} unit slots` });
  }
  if (!report.failed && report.accuracy !== null) {
    // Rounded to a tenth by the server (maintainer, 2026-10-01), so short of a full read it is
    // printed as the estimate it is.
    const percent = `${Math.round(report.accuracy * 100)}%`;
    lines.push({ label: 'Accuracy', value: report.accuracy >= 1 ? percent : `About ${percent}` });
  }
  if (!report.failed && report.unseen !== null) {
    lines.push({
      label: 'Unseen',
      value: report.unseen === 0 ? 'Nobody' : `Roughly ${report.unseen}`,
    });
  }
  // Only a job on somebody's ground can be seen: the courier's never is, nor anything on looter
  // or Combine ground, which has nobody to tell.
  if (report.tier !== null && report.holder.kind === 'crew') {
    lines.push({
      label: 'Noticed',
      value: report.foundOut ? 'They know it was you' : 'Nobody saw them',
    });
  }
  if (lines.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1" data-testid="spy-readouts">
      {lines.map((line) => (
        <Head key={line.label} label={line.label} value={line.value} />
      ))}
    </dl>
  );
}

function Head({ label, value, mark }: { label: string; value: string; mark?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="truncate font-display text-[12px] tabular-nums text-ink-100">
        {mark}
        {value}
      </dd>
    </div>
  );
}
