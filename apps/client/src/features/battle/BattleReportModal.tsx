import {
  NO_REPORT_LINE,
  type BattleAnalysis,
  type BattleSide,
  type SideAnalysis,
  type UnitPerformance,
} from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';

/**
 * The after-action report (GDD §A5, battle rework).
 *
 * Two documents in one window, and they are not the same document. The **log** is what happened,
 * in sentences: it is what makes a defeat readable and it is the half a player will read first. The
 * **ledger** is what it cost, per unit, ranked by what each of them actually put out — which is the
 * half a player reads when they are deciding what to build next.
 *
 * Nothing here is optional decoration. Every column answers a question the board asked for by name:
 * what fled, what the casualties were, which units did the most damage, and how the legends did.
 */

interface BattleReportModalProps {
  analysis: BattleAnalysis | null;
  /** Which side the reader was on, so their own force leads. */
  side: BattleSide;
  onClose: () => void;
}

export function BattleReportModal({ analysis, side, onClose }: BattleReportModalProps) {
  if (!analysis) {
    return (
      <Modal onClose={onClose} labelledBy="report-title" className="border-oxblood-500/30">
        <div className="flex flex-col gap-3 p-6" data-testid="battle-report-silent">
          <h2
            id="report-title"
            className="font-display text-lg font-bold tracking-[0.1em] text-ink-100"
          >
            No word
          </h2>
          <p className="font-body text-sm leading-relaxed text-ink-300">{NO_REPORT_LINE}</p>
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const mine = side === 'attacker' ? analysis.attacker : analysis.defender;
  const theirs = side === 'attacker' ? analysis.defender : analysis.attacker;
  const won = analysis.winner === side;

  return (
    <Modal
      onClose={onClose}
      labelledBy="report-title"
      size="wide"
      className={won ? 'border-brass-500/30' : 'border-oxblood-500/30'}
    >
      <div
        className="flex shrink-0 flex-col gap-1 border-b border-surface-700 px-5 py-4"
        data-testid="battle-report"
      >
        <p
          className={cn(
            'font-display text-[11px] uppercase tracking-[0.22em]',
            won ? 'text-brass-300' : 'text-oxblood-300',
          )}
        >
          {won ? 'Held' : 'Lost'} · {analysis.locationName}
        </p>
        <h2
          id="report-title"
          className="font-display text-lg font-bold tracking-[0.08em] text-ink-100"
        >
          {analysis.headline}
        </h2>
      </div>

      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5">
        <section className="flex flex-col gap-1.5">
          {analysis.trap && (
            <p className="font-body text-xs leading-relaxed text-sear-300">
              {analysis.trap.name} went off on the approach. It took {analysis.trap.killed}.
            </p>
          )}
          {analysis.log.map((line, index) => (
            <p
              key={`${index}-${line}`}
              className="font-body text-[13px] leading-relaxed text-ink-200"
            >
              {line}
            </p>
          ))}
          {analysis.decidedOnPower && (
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
              Called on who was left standing.
            </p>
          )}
        </section>

        {analysis.legends.length > 0 && (
          <section className="border border-brass-500/30 bg-brass-300/5 p-3">
            <p className="font-display text-[10px] uppercase tracking-[0.22em] text-brass-300">
              The ones there is only one of
            </p>
            {analysis.legends.map((line) => (
              <p key={line} className="mt-1 font-body text-[13px] leading-relaxed text-ink-200">
                {line}
              </p>
            ))}
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <SideTable side={mine} heading="Yours" tone="mine" />
          <SideTable side={theirs} heading="Theirs" tone="theirs" />
        </div>
      </div>

      <footer className="flex shrink-0 justify-end border-t border-surface-700 px-5 py-4">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </footer>
    </Modal>
  );
}

function SideTable({
  side,
  heading,
  tone,
}: {
  side: SideAnalysis;
  heading: string;
  tone: 'mine' | 'theirs';
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-2 border p-3',
        tone === 'mine' ? 'border-brass-500/40 bg-brass-300/5' : 'border-surface-700',
      )}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 truncate font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
          {heading} · {side.name}
        </h3>
        <span className="shrink-0 font-display text-[11px] tabular-nums text-ink-300">
          {side.committed} sent
        </span>
      </header>

      <dl className="flex flex-col divide-y divide-surface-700 border-y border-surface-700">
        <Row label="Lost" value={String(side.lost)} />
        <Row label="Came back" value={String(side.survived)} />
        <Row label="Broke and ran" value={String(side.fled)} />
        {side.perimeter > 0 && <Row label="On the ring" value={String(side.perimeter)} />}
        {side.perimeterCaught > 0 && (
          <Row label="Caught by the ring" value={String(side.perimeterCaught)} />
        )}
        {side.infamy > 0 && <Row label="Infamy earned" value={String(side.infamy)} />}
      </dl>

      {side.units.length === 0 ? (
        <p className="font-body text-xs leading-relaxed text-ink-300">Nobody was on the ground.</p>
      ) : (
        <table className="w-full table-fixed">
          <thead>
            <tr className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
              <th className="w-2/5 py-1 text-left font-normal">Unit</th>
              <th className="py-1 text-right font-normal">Sent</th>
              <th className="py-1 text-right font-normal">Lost</th>
              <th className="py-1 text-right font-normal">Ran</th>
              <th className="py-1 text-right font-normal">Damage</th>
            </tr>
          </thead>
          <tbody>
            {side.units.map((unit) => (
              <UnitRow key={unit.unitId} unit={unit} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function UnitRow({ unit }: { unit: UnitPerformance }) {
  return (
    <tr className="border-t border-surface-700/60">
      <td className="min-w-0 py-1.5">
        <span
          className={cn(
            'block truncate font-display text-[12px] tracking-[0.06em]',
            unit.unique ? 'text-brass-300' : 'text-ink-200',
          )}
        >
          {unit.name}
        </span>
        <span className="block truncate font-body text-[11px] text-ink-300">{unit.state}</span>
      </td>
      <td className="py-1.5 text-right font-display text-[12px] tabular-nums text-ink-300">
        {unit.started}
      </td>
      <td className="py-1.5 text-right font-display text-[12px] tabular-nums text-oxblood-300">
        {unit.lost}
      </td>
      <td className="py-1.5 text-right font-display text-[12px] tabular-nums text-ink-300">
        {unit.fled}
      </td>
      <td className="py-1.5 text-right font-display text-[12px] tabular-nums text-brass-300">
        {Math.round(unit.damageShare * 100)}%
      </td>
    </tr>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">{label}</dt>
      <dd className="font-display text-xs tabular-nums text-ink-200">{value}</dd>
    </div>
  );
}
