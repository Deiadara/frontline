import { describe, expect, it } from 'vitest';
import { ASSET_CLASS_SPECS, findAssetSpec } from '@frontline/shared';
import { DISTRICT_SITES, siteBox } from '../apps/client/src/features/base/plots.js';
import { annotationSvg, containedRect, groundSvg, padsFor } from './district-template.js';

const plate = ASSET_CLASS_SPECS.plate;
const pads = padsFor(plate.width, plate.height);
const everything = new Set(DISTRICT_SITES.map((site) => site.kind));

describe('the district plate template', () => {
  it('guides the plate that is actually in the manifest', () => {
    expect(findAssetSpec('plate-district'), 'plate-district must be in the manifest').toBeDefined();
    expect(groundSvg(plate.width, plate.height, pads)).toContain(
      `width="${plate.width}" height="${plate.height}"`,
    );
  });

  it('names every site, so no pad is painted over by accident', () => {
    const svg = annotationSvg(plate.width, plate.height, pads, everything);
    for (const site of DISTRICT_SITES) expect(svg, site.kind).toContain(`>${site.kind}</text>`);
  });

  /** A pad with no art behind it has to say so, or it reads as ground nobody needs to leave clear. */
  it('marks a site whose master has not been delivered', () => {
    const svg = annotationSvg(plate.width, plate.height, pads, new Set());
    // Every site, not a named one: the label is the same promise for all of them, and naming one
    // means this test goes stale the day that structure leaves the catalogue.
    for (const site of DISTRICT_SITES)
      expect(svg, site.kind).toContain(`${site.kind} — no master yet`);
  });

  /**
   * The guide is only worth anything if its pads are the *client's* pads. A generator that drew a
   * plausible-looking layout of its own would send the board off to paint a district the game does
   * not have, and nothing downstream would notice until the plate arrived and the structures sat
   * in the roads — so the pads are checked against the layout's own arithmetic.
   */
  it('places its pads where the layout puts them', () => {
    const nexus = DISTRICT_SITES.find((site) => site.kind === 'nexus');
    const pad = pads.find((candidate) => candidate.site.kind === 'nexus');
    expect(nexus && pad).toBeTruthy();
    if (!nexus || !pad) return;

    const box = siteBox(nexus);
    expect(pad.box.left).toBe(Math.round((box.x / 100) * plate.width));
    expect(pad.box.top).toBe(Math.round((box.y / 100) * plate.height));
    expect(pad.ground.y).toBe(Math.round((nexus.baseline / 100) * plate.height));
  });

  /**
   * `containedRect` is the template's copy of what the browser does with `object-contain` and
   * `object-bottom`. If it drifts, the guide shows the board a structure standing somewhere the
   * game will not put it — which is the one error this whole file exists to prevent.
   */
  describe('containedRect mirrors object-contain + object-bottom', () => {
    const pad = {
      site: DISTRICT_SITES[0]!,
      box: { left: 100, top: 200, width: 400, height: 300 },
      ground: { x: 300, y: 500 },
    };

    it('stands the art on the bottom edge of its pad, whatever its aspect', () => {
      for (const master of [
        { width: 1024, height: 1024 },
        { width: 1024, height: 683 },
        { width: 683, height: 1024 },
      ]) {
        const rect = containedRect(pad, master);
        expect(rect.top + rect.height, `${master.width}x${master.height}`).toBe(
          pad.box.top + pad.box.height,
        );
        expect(rect.width).toBeLessThanOrEqual(pad.box.width);
        expect(rect.height).toBeLessThanOrEqual(pad.box.height);
      }
    });

    it('centres it horizontally and keeps its aspect', () => {
      const rect = containedRect(pad, { width: 1024, height: 683 });
      expect(rect.left + rect.width / 2).toBeCloseTo(pad.box.left + pad.box.width / 2, 0);
      expect(rect.width / rect.height).toBeCloseTo(1024 / 683, 1);
    });
  });
});
