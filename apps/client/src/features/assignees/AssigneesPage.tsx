import {
  MAX_ASSIGNEES_PER_OFFICER,
  OFFICER_ROLE_LABELS,
  type AssigneeOfficer,
  type AssigneesResponse,
} from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useAssignees, usePlaceAssignees, useReskillAssignees } from '../../lib/queries';

/**
 * Assignees — the fungible pool under each officer (GDD §G).
 *
 * Every number on this page is served by `/api/assignees`, never recomputed here: the §G7 table and
 * the §G8 pool formula live in `@frontline/shared` and are read server-side, so the screen cannot
 * drift from what a launch will actually charge.
 */

/** Formats a §G7 percentage without a trailing `.0`, so 14.5% and 19% both read cleanly. */
export function percent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** §G1 — one pip per assignee. They are interchangeable, so the pips are identical by design. */
function Pips({ filled, cap }: { filled: number; cap: number }) {
  return (
    <div className="flex flex-wrap gap-1" aria-hidden="true">
      {Array.from({ length: cap }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-2.5 w-2.5 border',
            index < filled ? 'border-neon-cyan bg-neon-cyan/70' : 'border-steel-700 bg-steel-900',
          )}
        />
      ))}
    </div>
  );
}

interface OfficerRowProps {
  officer: AssigneeOfficer;
  cap: number;
  unplaced: number;
  pending: boolean;
  onPlace: (officerId: string) => void;
}

function OfficerRow({ officer, cap, unplaced, pending, onPlace }: OfficerRowProps) {
  const atCap = officer.assignees >= cap;
  const canPlace = !atCap && unplaced > 0 && !pending;

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border border-steel-800 bg-night-raised px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-xs uppercase tracking-[0.16em] text-steel-200">
          {officer.name}
        </p>
        <p className="truncate text-[11px] text-steel-500">{OFFICER_ROLE_LABELS[officer.role]}</p>
      </div>

      <div className="shrink-0">
        <Pips filled={officer.assignees} cap={cap} />
        <p className="mt-1 font-display text-[10px] tabular-nums tracking-[0.14em] text-steel-500">
          {officer.assignees} / {cap}
        </p>
      </div>

      {/* §G5/§G7 — the bonus this officer's team is currently worth, on time *and* power. */}
      <div className="w-24 shrink-0 text-right">
        <p className="font-display text-sm font-semibold tabular-nums text-neon-cyan">
          {percent(officer.bonusPercent)}
        </p>
        <p className="text-[10px] text-steel-600">
          {officer.nextBonusPercent === null
            ? 'at cap'
            : `next ${percent(officer.nextBonusPercent)}`}
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canPlace}
        onClick={() => onPlace(officer.officerId)}
        className="shrink-0"
      >
        Assign
      </Button>
    </li>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-600">{label}</p>
      <p className="font-display text-lg font-semibold tabular-nums text-steel-100">{value}</p>
      {hint !== undefined && <p className="text-[10px] text-steel-600">{hint}</p>}
    </div>
  );
}

function Layout({ data }: { data: AssigneesResponse }) {
  const place = usePlaceAssignees();
  const reskill = useReskillAssignees();
  const pending = place.isPending || reskill.isPending;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-4 p-4">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <Stat label="Pool" value={String(data.pool)} hint={`level ${data.level}`} />
              <Stat label="Unplaced" value={String(data.unplaced)} />
              <Stat
                label="Per officer"
                value={String(data.capPerOfficer)}
                hint={
                  data.capPerOfficer >= MAX_ASSIGNEES_PER_OFFICER
                    ? 'maximum'
                    : `up to ${percent(data.maxBonusPercent)}`
                }
              />
            </div>

            {/* §G4/§C4 — reskilling is the Professor's process, and the only way to take people back. */}
            <div className="max-w-xs text-right">
              <Button
                type="button"
                variant="ghost"
                disabled={!data.canReskill || data.placed === 0 || pending}
                onClick={() => reskill.mutate({ placements: {} })}
              >
                Reskill
              </Button>
              <p className="mt-1 text-[10px] leading-snug text-steel-600">
                {data.canReskill
                  ? 'Your Professor recalls every assignee at once.'
                  : 'Hire a Professor to recall assignees once placed.'}
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Assignees">
          {data.officers.length === 0 ? (
            <p className="p-4 text-sm text-steel-500">
              Nobody to assign anyone to yet — hire an officer at the Bar first.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 p-4">
              {data.officers.map((officer) => (
                <OfficerRow
                  key={officer.officerId}
                  officer={officer}
                  cap={data.capPerOfficer}
                  unplaced={data.unplaced}
                  pending={pending}
                  onPlace={(officerId) => place.mutate({ officerId, count: 1 })}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function AssigneesPage() {
  const { data, isPending, isError } = useAssignees();

  if (isPending) return <p className="p-4 text-sm text-steel-500">Reading the roster…</p>;
  if (isError || !data) {
    return <p className="p-4 text-sm text-neon-magenta">Could not read your assignees.</p>;
  }
  return <Layout data={data} />;
}
