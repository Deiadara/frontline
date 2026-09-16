import { findPerk, type OverseerPreset } from '@frontline/shared';
import { Fragment } from 'react';
import { cn } from '../../lib/cn';
import { perkDetail } from '../../components/PerkTags';
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
      // §F6: which four a player is shown is the server's answer and changes as the pool drains,
      // so a browser test cannot press a character by name any more. This is the stable handle.
      data-testid={`overseer-card-${preset.presetId}`}
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
              model was reworked, and at 1280x800 the fourth card was the one that paid for it.

              The rest of the line is on the hover rather than nowhere. Every bio here runs to
              three lines in this column, so the clamp cut all four of them mid-word on the one
              screen where a player is choosing *on* the description: an ellipsis with nothing
              behind it is the shortened half of a sentence and no way to read the other half. */}
          <p
            data-tip={preset.bio}
            className="mt-1.5 line-clamp-2 font-body text-[12px] leading-relaxed text-ink-300"
          >
            {preset.bio}
          </p>
          {/* The signature, with what it is worth beside it.

              The chip used to be the whole of it: a name and a flavour line on the hover, on the
              one screen a player cannot come back to. Every other screen in the game prints
              `describePerkBonus` under a perk, so the +5 that decides a whole run was readable
              only on the profile page you reach *after* choosing.

              On the chip's own row rather than under it, and at 10px: the radar beside this column
              is 128px tall and sets the card's height, so a bonus that fits on the line the chip
              is already using costs the card nothing. */}
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {preset.perks
              .map((id) => findPerk(id))
              .map(
                (perk) =>
                  perk && (
                    <Fragment key={perk.id}>
                      <span
                        data-tip={perk.description}
                        className="border border-warning/40 px-1.5 py-0.5 font-display text-[8px] uppercase tracking-[0.15em] text-warning"
                      >
                        {perk.name}
                      </span>
                      <span className="font-display text-[10px] leading-tight tracking-[0.02em] text-brass-300">
                        {perkDetail(perk.id)}
                      </span>
                    </Fragment>
                  ),
              )}
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
