import {
  describeAddonEffect,
  BUILDING_CATALOG,
  levelCeilingFor,
  CENTRAL_BUILDING,
  buildQueueCapacity,
  MAX_MODIFICATION_SLOTS,
  buildingBuildSeconds,
  buildingCost,
  buildingLevel,
  canAfford,
  findBuilding,
  isUnlockedForQueue,
  unmetForQueue,
  describeBuildingRequirement,
  modificationCapacity,
  MODIFICATION_SET_SIZE,
  SET_BONUSES,
  describeSetBonus,
  nextQueuedLevel,
  projectedBuildings,
  atLevelCeiling,
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
  overTheStores,
  overTheStoresText,
  storeCeilings,
  type StoreCeilings,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '../../lib/api';
import { CostLine } from '../../components/Resources';
import { useCancelBuild, useCrewStanding, useMe } from '../../lib/queries';
import { BuildOrderPlate } from './BuildOrderPlate';
import { DrawnButton, DrawnLabel } from '../../components/ui/DrawnButton';
import { DrawnCrane, DrawnRule } from '../../components/ui/DrawnMarks';
import { HoverCard } from '../../components/ui/HoverCard';
import { Confirm } from '../../components/ui/Confirm';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { ItemWindow } from '../market/MarketPage';
import { structureBonus } from './bonus';
import { formatDuration } from './format';
import { PayrollBookDialog } from '../../components/Payroll';
import { useServerClock } from '../missions/useServerClock';
import { PressError } from '../../components/ui/PressError';
import { Icon } from '../../components/ui/Icon';
import { RarityTag } from '../../lib/rarity';
import { YardPlate } from '../scrapyard/YardGlyph';
import { SLOT_WELL } from '../scrapyard/template';

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
  /**
   * `/me`'s `buildBoostOil`: what the burn costs this crew, with the ground's cut off it (Shaft
   * Nine). Absent, the burn is priced off the structures alone.
   */
  boostOil?: number | undefined;
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
  /**
   * A dismantle in flight. Every Dismantle waits on it (bug pass, 2026-10-06): a bracket is named by
   * position and the server closes the gap behind one it takes out, so a second strip confirmed
   * before the first answered could take the card after it.
   */
  clearing?: boolean;
  /** §B8/§B9: the two structures whose dialog is a door to a page. */
  onGo: (path: string) => void;
}

export function StructureDialog({
  kind,
  base,
  quotes,
  clocks,
  boostOil,
  serverNow,
  receivedAt,
  pending,
  error,
  onBuild,
  onClose,
  onBoost,
  boostPending,
  onClearSlot,
  clearing = false,
  onGo,
}: StructureDialogProps) {
  const { buildings, buildQueue, resources } = base;
  const spec = BUILDING_CATALOG[kind];
  const standing = findBuilding(buildings, kind);
  // This structure's own orders, so the window that took the order is the window that can call
  // it off (maintainer request, 2026-09-12). The clock is the district read's, like the rail's.
  const now = useServerClock(serverNow, receivedAt);
  const crewStanding = useCrewStanding().data;
  // The crew's half of the production rates, so a producing structure quotes what the settle pays.
  const productionYield = useMe().data?.productionYield;
  const cancel = useCancelBuild(base.id);
  const [payrollOpen, setPayrollOpen] = useState(false);

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
  /*
   * Why this structure has no next level, when it has none (maintainer, 2026-09-19).
   *
   * Computed here rather than inside the panel, because the heading, the body and the panel's own
   * treatment all read it, and three calls to a function that walks the build queue is three
   * chances for the heading and the body to disagree about which case they are in.
   */
  const ceiling = nextLevel === null ? ceilingReason(kind, base) : null;
  const partsInHand =
    nextLevel === null || hasItems(base.inventory, buildingParts(kind, nextLevel));
  const queueFull = buildQueue.length >= buildQueueCapacity(base.research.technologies);

  const slots = modificationCapacity(standing);
  // §F2: the Apothecary's ceiling is filled to the structure *plus* the crew's storage bonus, so the
  // line that quotes it reads the same fold the settle does.
  // The people's and the ground's (the Undercroft Stores), as the settle fills the shelves.
  const crewStorage = productionYield?.storageCapacityPercent ?? 0;
  const ceilings = storeCeilings(buildings, crewStorage);
  // A price no amount of waiting reaches: the stores cannot hold it.
  const over = cost !== null && !affordable ? overTheStores(cost, ceilings) : null;
  // People and ground together (the Printworks held whole): `effects` is people-only, so the
  // Quarters' line never showed the ground's share until 2026-10-13.
  const crewPayroll = crewStanding?.payrollPercent ?? 0;
  const bonus = structureBonus(
    kind,
    buildings,
    standing?.level ?? 0,
    crewStorage,
    productionYield,
    crewPayroll,
  );
  const nextBonus =
    nextLevel === null
      ? null
      : structureBonus(kind, buildings, nextLevel, crewStorage, productionYield, crewPayroll);

  return (
    <Modal
      onClose={onClose}
      labelledBy="structure-dialog-title"
      /*
       * 60rem, not 52 (maintainer, 2026-09-18).
       *
       * Measured before it was changed, on a district that has been played: every structure at
       * level 13 with its three brackets filled and an order on the clock. At 1024x768 the Nexus
       * wanted 707px of body in a 562px box, so 145px of it, the whole bracket rack below the
       * first row and the door to the bench under it, sat under a scroll nothing announced; the
       * Scrapyard hid 36, the Generator 35, the Garage 24 and the Lab 16.
       *
       * The deck below is what buys most of that back, and the width is what makes the answer
       * hold on the shortest frame in the matrix: 17px off the Nexus deck and 26 off the
       * Generator's, which is the difference between 705px and 688 at 1280x720. `Modal`'s note on
       * `broad` carries the rest of the figures.
       */
      size="plot"
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
      {/* The rule under the head is drawn rather than ruled, which is the whole of the change the
          maintainer asked for said once: the feats board, the archive and the unit hovers all
          close a heading with `.ink-rule` and none of them own a 1px border. */}
      <div className="relative flex shrink-0 items-stretch px-5 pb-3.5 pt-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
            {standing ? `Level ${standing.level}` : unlocked ? 'Vacant plot' : 'Locked'}
          </p>
          {/* The hand face, and a size up with it. A structure's name is a *name*, which is the
              test the rest of the game uses to decide between `font-display` and `font-stamp`. */}
          <h2
            id="structure-dialog-title"
            className="font-stamp text-[23px] leading-none text-ink-100"
          >
            {spec.name}
          </h2>
          {/* The one line that says what the building is *for*, promoted out of the body: it is the
              sentence a player reads before deciding, and it was three sections down. */}
          <p className="font-body text-[13px] leading-relaxed text-brass-100">{spec.role}</p>
        </div>
        <span aria-hidden className="ink-rule absolute inset-x-5 bottom-0" />
      </div>

      {/* The same 14px above the first panel and below the last, so the rule under the head and
          the rule over the footer sit the same distance from the deck (maintainer, 2026-09-28). */}
      <div className="flex min-h-0 flex-col overflow-y-auto px-5 py-3.5">
        {/*
         * One template for every plot (maintainer, 2026-09-28).
         *
         * Two columns and one row. The left holds the order (and, under it, whatever is already on
         * the clock) with what the level gives beneath; the right holds the three brackets, drawn
         * to the full height of the row so its top sits level with the order's and its bottom with
         * the gift's. The deck used to be a multi-column box that packed panels wherever they
         * fitted, which put a Generator's burn under its price and a Nexus's payroll book beside
         * it: no two windows had the same shape. Everything a building does beyond the template is
         * a control in the footer now.
         *
         * `items-stretch` is what makes the two columns the same height; the second panel on the
         * left grows to take whatever the bracket rack is taller by, and the rack grows when it is
         * the shorter one, so the gap to the rule below is the same on both sides.
         */}
        <div className="flex flex-col gap-3" data-testid="structure-deck">
          {/*
           * The order and what the level gives, side by side at one fixed height (maintainer,
           * 2026-10-08), so every plot's window is the same shape whatever its price, parts or
           * clock: a busy structure fills lines that were already drawn.
           */}
          <div className="grid h-[14rem] grid-cols-2 gap-3" data-testid="structure-top">
            <Section
              title={
                ceiling?.maxed === true
                  ? 'Max level reached'
                  : nextLevel === null
                    ? 'No order to give'
                    : standing
                      ? `Upgrade to level ${nextLevel}`
                      : 'Build this'
              }
              grow
              fill
            >
              <div className="flex flex-col gap-2 pt-2.5">
                {cost === null ? (
                  <p
                    className="font-display text-[12px] tracking-[0.15em] text-ink-300"
                    data-testid="structure-ceiling"
                  >
                    {ceiling?.line}
                  </p>
                ) : (
                  <>
                    {/* The whole price on one line: the glyph and the figure, the name on the
                        hover. */}
                    <CostLine compact cost={cost} stock={resources} />
                    {seconds !== null && (
                      <p className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-300">
                        Takes{' '}
                        <span className="tabular-nums text-ink-100">{formatDuration(seconds)}</span>
                      </p>
                    )}
                    {/* §A1: the handful of levels that ask for a part as well as a price, on a
                        line of their own. A part is a *gate*: no amount of waiting produces one,
                        and a player has to know to go and look for it. */}
                    {nextLevel !== null && buildingNeedsParts(kind, nextLevel) && (
                      <PartsLine parts={buildingParts(kind, nextLevel)} base={base} />
                    )}
                  </>
                )}
              </div>
              {/* What is already on the clock for this plot, at the foot of the order's own panel:
                  the window that took the order is the window that can call it off (maintainer
                  request, 2026-09-12). There whether or not anything is building, so queueing a
                  level fills a line that was already drawn. */}
              <div className="mt-auto">
                <UnderWayLine
                  kind={kind}
                  base={base}
                  now={now}
                  pending={cancel.isPending}
                  onCancel={(orderId) => cancel.mutate({ orderId })}
                />
              </div>
              {cancel.error && (
                <PressError onDismiss={cancel.reset}>{cancel.error.message}</PressError>
              )}
            </Section>

            {/* What the level actually buys and what it costs to run, from the same shared functions
            the server settles with: the two numbers somebody choosing between two upgrades is
            comparing, side by side rather than a column apart. */}
            <Section title="What it gives" grow>
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
          </div>

          {/* §E: the three brackets across the whole window, one card each. Each is a door to the
              bench that cuts what goes in it, a card that says what it does, or a lock. No "Build
              more in the Scrapyard" button under them (maintainer, 2026-10-04): the empty
              brackets are already doors to the same bench. */}
          <Section
            title={`Modifications: ${slots.used} of ${MAX_MODIFICATION_SLOTS} slots`}
            // Whether the bracket is a set rides on the heading's line rather than under the
            // cards, where a line kept for it stood empty on most plots.
            aside={<SetAside kind={kind} base={base} />}
          >
            <SlotRack
              kind={kind}
              base={base}
              onGo={onGo}
              onClear={onClearSlot}
              clearing={clearing}
            />
          </Section>
        </div>
      </div>

      {/*
       * The footer is where a building does whatever it does beyond the template (maintainer,
       * 2026-09-28): Close on the left, in red, and on the right the building's own control beside
       * the order. The Generator sells its burn here, the Lab, the Garage, the Gauntlet and the
       * Scrapyard are doors, and the Nexus opens the payroll book.
       */}
      <footer className="relative flex shrink-0 flex-wrap items-center gap-3 px-5 py-3">
        <span aria-hidden className="ink-rule absolute inset-x-5 top-0" />
        <DrawnButton size="sm" tone="danger" data-sound="click" onClick={onClose}>
          Close
        </DrawnButton>
        {/* The refusal sits beside the control that was refused, on the same row (maintainer,
            2026-09-25). */}
        {error !== null && error !== undefined && (
          <PressError>
            {error instanceof ApiRequestError ? error.message : 'That did not go through'}
          </PressError>
        )}
        <div className="ml-auto flex items-center gap-3">
          <StructureAction
            kind={kind}
            base={base}
            serverNow={serverNow}
            receivedAt={receivedAt}
            onBoost={onBoost}
            boostPending={boostPending}
            boostOil={boostOil}
            onGo={onGo}
            onPayroll={() => setPayrollOpen(true)}
            ceilings={ceilings}
          />
          <DrawnButton
            // The same size as Close and the building's own control beside it (maintainer,
            // 2026-10-08): one row of three alike buttons.
            size="sm"
            disabled={cost === null || !affordable || !partsInHand || queueFull || pending}
            onClick={onBuild}
            data-tip={over ? overTheStoresText(over) : undefined}
            data-testid="build-structure"
          >
            {pending
              ? 'Working…'
              : over
                ? 'Stores too small'
                : !partsInHand
                  ? 'Short of parts'
                  : queueFull
                    ? 'Queue full'
                    : standing || buildQueue.some((entry) => entry.kind === kind)
                      ? 'Queue upgrade'
                      : 'Queue build'}
          </DrawnButton>
        </div>
      </footer>

      {/* §H7: the payroll book, in its own window off the Nexus (maintainer, 2026-09-28). */}
      {payrollOpen && <PayrollBookDialog base={base} onClose={() => setPayrollOpen(false)} />}
    </Modal>
  );
}

/**
 * §A1: the parts a level asks for besides its price, as chips on one line. The count and the part
 * on the chip, green when the crew holds enough and red when it does not; what is held is on the
 * hover with the part's own window.
 */
function PartsLine({ parts, base }: { parts: Partial<Record<ItemId, number>>; base: Base }) {
  return (
    <div className="flex items-center gap-2" data-testid="structure-parts">
      <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
        Also needs
      </span>
      <ul className="flex min-w-0 gap-1.5">
        {Object.entries(parts).map(([id, count]) => {
          const held = base.inventory[id as ItemId] ?? 0;
          return (
            <li key={id} className="min-w-0">
              <HoverCard
                label={`${ITEM_CATALOG[id as ItemId].name}, ${held} held`}
                size="window"
                card={<ItemWindow id={id as ItemId} />}
              >
                <span
                  className={cn(
                    'flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5',
                    held >= (count ?? 0)
                      ? 'border-verdigris-500/60 bg-verdigris-700/20 text-verdigris-100'
                      : 'border-oxblood-500/60 bg-oxblood-500/10 text-oxblood-300',
                  )}
                >
                  <ItemGlyph id={id as ItemId} className="h-4 w-4" />
                  <span className="font-display text-[11px] font-semibold tabular-nums">
                    {count}× {ITEM_CATALOG[id as ItemId].name}
                  </span>
                </span>
              </HoverCard>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The level of this structure on the clock, drawn the way the district's rail draws it, or an
 * empty line of the same height when nothing is building. The earliest order for the plot is the
 * one shown; any queued behind it are counted beside its level.
 */
function UnderWayLine({
  kind,
  base,
  now,
  pending,
  onCancel,
}: {
  kind: BuildingKind;
  base: Base;
  now: Date;
  pending: boolean;
  onCancel: (orderId: string) => void;
}) {
  const orders = base.buildQueue.filter((entry) => entry.kind === kind);
  const current = orders[0];
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="structure-under-way-line">
      <span aria-hidden className="block h-1.5 text-ink-300/60">
        <DrawnRule />
      </span>
      <div className="flex h-[3.75rem] items-center gap-3">
        {current ? (
          <>
            <DrawnCrane className="h-11 w-11 shrink-0 text-brass-300" />
            <BuildOrderPlate
              entry={current}
              base={base}
              now={now}
              worked={base.buildQueue[0]?.id === current.id}
              after={orders.length - 1}
              pending={pending}
              onCancel={() => onCancel(current.id)}
              cancelTestId={`structure-cancel-${current.id}`}
              className="min-w-0 flex-1"
              data-testid={`structure-under-way-${kind}`}
            />
          </>
        ) : (
          <span className="flex h-full flex-1 items-center justify-center rounded-sm border border-dashed border-surface-500/70 font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
            Nothing under way
          </span>
        )}
      </div>
    </div>
  );
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
  clearing,
}: {
  kind: BuildingKind;
  base: Base;
  onGo: (path: string) => void;
  onClear: (slot: number) => void;
  clearing: boolean;
}) {
  const standing = findBuilding(base.buildings, kind);
  const slots = modificationSlots(kind, standing);
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
      {/* Three cards abreast with a moderate gap, each the same fixed size whatever is in it
          (maintainer, 2026-10-08), so the rack is one shape on every plot. */}
      <ul className="grid grid-cols-3 gap-4 pt-2.5" data-testid={`slots-${kind}`}>
        {slots.map((slot) => (
          <SlotCard
            key={slot.index}
            slot={slot}
            kind={kind}
            clearing={clearing}
            onClear={setStripping}
            onGo={onGo}
          />
        ))}
      </ul>

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

/** The set line for a structure's brackets, worked out from what is fitted there. */
function SetAside({ kind, base }: { kind: BuildingKind; base: Base }) {
  const standing = findBuilding(base.buildings, kind);
  const slots = modificationSlots(kind, standing);
  const fitted = (standing?.modifications ?? []).flatMap((id) => {
    const spec = findModification(id);
    return spec ? [spec] : [];
  });
  return <SetReadout fitted={fitted} open={slots.filter((slot) => slot.open).length} />;
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
  // Nothing until the third bracket is open: the rule used to be stated here, and the maintainer
  // took the sentence out (2026-09-28). The line comes back when there is a set to read.
  if (open < MODIFICATION_SET_SIZE) return null;

  const family = completedFamily(fitted, open);

  if (family !== null) {
    const bonus = SET_BONUSES[family];
    return (
      <span
        /*
         * `.ink-field`, not `.ink-box`.
         *
         * `.ink-box` is drawn in a 200x56 viewBox with its line 8 units inside the edge, painted at
         * `background-size: 100% 100%`. On a box this shape, wide and two lines tall, that 8 units
         * stretches to about 14px while the padding is 10, so the sentence was printed *outside*
         * its own border on both sides. `.ink-field` is the same pen authored for exactly this
         * shape (the note above it in `index.css` says so), with its line 3 units in.
         */
        className="ink-field whitespace-nowrap px-2.5 py-1 font-body text-[12px] leading-snug text-verdigris-100"
        data-testid="set-readout"
        data-set="complete"
      >
        <span className="font-stamp text-[13px] text-verdigris-100">
          {MODIFICATION_FAMILY_LABELS[family]} set
        </span>{' '}
        {bonus.title}: {describeSetBonus(family)}, on top of what the cards pay.
      </span>
    );
  }

  // Not a set yet. Name the family that is closest, because "two of three Comfort" is a decision;
  // with nothing of any family fitted there is nothing to say (maintainer, 2026-09-28).
  const counts = new Map<ModificationFamily, number>();
  for (const spec of fitted) {
    if (spec.family) counts.set(spec.family, (counts.get(spec.family) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best === undefined) return null;

  return (
    <span
      className="whitespace-nowrap font-body text-[12px] leading-snug text-ink-300"
      data-testid="set-readout"
      data-set="partial"
    >
      {`${best[1]} of ${MODIFICATION_SET_SIZE} ${MODIFICATION_FAMILY_LABELS[best[0]]}. A full bracket of one family adds ${describeSetBonus(best[0])}.`}
    </span>
  );
}

/** Every bracket card is this size, filled, empty or locked. */
const SLOT_CARD = 'flex h-[11.5rem] min-w-0 flex-col rounded-sm border px-3 pb-2.5 pt-3';

/** The pen line between a card's sections. */
function CardRule({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('block h-1.5 text-brass-300/55', className)}>
      <DrawnRule />
    </span>
  );
}

/**
 * One bracket card's three sections, the same in every state (maintainer, 2026-10-08): the plate
 * with the name and the tag beside it, closed by a pen line under the tag; what goes on in the
 * bracket; and, under a second line, the one control, centred.
 */
function SlotCardBody({
  plate,
  title,
  tag,
  place,
  body,
  foot,
}: {
  plate: ReactNode;
  title: ReactNode;
  tag?: ReactNode;
  place: number;
  body: ReactNode;
  foot: ReactNode;
}) {
  return (
    <>
      <span className="flex min-w-0 items-stretch gap-3">
        {plate}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-start gap-2">
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
              {title}
              {tag}
            </span>
            <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
              Slot {place + 1}
            </span>
          </span>
          {/* Just under the tag, and starting at the title's edge rather than the plate's, so it
              closes the name off without running into the plate (maintainer, 2026-10-08). */}
          <CardRule className="mt-1.5" />
        </span>
      </span>
      <span className="mt-2.5 block min-w-0">{body}</span>
      <span className="mt-auto block">
        <CardRule />
        <span className="flex min-h-8 items-center justify-center pt-2">{foot}</span>
      </span>
    </>
  );
}

const PLATE = 'flex h-14 w-14 shrink-0 items-center justify-center rounded-sm';
const CARD_TITLE = 'break-words font-display text-[15px] font-bold leading-tight';
const CARD_BODY = 'break-words font-display text-[12px] uppercase leading-snug tracking-[0.08em]';

function SlotCard({
  slot,
  kind,
  clearing,
  onClear,
  onGo,
}: {
  slot: ModificationSlot;
  kind: BuildingKind;
  clearing: boolean;
  onClear: (slot: number) => void;
  /** §I3a: an empty bracket is the way to the bench that fills it. */
  onGo: (path: string) => void;
}) {
  const fitted = slot.modificationId === null ? undefined : findModification(slot.modificationId);

  if (fitted) {
    /*
     * The card as the yard's bench draws it (maintainer, 2026-10-08): the mark on its plate, the
     * name and the grade, and what it does. The longer sentence about it is on the hover, read off
     * the catalogue rather than the district payload, so the bench and this card say the same
     * thing.
     */
    return (
      <li
        className={cn(SLOT_CARD, SLOT_WELL, 'border-bile-300/50')}
        data-testid={`slot-${kind}-${slot.index}`}
        data-tip={`${fitted.name} · ${describeAddonEffect(fitted)}. ${fitted.description}`}
      >
        <SlotCardBody
          place={slot.index}
          plate={
            <YardPlate mark={{ kind: 'effect', effect: fitted.effect }} tone="bile" size="lg" />
          }
          title={<h4 className={cn(CARD_TITLE, 'text-ink-100')}>{fitted.name}</h4>}
          tag={<RarityTag rarity={fitted.rarity} />}
          body={<p className={cn(CARD_BODY, 'text-brass-300')}>{describeAddonEffect(fitted)}</p>}
          foot={
            /*
             * A verb, not a state (2026-09-14), and the yard's own verb (2026-09-16): the same act
             * in both places, so a player who learns Dismantle on the bench does not have to learn
             * a second word here.
             */
            <DrawnButton
              size="sm"
              tone="danger"
              data-sound="click"
              data-testid={`slot-clear-${kind}-${slot.index}`}
              disabled={clearing}
              onClick={() => onClear(slot.index)}
            >
              Dismantle
            </DrawnButton>
          }
        />
      </li>
    );
  }

  if (!slot.open) {
    return (
      <li
        className={cn(SLOT_CARD, 'border-surface-700 bg-surface-950/40')}
        data-testid={`slot-${kind}-${slot.index}`}
      >
        <SlotCardBody
          place={slot.index}
          plate={
            <span aria-hidden className={cn(PLATE, 'icon-plate text-ink-400')}>
              <Icon name="lock" className="h-7 w-7" />
            </span>
          }
          title={
            <span className={cn(CARD_TITLE, 'uppercase tracking-[0.1em] text-ink-300')}>
              Locked
            </span>
          }
          body={
            <p className={cn(CARD_BODY, 'text-ink-400')}>
              Opens at level <span className="tabular-nums text-ink-200">{slot.opensAtLevel}</span>
            </p>
          }
          foot={
            <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-400">
              Not yet
            </span>
          }
        />
      </li>
    );
  }

  /*
   * The whole empty bracket is the control, and what it does is open the bench (2026-09-16): the
   * yard cuts a card for a named structure and bolts it in on the same press, so the one useful
   * thing this card can do is take the player to the bench for *this* structure.
   */
  return (
    <li className="min-w-0" data-testid={`slot-${kind}-${slot.index}`}>
      <button
        type="button"
        onClick={() => onGo(`/game/scrapyard?view=modifications&bench=${kind}`)}
        data-testid={`slot-door-${kind}-${slot.index}`}
        data-sound="click"
        data-tip={`Slot ${slot.index + 1} · empty · cut one for ${BUILDING_CATALOG[kind].name} at the yard`}
        className={cn(
          SLOT_CARD,
          // The card takes the press, so it is the group the drawn button's face answers to.
          'group/drawn w-full cursor-pointer border-dashed border-verdigris-300/50 bg-surface-900/40 text-left transition-colors',
          'hover:border-verdigris-300 hover:bg-verdigris-500/10',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-verdigris-300',
        )}
      >
        <SlotCardBody
          place={slot.index}
          plate={
            <span aria-hidden className={cn(PLATE, 'icon-plate text-verdigris-100')}>
              <Icon name="build" className="h-7 w-7" />
            </span>
          }
          title={
            <span className={cn(CARD_TITLE, 'uppercase tracking-[0.1em] text-ink-200')}>Empty</span>
          }
          body={<span className={cn(CARD_BODY, 'text-ink-300')}>Nothing fitted yet</span>}
          foot={<DrawnLabel tone="blue">Cut one at the yard ›</DrawnLabel>}
        />
      </button>
    </li>
  );
}

/**
 * The building's own control at the foot of the window (maintainer, 2026-09-28).
 *
 * One per kind, or nothing: the Generator sells its burn, the Lab, the Garage, the Gauntlet and
 * the Scrapyard are doors to the screen where their work is, and the Nexus opens the payroll book.
 * These were panels in the body once, which is what gave every window a different shape.
 */
function StructureAction({
  kind,
  base,
  serverNow,
  receivedAt,
  onBoost,
  boostPending,
  boostOil,
  onGo,
  onPayroll,
  ceilings,
}: {
  kind: BuildingKind;
  base: Base;
  serverNow: string | undefined;
  receivedAt: number | undefined;
  onBoost: () => void;
  boostPending: boolean;
  boostOil: number | undefined;
  onGo: (path: string) => void;
  onPayroll: () => void;
  /** What the stores can hold, so a price past them says so rather than "short". */
  ceilings: StoreCeilings;
}) {
  switch (kind) {
    case 'generator':
      return (
        <BurnButton
          base={base}
          serverNow={serverNow}
          receivedAt={receivedAt}
          onBoost={onBoost}
          pending={boostPending}
          oil={boostOil ?? buildBoostOilCost(base.buildings)}
          ceilings={ceilings}
        />
      );
    case 'lab':
      // §B8: the Lab is the door to research, and research is no longer a tab.
      return (
        <DrawnButton
          size="sm"
          data-sound="click"
          data-testid="lab-open-research"
          onClick={() => onGo('/game/research')}
        >
          Open research
        </DrawnButton>
      );
    case 'garage':
      // §B11: straight to the machines, on the roster beside the people who ride them.
      return (
        <DrawnButton
          size="sm"
          data-sound="click"
          data-testid="garage-open"
          onClick={() => onGo('/game/units?tab=vehicles')}
        >
          Open the Garage
        </DrawnButton>
      );
    case 'gauntlet':
      return (
        <DrawnButton
          size="sm"
          data-sound="click"
          data-testid="gauntlet-open-units"
          onClick={() => onGo('/game/units')}
        >
          Open units
        </DrawnButton>
      );
    case 'scrapyard':
      // §B9: and the Scrapyard has a page of its own.
      return (
        <DrawnButton
          size="sm"
          data-sound="click"
          data-testid="scrapyard-open"
          onClick={() => onGo('/game/scrapyard')}
        >
          Open the Scrapyard
        </DrawnButton>
      );
    case CENTRAL_BUILDING:
      return (
        <DrawnButton
          size="sm"
          data-sound="click"
          data-testid="nexus-open-payroll"
          onClick={onPayroll}
        >
          Increase payroll
        </DrawnButton>
      );
    default:
      return null;
  }
}

/**
 * §B4: the Generator's paid burn, sold as one button.
 *
 * What it does is on the hover (`data-tip`), and while it is lit the button becomes the
 * countdown. The countdown is derived from the district's own stored timestamp on every render
 * rather than ticked, so it is correct after a reload and after the tab has been asleep: the same
 * reason every other clock in this game is a timestamp. Nothing to sell until the Generator
 * stands, so a vacant plot draws no button.
 */
function BurnButton({
  base,
  serverNow,
  receivedAt,
  onBoost,
  pending,
  oil,
  ceilings,
}: {
  base: Base;
  serverNow: string | undefined;
  receivedAt: number | undefined;
  onBoost: () => void;
  pending: boolean;
  /** The server's price for the burn (`/me`'s `buildBoostOil`), which the door charges. */
  oil: number;
  ceilings: StoreCeilings;
}) {
  // The district read's own clock, so a skewed machine reads the same burn as everyone else.
  const now = useServerClock(serverNow, receivedAt);
  const remainingMs = buildBoostRemainingMs(base.economy.buildBoostUntil, now);
  const over = overTheStores({ oil }, ceilings);
  if (buildingLevel(base.buildings, 'generator') <= 0) return null;

  return (
    <span
      className="inline-flex"
      data-testid="build-boost"
      data-tip={
        over ? `${BUILD_BOOST_OIL_LINE(oil)} ${overTheStoresText(over)}` : BUILD_BOOST_OIL_LINE(oil)
      }
    >
      {remainingMs > 0 ? (
        <DrawnButton size="sm" disabled data-testid="build-boost-remaining">
          Burning · <span className="tabular-nums">{formatDuration(remainingMs / 1000)}</span> left
        </DrawnButton>
      ) : (
        <DrawnButton
          size="sm"
          disabled={pending || base.resources.oil < oil}
          data-testid="build-boost-buy"
          onClick={onBoost}
        >
          {pending
            ? 'Lighting…'
            : over
              ? 'Stores too small'
              : base.resources.oil < oil
                ? 'Short of oil'
                : `Burn ${oil} oil`}
        </DrawnButton>
      )}
    </span>
  );
}

/**
 * One sentence, so the price and the promise cannot drift apart on the screen.
 *
 * Said the way `boostedQueue` does it (bug pass, 2026-10-02). It used to read "25% faster for 2
 * hours", and the burn takes a quarter off what is left of the whole queue however long it runs, so
 * a queue of six ten-hour orders lost about fifteen hours to one burn the copy priced at thirty
 * minutes.
 */
const BUILD_BOOST_OIL_LINE = (oil: number): string =>
  `${oil} oil takes ${BUILD_BOOST_PERCENT}% off the time left on every order already queued, and off any order placed in the next ${BUILD_BOOST_HOURS} hours.`;

/**
 * Why there is no next level, and whether that is the end of the road or a thing to go and do.
 *
 * The distinction is the point of the type. Three of these are **waiting**: a requirement not met,
 * a rung the Nexus has not signed for yet. One of them is **finished**: the structure is at the
 * last level the content has, and nothing the player does will ever add a row to this panel.
 *
 * They used to be one string, so the panel could not tell them apart and drew the finished case
 * with the same live heading as the waiting ones ("No order to give", which reads as a temporary
 * state). The finished case says so instead, which needs the caller to know which one it is
 * holding. It no longer *dims*: the panels are all one lit material since 2026-09-22, and a
 * structure at its ceiling is told so in words rather than by being greyed out.
 *
 * Judged against the *projected* district, the same reading the server's gate uses, so a player
 * who has already queued the Nexus level that unlocks this plot is told they can build, not told to
 * go and do the thing they have just done.
 */
type Ceiling = { maxed: boolean; line: string };

function ceilingReason(kind: BuildingKind, base: Base): Ceiling {
  const projected = projectedBuildings(base.buildings, base.buildQueue);
  // The structure's own ceiling, not the game's, and first, in the order the server refuses in: the
  // Garage and the Infirmary stop at 10, and telling a player at that rung that the Nexus or a
  // neighbour is in the way sends them off to buy levels that will never sign for an eleventh.
  const ceiling = levelCeilingFor(kind);
  if (atLevelCeiling(kind, projected)) {
    return { maxed: true, line: `LEVEL ${ceiling}, WHICH IS AS HIGH AS IT GOES` };
  }
  // Every unmet clause (§A1, §I3), not the Nexus rung alone: a structure can be waiting on another
  // building and on the crew's own level at the same time, and naming one of the three sends a
  // player off to do a thing that will not unlock it.
  const unmet = unmetForQueue(kind, base.buildings, base.buildQueue, base.level);
  if (unmet.length > 0) {
    return {
      maxed: false,
      line: `NEEDS ${unmet.map(describeBuildingRequirement).join(' · ').toUpperCase()}`,
    };
  }
  return {
    maxed: false,
    line: `CAPPED BY THE NEXUS (LV ${buildingLevel(projected, CENTRAL_BUILDING)})`,
  };
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
function Section({
  title,
  aside,
  grow = false,
  fill = false,
  children,
}: {
  title: string;
  /** A line set on the heading's right, after the title. */
  aside?: ReactNode;
  /** Fill the column: the two panels whose bottoms have to meet the rule together. */
  grow?: boolean;
  /**
   * Hand the panel's spare height to the body, for a child that spreads itself over it. The child
   * brings its own top padding, so it can match it to the gaps it spreads.
   */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    /*
     * Paper, and the same sheet the rest of the game is printed on now.
     *
     * `ink-frame card-paper-lit washed grain ... shadow-panel`: the feats ladders' stack with
     * the lit sheet in place of the ink-black one (maintainer, 2026-09-22: the building windows
     * are too dark). Those ladders are printed on the game's own shell; this is printed on a lit
     * paper Modal, where the same black reads as a hole rather than as a panel. No `rivets`, for
     * the reason none of them has it: rivets are punched tin and this is a sheet somebody drew on.
     *
     * The gaps are the deck's (`gap-3` on the grid and on the left column), not the panel's, so
     * the first panel's top and the last panel's bottom sit exactly where the columns do.
     */
    <section
      className={cn(
        'ink-frame card-paper-lit washed grain flex min-w-0 flex-col rounded-sm',
        'shadow-panel',
        grow && 'flex-1',
      )}
    >
      <h3
        className={cn(
          'relative px-3 pb-2 pt-2.5 font-stamp text-[15px] leading-none text-brass-300',
        )}
      >
        {/*
         * The name in a span of its own, and it is not decoration.
         *
         * `expectNothingClippedVertically` only measures elements with **no element children**,
         * on the reasoning that a parent is merely the box around whatever really got cut. Put
         * the drawn rule inside the `h3` and the heading acquires a child, so the heading's own
         * text drops out of the sweep and a panel title sliced by the fold goes unreported. The
         * text lives in a leaf; the rule is the leaf's sibling.
         */}
        <span>{title}</span>
        {aside !== undefined && (
          <span className="absolute inset-y-0 right-3 flex items-center pt-0.5">{aside}</span>
        )}
        {/* Hand-drawn, not a border: a heading underlined with a ruler reads as a spreadsheet.
            `inset-x-3` matches the padding, so the rule stops short of the drawn frame instead of
            running into it. */}
        <span aria-hidden className="ink-rule absolute inset-x-3 -bottom-[1px]" />
      </h3>
      <div className={cn('relative min-w-0 px-3 pb-3', fill ? 'flex flex-1 flex-col' : 'pt-2.5')}>
        {children}
      </div>
    </section>
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
