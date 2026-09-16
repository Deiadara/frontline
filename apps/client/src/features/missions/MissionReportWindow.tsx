import {
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  findBlueprintPage,
  findMissionTemplate,
  formatDuration,
  heldItems,
  missionCarry,
  missionTimings,
  weightOf,
  type ItemId,
  type Mission,
  type MissionLeader,
  type PartialResources,
  type ResourceKey,
  type UnitLoadouts,
} from '@frontline/shared';
import { ResourceIcon } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { lotSpec } from '../market/VendorAuctionWindow';
import { FileSection } from '../overseer/FileSection';
import { areaName, cameHome, describeArmy, ledBy } from './missionLines';

const TITLE_ID = 'mission-report-title';

/**
 * What happened on a run that has come home (maintainer, 2026-09-12).
 *
 * The returned list used to print all of this on the row itself, four lines deep per crew, and six
 * crews of it filled the left column with a wall of small capitals that nobody read. The row is now
 * the three things a player scans for: which job, what it paid, and whether it worked. Everything
 * else is here, one press away, laid out as a document rather than as a stack of captions.
 *
 * The order is fixed, because a report a player has read once should be readable without hunting:
 * **outcome and ground** at the top, then the **facts** that are one number each, then **the crew**,
 * then **the haul**, then **what they turned up**. The last section is the only one that can be
 * absent, and only because a run that found nothing has nothing to put in it.
 *
 * A run nobody came back from never opens this. There is no report to draw: see `ReturnedRow`.
 */
export function MissionReportWindow({
  mission,
  leaders,
  overseerName,
  onClose,
  loadouts = {},
}: {
  mission: Mission;
  leaders: readonly MissionLeader[];
  overseerName: string;
  onClose: () => void;
  /** The crew's brackets, for the bag the crew could lift. Defaults to none for old rows. */
  loadouts?: UnitLoadouts;
}) {
  const template = findMissionTemplate(mission.templateId);
  const failed = mission.outcome === 'failure';

  return (
    <Modal
      onClose={onClose}
      labelledBy={TITLE_ID}
      size="wide"
      data-testid={`mission-report-${mission.id}`}
      className={failed ? 'border-oxblood-500/30' : 'border-brass-500/30'}
    >
      <div className="flex shrink-0 flex-col gap-1 border-b border-surface-700 px-5 py-4">
        <p
          className={cn(
            'font-display text-[11px] uppercase tracking-[0.22em]',
            failed ? 'text-oxblood-300' : 'text-bile-300',
          )}
          data-testid={`mission-outcome-${mission.id}`}
        >
          {failed ? 'Lost' : 'Success'} · {areaName(mission.areaId)}
        </p>
        <h2 id={TITLE_ID} className="font-display text-lg font-bold tracking-[0.08em] text-ink-100">
          {template?.name ?? mission.templateId}
        </h2>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5">
        <dl className="grid gap-2.5 sm:grid-cols-3">
          {/* Named the same way the in-flight row names it, off the same helper: who led a run is
              the same fact before and after they are home. */}
          <Field
            label="Led by"
            value={ledBy(mission, leaders, overseerName)}
            data-testid={`mission-leader-${mission.id}`}
          />
          <Field label="Experience" value={`${mission.xp.toLocaleString()} XP`} />
          <Field label="Round trip" value={formatDuration(missionTimings(mission).totalMinutes)} />
        </dl>

        <FileSection icon="crew" title="The crew" note="Who went out, and who walked back in">
          <dl className="flex flex-col gap-1.5">
            <Line label="Sent" value={describeArmy(mission.force) || 'nobody'} />
            <Losses mission={mission} />
          </dl>
        </FileSection>

        <Haul mission={mission} loadouts={loadouts} />
        <Drops mission={mission} />
      </div>

      <div className="flex shrink-0 justify-end border-t border-surface-700 px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

/** One labelled fact, in the plated frame the crew files use. */
function Field({
  label,
  value,
  'data-testid': testId,
}: {
  label: string;
  value: string;
  'data-testid'?: string;
}) {
  return (
    <div className="ink-frame card-paper washed flex min-w-0 flex-col gap-0.5 px-3 py-2">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">{label}</dt>
      <dd
        className="break-words font-display text-[14px] font-bold text-ink-100"
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

/** A label and its answer on one line, for the sections that read as a list rather than a grid. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">{label}</dt>
      <dd className="min-w-0 break-words font-display text-[12px] uppercase tracking-[0.1em] text-ink-200">
        {value}
      </dd>
    </div>
  );
}

/**
 * §E5: what a job cost in units.
 *
 * Drawn for every reported run, including the ones nobody died on, because "everybody came home" is
 * the answer a player opens a report looking for after a raid. It used to be gated on the run
 * having been a fight, which is fine on a row that is trying to stay short and wrong in a document
 * that is meant to say what happened.
 */
function Losses({ mission }: { mission: Mission }) {
  const lost = describeArmy(mission.lost);
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
        Came back
      </dt>
      <dd
        className="min-w-0 break-words font-display text-[12px] uppercase tracking-[0.1em] text-ink-200"
        data-testid={`mission-losses-${mission.id}`}
      >
        {lost === '' ? (
          'Everybody came home'
        ) : (
          <>
            Home: {describeArmy(cameHome(mission)) || 'nobody'}
            <span className="text-oxblood-300"> · Lost: {lost}</span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * What came home, against what the job actually paid.
 *
 * A crew carries what its units can lift (`missionCarry`), so an under-crewed run leaves part of
 * its pay on the ground. The stockpile only ever shows the part that arrived, so without this
 * comparison a player has no way to learn they are under-crewing: it is the whole feedback loop
 * for the carry mechanic.
 *
 * An older row recorded only what was banked. "268 of 268" there would be a claim the data cannot
 * support, so with no `spoils` the section says what came home and says outright that the total is
 * not known.
 */
function Haul({ mission, loadouts }: { mission: Mission; loadouts: UnitLoadouts }) {
  const knownSpoils = Object.keys(mission.spoils).length > 0;
  const earned: PartialResources = knownSpoils ? mission.spoils : mission.rewards;
  const kinds = RESOURCE_ORDER.filter(
    (kind) => (earned[kind] ?? 0) > 0 || (mission.rewards[kind] ?? 0) > 0,
  );
  const carriedKg = Math.round(weightOf(mission.rewards));
  const earnedKg = Math.round(weightOf(earned));
  const short = knownSpoils && carriedKg < earnedKg;

  return (
    <FileSection icon="loot" title="The haul" note="What the job paid, and what fitted on the crew">
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
          <p
            className="font-body text-[12px] leading-snug text-ink-400"
            data-testid={`mission-carry-${mission.id}`}
          >
            {!knownSpoils ? (
              <>
                This run settled before the game wrote down what the job paid, so the total is not
                known. What is above is what they banked.
              </>
            ) : short ? (
              <span className="text-brass-300">
                The crew could not carry everything. They lifted{' '}
                <span className="tabular-nums">{carriedKg.toLocaleString()}</span> loot of the{' '}
                <span className="tabular-nums">{earnedKg.toLocaleString()}</span> loot the job paid,
                and left the rest where it lay. Send more carriers.
              </span>
            ) : (
              <>
                They carried all{' '}
                <span className="tabular-nums text-ink-200">{earnedKg.toLocaleString()}</span> loot
                of it home, out of the{' '}
                <span className="tabular-nums text-ink-200">
                  {missionCarry(mission.force, loadouts).toLocaleString()}
                </span>{' '}
                loot they could lift between them.
              </>
            )}
          </p>
        </>
      )}
    </FileSection>
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
      className="flex min-w-0 items-center gap-2.5 rounded-sm border border-surface-600/80 bg-surface-900/40 px-3 py-2"
      data-testid={`haul-${kind}`}
    >
      <ResourceIcon kind={kind} className="h-5 w-5" />
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

/**
 * §F1f: the sheets and the salvage, by name.
 *
 * The card that offered the run said only "a unit blueprint's page"; this is where the player finds
 * out which sheet they actually came home with, which is the half of the mechanic that pays off the
 * anticipation. Everything else the run turned up is beside it, because a player who has to count
 * the inventory to work out what a job produced has not been told what the job produced.
 */
function Drops({ mission }: { mission: Mission }) {
  const page = mission.pageWon;
  const found = heldItems(mission.found);
  /*
   * The settler folds the won page into `found` (`missions/resolve.ts`), so listing the two
   * separately would name the same sheet twice. A row settled before `found` existed carries only
   * `pageWon`, and that page still has to be drawn: the cast is the gap between `pageWon`'s plain
   * id and the inventory's `ItemId` keys, which every page id is one of.
   */
  const pageId = page as ItemId | null;
  const drops: [ItemId, number][] =
    pageId !== null && mission.found[pageId] === undefined ? [...found, [pageId, 1]] : found;

  if (drops.length === 0) return null;

  return (
    <FileSection
      icon="inventory"
      title="What they turned up"
      note="Into the inventory, not the yard"
    >
      <ul className="grid gap-2 sm:grid-cols-2" data-testid={`mission-drops-${mission.id}`}>
        {drops.map(([id, count]) => (
          <li
            key={id}
            className={cn(
              'flex min-w-0 items-center gap-2.5 rounded-sm border px-3 py-2',
              id === pageId
                ? 'border-brass-500/50 bg-brass-300/10'
                : 'border-surface-600/80 bg-surface-900/40',
            )}
            {...(id === pageId ? { 'data-testid': `mission-page-${mission.id}` } : {})}
          >
            {/* Only for an id this build knows. `ItemGlyph` reads the catalogue without a guard,
                so an id it has never heard of takes the window down on `undefined.kind`, and the
                point of naming a drop at all is that an unknown one still reads as itself. */}
            {lotSpec(id) !== undefined && (
              <span className="icon-tile flex h-8 w-8 shrink-0 items-center justify-center rounded-sm [&_svg]:h-5 [&_svg]:w-5">
                <ItemGlyph id={id} />
              </span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="break-words font-display text-[12px] uppercase tracking-[0.1em] text-ink-100">
                {dropName(id)}
              </span>
              {count > 1 && (
                <span className="font-display text-[10px] uppercase tracking-[0.16em] tabular-nums text-brass-300">
                  {count.toLocaleString()} of them
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </FileSection>
  );
}

/**
 * What to call something a crew came home with.
 *
 * Pages first, by their own name: the item catalogue prefixes a page with the document it belongs
 * to (`Rotor Hub: Frame`), and the maintainer asked for the sheet's name the way `findBlueprintPage`
 * gives it. `lotSpec` is the Runner's guarded catalogue lookup, guarded for exactly this reason:
 * an id off the wire that this build's catalogue has never heard of must read as itself rather
 * than take the window down.
 */
function dropName(id: string): string {
  return findBlueprintPage(id)?.name ?? lotSpec(id)?.name ?? id;
}
