import {
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_CATEGORY_LABELS,
  BUILDING_CATALOG,
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  CITY_DISTRICTS,
  districtDisplayName,
  OFFICER_ROLE_LABELS,
  OFFICER_ROLES,
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
import { Confirm } from '../../components/ui/Confirm';
import { NumberField } from '../../components/ui/NumberField';
import { Dropdown } from '../../components/ui/Dropdown';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import {
  useAdmin,
  useAdminFog,
  useAdminGrant,
  useAdminKnobs,
  useAdminReset,
  useAdminMockBattle,
} from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { formatDayClock } from '@frontline/shared';
import { usePlayerZone } from '../settings/usePlayerZone';

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
    blurb: 'A Nexus, a Gate and nothing else. What a new crew actually opens.',
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
       * not seat anybody hands a reviewer a mid-game crew with nineteen empty chairs: no
       * scouting, no spying, no research track, no role fit. Half is the shape of the era. The
       * count is derived rather than typed, so a nineteenth role does not leave this at nine.
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
      'The ceiling on everything: seven rungs into every programme, every drawing held, the yard full, traps cut and the shelf stocked.',
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
  ) => (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => set(Math.max(0, Math.trunc(Number(event.target.value))))}
        data-testid={testId}
        className="w-32 rounded-sm border border-surface-600 bg-surface-950 px-2.5 py-2 text-[13px] tabular-nums text-ink-100"
      />
    </label>
  );

  return (
    <Panel title="Standing and stock">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          {numberField('Player level', playerLevel, setPlayerLevel, 'admin-player-level')}
          <Button
            size="sm"
            variant="ghost"
            disabled={knobs.isPending}
            onClick={() => knobs.mutate({ playerLevel: Math.max(1, playerLevel) })}
          >
            Set level
          </Button>
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
            Build, training and research, so the next thing can be watched from the start.
          </span>
        </div>

        {knobs.error !== null && (
          <p role="alert" className="font-body text-[13px] text-oxblood-300">
            {knobs.error.message}
          </p>
        )}
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
  const [track, setTrack] = useState<OfficerRole>('security_officer');
  const button = (label: string, body: AdminGrantRequest, testId: string) => (
    <Button
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
            <select
              value={track}
              onChange={(event) => setTrack(event.target.value as OfficerRole)}
              data-testid="admin-grant-track"
              className="rounded-sm border border-surface-600 bg-surface-950 px-2.5 py-2 text-[13px] text-ink-100"
            >
              {OFFICER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {OFFICER_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          {button('Finish that track', { technologies: track }, 'admin-grant-track-go')}
          <span className="font-body text-[12px] text-ink-300">
            A trap wants its Lab rung as well as its document.
          </span>
        </div>

        {grant.error !== null && (
          <p role="alert" className="font-body text-[13px] text-oxblood-300">
            {grant.error.message}
          </p>
        )}
      </div>
    </Panel>
  );
}

/** What is on disk, so a restore can be chosen without an ssh session. */
/**
 * Fog of war (maintainer request).
 *
 * In admin mode every district is scouted, so a reviewer can open any screen without sending a
 * scout and waiting. This is where a district is un-ticked to look at the unscouted state of it.
 * The tick is the effective answer, computed server-side through the same seam the city reads;
 * real scouting intel is never written here, so admin mode off is exactly what the crew has seen.
 */
function FogPanel({ snapshot }: { snapshot: AdminSnapshot }) {
  const fog = useAdminFog();

  const hidden = snapshot.fog.filter((entry) => !entry.visible).length;
  /*
   * The plots are numbered here, exactly as they are on the map.
   *
   * Every unclaimed residential district is stored as `Player District`, so the snapshot's own
   * names put four identical rows in this list and left a reviewer un-ticking one at random to
   * find out which was which. `districtDisplayName` is the rule the city, the district screen and
   * the standings all name a plot by, and it numbers them from the viewer's own: the home row is
   * already marked, so it keeps the bare name and the rest read I, II, III.
   */
  const home = snapshot.fog.find((entry) => entry.home)?.districtId ?? '';
  const nameOf = (districtId: string, fallback: string): string => {
    const district = CITY_DISTRICTS.find((one) => one.id === districtId);
    return district ? districtDisplayName(district, { ownDistrictId: home }) : fallback;
  };
  const setAll = (visible: boolean) => {
    for (const entry of snapshot.fog) {
      if (entry.visible !== visible) fog.mutate({ districtId: entry.districtId, visible });
    }
  };
  return (
    <Panel
      title="Fog of war"
      action={
        <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
          {hidden === 0 ? 'Everything scouted' : `${hidden} hidden`}
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="font-body text-[12px] leading-relaxed text-ink-300">
          Ticked is scouted. In testing mode everything is, until you say otherwise; un-tick a
          district to see it the way a crew that has never been there does.
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-3" data-testid="admin-fog">
          {snapshot.fog.map((entry) => (
            <li key={entry.districtId}>
              <label className="flex items-center gap-2.5 rounded-sm border border-surface-600/70 bg-surface-800/60 px-3 py-2 font-body text-[13px] text-ink-100">
                <input
                  type="checkbox"
                  checked={entry.visible}
                  disabled={fog.isPending || entry.home}
                  onChange={(event) =>
                    fog.mutate({ districtId: entry.districtId, visible: event.target.checked })
                  }
                  data-testid={`admin-fog-${entry.districtId}`}
                />
                <span className="min-w-0 flex-1 break-words leading-snug">
                  {nameOf(entry.districtId, entry.name)}
                </span>
                {entry.home && (
                  <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.14em] text-ink-400">
                    Home
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={fog.isPending}
            onClick={() => setAll(true)}
            data-testid="admin-fog-all"
          >
            Scout everything
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={fog.isPending}
            onClick={() => setAll(false)}
            data-testid="admin-fog-none"
          >
            Hide everything
          </Button>
        </div>
        {fog.error !== null && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            {fog.error.message}
          </p>
        )}
      </div>
    </Panel>
  );
}

function BackupsPanel({ snapshot }: { snapshot: AdminSnapshot }) {
  const zone = usePlayerZone();
  return (
    <Panel
      title="Snapshots"
      action={
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          Every ten minutes
        </span>
      }
    >
      {snapshot.backups.length === 0 ? (
        <p className="p-4 font-body text-[13px] text-ink-300">
          None on disk yet. The first one lands ten minutes after the server started.
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
          {mock.error !== null && (
            <span role="alert" className="font-body text-[12px] text-oxblood-300">
              {mock.error.message}
            </span>
          )}
        </div>
      </div>
    </Panel>
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

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Opening the console…
        </p>
      </div>
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
        Every clock in the game is <strong>{snapshot.state.actionSeconds} seconds</strong> and
        nothing is charged, but every screen still shows the real price and the real duration. That
        is the point, so the economy can be judged while the waiting is skipped. Gates are
        untouched: a locked structure is still locked, a full queue is still full, the unit-slot cap
        is still the unit-slot cap. Run with <code>ADMIN=false</code> for a build that charges.
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

        {wiping && (
          <Confirm
            title="Start over?"
            body="This crew goes back to its first second: the district emptied, every location you hold given back to the city, the inventory and the shelf cleared, and the research undone. You pick a character again. Nothing about it can be undone."
            confirm="Wipe it"
            testId="confirm-reset"
            onCancel={() => setWiping(false)}
            onConfirm={() => {
              setWiping(false);
              reset.mutate(undefined, {
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
        <FogPanel snapshot={snapshot} />
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
