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
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_LABELS,
  CROSS_REFERENCE_IMPROVISATION,
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
  TECH_TRACKS,
  TECH_TRACK_BLURBS,
  TECH_TRACK_LABELS,
  type LabTech,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { useBar, useResearch, useStartResearch } from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { useStartTech } from '../../lib/queries';

/**
 * Research & discovery (GDD §B9, §F2-§F4).
 *
 * Everything role-related on this page is rendered from `facts`: the crew's own discovered facts,
 * shipped by `GET /api/research`. The consultation panel calls `consultOnAssignment` from
 * `@frontline/shared` *in the browser*, over the recruit sheets the Bar already serves: there is no
 * server-side judgement to leak, because there is no server-side judgement (§B8a, INTERFACES R4).
 */

const TIER_STYLE: Record<AttributeTier, string> = {
  weak: 'text-oxblood-300',
  average: 'text-ink-200',
  strong: 'text-brass-300',
  elite: 'text-bile-300',
};

/**
 * How an attribute or a group is written on screen.
 *
 * Reads the shared tables first and only falls back to capitalising. Two attributes do not
 * title-case to their real spelling, and this page and the character sheet have to agree.
 */
function labelOf(name: string): string {
  return (
    (ATTRIBUTE_LABELS as Record<string, string>)[name] ??
    (ATTRIBUTE_GROUP_LABELS as Record<string, string>)[name] ??
    name.charAt(0).toUpperCase() + name.slice(1)
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-xs text-ink-300">{text}</p>;
}

/** A live countdown on the project in flight: the same tick the missions page runs. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** What the crew is on, in one line: the three project kinds each read differently. */
function titleOf(project: ActiveResearch['project']): string {
  switch (project.kind) {
    case 'investigation':
      return `Investigating the ${OFFICER_ROLE_LABELS[project.role]} position`;
    case 'training':
      return `Training: ${labelOf(project.attribute)}`;
    case 'modification':
      return `Fitting: ${findModification(project.modificationId)?.name ?? 'a modification'}`;
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
      {/* One painted bar, the same one a mission and a training batch draw, so every running clock
          in the game reads as the same kind of thing. */}
      <ProgressBar
        progress={progress}
        label={title}
        remaining={remaining === 0 ? 'Landing…' : formatCountdown(remaining)}
        size="md"
        data-testid="research-progress"
      />
      {active.project.kind === 'investigation' && active.project.crossReference && (
        <p className="text-[12px] leading-relaxed text-bile-300">
          Cross-referencing. They are watching for what goes with what.
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

/** §B9 + §F2 + §F4: the two things the crew can be put on, and the option one of them unlocks. */
function StartForm({ data, pending, onStart }: StartFormProps) {
  const [role, setRole] = useState<OfficerRole | ''>('');
  const [leadId, setLeadId] = useState('');
  const [crossReference, setCrossReference] = useState(false);
  const [attribute, setAttribute] = useState<AttributeName>('improvisation');

  const lead = data.leads.find((candidate) => candidate.officerId === leadId) ?? data.leads[0];
  const canCrossReference = (lead?.crossReference ?? false) && !data.pairingsExhausted;
  const chosenRole = role === '' ? data.openRoles[0] : role;

  const affordable = (kind: 'investigation' | 'training' | 'modification') =>
    data.caps >= data.costs[kind];
  const trainable = data.overseerAttributes[attribute] < MAX_ATTRIBUTE;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-3 rounded-sm border border-surface-600/70 bg-surface-900/40 p-4">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-brass-300">
            Investigate a position
          </h3>
          <span className="shrink-0 font-display text-[12px] font-semibold tabular-nums text-ink-200">
            {data.costs.investigation}c · {formatDuration(RESEARCH_MINUTES.investigation)}
          </span>
        </header>
        <p className="text-[13px] leading-relaxed text-ink-300">
          Your Professor reads the files on who has worked out well where. You get told what a job
          leans on. Never how much, and never all of it.
        </p>

        {data.leads.length === 0 ? (
          <p className="text-[13px] text-warning">
            Nobody on your books can run this. Hire a Professor or a Head of Research.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-ink-200">
                Lead
              </span>
              <Dropdown
                label="Who leads the project"
                value={lead?.officerId ?? ''}
                onChange={(officerId) => {
                  setLeadId(officerId);
                  setCrossReference(false);
                }}
                options={data.leads.map((candidate) => ({
                  value: candidate.officerId,
                  label: candidate.name,
                  hint: OFFICER_ROLE_LABELS[candidate.role],
                }))}
                data-testid="research-lead"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-ink-200">
                Position
              </span>
              <Dropdown
                label="Which role to investigate"
                value={chosenRole ?? ''}
                onChange={setRole}
                options={data.openRoles.map((open) => ({
                  value: open,
                  label: OFFICER_ROLE_LABELS[open],
                }))}
                data-testid="research-role"
              />
            </label>

            {/* §F4: an option that is *locked*, and says why, rather than quietly doing nothing. */}
            <label
              className={cn(
                'flex items-start gap-2 border p-2',
                canCrossReference ? 'border-bile-300/40' : 'border-surface-700',
              )}
            >
              <input
                type="checkbox"
                checked={crossReference && canCrossReference}
                disabled={!canCrossReference}
                onChange={(event) => setCrossReference(event.target.checked)}
                className="mt-0.5 shrink-0 accent-bile-300"
              />
              <span className="min-w-0 text-[13px] leading-relaxed">
                <span className={canCrossReference ? 'text-bile-300' : 'text-ink-300'}>
                  Cross-reference
                </span>
                <span className="block text-ink-300">
                  {data.pairingsExhausted
                    ? 'Every connection they could draw, they already have.'
                    : canCrossReference
                      ? 'They will also notice what goes with what.'
                      : `Locked. Needs Improvisation ${CROSS_REFERENCE_IMPROVISATION}.`}
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

      <section className="flex min-w-0 flex-col gap-3 rounded-sm border border-surface-600/70 bg-surface-900/40 p-4">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-brass-300">
            Develop yourself
          </h3>
          <span className="shrink-0 font-display text-[12px] font-semibold tabular-nums text-ink-200">
            {data.costs.training}c · {formatDuration(RESEARCH_MINUTES.training)}
          </span>
        </header>
        <p className="text-[13px] leading-relaxed text-ink-300">
          Any attribute, whether or not it suits you. Time and caps, one point at a time.
        </p>

        <label className="flex flex-col gap-1">
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-ink-200">
            Attribute
          </span>
          <Dropdown
            label="Which attribute to train"
            value={attribute}
            onChange={setAttribute}
            options={ATTRIBUTE_GROUPS.flatMap((group) =>
              ATTRIBUTES_BY_GROUP[group].map((name) => ({
                value: name,
                label: labelOf(name),
                hint: `at ${data.overseerAttributes[name]}`,
                group: labelOf(group),
              })),
            )}
            data-testid="research-attribute"
          />
        </label>

        <p className="text-[12px] text-ink-300">
          {labelOf(attribute)}{' '}
          <span className="font-display font-semibold tabular-nums text-ink-200">
            {data.overseerAttributes[attribute]}
          </span>
          {trainable ? (
            <>
              {' → '}
              <span className="font-display font-semibold tabular-nums text-brass-300">
                {data.overseerAttributes[attribute] + 1}
              </span>
            </>
          ) : (
            <span className="text-warning"> (already at the ceiling)</span>
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
 * §A1: the sixty-five modifications, grouped by the structure they go in.
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
    <section className="flex min-w-0 flex-col gap-3 rounded-sm border border-surface-600/70 bg-surface-900/40 p-4 lg:col-span-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-brass-300">
          Fit a modification
        </h3>
        <span className="shrink-0 font-display text-[12px] font-semibold tabular-nums text-ink-200">
          {data.costs.modification}c + materials · {formatDuration(RESEARCH_MINUTES.modification)}
        </span>
      </header>
      <p className="text-[13px] leading-relaxed text-ink-300">
        Permanent, and limited to {MAX_MODIFICATION_SLOTS} per structure. Slots open at levels{' '}
        {MODIFICATION_SLOT_LEVELS.join(', ')}. Your Lead Engineer does the work.
      </p>

      {!data.canModify && (
        <p className="text-[13px] text-warning">
          Nobody on your books can run this. Hire a Lead Engineer.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-ink-200">
          Structure
        </span>
        <Dropdown
          label="Which structure to modify"
          value={kind}
          onChange={setKind}
          options={BUILDING_KINDS.map((option) => ({
            value: option,
            label: BUILDING_CATALOG[option].name,
          }))}
          data-testid="research-building"
        />
      </label>

      <ul className="flex flex-col gap-2" data-testid="modification-options">
        {shown.map((option) => (
          <li
            key={option.id}
            className="flex flex-wrap items-center justify-between gap-2 border border-surface-700 p-2"
          >
            <div className="min-w-0 flex-1">
              <p className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                {option.name}{' '}
                <span className="tabular-nums text-brass-300">+{option.magnitude}</span>
              </p>
              <p className="text-[13px] leading-relaxed text-ink-300">{option.description}</p>
            </div>
            {option.installed ? (
              <span className="shrink-0 border border-brass-500/60 px-2 py-1 font-display text-[10px] uppercase tracking-[0.16em] text-brass-300">
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

/** §B9: what the crew has actually learned, grouped by the position it is about. */
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
        <ul className="flex flex-col divide-y divide-surface-700">
          {roles.map((role) => {
            const known = roleFactsIn(facts, role);
            return (
              <li key={role} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 font-display text-[12px] uppercase tracking-[0.16em] text-ink-200">
                  {OFFICER_ROLE_LABELS[role]}
                </span>
                <span className="flex min-w-0 flex-wrap gap-1.5">
                  {known.map((attribute) => (
                    <span
                      key={attribute}
                      className="inline-flex shrink-0 items-center border border-brass-500/60 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.14em] text-brass-300"
                    >
                      {labelOf(attribute)}
                    </span>
                  ))}
                </span>
                <span className="ml-auto shrink-0 font-display text-[10px] tabular-nums text-ink-300">
                  {known.length} / {MAX_ROLE_FACTS} leads
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {pairings.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-surface-700 pt-3">
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
            What goes with what
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {pairings.map((pairing) => (
              <li
                key={`${pairing.attributes[0]}-${pairing.attributes[1]}`}
                className="inline-flex shrink-0 items-center border border-bile-300/40 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.14em] text-bile-300"
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
 * §B9: "feedback you can ask for about a potential assignment for a given role".
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
    return <EmptyRow text="Nothing to consult on yet. Investigate a position first." />;
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <label className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-ink-200">
          Assignment
        </span>
        <span className="min-w-0 flex-1">
          <Dropdown
            label="Which role's file to read"
            value={chosen ?? ''}
            onChange={setRole}
            options={researched.map((known) => ({
              value: known,
              label: OFFICER_ROLE_LABELS[known],
            }))}
            data-testid="research-file"
          />
        </span>
      </label>

      {recruits.length === 0 ? (
        <EmptyRow text="Nobody in the room tonight." />
      ) : (
        <ul className="flex flex-col divide-y divide-surface-700">
          {recruits.map((recruit) => {
            const notes = chosen ? consultOnAssignment(recruit.attributes, chosen, facts) : [];
            return (
              <li key={recruit.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 truncate text-[12px] text-ink-200">{recruit.name}</span>
                <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-1">
                  {notes.map((note) => (
                    <span key={note.attribute} className="shrink-0 font-display text-[11px]">
                      <span className="text-ink-300">{labelOf(note.attribute)} </span>
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
      <p className="text-[11px] leading-relaxed text-ink-300">
        Ratings are read off each sheet in {labelOf(attributeTier(0))} to {labelOf('elite')} bands.
        Nobody is scored or ranked for you.
      </p>
    </div>
  );
}

/** One rung of the Lab's tree: what it does, what it costs, and why it is shut. */
function TechCard({
  tech,
  caps,
  pending,
  onStart,
}: {
  tech: LabTech;
  /** The Archive only knows the crew's caps, so the price reads as caps and materials in words. */
  caps: number;
  pending: boolean;
  onStart: () => void;
}) {
  return (
    <article
      data-testid={`tech-${tech.id}`}
      className={cn(
        'flex flex-col gap-2 rounded-sm border p-3',
        tech.known
          ? 'border-bile-300/50 bg-bile-300/10'
          : tech.blocker === null
            ? 'border-surface-600 bg-surface-800/60'
            : 'border-surface-700 bg-surface-900/50 opacity-75',
      )}
    >
      <h4 className="font-display text-[13px] font-bold text-ink-100">{tech.name}</h4>
      <p className="font-body text-[12px] leading-snug text-ink-200">{tech.description}</p>
      <p className="font-display text-[12px] uppercase tracking-[0.08em] text-brass-300">
        {tech.effect}
      </p>
      {tech.known ? (
        <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-bile-300">
          Running
        </p>
      ) : (
        <>
          <p
            className={cn(
              'font-display text-[12px] tabular-nums',
              (tech.cost.caps ?? 0) > caps ? 'text-oxblood-300' : 'text-ink-200',
            )}
          >
            {Object.entries(tech.cost)
              .map(([key, amount]) => `${(amount ?? 0).toLocaleString()} ${key}`)
              .join(' · ')}
          </p>
          <button
            type="button"
            disabled={tech.blocker !== null || pending}
            onClick={onStart}
            className={cn(
              'rounded-sm border px-2 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.14em]',
              tech.blocker === null
                ? 'border-brass-300/70 text-brass-300 hover:bg-brass-300/10'
                : 'cursor-not-allowed border-surface-700 text-ink-400',
            )}
          >
            {tech.blocker ?? 'Start it'}
          </button>
        </>
      )}
    </article>
  );
}

export function ResearchPage() {
  const researchQuery = useResearch();
  const start = useStartResearch();
  const startTechMutation = useStartTech();
  const data = researchQuery.data;
  const now = useTick(data?.active != null);

  return (
    <PageShell
      title="The Archive"
      icon="research"
      lede="Nobody hands you the list of what a job needs. Put the right officer on the files for long enough and you will work some of it out. A better officer finds more, and cross-referencing two projects finds things neither would alone."
      wide
    >
      {/* The standing note that used to sit here said the same thing as the lede above, one line
          lower and in a box. Two paragraphs of the same explanation is how a screen stops being
          read at all. */}
      <Panel
        title={data?.active ? 'In progress' : 'Put someone on it'}
        action={
          <span className="shrink-0 font-display text-[12px] font-bold uppercase tracking-[0.18em] text-ink-200">
            <span className="tabular-nums text-brass-300">
              {(data?.caps ?? 0).toLocaleString()}
            </span>{' '}
            caps
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
          <p className="border-t border-surface-700 px-4 py-2 text-[12px] text-oxblood-300">
            {start.error.message}
          </p>
        )}
      </Panel>

      {/* The Lab's own tree. Four tracks, three rungs each, and every locked one says why,
          which is where a player learns that the Runner's barrow is on their critical path. */}
      <Panel
        title="Standing programmes"
        action={
          <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200">
            {(data?.technologies ?? []).filter((tech) => tech.known).length} finished
          </span>
        }
      >
        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
          {TECH_TRACKS.map((track) => (
            <section key={track} className="flex min-w-0 flex-col gap-2">
              <h3 className="font-display text-sm font-bold uppercase tracking-[0.16em] text-brass-300">
                {TECH_TRACK_LABELS[track]}
              </h3>
              <p className="font-body text-[12px] leading-snug text-ink-300">
                {TECH_TRACK_BLURBS[track]}
              </p>
              {(data?.technologies ?? [])
                .filter((tech) => tech.track === track)
                .map((tech) => (
                  <TechCard
                    key={tech.id}
                    tech={tech}
                    caps={data?.caps ?? 0}
                    pending={startTechMutation.isPending}
                    onStart={() => startTechMutation.mutate({ techId: tech.id })}
                  />
                ))}
            </section>
          ))}
        </div>
        {startTechMutation.error !== null && (
          <p role="alert" className="px-4 pb-3 font-body text-[13px] text-oxblood-300">
            {startTechMutation.error.message}
          </p>
        )}
      </Panel>

      {/* Side by side: what the crew has learned, and the one thing you do with it. Stacked, the
          consult form sat below a list that grows without bound, so the longer a campaign ran the
          less likely anybody was to find it. */}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel
          title="What we know"
          action={
            data && data.justDiscovered.length > 0 ? (
              <span className="shrink-0 font-display text-[12px] font-bold uppercase tracking-[0.18em] text-bile-300">
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
    </PageShell>
  );
}
