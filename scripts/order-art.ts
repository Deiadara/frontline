/**
 * `docs/ART-ORDER.md` — the order sheet a human works from when the art is hand-generated in a chat
 * UI rather than bought from an image API (MOU-134).
 *
 * Every word of prompt in the sheet is **assembled** from `ART_MANIFEST` and
 * `packages/shared/src/art/prompts.ts`, never restated: `prompts.ts` stays the single copy of the
 * style anchor, the negative list, the framing blocks and the subjects. Every filename and every
 * pixel size is read off the manifest, so a sheet that disagrees with what `encode-art` will accept
 * cannot be written by hand — it can only be regenerated.
 *
 *   pnpm art:order            # regenerate docs/ART-ORDER.md
 *   pnpm art:order --check    # non-zero exit if the committed sheet has drifted
 *
 * `--check` is wired into `pnpm --filter @frontline/scripts test`, so adding a district and
 * forgetting to regenerate fails CI rather than sending the board a stale order.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  ART_MANIFEST,
  HERO_ASSETS,
  NEGATIVE,
  isHeroAsset,
  type AssetSpec,
} from '@frontline/shared';
import { assemblePrompt, foldNegativeIntoProse } from './gen-art.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_SHEET_PATH = path.join(REPO_ROOT, 'docs', 'ART-ORDER.md');

/** The master directory a download is saved into, relative to the repo root (ADR 0001 §5.1). */
const MASTER_DIR = 'art-src';

/** What `encode-art` will open for a key. PNG is the canonical master; WebP is accepted as-is. */
const MASTER_EXTENSIONS = ['png', 'webp'] as const;

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

export interface Section {
  title: string;
  /** The paragraph under the heading — what the board should actually do with this group. */
  guidance: string;
  includes: (spec: AssetSpec) => boolean;
}

/**
 * The three groups, in the order the board should act on them. They **partition** the manifest —
 * pinned by a test, so a new asset class cannot quietly fall off the sheet.
 *
 * The split is by what a chat UI can be trusted to hand back, not by what the game wants first:
 * a plain opaque download at a baseline size is verified-by-construction, a 16:9 download is an
 * open question the board answers by measuring one, and transparency is unverified against real
 * ChatGPT output by anyone here.
 */
export const SECTIONS: readonly Section[] = [
  {
    title: 'Hero set — do these',
    guidance: [
      'These are the assets a plain ChatGPT download satisfies exactly: no transparency, no crop, no',
      'downscale, and a size ChatGPT already returns. **Match the size exactly.** `encode-art` accepts',
      'a larger download by centre-cropping to the listed aspect and resampling down, but it will never',
      'upscale — a download smaller than the minimum below is rejected by name.',
    ].join('\n'),
    includes: isHeroAsset,
  },
  {
    title: '16:9 set — only if your download measures at least 2048×1152',
    guidance: [
      '**Check the pixel dimensions of the downloaded file before you spend any time on these.** OpenAI',
      'documents 2048×1152 as a `gpt-image-2` size, but what the consumer ChatGPT UI hands a human on',
      'download is not something anyone here has verified. If what lands on your disk is 1536×1024,',
      'cropping it to 16:9 gives 1536×864 — under the 2048×1152 minimum, and `encode-art` will reject it,',
      'correctly. Upscaling invents detail, so the answer is a bigger render, not a bigger resample.',
    ].join('\n'),
    includes: (spec) => !spec.alpha && !isHeroAsset(spec),
  },
  {
    title: 'Alpha set — not requested yet',
    guidance: [
      'Do **not** start these. Every asset here ships with a real alpha channel, and ChatGPT does not',
      'reliably return transparency — `gpt-image-2` explicitly does not support a transparent background',
      'at all. The fallback is the `matte` step keying a flat background out of an opaque master, and',
      '**that path has never been run against real ChatGPT output.** Until someone verifies it on a',
      'single file, ordering the set is a batch of downloads that may every one of them be unusable.',
      'Listed for completeness only.',
    ].join('\n'),
    includes: (spec) => spec.alpha,
  },
];

export interface SectionContents {
  section: Section;
  specs: readonly AssetSpec[];
}

export function groupIntoSections(
  specs: readonly AssetSpec[] = ART_MANIFEST,
): readonly SectionContents[] {
  return SECTIONS.map((section) => ({ section, specs: specs.filter(section.includes) }));
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The exact prose to paste. `assemblePrompt` is the same function the paid backends call, and the
 * negative list is folded in the same way `gen-art`'s gpt-image-1 adapter folds it — a chat UI has
 * no negative-prompt field either, so the two routes must not drift into two different prompts.
 */
export function orderPrompt(spec: AssetSpec): string {
  return foldNegativeIntoProse(assemblePrompt(spec), NEGATIVE);
}

/**
 * The minimum the download must measure. `spec.source`, not `spec.width`×`spec.height`: they are the
 * same for 30 of the 45 assets, and where they differ the manifest deliberately asks for the larger
 * one (icons render at 1024² so the matte has headroom before the downscale to 512²).
 */
function minimumSize(spec: AssetSpec): string {
  return `${spec.source.width} × ${spec.source.height}`;
}

function assetBlock(spec: AssetSpec): string {
  const [canonical, ...alternatives] = MASTER_EXTENSIONS;
  return [
    `### \`${spec.key}\``,
    '',
    `- **Save the download as** \`${MASTER_DIR}/${spec.key}.${canonical}\`` +
      ` (\`.${alternatives.join('`, `.')}\` is accepted too)`,
    `- **Minimum size** ${minimumSize(spec)} px, aspect ${spec.aspect}` +
      `${spec.alpha ? ', **with a transparent background**' : ''}`,
    `- Ships as \`assets/${spec.file}\``,
    '',
    '```text',
    orderPrompt(spec),
    '```',
  ].join('\n');
}

const PREAMBLE = [
  '<!-- Generated by `pnpm art:order`. Do not edit by hand — edit `packages/shared/src/art/prompts.ts`',
  '     or the manifest and regenerate. `pnpm art:order --check` fails when this file has drifted. -->',
  '',
  '# Art order sheet',
  '',
  'One block per asset. Paste the fenced prompt into ChatGPT unedited, download the result, and save it',
  `under \`${MASTER_DIR}/\` with the exact filename given. Then run one command:`,
  '',
  '```sh',
  'pnpm --filter @frontline/scripts encode-art   # turns every master in art-src/ into a delivery file',
  '```',
  '',
  'No TypeScript changes are needed for any asset on this sheet — the game picks up a delivery file the',
  'moment it exists (restart `pnpm dev`, see `assets/README.md`).',
  '',
  '## How the size rule works',
  '',
  '`encode-art` normalises whatever you saved to the size the manifest asks for: it centre-crops to the',
  'listed aspect, then resamples down. It **refuses to upscale** — if your download is smaller than the',
  'minimum in either axis after that crop, it fails and names the file, the size it measured and the size',
  'it needs. So a bigger download is always safe and a smaller one is never accepted. Check the pixel',
  'dimensions of the file on disk, not the size you asked the UI for.',
].join('\n');

export function renderSheet(specs: readonly AssetSpec[] = ART_MANIFEST): string {
  const sections = groupIntoSections(specs).map(({ section, specs: grouped }) =>
    [`## ${section.title} (${grouped.length})`, section.guidance, ...grouped.map(assetBlock)].join(
      '\n\n',
    ),
  );
  return `${[PREAMBLE, ...sections].join('\n\n')}\n`;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

export interface CliOptions {
  check: boolean;
  sheetPath: string;
}

const USAGE = 'Usage: order-art [--check] [--out FILE]';

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { check: false, sheetPath: DEFAULT_SHEET_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg !== '--out') throw new Error(`Unknown argument "${arg}". ${USAGE}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    options.sheetPath = path.resolve(value);
    i += 1;
  }
  return options;
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const sheet = renderSheet();
  const relative = path.relative(REPO_ROOT, options.sheetPath);

  if (options.check) {
    const committed = await readFile(options.sheetPath, 'utf8').catch(() => null);
    if (committed === sheet) return 0;
    process.stderr.write(
      committed === null
        ? `${relative} does not exist — run \`pnpm art:order\`.\n`
        : `${relative} is out of date with the manifest — run \`pnpm art:order\` and commit it.\n`,
    );
    return 1;
  }

  await writeFile(options.sheetPath, sheet);
  process.stdout.write(
    `${relative}: ${ART_MANIFEST.length} asset(s), ${HERO_ASSETS.length} in the hero set.\n`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
