import {
  addResources,
  CITY_DISTRICTS,
  OVERSEER_PRESETS,
  STARTING_RESOURCES,
  type AuthResponse,
  type Base,
  type BaseDetailResponse,
  type BattleResponse,
  type CityResponse,
  type CreateOverseerResponse,
  type MeResponse,
  type Overseer,
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
  skills: preset.skills,
};

export const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: "Operator's Foothold",
  districtId: 'neon-docks',
  level: 1,
  resources: STARTING_RESOURCES,
  buildings: [
    { id: 'b1', kind: 'command_center', level: 1 },
    { id: 'b2', kind: 'reactor', level: 1 },
  ],
  createdAt: NOW,
};

const user: User = { id: 'user-1', username: 'operator', overseerId: overseer.id, createdAt: NOW };
const userNoOverseer: User = { ...user, overseerId: null };

export const me: MeResponse = { user, overseer, base };
export const meNoOverseer: MeResponse = { user: userNoOverseer, overseer: null, base: null };

export const city: CityResponse = {
  districts: [...CITY_DISTRICTS],
  bases: [
    { id: base.id, ownerId: user.id, name: base.name, districtId: 'neon-docks', level: 1 },
    {
      id: 'rival-1',
      ownerId: 'user-2',
      name: 'Vex Holdings',
      districtId: 'ashen-terraces',
      level: 3,
    },
  ],
};

export const baseDetail: BaseDetailResponse = { base };

const rewards = { alloy: 120, credits: 60 };

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
