import type { BuildingKind } from '@frontline/shared';

/**
 * Measured facts about the **delivered** structure masters, and the grade that makes twelve of them
 * read as one set of portraits.
 *
 * None of this is taste. Every number here was measured off the files in `assets/`, and
 * `scripts/district-masters.test.ts` re-measures them against this table, so a redrawn master that
 * changes shape or tone fails a gate instead of quietly glowing a stop brighter than the eleven
 * beside it.
 *
 * It lives in the client rather than in the manifest because the manifest describes what an asset
 * *must be delivered as*; these are properties of the drawings that arrived.
 */

/**
 * The aspect (width ÷ height) each master trims to.
 *
 * A structure ships cropped to its own alpha box (the manifest's `trim` step), so these are the
 * proportions of the drawing itself and not of a canvas it was painted on.
 */
export const STRUCTURE_ASPECT: Readonly<Record<BuildingKind, number>> = {
  nexus: 0.8,
  cistern: 0.9,
  apothecary: 0.95,
  lab: 1.02,
  quarters: 1.03,
  gauntlet: 1.05,
  garage: 1.07,
  generator: 1.16,
  scrapyard: 1.27,
  gate: 1.34,
  infirmary: 1.38,
  greenhouse: 1.56,
};

/** A structure's tonal correction, as the two CSS filter functions that apply it. */
export interface StructureGrade {
  /** Multiplier on every channel: `filter: brightness()`. */
  brightness: number;
  /** Multiplier on chroma about the luma axis: `filter: saturate()`. */
  saturate: number;
}

/**
 * The tone twelve portraits are brought onto, as mean luminance (0-255) and mean HSV saturation.
 *
 * A **constant**, and it did not use to be. The masters were once cutouts pasted onto the district's
 * painted ground, so the thing they had to agree with was the plate, and the target was measured off
 * it. The delivered plate paints its own buildings; these are now the portrait in a structure's
 * window, framed on chrome, and what they have to agree with is *each other*: twelve icons in
 * identical frames, one of them a stop hotter than the rest, is the only way this set can look
 * wrong now.
 *
 * The numbers are the tone the set was approved at: what the ground the masters were cut for
 * measured, so pinning them changed nothing on screen. Pinning them is what stopped the delivered
 * plate, which measures 33.2, from silently dragging all twelve portraits down with it.
 */
export const PORTRAIT_TARGET_LUMINANCE = 59.55;
export const PORTRAIT_TARGET_SATURATION = 0.2641;

/**
 * How far each master is pulled toward that tone, as a fraction of the whole distance.
 *
 * **Not 1.** The twelve masters run from a mean luminance of 40 to one of 108, and normalising all
 * of them onto a single number would be the renderer overruling the drawings: a generator with a lit
 * furnace *should* read brighter than a scrapyard. Pulling most of the way closes the odd-one-out
 * gap, the graded set spans 55 to 71, while leaving the order and the reasons for it intact.
 *
 * Saturation is pulled less than luminance, because the giveaway is brightness. One portrait a stop
 * hotter than its neighbours reads as a mistake from across the room; one slightly more colourful
 * just reads as painted more recently.
 */
export const GRADE_LUMINANCE_PULL = 0.85;
export const GRADE_SATURATION_PULL = 0.6;

/**
 * The most a master may be brightened.
 *
 * Brightening is a plain per-channel multiply, so it lifts a highlight as hard as it lifts a
 * shadow, and the two masters that measure dark are dark because most of their *area* is dirt,
 * not because anything in them is dim. The Scrapyard's chain-link rail was already the brightest
 * thing on that lot; ×1.27 clipped it into a white outline around the building. Darkening has no
 * equivalent failure, so it is not capped: a building can always be in shadow.
 */
export const MAX_BRIGHTEN = 1.1;

/**
 * The per-structure grade, derived from the delivered files at {@link GRADE_LUMINANCE_PULL} and
 * {@link GRADE_SATURATION_PULL} toward {@link PORTRAIT_TARGET_LUMINANCE}.
 *
 * Written down rather than computed at load: deriving it in the browser would mean decoding twelve
 * masters to a canvas before the first paint, to recover numbers that only change when a master
 * does.
 */
export const STRUCTURE_GRADE: Readonly<Record<BuildingKind, StructureGrade>> = {
  apothecary: { brightness: 0.79, saturate: 0.79 },
  cistern: { brightness: 1.01, saturate: 0.96 },
  garage: { brightness: 1.1, saturate: 0.76 },
  gate: { brightness: 0.9, saturate: 0.82 },
  gauntlet: { brightness: 1.1, saturate: 0.92 },
  generator: { brightness: 0.84, saturate: 0.94 },
  greenhouse: { brightness: 0.79, saturate: 1.07 },
  infirmary: { brightness: 0.62, saturate: 1.17 },
  lab: { brightness: 0.7, saturate: 1.09 },
  nexus: { brightness: 0.66, saturate: 1.18 },
  quarters: { brightness: 0.63, saturate: 0.79 },
  scrapyard: { brightness: 1.1, saturate: 0.77 },
};

/** The grade as a CSS `filter` value, or `null` for a master that needs none. */
export function gradeFilter(kind: BuildingKind): string | null {
  const { brightness, saturate } = STRUCTURE_GRADE[kind];
  if (brightness === 1 && saturate === 1) return null;
  return `brightness(${brightness}) saturate(${saturate})`;
}
