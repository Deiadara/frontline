import {
  BLUEPRINTS,
  BLUEPRINT_MOTIF_IDS,
  findBlueprint,
  pageRarity,
  type BlueprintSpec,
} from '@frontline/shared';
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
 * **Right**: a sheet draws what the catalogue says it draws, and the catalogue's rules hold on
 * screen. Two documents never draw the same cover, and no page of a document draws another page of
 * it or the cover above it. `motifs.test.ts` checks the assignment; this file checks that the
 * assignment is what reaches the paper, which is a different failure: a component that drew one
 * motif for everything would pass every test in shared.
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
  return [...markup.matchAll(/data-motif="([a-z_]+)"/g)].map((match) => match[1] ?? '');
}

/** The one motif on the sheet. Throws rather than returning a default: an empty sheet is the bug. */
function motifOf(markup: string): string {
  const [first] = motifs(markup);
  if (first === undefined) throw new Error('the sheet drew nothing');
  return first;
}

/**
 * The line work inside the drawing group: the strokes a player actually sees.
 *
 * Read separately from the `data-motif` label because the label is not the picture, and a mutant
 * proved it. Pointing every sheet at one motif's art while leaving the labels alone passed every
 * test in this file: each sheet still *said* it drew a rifle or a bore, and the whole archive
 * rendered as two hundred and four tables. Nothing below compares labels alone any more.
 */
function lineWork(markup: string): string {
  const mark = /<g data-motif="[a-z_]+" transform="[^"]+">(.*)<\/g>/s.exec(markup);
  if (mark === null) throw new Error('the sheet drew nothing');
  const drawn = mark[1] ?? '';
  if (drawn.length === 0) throw new Error('the drawing group is empty');
  return drawn;
}

/**
 * The drawing proper, and nothing else on the sheet: what it says it is, where, and the strokes.
 *
 * Compared instead of the whole sheet because the whole sheet is too easy to pass: the tear down
 * the left edge is seeded off the id, so a glyph whose *picture* had stopped depending on the sheet
 * at all would still hand back two hundred and four different strings on the strength of its
 * fraying. This is the part a player would call the drawing.
 */
function composition(markup: string): string {
  const mark = /<g data-motif="[a-z_]+" transform="[^"]+"/.exec(markup);
  return `${mark?.[0] ?? ''}|${lineWork(markup)}`;
}

describe('a glyph is the drawing for that page, not a drawing', () => {
  it('draws the same sheet every time it is asked', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    expect(pageDrawing(colossus, 3)).toBe(pageDrawing(colossus, 3));
    expect(coverDrawing(colossus)).toBe(coverDrawing(colossus));
  });

  /**
   * How many different pictures the catalogue actually draws.
   *
   * "No two sheets alike" was the old rule and it is not this one: two Hydraulics pages on two
   * machines should both draw a manifold, so two hundred and four sheets deliberately come out of a
   * smaller set. What is worth pinning is the size of that set, because the way this feature dies
   * is by shrinking: a component that fell back to one default for anything it did not recognise
   * would still pass every rule about documents and still turn the archive into wallpaper.
   */
  it('draws a hundred and eleven different pictures across the two hundred and four sheets', () => {
    const drawn = new Set<string>();
    for (const blueprint of BLUEPRINTS) {
      drawn.add(composition(coverDrawing(blueprint)));
      for (const index of blueprint.pages.keys()) {
        drawn.add(composition(pageDrawing(blueprint, index)));
      }
    }
    // The cover and the page place their drawing differently, so one motif can arrive here as two
    // strings; what matters is that neither number has collapsed.
    expect(drawn.size).toBeGreaterThanOrEqual(BLUEPRINT_MOTIF_IDS.length);
    expect(BLUEPRINT_MOTIF_IDS.length).toBe(111);
  });

  /**
   * The strokes, counted, with the labels ignored entirely.
   *
   * This is the one that catches a component drawing one motif's art under every motif's name. It
   * counts *line work* rather than `data-motif`, and it counts covers and pages apart because the
   * two plates place the same drawing at different scales: forty-one covers must produce forty-one
   * different pictures, and the pages must produce one per motif the pages actually use.
   */
  it('draws different line work for every motif, not one picture under many names', () => {
    const covers = new Set(BLUEPRINTS.map((blueprint) => lineWork(coverDrawing(blueprint))));
    expect(covers.size, 'two covers draw the same line work').toBe(BLUEPRINTS.length);

    const pages = new Set<string>();
    const motifsUsed = new Set<string>();
    for (const blueprint of BLUEPRINTS) {
      for (const [index, page] of blueprint.pages.entries()) {
        pages.add(lineWork(pageDrawing(blueprint, index)));
        motifsUsed.add(page.motif);
      }
    }
    expect(pages.size, 'the pages draw fewer pictures than they name motifs').toBe(motifsUsed.size);
  });

  /**
   * The one the old family motifs hid.
   *
   * Every page of one document used to share a subject and differ only in a seeded margin note, so
   * eight Colossus sheets were eight copies with a smudge in eight places. Every page of a document
   * is now a different object, and its own cover is a ninth.
   */
  it('separates the eight pages of the Colossus, and its cover from all of them', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    const pages = colossus.pages.map((_, index) => motifOf(pageDrawing(colossus, index)));
    expect(new Set(pages).size).toBe(colossus.pages.length);
    expect(pages).not.toContain(motifOf(coverDrawing(colossus)));
  });

  /** The whole catalogue, under the same two rules, because one document proves nothing. */
  it('never draws one document cover twice, and never repeats inside a document', () => {
    const covers = new Map<string, string>();
    for (const blueprint of BLUEPRINTS) {
      const cover = motifOf(coverDrawing(blueprint, 'sm'));
      const clash = covers.get(cover);
      expect(clash, `${blueprint.id} draws the cover of ${clash ?? ''}`).toBeUndefined();
      covers.set(cover, blueprint.id);

      const pages = blueprint.pages.map((_, index) => motifOf(pageDrawing(blueprint, index, 'sm')));
      expect(new Set(pages).size, `${blueprint.id} draws a page twice`).toBe(pages.length);
      expect(pages, `a page of ${blueprint.id} draws its cover`).not.toContain(cover);
    }
    expect(covers.size).toBe(BLUEPRINTS.length);
  });
});

/**
 * The sheet draws what the catalogue says, and it is the only thing on it.
 *
 * Written out by hand rather than read back off `page.motif`, on purpose: a test that asked the
 * catalogue what to expect would pass whatever the catalogue happened to say, including a catalogue
 * that had lost the lot to one default. These are the sheets the maintainer named in the brief, spelled
 * out, so a re-assignment has to be a deliberate edit here too.
 */
describe('what is on the sheet is what the catalogue says is on it', () => {
  it('draws the Sniper as a rifle, its bore, its ruled card and its net', () => {
    const snipers = requireBlueprint('bp_snipers');
    expect(motifOf(coverDrawing(snipers))).toBe('rifle');
    expect(snipers.pages.map((_, index) => motifOf(pageDrawing(snipers, index)))).toEqual([
      'bore',
      'card',
      'net',
    ]);
  });

  it('draws the Colossus as a walking hull, with a piston for its legs and a core for its reactor', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    expect(motifOf(coverDrawing(colossus))).toBe('walking_hull');
    expect(motifOf(pageDrawing(colossus, 1))).toBe('piston');
    expect(motifOf(pageDrawing(colossus, 3))).toBe('core_vessel');
  });

  it('draws the machines that fly as themselves rather than as one rotor', () => {
    expect(motifOf(coverDrawing(requireBlueprint('bp_rotorcraft')))).toBe('rotor_head');
    expect(motifOf(coverDrawing(requireBlueprint('bp_heli_porter')))).toBe('helicopter');
    const rotorcraft = requireBlueprint('bp_rotorcraft');
    expect(motifOf(pageDrawing(rotorcraft, 1))).toBe('swashplate');
  });

  it('draws a bus for the Cheese Wagon and a mortar and pestle for the thickened mix', () => {
    expect(motifOf(coverDrawing(requireBlueprint('bp_armoured_car')))).toBe('bus');
    // The mortar and pestle used to be pinned on the Munitions document's primer page. That
    // document went with the tiered refits (2026-09-15), and the one sheet still mixing anything
    // by hand is the Fuel Fougasse's second page.
    expect(motifOf(pageDrawing(requireBlueprint('bp_fuel_fougasse'), 1))).toBe('mortar_pestle');
  });

  /** One drawing per sheet. The seeded second and third marks are gone and stay gone. */
  it('puts exactly one drawing on every sheet, at every size', () => {
    const garage = requireBlueprint('bp_garage_retrofit');
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(motifs(pageDrawing(garage, 0, size))).toHaveLength(1);
      expect(motifs(coverDrawing(garage, size))).toHaveLength(1);
    }
  });

  /** Every id in the set is drawable: a motif with no art renders an empty group. */
  it('has art for every motif the catalogue can name', () => {
    for (const blueprint of BLUEPRINTS) {
      expect(coverDrawing(blueprint, 'md')).toContain(`data-motif="${blueprint.motif}"`);
    }
    const drawn = new Set(BLUEPRINTS.flatMap((b) => [b.motif, ...b.pages.map((p) => p.motif)]));
    expect(drawn.size).toBe(BLUEPRINT_MOTIF_IDS.length);
  });
});

describe('detail is dropped rather than redrawn as the glyph gets smaller', () => {
  /**
   * Every motif, at every size, because one sample is not the rule.
   *
   * A motif whose `detail` is empty draws the same picture at 16px and 36px, which is the quiet way
   * this rule rots: the sheet still renders, the tests on distinctness still pass, and the only
   * symptom is a glyph that never gets any better as it gets bigger. Measured over all two hundred
   * and four sheets so a new motif cannot be added without one.
   */
  it('gives every sheet in the catalogue more line at 36px than at 16px', () => {
    const strokes = (markup: string) =>
      markup.split('<path').length +
      markup.split('<circle').length +
      markup.split('<ellipse').length;
    for (const blueprint of BLUEPRINTS) {
      expect(
        strokes(coverDrawing(blueprint, 'sm')),
        `${blueprint.id} draws the same cover at both sizes`,
      ).toBeLessThan(strokes(coverDrawing(blueprint, 'md')));
      for (const [index, page] of blueprint.pages.entries()) {
        expect(
          strokes(pageDrawing(blueprint, index, 'sm')),
          `${page.id} draws the same sheet at both sizes`,
        ).toBeLessThan(strokes(pageDrawing(blueprint, index, 'md')));
      }
    }
  });

  it('says on the element which of the three sizes it drew', () => {
    const page = requireBlueprint('bp_the_specter').pages[0];
    if (page === undefined) throw new Error('the Specter lost a page');
    const { container } = render(
      <PageGlyph page={page} blueprint={requireBlueprint('bp_the_specter')} size="sm" />,
    );
    expect(container.querySelector('svg')?.getAttribute('data-size')).toBe('sm');
  });

  it('keeps the same subject in the same place at all three sizes', () => {
    const specter = requireBlueprint('bp_the_specter');
    const subject = /<g data-motif="[a-z_]+" transform="[^"]+"/;
    const small = subject.exec(pageDrawing(specter, 2, 'sm'))?.[0];
    expect(small).toBeDefined();
    expect(pageDrawing(specter, 2, 'md')).toContain(small);
    expect(pageDrawing(specter, 2, 'lg')).toContain(small);
  });

  /** And 72px adds the sheet's own furniture on top of that, rather than a third drawing. */
  it('draws fewer strokes the smaller it gets, and adds no motif on the way up', () => {
    const garage = requireBlueprint('bp_garage_retrofit');
    const strokes = (markup: string) =>
      markup.split('<path').length + markup.split('<circle').length;
    expect(strokes(pageDrawing(garage, 0, 'sm'))).toBeLessThan(
      strokes(pageDrawing(garage, 0, 'md')),
    );
    expect(strokes(pageDrawing(garage, 0, 'md'))).toBeLessThan(
      strokes(pageDrawing(garage, 0, 'lg')),
    );
    expect(motifs(pageDrawing(garage, 0, 'lg'))).toHaveLength(1);
  });
});

describe('rarity is the ink', () => {
  it('inks a document and its pages in their own tier, not in one colour', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    const { container } = render(<BlueprintGlyph blueprint={colossus} />);
    const cover = container.querySelector('svg');
    expect(cover?.getAttribute('data-rarity')).toBe('masterpiece');
    expect(cover?.getAttribute('class')).toContain('text-brass-300');

    // The Armour Schedule is one tier under the document it belongs to, and is drawn as such.
    const page = colossus.pages[6];
    if (page === undefined) throw new Error('the Colossus lost a page');
    expect(pageRarity(colossus, page)).toBe('advanced');
    const sheet = render(<PageGlyph page={page} blueprint={colossus} />).container.querySelector(
      'svg',
    );
    expect(sheet?.getAttribute('data-rarity')).toBe('advanced');
    expect(sheet?.getAttribute('class')).toContain('text-oxblood-300');
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
   * A motif is placed with a `scale()`, so it has to ask for a *lighter* number to land the weight
   * it means: the page's drawing is at 1.85, so the authored 1.5 is written as 0.81 and reaches the
   * paper at 1.5. The check is on the product. A motif that had gone back to writing plain widths
   * would land its outline at 2.8 on a page and 2.6 on a cover, and the whole catalogue would go
   * from crisp to woolly with nothing failing.
   */
  it('lands the outline at the authored weight whatever it is scaled by', () => {
    const colossus = requireBlueprint('bp_the_colossus');
    const heaviest = (markup: string) => {
      const mark =
        /<g data-motif="[a-z_]+" transform="[^"]*scale\(([\d.]+)\)"[^>]*>(.*?)<\/g>/s.exec(markup);
      expect(mark, 'no drawing on the sheet').not.toBeNull();
      const widths = [...(mark?.[2] ?? '').matchAll(/stroke-width="([\d.]+)"/g)].map((m) =>
        Number(m[1]),
      );
      return Math.max(...widths) * Number(mark?.[1]);
    };
    // The page is drawn at 1.85 and the cover at 1.75, so the two scales disagree and the two
    // outlines still have to arrive at the same 1.5.
    expect(heaviest(pageDrawing(colossus, 0))).toBeCloseTo(1.5, 1);
    expect(heaviest(coverDrawing(colossus))).toBeCloseTo(1.5, 1);
  });

  /** A motif's own line is heavier than the sheet's furniture around it. */
  it('keeps the motif strokes heavier than the dimension run under them', () => {
    const sheet = pageDrawing(requireBlueprint('bp_snipers'), 0, 'lg');
    // The run at the foot of the page, which only the largest size draws.
    const run = /d="M16 38.6h19[^"]*" stroke-width="([\d.]+)"/.exec(sheet);
    expect(run, 'the largest size drew no dimension run').not.toBeNull();
    expect(Number(run?.[1])).toBeLessThan(0.9);
    // ...and the same run is not on the smaller sheets, where it would be grain.
    expect(pageDrawing(requireBlueprint('bp_snipers'), 0, 'md')).not.toContain('M16 38.6h19');
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
