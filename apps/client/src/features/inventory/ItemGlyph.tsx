import { ITEM_CATALOG, type ItemId, type ItemKind } from '@frontline/shared';
import type { JSX } from 'react';
import { cn } from '../../lib/cn';

/**
 * The picture on an item.
 *
 * Procedural, and drawn per *kind* rather than per item: eighteen hand-drawn glyphs is a lot of
 * somebody's time for a system that mostly needs a player to tell a blueprint from a part from a
 * trinket at a glance.
 *
 * Item art is deliberately **not** in `ART_MANIFEST` yet. Adding eighteen keys would put eighteen
 * lines on the board's order sheet for a feature whose art has not been designed, and the order
 * sheet is a list the board works through. When those masters are wanted, the keys go in the
 * manifest as `item-<id>` and this component grows the same `deliveredUrl` lookup every other
 * asset-backed component already has: one function call, no other change.
 *
 * The four kinds are drawn to be distinguishable in silhouette, not in colour, so they still read
 * at 24px and for a player who cannot separate the palette's greens from its purples. A page and a
 * blueprint share a tint on purpose: they are the same object at two stages, and the torn edge is
 * what separates them.
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
  // A single sheet with a torn edge down one side: one page out of a document, and the only
  // silhouette here that is incomplete on purpose.
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
  // A cog: a part, and the only round silhouette of the four.
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
};

const TINT: Record<ItemKind, string> = {
  blueprint: 'text-iris-100',
  page: 'text-iris-300',
  component: 'text-verdigris-100',
  relic: 'text-brass-300',
};

export function ItemGlyph({ id, className }: { id: ItemId; className?: string }) {
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
