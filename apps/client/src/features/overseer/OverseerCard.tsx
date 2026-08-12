import type { OverseerPreset } from '@frontline/shared';
import { cn } from '../../lib/cn';
import { OverseerPortrait } from './OverseerPortrait';
import { SkillBars } from './SkillBars';
import { SkillRadar } from './SkillRadar';

interface OverseerCardProps {
  preset: OverseerPreset;
  selected: boolean;
  onSelect: () => void;
}

/** One character-select option: portrait, bio, skill bars, and radar. */
export function OverseerCard({ preset, selected, onSelect }: OverseerCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group flex min-h-0 flex-col border bg-night-raised text-left transition-all duration-150',
        selected
          ? 'border-neon-cyan shadow-neon-cyan'
          : 'border-steel-700 hover:border-neon-cyan/50',
      )}
    >
      <div className="flex gap-3 p-2">
        <div className="w-20 shrink-0">
          <OverseerPortrait
            portraitId={preset.portraitId}
            archetype={preset.archetype}
            showTag={false}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate font-display text-sm font-bold tracking-wide text-steel-100">
            {preset.name}
          </h3>
          <span className="mt-0.5 w-fit border border-neon-cyan/30 px-1.5 py-0.5 font-display text-[9px] uppercase tracking-[0.2em] text-neon-cyan">
            {preset.archetype}
          </span>
          <p className="mt-2 line-clamp-3 font-body text-[11px] leading-relaxed text-steel-400">
            {preset.bio}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-steel-800 p-2">
        <SkillBars skills={preset.skills} />
        <div className="h-20 w-20 shrink-0">
          <SkillRadar skills={preset.skills} />
        </div>
      </div>
    </button>
  );
}
