import {
  MVP_DEV_CREDENTIALS,
  createCommander,
  type Army,
  type Building,
  type Commander,
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
   * The rival's stat sheet. These three fields are staged input for the real battle
   * engine: none of them is read by the placeholder engine, which pays out the target
   * district's `rewards` and never touches the defender. Raiding the rival therefore does
   * not (yet) move a single credit out of this stockpile.
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
    { id: 'vex-nexus', kind: 'nexus', level: 4, modifications: [], damage: 0, fortification: 0 },
    { id: 'vex-gate', kind: 'gate', level: 4, modifications: [], damage: 0, fortification: 0 },
    {
      id: 'vex-gauntlet',
      kind: 'gauntlet',
      level: 3,
      modifications: [],
      damage: 0,
      fortification: 0,
    },
    {
      id: 'vex-generator',
      kind: 'generator',
      level: 3,
      modifications: [],
      damage: 0,
      fortification: 0,
    },
    {
      id: 'vex-scrapyard',
      kind: 'scrapyard',
      level: 2,
      modifications: [],
      damage: 0,
      fortification: 0,
    },
    {
      id: 'vex-quarters',
      kind: 'quarters',
      level: 2,
      modifications: [],
      damage: 0,
      fortification: 0,
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
      ['field_surgeon'],
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
      { stealth: 37, deception: 29, hacking: 26 },
      ['gutter_born'],
    ),
  ],
};
