import {
  ATTRIBUTE_LABELS,
  BUILDING_CATALOG,
  OVERSEER_SUBJECT,
  cancelWindowMs,
  drillCancelWindowMs,
  drillCancellable,
  drillProgressAt,
  drillRemainingMs,
  findResearchItem,
  findUnit,
  findVehicle,
  buildCancelWindowMs,
  queueCompletesAt,
  queueProgressAt,
  researchCancelWindowMs,
  researchCompletesAt,
  researchProgressAt,
  musterCancelWindowMs,
  musterCancellable,
  musterProgressAt,
  musterRemainingMs,
  type Base,
  type LocationView,
  type TrainingSession,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { CancelMark } from '../../components/ui/CancelMark';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { ProgressBar } from '../../components/ui/ProgressBar';
import {
  useCancelBuild,
  useCancelDrill,
  useCancelLocationUpgrade,
  useCancelResearch,
  useCancelMuster,
  useCity,
  useCrew,
  useDistrict,
  useMe,
  useMissions,
  useResearch,
  useTraining,
  useWorksUnderWay,
} from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { FileSection } from '../overseer/FileSection';
import { Row, Section } from './rows';
import { PressError } from '../../components/ui/PressError';

/**
 * The Monitor's In progress page (maintainer, 2026-09-23): every clock that is running at home.
 *
 * "On the road" is everything that is somewhere else. This is everything that is *here* and not
 * finished: a level being built, a programme in the Archive, a batch on the bench, an officer's
 * drill, a place being worked up, and somebody laid up. It replaces the strip of chips
 * that used to sit under the Monitor ("In flight"), which had room for four words and a countdown
 * and drew the road's crews a second time; a page has room to say what each thing is, where, how
 * far along, and, inside its first tenth, the one X that calls it off.
 *
 * Nothing here is the only copy. The district draws its own build rail, the Archive its own
 * programme, the bench its own batches, the training floor its own drills, and a location's sheet
 * its own upgrade and dig. This is the one place they are all on one page.
 *
 * The clock is the missions board's `serverNow` paired with *its own* arrival time. The rail this
 * replaces once paired that clock with the `/me` query's arrival, and every countdown on it
 * jumped twenty seconds as the two polls interleaved. Every end here is an absolute server time,
 * so any honest offset reads them all.
 */
export function InProgressPage() {
  const me = useMe();
  const research = useResearch();
  const training = useTraining();
  const crew = useCrew();
  const city = useCity();
  const missions = useMissions();
  const now = useServerClock(missions.data?.serverNow, missions.dataUpdatedAt);
  const heldDistricts = (city.data?.districts ?? []).filter((one) => one.held.mine > 0);
  // Before the early return below: a hook after it is how a page goes blank.
  const works = useWorksUnderWay(
    heldDistricts.map((one) => one.district.id),
    me.data?.base?.id,
  );

  const base = me.data?.base;
  if (!base) {
    return (
      <ScreenLoad
        what="What is in progress"
        loading="Reading the clocks…"
        isError={me.isError}
        onRetry={() => void me.refetch()}
        detail="Nothing has been lost. Everything that was running still is."
      />
    );
  }

  const active = research.data?.active ?? null;
  const drills = base.training.sessions;
  const hurt = (crew.data?.officers ?? []).filter(
    (one) => one.injuredUntil !== null && Date.parse(one.injuredUntil) > now.getTime(),
  );
  /*
   * Only once the reads it counts have answered (bug pass, 2026-10-06): it waited for `/me` alone,
   * so a crew with only research running was told nothing was running until `/research` landed,
   * and for good if that read failed.
   */
  const counted = research.data !== undefined && crew.data !== undefined && city.data !== undefined;
  const nothing =
    counted &&
    base.buildQueue.length === 0 &&
    active === null &&
    base.musterQueue.length === 0 &&
    drills.length === 0 &&
    hurt.length === 0 &&
    works === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-testid="in-progress">
      {nothing && (
        <FileSection icon="actions" title="Nothing is running">
          <p className="font-body text-[13px] leading-relaxed text-ink-300">
            No level being built, nothing in the Archive, nobody on the bench or the training floor.
            An idle district is the one state a builder should not leave it in.
          </p>
        </FileSection>
      )}

      {base.buildQueue.length > 0 && (
        <Section icon="district" title="Being built" count={base.buildQueue.length}>
          <ul className="flex flex-col gap-2.5" data-testid="progress-builds">
            {base.buildQueue.map((entry) => {
              const name = `${BUILDING_CATALOG[entry.kind].name} to ${String(entry.level)}`;
              const left = Math.max(0, queueCompletesAt(entry).getTime() - now.getTime());
              return (
                <Row
                  key={entry.id}
                  testId={`progress-build-${entry.id}`}
                  name={name}
                  status={left === 0 ? 'Finishing' : 'Building'}
                  tone={left === 0 ? 'done' : 'plain'}
                >
                  <Where place="Your district" remaining={formatRemaining(left)} />
                  <ProgressBar progress={queueProgressAt(entry, now)} label={name} />
                  <BuildCancel
                    baseId={base.id}
                    orderId={entry.id}
                    name={name}
                    windowMs={buildCancelWindowMs(entry, base, now)}
                  />
                </Row>
              );
            })}
          </ul>
        </Section>
      )}

      {active !== null && (
        <Section icon="research" title="In the Archive" count={1}>
          <ul className="flex flex-col gap-2.5" data-testid="progress-research">
            {(() => {
              const name = findResearchItem(active.project.techId)?.name ?? 'A programme';
              const left = Math.max(0, researchCompletesAt(active).getTime() - now.getTime());
              return (
                <Row
                  testId={`progress-research-${active.id}`}
                  name={name}
                  status={left === 0 ? 'Finishing' : 'Researching'}
                  tone={left === 0 ? 'done' : 'plain'}
                >
                  <Where place="The Lab" remaining={formatRemaining(left)} />
                  <ProgressBar progress={researchProgressAt(active, now)} label={name} />
                  <ResearchCancel name={name} windowMs={researchCancelWindowMs(active, now)} />
                </Row>
              );
            })()}
          </ul>
        </Section>
      )}

      {base.musterQueue.length > 0 && (
        <Section icon="units" title="On the bench" count={base.musterQueue.length}>
          <ul className="flex flex-col gap-2.5" data-testid="progress-muster">
            {base.musterQueue.map((order) => {
              const what = findUnit(order.unitId)?.name ?? findVehicle(order.unitId)?.name;
              const name = `${String(order.count)} × ${what ?? order.unitId}`;
              const left = musterRemainingMs(order, now);
              return (
                <Row
                  key={order.id}
                  testId={`progress-muster-${order.id}`}
                  name={name}
                  status={
                    order.delivered > 0
                      ? `${String(order.delivered)} of ${String(order.count)} out`
                      : 'Mustering'
                  }
                >
                  <Where
                    // The structure the sheet names, as its card does: nine kinds muster somewhere
                    // other than the Gauntlet, and a Garage order is on the same bench.
                    place={musteredAtName(order.unitId)}
                    remaining={formatRemaining(left)}
                  />
                  <ProgressBar progress={musterProgressAt(order, now)} label={name} />
                  <MusterCancel
                    baseId={base.id}
                    orderId={order.id}
                    name={name}
                    // The bench's own gate, not just the clock: a batch with a unit already out is
                    // not cancellable however young its clock is (`musterCancellable`).
                    windowMs={musterCancellable(order, now) ? musterCancelWindowMs(order, now) : 0}
                  />
                </Row>
              );
            })}
          </ul>
        </Section>
      )}

      {drills.length > 0 && (
        <Section icon="crew" title="On the training floor" count={drills.length}>
          <ul className="flex flex-col gap-2.5" data-testid="progress-drills">
            {drills.map((session) => (
              <Drill
                key={session.id}
                session={session}
                who={subjectName(session.subjectId, training.data?.subjects ?? [], base)}
                now={now}
              />
            ))}
          </ul>
        </Section>
      )}

      {heldDistricts.map((summary) => (
        <DistrictWorks
          key={summary.district.id}
          districtId={summary.district.id}
          districtName={summary.district.name}
          baseId={base.id}
          now={now}
        />
      ))}

      {hurt.length > 0 && (
        <Section icon="crew" title="Laid up" count={hurt.length}>
          <ul className="flex flex-col gap-2.5" data-testid="progress-healing">
            {hurt.map((officer) => {
              const left = Math.max(0, Date.parse(officer.injuredUntil ?? '') - now.getTime());
              return (
                <Row
                  key={officer.officerId}
                  testId={`progress-healing-${officer.officerId}`}
                  name={officer.name}
                  status="Healing"
                >
                  <Where place="The Quarters" remaining={formatRemaining(left)} />
                  <p className="font-body text-[12px] leading-snug text-ink-400">
                    Back on their feet when the clock runs out. Nothing hurries it.
                  </p>
                </Row>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Where an order on the shared bench is being made: the Garage, or the structure the sheet names. */
function musteredAtName(unitId: string): string {
  if (findVehicle(unitId)) return BUILDING_CATALOG.garage.name;
  const unit = findUnit(unitId);
  return unit ? BUILDING_CATALOG[unit.musteredAt].name : BUILDING_CATALOG.gauntlet.name;
}

/** Where it is happening, and how long is left: the same line on every row. */
function Where({ place, remaining }: { place: string; remaining: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-display text-[12px] uppercase tracking-[0.12em] text-ink-200">
      <span>{place}</span>
      <span className="ml-auto font-bold tabular-nums text-brass-300">{remaining}</span>
    </div>
  );
}

/** The X, inside its window, on a rule of its own so it reads as the row's footer. */
function Footer({ children }: { children: ReactNode }) {
  return <div className="border-t border-surface-700/70 pt-2.5">{children}</div>;
}

function BuildCancel({
  baseId,
  orderId,
  name,
  windowMs,
}: {
  baseId: string;
  orderId: string;
  name: string;
  windowMs: number;
}) {
  const cancel = useCancelBuild(baseId);
  // The refusal outlives the window: "too late" lands exactly when the window has just shut.
  if (windowMs <= 0) return <WriteError message={cancel.error?.message} />;
  return (
    <Footer>
      <CancelMark
        windowMs={windowMs}
        label={`Call off ${name}`}
        pending={cancel.isPending}
        onCancel={() => cancel.mutate({ orderId })}
        data-testid={`cancel-build-${orderId}`}
      />
      <WriteError message={cancel.error?.message} />
    </Footer>
  );
}

function ResearchCancel({ name, windowMs }: { name: string; windowMs: number }) {
  const cancel = useCancelResearch();
  if (windowMs <= 0) return <WriteError message={cancel.error?.message} />;
  return (
    <Footer>
      <CancelMark
        windowMs={windowMs}
        label={`Take ${name} off the bench`}
        pending={cancel.isPending}
        onCancel={() => cancel.mutate({})}
        data-testid="cancel-research"
      />
      <WriteError message={cancel.error?.message} />
    </Footer>
  );
}

function MusterCancel({
  baseId,
  orderId,
  name,
  windowMs,
}: {
  baseId: string;
  orderId: string;
  name: string;
  windowMs: number;
}) {
  const cancel = useCancelMuster(baseId);
  if (windowMs <= 0) return <WriteError message={cancel.error?.message} />;
  return (
    <Footer>
      <CancelMark
        windowMs={windowMs}
        label={`Call off ${name}`}
        pending={cancel.isPending}
        onCancel={() => cancel.mutate({ orderId })}
        data-testid={`cancel-muster-${orderId}`}
      />
      <WriteError message={cancel.error?.message} />
    </Footer>
  );
}

/** Whose drill it is: the Overseer, or an officer by name off the training board. */
function subjectName(
  subjectId: string,
  subjects: readonly { id: string; name: string }[],
  base: Base,
): string {
  if (subjectId === OVERSEER_SUBJECT) return 'The Overseer';
  return (
    subjects.find((one) => one.id === subjectId)?.name ??
    base.commanders.find((one) => one.id === subjectId)?.name ??
    'An officer'
  );
}

function Drill({ session, who, now }: { session: TrainingSession; who: string; now: Date }) {
  const cancel = useCancelDrill();
  const name = `${who}: ${ATTRIBUTE_LABELS[session.attribute]}`;
  const left = drillRemainingMs(session, now.getTime());
  const at = now.toISOString();
  const windowMs = drillCancellable(session, at) ? drillCancelWindowMs(session, at) : 0;
  return (
    <Row
      testId={`progress-drill-${session.id}`}
      name={name}
      status={left === 0 ? 'Finishing' : 'Drilling'}
      tone={left === 0 ? 'done' : 'plain'}
    >
      <Where place="The training floor" remaining={formatRemaining(left)} />
      <ProgressBar progress={drillProgressAt(session, now.getTime())} label={name} />
      {windowMs > 0 ? (
        <Footer>
          <CancelMark
            windowMs={windowMs}
            label={`Call off ${name}`}
            pending={cancel.isPending}
            onCancel={() => cancel.mutate({ sessionId: session.id })}
            data-testid={`cancel-drill-${session.id}`}
          />
          <WriteError message={cancel.error?.message} />
        </Footer>
      ) : (
        <WriteError message={cancel.error?.message} />
      )}
    </Row>
  );
}

/**
 * One held district's places being worked up.
 *
 * A child per district rather than one list, because a location's clock lives on the district read
 * (`/city/:id`) and the write that calls it off is keyed by district as well. A
 * district with nothing under way draws nothing: the section is the work, not the holding.
 */
function DistrictWorks({
  districtId,
  districtName,
  baseId,
  now,
}: {
  districtId: string;
  districtName: string;
  baseId: string;
  now: Date;
}) {
  const district = useDistrict(districtId);
  const cancelUpgrade = useCancelLocationUpgrade(baseId, districtId);
  const mine = (district.data?.locations ?? []).filter(
    (view) =>
      view.holder.kind === 'crew' && view.holder.baseId === baseId && view.upgradingUntil !== null,
  );
  if (mine.length === 0) return null;

  return (
    <Section icon="city" title={`Worked in ${districtName}`} count={mine.length}>
      <ul className="flex flex-col gap-2.5" data-testid={`progress-works-${districtId}`}>
        {mine.map((view) => {
          const clock = workClock(view.upgradingSince, view.upgradingUntil, now);
          const name = `${view.location.name} to ${String(view.level + 1)}`;
          // One mutation for the district's rows: its press and its refusal belong to the row
          // pressed, not to every row in the district (bug pass, 2026-10-06).
          const pressed = cancelUpgrade.variables?.locationId === view.location.id;
          const refused = pressed ? cancelUpgrade.error?.message : undefined;
          return (
            <Row
              key={view.location.id}
              testId={`progress-work-${view.location.id}-upgrade`}
              name={name}
              status="Upgrading"
            >
              <Where place={districtName} remaining={formatRemaining(clock.left)} />
              <ProgressBar progress={clock.progress} label={name} />
              {clock.windowMs > 0 ? (
                <Footer>
                  <CancelMark
                    windowMs={clock.windowMs}
                    label={`Call off ${name}`}
                    pending={pressed && cancelUpgrade.isPending}
                    onCancel={() => cancelUpgrade.mutate({ locationId: view.location.id })}
                    data-testid={`cancel-work-${view.location.id}-upgrade`}
                  />
                  <WriteError message={refused} />
                </Footer>
              ) : (
                <WriteError message={refused} />
              )}
            </Row>
          );
        })}
      </ul>
    </Section>
  );
}

/** A location's clock, read off the two marks the view carries: how far, how long, the window. */
function workClock(
  since: string | null,
  until: string | null,
  now: Date,
): { progress: number; left: number; windowMs: number } {
  if (until === null) return { progress: 0, left: 0, windowMs: 0 };
  const end = Date.parse(until);
  const left = Math.max(0, end - now.getTime());
  if (since === null) return { progress: 0, left, windowMs: 0 };
  const start = Date.parse(since);
  const total = end - start;
  return {
    progress: total <= 0 ? 1 : Math.min(1, Math.max(0, (now.getTime() - start) / total)),
    left,
    windowMs: cancelWindowMs(start, total, now.getTime()),
  };
}

function WriteError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <PressError>{message}</PressError>;
}

/** The one type this page reads off a district and nothing else needs. */
export type { LocationView };
