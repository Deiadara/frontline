import { describe, expect, it } from 'vitest';
import { BLUEPRINTS } from './catalog.js';
import { BLUEPRINT_MOTIFS, BLUEPRINT_MOTIF_IDS, isBlueprintMotif } from './motifs.js';

/**
 * The drawings, checked as content rather than as art.
 *
 * The art itself is the client's (`BlueprintGlyph.tsx`), and what it can get wrong is a smudge,
 * which only an eye catches. What *this* side can get wrong is silent and total: a motif that names
 * nothing renders as an empty sheet, two documents that name the same cover are two documents a
 * player cannot tell apart in a row, and two pages of one document that name the same motif undo
 * the whole reason the ids were authored by hand.
 *
 * The type already forbids an id that is not in the set. It is checked again here because the type
 * is checked at build time and this catalogue is also read by a running server: a rule worth having
 * is worth having in the report.
 */

/**
 * Widened off the const-asserted catalogue on purpose.
 *
 * `BLUEPRINTS` is `as const`, so every motif here has a literal type and `isBlueprintMotif` on one
 * of them is a check the compiler has already decided the answer to. The rule under test is the
 * interface's: whatever this catalogue holds at run time names a real drawing.
 */
const DOCUMENTS: readonly {
  id: string;
  motif: string;
  pages: readonly { id: string; motif: string }[];
}[] = BLUEPRINTS.map((blueprint) => ({
  id: blueprint.id,
  motif: blueprint.motif,
  pages: blueprint.pages.map((page) => ({ id: page.id, motif: page.motif })),
}));

describe('every sheet names a drawing', () => {
  it('gives all forty-five documents and all one hundred and seventy-four pages one', () => {
    let pages = 0;
    for (const document of DOCUMENTS) {
      expect(isBlueprintMotif(document.motif), `${document.id} draws nothing`).toBe(true);
      for (const page of document.pages) {
        expect(isBlueprintMotif(page.motif), `${page.id} draws nothing`).toBe(true);
        pages += 1;
      }
    }
    expect(DOCUMENTS).toHaveLength(45);
    expect(pages).toBe(174);
  });

  /**
   * A motif nobody draws is a label nobody wrote a picture against.
   *
   * The failure it catches is the tidy-up: a page re-assigned to a better motif leaves its old one
   * orphaned, and the next person to read the set has no way to tell which of the hundred and ten
   * are load-bearing.
   */
  it('uses every id in the set, and names none that is not in it', () => {
    const drawn = new Set<string>();
    for (const document of DOCUMENTS) {
      drawn.add(document.motif);
      for (const page of document.pages) drawn.add(page.motif);
    }
    expect([...drawn].filter((motif) => !isBlueprintMotif(motif))).toEqual([]);
    expect(BLUEPRINT_MOTIF_IDS.filter((motif) => !drawn.has(motif))).toEqual([]);
  });

  it('writes each label as a phrase saying what is drawn', () => {
    for (const motif of BLUEPRINT_MOTIF_IDS) {
      const label = BLUEPRINT_MOTIFS[motif];
      expect(label.length, `${motif} has no label`).toBeGreaterThan(8);
      expect(label.trim(), `${motif} is padded`).toBe(label);
      // A label, not a sentence: it goes in a list of a hundred and ten, one line each.
      expect(label, `${motif} ends in a full stop`).not.toMatch(/[.]$/);
    }
  });
});

describe('no two sheets draw the same picture where it would matter (§D8)', () => {
  /** Forty-five covers, forty-five drawings: a cover is how a document is picked off a shelf. */
  it('never gives two documents the same cover', () => {
    const seen = new Map<string, string>();
    for (const document of DOCUMENTS) {
      const first = seen.get(document.motif);
      expect(first, `${document.id} draws the cover of ${first ?? ''}`).toBeUndefined();
      seen.set(document.motif, document.id);
    }
  });

  it('never repeats a motif inside one document', () => {
    for (const document of DOCUMENTS) {
      const motifs = document.pages.map((page) => page.motif);
      expect(new Set(motifs).size, `${document.id} draws a page twice: ${motifs.join(', ')}`).toBe(
        motifs.length,
      );
    }
  });

  /** A page that draws its own cover is the old family-motif bug with extra steps. */
  it('never draws a document cover on one of its own pages', () => {
    for (const document of DOCUMENTS) {
      for (const page of document.pages) {
        expect(page.motif, `${page.id} draws the ${document.id} cover`).not.toBe(document.motif);
      }
    }
  });

  /**
   * Sharing across documents is the point, so it is asserted rather than merely allowed.
   *
   * A hundred and ten ids carry two hundred and nineteen entries, and the reason that is right is
   * that a hydraulic block is a hydraulic block on whichever machine it is bolted to. A catalogue
   * where every entry had its own id would have quietly become two hundred and nineteen drawings
   * to keep.
   */
  it('shares motifs between documents rather than authoring one per entry', () => {
    const used = DOCUMENTS.flatMap((document) => [
      document.motif,
      ...document.pages.map((page) => page.motif),
    ]);
    expect(used).toHaveLength(219);
    expect(BLUEPRINT_MOTIF_IDS.length).toBeLessThan(used.length);
  });
});
