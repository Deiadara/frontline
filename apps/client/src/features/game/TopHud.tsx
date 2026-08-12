import { reputationOf, type EconomyState, type Overseer, type Resources } from '@frontline/shared';
import { MeterChip, ReputationChip } from '../../components/Meters';
import { RESOURCE_ORDER, ResourceChip } from '../../components/Resources';
import { OverseerPortrait } from '../overseer/OverseerPortrait';

interface TopHudProps {
  overseer: Overseer;
  resources: Resources;
  economy: EconomyState;
}

/**
 * Two-tier top bar: identity and street reputation up top, the stockpile and meters below.
 *
 * The economy row wraps rather than scrolling: chip widths grow with the digits in them, and at
 * 1024px a six-figure stockpile pushed the infamy meter off the end of a scroll container, where
 * nothing but a horizontal drag could reveal it. The shell is a `flex-col` with a `shrink-0`
 * header over a `flex-1 min-h-0` body, so a second row costs the map some height and clips
 * nothing.
 */
export function TopHud({ overseer, resources, economy }: TopHudProps) {
  const reputation = reputationOf(economy, new Date());

  return (
    <header className="flex shrink-0 flex-col border-b border-neon-cyan/20 bg-night-raised">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-glow-cyan hidden font-display text-lg font-black tracking-[0.2em] text-steel-100 sm:block">
            FRONTLINE
          </span>
          <ReputationChip label={reputation} />
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
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        {RESOURCE_ORDER.map((kind) => (
          <ResourceChip key={kind} kind={kind} value={resources[kind]} />
        ))}
        <span className="mx-1 h-5 w-px shrink-0 bg-steel-700" />
        <MeterChip kind="morale" value={economy.morale} />
        <MeterChip kind="infamy" value={economy.infamy} />
      </div>
    </header>
  );
}
