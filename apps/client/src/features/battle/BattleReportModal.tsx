import {
  NO_REPORT_LINE,
  type BattleAnalysis,
  type BattleSide,
  type LocationHolderKind,
  type SideAnalysis,
  type SkirmishOutcome,
  type UnitPerformance,
  WEATHER_CATALOG,
  findUnit,
  isPlainDay,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { RewardLine } from '../../components/Resources';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { DrawnGlyph } from '../../components/ui/DrawnMarks';
import { Insignia } from '../../components/ui/Insignia';
import type { IconName } from '../../components/ui/Icon';
import { LabelRow } from '../../components/ui/LabelChip';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { UnitTrigger } from '../units/UnitWindow';

/**
 * The after-action report (GDD §A5; redrawn 2026-09-28).
 *
 * A sheet of final figures, not a story. The round-by-round log the report used to open with is
 * gone (maintainer: "I want the final stats"); what is left is the same document for every fight,
 * in the same order, so a player who has read one can read any of them without hunting:
 *
 * 1. **The head**: won or lost, where, how many rounds, and the ground and sky it was fought on.
 * 2. **The outcome**: one row of drawn tiles, each with an icon that says what it means on the
 *    hover. The ground (captured, held, broken, raided), the infamy this side earned, the spoils
 *    the winner carried home, the rounds, the trap if one went off, and the officer who led.
 * 3. **Notes**: the handful of facts that belong to one side only, when there are any: whose
 *    ground it was, who changed sides under Directive Xero, what the Executioner finished.
 * 4. **The two sides**, yours first, each with the same rows in the same order (sent, died, fled,
 *    came back, and the rows either side has something to say on) and the unit table under it.
 *
 * "The same rows" is the part that needs enforcing rather than intending. {@link ledgerRows}
 * decides the row set once, for the report, from both sides at once: a row is on both columns or
 * on neither, so the two ledgers line up at exactly the moment a reader wants to compare them.
 *
 * Every icon is a {@link DrawnGlyph} with a `data-tip`, so the sheet reads as pictures first and
 * the words are one hover away. The panels are the same paper the plot window is printed on.
 */

/**
 * What the Combine's two legendaries took off the attacker (`city/combine.ts`, 2026-09-19).
 *
 * `turned` is the attacker's units that changed sides under Directive Xero's Change of Heart, by
 * unit id: they fought this one fight for him and are dead after it, whichever way it went.
 * `executed` is the count the Executioner finished where they stood. Both are on
 * `SkirmishOutcome`; the report reads them off the analysis it is handed, and draws nothing while
 * they are zero, which is every fight the Combine is not in.
 */
type CombineToll = Pick<SkirmishOutcome, 'turned' | 'executed'>;

interface BattleReportModalProps {
  analysis: (BattleAnalysis & Partial<CombineToll>) | null;
  /** Which side the reader was on, so their own force leads. */
  side: BattleSide;
  /**
   * Who stood on the ground (`BattleReportView.defenderKind`), so the Combine's and the looters'
   * side carries their mark. The attacker is always a crew.
   */
  defenderKind?: LocationHolderKind;
  onClose: () => void;
}

/** What each drawn icon means, said on the hover. One table, so a tile and a row agree. */
const MEANING: Readonly<Record<string, string>> = {
  ground: 'The ground: what this fight was for, and who holds it now that it is over.',
  infamy:
    'Infamy: the name this side earned from the fight. A name is burned to boost a fight and opens contracts.',
  spoils: 'Spoils: what the winner carried home, after anything the stores could not take.',
  rounds: 'Rounds: how many exchanges it took to settle.',
  trap: 'The trap: what went off on the approach, and how many it took or how it slowed the attack before the lines met.',
  officer:
    'The officer who led this side, what they put out, and whether they walked off the field.',
  sent: 'Sent: everybody this side committed to the line.',
  died: 'Died: units that did not walk off the field, whatever took them.',
  fled: 'Fled: units that broke, ran, and got home.',
  back: 'Came back: units that walked off the field standing, the ones the medics got back included.',
  intimidated:
    'Too intimidated to fire: units the other side kept out of the exchange before a shot was fired.',
  ring: 'The ring: the perimeter set to catch a withdrawal, and what it caught and cost.',
};

export function BattleReportModal({
  analysis,
  side,
  defenderKind = 'crew',
  onClose,
}: BattleReportModalProps) {
  if (!analysis) {
    return (
      <Modal onClose={onClose} labelledBy="report-title" className="border-oxblood-500/30">
        <div className="flex flex-col gap-3 p-6" data-testid="battle-report-silent">
          <h2 id="report-title" className="font-stamp text-[23px] leading-none text-ink-100">
            No word
          </h2>
          <p className="font-body text-sm leading-relaxed text-ink-300">{NO_REPORT_LINE}</p>
          <div className="flex justify-end">
            <DrawnButton size="sm" tone="danger" data-sound="click" onClick={onClose}>
              Close
            </DrawnButton>
          </div>
        </div>
      </Modal>
    );
  }

  const mine = side === 'attacker' ? analysis.attacker : analysis.defender;
  const theirs = side === 'attacker' ? analysis.defender : analysis.attacker;
  const won = analysis.winner === side;
  const theirHolder = side === 'attacker' ? defenderKind : 'crew';
  const rows = ledgerRows(mine, theirs, theirHolder);
  const notes = noteLines(analysis);

  return (
    <Modal
      onClose={onClose}
      labelledBy="report-title"
      size="wide"
      className={won ? 'border-brass-500/30' : 'border-oxblood-500/30'}
    >
      <div
        className="relative flex shrink-0 flex-col gap-1.5 px-5 pb-3.5 pt-4"
        data-testid="battle-report"
      >
        <p
          className={cn(
            'font-display text-[11px] uppercase tracking-[0.22em]',
            won ? 'text-brass-300' : 'text-oxblood-300',
          )}
        >
          {won ? 'Won' : 'Lost'} · {analysis.locationName} ·{' '}
          {analysis.rounds === 1 ? '1 round' : `${analysis.rounds} rounds`}
        </p>
        <h2 id="report-title" className="font-stamp text-[23px] leading-none text-ink-100">
          {groundLine(analysis, side)}
        </h2>
        {/* §A4: the ground the fight was actually on, and the sky it was under. Stamped onto the
            analysis at resolution rather than read live, because by the time anybody opens this
            the weather has moved on. */}
        {(analysis.ground.length > 0 || !isPlainDay(analysis.weather)) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {!isPlainDay(analysis.weather) && (
              <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
                {WEATHER_CATALOG[analysis.weather].name}
              </span>
            )}
            <LabelRow labels={analysis.ground} size="sm" />
          </div>
        )}
        <span aria-hidden className="ink-rule absolute inset-x-5 bottom-0" />
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-3.5">
        <Panel title="The outcome">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="report-outcome">
            <Tile
              icon="district"
              meaning="ground"
              label="The ground"
              value={groundWord(analysis, side)}
            />
            <Tile
              icon="infamy"
              meaning="infamy"
              label="Infamy earned"
              value={mine.infamy > 0 ? `+${mine.infamy.toLocaleString('en-US')}` : '0'}
              tone={mine.infamy > 0 ? 'good' : undefined}
            />
            <Tile
              icon="loot"
              meaning="spoils"
              label="Spoils"
              value={
                won ? (
                  <RewardLine rewards={analysis.spoils} />
                ) : (
                  <span>Nothing: the field was theirs</span>
                )
              }
            />
            <Tile icon="clock" meaning="rounds" label="Rounds" value={String(analysis.rounds)} />
            {analysis.trap && (
              <Tile
                icon="alert"
                meaning="trap"
                label={analysis.trap.name}
                value={analysis.trap.slowed ? 'slowed them' : `took ${analysis.trap.killed}`}
                // A trap is laid by the side holding the ground, so it is the defender's own work:
                // green on their report, red on the attacker's (maintainer, 2026-10-06).
                tone={side === 'defender' ? 'ours' : 'bad'}
              />
            )}
            {mine.officer && (
              <Tile
                icon="crew"
                meaning="officer"
                label={mine.officer.name}
                value={mine.officer.fell ? 'taken off the field' : 'walked off the field'}
                tone={mine.officer.fell ? 'bad' : 'good'}
              />
            )}
          </ul>
        </Panel>

        {notes.length > 0 && (
          <Panel title="Notes">
            <ul className="flex flex-col gap-1.5">
              {notes.map((note) => (
                <li
                  key={note.testId}
                  className="font-body text-[13px] leading-relaxed text-ink-200"
                  data-testid={note.testId}
                >
                  {note.text}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <div className="grid gap-3 sm:grid-cols-2 sm:items-stretch">
          <SideSheet
            side={mine}
            heading="Yours"
            tone="mine"
            rows={rows}
            holder={side === 'defender' ? defenderKind : 'crew'}
          />
          <SideSheet
            side={theirs}
            heading="Theirs"
            tone="theirs"
            rows={rows}
            holder={theirHolder}
          />
        </div>
      </div>

      <footer className="relative flex shrink-0 items-center px-5 py-3">
        <span aria-hidden className="ink-rule absolute inset-x-5 top-0" />
        <DrawnButton size="sm" tone="danger" data-sound="click" onClick={onClose}>
          Close
        </DrawnButton>
      </footer>
    </Modal>
  );
}

/** The turncoats as a report names them: `3 Razors, 1 Scrapers`, in unit-id order. */
export function turnedLine(turned: Readonly<Record<string, number>>): string {
  return Object.entries(turned)
    .filter(([, count]) => count > 0)
    .map(([unitId, count]) => `${count} ${findUnit(unitId)?.name ?? unitId}`)
    .join(', ');
}

/** What winning or losing this fight did to the ground, from the reader's side. */
function groundWord(analysis: BattleAnalysis, side: BattleSide): string {
  const attackerWon = analysis.winner === 'attacker';
  const reader = side === 'attacker';
  switch (analysis.target) {
    case 'gate':
      return attackerWon
        ? reader
          ? 'Gate broken'
          : 'Gate lost'
        : reader
          ? 'Gate held'
          : 'Gate held';
    case 'district':
      return attackerWon ? (reader ? 'Raided' : 'Raided') : reader ? 'Thrown back' : 'Repelled';
    default:
      return attackerWon ? (reader ? 'Captured' : 'Lost') : reader ? 'Not taken' : 'Held';
  }
}

/** The headline: the ground and what became of it, in one line. */
function groundLine(analysis: BattleAnalysis, side: BattleSide): string {
  const attackerWon = analysis.winner === 'attacker';
  const reader = side === 'attacker';
  const place = analysis.locationName;
  switch (analysis.target) {
    case 'gate':
      return attackerWon
        ? reader
          ? `The gate at ${place} is broken`
          : `The gate at ${place} fell`
        : `The gate at ${place} held`;
    case 'district':
      return attackerWon
        ? `${place} was raided`
        : reader
          ? `The raid on ${place} was thrown back`
          : `${place} threw the raid back`;
    default:
      return attackerWon
        ? reader
          ? `${place} is yours`
          : `${place} was taken`
        : reader
          ? `${place} did not fall`
          : `${place} held`;
  }
}

interface Note {
  testId: string;
  text: string;
}

/**
 * The lines that belong to one side only, drawn only when there is a number or a name behind
 * them. A turned unit is counted in "Died" (maintainer, 2026-09-29: "Count them as dead"), and the
 * turned line says so, because a player reading the unit table would otherwise put every one of
 * those deaths down to the fire.
 */
function noteLines(analysis: BattleAnalysis & Partial<CombineToll>): Note[] {
  const notes: Note[] = [];
  if (analysis.underLeader !== null) {
    notes.push({
      testId: 'report-under-leader',
      text: `Fought under ${analysis.underLeader.name}. Every unit the Combine put in the line carried ${analysis.underLeader.powerName}.`,
    });
  }
  const turned = Object.values(analysis.turned ?? {}).reduce((sum, count) => sum + count, 0);
  if (turned > 0) {
    notes.push({
      testId: 'report-turned',
      text: `${turned} turned by Directive Xero (included in Died): ${turnedLine(analysis.turned ?? {})}.`,
    });
  }
  const executed = analysis.executed ?? 0;
  if (executed > 0) {
    notes.push({ testId: 'report-executed', text: `The Executioner finished ${executed}.` });
  }
  return notes;
}

interface LedgerRow {
  label: string;
  icon: IconName;
  meaning: string;
  of: (side: SideAnalysis) => number;
  tone?: 'bad';
  /**
   * A crew's figure only. Infamy is a crew's name, and the Combine and the looters have none to
   * earn: "The Combine's infamy is irrelevant. Don't show it anywhere" (maintainer, 2026-09-30).
   * The looters are left out on the same ground. It is the last row, so dropping it from their
   * column leaves every row above it level with its twin.
   */
  crewOnly?: true;
}

/**
 * The ledger rows for this report, decided once from both sides.
 *
 * The first four are always drawn, because every fight has them and a reader looking for "what
 * did this cost" should find it in the same place every time. The rest are drawn when *either*
 * side has something to say, which is what keeps the two columns aligned: a row is on both or on
 * neither.
 */
function ledgerRows(
  mine: SideAnalysis,
  theirs: SideAnalysis,
  theirHolder: LocationHolderKind,
): LedgerRow[] {
  const always: LedgerRow[] = [
    { label: 'Sent', icon: 'units', meaning: 'sent', of: (side) => side.committed },
    { label: 'Died', icon: 'sword', meaning: 'died', of: (side) => side.lost, tone: 'bad' },
    { label: 'Fled', icon: 'morale', meaning: 'fled', of: (side) => side.fled },
    { label: 'Came back', icon: 'check', meaning: 'back', of: (side) => side.survived },
  ];
  const whenAnybodyHas: LedgerRow[] = [
    // §D3: the intimidation the engine settles before the first shot.
    {
      label: 'Too intimidated to fire',
      icon: 'eye',
      meaning: 'intimidated',
      of: (side) => side.intimidated,
    },
    { label: 'On the ring', icon: 'shield', meaning: 'ring', of: (side) => side.perimeter },
    {
      label: 'Caught by the ring',
      icon: 'shield',
      meaning: 'ring',
      of: (side) => side.perimeterCaught,
    },
    {
      label: 'Lost holding the ring',
      icon: 'shield',
      meaning: 'ring',
      of: (side) => side.perimeterLost,
      tone: 'bad',
    },
    {
      label: 'Infamy earned',
      icon: 'infamy',
      meaning: 'infamy',
      of: (side) => side.infamy,
      crewOnly: true,
    },
  ];
  // The reader is always a crew; the other side counts only where it is one too.
  const theirsCounts = (row: LedgerRow) => !row.crewOnly || theirHolder === 'crew';
  return [
    ...always,
    ...whenAnybodyHas.filter(
      (row) => row.of(mine) > 0 || (theirsCounts(row) && row.of(theirs) > 0),
    ),
  ];
}

/** One paper panel of the sheet, with its drawn heading: the plot window's own material. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ink-frame card-paper-lit washed grain flex min-w-0 flex-col rounded-sm shadow-panel">
      <h3 className="relative px-3 pb-2 pt-2.5 font-stamp text-[15px] leading-none text-brass-300">
        <span>{title}</span>
        <span aria-hidden className="ink-rule absolute inset-x-3 -bottom-[1px]" />
      </h3>
      <div className="relative min-w-0 px-3 pb-3 pt-2.5">{children}</div>
    </section>
  );
}

/** A drawn icon that says what it means on the hover. */
function Glyph({
  icon,
  meaning,
  className,
}: {
  icon: IconName;
  meaning: string;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center', className)}
      data-tip={MEANING[meaning]}
      data-testid={`report-glyph-${meaning}`}
    >
      <DrawnGlyph name={icon} className="h-4 w-4" />
    </span>
  );
}

/** One figure on the outcome row: the icon, what it is, and what it came to. */
function Tile({
  icon,
  meaning,
  label,
  value,
  tone,
}: {
  icon: IconName;
  meaning: string;
  label: string;
  value: ReactNode;
  tone?: 'good' | 'ours' | 'bad' | undefined;
}) {
  const ink =
    tone === 'good'
      ? 'text-brass-300'
      : tone === 'ours'
        ? 'text-verdigris-300'
        : tone === 'bad'
          ? 'text-oxblood-300'
          : undefined;
  return (
    <li className="flex min-w-0 items-start gap-2 border border-surface-700/60 px-2.5 py-2">
      <Glyph icon={icon} meaning={meaning} className={cn('mt-0.5', ink ?? 'text-ink-200')} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
          {label}
        </span>
        <span
          className={cn(
            'font-display text-[13px] font-semibold tabular-nums',
            ink ?? 'text-ink-100',
          )}
        >
          {value}
        </span>
      </span>
    </li>
  );
}

function SideSheet({
  side,
  heading,
  tone,
  rows,
  holder,
}: {
  side: SideAnalysis;
  heading: string;
  tone: 'mine' | 'theirs';
  rows: LedgerRow[];
  /** Whose side this was, for the Combine's or the looters' mark beside the name. */
  holder: LocationHolderKind;
}) {
  return (
    <section
      className={cn(
        'ink-frame card-paper-lit washed grain flex min-w-0 flex-col rounded-sm shadow-panel',
        tone === 'mine' && 'ring-1 ring-brass-500/30',
      )}
      data-testid={`report-side-${tone}`}
    >
      <header className="relative flex items-baseline justify-between gap-2 px-3 pb-2 pt-2.5">
        {/* Wrapped, not truncated. A crew name is the thing this line is for. */}
        <h3 className="flex min-w-0 items-center gap-1.5 break-words font-stamp text-[15px] leading-none text-brass-300">
          <span className="min-w-0">
            {heading} · {side.name}
          </span>
          <Insignia holder={holder} className="-my-1 h-[18px] w-[18px]" />
        </h3>
        <span aria-hidden className="ink-rule absolute inset-x-3 -bottom-[1px]" />
      </header>

      <div className="flex min-w-0 flex-col gap-2.5 px-3 pb-3 pt-2.5">
        <dl className="flex flex-col gap-1">
          {rows
            .filter((row) => !row.crewOnly || holder === 'crew')
            .map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
                  <Glyph
                    icon={row.icon}
                    meaning={row.meaning}
                    className={row.tone === 'bad' ? 'text-oxblood-300' : 'text-ink-200'}
                  />
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    'font-display text-[13px] font-semibold tabular-nums',
                    row.tone === 'bad' && row.of(side) > 0 ? 'text-oxblood-300' : 'text-ink-100',
                  )}
                >
                  {row.of(side).toLocaleString('en-US')}
                </dd>
              </div>
            ))}
        </dl>

        {/* §D1: who led, and what it came to. */}
        {side.officer && (
          <p
            className="flex items-center gap-2 font-body text-[11px] leading-relaxed text-ink-300"
            data-testid={`report-officer-${tone}`}
          >
            <Glyph icon="crew" meaning="officer" className="text-brass-300" />
            <span>
              <span className="font-display tracking-[0.06em] text-brass-300">
                {side.officer.name}
              </span>{' '}
              led, and put out {Math.round(side.officer.damage)}.{' '}
              {side.officer.fell ? 'Taken off the field.' : 'Walked off it.'}
            </span>
          </p>
        )}

        {side.units.length === 0 ? (
          <p className="font-body text-xs leading-relaxed text-ink-300">
            Nobody was on the ground.
          </p>
        ) : (
          <table className="w-full table-fixed">
            <thead>
              <tr className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
                <th className="w-2/5 py-1 text-left font-normal">Unit</th>
                <th className="py-1 text-right font-normal">Sent</th>
                <th className="py-1 text-right font-normal">Died</th>
                <th className="py-1 text-right font-normal">Fled</th>
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
      </div>
    </section>
  );
}

function UnitRow({ unit }: { unit: UnitPerformance }) {
  return (
    <tr className="border-t border-surface-700/60">
      <td className="min-w-0 py-1.5">
        {/* The name opens the sheet (maintainer, 2026-09-22): a Combine unit is met here and
            nowhere on the player's own screens, so this row is the one door to its card. */}
        <UnitTrigger
          unitId={unit.unitId}
          label={`${unit.name}: the sheet`}
          className="block w-full min-w-0 text-left"
          data-testid={`report-unit-${unit.unitId}`}
        >
          <span
            className={cn(
              'block truncate font-display text-[12px] tracking-[0.06em] underline decoration-dotted decoration-surface-500 underline-offset-2',
              unit.unique ? 'text-brass-300' : 'text-ink-200',
            )}
          >
            {unit.name}
          </span>
        </UnitTrigger>
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
