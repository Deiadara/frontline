import { BLUEPRINTS, findBlueprint, pageRarity, type BlueprintSpec } from '@frontline/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlueprintGlyph, PageGlyph, type GlyphSize } from './BlueprintGlyph';

/**
 * The drawings, measured rather than looked at.
 *
 * Two properties carry the whole feature, and neither is visible in a screenshot of one glyph.
 *
 * **Deterministic**: the same page draws the same sheet every render, on every screen, for every
 * player. A drawing that shuffles when a list re-renders is not a drawing of that page, it is
 * noise, and it would fail nowhere except in somebody's eyes.
 *
 * **Distinct**: two hundred and one glyphs, no two alike. This is the reason the work was done,
 * and it is the one thing a hand-written motif table can quietly lose by picking off a category
 * instead of an id.
 *
 * The markup compared is the svg's children, never its attributes: the root carries `data-rarity`
 * and the caller's classes, so comparing the whole element would let two identical drawings pass
 * on the strength of their ink. What is compared here is the picture.
 */

function drawing(node: HTMLElement): string {
  const svg = node.querySelector('svg');
  if (svg === null) throw new Error('no glyph rendered');
  return svg.innerHTML;
}

function pageDrawing(blueprint: BlueprintSpec, index: number, size: GlyphSize = 'lg'): string {
  const page = blueprint.pages[index];
  if (page === undefined) throw new Error(`${blueprint.id} has no page ${index}`);
  const { container, unmount } = render(
    <PageGlyph page={page} blueprint={blueprint} size={size} />,
  );
  const markup = drawing(container);
  unmount();
  return markup;
}

function coverDrawing(blueprint: BlueprintSpec, size: GlyphSize = 'lg'): string {
  const { container, unmount } = render(<BlueprintGlyph blueprint={blueprint} size={size} />);
  const markup = drawing(container);
  unmount();
  return markup;
}

function requireBlueprint(id: string): BlueprintSpec {
  const blueprint = findBlueprint(id);
  if (blueprint === undefined) throw new Error(`${id} is not in the catalogue`);
  return blueprint;
}

/** The motifs on the sheet, primary first. */
function motifs(markup: string): string[] {
  return [...markup.matchAll(/data-motif="([a-z]+)"/g)].map((match) => match[1] ?? '');
}

/**
 * The drawing proper: which motifs, at what size, turned which way, in which corner.
 *
 * Compared instead of the whole sheet because the whole sheet is too easy to pass. The tear down
 * the left edge and the drafting ticks are seeded off the id too, so a glyph whose *picture* had
 * stopped depending on the id at all would still hand back a hundred and sixty different strings
 * on the strength of its fraying. This is the part a player would call the drawing.
 */
function composition(markup: string): string {
  return [...markup.matchAll(/<g data-motif="[a-z]+" transform="[^"]+"/g)]
    .map((match) => match[0])
    .join('|');
}

describe('a glyph is the drawing for that page, not a drawing', () => {
  it('draws the same sheet every time it is asked', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    expect(pageDrawing(colossus, 3)).toBe(pageDrawing(colossus, 3));
    expect(coverDrawing(colossus)).toBe(coverDrawing(colossus));
  });

  it('gives every page and every document its own drawing', () => {
    const seen = new Map<string, string>();
    for (const blueprint of BLUEPRINTS) {
      const cover = composition(coverDrawing(blueprint));
      expect(seen.get(cover), `${blueprint.id} draws what ${seen.get(cover) ?? ''} draws`).toBe(
        undefined,
      );
      seen.set(cover, blueprint.id);
      for (const [index, page] of blueprint.pages.entries()) {
        const drawn = composition(pageDrawing(blueprint, index));
        expect(seen.get(drawn), `${page.id} draws what ${seen.get(drawn) ?? ''} draws`).toBe(
          undefined,
        );
        seen.set(drawn, page.id);
      }
    }
    expect(seen.size).toBe(BLUEPRINTS.length + BLUEPRINTS.reduce((n, b) => n + b.pages.length, 0));
  });

  /**
   * The one a family motif could hide.
   *
   * Every page of one document shares a subject, so if only the subject were drawn, eight Colossus
   * pages would be eight copies. The margin motifs are what separate them and they come off the
   * page's own id.
   */
  it('separates the eight pages of one document', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    const drawings = colossus.pages.map((_, index) => composition(pageDrawing(colossus, index)));
    expect(new Set(drawings).size).toBe(colossus.pages.length);
  });
});

describe('what is on the sheet comes from what the document builds', () => {
  it('draws a rotor for the machines that fly and an elevation for a building', () => {
    expect(motifs(coverDrawing(requireBlueprint('bp_rotorcraft')))[0]).toBe('rotor');
    expect(motifs(coverDrawing(requireBlueprint('bp_heli_porter')))[0]).toBe('rotor');
    expect(motifs(coverDrawing(requireBlueprint('bp_nexus_retrofit')))[0]).toBe('schematic');
  });

  it('draws a body for a unit, a chassis for a machine that drives, a plate for a trap', () => {
    expect(motifs(coverDrawing(requireBlueprint('bp_snipers')))[0]).toBe('figure');
    expect(motifs(coverDrawing(requireBlueprint('bp_scrap_car')))[0]).toBe('hull');
    expect(motifs(coverDrawing(requireBlueprint('bp_prepared_collapse')))[0]).toBe('bolts');
  });

  it('gives every page of a document the document subject, and its own margin notes', () => {
    const rotorcraft = requireBlueprint('bp_rotorcraft');
    const margins = rotorcraft.pages.map((_, index) => {
      const drawn = motifs(pageDrawing(rotorcraft, index));
      expect(drawn[0]).toBe('rotor');
      return drawn.slice(1).join('+');
    });
    // Seven pages, and no motif is ever the subject twice on one sheet.
    for (const pair of margins) expect(pair).not.toContain('rotor');
    expect(new Set(margins).size).toBeGreaterThan(1);
  });
});

describe('detail is dropped rather than redrawn as the glyph gets smaller', () => {
  it('draws one motif at 16px, two at 32px and three at 64px', () => {
    const specter = requireBlueprint('bp_the_specter');
    expect(motifs(pageDrawing(specter, 0, 'sm'))).toHaveLength(1);
    expect(motifs(pageDrawing(specter, 0, 'md'))).toHaveLength(2);
    expect(motifs(pageDrawing(specter, 0, 'lg'))).toHaveLength(3);
  });

  it('says on the element which of the three it drew', () => {
    const page = requireBlueprint('bp_the_specter').pages[0];
    if (page === undefined) throw new Error('the Specter lost a page');
    const { container } = render(
      <PageGlyph page={page} blueprint={requireBlueprint('bp_the_specter')} size="sm" />,
    );
    expect(container.querySelector('svg')?.getAttribute('data-size')).toBe('sm');
  });

  it('keeps the same subject in the same place at all three sizes', () => {
    const specter = requireBlueprint('bp_the_specter');
    const subject = /<g data-motif="[a-z]+" transform="[^"]+"/;
    const small = subject.exec(pageDrawing(specter, 2, 'sm'))?.[0];
    expect(small).toBeDefined();
    expect(pageDrawing(specter, 2, 'md')).toContain(small);
    expect(pageDrawing(specter, 2, 'lg')).toContain(small);
  });

  it('draws fewer strokes the smaller it gets', () => {
    const garage = requireBlueprint('bp_garage_retrofit');
    const strokes = (markup: string) =>
      markup.split('<path').length + markup.split('<circle').length;
    expect(strokes(pageDrawing(garage, 0, 'sm'))).toBeLessThan(
      strokes(pageDrawing(garage, 0, 'md')),
    );
    expect(strokes(pageDrawing(garage, 0, 'md'))).toBeLessThan(
      strokes(pageDrawing(garage, 0, 'lg')),
    );
  });
});

describe('rarity is the ink', () => {
  it('inks a document and its pages in their own tier, not in one colour', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    const { container } = render(<BlueprintGlyph blueprint={colossus} />);
    const cover = container.querySelector('svg');
    expect(cover?.getAttribute('data-rarity')).toBe('exotic');
    expect(cover?.getAttribute('class')).toContain('text-brass-300');

    // The Armour Schedule is one tier under the document it belongs to, and is drawn as such.
    const page = colossus.pages[6];
    if (page === undefined) throw new Error('the Colossus lost a page');
    expect(pageRarity(colossus, page)).toBe('rare');
    const sheet = render(<PageGlyph page={page} blueprint={colossus} />).container.querySelector(
      'svg',
    );
    expect(sheet?.getAttribute('data-rarity')).toBe('rare');
    expect(sheet?.getAttribute('class')).toContain('text-iris-100');
  });

  it('gives the four tiers four different inks', () => {
    const inks = new Set(
      ['bp_quarters_retrofit', 'bp_snipers', 'bp_the_twins', 'bp_the_colossus'].map((id) => {
        const { container } = render(<BlueprintGlyph blueprint={requireBlueprint(id)} />);
        return container.querySelector('svg')?.getAttribute('class') ?? '';
      }),
    );
    expect(inks.size).toBe(4);
  });
});

/**
 * The two things that made the drawings readable, and both are invisible in a passing glance.
 *
 * The board's note was that the glyphs were too small and too faint. Size was the caller's to fix;
 * faint was this component's, and it had two causes: a pale lilac ground under a stroked mark, and
 * a second drawing placed with `scale(0.7)` whose strokes then rendered at seven tenths of the
 * weight of the first. Both are the sort of thing that comes back the next time somebody tidies a
 * transform, so both are pinned.
 */
describe('a drawing on a dark plate, at one weight', () => {
  it('brings its own dark plate rather than standing on the pale one', () => {
    const { container } = render(
      <BlueprintGlyph blueprint={requireBlueprint('bp_snipers')} size="lg" />,
    );
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('icon-plate');
  });

  it('washes the paper in the sheet own ink so it reads as paper', () => {
    const sheet = pageDrawing(requireBlueprint('bp_snipers'), 0);
    expect(sheet).toContain('fill="currentColor"');
    expect(sheet).toContain('fill-opacity="0.13"');
  });

  /**
   * The pen, measured rather than trusted.
   *
   * A mark placed at `scale(0.85)` has to ask for a heavier line so the line that lands is the
   * same one the subject drew. The check is on the *product*, which is the width as it reaches the
   * paper: a motif that had gone back to writing plain widths would show the band at 0.85 of the
   * subject and fail here.
   */
  it('draws the second motif at the weight the first one is drawn at', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    const marks = [
      ...pageDrawing(colossus, 0).matchAll(
        /<g data-motif="[a-z]+" transform="[^"]*scale\(([\d.]+)\)"[^>]*>(.*?)<\/g>/gs,
      ),
    ];
    expect(marks.length).toBeGreaterThanOrEqual(2);
    const onPaper = marks.map((mark) => {
      const scale = Number(mark[1]);
      const widths = [...(mark[2] ?? '').matchAll(/stroke-width="([\d.]+)"/g)].map((m) =>
        Number(m[1]),
      );
      return Math.max(...widths) * scale;
    });
    const [subject, band] = onPaper;
    expect(subject).toBeDefined();
    expect(band).toBeDefined();
    if (subject === undefined || band === undefined) return;
    expect(band).toBeCloseTo(subject, 1);
  });

  /** A motif's own line is heavier than the draughtsman's ticks around it, at every size. */
  it('keeps the motif strokes heavier than the drafting ticks', () => {
    const sheet = pageDrawing(requireBlueprint('bp_snipers'), 0, 'lg');
    const ticks = [...sheet.matchAll(/d="M[\d.]+ [\d.]+h[\d.]+" stroke-width="([\d.]+)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(ticks.length).toBeGreaterThan(0);
    expect(Math.max(...ticks)).toBeLessThan(1.15);
  });
});

describe('a page and its document are one glance apart', () => {
  it('draws a page as a loose sheet and a document as a bound cover', () => {
    const snipers = requireBlueprint('bp_snipers');
    const cover = coverDrawing(snipers);
    const sheet = pageDrawing(snipers, 0);
    // The spine, which only a bound thing has, and the turned corner, which only a sheet has.
    expect(cover).toContain('M14.5 5v38');
    expect(sheet).not.toContain('M14.5 5v38');
    expect(sheet).toContain('M32 5.5v6h6');
    expect(cover).not.toContain('M32 5.5v6h6');
  });
});
