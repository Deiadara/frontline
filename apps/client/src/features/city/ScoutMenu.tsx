import {
  formatCountdown,
  scoutRecallWindowMs,
  type DistrictDetailResponse,
} from '@frontline/shared';
import { CancelMark } from '../../components/ui/CancelMark';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { DrawnGlyph, DrawnRule } from '../../components/ui/DrawnMarks';
import { Modal } from '../../components/ui/Modal';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { cn } from '../../lib/cn';
import { useDistrict, useRecallScout, useScout } from '../../lib/queries';
import { useServerClock } from '../missions/useServerClock';
import { CombineLeaderTag } from './CombineLeader';

/**
 * The door to a district nobody from this crew has been to (maintainer, 2026-09-23).
 *
 * Unscouted ground does not open. It used to: a tag on the map led to the district's own screen
 * with the fog drawn as an "Unscouted" panel in a column, and the whole rest of the screen was
 * chrome around nothing, since a district you have not been to has nothing to show. Now the tag
 * opens this instead: a hand-drawn sheet with the district's name on it and the one thing to do
 * about it, in one of four states.
 *
 * - **Cannot send.** Scouting is the Master of Whispers' work, sent from their chair once they
 *   have worked Scouting out. Both requirements are drawn as a checklist with a tick or a cross,
 *   so the one that is missing is obvious, and a line under it says where to go.
 * - **Can send.** How long the party would be gone, and Send Scouts.
 * - **A party is on the road here.** The countdown, and the X to turn them round while the first
 *   tenth of the way out is still open.
 * - **A party is out somewhere else.** Where, and the countdown: one party at a time.
 *
 * The district read carries all of it (`scoutBlocker`, `scoutPlan`, `scoutingRun`), so this is
 * the same data the old panel read, on a sheet over the map rather than on a page.
 */
export function ScoutMenu({ districtId, onClose }: { districtId: string; onClose: () => void }) {
  const query = useDistrict(districtId);
  const data = query.data;

  return (
    <Modal onClose={onClose} labelledBy="scout-menu-title" data-testid="scout-menu-window">
      <div
        className="ink-frame card-paper washed grain relative flex flex-col gap-3 rounded-sm p-5 shadow-panel"
        data-testid="scout-menu"
      >
        {data ? (
          <ScoutSheet data={data} receivedAt={query.dataUpdatedAt} onClose={onClose} />
        ) : (
          <ScreenLoad
            what="This district"
            loading="Reading the street…"
            isError={query.isError}
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    </Modal>
  );
}

function ScoutSheet({
  data,
  receivedAt,
  onClose,
}: {
  data: DistrictDetailResponse;
  /** When the payload arrived, so the countdown runs on the server's clock (see `useServerClock`). */
  receivedAt: number;
  onClose: () => void;
}) {
  const now = useServerClock(data.serverNow, receivedAt);
  const run = data.scoutingRun;
  const scout = useScout();
  const recall = useRecallScout(data.district.id);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p className="font-display text-[10px] font-bold uppercase tracking-[0.22em] text-brass-300">
          Unscouted ground
        </p>
        <h2
          id="scout-menu-title"
          className="break-words font-stamp text-[26px] leading-tight text-ink-100"
          data-testid="scout-menu-title"
        >
          {data.district.name}
        </h2>
        {/* What the initials stand for. The map draws the short name because a tag on a painting
            has room for three letters, and this sheet is now where a player meets an unscouted
            district, so it is where CCS has to become the Civic Command Sector. */}
        {data.district.formalName !== null && (
          <p
            className="font-display text-[12px] uppercase tracking-[0.18em] text-brass-300"
            data-testid="district-formal-name"
          >
            {data.district.formalName}
          </p>
        )}
        {/* The Combine's man, when there is one: his existence is known before the ground is. */}
        {data.combineLeader && <CombineLeaderTag leader={data.combineLeader} />}
      </div>
      <span aria-hidden className="block h-1.5 w-full text-brass-300/60">
        <DrawnRule />
      </span>

      {run && run.districtId === data.district.id ? (
        <Underway data={data} now={now} />
      ) : run ? (
        <div className="flex flex-col gap-2" data-testid="scout-elsewhere">
          <p className="font-body text-[13px] leading-relaxed text-ink-200">
            Nobody from this crew has been here, and the{' '}
            <span className="text-ink-100">{run.officerName}</span> is already out at{' '}
            <span className="text-ink-100">{run.districtName}</span>. One party at a time.
          </p>
          <Waiting until={run.returnsAt} now={now} />
        </div>
      ) : data.scoutBlocker !== null ? (
        <Blocked blocker={data.scoutBlocker} />
      ) : data.scoutPlan === null ? (
        <p
          className="font-body text-[13px] leading-relaxed text-oxblood-300"
          data-testid="scout-nobody"
        >
          There is no road between here and home for a party to walk.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-body text-[13px] leading-relaxed text-ink-200">
            Nobody from this crew has been here. Send a scout party and the street opens up.
          </p>
          <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-400">
            <span className="text-brass-300">A scout party</span> would be gone{' '}
            <span className="tabular-nums text-brass-300">
              {formatSpan(data.scoutPlan.minutes)}
            </span>
          </p>
          {scout.error && (
            <p role="alert" className="font-body text-[12px] text-oxblood-300">
              {scout.error.message}
            </p>
          )}
          <DrawnButton
            disabled={scout.isPending}
            onClick={() => scout.mutate({ districtId: data.district.id })}
            data-testid="send-scout"
          >
            {scout.isPending ? 'Sending…' : 'Send Scouts'}
          </DrawnButton>
        </div>
      )}

      {/*
       * The X to turn a party round, only on a run to *this* ground and only while the window is
       * open: they walk home the distance covered and the ground stays shut.
       */}
      {run && run.districtId === data.district.id && (
        <>
          <CancelMark
            windowMs={scoutRecallWindowMs(run, now)}
            label={`Turn the ${run.officerName} round`}
            pending={recall.isPending}
            onCancel={() => recall.mutate({})}
            data-testid="recall-scout"
          />
          {recall.error && (
            <p role="alert" className="font-body text-xs text-oxblood-300">
              {recall.error.message}
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        data-testid="scout-menu-close"
        className="self-end font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-400 hover:text-brass-300"
      >
        Back to the map
      </button>
    </>
  );
}

/**
 * What it takes, as a checklist. The route answers with one blocker, and the chair comes first:
 * with nobody in it the research line is drawn unmet too, because Scouting is worked out on the
 * Master of Whispers' own track and there is no track without the chair.
 */
function Blocked({ blocker }: { blocker: 'no_whispers' | 'not_researched' }) {
  const chair = blocker !== 'no_whispers';
  return (
    <div className="flex flex-col gap-2.5" data-testid="scout-nobody">
      <p className="font-body text-[13px] leading-relaxed text-ink-200">
        Nobody from this crew has been here, and nobody can go yet. Scouting is the Master of
        Whispers' work.
      </p>
      <ul className="flex flex-col gap-1.5">
        <Requirement met={chair} testId="scout-need-whispers">
          A Master of Whispers in the chair
        </Requirement>
        <Requirement met={false} testId="scout-need-research">
          Scouting researched on their track
        </Requirement>
      </ul>
      <p className="font-body text-[12px] italic leading-relaxed text-ink-400">
        {chair
          ? 'It is the first rung on their track: open Research and start it.'
          : 'Sign one at the Bar and seat them, then work Scouting out on their track.'}
      </p>
    </div>
  );
}

function Requirement({
  met,
  testId,
  children,
}: {
  met: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className="ink-box flex items-center gap-2.5 px-3 py-1.5"
      data-testid={testId}
      data-met={met ? 'yes' : 'no'}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4',
          met ? 'text-verdigris-300' : 'text-oxblood-300',
        )}
      >
        <DrawnGlyph name={met ? 'check' : 'close'} />
      </span>
      <span className={cn('font-body text-[13px]', met ? 'text-ink-300' : 'text-ink-100')}>
        {children}
      </span>
      <span className="sr-only">{met ? ' (met)' : ' (missing)'}</span>
    </li>
  );
}

/** Somebody is out, and it is this district: a countdown, and what it means. */
function Underway({ data, now }: { data: DistrictDetailResponse; now: Date }) {
  const run = data.scoutingRun!;
  return (
    <div className="flex flex-col gap-2" data-testid="scout-underway">
      <p className="font-body text-[13px] leading-relaxed text-ink-200">
        {run.recalledAt === null ? (
          <>
            The <span className="text-ink-100">{run.officerName}</span> is on the road. The street
            opens when they are back.
          </>
        ) : (
          <>
            The <span className="text-ink-100">{run.officerName}</span> turned round and is walking
            home. The street stays shut: they never got here.
          </>
        )}
      </p>
      <Waiting until={run.returnsAt} now={now} />
    </div>
  );
}

/** Hours and minutes, in the shape a player reads an evening in. */
function formatSpan(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** The clock on a run under way, ticking against the server's own time. */
function Waiting({ until, now }: { until: string; now: Date }) {
  const remaining = Date.parse(until) - now.getTime();
  return (
    <p
      className="font-display text-[18px] font-bold tabular-nums text-brass-300"
      data-testid="scout-countdown"
    >
      {remaining <= 0 ? 'Walking back in' : formatCountdown(remaining)}
    </p>
  );
}
