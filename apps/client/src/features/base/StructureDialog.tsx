import {
  BUILDING_CATALOG,
  BUILDING_MAX_LEVEL,
  buildingCost,
  canAfford,
  nextStructureLevel,
  type Building,
  type BuildingKind,
  type Resources,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { ApiRequestError } from '../../lib/api';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { StructureSprite } from './sprites';

/**
 * One structure's plot dialog: what stands there, what the next level costs, and the one action
 * that raises it (GDD §A1 the village, §D3 oil is what building and upgrading consume).
 *
 * Every gate the server enforces is mirrored here so the button is dead *with a reason* rather
 * than alive until a 409 — the shared `nextStructureLevel` / `buildingCost` are the same functions
 * the route runs, so the two cannot drift.
 */

interface StructureDialogProps {
  kind: BuildingKind;
  buildings: readonly Building[];
  resources: Resources;
  pending: boolean;
  error: unknown;
  onBuild: () => void;
  onClose: () => void;
}

export function StructureDialog({
  kind,
  buildings,
  resources,
  pending,
  error,
  onBuild,
  onClose,
}: StructureDialogProps) {
  const spec = BUILDING_CATALOG[kind];
  const standing = buildings.find((building) => building.kind === kind);
  const nextLevel = nextStructureLevel(kind, buildings);
  const cost = nextLevel === null ? null : buildingCost(kind, nextLevel);
  const affordable = cost !== null && canAfford(resources, cost);

  return (
    <Modal onClose={onClose} labelledBy="structure-dialog-title" className="border-neon-cyan/30">
      {/* A plain block, not a <header>: `role=dialog` is not sectioning content, so a <header>
          here still maps to the page's `banner` landmark — the same ambiguity BasePanel dropped
          its own <header> to avoid, and it would make `locator('header')` match twice whenever a
          plot dialog is open. */}
      <div className="flex items-start justify-between gap-4 border-b border-neon-cyan/15 px-5 py-4">
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.3em] text-neon-cyan/70">
            {standing ? `Level ${standing.level}` : 'Vacant plot'}
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

        <Row label={standing ? `Upgrade to level ${nextLevel ?? '—'}` : 'Construction cost'}>
          {cost === null ? (
            <span className="font-display text-[11px] tracking-[0.15em] text-steel-600">
              {ceilingReason(kind, buildings)}
            </span>
          ) : (
            <CostLine cost={cost} stock={resources} />
          )}
        </Row>

        {error !== null && error !== undefined && (
          <p role="alert" className="font-body text-xs leading-relaxed text-neon-magenta">
            {error instanceof ApiRequestError ? error.message : 'That did not go through'}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-end gap-3 border-t border-steel-800 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button size="sm" disabled={cost === null || !affordable || pending} onClick={onBuild}>
          {pending ? 'Working…' : standing ? 'Upgrade' : 'Build'}
        </Button>
      </footer>
    </Modal>
  );
}

/** Why there is no next level: the end of the content, or the Command Center holding it down. */
function ceilingReason(kind: BuildingKind, buildings: readonly Building[]): string {
  if (kind === 'command_center') return `MAXED AT LEVEL ${BUILDING_MAX_LEVEL}`;
  const commandCenter = buildings.find((building) => building.kind === 'command_center');
  return commandCenter
    ? `CAPPED BY THE COMMAND CENTER (LV ${commandCenter.level})`
    : 'NEEDS A COMMAND CENTER FIRST';
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
