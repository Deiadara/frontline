import {
  mulberry32,
  pageRarity,
  seedFrom,
  type BlueprintMotif,
  type BlueprintPage,
  type BlueprintSpec,
  type ItemRarity,
} from '@frontline/shared';
import type { JSX } from 'react';
import { cn } from '../../lib/cn';
import { RARITY_INK } from '../../lib/rarity';

/**
 * The drawing on a blueprint's cover, and on each of its pages (§D8).
 *
 * Forty-one documents and a hundred and sixty-three pages, and every one of them draws the thing it
 * is about. The Sniper Blueprint is a long rifle with a scope; its Barrel Liners sheet is a rifled
 * bore in section, its Range Cards a ruled card, its Ghillie Patterns a fringed net. Which motif
 * goes on which sheet is authored in `packages/shared/src/blueprints/catalog.ts` and named from the
 * set in `motifs.ts`; this file is the hundred and ten drawings those names stand for.
 *
 * ## What replaced the family motifs, and why
 *
 * Until the maintainer's 2026-09-10 call a glyph picked its subject off the document's *target kind*,
 * so every unit drew a body and every vehicle drew a chassis, and each sheet added a second and a
 * third motif chosen by a seed off its own id. That satisfied "no two sheets alike" and told a
 * player nothing: four Colossus pages were four copies of a walking body with a different smudge in
 * a different corner, and the smudge was the only part that was about the page. The seed is gone.
 * One drawing per sheet, chosen by hand, filling the paper.
 *
 * ## What a glyph is made of
 *
 * 1. **The paper.** A page is a loose sheet with a torn left edge and a turned top corner; a
 *    document is a bound cover with a spine, stitches, a title block and the fore-edge of the pages
 *    inside it. That difference is in silhouette rather than in colour, so a page and its document
 *    are one glance apart for somebody who cannot separate the palette. The tear and the fore-edge
 *    are still seeded off the id: they are the paper, not the drawing.
 * 2. **The drawing.** One motif, authored inside a 12 by 12 box centred on the origin, scaled up to
 *    fill the sheet. Every motif comes in two parts: a `body` that has to survive 16px, and a
 *    `detail` drawn from 36px up.
 * 3. **The ink.** The tier's colour, on the glyph's own dark plate.
 *
 * ## Size drops detail, it never adds clutter
 *
 * `sm` (16px, a cost row) is the paper and the motif's body. `md` (36px, a page row or a satchel
 * tile) adds the detail inside it. `lg` (72px, a card head) adds the sheet's own draughtsmanship,
 * which is fixed furniture rather than a seeded extra: a dimension run under a page, the title
 * block rules on a cover. Nothing moves between the three, so a glyph does not change identity when
 * it changes size.
 *
 * If the board later hands over masters, this component is where they land: same call sites, same
 * sizes, same rarity ink around them.
 */

export type GlyphSize = 'sm' | 'md' | 'lg';

/**
 * The pen, and the whole of why the line weight is consistent.
 *
 * Every motif is handed one instead of writing its stroke widths out. A mark is placed with a
 * `scale()`, and a plain `strokeWidth="1.5"` inside `scale(1.85)` renders at 0.81 on the paper: the
 * drawings would get thinner as they got bigger. `pen` divides by the mark's own scale, so a 1.5 is
 * a 1.5 wherever and at whatever size it is drawn.
 *
 * Three weights, and they stay a hierarchy: **1.5** is the subject's own outline, **1.15** the
 * detail inside it, **0.9** annotation on it. The sheet's own furniture sits at 0.8 and below, so a
 * motif is always the heavier mark.
 */
type Pen = (weight: number) => number;

/**
 * One drawing, in two parts.
 *
 * The split is what makes a size drop detail rather than redraw: `body` is the silhouette a player
 * has to recognise in a 16px cost row, `detail` is what they get once there is room for it. Both
 * are required, so every motif reads at every size and every size is genuinely different from the
 * one below it.
 */
interface MotifArt {
  body: (pen: Pen) => JSX.Element;
  detail: (pen: Pen) => JSX.Element;
}

/**
 * The hundred and ten drawings.
 *
 * Grouped the way `motifs.ts` groups the ids: the forty-one things a document is *about*, then the
 * parts, the fabric, the bodies, and the four or five kinds of drawing a page can simply be. A
 * motif is shared across documents wherever the object really is the same one, which is why a
 * hundred and ten of them carry two hundred and four sheets.
 */
const MOTIFS: Readonly<Record<BlueprintMotif, MotifArt>> = {
  // ---------------------------------------------------------------- the forty-one cover objects
  rifle: {
    body: (pen) => (
      <>
        <path d="M-5.9-1.1h7.4v1.5h-7.4z" strokeWidth={pen(1.5)} />
        <path d="M1.5-1.5h2.3l2.2 2.7-1.8 1.5-2.7-2z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.4-2.7h3.6v1.2h-3.6z" strokeWidth={pen(1.15)} />
        <path d="M-2.8-1.5v-1.2M-0.4-1.5v-1.2" strokeWidth={pen(0.9)} />
        <path d="M0.4 0.4v1.8h1.6" strokeWidth={pen(1.15)} />
      </>
    ),
  },
  breach: {
    body: (pen) => (
      <>
        <path d="M-5.6-4.4h11.2v8.8h-11.2z" strokeWidth={pen(1.5)} />
        <path d="M-2.4 3.6l-0.8-3.2 1.8-2.6 2.8 0.4 1 2.8-1.6 2.6z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-5.6-1.6h2.4M2.8-1.6h2.8M-5.6 1.4h1.8M3.6 1.4h2" strokeWidth={pen(1.15)} />
        <path d="M-3.6 4.4h1.2M0.8 4.6h2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  kite: {
    body: (pen) => (
      <>
        <path d="M0-5.4L3.2-1.4 0 3.4-3.2-1.4z" strokeWidth={pen(1.5)} />
        <path d="M0 3.4L-3.2 4.6" strokeWidth={pen(1.5)} />
        <circle cx="-4.2" cy="5" r="1.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.2-1.4h6.4M0-5.4v8.8" strokeWidth={pen(1.15)} />
        <path d="M2.4 0.6l1.6 1.4M3.4 2.6l1.4 1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  hound: {
    body: (pen) => (
      <>
        <path d="M-3.8-2h6v3h-6z" strokeWidth={pen(1.5)} />
        <path d="M2.2-2.6h2.6v2.2h1.2v1.2h-3.8z" strokeWidth={pen(1.5)} />
        <path d="M-2.6 1v3.6M-0.8 1v3.6M0.8 1v3.6M2.4 1v3.6" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.8-1.4l-1.8-1.6" strokeWidth={pen(1.15)} />
        <circle cx="3.6" cy="-1.6" r="0.5" strokeWidth={pen(1.15)} />
        <path d="M-1.6-2v3M-2.6 2.6h0.001M-5.4 4.6h10.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  twin_figures: {
    body: (pen) => (
      <>
        <circle cx="-2.8" cy="-3" r="1.5" strokeWidth={pen(1.5)} />
        <circle cx="2.8" cy="-3" r="1.5" strokeWidth={pen(1.5)} />
        <path
          d="M-5.2 3.6c0-2.3 1.1-3.5 2.4-3.5s2.4 1.2 2.4 3.5M0.4 3.6c0-2.3 1.1-3.5 2.4-3.5s2.4 1.2 2.4 3.5"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.4 1.2q1.4 1.6 2.8 0" strokeWidth={pen(1.15)} />
        <path d="M-5.4 4.6h10.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  cuirass: {
    body: (pen) => <path d="M-3.6-3.6h7.2l1.2 2.6-1 6.6h-7.6l-1-6.6z" strokeWidth={pen(1.5)} />,
    detail: (pen) => (
      <>
        <path d="M0-3.6v9.2" strokeWidth={pen(1.15)} />
        <path d="M-3.6-3.6l-1.4-1.4M3.6-3.6l1.4-1.4" strokeWidth={pen(1.15)} />
        <path d="M-3.2-0.4h6.4M-3 2h6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  exoframe: {
    body: (pen) => (
      <>
        <circle cy="-3.6" r="1.3" strokeWidth={pen(1.5)} />
        <path d="M-1.8-1.8h3.6v4.2h-3.6z" strokeWidth={pen(1.5)} />
        <path
          d="M-4.4-2.8h2.2M-4.4-2.8v7M-4.4 4.2h2.8M4.4-2.8h-2.2M4.4-2.8v7M4.4 4.2h-2.8"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-4.4" cy="0.8" r="0.8" strokeWidth={pen(1.15)} />
        <circle cx="4.4" cy="0.8" r="0.8" strokeWidth={pen(1.15)} />
        <path d="M-3.6 0.8h1.8M3.6 0.8h-1.8M-1.4 2.4v2.6M1.4 2.4v2.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  husk: {
    body: (pen) => (
      <>
        <path d="M-2.8 5V-1.4c0-2.1 1.3-3.4 2.8-3.4s2.8 1.3 2.8 3.4V5" strokeWidth={pen(1.5)} />
        <path d="M-2.8-1.4q2.8-1.6 5.6 0" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.8 3.4h5.6" strokeWidth={pen(1.15)} />
        <path d="M-1.2 3.2V0.2M1.2 3.2V0.2M-3.4 5h6.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  shroud: {
    body: (pen) => (
      <path
        d="M0-5.2c2.2 0 3.5 1.6 3.5 3.5L4.6 4.4M0-5.2c-2.2 0-3.5 1.6-3.5 3.5L-4.6 4.4"
        strokeWidth={pen(1.5)}
      />
    ),
    detail: (pen) => (
      <>
        <path d="M-1.7-2.4q1.7 1.6 3.4 0" strokeWidth={pen(1.15)} />
        <path d="M-4.6 4.4h9.2" strokeDasharray="1.4 1.1" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  blade: {
    body: (pen) => (
      <>
        <path d="M-3 2.8C0 1 2.6-1.8 4.6-5c0.6 3.6-1.6 7-5.4 9z" strokeWidth={pen(1.5)} />
        <path d="M-3 2.8l-1.9 1.3 1.3 1.9 1.9-1.3z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.2 3.4C0.2 1.8 2.4-0.6 3.8-3.2" strokeWidth={pen(1.15)} />
        <path d="M-4.2 3.4l1.2 1.2M-3.6 4.6l1.2 1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  frayed_end: {
    body: (pen) => (
      <>
        <path d="M-5.8-1.5h4.6v3h-4.6z" strokeWidth={pen(1.5)} />
        <path
          d="M-1.2-0.4q2 -0.8 3.4-2.8M-1.2 0.2q2.2 0.4 3.8-0.4M-1.2 1q1.8 1.4 2.8 3.4"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-4.6-1.5l0.9 3M-3.2-1.5l0.9 3M-1.8-1.5l0.6 3" strokeWidth={pen(1.15)} />
        <path d="M-1.2 0.6q2.4 1.6 3.2 3.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  graft_body: {
    body: (pen) => (
      <>
        <circle cy="-3.6" r="1.5" strokeWidth={pen(1.5)} />
        <path d="M-2.6-1.6h5.2v4.4h-5.2z" strokeWidth={pen(1.5)} />
        <path
          d="M2.6-0.8l2.8 1.6M-2.6-0.8l-2.4 0.6M-1.4 2.8v2.6M1.4 2.8v2.6"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M5.2 0.4h1.2v1.4h-1.2z" strokeWidth={pen(1.15)} />
        <path d="M-2.6 0.4h5.2M0-1.6v4.4" strokeDasharray="0.8 0.7" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  walking_hull: {
    body: (pen) => (
      <>
        <path d="M-4.6-4.2h9.2v4.8h-9.2z" strokeWidth={pen(1.5)} />
        <path d="M-2.4 0.6l-1.2 5M2.4 0.6l1.2 5" strokeWidth={pen(1.5)} />
        <path d="M-4.8 5.6h2.4M2.4 5.6h2.4" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.6-3.2h2.8v1.8h-2.8z" strokeWidth={pen(1.15)} />
        <circle cx="-3" cy="3.1" r="0.7" strokeWidth={pen(1.15)} />
        <circle cx="3" cy="3.1" r="0.7" strokeWidth={pen(1.15)} />
        <path d="M1.2-3.2h3.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  motorcycle: {
    body: (pen) => (
      <>
        <circle cx="-3.4" cy="2.2" r="2.6" strokeWidth={pen(1.5)} />
        <circle cx="3.4" cy="2.2" r="2.6" strokeWidth={pen(1.5)} />
        <path d="M-3.4 2.2l1.6-3.6h3.4l1.8 3.6M-1.8-1.4h3" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-3.4" cy="2.2" r="0.7" strokeWidth={pen(1.15)} />
        <circle cx="3.4" cy="2.2" r="0.7" strokeWidth={pen(1.15)} />
        <path d="M1.2-1.4l1.4-2h1.8" strokeWidth={pen(1.15)} />
        <path d="M-2.6-2.2h2.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  pickup: {
    body: (pen) => (
      <>
        <path d="M-5.6 1.6V-0.4l1.6-2.6h3.2v2.6h6.4v2z" strokeWidth={pen(1.5)} />
        <circle cx="-3.4" cy="2.8" r="1.5" strokeWidth={pen(1.5)} />
        <circle cx="3.4" cy="2.8" r="1.5" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-4.2-0.4h2.4v-1.8h-1.2z" strokeWidth={pen(1.15)} />
        <path d="M0.6-0.4v2M2.8-0.4v2M5-0.4v2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  car: {
    body: (pen) => (
      <>
        <path d="M-5.6 1.2V-0.6l1.8-0.6 1.4-2.2h4.8l1.8 2.2 1.8 0.6v1.8z" strokeWidth={pen(1.5)} />
        <circle cx="-3.2" cy="2" r="1.5" strokeWidth={pen(1.5)} />
        <circle cx="3.2" cy="2" r="1.5" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.8-3.4v4.6M1.6-3.4v4.6" strokeDasharray="0.9 0.8" strokeWidth={pen(1.15)} />
        <path d="M-3.8-1.2h7.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  bus: {
    body: (pen) => (
      <>
        <path d="M-5.8 2V-3.6h11.6V2z" strokeWidth={pen(1.5)} />
        <circle cx="-3.4" cy="2.8" r="1.3" strokeWidth={pen(1.5)} />
        <circle cx="3.4" cy="2.8" r="1.3" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-4.8-2.6h2v2h-2zM-2-2.6h2v2h-2zM0.8-2.6h2v2h-2z" strokeWidth={pen(1.15)} />
        <path d="M-4.8-1.6h7.6M3.6 0h1.8v2h-1.8z" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  balloon: {
    body: (pen) => (
      <>
        <path
          d="M0-5.4c2.6 0 4.3 2 4.3 4.1 0 2-1.9 3.5-2.7 4.3h-3.2C-2.4 2.2-4.3 0.7-4.3-1.3-4.3-3.4-2.6-5.4 0-5.4z"
          strokeWidth={pen(1.5)}
        />
        <path d="M-1.7 3.2h3.4v2.2h-3.4z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M0-5.4v8.4M-2.3-4.6q-0.4 4 0.6 7.6M2.3-4.6q0.4 4-0.6 7.6" strokeWidth={pen(0.9)} />
        <path d="M-1.5 3l-0.3-1M1.5 3l0.3-1" strokeWidth={pen(1.15)} />
      </>
    ),
  },
  rotor_head: {
    body: (pen) => (
      <>
        <path d="M-5.8-2.6H5.8" strokeWidth={pen(1.5)} />
        <circle cy="-2.6" r="1.3" strokeWidth={pen(1.5)} />
        <path d="M0-1.3v2.5" strokeWidth={pen(1.5)} />
        <path d="M-0.8 1.2h6.4v2h-6.4z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.4-2.6v1.4M2.4-2.6v1.4" strokeWidth={pen(1.15)} />
        <path d="M-0.8 1.2l2 2M1.2 1.2l2 2M3.2 1.2l2 2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  helicopter: {
    body: (pen) => (
      <>
        <path d="M-5.6 2v-1.6c0-1.9 1.4-3.2 3.4-3.2h2.6l2 2.6h1.6v2.2z" strokeWidth={pen(1.5)} />
        <path d="M0.4 0.2h5.2v1.2H0.4z" strokeWidth={pen(1.5)} />
        <path d="M-5 -4.6H4.6M-1-4.6v1.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="5.4" cy="-0.6" r="1" strokeWidth={pen(1.15)} />
        <path d="M-4.6 3.6h6.6M-3.4 2v1.6M0.6 2v1.6" strokeWidth={pen(1.15)} />
        <path d="M-4.4-1.4h2.4v1.6h-2.4z" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  laminate: {
    // Stepped at the right-hand edge, so the layers read as a stack rather than as rules on a
    // sheet: a plain banded rectangle is a table, and the Composite Armour cover sat next to its
    // own Lamination Schedule page looking like it.
    body: (pen) => (
      <path d="M-5.4-3.4h8.4v1.7h0.8v1.7h0.8v1.7h0.8v1.7h-10.8z" strokeWidth={pen(1.5)} />
    ),
    detail: (pen) => (
      <>
        <path d="M-5.4-1.7h8.4M-5.4 0h9.2M-5.4 1.7h10" strokeWidth={pen(1.15)} />
        <path d="M-4.6-4.4h4.4M-4.6-5v1.2M-0.2-5v1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  cartridge: {
    body: (pen) => (
      <>
        <path d="M-5-2.2h6.4v4.4h-6.4z" strokeWidth={pen(1.5)} />
        <path
          d="M1.4-2.2h1.4c1.7 0 2.9 1.2 2.9 2.2s-1.2 2.2-2.9 2.2h-1.4z"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M1.4-2.2v4.4" strokeWidth={pen(1.15)} />
        <circle cx="-4.2" cy="0" r="0.8" strokeWidth={pen(1.15)} />
        <path d="M-3.4-2.2v4.4M-5-2.6v5.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  implant: {
    body: (pen) => (
      <>
        <path d="M-5.8-2.4h11.6v4.8h-11.6z" strokeWidth={pen(1.5)} />
        <circle cx="0.6" r="2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="0.6" r="1" strokeWidth={pen(1.15)} />
        <path d="M0.6-2v-1.4M0.6 2v1.4M2.6 0h1.4M-1.4 0h-1.4" strokeWidth={pen(0.9)} />
        <path d="M-5.8 1.4h2.6M4.4 1.4h1.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  switchboard: {
    body: (pen) => (
      <>
        <path d="M-5.2-4h10.4v8h-10.4z" strokeWidth={pen(1.5)} />
        <circle cx="-3.2" cy="-1.8" r="0.7" strokeWidth={pen(1.5)} />
        <circle cx="-0.6" cy="-1.8" r="0.7" strokeWidth={pen(1.5)} />
        <circle cx="2" cy="-1.8" r="0.7" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-3.2" cy="1.4" r="0.7" strokeWidth={pen(1.15)} />
        <circle cx="-0.6" cy="1.4" r="0.7" strokeWidth={pen(1.15)} />
        <circle cx="2" cy="1.4" r="0.7" strokeWidth={pen(1.15)} />
        <path d="M-0.6-1.1C-0.6 2 2.6 2.2 3.4 0.6" strokeWidth={pen(1.15)} />
        <path d="M4.2-3h0.8v6h-0.8z" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  hut: {
    body: (pen) => (
      <>
        <path d="M-4.4 4.4V-1.2L0-4.4l4.4 3.2v5.6z" strokeWidth={pen(1.5)} />
        <path d="M2-3.2v-2h1.4v3" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1 4.4V1.2h2v3.2" strokeWidth={pen(1.15)} />
        <path d="M-3.2-0.4h1.8v1.8h-1.8z" strokeWidth={pen(1.15)} />
        <path d="M-4.4-1.2h8.8M-5.2 4.4h10.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  greenhouse: {
    body: (pen) => <path d="M-5.4 4V-0.6L0-4.2l5.4 3.6V4z" strokeWidth={pen(1.5)} />,
    detail: (pen) => (
      <>
        <path d="M-5.4-0.6h10.8" strokeWidth={pen(1.15)} />
        <path d="M-2.8-2.3V4M0-4.2V4M2.8-2.3V4M-5.4 1.6h10.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  generator_set: {
    body: (pen) => (
      <>
        <path d="M-5.6 3h11.2v1.6h-11.2z" strokeWidth={pen(1.5)} />
        <path d="M-5-1.8h4.6v4.8h-4.6z" strokeWidth={pen(1.5)} />
        <path d="M0.8 0h4.6v3h-4.6z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-4-1.8v-2.6h1.8" strokeWidth={pen(1.15)} />
        <path d="M2 0v-1.4h1.8V0" strokeWidth={pen(1.15)} />
        <path d="M-4 4.6v1M4 4.6v1M-3.4 0.4h1.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  scrap_heap: {
    body: (pen) => <path d="M-5.8 4.4l2.2-4.2 3-2.4 3.4 1.8 2.4 4.8z" strokeWidth={pen(1.5)} />,
    detail: (pen) => (
      <>
        <path d="M-3.4 4.4l1.8-3.6M0.2 4.4l0.6-4M2.8 4.4l-1-2.8" strokeWidth={pen(1.15)} />
        <circle cx="1.2" cy="2.4" r="0.8" strokeWidth={pen(0.9)} />
        <path d="M-6 4.4h12" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  retort: {
    body: (pen) => (
      <>
        <path
          d="M-1.4-4.8h2.8v2.6l2.4 3.2c0.9 1.2 0.1 2.6-1.3 2.6h-5c-1.4 0-2.2-1.4-1.3-2.6l2.4-3.2z"
          strokeWidth={pen(1.5)}
        />
        <path d="M-1.4 4.8h2.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3 1.6h6" strokeWidth={pen(1.15)} />
        <path d="M0 4.6c-0.9-0.9-0.5-1.8 0-2.2 0.5 0.4 0.9 1.3 0 2.2z" strokeWidth={pen(1.15)} />
        <path d="M-2-4.8h4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  gate: {
    body: (pen) => (
      <>
        <path d="M-5.4 5V-3.4h10.8V5" strokeWidth={pen(1.5)} />
        <path d="M-3.6 4.6V-1.6h7.2v6.2z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.2-1.6v6.2M1.2-1.6v6.2M-3.6 1.4h7.2" strokeWidth={pen(1.15)} />
        <path d="M-4.4 0h0.8M-4.4 3h0.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  microscope: {
    body: (pen) => (
      <>
        <path d="M-3.6 4.4h6.6v1.2h-6.6z" strokeWidth={pen(1.5)} />
        <path d="M-0.6 4.4V0.6c0-2 1-3 2.4-3.4" strokeWidth={pen(1.5)} />
        <path d="M0.8-4.8h2.6v4.4h-2.6z" strokeWidth={pen(1.5)} />
        <path d="M-2.8-0.4h5.4" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-0.6" cy="1.8" r="0.9" strokeWidth={pen(1.15)} />
        <path d="M1.4-0.4v0.9h1.4v-0.9" strokeWidth={pen(1.15)} />
        <path d="M-1.6 2h2.4M1.2-5.4h1.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  hurdles: {
    body: (pen) => (
      <>
        <path d="M-5.4 4.2V0.6h3.4v3.6" strokeWidth={pen(1.5)} />
        <path d="M-1 3.8V0.4h3v3.4" strokeWidth={pen(1.5)} />
        <path d="M2.6 3.4V0.2h2.6v3.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-5.4 1.6h3.4M-1 1.4h3M2.6 1.2h2.6" strokeWidth={pen(1.15)} />
        <path d="M-5.8 4.6h11.6M-4 5.4h1.6M0.2 5.4h1.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  bed: {
    body: (pen) => (
      <>
        <path d="M-5.4 3.4V0h10.8v3.4" strokeWidth={pen(1.5)} />
        <path d="M-5.4 0v-3.2h1.6V0" strokeWidth={pen(1.5)} />
        <path d="M-5 3.4v1.8M5 3.4v1.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.8 1.4h9.2" strokeWidth={pen(1.15)} />
        <path d="M3.2 3.6h2.2v2.4h-2.2z" strokeWidth={pen(1.15)} />
        <path d="M3.6 4.4h1.4M3.6 5.2h0.9" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  hoist: {
    body: (pen) => (
      <>
        <path d="M-5 5V-3.6M5 5V-3.6" strokeWidth={pen(1.5)} />
        <path d="M-5-2.4h3.2M5-2.4h-3.2" strokeWidth={pen(1.5)} />
        <path d="M-3.8-2.4v-1.4l1.2-1.4h5.2l1.2 1.4v1.4z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-5.8 5h1.6M4.2 5h1.6" strokeWidth={pen(1.15)} />
        <path d="M-2.4-3.8h4.8" strokeWidth={pen(1.15)} />
        <path d="M-3.4 0.4h6.8" strokeDasharray="1 0.9" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  plating: {
    body: (pen) => <path d="M-5-4.4h10v8.8h-10z" strokeWidth={pen(1.5)} />,
    detail: (pen) => (
      <>
        <circle cx="-3.4" cy="-2.8" r="0.6" strokeWidth={pen(1.15)} />
        <circle cx="0" cy="-2.8" r="0.6" strokeWidth={pen(1.15)} />
        <circle cx="3.4" cy="-2.8" r="0.6" strokeWidth={pen(1.15)} />
        <circle cx="-3.4" cy="2.8" r="0.6" strokeWidth={pen(1.15)} />
        <circle cx="0" cy="2.8" r="0.6" strokeWidth={pen(1.15)} />
        <circle cx="3.4" cy="2.8" r="0.6" strokeWidth={pen(1.15)} />
        <path d="M-3 0h6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  charge: {
    body: (pen) => (
      <>
        <path d="M-3.2-2.4h6.4v5.4h-6.4z" strokeWidth={pen(1.5)} />
        <path d="M0-2.4v-2.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.6 3L0 0.2 2.6 3" strokeWidth={pen(1.15)} />
        <path d="M-3.2 0.4h6.4" strokeWidth={pen(0.9)} />
        <path d="M0-5.2l1-0.8M0-5.2l-1-0.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  frontage: {
    body: (pen) => (
      <path
        d="M-5.8 4.4V-1.4h3.8v5.8M-1.6 4.4V-3.4h3.4v7.8M2.2 4.4V-0.6h3.6v5"
        strokeWidth={pen(1.5)}
      />
    ),
    detail: (pen) => (
      <>
        <path
          d="M-4.8 4.4V1.8h1.6v2.6M-0.6 4.4V1.4h1.4v3M3.4 4.4V2h1.4v2.4"
          strokeWidth={pen(1.15)}
        />
        <path d="M-6 4.6h12" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  can: {
    body: (pen) => (
      <>
        <path d="M-3.6-3.4h6.2v8.2h-6.2z" strokeWidth={pen(1.5)} />
        <path d="M2.6-2.4h2.2v1.4h-2.2z" strokeWidth={pen(1.5)} />
        <path d="M-2.6-3.4v-1.2h3v1.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="1.4" cy="-2.4" r="0.7" strokeWidth={pen(1.15)} />
        <path d="M-3.6-3.4l6.2 8.2M2.6-3.4l-6.2 8.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  pressure_plate: {
    body: (pen) => (
      <>
        <path d="M-5-2.6h10v1.6h-10z" strokeWidth={pen(1.5)} />
        <path d="M-0.8-1v2.2h1.6V-1" strokeWidth={pen(1.5)} />
        <path d="M-5 3.4h10v1.2h-10z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-0.6 1.2l1.4 0.7-1.4 0.8 1.4 0.7" strokeWidth={pen(1.15)} />
        <path d="M-3 3.4V1.8M3 3.4V1.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  buried_shell: {
    body: (pen) => (
      <>
        <path d="M-5.8-2h11.6" strokeWidth={pen(1.5)} />
        <path
          d="M-2.6 0.8h3.2c1.5 0 2.4 0.8 2.4 1.7s-0.9 1.7-2.4 1.7h-3.2z"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1 0.8V-2.6h-4" strokeWidth={pen(1.15)} />
        <path d="M-4-1.2l1-0.8M-2-1.2l1-0.8M2-1.2l1-0.8M4-1.2l1-0.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  collapse: {
    body: (pen) => (
      <>
        <path d="M-5.2 4.6V-3.6h3.4v8.2" strokeWidth={pen(1.5)} />
        <path d="M-1.2 4.6l1.6-7.2 4 1.4-1.4 5.8z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-5.2 0.4h3.4M-0.4 1.4l3.8 0.9" strokeWidth={pen(1.15)} />
        <path d="M2.4 5.4h1.8M-0.4 5.6h1.2M-5.8 4.6h11.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },

  // ------------------------------------------------------------------- machinery and fittings
  bore: {
    body: (pen) => (
      <>
        <circle r="5" strokeWidth={pen(1.5)} />
        <circle r="2.6" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M2.6 0h1.1M1.3 2.25l0.55 0.95M-1.3 2.25l-0.55 0.95M-2.6 0h-1.1M-1.3-2.25l-0.55-0.95M1.3-2.25l0.55 0.95"
          strokeWidth={pen(1.15)}
        />
        <path d="M0-5.8a5.8 5.8 0 0 1 3.4 1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  piston: {
    body: (pen) => (
      <>
        <path d="M-5.6-3.4h5v2.6h-5z" strokeWidth={pen(1.5)} />
        <path d="M-0.6-2.1h4.8" strokeWidth={pen(1.5)} />
        <path d="M0.6 0.8h5v2.6h-5z" strokeWidth={pen(1.5)} />
        <path d="M0.6 2.1h-4.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.6-3.4v2.6M2.6 0.8v2.6" strokeWidth={pen(1.15)} />
        <circle cx="4.6" cy="-2.1" r="0.7" strokeWidth={pen(0.9)} />
        <circle cx="-5.2" cy="2.1" r="0.7" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  gear_train: {
    body: (pen) => (
      <>
        <circle cx="-2" cy="-0.6" r="3" strokeWidth={pen(1.5)} />
        <path
          d="M1-0.6h1M-2 2.4v1M-5-0.6h-1M-2-3.6v-1M0.1 1.5l0.7 0.7M-4.1 1.5l-0.7 0.7M-4.1-2.7l-0.7-0.7M0.1-2.7l0.7-0.7"
          strokeWidth={pen(1.5)}
        />
        <circle cx="2.8" cy="2.4" r="2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M4.8 2.4h1M2.8 4.4v1M0.8 2.4h-1M2.8 0.4v-1" strokeWidth={pen(1.15)} />
        <circle cx="-2" cy="-0.6" r="0.8" strokeWidth={pen(1.15)} />
        <circle cx="2.8" cy="2.4" r="0.7" strokeWidth={pen(1.15)} />
        <path d="M-2-0.6l4.8 3" strokeDasharray="0.8 0.7" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  swashplate: {
    body: (pen) => (
      <>
        <ellipse cy="0.8" rx="4.8" ry="1.7" strokeWidth={pen(1.5)} />
        <path d="M0-4.8V2.6" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.4 0.2V-2.8M0-0.9V-3.6M3.4 0.2V-2.8" strokeWidth={pen(1.15)} />
        <ellipse cy="0.8" rx="3.2" ry="1.1" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  turbine: {
    body: (pen) => (
      <>
        <circle r="5" strokeWidth={pen(1.5)} />
        <circle r="1.3" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M0-1.6L1.4-4.4M1.1 1.1L4 2.2M-1.1 1.1L-4 2.2M-1.4-0.8L-4.4-1.8M1.4-0.8L4.4-1.8M0 1.6L-1.4 4.4"
          strokeWidth={pen(1.15)}
        />
        <path d="M-5.6 0h-0.4M5.6 0h0.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  shaft: {
    body: (pen) => (
      <>
        <path d="M-5.8-0.7h11.6v1.4h-11.6z" strokeWidth={pen(1.5)} />
        <path d="M-3.4-2h1.8v4h-1.8zM1.6-2h1.8v4h-1.8z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.5 3.6h5M-2.5 3h1.2M2.5 3h-1.2" strokeWidth={pen(1.15)} />
        <path d="M-3.4 2l1.8-4M1.6 2l1.8-4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  coil: {
    body: (pen) => (
      <>
        <path d="M-5.6-1h11.2v2h-11.2z" strokeWidth={pen(1.5)} />
        <path
          d="M-4.2-1a1.3 1.3 0 0 1 2.6 0M-1.4-1a1.3 1.3 0 0 1 2.6 0M1.4-1a1.3 1.3 0 0 1 2.6 0"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M-4.2 1a1.3 1.3 0 0 0 2.6 0M-1.4 1a1.3 1.3 0 0 0 2.6 0M1.4 1a1.3 1.3 0 0 0 2.6 0"
          strokeWidth={pen(1.15)}
        />
        <path d="M-5.6-1v-2.4M5.6 1v2.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  circuit: {
    body: (pen) => (
      <>
        <path d="M-5.6 4h3.4v-4h4.2v-4.2h3.6" strokeWidth={pen(1.5)} />
        <circle cx="-5.6" cy="4" r="1.1" strokeWidth={pen(1.5)} />
        <circle cx="5.6" cy="-4.2" r="1.1" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-0.8-0.8h1.6v1.6h-1.6z" strokeWidth={pen(1.15)} />
        <path d="M-2.2 1.8h-2.6M2-2.2v-2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  cable_run: {
    body: (pen) => (
      <>
        <path d="M-5.8-2h11.6M-5.8 0h11.6M-5.8 2h11.6" strokeWidth={pen(1.5)} />
        <path d="M-1.8-2.8h1.2v5.6h-1.2z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-4 2v2.2M1 2v2.2M4 2v2.2" strokeWidth={pen(1.15)} />
        <path d="M3.2-2.8h1.2v5.6h-1.2z" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  manifold: {
    body: (pen) => (
      <>
        <path d="M-4.6-3h9.2v6h-9.2z" strokeWidth={pen(1.5)} />
        <path d="M-6-1.6h1.4M-6 1.6h1.4M4.6-1.6h1.4M4.6 1.6h1.4" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-4.6-1.6h9.2" strokeWidth={pen(1.15)} />
        <path d="M-4.6 1.6h4.6v-3.2" strokeDasharray="0.9 0.8" strokeWidth={pen(1.15)} />
        <circle cx="-4.6" cy="-1.6" r="0.5" strokeWidth={pen(0.9)} />
        <circle cx="4.6" cy="1.6" r="0.5" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  governor: {
    body: (pen) => (
      <>
        <path d="M0-4.6v6.6" strokeWidth={pen(1.5)} />
        <path d="M0-4.2L-3.6 0.6M0-4.2L3.6 0.6" strokeWidth={pen(1.5)} />
        <circle cx="-3.6" cy="1.6" r="1.2" strokeWidth={pen(1.5)} />
        <circle cx="3.6" cy="1.6" r="1.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.4 2h2.8v1.6h-2.8z" strokeWidth={pen(1.15)} />
        <path d="M-5 3.2h1.6M3.4 3.2h1.6M-1.4 5h2.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  winch: {
    body: (pen) => (
      <>
        <circle cx="-1" r="3.2" strokeWidth={pen(1.5)} />
        <path d="M1.9 1.4l4.1 1.2" strokeWidth={pen(1.5)} />
        <path d="M-4.8 3.6h7.4" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M2.4-2.6l2.2-1.2 0.6 1.4" strokeWidth={pen(1.15)} />
        <circle cx="-1" r="1.9" strokeWidth={pen(0.9)} />
        <circle cx="-1" r="0.7" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  engine: {
    body: (pen) => (
      <>
        <path d="M-5.6-3h4.8v6.4h-4.8z" strokeWidth={pen(1.5)} />
        <path d="M0.8-3h4.8v6.4h-4.8z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-3.2" cy="-1" r="1.1" strokeWidth={pen(1.15)} />
        <circle cx="3.2" cy="-1" r="1.1" strokeWidth={pen(1.15)} />
        <path d="M-5.6 1.4h4.8M0.8 1.4h4.8" strokeWidth={pen(0.9)} />
        <path d="M0-3.8v8" strokeDasharray="0.9 0.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  mount: {
    body: (pen) => <path d="M-4.4-3.4h2.6v5.2h6v2.6h-8.6z" strokeWidth={pen(1.5)} />,
    detail: (pen) => (
      <>
        <circle cx="-3.1" cy="-2" r="0.7" strokeWidth={pen(1.15)} />
        <circle cx="2.4" cy="3.1" r="0.7" strokeWidth={pen(1.15)} />
        <path d="M0-4.6v3.4M0-1.2l-0.9-1M0-1.2l0.9-1" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  optics: {
    body: (pen) => (
      <>
        <path d="M-5.6-2h9.6v4h-9.6z" strokeWidth={pen(1.5)} />
        <path d="M4-2.8h1.8v5.6H4z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3-2q1.7 2 0 4M0.4-2q1.7 2 0 4" strokeWidth={pen(1.15)} />
        <path d="M-5.6 0h11.4" strokeDasharray="1 0.9" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  burner: {
    body: (pen) => (
      <>
        <path d="M-2.6 1.2h5.2v2.2h-5.2z" strokeWidth={pen(1.5)} />
        <path d="M-0.8 3.4h1.6v2.2h-1.6z" strokeWidth={pen(1.5)} />
        <path
          d="M0-4.8c1.9 1.9 2.7 3.5 1.5 4.9-0.7 0.8-2.3 0.8-3 0-1.2-1.4-0.4-3 1.5-4.9z"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M0-2.2c1 1.1 1.3 1.9 0.7 2.5-0.4 0.4-1 0.4-1.4 0-0.6-0.6-0.3-1.4 0.7-2.5z"
          strokeWidth={pen(1.15)}
        />
        <path d="M-1.6 1.2V0.4M0 1.2V0.4M1.6 1.2V0.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  spring: {
    body: (pen) => (
      <>
        <path d="M-3-4.2h6l-6 1.9h6l-6 1.9h6l-6 1.9h6" strokeWidth={pen(1.5)} />
        <path d="M-4-5.6h8v1.4h-8z" strokeWidth={pen(1.5)} />
        <path d="M-4 1.4h8v1.4h-8z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M5-4.2v6.4M4.4-4.2h1.2M4.4 2.2h1.2" strokeWidth={pen(1.15)} />
        <path d="M-4 3.6h8v1.2h-8z" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  press: {
    body: (pen) => (
      <>
        <path d="M-5 5V-4.6h10V5" strokeWidth={pen(1.5)} />
        <path d="M-2.2-3v3.6h4.4V-3z" strokeWidth={pen(1.5)} />
        <path d="M-4 2.6h8v1.6h-8z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.4 0.6h2.8v2h-2.8z" strokeWidth={pen(1.15)} />
        <path d="M0 0.6v2" strokeWidth={pen(1.15)} />
        <circle cx="3.2" cy="-2.6" r="1" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  belt: {
    body: (pen) => (
      <>
        <path d="M-5.6 1h11.2v2.2h-11.2z" strokeWidth={pen(1.5)} />
        <circle cx="-4.6" cy="2.1" r="1.5" strokeWidth={pen(1.5)} />
        <circle cx="4.6" cy="2.1" r="1.5" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.4-2.4v1.6h1.8v-1.6M1.6-2.4v1.6h1.8v-1.6" strokeWidth={pen(1.15)} />
        <path d="M-2.5-0.8v1.8M2.5-0.8v1.8" strokeWidth={pen(0.9)} />
        <path d="M-0.8 0h1.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  crane: {
    body: (pen) => (
      <>
        <path d="M-5.8-2.6h11.6v1.8h-11.6z" strokeWidth={pen(1.5)} />
        <path d="M-4.4-0.8v5.2M4.4-0.8v5.2" strokeWidth={pen(1.5)} />
        <path d="M-5.6 4.4h2.4M3.2 4.4h2.4" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M0-0.8v2.4M0 1.6l0.9 0.9" strokeWidth={pen(1.15)} />
        <path d="M-4.4 2h8.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  hopper: {
    body: (pen) => (
      <>
        <path d="M-4.6-4h9.2l-3 6h-3.2z" strokeWidth={pen(1.5)} />
        <path d="M-1.6 2h3.2v3.4h-3.2z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.6 3.6h3.2" strokeWidth={pen(1.15)} />
        <circle cx="-1.6" cy="-2.4" r="0.6" strokeWidth={pen(0.9)} />
        <circle cx="0.6" cy="-2.8" r="0.6" strokeWidth={pen(0.9)} />
        <circle cx="2.2" cy="-2" r="0.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  column: {
    body: (pen) => (
      <>
        <path d="M-2.8-4.6h5.6v9.2h-5.6z" strokeWidth={pen(1.5)} />
        <path d="M-2.8-4.6q2.8-1.4 5.6 0M-2.8 4.6q2.8 1.4 5.6 0" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.8-2.4h5.6M-2.8 0h5.6M-2.8 2.4h5.6" strokeWidth={pen(1.15)} />
        <path d="M2.8 1.2h2.4M-2.8-3.6h-2.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  vessel: {
    body: (pen) => (
      <>
        <path d="M-3.8-4.2h7.6v6.9a3.8 3.8 0 0 1-7.6 0z" strokeWidth={pen(1.5)} />
        <path d="M-5-4.2h10" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.8-1.1h7.6" strokeWidth={pen(1.15)} />
        <path d="M2.6 3.4h2.2v2" strokeWidth={pen(1.15)} />
        <path d="M-3.8 1.4h7.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  core_vessel: {
    body: (pen) => (
      <>
        <path d="M-5-4.6h10v9.2h-10z" strokeWidth={pen(1.5)} />
        <path d="M-2.6-2.6h5.2v5.2h-5.2z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle r="1.2" strokeWidth={pen(1.15)} />
        <path d="M0-1.2v-0.9M0 1.2v0.9M-1.2 0h-0.9M1.2 0h0.9" strokeWidth={pen(0.9)} />
        <path d="M-3.8-3.8h7.6v7.6h-7.6z" strokeDasharray="0.9 0.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  loop: {
    body: (pen) => (
      <>
        <path d="M-5.6-4.4h4.4v3.6h-4.4z" strokeWidth={pen(1.5)} />
        <path d="M-3.4-0.8v1.6h5.8a2.2 2.2 0 0 1 0 4.4h-5.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M2.6 0.4l1.4 1.4M4 0.4l-1.4 1.4" strokeWidth={pen(1.15)} />
        <path d="M0 0.8l0.9 0.5-0.9 0.5M0 5.2l-0.9-0.5 0.9-0.5" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  flue: {
    body: (pen) => (
      <>
        <path d="M-2.6 5.6V-2.4h8.2" strokeWidth={pen(1.5)} />
        <path d="M-0.4 5.6V-0.2h6" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-4.4 5.6V2.4h1.8" strokeWidth={pen(1.15)} />
        <path d="M2.4-1.3h1.8M4.2-1.3l-0.7-0.6M4.2-1.3l-0.7 0.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  hood: {
    body: (pen) => (
      <>
        <path d="M-5 1.4L-3-2.6h6l2 4z" strokeWidth={pen(1.5)} />
        <path d="M-0.8-2.6V-5.4h1.6v2.8" strokeWidth={pen(1.5)} />
        <path d="M0.8-4.8h4.6" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3 3l0.8-1.2M0 3.2V1.8M3 3l-0.8-1.2" strokeWidth={pen(1.15)} />
        <path d="M-5.4 4h10.8" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  plough: {
    body: (pen) => (
      <>
        <path d="M-5.4 3.6L-2-1.4h4l3.4 5z" strokeWidth={pen(1.5)} />
        <path d="M-2-1.4v-2.6h4v2.6" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2.4 3.6l1.4-3.4M2.4 3.6l-1.4-3.4" strokeWidth={pen(1.15)} />
        <circle cx="-1" cy="-2.8" r="0.5" strokeWidth={pen(0.9)} />
        <circle cx="1" cy="-2.8" r="0.5" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  tools: {
    body: (pen) => (
      <>
        <path d="M-5.4-4h10.8v8h-10.8z" strokeWidth={pen(1.5)} />
        <path d="M-3.4-2.2h2.2v1h-0.7v3.9h-0.8v-3.9h-0.7z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="2.2" cy="-1.4" r="1" strokeWidth={pen(1.15)} />
        <path d="M2.2-0.4V2.6" strokeWidth={pen(1.15)} />
        <path
          d="M-3.9-2.7h3.2v5.2h-3.2zM1.2-2.6h2v5.8h-2z"
          strokeDasharray="0.8 0.7"
          strokeWidth={pen(0.9)}
        />
      </>
    ),
  },

  // -------------------------------------------------------------------- structure and fabric
  frame: {
    body: (pen) => (
      <>
        <path d="M-5-3.6h10v7.2h-10z" strokeWidth={pen(1.5)} />
        <path d="M-5-3.6l10 7.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-5 0h1.2M5 0h-1.2M0-3.6v1.2M0 3.6v-1.2" strokeWidth={pen(1.15)} />
        <path d="M-5-2.2l1.4-1.4M5 2.2l-1.4 1.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  mast: {
    body: (pen) => (
      <>
        <path d="M-0.7-5.2V4.6M0.7-5.2V4.6" strokeWidth={pen(1.5)} />
        <path d="M0-3.8L-4.8 4.6M0-3.8L4.8 4.6" strokeWidth={pen(1.5)} />
        <path d="M-5.4 4.6h10.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-0.7-3.4h1.4M-0.7-1.4h1.4M-0.7 0.6h1.4M-0.7 2.6h1.4" strokeWidth={pen(1.15)} />
        <path d="M-4.8 4.6l-0.6 1M4.8 4.6l0.6 1" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  rack: {
    body: (pen) => (
      <>
        <path d="M-4.6-4.6V4.6M4.6-4.6V4.6" strokeWidth={pen(1.5)} />
        <path d="M-4.6-2h9.2M-4.6 1h9.2M-4.6 4h9.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.6-2v-1.8h2.4V-2M0.4 1v-2.2h2.8V1" strokeWidth={pen(1.15)} />
        <path d="M-4.6-4.6h9.2M-2.4 4v-1.4h1.6V4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  bunk: {
    body: (pen) => (
      <>
        <path d="M-4.6-5V4.6M4.6-5V4.6" strokeWidth={pen(1.5)} />
        <path
          d="M-4.6-3.4h9.2v1h-9.2zM-4.6 0h9.2v1h-9.2zM-4.6 3.4h9.2v1h-9.2z"
          strokeWidth={pen(1.5)}
        />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M-4 -3.4v-1.1h1.8v1.1M-4 0v-1.1h1.8V0M-4 3.4v-1.1h1.8v1.1"
          strokeWidth={pen(1.15)}
        />
        <path d="M3.2-3.4v6.8M2.4-2.2h1.6M2.4 0.6h1.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  seat: {
    body: (pen) => (
      <>
        <path d="M-5.4-3.4h10.8v1.6h-10.8z" strokeWidth={pen(1.5)} />
        <path d="M-5.4 0.6h10.8v1.8h-10.8z" strokeWidth={pen(1.5)} />
        <path d="M-4 2.4v2.2M4 2.4v2.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.8 0.6v1.8M1.8 0.6v1.8M-1.8-3.4v1.6M1.8-3.4v1.6" strokeWidth={pen(1.15)} />
        <path d="M-5.4-1.8v2.4M5.4-1.8v2.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  door: {
    body: (pen) => (
      <>
        <path d="M-3-4.6h6v9.2h-6z" strokeWidth={pen(1.5)} />
        <circle cx="2" cy="0.4" r="0.5" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2-3.4h4v3h-4zM-2 1.2h4v3h-4z" strokeWidth={pen(1.15)} />
        <path d="M3-4.6a4.6 4.6 0 0 1 0 9.2" strokeDasharray="1.1 0.9" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  board: {
    // A board stands on a post, and that is the whole of how it is told apart from a table at
    // 36px: ruled paper and a ruled board are the same rectangle otherwise.
    body: (pen) => (
      <>
        <path d="M-5.2-4.6h10.4v6.4h-10.4z" strokeWidth={pen(1.5)} />
        <path d="M0 1.8v3.4M-2.2 5.2h4.4" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-5.2-2.8h10.4M-2.6-4.6v6.4M0-4.6v6.4M2.6-4.6v6.4" strokeWidth={pen(1.15)} />
        <path
          d="M-4.4-1.4h1.2M-1.8-1.4h1.2M0.8-1.4h1.2M-4.4 0.6h1.2M0.8 0.6h1.2"
          strokeWidth={pen(0.9)}
        />
      </>
    ),
  },
  weave: {
    body: (pen) => (
      <path d="M-4.6-4.8V4.8M-1.5-4.8V4.8M1.5-4.8V4.8M4.6-4.8V4.8" strokeWidth={pen(1.5)} />
    ),
    detail: (pen) => (
      <>
        <path d="M-5.6-3h11.2M-5.6 0h11.2M-5.6 3h11.2" strokeWidth={pen(1.15)} />
        <path
          d="M-3.05-4.8V4.8M0-4.8V4.8M3.05-4.8V4.8"
          strokeDasharray="1.4 1.6"
          strokeWidth={pen(0.9)}
        />
      </>
    ),
  },
  net: {
    body: (pen) => (
      <path
        d="M-5.4-2.6L-1.4 1.4M-1.4-2.6L2.6 1.4M2.6-2.6L5.4 0.2M-5.4 1.4L-1.4-2.6M-1.4 1.4L2.6-2.6M2.6 1.4L5.4-1.4"
        strokeWidth={pen(1.5)}
      />
    ),
    detail: (pen) => (
      <>
        <path d="M-5.6-3.2h11.2" strokeWidth={pen(1.15)} />
        <path d="M-4 1.8v3M-2 1.8v3.6M0 1.8v2.8M2 1.8v3.6M4 1.8v3" strokeWidth={pen(1.15)} />
        <circle cx="-1.4" cy="1.4" r="0.4" strokeWidth={pen(0.9)} />
        <circle cx="2.6" cy="1.4" r="0.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  pattern: {
    body: (pen) => (
      <>
        <path d="M-5.4 4.2L-3.8-4.2h2.8L0 4.2z" strokeWidth={pen(1.5)} />
        <path d="M0.8 4.2L1.8-4.2h2.6l1.2 8.4z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M-4.4 3.4L-3.2-3.4h1.6L-0.9 3.4M1.9 3.4L2.6-3.4h1.4l0.9 6.8"
          strokeDasharray="0.9 0.8"
          strokeWidth={pen(0.9)}
        />
        <path d="M-2.4-4.2v-1M2.9-4.2v-1" strokeWidth={pen(1.15)} />
      </>
    ),
  },
  cut_list: {
    body: (pen) => (
      <>
        <path d="M-5-4.6h10v9.2h-10z" strokeWidth={pen(1.5)} />
        <path d="M-5-0.8h10M0.6-4.6v5.4" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-3.6-2.8h1.4M2.4-2.8h1.4M-1.6 2h1.4" strokeWidth={pen(1.15)} />
        <path d="M-5 3h10" strokeDasharray="1 0.9" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  boot: {
    body: (pen) => (
      <path d="M-5.4 2.2V0.6c0-1.3 1-2 2.4-2h5.4c1.9 0 3 0.9 3 2v1.6z" strokeWidth={pen(1.5)} />
    ),
    detail: (pen) => (
      <>
        <path d="M-5.4 0.8h10.8M-5.4 1.6h10.8" strokeWidth={pen(1.15)} />
        <path d="M-4 2.2v1.1M-2 2.2v1.1M0 2.2v1.1M2 2.2v1.1M4 2.2v1.1" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  strap: {
    body: (pen) => (
      <>
        <path d="M-5.6-1.4h11.2v2.8h-11.2z" strokeWidth={pen(1.5)} />
        <path d="M-1.8 1.4h3.6v2.8h-3.6z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M2.2-2.2h2.2v4.4h-2.2z" strokeWidth={pen(1.15)} />
        <circle cx="-0.9" cy="3" r="0.5" strokeWidth={pen(0.9)} />
        <circle cx="0.9" cy="3" r="0.5" strokeWidth={pen(0.9)} />
        <path d="M-5.6 0h6.4" strokeDasharray="0.8 0.7" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  braid: {
    // Three strands going into one cable, with the twist drawn on it. The first pass ran the
    // strands almost flat and the whole mark read as a single line with a box on the end.
    body: (pen) => (
      <>
        <path
          d="M-5.6-3.6C-3-3.6-3.4-1.4-1.4-1.4M-5.6 0h4.2M-5.6 3.6C-3 3.6-3.4 1.4-1.4 1.4"
          strokeWidth={pen(1.5)}
        />
        <path d="M-1.4-1.5h7v3h-7z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M0-1.5l1.2 1.5-1.2 1.5M2.4-1.5l1.2 1.5-1.2 1.5M4.8-1.5l1.2 1.5-1.2 1.5"
          strokeWidth={pen(1.15)}
        />
        <circle cx="-5.6" cy="-3.6" r="0.4" strokeWidth={pen(0.9)} />
        <circle cx="-5.6" cy="3.6" r="0.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  lace: {
    body: (pen) => (
      <>
        <path d="M-3.6-4.8V4.8M3.6-4.8V4.8" strokeWidth={pen(1.5)} />
        <path d="M-3.6-3.6L3.6-1.2-3.6 1.2 3.6 3.6" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-3.6" cy="-3.6" r="0.5" strokeWidth={pen(1.15)} />
        <circle cx="3.6" cy="-1.2" r="0.5" strokeWidth={pen(1.15)} />
        <circle cx="-3.6" cy="1.2" r="0.5" strokeWidth={pen(1.15)} />
        <circle cx="3.6" cy="3.6" r="0.5" strokeWidth={pen(1.15)} />
        <path d="M-3.6-3.6l-1.8-1.2M3.6 3.6l1.8 1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  bolts: {
    body: (pen) => <path d="M-4.4-3.4h8.8v6.8h-8.8z" strokeWidth={pen(1.5)} />,
    detail: (pen) => (
      <>
        <circle cx="-2.6" cy="-1.8" r="0.9" strokeWidth={pen(1.15)} />
        <circle cx="2.6" cy="-1.8" r="0.9" strokeWidth={pen(1.15)} />
        <circle cx="-2.6" cy="1.8" r="0.9" strokeWidth={pen(1.15)} />
        <circle cx="2.6" cy="1.8" r="0.9" strokeWidth={pen(1.15)} />
        <path d="M-1.2 0h2.4M0-1.2v2.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  mould: {
    body: (pen) => (
      <>
        <path d="M-5.2-3.6h4.6v7.2h-4.6z" strokeWidth={pen(1.5)} />
        <path d="M0.6-3.6h4.6v7.2h-4.6z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-0.6-2h-2.2l1 4.4h1.2M0.6-2h2.2l-1 4.4H0.6" strokeWidth={pen(1.15)} />
        <path d="M-1.6-3.6v-1.2M1.6-3.6v-1.2" strokeWidth={pen(1.15)} />
        <path d="M-4.6 3.6l1.2-1.2M3.4 3.6l1.2-1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  fuse: {
    body: (pen) => (
      <>
        <path d="M-1 3.8A3.8 3.8 0 1 0-1-3.8" strokeWidth={pen(1.5)} />
        <path d="M-1-3.8A2.2 2.2 0 1 0-1 0.6" strokeWidth={pen(1.5)} />
        <path d="M-1-3.8l2.8-0.9" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M1.8-4.7l1.2-0.8M1.8-4.7l0.4-1.2M2.6-4.2l1.2 0.2" strokeWidth={pen(1.15)} />
        <path d="M-1 3.8h-1.2M-3.4 1.6h-1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  shell: {
    body: (pen) => (
      <path
        d="M-1.8 5h3.6V-1.4c0-2.1-0.9-3.7-1.8-4.5-0.9 0.8-1.8 2.4-1.8 4.5z"
        strokeWidth={pen(1.5)}
      />
    ),
    detail: (pen) => (
      <>
        <path d="M0.6-1.4l-1.1 1.7 1 1.5-0.8 1.5" strokeWidth={pen(1.15)} />
        <path d="M-1.8 3.4h3.6M-1.8 2h3.6" strokeWidth={pen(0.9)} />
        <path d="M-2.6 4.4h-1.4M2.6 4.4h1.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  key: {
    body: (pen) => (
      <>
        <circle cx="-3.4" cy="-3" r="1.5" strokeWidth={pen(1.5)} />
        <circle cx="0.8" cy="-3" r="1.5" strokeWidth={pen(1.5)} />
        <path d="M-3.4-1.5v6.2M0.8-1.5v6.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M-3.4 1.2h1v0.9h-1M-3.4 3h1v0.9h-1M0.8 0.8h1v1h-1M0.8 2.8h1v1h-1"
          strokeWidth={pen(1.15)}
        />
        <circle cx="-3.4" cy="-3" r="0.5" strokeWidth={pen(0.9)} />
        <circle cx="0.8" cy="-3" r="0.5" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  knot: {
    body: (pen) => (
      <>
        <path d="M-2.4 5C-5.4 2.2-4.6-3 0-3s5.4 5.2 2.4 8" strokeWidth={pen(1.5)} />
        <path d="M-3.6 0.4C-1 3 1 3 3.6 0.4" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.4 1.6q1.4 1.6 2.8 0" strokeWidth={pen(1.15)} />
        <path d="M-2.4 5l-1.6 1M2.4 5l1.6 1" strokeWidth={pen(0.9)} />
      </>
    ),
  },

  // --------------------------------------------------------------- bodies, and what is on one
  figure: {
    body: (pen) => (
      <>
        <circle cy="-3.2" r="1.9" strokeWidth={pen(1.5)} />
        <path d="M-4.2 4.4c0-3 1.9-4.7 4.2-4.7s4.2 1.7 4.2 4.7" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-4.2 4.4h8.4" strokeWidth={pen(1.15)} />
        <path d="M-5.4 5.4h10.8M0-5.1v-1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  face: {
    body: (pen) => (
      <>
        <ellipse cx="-3.7" cy="-0.4" rx="1.7" ry="2.5" strokeWidth={pen(1.5)} />
        <ellipse cy="-0.4" rx="1.7" ry="2.5" strokeWidth={pen(1.5)} />
        <ellipse cx="3.7" cy="-0.4" rx="1.7" ry="2.5" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M-4.3-1h0.5M-3.1-1h0.5M-0.6-1h0.5M0.6-1h0.5M3.1-1h0.5M4.3-1h0.5"
          strokeWidth={pen(1.15)}
        />
        <path d="M-3.7 0.2v0.9M0 0.2v0.9M3.7 0.2v0.9" strokeWidth={pen(1.15)} />
        <path d="M-5.4 3.4h10.8M-5.4 2.8v1.2M5.4 2.8v1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  mirrored_pair: {
    body: (pen) => (
      <>
        <path d="M-5.4-3.4h3.4l1.4 3.4-1.4 3.4h-3.4z" strokeWidth={pen(1.5)} />
        <path d="M5.4-3.4h-3.4l-1.4 3.4 1.4 3.4h3.4z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="3.4" r="0.8" strokeWidth={pen(1.15)} />
        <path d="M0-4.6V4.6" strokeDasharray="1.2 0.9" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  footprints: {
    body: (pen) => (
      <>
        <ellipse cx="-2.4" cy="-1.6" rx="1.1" ry="1.9" strokeWidth={pen(1.5)} />
        <ellipse cx="1.8" cy="1.8" rx="1.1" ry="1.9" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M-5.4-4.4h10.8M-5.4 0h10.8M-5.4 4.4h10.8M-3.4-5V5M0.4-5V5M4.2-5V5"
          strokeWidth={pen(0.9)}
        />
        <path d="M-2.4 0.6v0.9M1.8 4v0.9" strokeWidth={pen(1.15)} />
      </>
    ),
  },
  speaker: {
    body: (pen) => (
      <>
        <path d="M-5-4.4h10v8.8h-10z" strokeWidth={pen(1.5)} />
        <path d="M-2.6-1.2h1.4l2.2-2v6.4l-2.2-2h-1.4z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path
          d="M2.2-1.4a2.4 2.4 0 0 1 0 2.8M3.6-2.8a4.4 4.4 0 0 1 0 5.6"
          strokeWidth={pen(1.15)}
        />
        <path d="M-4.2 2.2h1.2M-4.2 3.4h1.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  ballast: {
    body: (pen) => (
      <>
        <circle cy="-4" r="1.3" strokeWidth={pen(1.5)} />
        <path d="M0-2.7V1.4" strokeWidth={pen(1.5)} />
        <path d="M-2.4 1.4h4.8v3.4h-4.8z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-2-5.4h4" strokeWidth={pen(1.15)} />
        <path d="M-2.4 4.8l1.6-3.4M0 4.8l1.6-3.4" strokeWidth={pen(0.9)} />
        <path d="M3.2 1.4v3.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  balance: {
    body: (pen) => (
      <>
        <path d="M-5.4-1.6h10.8" strokeWidth={pen(1.5)} />
        <path d="M0-1.6l-1.8 3.6h3.6z" strokeWidth={pen(1.5)} />
        <path d="M-4.6-1.6v1.6M-5.8 0h2.4" strokeWidth={pen(1.5)} />
        <path d="M2.6 0h2.2v1.8h-2.2z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M3.7-1.6V0" strokeWidth={pen(1.15)} />
        <path d="M0-1.6v-2.4M-0.9-4h1.8" strokeWidth={pen(1.15)} />
        <path d="M-2.6 2h5.2" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  mortar_pestle: {
    body: (pen) => (
      <>
        <path d="M-3.6 0.4h7.2c0 2.7-1.6 4.4-3.6 4.4s-3.6-1.7-3.6-4.4z" strokeWidth={pen(1.5)} />
        <path d="M-4.6 0.4h9.2" strokeWidth={pen(1.5)} />
        <path d="M2.6-4.8l1.4 1-3.4 4.2-1.4-1z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-0.9" cy="0.2" r="0.9" strokeWidth={pen(1.15)} />
        <path d="M-3.2 2h6.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },

  // -------------------------------------------------------------------- what a drawing itself is
  plan: {
    body: (pen) => (
      <>
        <path d="M-5 4.2V-4.2h10v8.4h-3.2" strokeWidth={pen(1.5)} />
        <path d="M-1.6 4.2H-5" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M1.8 4.2V1.8" strokeWidth={pen(1.15)} />
        <path d="M1.8 1.8A2.4 2.4 0 0 0-0.6 4.2" strokeDasharray="1 0.9" strokeWidth={pen(0.9)} />
        <path d="M-5 0h4M2 -4.2v2.4" strokeWidth={pen(1.15)} />
      </>
    ),
  },
  elevation: {
    body: (pen) => (
      <>
        <path d="M-5-4h10v8h-10z" strokeWidth={pen(1.5)} />
        <path d="M-5-0.6h10" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M0-5.2V5.2" strokeDasharray="2.2 0.8 0.6 0.8" strokeWidth={pen(1.15)} />
        <path d="M-3.6-2.8h2v1.6h-2zM1.6-2.8h2v1.6h-2zM-3.6 1h2v1.8h-2z" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  section: {
    body: (pen) => <path d="M-4.6-3.6h9.2v3.4h-4.6v3.8h-4.6z" strokeWidth={pen(1.5)} />,
    detail: (pen) => (
      <>
        <path
          d="M-4.2 0.4l3.4-3.6M-2.2 3.4l5-5.4M0.8 3.4l3.6-3.8M-4.2 3.2l1.4-1.4"
          strokeWidth={pen(1.15)}
        />
        <path d="M-5.6-4.6h1.6M5.6-4.6h-1.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  exploded: {
    body: (pen) => (
      <>
        <path d="M-5.4-2.2h2.6v4.4h-2.6z" strokeWidth={pen(1.5)} />
        <path d="M-1.2-1.6h2.4v3.2h-2.4z" strokeWidth={pen(1.5)} />
        <path d="M2.8-2.6h2.6v5.2h-2.6z" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M1.6-0.8v1.6" strokeWidth={pen(1.15)} />
        <path d="M-5.8 0h11.6" strokeDasharray="1.6 0.7 0.4 0.7" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  dimension: {
    // Two runs stacked, not one. A single run sat low on the paper with nothing above it and read
    // at 36px as an empty sheet with a scratch on it; a drawing being dimensioned carries a witness
    // line at each end and more than one figure.
    body: (pen) => (
      <>
        <path d="M-5.6-4.6v6.4M5.6-4.6v6.4" strokeWidth={pen(1.5)} />
        <path d="M-5.6-1.8h11.2M-5.6-3.2v2.8M5.6-3.2v2.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-5.6 2.6h11.2M-5.6 1.2v2.8M5.6 1.2v2.8" strokeWidth={pen(1.15)} />
        <path d="M-1.8-3.6h3.6M-1.8 0.8h3.6" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  line_run: {
    body: (pen) => (
      <>
        <path d="M-5.4-2.6v5.2M5.4-2.6v5.2" strokeWidth={pen(1.5)} />
        <path d="M-5.4-0.8q5.4 4 10.8 0" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-5.4" cy="-0.8" r="0.6" strokeWidth={pen(1.15)} />
        <circle cx="5.4" cy="-0.8" r="0.6" strokeWidth={pen(1.15)} />
        <path d="M0 1.2v2.2M-0.7 3.4h1.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  table: {
    body: (pen) => (
      <>
        <path d="M-5.4-4h10.8v8h-10.8z" strokeWidth={pen(1.5)} />
        <path d="M-5.4-2h10.8" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-5.4 0h10.8M-5.4 2h10.8M0.6-4v8" strokeWidth={pen(1.15)} />
        <path
          d="M-4.4-1h1.8M1.6-1h2.2M-4.4 1h1.4M1.6 1h2.6M-4.4 3h2M1.6 3h1.6"
          strokeWidth={pen(0.9)}
        />
      </>
    ),
  },
  card: {
    // Small, held in a hand, and struck through: the Range Cards sheet sat in a tray next to two
    // full-sheet tables from other documents and the three read as one drawing three times.
    body: (pen) => (
      <>
        <path d="M-3.6-4.6h6l1.2 1.2v8h-7.2z" strokeWidth={pen(1.5)} />
        <path d="M-3.6-2h7.2" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <path d="M-1.2-2v6.6M1.2-2v6.6" strokeWidth={pen(1.15)} />
        <path
          d="M-3-0.6h1.2M-0.6-0.6h1.2M1.8-0.6h1.2M-3 1.2h1.2M1.8 1.2h1.2"
          strokeWidth={pen(0.9)}
        />
        <path d="M-3.4 2.8h7" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  chart: {
    body: (pen) => (
      <>
        <path d="M-4.6-4.6V3.8h9.2" strokeWidth={pen(1.5)} />
        <path d="M-4.6 2.6C-2 2.6-1-1 1.4-2.2c1.3-0.7 2.3-0.9 3.2-1" strokeWidth={pen(1.5)} />
      </>
    ),
    detail: (pen) => (
      <>
        <circle cx="-1.4" cy="1.2" r="0.4" strokeWidth={pen(1.15)} />
        <circle cx="1.4" cy="-2.2" r="0.4" strokeWidth={pen(1.15)} />
        <path d="M-4.6 0h9.2M0-4.6V3.8" strokeWidth={pen(0.9)} />
        <path d="M2 -2.8l2.2-1.8" strokeDasharray="0.8 0.7" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  list: {
    body: (pen) => <path d="M-2.6-3.6h8M-2.6-1.2h8M-2.6 1.2h8M-2.6 3.6h6" strokeWidth={pen(1.5)} />,
    detail: (pen) => (
      <>
        <circle cx="-4.4" cy="-3.6" r="0.7" strokeWidth={pen(1.15)} />
        <circle cx="-4.4" cy="-1.2" r="0.7" strokeWidth={pen(1.15)} />
        <circle cx="-4.4" cy="1.2" r="0.7" strokeWidth={pen(1.15)} />
        <circle cx="-4.4" cy="3.6" r="0.7" strokeWidth={pen(1.15)} />
        <path d="M-2.6 2.4h5" strokeWidth={pen(0.9)} />
      </>
    ),
  },
  prose: {
    body: (pen) => (
      <path
        d="M-4.8-3.4q1.2 0.9 2.4 0t2.4 0 2.4 0M-4.8-0.8q1.2 0.9 2.4 0t2.4 0 2.4 0M-4.8 1.8q1.2 0.9 2.4 0t2.4 0"
        strokeWidth={pen(1.5)}
      />
    ),
    detail: (pen) => (
      <>
        <path d="M-5.8-4.6V4.6" strokeWidth={pen(1.15)} />
        <path d="M-4.8 4.4q1.2 0.9 2.4 0t1.6-0.2" strokeWidth={pen(0.9)} />
        <path d="M2.4-3.4h2.4" strokeWidth={pen(0.9)} />
      </>
    ),
  },
} as const;

/** Two decimals is past what a 48-unit box can show, and it keeps the markup comparable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Where the drawing sits on the paper, and how big it is drawn.
 *
 * One motif, filling the sheet, rather than the subject-plus-margin-notes arrangement that stood
 * here before. A page's drawing is 22 units across on a 25-unit sheet; a cover's is 21 on the 23.5
 * of cover to the right of the spine, and sits high enough to clear the title block at its foot.
 * Both are centred, so the same motif is the same drawing on a page and on a cover.
 */
interface Plate {
  x: number;
  y: number;
  scale: number;
}

const PAGE_PLATE: Plate = { x: 25.5, y: 23.5, scale: 1.85 };
const COVER_PLATE: Plate = { x: 26.25, y: 20.5, scale: 1.75 };

/**
 * The drawing, placed.
 *
 * `data-motif` on the group is what the tests read: it is the one attribute that says which of the
 * hundred and ten this sheet drew, and comparing it across the catalogue is how "no two pages of a
 * document alike" is measured without anybody looking at two hundred and four pictures.
 */
function Drawing({ motif, plate, size }: { motif: BlueprintMotif; plate: Plate; size: GlyphSize }) {
  const art = MOTIFS[motif];
  const pen: Pen = (weight) => round(weight / plate.scale);
  return (
    <g data-motif={motif} transform={`translate(${plate.x} ${plate.y}) scale(${plate.scale})`}>
      {art.body(pen)}
      {size !== 'sm' && art.detail(pen)}
    </g>
  );
}

/**
 * A torn or ragged edge, as an absolute polyline.
 *
 * Absolute rather than relative segments so the run ends exactly where the outline expects it,
 * however the seed jitters the middle. A relative version drifts by up to three units over twelve
 * steps, which detaches the tear from the corner it is supposed to start at.
 *
 * This is the last seeded thing on the sheet, and it is deliberately not the drawing: a tear is
 * how the paper came apart, so two sheets of one document fray differently and draw differently for
 * two unrelated reasons.
 */
function raggedEdge(seed: string, x: number, top: number, bottom: number, out: number): string {
  const random = mulberry32(seedFrom(`${seed}:edge`));
  const steps = 8;
  const step = (bottom - top) / steps;
  let d = `M${x} ${bottom}`;
  for (let index = 1; index <= steps; index += 1) {
    const y = round(bottom - step * index);
    const at = index === steps || index % 2 === 0 ? x : round(x + out * (0.45 + random() * 0.55));
    d += `L${at} ${y}`;
  }
  return d;
}

interface GlyphProps {
  size?: GlyphSize | undefined;
  className?: string | undefined;
}

function Sheet({
  rarity,
  size,
  className,
  children,
}: GlyphProps & {
  rarity: ItemRarity;
  children: JSX.Element;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-size={size}
      data-rarity={rarity}
      /*
       * The glyph brings its own plate.
       *
       * A stroked mark needs a value under it, and on the pale lilac `.icon-tile` the rarity ink
       * washed out: brass on lavender at 44px was a smudge with a colour. `.icon-plate` is the
       * ground index.css already keeps for drawn marks rather than painted ones, and it is on the
       * svg itself rather than on the callers because the satchel row, the barrow card and the
       * item window all hand this component a box they own and none of them can be edited from
       * here. The one it costs is a thin lilac frame where a caller still wraps it in a tile.
       */
      className={cn('icon-plate rounded-[3px]', RARITY_INK[rarity], className)}
    >
      {children}
    </svg>
  );
}

/**
 * One page: a loose sheet, torn down the left where it came out of the document.
 *
 * The tear is the whole silhouette argument. A page and its document are the same object at two
 * stages and a player has to tell them apart in a satchel row at 36px, so one of them is bound and
 * the other one is not.
 */
export function PageGlyph({
  page,
  blueprint,
  size = 'md',
  className,
}: GlyphProps & { page: BlueprintPage; blueprint: BlueprintSpec }) {
  return (
    <Sheet rarity={pageRarity(blueprint, page)} size={size} className={className}>
      <>
        {/* The paper itself: a wash of the sheet's own ink, so a drawing on a dark plate still
            reads as ink on paper rather than as a wireframe floating in a box. */}
        <path
          d="M13 42.5V5.5h19L38 11.5V42.5z"
          fill="currentColor"
          fillOpacity="0.13"
          strokeWidth="1.8"
        />
        <path d={raggedEdge(page.id, 13, 5.5, 42.5, -1.5)} strokeWidth="1.4" />
        <path d="M32 5.5v6h6" strokeWidth="1.2" />
        <Drawing motif={page.motif} plate={PAGE_PLATE} size={size} />
        {/* The draughtsman's own furniture, and the whole of what the largest size adds: one
            dimension run along the foot, identical on every sheet. Fixed rather than seeded,
            because a mark that changes per page is a second drawing competing with the first. */}
        {size === 'lg' && (
          <path d="M16 38.6h19M16 37.5v2.2M35 37.5v2.2" strokeWidth="0.8" opacity="0.5" />
        )}
      </>
    </Sheet>
  );
}

/**
 * One document: a bound cover, with the fore-edge of the pages showing on the right.
 *
 * The cover draws the thing at the end of the document and no page of it draws the same, so a
 * document and its own pages are as distinguishable as two different documents are.
 */
export function BlueprintGlyph({
  blueprint,
  size = 'md',
  className,
}: GlyphProps & { blueprint: BlueprintSpec }) {
  return (
    <Sheet rarity={blueprint.rarity} size={size} className={className}>
      <>
        <path d="M9.5 5h28.5v38H9.5z" fill="currentColor" fillOpacity="0.13" strokeWidth="1.8" />
        <path d="M14.5 5v38" strokeWidth="1.3" />
        {/* The pages inside, ragged where they have been thumbed through. */}
        <path d={raggedEdge(blueprint.id, 38, 7.5, 40.5, 2)} strokeWidth="1.2" opacity="0.85" />
        <path d="M38 7.5h1.6M38 40.5h1.6" strokeWidth="1.1" opacity="0.85" />
        <Drawing motif={blueprint.motif} plate={COVER_PLATE} size={size} />
        {size !== 'sm' && (
          <>
            {/* Two stitches through the spine, and the title block at the foot of the cover. */}
            <path d="M12 14.5h1M12 33.5h1" strokeWidth="1.3" opacity="0.8" />
            <path d="M19 34.5h15v5.5H19z" strokeWidth="1" opacity="0.65" />
          </>
        )}
        {size === 'lg' && <path d="M20.5 36.4h9M20.5 38.4h11.5" strokeWidth="0.8" opacity="0.55" />}
      </>
    </Sheet>
  );
}
