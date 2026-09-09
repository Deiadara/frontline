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
 * lines on the board's order sheet for a feature whose art has not been designed, and the order
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
      {GLYPHS[spec.kind]}
    </svg>
  );
}
