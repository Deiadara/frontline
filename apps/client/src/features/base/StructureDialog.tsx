import {
  BUILDING_CATALOG,
  BUILDING_MAX_LEVEL,
  CENTRAL_BUILDING,
  MAX_BUILD_QUEUE,
  MAX_MODIFICATION_SLOTS,
  buildingBuildSeconds,
  buildingCost,
  buildingLevel,
  buildingPowerDraw,
  canAfford,
  findBuilding,
  isUnlockedForQueue,
  modificationCapacity,
  modificationsFor,
  nextModificationSlotLevel,
  nextQueuedLevel,
  projectedBuildings,
  structureLevelCap,
  wouldBrownOut,
  buildingNeedsParts,
  buildingParts,
  hasItems,
  ITEM_CATALOG,
  type Base,
  type BuildingKind,
  type ItemId,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { ApiRequestError } from '../../lib/api';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { ItemWindow } from '../market/MarketPage';
import { StructureSprite } from './sprites';
import { structureBonus } from './bonus';
import { formatDuration } from './format';

/**
 * One plot's dialog: what stands there, what the next level costs and takes, what it does, and the
 * one action that orders it (GDD §A1, §D3 — oil is what building and upgrading consume).
 *
 * Every gate the server enforces is mirrored here so the button is dead *with a reason* rather than
 * alive until a 409 — and it is mirrored by calling the same shared functions the route calls, so
 * the two cannot drift into disagreeing about why.
 */

interface StructureDialogProps {
  kind: BuildingKind;
  base: Base;
  pending: boolean;
  error: unknown;
  onBuild: () => void;
  onClose: () => void;
}

export function StructureDialog({
  kind,
  base,
  pending,
  error,
  onBuild,
  onClose,
}: StructureDialogProps) {
  const { buildings, buildQueue, resources } = base;
  const spec = BUILDING_CATALOG[kind];
  const standing = findBuilding(buildings, kind);

  const unlocked = isUnlockedForQueue(kind, buildings, buildQueue);
  const nextLevel = unlocked ? nextQueuedLevel(kind, buildings, buildQueue) : null;
  const cost = nextLevel === null ? null : buildingCost(kind, nextLevel, buildings);
  const seconds = nextLevel === null ? null : buildingBuildSeconds(kind, nextLevel, buildings);
  const affordable = cost !== null && canAfford(resources, cost);
  const partsInHand =
    nextLevel === null || hasItems(base.inventory, buildingParts(kind, nextLevel));
  const queueFull = buildQueue.length >= MAX_BUILD_QUEUE;
  const brownout = nextLevel !== null && wouldBrownOut(kind, nextLevel, buildings);

  const slots = modificationCapacity(standing);
  const nextSlotAt = nextModificationSlotLevel(standing?.level ?? 0);

  const bonus = structureBonus(kind, buildings, standing?.level ?? 0);
  const nextBonus = nextLevel === null ? null : structureBonus(kind, buildings, nextLevel);

  return (
    <Modal
      onClose={onClose}
      labelledBy="structure-dialog-title"
      size="wide"
      className="border-brass-300/30"
    >
      {/* A plain block, not a <header>: `role=dialog` is not sectioning content, so a <header>
          here still maps to the page's `banner` landmark — the same ambiguity the district page
          dropped its own <header> to avoid, and it would make `locator('header')` match twice
          whenever a plot dialog is open. */}
      {/* `shrink-0` on both the header and the footer, so the only thing a short viewport
          squeezes is the scrollable body between them. Without it flexbox takes the space out of
          whichever child will give — and a header that gives up four pixels clips its own text
          against the modal's `max-h`, which is a defect no assertion about the *body* can see. */}
      {/* The plate the town-view dialog is built around: the structure's own portrait, framed and
          riveted, with the level stamped on the frame. The painting on the district shows the
          building in its street at the size the street gives it; this is the one place a player
          sees the thing itself, which is what the delivered masters are for now that the plate
          paints its own buildings. Shown whether or not it is standing — dimmed when it is not,
          because "here is what you would be building" is the question a vacant plot is asking. */}
      <div className="flex shrink-0 items-stretch gap-4 border-b border-surface-600/60 px-5 py-4">
        {/* The picture, at a size worth opening a window for. It used to be an 80px thumbnail in
            the corner of a wall of type, which is a favicon rather than a portrait — and the point
            of this window is to show the player the building they just clicked. */}
        <span className="rivets relative block h-32 w-32 shrink-0 rounded-sm border border-brass-500/45 bg-surface-900/70 p-1.5">
          <StructureSprite kind={kind} built lit={standing !== undefined} />
          {standing === undefined && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-sm bg-surface-950/55"
            />
          )}
          <span
            className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap border border-brass-500/60 bg-surface-950 px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-brass-300"
            data-testid="structure-level-stamp"
          >
            {standing ? `Lv ${standing.level}` : unlocked ? 'Vacant' : 'Locked'}
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
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

          Not decoration — arithmetic. The window carries a portrait, prose, a bonus, a price, a
          clock, the grid and the modification slots, and stacking all of that in one column ran it
          past `max-h-[calc(100vh-2rem)]` at 720px and 800px tall, which put the modification list
          under the fold with nothing to say it was there. Two columns halve the run. Single column
          below `sm`, where there is no width to split. */}
      <div className="grid min-h-0 gap-x-5 gap-y-4 overflow-y-auto p-5 sm:grid-cols-2">
        {/* §A1 — what the order costs, which is what the window is opened to find out. First, and
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
              {/* §A1 — the handful of levels that ask for a part as well as a price. Kept apart
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

        {/* What the level actually buys and what it costs to run, from the same shared functions
            the server settles with — the two numbers somebody choosing between two upgrades is
            comparing, side by side rather than a column apart. */}
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
            <Stat label="Power">
              <span className="font-display text-[12px] tabular-nums text-ink-200">
                {standing
                  ? `Draws ${Math.round(buildingPowerDraw(kind, standing.level))}`
                  : 'Draws nothing yet'}
                {nextLevel !== null &&
                  ` → ${Math.round(buildingPowerDraw(kind, nextLevel))} at level ${nextLevel}`}
              </span>
            </Stat>
          </dl>
          {brownout && (
            <p className="mt-2.5 font-body text-xs leading-relaxed text-ember-300">
              That level would draw more than the Generator supplies. The district will keep
              working, slower, until the Generator catches up.
            </p>
          )}
        </Section>

        <Section title={`Modifications — ${slots.used} of ${slots.slots} slots`}>
          <ul className="flex flex-col gap-1.5">
            {modificationsFor(kind).map((mod) => {
              const fitted = standing?.modifications.includes(mod.id) ?? false;
              return (
                <li key={mod.id} className={cnRow(fitted)} data-testid={`modification-${mod.id}`}>
                  <span className="truncate">{mod.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {fitted ? 'FITTED' : `+${mod.magnitude}`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 font-body text-[12px] leading-relaxed text-ink-300">
            {nextSlotAt === null
              ? `All ${MAX_MODIFICATION_SLOTS} slots are open. Fit them from the Research page.`
              : `Next slot opens at level ${nextSlotAt}. Fitting one is Research work and needs a Lead Engineer.`}
          </p>
        </Section>

        <Section title="The place itself">
          <p className="font-body text-xs italic leading-relaxed text-ink-300">
            {spec.description}
          </p>
        </Section>

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
 * Why there is no next level: locked behind the Nexus, held down by it, or the end of the content.
 *
 * Judged against the *projected* district, the same reading the server's gate uses — so a player
 * who has already queued the Nexus level that unlocks this plot is told they can build, not told to
 * go and do the thing they have just done.
 */
function ceilingReason(kind: BuildingKind, base: Base): string {
  const projected = projectedBuildings(base.buildings, base.buildQueue);
  if (!isUnlockedForQueue(kind, base.buildings, base.buildQueue)) {
    return `NEEDS THE NEXUS AT LEVEL ${BUILDING_CATALOG[kind].requiresNexusLevel}`;
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
 * The body used to be a run of label-over-value rows separated by hairlines, which reads as one
 * long list of facts however it is arranged in columns — the player has to read every label to
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

/** A named figure inside a section: the label on the left, the number on the right. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
