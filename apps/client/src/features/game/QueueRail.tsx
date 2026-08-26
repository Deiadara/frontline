import {
  BUILDING_CATALOG,
  canRecall,
  findMissionTemplate,
  findUnit,
  missionCompletesAt,
  missionPhaseAt,
  missionProgressAt,
  queueCompletesAt,
  queueProgressAt,
  researchCompletesAt,
  trainingProgressAt,
  trainingRemainingMs,
  type Base,
  type MissionsResponse,
  type ResearchResponse,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { useMe, useMissions, useRecallMission, useResearch } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';

/**
 * What the crew is doing right now, on every screen.
 *
 * Straight out of Grepolis, and it is the single thing that game does which this one was missing.
 * Every clock in Frontline lived on the page that started it: a build was only visible in the
 * district, a training batch only on the roster, a research project only in the Archive. So a
 * player looking at the city map had no idea anything was running at all, and the only way to find
 * out whether the Quarters had finished was to go and look. A queue you cannot see is a queue you
 * forget to refill, and an idle district is the failure state of a builder.
 *
 * A strip along the bottom, above the scenery switcher, and *in the shell's flow* rather than
 * floating over the world. It used to be a 224px column in the bottom-left corner, which was fine
 * while the district was a picture in the middle of the screen and became a real bug when the
 * district filled it: the column sat squarely on the Cistern, which is the smallest building on the
 * plate, and buried it completely: visible, labelled, and impossible to click. A horizontal strip
 * costs a fortieth of the picture instead of a third of it, and because it is in flow the shell
 * measures it into `--nav-h`, so the district lays itself out *above* it and covers nothing at all.
 *
 * Each chip opens the same detail window the rows used to, because the reason a player looks at a
 * countdown is to decide whether to go and do something about it.
 *
 * It reads what the shell already polls: `/me` carries both queues, `/research` the project in
 * flight, so it costs no extra request and cannot disagree with the page it links to.
 */

interface Entry {
  id: string;
  icon: IconName;
  /** What is happening, in three or four words. */
  what: string;
  /** Where the player goes to do something about it. */
  to: string;
  endsAt: number;
  progress: number;
  /** Where it is happening. Missions go somewhere; a build happens at home. */
  place: string;
  /** What kind of thing this is, in the player's words. */
  kind: string;
  /** Set on the things that can be called off; `null` on everything else. */
  missionId: string | null;
}

function entriesFor(
  base: Base,
  research: ResearchResponse | undefined,
  missions: MissionsResponse | undefined,
  now: Date,
): Entry[] {
  const builds = base.buildQueue.map((entry) => ({
    id: `build-${entry.id}`,
    icon: 'district' as const,
    what: `${BUILDING_CATALOG[entry.kind].name} → ${entry.level}`,
    to: '/game/base',
    endsAt: queueCompletesAt(entry).getTime(),
    progress: queueProgressAt(entry, now),
    place: 'Your district',
    kind: 'Building',
    missionId: null,
  }));

  const training = base.trainingQueue.map((order) => ({
    id: `unit-${order.id}`,
    icon: 'units' as const,
    what: `${order.count}× ${findUnit(order.unitId)?.name ?? order.unitId}`,
    to: '/game/units',
    endsAt: now.getTime() + trainingRemainingMs(order, now),
    progress: trainingProgressAt(order, now),
    place: 'The Gauntlet',
    kind: 'Training',
    missionId: null,
  }));

  /*
   * Crews that are actually *out*.
   *
   * The only entries with somewhere to be and the only ones that can be turned around, which is why
   * the rail carries them at all: a build finishing is a thing you wait for, a crew three districts
   * away is a decision you might still want to change.
   */
  const away = (missions?.missions ?? [])
    .filter((mission) => mission.status === 'active')
    .map((mission) => {
      const template = findMissionTemplate(mission.templateId);
      return {
        id: `mission-${mission.id}`,
        icon: 'missions' as const,
        what: template?.name ?? 'A crew is out',
        to: '/game/missions',
        endsAt: missionCompletesAt(mission).getTime(),
        progress: missionProgressAt(mission, now),
        place: template?.name ?? 'Somewhere in the city',
        kind:
          mission.recalledAt !== null
            ? 'Coming home'
            : (MISSION_PHASE_WORD[missionPhaseAt(mission, now)] ?? 'Out'),
        missionId: canRecall(mission, now) ? mission.id : null,
      };
    });

  const active = research?.active;
  const project = active
    ? [
        {
          id: `research-${active.id}`,
          icon: 'research' as const,
          what: 'In the archive',
          to: '/game/research',
          place: 'The Archive',
          kind: 'Research',
          missionId: null,
          endsAt: researchCompletesAt(active).getTime(),
          progress: Math.min(
            1,
            Math.max(
              0,
              (now.getTime() - Date.parse(active.startedAt)) / (active.durationMinutes * 60_000),
            ),
          ),
        },
      ]
    : [];

  // Soonest first: the one about to land is the one worth a glance.
  return [...builds, ...training, ...project, ...away].sort((a, b) => a.endsAt - b.endsAt);
}

/** §E2's phases, as the two words a rail entry has room for. */
const MISSION_PHASE_WORD: Record<string, string> = {
  outbound: 'On the road',
  onSite: 'On site',
  returning: 'Coming home',
  returned: 'At the gate',
};

/**
 * The screens the rail is drawn on.
 *
 * The world ones. A document page fills the frame with a sheet, and a floating panel over the
 * bottom-left corner of a sheet is not chrome. It is something covering the page you are reading.
 * On the map and in the district it floats over artwork and hides nothing, which is exactly what
 * Grepolis does with it.
 */
const WORLD_ROUTES = new Set(['/game', '/game/base']);

export function QueueRail() {
  const { pathname } = useLocation();
  const me = useMe();
  const research = useResearch();
  const missions = useMissions();
  const now = useServerClock(missions.data?.serverNow, me.dataUpdatedAt);
  const [opened, setOpened] = useState<string | null>(null);

  const base = me.data?.base;
  if (!base || !WORLD_ROUTES.has(pathname)) return null;

  const entries = entriesFor(base, research.data, missions.data, now);
  if (entries.length === 0) return null;
  const open = entries.find((entry) => entry.id === opened);

  return (
    <aside
      aria-label="What is in flight"
      data-testid="queue-rail"
      className="pointer-events-auto flex items-center gap-2 overflow-x-auto px-4 pb-1 pt-1"
    >
      <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
        In flight
      </span>
      {/* Capped at four. Five clocks is a scroll bar on a strip nobody scrolls; the pages
          themselves are where a full queue belongs. */}
      {entries.slice(0, 4).map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => setOpened(entry.id)}
          data-testid={`queue-rail-${entry.id}`}
          data-tip={`${entry.kind}: ${entry.what}`}
          className={cn(
            'glass painted rivets group relative flex shrink-0 items-center gap-2 overflow-hidden rounded-sm',
            'border border-surface-600/80 py-1 pl-1.5 pr-2.5 text-left transition-colors hover:border-brass-300/70',
          )}
        >
          <span className="icon-tile flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-brass-100">
            <Icon name={entry.icon} className="h-4 w-4" />
          </span>
          <span className="max-w-[11rem] truncate font-display text-[12px] font-semibold text-ink-100">
            {entry.what}
          </span>
          <span className="shrink-0 font-display text-[12px] font-bold tabular-nums text-brass-300">
            {formatRemaining(Math.max(0, entry.endsAt - now.getTime()))}
          </span>
          {/* The progress bar as the chip's own underline: a strip has no room for a row of
              bars under the labels, and a filling edge is read at a glance anyway. */}
          <span className="absolute inset-x-0 bottom-0 block h-[3px] bg-surface-900">
            <span
              className="block h-full bg-brass-300"
              style={{ width: `${entry.progress * 100}%` }}
            />
          </span>
        </button>
      ))}
      {entries.length > 4 && (
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          +{entries.length - 4} more
        </span>
      )}

      {open !== undefined && <QueueDetail entry={open} now={now} onClose={() => setOpened(null)} />}
    </aside>
  );
}

/**
 * One clock, opened.
 *
 * The rail has room for a countdown and four words. This is where the rest goes: what exactly is
 * happening, where, when it lands as a wall-clock time rather than a duration, and, for a crew
 * that is still out: the one button that changes any of it.
 *
 * Recall is deliberately not a "cancel". Nothing is undone: the crew turns around and walks back
 * the way they came, which takes exactly as long as getting that far did, and they arrive with
 * nothing. Saying so on the button is the difference between a player using it once and a player
 * feeling cheated by it once.
 */
function QueueDetail({ entry, now, onClose }: { entry: Entry; now: Date; onClose: () => void }) {
  const recall = useRecallMission();
  const left = Math.max(0, entry.endsAt - now.getTime());
  const arrival = new Date(entry.endsAt);

  return (
    <Modal onClose={onClose} labelledBy="queue-detail-title" className="max-w-md">
      <div className="flex shrink-0 items-start gap-3.5 border-b border-surface-600/60 px-5 py-4">
        <span className="icon-tile flex h-14 w-14 shrink-0 items-center justify-center rounded-sm text-brass-100">
          <Icon name={entry.icon} className="h-9 w-9" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
            {entry.kind}
          </p>
          <h2
            id="queue-detail-title"
            className="mt-0.5 font-display text-lg font-bold tracking-[0.06em] text-ink-100"
          >
            {entry.what}
          </h2>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-5">
        <span className="block h-2 w-full overflow-hidden rounded-sm bg-surface-900">
          <span
            className="block h-full rounded-sm bg-brass-300"
            style={{ width: `${entry.progress * 100}%` }}
          />
        </span>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <Field label="Where">{entry.place}</Field>
          <Field label="Time left">
            <span className="tabular-nums">{formatRemaining(left)}</span>
          </Field>
          <Field label="Expected">
            <span className="tabular-nums">
              {arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
              {arrival.toLocaleDateString([], { day: 'numeric', month: 'short' })}
            </span>
          </Field>
          <Field label="Done">{Math.round(entry.progress * 100)}%</Field>
        </dl>

        {entry.missionId !== null && (
          <p className="rounded-sm border-l-2 border-oxblood-300 bg-oxblood-500/10 px-3 py-2 font-body text-[13px] leading-relaxed text-ink-200">
            Call them back and they turn around where they stand. The walk home takes as long as the
            walk out took, and they arrive with nothing.
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-surface-700 px-5 py-4">
        <Link
          to={entry.to}
          onClick={onClose}
          className="rounded-sm border border-surface-600 px-3 py-2 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-ink-100 transition-colors hover:border-brass-300/70"
        >
          Go there
        </Link>
        {entry.missionId !== null && (
          <Button
            size="sm"
            variant="ghost"
            disabled={recall.isPending}
            data-testid="queue-recall"
            onClick={() => {
              recall.mutate({ missionId: entry.missionId ?? '' }, { onSuccess: onClose });
            }}
          >
            Call them back
          </Button>
        )}
        <Button size="sm" onClick={onClose}>
          Leave it
        </Button>
      </footer>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-400">{label}</dt>
      <dd className="mt-0.5 truncate font-body text-[14px] text-ink-100">{children}</dd>
    </div>
  );
}
