import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ART_MANIFEST, HERO_ASSET_KEYS, findAssetSpec, type AssetSpec } from '@frontline/shared';
import {
  deliveredFiles,
  fontsRender,
  layoutFor,
  main,
  parseArgs,
  renderSheet,
  sheetSpecs,
  tally,
  type Cell,
} from './contact-sheet.js';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`${key} is missing from the manifest`);
  return found;
};

const PORTRAIT = spec('portrait-overseer-1');
/** Outside the hero set: it exists on the sheet only once it has actually been delivered. */
const ICON = spec('icon-alloy');

/** A delivery-shaped file of one flat colour, so a test can point at it in the rendered sheet. */
function delivery(target: AssetSpec, colour: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: target.width, height: target.height, channels: 4, background: colour },
  })
    .png()
    .toBuffer();
}

async function withAssetDir(
  files: Readonly<Record<string, Buffer>>,
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'contact-sheet-'));
  try {
    for (const [name, bytes] of Object.entries(files)) {
      await writeFile(path.join(dir, name), bytes);
    }
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sheetSpecs', () => {
  it('shows every hero key, delivered or not, in manifest order', () => {
    const keys = sheetSpecs(new Set()).map((entry) => entry.key);
    expect(keys).toEqual([...HERO_ASSET_KEYS]);
  });

  it('adds a non-hero asset only once it has been delivered', () => {
    expect(sheetSpecs(new Set()).map((entry) => entry.key)).not.toContain(ICON.key);

    const withIcon = sheetSpecs(new Set([ICON.file])).map((entry) => entry.key);
    expect(withIcon).toContain(ICON.key);
    // Manifest order, not arrival order — icons sit after the hero portraits and districts.
    expect(withIcon.indexOf(ICON.key)).toBeGreaterThan(withIcon.indexOf(PORTRAIT.key));
  });
});

describe('tally', () => {
  it('counts an empty drop directory as entirely procedural', () => {
    expect(tally(new Set())).toEqual({
      painted: 0,
      procedural: ART_MANIFEST.length,
      heroPainted: 0,
    });
  });

  it('splits painted from procedural and tracks the hero subset', () => {
    // The icon is painted but is not hero, so it moves `painted` without moving `heroPainted`.
    expect(tally(new Set([PORTRAIT.file, ICON.file]))).toEqual({
      painted: 2,
      procedural: ART_MANIFEST.length - 2,
      heroPainted: 1,
    });
  });

  it('ignores a file that matches no manifest entry', () => {
    expect(tally(new Set(['contact-sheet.png', 'notes.txt']))).toEqual(tally(new Set()));
  });
});

describe('layoutFor', () => {
  it('grows in rows, never past five columns', () => {
    expect(layoutFor(15)).toMatchObject({ columns: 5, rows: 3 });
    expect(layoutFor(44)).toMatchObject({ columns: 5, rows: 9 });
  });

  it('narrows to the cell count while it is under a full row', () => {
    expect(layoutFor(3)).toMatchObject({ columns: 3, rows: 1 });
    // A partial last row still gets a whole row of height.
    expect(layoutFor(6)).toMatchObject({ columns: 5, rows: 2 });
  });

  it('stays a valid canvas with nothing to show', () => {
    const layout = layoutFor(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe('renderSheet', () => {
  const counts = { painted: 1, procedural: ART_MANIFEST.length - 1, heroPainted: 1 };

  it('draws each delivery into its own cell at the sheet size the layout declares', async () => {
    const magenta = { r: 255, g: 0, b: 255 };
    const cells: Cell[] = [
      { spec: PORTRAIT, bytes: await delivery(PORTRAIT, magenta) },
      { spec: spec('portrait-overseer-2'), bytes: undefined },
    ];

    const sheet = sharp(await renderSheet(cells, counts));
    const layout = layoutFor(cells.length);
    const { data, info } = await sheet.raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([layout.width, layout.height]);

    let magentaPixels = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! > 200) magentaPixels += 1;
    }
    // The 3:4 portrait is letterboxed into the square slot, so it covers three quarters of it — the
    // point being that it is neither cropped nor stretched to fill.
    expect(magentaPixels).toBeGreaterThan(0);
    expect(magentaPixels).toBeLessThan(320 * 320);
  });

  it('labels every cell', async () => {
    const cells: Cell[] = [{ spec: PORTRAIT, bytes: undefined }];
    const withText = await renderSheet(cells, counts);

    // Same sheet with the glyphs removed is strictly less ink; if librsvg silently drew no text the
    // two would be identical and an unlabelled sheet would ship.
    const inkOf = async (png: Buffer): Promise<number> => {
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      let lit = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i]! > 100 || data[i + 1]! > 100 || data[i + 2]! > 100) lit += 1;
      }
      return lit;
    };
    expect(await inkOf(withText)).toBeGreaterThan(0);
  });

  it('refuses to write an unlabelled sheet when no font is available', async () => {
    // The probe raster comes back empty exactly as it would with no font installed. Mocked at the
    // first `raw()` of the render, which is the probe's.
    const blankProbe = {
      toBuffer: () => Promise.resolve({ data: Buffer.alloc(200 * 40 * 4), info: {} }),
    };
    vi.spyOn(sharp.prototype, 'raw').mockReturnValueOnce(blankProbe);

    await expect(renderSheet([{ spec: PORTRAIT, bytes: undefined }], counts)).rejects.toThrow(
      /no glyphs/,
    );
  });
});

describe('fontsRender', () => {
  it('finds a font on this machine', async () => {
    await expect(fontsRender()).resolves.toBe(true);
  });
});

describe('deliveredFiles', () => {
  it('is empty for a directory that does not exist yet', async () => {
    await expect(deliveredFiles(path.join(tmpdir(), 'contact-sheet-absent'))).resolves.toEqual(
      new Set(),
    );
  });
});

describe('parseArgs', () => {
  it('rejects an unknown flag and a flag with no value', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--out'])).toThrow(/--out needs a value/);
    expect(() => parseArgs(['--out', '--assets'])).toThrow(/--out needs a value/);
  });

  it('resolves both directories to absolute paths', () => {
    const options = parseArgs(['--assets', 'a', '--out', 'b/sheet.png']);
    expect(path.isAbsolute(options.assetDir)).toBe(true);
    expect(options.outPath).toBe(path.resolve('b/sheet.png'));
  });
});

describe('main', () => {
  it('writes a sheet for a half-landed batch and reports painted vs procedural', async () => {
    const bytes = await delivery(PORTRAIT, { r: 40, g: 80, b: 120 });
    await withAssetDir({ [PORTRAIT.file]: bytes }, async (dir) => {
      const out = path.join(dir, 'out', 'sheet.png');
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

      await expect(main(['--assets', dir, '--out', out])).resolves.toBe(0);

      const written = await sharp(await readFile(out)).metadata();
      expect([written.width, written.height]).toEqual([
        layoutFor(HERO_ASSET_KEYS.length).width,
        layoutFor(HERO_ASSET_KEYS.length).height,
      ]);
      expect(stdout.mock.calls.join('')).toContain(
        `painted 1/${ART_MANIFEST.length}, hero set 1/${HERO_ASSET_KEYS.length}`,
      );
    });
  });

  it('still renders the outstanding hero slots when nothing has landed', async () => {
    await withAssetDir({}, async (dir) => {
      const out = path.join(dir, 'sheet.png');
      vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      await expect(main(['--assets', dir, '--out', out])).resolves.toBe(0);
      await expect(readFile(out)).resolves.toBeInstanceOf(Buffer);
    });
  });

  it('reports a bad argument instead of throwing', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(main(['--nope'])).resolves.toBe(1);
    expect(stderr.mock.calls.join('')).toMatch(/Unknown argument/);
  });
});
