import {
  ITEM_CATALOG,
  blueprintOfPage,
  findBlueprint,
  findBlueprintPage,
  type ItemId,
  type ItemKind,
} from '@frontline/shared';
import { useId, type JSX } from 'react';
import { cn } from '../../lib/cn';
import { BlueprintGlyph, PageGlyph, type GlyphSize } from '../research/BlueprintGlyph';

/**
 * The picture on an item.
 *
 * Procedural, and drawn per *kind* for the goods: eighteen hand-drawn glyphs is a lot of somebody's
 * time for a system that mostly needs a player to tell a part from a trinket at a glance.
 *
 * **Pages and assembled documents are the exception, and they are the reason this file has a
 * branch in it.** There are a hundred and sixty pages and a page is a thing a player collects one
 * at a time, so "all pages look alike" is not a shortcut there, it is the feature failing. Those
 * go to `BlueprintGlyph`, which draws each one its own sheet in its own rarity ink. The six
 * pre-war `blueprint_*` goods are not in that catalogue and keep the kind glyph below.
 *
 * Item art is deliberately **not** in `ART_MANIFEST` yet. Adding eighteen keys would put eighteen
 * lines on the maintainer's order sheet for a feature whose art has not been designed, and the order
 * sheet is a list the board works through. When those masters are wanted, the keys go in the
 * manifest as `item-<id>` and this component grows the same `deliveredUrl` lookup every other
 * asset-backed component already has: one function call, no other change.
 *
 * The five kinds are drawn to be distinguishable in silhouette, not in colour, so they still read
 * at 24px and for a player who cannot separate the palette's greens from its purples.
 */

const GLYPHS: Record<ItemKind, JSX.Element> = {
  // A folded sheet with a corner turned: knowledge, and the one thing here that is paper.
  blueprint: (
    <>
      <path
        d="M4 3.5h5.5L12.5 6.5V12.5H4z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M9.4 3.6v3h3" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <path d="M5.8 8.4h5M5.8 10.3h5" stroke="currentColor" strokeWidth="1" />
    </>
  ),
  // A single sheet with a torn edge down one side. Every page in the game now draws its own sheet
  // through `PageGlyph` above, so this is the kind's fallback and nothing reaches it today: the
  // record has to be total over `ItemKind`, and a page item invented outside the blueprint
  // catalogue would still get paper rather than a blank box.
  page: (
    <>
      <path
        d="M4.6 3.4h4.9l2.9 2.9v6.3H4.6z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M4.6 3.4l1.1 1.4-1.1 1.4 1.1 1.4-1.1 1.4 1.1 1.4-1.1 1.4"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <path d="M7.4 8.2h3.2M7.4 10.1h3.2" stroke="currentColor" strokeWidth="1" />
    </>
  ),
  // A cog: a part, and the only round silhouette of the five.
  component: (
    <>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="8" cy="8" r="1.1" stroke="currentColor" strokeWidth="1" fill="none" />
      <path
        d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M4 4l1.1 1.1M10.9 10.9L12 12M12 4l-1.1 1.1M5.1 10.9L4 12"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </>
  ),
  // A faceted stone: worth money and nothing else.
  // A pressure plate over a charge: a board, and the thing under it. Built to go off once.
  consumable: (
    <>
      <path d="M2.8 6.2h10.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M4.2 6.2v1.6M11.8 6.2v1.6"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M8 8.6l1.9 1.6-0.7 2.6H6.8l-0.7-2.6z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 8.6V7.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
};

/**
 * The goods, each drawn as itself (maintainer request, 2026-09-10).
 *
 * The kind glyphs above were a shortcut that held while an item was a line in a list. The Runner's
 * barrow is six plates a player scans, and six cogs in a row is a barrow that says nothing until
 * it is read. So every good has a drawing of its own now, in the same 16 by 16 box and the same
 * pen: a servo is a motor with a shaft, a gyro is three rings, a Rotor Hub is the hub and its
 * blades. Anything not named here (the six pre-war `blueprint_*` goods, a good added tomorrow) keeps
 * its kind glyph, so the record need not be total.
 */
const S = {
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
/**
 * The eight components, drawn rather than plotted (maintainer request, 2026-09-14).
 *
 * These were exact geometry: true circles, right angles, paths that closed on themselves to the
 * pixel. Correct, legible, and completely at odds with a screen whose frames, rules, buttons and
 * seals are all pen strokes that wobble and overshoot. Next to a hand-inked frame an exact octagon
 * reads as a placeholder, which is what "boring" meant.
 *
 * Two changes and they are both the house idiom. Every path now has a hand in it: corners run past
 * where they should stop, opposite sides disagree by a fraction, a circle is drawn as two arcs that
 * do not quite meet. And the whole glyph goes through the same `feTurbulence` and
 * `feDisplacementMap` pair that `ClaimButton`, `.ink-box` and `PortraitFrame` use, which is what
 * turns a clean stroke into an inked one.
 *
 * The silhouettes are unchanged on purpose. A player already knows a Coolant Cell by its shape, and
 * the point of this pass was the line quality rather than a new vocabulary of pictures.
 */
const GOOD_GLYPHS: Partial<Record<ItemId, JSX.Element>> = {
  // A servo can: unit, spindle, mounting feet, and the seam across the middle.
  scrap_servo: (
    <>
      <path d="M3.1 5.4 L10.1 5.2 L9.9 10.6 L2.9 10.4 Z" {...S} />
      <path d="M10 8.1 L13.1 7.9 M13 6.9 L13.2 9.2 M1.4 8.2 L3 8.05" {...S} />
      <path d="M4.4 10.5 L4.6 12.6 M8.4 10.5 L8.7 12.5" {...S} />
      <path d="M5 7.4 Q6.5 7.7 8.1 7.3" {...S} strokeWidth={0.85} />
    </>
  ),
  // A gyro: an outer ring drawn in two passes, with two gimbals inside it.
  gyro_assembly: (
    <>
      <path d="M13.4 8.2 A5.4 5.4 0 1 1 8 2.6 A5.5 5.5 0 0 1 13.5 7.9" {...S} />
      <path d="M2.7 8.2 Q8 5.6 13.3 8.1 Q8 10.7 2.7 8.2" {...S} strokeWidth={0.95} />
      <path d="M8.1 2.8 Q5.4 8 8 13.2 Q10.7 8 8.05 2.9" {...S} strokeWidth={0.95} />
      <circle cx="8" cy="8.1" r="0.85" fill="currentColor" stroke="none" />
    </>
  ),
  // A plate: a hex cut from sheet, with the inner lamination showing.
  ceramic_plate: (
    <>
      <path d="M8 2.1 L13.1 5.2 L12.9 10.9 L8 13.9 L3 10.8 L3.2 5.1 Z" {...S} />
      <path
        d="M8 5.5 L10.4 6.95 L10.3 9.7 L8 11 L5.6 9.55 L5.75 6.85 Z"
        {...S}
        strokeWidth={0.85}
      />
      <path d="M3.2 5.1 L4.4 4.4" {...S} strokeWidth={0.8} />
    </>
  ),
  // A lens cluster: the big eye, its iris, and a smaller one behind it on a stalk.
  optic_cluster: (
    <>
      <path d="M11.2 9.1 A4.2 4.2 0 1 1 7 4.85 A4.25 4.25 0 0 1 11.25 8.8" {...S} />
      <path
        d="M8.6 9.1 A1.6 1.6 0 1 1 7 7.45 A1.65 1.65 0 0 1 8.65 8.9"
        {...S}
        strokeWidth={0.95}
      />
      <path
        d="M14 4.1 A1.8 1.8 0 1 1 12.2 2.3 A1.85 1.85 0 0 1 13.95 3.9"
        {...S}
        strokeWidth={0.95}
      />
      <path d="M9.7 6.3 Q10.3 5.7 10.9 5.2" {...S} strokeWidth={0.85} />
    </>
  ),
  // A shunt: the housing, the pins under it, and the lead going up out of the top.
  neural_shunt: (
    <>
      <path d="M5.1 3.4 L11 3.6 L10.8 9.1 L4.9 8.9 Z" {...S} />
      <path d="M6.5 9 L6.7 13.4 M9.3 9 L9.5 13.3 M8 3.5 L7.9 1.4" {...S} />
      <path d="M6.5 6.1 Q8 6.4 9.5 6" {...S} strokeWidth={0.85} />
      <path d="M4.9 8.9 L4.2 9.4" {...S} strokeWidth={0.8} />
    </>
  ),
  // A cell: a canister with a cap, two fill lines, and a rounded foot.
  coolant_cell: (
    <>
      <path
        d="M5 3.7 L11 3.9 L10.85 12.4 Q10.8 13.9 9.4 13.95 L6.5 13.9 Q5.1 13.85 5.05 12.4 Z"
        {...S}
      />
      <path d="M6.4 3.75 L6.5 1.9 L9.5 2 L9.45 3.85" {...S} strokeWidth={0.95} />
      <path
        d="M5.05 7.05 Q8 7.35 10.95 6.95 M5.05 9.85 Q8 10.15 10.9 9.75"
        {...S}
        strokeWidth={0.9}
      />
    </>
  ),
  // A rotor hub: the boss, and three blades running off it at unequal lengths.
  rotor_hub: (
    <>
      <path d="M10 8.6 A2 2 0 1 1 8 6.55 A2.05 2.05 0 0 1 10.05 8.4" {...S} />
      <path d="M8 6.5 L7.85 1.4 M9.75 9.6 L14.1 12.2 M6.3 9.5 L1.9 11.9" {...S} />
      <path d="M7.85 1.4 L8.7 2.1 M14.1 12.2 L13.1 12.4" {...S} strokeWidth={0.8} />
      <circle cx="8" cy="8.55" r="0.55" fill="currentColor" stroke="none" />
    </>
  ),
  // A bundle of welding rod, banded, with one pulled out of it.
  weld_rod: (
    <>
      <path
        d="M4.4 12.9 L11.2 3.1 M6.2 13.2 L12.8 3.4 M8 13.3 L14.2 3.6"
        {...S}
        strokeWidth={1.05}
      />
      <path d="M5.4 9.2 Q9 8.2 12.6 7" {...S} strokeWidth={1.15} />
      <path d="M2 13.6 L5.6 8.5" {...S} strokeWidth={0.95} />
      <path d="M2 13.6 L2.9 13.2" {...S} strokeWidth={0.8} />
    </>
  ),
  // A ram: the cylinder, the rod out of one end, and the eye it pins through.
  hydraulic_ram: (
    <>
      <path d="M2.4 5.9 L9.1 5.7 L9 10.4 L2.3 10.2 Z" {...S} />
      <path d="M9.05 8 L12.6 7.9" {...S} strokeWidth={1.3} />
      <path d="M14.4 8 A1.5 1.5 0 1 1 12.9 6.5 A1.55 1.55 0 0 1 14.35 7.8" {...S} strokeWidth={1} />
      <path d="M3.9 5.8 L3.8 10.3 M6 5.75 L5.95 10.3" {...S} strokeWidth={0.8} />
    </>
  ),
  // A relay board: the case, the aerial stub, and the waves coming off it.
  signal_relay: (
    <>
      <path d="M3.2 7.4 L9.6 7.2 L9.5 12.6 L3.1 12.4 Z" {...S} />
      <path d="M6.3 7.3 L6.2 4.4" {...S} />
      <path d="M4.6 9.5 L8.1 9.4 M4.6 11 L6.8 10.9" {...S} strokeWidth={0.8} />
      <path d="M11 6.2 Q12.6 8 11.1 9.9 M12.9 4.6 Q15.3 8 13 11.4" {...S} strokeWidth={0.95} />
    </>
  ),
  // A valve: the unit, the gland, and the handwheel across the top.
  pressure_valve: (
    <>
      <path d="M5 7.6 L11 7.4 L10.9 11.9 L4.9 11.7 Z" {...S} />
      <path d="M1.8 9.7 L5 9.6 M11 9.5 L14.2 9.4" {...S} strokeWidth={1.2} />
      <path d="M7.9 7.5 L7.85 4.9" {...S} />
      <path d="M5.3 4.7 Q8 3.5 10.7 4.6" {...S} strokeWidth={1.1} />
      <path d="M5.3 4.7 L5.9 5.3" {...S} strokeWidth={0.8} />
    </>
  ),
  // A targeting core: the block, the bracket lugs on all four sides, and the reticle.
  targeting_core: (
    <>
      <path d="M4.1 3.9 L12 4.1 L11.9 12.1 L3.9 11.9 Z" {...S} />
      <path
        d="M2.4 6 L4.05 5.9 M2.4 10 L4 10.05 M11.95 5.95 L13.6 5.85 M11.9 10.05 L13.5 10 M6 2.4 L5.9 4.05 M10 2.5 L9.95 4.05 M6.05 11.95 L5.95 13.6 M10 11.95 L10.05 13.5"
        {...S}
        strokeWidth={0.95}
      />
      <path d="M9.8 8.1 A1.8 1.8 0 1 1 8 6.2 A1.85 1.85 0 0 1 9.75 7.9" {...S} strokeWidth={0.95} />
    </>
  ),
};

const TINT: Record<ItemKind, string> = {
  blueprint: 'text-iris-100',
  page: 'text-iris-300',
  component: 'text-verdigris-100',
  consumable: 'text-oxblood-100',
};

export function ItemGlyph({
  id,
  size = 'md',
  className,
}: {
  id: ItemId;
  /** How much detail a blueprint or page glyph draws. Ignored by the five kind glyphs. */
  size?: GlyphSize | undefined;
  className?: string | undefined;
}) {
  const filterId = useId().replace(/:/g, '');
  const page = findBlueprintPage(id);
  const document = page === undefined ? undefined : blueprintOfPage(id);
  if (page !== undefined && document !== undefined) {
    return <PageGlyph page={page} blueprint={document} size={size} className={className} />;
  }
  const blueprint = findBlueprint(id);
  if (blueprint !== undefined) {
    return <BlueprintGlyph blueprint={blueprint} size={size} className={className} />;
  }
  const spec = ITEM_CATALOG[id];
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      className={cn(TINT[spec.kind], className)}
    >
      {/*
       * The pen, not the plotter.
       *
       * Same `feTurbulence` + `feDisplacementMap` pair as `ClaimButton`, `.ink-box` and
       * `PortraitFrame`, so an item glyph is made with the same instrument as the frame around it.
       * The scale is small (0.25 on a 16-unit box, so a quarter of a stroke width) because these
       * are drawn at 16 to 24px: the wobble that reads as a hand on a 120px button reads as damage
       * at this size. What it buys is that no two edges are quite parallel.
       *
       * The id has to be unique per instance. A page drawing forty of these shares one document,
       * and duplicate filter ids there mean every glyph resolves to whichever one mounted first.
       */}
      <defs>
        <filter id={`ink-${filterId}`} x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="9" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="0.25"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#ink-${filterId})`}>{GOOD_GLYPHS[id] ?? GLYPHS[spec.kind]}</g>
    </svg>
  );
}
