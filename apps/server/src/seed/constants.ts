import {
  MVP_DEV_CREDENTIALS,
  createCommander,
  type Army,
  type Building,
  type Commander,
  type FactionBadge,
  type Resources,
} from '@frontline/shared';

/*
 * MVP ONLY: replace before any public deployment.
 *
 * The whole seeded world: one hardcoded operator account whose password is committed to
 * this repository, and one AI rival base. Nothing here is authored content: it exists so
 * the game is playable end to end from a cold database. Before this ships anywhere public
 * the account must go and the rival must come from real content/AI systems.
 */

/** The hardcoded dev operator. Credentials are shared so the client can prefill them. */
export const MVP_PLAYER = MVP_DEV_CREDENTIALS;

/** Everything needed to mint the single AI rival base. */
interface BotBlueprint {
  /** Login is impossible for this account (see seedMvpWorld): the name is display-only. */
  username: string;
  baseName: string;
  /** Resolved through `findOverseerPreset`; the rival fields a real overseer. */
  overseerPresetId: string;
  level: number;
  /*
   * The rival's stat sheet, and the real battle engine reads all three. A raid that gets through
   * loots this stockpile for real: `resolve.ts` bounds the haul by what the attacking force can
   * physically carry and then spends it out of the defender's resources. So these numbers are a
   * balance decision about what a successful raid is worth, not decoration.
   */
  resources: Resources;
  /** Defensive structures plus the economy that pays for them. */
  buildings: Building[];
  commanders: Commander[];
  /** §A5: what the rival can put on the ground. Enough to be a real defence, not a wall. */
  army: Army;
}

export const MVP_BOT: BotBlueprint = {
  username: 'Vex_Combine',
  baseName: 'Vex Holdings',
  overseerPresetId: 'fixer',
  level: 4,
  resources: {
    caps: 4200,
    supplies: 2400,
    oil: 1600,
    scrap: 3800,
    planks: 3200,
    highQualityMetal: 900,
  },
  /**
   * A district built the way a rival would build one: the Nexus high enough to authorise a Gate,
   * and then the Gate raised to the cap. `districtDefense` reads that Gate when the player raids
   * here, so the rival is measurably harder to take than bare ground, which is the point of
   * seeding a rival with structures at all.
   */
  buildings: [
    { id: 'vex-nexus', kind: 'nexus', level: 4, modifications: [], damage: 0 },
    { id: 'vex-gate', kind: 'gate', level: 4, modifications: [], damage: 0 },
    {
      id: 'vex-gauntlet',
      kind: 'gauntlet',
      level: 3,
      modifications: [],
      damage: 0,
    },
    {
      id: 'vex-generator',
      kind: 'generator',
      level: 3,
      modifications: [],
      damage: 0,
    },
    {
      id: 'vex-scrapyard',
      kind: 'scrapyard',
      level: 2,
      modifications: [],
      damage: 0,
    },
    {
      id: 'vex-quarters',
      kind: 'quarters',
      level: 2,
      modifications: [],
      damage: 0,
    },
  ],
  army: { razors: 12, wardens: 6, breakers: 4 },
  /* Four of the 19 officer positions (GDD §C1), on the 0..100 attribute scale. */
  commanders: [
    createCommander(
      'vex-commander-doctor',
      'Iris "Suture" Vale',
      'chief_medic',
      { medicine: 38, composure: 30, chemistry: 24 },
      ['field_medic'],
    ),
    createCommander('vex-commander-analyst', 'Ren Kaido', 'field_commander', {
      organization: 36,
      leadership: 28,
      resolve: 22,
    }),
    createCommander('vex-commander-accountant', 'Odile Marchetti', 'finance_officer', {
      strategy: 34,
      analysis: 27,
      logistics: 25,
    }),
    createCommander(
      'vex-commander-spy',
      'The Ghost of Sector Nine',
      'head_spy',
      { stealth: 37, deception: 29, signals: 26 },
      ['quiet_boots'],
    ),
  ],
};

/**
 * The neighbour who is on your side (board request).
 *
 * A hardcoded, non-playing crew that sits in a faction with the player, so the faction screen has
 * somebody in it from the first minute: their district, their army, their fights and their standing
 * are all real rows read by the same code that reads a live member's. Nothing drives them, which is
 * the point: they are a fixture to build and test the faction screen against, not an AI.
 *
 * Distinct from `MVP_BOT`, who is the *rival*. One neighbour you fight and one you fight beside is
 * what makes the map read as a city rather than a duel.
 */
export const MVP_ALLY: BotBlueprint = {
  username: 'Sable_Ninth',
  baseName: 'The Ninth Street Irregulars',
  overseerPresetId: 'enforcer',
  level: 6,
  resources: {
    caps: 5100,
    supplies: 3300,
    oil: 1900,
    scrap: 4400,
    planks: 2600,
    highQualityMetal: 700,
  },
  buildings: [
    { id: 'ally-nexus', kind: 'nexus', level: 5, modifications: [], damage: 0 },
    { id: 'ally-gate', kind: 'gate', level: 3, modifications: [], damage: 0 },
    {
      id: 'ally-gauntlet',
      kind: 'gauntlet',
      level: 4,
      modifications: [],
      damage: 0,
    },
    {
      id: 'ally-quarters',
      kind: 'quarters',
      level: 4,
      modifications: [],
      damage: 0,
    },
  ],
  // Deliberately a different shape from the player's opening roster: an ally worth having is one
  // who fields what you do not, so the "who could help me" question on the faction screen has a
  // real answer rather than "more of the same".
  army: { ironsides: 8, snipers: 6, stitchers: 4, razors: 20 },
  commanders: [
    createCommander(
      'ally-commander-boss',
      'Halloran Sable',
      'raid_boss',
      { leadership: 36, intimidation: 31, resolve: 27 },
      ['reputation', 'line_officer'],
      120,
    ),
    createCommander(
      'ally-commander-engineer',
      'Petra Vance',
      'lead_engineer',
      { engineering: 34, craft: 29, salvage: 24 },
      ['site_foreman'],
      95,
    ),
  ],
};

/** The plot the ally sits on: the third residential district, beside the player and the rival. */
export const ALLY_DISTRICT_ID = 'ashen-terraces';

/** What the seeded faction is called. The ally founds it and leads it. */
export const MVP_FACTION = {
  name: 'The Ninth Circle',
  /** Drawn, not typed: see `factions/badge.ts`. Soot ground, brass chevron, a brass skull on it. */
  badge: {
    shape: 'shield',
    ground: 'soot',
    field: 'chevron',
    fieldColor: 'oxblood',
    prop: 'skull',
    ink: 'brass',
  },
  blurb: 'Five streets, one arrangement. Whoever comes for one of us finds all of us.',
} as const satisfies { name: string; badge: FactionBadge; blurb: string };
