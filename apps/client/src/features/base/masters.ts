import type { BuildingKind } from '@frontline/shared';

/**
 * Measured facts about the **delivered** structure masters, and the grade that seats them in the
 * district's painted ground.
 *
 * None of this is taste. Every number here was measured off the files in `assets/`, and
 * `scripts/district-masters.test.ts` re-measures them against this table — so a redrawn master that
 * changes shape or tone fails a gate instead of quietly standing in a box that no longer fits it or
 * glowing a stop brighter than the street it is standing in.
 *
 * It lives in the client rather than in the manifest because the manifest describes what an asset
 * *must be delivered as*; these are properties of the drawings that arrived. The scene needs both
 * before it has loaded a single image: it sizes the box, and it grades the pixels.
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
  /** Multiplier on every channel — `filter: brightness()`. */
  brightness: number;
  /** Multiplier on chroma about the luma axis — `filter: saturate()`. */
  saturate: number;
}

/**
 * How far each master is pulled toward the plate's tone, as a fraction of the whole distance.
 *
 * **Not 1.** The twelve masters run from a mean luminance of 40 to one of 108 against a plate at
 * 59.5, and normalising all of them onto that single number would be the renderer overruling the
 * drawings: a generator with a lit furnace *should* read brighter than a scrapyard. Pulling most of
 * the way closes the "pasted on" gap — the graded set spans 55 to 71 — while leaving the order and
 * the reasons for it intact.
 *
 * Saturation is pulled less than luminance, because the giveaway is brightness. A cutout a stop
 * hotter than the ground it stands on reads as a sticker from across the room; one slightly more
 * colourful than its neighbours just reads as painted more recently.
 */
export const GRADE_LUMINANCE_PULL = 0.85;
export const GRADE_SATURATION_PULL = 0.6;

/**
 * The most a master may be brightened.
 *
 * Brightening is a plain per-channel multiply, so it lifts a highlight as hard as it lifts a
 * shadow — and the two masters that measure dark are dark because most of their *area* is dirt,
 * not because anything in them is dim. The Scrapyard's chain-link rail was already the brightest
 * thing on that lot; ×1.27 clipped it into a white outline around the building, which is the exact
 * pasted-on look the grade exists to remove. Darkening has no equivalent failure, so it is not
 * capped: a building can always be in shadow.
 */
export const MAX_BRIGHTEN = 1.1;

/**
 * The per-structure grade, derived from the delivered files at {@link GRADE_LUMINANCE_PULL} and
 * {@link GRADE_SATURATION_PULL}.
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
