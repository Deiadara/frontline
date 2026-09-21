/**
 * `docs/CATALOG.md`: everything listable in `@frontline/shared`, in one page the maintainer can read
 * before it starts changing content.
 *
 * Every row is read off the catalogue it documents, so the sheet cannot disagree with the game.
 * The only hand-written words in it are the section notes saying which file to edit, and the
 * opening block about the removed mission-board tag.
 *
 *   pnpm catalog:doc            # regenerate docs/CATALOG.md
 *   pnpm catalog:doc --check    # non-zero exit if the committed sheet has drifted
 *
 * `--check` is wired into `pnpm --filter @frontline/scripts test`, so adding a unit and forgetting
 * to regenerate fails there rather than handing the board a stale list.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  areaPayPercent,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_LABELS,
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_GROUPS,
  BATTLE_BOOSTS,
  BLACK_MARKET_GOODS,
  BLACK_MARKET_KIND_LABELS,
  BLACK_MARKET_KINDS,
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_CATEGORY_BLURBS,
  BLUEPRINT_CATEGORY_LABELS,
  BLUEPRINT_MOTIFS,
  BLUEPRINTS,
  BUILDING_CATALOG,
  BUILDING_KINDS,
  CITY_DISTRICTS,
  CITY_LOCATIONS,
  describeBoostEffect,
  describeBoostUnlock,
  describeBuildingRequirement,
  describeHoldBonus,
  describePerkBonus,
  describeRequirement,
  describeResearchPayout,
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  FACTION_CARD_SPECS,
  FACTION_RANK_BLURBS,
  FACTION_RANK_LABELS,
  FACTION_RANKS,
  findResearchItem,
  ITEM_CATALOG,
  ITEM_KIND_LABELS,
  ITEM_KINDS,
  ITEM_RARITY_LABELS,
  isAdvancedModification,
  scrapyardLevelForModification,
  scrapyardLevelForTrap,
  scrapyardLevelForUpgrade,
  labelText,
  LOCATION_CATALOG,
  MISC_AREA_ID,
  FEATS,
  FEAT_ERAS,
  FEAT_SIZES,
  featRewardBand,
  featRewardValue,
  MISSION_LEANING_LABELS,
  MISSION_LEANING_REASONS,
  MISSION_LEANINGS,
  MISSION_TEMPLATES,
  MODIFICATIONS,
  modificationPrice,
  NOTIFICATION_GROUP_LABELS,
  NOTIFICATION_GROUPS,
  NOTIFICATION_KIND_SPECS,
  NOTIFICATION_KINDS,
  NOTORIETY_BLURBS,
  NOTORIETY_TIERS,
  OFFICER_ROLE_LABELS,
  OFFICER_ROLES,
  OVERSEER_PRESETS,
  PAY_PERCENT_PER_DIFFICULTY,
  PERK_CATALOG,
  PERK_CATEGORIES,
  PERK_CATEGORY_LABELS,
  PLAYER_LEVEL_UNLOCKS,
  RESEARCH_ITEMS,
  RESEARCH_TRACK_BLURBS,
  RESEARCH_TRACK_STEPS,
  RESOURCE_LABELS,
  RESOURCE_LORE,
  RESOURCE_ORDER,
  TRAINING_DRILLS,
  TRAP_CATALOG,
  COMBINE_UNITS,
  PLAYER_UNITS,
  UNIT_CATALOG,
  UNIT_MODIFIER_IDS,
  UNIT_MODIFIERS,
  UNIT_RULE_IDS,
  UNIT_RULES,
  UNIT_STAT_KEYS,
  UNIT_STAT_LABELS,
  UNIT_TIER_LABELS,
  UNIT_TIERS,
  UNIT_MODIFICATIONS,
  UNIT_MODIFICATION_RARITIES,
  UNIT_MODIFICATION_RARITY_BLURBS,
  UNIT_MODIFICATION_RARITY_LABELS,
  unitModificationsOfRarity,
  unitUnlockClauses,
  VEHICLES,
  WEATHER_CATALOG,
  WEATHER_KINDS,
  type AttributeName,
  type BlueprintSpec,
  type ItemCost,
  type ItemSpec,
  type LocationKind,
  type MissionTemplate,
  type PartialResources,
  type UnitSpec,
  DAMAGE_TYPES,
  LATE_COST_FROM_LEVEL,
  levelCeilingFor,
  type UnitStats,
} from '@frontline/shared';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_DOC_PATH = path.join(REPO_ROOT, 'docs', 'CATALOG.md');

/** How wide a description cell is allowed to get before it is cut. Wide tables stop being read. */
export const MAX_CELL = 90;

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** A long authored line, cut to something a table cell can hold. */
export function clip(text: string, max = MAX_CELL): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** One table cell: pipes escaped, newlines flattened, an empty value written as a hyphen. */
function cell(value: string): string {
  const flat = value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return flat === '' ? '-' : flat;
}

export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

const code = (value: string): string => `\`${value}\``;

/** A resource bundle in the words the stockpile uses: `400 Caps, 200 Scrap`. */
export function money(bundle: PartialResources): string {
  const lines = RESOURCE_ORDER.filter((key) => (bundle[key] ?? 0) !== 0).map(
    (key) => `${bundle[key]} ${RESOURCE_LABELS[key]}`,
  );
  return lines.length === 0 ? 'free' : lines.join(', ');
}

/** An item bundle, by item name rather than by id: what a bill of parts actually asks for. */
function parts(bundle: ItemCost): string {
  const lines = Object.entries(bundle).map(
    ([id, count]) => `${count} ${ITEM_CATALOG[id as keyof typeof ITEM_CATALOG]?.name ?? id}`,
  );
  return lines.length === 0 ? '' : lines.join(', ');
}

/** Seconds as the board reads a clock: `45s`, `20m`, `2h 30m`. */
export function clock(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

export interface Section {
  title: string;
  /** The files a content editor opens to change what this section lists, repo-relative. */
  sources: readonly string[];
  /** Entries listed, for the table of contents. */
  rows: number;
  body: string;
}

/** GitHub's own heading slug, so the table of contents links land. */
export function anchor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function render(section: Section): string {
  const note = section.sources.map(code).join(', ');
  return [`## ${section.title}`, `Source: ${note}`, section.body].join('\n\n');
}

/* ------------------------------------------------------------------ blueprints */

function blueprintPages(spec: BlueprintSpec): string {
  return table(
    ['Page id', 'Name', 'Motif', 'Rarity', 'Description'],
    spec.pages.map((page) => [
      code(page.id),
      page.name,
      page.motif,
      page.rarity === undefined ? 'as document' : ITEM_RARITY_LABELS[page.rarity],
      clip(page.description),
    ]),
  );
}

function blueprintsSection(): Section {
  const groups = BLUEPRINT_CATEGORIES.map((category) => {
    const specs = BLUEPRINTS.filter((spec) => spec.category === category);
    const overview = table(
      ['Id', 'Name', 'Rarity', 'Motif', 'Unlocks', 'Pages', 'Blurb'],
      specs.map((spec) => [
        code(spec.id),
        spec.name,
        ITEM_RARITY_LABELS[spec.rarity],
        spec.motif,
        spec.targets.map((target) => code(`${target.kind}:${target.id}`)).join(', '),
        String(spec.pages.length),
        clip(spec.blurb),
      ]),
    );
    const documents = specs.map((spec) =>
      [`##### ${spec.name} (${code(spec.id)})`, blueprintPages(spec)].join('\n\n'),
    );
    return [
      `#### ${BLUEPRINT_CATEGORY_LABELS[category]} (${specs.length})`,
      BLUEPRINT_CATEGORY_BLURBS[category],
      overview,
      ...documents,
    ].join('\n\n');
  });
  return {
    title: 'Blueprints and their pages',
    sources: ['packages/shared/src/blueprints/catalog.ts'],
    rows: BLUEPRINTS.length,
    body: [
      `${BLUEPRINTS.length} documents, ${BLUEPRINTS.reduce((sum, spec) => sum + spec.pages.length, 0)} pages between them. A page rarity of "as document" means the page inherits the document's own.`,
      ...groups,
    ].join('\n\n'),
  };
}

/* ----------------------------------------------------------------------- items */

function itemRow(spec: ItemSpec): readonly string[] {
  return [
    code(spec.id),
    spec.name,
    ITEM_RARITY_LABELS[spec.rarity],
    String(spec.capsValue),
    spec.tradeable ? 'yes' : 'no',
    clip(spec.description),
    clip(spec.usedFor, 60),
  ];
}

function itemsSection(): Section {
  const listed = ITEM_KINDS.filter((kind) => kind !== 'page');
  const specs = Object.values(ITEM_CATALOG);
  const groups = listed.map((kind) => {
    const rows = specs.filter((spec) => spec.kind === kind);
    return [
      `#### ${ITEM_KIND_LABELS[kind]} (${rows.length})`,
      table(
        ['Id', 'Name', 'Rarity', 'Caps', 'Tradeable', 'Description', 'Used for'],
        rows.map(itemRow),
      ),
    ].join('\n\n');
  });
  const pages = specs.filter((spec) => spec.kind === 'page').length;
  return {
    title: 'Consumables and other items',
    sources: ['packages/shared/src/items/catalog.ts'],
    rows: specs.length - pages,
    body: [
      `The ${pages} page items are generated one per blueprint page and are listed under Blueprints above, so they are not repeated here. The blueprint rows below are the six standing Lab documents plus one per assembled blueprint.`,
      ...groups,
    ].join('\n\n'),
  };
}

/* ----------------------------------------------------------------------- traps */

function trapsSection(): Section {
  return {
    title: 'Traps',
    sources: ['packages/shared/src/battle/traps.ts'],
    rows: TRAP_CATALOG.length,
    body: table(
      ['Id', 'Name', 'Needs', 'Yard level', 'Cost', 'Kill share', 'Max kills', 'Description'],
      TRAP_CATALOG.map((spec) => [
        code(spec.id),
        spec.name,
        code(spec.requiresTech),
        String(scrapyardLevelForTrap(spec)),
        money(spec.cost),
        percent(spec.killShare),
        String(spec.maxKills),
        clip(spec.description),
      ]),
    ),
  };
}

/* ---------------------------------------------------------------------- boosts */

function boostsSection(): Section {
  const techName = (id: string): string => findResearchItem(id)?.name ?? id;
  return {
    title: 'Battle boosts',
    sources: ['packages/shared/src/battle/boosts.ts'],
    rows: BATTLE_BOOSTS.length,
    body: table(
      ['Id', 'Name', 'Infamy', 'Effect', 'Offered by', 'Description'],
      BATTLE_BOOSTS.map((spec) => [
        code(spec.id),
        spec.name,
        String(spec.cost),
        describeBoostEffect(spec.effect),
        describeBoostUnlock(spec.unlock, techName) || 'Anybody',
        clip(spec.description),
      ]),
    ),
  };
}

/* -------------------------------------------------------------------- missions */

/**
 * The two optional template fields, as columns, and only when a template actually carries one.
 *
 * Both are overrides: a job with no `leanings` is read off its kind and its distance, and a battle
 * job with no `battleTier` takes the tier its difficulty and distance suggest. A column of nothing
 * across 38 rows is width the brief could use, so each one appears only if somebody uses it.
 */
const OPTIONAL_MISSION_COLUMNS = [
  {
    header: 'Leanings',
    read: (template: MissionTemplate) =>
      (template.leanings ?? []).map((leaning) => MISSION_LEANING_LABELS[leaning]).join(', '),
  },
  {
    header: 'Battle tier',
    read: (template: MissionTemplate) => template.battleTier ?? '',
  },
] as const;

function missionColumns(): readonly (typeof OPTIONAL_MISSION_COLUMNS)[number][] {
  return OPTIONAL_MISSION_COLUMNS.filter((column) =>
    MISSION_TEMPLATES.some((template) => column.read(template) !== ''),
  );
}

function missionRow(
  template: MissionTemplate,
  columns: readonly (typeof OPTIONAL_MISSION_COLUMNS)[number][],
): readonly string[] {
  return [
    code(template.id),
    template.name,
    template.kind,
    template.difficulty,
    template.travelBand,
    `${template.durationMinutes}m`,
    percent(template.successChance),
    money(template.spoils),
    ...columns.map((column) => column.read(template)),
    clip(template.brief),
  ];
}

/**
 * Feats, in one table.
 *
 * A hundred and sixty one entries is past the size anybody can hold in their head, and the
 * balance argument about them is a comparison between rows: this is the only view where the
 * whole ladder for one measure, and every reward in one era, can be read side by side.
 *
 * The reward is printed as the caps-equivalent the balance gate prices it at, plus the channels
 * it actually pays in. The figure is not a thing a player ever sees, and it is here for the same
 * reason the gate exists: so a wrong one is visible from across the room.
 */
function featsSection(): Section {
  const channels = (reward: (typeof FEATS)[number]['reward']): string =>
    [
      reward.resources ? 'resources' : '',
      reward.units ? 'units' : '',
      reward.items ? 'items' : '',
      reward.xp ? 'xp' : '',
      reward.infamy ? 'infamy' : '',
      reward.boosts ? 'boosts' : '',
    ]
      .filter((one) => one !== '')
      .join(', ');

  return {
    title: 'Feats',
    sources: ['packages/shared/src/feats/catalog.ts', 'packages/shared/src/feats/rewards.ts'],
    rows: FEATS.length,
    body: [
      'Every feat, its ladder, and what finishing it pays. A step with something in **After** is locked until that one is done; everything else is always open. Worth is the caps-equivalent the balance gate prices the reward at, and is never shown to a player.',
      table(
        ['Id', 'Name', 'Era', 'Size', 'Chain', 'After', 'Measure', 'Target', 'Pays', 'Worth'],
        FEATS.map((feat) => [
          code(feat.id),
          feat.name,
          feat.era,
          feat.size,
          feat.chain === null ? '-' : code(feat.chain),
          feat.after === null ? '-' : code(feat.after),
          code(feat.scope === undefined ? feat.measure : `${feat.measure}:${feat.scope}`),
          feat.target.toLocaleString(),
          channels(feat.reward),
          Math.round(featRewardValue(feat.reward)).toLocaleString(),
        ]),
      ),
      '#### What a feat of each era and size may pay',
      table(
        ['Era', 'Size', 'Lowest', 'Highest'],
        FEAT_ERAS.flatMap((era) =>
          FEAT_SIZES.map((size) => [
            era,
            size,
            featRewardBand(era, size).min.toLocaleString(),
            featRewardBand(era, size).max.toLocaleString(),
          ]),
        ),
      ),
    ]
      .filter((part) => part !== '')
      .join('\n\n'),
  };
}

function missionsSection(): Section {
  const columns = missionColumns();
  const omitted = OPTIONAL_MISSION_COLUMNS.filter((column) => !columns.includes(column));
  return {
    title: 'Missions',
    sources: ['packages/shared/src/missions.ts', 'packages/shared/src/missions.leading.ts'],
    rows: MISSION_TEMPLATES.length,
    body: [
      'Spoils are the baseline bundle before the area premium, the crew level premium and the §E5 length curve. Success chance is the base, before whoever leads the run moves it.',
      omitted.length === 0
        ? ''
        : `No template overrides ${omitted.map((column) => column.header.toLowerCase()).join(' or ')}, so those columns are left out: a job is read off its kind and its distance instead.`,
      table(
        [
          'Id',
          'Name',
          'Kind',
          'Difficulty',
          'Travel',
          'On site',
          'Success',
          'Spoils',
          ...columns.map((column) => column.header),
          'Brief',
        ],
        MISSION_TEMPLATES.map((template) => missionRow(template, columns)),
      ),
      '#### Leanings',
      'What a job leans on in whoever leads it. The reason is the sentence the board shows on hover, and it names the attributes the leaning actually reads.',
      table(
        ['Leaning', 'Label', 'Why it matters'],
        MISSION_LEANINGS.map((leaning) => [
          code(leaning),
          MISSION_LEANING_LABELS[leaning],
          clip(MISSION_LEANING_REASONS[leaning]),
        ]),
      ),
    ]
      .filter((part) => part !== '')
      .join('\n\n'),
  };
}

/* ----------------------------------------------------------------------- areas */

function areasSection(): Section {
  const rows = CITY_DISTRICTS.map((district) => [
    code(district.id),
    district.name,
    district.nickname ?? '',
    district.formalName ?? '',
    district.kind,
    district.allegiance,
    String(district.difficulty),
    `+${areaPayPercent(district.id)}%`,
    String(district.locations.length),
    clip(district.blurb),
  ]);
  const misc = [
    code(MISC_AREA_ID),
    'Miscellaneous board',
    '',
    '',
    'board',
    '',
    '1',
    `+${areaPayPercent(MISC_AREA_ID)}%`,
    '0',
    'Work with no address: scrap runs, expeditions, the board that is always open.',
  ];
  return {
    title: 'Mission areas and districts',
    sources: ['packages/shared/src/city/districts.ts', 'packages/shared/src/missions.areas.ts'],
    rows: CITY_DISTRICTS.length + 1,
    body: [
      `Pay premium is ${PAY_PERCENT_PER_DIFFICULTY} percentage points per point of difficulty above 1. The misc board sits at the bottom of the scale because it is always open.`,
      table(
        [
          'Id',
          'Name',
          'Nickname',
          'Formal name',
          'Kind',
          'Allegiance',
          'Difficulty',
          'Pay premium',
          'Locations',
          'Blurb',
        ],
        [...rows, misc],
      ),
    ].join('\n\n'),
  };
}

/* ------------------------------------------------------------------- locations */

function locationsSection(): Section {
  const kinds = Object.keys(LOCATION_CATALOG) as LocationKind[];
  const kindRows = kinds.map((kind) => {
    const spec = LOCATION_CATALOG[kind];
    return [
      code(kind),
      spec.label,
      String(spec.baseDefense),
      spec.bonuses.map(describeHoldBonus).join(', '),
      spec.labels.map(labelText).join(', '),
      money(spec.upgradeCost),
      clip(spec.blurb),
      clip(spec.reward, 60),
    ];
  });
  const placed = CITY_LOCATIONS.map((location) => [
    code(location.id),
    location.name,
    code(location.districtId),
    code(location.kind),
    location.fortifyDifficulty,
  ]);
  return {
    title: 'Locations',
    sources: ['packages/shared/src/city/locations.ts', 'packages/shared/src/city/districts.ts'],
    rows: kinds.length + CITY_LOCATIONS.length,
    body: [
      `${kinds.length} kinds of ground, ${CITY_LOCATIONS.length} of them placed on the map. Bonuses and labels are the level 1 figures.`,
      `#### Kinds (${kinds.length})`,
      table(
        [
          'Kind',
          'Label',
          'Defense',
          'Holding it pays',
          'Ground',
          'First upgrade',
          'Blurb',
          'Reward',
        ],
        kindRows,
      ),
      `#### Placed on the map (${CITY_LOCATIONS.length})`,
      table(['Id', 'Name', 'District', 'Kind', 'Fortify'], placed),
    ].join('\n\n'),
  };
}

/* ---------------------------------------------------------------- environment */

function environmentSection(): Section {
  return {
    title: 'Environment labels and weather',
    sources: ['packages/shared/src/city/labels.ts', 'packages/shared/src/city/weather.ts'],
    rows: ENV_LABEL_IDS.length + WEATHER_KINDS.length,
    body: [
      `#### Ground labels (${ENV_LABEL_IDS.length})`,
      table(
        ['Id', 'Name', 'Tone', 'Stat', 'At tier 1', 'At tier 4', 'Description', 'Who it bites'],
        ENV_LABEL_IDS.map((id) => {
          const spec = ENV_LABEL_CATALOG[id];
          return [
            code(id),
            spec.name,
            spec.tone,
            spec.rule.stat,
            String(spec.rule.atLow),
            String(spec.rule.atHigh),
            clip(spec.description),
            clip(spec.bites, 70),
          ];
        }),
      ),
      `#### Weather (${WEATHER_KINDS.length})`,
      table(
        ['Kind', 'Name', 'Blurb'],
        WEATHER_KINDS.map((kind) => [
          code(kind),
          WEATHER_CATALOG[kind].name,
          clip(WEATHER_CATALOG[kind].blurb),
        ]),
      ),
    ].join('\n\n'),
  };
}

/* ----------------------------------------------------------------------- units */

/**
 * What a unit answers and what it dreads, in one cell.
 *
 * Every unit carries both since 2026-09-18, and the sheet is the axis a defending player builds
 * against, so a catalogue that prints `Damage type` and stops tells half the story: it says what a
 * unit deals and nothing about what deals with it. Signed numbers because the sign is the meaning,
 * a plus being damage taken off and a minus being damage taken extra.
 */
function resistanceLine(resistances: UnitStats['resistances']): string {
  const of = (keep: (points: number) => boolean) =>
    DAMAGE_TYPES.flatMap((type) => {
      const points = resistances[type];
      return points === undefined || !keep(points)
        ? []
        : [`${type} ${points > 0 ? '+' : ''}${points}`];
    });
  // Answers before dreads, because that is the order the column heading promises. Reading the
  // sheet in `DAMAGE_TYPES` order alone put a weakness first whenever its type sorted earlier.
  return [...of((points) => points > 0), ...of((points) => points < 0)].join(', ');
}

function unitRow(unit: UnitSpec): readonly string[] {
  return [
    code(unit.id),
    unit.name,
    unit.unique ? 'yes' : 'no',
    unit.combat === false ? 'no' : 'yes',
    String(unit.unitSlots),
    String(unit.stats.offense),
    String(unit.stats.vitality),
    String(unit.stats.armor),
    String(unit.stats.speed),
    unit.stats.damageType,
    resistanceLine(unit.stats.resistances),
    money(unit.cost),
    clock(unit.trainSeconds),
    unitUnlockClauses(unit).map(describeRequirement).join('; '),
    UNIT_RULE_IDS.filter((id) => unit[id] === true)
      .map((id) => UNIT_RULES[id].label)
      .join(', '),
    unit.modifiers.map((id) => UNIT_MODIFIERS[id].label).join(', '),
    clip(unit.blurb),
  ];
}

function unitsSection(): Section {
  const headers = [
    'Id',
    'Name',
    'Unique',
    'Fights',
    'Unit slots',
    'Damage',
    'Vitality',
    'Armour',
    'Speed',
    'Damage type',
    'Answers / dreads',
    'Cost',
    'Train',
    'Requires',
    'Rules',
    'Modifiers',
    'Blurb',
  ];
  const groups = UNIT_TIERS.map((tier) => {
    const units = PLAYER_UNITS.filter((unit) => unit.tier === tier);
    return [
      `#### ${UNIT_TIER_LABELS[tier]} (${units.length})`,
      table(headers, units.map(unitRow)),
    ].join('\n\n');
  });
  // The regime's own sheets, in a section of their own rather than mixed into the tiers: they are
  // never trained, so listing them under Rabble beside the Razors would read as an offer.
  const combine = [
    `#### The Combine (${COMBINE_UNITS.length})`,
    'Met, never held. No price, no clock and no gate: see `UnitSpec.faction`.',
    table(headers, COMBINE_UNITS.map(unitRow)),
  ].join('\n\n');
  return {
    title: 'Units',
    sources: ['packages/shared/src/units/catalog.ts'],
    rows: UNIT_CATALOG.length,
    body: [
      'Four of the eleven sheet numbers are printed here. The rest (penetration, range, evasion, stealth, loot, intimidation) are in the catalogue beside them.',
      ...groups,
      combine,
      `#### Sheet numbers (${UNIT_STAT_KEYS.length})`,
      table(
        ['Key', 'Label'],
        UNIT_STAT_KEYS.map((key) => [code(key), UNIT_STAT_LABELS[key]]),
      ),
      `#### Rules on a sheet (${UNIT_RULE_IDS.length})`,
      table(
        ['Flag', 'Label', 'Tone', 'Description'],
        UNIT_RULE_IDS.map((id) => [
          code(id),
          UNIT_RULES[id].label,
          'tone' in UNIT_RULES[id] ? String(UNIT_RULES[id].tone) : 'positive',
          clip(UNIT_RULES[id].description),
        ]),
      ),
      `#### Modifiers (${UNIT_MODIFIER_IDS.length})`,
      table(
        ['Id', 'Label', 'When', 'Points', 'Affects', 'Description'],
        UNIT_MODIFIER_IDS.map((id) => {
          const spec = UNIT_MODIFIERS[id];
          return [
            code(id),
            spec.label,
            spec.context,
            `+${spec.percent}%`,
            'affects' in spec ? String(spec.affects) : 'offense',
            clip(spec.description),
          ];
        }),
      ),
    ].join('\n\n'),
  };
}

/* -------------------------------------------------------------------- upgrades */

/** Flat changes to a sheet, signed: `+10 Vitality, -2 Speed`. Non-numeric keys are not authored. */
function statEffect(effect: Partial<UnitStats>): string {
  return UNIT_STAT_KEYS.filter((key) => effect[key] !== undefined)
    .map((key) => {
      const value = effect[key] as number;
      return `${value > 0 ? '+' : ''}${value} ${UNIT_STAT_LABELS[key]}`;
    })
    .join(', ');
}

/** The thirty cards, grouped by the four rarities in order, which is how the yard's bench groups them. */
function upgradesSection(): Section {
  const groups = UNIT_MODIFICATION_RARITIES.map((rarity) => {
    const specs = unitModificationsOfRarity(rarity);
    return [
      `#### ${UNIT_MODIFICATION_RARITY_LABELS[rarity]} (${specs.length})`,
      UNIT_MODIFICATION_RARITY_BLURBS[rarity],
      table(
        ['Id', 'Name', 'Effect', 'Cost', 'Parts', 'Blueprint', 'Fits', 'Yard level', 'Description'],
        specs.map((spec) => [
          code(spec.id),
          spec.name,
          statEffect(spec.effect),
          money(spec.cost),
          parts(spec.parts),
          spec.requiresBlueprint ? 'yes' : 'no',
          spec.fits ? spec.fits.map(code).join(', ') : 'every unit',
          String(scrapyardLevelForUpgrade(spec)),
          clip(spec.description),
        ]),
      ),
    ].join('\n\n');
  });
  return {
    title: 'Unit modifications',
    sources: ['packages/shared/src/units/modifications.ts'],
    rows: UNIT_MODIFICATIONS.length,
    body: groups.join('\n\n'),
  };
}

/* -------------------------------------------------------------------- vehicles */

function vehiclesSection(): Section {
  return {
    title: 'Vehicles',
    sources: ['packages/shared/src/building/vehicles.ts'],
    rows: VEHICLES.length,
    body: table(
      [
        'Id',
        'Name',
        'Class',
        'Garage',
        'Cost',
        'Build',
        'Speed',
        'Seats (unit slots)',
        'Fragile',
        'Description',
      ],
      VEHICLES.map((spec) => [
        code(spec.id),
        spec.name,
        spec.class,
        String(spec.requiresGarageLevel),
        money(spec.cost),
        clock(spec.buildSeconds),
        String(spec.speed),
        String(spec.capacity),
        spec.fragile === true ? 'yes' : 'no',
        clip(spec.description),
      ]),
    ),
  };
}

/* ------------------------------------------------------------------- buildings */

function buildingsSection(): Section {
  return {
    title: 'Buildings',
    sources: ['packages/shared/src/building/kinds.ts'],
    rows: BUILDING_KINDS.length,
    body: table(
      [
        'Kind',
        'Name',
        'Short',
        'Requires',
        'Ceiling',
        'Level 1 cost',
        `Level ${LATE_COST_FROM_LEVEL} extra`,
        'Level 1 build',
        'Role',
        'Description',
      ],
      BUILDING_KINDS.map((kind) => {
        const spec = BUILDING_CATALOG[kind];
        return [
          code(kind),
          spec.name,
          spec.shortName,
          spec.requires.map(describeBuildingRequirement).join('; ') || 'nothing',
          String(levelCeilingFor(kind)),
          money(spec.baseCost),
          // Seven structures charge no high quality metal until their fifth level (`lateCost`), and
          // a reference that prints only `baseCost` says they never charge any at all.
          spec.lateCost === undefined ? 'none' : money(spec.lateCost),
          clock(spec.baseSeconds),
          clip(spec.role),
          clip(spec.description),
        ];
      }),
    ),
  };
}

/* --------------------------------------------------------------- modifications */

function modificationsSection(): Section {
  const groups = BUILDING_KINDS.map((kind) => {
    const specs = MODIFICATIONS.filter((spec) => spec.building === kind);
    return [
      `#### ${BUILDING_CATALOG[kind].name} (${specs.length})`,
      table(
        ['Id', 'Name', 'Effect', 'Points', 'Price', 'Advanced', 'Yard level', 'Description'],
        specs.map((spec) => [
          code(spec.id),
          spec.name,
          code(spec.effect),
          `+${spec.magnitude}`,
          money(modificationPrice(spec)),
          isAdvancedModification(spec) ? 'yes' : 'no',
          String(scrapyardLevelForModification(spec)),
          clip(spec.description),
        ]),
      ),
    ].join('\n\n');
  });
  return {
    title: 'Building modifications',
    sources: [
      'packages/shared/src/building/modifications.ts',
      'packages/shared/src/building/addons.ts',
    ],
    rows: MODIFICATIONS.length,
    body: [
      'An advanced modification is one worth 12 points or more: it costs high quality metal on top of the scrap, and it sits behind the structure’s retrofit blueprint. Prices are list prices; the Scrapyard takes 2% off per level above its first, to a cap of 30%, and each entry opens at the yard level shown (`packages/shared/src/building/scrapyard.ts`).',
      ...groups,
    ].join('\n\n'),
  };
}

/* -------------------------------------------------------------------- research */

function researchSection(): Section {
  const groups = OFFICER_ROLES.map((role) => {
    const items = RESEARCH_ITEMS.filter((item) => item.track === role);
    return [
      `#### ${OFFICER_ROLE_LABELS[role]} (${items.length})`,
      RESEARCH_TRACK_BLURBS[role],
      table(
        ['Step', 'Id', 'Name', 'Payout', 'Cost', 'Minutes', 'Mark', 'Head mark', 'Description'],
        items.map((item) => [
          String(item.step),
          code(item.id),
          item.name,
          clip(describeResearchPayout(item), 70),
          money(item.cost),
          String(item.minutes),
          item.requiresMark,
          item.requiresHeadMark ?? '',
          clip(item.description),
        ]),
      ),
    ].join('\n\n');
  });
  return {
    title: 'Research',
    sources: ['packages/shared/src/research/tracks.ts'],
    rows: RESEARCH_ITEMS.length,
    body: [
      `${OFFICER_ROLES.length} tracks of ${RESEARCH_TRACK_STEPS} rungs. Cost and minutes come from the rung's depth, not from the row: see \`researchItemCost\` and \`researchItemMinutes\`. Mark is what the chair holding the track needs; head mark is what the Head of Research needs alongside.`,
      ...groups,
    ].join('\n\n'),
  };
}

/* ----------------------------------------------------------------------- perks */

function perksSection(): Section {
  const groups = PERK_CATEGORIES.map((category) => {
    const perks = PERK_CATALOG.filter((perk) => perk.category === category);
    return [
      `#### ${PERK_CATEGORY_LABELS[category]} (${perks.length})`,
      table(
        ['Id', 'Name', 'Bonus', 'Description'],
        perks.map((perk) => [
          code(perk.id),
          perk.name,
          describePerkBonus(perk.bonus),
          clip(perk.description),
        ]),
      ),
    ].join('\n\n');
  });
  return {
    title: 'Officer perks',
    sources: ['packages/shared/src/crew/perks.ts'],
    rows: PERK_CATALOG.length,
    body: groups.join('\n\n'),
  };
}

/* -------------------------------------------------------------------- training */

function drillsSection(): Section {
  const names = Object.keys(TRAINING_DRILLS) as AttributeName[];
  return {
    title: 'Training drills',
    sources: ['packages/shared/src/crew/training.ts'],
    rows: names.length,
    body: table(
      ['Attribute', 'Title', 'Detail'],
      names.map((name) => [
        ATTRIBUTE_LABELS[name],
        TRAINING_DRILLS[name].title,
        clip(TRAINING_DRILLS[name].detail),
      ]),
    ),
  };
}

/* ---------------------------------------------------------------- black market */

function blackMarketSection(): Section {
  const goods = Object.values(BLACK_MARKET_GOODS);
  const pages = goods.filter((good) => good.kind === 'blueprint_page');
  const listed = BLACK_MARKET_KINDS.filter((kind) => kind !== 'blueprint_page');
  const groups = listed.map((kind) => {
    const rows = goods.filter((good) => good.kind === kind);
    return [
      `#### ${BLACK_MARKET_KIND_LABELS[kind]} (${rows.length})`,
      table(
        ['Id', 'Name', 'Infamy', 'Effect', 'Grants', 'Description'],
        rows.map((good) => [
          code(good.id),
          good.name,
          String(good.infamy),
          clip(good.effect, 70),
          good.grants === undefined ? '' : parts(good.grants),
          clip(good.description),
        ]),
      ),
    ].join('\n\n');
  });
  return {
    title: 'Black market goods',
    sources: ['packages/shared/src/market/blackmarket.ts'],
    rows: goods.length - pages.length,
    body: [
      `The shelf also carries every blueprint page as a good (${pages.length} of them), generated one per page and priced off the document's length. Those are not listed again here.`,
      ...groups,
    ].join('\n\n'),
  };
}

/* -------------------------------------------------------------------- factions */

function factionsSection(): Section {
  const cards = Object.values(FACTION_CARD_SPECS);
  return {
    title: 'Factions',
    sources: ['packages/shared/src/factions/cards.ts', 'packages/shared/src/factions/factions.ts'],
    rows: cards.length + FACTION_RANKS.length,
    body: [
      `#### Table cards (${cards.length})`,
      table(
        ['Card', 'Name', 'Aspect', 'Reads', 'Pays the table', 'Blurb'],
        cards.map((spec) => [
          code(spec.card),
          spec.name,
          spec.aspect,
          spec.reads.map((name) => ATTRIBUTE_LABELS[name]).join(', '),
          spec.channelLabel,
          clip(spec.blurb),
        ]),
      ),
      `#### Ranks (${FACTION_RANKS.length})`,
      table(
        ['Rank', 'Label', 'What it may do'],
        FACTION_RANKS.map((rank) => [
          code(rank),
          FACTION_RANK_LABELS[rank],
          clip(FACTION_RANK_BLURBS[rank]),
        ]),
      ),
    ].join('\n\n'),
  };
}

/* -------------------------------------------------------------------- overseer */

function overseerSection(): Section {
  return {
    title: 'Overseer presets',
    sources: ['packages/shared/src/overseer.ts'],
    rows: OVERSEER_PRESETS.length,
    body: table(
      ['Preset', 'Name', 'Archetype', 'Top ratings', 'Perks', 'Bio'],
      OVERSEER_PRESETS.map((preset) => [
        code(preset.presetId),
        preset.name,
        preset.archetype,
        (Object.entries(preset.attributes) as [AttributeName, number][])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([name, value]) => `${ATTRIBUTE_LABELS[name]} ${value}`)
          .join(', '),
        preset.perks.join(', '),
        clip(preset.bio),
      ]),
    ),
  };
}

/* ------------------------------------------------------------------- resources */

function resourcesSection(): Section {
  return {
    title: 'Resources',
    sources: ['packages/shared/src/resources.ts'],
    rows: RESOURCE_ORDER.length,
    body: table(
      ['Key', 'Label', 'What it is', 'Spent on', 'Comes from'],
      RESOURCE_ORDER.map((key) => [
        code(key),
        RESOURCE_LABELS[key],
        clip(RESOURCE_LORE[key].what),
        RESOURCE_LORE[key].spentOn.join('; '),
        clip(RESOURCE_LORE[key].from, 60),
      ]),
    ),
  };
}

/* ------------------------------------------------------------------ attributes */

function attributesSection(): Section {
  return {
    title: 'Attributes and officer roles',
    sources: ['packages/shared/src/attributes.ts', 'packages/shared/src/roles.ts'],
    rows: Object.keys(ATTRIBUTE_LABELS).length + OFFICER_ROLES.length,
    body: [
      table(
        ['Group', 'Attributes'],
        ATTRIBUTE_GROUPS.map((group) => [
          ATTRIBUTE_GROUP_LABELS[group],
          ATTRIBUTES_BY_GROUP[group]
            .map((name) => `${ATTRIBUTE_LABELS[name]} (${code(name)})`)
            .join(', '),
        ]),
      ),
      `#### Officer roles (${OFFICER_ROLES.length})`,
      'What a role actually asks of a sheet is server-side and deliberately not in this package.',
      table(
        ['Role', 'Label', 'Its research track'],
        OFFICER_ROLES.map((role) => [
          code(role),
          OFFICER_ROLE_LABELS[role],
          clip(RESEARCH_TRACK_BLURBS[role]),
        ]),
      ),
    ].join('\n\n'),
  };
}

/* ------------------------------------------------------------------- notoriety */

function notorietySection(): Section {
  return {
    title: 'Notoriety tiers',
    sources: ['packages/shared/src/economy/notoriety.ts'],
    rows: NOTORIETY_TIERS.length,
    body: table(
      ['Rung', 'Tier', 'What the street is doing'],
      NOTORIETY_TIERS.map((tier, index) => [String(index), tier, clip(NOTORIETY_BLURBS[tier])]),
    ),
  };
}

/* ---------------------------------------------------------------------- extras */

function unlocksSection(): Section {
  return {
    title: 'Player level unlocks',
    sources: ['packages/shared/src/progression/unlocks.ts'],
    rows: PLAYER_LEVEL_UNLOCKS.length,
    body: table(
      ['Level', 'Id', 'Name', 'What changes'],
      PLAYER_LEVEL_UNLOCKS.map((unlock) => [
        String(unlock.level),
        code(unlock.id),
        unlock.name,
        clip(unlock.description),
      ]),
    ),
  };
}

function notificationsSection(): Section {
  const groups = NOTIFICATION_GROUPS.map((group) => {
    const kinds = NOTIFICATION_KINDS.filter(
      (kind) => NOTIFICATION_KIND_SPECS[kind].group === group,
    );
    return [
      `#### ${NOTIFICATION_GROUP_LABELS[group]} (${kinds.length})`,
      table(
        ['Kind', 'Label', 'Always on', 'Blurb'],
        kinds.map((kind) => {
          const spec = NOTIFICATION_KIND_SPECS[kind];
          return [code(kind), spec.label, spec.alwaysOn === true ? 'yes' : 'no', clip(spec.blurb)];
        }),
      ),
    ].join('\n\n');
  });
  return {
    title: 'Notification kinds',
    sources: ['packages/shared/src/social/notifications.ts'],
    rows: NOTIFICATION_KINDS.length,
    body: groups.join('\n\n'),
  };
}

function motifsSection(): Section {
  const ids = Object.keys(BLUEPRINT_MOTIFS) as (keyof typeof BLUEPRINT_MOTIFS)[];
  return {
    title: 'Blueprint motifs',
    sources: ['packages/shared/src/blueprints/motifs.ts'],
    rows: ids.length,
    body: [
      'What each cover and page sheet draws. The label is the specification: where the art and the label disagree, the art is the bug.',
      table(
        ['Motif', 'Draws'],
        ids.map((id) => [code(id), BLUEPRINT_MOTIFS[id]]),
      ),
    ].join('\n\n'),
  };
}

/* -------------------------------------------------------------------------- */
/* The document                                                                */
/* -------------------------------------------------------------------------- */

export function sections(): readonly Section[] {
  return [
    blueprintsSection(),
    itemsSection(),
    trapsSection(),
    boostsSection(),
    featsSection(),
    missionsSection(),
    areasSection(),
    locationsSection(),
    environmentSection(),
    unitsSection(),
    upgradesSection(),
    vehiclesSection(),
    buildingsSection(),
    modificationsSection(),
    researchSection(),
    perksSection(),
    drillsSection(),
    blackMarketSection(),
    factionsSection(),
    overseerSection(),
    resourcesSection(),
    attributesSection(),
    notorietySection(),
    unlocksSection(),
    notificationsSection(),
    motifsSection(),
  ];
}

/**
 * The board's note at the top, kept verbatim (maintainer request, 2026-09-10).
 *
 * It is here rather than in a hand-edited file because the whole document is regenerated: a note
 * living outside the generator would be wiped by the next run.
 */
const REMOVED_TAG_NOTE = [
  '## Removed: the "Ground pays" tag on the mission board',
  '',
  'The mission board used to carry a tag at the right of the "Board 1 of N" row reading "Ground pays +N%" (or "Standing rate" when the bonus was zero). It was the area’s pay premium: every district pays a percentage more for the same job than the misc board does, 9 percentage points per point of district difficulty above 1 (`PAY_PERCENT_PER_DIFFICULTY` in `packages/shared/src/missions.areas.ts`), plus 10 points per crew level above the first (`PAY_PERCENT_PER_LEVEL`) and any spoils bonus from the crew’s standing. The number is still applied to every reward on the board and frozen onto a mission at launch; only the tag that quoted it on the board header has been removed (maintainer request, 2026-09-10). The per-card "expected haul" already shows the scaled figures.',
].join('\n');

function contents(all: readonly Section[]): string {
  return [
    '## Contents',
    '',
    ...all.map(
      (section) => `- [${section.title}](#${anchor(section.title)}) (${section.rows} entries)`,
    ),
  ].join('\n');
}

export function renderDoc(all: readonly Section[] = sections()): string {
  const head = [
    '# Frontline content catalogue',
    '',
    'Generated by `pnpm catalog:doc`, do not edit by hand; edit the source file named under each heading and regenerate.',
  ].join('\n');
  return `${[head, REMOVED_TAG_NOTE, contents(all), ...all.map(render)].join('\n\n')}\n`;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

export interface CliOptions {
  check: boolean;
  docPath: string;
}

const USAGE = 'Usage: catalog-doc [--check] [--out FILE]';

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { check: false, docPath: DEFAULT_DOC_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg !== '--out') throw new Error(`Unknown argument "${String(arg)}". ${USAGE}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    options.docPath = path.resolve(value);
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

  const all = sections();
  const doc = renderDoc(all);
  const relative = path.relative(REPO_ROOT, options.docPath);

  if (options.check) {
    const committed = await readFile(options.docPath, 'utf8').catch(() => null);
    if (committed === doc) return 0;
    process.stderr.write(
      committed === null
        ? `${relative} does not exist: run \`pnpm catalog:doc\`.\n`
        : `${relative} is out of date with the catalogues: run \`pnpm catalog:doc\` and commit it.\n`,
    );
    return 1;
  }

  await writeFile(options.docPath, doc);
  const rows = all.reduce((sum, section) => sum + section.rows, 0);
  process.stdout.write(`${relative}: ${all.length} sections, ${rows} entries.\n`);
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
