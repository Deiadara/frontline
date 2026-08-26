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
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { InfoWindow } from '../../components/ui/InfoWindow';
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
 * Assignees: the fungible pool under each officer (GDD §G).
 *
 * Every number on this page is served by `/api/assignees`, never recomputed here: the §G7 table and
 * the §G8 pool formula live in `@frontline/shared` and are read server-side, so the screen cannot
 * drift from what a launch will actually charge.
 */

/** Formats a §G7 percentage without a trailing `.0`, so 14.5% and 19% both read cleanly. */
export function percent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/**
 * §G1: one pip per assignee. They are interchangeable, so the pips are identical by design.
 *
 * Past {@link PIPS_MAX} it becomes a bar instead. A cap climbs to twenty-four with the crew's level,
 * and twenty-four squares either wrap onto a second line, which breaks the fixed card height every
 * other card depends on, or shrink to a texture nobody can count anyway.
 */
const PIPS_MAX = 12;

function Pips({ filled, cap }: { filled: number; cap: number }) {
  if (cap > PIPS_MAX) {
    return (
      <span className="flex h-2.5 w-full max-w-[9rem] overflow-hidden rounded-sm border border-surface-600 bg-surface-900">
        <span
          className="block h-full bg-brass-300/70"
          style={{ width: `${cap === 0 ? 0 : (filled / cap) * 100}%` }}
        />
      </span>
    );
  }
  return (
    <div className="flex gap-1" aria-hidden="true">
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
  cap: number;
  open: boolean;
  onToggle: () => void;
}

/**
 * One position on the books, filled or not, as a card.
 *
 * The page used to list only the people you had already hired, which meant the nineteen jobs in
 * §C1 were invisible until somebody was standing in one: a player could not see what the crew was
 * *for*, only who happened to be in it. Every position has a card now, empty ones included, so the
 * screen reads as a chart of the organisation and hiring is filling a hole you can already see.
 *
 * Built to the roster's pattern, and for the roster's reason: a **fixed frame**, so that the row of
 * pips and the button land on the same line on every card and the eye can run down a column of
 * nineteen without re-finding anything. Nothing about a character is printed at this size beyond
 * their name and what they are carrying: the sheet is a window away, and nineteen sheets side by
 * side is a wall.
 */
function Slot({ role, officer, cap, open, onToggle }: SlotProps) {
  const filled = officer !== undefined;
  const label = OFFICER_ROLE_LABELS[role];

  const body = (
    <>
      {/* The face column, at the roster card's proportions so the two screens read as one game.
          Empty on purpose rather than absent: a face-shaped hole says art is coming. */}
      <span
        className={cn(
          'relative flex w-[4.5rem] shrink-0 items-center justify-center overflow-hidden border-r',
          filled
            ? 'icon-tile border-surface-700 text-brass-100'
            : 'border-surface-700/70 bg-surface-950/60 text-ink-400',
        )}
      >
        {filled ? (
          <span className="font-display text-3xl font-bold">{officer.name.slice(0, 1)}</span>
        ) : (
          <Icon name="crew" className="h-8 w-8" />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 text-left">
        <span className="block truncate font-display text-[12px] font-bold uppercase tracking-[0.12em] text-brass-300">
          {label}
        </span>
        <span
          className={cn(
            'block truncate font-display text-[15px] font-bold leading-tight',
            filled ? 'text-ink-100' : 'text-ink-400',
          )}
        >
          {filled ? officer.name : 'Vacant'}
        </span>

        {/* The reserved row. Pips when somebody is standing here, a hairline when nobody is, so
            every card in the grid is exactly as tall as every other. */}
        <span className="flex h-4 items-center">
          {filled ? (
            <Pips filled={officer.assignees} cap={cap} />
          ) : (
            <span aria-hidden className="ink-rule w-16 opacity-40" />
          )}
        </span>

        <span className="mt-auto flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate font-display text-[11px] uppercase tracking-[0.12em] tabular-nums',
              filled ? 'text-ink-300' : 'text-ink-400',
            )}
          >
            {filled
              ? `${officer.assignees} / ${cap} · ${percent(officer.bonusPercent)}`
              : 'Nobody hired'}
          </span>
          {filled ? (
            <span
              className={cn(
                'shrink-0 rounded-sm border px-1.5 py-px font-display text-[10px] font-bold uppercase tracking-[0.1em]',
                BAND_STYLE[officer.alignmentBand],
              )}
            >
              {ALIGNMENT_BAND_LABELS[officer.alignmentBand]}
            </span>
          ) : (
            <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.12em] text-brass-300">
              The Bar
            </span>
          )}
        </span>
      </span>
    </>
  );

  const frame =
    'card-paper washed rivets edge-lit flex h-[7.5rem] min-w-0 overflow-hidden rounded-sm border text-left transition-colors';

  if (!filled) {
    return (
      <Link
        to="/game/bar"
        data-testid={`crew-slot-${role}`}
        className={cn(frame, 'border-dashed border-surface-700 opacity-70 hover:opacity-100')}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-testid={`crew-slot-${role}`}
      className={cn(
        frame,
        open
          ? 'border-brass-300 shadow-brass'
          : 'border-surface-600/70 hover:border-brass-300/60 hover:shadow-lifted',
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
 * a row. Portrait on the left: empty until the board delivers officer art, and deliberately shaped
 * like the frame it will fill: the sheet on the right, and the three things you can actually do
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
              data-tip={`Alignment ${officer.alignment} of 100`}
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

            {/* §C2: a hire is a person, not a job title. Only open positions are offered: two
                people cannot hold one, and a swap is two moves the player makes on purpose. */}
            <section>
              <h3 className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
                Move them
              </h3>
              {/* `aria-label`, not a visually-hidden span. `sr-only` clips its own text to a 1px
                  box by design, which is exactly the shape every "is any text cut off?" gate in
                  the suite looks for, and this one is a whole officer's name long. */}
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

function Layout({ data }: { data: AssigneesResponse }) {
  const place = usePlaceAssignees();
  const reskill = useReskillAssignees();
  const reassign = useReassignOfficer();
  const pending = place.isPending || reskill.isPending || reassign.isPending;
  /** Which officer's card is open, if any. One at a time. This is a drill-down, not a list. */
  const [opened, setOpened] = useState<string | null>(null);
  const open = data.officers.find((officer) => officer.officerId === opened);

  return (
    <PageShell title="Your crew" icon="crew" wide>
      {/* Three figures and one control. The paragraph that used to sit beside the Reskill button
          explaining what it does is on the button now, where a player is already pointing. */}
      <div className="flex flex-wrap items-center gap-2">
        <Figure
          label="Pool"
          value={String(data.pool)}
          note={`Level ${data.level}`}
          explain="Everybody your crew has to hand, granted by your level rather than hired. They do nothing at all until you put them under an officer."
        />
        <Figure
          label="Unplaced"
          value={String(data.unplaced)}
          note={data.unplaced === 0 ? 'All working' : 'Idle'}
          explain="People standing around waiting to be given to somebody. Open a position below and assign them."
        />
        <Figure
          label="Per officer"
          value={String(data.capPerOfficer)}
          note={
            data.capPerOfficer >= MAX_ASSIGNEES_PER_OFFICER
              ? 'Maximum'
              : `Up to ${percent(data.maxBonusPercent)}`
          }
          explain="How many one officer can carry, and what a full set is worth to whatever they are doing. Both climb with your level."
        />
        <span className="ml-auto">
          <HoverCard
            size="window"
            label="Reskill"
            onActivate={() => reskill.mutate({ placements: {} })}
            disabled={!data.canReskill || data.placed === 0 || pending}
            card={
              <InfoWindow eyebrow="§G4" title="Reskill" tone="oxblood">
                <p className="font-body text-[14px] leading-relaxed text-ink-100">
                  {data.canReskill
                    ? 'Your Professor calls every assignee back off the books at once, and you place them again from scratch.'
                    : 'Only a Professor can take assignees back once they are placed. Hire one at the Bar.'}
                </p>
              </InfoWindow>
            }
          >
            <span
              className={cn(
                'flex items-center gap-2 rounded-sm border px-3 py-2 font-display text-[12px] font-bold uppercase tracking-[0.14em]',
                !data.canReskill || data.placed === 0
                  ? 'border-surface-700 text-ink-400'
                  : 'border-brass-300/60 text-brass-300 hover:bg-brass-300/10',
              )}
            >
              <Icon name="edit" aria-hidden className="h-4 w-4" />
              Reskill
            </span>
          </HoverCard>
        </span>
      </div>

      {data.officers.length === 0 && (
        <p className="font-body text-[13px] text-ink-300">
          Nineteen positions, nobody in any of them yet. A card is a job: click an empty one to go
          and hire for it.
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

      {/* No panel around it. Nineteen cards inside a bordered box is a box with a border you have
          to look past; the cards are the surface, and the page they sit on already scrolls. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="crew-books">
        {OFFICER_ROLES.map((role) => {
          const officer = data.officers.find((candidate) => candidate.role === role);
          return (
            <Slot
              key={role}
              role={role}
              officer={officer}
              cap={data.capPerOfficer}
              open={officer !== undefined && opened === officer.officerId}
              onToggle={() =>
                setOpened((current) =>
                  officer && current === officer.officerId ? null : (officer?.officerId ?? null),
                )
              }
            />
          );
        })}
      </div>
    </PageShell>
  );
}

/** One figure from the top of the page, with what it means one hover away rather than printed. */
function Figure({
  label,
  value,
  note,
  explain,
}: {
  label: string;
  value: string;
  note: string;
  explain: string;
}) {
  return (
    <HoverCard
      size="window"
      label={`${label}: ${value}`}
      card={
        <InfoWindow eyebrow="Your crew" title={label}>
          <p className="font-body text-[14px] leading-relaxed text-ink-100">{explain}</p>
        </InfoWindow>
      }
    >
      <span className="card-paper washed edge-lit flex items-baseline gap-2 rounded-sm border border-surface-600/70 px-3 py-2">
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300">
          {label}
        </span>
        <span className="font-display text-xl font-bold tabular-nums text-ink-100">{value}</span>
        <span className="font-display text-[11px] uppercase tracking-[0.12em] text-ink-300">
          {note}
        </span>
      </span>
    </HoverCard>
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
