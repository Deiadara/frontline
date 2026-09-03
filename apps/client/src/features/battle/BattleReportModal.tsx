import {
  NO_REPORT_LINE,
  type BattleAnalysis,
  type BattleSide,
  type SideAnalysis,
  type UnitPerformance,
  WEATHER_CATALOG,
  isPlainDay,
} from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { LabelRow } from '../../components/ui/LabelChip';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';

/**
 * The after-action report (GDD §A5, battle rework).
 *
 * Two documents in one window, and they are not the same document. The **log** is what happened,
 * in sentences: it is what makes a defeat readable and it is the half a player will read first. The
 * **ledger** is what it cost, per unit, ranked by what each of them actually put out, which is the
 * half a player reads when they are deciding what to build next.
 *
 * Nothing here is optional decoration. Every column answers a question the board asked for by name:
 * what fled, what the casualties were, which units did the most damage, and how the legends did.
 *
 * ## The template
 *
 * Every report is the same document in the same order, so a player who has read one can read any of
 * them without hunting: **outcome and ground**, then **what happened** in sentences, then **the
 * legends**, then **the two ledgers side by side**, each with the same rows in the same order and
 * the same five-column unit table under it.
 *
 * "The same rows" is the part that needs enforcing rather than intending. The ledger rows used to be
 * written `{side.infamy > 0 && <Row .../>}`, one condition per side, so the two columns grew
 * different rows: a fight where only the winner banked infamy put "Infamy earned" on one side and
 * not the other, and the two ledgers stopped lining up at exactly the moment a reader wanted to
 * compare them. {@link ledgerRows} decides the row set once, for the report, from both sides at
 * once: a row is on both columns or on neither.
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
  const rows = ledgerRows(mine, theirs);
  // A ring that anybody actually met, rather than one that was merely set: a perimeter nobody ran
  // into neither caught anyone nor paid anything, and has nothing to report.
  const ringFought = [mine, theirs].some(
    (each) => each.perimeterCaught > 0 || each.perimeterLost > 0,
  );

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
          {won ? 'Held' : 'Lost'} · {analysis.locationName} ·{' '}
          {analysis.rounds === 1 ? '1 round' : `${analysis.rounds} rounds`}
        </p>
        <h2
          id="report-title"
          className="font-display text-lg font-bold tracking-[0.08em] text-ink-100"
        >
          {analysis.headline}
        </h2>
        {/* §A4: the ground the fight was actually on, and the sky it was under.
            
            The labels decide a real share of every outcome, and for a while the report said nothing
            about any of them: a player read a loss with no way to learn they had sent riflemen into
            a corridor on a foggy night. Stamped onto the analysis at resolution rather than read
            live, because by the time anybody opens this the weather has moved on. */}
        {(analysis.ground.length > 0 || !isPlainDay(analysis.weather)) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {!isPlainDay(analysis.weather) && (
              <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
                {WEATHER_CATALOG[analysis.weather].name}
              </span>
            )}
            <LabelRow labels={analysis.ground} size="sm" />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5">
        <section className="flex flex-col gap-1.5">
          {analysis.trap && (
            <p className="font-body text-xs leading-relaxed text-oxblood-300">
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
          {/* The ring, when one was there to be met. Meeting it is a second fight now, so it has a
              result of its own: the same handful of runners getting home means one thing when the
              ring held and quite another when it was ridden through. */}
          {ringFought && (
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
              {analysis.brokeThrough
                ? 'The withdrawal came through the ring.'
                : 'The ring held, and the withdrawal broke on it.'}
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
          <SideTable side={mine} heading="Yours" tone="mine" rows={rows} />
          <SideTable side={theirs} heading="Theirs" tone="theirs" rows={rows} />
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

interface LedgerRow {
  label: string;
  of: (side: SideAnalysis) => number;
}

/**
 * The ledger rows for this report, decided once from both sides.
 *
 * The first four are always drawn, because every fight has them and a reader looking for "what did
 * this cost" should find it in the same place every time. The rest are drawn when *either* side has
 * something to say, which is what keeps the two columns aligned: a row is on both or on neither.
 * Drawing a row only where its own number is non-zero, which is what this replaced, produced two
 * ledgers of different heights whose rows did not correspond.
 */
function ledgerRows(mine: SideAnalysis, theirs: SideAnalysis): LedgerRow[] {
  const always: LedgerRow[] = [
    { label: 'Lost', of: (side) => side.lost },
    { label: 'Came back', of: (side) => side.survived },
    { label: 'Broke and ran', of: (side) => side.fled },
  ];
  const whenAnybodyHas: LedgerRow[] = [
    // §D3: the intimidation the engine has always settled before the first shot and never showed.
    { label: 'Too cowed to fire', of: (side) => side.cowed },
    { label: 'On the ring', of: (side) => side.perimeter },
    { label: 'Caught by the ring', of: (side) => side.perimeterCaught },
    { label: 'Lost holding the ring', of: (side) => side.perimeterLost },
    { label: 'Infamy earned', of: (side) => side.infamy },
  ];
  return [...always, ...whenAnybodyHas.filter((row) => row.of(mine) > 0 || row.of(theirs) > 0)];
}

function SideTable({
  side,
  heading,
  tone,
  rows,
}: {
  side: SideAnalysis;
  heading: string;
  tone: 'mine' | 'theirs';
  rows: LedgerRow[];
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-2 border p-3',
        tone === 'mine' ? 'border-brass-500/40 bg-brass-300/5' : 'border-surface-700',
      )}
      data-testid={`report-side-${tone}`}
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
        {rows.map((row) => (
          <Row key={row.label} label={row.label} value={String(row.of(side))} />
        ))}
      </dl>

      {/* §D1: who led, and what it came to. On the analysis since officers could lead a fight and
          drawn nowhere: a player could field a legend, have them fall, and read a report that did
          not mention it. Beside the unit rows rather than in them, because an officer is one person
          who was there rather than a body count the settler writes back to a roster. */}
      {side.officer && (
        <p
          className="font-body text-[11px] leading-relaxed text-ink-300"
          data-testid={`report-officer-${tone}`}
        >
          <span className="font-display tracking-[0.06em] text-brass-300">{side.officer.name}</span>{' '}
          led, and put out {Math.round(side.officer.damage)}.{' '}
          {side.officer.fell ? 'Taken off the field.' : 'Walked off it.'}
        </p>
      )}

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
