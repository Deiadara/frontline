import { findPerk, type OverseerPreset } from '@frontline/shared';
import { perkDetail } from '../../components/PerkTags';
import { DrawnRule } from '../../components/ui/DrawnMarks';
import { AttributeRadar } from './AttributeRadar';
import { AttributeSheet } from './AttributeSheet';
import { OverseerPortrait } from './OverseerPortrait';

/**
 * One overseer's file, at the size a decision deserves (maintainer, 2026-09-22).
 *
 * The character-select screen used to show four of these at once, shrunk to thumbnails: a 20px
 * portrait, a two-line bio clamped mid-sentence, and the sheet set in 8px type. The pick is the
 * single most consequential thing a player does and it cannot be undone, so it is two steps now.
 * The first is four paintings. This is the second: the painting kept large, the bio whole, what
 * the signature is worth in words, and the full attribute sheet under it.
 *
 * **Two columns, not two rows.** The painting runs the full height of the file beside everything
 * written about the person. Stacked instead (portrait and text on top, attributes underneath),
 * the row's height came off the picture and the text ran out a third of the way down it, which
 * left a band of empty sheet across the middle of the one screen a player studies.
 *
 * Drawn rather than plated, on the lit sheet: `ink-frame card-paper-lit washed grain` is the
 * feats ladders' stack with the lighter ground under it. The ink-black one is right on the
 * game's own violet shell and wrong here, where the splash behind it is `surface-950` and a
 * black sheet on a black ground is a slab rather than a page.
 */
export function OverseerSheet({ preset }: { preset: OverseerPreset }) {
  const perks = preset.perks.flatMap((id) => {
    const perk = findPerk(id);
    return perk ? [perk] : [];
  });

  return (
    <article
      className="ink-frame card-paper-lit washed grain flex w-full flex-col gap-4 rounded-sm p-4 shadow-panel sm:p-5"
      data-testid={`overseer-sheet-${preset.presetId}`}
    >
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-6">
        {/* The painting takes the height of whatever is written beside it. `fill` is what makes
            that true: the shape is the column's rather than the picture's, so there is no band
            of empty sheet under a 3:4 box that the text could not fill. */}
        <div className="w-full shrink-0 sm:w-[clamp(12rem,26vw,21rem)]">
          <div className="h-full min-h-[17rem] overflow-hidden rounded-sm">
            <OverseerPortrait
              portraitId={preset.portraitId}
              archetype={preset.archetype}
              showTag={false}
              aspect="fill"
              className="rounded-sm border-brass-500/40"
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="min-w-0 break-words font-stamp text-[clamp(22px,3vw,34px)] leading-none text-ink-100">
                  {preset.name}
                </h2>
                <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.24em] text-brass-300">
                  {preset.archetype}
                </span>
              </div>
              <span aria-hidden className="block h-1.5 w-full text-ink-300/50">
                <DrawnRule />
              </span>
              {/* Whole, not clamped. The bio is three lines in this column and the clamp cut every
                one of them mid-word on the one screen a player is choosing *on* the description. */}
              <p className="font-body text-[13px] leading-relaxed text-ink-200">{preset.bio}</p>
            </div>

            {/* The radar beside the name rather than under it: it is a shape, and the numbers at
              the foot of the file are the same facts said exactly. Dropped below `lg`, where the
              column it would take is the column the bio needs. */}
            <div className="hidden h-36 w-36 shrink-0 lg:block">
              <AttributeRadar attributes={preset.attributes} />
            </div>
          </div>

          {/* What the signature is worth, in the same words every other screen prints under a
              perk. A name and a flavour line is not a reason to choose somebody. */}
          <ul className="flex flex-col gap-2" data-testid="overseer-sheet-perks">
            {perks.map((perk) => (
              <li
                key={perk.id}
                className="flex min-w-0 flex-col gap-0.5 border-l-2 border-warning/60 pl-2.5"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-[11px] uppercase tracking-[0.18em] text-warning">
                    {perk.name}
                  </span>
                  <span className="font-display text-[12px] tracking-[0.02em] text-brass-300">
                    {perkDetail(perk.id)}
                  </span>
                </span>
                <span className="font-body text-[12px] leading-relaxed text-ink-300">
                  {perk.description}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/*
       * The numbers, across the whole file rather than in the column beside the painting.
       *
       * Four groups across needs the width: in the narrower column the long labels
       * ("Improvisation", "Communication") ran out of their columns at 1280, and two groups
       * across made the block tall enough to push the file past the foot of the screen.
       */}
      <div className="border-t border-surface-600/70 pt-3">
        <AttributeSheet attributes={preset.attributes} columns={4} />
      </div>
    </article>
  );
}
