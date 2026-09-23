import type { JSX } from 'react';
import { cn } from '../../lib/cn';

/**
 * A mark for each of the back room's five boosts (maintainer request, 2026-09-14).
 *
 * The Inventory tab drew all five with one `spark`, so the shelf was five rows of the same picture
 * and you read it by the labels, which makes the pictures decoration rather than a way of finding
 * anything.
 *
 * **Boosts only.** The six traps are drawn by `YardGlyph` in the Scrapyard, which already has a
 * mark per trap id, and the shelf uses those (maintainer request, 2026-09-15: use the icons we
 * have rather than redoing them). A trap that looked like one thing on the bench that cut it and
 * another on the shelf it waits on would be two pictures of one object. Nothing in the Scrapyard
 * sells a boost, which is why these five have no such home and live here.
 *
 * Drawn to be told apart in **silhouette**: a syringe, a drip bag, a bundle, a blister strip, a
 * canister. Not by colour, so they survive a dark plate and a player who cannot separate the
 * palette's greens from its purples.
 *
 * Deliberately not in `ART_MANIFEST`. Five small pieces of chrome on one tab is not worth five
 * lines of the maintainer's order sheet; if painted masters are ever wanted the keys go in as
 * `item-<id>` and this grows the same `deliveredUrl` lookup every asset-backed component has.
 */

/** The shared stroke, matched to `Icon` so a glyph sits beside one without reading lighter. */
const S = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
} as const;

const GLYPHS: Readonly<Record<string, JSX.Element>> = {
  /* --- the back room's five, all things that go into a unit before a fight --- */

  /** A syringe on the diagonal: plunger, barrel, needle. The one shape nothing else here has. */
  adrenaline_syringes: (
    <>
      <path d="M14.2 4.6l5.2 5.2" {...S} />
      <path d="M16.1 2.7l3.1 3.1M17.6 9.2l-3.1-3.1" {...S} />
      <path d="M15.3 7.4L7.6 15.1l-2.4 3.7 3.7-2.4 7.7-7.7z" {...S} />
      <path d="M10.4 9.5l2.9 2.9" {...S} />
      <path d="M4.6 19.4l-1.4 1.4" {...S} />
    </>
  ),
  /**
   * A drip bag on its hook, with the line running out of it.
   *
   * It was a bottle on a stand and it came out a wine glass: a bowl on a stem with a foot is a
   * goblet whatever it is meant to be. A bag hangs, which nothing else on this shelf does.
   */
  biochemical_infusers: (
    <>
      <path d="M12 2.2v2.2" {...S} />
      <path d="M8.2 4.4h7.6v8.8a3.8 3.8 0 0 1-7.6 0z" {...S} />
      <path d="M8.2 8.6h7.6" {...S} />
      <path d="M12 17v3.2" {...S} />
      <path d="M10.2 20.2h3.6" {...S} />
    </>
  ),
  /** A bundle of sticks, taped, with the fuse lit. Three bars, because two is a battery. */
  banned_explosives: (
    <>
      <rect x="4.6" y="8.8" width="4.1" height="10.6" rx="0.8" {...S} />
      <rect x="9.3" y="8.8" width="4.1" height="10.6" rx="0.8" {...S} />
      <rect x="14" y="8.8" width="4.1" height="10.6" rx="0.8" {...S} />
      <path d="M3.8 13.2h15" {...S} />
      <path d="M11.4 8.8c0-2.4 2.2-2.6 2.2-4.6" {...S} />
      <path d="M13.6 2.8l1.4 1.5-1.4 1.4-1.3-1.4z" {...S} />
    </>
  ),
  /** A blister strip, pressed out. Pills rather than a needle: the cheap one you hand round. */
  combat_stims: (
    <>
      <rect x="3.6" y="6.4" width="16.8" height="11.2" rx="2" {...S} />
      <path d="M3.6 12h16.8" {...S} />
      <circle cx="7.6" cy="9.2" r="1.5" {...S} />
      <circle cx="12" cy="9.2" r="1.5" {...S} />
      <circle cx="16.4" cy="9.2" r="1.5" {...S} />
      <circle cx="7.6" cy="14.8" r="1.5" {...S} />
      <path d="M10.5 13.3l3 3M13.5 13.3l-3 3" {...S} />
      <circle cx="16.4" cy="14.8" r="1.5" {...S} />
    </>
  ),
  /** A pressure bottle with a valve and a wisp off it. Rounded ends: nothing else here is. */
  nerve_gas_canisters: (
    <>
      <rect x="7.4" y="6.6" width="6.4" height="13.4" rx="3.2" {...S} />
      <path d="M9.2 6.6V4.8h2.8v1.8" {...S} />
      <path d="M12 5.4h2.6" {...S} />
      <path d="M7.9 10.4h5.4" {...S} />
      <path d="M16.4 8.2c1.6.6 2 2 1.2 3s-.6 2.2.6 2.8" {...S} />
    </>
  ),
};

/**
 * One mark, at whatever size the caller gives it.
 *
 * `viewBox` only, no width or height: the row draws it at 20px and the opened card at 56px, and a
 * glyph that carried its own size would need a second copy to do both.
 */
export function StashGlyph({ id, className }: { id: string; className?: string }) {
  const glyph = GLYPHS[id];
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('shrink-0', className)}>
      {glyph ?? <circle cx="12" cy="12" r="7" {...S} />}
    </svg>
  );
}
