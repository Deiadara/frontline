import {
  describeAddonEffect,
  BUILDING_CATALOG,
  BUILDING_MAX_LEVEL,
  CENTRAL_BUILDING,
  MAX_BUILD_QUEUE,
  MAX_MODIFICATION_SLOTS,
  buildingBuildSeconds,
  buildingCost,
  buildingLevel,
  payrollBonusPercent,
  payrollLedger,
  canAfford,
  findBuilding,
  isUnlockedForQueue,
  unmetForQueue,
  describeBuildingRequirement,
  modificationCapacity,
  MODIFICATION_SET_SIZE,
  MODIFICATION_SLOT_LEVELS,
  SET_BONUSES,
  describeSetBonus,
  nextModificationSlotLevel,
  nextQueuedLevel,
  projectedBuildings,
  queueCancelWindowMs,
  queueRemainingMs,
  structureLevelCap,
  buildingNeedsParts,
  buildingParts,
  hasItems,
  ITEM_CATALOG,
  BUILD_BOOST_HOURS,
  BUILD_BOOST_PERCENT,
  buildBoostOilCost,
  buildBoostRemainingMs,
  findModification,
  MODIFICATION_FAMILY_LABELS,
  modificationSlots,
  nexusLevelForUpgrade,
  type Base,
  type BuildClocks,
  type BuildQuotes,
  type BuildingKind,
  type ItemId,
  type ModificationFamily,
  type ModificationSlot,
  type ModificationSpec,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '../../lib/api';
import { CostLine } from '../../components/Resources';
import { useCancelBuild, useCrewStanding, useIncreasePayroll } from '../../lib/queries';
import { Button } from '../../components/ui/Button';
import { CancelMark } from '../../components/ui/CancelMark';
import { HoverCard } from '../../components/ui/HoverCard';
import { Confirm } from '../../components/ui/Confirm';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { ItemWindow } from '../market/MarketPage';
import { structureBonus } from './bonus';
import { formatDuration, formatRemaining } from './format';
import { PayrollMeter, RaisePayroll } from '../../components/Payroll';
import { useServerClock } from '../missions/useServerClock';

/**
 * One plot's dialog: what stands there, what the next level costs and takes, what it does, and the
 * one action that orders it (GDD §A1, §D3: oil is what building and upgrading consume).
 *
 * Every gate the server enforces is mirrored here so the button is dead *with a reason* rather than
 * alive until a 409, and it is mirrored by calling the same shared functions the route calls, so
 * the two cannot drift into disagreeing about why.
 */

interface StructureDialogProps {
  kind: BuildingKind;
  base: Base;
  /**
   * What the server will actually charge for each structure's next level (`/me`'s `buildQuotes`).
   *
   * The catalogue price is not the price. `queueBuild` takes `buildCostPercent` off everything and
   * `buildingCostPercent[kind]` off the one structure a §B7 perk names, and neither is a number
   * the client can reach: the effects on the wire are flat, and the per-structure record is not on
   * them at all. So the server prices every plot once on the call the shell already polls and this
   * dialog reads the answer.
   *
   * Optional, and absent means "no quote for this plot": either the server is older than the
   * field or there is nothing left to queue. The catalogue price is the fallback, which is what
   * this drew before.
   */
  quotes?: BuildQuotes | undefined;
  /** `/me`'s `buildClocks`: how long the server would take, after the crew's speed and the burn. */
  clocks?: BuildClocks | undefined;
  /** The district read's clock and when it arrived: `useServerClock`'s two arguments, for the burn. */
  serverNow: string | undefined;
  receivedAt: number | undefined;
  pending: boolean;
  error: unknown;
  onBuild: () => void;
  onClose: () => void;
  /** §B4: light the Generator's burn. */
  onBoost: () => void;
  boostPending: boolean;
  /** §E: empty one of the three brackets. Filling one is a press at the yard now. */
  onClearSlot: (slot: number) => void;
  /** §B8/§B9: the two structures whose dialog is a door to a page. */
  onGo: (path: string) => void;
}

export function StructureDialog({
  kind,
  base,
  quotes,
  clocks,
  serverNow,
  receivedAt,
  pending,
  error,
  onBuild,
  onClose,
  onBoost,
  boostPending,
  onClearSlot,
  onGo,
}: StructureDialogProps) {
  const { buildings, buildQueue, resources } = base;
  const spec = BUILDING_CATALOG[kind];
  const standing = findBuilding(buildings, kind);
  // This structure's own orders, so the window that took the order is the window that can call
  // it off (maintainer request, 2026-09-12). The clock is the district read's, like the rail's.
  const now = useServerClock(serverNow, receivedAt);
  const crewStandingEffects = useCrewStanding().data?.effects;
  const cancel = useCancelBuild(base.id);
  const underWay = buildQueue.filter((entry) => entry.kind === kind);

  const unlocked = isUnlockedForQueue(kind, buildings, buildQueue, base.level);
  const nextLevel = unlocked ? nextQueuedLevel(kind, buildings, buildQueue) : null;
  /*
   * The quote, not the catalogue.
   *
   * This used to be `buildingCost(...)` alone, which is the list price. A crew with any build
   * discount was quoted more than it was charged, and, worse, `affordable` below was measured
   * against that inflated figure: the Build button went dead on an order the server would have
   * taken. `buildQuotes` was put on `/me` to fix exactly this and nothing had ever read it.
   */
  const cost =
    nextLevel === null ? null : (quotes?.[kind] ?? buildingCost(kind, nextLevel, buildings));
  // The clock the same way: the order freezes the catalogue's seconds after the crew's build-speed
  // fold and the Generator's burn, and neither reaches the client, so the server quotes it.
  const seconds =
    nextLevel === null
      ? null
      : (clocks?.[kind] ?? buildingBuildSeconds(kind, nextLevel, buildings));
  const affordable = cost !== null && canAfford(resources, cost);
  const partsInHand =
    nextLevel === null || hasItems(base.inventory, buildingParts(kind, nextLevel));
  const queueFull = buildQueue.length >= MAX_BUILD_QUEUE;

  const slots = modificationCapacity(standing);
  const nextSlotAt = nextModificationSlotLevel(standing?.level ?? 0);

  // §F2: the Apothecary's ceiling is filled to the structure *plus* the crew's Logistics, so the
  // line that quotes it reads the same fold the settle does.
  const crewStorage = crewStandingEffects?.['storageCapacityPercent'] ?? 0;
  const bonus = structureBonus(kind, buildings, standing?.level ?? 0, crewStorage);
  const nextBonus =
    nextLevel === null ? null : structureBonus(kind, buildings, nextLevel, crewStorage);

  return (
    <Modal
      onClose={onClose}
      labelledBy="structure-dialog-title"
      size="wide"
      className="border-brass-300/30"
    >
      {/* A plain block, not a <header>: `role=dialog` is not sectioning content, so a <header>
          here still maps to the page's `banner` landmark: the same ambiguity the district page
          dropped its own <header> to avoid, and it would make `locator('header')` match twice
          whenever a plot dialog is open. */}
      {/* `shrink-0` on both the header and the footer, so the only thing a short viewport
          squeezes is the scrollable unit between them. Without it flexbox takes the space out of
          whichever child will give, and a header that gives up four pixels clips its own text
          against the modal's `max-h`, which is a defect no assertion about the *unit* can see. */}
      {/* No portrait.
       *
       * The window used to open on a 128px painting of the building, which is the same building
       * the player had just clicked in the street behind it at four times the size. It cost a
       * third of the header to say something already on screen and pushed the price, the clock
       * and the level down under it. What a dialog is for is the numbers. */}
      <div className="flex shrink-0 items-stretch border-b border-surface-600/60 px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
            {standing ? `Level ${standing.level}` : unlocked ? 'Vacant plot' : 'Locked'}
          </p>
          <h2
            id="structure-dialog-title"
            className="font-display text-lg font-bold tracking-[0.12em] text-ink-100"
          >
            {spec.name}
          </h2>
          {/* The one line that says what the building is *for*, promoted out of the body: it is the
              sentence a player reads before deciding, and it was three sections down. */}
          <p className="font-body text-xs leading-relaxed text-brass-100">{spec.role}</p>
        </div>
      </div>

      {/* Two columns, the way a town-view building window is laid out: what it is on the left,
          what an order costs on the right.

          Not decoration: arithmetic. The window carries a portrait, prose, a bonus, a price, a
          clock, the slots and the doors, and stacking all of that in one column ran it
          past `max-h-[calc(100vh-2rem)]` at 720px and 800px tall, which put the modification list
          under the fold with nothing to say it was there. Two columns halve the run. Single column
          below `sm`, where there is no width to split. */}
      <div className="grid min-h-0 gap-x-5 gap-y-4 overflow-y-auto p-5 sm:grid-cols-2">
        {/* §A1: what the order costs, which is what the window is opened to find out. First, and
            on its own, rather than the fourth label/value pair down a column. */}
        <Section
          title={
            nextLevel === null
              ? 'No order to give'
              : standing
                ? `Upgrade to level ${nextLevel}`
                : 'Build this'
          }
        >
          {cost === null ? (
            <p className="font-display text-[12px] tracking-[0.15em] text-ink-300">
              {ceilingReason(kind, base)}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              <CostLine cost={cost} stock={resources} />
              {seconds !== null && (
                <p className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-300">
                  Takes <span className="tabular-nums text-ink-100">{formatDuration(seconds)}</span>
                </p>
              )}
              {/* §A1: the handful of levels that ask for a part as well as a price. Kept apart
                  from the cost line, because a part is a *gate*: no amount of waiting produces
                  one, and a player has to know to go and look for it. */}
              {nextLevel !== null && buildingNeedsParts(kind, nextLevel) && (
                <div className="flex flex-col gap-1.5 border-t border-surface-700 pt-2.5">
                  <span className="font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
                    Also needs
                  </span>
                  <ul className="flex flex-wrap gap-1.5">
                    {Object.entries(buildingParts(kind, nextLevel)).map(([id, count]) => {
                      const held = base.inventory[id as ItemId] ?? 0;
                      return (
                        <li key={id}>
                          <HoverCard
                            label={ITEM_CATALOG[id as ItemId].name}
                            size="window"
                            card={<ItemWindow id={id as ItemId} />}
                          >
                            <span
                              className={cn(
                                'flex items-center gap-1.5 rounded-sm border px-2 py-1',
                                held >= (count ?? 0)
                                  ? 'border-verdigris-500/60 bg-verdigris-700/20 text-verdigris-100'
                                  : 'border-oxblood-500/60 bg-oxblood-500/10 text-oxblood-300',
                              )}
                            >
                              <ItemGlyph id={id as ItemId} className="h-5 w-5" />
                              <span className="font-display text-[12px] font-semibold tabular-nums">
                                {count}× {ITEM_CATALOG[id as ItemId].name}
                              </span>
                              <span className="font-display text-[11px] tabular-nums opacity-80">
                                ({held} held)
                              </span>
                            </span>
                          </HoverCard>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>

        {underWay.length > 0 && (
          <Section title="Under way">
            <ul className="flex flex-col gap-2.5" data-testid={`structure-under-way-${kind}`}>
              {underWay.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                      To level {entry.level}
                    </span>
                    <span className="shrink-0 font-display text-[12px] font-bold tabular-nums text-brass-300">
                      {formatRemaining(queueRemainingMs(entry, now))}
                    </span>
                  </div>
                  <CancelMark
                    windowMs={queueCancelWindowMs(entry, now)}
                    label={`Call off ${spec.name} level ${entry.level}`}
                    pending={cancel.isPending}
                    onCancel={() => cancel.mutate({ orderId: entry.id })}
                    data-testid={`structure-cancel-${entry.id}`}
                  />
                </li>
              ))}
            </ul>
            {cancel.error && (
              <p role="alert" className="mt-2 font-body text-xs leading-relaxed text-oxblood-300">
                {cancel.error.message}
              </p>
            )}
          </Section>
        )}

        {/* What the level actually buys and what it costs to run, from the same shared functions
            the server settles with: the two numbers somebody choosing between two upgrades is
            comparing, side by side rather than a column apart. */}
        {/*
         * §H7: the payroll book, in the building that keeps it.
         *
         * The Nexus is where a crew's standing figures live, so it is where the book is read and
         * where it is raised. It is the same panel the Bar carries, deliberately: the Bar is
         * where a player finds out they cannot afford somebody, and this is where they go about
         * it, and two different-looking readouts of one number is how a player comes to distrust
         * both.
         */}
        {kind === CENTRAL_BUILDING && (
          <Section title="The payroll book">
            <PayrollBook base={base} />
          </Section>
        )}

        <Section title="What it gives">
          <dl className="flex flex-col gap-2.5">
            <Stat label={bonus.label}>
              <span
                className="flex flex-wrap items-baseline gap-2 font-display text-sm font-semibold text-ink-100"
                data-testid="structure-bonus"
              >
                <span className="tabular-nums">{bonus.value}</span>
                {nextBonus !== null && nextBonus.value !== bonus.value && (
                  <>
                    <span aria-hidden="true" className="text-ink-300">
                      →
                    </span>
                    <span className="tabular-nums text-verdigris-100">{nextBonus.value}</span>
                    <span className="font-body text-[11px] font-normal text-ink-300">
                      at level {nextLevel}
                    </span>
                  </>
                )}
              </span>
            </Stat>
            {/* §B1: what the Nexus has to be for the *next* level, said before anything is spent
                rather than after a refused order. The table is per building and per level, so this
                is the one number a player cannot work out from anywhere else on the screen. */}
            {kind !== CENTRAL_BUILDING && nextLevel !== null && (
              <Stat label="The Nexus has to be at">
                <span
                  className="font-display text-[12px] tabular-nums text-ink-200"
                  data-testid="nexus-requirement"
                >
                  Level {nexusLevelForUpgrade(kind, nextLevel)}
                </span>
              </Stat>
            )}
          </dl>
        </Section>

        {/* §E: three brackets, each one a door to the bench that cuts what goes in it. */}
        <Section title={`Modifications: ${slots.used} of ${MAX_MODIFICATION_SLOTS} slots`}>
          <SlotRack kind={kind} base={base} onGo={onGo} onClear={onClearSlot} />
          {/* Only the line that is still news. "All three are open" was a sentence about nothing
              to do, printed exactly when a player has nothing left to wait for (maintainer
              request, 2026-09-16). */}
          {nextSlotAt !== null && (
            <p className="mt-2 font-body text-[12px] leading-relaxed text-ink-300">
              The next slot opens at level {nextSlotAt}. The Scrapyard builds what goes in them.
            </p>
          )}
          {/*
           * §I3a: the way to make more, from the place you found out you were short.
           *
           * The brackets above are doors to the same bench, and this is the one for a player who
           * has none free: it is the only control in the section that is still worth pressing when
           * all three are full.
           *
           * It opens the yard on *this* structure's bench rather than on the whole board, which
           * the yard reads off `?view` and `?bench` together. The bench ids are `BuildingKind`, so
           * there is no second name to keep in step.
           */}
          <Button
            size="sm"
            variant="ghost"
            className="mt-2.5"
            data-testid={`structure-build-addons-${kind}`}
            onClick={() => onGo(`/game/scrapyard?view=modifications&bench=${kind}`)}
          >
            Build more in the Scrapyard
          </Button>
        </Section>

        {/* §B4: the Generator's two-hour burn, bought where it is sold. */}
        {kind === 'generator' && (
          <Section title="Burn the tanks">
            <BuildBoost
              base={base}
              serverNow={serverNow}
              receivedAt={receivedAt}
              onBoost={onBoost}
              pending={boostPending}
            />
          </Section>
        )}

        {/* §B8: the Lab is the door to research, and research is no longer a tab. */}
        {kind === 'lab' && (
          <Section title="Research">
            <p className="font-body text-xs leading-relaxed text-ink-300">
              Projects are run out of the Lab. Every level here takes time off all of them.
            </p>
            <Button
              size="sm"
              className="mt-2.5"
              data-testid="lab-open-research"
              onClick={() => onGo('/game/research')}
            >
              Open research
            </Button>
          </Section>
        )}

        {/*
         * §B11: the Garage is a door and nothing else.
         *
         * It grants nothing passively, so without this section its dialog is a level, a cost and
         * no reason to have built it. The page existed and was routed before this was added, and
         * was reachable only by typing the URL: the two halves of the Garage were built either
         * side of a seam and neither owned the door.
         */}
        {kind === 'garage' && (
          <Section title="The yard">
            <p className="font-body text-xs leading-relaxed text-ink-300">
              Machines are built and kept here. They carry a column to the ground faster than it
              walks, and they are lost with the people riding them.
            </p>
            {/*
             * Straight to the machines, not to a page about them.
             *
             * This used to open `/game/garage`, which held a level, a seat count and one button
             * that went here. Three clicks and two screens to reach a list, with the middle screen
             * telling a player nothing they could not read on the dialog they had just left. The
             * page is retired; the Vehicles tab is where the machines live, beside the people who
             * ride them, which is the comparison that matters when choosing one.
             */}
            <Button
              size="sm"
              className="mt-2.5"
              data-testid="garage-open"
              onClick={() => onGo('/game/units?tab=vehicles')}
            >
              Open the Garage
            </Button>
          </Section>
        )}

        {/* §B9: and the Scrapyard has a page of its own. */}
        {kind === 'scrapyard' && (
          <Section title="The yard">
            <p className="font-body text-xs leading-relaxed text-ink-300">
              Add-ons are built here: building modifications for these three slots, and unit
              modifications for the roster. Scrap, and good metal for the heavy work.
            </p>
            <Button
              size="sm"
              className="mt-2.5"
              data-testid="scrapyard-open"
              onClick={() => onGo('/game/scrapyard')}
            >
              Open the Scrapyard
            </Button>
          </Section>
        )}

        {error !== null && error !== undefined && (
          <p
            role="alert"
            className="font-body text-xs leading-relaxed text-oxblood-300 sm:col-span-2"
          >
            {error instanceof ApiRequestError ? error.message : 'That did not go through'}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-surface-700 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          size="sm"
          disabled={cost === null || !affordable || !partsInHand || queueFull || pending}
          onClick={onBuild}
        >
          {pending
            ? 'Working…'
            : !partsInHand
              ? 'Short of parts'
              : queueFull
                ? 'Queue full'
                : standing || buildQueue.some((entry) => entry.kind === kind)
                  ? 'Queue upgrade'
                  : 'Queue build'}
        </Button>
      </footer>
    </Modal>
  );
}

/** A fitted modification reads as a fact; an unfitted one reads as an option. */
function cnRow(fitted: boolean): string {
  return [
    'flex items-center justify-between gap-3 border px-2 py-1 font-display text-[11px] uppercase tracking-[0.12em]',
    fitted ? 'border-brass-500/60 text-brass-300' : 'border-surface-700 text-ink-300',
  ].join(' ');
}

/**
 * §E: the three brackets, and everything a player can do with them.
 *
 * Always three rows, whatever the structure's level, because "three clear slots" is the board's
 * wording and a slot that is not drawn is a slot a player does not know they are working towards.
 * A locked one says which level opens it; an empty open one is a door to this structure's bench at
 * the yard; a filled one says what is in it and has a control that dismantles it.
 *
 * There is no shelf to read any more (2026-09-16). A card is cut for a named structure and bolted
 * in by the same press at the bench, so nothing is ever built and waiting to be placed, and the
 * picker that used to stand between the two is gone with the route it called.
 */
function SlotRack({
  kind,
  base,
  onGo,
  onClear,
}: {
  kind: BuildingKind;
  base: Base;
  onGo: (path: string) => void;
  onClear: (slot: number) => void;
}) {
  const standing = findBuilding(base.buildings, kind);
  const slots = modificationSlots(standing);
  /*
   * Which bracket is being stripped, and has not been confirmed yet.
   *
   * Stripping one *destroys* it: `clearSlot` puts nothing back and refunds nothing, and the yard
   * has to cut another from parts. That is the one permanent decision left on this window.
   */
  const [stripping, setStripping] = useState<number | null>(null);
  const strippingSpec =
    stripping === null ? undefined : findModification(standing?.modifications[stripping] ?? '');
  /** What is already bolted into this structure, which is what a set is measured against. */
  const fittedHere = (standing?.modifications ?? []).flatMap((id) => {
    const spec = findModification(id);
    return spec ? [spec] : [];
  });

  return (
    <>
      <ul className="flex flex-col gap-1.5" data-testid={`slots-${kind}`}>
        {slots.map((slot) => (
          <SlotRow key={slot.index} slot={slot} kind={kind} onClear={setStripping} onGo={onGo} />
        ))}
      </ul>

      <SetReadout fitted={fittedHere} open={slots.filter((slot) => slot.open).length} />

      {/*
       * The one permanent decision left on this window, asked the way the kit asks every other one.
       *
       * `clearSlot` destroys the card: nothing is refunded and the yard has to cut another from
       * parts. Through `Confirm` rather than a dialog of its own, which is that component's stated
       * rule and the reason it lives in the kit: two screens with different ideas of "are you
       * sure" is the bug it was written to stop.
       */}
      {stripping !== null && strippingSpec && (
        <Confirm
          title="Strip it out?"
          body={[
            `${strippingSpec.name} comes out of ${BUILDING_CATALOG[kind].name} and is scrap.`,
            'Nothing is refunded, and the Scrapyard has to cut another one from parts.',
            // Said only when it is true: stripping a card out of a full bracket of one family also
            // gives up the set bonus, which is the expensive half and the half nobody thinks of at
            // the moment they press a red word.
            completedFamily(fittedHere, slots.filter((slot) => slot.open).length) !== null &&
            strippingSpec.family
              ? `That breaks the ${MODIFICATION_FAMILY_LABELS[strippingSpec.family]} set, and its ${describeSetBonus(strippingSpec.family)} goes with it.`
              : '',
          ]
            .filter((line) => line !== '')
            .join(' ')}
          confirm="Strip it out"
          testId={`slot-strip-${kind}`}
          onCancel={() => setStripping(null)}
          onConfirm={() => {
            onClear(stripping);
            setStripping(null);
          }}
        />
      )}
    </>
  );
}

/**
 * The family this bracket is completely built around, or null.
 *
 * The client's own reading of `completedSet`, which takes a `Building` and is therefore awkward to
 * ask about a list of specs. Kept to the same rule as the shared one on purpose: every open slot
 * filled, all of one family. If that rule ever moves, `decks.test.ts` is where it moves, and this
 * has to follow it.
 */
function completedFamily(
  fitted: readonly ModificationSpec[],
  open: number,
): ModificationFamily | null {
  if (open < MODIFICATION_SET_SIZE || fitted.length < open) return null;
  const family = fitted[0]?.family;
  if (family === undefined) return null;
  return fitted.every((spec) => spec.family === family) ? family : null;
}

/**
 * Whether this structure is built around one family, and what that is worth (2026-09-14).
 *
 * The set bonus shipped with nothing in the client reading it. Every other half of the deck was
 * on screen, the family tag and the synergy line in the picker, so a player could see that cards
 * had families and never learn that three of one family in one structure paid anything at all. A
 * bonus nobody can see is not a mechanic, it is a number in a test.
 *
 * Drawn in all three states on purpose. "Nothing yet" is the one that teaches the rule, and a
 * readout that only appeared once a set was complete would only ever be read by players who had
 * already worked it out.
 */
function SetReadout({ fitted, open }: { fitted: ModificationSpec[]; open: number }) {
  // A set is every open slot filled with one family, so it cannot be assembled at all until the
  // structure has all three. Saying so is more use than a progress line that can never finish.
  if (open < MODIFICATION_SET_SIZE) {
    return (
      <p
        className="mt-2 font-body text-[12px] leading-snug text-ink-400"
        data-testid="set-readout"
        data-set="locked"
      >
        Fill all {MODIFICATION_SET_SIZE} slots with one family and the structure pays a set bonus on
        top of the cards. That needs the last slot, at level{' '}
        {MODIFICATION_SLOT_LEVELS[MODIFICATION_SET_SIZE - 1]}.
      </p>
    );
  }

  const family = completedFamily(fitted, open);

  if (family !== null) {
    const bonus = SET_BONUSES[family];
    return (
      <p
        /*
         * `.ink-field`, not `.ink-box`.
         *
         * `.ink-box` is drawn in a 200x56 viewBox with its line 8 units inside the edge, painted at
         * `background-size: 100% 100%`. On a box this shape, wide and two lines tall, that 8 units
         * stretches to about 14px while the padding is 10, so the sentence was printed *outside*
         * its own border on both sides. `.ink-field` is the same pen authored for exactly this
         * shape (the note above it in `index.css` says so), with its line 3 units in.
         */
        className="ink-field mt-2 px-3 py-2 font-body text-[12px] leading-snug text-verdigris-100"
        data-testid="set-readout"
        data-set="complete"
      >
        <span className="font-stamp text-[13px] text-verdigris-100">
          {MODIFICATION_FAMILY_LABELS[family]} set
        </span>{' '}
        {bonus.title}: {describeSetBonus(family)}, on top of what the cards pay.
      </p>
    );
  }

  // Not a set yet. Name the family that is closest, because "two of three Comfort" is a decision
  // and "no set" is not.
  const counts = new Map<ModificationFamily, number>();
  for (const spec of fitted) {
    if (spec.family) counts.set(spec.family, (counts.get(spec.family) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <p
      className="mt-2 font-body text-[12px] leading-snug text-ink-400"
      data-testid="set-readout"
      data-set="partial"
    >
      {best === undefined
        ? `No set. Three cards of one family in these ${MODIFICATION_SET_SIZE} slots pays a bonus on top of them.`
        : `${best[1]} of ${MODIFICATION_SET_SIZE} ${MODIFICATION_FAMILY_LABELS[best[0]]}. A full bracket of one family adds ${describeSetBonus(best[0])}.`}
    </p>
  );
}

function SlotRow({
  slot,
  kind,
  onClear,
  onGo,
}: {
  slot: ModificationSlot;
  kind: BuildingKind;
  onClear: (slot: number) => void;
  /** §I3a: an empty bracket is the way to the bench that fills it. */
  onGo: (path: string) => void;
}) {
  const fitted = slot.modificationId === null ? undefined : findModification(slot.modificationId);

  if (fitted) {
    return (
      <li
        className={cnRow(true)}
        data-testid={`slot-${kind}-${slot.index}`}
        /*
         * What the card in the bracket does, on the hover (maintainer request, 2026-09-16).
         *
         * The row has room for a name and a control and nothing else, and a name on its own does
         * not say why the bracket was worth filling. Read off the catalogue rather than off the
         * district payload, which carries the id and no effect at all, so this sentence and the
         * one the bench prints on the same card are the same sentence.
         */
        data-tip={`${fitted.name} · ${describeAddonEffect(fitted)}`}
      >
        <span className="truncate">{fitted.name}</span>
        {/*
         * A verb, not a state (2026-09-14), and the yard's own verb (2026-09-16).
         *
         * The control sat at the end of a row whose other half is the fitted card's name, so it
         * read as the slot's *state* rather than as something to press: "Automated Protocols,
         * Empty" says the opposite of what is true. Every other row in the rack does say its state
         * there ("Level 20" on a locked one), which is exactly why a verb is needed on this one.
         *
         * The word is the bench's, because it is the same act in both places and a player who
         * learns Dismantle on the card should not have to learn Strip out on the bracket.
         */}
        <button
          type="button"
          className="shrink-0 text-oxblood-300 underline-offset-2 hover:underline"
          data-testid={`slot-clear-${kind}-${slot.index}`}
          onClick={() => onClear(slot.index)}
        >
          Dismantle
        </button>
      </li>
    );
  }

  if (!slot.open) {
    return (
      <li className={cnRow(false)} data-testid={`slot-${kind}-${slot.index}`}>
        <span className="truncate">Locked</span>
        <span className="shrink-0 tabular-nums">Level {slot.opensAtLevel}</span>
      </li>
    );
  }

  /*
   * The whole empty bracket is the control, and what it does now is open the bench (2026-09-16).
   *
   * It used to open a picker over the shelf. There is no shelf: the yard cuts a card for a named
   * structure and bolts it in on the same press, so the only thing this row can usefully do is
   * take the player to the bench for *this* structure. Which is also what it looked like it did.
   */
  return (
    <li data-testid={`slot-${kind}-${slot.index}`}>
      <button
        type="button"
        onClick={() => onGo(`/game/scrapyard?view=modifications&bench=${kind}`)}
        data-testid={`slot-door-${kind}-${slot.index}`}
        data-sound="click"
        data-tip={`Bracket ${slot.index + 1} · empty · cut one for ${BUILDING_CATALOG[kind].name} at the yard`}
        className={cn(
          cnRow(false),
          'w-full cursor-pointer text-left transition-colors',
          'border-verdigris-300/40 hover:border-verdigris-300/80 hover:text-verdigris-100',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-verdigris-300',
        )}
      >
        <span className="truncate">Empty</span>
        <span className="flex shrink-0 items-center gap-1.5 text-verdigris-100">
          Cut one at the yard
        </span>
      </button>
    </li>
  );
}

/**
 * §B4: the Generator's paid burn, with its countdown.
 *
 * The countdown is derived from the district's own stored timestamp on every render rather than
 * ticked, so it is correct after a reload and after the tab has been asleep: the same reason every
 * other clock in this game is a timestamp.
 */
function BuildBoost({
  base,
  serverNow,
  receivedAt,
  onBoost,
  pending,
}: {
  base: Base;
  serverNow: string | undefined;
  receivedAt: number | undefined;
  onBoost: () => void;
  pending: boolean;
}) {
  // The district read's own clock, so a skewed machine reads the same burn as everyone else.
  const now = useServerClock(serverNow, receivedAt);
  const remainingMs = buildBoostRemainingMs(base.economy.buildBoostUntil, now);
  const oil = buildBoostOilCost(base.buildings);
  const level = buildingLevel(base.buildings, 'generator');

  if (level <= 0) {
    return (
      <p className="font-body text-xs leading-relaxed text-ink-300">
        Build the Generator first. It is what sells the burn.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5" data-testid="build-boost">
      <p className="font-body text-xs leading-relaxed text-ink-300">{BUILD_BOOST_OIL_LINE(oil)}</p>
      {remainingMs > 0 ? (
        <p
          className="font-display text-[12px] uppercase tracking-[0.14em] text-brass-300"
          data-testid="build-boost-remaining"
        >
          Burning:{' '}
          <span className="tabular-nums text-ink-100">{formatDuration(remainingMs / 1000)}</span>{' '}
          left
        </p>
      ) : (
        <Button
          size="sm"
          disabled={pending || base.resources.oil < oil}
          data-testid="build-boost-buy"
          onClick={onBoost}
        >
          {pending ? 'Lighting…' : base.resources.oil < oil ? 'Short of oil' : `Burn ${oil} oil`}
        </Button>
      )}
    </div>
  );
}

/** One sentence, so the price and the promise cannot drift apart on the screen. */
const BUILD_BOOST_OIL_LINE = (oil: number): string =>
  `${oil} oil makes all building upgrades ${BUILD_BOOST_PERCENT}% faster for ${BUILD_BOOST_HOURS} hours.`;

/**
 * Why there is no next level: locked behind the Nexus, held down by it, or the end of the content.
 *
 * Judged against the *projected* district, the same reading the server's gate uses, so a player
 * who has already queued the Nexus level that unlocks this plot is told they can build, not told to
 * go and do the thing they have just done.
 */
function ceilingReason(kind: BuildingKind, base: Base): string {
  const projected = projectedBuildings(base.buildings, base.buildQueue);
  // Every unmet clause (§A1, §I3), not the Nexus rung alone: a structure can be waiting on another
  // building and on the crew's own level at the same time, and naming one of the three sends a
  // player off to do a thing that will not unlock it.
  const unmet = unmetForQueue(kind, base.buildings, base.buildQueue, base.level);
  if (unmet.length > 0) {
    return `NEEDS ${unmet.map(describeBuildingRequirement).join(' · ').toUpperCase()}`;
  }
  if (kind === CENTRAL_BUILDING) return `MAXED AT LEVEL ${BUILDING_MAX_LEVEL}`;
  if (structureLevelCap(kind, projected) === BUILDING_MAX_LEVEL) {
    return `MAXED AT LEVEL ${BUILDING_MAX_LEVEL}`;
  }
  return `CAPPED BY THE NEXUS (LV ${buildingLevel(projected, CENTRAL_BUILDING)})`;
}

/**
 * One panel of the window, with its own heading.
 *
 * The unit used to be a run of label-over-value rows separated by hairlines, which reads as one
 * long list of facts however it is arranged in columns: the player has to read every label to
 * find the one they came for. A section is a *place*: the price is in the box called "Build this",
 * the slots are in the box called "Modifications", and a glance lands in the right box before any
 * word has been read.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rivets flex min-w-0 flex-col rounded-sm border border-surface-600/70 bg-surface-900/40">
      <h3 className="border-b border-surface-600/70 px-3.5 py-2 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
        {title}
      </h3>
      <div className="min-w-0 px-3.5 py-3">{children}</div>
    </section>
  );
}

/**
 * What the crew may promise officers, and the one control that raises it (§H7).
 *
 * The ceiling comes straight off the base: `payrollCapacity` of the Nexus level, what has been
 * bought and the district's own bonus are all on the base this dialog was handed, and a second read
 * of those would be a second answer. The step *price* is the exception, and the reason is below.
 */
function PayrollBook({ base }: { base: Base }) {
  const raise = useIncreasePayroll();
  /*
   * The step discount is the one figure in this ledger that is not on the base.
   *
   * `payrollStepDiscountPercent` (§B7) is a crew channel, not a district one, so the base this
   * dialog was handed cannot answer it and the default of 0 quoted full price. `POST /bar/payroll`
   * charges `payrollStepCost(steps, payrollStepDiscountPercent)`, so a crew holding `ledger_hand`
   * and `bank_contact` (13% between them) saw "500 caps, once" and a disabled button on 450 caps
   * while the route would have taken 435: the panel refused a purchase the server accepts, and the
   * Bar's copy of this same control showed the right price all along.
   *
   * Read off `/overseer/me`, which is where the client already gets the whole `CrewEffects` struct.
   * Before it answers the panel quotes full price, which is the behaviour this replaces rather than
   * a new one; gating the button on the query instead would turn a request that fails into a
   * permanent refusal, which is the harm this is fixing.
   */
  const effects = useCrewStanding().data?.effects;
  const ledger = payrollLedger(
    base.economy.payroll,
    buildingLevel(base.buildings, CENTRAL_BUILDING),
    payrollBonusPercent(base.buildings),
    effects?.['payrollStepDiscountPercent'],
  );

  return (
    <div className="flex flex-col gap-2.5" data-testid="nexus-payroll">
      <dl className="flex flex-col gap-2.5">
        <Stat label="Committed to officers">
          <span className="font-display text-sm font-semibold tabular-nums text-ink-100">
            {ledger.committed.toLocaleString()} / {ledger.capacity.toLocaleString()} caps / wk
          </span>
        </Stat>
        <Stat label="Left to promise">
          <span className="font-display text-sm font-semibold tabular-nums text-brass-300">
            {ledger.available.toLocaleString()}
          </span>
        </Stat>
      </dl>
      <PayrollMeter ledger={ledger} />
      <RaisePayroll
        ledger={ledger}
        caps={base.resources.caps}
        onRaise={() => raise.mutate({ fromSteps: base.economy.payroll.purchasedSteps })}
        pending={raise.isPending}
        error={raise.error?.message ?? null}
        testId="nexus-increase-payroll"
        className="pt-2.5"
      />
      <p className="font-body text-[12px] leading-snug text-ink-300">
        A step is permanent and the next one costs more. Nothing is deducted week to week: an
        officer holds a slice of the book for as long as they are on the books.
      </p>
    </div>
  );
}

/** A named figure inside a section: the label on the left, the number on the right. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
