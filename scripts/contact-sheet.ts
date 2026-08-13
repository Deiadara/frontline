/**
 * The contact sheet: one image showing every delivery file in `assets/` next to its asset key, plus
 * an empty slot for every hero-set key still outstanding.
 *
 *   pnpm --filter @frontline/scripts contact-sheet
 *
 * The art run lands in hand-pasted batches, so "how far along is it" is a question asked after every
 * batch. A directory listing answers it in filenames; this answers it in pixels — which is the only
 * form that also shows whether the paint is any good. The outstanding hero keys are drawn as labelled
 * empty slots rather than omitted, so the sheet reads as progress against a fixed target instead of a
 * pile of whatever happened to arrive.
 *
 * Cells are laid out in `ART_MANIFEST` order and sized to the widest thumbnail, so a 3:4 portrait, a
 * 1:1 district and a 16:9 plate all sit in the same box, letterboxed rather than cropped: this sheet
 * reports what shipped and must not restage it.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ART_MANIFEST, HERO_ASSET_KEYS, type AssetSpec } from '@frontline/shared';
import { auditDeliveries } from './encode-art.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The drop directory the client globs — see `assets/README.md`. */
export const DEFAULT_ASSET_DIR = path.join(REPO_ROOT, 'assets');
/**
 * Deliberately not under `assets/`: the client globs that directory for `*.{webp,png}` and would
 * bundle the sheet into the game build.
 */
export const DEFAULT_SHEET_PATH = path.join(REPO_ROOT, 'docs', 'art', 'contact-sheet.png');

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

/** ART-BIBLE §4 palette, so the sheet reads as the game's own surface rather than a report. */
const INK = {
  page: '#05070d',
  slot: '#111827',
  slotEdge: '#1e293b',
  key: '#22d3ee',
  detail: '#94a3b8',
  pending: '#f59e0b',
} as const;

const THUMB = 320;
const LABEL_HEIGHT = 46;
const GUTTER = 18;
const MARGIN = 28;
const HEADER_HEIGHT = 92;
const MAX_COLUMNS = 5;

const CELL_WIDTH = THUMB;
const CELL_HEIGHT = THUMB + LABEL_HEIGHT;

/**
 * A floor wide enough for the header, which does not narrow with the grid: at one cell the columns
 * alone would give a 376px sheet and the title would be cut mid-glyph.
 *
 * Measured, on the summary line (the wider of the two). It is widest when all three counts carry
 * two digits, which takes a *split* manifest rather than a finished one — `painted` and
 * `procedural` sum to `ART_MANIFEST.length`, so `44/44 · 15/15 · 0` is 10px narrower than
 * `34/44 · 15/15 · 10`. That widest reachable header ends at x=433, so 434 + `MARGIN` of air.
 * Pinned by a test that renders it on the one-cell sheet and checks the ink stays inside the page.
 */
const MIN_WIDTH = 462;

/** A manifest entry's place on the sheet. `bytes` is absent while the asset is still outstanding. */
export interface Cell {
  spec: AssetSpec;
  bytes: Uint8Array | undefined;
}

export interface Layout {
  columns: number;
  rows: number;
  width: number;
  height: number;
}

export function layoutFor(cellCount: number): Layout {
  const columns = Math.max(1, Math.min(cellCount, MAX_COLUMNS));
  const rows = Math.max(1, Math.ceil(cellCount / columns));
  return {
    columns,
    rows,
    width: Math.max(MIN_WIDTH, MARGIN * 2 + columns * CELL_WIDTH + (columns - 1) * GUTTER),
    height: MARGIN * 2 + HEADER_HEIGHT + rows * CELL_HEIGHT + (rows - 1) * GUTTER,
  };
}

function cellOrigin(index: number, layout: Layout): { x: number; y: number } {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: MARGIN + column * (CELL_WIDTH + GUTTER),
    y: MARGIN + HEADER_HEIGHT + row * (CELL_HEIGHT + GUTTER),
  };
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What landed in the drop directory, keyed by bare file name — the same shape and the same keying
 * as the client's own glob (`DELIVERED_ART`, `apps/client/src/assets/source.ts`), so this sheet
 * reports a file exactly when the browser renders it. The value is the path relative to the drop
 * directory, which is what the sheet has to open: the client globs `**` and keys on the basename,
 * so a delivery may sit in a subdirectory.
 */
export type Delivered = ReadonlyMap<string, string>;

export interface Tally {
  /** Manifest keys with a delivery file — what the game paints today. */
  painted: number;
  /** Manifest keys with none, which the client draws with its procedural fallback (ADR §5.3). */
  procedural: number;
  heroPainted: number;
}

export function tally(delivered: Delivered): Tally {
  const painted = ART_MANIFEST.filter((spec) => delivered.has(spec.file));
  return {
    painted: painted.length,
    procedural: ART_MANIFEST.length - painted.length,
    heroPainted: painted.filter((spec) => HERO_ASSET_KEYS.includes(spec.key)).length,
  };
}

/**
 * Every asset worth a cell: the hero set (the current target, outstanding ones included) plus
 * anything else that has actually been delivered. In manifest order, so the sheet's reading order
 * never depends on which batch a file arrived in.
 */
export function sheetSpecs(delivered: Delivered): readonly AssetSpec[] {
  return ART_MANIFEST.filter(
    (spec) => HERO_ASSET_KEYS.includes(spec.key) || delivered.has(spec.file),
  );
}

/** What the client globs out of the drop directory — see `assets/README.md`. */
const DELIVERY_FILE = /\.(?:webp|png)$/;
/**
 * A 2× variant is the same art as its 1×, and the 1× is what the sheet reports. This also means a
 * misnamed 2× goes unreported below: the client derives the 2× name from the 1× via `retinaName`,
 * so a bad one degrades to the 1× rather than to a blank slot.
 */
const RETINA_FILE = /@2x\.(?:webp|png)$/;

/**
 * Images in the drop directory that no manifest entry claims: a wrong extension
 * (`portrait-overseer-1.png` where the manifest asks for `.webp`), art orphaned by a district
 * rename, a `-final` suffix the §7 naming rule bans.
 *
 * The sheet draws those keys as "not delivered yet" while the paint sits in `assets/` — the one way
 * this report can be confidently wrong — and the game will not load them either, so `main` names
 * them on stderr. Deliberately extension-shaped rather than grammar-shaped: a file the naming rule
 * rejects is exactly the kind that goes missing, so it has to be named too.
 */
export function unclaimedDeliveries(delivered: Delivered): readonly string[] {
  const claimed = new Set(ART_MANIFEST.map((spec) => spec.file));
  return [...delivered.keys()]
    .filter((file) => DELIVERY_FILE.test(file) && !RETINA_FILE.test(file) && !claimed.has(file))
    .sort();
}

/**
 * Delivery files present in `assetDir`. The 2× variants are the same art — 1× is the cell.
 *
 * Recursive, because the client's glob is (`assets/**` in `source.ts`): a batch filed under
 * `assets/cc0/` renders in the browser, and a flat listing would draw every one of those keys as
 * "not delivered yet" — the sheet reporting the opposite of what shipped.
 */
export async function deliveredFiles(assetDir: string): Promise<Delivered> {
  const files = await readdir(assetDir, { recursive: true }).catch(() => []);
  return new Map(files.map((file) => [path.basename(file), file]));
}

/* -------------------------------------------------------------------------- */
/* Render                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Asset keys are `[a-z0-9-]` by `AssetKeySchema` and every other string here is a number we
 * formatted, so nothing on this sheet can carry a character XML would have to escape.
 */
function text(value: string, x: number, y: number, size: number, fill: string): string {
  return `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="${fill}">${value}</text>`;
}

function cellSvg(cell: Cell, index: number, layout: Layout): string {
  const { x, y } = cellOrigin(index, layout);
  const slot = `<rect x="${x}" y="${y}" width="${THUMB}" height="${THUMB}" fill="${INK.slot}" stroke="${INK.slotEdge}" stroke-width="1"/>`;
  const key = text(cell.spec.key, x + 2, y + THUMB + 20, 15, INK.key);
  const detail =
    cell.bytes === undefined
      ? text('not delivered yet — procedural fallback', x + 2, y + THUMB + 38, 13, INK.pending)
      : text(
          `${cell.spec.width}×${cell.spec.height} · ${Math.round(cell.bytes.length / 1024)} kB`,
          x + 2,
          y + THUMB + 38,
          13,
          INK.detail,
        );
  return slot + key + detail;
}

function headerSvg(counts: Tally, layout: Layout): string {
  const title = text('Frontline — art contact sheet', MARGIN, MARGIN + 34, 30, INK.key);
  const summary = text(
    `painted ${counts.painted}/${ART_MANIFEST.length} · hero set ${counts.heroPainted}/${HERO_ASSET_KEYS.length} · procedural fallback ${counts.procedural}`,
    MARGIN,
    MARGIN + 66,
    17,
    INK.detail,
  );
  const rule = `<rect x="${MARGIN}" y="${MARGIN + HEADER_HEIGHT - 18}" width="${layout.width - MARGIN * 2}" height="1" fill="${INK.slotEdge}"/>`;
  return title + summary + rule;
}

function sheetSvg(cells: readonly Cell[], counts: Tally, layout: Layout): string {
  const page = `<rect width="${layout.width}" height="${layout.height}" fill="${INK.page}"/>`;
  const body = cells.map((cell, index) => cellSvg(cell, index, layout)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}">${page}${headerSvg(counts, layout)}${body}</svg>`;
}

/**
 * Whether librsvg found a font to draw with.
 *
 * It renders text as nothing at all when fontconfig turns up empty, which would produce a sheet of
 * unlabelled thumbnails — the one thing the board asked this image for is which key each picture is.
 * A silent miss is worth one 200×40 raster to rule out.
 */
export async function fontsRender(): Promise<boolean> {
  const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40">${text('probe', 4, 28, 24, '#ffffff')}</svg>`;
  const { data } = await sharp(Buffer.from(probe)).raw().toBuffer({ resolveWithObject: true });
  return data.some((channel) => channel !== 0);
}

/**
 * Fits a delivery into the thumbnail box without cropping — letterboxed onto the slot colour.
 *
 * sharp names neither the file nor the key when it rejects one ("Input buffer contains unsupported
 * image format"), and a hand-pasted batch is exactly where a truncated download turns up, so the
 * failure has to say which of the 15 to re-download.
 */
async function thumbnail(bytes: Uint8Array, file: string): Promise<Buffer> {
  try {
    return await sharp(bytes)
      .resize(THUMB, THUMB, { fit: 'contain', background: INK.slot })
      .flatten({ background: INK.slot })
      .png()
      .toBuffer();
  } catch (error) {
    throw new Error(`${file}: ${errorMessage(error)}`, { cause: error });
  }
}

export async function renderSheet(
  cells: readonly Cell[],
  counts: Tally,
  /** Seam for the no-font path, which is otherwise only reachable on a machine without one. */
  fontsAvailable: () => Promise<boolean> = fontsRender,
): Promise<Buffer> {
  if (!(await fontsAvailable())) {
    throw new Error(
      'librsvg rendered no glyphs — no system font is visible to fontconfig, so every cell would be ' +
        'unlabelled. Install a font (or run this on a machine that has one) and try again.',
    );
  }

  const layout = layoutFor(cells.length);
  const thumbnails = await Promise.all(
    cells.map(async (cell, index) => {
      if (cell.bytes === undefined) return undefined;
      const { x, y } = cellOrigin(index, layout);
      return { input: await thumbnail(cell.bytes, cell.spec.file), left: x, top: y };
    }),
  );

  return sharp(Buffer.from(sheetSvg(cells, counts, layout)))
    .composite(thumbnails.filter((overlay) => overlay !== undefined))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

export interface CliOptions {
  assetDir: string;
  outPath: string;
}

const USAGE = 'Usage: contact-sheet [--assets DIR] [--out FILE]';

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { assetDir: DEFAULT_ASSET_DIR, outPath: DEFAULT_SHEET_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--assets' && arg !== '--out') {
      throw new Error(`Unknown argument "${arg}". ${USAGE}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    i += 1;
    if (arg === '--assets') options.assetDir = path.resolve(value);
    else options.outPath = path.resolve(value);
  }
  return options;
}

async function collectCells(
  specs: readonly AssetSpec[],
  delivered: Delivered,
  assetDir: string,
): Promise<Cell[]> {
  return Promise.all(
    specs.map(async (spec) => {
      const file = delivered.get(spec.file);
      return {
        spec,
        bytes: file === undefined ? undefined : await readFile(path.join(assetDir, file)),
      };
    }),
  );
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  const delivered = await deliveredFiles(options.assetDir);
  const counts = tally(delivered);
  const unclaimed = unclaimedDeliveries(delivered);
  if (unclaimed.length > 0) {
    process.stderr.write(
      `warning: no manifest entry claims ${unclaimed.join(', ')} — the matching key is drawn as ` +
        'not delivered yet. Check the extension and the subject against the manifest.\n',
    );
  }

  // The §6 transparency floor, reported here as well as in the test suite: this is the command
  // `assets/README.md` sends the board to run after a drop, and the repo has no CI, so vitest only
  // fires when an agent runs the gates. A thumbnail cannot show the failure either — an opaque
  // foreground plane looks like perfectly good art in its cell, and blankets the map in the game.
  for (const problem of await auditDeliveries(options.assetDir)) {
    process.stderr.write(`warning: ${problem.file} (${problem.key}) — ${problem.problem}\n`);
  }

  let cells: Cell[];
  try {
    cells = await collectCells(sheetSpecs(delivered), delivered, options.assetDir);
    const sheet = await renderSheet(cells, counts);
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, sheet);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  const layout = layoutFor(cells.length);
  process.stdout.write(
    `${options.outPath}  ${layout.width}×${layout.height}, ${cells.length} cell(s)\n` +
      `painted ${counts.painted}/${ART_MANIFEST.length}, hero set ${counts.heroPainted}/${HERO_ASSET_KEYS.length}, procedural fallback ${counts.procedural}\n`,
  );
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
