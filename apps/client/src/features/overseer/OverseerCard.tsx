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
        'group flex min-h-0 snap-start flex-col border bg-surface-900 text-left transition-all duration-150',
        selected ? 'border-brass-300 shadow-brass' : 'border-surface-600 hover:border-brass-300/50',
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
          <h3 className="truncate font-display text-sm font-bold tracking-wide text-ink-100">
            {preset.name}
          </h3>
          <span className="mt-0.5 w-fit border border-brass-300/30 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.2em] text-brass-300">
            {preset.archetype}
          </span>
          {/* Two lines, not three. The sheet under this card grew by two rows when the attribute
              model was reworked, and at 1280x800 the fourth card was the one that paid for it. */}
          <p className="mt-1.5 line-clamp-2 font-body text-[12px] leading-relaxed text-ink-300">
            {preset.bio}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {preset.traits.map((traitId) => (
              <span
                key={traitId}
                data-tip={TRAIT_CATALOG[traitId].description}
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

      <div className="border-t border-surface-700 px-2 py-1.5">
        {/* Four groups and no bars: this card is a thumbnail a player compares four of at once, and
            at 488px a bar costs the width `Communication` needs. See `AttributeSheet`. */}
        <AttributeSheet attributes={preset.attributes} columns={4} bars={false} />
      </div>
    </button>
  );
}
