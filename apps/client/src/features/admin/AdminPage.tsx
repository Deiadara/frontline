import {
  BUILDING_CATALOG,
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  RESOURCE_KEYS,
  type AdminKnobsRequest,
  type AdminSnapshot,
  type BuildingKind,
  type ResourceKey,
} from '@frontline/shared';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useAdmin, useAdminKnobs } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { formatDayClock } from '@frontline/shared';
import { usePlayerZone } from '../settings/usePlayerZone';

/**
 * The bench.
 *
 * A design pass needs to look at the game at level 3, at level 10 and at level 20, and reaching any
 * of those by playing takes days. This puts the whole district at a chosen level in one click, sets
 * the stockpile and the name on the street, and empties the queues so the next thing can be watched
 * from the start.
 *
 * **It does not exist when admin mode is off.** `GET /api/admin` answers 404 in that build, the
 * hook turns that one status into `null`, and this screen redirects rather than rendering an
 * apology. There is no half-state where a player sees a locked bench and wonders what is behind it.
 *
 * Everything here is one press, applied immediately, with the resulting state shown underneath.
 * A bench with a Save button is a bench where you have to remember what you changed.
 */

const PRESETS: readonly { label: string; blurb: string; knobs: AdminKnobsRequest }[] = [
  {
    label: 'First hour',
    blurb: 'A Nexus, a Gate and nothing else. What a new crew actually opens.',
    knobs: { buildingLevel: 1, playerLevel: 1, infamy: 0, clearQueues: true },
  },
  {
    label: 'Mid game',
    blurb: 'Every structure at 8, a working stockpile, a name people have heard.',
    knobs: {
      buildingLevel: 8,
      playerLevel: 12,
      infamy: 900,
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
    blurb: 'The ceiling on everything, and enough infamy to empty the back room.',
    knobs: {
      buildingLevel: BUILDING_MAX_LEVEL,
      playerLevel: 30,
      infamy: 25_000,
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
             * codebase: the bench is not a player screen, but it is a screen somebody looks at the
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

          <label className="flex flex-col gap-1.5">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-200">
              Level ({level})
            </span>
            <input
              type="range"
              min={0}
              max={BUILDING_MAX_LEVEL}
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              data-testid="admin-level"
              className="h-9 w-56 accent-brass-300"
            />
          </label>

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

/** What is on disk, so a restore can be chosen without an ssh session. */
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

export function AdminPage() {
  const query = useAdmin();
  const knobs = useAdminKnobs();

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Opening the bench…
        </p>
      </div>
    );
  }

  // Null is the answer "this build has no bench", not a failure. See `useAdmin`.
  const snapshot = query.data;
  if (!snapshot) return <Navigate to="/game" replace />;

  return (
    <PageShell
      title="The Bench"
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
        untouched: a locked structure is still locked, a full queue is still full, supply is still
        supply. Run with <code>ADMIN=false</code> for a build that charges.
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
                disabled={knobs.isPending}
                onClick={() => knobs.mutate(preset.knobs)}
              >
                Go there
              </Button>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <StructureKnobs snapshot={snapshot} />
        <div className="flex flex-col gap-5">
          <StateKnobs snapshot={snapshot} />
          <BackupsPanel snapshot={snapshot} />
        </div>
      </div>
    </PageShell>
  );
}
