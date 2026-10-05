import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * One drawing per Black Market good (maintainer, 2026-10-05: "make the icons of the consumables
 * more diverse so different ones dont share the same icon").
 *
 * The shelf used to pick a card's mark by the good's kind, so all five battle boosts wore one sword
 * and all five contraband crates wore the crew's faces. Each good here is drawn as the thing the
 * fence is actually holding out: the syringe, the bag, the crate with the jack hanging off it.
 *
 * Same pen as `components/ui/Icon.tsx`: the 24 grid, one 1.6 stroke with round ends, outlines
 * rather than fills, nothing under about 2 units. The hand shows in the lines that do not quite
 * close or run quite square, and in the odd faint second pass (`F`), which is how the lock and the
 * unit slot in that set are drawn too.
 *
 * The four blueprints share a printer's registration mark in two corners and a dimension line, so
 * they read as plans of a thing rather than the thing itself. Every loose page shares one drawing,
 * a single torn sheet, because 258 of them could never each have their own.
 */

/** The shared stroke, the same values as `S` in `Icon.tsx`. */
const S = {
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
} as const;

/** The pen going over a line a second time, lighter: the lock's and the unit slot's under-stroke. */
const F = { ...S, strokeWidth: 1, opacity: 0.45 } as const;

/** Registration marks in two corners of a drawing sheet: what makes a blueprint read as a plan. */
const PLAN_CORNERS = <path d="M2.6 6.4V2.7h3.7M21.4 17.6v3.7h-3.7" {...F} />;

/** Every good that gets a drawing of its own. Pages are not listed: they all share {@link PAGE_GLYPH}. */
export const DRAWN_GOOD_IDS = [
  'adrenaline_syringes',
  'biochemical_infusers',
  'banned_explosives',
  'combat_stims',
  'nerve_gas_canisters',
  'crate_neural_shunts',
  'looted_targeting_cores',
  'salvaged_rotor_hub',
  'coolant_run',
  'ceramic_consignment',
  'refit_hardshell',
  'refit_wetwork',
  'refit_gunsmith',
  'stolen_cybernetics_plans',
  'munitions_schematics',
  'rotorcraft_plans',
  'field_medicine_notes',
] as const;

export type DrawnGoodId = (typeof DRAWN_GOOD_IDS)[number];

export const GOOD_GLYPHS: Record<DrawnGoodId, ReactNode> = {
  // A syringe on the diagonal, plunger back, a drop off the needle.
  adrenaline_syringes: (
    <>
      <g transform="translate(.6 -.4) rotate(-45 12 12)">
        <path d="M2.6 9.4l.2 5.2M2.8 12h4.7" {...S} />
        <path d="M7.4 8.2l.2 7.6" {...S} />
        <path d="M7.6 9.6l8.8.2-.1 4.5-8.7.1" {...S} />
        <path d="M10 9.7v4.6M12.6 9.8v1.9M14.6 9.8v1.9" {...S} />
        <path d="M16.4 10.8l2 .6v1.2l-2.1.6M18.4 12h3.8" {...S} />
      </g>
      <path d="M20.6 6.8c.7.9 1.1 1.5 1.1 2a1.1 1.1 0 0 1-2.2 0c0-.5.4-1.1 1.1-2z" {...S} />
    </>
  ),
  // A drip bag on its hanger, the liquid sloshing, the line curling off to whoever is wearing it.
  biochemical_infusers: (
    <>
      <path d="M10.8 4.6V2.9h2.5v1.7" {...S} />
      <path
        d="M6.4 6.2c0-1.1.6-1.6 1.7-1.6h7.9c1.1 0 1.6.6 1.6 1.7l-.3 7.2c-.2 2.6-2.3 3.4-5.3 3.4s-5.2-.8-5.4-3.4z"
        {...S}
      />
      <path d="M6.9 10.4c1.7-.9 3.4.8 5.1 0s3.4.8 5.2 0" {...S} />
      <path d="M12 16.9v1.6c0 2.6 3.4 3.2 5.4 1.6 1.4-1.1 1.8-2.8 2.6-4.6M20 15.5l1.2-1.8" {...S} />
    </>
  ),
  // Three sticks bound in tape, a fuse off the middle one and the spark already on it.
  banned_explosives: (
    <>
      <path
        d="M4.4 20.6V11a1.9 1.9 0 0 1 3.8 0 1.9 1.9 0 0 1 3.8 0 1.9 1.9 0 0 1 3.8 0v9.6z"
        {...S}
      />
      <path d="M8.2 11v3.3M12 11v3.3M8.2 17v3.6M12 17v3.6" {...S} />
      <path d="M3.9 14.4l12.4-.2M3.9 16.8l12.4.2" {...S} />
      <path d="M10.1 9.1c0-2.6 2-3 3.4-4 1-.7 1.6-1.6 3-1.7" {...S} />
      <path d="M18.6 1.6v1.8M21.4 4.2h-1.8M20.8 1.9l-1.2 1.2M20.6 6.4l-1-.9" {...S} />
    </>
  ),
  // A blister card of capsules, a little crooked, one bubble already pushed through and empty.
  combat_stims: (
    <g transform="rotate(-7 12 12)">
      <path d="M5.4 3.7l13.2-.1c.6 0 .9.3.9.9l-.1 15.5-14.2.1-.1-15.4c0-.6.3-1 .3-1z" {...S} />
      <rect x="7" y="5.6" width="3.6" height="5.6" rx="1.8" {...S} />
      <rect x="13.6" y="5.6" width="3.6" height="5.6" rx="1.8" {...S} />
      <rect x="7" y="13" width="3.6" height="5.6" rx="1.8" {...S} />
      <path d="M7.2 8.4h3.2M13.8 8.4h3.2M7.2 15.8h3.2" {...S} />
      <rect x="13.6" y="13" width="3.6" height="5.6" rx="1.8" {...S} />
    </g>
  ),
  // A squat cylinder with a valve on top, a hazard band round its middle and something leaking.
  nerve_gas_canisters: (
    <>
      <path d="M7.3 20.4L7.1 11c0-2.4 1.7-3.6 3.5-3.8h2.8c1.8.2 3.5 1.4 3.5 3.8l-.2 9.4z" {...S} />
      <path d="M10.6 7.2V5.5h2.8v1.7M12 5.5V3.4M9.6 3.3h4.8" {...S} />
      <path d="M7.2 12.6h9.6M7.2 16.4h9.6" {...S} />
      <path d="M8.4 16.3l2.3-3.6M11.6 16.3l2.3-3.6M14.8 16.3l2-3.1" {...S} />
      <path d="M15.4 4.6c1.2-.9 2.2.5 3.2-.2s1.6-1.7 3-1" {...S} />
      <path d="M16.2 6.8c1-.5 1.8.4 2.7 0" {...F} />
    </>
  ),
  // A braced crate with a jack on a lead coming out of its side.
  crate_neural_shunts: (
    <>
      <path d="M3 10.4l11.8-.2.2 10.4-12 .2z" {...S} />
      <path d="M3 13.4h11.9M3.2 20.6l11.6-7" {...S} />
      <path d="M15 16.6c2.6.1 4-1.2 4-3.8V11.6" {...S} />
      <path d="M17.4 11.6h3.2l-.1-4.2h-3z" {...S} />
      <path d="M18.2 7.4V5.9h1.6v1.5M19 5.9V2.6" {...S} />
    </>
  ),
  // A sighting module pulled off its mount: reticle in a hex housing, a lead torn off at the back.
  looted_targeting_cores: (
    <>
      <path d="M8 3.8h8.1l4 7.1-4.1 7.2H7.9l-4-7.2z" {...S} />
      <circle cx="12" cy="11" r="3.6" {...S} />
      <path d="M12 5.6v3M12 13.4v3M6.6 11h3M14.4 11h3" {...S} />
      <path d="M14.2 18.2c.2 1.8 1.6 2.6 3.4 2.4M17.6 20.6l1.2-1.4M17.6 20.6l1.6.6" {...S} />
    </>
  ),
  // A hub from above with three blade roots, one of them snapped off short.
  salvaged_rotor_hub: (
    <>
      <circle cx="12" cy="12" r="3.1" {...S} />
      <path d="M12 12h.01" {...S} />
      <path d="M10.6 9.2l-.3-5.2c.1-1.1.8-1.6 1.7-1.6s1.6.5 1.7 1.5l-.3 5.3" {...S} />
      <path
        d="M10.6 9.2l-.3-5.2c.1-1.1.8-1.6 1.7-1.6s1.6.5 1.7 1.5l-.3 5.3"
        transform="rotate(120 12 12)"
        {...S}
      />
      <path d="M10.6 9.2l-.4-4.6 1-.6.8 1 1-1.2.8.8-.4 4.6" transform="rotate(240 12 12)" {...S} />
    </>
  ),
  // A cell on a hand truck, frost on the cell and a drop of condensation running off it.
  coolant_run: (
    <>
      <path d="M3.6 4.4c.1-1 .7-1.4 1.6-1.4h1.1l.3 15.8h11.2" {...S} />
      <circle cx="5.4" cy="20" r="1.8" {...S} />
      <path d="M8.6 18.6V8.4c0-.7.4-1.2 1.2-1.2h5.4c.8 0 1.2.5 1.2 1.2v10.2" {...S} />
      <path d="M10.8 7.2V5.6h3.4v1.6" {...S} />
      <path d="M12.5 10.4v5.6M10.1 11.8l4.8 2.8M10.1 14.6l4.8-2.8" {...S} />
      <path d="M19.4 9.6c.7.9 1.1 1.5 1.1 2a1.1 1.1 0 0 1-2.2 0c0-.5.4-1.1 1.1-2z" {...S} />
    </>
  ),
  // Three trauma plates fanned on the pallet, chamfered at the shoulders, the front one cracked.
  ceramic_consignment: (
    <>
      <path d="M9 5.6l2.2-2.2h6.4l2.8 2.8v10h-2.2" {...S} />
      <path d="M6.8 7.8L9 5.6h6.4l2.8 2.8v10H16" {...S} />
      <path d="M4 10.6l2.8-2.8h6.4l2.8 2.8v10H4z" {...S} />
      <path d="M9.6 11.8l1.2 2-1 1.6 1.4 2.2" {...S} />
    </>
  ),
  // A carapace chestpiece: collar, armholes, two chest plates off a ridge and the belly in bands.
  refit_hardshell: (
    <>
      <path
        d="M4.2 6.6C6 5 8 4.4 9.6 4.2c.4 2 1.3 3 2.4 3s2-1 2.4-3c1.6.2 3.6.8 5.4 2.4l-1.6 3.6c.2 3.4-.4 6.8-1.6 10H7.4c-1.2-3.2-1.8-6.6-1.6-10z"
        {...S}
      />
      <path d="M12 7.2v3.6" {...S} />
      <path d="M5.9 10.2c2.4 1.5 4.6 1.6 6.1.6 1.5 1 3.7.9 6.1-.6" {...S} />
      <path d="M6.3 14c3.6.9 7.8.9 11.4 0M6.9 17.3c3.4.8 6.8.8 10.2 0" {...S} />
    </>
  ),
  // A fighting knife point up, and beside it the garrote: two toggles and a wire crossed into a noose.
  refit_wetwork: (
    <>
      <g transform="translate(4 0) rotate(90 12 12)">
        <path d="M2.4 10.6l10.6-.4v3H7.2c-2.2 0-3.8-1-4.8-2.6z" {...S} />
        <path
          d="M13 8.4v6.4M13 10.4h6.2c.9 0 1.4.5 1.4 1.2s-.5 1.2-1.4 1.2H13M16.2 10.4v2.4"
          {...S}
        />
      </g>
      <path d="M2.9 5.3h3M8.6 5.1h3" {...S} />
      <path d="M4.4 5.4c0 5.2 5.8 7.4 5.6 11.4-.2 3.4-5.2 3.6-5.6.4-.4-3.8 5.6-6.4 5.6-12" {...S} />
    </>
  ),
  // A pistol on the bench with the screwdriver that has been inside it.
  refit_gunsmith: (
    <>
      <path d="M3.4 5.4l15.8-.2.2 4H11l-1 .7 1.1 5.9H6.6L5.4 9.3H3.4z" {...S} />
      <path d="M17.2 5.3V4.2M11 9.2c.1 2 1.4 3 3 2.6l.4-2.6" {...S} />
      <path
        d="M3.4 17.6h4.9c.8 0 1.4.6 1.4 1.4s-.6 1.4-1.4 1.4H3.4c-.6 0-.9-.4-.9-1.4s.3-1.4.9-1.4z"
        {...S}
      />
      <path d="M9.7 19h8.6M18.3 18.2l2.2.1v1.4l-2.2.1" {...S} />
    </>
  ),
  // A plan of a cybernetic arm: shoulder, piston upper arm, elbow, forearm and the pincer.
  stolen_cybernetics_plans: (
    <>
      {PLAN_CORNERS}
      <circle cx="7" cy="7" r="2" {...S} />
      <path d="M5.8 8.6l.1 5M8.2 8.6l.1 5" {...S} />
      <circle cx="7.1" cy="15.4" r="1.8" {...S} />
      <path d="M8.8 14.4h5.4M8.8 16.4h5.4M14.2 13.4v4" {...S} />
      <path
        d="M14.2 13.6c1.6-1.6 3.4-2.2 5.2-1.6l-1.4 1.6M14.2 17.2c1.6 1.6 3.4 2.2 5.2 1.6l-1.4-1.6"
        {...S}
      />
      <path d="M11.4 6.4h7.6M11.4 5.2v2.4M19 5.2v2.4" {...S} />
    </>
  ),
  // A hollowpoint round in profile with the notch in its tip, its base end-on beside it, measured.
  munitions_schematics: (
    <>
      {PLAN_CORNERS}
      <g transform="translate(-2.2 0)">
        <path d="M9.4 11.6c0-3.6.5-5.4 1.2-6.4h1.8c.7 1 1.2 2.8 1.2 6.4" {...S} />
        <path d="M11 5.2l.5 1.4.5-1.4" {...S} />
        <path d="M8.8 11.6h5.4l.1 6.8H8.7z" {...S} />
        <path d="M8.2 18.4l.1 1.6h6.4l.1-1.6" {...S} />
      </g>
      <circle cx="17.4" cy="15.6" r="2.8" {...S} />
      <circle cx="17.4" cy="15.6" r="1" {...S} />
      <path d="M14.6 10.4h5.6M14.6 9.4v2M20.2 9.4v2" {...S} />
    </>
  ),
  // A helicopter in side elevation, rotor, skids and tail, with its length dimensioned underneath.
  rotorcraft_plans: (
    <>
      {PLAN_CORNERS}
      <path d="M4.4 6.4l13.2-.4M11 6.2v2.2" {...S} />
      <path
        d="M3.8 13.2c0-3 2.6-4.8 6-4.8h2.6c1.8 0 2.8 1.2 3 2.4l4.6-.4M3.8 13.2c.4 1.6 1.6 2.2 3.6 2.2H13l2-2.4 5-.8"
        {...S}
      />
      <path d="M20.2 8.2v4.6M4.8 11.6h3.4V9" {...S} />
      <path d="M7 15.4v2.6M12.4 15.4v2.6M4.6 18h9.8c.8 0 1.2-.4 1.6-1" {...S} />
      <path d="M4.4 20.6h11M4.4 19.6v2M15.4 19.6v2" {...F} />
    </>
  ),
  // A ring-bound notebook with a cross on the cover and a row of stitches across a cut.
  field_medicine_notes: (
    <>
      <path d="M6.4 3.6l12.2-.1c.5 0 .8.4.8.9l-.1 15.4c0 .5-.3.8-.8.8l-12.1.1z" {...S} />
      <path d="M4.4 6.4h3.6M4.4 10.4h3.6M4.4 14.4h3.6M4.4 18.4h3.6" {...S} />
      <path d="M12.2 5.8h2.4V8h2.2v2.4h-2.2v2.2h-2.4v-2.2H10V8h2.2z" {...S} />
      <path
        d="M9.8 16.8c2.2-.6 4.6.6 7.6-.2M11 15.2l.6 2.8M13.4 15.4l.6 2.8M15.8 15.2l.6 2.8"
        {...S}
      />
    </>
  ),
};

/**
 * One loose page: a sheet with its corner turned down, torn along the bottom, a scrap of drawing on
 * it. No corner marks, so it never passes for one of the four whole documents.
 */
export const PAGE_GLYPH: ReactNode = (
  <g transform="rotate(-6 12 12)">
    <path
      d="M5.6 3.4h8.8l4.2 4.2v10l-1.6 1.6-1.6-1.4-1.8 1.8-1.8-1.6-1.8 1.6-1.8-1.8-1.6 1.6-1.2-1.4z"
      {...S}
    />
    <path d="M14.4 3.4v4.2h4.2" {...S} />
    <circle cx="10.2" cy="10.4" r="2.4" {...S} />
    <path d="M12.6 10.4h3.4M8 15h7" {...S} />
  </g>
);

function hasOwnGlyph(goodId: string): goodId is DrawnGoodId {
  return Object.hasOwn(GOOD_GLYPHS, goodId);
}

export interface GoodIconProps {
  goodId: string;
  /** Tailwind size classes. Defaults to `h-5 w-5`, the same as `Icon`. */
  className?: string;
}

/**
 * A good's drawing, decorative: it always sits beside the good's name. A page, or an id the shelf
 * does not know, gets the loose page, which is what an unknown thing in the back room most likely
 * is and never a blank tile.
 */
export function GoodIcon({ goodId, className }: GoodIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-5 w-5 shrink-0', className)} aria-hidden>
      {hasOwnGlyph(goodId) ? GOOD_GLYPHS[goodId] : PAGE_GLYPH}
    </svg>
  );
}
