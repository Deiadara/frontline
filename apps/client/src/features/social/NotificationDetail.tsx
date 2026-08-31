import {
  MISC_AREA_ID,
  NOTIFICATION_KIND_SPECS,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  findDistrict,
  findMissionTemplate,
  findUnit,
  missionCarry,
  type Mission,
  type Notification,
  type PartialResources,
  type ResourceKey,
} from '@frontline/shared';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { useMissions } from '../../lib/queries';

/**
 * What is behind a notification (board request).
 *
 * A receipt that only carries a headline makes a player go and hunt for the thing it is about, and
 * the hunt is worse the more receipts there are. Opening one now shows the thing itself, drawn as a
 * report rather than as a paragraph: labelled boxes, the numbers in the display face, and the one
 * comparison that is not obvious anywhere else in the game.
 *
 * ## Not every kind has a sheet yet
 *
 * A mission has one, because a mission is the kind with the most to say and the only one carrying a
 * fact that exists nowhere else on any screen (see `Haul`). Everything else falls back to the
 * headline and a door to where it happened, which is exactly what the whole feature did before, so
 * a kind with no bespoke sheet is no worse off than it was.
 */
export function NotificationDetail({
  entry,
  onClose,
}: {
  entry: Notification;
  onClose: () => void;
}) {
  const spec = NOTIFICATION_KIND_SPECS[entry.kind];
  const missions = useMissions();
  const mission =
    entry.subjectId === null
      ? undefined
      : missions.data?.missions.find((row) => row.id === entry.subjectId);

  return (
    <Modal onClose={onClose} labelledBy="detail-title" size="wide">
      <div className="flex min-h-0 flex-col" data-testid="notification-detail">
        <div className="flex shrink-0 items-start gap-3 border-b border-surface-600/60 px-5 py-4">
          <span
            aria-hidden
            className="icon-plate flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
          >
            <Icon name={spec.icon as IconName} />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 id="detail-title" className="font-stamp text-xl leading-tight text-ink-100">
              {entry.title}
            </h2>
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
              {spec.label}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {mission ? (
            <MissionReport mission={mission} where={areaName(mission.areaId)} />
          ) : (
            <p className="font-body text-[14px] leading-relaxed text-ink-200">
              {entry.body || 'Nothing further was written down.'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-surface-600/60 px-5 py-3">
          <Link to={entry.link} onClick={onClose} data-testid="detail-go">
            <Button size="sm">Go there</Button>
          </Link>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One labelled box. The report is a grid of these rather than a paragraph of prose. */
function Field({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'good' | 'bad';
}) {
  return (
    <div className="ink-frame card-paper washed flex min-w-0 flex-col gap-0.5 px-3 py-2">
      <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
        {label}
      </span>
      <span
        className={cn(
          'truncate font-display text-[15px] font-bold',
          tone === 'good' && 'text-verdigris-300',
          tone === 'bad' && 'text-oxblood-300',
          tone === 'plain' && 'text-ink-100',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Where a job was, in the player's words.
 *
 * The areas on the missions response are only the boards this crew may *read* right now, so a
 * finished run's ground is often not among them: it goes through the map instead, which authored
 * every district and never forgets one.
 */
function areaName(areaId: string): string {
  if (areaId === MISC_AREA_ID) return 'Odd jobs';
  return findDistrict(areaId)?.name ?? areaId;
}

/**
 * The mission report: four facts across the top, who went, then the haul.
 */
function MissionReport({ mission, where }: { mission: Mission; where: string }) {
  const template = findMissionTemplate(mission.templateId);
  const recalled = mission.recalledAt !== null;
  const bodies = Object.values(mission.force).reduce((total, count) => total + count, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="mission-report">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Job" value={template?.name ?? 'A retired job'} />
        <Field label="Where" value={where} />
        <Field
          label="Outcome"
          value={recalled ? 'Recalled' : mission.outcome === 'success' ? 'Clean' : 'Failed'}
          tone={recalled ? 'plain' : mission.outcome === 'success' ? 'good' : 'bad'}
        />
        <Field label="Sent" value={`${bodies} ${bodies === 1 ? 'body' : 'bodies'}`} />
      </div>

      {/* Who went, and what they could lift between them. */}
      {bodies > 0 && (
        <section className="flex flex-col gap-2">
          <Heading>The crew that went</Heading>
          <ul className="flex flex-wrap gap-1.5" data-testid="report-force">
            {Object.entries(mission.force)
              .filter(([, count]) => count > 0)
              .map(([unitId, count]) => (
                <li
                  key={unitId}
                  className="rounded-sm border border-surface-600 px-2 py-1 font-display text-[11px] uppercase tracking-[0.1em] text-ink-200"
                >
                  {findUnit(unitId)?.name ?? unitId}{' '}
                  <span className="tabular-nums text-brass-300">{count}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <Haul mission={mission} />
    </div>
  );
}

/**
 * What came home, against what the job actually paid.
 *
 * This is the reason the sheet exists. A crew carries what its units can lift (`missionCarry`), so
 * an under-crewed run leaves part of its pay on the ground, and before this there was no screen in
 * the game that said so: the player saw what landed in the stockpile and had no way to know it was
 * a fraction. Drawn as `carried / earned` per resource, with the shortfall called out once at the
 * bottom in the plainest sentence available.
 */
function Haul({ mission }: { mission: Mission }) {
  const carry = missionCarry(mission.force);
  // An older row recorded only what was banked. Showing "120 of 120" there would be a claim the
  // data cannot support, so with no `spoils` the report says what came home and stops.
  const knownSpoils = Object.keys(mission.spoils).length > 0;
  const earned: PartialResources = knownSpoils ? mission.spoils : mission.rewards;
  const kinds = RESOURCE_ORDER.filter(
    (kind) => (earned[kind] ?? 0) > 0 || (mission.rewards[kind] ?? 0) > 0,
  );
  const shortfall = kinds.some((kind) => (mission.rewards[kind] ?? 0) < (earned[kind] ?? 0));

  return (
    <section className="flex flex-col gap-2">
      <Heading>What came back</Heading>
      {kinds.length === 0 ? (
        <p className="font-body text-[13px] italic text-ink-400">
          {mission.recalledAt !== null
            ? 'They were turned around before they got there. Nothing was picked up.'
            : 'The job paid nothing.'}
        </p>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="report-haul">
            {kinds.map((kind) => (
              <HaulRow
                key={kind}
                kind={kind}
                carried={Math.round(mission.rewards[kind] ?? 0)}
                earned={Math.round(earned[kind] ?? 0)}
                known={knownSpoils}
              />
            ))}
          </ul>
          <p className="font-body text-[12px] leading-snug text-ink-400">
            The crew could lift <span className="tabular-nums text-ink-200">{carry}</span> kg
            between them.
            {shortfall && (
              <span className="text-brass-300">
                {' '}
                They left the rest of it where it lay: send more carriers next time.
              </span>
            )}
          </p>
        </>
      )}
    </section>
  );
}

function HaulRow({
  kind,
  carried,
  earned,
  known,
}: {
  kind: ResourceKey;
  carried: number;
  earned: number;
  known: boolean;
}) {
  const short = known && carried < earned;
  return (
    <li
      className="flex items-center gap-2.5 rounded-sm border border-surface-600/80 bg-surface-900/40 px-3 py-2"
      data-testid={`haul-${kind}`}
    >
      <span
        aria-hidden
        className="icon-tile flex h-8 w-8 shrink-0 items-center justify-center rounded-sm [&_svg]:h-4 [&_svg]:w-4"
      >
        <Icon name={kind === 'highQualityMetal' ? 'metal' : (kind as IconName)} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-display text-[10px] uppercase tracking-[0.14em] text-ink-400">
          {RESOURCE_LABELS[kind]}
        </span>
        <span className="font-display text-[14px] font-bold tabular-nums">
          <span className={short ? 'text-brass-300' : 'text-ink-100'}>
            {carried.toLocaleString()}
          </span>
          {known && <span className="text-ink-400"> of {earned.toLocaleString()}</span>}
        </span>
      </span>
    </li>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
        {children}
      </h3>
      <span aria-hidden className="ink-rule h-1 w-full" />
    </div>
  );
}
