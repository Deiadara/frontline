import {
  MVP_DEV_CREDENTIALS,
  createCommander,
  type Building,
  type Commander,
  type Resources,
} from '@frontline/shared';

/*
 * MVP ONLY — replace before any public deployment.
 *
 * The whole seeded world: one hardcoded operator account whose password is committed to
 * this repository, and one AI rival base. Nothing here is authored content — it exists so
 * the game is playable end to end from a cold database. Before this ships anywhere public
 * the account must go and the rival must come from real content/AI systems.
 */

/** The hardcoded dev operator. Credentials are shared so the client can prefill them. */
export const MVP_PLAYER = MVP_DEV_CREDENTIALS;

/** Everything needed to mint the single AI rival base. */
interface BotBlueprint {
  /** Login is impossible for this account (see seedMvpWorld) — the name is display-only. */
  username: string;
  baseName: string;
  /** Resolved through `findOverseerPreset`; the rival fields a real overseer. */
  overseerPresetId: string;
  level: number;
  /*
   * The rival's stat sheet. These three fields are staged input for the real battle
   * engine — none of them is read by the placeholder engine, which pays out the target
   * district's `rewards` and never touches the defender. Raiding the rival therefore does
   * not (yet) move a single credit out of this stockpile.
   */
  resources: Resources;
  /** Defensive structures plus the economy that pays for them. */
  buildings: Building[];
  commanders: Commander[];
}

export const MVP_BOT: BotBlueprint = {
  username: 'Vex_Combine',
  baseName: 'Vex Holdings',
  overseerPresetId: 'fixer',
  level: 4,
  resources: { credits: 4200, power: 1600, data: 1400, alloy: 3800 },
  buildings: [
    { id: 'vex-command-center', kind: 'command_center', level: 4 },
    { id: 'vex-wall', kind: 'wall', level: 4 },
    { id: 'vex-barracks', kind: 'barracks', level: 3 },
    { id: 'vex-reactor', kind: 'reactor', level: 3 },
    { id: 'vex-foundry', kind: 'foundry', level: 2 },
    { id: 'vex-data-hub', kind: 'data_hub', level: 2 },
  ],
  commanders: [
    createCommander('vex-commander-doctor', 'Iris "Suture" Vale', 'head_doctor', {
      medicine: 18,
      leadership: 12,
    }),
    createCommander('vex-commander-analyst', 'Ren Kaido', 'battle_analyst', {
      tactics: 17,
      engineering: 13,
    }),
    createCommander('vex-commander-accountant', 'Odile Marchetti', 'accountant', {
      negotiation: 16,
      logistics: 15,
    }),
    createCommander('vex-commander-spy', 'The Ghost of Sector Nine', 'head_spy', {
      hacking: 18,
      intimidation: 14,
    }),
  ],
};
