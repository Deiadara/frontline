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
  type Base,
  type BuildingKind,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { ApiRequestError } from '../../lib/api';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { StructureSprite } from './sprites';
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
  const queueFull = buildQueue.length >= MAX_BUILD_QUEUE;
  const brownout = nextLevel !== null && wouldBrownOut(kind, nextLevel, buildings);

  const slots = modificationCapacity(standing);
  const nextSlotAt = nextModificationSlotLevel(standing?.level ?? 0);

  return (
    <Modal onClose={onClose} labelledBy="structure-dialog-title" className="border-neon-cyan/30">
      {/* A plain block, not a <header>: `role=dialog` is not sectioning content, so a <header>
          here still maps to the page's `banner` landmark — the same ambiguity the district page
          dropped its own <header> to avoid, and it would make `locator('header')` match twice
          whenever a plot dialog is open. */}
      {/* `shrink-0` on both the header and the footer, so the only thing a short viewport
          squeezes is the scrollable body between them. Without it flexbox takes the space out of
          whichever child will give — and a header that gives up four pixels clips its own text
          against the modal's `max-h`, which is a defect no assertion about the *body* can see. */}
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-neon-cyan/15 px-5 py-4">
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.3em] text-neon-cyan/70">
            {standing ? `Level ${standing.level}` : unlocked ? 'Vacant plot' : 'Locked'}
          </p>
          <h2
            id="structure-dialog-title"
            className="mt-1 font-display text-lg font-bold tracking-[0.12em] text-steel-100"
          >
            {spec.name}
          </h2>
        </div>
        <span className="h-14 w-14 shrink-0">
          <StructureSprite kind={kind} built={standing !== undefined} />
        </span>
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <p className="font-body text-xs leading-relaxed text-steel-400">{spec.description}</p>
        <p className="font-body text-xs leading-relaxed text-neon-cyan/80">{spec.role}</p>

        <Row label={standing ? `Upgrade to level ${nextLevel ?? '—'}` : 'Construction cost'}>
          {cost === null ? (
            <span className="font-display text-[11px] tracking-[0.15em] text-steel-600">
              {ceilingReason(kind, base)}
            </span>
          ) : (
            <CostLine cost={cost} stock={resources} />
          )}
        </Row>

        {seconds !== null && (
          <Row label="Build time">
            <span className="font-display text-sm font-semibold tabular-nums text-steel-100">
              {formatDuration(seconds)}
            </span>
          </Row>
        )}

        <Row label="Power">
          <span className="font-display text-xs tabular-nums text-steel-300">
            {standing
              ? `Draws ${Math.round(buildingPowerDraw(kind, standing.level))}`
              : 'Draws nothing yet'}
            {nextLevel !== null &&
              ` → ${Math.round(buildingPowerDraw(kind, nextLevel))} at level ${nextLevel}`}
          </span>
        </Row>
        {brownout && (
          <p className="font-body text-xs leading-relaxed text-ember-300">
            That level would draw more than the Generator supplies. The district will keep working,
            slower, until the Generator catches up.
          </p>
        )}

        <Row label={`Modifications — ${slots.used} / ${slots.slots} slots`}>
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
          <p className="mt-1 font-body text-[11px] leading-relaxed text-steel-500">
            {nextSlotAt === null
              ? `All ${MAX_MODIFICATION_SLOTS} slots are open. Fit them from the Research page.`
              : `Next slot opens at level ${nextSlotAt}. Fitting one is Research work and needs a Lead Engineer.`}
          </p>
        </Row>

        {error !== null && error !== undefined && (
          <p role="alert" className="font-body text-xs leading-relaxed text-neon-magenta">
            {error instanceof ApiRequestError ? error.message : 'That did not go through'}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-steel-800 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          size="sm"
          disabled={cost === null || !affordable || queueFull || pending}
          onClick={onBuild}
        >
          {pending
            ? 'Working…'
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
    'flex items-center justify-between gap-3 border px-2 py-1 font-display text-[10px] uppercase tracking-[0.12em]',
    fitted ? 'border-neon-cyan/40 text-neon-cyan' : 'border-steel-800 text-steel-400',
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-steel-800 pt-3 first:border-t-0 first:pt-0">
      <span className="font-display text-[10px] uppercase tracking-[0.2em] text-steel-500">
        {label}
      </span>
      {children}
    </div>
  );
}
