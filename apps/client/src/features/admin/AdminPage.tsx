import {
  ADMIN_MAX_PLAYER_LEVEL,
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_CATEGORY_LABELS,
  BUILDING_CATALOG,
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  MAX_NOTORIETY,
  OFFICER_ROLE_LABELS,
  OFFICER_ROLES,
  PLAYER_UNITS,
  RESOURCE_KEYS,
  type AdminGrantRequest,
  type AdminKnobsRequest,
  type AdminSnapshot,
  type BuildingKind,
  type OfficerRole,
  type ResourceKey,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { LeaveDialog } from '../../components/LeaveDialog';
import { NumberField } from '../../components/ui/NumberField';
import { Dropdown } from '../../components/ui/Dropdown';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import {
  useAdmin,
  useAdminGrant,
  useAdminKnobs,
  useAdminReset,
  useAdminMockBattle,
  useFaction,
  useMe,
} from '../../lib/queries';
import { InfoNote, PageShell, ScreenLoadSheet } from '../game/PageShell';
import { formatDayClock } from '@frontline/shared';
import { usePlayerZone } from '../settings/usePlayerZone';
import { PressError } from '../../components/ui/PressError';

/**
 * The console.
 *
 * A design pass needs to look at the game at level 3, at level 10 and at level 20, and reaching any
 * of those by playing takes days. This puts the whole district at a chosen level in one click, sets
 * the stockpile and the name on the street, and empties the queues so the next thing can be watched
 * from the start.
 *
 * **It does not exist when admin mode is off.** `GET /api/admin` answers 404 in that build, the
 * hook turns that one status into `null`, and this screen redirects rather than rendering an
 * apology. There is no half-state where a player sees a locked console and wonders what is behind it.
 *
 * Everything here is one press, applied immediately, with the resulting state shown underneath.
 * A console with a Save button is a console where you have to remember what you changed.
 */

/**
 * A preset is a set of knobs and, for one of them, a grant to fire alongside.
 *
 * The two go through different routes (knobs set state, grants hand things over), so a preset that
 * needs both carries both rather than the button inferring one from the label.
 */
interface Preset {
  label: string;
  blurb: string;
  knobs: AdminKnobsRequest;
  grant?: AdminGrantRequest;
}

/**
 * Four presets, and each one sets the crew's whole state to one era (maintainer request,
 * 2026-09-14).
 *
 * They used to move three knobs and, for one of them, finish the research. Everything else a crew
 * accumulates was left where it was, so "End game" handed you a maxed district with an empty
 * inventory and nothing on the back room's shelf: a ceiling with half the rooms locked, which is the
 * complaint the research grant was added to fix and which was still true of everything research is
 * not. An era preset that only moves some of the state is a preset you have to finish by hand.
 *
 * So each carries the grant its era implies as well as its knobs. The two still go through
 * different routes (knobs set state, grants hand things over) and a preset that needs both carries
 * both, rather than the button inferring one from the label.
 */
const PRESETS: readonly Preset[] = [
  {
    label: 'First hour',
    // What the knobs below do, not what a new crew opens: that is Clean slate (bug pass,
    // 2026-09-29). The blurb said "A Nexus, a Gate and nothing else" over a preset that stands
    // every structure at level 1, and a new crew opens a Nexus and a Generator.
    blurb: 'Every structure at level 1, the crew at level 1 with no infamy, the queues empty.',
    /*
     * No grant, and that is the point of it rather than an omission.
     *
     * The other two hand things over, and a grant is additive on every route it touches: there is
     * no spelling of "take the blueprints back". Pressing First hour on a finished crew therefore
     * moves the knobs and leaves the inventory full, which is the honest behaviour and the reason
     * Clean slate exists below.
     */
    knobs: { buildingLevel: 1, playerLevel: 1, infamy: 0, clearQueues: true },
  },
  {
    label: 'Mid game',
    blurb:
      'Every structure at 8, four rungs into every programme, the yard stocked and a few favours owed.',
    grant: { researchDepth: 4, parts: 40, pages: 'all' as const, consumables: 2, boosts: 1 },
    knobs: {
      buildingLevel: 8,
      playerLevel: 12,
      infamy: 900,
      /*
       * Half the chairs, at a middling rating (maintainer, 2026-09-22).
       *
       * An officer is the Bar's to give and the Bar settles at midnight, so a preset that does
       * not seat anybody hands a reviewer a mid-game crew with thirteen empty chairs: no
       * spying, no research track, no role fit. Half is the shape of the era. The
       * count is derived rather than typed, so a change to the list of chairs does not leave it stale.
       */
      officers: { count: Math.ceil(OFFICER_ROLES.length / 2), rating: 55 },
      resources: {
        caps: 60_000,
        supplies: 60_000,
        oil: 60_000,
        scrap: 90_000,
        planks: 80_000,
        highQualityMetal: 9_000,
      },
      clearQueues: true,
    },
  },
  {
    label: 'End game',
    blurb:
      'The ceiling on everything: seven rungs into every programme, every drawing held, the yard full, the shelf stocked and ground held in every open city.',
    /*
     * The one that hands over everything, because everything is what "end game" means.
     *
     * `seed/sandbox.ts` leaves research alone on purpose, on the grounds that a programme is worked
     * through on the Lab's one bench and granting the rungs would invent a state the mechanic does
     * not have. That reasoning is right for the *boot* sandbox and wrong here: this is the Console,
     * where every clock is already five seconds and nothing is charged, and "end game" that still
     * has forty hours of bench time in front of it is not the end game. Everything downstream of
     * research (the units it authorises, the blueprints it opens) is unreachable without it.
     *
     * The same argument carries to the rest of it, which is why the traps, the boosts, the parts
     * and the documents are here too: a crew at the ceiling with nothing to take into a fight is a
     * ceiling you cannot actually play from.
     *
     * **Seven rungs of ten, not all ten** (maintainer request, 2026-09-14). It granted every rung,
     * and the reasoning above says why that was better than none. Seven is better than both: the
     * Lab still has something on its bench, so the one mechanic that takes real time is reachable
     * from this preset rather than already finished by it. Nothing is locked behind the missing
     * three, because `blueprints: 'all'` hands over the documents directly: this leaves research to
     * *play*, not rooms to be shut out of.
     */
    grant: {
      researchDepth: 7,
      blueprints: 'all' as const,
      pages: 'all' as const,
      parts: 250,
      consumables: 10,
      boosts: 5,
      // Ground in every open city, so the multi-city screens have something to show.
      footholds: 'every-city' as const,
    },
    knobs: {
      buildingLevel: BUILDING_MAX_LEVEL,
      playerLevel: 30,
      infamy: 25_000,
      /* Every chair, well rated: at the ceiling there is nobody left to hire. */
      officers: { count: OFFICER_ROLES.length, rating: 85 },
      resources: {
        caps: 400_000,
        supplies: 400_000,
        oil: 400_000,
        scrap: 600_000,
        planks: 500_000,
        highQualityMetal: 60_000,
      },
      clearQueues: true,
    },
  },
];

function StructureKnobs({ snapshot }: { snapshot: AdminSnapshot }) {
  const knobs = useAdminKnobs();
  const [structure, setStructure] = useState<BuildingKind | 'all'>('all');
  const [level, setLevel] = useState(10);

  const standing = new Map(snapshot.buildings.map((entry) => [entry.kind, entry.level]));

  return (
    <Panel title="Structures">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
              Which
            </span>
            {/*
             * The painted picker, not the browser's. This was the last `<select>` left in the
             * codebase: the console is not a player screen, but it is a screen somebody looks at the
             * artwork through, and a white operating-system menu dropped over it is the exact
             * complaint `Dropdown` was written to answer.
             */}
            <Dropdown
              label="Which structure to set"
              value={structure}
              onChange={setStructure}
              options={[
                { value: 'all' as const, label: 'Every structure' },
                ...BUILDING_KINDS.map((kind) => ({
                  value: kind,
                  label: BUILDING_CATALOG[kind].name,
                })),
              ]}
              data-testid="admin-structure"
            />
          </label>

          {/* The same stepper every other count in the game uses, not a browser range slider. */}
          <div className="flex flex-col gap-1.5">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
              Level
            </span>
            <NumberField
              label="Level"
              value={level}
              min={0}
              max={BUILDING_MAX_LEVEL}
              onChange={setLevel}
              data-testid="admin-level"
            />
          </div>

          <Button
            size="sm"
            disabled={knobs.isPending}
            onClick={() =>
              knobs.mutate({
                buildingLevel: level,
                ...(structure === 'all' ? {} : { structure }),
              })
            }
          >
            Set
          </Button>
        </div>
        {/* Refused is said, not swallowed (bug pass, 2026-10-06). */}
        {knobs.error && <PressError onDismiss={knobs.reset}>{knobs.error.message}</PressError>}

        <p className="font-body text-[12px] leading-snug text-ink-300">
          Level 0 removes the structure, which is the one stage an unlock-everything switch can
          never show you.
        </p>

        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-standing">
          {BUILDING_KINDS.map((kind) => {
            const at = standing.get(kind) ?? 0;
            return (
              <li
                key={kind}
                className="flex items-center justify-between gap-2 rounded-sm border border-surface-600/70 bg-surface-800/60 px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate font-display text-[12px] text-ink-200">
                  {BUILDING_CATALOG[kind].name}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-display text-[13px] font-bold tabular-nums',
                    at === 0 ? 'text-ink-300' : 'text-brass-300',
                  )}
                >
                  {at}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

function StateKnobs({ snapshot }: { snapshot: AdminSnapshot }) {
  const knobs = useAdminKnobs();
  const [playerLevel, setPlayerLevel] = useState(snapshot.playerLevel);
  const [infamy, setInfamy] = useState(snapshot.infamy);
  const [amount, setAmount] = useState(100_000);
  const [rank, setRank] = useState(0);
  const [officers, setOfficers] = useState<number>(OFFICER_ROLES.length);
  const [rating, setRating] = useState(60);
  // Seeded once and then followed: every knob answers with a fresh snapshot, and a field still
  // holding the number it mounted with re-submits a stale level the next time its button is
  // pressed after the other knob has moved.
  useEffect(() => setPlayerLevel(snapshot.playerLevel), [snapshot.playerLevel]);
  useEffect(() => setInfamy(snapshot.infamy), [snapshot.infamy]);

  const numberField = (
    label: string,
    value: number,
    set: (next: number) => void,
    testId: string,
    max = Number.MAX_SAFE_INTEGER,
  ) => (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(event) =>
          set(Math.min(max, Math.max(0, Math.trunc(Number(event.target.value) || 0))))
        }
        data-testid={testId}
        className="w-32 rounded-sm border border-surface-600 bg-surface-950 px-2.5 py-2 text-[13px] tabular-nums text-ink-100"
      />
    </label>
  );

  return (
    <Panel title="Standing and stock">
      <div className="flex flex-col gap-4 p-4">
        {/* A field and its button wrap together, so a narrow column never leaves a button on
            the line below the number it sends. */}
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div className="flex items-end gap-2">
            {numberField('Player level', playerLevel, setPlayerLevel, 'admin-player-level')}
            <Button
              size="sm"
              variant="ghost"
              disabled={knobs.isPending}
              onClick={() =>
                knobs.mutate({
                  playerLevel: Math.min(ADMIN_MAX_PLAYER_LEVEL, Math.max(1, playerLevel)),
                })
              }
            >
              Set level
            </Button>
          </div>
          <div className="flex items-end gap-2">
            {numberField('Infamy', infamy, setInfamy, 'admin-infamy')}
            <Button
              size="sm"
              variant="ghost"
              disabled={knobs.isPending}
              onClick={() => knobs.mutate({ infamy })}
            >
              Set infamy
            </Button>
          </div>
          <div className="flex items-end gap-2">
            {numberField('Rank', rank, setRank, 'admin-notoriety', MAX_NOTORIETY)}
            <Button
              size="sm"
              variant="ghost"
              disabled={knobs.isPending}
              onClick={() => knobs.mutate({ notoriety: rank })}
              data-testid="admin-notoriety-go"
            >
              Set rank
            </Button>
          </div>
        </div>

        {/* The Bar settles at midnight, so this is the way to a crew with people in its chairs
            today. One per role in the catalogue's order, all at one rating. */}
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div className="flex items-end gap-2">
            {numberField('Officers', officers, setOfficers, 'admin-officers', OFFICER_ROLES.length)}
            {numberField('Rated', rating, setRating, 'admin-officer-rating', 100)}
            <Button
              size="sm"
              variant="ghost"
              disabled={knobs.isPending}
              onClick={() =>
                knobs.mutate({ officers: { count: officers, rating: Math.max(1, rating) } })
              }
              data-testid="admin-officers-go"
            >
              Seat them
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={knobs.isPending}
            onClick={() => knobs.mutate({ automationsRested: true })}
            data-testid="admin-automations-rested"
          >
            Rest the standing orders
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {numberField('Each resource', amount, setAmount, 'admin-resources')}
          <Button
            size="sm"
            variant="ghost"
            disabled={knobs.isPending}
            onClick={() =>
              knobs.mutate({
                resources: RESOURCE_KEYS.reduce<Partial<Record<ResourceKey, number>>>(
                  (into, key) => ({ ...into, [key]: amount }),
                  {},
                ),
              })
            }
          >
            Fill the stockpile
          </Button>
          <span className="flex items-center gap-1.5">
            {RESOURCE_KEYS.map((key) => (
              <ResourceIcon key={key} kind={key} className="h-5 w-5" />
            ))}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={knobs.isPending}
            onClick={() => knobs.mutate({ clearQueues: true })}
          >
            Empty every queue
          </Button>
          <span className="font-body text-[12px] text-ink-300">
            Build, muster and research, so the next thing can be watched from the start.
          </span>
        </div>

        {knobs.error && <PressError onDismiss={knobs.reset}>{knobs.error.message}</PressError>}
      </div>
    </Panel>
  );
}

/**
 * Grants (maintainer request, 2026-09-11): the documents, pages, parts and rungs a reviewer needs to
 * see the yard at mid and late game.
 *
 * Every Scrapyard bench draws only what the crew holds the drawings for, so without this the only
 * way to look at an advanced bracket was to collect its pages honestly. These are additive: a
 * grant on top of an inventory is an inventory with more in it.
 */
function GrantsPanel() {
  const grant = useAdminGrant();
  const [parts, setParts] = useState(20);
  const [track, setTrack] = useState<OfficerRole>('veteran');
  const [depth, setDepth] = useState(5);
  const [stock, setStock] = useState(5);
  const [unit, setUnit] = useState<string>(PLAYER_UNITS[0]?.id ?? '');
  const [bodies, setBodies] = useState(20);
  /** A count box in this panel's style, clamped to what the route takes. */
  const countField = (
    label: string,
    value: number,
    set: (next: number) => void,
    max: number,
    testId: string,
  ) => (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
        {label}
      </span>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(event) =>
          set(Math.min(max, Math.max(1, Math.trunc(Number(event.target.value) || 1))))
        }
        data-testid={testId}
        className="w-24 rounded-sm border border-surface-600 bg-surface-950 px-2.5 py-2 text-[13px] tabular-nums text-ink-100"
      />
    </label>
  );
  /*
   * `key` off the test id, because one of the four callers below is a `.map`.
   *
   * The blueprint row renders one of these per category and React had nothing to tell them apart
   * with, which it says so in the console on every open of this screen. The test id is already
   * unique per button by construction, so it is the key as well rather than a second identifier
   * that could drift from it.
   */
  const button = (label: string, body: AdminGrantRequest, testId: string) => (
    <Button
      key={testId}
      size="sm"
      variant="ghost"
      disabled={grant.isPending}
      onClick={() => grant.mutate(body)}
      data-testid={testId}
    >
      {label}
    </Button>
  );
  return (
    <Panel title="Grants for testing">
      <div className="flex flex-col gap-4 p-4" data-testid="admin-grants">
        <div className="flex flex-col gap-1.5">
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
            Blueprints, assembled
          </span>
          <div className="flex flex-wrap gap-2">
            {button('Every document', { blueprints: 'all' }, 'admin-grant-blueprints')}
            {BLUEPRINT_CATEGORIES.map((category) =>
              button(
                BLUEPRINT_CATEGORY_LABELS[category],
                { blueprints: category },
                `admin-grant-blueprints-${category}`,
              ),
            )}
          </div>
          <span className="font-body text-[12px] text-ink-300">
            Puts the finished document in the inventory, so the yard's rows open at once.
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {button('One of every page', { pages: 'all' }, 'admin-grant-pages')}
          <label className="flex flex-col gap-1.5">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
              Of every part
            </span>
            <input
              type="number"
              min={1}
              max={999}
              value={parts}
              onChange={(event) =>
                setParts(Math.min(999, Math.max(1, Math.trunc(Number(event.target.value)))))
              }
              data-testid="admin-grant-parts"
              className="w-24 rounded-sm border border-surface-600 bg-surface-950 px-2.5 py-2 text-[13px] tabular-nums text-ink-100"
            />
          </label>
          {button('Fill the parts bin', { parts }, 'admin-grant-parts-go')}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {button('Finish every research rung', { technologies: 'all' }, 'admin-grant-research')}
          <label className="flex flex-col gap-1.5">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
              One track
            </span>
            {/* The painted picker, for the reason the structure picker above gives. */}
            <Dropdown
              label="Which track to finish"
              value={track}
              onChange={setTrack}
              options={OFFICER_ROLES.map((role) => ({
                value: role,
                label: OFFICER_ROLE_LABELS[role],
              }))}
              data-testid="admin-grant-track"
            />
          </label>
          {button('Finish that track', { technologies: track }, 'admin-grant-track-go')}
          <span className="font-body text-[12px] text-ink-300">
            A trap wants its Lab rung as well as its document.
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {countField('Rungs deep', depth, setDepth, 10, 'admin-grant-depth')}
          {button('Every track that deep', { researchDepth: depth }, 'admin-grant-depth-go')}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {countField('Of each', stock, setStock, 99, 'admin-grant-stock')}
          {button('Every trap', { consumables: stock }, 'admin-grant-traps')}
          {button('Every boost', { boosts: stock }, 'admin-grant-boosts')}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
              Unit
            </span>
            <Dropdown
              label="Which unit to add"
              value={unit}
              onChange={setUnit}
              options={PLAYER_UNITS.map((spec) => ({ value: spec.id, label: spec.name }))}
              data-testid="admin-grant-unit"
            />
          </label>
          {countField('How many', bodies, setBodies, 9_999, 'admin-grant-bodies')}
          {button('Add to the roster', { units: { [unit]: bodies } }, 'admin-grant-units')}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {button('A foothold in every city', { footholds: 'every-city' }, 'admin-grant-footholds')}
          <span className="font-body text-[12px] text-ink-300">
            One location in each open city, so the city pickers have somewhere to read.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {button('A district held whole', { districtWhole: 'quietest' }, 'admin-grant-district')}
          <span className="font-body text-[12px] text-ink-300">
            Every plot of the quietest district in your city, so a district board opens beside misc.
          </span>
        </div>

        {grant.error && <PressError onDismiss={grant.reset}>{grant.error.message}</PressError>}
      </div>
    </Panel>
  );
}

/** What is on disk, so a restore can be chosen without an ssh session. */
function BackupsPanel({ snapshot }: { snapshot: AdminSnapshot }) {
  const zone = usePlayerZone();
  return (
    <Panel
      title="Snapshots"
      action={
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          Every two minutes
        </span>
      }
    >
      {snapshot.backups.length === 0 ? (
        <p className="p-4 font-body text-[13px] text-ink-300">
          None on disk yet. The first one lands two minutes after the server started.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-surface-700" data-testid="admin-backups">
          {snapshot.backups.map((backup) => (
            <li key={backup.file} className="flex items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate font-body text-[13px] text-ink-200">
                {formatDayClock(new Date(backup.takenAt), zone)}
              </span>
              <span className="shrink-0 font-display text-[12px] tabular-nums text-ink-300">
                {(backup.bytes / 1024).toFixed(0)} KB
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="px-4 py-3 font-body text-[12px] leading-snug text-ink-300">
        Restoring one is three commands and no replay: see <code>docs/RECOVERY.md</code>.
      </p>
    </Panel>
  );
}

/** A fight called on the reviewer by whoever else is in the city, through the real declaration. */
function FightsPanel() {
  const mock = useAdminMockBattle();
  return (
    <Panel title="Fights">
      <div className="flex flex-col gap-3 p-4">
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          Somebody else in the city calls a fight on your ground at the earliest mark, through the
          same declaration a player makes: the bell rings, the red mark lands on the bar, and the
          board carries it. A crew holding nothing is handed one location first.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="danger"
            disabled={mock.isPending}
            onClick={() => mock.mutate()}
            data-testid="admin-mock-battle"
          >
            {mock.isPending ? 'Calling…' : 'Call a fight on me'}
          </Button>
          {mock.isSuccess && (
            <span
              className="font-body text-[12px] text-verdigris-300"
              data-testid="admin-mock-called"
            >
              Called. It is on the Battles board.
            </span>
          )}
          {mock.error && <PressError onDismiss={mock.reset}>{mock.error.message}</PressError>}
        </div>
      </div>
    </Panel>
  );
}

/**
 * Clean slate's "are you sure", which is also a faction's door (maintainer, 2026-09-30).
 *
 * The reset walks the old life out of its faction by the route Leave takes, so a leader with people
 * at the table is warned it disbands and may name who leads after them, exactly as on their own
 * file. Its own component so the faction is read when the question is asked, not polled for as
 * long as the Console is open; nothing is drawn until that read has answered, so the question a
 * leader is asked is never the one for somebody with no table.
 */
function StartOverDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (successorId: string | undefined) => void;
  onCancel: () => void;
}) {
  const faction = useFaction();
  const me = useMe();
  if (faction.isPending || me.isPending) return null;
  const table = faction.data?.faction ? faction.data : undefined;
  const leads = table?.rank === 'leader' && table.members.length > 1;
  return (
    <LeaveDialog
      faction={table}
      selfId={me.data?.user.id ?? ''}
      title="Start over?"
      body={`This crew goes back to its first second: the district emptied, every location you hold given back to the city, the inventory and the shelf cleared, and the research undone. Every fight, mission and spy job it has going is forfeit, and it walks out of its faction.${leads ? ` You lead ${table.faction?.name ?? 'it'}, so it is disbanded when you go, for all ${table.members.length} of you, unless you name somebody to lead it.` : ''} You pick a character again. Nothing about it can be undone.`}
      confirm={(heir) => (heir ? `Wipe it, ${heir.username} leads` : 'Wipe it')}
      testId="confirm-reset"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function AdminPage() {
  const query = useAdmin();
  const knobs = useAdminKnobs();
  // Every era preset now carries a grant as well as knobs, so the page needs both mutations on
  // every press rather than only for End game.
  const grant = useAdminGrant();
  const reset = useAdminReset();
  const navigate = useNavigate();
  /** Whether Clean slate has been pressed and not yet confirmed. */
  const [wiping, setWiping] = useState(false);

  // On a sheet: a bare line here landed at the top of the window, under the standing bar. A failed
  // read says so rather than falling through to the redirect below, which is for a build that has
  // no console at all.
  // A failed *re*-read keeps the console up (bug pass, 2026-10-06): every press refetches the
  // snapshot, and one blip swapped the whole console for this sheet and lost every field typed.
  if (query.isLoading || (query.isError && query.data === undefined)) {
    return (
      <ScreenLoadSheet
        what="The console"
        loading="Opening the console…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  // Null is the answer "this build has no console", not a failure. See `useAdmin`.
  const snapshot = query.data;
  if (!snapshot) return <Navigate to="/game" replace />;

  return (
    <PageShell
      title="The Console"
      icon="gear"
      wide
      lede="Testing mode. Put the game at a stage and look at it."
      action={
        <span
          className="rounded-sm border border-warning/60 bg-warning/10 px-2.5 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-warning"
          data-testid="admin-badge"
        >
          Admin · {snapshot.state.actionSeconds}s · free
        </span>
      }
    >
      <InfoNote tone="warn" label="Testing mode">
        Builds, musters, drills, location upgrades and the columns you send take{' '}
        <strong>{snapshot.state.actionSeconds} seconds</strong>, missions and research a minute, and
        nothing is charged, though screens show the real prices and times. A column the game walks
        home for you, after a fight or a faction ending, keeps the real pace. Gates about progress
        are waived: a locked plot, a full queue, an empty wallet. Run with <code>ADMIN=false</code>{' '}
        to charge.
      </InfoNote>

      <Panel title="Take me to">
        <div className="grid gap-3 p-4 sm:grid-cols-3" data-testid="admin-presets">
          {PRESETS.map((preset) => (
            <div
              key={preset.label}
              className="flex flex-col gap-2 rounded-sm border border-surface-600/70 bg-surface-800/60 p-3"
            >
              <span className="font-display text-[14px] font-bold text-ink-100">
                {preset.label}
              </span>
              <p className="font-body text-[12px] leading-snug text-ink-300">{preset.blurb}</p>
              <Button
                size="sm"
                className="mt-auto"
                disabled={knobs.isPending || grant.isPending}
                onClick={() => {
                  knobs.mutate(preset.knobs);
                  if (preset.grant) grant.mutate(preset.grant);
                }}
              >
                Go there
              </Button>
            </div>
          ))}

          {/*
           * Clean slate, in the row with the eras but not one of them.
           *
           * The three above move a crew along the game and every one of them is additive: a grant
           * has no undo, so pressing First hour on a finished crew lowers the knobs and leaves the
           * inventory full. This is the only control on the page that takes things *away*, which is
           * why it is the only one that asks first.
           */}
          <div className="flex flex-col gap-2 rounded-sm border border-oxblood-500/60 bg-surface-800/60 p-3">
            <span className="font-display text-[14px] font-bold text-oxblood-300">Clean slate</span>
            <p className="font-body text-[12px] leading-snug text-ink-300">
              Everything gone and a new character: the district emptied, the ground given back, and
              the overseer picker again.
            </p>
            <Button
              size="sm"
              variant="danger"
              className="mt-auto"
              data-testid="admin-reset"
              disabled={reset.isPending}
              onClick={() => setWiping(true)}
            >
              Start over
            </Button>
          </div>
        </div>

        {/* The presets' and the clean slate's own refusals, under the row they belong to: none of
            the three was drawn anywhere (bug pass, 2026-10-06). */}
        {(knobs.error ?? grant.error ?? reset.error) !== null && (
          <PressError>{(knobs.error ?? grant.error ?? reset.error)?.message}</PressError>
        )}

        {wiping && (
          <StartOverDialog
            onCancel={() => setWiping(false)}
            onConfirm={(successorId) => {
              setWiping(false);
              reset.mutate(successorId, {
                // The picker lives at the root: with no overseer, `/game` has nothing to draw.
                onSuccess: () => {
                  void navigate('/');
                },
              });
            }}
          />
        )}
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <StructureKnobs snapshot={snapshot} />
        <div className="flex flex-col gap-5">
          <StateKnobs snapshot={snapshot} />
          <GrantsPanel />
          <FightsPanel />
          <BackupsPanel snapshot={snapshot} />
        </div>
      </div>
    </PageShell>
  );
}
