import {
  ALIGNMENT_BAND_LABELS,
  AMBITION_SPECS,
  MORAL_COMPASS_SPECS,
  OFFICER_ROLE_LABELS,
  OFFICER_ROLES,
  TRAIT_CATALOG,
  reservationWage,
  type AlignmentBand,
  type BarOfficer,
  type BarRecruit,
  type JoinBlocker,
  type OfficerRole,
} from '@frontline/shared';
import { useState } from 'react';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBar, useHireRecruit } from '../../lib/queries';

/** Devotion reads in the player's own accent; a walkout reads as a warning. */
const BAND_STYLE: Record<AlignmentBand, string> = {
  leaving: 'border-neon-magenta/50 text-neon-magenta',
  unsettled: 'border-steel-600 text-steel-300',
  settled: 'border-neon-cyan/50 text-neon-cyan',
  devoted: 'border-bile-300/50 text-bile-300',
};

const BLOCKER_LABEL: Record<JoinBlocker, string> = {
  infamy: 'Not infamous enough',
  reputation: 'Wants no part of you',
};

function Tag({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center border border-steel-700 px-2 py-1 font-display text-[9px] uppercase tracking-[0.18em] text-steel-400',
        className,
      )}
    >
      {label}
    </span>
  );
}

/** §H5 — the meter itself, so "too low" and "high" are visible rather than inferred. */
function AlignmentMeter({ value, band }: { value: number; band: AlignmentBand }) {
  const fill =
    band === 'leaving' ? 'bg-neon-magenta' : band === 'devoted' ? 'bg-bile-300' : 'bg-neon-cyan';
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1 min-w-0 flex-1 overflow-hidden bg-steel-800">
        <div className={cn('h-full', fill)} style={{ width: `${Math.round(value)}%` }} />
      </div>
      <span className="shrink-0 font-display text-[10px] font-semibold tabular-nums text-steel-300">
        {Math.round(value)}
      </span>
    </div>
  );
}

/** What a character wants and how far they will go for it (§H4). */
function Disposition({ ambition, moralCompass }: Pick<BarRecruit, 'ambition' | 'moralCompass'>) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      <Tag
        label={AMBITION_SPECS[ambition].label}
        className="border-hextech-100/40 text-hextech-100"
      />
      <Tag label={MORAL_COMPASS_SPECS[moralCompass].label} />
    </div>
  );
}

interface RecruitCardProps {
  recruit: BarRecruit;
  filledRoles: readonly OfficerRole[];
  caps: number;
  /** §H8 — every slot is taken, so no offer can be made however willing the character is. */
  full: boolean;
  pending: boolean;
  counter: number | null;
  onOffer: (recruitId: string, role: OfficerRole, offerWage: number) => void;
}

/**
 * One person at the Bar (§H1–§H4, §H7).
 *
 * Nothing on this card says what role they would be *good* at — the player reads the sheet and
 * decides, which is what §B8 asks for. The role picker is a hiring choice (§C2), not a hint.
 */
function RecruitCard({
  recruit,
  filledRoles,
  caps,
  full,
  pending,
  counter,
  onOffer,
}: RecruitCardProps) {
  const open = OFFICER_ROLES.filter((role) => !filledRoles.includes(role));
  const [role, setRole] = useState<OfficerRole>(() => open[0] ?? 'head_spy');
  const [offer, setOffer] = useState<string>('');

  const asking = recruit.askingWage;
  const proposed = offer === '' ? (counter ?? asking ?? 0) : Number(offer);
  const affordable = proposed <= caps;
  const canOffer =
    recruit.assessment.interested &&
    !recruit.hired &&
    !full &&
    open.length > 0 &&
    proposed > 0 &&
    affordable;

  return (
    <article className="flex min-w-0 flex-col gap-3 border border-steel-800 bg-night p-4">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-display text-sm font-semibold uppercase tracking-[0.12em] text-steel-100">
          {recruit.name}
        </h3>
        {recruit.hired ? (
          <Tag label="On your books" className="border-bile-300/50 text-bile-300" />
        ) : recruit.assessment.interested ? (
          <Tag label={`${asking ?? 0} caps/wk`} className="border-neon-cyan/50 text-neon-cyan" />
        ) : (
          <Tag label="Not talking" className="border-neon-magenta/50 text-neon-magenta" />
        )}
      </header>

      <Disposition ambition={recruit.ambition} moralCompass={recruit.moralCompass} />

      <AttributeSheet attributes={recruit.attributes} />

      {recruit.traits.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {recruit.traits.map((trait) => (
            <Tag key={trait} label={TRAIT_CATALOG[trait].name} className="border-steel-600" />
          ))}
        </div>
      )}

      {recruit.requirement.minInfamy > 0 && (
        <p className="min-w-0 break-words font-display text-[9px] uppercase tracking-[0.16em] text-steel-500">
          Wants a crew at{' '}
          <span className="tabular-nums text-steel-300">{recruit.requirement.minInfamy}</span>{' '}
          infamy
        </p>
      )}

      {recruit.hired ? null : recruit.assessment.interested ? (
        <div className="mt-auto flex min-w-0 flex-col gap-2 pt-1">
          {counter !== null && (
            <p className="min-w-0 break-words text-[11px] leading-relaxed text-warning">
              Turned it down — they will sign for {counter} caps a week.
            </p>
          )}
          <label className="flex min-w-0 flex-col gap-1">
            <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
              Hire as
            </span>
            <select
              aria-label={`Role for ${recruit.name}`}
              value={role}
              onChange={(event) => setRole(event.target.value as OfficerRole)}
              className="min-w-0 border border-steel-700 bg-night-raised px-2 py-1.5 font-display text-[11px] text-steel-200"
            >
              {open.map((option) => (
                <option key={option} value={option}>
                  {OFFICER_ROLE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-0 items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
                Offer (caps/wk)
              </span>
              <input
                aria-label={`Weekly wage for ${recruit.name}`}
                type="number"
                min={0}
                inputMode="numeric"
                placeholder={String(counter ?? asking ?? 0)}
                value={offer}
                onChange={(event) => setOffer(event.target.value)}
                className="w-full min-w-0 border border-steel-700 bg-night-raised px-2 py-1.5 font-display text-[11px] tabular-nums text-steel-200"
              />
            </label>
            <Button
              size="sm"
              disabled={!canOffer || pending}
              onClick={() => onOffer(recruit.id, role, Math.round(proposed))}
            >
              {pending ? 'Talking…' : 'Offer'}
            </Button>
          </div>
          {asking !== null && (
            <p className="font-display text-[9px] uppercase tracking-[0.16em] text-steel-600">
              They will not go below{' '}
              <span className="tabular-nums text-steel-400">{reservationWage(asking)}</span>
            </p>
          )}
          {!affordable && (
            <p className="text-[11px] leading-relaxed text-neon-magenta">
              You do not have the caps for the first payment.
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-auto flex min-w-0 flex-col gap-1 pt-1">
          {recruit.assessment.blockers.map((blocker) => (
            <li
              key={blocker}
              className="min-w-0 break-words font-display text-[9px] uppercase tracking-[0.16em] text-neon-magenta/80"
            >
              {BLOCKER_LABEL[blocker]}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** One officer on the books, with their §H5 standing and §H6 level. */
function OfficerRow({ officer }: { officer: BarOfficer }) {
  const { commander } = officer;
  return (
    <li className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.12em] text-steel-100">
          {commander.name}
        </span>
        <Tag label={ALIGNMENT_BAND_LABELS[officer.band]} className={BAND_STYLE[officer.band]} />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 truncate font-display text-[9px] uppercase tracking-[0.16em] text-steel-500">
          {OFFICER_ROLE_LABELS[commander.role]} · Lv {commander.level}
        </span>
        <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.14em] text-steel-400">
          <span className="tabular-nums text-steel-200">{officer.weeklyWage}</span> caps/wk
        </span>
      </div>
      <AlignmentMeter value={commander.alignment} band={officer.band} />
      {officer.skillBonus > 0 && (
        <p className="min-w-0 break-words font-display text-[9px] uppercase tracking-[0.14em] text-bile-300">
          +{officer.skillBonus} to {officer.bonusAttributes.join(', ')}
        </p>
      )}
      {officer.threateningToLeave && (
        <p className="min-w-0 break-words text-[11px] leading-relaxed text-neon-magenta">
          Says they are done unless something changes.
        </p>
      )}
      {commander.unspentPoints > 0 && (
        <p className="min-w-0 break-words font-display text-[9px] uppercase tracking-[0.14em] text-neon-cyan">
          {commander.unspentPoints} point{commander.unspentPoints === 1 ? '' : 's'} to assign
        </p>
      )}
    </li>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-4 py-6 text-center font-display text-[10px] uppercase tracking-[0.2em] text-steel-600">
      {text}
    </p>
  );
}

/**
 * The Bar (GDD §H1) — today's roster and the crew it has already given you.
 *
 * The roster is the same for every player on the same UTC day (§H2), which the header says out
 * loud: it is a shared room, not a personalised shortlist.
 */
export function BarPage() {
  const barQuery = useBar();
  const hire = useHireRecruit();
  const [counters, setCounters] = useState<Record<string, number>>({});

  const data = barQuery.data;
  const recruits = data?.recruits ?? [];
  const officers = data?.officers ?? [];
  const full = data !== undefined && data.slotsUsed >= data.slotsTotal;

  const onOffer = (recruitId: string, role: OfficerRole, offerWage: number) => {
    hire.mutate(
      { recruitId, role, offerWage },
      {
        onSuccess: (result) =>
          setCounters((current) => {
            if (result.accepted) {
              const { [recruitId]: _signed, ...rest } = current;
              return rest;
            }
            return { ...current, [recruitId]: result.wage };
          }),
      },
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header>
          <p className="font-display text-[10px] tracking-[0.4em] text-neon-cyan/70">
            // RECRUITMENT //
          </p>
          <h1 className="text-glow-cyan mt-1 font-display text-2xl font-bold tracking-[0.15em] text-steel-100">
            The Bar
          </h1>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-steel-500">
            The same people drink here whoever you are — the room turns over at midnight UTC, and
            every crew in the city is looking at this list. Whether they will work for{' '}
            <em className="not-italic text-steel-300">you</em> is another question.
          </p>
        </header>

        <Panel
          title="Your Crew"
          action={
            <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.18em] text-steel-500">
              <span className={cn('tabular-nums', full ? 'text-warning' : 'text-steel-300')}>
                {data?.slotsUsed ?? 0}
              </span>
              <span className="tabular-nums"> / {data?.slotsTotal ?? 0}</span> recruits
            </span>
          }
        >
          {barQuery.isLoading ? (
            <EmptyRow text="Reading the room…" />
          ) : officers.length === 0 ? (
            <EmptyRow text="You are drinking alone" />
          ) : (
            <ul className="flex flex-col divide-y divide-steel-800">
              {officers.map((officer) => (
                <OfficerRow key={officer.commander.id} officer={officer} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={data ? `Tonight — ${data.day}` : 'Tonight'}
          action={
            <span className="shrink-0 font-display text-[9px] uppercase tracking-[0.16em] text-steel-500">
              {full ? (
                <span className="text-warning">No room for another</span>
              ) : (
                <>
                  Street reads <span className="text-steel-300">{data?.reputation ?? '—'}</span>
                </>
              )}
            </span>
          }
        >
          {/*
           * Two columns only from `xl`. A recruit card carries the whole 32-attribute sheet (§B6),
           * and at 1024px a two-up grid squeezes its four columns to 61px — enough to ellipsise
           * `communication` and `marksmanship`, which is fixed copy and so a permanent defect
           * rather than a fat-content edge case.
           */}
          {barQuery.isLoading ? (
            <EmptyRow text="Reading the room…" />
          ) : (
            <div className="grid gap-3 p-4 xl:grid-cols-2">
              {recruits.map((recruit) => (
                <RecruitCard
                  key={recruit.id}
                  recruit={recruit}
                  filledRoles={data?.filledRoles ?? []}
                  caps={data?.caps ?? 0}
                  full={full}
                  pending={hire.isPending && hire.variables?.recruitId === recruit.id}
                  counter={counters[recruit.id] ?? null}
                  onOffer={onOffer}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
