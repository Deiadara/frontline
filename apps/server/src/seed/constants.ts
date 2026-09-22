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
    { id: 'vex-nexus', kind: 'nexus', level: 4, modifications: [] },
    { id: 'vex-gate', kind: 'gate', level: 4, modifications: [] },
    {
      id: 'vex-gauntlet',
      kind: 'gauntlet',
      level: 3,
      modifications: [],
    },
    {
      id: 'vex-generator',
      kind: 'generator',
      level: 3,
      modifications: [],
    },
    {
      id: 'vex-scrapyard',
      kind: 'scrapyard',
      level: 2,
      modifications: [],
    },
    {
      id: 'vex-quarters',
      kind: 'quarters',
      level: 2,
      modifications: [],
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
      'master_of_whispers',
      { stealth: 37, deception: 29, signals: 26 },
      ['quiet_boots'],
    ),
  ],
};

/**
 * The neighbour who is on your side (maintainer request).
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
    { id: 'ally-nexus', kind: 'nexus', level: 5, modifications: [] },
    { id: 'ally-gate', kind: 'gate', level: 3, modifications: [] },
    {
      id: 'ally-gauntlet',
      kind: 'gauntlet',
      level: 4,
      modifications: [],
    },
    {
      id: 'ally-quarters',
      kind: 'quarters',
      level: 4,
      modifications: [],
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

/**
 * The rival's second, who fills the fourth and last residential plot.
 *
 * Added with the NPC faction (maintainer request, 2026-09-12). The rival already existed and sat at no
 * table, so there was no faction in the world a player was not in, and the enemy faction profile
 * had nothing to open on. A faction of one would have technically answered that and shown a roster
 * with a single row, which is not what a rival table looks like; two crews make it a table.
 *
 * Built like the ally and the rival: a real district, a real army, a real stockpile, read by the
 * same code that reads a live member's. Nothing drives either of them.
 */
export const RIVAL_SECOND_DISTRICT_ID = 'south-quay';

export const MVP_RIVAL_SECOND: BotBlueprint = {
  username: 'Sollen_Tam',
  baseName: 'Sollen Reclamation',
  overseerPresetId: 'technocrat',
  level: 5,
  resources: {
    caps: 3600,
    supplies: 2100,
    oil: 2400,
    scrap: 4600,
    planks: 1800,
    highQualityMetal: 620,
  },
  buildings: [
    { id: 'sollen-nexus', kind: 'nexus', level: 4, modifications: [] },
    { id: 'sollen-gate', kind: 'gate', level: 3, modifications: [] },
    { id: 'sollen-gauntlet', kind: 'gauntlet', level: 3, modifications: [] },
    { id: 'sollen-quarters', kind: 'quarters', level: 3, modifications: [] },
  ],
  // A salvage outfit: thin on units, heavy on the machines that pull a wreck apart. Different
  // again from the rival's line troops and the ally's mixed roster, so the three NPC crews read as
  // three different operations rather than one army at three levels.
  army: { ironsides: 6, razors: 14, scrapers: 9, breakers: 5, stitchers: 3 },
  commanders: [
    createCommander(
      'sollen-commander-boss',
      'Mirek Sollen',
      'lead_engineer',
      { engineering: 39, salvage: 33, craft: 26 },
      ['site_foreman'],
      110,
    ),
    createCommander('sollen-commander-broker', 'Adaeze Quill', 'finance_officer', {
      negotiation: 31,
      analysis: 28,
      logistics: 24,
    }),
  ],
};

/**
 * The NPC faction (maintainer request, 2026-09-12): the table a player is never invited to.
 *
 * The rival leads it and the salvage outfit sits under them. It exists so there is a faction in
 * the world that is somebody else's from the first boot, which is what the public faction profile
 * is for: a player can read who is at it, what it has won and what rank each of them holds, and
 * write to any of them, without any of it being a screen only the seeder can produce.
 *
 * Its badge is deliberately unlike the ally's: a steel lozenge carrying a bone key against the
 * ally's brass skull on a soot shield, so the two are told apart at roster size.
 */
export const MVP_RIVAL_FACTION = {
  name: 'The Vexhold Concern',
  badge: {
    shape: 'lozenge',
    ground: 'steel',
    field: 'pale',
    fieldColor: 'rust',
    prop: 'key',
    ink: 'bone',
  },
  blurb:
    'Debt is a kind of ground, and we hold a great deal of it. Nothing personal in any of this.',
} as const satisfies { name: string; badge: FactionBadge; blurb: string };

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
