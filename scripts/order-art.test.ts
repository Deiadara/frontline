import { describe, expect, it, vi } from 'vitest';
import {
  ART_MANIFEST,
  HERO_ASSETS,
  NEGATIVE,
  OCCLUDED_BACKDROP_KEYS,
  STYLE_ANCHOR,
  findAssetSpec,
  type AssetSpec,
} from '@frontline/shared';
import { assemblePrompt } from './gen-art.js';
import {
  SECTIONS,
  groupIntoSections,
  main,
  orderPrompt,
  parseArgs,
  renderSheet,
} from './order-art.js';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`${key} is missing from the manifest`);
  return found;
};

const PORTRAIT = spec('portrait-overseer-1');
const ICON = spec('icon-scrap');

describe('sections', () => {
  it('partitions the manifest: no asset is listed twice or dropped', () => {
    const grouped = groupIntoSections().flatMap(({ specs }) => specs.map((s) => s.key));
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(ART_MANIFEST.map((s) => s.key).sort());
  });

  it('puts the hero assets first, then the two 16:9 opaque assets, then roster, alpha, occluded', () => {
    const [hero, wide, roster, alpha, occluded] = groupIntoSections();
    expect(hero!.specs.map((s) => s.key)).toEqual(HERO_ASSETS.map((s) => s.key));
    // Named rather than derived: joining this set means asking the board for a 2048×1152
    // render, which is the one size a plain ChatGPT download may not reach (§3 guidance).
    // `plate-district` is deliberately absent. It is delivered at the size it was painted
    // (1376×768, aspect 43:24), so it never needed that render and asking for one would be asking
    // the board to repaint a map twelve building sites are already positioned on.
    expect(wide!.specs.map((s) => s.key)).toEqual(['plate-city', 'splash-auth']);
    // Opaque and croppable, but not at a size ChatGPT hands back: the unit roster, plus the two
    // plates delivered off the §6 size table. Both are places with things positioned on them, the
    // district's building sites and the Bar's empty stool, so both ship at the size they were
    // painted and neither belongs in the 16:9 group above.
    expect(roster!.specs.every((s) => !s.alpha && s.aspect !== '16:9')).toBe(true);
    expect(roster!.specs.map((s) => s.key).filter((key) => !key.startsWith('unit-'))).toEqual([
      'plate-district',
      'plate-bar',
    ]);
    expect(alpha!.specs.every((s) => s.alpha)).toBe(true);
    expect(occluded!.specs.map((s) => s.key)).toEqual([...OCCLUDED_BACKDROP_KEYS]);
    expect(groupIntoSections().reduce((total, { specs }) => total + specs.length, 0)).toBe(
      ART_MANIFEST.length,
    );
  });

  /**
   * MOU-309: `plane-city-sky` used to land in the *active* `16:9 set` because it is `alpha: false`
   * at a non-baseline size, so the sheet asked the board to draw a master that the opaque plate
   * listed sixteen lines above would have made permanently invisible.
   *
   * `plane-city-sky` is named literally as well as derived: dropping it from `BACKDROP_STACK` would
   * empty it out of `OCCLUDED_BACKDROP_KEYS` and make the derived half of this vacuous.
   */
  it('keeps every occluded backdrop asset out of the sections the board acts on', () => {
    const grouped = groupIntoSections();
    const actionable = grouped.slice(0, -1).flatMap(({ specs }) => specs.map((s) => s.key));
    expect(actionable).not.toContain('plane-city-sky');
    expect(actionable).not.toContain('plane-city-far');
    for (const key of OCCLUDED_BACKDROP_KEYS) expect(actionable).not.toContain(key);
    expect(OCCLUDED_BACKDROP_KEYS.length).toBeGreaterThan(0);
  });

  it('labels the sections so the board knows which to act on', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual([
      'Hero set: do these',
      '16:9 set: only if your download measures at least 2048×1152',
      'Roster set: any download at or above the listed minimum works',
      'Alpha set, not requested yet',
      'Occluded backdrop: nothing to draw',
    ]);
  });
});

describe('orderPrompt', () => {
  /** ART-PROMPTS §0: the sheet assembles the shared blocks; it never paraphrases one. */
  it('is the assembled prompt with the shared negative folded in, nothing else', () => {
    expect(orderPrompt(PORTRAIT)).toBe(
      `${assemblePrompt(PORTRAIT)}\n\nAvoid entirely: ${NEGATIVE}`,
    );
    expect(orderPrompt(PORTRAIT).startsWith(STYLE_ANCHOR)).toBe(true);
    expect(orderPrompt(PORTRAIT)).toContain(PORTRAIT.prompt.subject);
    expect(orderPrompt(PORTRAIT)).toContain(PORTRAIT.prompt.framing);
  });
});

describe('renderSheet', () => {
  const sheet = renderSheet();

  it('gives every asset a block with its filename, minimum size and pasteable prompt', () => {
    for (const s of ART_MANIFEST) {
      expect(sheet, s.key).toContain(`### \`${s.key}\``);
      expect(sheet, s.key).toContain(`\`art-src/${s.key}.png\``);
      expect(sheet, s.key).toContain(`**Minimum size** ${s.source.width} × ${s.source.height} px`);
      expect(sheet, s.key).toContain(orderPrompt(s));
    }
  });

  /**
   * The one number the sheet must not get wrong: 512 is the icon's delivery size, but the master is
   * rendered at 1024 so the matte has headroom. The larger number is what `encode-art` enforces.
   */
  it('quotes the source size, not the delivery size, where the manifest asks for a bigger master', () => {
    expect(ICON.source.width).toBe(1024);
    expect(ICON.width).toBe(512);
    expect(sheet).toContain('**Minimum size** 1024 × 1024 px');
  });

  it('marks the alpha assets as needing a transparent background', () => {
    const alphaBlock = sheet.slice(sheet.indexOf('### `icon-scrap`'));
    expect(alphaBlock.slice(0, alphaBlock.indexOf('```'))).toContain(
      '**with a transparent background**',
    );
  });

  it('states the size rule the board is meant to check before downloading', () => {
    expect(sheet).toContain('refuses to upscale');
    expect(sheet).toContain('1536×864');
    expect(sheet).toContain('encode-art');
  });

  it('is derived: nothing in it is hand-maintained', () => {
    expect(sheet).toContain('Generated by `pnpm art:order`');
  });
});

describe('parseArgs', () => {
  it('defaults to writing the committed sheet', () => {
    expect(parseArgs([])).toMatchObject({ check: false });
  });

  it('reads --check and --out', () => {
    expect(parseArgs(['--check'])).toMatchObject({ check: true });
    expect(parseArgs(['--out', 'x.md']).sheetPath).toMatch(/x\.md$/);
  });

  it('rejects an unknown flag and a missing value', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--out'])).toThrow(/needs a value/);
  });
});

describe('--check', () => {
  /**
   * The gate that stops the sheet going stale: adding a district changes `renderSheet`, and this
   * fails until someone runs `pnpm art:order` and commits the result.
   */
  it('passes against the committed docs/ART-ORDER.md', async () => {
    expect(await main(['--check'])).toBe(0);
  });

  it('fails and says what to run when the sheet is missing', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await main(['--check', '--out', 'docs/ART-ORDER-nope.md'])).toBe(1);
    expect(err.mock.calls.map((call) => String(call[0])).join('')).toContain('pnpm art:order');
    err.mockRestore();
  });
});
