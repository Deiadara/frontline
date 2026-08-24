import {
  ALIGNMENT_BAND_LABELS,
  ATTRIBUTE_LABELS,
  MAX_ASSIGNEES_PER_OFFICER,
  OFFICER_ROLES,
  OFFICER_ROLE_LABELS,
  TRAIT_CATALOG,
  isFlaw,
  type AlignmentBand,
  type AssigneeOfficer,
  type AssigneesResponse,
  type AttributeName,
  type OfficerRole,
  type TraitId,
} from '@frontline/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Modal } from '../../components/ui/Modal';
import { DescribedTag } from '../../components/ui/DescribedTag';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import {
  useAssignees,
  usePlaceAssignees,
  useReassignOfficer,
  useReskillAssignees,
} from '../../lib/queries';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { PageShell } from '../game/PageShell';

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
            index < filled
              ? 'border-brass-300 bg-brass-300/70'
              : 'border-surface-600 bg-surface-900',
          )}
        />
      ))}
    </div>
  );
}

interface SlotProps {
  role: OfficerRole;
  officer: AssigneeOfficer | undefined;
  open: boolean;
  onToggle: () => void;
}

/**
 * One position on the books, filled or not.
 *
 * The page used to list only the people you had already hired, which meant the nineteen jobs in
 * §C1 were invisible until somebody was standing in one — a player could not see what the crew was
 * *for*, only who happened to be in it. Every position now has a slot, empty ones included, so the
 * screen reads as a chart of the organisation and hiring is filling a hole you can already see.
 *
 * A filled slot is a button that opens the person underneath it. Nothing about a character is
 * shown at this size: a grid of nineteen cards each carrying a sheet is a wall, and the sheet is
 * only interesting for the one person you are thinking about.
 */
function Slot({ role, officer, open, onToggle }: SlotProps) {
  const filled = officer !== undefined;
  const label = OFFICER_ROLE_LABELS[role];

  const body = (
    <>
      <span
        className={cn(
          'flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border-2 transition-colors',
          filled
            ? 'icon-tile border-brass-300/60 text-brass-100'
            : 'border-dashed border-surface-600 bg-surface-900/70 text-ink-300',
        )}
      >
        {filled ? (
          <span className="font-display text-xl font-bold">{officer.name.slice(0, 1)}</span>
        ) : (
          <Icon name="crew" className="h-7 w-7" />
        )}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-display text-[13px] font-bold uppercase tracking-[0.12em] text-brass-300">
          {label}
        </span>
        <span
          className={cn(
            'block truncate font-body text-[13px]',
            filled ? 'text-ink-100' : 'text-ink-300',
          )}
        >
          {filled ? officer.name : 'Vacant'}
        </span>
        {filled && (
          <span className="mt-0.5 block font-display text-[12px] uppercase tracking-[0.12em] text-ink-300">
            {officer.assignees} assigned · {percent(officer.bonusPercent)}
          </span>
        )}
      </span>
    </>
  );

  if (!filled) {
    return (
      <div
        data-testid={`crew-slot-${role}`}
        className="flex items-center gap-3 rounded-sm border border-surface-700 bg-surface-900/50 p-3 opacity-70"
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-testid={`crew-slot-${role}`}
      className={cn(
        'flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-colors',
        open
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-surface-600 bg-surface-800/60 hover:border-brass-300/60 hover:bg-brass-300/5',
      )}
    >
      {body}
    </button>
  );
}

/**
 * The character behind a slot, as a proper window.
 *
 * Half the width of the frame and most of its height, because a person is the most expensive
 * decision in the game and looking one over should feel like opening a file rather than expanding
 * a row. Portrait on the left — empty until the board delivers officer art, and deliberately shaped
 * like the frame it will fill — the sheet on the right, and the three things you can actually do
 * along the bottom: put people under them, move them into a different job, or go and train them.
 *
 * A modal rather than an inline panel, unlike the first version. Nineteen slots is a tall grid, and
 * a card opened *inside* it either pushes half the chart off screen or opens somewhere the player
 * is not looking. A window over the top has neither problem.
 */
function OfficerDetail({
  officer,
  cap,
  unplaced,
  filledRoles,
  pending,
  onPlace,
  onReassign,
  onClose,
}: {
  officer: AssigneeOfficer;
  cap: number;
  unplaced: number;
  filledRoles: readonly OfficerRole[];
  pending: boolean;
  onPlace: () => void;
  onReassign: (role: OfficerRole) => void;
  onClose: () => void;
}) {
  const atCap = officer.assignees >= cap;
  const open = OFFICER_ROLES.filter((role) => role === officer.role || !filledRoles.includes(role));

  return (
    <Modal
      onClose={onClose}
      labelledBy="officer-detail-title"
      size="wide"
      className="h-[85vh] border-brass-300/40"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="crew-detail">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-surface-600/60 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="officer-detail-title"
              className="font-display text-2xl font-bold tracking-[0.04em] text-ink-100"
            >
              {officer.name}
            </h2>
            <p className="mt-0.5 font-display text-[13px] uppercase tracking-[0.16em] text-brass-300">
              {OFFICER_ROLE_LABELS[officer.role]} · level {officer.level}
            </p>
          </div>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-sm border px-2.5 py-1 font-display text-[12px] font-bold uppercase tracking-[0.14em]',
                BAND_STYLE[officer.alignmentBand],
              )}
              title={`Alignment ${officer.alignment} of 100`}
            >
              {ALIGNMENT_BAND_LABELS[officer.alignmentBand]}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </span>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 p-5 md:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            {/* The frame the officer's portrait will land in. Empty on purpose rather than absent:
                a face-shaped hole reads as "art is coming", and a missing block reads as a bug. */}
            <div className="painted washed rivets edge-lit flex aspect-[3/4] w-full items-center justify-center rounded-sm border-2 border-surface-600/80">
              <span className="font-display text-5xl font-bold text-ink-500">
                {officer.name.slice(0, 1)}
              </span>
            </div>

            {officer.traits.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {officer.traits.map((trait) => (
                  <DescribedTag
                    key={trait}
                    label={TRAIT_CATALOG[trait].name}
                    description={TRAIT_CATALOG[trait].description}
                    detail={traitDetail(trait)}
                    className={
                      isFlaw(trait)
                        ? 'border-oxblood-500 text-oxblood-300'
                        : 'border-surface-600 text-ink-200'
                    }
                  />
                ))}
              </div>
            )}

            <Link
              to="/game/training"
              onClick={onClose}
              className="rounded-sm border border-brass-300/60 px-3 py-2 text-center font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300 transition-colors hover:bg-brass-300/10"
            >
              Train them
            </Link>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <section>
              <h3 className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
                What they can do
              </h3>
              <div className="rounded-sm border border-surface-600/70 bg-surface-900/50 p-3">
                <AttributeSheet attributes={officer.attributes} />
              </div>
            </section>

            <section>
              <h3 className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
                Under them
              </h3>
              <Pips filled={officer.assignees} cap={cap} />
              <p className="mt-1.5 font-display text-[13px] tabular-nums tracking-[0.1em] text-ink-200">
                {officer.assignees} / {cap} ·{' '}
                <span className="text-brass-300">{percent(officer.bonusPercent)}</span>
                {officer.nextBonusPercent !== null && (
                  <span className="text-ink-400">
                    {' '}
                    → {percent(officer.nextBonusPercent)} with one more
                  </span>
                )}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-2"
                disabled={atCap || unplaced === 0 || pending}
                onClick={onPlace}
              >
                {atCap ? 'At cap' : unplaced === 0 ? 'Nobody spare' : 'Assign one'}
              </Button>
            </section>

            {/* §C2 — a hire is a person, not a job title. Only open positions are offered: two
                people cannot hold one, and a swap is two moves the player makes on purpose. */}
            <section>
              <h3 className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
                Move them
              </h3>
              {/* `aria-label`, not a visually-hidden span. `sr-only` clips its own text to a 1px
                  box by design, which is exactly the shape every "is any text cut off?" gate in
                  the suite looks for — and this one is a whole officer's name long. */}
              <label className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <Dropdown
                    label={`New position for ${officer.name}`}
                    value={officer.role}
                    disabled={pending}
                    onChange={onReassign}
                    options={open.map((role) => ({
                      value: role,
                      label: OFFICER_ROLE_LABELS[role],
                    }))}
                    data-testid="reassign-role"
                  />
                </span>
              </label>
              <p className="mt-1.5 font-body text-[12px] leading-snug text-ink-300">
                Their assignees come with them. Positions somebody else holds are not offered.
              </p>
            </section>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** A trait's whole mechanical effect, written out. */
function traitDetail(trait: TraitId): string {
  return Object.entries(TRAIT_CATALOG[trait].bonus)
    .map(
      ([name, amount]) =>
        `${amount > 0 ? '+' : ''}${amount} ${ATTRIBUTE_LABELS[name as AttributeName]}`,
    )
    .join(' · ');
}

/** Devotion reads in the player's own accent; a walkout reads as a warning. */
const BAND_STYLE: Record<AlignmentBand, string> = {
  leaving: 'border-oxblood-500/60 text-oxblood-300',
  unsettled: 'border-surface-600 text-ink-200',
  settled: 'border-brass-300/50 text-brass-300',
  devoted: 'border-bile-300/50 text-bile-300',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300">
        {label}
      </p>
      <p className="font-display text-2xl font-bold tabular-nums text-ink-100">{value}</p>
      {hint !== undefined && <p className="text-[12px] text-ink-300">{hint}</p>}
    </div>
  );
}

function Layout({ data }: { data: AssigneesResponse }) {
  const place = usePlaceAssignees();
  const reskill = useReskillAssignees();
  const reassign = useReassignOfficer();
  const pending = place.isPending || reskill.isPending || reassign.isPending;
  /** Which officer's card is open, if any. One at a time — this is a drill-down, not a list. */
  const [opened, setOpened] = useState<string | null>(null);
  const open = data.officers.find((officer) => officer.officerId === opened);

  return (
    <PageShell title="Your crew" icon="crew" wide>
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
            <p className="mt-1.5 text-[12px] leading-snug text-ink-300">
              {data.canReskill
                ? 'Your Professor recalls every assignee at once.'
                : 'Hire a Professor to recall assignees once placed.'}
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="The books">
        {data.officers.length === 0 && (
          <p className="px-4 pt-4 text-[13px] text-ink-300">
            Nineteen positions, nobody in any of them yet. Hire somebody at the Bar and they take a
            slot below.
          </p>
        )}
        {open !== undefined && (
          <OfficerDetail
            officer={open}
            cap={data.capPerOfficer}
            unplaced={data.unplaced}
            filledRoles={data.officers.map((one) => one.role)}
            pending={pending}
            onPlace={() => place.mutate({ officerId: open.officerId, count: 1 })}
            onReassign={(role) => reassign.mutate({ officerId: open.officerId, role })}
            onClose={() => setOpened(null)}
          />
        )}

        <div className="grid gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {OFFICER_ROLES.map((role) => {
            const officer = data.officers.find((candidate) => candidate.role === role);
            return (
              <div key={role} className="flex min-w-0 flex-col gap-2.5">
                <Slot
                  role={role}
                  officer={officer}
                  open={officer !== undefined && opened === officer.officerId}
                  onToggle={() =>
                    setOpened((current) =>
                      officer && current === officer.officerId
                        ? null
                        : (officer?.officerId ?? null),
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      </Panel>
    </PageShell>
  );
}

export function AssigneesPage() {
  const { data, isPending, isError } = useAssignees();

  if (isPending) return <p className="p-4 text-sm text-ink-300">Reading the roster…</p>;
  if (isError || !data) {
    return <p className="p-4 text-sm text-oxblood-300">Could not read your assignees.</p>;
  }
  return <Layout data={data} />;
}
