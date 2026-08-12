import type { Overseer, Resources } from '@frontline/shared';
import { RESOURCE_ORDER, ResourceChip } from '../../components/Resources';
import { OverseerPortrait } from '../overseer/OverseerPortrait';

interface TopHudProps {
  overseer: Overseer;
  resources: Resources;
}

/** Fixed-height top bar: resource readout on the left, overseer identity on the right. */
export function TopHud({ overseer, resources }: TopHudProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-neon-cyan/20 bg-night-raised px-4">
      <div className="flex items-center gap-3">
        <span className="text-glow-cyan hidden font-display text-lg font-black tracking-[0.2em] text-steel-100 sm:block">
          FRONTLINE
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {RESOURCE_ORDER.map((kind) => (
            <ResourceChip key={kind} kind={kind} value={resources[kind]} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="font-display text-xs font-semibold tracking-[0.15em] text-steel-100">
            {overseer.name}
          </p>
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-neon-cyan">
            {overseer.archetype}
          </p>
        </div>
        <div className="h-10 w-10 shrink-0">
          <OverseerPortrait
            portraitId={overseer.portraitId}
            archetype={overseer.archetype}
            aspect="square"
            showTag={false}
          />
        </div>
      </div>
    </header>
  );
}
