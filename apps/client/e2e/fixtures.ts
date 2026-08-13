import {
  addResources,
  CITY_DISTRICTS,
  findMissionTemplate,
  OVERSEER_PRESETS,
  STARTING_RESOURCES,
  startingEconomy,
  startingProgression,
  templateTimings,
  type AuthResponse,
  type Base,
  type BaseDetailResponse,
  type BattleResponse,
  type CityResponse,
  type CreateOverseerResponse,
  type MeResponse,
  type Mission,
  type MissionsResponse,
  type Overseer,
  type PartialResources,
  type User,
} from '@frontline/shared';

const NOW = '2026-08-12T10:00:00.000Z';

const [preset] = OVERSEER_PRESETS;
if (!preset) throw new Error('expected at least one overseer preset');

export const TOKEN = 'e2e-token';

export const overseer: Overseer = {
  id: 'ov-1',
  name: preset.name,
  archetype: preset.archetype,
  portraitId: preset.portraitId,
  bio: preset.bio,
  attributes: preset.attributes,
  traits: preset.traits,
};

export const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: "Operator's Foothold",
  districtId: 'neon-docks',
  level: 1,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  buildings: [
    { id: 'b1', kind: 'command_center', level: 1 },
    { id: 'b2', kind: 'reactor', level: 1 },
  ],
  commanders: [],
  createdAt: NOW,
};

const user: User = { id: 'user-1', username: 'operator', overseerId: overseer.id, createdAt: NOW };
const userNoOverseer: User = { ...user, overseerId: null };

export const me: MeResponse = { user, overseer, base };
export const meNoOverseer: MeResponse = { user: userNoOverseer, overseer: null, base: null };

/**
 * A save that has actually been played: six-figure stockpiles and both meters pegged. HUD chips
 * are sized by the digits in them, so this — not `base` — is the widest the economy row ever
 * gets, and it is what the layout has to survive at the narrowest supported viewport.
 */
export const lateGameBase: Base = {
  ...base,
  level: 12,
  resources: { caps: 125000, food: 48000, oil: 32000, scrap: 96000, highQualityMetal: 12000 },
  economy: { ...base.economy, morale: 100, infamy: 100 },
  // One XP short of level 13 (§I). Widest the progression readout ever gets — four digits either
  // side of the slash and a bar at ~100% — where the starting base shows `0 / 100`.
  progression: { xpIntoLevel: 7799 },
};

export const lateGame: MeResponse = { user, overseer, base: lateGameBase };

export const city: CityResponse = {
  districts: [...CITY_DISTRICTS],
  bases: [
    {
      id: base.id,
      ownerId: user.id,
      name: base.name,
      districtId: 'neon-docks',
      level: 1,
      isBot: false,
    },
    {
      id: 'rival-1',
      ownerId: 'user-2',
      name: 'Vex Holdings',
      districtId: 'ashen-terraces',
      level: 4,
      isBot: true,
    },
  ],
};

export const baseDetail: BaseDetailResponse = { base };

const rewards = { scrap: 120, caps: 60 };

export const battle: BattleResponse = {
  result: {
    winner: 'attacker',
    log: [
      'Strike team slips the cordon under a dead satellite window.',
      'Netrunners spoof the sentry grid; drones circle blind for 41 seconds.',
      'Breach charges crack the ferrocrete line — defenders scatter into the undergrid.',
      'Salvage crews strip the site before corporate response arrives. Victory.',
    ],
    rewards,
  },
  resources: addResources(STARTING_RESOURCES, rewards),
};

export const createOverseerResponse: CreateOverseerResponse = { user, overseer, base };
export const authResponse: AuthResponse = { token: TOKEN, user };

/**
 * The missions page at its widest (GDD §E3).
 *
 * Deliberately the fat case, not the starting one: every crew slot filled, the longest mission on
 * the board only just launched — so its countdown reads `25:5x:xx`, the widest string the timer
 * column can ever hold — and a returned mission paying all five resources at once, which is the
 * longest reward line that can render. The starting state of this page is an empty list, and an
 * empty list has never caught a layout bug.
 *
 * Built against a live `now` because the countdowns are relative; the widths do not depend on
 * which second the screenshot lands on.
 */
export function missionsResponse(now: Date = new Date()): MissionsResponse {
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  const inFlight = (id: string, templateId: string, startedMinutesAgo: number): Mission => {
    const template = findMissionTemplate(templateId);
    if (!template) throw new Error(`unknown mission template: ${templateId}`);
    const { travelMinutes, durationMinutes } = templateTimings(template);
    return {
      id,
      baseId: base.id,
      templateId,
      startedAt: minutesAgo(startedMinutesAgo),
      travelMinutes,
      durationMinutes,
      status: 'active',
      outcome: null,
      rewards: {},
      resolvedAt: null,
    };
  };

  const returned = (
    id: string,
    templateId: string,
    outcome: 'success' | 'failure',
    rewards: PartialResources,
  ): Mission => ({
    ...inFlight(id, templateId, 5_000),
    status: 'resolved',
    outcome,
    rewards,
    resolvedAt: minutesAgo(60),
  });

  return {
    missions: [
      // One minute in on a day-long run: the longest countdown this page can show.
      inFlight('m-1', 'deep-expedition', 1),
      inFlight('m-2', 'refinery-assault', 90),
      inFlight('m-3', 'courier-contract', 40),
      inFlight('m-4', 'scrap-run', 6),
      returned('m-5', 'deep-expedition', 'success', {
        caps: 268,
        food: 268,
        oil: 201,
        scrap: 335,
        highQualityMetal: 40,
      }),
      returned('m-6', 'foundry-raid', 'failure', {}),
      returned('m-7', 'convoy-ambush', 'success', { caps: 52, oil: 35 }),
    ],
    justResolved: [],
    resources: lateGameBase.resources,
    activeLimit: 4,
    serverNow: now.toISOString(),
  };
}
