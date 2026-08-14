import {
  BUILDING_CATALOG,
  BUILDING_KINDS,
  MAX_MODIFICATION_SLOTS,
  MODIFICATION_SLOT_LEVELS,
  findModification,
  type ActiveResearch,
  type BuildingKind,
  type ModificationBlocker,
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_GROUPS,
  CROSS_REFERENCE_IMAGINATION,
  MAX_ATTRIBUTE,
  MAX_ROLE_FACTS,
  OFFICER_ROLE_LABELS,
  RESEARCH_MINUTES,
  attributeTier,
  consultOnAssignment,
  formatCountdown,
  formatDuration,
  pairingsIn,
  researchProgressAt,
  researchRemainingMs,
  roleFactsIn,
  type AttributeName,
  type AttributeTier,
  type DiscoveredFact,
  type OfficerRole,
  type ResearchResponse,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBar, useResearch, useStartResearch } from '../../lib/queries';

/**
 * Research & discovery (GDD §B9, §F2–§F4).
 *
 * Everything role-related on this page is rendered from `facts` — the crew's own discovered facts,
 * shipped by `GET /api/research`. The consultation panel calls `consultOnAssignment` from
 * `@frontline/shared` *in the browser*, over the recruit sheets the Bar already serves: there is no
 * server-side judgement to leak, because there is no server-side judgement (§B8a, INTERFACES R4).
 */

const TIER_STYLE: Record<AttributeTier, string> = {
  weak: 'text-neon-magenta',
  average: 'text-steel-300',
  strong: 'text-neon-cyan',
  elite: 'text-bile-300',
};

/** Attribute ids are snake_case in the model and Title Case on screen. */
function labelOf(attribute: string): string {
  return attribute.charAt(0).toUpperCase() + attribute.slice(1);
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-xs text-steel-600">{text}</p>;
}

/** A live countdown on the project in flight — the same tick the missions page runs. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** What the crew is on, in one line — the three project kinds each read differently. */
function titleOf(project: ActiveResearch['project']): string {
  switch (project.kind) {
    case 'investigation':
      return `Investigating the ${OFFICER_ROLE_LABELS[project.role]} position`;
    case 'training':
      return `Training — ${labelOf(project.attribute)}`;
    case 'modification':
      return `Fitting — ${findModification(project.modificationId)?.name ?? 'a modification'}`;
  }
}

function ActiveProject({ data, now }: { data: ResearchResponse; now: number }) {
  const active = data.active;
  if (!active) return null;

  const at = new Date(now);
  const progress = researchProgressAt(active, at);
  const remaining = researchRemainingMs(active, at);
  const title = titleOf(active.project);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 font-display text-xs uppercase tracking-[0.18em] text-steel-200">
          {title}
        </p>
        <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-neon-cyan">
          {remaining === 0 ? 'Landing…' : formatCountdown(remaining)}
        </span>
      </div>
      <div className="h-1 overflow-hidden bg-steel-800">
        <div className="h-full bg-neon-cyan" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      {active.project.kind === 'investigation' && active.project.crossReference && (
        <p className="text-[11px] leading-relaxed text-bile-300">
          Cross-referencing — they are also watching for what goes with what.
        </p>
      )}
    </div>
  );
}

interface StartFormProps {
  data: ResearchResponse;
  pending: boolean;
  onStart: (project: Parameters<ReturnType<typeof useStartResearch>['mutate']>[0]) => void;
}

/** §B9 + §F2 + §F4 — the two things the crew can be put on, and the option one of them unlocks. */
function StartForm({ data, pending, onStart }: StartFormProps) {
  const [role, setRole] = useState<OfficerRole | ''>('');
  const [leadId, setLeadId] = useState('');
  const [crossReference, setCrossReference] = useState(false);
  const [attribute, setAttribute] = useState<AttributeName>('imagination');

  const lead = data.leads.find((candidate) => candidate.officerId === leadId) ?? data.leads[0];
  const canCrossReference = (lead?.crossReference ?? false) && !data.pairingsExhausted;
  const chosenRole = role === '' ? data.openRoles[0] : role;

  const affordable = (kind: 'investigation' | 'training' | 'modification') =>
    data.caps >= data.costs[kind];
  const trainable = data.overseerAttributes[attribute] < MAX_ATTRIBUTE;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-3 border border-steel-800 p-3">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-[11px] uppercase tracking-[0.2em] text-steel-200">
            Investigate a position
          </h3>
          <span className="shrink-0 font-display text-[10px] tabular-nums text-steel-500">
            {data.costs.investigation}c · {formatDuration(RESEARCH_MINUTES.investigation)}
          </span>
        </header>
        <p className="text-[11px] leading-relaxed text-steel-500">
          Your Professor reads the files on who has worked out where. You get what the job leans on
          — never how much, and never all of it.
        </p>

        {data.leads.length === 0 ? (
          <p className="text-[11px] text-warning">
            Nobody on your books can run this. Hire a Professor or a Head of Research.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
                Lead
              </span>
              <select
                value={lead?.officerId ?? ''}
                onChange={(event) => {
                  setLeadId(event.target.value);
                  setCrossReference(false);
                }}
                className="min-w-0 border border-steel-700 bg-night px-2 py-1.5 text-[11px] text-steel-200"
              >
                {data.leads.map((candidate) => (
                  <option key={candidate.officerId} value={candidate.officerId}>
                    {candidate.name} — {OFFICER_ROLE_LABELS[candidate.role]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
                Position
              </span>
              <select
                value={chosenRole ?? ''}
                onChange={(event) => setRole(event.target.value as OfficerRole)}
                className="min-w-0 border border-steel-700 bg-night px-2 py-1.5 text-[11px] text-steel-200"
              >
                {data.openRoles.map((open) => (
                  <option key={open} value={open}>
                    {OFFICER_ROLE_LABELS[open]}
                  </option>
                ))}
              </select>
            </label>

            {/* §F4 — an option that is *locked*, and says why, rather than quietly doing nothing. */}
            <label
              className={cn(
                'flex items-start gap-2 border p-2',
                canCrossReference ? 'border-bile-300/40' : 'border-steel-800',
              )}
            >
              <input
                type="checkbox"
                checked={crossReference && canCrossReference}
                disabled={!canCrossReference}
                onChange={(event) => setCrossReference(event.target.checked)}
                className="mt-0.5 shrink-0 accent-bile-300"
              />
              <span className="min-w-0 text-[11px] leading-relaxed">
                <span className={canCrossReference ? 'text-bile-300' : 'text-steel-500'}>
                  Cross-reference
                </span>
                <span className="block text-steel-500">
                  {data.pairingsExhausted
                    ? 'Every connection they could draw, they already have.'
                    : canCrossReference
                      ? 'They will also notice what goes with what.'
                      : `Locked — needs Imagination ${CROSS_REFERENCE_IMAGINATION}.`}
                </span>
              </span>
            </label>

            <Button
              size="sm"
              disabled={
                pending || !chosenRole || !affordable('investigation') || data.active !== null
              }
              onClick={() => {
                if (!chosenRole || !lead) return;
                onStart({
                  kind: 'investigation',
                  role: chosenRole,
                  leadOfficerId: lead.officerId,
                  crossReference: crossReference && canCrossReference,
                });
              }}
            >
              {affordable('investigation') ? 'Put them on it' : 'Not enough caps'}
            </Button>
          </>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-3 border border-steel-800 p-3">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-[11px] uppercase tracking-[0.2em] text-steel-200">
            Develop yourself
          </h3>
          <span className="shrink-0 font-display text-[10px] tabular-nums text-steel-500">
            {data.costs.training}c · {formatDuration(RESEARCH_MINUTES.training)}
          </span>
        </header>
        <p className="text-[11px] leading-relaxed text-steel-500">
          Any attribute, whether or not it suits you. Time and caps, one point at a time.
        </p>

        <label className="flex flex-col gap-1">
          <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
            Attribute
          </span>
          <select
            value={attribute}
            onChange={(event) => setAttribute(event.target.value as AttributeName)}
            className="min-w-0 border border-steel-700 bg-night px-2 py-1.5 text-[11px] text-steel-200"
          >
            {ATTRIBUTE_GROUPS.map((group) => (
              <optgroup key={group} label={labelOf(group)}>
                {ATTRIBUTES_BY_GROUP[group].map((name) => (
                  <option key={name} value={name}>
                    {labelOf(name)} — {data.overseerAttributes[name]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <p className="text-[11px] text-steel-400">
          {labelOf(attribute)}{' '}
          <span className="font-display font-semibold tabular-nums text-steel-200">
            {data.overseerAttributes[attribute]}
          </span>
          {trainable ? (
            <>
              {' → '}
              <span className="font-display font-semibold tabular-nums text-neon-cyan">
                {data.overseerAttributes[attribute] + 1}
              </span>
            </>
          ) : (
            <span className="text-warning"> — already at the ceiling</span>
          )}
        </p>

        <Button
          size="sm"
          disabled={pending || !trainable || !affordable('training') || data.active !== null}
          onClick={() => onStart({ kind: 'training', attribute })}
        >
          {affordable('training') ? 'Begin training' : 'Not enough caps'}
        </Button>
      </section>

      <ModificationsSection data={data} pending={pending} onStart={onStart} />
    </div>
  );
}

/** Why a modification cannot be started, in the words the player needs to act on it. */
const BLOCKER_TEXT: Record<ModificationBlocker, string> = {
  not_built: 'Not built',
  no_slot: 'No free slot',
  no_lead_engineer: 'Needs a Lead Engineer',
  research_busy: 'Bench busy',
  cannot_afford: 'Cannot afford',
};

/**
 * §A1 — the sixty-five modifications, grouped by the structure they go in.
 *
 * The whole catalogue is shown, not just the startable ones: what raising the Lab would unlock is
 * exactly the information a player needs *before* they raise it, and a list that hid everything
 * unavailable would hide precisely that. `blocker` comes from the server, so the reason a row is
 * dead is by construction the reason the route would give.
 */
function ModificationsSection({ data, pending, onStart }: StartFormProps) {
  const [kind, setKind] = useState<BuildingKind>('nexus');
  const shown = data.modifications.filter((option) => option.building === kind);

  return (
    <section className="flex min-w-0 flex-col gap-3 border border-steel-800 p-3 lg:col-span-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[11px] uppercase tracking-[0.2em] text-steel-200">
          Fit a modification
        </h3>
        <span className="shrink-0 font-display text-[10px] tabular-nums text-steel-500">
          {data.costs.modification}c + materials · {formatDuration(RESEARCH_MINUTES.modification)}
        </span>
      </header>
      <p className="text-[11px] leading-relaxed text-steel-500">
        Permanent, and limited to {MAX_MODIFICATION_SLOTS} per structure — slots open at levels{' '}
        {MODIFICATION_SLOT_LEVELS.join(', ')}. Your Lead Engineer does the work.
      </p>

      {!data.canModify && (
        <p className="text-[11px] text-warning">
          Nobody on your books can run this. Hire a Lead Engineer.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
          Structure
        </span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as BuildingKind)}
          className="min-w-0 border border-steel-700 bg-night px-2 py-1.5 text-[11px] text-steel-200"
        >
          {BUILDING_KINDS.map((option) => (
            <option key={option} value={option}>
              {BUILDING_CATALOG[option].name}
            </option>
          ))}
        </select>
      </label>

      <ul className="flex flex-col gap-2" data-testid="modification-options">
        {shown.map((option) => (
          <li
            key={option.id}
            className="flex flex-wrap items-center justify-between gap-2 border border-steel-800 p-2"
          >
            <div className="min-w-0 flex-1">
              <p className="font-display text-[11px] uppercase tracking-[0.14em] text-steel-200">
                {option.name}{' '}
                <span className="tabular-nums text-neon-cyan">+{option.magnitude}</span>
              </p>
              <p className="text-[11px] leading-relaxed text-steel-500">{option.description}</p>
            </div>
            {option.installed ? (
              <span className="shrink-0 border border-neon-cyan/40 px-2 py-1 font-display text-[9px] uppercase tracking-[0.16em] text-neon-cyan">
                Fitted
              </span>
            ) : (
              <Button
                size="sm"
                disabled={pending || option.blocker !== null}
                onClick={() => onStart({ kind: 'modification', modificationId: option.id })}
              >
                {option.blocker === null ? 'Fit it' : BLOCKER_TEXT[option.blocker]}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** §B9 — what the crew has actually learned, grouped by the position it is about. */
function FactsPanel({ facts }: { facts: readonly DiscoveredFact[] }) {
  const roles = [
    ...new Set(facts.flatMap((fact) => (fact.kind === 'role_attribute' ? [fact.role] : []))),
  ];
  const pairings = pairingsIn(facts);

  if (facts.length === 0) {
    return <EmptyRow text="You know nothing about what these jobs need. Yet." />;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {roles.length > 0 && (
        <ul className="flex flex-col divide-y divide-steel-800">
          {roles.map((role) => {
            const known = roleFactsIn(facts, role);
            return (
              <li key={role} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 font-display text-[11px] uppercase tracking-[0.16em] text-steel-200">
                  {OFFICER_ROLE_LABELS[role]}
                </span>
                <span className="flex min-w-0 flex-wrap gap-1.5">
                  {known.map((attribute) => (
                    <span
                      key={attribute}
                      className="inline-flex shrink-0 items-center border border-neon-cyan/40 px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.14em] text-neon-cyan"
                    >
                      {labelOf(attribute)}
                    </span>
                  ))}
                </span>
                <span className="ml-auto shrink-0 font-display text-[9px] tabular-nums text-steel-600">
                  {known.length} / {MAX_ROLE_FACTS} leads
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {pairings.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-steel-800 pt-3">
          <p className="font-display text-[9px] uppercase tracking-[0.2em] text-steel-500">
            What goes with what
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {pairings.map((pairing) => (
              <li
                key={`${pairing.attributes[0]}-${pairing.attributes[1]}`}
                className="inline-flex shrink-0 items-center border border-bile-300/40 px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.14em] text-bile-300"
              >
                {labelOf(pairing.attributes[0])} + {labelOf(pairing.attributes[1])}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * §B9 — "feedback you can ask for about a potential assignment for a given role".
 *
 * Computed here, in the browser, from the recruit sheets the Bar already serves and the facts this
 * crew has earned. No ranking and no total: the discovered attributes, read off each sheet, and the
 * player decides.
 */
function ConsultPanel({ facts }: { facts: readonly DiscoveredFact[] }) {
  const barQuery = useBar();
  const researched = [
    ...new Set(facts.flatMap((fact) => (fact.kind === 'role_attribute' ? [fact.role] : []))),
  ];
  const [role, setRole] = useState<OfficerRole | ''>('');
  const chosen = role === '' ? researched[0] : role;
  const recruits = barQuery.data?.recruits ?? [];

  if (researched.length === 0) {
    return <EmptyRow text="Investigate a position first — there is nothing to consult on." />;
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <label className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
          Assignment
        </span>
        <select
          value={chosen ?? ''}
          onChange={(event) => setRole(event.target.value as OfficerRole)}
          className="min-w-0 border border-steel-700 bg-night px-2 py-1.5 text-[11px] text-steel-200"
        >
          {researched.map((known) => (
            <option key={known} value={known}>
              {OFFICER_ROLE_LABELS[known]}
            </option>
          ))}
        </select>
      </label>

      {recruits.length === 0 ? (
        <EmptyRow text="Nobody in the room tonight." />
      ) : (
        <ul className="flex flex-col divide-y divide-steel-800">
          {recruits.map((recruit) => {
            const notes = chosen ? consultOnAssignment(recruit.attributes, chosen, facts) : [];
            return (
              <li key={recruit.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 truncate text-[11px] text-steel-200">{recruit.name}</span>
                <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-1">
                  {notes.map((note) => (
                    <span key={note.attribute} className="shrink-0 font-display text-[10px]">
                      <span className="text-steel-500">{labelOf(note.attribute)} </span>
                      <span className={cn('font-semibold tabular-nums', TIER_STYLE[note.tier])}>
                        {note.value}
                      </span>
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[10px] leading-relaxed text-steel-600">
        Ratings are read off each sheet with {labelOf(attributeTier(0))} — {labelOf('elite')} bands.
        Nobody is scored or ranked for you.
      </p>
    </div>
  );
}

export function ResearchPage() {
  const researchQuery = useResearch();
  const start = useStartResearch();
  const data = researchQuery.data;
  const now = useTick(data?.active != null);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header>
          <p className="font-display text-[10px] tracking-[0.4em] text-neon-cyan/70">
            // RESEARCH //
          </p>
          <h1 className="text-glow-cyan mt-1 font-display text-2xl font-bold tracking-[0.15em] text-steel-100">
            The Archive
          </h1>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-steel-500">
            Nobody will ever hand you the list of what a job needs. Put the right person on the
            files for long enough and you will work out{' '}
            <em className="not-italic text-steel-300">some</em> of it.
          </p>
        </header>

        <Panel
          title={data?.active ? 'In progress' : 'Put someone on it'}
          action={
            <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.18em] text-steel-500">
              <span className="tabular-nums text-steel-300">{data?.caps ?? 0}</span> caps
            </span>
          }
        >
          {researchQuery.isLoading || !data ? (
            <EmptyRow text="Opening the archive…" />
          ) : data.active ? (
            <ActiveProject data={data} now={now} />
          ) : (
            <StartForm data={data} pending={start.isPending} onStart={(p) => start.mutate(p)} />
          )}
          {start.error && (
            <p className="border-t border-steel-800 px-4 py-2 text-[11px] text-neon-magenta">
              {start.error.message}
            </p>
          )}
        </Panel>

        <Panel
          title="What we know"
          action={
            data && data.justDiscovered.length > 0 ? (
              <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.18em] text-bile-300">
                +{data.justDiscovered.length} just in
              </span>
            ) : undefined
          }
        >
          <FactsPanel facts={data?.facts ?? []} />
        </Panel>

        <Panel title="Consult on an assignment">
          <ConsultPanel facts={data?.facts ?? []} />
        </Panel>
      </div>
    </div>
  );
}
