import {
  COMBAT_CONTEXT_LABELS,
  FORTIFY_DIFFICULTY_LABELS,
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  UNIT_MODIFIERS,
  armySize,
  battlefieldFor,
  findUnit,
  cancelWindowMs,
  cellCanHold,
  findDistrict,
  fortifyBonusPercent,
  fortifyCost,
  maxFortifyBonusPercent,
  quoteFortify,
  weatherAt,
  type Army,
  type CombatContext,
  type LocationHolderKind,
  type LocationView,
  type Resources,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { CancelMark } from '../../components/ui/CancelMark';
import { FortifyMeter } from '../../components/ui/FortifyMeter';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Characteristics } from '../../components/ui/LabelChip';
import { cn } from '../../lib/cn';
import {
  useCancelLocationFortify,
  useCancelLocationUpgrade,
  useFortify,
  useMe,
  usePlantSleepers,
  useSetGarrison,
  useUpgradeLocation,
} from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { HOLDER_PLATE } from './holder';
import { whenItHolds } from './characteristics';
import { ForcePicker } from './ForcePicker';
import { SpyDialog, type SpyingProps } from './SpyPanel';

/**
 * One location, on one sheet, laid out the same way for every location in the city (board
 * request, 2026-09-11).
 *
 * The card this replaces grew a row at a time as the mechanics arrived, so a player opening the
 * Tideline Market and then the Bone Market was reading two different documents: the same facts in
 * a different order, some of them missing, and who held the place squeezed into a tag in the
 * corner. A location is one kind of thing and its sheet is one template. Every section below is
 * drawn for every location, in this order, and a section with nothing in it says so rather than
 * disappearing, so the eye always finds the same fact in the same place.
 *
 * ## The head
 *
 * A nameplate: where you are, what kind of place this is, what it is called, and how far it has
 * been worked up. It used to be the district painting blown up three times and cropped around the
 * sign, which cost roughly 250px at the top of every sheet and pushed "Taking it" off the bottom
 * of the window (maintainer request, 2026-09-15). The painting is already on the screen behind the
 * window, with the sign the player just clicked lit on it, so the close-up was showing them a
 * second, blurrier copy of a picture they were looking at.
 *
 * ## Who holds it
 *
 * The one fact the old card buried, and the first thing under the nameplate now. Four holders, four
 * readings: your own ground says so and offers your file; another crew's names the crew and the
 * player behind it, and the player's name is the door to theirs; the looters are called looters,
 * because that is what a place nobody's crew has taken is held by; the Combine is the Combine.
 */

export interface LocationSheetProps {
  /** Anchor for the painting's signs to scroll to. */
  id: string;
  /** Just arrived here from a sign, so say so for a beat. */
  picked: boolean;
  view: LocationView;
  mine: boolean;
  districtId: string;
  baseId: string | undefined;
  army: Army;
  resources: Resources;
  /** The district is held end to end, so nothing in it can be called until the gate is down. */
  shut: boolean;
  /** The server's clock, corrected and ticking, for the sheet's countdowns. */
  now: Date;
  onCall: () => void;
  /** The crew's spy job, quote and blocker, off the district read (2026-09-22). */
  spying: SpyingProps;
}

/**
 * How long is left to call a running upgrade or dig off (maintainer request, 2026-09-12): the first
 * tenth of its own clock, read off the two marks the view carries. Zero with nothing under way.
 */
function workWindowMs(since: string | null, until: string | null, now: Date): number {
  if (since === null || until === null) return 0;
  const startedAt = Date.parse(since);
  return cancelWindowMs(startedAt, Date.parse(until) - startedAt, now.getTime());
}

/** One id scheme, used by the sign that scrolls and the sheet that is scrolled to. */
export function cardId(locationId: string): string {
  return `location-card-${locationId}`;
}

/** The heading inside that sheet, so a dialog holding one can point `aria-labelledby` at it. */
export function cardHeadingId(locationId: string): string {
  return `${cardId(locationId)}-name`;
}

/** The way to a crew's file, by base id. One string, because three screens link there. */
export function crewFileHref(baseId: string): string {
  return `/game/crews/${encodeURIComponent(baseId)}`;
}

export function LocationSheet({
  id,
  picked,
  view,
  mine,
  districtId,
  baseId,
  army,
  resources,
  shut,
  now,
  onCall,
  spying,
}: LocationSheetProps) {
  const spec = LOCATION_CATALOG[view.location.kind];
  const fortify = useFortify(baseId, districtId);
  const garrison = useSetGarrison(baseId, districtId);
  const upgrade = useUpgradeLocation(baseId, districtId);
  const cancelUpgrade = useCancelLocationUpgrade(baseId, districtId);
  const cancelFortify = useCancelLocationFortify(baseId, districtId);
  // For the bag the picker quotes: the raid pays against the crew's brackets, so the quote reads
  // the same map (`battle/resolve.ts`).
  const me = useMe();
  const [staging, setStaging] = useState(false);
  const [planting, setPlanting] = useState(false);
  const [spyingOpen, setSpyingOpen] = useState(false);
  const plant = usePlantSleepers(baseId, districtId);
  /*
   * How many sheets this crew has that can be planted at all (`UnitSpec.sleeper`).
   *
   * Counted off the roster rather than hardcoded to the Sleepers, so a second infiltrating sheet
   * added tomorrow opens this door without an edit here.
   */
  const sleepersHeld = Object.entries(army).reduce(
    (total, [unitId, count]) => (cellCanHold(findUnit(unitId)) ? total + count : total),
    0,
  );

  const quote = quoteFortify(view.location, view.fortification);
  const digging = view.fortifyingUntil !== null;
  const upgrading = view.upgradingUntil !== null;
  const district = findDistrict(districtId);

  return (
    <section
      id={id}
      data-testid={`location-${view.location.id}`}
      // `scroll-mt` clears the standing bar, which is fixed: without it the browser scrolls the
      // sheet to the top of the *document* and the bar covers the header the sign was pointing at.
      className={cn(
        'flex scroll-mt-24 flex-col gap-3 rounded-sm border p-3 transition-colors duration-300',
        mine ? 'border-brass-500/60 bg-brass-300/5' : 'border-surface-700 bg-surface-900',
        picked && 'ring-1 ring-inset ring-brass-300',
      )}
    >
      <header
        className="flex items-end gap-3 rounded-sm border border-surface-600/70 bg-surface-950/60 px-3 py-2.5"
        data-testid={`head-${view.location.id}`}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-brass-300">
            {district === undefined ? spec.label : `${district.name} · ${spec.label}`}
          </p>
          <h3
            id={cardHeadingId(view.location.id)}
            className="font-stamp text-[19px] leading-tight text-ink-100"
          >
            {view.location.name}
          </h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* The level, as pips rather than a number: a player scanning a district is asking
              "which of these has somebody poured work into", and four filled squares answer that
              without being read. It is also what they are taking if they win: a capture puts it
              back to one. */}
          <span
            className="flex items-center gap-0.5"
            data-testid={`level-${view.location.id}`}
            data-level={view.level}
            data-tip={`Level ${view.level} of ${MAX_LOCATION_LEVEL}`}
            aria-label={`Level ${view.level} of ${MAX_LOCATION_LEVEL}`}
          >
            {Array.from({ length: MAX_LOCATION_LEVEL }, (_, index) => (
              <span
                key={index}
                aria-hidden
                className={cn(
                  'block h-2 w-2 rounded-[1px] border',
                  index < view.level
                    ? 'border-brass-300/70 bg-brass-300'
                    : 'border-surface-500 bg-surface-950/80',
                )}
              />
            ))}
          </span>
          <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-200">
            Level {view.level}
          </span>
        </div>
      </header>

      <HolderPlate view={view} mine={mine} />

      <Sheet label="What it is">
        {/* This place's own line where it has one, else its kind's: two rail yards used to read
            the same sentence. */}
        <p className="font-body text-[12px] leading-relaxed text-ink-200">
          {view.location.blurb ?? spec.blurb}
        </p>
      </Sheet>

      <Sheet label="What holding it pays" icon="loot">
        <ul className="flex flex-wrap gap-1.5" data-testid={`pays-${view.location.id}`}>
          {view.bonuses.map((bonus) => (
            <li
              key={bonus}
              className="rounded-sm border border-brass-500/40 bg-brass-300/10 px-2 py-0.5 font-display text-[11px] tabular-nums tracking-[0.06em] text-brass-100"
            >
              {bonus}
            </li>
          ))}
        </ul>
        <p className="font-body text-[12px] leading-relaxed text-verdigris-100">{view.reward}</p>
        <p className="font-body text-[12px] leading-relaxed text-ink-300">
          {view.unlocks.length > 0 ? (
            <>
              Holding it opens up: <span className="text-ink-200">{view.unlocks.join(', ')}</span>
            </>
          ) : (
            'It opens up nothing of its own. What it pays is the whole of it.'
          )}
        </p>
      </Sheet>

      {/* §A4: the location's own character folded with today's sky, titled, because this is the
          section that decides *what to bring*. A player who reads nothing else on the sheet should
          still see that a tunnel is Crammed IV and Dark II. Each chip carries its tier as a numeral
          and its own hover; the ones the sky put there say so, so nobody plans tomorrow around
          rain that will have stopped. */}
      <Sheet label="On the ground" icon="eye">
        <Characteristics
          labels={view.labels}
          when={whenItHolds(view.location.kind, weatherAt(now))}
          data-testid={`characteristics-${view.location.id}`}
        />
        <FightsAs view={view} now={now} />
        <dl className="mt-1 grid grid-cols-3 gap-2">
          <Figure label={mine ? 'Defence' : 'Ground defence'} value={String(view.defense)} />
          {/* Nothing about their count is free (maintainer, 2026-09-22): the figure is the
              crew's own, or what its last spy report said, or a blank. */}
          <Figure
            label="Standing there"
            value={
              view.garrisonSize !== null
                ? String(view.garrisonSize)
                : view.latestSpyReport && !view.latestSpyReport.failed
                  ? `${armySize(view.latestSpyReport.exposed)} seen`
                  : 'Unknown'
            }
          />
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
              Dug in
            </dt>
            {/* Drawn rather than counted: see `FortifyMeter`. The ground's difficulty stays in
                words beside it, because it is what decides whether digging here is worth the
                materials. */}
            <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <FortifyMeter
                level={view.fortification}
                percent={fortifyBonusPercent(view.location.fortifyDifficulty, view.fortification)}
                size="sm"
              />
              <span className="font-body text-[11px] text-ink-300">
                {FORTIFY_DIFFICULTY_LABELS[view.location.fortifyDifficulty]}
              </span>
            </dd>
          </div>
        </dl>
      </Sheet>

      {spyingOpen && (
        <SpyDialog
          target={{ kind: 'location', locationId: view.location.id }}
          title={`Spy on ${view.location.name}`}
          eyebrow={district?.name ?? spec.label}
          blurb="Your runners go and look. What comes back is what they could uncover of whoever is standing there, and never a soul that is not."
          placeName={view.location.name}
          districtId={districtId}
          baseId={baseId}
          caps={resources.caps}
          spying={spying}
          latest={view.latestSpyReport}
          now={now}
          testId={`spy-${view.location.id}`}
          onClose={() => setSpyingOpen(false)}
        />
      )}

      {mine ? (
        <Sheet label="Your options" icon="build" tone="mine">
          {/*
           * Working it up (§A4): the board-game half of holding ground, and the first thing
           * offered because it is the decision the sheet exists for. Fortifying makes a location
           * *harder to take*; a level makes it *worth more*. What happens to each on capture is
           * not the same, and the sheet used to say here that both were lost: a fortification is
           * lost, and a banked level changes hands with the ground (§A4, `battle/resolve.ts`).
           * What a capture does destroy is an upgrade still running, paid for and not yet banked.
           *
           * The authored sentence is shown, not the percentage: "you get the underground tanks
           * pumping again" is a thing that happens to a petrol station you own, and "+50% oil" is
           * a number going up.
           */}
          {upgrading ? (
            <div className="flex flex-wrap items-center gap-3">
              <p
                className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300"
                data-testid={`upgrading-${view.location.id}`}
              >
                Work under way,{' '}
                {formatRemaining(Date.parse(view.upgradingUntil ?? '') - now.getTime())} left
              </p>
              <CancelMark
                windowMs={workWindowMs(view.upgradingSince, view.upgradingUntil, now)}
                label={`Call off the work on ${view.location.name}`}
                pending={cancelUpgrade.isPending}
                onCancel={() => cancelUpgrade.mutate({ locationId: view.location.id })}
                data-testid={`cancel-upgrade-${view.location.id}`}
              />
              {cancelUpgrade.error && (
                <p role="alert" className="w-full font-body text-[12px] text-oxblood-300">
                  {cancelUpgrade.error.message}
                </p>
              )}
            </div>
          ) : view.upgrade === null ? (
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
              Worked up as far as it goes
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-sm border border-brass-500/30 bg-brass-300/5 p-2.5">
              <span className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
                Level {view.upgrade.toLevel} · {formatDuration(view.upgrade.seconds)}
              </span>
              <p className="font-body text-[12px] leading-relaxed text-ink-200">
                {view.upgrade.note}
              </p>
              <CostLine cost={view.upgrade.cost} stock={resources} />
              <div>
                <Button
                  size="sm"
                  disabled={upgrade.isPending}
                  data-testid={`upgrade-${view.location.id}`}
                  onClick={() => upgrade.mutate({ locationId: view.location.id })}
                >
                  {upgrade.isPending ? 'Working…' : 'Work it up'}
                </Button>
              </div>
            </div>
          )}
          {digging ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ember-300">
                Digging in,{' '}
                {formatRemaining(Date.parse(view.fortifyingUntil ?? '') - now.getTime())} left
              </p>
              <CancelMark
                windowMs={workWindowMs(view.fortifyingSince, view.fortifyingUntil, now)}
                label={`Call off digging in at ${view.location.name}`}
                pending={cancelFortify.isPending}
                onCancel={() => cancelFortify.mutate({ locationId: view.location.id })}
                data-testid={`cancel-fortify-${view.location.id}`}
              />
              {cancelFortify.error && (
                <p role="alert" className="w-full font-body text-[12px] text-oxblood-300">
                  {cancelFortify.error.message}
                </p>
              )}
            </div>
          ) : quote === null ? (
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
              As dug in as this ground allows (
              {maxFortifyBonusPercent(view.location.fortifyDifficulty)}
              %)
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
                Fortify to level {quote.level} · +{quote.bonusPercent}% ·{' '}
                {formatDuration(quote.seconds)}
              </span>
              <CostLine cost={fortifyCost(quote.level)} stock={resources} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!digging && quote !== null && (
              <Button
                size="sm"
                disabled={fortify.isPending}
                onClick={() => fortify.mutate({ locationId: view.location.id })}
              >
                {fortify.isPending ? 'Working…' : 'Dig in'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setStaging(true)}>
              Garrison
            </Button>
          </div>
        </Sheet>
      ) : (
        <Sheet label="Taking it" icon="battles" tone="hostile">
          <p className="font-body text-[12px] leading-relaxed text-ink-300">
            {shut
              ? 'The gate is armed. Nothing in here can be called until it is down.'
              : 'Call a fight on it and turn up. What you have to beat is the defence above and whoever is standing on it: spy on it to find out who.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {/* One button, because there is one way to take ground now: call it, and turn up.
                "Take it" used to resolve a fight on the spot beside this, which meant nobody ever
                pressed this one. */}
            <Button
              size="sm"
              variant="danger"
              disabled={shut}
              onClick={onCall}
              data-testid={`call-${view.location.id}`}
            >
              {shut ? 'Behind the gate' : 'Call a fight'}
            </Button>
            {/*
             * §A4: the other way onto somebody else's ground (maintainer, 2026-09-18).
             *
             * Beside Call a fight and not instead of it, because it is the *other half* of the
             * same decision: plant them now and the fight you call next week is already half
             * won. Shown only to a crew that actually has Sleepers, since a control that
             * refuses everybody who presses it is a control nobody should be offered.
             *
             * Not disabled behind the gate. A cell is not a fight: it goes to ground whether or
             * not the district's front door is shut, which is most of why anybody plants one.
             */}
            {sleepersHeld > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPlanting(true)}
                data-testid={`send-sleepers-${view.location.id}`}
              >
                Send Sleepers
              </Button>
            )}
            {/* Spying (2026-09-22): the third thing to do about somebody else's ground, and the
                one that tells you what the other two are up against. A window rather than a
                sheet, so this card still fits at 1024x768.
                
                Not offered behind a shut gate, where the district screen reads the door instead,
                and not on ground nobody holds: there is nothing to count, the sheet says so
                already, and the route refuses it (`nothing_there`). */}
            {!shut && view.holder.kind !== 'unoccupied' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSpyingOpen(true)}
                data-testid={`spy-open-${view.location.id}`}
              >
                Spy on it
              </Button>
            )}
          </div>
        </Sheet>
      )}

      {planting && (
        <ForcePicker
          title={`Send Sleepers into ${view.location.name}`}
          blurb="They walk there, go to ground, and wait. Nothing finds them: no scout counts them and no digging turns them up. Call a fight on this place and they are already standing in it."
          army={Object.fromEntries(
            Object.entries(army).filter(([unitId]) => cellCanHold(findUnit(unitId))),
          )}
          loadouts={me.data?.base?.unitLoadouts ?? {}}
          pending={plant.isPending}
          error={plant.error}
          confirmLabel="Send them in"
          onClose={() => setPlanting(false)}
          onConfirm={(sending) =>
            plant.mutate(
              { locationId: view.location.id, army: sending },
              { onSuccess: () => setPlanting(false) },
            )
          }
        />
      )}

      {staging && (
        <ForcePicker
          title={`Garrison ${view.location.name}`}
          blurb="Units left here hold the location. If it falls, half of them run and half do not. A number below zero brings that many home."
          army={army}
          standing={view.garrison ?? {}}
          loadouts={me.data?.base?.unitLoadouts ?? {}}
          pending={garrison.isPending}
          error={garrison.error}
          confirmLabel="Leave them"
          onClose={() => setStaging(false)}
          onConfirm={(changes) =>
            garrison.mutate(
              { locationId: view.location.id, changes },
              { onSuccess: () => setStaging(false) },
            )
          }
        />
      )}
    </section>
  );
}

/** What a holder is called, what it reads as, and what to say about it under the name. */
const HOLDER_READING: Record<
  LocationHolderKind,
  { tone: 'mine' | 'crew' | 'looters' | 'government' | 'unoccupied'; icon: IconName; note: string }
> = {
  crew: { tone: 'crew', icon: 'crew', note: 'Another crew. Their name is the door to their file.' },
  looters: {
    tone: 'looters',
    icon: 'sword',
    note: "Nobody's crew. Whoever was here when the city fell, and stayed.",
  },
  government: {
    tone: 'government',
    icon: 'shield',
    note: 'The state keeps this. Expect the garrison the district says it has.',
  },
  unoccupied: { tone: 'unoccupied', icon: 'eye', note: 'Empty ground. Walk in and it is yours.' },
};

/*
 * The plate's colours moved to `city/holder.ts` on 2026-09-20, so the sign on the district
 * painting and this plate are coloured from one table. They were two literals, which is how the
 * Combine and a rival crew came to wear the same red on one screen and a different pair on the
 * other.
 */
const HOLDER_TONE = HOLDER_PLATE;

/**
 * Who holds it, said first and said large.
 *
 * Four holders and one of them might be you, so five readings of one plate. Your own ground is
 * framed in the colour every other "yours" in the game uses; a rival crew's is framed in the
 * colour of a fight; the looters and the Combine each get their own note. A crew's name and the
 * player's are both here because they are different facts: the map prints the crew, and the
 * person is who you are about to call a fight on.
 */
function HolderPlate({ view, mine }: { view: LocationView; mine: boolean }) {
  const reading = HOLDER_READING[view.holder.kind];
  const tone = HOLDER_TONE[mine ? 'mine' : reading.tone];
  const href = view.holder.kind === 'crew' ? crewFileHref(view.holder.baseId) : null;

  return (
    <div
      className={cn('flex items-center gap-3 rounded-sm border px-3 py-2', tone.frame)}
      data-testid={`holder-${view.location.id}`}
      data-holder={mine ? 'you' : view.holder.kind}
    >
      <span
        aria-hidden
        className={cn(
          'icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm [&_svg]:h-5 [&_svg]:w-5',
          tone.plate,
        )}
      >
        <Icon name={mine ? 'check' : reading.icon} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('font-display text-[10px] uppercase tracking-[0.2em]', tone.plate)}>
          Held by
        </span>
        {href !== null ? (
          // The name is the door. A `Link`, so it opens in the same session and a middle-click
          // does what a middle-click does; the whole plate is not the control, because a plate that
          // navigates when you click anywhere on it is a plate you cannot read without leaving.
          <Link
            to={href}
            data-testid={`holder-link-${view.location.id}`}
            className={cn(
              'flex min-w-0 flex-wrap items-baseline gap-x-2 font-stamp text-[17px] leading-tight underline-offset-2 hover:underline',
              tone.name,
            )}
          >
            <span className="truncate">{mine ? 'You' : view.holderName}</span>
            <span className="font-body text-[12px] not-italic text-ink-300">
              {mine
                ? view.holderName
                : view.holderPlayer !== null
                  ? view.holderPlayer
                  : 'a crew nobody knows'}
            </span>
          </Link>
        ) : (
          <span className={cn('font-stamp text-[17px] leading-tight', tone.name)}>
            {view.holderName}
          </span>
        )}
        <span className="font-body text-[11px] leading-snug text-ink-300">
          {mine ? 'Your ground. Work it up, dig in, or leave people on it.' : reading.note}
        </span>
      </div>
      {mine && (
        <span className="shrink-0 rounded-sm border border-verdigris-300/60 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em] text-verdigris-100">
          Yours
        </span>
      )}
      {href !== null && !mine && (
        <span aria-hidden className="shrink-0 text-ink-400 [&_svg]:h-4 [&_svg]:w-4">
          <Icon name="info" />
        </span>
      )}
    </div>
  );
}

/** A section of the sheet: a label, a rule, and what is under it. The same box for every fact. */
function Sheet({
  label,
  icon,
  tone = 'plain',
  children,
}: {
  label: string;
  icon?: IconName;
  tone?: 'plain' | 'mine' | 'hostile';
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-sm border px-3 py-2.5',
        tone === 'mine'
          ? 'border-brass-500/40 bg-surface-950/40'
          : tone === 'hostile'
            ? 'border-oxblood-500/40 bg-surface-950/40'
            : 'border-surface-700 bg-surface-950/40',
      )}
    >
      <header className="flex items-center gap-2">
        {icon !== undefined && (
          <span
            aria-hidden
            className={cn(
              'shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5',
              tone === 'hostile' ? 'text-oxblood-300' : 'text-brass-300',
            )}
          >
            <Icon name={icon} />
          </span>
        )}
        <span
          data-testid="sheet-label"
          className={cn(
            'font-display text-[10px] font-bold uppercase tracking-[0.2em]',
            tone === 'hostile' ? 'text-oxblood-300' : 'text-brass-300',
          )}
        >
          {label}
        </span>
        <span aria-hidden className="ink-rule block min-w-0 flex-1" />
      </header>
      {children}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="font-display text-[15px] font-bold tabular-nums text-ink-100">{value}</dd>
    </div>
  );
}

/**
 * What the ground counts as in a fight (maintainer, 2026-09-18).
 *
 * A `CombatContext` is, in `battlefield.ts`'s own words, "a promise to the player that a modifier
 * on a unit sheet will fire", and until now the promise was kept nowhere a player could read it.
 * A market is Urban, a foundry is Indoor and Urban, a sewer junction is Underground, and the only
 * way to find out was to send somebody and read the report afterwards. The Characteristics row
 * above says what the place is *like*; this one says what it *counts as*, which is the half that
 * decides who to bring.
 *
 * Read out of `battlefieldFor` rather than off `LOCATION_CONTEXTS` directly, so the chips are the
 * list the fight will actually use: digging in adds Fortified, and a dark sky adds Unlit. A row
 * derived from the catalogue alone would tell a player their Tunnel Rats were no use on ground
 * the settler was about to call Underground.
 */
function FightsAs({ view, now }: { view: LocationView; now: Date }) {
  const ground = battlefieldFor({
    locationName: view.location.name,
    kind: view.location.kind,
    fortifyDifficulty: view.location.fortifyDifficulty,
    fortifyLevel: view.fortification,
    at: now,
  });

  return (
    /*
     * Label and chips on **one** line, where Characteristics above stacks them.
     *
     * Not a style preference: stacked, this row costs about thirty pixels, and the location
     * window at 1024x768 had eight of them going spare. `profile.spec.ts` caught it, with "Work
     * it up" at the foot of the window showing 24 of its 32 pixels. Inline, the row costs the
     * height of the chips alone and the button is whole again.
     */
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid={`fights-as-${view.location.id}`}
    >
      <span className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
        Fights as
      </span>
      <ul className="flex flex-wrap items-center gap-1">
        {ground.contexts.map((context) => (
          <li
            key={context}
            className="rounded-sm border border-brass-500/40 bg-brass-300/10 px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.08em] text-brass-100"
            data-tip={tipFor(context)}
          >
            {COMBAT_CONTEXT_LABELS[context].name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What a context is worth here, named by the sheets it turns on.
 *
 * Derived from `UNIT_MODIFIERS` rather than written per context, so a modifier added to the table
 * tomorrow appears on the ground that grants it with no edit here. A context no modifier reads is
 * still worth a chip: it says the ground is that, which is the fact, and the sentence says the
 * roster has nothing for it rather than leaving a player to guess.
 */
function tipFor(context: CombatContext): string {
  const fires = Object.values(UNIT_MODIFIERS)
    .filter((modifier) => modifier.context === context)
    .map((modifier) => modifier.label);
  const when = COMBAT_CONTEXT_LABELS[context].when;
  return fires.length === 0
    ? `This ground counts ${when}. No unit modifier reads it yet.`
    : `This ground counts ${when}, so ${fires.join(' and ')} fire here.`;
}
