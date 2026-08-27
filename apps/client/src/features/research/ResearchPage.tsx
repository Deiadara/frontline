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
  RESOURCE_LABELS,
  RESOURCE_ORDER,
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
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon, type IconName } from '../../components/ui/Icon';
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

/**
 * One bench: a sheet of paper on the desk, with a lit edge and rivets like every other card.
 *
 * `narrow` caps the two that are forms. A pair of dropdowns and a button stretched across 1200px
 * is a control that has lost its own shape: the eye has to travel the width of the screen from the
 * label to the field. The modification bench is a grid of sixty-five cards and wants every pixel.
 */
function Bench({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) {
  return (
    <section
      className={cn(
        'card-paper washed rivets edge-lit flex min-w-0 flex-col gap-3 rounded-sm border border-surface-500/70 p-4 shadow-panel',
        narrow && 'max-w-3xl',
      )}
    >
      {children}
    </section>
  );
}

/**
 * The head of one bench: what it is, and what an order on it costs.
 *
 * The three used to open with a small brass heading and a figure at the other end of the line, and
 * three of those stacked read as one form with three paragraphs in it. A plated mark, a name at a
 * size worth reading, and a drawn rule under it is what makes them three *places*.
 */
function BenchHead({
  icon,
  title,
  cost,
  children,
}: {
  icon: IconName;
  title: string;
  cost: string;
  children: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="icon-plate flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name={icon} />
        </span>
        <h3 className="min-w-0 flex-1 font-stamp text-[17px] leading-tight text-ink-100">
          {title}
        </h3>
        <span className="shrink-0 rounded-sm border border-brass-500/40 px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.1em] tabular-nums text-brass-300">
          {cost}
        </span>
      </div>
      <span aria-hidden className="ink-rule block w-full" />
      <p className="font-body text-[13px] leading-relaxed text-ink-300">{children}</p>
    </header>
  );
}

/** §B9 + §F2 + §F4: the two things the crew can be put on, and the option one of them unlocks. */
/**
 * §B9: put the Professor on a position, and find out what the job leans on.
 */
function InvestigateBench({ data, pending, onStart }: StartFormProps) {
  const [role, setRole] = useState<OfficerRole | ''>('');
  const [leadId, setLeadId] = useState('');
  const [crossReference, setCrossReference] = useState(false);
  const lead = data.leads.find((candidate) => candidate.officerId === leadId) ?? data.leads[0];
  const canCrossReference = (lead?.crossReference ?? false) && !data.pairingsExhausted;
  const chosenRole = role === '' ? data.openRoles[0] : role;
  const affordable = data.caps >= data.costs.investigation;

  return (
    <Bench narrow>
      <BenchHead
        icon="eye"
        title="Investigate a position"
        cost={`${data.costs.investigation}c · ${formatDuration(RESEARCH_MINUTES.investigation)}`}
      >
        Your Professor reads the files on who has worked out well where. You get told what a job
        leans on. Never how much, and never all of it.
      </BenchHead>

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
            disabled={pending || !chosenRole || !affordable || data.active !== null}
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
            {affordable ? 'Put them on it' : 'Not enough caps'}
          </Button>
        </>
      )}
    </Bench>
  );
}

/** §F2: an hour of the Overseer's own time, bought with caps, one point at a time. */
function DevelopBench({ data, pending, onStart }: StartFormProps) {
  const [attribute, setAttribute] = useState<AttributeName>('improvisation');
  const affordable = data.caps >= data.costs.training;
  const trainable = data.overseerAttributes[attribute] < MAX_ATTRIBUTE;

  return (
    <Bench narrow>
      <BenchHead
        icon="training"
        title="Develop yourself"
        cost={`${data.costs.training}c · ${formatDuration(RESEARCH_MINUTES.training)}`}
      >
        Any attribute, whether or not it suits you. Time and caps, one point at a time.
      </BenchHead>

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
        disabled={pending || !trainable || !affordable || data.active !== null}
        onClick={() => onStart({ kind: 'training', attribute })}
      >
        {affordable ? 'Begin training' : 'Not enough caps'}
      </Button>
    </Bench>
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

  const fitted = shown.filter((option) => option.installed).length;

  return (
    <Bench>
      <BenchHead
        icon="workshop"
        title="Fit a modification"
        cost={`${data.costs.modification}c + materials · ${formatDuration(RESEARCH_MINUTES.modification)}`}
      >
        Permanent, and limited to {MAX_MODIFICATION_SLOTS} per structure. Slots open at levels{' '}
        {MODIFICATION_SLOT_LEVELS.join(', ')}. Your Lead Engineer does the work.
      </BenchHead>

      {!data.canModify && (
        <p className="rounded-sm border border-oxblood-500/50 bg-oxblood-700/20 px-3 py-2 font-body text-[13px] leading-relaxed text-oxblood-100">
          Nobody on your books can run this. Hire a Lead Engineer.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-ink-200">
            Structure
          </span>
          {/* What is already in it, against what it will ever hold. The list below is sixty-five
              rows across twelve structures, and "how full is this one" is the question a player
              is actually asking before they read any of them. */}
          <span className="font-display text-[11px] uppercase tracking-[0.12em] tabular-nums text-ink-300">
            {fitted} of {MAX_MODIFICATION_SLOTS} fitted
          </span>
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

      <ul
        className="grid gap-2 md:grid-cols-2 [@media(min-width:1500px)]:grid-cols-3"
        data-testid="modification-options"
      >
        {shown.map((option) => (
          <li
            key={option.id}
            className={cn(
              'edge-lit flex min-w-0 flex-col gap-2 rounded-sm border p-2.5 transition-colors',
              option.installed
                ? 'border-brass-300/60 bg-brass-300/10'
                : option.blocker === null
                  ? 'border-surface-500/70 bg-surface-900/50'
                  : 'border-surface-700 bg-surface-900/40 opacity-60',
            )}
          >
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 font-display text-[12px] uppercase leading-tight tracking-[0.12em] text-ink-100">
                {option.name}
              </p>
              {/* The figure on a plate rather than loose in the title: it is the one number on the
                  card and it is what two modifications are compared on. */}
              <span className="shrink-0 rounded-sm border border-brass-500/40 px-1.5 py-0.5 font-display text-[12px] font-bold tabular-nums text-brass-300">
                +{option.magnitude}
              </span>
            </div>
            <p className="min-w-0 flex-1 font-body text-[12px] leading-relaxed text-ink-300">
              {option.description}
            </p>
            {option.installed ? (
              <span className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.16em] text-brass-300">
                <Icon name="check" className="h-3.5 w-3.5" />
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
    </Bench>
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
            {/* Named off the shared table, not printed raw. This read `140 highQualityMetal`,
                which is a field name rather than the words on a crate, and the same table is what
                the market and the stockpile use. */}
            {RESOURCE_ORDER.filter((key) => (tech.cost[key] ?? 0) > 0)
              .map(
                (key) =>
                  `${(tech.cost[key] ?? 0).toLocaleString()} ${RESOURCE_LABELS[key].toLowerCase()}`,
              )
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

/**
 * The three benches on the desk, as one strip of choices.
 *
 * Investigating a position, developing yourself and fitting a modification are three different
 * kinds of work that happen to share one constraint: only one of them can be running. Stacked as
 * three forms they read as one long form with three submit buttons, and the modification list
 * alone is sixty-five rows, so whichever bench a player wanted was somewhere below the fold of a
 * screen that had already stopped looking like a decision.
 *
 * One at a time, then, chosen off a strip that says what each costs before it is opened.
 */
const BENCHES = [
  { id: 'investigate', label: 'Investigate', icon: 'eye' },
  { id: 'develop', label: 'Develop', icon: 'training' },
  { id: 'modify', label: 'Modify', icon: 'workshop' },
] as const;
type BenchId = (typeof BENCHES)[number]['id'];

/** The sections of the archive, and what each one is for. */
const SECTIONS = [
  { id: 'desk', label: 'The desk', icon: 'desk', blurb: 'Put somebody on something' },
  { id: 'programmes', label: 'Programmes', icon: 'flask', blurb: 'The Lab’s standing tracks' },
  { id: 'files', label: 'The files', icon: 'archive', blurb: 'What the crew has learned' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** One door on the rail: a plated mark, what it is, and what is happening behind it. */
function SectionButton({
  icon,
  label,
  blurb,
  state,
  selected,
  onSelect,
}: {
  icon: IconName;
  label: string;
  blurb: string;
  state: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`research-section-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      className={cn(
        // A lit left edge on the chosen one, the same signal the training rail uses.
        'flex w-full items-center gap-3 border-l-[3px] py-2.5 pl-2.5 pr-3 text-left transition-all duration-150',
        selected
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm [&_svg]:h-5 [&_svg]:w-5',
          selected ? 'text-brass-300' : 'text-ink-300',
        )}
      >
        <Icon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[14px] leading-[1.15] text-ink-100">
          {label}
        </span>
        <span className="block break-words font-body text-[11px] leading-snug text-ink-300">
          {blurb}
        </span>
      </span>
      <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.12em]">{state}</span>
    </button>
  );
}

export function ResearchPage() {
  const researchQuery = useResearch();
  const start = useStartResearch();
  const startTechMutation = useStartTech();
  const data = researchQuery.data;
  const now = useTick(data?.active != null);
  const [section, setSection] = useState<SectionId>('desk');
  const [bench, setBench] = useState<BenchId>('investigate');

  const technologies = data?.technologies ?? [];
  const finished = technologies.filter((tech) => tech.known).length;
  const facts = data?.facts ?? [];

  const stateOf = (id: SectionId): ReactNode => {
    if (id === 'desk') {
      return data?.active ? (
        <span className="text-brass-300">Busy</span>
      ) : (
        <span className="text-verdigris-300">Free</span>
      );
    }
    if (id === 'programmes') {
      return (
        <span className="tabular-nums text-ink-200">
          {finished}/{technologies.length}
        </span>
      );
    }
    /*
     * The files carry a *new* count when something has just landed.
     *
     * The old page stacked every panel, so "+3 just in" was on screen whatever a player was doing.
     * Behind a door it is not, and a project finishing while somebody is at the desk is exactly the
     * moment the flag exists for: they would open the files an hour later and find three facts
     * they were never told about.
     */
    const fresh = data?.justDiscovered.length ?? 0;
    if (fresh > 0) {
      return <span className="text-bile-300">+{fresh} just in</span>;
    }
    return <span className="tabular-nums text-ink-200">{facts.length}</span>;
  };

  return (
    <PageShell
      quote="Nobody wrote down how any of it works. Somebody has to sit with the files until it does."
      wide
      fills
    >
      {/*
       * A fixed frame, a rail of doors, and one workspace: the same shape the Training tab uses,
       * and for the same reason. This page was five panels in a scrolling column, so the Lab's
       * tree and the crew's own files, which are the two things a player comes back to, lived
       * below a form that fills a screen on its own.
       */}
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* Hugging, not filling. Three doors is the whole list and it can never grow, so a
              stretched panel would be a framed sheet of empty tin under them. The training rail
              fills because its roster does grow; this one does not. */}
          <Panel title="The archive" className="min-h-0 border border-surface-500/70">
            <ul
              className="min-h-0 flex-1 divide-y divide-surface-700 overflow-y-auto"
              data-testid="research-sections"
            >
              {SECTIONS.map((entry) => (
                <li key={entry.id}>
                  <SectionButton
                    icon={entry.icon}
                    label={entry.label}
                    blurb={entry.blurb}
                    state={stateOf(entry.id)}
                    selected={section === entry.id}
                    onSelect={() => setSection(entry.id)}
                  />
                </li>
              ))}
            </ul>
          </Panel>

          {/* What the whole page is spent out of, at the foot of the rail. */}
          <div className="card-paper washed rivets edge-lit mt-auto flex shrink-0 items-center gap-2 rounded-sm border border-surface-600/70 px-3 py-2.5">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
              Caps
            </span>
            <span className="ml-auto font-display text-[15px] font-bold tabular-nums text-ink-100">
              {(data?.caps ?? 0).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* The bench in flight, over whatever section is open: a project running is a fact about
              the whole archive, not about the page a player happens to be on. */}
          {data?.active && (
            <div className="card-paper washed rivets edge-lit shrink-0 rounded-sm border border-brass-500/40 shadow-panel">
              <ActiveProject data={data} now={now} />
            </div>
          )}

          {(start.error || startTechMutation.error) && (
            <p
              role="alert"
              className="shrink-0 font-body text-[13px] leading-relaxed text-oxblood-300"
            >
              {(start.error ?? startTechMutation.error)?.message}
            </p>
          )}

          {/*
           * The bench strip is **outside** the scroller.
           *
           * It was inside it, and the modification bench is sixty-five cards: scrolling down to
           * read them carried the three buttons off the top of the screen with the content, so
           * the controls for choosing a bench vanished the moment you used the bench you chose.
           * At 1280x720 the strip ended up at y=-77. A control is not content, and it does not
           * move when the thing it controls does.
           */}
          {section === 'desk' && data && (
            <div className="flex shrink-0 flex-wrap gap-2" data-testid="research-benches">
              {BENCHES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setBench(entry.id)}
                  aria-pressed={bench === entry.id}
                  data-testid={`research-bench-${entry.id}`}
                  className={cn(
                    'door-tile flex items-center gap-2 rounded-md border px-3 py-2 transition-all duration-150',
                    'font-display text-[12px] font-bold uppercase tracking-[0.14em]',
                    bench === entry.id
                      ? 'door-tile-active -translate-y-0.5 border-brass-300 text-brass-100'
                      : 'border-surface-500/70 text-ink-300 hover:-translate-y-0.5 hover:border-iris-300/80 hover:text-iris-100',
                  )}
                >
                  <span aria-hidden className="relative z-[2] [&_svg]:h-4 [&_svg]:w-4">
                    <Icon name={entry.icon} />
                  </span>
                  <span className="relative z-[2]">{entry.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="research-workspace">
            {researchQuery.isLoading || !data ? (
              <EmptyRow text="Opening the archive…" />
            ) : section === 'desk' ? (
              <div className="flex flex-col gap-3">
                {bench === 'investigate' && (
                  <InvestigateBench
                    data={data}
                    pending={start.isPending}
                    onStart={(project) => start.mutate(project)}
                  />
                )}
                {bench === 'develop' && (
                  <DevelopBench
                    data={data}
                    pending={start.isPending}
                    onStart={(project) => start.mutate(project)}
                  />
                )}
                {bench === 'modify' && (
                  <ModificationsSection
                    data={data}
                    pending={start.isPending}
                    onStart={(project) => start.mutate(project)}
                  />
                )}
              </div>
            ) : section === 'programmes' ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {TECH_TRACKS.map((track) => (
                  <section
                    key={track}
                    className="card-paper washed edge-lit flex min-w-0 flex-col gap-2 rounded-sm border border-surface-500/70 p-3 shadow-panel"
                    data-testid={`tech-track-${track}`}
                  >
                    <header className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="icon-plate flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-[18px] [&_svg]:w-[18px]"
                        >
                          <Icon name="flask" />
                        </span>
                        <h3 className="min-w-0 flex-1 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300">
                          {TECH_TRACK_LABELS[track]}
                        </h3>
                      </div>
                      <span aria-hidden className="ink-rule block w-full" />
                      <p className="font-body text-[12px] leading-snug text-ink-300">
                        {TECH_TRACK_BLURBS[track]}
                      </p>
                    </header>
                    {technologies
                      .filter((tech) => tech.track === track)
                      .map((tech) => (
                        <TechCard
                          key={tech.id}
                          tech={tech}
                          caps={data.caps}
                          pending={startTechMutation.isPending}
                          onStart={() => startTechMutation.mutate({ techId: tech.id })}
                        />
                      ))}
                  </section>
                ))}
              </div>
            ) : (
              <div className="grid items-start gap-3 xl:grid-cols-2">
                <Panel
                  title="What we know"
                  className="border border-surface-500/70"
                  action={
                    data.justDiscovered.length > 0 ? (
                      <span className="shrink-0 font-display text-[12px] font-bold uppercase tracking-[0.18em] text-bile-300">
                        +{data.justDiscovered.length} just in
                      </span>
                    ) : undefined
                  }
                >
                  <FactsPanel facts={facts} />
                </Panel>

                <Panel title="Consult on an assignment" className="border border-surface-500/70">
                  <ConsultPanel facts={facts} />
                </Panel>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
