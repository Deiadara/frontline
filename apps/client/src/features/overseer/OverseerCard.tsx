import { TRAIT_CATALOG, type OverseerPreset } from '@frontline/shared';
import { cn } from '../../lib/cn';
import { AttributeRadar } from './AttributeRadar';
import { AttributeSheet } from './AttributeSheet';
import { OverseerPortrait } from './OverseerPortrait';

interface OverseerCardProps {
  preset: OverseerPreset;
  selected: boolean;
  onSelect: () => void;
}

/** One character-select option: portrait, bio, traits, group radar, and the full sheet. */
export function OverseerCard({ preset, selected, onSelect }: OverseerCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group flex min-h-0 snap-start flex-col border bg-night-raised text-left transition-all duration-150',
        selected
          ? 'border-neon-cyan shadow-neon-cyan'
          : 'border-steel-700 hover:border-neon-cyan/50',
      )}
    >
      <div className="flex gap-3 px-2 py-1.5">
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
          <p className="mt-1.5 line-clamp-3 font-body text-[11px] leading-relaxed text-steel-400">
            {preset.bio}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {preset.traits.map((traitId) => (
              <span
                key={traitId}
                title={TRAIT_CATALOG[traitId].description}
                className="border border-warning/40 px-1.5 py-0.5 font-display text-[8px] uppercase tracking-[0.15em] text-warning"
              >
                {TRAIT_CATALOG[traitId].name}
              </span>
            ))}
          </div>
        </div>
        <div className="h-32 w-32 shrink-0 self-start">
          <AttributeRadar attributes={preset.attributes} />
        </div>
      </div>

      <div className="border-t border-steel-800 px-2 py-1.5">
        <AttributeSheet attributes={preset.attributes} />
      </div>
    </button>
  );
}
