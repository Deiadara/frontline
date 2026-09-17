/**
 * `docs/balance-sheet.html`: one page holding every number the game is balanced on, editable.
 *
 * This is not `catalog-doc.ts`. That one renders a sheet to *read*, pinned character for character
 * so a content change cannot land without the doc moving with it. This one renders a sheet to
 * *edit*: the maintainer opens it in a browser, changes costs and stats and copy, and exports a
 * list of what they changed for an implementer to apply. Nothing here writes back to the source.
 *
 *   pnpm balance:sheet                  # regenerate docs/balance-sheet.html
 *   pnpm balance:sheet --out path.html  # write somewhere else
 *   pnpm balance:sheet --json path.json # dump the extracted data without the page
 *
 * The output is generated and ignored by git: it is ~500KB of catalogue inlined into the page so
 * the file opens straight off disk with no server and no fetch behind it.
 *
 * Two halves feed it:
 *
 * - **Catalogues**, read off `@frontline/shared` at run time, so a row cannot disagree with the
 *   game. Each entry is flattened into typed fields by {@link fieldsOf}: numbers become number
 *   inputs, short strings text inputs, long strings textareas, and anything with a shape the
 *   flattener does not recognise becomes a JSON box rather than being silently dropped.
 * - **Constants**, read off the *source text* of `packages/shared/src`, because a good half of the
 *   tuning lives in module-private consts that the package never exports. `PRODUCTION_PER_LEVEL`
 *   is the one that matters most: what each structure makes per level is exactly the kind of
 *   number the maintainer wants in front of them, and it is not on the public surface. The scanner
 *   takes plain numbers, flat records of numbers and arrays of numbers, and nothing else, so it
 *   cannot mangle a table it did not understand.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  ALL_DISTRICTS,
  BATTLE_BOOSTS,
  BLUEPRINTS,
  BUILDING_CATALOG,
  FEATS,
  ITEM_CATALOG,
  LOCATION_CATALOG,
  MISSION_TEMPLATES,
  MODIFICATIONS,
  OVERSEER_PRESETS,
  PERK_CATALOG,
  RESEARCH_ITEMS,
  TRAP_CATALOG,
  UNIT_CATALOG,
  UNIT_MODIFICATIONS,
  VEHICLES,
} from '@frontline/shared';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SHARED_SRC = path.join(REPO_ROOT, 'packages/shared/src');

/** How the page draws one field, decided here rather than guessed in the browser. */
type FieldKind = 'number' | 'text' | 'para' | 'list' | 'json' | 'bool';

interface Field {
  /** Dotted path into the source entry, which is what an implementer needs to find it again. */
  key: string;
  kind: FieldKind;
  value: string | number | boolean;
}

interface Row {
  id: string;
  name: string;
  /** The one or two words under the name in the list: tier, rarity, track, whatever sorts it. */
  tag: string;
  fields: Field[];
}

interface Section {
  id: string;
  label: string;
  /** Where the numbers live, so a change can be applied without searching for it. */
  source: string;
  note: string;
  rows: Row[];
}

/** Keys that identify a row rather than tune it. Editing one would break every reference to it. */
const LOCKED = new Set(['id', 'presetId', 'districtId', 'cityId']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One value, flattened into the fields the page draws for it.
 *
 * Nested objects are walked rather than boxed: a unit's stats are eleven numbers, and handing them
 * over as one JSON blob would make the most-edited table in the game the hardest thing on the page
 * to change. What stays a JSON box is what has no flat reading: an array of objects (a blueprint's
 * pages, a district's ground), or a map whose keys are data rather than fields.
 */
function fieldFor(key: string, value: unknown): Field[] {
  if (typeof value === 'number') return [{ key, kind: 'number', value }];
  if (typeof value === 'boolean') return [{ key, kind: 'bool', value }];
  if (typeof value === 'string') {
    // 64 is roughly where a name stops being a name: past it the editor needs room to wrap, and a
    // single-line input hides the tail of the sentence behind its own right edge.
    return [{ key, kind: value.length > 64 ? 'para' : 'text', value }];
  }
  if (value === null || value === undefined) return [{ key, kind: 'text', value: '' }];
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      return [{ key, kind: 'list', value: value.join(', ') }];
    }
    return [{ key, kind: 'json', value: JSON.stringify(value, null, 2) }];
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [{ key, kind: 'json', value: '{}' }];
    return entries.flatMap(([inner, held]) => fieldFor(`${key}.${inner}`, held));
  }
  return [{ key, kind: 'json', value: JSON.stringify(value, null, 2) }];
}

/**
 * One catalogue entry, flattened into the fields the page draws.
 *
 * Insertion order is kept, because the catalogues are written in the order a reader wants them:
 * name and blurb first, then cost, then the stats. Sorting alphabetically here would put `armor`
 * above `name` on every unit in the game.
 */
function fieldsOf(entry: Record<string, unknown>): Field[] {
  const fields: Field[] = [];
  for (const [key, value] of Object.entries(entry)) {
    if (LOCKED.has(key)) continue;
    fields.push(...fieldFor(key, value));
  }
  return fields;
}

function rowOf(entry: Record<string, unknown>, id: string, tag: string): Row {
  const name =
    typeof entry.name === 'string'
      ? entry.name
      : typeof entry.label === 'string'
        ? entry.label
        : id;
  return { id, name, tag, fields: fieldsOf(entry) };
}

/** A catalogue keyed by id in an array. */
function listSection(
  id: string,
  label: string,
  source: string,
  note: string,
  entries: readonly Record<string, unknown>[],
  tagOf: (entry: Record<string, unknown>) => string,
): Section {
  return {
    id,
    label,
    source,
    note,
    rows: entries.map((entry) => rowOf(entry, String(entry.id), tagOf(entry))),
  };
}

/** A catalogue keyed by a record, where the key is the id and is not repeated inside the value. */
function recordSection(
  id: string,
  label: string,
  source: string,
  note: string,
  entries: Readonly<Record<string, Record<string, unknown>>>,
  tagOf: (key: string, entry: Record<string, unknown>) => string,
): Section {
  return {
    id,
    label,
    source,
    note,
    rows: Object.entries(entries).map(([key, entry]) => rowOf(entry, key, tagOf(key, entry))),
  };
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function catalogueSections(): Section[] {
  return [
    recordSection(
      'structures',
      'Structures',
      'packages/shared/src/building/catalog.ts',
      'The eleven buildings. `baseCost` and `baseSeconds` are level 1; every level after multiplies by BUILDING_COST_GROWTH and BUILDING_TIME_GROWTH in the Constants tab. What each one gives per level is in Constants under `building`.',
      BUILDING_CATALOG as unknown as Record<string, Record<string, unknown>>,
      (key) => key,
    ),
    listSection(
      'units',
      'Units',
      'packages/shared/src/units/catalog.ts',
      'Every trainable unit: what it costs, how long it takes, and the eleven stats it fights on. `stats.resistances` is a JSON box because it is a sparse map of damage type to percent.',
      UNIT_CATALOG as unknown as Record<string, unknown>[],
      (entry) => str(entry.tier),
    ),
    listSection(
      'unit-modifications',
      'Unit modifications',
      'packages/shared/src/units/upgrades.ts',
      'Cards the Scrapyard cuts for a named unit. `effect` is a flat map of stat to flat points, so each stat is its own number box.',
      UNIT_MODIFICATIONS as unknown as Record<string, unknown>[],
      (entry) => str(entry.rarity),
    ),
    listSection(
      'modifications',
      'Structure modifications',
      'packages/shared/src/building/modifications.ts',
      'Cards bolted into a structure bracket. `magnitude` is the percent, `effect` names the channel, and `fits` (when present) overrides which structures accept it. Grade decides the requirement band in Constants.',
      MODIFICATIONS as unknown as Record<string, unknown>[],
      (entry) => `${str(entry.rarity)} / ${str(entry.building)}`,
    ),
    listSection(
      'traps',
      'Traps',
      'packages/shared/src/building/traps.ts',
      '`killShare` is the fraction of an attacking force a fitted trap takes, `maxKills` the ceiling on bodies from one trigger.',
      TRAP_CATALOG as unknown as Record<string, unknown>[],
      () => 'trap',
    ),
    listSection(
      'blueprints',
      'Blueprints',
      'packages/shared/src/research/blueprints.ts',
      'What each blueprint unlocks and the pages it is assembled from. `targets` and `pages` are JSON boxes: the page text is inside them, so edit it there.',
      BLUEPRINTS,
      (entry) => `${str(entry.category)} / ${str(entry.rarity)}`,
    ),
    listSection(
      'research',
      'Programmes',
      'packages/shared/src/research/catalog.ts',
      'The Lab tracks. `payout` is the bonus the programme pays and is a JSON box because its shape changes with the kind of bonus. `requiresMark` gates it on the track officer.',
      RESEARCH_ITEMS as unknown as Record<string, unknown>[],
      (entry) => `${str(entry.track)} ${String(entry.step)}`,
    ),
    listSection(
      'locations',
      'Location kinds',
      'packages/shared/src/map/locations.ts',
      'Ground you can hold. `bonuses` is what holding it pays per hour, `upgradeCost` the level-1 price, `upgrades` the three lines of flavour shown as it climbs.',
      Object.entries(LOCATION_CATALOG).map(([kind, entry]) => ({ id: kind, ...(entry as object) })),
      () => 'ground',
    ),
    listSection(
      'districts',
      'Districts',
      'packages/shared/src/map/districts.ts',
      '`difficulty` scales mission pay and garrison strength. `position` is the map coordinate and feeds travel time. `locations` is the ground inside, as JSON.',
      ALL_DISTRICTS,
      (entry) => `${str(entry.kind)} / d${String(entry.difficulty)}`,
    ),
    listSection(
      'missions',
      'Missions',
      'packages/shared/src/missions/templates.ts',
      'Board templates. `spoils` is the haul before difficulty and officer scaling, `successChance` the base odds before the crew is weighed.',
      MISSION_TEMPLATES,
      (entry) => `${str(entry.difficulty)} / ${str(entry.travelBand)}`,
    ),
    listSection(
      'vehicles',
      'Vehicles',
      'packages/shared/src/vehicles/catalog.ts',
      'Garage builds. `speed` cuts travel time, `capacity` is bodies carried.',
      VEHICLES as unknown as Record<string, unknown>[],
      (entry) => str(entry.class),
    ),
    listSection(
      'items',
      'Items',
      'packages/shared/src/items/catalog.ts',
      'Parts, components and consumables. `capsValue` is what it is worth and drives every price the market quotes on it.',
      Object.values(ITEM_CATALOG) as unknown as Record<string, unknown>[],
      (entry) => `${str(entry.kind)} / ${str(entry.rarity)}`,
    ),
    listSection(
      'feats',
      'Feats',
      'packages/shared/src/feats/catalog.ts',
      '`measure` is the counter the server tallies, `target` the threshold, `reward` what claiming it pays. A chain climbs through `after`.',
      FEATS,
      (entry) => `${str(entry.era)} / ${str(entry.size)}`,
    ),
    listSection(
      'perks',
      'Perks',
      'packages/shared/src/crew/perks.ts',
      'What an officer can carry. `bonus` is a JSON box: the shape says which channel it pays into.',
      PERK_CATALOG as unknown as Record<string, unknown>[],
      (entry) => str(entry.category),
    ),
    listSection(
      'boosts',
      'Battle boosts',
      'packages/shared/src/battle/boosts.ts',
      'Bought with caps at the deploy screen. `cost` is caps, `effect` the percent it swings.',
      BATTLE_BOOSTS as unknown as Record<string, unknown>[],
      () => 'boost',
    ),
    listSection(
      'overseers',
      'Overseer presets',
      'packages/shared/src/overseer/presets.ts',
      'The thirty starting characters. Every one of the 35 attributes is its own box; they should sum to the same budget across presets.',
      OVERSEER_PRESETS.map((preset) => ({ ...preset, id: preset.presetId })),
      (entry) => str(entry.archetype),
    ),
  ];
}

/* --------------------------------------------------------------------------------------------
 * The constants scanner.
 * ------------------------------------------------------------------------------------------ */

/**
 * Tables the scanner would pick up that already have a tab of their own.
 *
 * `SPECS` is what `MODIFICATIONS` is built from, so it arrives as one 693-field row of the same
 * eighty-nine cards the Structure modifications tab lists one per line. Two places to edit the
 * same number is one place too many.
 */
const ALREADY_A_TAB = new Set(['SPECS', 'TRAP_CATALOG', 'BATTLE_BOOSTS']);

/** Strip block and line comments so a table's prose cannot look like a key. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The first sentence of a doc block, unwrapped, as the hint under a constant's name. */
function blurbOf(doc: string): string {
  const body = doc
    .replace(/^\s*\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join(' ')
    .replace(/\{@link ([^}]+)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const stop = body.search(/\.(\s|$)/);
  const first = stop === -1 ? body : body.slice(0, stop + 1);
  return first.length > 240 ? `${first.slice(0, 237)}...` : first;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found.sort();
}

/**
 * Every tunable number in `packages/shared/src`, exported or not.
 *
 * Three shapes and no others: a plain number, a record whose values are all numbers, and an array
 * of numbers. Anything else is left alone, because a scanner that guesses at a shape it does not
 * understand produces a row the maintainer cannot trust, which is worse than a missing row.
 */
async function constantSection(): Promise<Section> {
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const file of await sourceFiles(SHARED_SRC)) {
    const text = await readFile(file, 'utf8');
    const relative = path.relative(REPO_ROOT, file);
    const group = path.relative(SHARED_SRC, file).split(path.sep)[0] ?? '';
    const area = group.endsWith('.ts') ? 'core' : group;
    // The art manifest's seeds and transparency floors are not balance, and they are the only
    // numbers in the package a maintainer tuning the game never wants to see.
    if (area === 'art') continue;

    // The doc block, the name, and whatever the initialiser is up to the line that closes it.
    const pattern =
      /(\/\*\*[\s\S]*?\*\/\n)?(?:export )?const ([A-Z][A-Z0-9_]*)(?:\s*:\s*[^=]+?)?\s*=\s*([\s\S]*?);\n/g;
    for (const match of text.matchAll(pattern)) {
      const [, doc = '', name = '', raw = ''] = match;
      if (seen.has(name) || ALREADY_A_TAB.has(name)) continue;

      const body = stripComments(raw)
        .trim()
        .replace(/\s+as const$/, '');
      const fields = constantFields(body);
      if (fields === null) continue;

      seen.add(name);
      rows.push({
        id: name,
        name,
        tag: `${area} · ${path.basename(file)}`,
        fields: [
          { key: '_file', kind: 'text', value: relative },
          { key: '_note', kind: 'para', value: blurbOf(doc) },
          ...fields,
        ],
      });
    }
  }

  rows.sort((a, b) => a.tag.localeCompare(b.tag) || a.name.localeCompare(b.name));
  return {
    id: 'constants',
    label: 'Constants',
    source: 'packages/shared/src',
    note: 'Every tuning number in the shared package, including the module-private tables the package never exports. `_file` says where it lives and `_note` is the first line of its doc block. The ones that answer "what does a structure give per level" are PRODUCTION_PER_LEVEL, STORAGE_BASE, STORAGE_GROWTH, STORAGE_SHARES, HOUSING_BASE, HOUSING_PER_QUARTERS_LEVEL and the PER_LEVEL family.',
    rows,
  };
}

/**
 * The initialiser, if it is made of numbers, flattened into one field per leaf.
 *
 * Evaluated rather than parsed. Half these tables are written as arithmetic the maintainer wants
 * to read (`2 / 3` for a shelf share, `60 * 60` for an hour) and a JSON parser cannot take them.
 * Anything naming an identifier throws here and is skipped, which is the filter: a table made of
 * literals evaluates, a table made of anything else does not, and the scanner never has to decide
 * what it is looking at.
 */
function constantFields(body: string): Field[] | null {
  let value: unknown;
  try {
    // In a context of its own with nothing in scope, so an initialiser naming an identifier throws
    // instead of picking up whatever this module happens to have bound under that name.
    value = runInNewContext(`(${body})`, {}, { timeout: 200 });
  } catch {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [{ key: 'value', kind: 'number', value }] : null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const fields: Field[] = [];
  const walk = (node: unknown, prefix: string): boolean => {
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) return false;
      fields.push({ key: prefix, kind: 'number', value: node });
      return true;
    }
    // A string or a null beside the numbers, which is how the banded tables are written: a grade
    // band carries a `mark` next to its two levels, and dropping the whole table because one leaf
    // is a letter would lose the tables the maintainer most wants to move.
    if (typeof node === 'string' || node === null) {
      fields.push({ key: prefix, kind: 'text', value: node ?? '' });
      return true;
    }
    if (typeof node === 'boolean') {
      fields.push({ key: prefix, kind: 'bool', value: node });
      return true;
    }
    if (typeof node !== 'object') return false;
    const entries = Array.isArray(node)
      ? node.map((item, index) => [String(index), item] as const)
      : Object.entries(node);
    if (entries.length === 0) return false;
    return entries.every(([key, inner]) => walk(inner, prefix === '' ? key : `${prefix}.${key}`));
  };
  // At least one number, or it is a table of labels rather than a table of tuning.
  return walk(value, '') && fields.some((field) => field.kind === 'number') ? fields : null;
}

/* --------------------------------------------------------------------------------------------
 * CLI.
 * ------------------------------------------------------------------------------------------ */

interface CliOptions {
  outPath: string;
  jsonPath: string | null;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    outPath: path.join(REPO_ROOT, 'docs/balance-sheet.html'),
    jsonPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      const next = argv[index + 1];
      if (next === undefined) throw new Error('--out needs a path');
      options.outPath = path.resolve(next);
      index += 1;
    } else if (arg === '--json') {
      const next = argv[index + 1];
      if (next === undefined) throw new Error('--json needs a path');
      options.jsonPath = path.resolve(next);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${String(arg)}`);
    }
  }
  return options;
}

export async function sections(): Promise<Section[]> {
  return [...catalogueSections(), await constantSection()];
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const all = await sections();
  const payload = JSON.stringify({ generated: new Date().toISOString(), sections: all });

  if (options.jsonPath !== null) {
    await writeFile(options.jsonPath, payload);
  }

  const template = await readFile(path.join(HERE, 'balance-sheet.template.html'), 'utf8');
  // Either quote: the template is prettier's to format, and it rewrites the page's string literals
  // to single quotes.
  const placeholder = /['"]__BALANCE_DATA__['"]/;
  if (!placeholder.test(template)) {
    process.stderr.write('balance-sheet.template.html has no __BALANCE_DATA__ placeholder\n');
    return 1;
  }
  // Stringified twice: the page parses a string literal rather than evaluating an object literal,
  // which loads faster and cannot be broken by a `</script>` hiding in somebody's blurb.
  await writeFile(options.outPath, template.replace(placeholder, JSON.stringify(payload)));

  const fields = all.reduce(
    (sum, section) => sum + section.rows.reduce((inner, row) => inner + row.fields.length, 0),
    0,
  );
  process.stdout.write(
    `${path.relative(REPO_ROOT, options.outPath)}: ${all.length} sections, ${all.reduce((sum, section) => sum + section.rows.length, 0)} entries, ${fields} fields.\n`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
