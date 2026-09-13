import {
  ITEM_CATALOG,
  blueprintOfPage,
  findBlueprint,
  findBlueprintPage,
  type ItemId,
  type ItemKind,
} from '@frontline/shared';
import type { JSX } from 'react';
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
  relic: (
    <>
      <path
        d="M8 2.6l4.6 3.1-1.7 6.6H5.1L3.4 5.7z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M3.4 5.7h9.2M8 2.6v9.7" stroke="currentColor" strokeWidth="1" />
    </>
  ),
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
const GOOD_GLYPHS: Partial<Record<ItemId, JSX.Element>> = {
  scrap_servo: (
    <>
      <path d="M3 5.5h7v5H3z" {...S} />
      <path d="M10 8h3M13 7v2M1.5 8H3M4.5 10.5v2M8.5 10.5v2" {...S} />
      <path d="M5 7.5h3" {...S} strokeWidth={0.9} />
    </>
  ),
  gyro_assembly: (
    <>
      <circle cx="8" cy="8" r="5.5" {...S} />
      <path d="M2.5 8a5.5 2.2 0 1 0 11 0a5.5 2.2 0 1 0-11 0" {...S} strokeWidth={1} />
      <path d="M8 2.5a2.2 5.5 0 1 0 0 11a2.2 5.5 0 1 0 0-11" {...S} strokeWidth={1} />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  ceramic_plate: (
    <>
      <path d="M8 2.2l5 2.9v5.8l-5 2.9-5-2.9V5.1z" {...S} />
      <path d="M8 5.6l2.3 1.3v2.7L8 10.9 5.7 9.6V6.9z" {...S} strokeWidth={0.9} />
    </>
  ),
  optic_cluster: (
    <>
      <circle cx="7" cy="9" r="4.2" {...S} />
      <circle cx="7" cy="9" r="1.6" {...S} strokeWidth={1} />
      <circle cx="12.2" cy="4" r="1.8" {...S} strokeWidth={1} />
      <path d="M9.8 6.2l1-1" {...S} strokeWidth={0.9} />
    </>
  ),
  neural_shunt: (
    <>
      <path d="M5 3.5h6v5.5H5z" {...S} />
      <path d="M6.6 9v4.5M9.4 9v4.5M8 3.5V1.5" {...S} />
      <path d="M6.6 6.2h2.8" {...S} strokeWidth={0.9} />
    </>
  ),
  coolant_cell: (
    <>
      <path d="M5 3.8h6v8.7a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 5 12.5z" {...S} />
      <path d="M6.5 3.8V2h3v1.8M5 7h6M5 9.8h6" {...S} strokeWidth={1} />
    </>
  ),
  rotor_hub: (
    <>
      <circle cx="8" cy="8.5" r="2" {...S} />
      <path d="M8 6.5V1.5M9.7 9.5l4.3 2.5M6.3 9.5L2 12" {...S} />
      <circle cx="8" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  targeting_core: (
    <>
      <path d="M4 4h8v8H4z" {...S} />
      <path
        d="M2.5 6h1.5M2.5 10h1.5M12 6h1.5M12 10h1.5M6 2.5V4M10 2.5V4M6 12v1.5M10 12v1.5"
        {...S}
        strokeWidth={1}
      />
      <circle cx="8" cy="8" r="1.8" {...S} strokeWidth={1} />
      <path d="M8 5.4v1M8 9.6v1M5.4 8h1M9.6 8h1" {...S} strokeWidth={0.9} />
    </>
  ),
  combine_seal: (
    <>
      <circle cx="8" cy="8" r="5.6" {...S} />
      <path
        d="M8 4.3l1.1 2.3 2.5.3-1.8 1.7.5 2.5L8 9.9l-2.3 1.2.5-2.5L4.4 6.9l2.5-.3z"
        {...S}
        strokeWidth={1}
      />
    </>
  ),
  pre_collapse_ledger: (
    <>
      <path d="M4 2.6h7a1.4 1.4 0 0 1 1.4 1.4v9.4H5.4A1.4 1.4 0 0 1 4 12z" {...S} />
      <path d="M4 12a1.4 1.4 0 0 1 1.4-1.4h7M6.6 5.6h3.4M6.6 8h3.4" {...S} strokeWidth={1} />
    </>
  ),
  ivory_dice: (
    <>
      <path d="M7.2 2.6h6.2v6.2H7.2z" {...S} />
      <path d="M2.6 7.2h6.2v6.2H2.6z" fill="rgb(20 18 26)" {...S} />
      <circle cx="10.3" cy="5.7" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="9" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="7" cy="11.6" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="5.7" cy="10.3" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
};

const TINT: Record<ItemKind, string> = {
  blueprint: 'text-iris-100',
  page: 'text-iris-300',
  component: 'text-verdigris-100',
  relic: 'text-brass-300',
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
      {GOOD_GLYPHS[id] ?? GLYPHS[spec.kind]}
    </svg>
  );
}
