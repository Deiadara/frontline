import { findPerk, type OverseerPreset } from '@frontline/shared';
import type { ReactNode } from 'react';
import { perkDetail } from '../../components/PerkTags';
import { AttributeRadar } from './AttributeRadar';
import { AttributeSheet } from './AttributeSheet';
import { OverseerPortrait } from './OverseerPortrait';

/**
 * One overseer's file, drawn as the officer window (maintainer, 2026-09-22).
 *
 * The pick is the single most consequential thing a player does and it cannot be undone, so the
 * character screen is two steps: four paintings, then this. What this file is *for* is the same
 * job the crew screen's officer window does, which is to put everything known about one person on
 * one sheet, so it is now built out of the same parts rather than out of its own.
 *
 * ## Why it was rebuilt
 *
 * It used to be a bare two-column block: a portrait, a paragraph, a bulleted signature with a
 * coloured rule down its left, and four unframed columns of numbers. Nothing on it had an edge, so
 * nothing lined up with anything, and the eye had no way to tell the bio from the bonus from the
 * sheet except by type size. The maintainer asked for boxes, alignment, and the colour the rest of
 * the officer screens use.
 *
 * So: `glass-strong washed rivets` is the Modal's own material, which is what a player sees behind
 * every officer they have ever opened. The header band with the name and the rule under it is the
 * officer window's header. The portrait is the officer window's portrait, same frame, same 4:5.
 * Every block on the right is a {@link Field}, which is the frame `AttributeSheet` draws around a
 * group when it is `roomy`, so the bio, the signature and the four groups of numbers are six boxes
 * of one kind on one grid rather than four different treatments stacked up.
 *
 * ## Spacing
 *
 * One number, `p-5`, on the header and on the body alike, so the gap under the last row of
 * numbers is the gap above the name. The sheet used to run its content to within `p-4` of the
 * bottom edge while the top had a header's worth of air, and it read as though the card had been
 * cut off.
 */

/**
 * One titled box: the frame every part of this sheet is printed in.
 *
 * Deliberately the same recipe as a `roomy` attribute group (`edge-lit`, a `surface-600` hairline,
 * `bg-black/20`, a brass small-caps heading over a rule). Copied rather than imported because
 * `AttributeSheet` draws its own and exporting a box from it would make the sheet's layout
 * component own the styling of things that are not attributes.
 */
function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`edge-lit flex min-w-0 flex-col rounded-sm border border-surface-600/70 bg-black/20 p-2 ${className ?? ''}`}
    >
      <h3 className="mb-1.5 truncate border-b border-surface-600/80 pb-1 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
        {label}
      </h3>
      {children}
    </section>
  );
}

export function OverseerSheet({ preset }: { preset: OverseerPreset }) {
  const perks = preset.perks.flatMap((id) => {
    const perk = findPerk(id);
    return perk ? [perk] : [];
  });

  return (
    <article
      className="glass-strong washed rivets relative flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-sm border border-brass-300/40 shadow-panel"
      data-testid={`overseer-sheet-${preset.presetId}`}
    >
      {/*
       * The header band, lifted from the officer window: who this is, on the left, and the shape
       * of them on the right. The rule under it is a real border rather than a drawn mark, because
       * the whole point of this pass is that this sheet matches the others.
       */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-surface-600/60 px-5 py-3">
        <div className="min-w-0">
          <h2 className="break-words font-stamp text-[clamp(20px,2.6vw,30px)] leading-tight text-ink-100">
            {preset.name}
          </h2>
          <p className="mt-0.5 font-display text-[13px] uppercase tracking-[0.16em] text-brass-300">
            {preset.archetype}
          </p>
        </div>
        {/* The radar is a shape, and the numbers below say the same thing exactly. Dropped under
            `sm`, where the width it wants is the width the name needs. */}
        <div className="hidden h-16 w-16 shrink-0 sm:block">
          <AttributeRadar attributes={preset.attributes} />
        </div>
      </header>

      {/*
       * Portrait in a fixed column, everything written in the other one.
       *
       * `14rem` is the officer window's figure, so the two screens put the face in the same place
       * at the same size. Below `md` it stacks, and the portrait keeps its 4:5 rather than
       * stretching: a painting that changes shape with the viewport is the thing the `fill` crop
       * was doing wrong here before.
       */}
      {/*
       * The body scrolls, the header and the frame do not.
       *
       * This is the officer window's arrangement and it is here for the same reason: on a
       * 1280x720 laptop the file is taller than the space under the title, and the two buttons
       * are the one thing on this screen that must never be below the fold. Letting the page
       * scroll instead put `Confirm overseer` off the bottom of a screen whose entire job is to
       * be pressed. On a tall viewport nothing overflows and no scrollbar appears.
       */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        <div className="grid min-w-0 items-stretch gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
          <OverseerPortrait
            portraitId={preset.portraitId}
            archetype={preset.archetype}
            showTag={false}
            className="painted rivets edge-lit aspect-[4/5] w-full self-start border-2 border-brass-500/40"
          />

          {/*
           * Two boxes across where there is room for two, so the bio and the signature are a row
           * rather than a stack: it keeps the sheet short enough that the two buttons under it
           * stay on screen, and it puts the one bonus next to the description instead of
           * underneath it where it read as a footnote.
           */}
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            <Field label="Who they are">
              <p className="font-body text-[13px] leading-relaxed text-ink-200">{preset.bio}</p>
            </Field>

            {/* What the signature is worth, in the same words every other screen prints under a
                perk. A name and a flavour line is not a reason to choose somebody. */}
            <Field label={perks.length > 1 ? 'What they bring' : 'Signature'}>
              <ul className="flex flex-col gap-2" data-testid="overseer-sheet-perks">
                {perks.map((perk) => (
                  <li key={perk.id} className="flex min-w-0 flex-col gap-0.5">
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
            </Field>
          </div>
        </div>

        {/*
         * The numbers, as four boxes of the same kind as the two above them, across the **whole**
         * sheet rather than in the column beside the painting.
         *
         * They sat in that column for one pass and every label in all four groups came out
         * truncated: four groups inside 1fr of a `14rem + 1fr` grid is about 170px each at 1280,
         * and `Improvisation` does not fit in what is left after the bar and the figure. Across
         * the full width they get 255px and the words are whole, which is the difference between
         * a sheet and a sheet with ellipses on it.
         *
         * `roomy` is what draws the frames and equalises their heights, and it is the reason this
         * reads as a sheet: four bare columns of text was the part the maintainer called "just in
         * the middle".
         */}
        <AttributeSheet attributes={preset.attributes} columns={4} roomy />
      </div>
    </article>
  );
}
