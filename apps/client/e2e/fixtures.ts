import type { FactionResponse, MessagesResponse, NotificationsResponse } from '@frontline/shared';
import {
  BAR_HIRES_PER_DAY,
  barterRateFor,
  storageCapacity,
  storageCapacityFor,
  supplyAllowance,
  supplyBoard,
  BUILDING_CATALOG,
  fortifyBonusPercent,
  fortifyCost,
  BATTLE_BOOSTS,
  BLACK_MARKET_GOODS,
  boostCoverage,
  describeBoostEffect,
  describeBoostUnlock,
  TRAP_CATALOG,
  declarableSlots,
  type BattleAnalysis,
  type BattlesResponse,
  type BattleView,
  startingTraining,
  VEHICLES,
  TECHNOLOGIES,
  describeTechEffect,
  type MarketResponse,
  type WorkshopResponse,
  EFFECT_CHANNELS,
  OVERSEER_SUBJECT,
  officerPortraitId,
  TRAINING_GAIN,
  TRAINING_SECONDS,
  TRAININGS_PER_DAY,
  crewSheet,
  effectsOfSheet,
  type CrewStandingResponse,
  type TrainingResponse,
  COMBAT_CONTEXT_LABELS,
  ENV_LABEL_CATALOG,
  envLabel,
  ENV_LABEL_IDS,
  LOCATION_CATALOG,
  bonusesAt,
  mergeLabels,
  upgradeCost,
  upgradeNote,
  weatherAt,
  weatherLabels,
  UNIT_CATALOG,
  BOT_DISTRICT_ID,
  STARTER_DISTRICT_ID,
  UNIT_MODIFIERS,
  battlefieldFor,
  unitRules,
  districtPopulationCapacity,
  noTerritoryEffects,
  populationDraw,
  findUnit,
  supplyUsed,
  trainingCost,
  describeHoldBonus,
  describeRequirement,
  findDistrict,
  unitsUnlockedByLocation,
  type DistrictDetailResponse,
  BASE_CONCURRENT_MISSIONS,
  MISC_AREA_ID,
  RESOURCE_KG,
  UNIT_UPGRADES,
  areaPayPercent,
  missionOffers,
  FAILED_MISSION_XP_SHARE,
  missionRewards,
  missionXp,
  payoutSlots,
  scaledSpoils,
  type FittedSlot,
  DISMISSAL_WEEKS,
  PAYROLL_STEP,
  payrollStepCost,
  type UnitsResponse,
  MODIFICATIONS,
  addResources,
  MAX_PAIRINGS,
  MAX_ROLE_FACTS,
  makePairing,
  OFFICER_ROLES,
  RESEARCH_COST_CAPS,
  RESEARCH_MINUTES,
  researchCompletesAt,
  roleFullyResearched,
  CITY_DISTRICTS,
  createCommander,
  findMissionTemplate,
  makeAttributes,
  OVERSEER_PRESETS,
  STARTING_RESOURCES,
  startingEconomy,
  startingProgression,
  startingResearch,
  templateTimings,
  type AuthResponse,
  type BarOfficer,
  type BarRecruit,
  type CrewOfficer,
  type CrewResponse,
  type ActionsResponse,
  type BarResponse,
  type Base,
  type Commander,
  type BaseDetailResponse,
  type BattleResponse,
  type CityResponse,
  type CreateOverseerResponse,
  type DiscoveredFact,
  type MeResponse,
  type OfficerRole,
  type LaunchMissionResponse,
  type ResearchLead,
  type ResearchResponse,
  type Mission,
  type MissionOutcome,
  type MissionsResponse,
  type Overseer,
  type PartialResources,
  type Resources,
  type User,
  type AdminSnapshot,
  type BlackMarketResponse,
  type SettingsResponse,
  GAME_TIMEZONE,
  PLAYER_ICONS,
  blackMarketBoard,
  blackMarketEffect,
  blackMarketPrice,
  findBlackMarketGood,
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
  perks: preset.perks,
};

export const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'The Ninth Street Crew',
  districtId: STARTER_DISTRICT_ID,
  level: 1,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  buildings: [
    { id: 'b1', kind: 'nexus', level: 1, modifications: [], damage: 0, fortification: 0 },
    { id: 'b2', kind: 'generator', level: 1, modifications: [], damage: 0, fortification: 0 },
    // A Gate, dug in one level: the §A4 fortification the board screen is built around, so the
    // default screenshot shows the meter part-filled rather than empty.
    { id: 'b3', kind: 'gate', level: 2, modifications: [], damage: 0, fortification: 1 },
  ],
  buildQueue: [],
  // Fighters and porters both, so the send window and the roster show the support tier (§A5).
  army: { razors: 4, scavengers: 2 },
  trainingQueue: [],
  training: startingTraining('2026-08-16T00:00:00.000Z'),
  inventory: {},
  fittedUpgrades: [],
  unitLoadouts: {},
  fleet: {},
  commanders: [],
  createdAt: NOW,
};

const user: User = {
  id: 'user-1',
  username: 'operator',
  overseerId: overseer.id,
  createdAt: NOW,
  // The house defaults, spelled out. A fixture that leaned on the schema's own defaults would stop
  // exercising the settings screen the day one of them changed.
  displayName: null,
  icon: 'shield',
  timezone: GAME_TIMEZONE,
};
const userNoOverseer: User = { ...user, overseerId: null };

export const me: MeResponse = {
  admin: false,
  user,
  overseer,
  base,
};
export const meNoOverseer: MeResponse = {
  admin: false,
  user: userNoOverseer,
  overseer: null,
  base: null,
};

/**
 * A save that has actually been played: six-figure stockpiles and both meters pegged. HUD chips
 * are sized by the digits in them, so this, not `base`, is the widest the economy row ever
 * gets, and it is what the layout has to survive at the narrowest supported viewport.
 */
export const lateGameBase: Base = {
  ...base,
  level: 12,
  resources: {
    caps: 125000,
    supplies: 48000,
    oil: 32000,
    scrap: 96000,
    highQualityMetal: 12000,
    planks: 96000,
  },
  economy: { ...base.economy, infamy: 100 },
  // One XP short of level 13 (§I). Widest the progression readout ever gets: four digits either
  // side of the slash and a bar at ~100%: where the starting base shows `0 / 100`.
  progression: { xpIntoLevel: 7799 },
  // Something on both clocks, because the in-flight rail is drawn on *every* screen from this
  // payload: a fixture with empty queues screenshots the whole shell without the one piece of
  // chrome that is meant to be always there.
  buildQueue: [
    {
      id: 'bq-1',
      kind: 'quarters',
      level: 4,
      startedAt: new Date(Date.parse(NOW) - 5 * 60 * 1000).toISOString(),
      durationSeconds: 20 * 60,
    },
  ],
  trainingQueue: [
    {
      id: 'tq-1',
      unitId: 'razors',
      count: 6,
      delivered: 0,
      paid: trainingCost(findUnit('razors')!, 6),
      startedAt: new Date(Date.parse(NOW) - 30 * 1000).toISOString(),
      durationSeconds: 270,
    },
  ],
};

export const lateGame: MeResponse = {
  admin: false,
  user,
  overseer,
  base: lateGameBase,
};

/**
 * §D7: a crew with a name and the points to buy the next one.
 *
 * `lateGame` deliberately has 100 infamy against a 300 first rung, which is the "short of it"
 * state. This is the other one, and both are worth a screenshot: the ladder's card reads completely
 * differently depending on whether the button is live.
 */
export const notoriousBase: Base = {
  ...lateGameBase,
  economy: { ...lateGameBase.economy, infamy: 40_000, notoriety: 4 },
};

export const notorious: MeResponse = { ...lateGame, base: notoriousBase };

/**
 * The same save on a build that *has* a bench.
 *
 * Separate from `lateGame` rather than a flag on it, because whether the bench exists is now a
 * fact `/me` reports and almost every other spec wants the answer to be no: a Bench door on the
 * screenshot matrix would put a fourteenth door in every layout sweep for a screen that does not
 * ship.
 */
export const adminGame: MeResponse = { ...lateGame, admin: true };

/**
 * §A4: the map as one crew sees it.
 *
 * Two districts are deliberately left **unscouted**, because the fog is the thing most worth
 * having a fixture for: a screen that renders `held: null` as "0 / 0" is a screen that tells a
 * player something they have not earned, and it only shows up when something is actually unseen.
 */
/** Named rather than positional, so reordering the map cannot silently reveal the fog case. */
const UNSCOUTED = new Set(['chrome-row', 'glasshouse-fields']);

/*
 * The city, with somebody living on two of the four plots.
 *
 * The crew is on `STARTER_DISTRICT_ID` and the seeded rival on `BOT_DISTRICT_ID`, read off the
 * constants rather than typed: the Docks were home until they were opened up as contested ground,
 * and a fixture that still housed a crew there would be exercising a state migration `0040` exists
 * to remove. The two occupied plots are also what makes the map's naming testable, since a
 * residential tag prints the crew's name and an empty one prints `Player District`.
 */
export const city: CityResponse = {
  homeDistrictId: STARTER_DISTRICT_ID,
  serverNow: NOW,
  districts: CITY_DISTRICTS.map((district, index) => {
    const scouted = !UNSCOUTED.has(district.id);
    const isHome = district.id === STARTER_DISTRICT_ID;
    return {
      district,
      scouted: scouted || isHome,
      travelMinutes: 8 + index * 7,
      holder: null,
      held:
        scouted && district.kind === 'contested'
          ? { mine: index === 3 ? 1 : 0, total: district.locations.length }
          : null,
      base:
        district.id === STARTER_DISTRICT_ID
          ? {
              id: base.id,
              ownerId: user.id,
              name: base.name,
              districtId: STARTER_DISTRICT_ID,
              level: 1,
              isBot: false,
            }
          : district.id === BOT_DISTRICT_ID
            ? {
                id: 'base-vex',
                ownerId: 'user-vex',
                name: 'Vex Holdings',
                districtId: BOT_DISTRICT_ID,
                level: 4,
                isBot: true,
              }
            : null,
      isHome,
    };
  }),
};

export const baseDetail: BaseDetailResponse = { base };

const rewards = { scrap: 120, caps: 60 };

/**
 * §A4: one contested district, scouted, with one location already taken.
 *
 * The Rustyard because it is where a new crew actually goes: easy ground, looters holding it, and
 * a war machine graveyard at the back worth a campaign.
 */
const rustyard = findDistrict('rustyard');
if (!rustyard) throw new Error('fixture error: the Rustyard is missing from the city map');

export const districtDetail: DistrictDetailResponse = {
  district: rustyard,
  scouted: true,
  travelMinutes: 24,
  // Contested ground, so nobody lives here and there is nothing standing to look at.
  residentBuildings: [],
  holder: null,
  unified: { title: 'Run of the Scrapfields', effect: '-10% training cost' },
  base: null,
  raidable: false,
  serverNow: NOW,
  locations: rustyard.locations.map((location, index) => {
    const spec = LOCATION_CATALOG[location.kind];
    const mine = index === 0;
    // §A4: the one location this crew holds is part-worked, so the screen has a level to draw,
    // an upgrade to offer, and pips that are not all the same. The rest sit at 1 like any capture.
    const level = mine ? 2 : 1;
    const cost = upgradeCost(location.kind, level);
    const note = upgradeNote(location.kind, level);
    return {
      location,
      holder: mine ? { kind: 'crew' as const, baseId: base.id } : { kind: 'looters' as const },
      holderName: mine ? base.name : 'Looters',
      level,
      upgradingUntil: null,
      upgrade: cost && note ? { toLevel: level + 1, cost, note, seconds: 1800 } : null,
      fortification: mine ? 2 : 0,
      fortifyingUntil: null,
      defense: spec.baseDefense + index,
      garrisonSize: mine ? 3 : index * 2,
      garrison: mine ? { razors: 3 } : null,
      bonuses: bonusesAt(location.kind, level).map(describeHoldBonus),
      reward: spec.reward,
      // The same fold the server does: the ground's own character plus today's sky. `NOW` is a
      // fixed instant, so the fixture's labels are stable and a screenshot of them is comparable.
      labels: mergeLabels(spec.labels, weatherLabels(weatherAt(new Date(NOW)))),
      unlocks: unitsUnlockedByLocation(location.kind).map((unit) => unit.name),
    };
  }),
};

/**
 * The same district screen, for whichever district was asked for.
 *
 * The route used to answer with the Rustyard whatever the id was, which was fine while the only
 * way to a district was a two-step walk through the city map's intel panel: every test that cared
 * about a *particular* district read it off the panel, and the panel came from the city payload.
 * The panel went with the map, so those facts are read on the district's own screen now, and a
 * fixture that hands back the wrong district makes that untestable. This keeps the Rustyard's
 * worked-over shape and swaps in the district that was actually asked for.
 */
export function districtDetailFor(id: string): DistrictDetailResponse {
  const district = CITY_DISTRICTS.find((entry) => entry.id === id);
  if (!district || district.id === districtDetail.district.id) return districtDetail;
  return {
    ...districtDetail,
    district,
    // The Rustyard's own run bonus does not belong to anywhere else.
    unified: null,
    locations: [],
  };
}

/** §A5: the roster as a crew four levels in sees it: some fielded, most still locked. */
/** The two the crew has paid for. One of them is bolted to the Razors below. */
const BUILT_UPGRADES = UNIT_UPGRADES.filter(
  (spec) => spec.id === 'weapons_1' || spec.id === 'armour_1',
);

function fittedSlots(ids: (string | null)[]): FittedSlot[] {
  return ids.map((id) => {
    const spec = id === null ? undefined : UNIT_UPGRADES.find((other) => other.id === id);
    if (!spec) return { upgradeId: null, name: '', line: null, tier: 0, effect: {} };
    return {
      upgradeId: spec.id,
      name: spec.name,
      line: spec.line,
      tier: spec.tier,
      effect: spec.effect as Record<string, number>,
    };
  });
}

export const unitsResponse: UnitsResponse = {
  serverNow: NOW,
  army: base.army,
  garrisoned: { razors: 2 },
  // §A4: away at a fight, and drawing on the same beds as the two on held ground. Non-empty on
  // purpose: the card prints a third count for these, and a fixture with none of them would
  // screenshot a card that cannot show the thing it grew a column for.
  abroad: { razors: 3 },
  // Derived rather than typed, so the fixture cannot quietly become a crew that is over its own
  // cap, which is a real state, but a misleading one to make the default screenshot of.
  supplyUsed: supplyUsed(base.army) + supplyUsed({ razors: 2 }) + supplyUsed({ razors: 3 }),
  supplyCap:
    districtPopulationCapacity(base.buildings, noTerritoryEffects()) -
    populationDraw({ ...base, army: {}, trainingQueue: [] }).total,
  // Two orders on the bench, one part-way through and one behind it. An empty queue screenshots
  // the empty state and nothing else, and the live bench is the half of this screen with a clock
  // on it: the half most likely to lay out badly once a countdown reaches its widest.
  queue: [
    {
      id: 'order-1',
      unitId: 'razors',
      count: 6,
      delivered: 0,
      // Recorded, because the bench's Cancel is only offered on an order whose price is known.
      // 30 seconds into a 270-second batch is past the tenth, so this one is *not* cancellable:
      // the screenshot state worth pinning is the ordinary one.
      paid: trainingCost(findUnit('razors')!, 6),
      startedAt: new Date(Date.parse(NOW) - 30 * 1000).toISOString(),
      durationSeconds: 270,
    },
    {
      id: 'order-2',
      unitId: 'sparks',
      count: 3,
      delivered: 0,
      paid: trainingCost(findUnit('sparks')!, 3),
      startedAt: new Date(Date.parse(NOW) + 240 * 1000).toISOString(),
      durationSeconds: 150,
    },
  ],
  resources: base.resources,
  trainingCostReduction: 10,
  trainingSpeedBonus: 0,
  // A stock with something in it, and a bracket that is filled. An empty stock screenshots three
  // dashed brackets and a menu with nothing in it, which is the one state the row is *not* for.
  built: BUILT_UPGRADES.map((spec) => ({
    id: spec.id,
    name: spec.name,
    line: spec.line,
    tier: spec.tier,
    description: spec.description,
    effect: spec.effect as Record<string, number>,
  })),
  units: UNIT_CATALOG.map((unit) => {
    const unlocked = unit.tier === 'rabble';
    return {
      id: unit.id,
      name: unit.name,
      tier: unit.tier,
      blurb: unit.blurb,
      trainedAt: unit.trainedAt,
      unique: unit.unique,
      stats: unit.stats,
      modifiers: unit.modifiers.map((id) => ({
        label: UNIT_MODIFIERS[id].label,
        description: UNIT_MODIFIERS[id].description,
        when: COMBAT_CONTEXT_LABELS[UNIT_MODIFIERS[id].context],
      })),
      rules: unitRules(unit),
      // §A4: the same fold the server does: only the labels the sheet does not already say.
      affinities: ENV_LABEL_IDS.flatMap((id) => {
        const immune = unit.immuneTo?.includes(id) ?? false;
        const per = unit.affinities?.[id] ?? 0;
        if (!immune && per === 0) return [];
        return [
          {
            id,
            label: ENV_LABEL_CATALOG[id].name,
            note: immune && per === 0 ? 'Immune' : `${per > 0 ? '+' : ''}${per}% per tier`,
            good: immune || per > 0,
          },
        ];
      }),
      cost: unit.cost,
      trainSeconds: unit.trainSeconds,
      supply: unit.supply,
      unlocked,
      missing: unlocked ? [] : unit.requires.map(describeRequirement),
      owned: base.army[unit.id] ?? 0,
      // The Razors have one bolted on and room for two more, which is both halves of the row in
      // one card. Everybody else is empty, which is what most of the roster looks like.
      slots: fittedSlots(unit.id === 'razors' ? ['weapons_1', null, null] : [null, null, null]),
    };
  }),
};

export const battle: BattleResponse = {
  result: {
    winner: 'attacker',
    log: [
      'Strike team slips the cordon under a dead satellite window.',
      'Netrunners spoof the sentry grid; drones circle blind for 41 seconds.',
      'Breach charges crack the ferrocrete line: defenders scatter into the undergrid.',
      'Salvage crews strip the site before corporate response arrives. Victory.',
    ],
    rewards,
  },
  resources: addResources(STARTING_RESOURCES, rewards),
};

export const createOverseerResponse: CreateOverseerResponse = { user, overseer, base };
export const authResponse: AuthResponse = { token: TOKEN, user };

/**
 * The Bar at its widest (GDD §H).
 *
 * Deliberately the fat case, per MOU-207: the starting state of this screen is an empty crew and
 * eight identical-looking cards, and that has never caught a layout bug. This is a late-game crew:
 * the longest officer names the generator can produce, a four-digit wage, every §H5 band
 * including the walkout warning and the skill-bonus line, and recruits covering all three card
 * states (interested, gated, already hired).
 */
function barRecruit(id: string, name: string, overrides: Partial<BarRecruit> = {}): BarRecruit {
  return {
    id,
    name,
    attributes: makeAttributes(18, { stealth: 34, logic: 31, hacking: 29, medicine: 9 }),
    perks: ['skim_route', 'quiet_boots'],
    requirement: { minNotoriety: 0, minLevel: 1 },
    assessment: { meetsNotoriety: true, meetsLevel: true, interested: true, blockers: [] },
    askingWage: 48,
    hired: false,
    standoff: null,
    ...overrides,
  };
}

function barOfficer(
  id: string,
  name: string,
  role: BarOfficer['commander']['role'],
  weeklyWage: number,
  overrides: Partial<BarOfficer['commander']> = {},
): BarOfficer {
  const commander: Commander = {
    ...createCommander(
      id,
      name,
      role,
      { stealth: 41, logic: 37, hacking: 33 },
      ['skim_route'],
      weeklyWage,
    ),
    ...overrides,
  };
  return { commander, weeklyWage, dismissalFee: weeklyWage * DISMISSAL_WEEKS };
}

export const bar: BarResponse = {
  day: '2026-08-12',
  serverNow: NOW,
  recruits: [
    barRecruit('bar-1', 'Dorotea "The Undergrid Ghost"'),
    barRecruit('bar-2', 'Emeric Voskuijlen', { askingWage: 1240, perks: [] }),
    barRecruit('bar-3', 'Kestrel Salvatierra', {
      requirement: { minNotoriety: 3, minLevel: 1 },
      assessment: {
        meetsNotoriety: false,
        meetsLevel: true,
        interested: false,
        blockers: ['notoriety'],
      },
      askingWage: null,
    }),
    barRecruit('bar-4', 'Rashid Okonkwo', {
      assessment: {
        meetsNotoriety: false,
        meetsLevel: false,
        interested: false,
        blockers: ['notoriety', 'level'],
      },
      askingWage: null,
      requirement: { minNotoriety: 5, minLevel: 24 },
    }),
    // Somebody this crew walked out on: the chair is cold for another few hours, and their price
    // has already gone up for it.
    barRecruit('bar-8', 'Wren Adisa', {
      askingWage: null,
      standoff: {
        until: new Date(Date.parse(NOW) + 4 * 60 * 60 * 1000).toISOString(),
        walkouts: 1,
      },
    }),
    barRecruit('bar-5', 'Ilse Abara', { hired: true, askingWage: 96 }),
    barRecruit('bar-6', 'Juno Petrosyan', { askingWage: 61, perks: ['haggler'] }),
    // §B7: a flaw on the card, so the layout guards cover the state a player must be able to read.
    barRecruit('bar-7', 'Casimir Adeyemi-Lindqvist', { askingWage: 74, perks: ['haggler'] }),
  ],
  officers: [
    barOfficer('off-1', 'The Ghost of Sector Nine', 'head_spy', 1240, {
      perks: ['wire_tap', 'street_ears', 'counter_signals'],
    }),
    barOfficer('off-2', 'Odile Marchetti', 'finance_officer', 340),
    barOfficer('off-3', 'Bruno Lindqvist', 'raid_boss', 88, { perks: [] }),
  ],
  slotsUsed: 3,
  slotsTotal: 13,
  infamy: 100,
  notoriety: 5,
  level: 12,
  caps: 125000,
  payroll: {
    capacity: 2400,
    committed: 1668,
    available: 732,
    purchasedSteps: 6,
    nextStepCost: payrollStepCost(6),
    stepSize: PAYROLL_STEP,
  },
  filledRoles: ['head_spy', 'finance_officer', 'raid_boss'],
  /** §H2b: this crew has not signed anybody today, so the offer buttons are live. */
  hiresLeftToday: BAR_HIRES_PER_DAY,
  /**
   * §H7: one conversation already under way, so the screenshot carries both states: a card that
   * has been talked to and cards that have not. Mid-negotiation rather than closed, because the
   * open state is the one with the window, the standing demand and the reply on it.
   */
  negotiations: {
    'bar-2': {
      rounds: 2,
      patience: 3,
      standing: 1120,
      lastOffer: 900,
      mood: 'considering',
      closed: false,
    },
  },
};

/**
 * The three boards a screenshot needs: the one that is always open, one district and one being
 * worked by a crew already.
 *
 * Priced off the real offer walk rather than hand-written, so a retune of which jobs an area
 * offers cannot leave the fixture claiming something the server never says.
 */
function areaFixture(id: string, name: string, payPercent: number, activeMissionId: string | null) {
  return {
    id,
    name,
    blurb:
      id === MISC_AREA_ID
        ? 'Work that belongs to nobody. Somebody always needs a wall stripped or a bay emptied.'
        : (findDistrict(id)?.blurb ?? 'Ground somebody is paying to have worked.'),
    difficulty: findDistrict(id)?.difficulty ?? 1,
    payPercent,
    offers:
      activeMissionId === null
        ? missionOffers(id).map((template) => ({
            templateId: template.id,
            name: template.name,
            brief: template.brief,
            kind: template.kind,
            difficulty: template.difficulty,
            stance: template.stance,
            travelMinutes: templateTimings(template).travelMinutes,
            durationMinutes: template.durationMinutes,
            totalMinutes: templateTimings(template).totalMinutes,
            rewards: scaledSpoils(missionRewards(template, 'success'), payPercent),
            payoutSlots: Math.round(
              payoutSlots(
                scaledSpoils(missionRewards(template, 'success'), payPercent),
                RESOURCE_KG,
              ),
            ),
            xp: missionXp(template, templateTimings(template).totalMinutes, lateGameBase.level),
            failedXp: Math.round(
              missionXp(template, templateTimings(template).totalMinutes, lateGameBase.level) *
                FAILED_MISSION_XP_SHARE,
            ),
          }))
        : [],
    activeMissionId,
  };
}

const MISSION_AREAS = [
  areaFixture(MISC_AREA_ID, 'Miscellaneous Missions', 0, null),
  areaFixture('neon-docks', 'The Neon Docks', areaPayPercent('neon-docks'), null),
  areaFixture('rustyard', 'The Rustyard', areaPayPercent('rustyard'), 'm-1'),
];

const minutesBefore = (now: Date, minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

/** A crew sent out at `startedAt`, timed from its own template the way the server freezes it. */
function launchedMission(id: string, templateId: string, startedAt: string): Mission {
  const template = findMissionTemplate(templateId);
  if (!template) throw new Error(`unknown mission template: ${templateId}`);
  const { travelMinutes, durationMinutes } = templateTimings(template);
  return {
    id,
    baseId: base.id,
    templateId,
    // The board these came off, and who went. Every fixture crew is sent from the miscellaneous
    // board so the screenshots do not depend on which districts happen to be scouted.
    areaId: MISC_AREA_ID,
    payPercent: 0,
    xp: 240,
    force: { razors: 3, scavengers: 4 },
    startedAt,
    travelMinutes,
    durationMinutes,
    status: 'active',
    // §G6: these fixtures send delegations, not officer-led runs.
    officerId: null,
    outcome: null,
    rewards: {},
    resolvedAt: null,
    recalledAt: null,
  };
}

/** The same crew after the server banked it. */
function resolvedMission(
  mission: Mission,
  outcome: MissionOutcome,
  rewards: PartialResources,
  resolvedAt: string,
): Mission {
  return { ...mission, status: 'resolved', outcome, rewards, resolvedAt };
}

/**
 * The missions page at its widest (GDD §E3).
 *
 * Deliberately the fat case, not the starting one: every crew slot filled, the longest mission on
 * the board only just launched, so its countdown reads `25:5x:xx`, the widest string the timer
 * column can ever hold, and a returned mission paying all five resources at once, which is the
 * longest reward line that can render. The starting state of this page is an empty list, and an
 * empty list has never caught a layout bug.
 *
 * Built against a live `now` because the countdowns are relative; the widths do not depend on
 * which second the screenshot lands on.
 */
export function missionsResponse(now: Date = new Date()): MissionsResponse {
  const inFlight = (id: string, templateId: string, startedMinutesAgo: number): Mission =>
    launchedMission(id, templateId, minutesBefore(now, startedMinutesAgo));

  const returned = (
    id: string,
    templateId: string,
    outcome: MissionOutcome,
    rewards: PartialResources,
  ): Mission =>
    resolvedMission(inFlight(id, templateId, 5_000), outcome, rewards, minutesBefore(now, 60));

  return {
    missions: [
      /*
       * One crew out, of the two a base may have (§E).
       *
       * Deliberately not at the cap. At the cap every button on the board reads `No crew free`,
       * which is a real state and the wrong one to make the default screenshot of: the board's own
       * layout is what these fixtures are for, and a board of three disabled buttons proves
       * nothing about it. One minute into a day-long run, so the page still shows the longest
       * countdown it ever can.
       */
      inFlight('m-1', 'deep-expedition', 1),
      returned('m-5', 'deep-expedition', 'success', {
        caps: 268,
        supplies: 268,
        oil: 201,
        scrap: 335,
        highQualityMetal: 40,
        planks: 335,
      }),
      returned('m-6', 'foundry-raid', 'failure', {}),
      returned('m-7', 'convoy-ambush', 'success', { caps: 52, oil: 35 }),
    ],
    justResolved: [],
    resources: lateGameBase.resources,
    activeLimit: BASE_CONCURRENT_MISSIONS,
    areas: MISSION_AREAS,
    army: lateGameBase.army,
    serverNow: now.toISOString(),
  };
}

/**
 * What `POST /missions` answers with: a different shape from the board (§G6 launch path).
 *
 * `LaunchMissionResponseSchema` is `{ mission, serverNow }`, not a board, so this cannot be served
 * by the `GET` fixture: the client validates every 2xx body and would reject it. A launch of the
 * cheapest easy template, which is the one a delegation can actually run.
 */
export function launchResponse(now: Date = new Date()): LaunchMissionResponse {
  return {
    mission: launchedMission('m-new', 'scrap-run', now.toISOString()),
    serverNow: now.toISOString(),
  };
}

/** What the crew that lands mid-session brings home (§E5). Distinct digits, so the HUD is unambiguous. */
export const SETTLED_REWARD: PartialResources = { caps: 268, scrap: 335 };

/** The base after that payout is banked: `caps 768`, `scrap 535`. */
export const paidBase: Base = {
  ...base,
  resources: addResources(STARTING_RESOURCES, SETTLED_REWARD),
};

export const paidMe: MeResponse = {
  admin: false,
  user,
  overseer,
  base: paidBase,
};

/**
 * The state change `missionsResponse` cannot express: one crew still out on the first read, home
 * and paid on the next.
 *
 * Every mission in that fixture is *born* either active or already resolved, so the settle path:
 * the one moment the whole feature turns on: was never exercised in a browser, and a payout that
 * never reached the HUD passed every gate. The day-long expedition here launched a day before the
 * short run that is already home, so its return also has to survive a list ordered by launch.
 */
export function settlingMissions(now: Date = new Date()): {
  pending: MissionsResponse;
  settled: MissionsResponse;
} {
  const expedition = launchedMission('m-away', 'deep-expedition', minutesBefore(now, 26 * 60));
  // Launched a day after the expedition and already back: it sorts above by launch time.
  const shortRun = resolvedMission(
    launchedMission('m-home', 'scrap-run', minutesBefore(now, 60)),
    'success',
    { scrap: 40, caps: 5 },
    minutesBefore(now, 47),
  );

  const board = (missions: Mission[], justResolved: Mission[], resources: Resources) => ({
    missions,
    justResolved,
    resources,
    activeLimit: BASE_CONCURRENT_MISSIONS,
    areas: MISSION_AREAS,
    army: base.army,
    serverNow: now.toISOString(),
  });

  const home = resolvedMission(expedition, 'success', SETTLED_REWARD, now.toISOString());
  return {
    pending: board([shortRun, expedition], [], STARTING_RESOURCES),
    settled: board([shortRun, home], [home], paidBase.resources),
  };
}

/**
 * Research at its widest (GDD §B9).
 *
 * The fat case, per the standard `bar` and `missionsResponse` set. Fatness here is specific: the
 * longest role labels in §C1 (`Instructor of the Young`) against the longest attribute names in
 * §B (`communication`, `cryptography`, `intimidation`), every listed role already at
 * `MAX_ROLE_FACTS` so the `3 / 3 leads` counter is at its widest, the pairing cap filled so that
 * list wraps as far as it ever will, and a six-figure cap balance in the header.
 *
 * The facts below are chosen for *string width*, not for accuracy against the server's hidden
 * requirement table: a fixture has no business encoding that, and this file is inside the W1 leak
 * guard's scan (§B8a).
 */
const WIDE_ATTRIBUTES = [
  'communication',
  'cryptography',
  'intimidation',
  'fabrication',
  'cybernetics',
  'intuition',
  'negotiation',
  'demolition',
  'navigation',
  'engineering',
  'diplomacy',
  'strategy',
] as const;

const WIDE_ROLES = [
  'instructor_of_the_young',
  'head_of_research',
  'finance_officer',
  'security_officer',
  'field_commander',
] as const satisfies readonly OfficerRole[];

const wideFacts: DiscoveredFact[] = [
  ...WIDE_ROLES.flatMap((role, roleIndex) =>
    Array.from({ length: MAX_ROLE_FACTS }, (_unused, factIndex) => ({
      kind: 'role_attribute' as const,
      role,
      attribute:
        WIDE_ATTRIBUTES[(roleIndex * MAX_ROLE_FACTS + factIndex) % WIDE_ATTRIBUTES.length]!,
    })),
  ),
  ...Array.from({ length: MAX_PAIRINGS - 1 }, (_unused, index) =>
    makePairing(
      WIDE_ATTRIBUTES[index % WIDE_ATTRIBUTES.length]!,
      WIDE_ATTRIBUTES[(index + 5) % WIDE_ATTRIBUTES.length]!,
    ),
  ),
];

/** Two leads, one of them imaginative enough to unlock §F4, with the longest names available. */
const wideLeads: ResearchLead[] = [
  {
    officerId: 'off-prof',
    name: 'Professor Aurelio Xanthopoulos-Reyes',
    role: 'professor',
    crossReference: true,
  },
  {
    officerId: 'off-hor',
    name: 'Wenqing "Compass" Adebayo-Lindqvist',
    role: 'head_of_research',
    crossReference: false,
  },
];

const researchBase = {
  serverNow: NOW,
  justDiscovered: [] as DiscoveredFact[],
  facts: wideFacts,
  leads: wideLeads,
  openRoles: OFFICER_ROLES.filter((role) => !roleFullyResearched(wideFacts, role)),
  pairingsExhausted: false,
  overseerAttributes: overseer.attributes,
  caps: 125000,
  costs: RESEARCH_COST_CAPS,
  // §A1: a crew with no Lead Engineer, so every modification reports the same blocker. The
  // structures themselves are unbuilt in this fixture, which is the blocker the player sees first.
  canModify: false,
  // The Lab's tree: one rung finished per track, one reachable, one locked, so a screenshot shows
  // all three states rather than a grid of identical cards.
  technologies: TECHNOLOGIES.map((spec) => ({
    id: spec.id,
    track: spec.track,
    tier: spec.tier,
    name: spec.name,
    description: spec.description,
    cost: spec.cost,
    parts: spec.parts,
    // The same words the route sends. This printed the raw channel key for a while, so every
    // screenshot of the Lab certified `+8% PRODUCTIONPERCENT`: the fixture *is* the contract.
    effect: describeTechEffect(spec),
    known: spec.tier === 1,
    blocker: spec.tier === 3 ? `Needs the Lab at level ${spec.requiresLabLevel}` : null,
  })),
  modifications: MODIFICATIONS.map((mod) => ({
    id: mod.id,
    building: mod.building,
    name: mod.name,
    description: mod.description,
    effect: mod.effect,
    magnitude: mod.magnitude,
    installed: false,
    blocker: 'not_built' as const,
  })),
};

/** Nothing running: the start forms, both of them, over a crew that already knows a lot. */
export const research: ResearchResponse = {
  ...researchBase,
  active: null,
  completesAt: null,
};

/** A project in flight, with §F4's cross-reference on, built live so the countdown is real. */
export function activeResearch(now: Date = new Date()): ResearchResponse {
  const active = {
    id: 'r-active',
    project: {
      kind: 'investigation' as const,
      role: 'instructor_of_the_young' as const,
      leadOfficerId: 'off-prof',
      crossReference: true,
    },
    // One minute in, so the countdown reads at its widest for this duration.
    startedAt: new Date(now.getTime() - 60_000).toISOString(),
    durationMinutes: RESEARCH_MINUTES.investigation,
  };
  return { ...researchBase, active, completesAt: researchCompletesAt(active).toISOString() };
}

/**
 * The state change neither fixture above can express: a project still running on the first read,
 * landed and reporting its facts on the next.
 *
 * Every other research fixture is *born* either active or already idle, so the settle path: the
 * one moment the whole feature turns on: would never be exercised in a browser, and facts that
 * never reached the page would pass every assertion in the suite. This is the §E-settlement lesson
 * applied to §B9.
 */
export function settlingResearch(now: Date = new Date()): {
  pending: ResearchResponse;
  settled: ResearchResponse;
} {
  const pending = activeResearch(now);
  const discovered: DiscoveredFact[] = [
    { kind: 'role_attribute', role: 'raid_boss', attribute: 'intimidation' },
    { kind: 'role_attribute', role: 'raid_boss', attribute: 'demolition' },
    makePairing('intimidation', 'demolition'),
  ];
  return {
    pending,
    settled: {
      ...researchBase,
      active: null,
      completesAt: null,
      justDiscovered: discovered,
      facts: [...wideFacts, ...discovered],
      openRoles: researchBase.openRoles.filter((role) => role !== 'raid_boss'),
    },
  };
}

/**
 * One officer on the crew screen.
 *
 * A real sheet rather than a flat one: the window draws the whole thing, so a fixture of identical
 * numbers would screenshot a page with no shape in it.
 */
function crewOfficer(
  officerId: string,
  name: string,
  role: CrewOfficer['role'],
  perks: readonly string[],
  weeklyWage: number,
): CrewOfficer {
  return {
    officerId,
    name,
    role,
    attributes: makeAttributes(15, { leadership: 32, composure: 27, empathy: 24, hacking: 8 }),
    perks: [...perks],
    weeklyWage,
  };
}

/**
 * Nought, one and three perks, cycled across the roster.
 *
 * The footer under the picture is a fixed height so a chair with three keywords lines up with one
 * that has none, and a fixture where everybody carried exactly one would screenshot the single
 * case that cannot fail. Three is the ceiling (`MAX_OFFICER_PERKS`) and the row that has to wrap.
 */
const PERK_SPREAD: readonly (readonly string[])[] = [
  ['wire_tap', 'street_ears', 'counter_signals'],
  ['haggler'],
  [],
];

function crewAt(
  level: number,
  hired: readonly [string, string, CrewOfficer['role']][],
): CrewResponse {
  const officers = hired.map(([id, name, role], index) =>
    crewOfficer(id, name, role, PERK_SPREAD[index % PERK_SPREAD.length] ?? [], 40 + index * 37),
  );
  return {
    level,
    housing: {
      used: officers.length,
      capacity: districtPopulationCapacity(base.buildings, noTerritoryEffects()),
    },
    officers,
  };
}

/** A level-1 crew: nobody hired. The empty state, which is nineteen vacant chairs. */
export const crewStart: CrewResponse = crewAt(1, []);

/**
 * The widest this screen ever gets, and the state every layout guard has to survive.
 *
 * The longest officer name and the longest role label on the board, which is what actually
 * threatens the column, plus enough hires that the grid wraps.
 */
export const crewFat: CrewResponse = crewAt(48, [
  ['off-1', 'The Ghost of Sector Nine', 'instructor_of_the_young'],
  ['off-2', 'Wilhelmina Okonkwo-Restrepo', 'head_of_research'],
  ['off-3', 'Vela', 'professor'],
]);

/**
 * §F2: the Training tab with one hour already running and one officer idle.
 *
 * Both states on one screen on purpose: the in-flight panel and the "free this hour" panel are
 * different shapes, and a fixture showing only one of them screenshots half the page.
 */
export const trainingResponse: TrainingResponse = {
  serverNow: NOW,
  sessionsLeft: 3,
  perDay: TRAININGS_PER_DAY,
  gainPerSession: TRAINING_GAIN,
  sessionSeconds: TRAINING_SECONDS,
  subjects: [
    {
      id: OVERSEER_SUBJECT,
      name: overseer.name,
      role: 'Overseer',
      officerRole: null,
      portraitId: overseer.portraitId,
      attributes: overseer.attributes,
      perks: overseer.perks,
      session: {
        id: 'drill-1',
        subjectId: OVERSEER_SUBJECT,
        attribute: 'cryptography',
        // Started 20 minutes ago, so the bar is a third full rather than empty or done.
        startedAt: new Date(Date.parse(NOW) - 20 * 60 * 1000).toISOString(),
        durationSeconds: TRAINING_SECONDS,
      },
      lastAttribute: 'stamina',
    },
    {
      id: 'officer-1',
      name: 'Ada Vasquez',
      role: 'Professor',
      officerRole: 'professor',
      // Off the pool, the way the server derives it: `officerPortraitId('officer-1')`.
      portraitId: officerPortraitId('officer-1'),
      // A specialist, not a flat sheet: the profile's whole point is that one officer's good
      // number becomes the crew's, and a fixture at the recruitment mean shows none of that.
      attributes: makeAttributes(14, { intuition: 46, analysis: 38, diplomacy: 33, logic: 30 }),
      perks: ['war_college'],
      session: null,
      lastAttribute: 'intuition',
    },
  ],
};

/**
 * Best-of across the Overseer and the one officer above: the sheet the effects come from.
 *
 * The Professor's duties are spelled out here rather than looked up: which attributes a seat puts
 * to work is a server-side table (§B8a) and deliberately unreachable from the client, so a fixture
 * that needs a seated officer states the seat's duties itself.
 */
const PROFESSOR_CREW = crewSheet([
  { attributes: overseer.attributes, role: null, perks: [] },
  {
    attributes: makeAttributes(14, { intuition: 46, analysis: 38, diplomacy: 33, logic: 30 }),
    role: 'professor',
    perks: [],
  },
]);

/** The Overseer's own file: their sheet, the crew's best-of, and what it is all buying. */
export const crewStanding: CrewStandingResponse = {
  overseer,
  crewSheet: PROFESSOR_CREW,
  effects: Object.fromEntries(
    EFFECT_CHANNELS.map((channel) => [channel, effectsOfSheet(PROFESSOR_CREW)[channel]]),
  ),
};

/**
 * The market, with the Runner in and the board busy.
 *
 * Deliberately the *open* state: the closed one is a single line of copy and an empty barrow, and
 * a screenshot of it says nothing about whether the stock rows lay out. The hours are pinned rather
 * than derived so the fixture reads the same on every run.
 */
export const market: MarketResponse = {
  serverNow: NOW,
  caps: lateGameBase.resources.caps,
  resources: lateGameBase.resources,
  inventory: { scrap_servo: 6, ceramic_plate: 2, blueprint_cybernetics: 1, ivory_dice: 1 },
  vendor: {
    open: true,
    sessions: [
      { startHour: 7, hours: 2 },
      { startHour: 19, hours: 2 },
    ],
    closesAt: new Date(Date.parse(NOW) + 42 * 60 * 1000).toISOString(),
    opensAt: new Date(Date.parse(NOW) + 9 * 3600 * 1000).toISOString(),
    stock: [
      { line: { id: 'l1', item: 'neural_shunt', stock: 2, price: 1180 }, affordable: true },
      { line: { id: 'l2', item: 'blueprint_rotorcraft', stock: 1, price: 4600 }, affordable: true },
      { line: { id: 'l3', item: 'gyro_assembly', stock: 4, price: 410 }, affordable: true },
      { line: { id: 'l4', item: 'ceramic_plate', stock: 0, price: 360 }, affordable: false },
    ],
  },
  offers: [
    {
      id: 'offer-1',
      sellerBaseId: 'base-9',
      sellerName: 'The Kettle Row Combine',
      give: { resources: { oil: 4000 }, items: {} },
      want: { resources: { highQualityMetal: 400 }, items: {} },
      status: 'open',
      createdAt: new Date(Date.parse(NOW) - 3 * 3600 * 1000).toISOString(),
      counterTo: null,
      directedAt: null,
    },
    {
      id: 'offer-2',
      sellerBaseId: 'base-4',
      sellerName: 'Sisters of the Undergrid',
      give: { resources: {}, items: { rotor_hub: 1 } },
      want: { resources: { caps: 3000, scrap: 5000 }, items: {} },
      status: 'open',
      createdAt: new Date(Date.parse(NOW) - 20 * 60 * 1000).toISOString(),
      counterTo: null,
      directedAt: null,
    },
  ],
  mine: [
    {
      id: 'offer-mine',
      sellerBaseId: 'base-1',
      sellerName: 'The Ninth Street Crew',
      give: { resources: { scrap: 2000 }, items: {} },
      want: { resources: {}, items: { optic_cluster: 2 } },
      status: 'open',
      createdAt: new Date(Date.parse(NOW) - 90 * 60 * 1000).toISOString(),
      counterTo: null,
      directedAt: null,
    },
  ],
  /**
   * The supply run, part-spent. A ration with nothing taken out of it draws the same bar as a
   * ration that does not exist, so the fixture spends some of it. That is the state where the
   * remaining-allowance figure and the per-line ceilings are actually doing something.
   */
  supply: (() => {
    const capacity = storageCapacity(lateGameBase.buildings);
    // A third of the day's ration already spent. Derived rather than a literal: a hard-coded
    // figure larger than the allowance draws a full bar reading "0 left", which is a screenshot of
    // an exhausted ration rather than of a working one, and it moves every time the curve does.
    const allowance = supplyAllowance(lateGameBase.level, capacity);
    return supplyBoard(
      lateGameBase.level,
      lateGameBase.resources,
      capacity,
      Math.floor(allowance / 3),
      (key) => storageCapacityFor(lateGameBase.buildings, key, capacity),
    );
  })(),
  barterRate: barterRateFor(lateGameBase.level),
};

/** The workshop with one rung climbed on each line, so both states are on the screenshot. */
export const workshop: WorkshopResponse = {
  resources: lateGameBase.resources,
  inventory: market.inventory,
  upgrades: UNIT_UPGRADES.map((spec) => ({
    id: spec.id,
    line: spec.line,
    tier: spec.tier,
    name: spec.name,
    description: spec.description,
    cost: spec.cost,
    parts: spec.parts,
    effect: spec.effect as Record<string, number>,
    built: spec.tier === 1,
    blocker:
      spec.tier === 1
        ? null
        : spec.tier === 2
          ? null
          : `Needs the Gauntlet at level ${spec.requiresGauntletLevel}`,
  })),
  vehicles: VEHICLES.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    cost: spec.cost,
    parts: spec.parts,
    owned: spec.id === 'motorcycle' ? 2 : 0,
    travelSpeedPercent: spec.travelSpeedPercent,
    blocker: spec.id === 'motorcycle' ? null : 'Needs the Blueprint: Rotorcraft',
  })),
  fleetTravelSpeedPercent: 13,
};

/**
 * The back room, mid-day, with a shelf a crew can only half afford.
 *
 * Derived from the real board function rather than hand-written, so the fixture cannot drift into
 * showing five things the catalogue does not stock: the shape of defect the mocked-e2e trap is
 * made of. One slot has already turned over today, because a shelf where nothing has moved is a
 * screenshot of the uninteresting half of the feature.
 */
const BLACK_MARKET_DAY = '2026-08-12';
const blackMarketSlots = blackMarketBoard(BLACK_MARKET_DAY, [0, 0, 1, 0, 0]);

/**
 * A city a little way along, so the fixture exercises the weighting rather than the identity case.
 *
 * At the reference level every price is the catalogue's and every boost is the catalogue's, which
 * is exactly the fixture that cannot tell a weighted shelf from an unweighted one.
 */
const BLACK_MARKET_CITY_LEVEL = 12;

export const blackMarket: BlackMarketResponse = {
  day: BLACK_MARKET_DAY,
  offers: blackMarketSlots.map((slot, index) => {
    const spec = findBlackMarketGood(slot.goodId);
    return {
      slot,
      affordable: index < 3,
      price: spec ? blackMarketPrice(spec, BLACK_MARKET_CITY_LEVEL) : 0,
      effect: spec ? blackMarketEffect(spec, BLACK_MARKET_CITY_LEVEL) : '',
    };
  }),
  infamy: 460,
  takenToday: 0,
  takesPerDay: 1,
  cityLevel: BLACK_MARKET_CITY_LEVEL,
  stash: { adrenaline_syringes: 2, combat_stims: 1 },
  // Athens midnight, which for this instant is 21:00 UTC the same evening.
  refreshesAt: '2026-08-12T21:00:00.000Z',
  serverNow: NOW,
};

/** The same shelf, for a crew that has already had its one thing today. */
export const blackMarketSpent: BlackMarketResponse = {
  ...blackMarket,
  takenToday: 1,
  offers: blackMarket.offers.map((offer) => ({ ...offer, affordable: false })),
};

export const settings: SettingsResponse = {
  user,
  icons: [...PLAYER_ICONS],
  serverNow: NOW,
  gameTimezone: GAME_TIMEZONE,
};

export const adminSnapshot: AdminSnapshot = {
  state: { enabled: true, actionSeconds: 5, chargesResources: false },
  baseId: base.id,
  playerLevel: 12,
  infamy: 460,
  buildings: [
    { kind: 'nexus', level: 12 },
    { kind: 'quarters', level: 8 },
    { kind: 'greenhouse', level: 8 },
    { kind: 'generator', level: 9 },
    { kind: 'scrapyard', level: 8 },
    { kind: 'cistern', level: 6 },
    { kind: 'apothecary', level: 7 },
    { kind: 'gate', level: 10 },
    { kind: 'lab', level: 6 },
    { kind: 'gauntlet', level: 5 },
    { kind: 'infirmary', level: 4 },
    { kind: 'garage', level: 0 },
  ],
  backups: [
    {
      file: 'frontline-2026-08-12T09-50-00-000Z.sqlite',
      takenAt: '2026-08-12T09:50:00.000Z',
      bytes: 262144,
    },
    {
      file: 'frontline-2026-08-12T09-40-00-000Z.sqlite',
      takenAt: '2026-08-12T09:40:00.000Z',
      bytes: 258048,
    },
    {
      file: 'frontline-2026-08-12T09-30-00-000Z.sqlite',
      takenAt: '2026-08-12T09:30:00.000Z',
      bytes: 253952,
    },
  ],
};

/**
 * The battle board (§A4, battle rework).
 *
 * A crew with three fights in different states: one they called and have people on, one they are
 * defending with nothing moved up yet, and a finished one whose report reached them. The point of
 * three rather than one is that the card is styled by role and the screenshot has to prove all
 * three read as different things.
 */
const BOARD_NOW = '2026-08-16T12:00:00.000Z';
const boardSlots = declarableSlots(new Date(BOARD_NOW)).map((slot) => slot.toISOString());

const boardAnalysis: BattleAnalysis = {
  battleId: 'fight-3',
  locationName: 'Ninth Street Pawn',
  // §A4: the sky it was fought under and what the ground was like, stamped at resolution. A
  // storm, so the card has something to draw and the chips are worth looking at.
  weather: 'stormy',
  ground: [envLabel('crammed', 3), envLabel('dark', 2), envLabel('wet', 3), envLabel('noisy', 2)],
  winner: 'attacker',
  rounds: 5,
  decidedOnPower: false,
  attacker: {
    name: 'The Ninth Street Reclamation Company',
    committed: 34,
    lost: 6,
    survived: 28,
    fled: 0,
    perimeter: 4,
    perimeterCaught: 5,
    infamy: 118,
    units: [
      {
        unitId: 'snipers',
        name: 'Snipers',
        tier: 'specialist',
        unique: false,
        started: 6,
        lost: 1,
        fled: 0,
        caught: 0,
        survived: 5,
        damage: 4210,
        damageShare: 0.61,
        brokeAtRound: null,
        state: 'Steady',
      },
      {
        unitId: 'razors',
        name: 'Razors',
        tier: 'rabble',
        unique: false,
        started: 28,
        lost: 5,
        fled: 0,
        caught: 0,
        survived: 23,
        damage: 2690,
        damageShare: 0.39,
        brokeAtRound: null,
        state: 'Steady',
      },
    ],
  },
  defender: {
    name: 'Looters',
    committed: 19,
    lost: 19,
    survived: 0,
    fled: 0,
    perimeter: 0,
    perimeterCaught: 0,
    infamy: 0,
    units: [
      {
        unitId: 'razors',
        name: 'Razors',
        tier: 'rabble',
        unique: false,
        started: 19,
        lost: 19,
        fled: 0,
        caught: 5,
        survived: 0,
        damage: 1880,
        damageShare: 1,
        brokeAtRound: 4,
        state: 'Routed',
      },
    ],
  },
  log: [
    '34 moving on Ninth Street Pawn. Looters has 19 on the ground.',
    'Fought inside a structure, in built-up ground.',
    'Round 4: Razors broke.',
    'Ninth Street Pawn changes hands. The Ninth Street Reclamation Company holds it.',
    '14 broke and ran; 5 did not.',
    '5 got out of the fight and no further. The ring was waiting.',
  ],
  findings: [],
  trap: null,
  legends: [],
  headline:
    'The Ninth Street Reclamation Company holds Ninth Street Pawn. It cost 6, and Looters lost 19.',
};

/** What the board fixture's crew has to spend. Quoted once: the shelf is priced against it. */
const BOARD_INFAMY = 1460;

const comingBattle = (
  id: string,
  targetName: string,
  role: 'attacker' | 'defender',
  scheduledFor: string,
  muster: { army: Record<string, number>; perimeter: Record<string, number> },
  enemySize: number | null,
): BattleView => ({
  battle: {
    id,
    target: { kind: 'location', districtId: 'rustyard', locationId: `rustyard-${id}` },
    attackerBaseId: role === 'attacker' ? base.id : 'rival-base',
    defender: { kind: 'looters' },
    scheduledFor,
    holdAfterCapture: false,
    declaredAt: BOARD_NOW,
    resolvedAt: null,
    seed: `${id}-seed`,
  },
  targetName,
  districtName: 'Steelbelt',
  // Real ground, through the same builder the server uses: a fixture that sent bare open field
  // would make the deployment screen's forecast right in the fixture and wrong in the game.
  battlefield: battlefieldFor({
    locationName: targetName,
    kind: 'scrap_press',
    fortifyDifficulty: 'medium',
    fortifyLevel: 0,
    at: new Date(scheduledFor),
    weather: 'normal',
  }),
  role,
  side: role,
  deploymentOpen: true,
  muster: {
    ...muster,
    size:
      Object.values(muster.army).reduce((total, count) => total + count, 0) +
      Object.values(muster.perimeter).reduce((total, count) => total + count, 0),
  },
  enemySize,
  enemyIntel:
    enemySize === null
      ? 'Nothing. They are running dark.'
      : 'A rough count. Nobody would swear to it.',
  opponentName: role === 'attacker' ? 'Looters' : 'The Vex Combine',
  // §D7: priced against what this fixture actually has on the ground, exactly as the server does
  // it, so the fattest screenshot of the drop-down is the real arithmetic rather than round numbers
  // somebody typed. The Lab has finished nothing and the crew is one officer, so the gated half of
  // the shelf is drawn locked, which is the state worth screenshotting.
  boosts: [
    // One crate the crew is already carrying, at the head of the list where the server puts them.
    // Contraband is applied on this screen now rather than emptying itself into whichever fight
    // happened next, so the state worth screenshotting is a bag with something in it.
    {
      id: 'adrenaline_syringes',
      name: BLACK_MARKET_GOODS['adrenaline_syringes']?.name ?? 'Adrenaline Syringes',
      description: BLACK_MARKET_GOODS['adrenaline_syringes']?.description ?? '',
      cost: 0,
      effect: blackMarketEffect(BLACK_MARKET_GOODS['adrenaline_syringes']!, 12),
      source: '2 in the bag',
      reach: 100,
      affordable: true,
      available: true,
      held: true,
    },
    ...BATTLE_BOOSTS.map((spec) => ({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      cost: spec.cost,
      effect: describeBoostEffect(spec.effect),
      source: describeBoostUnlock(spec.unlock, (techId) => techId),
      reach: Math.round(boostCoverage(spec.effect, muster.army) * 100),
      affordable: BOARD_INFAMY >= spec.cost,
      available: spec.unlock.kind === 'open',
      held: false,
    })),
  ],
  boostId: null,
});

export const battles: BattlesResponse = {
  coming: [
    comingBattle(
      'press',
      'Kessler Press',
      'attacker',
      boardSlots[0] ?? BOARD_NOW,
      { army: { razors: 22, snipers: 6 }, perimeter: { road_reavers: 4 } },
      40,
    ),
    comingBattle(
      'bonefield',
      'The Bonefield',
      'defender',
      boardSlots[6] ?? BOARD_NOW,
      { army: {}, perimeter: {} },
      null,
    ),
  ],
  reports: [
    {
      battleId: 'fight-3',
      targetName: 'Ninth Street Pawn',
      resolvedAt: '2026-08-15T20:00:00.000Z',
      side: 'attacker',
      won: true,
      analysis: boardAnalysis,
      redacted: false,
    },
    {
      battleId: 'fight-4',
      targetName: 'The Ramp',
      resolvedAt: '2026-08-15T08:30:00.000Z',
      side: 'attacker',
      won: false,
      analysis: null,
      redacted: true,
    },
  ],
  slots: boardSlots,
  infamy: BOARD_INFAMY,
  gates: [
    { districtId: 'rustyard', name: 'The Rustyard', shut: false, brokenUntil: null },
    {
      districtId: 'chrome-row',
      name: 'Chrome Row',
      shut: true,
      brokenUntil: null,
    },
  ],
  structures: base.buildings.map((building, index) => ({
    buildingId: building.id,
    kind: building.kind,
    label: BUILDING_CATALOG[building.kind].name,
    level: building.level,
    damage: index === 0 ? 42 : 0,
    effectiveness: index === 0 ? 0.79 : 1,
    fortification: building.kind === 'gate' ? 1 : 0,
    fortifyPercent: building.kind === 'gate' ? fortifyBonusPercent('medium', 1) : 0,
    nextFortify:
      building.kind === 'gate'
        ? { level: 2, cost: fortifyCost(2), bonusPercent: fortifyBonusPercent('medium', 2) }
        : null,
  })),
  traps: TRAP_CATALOG.map((spec, index) => ({
    trapId: spec.id,
    name: spec.name,
    description: spec.description,
    available: index === 0,
    blocker: index === 0 ? '' : 'The Lab has not worked this one out yet',
  })),
  serverNow: BOARD_NOW,
};

/**
 * §A4: two columns on the road, one still inside its window and one well past it.
 *
 * Both states in one fixture, because the whole point of the screen is the difference: a column
 * that can still be turned around draws a control and one that cannot does not.
 */
export const actionsResponse: ActionsResponse = {
  serverNow: BOARD_NOW,
  movements: [
    {
      id: 'col-1',
      battleId: 'fight-1',
      targetName: 'Kessler Press',
      fromName: 'Neon Docks',
      toName: 'The Rustyard',
      side: 'attacker',
      army: { razors: 14, snipers: 4 },
      perimeter: { road_reavers: 2 },
      size: 20,
      // A minute into a twenty-minute walk: still inside the tenth.
      departedAt: new Date(Date.parse(BOARD_NOW) - 60_000).toISOString(),
      arrivesAt: new Date(Date.parse(BOARD_NOW) + 19 * 60_000).toISOString(),
      recallable: true,
    },
    {
      id: 'col-2',
      battleId: 'fight-2',
      targetName: 'The Bonefield',
      fromName: 'Neon Docks',
      toName: 'The Rustyard',
      side: 'defender',
      army: { breakers: 6 },
      perimeter: {},
      size: 6,
      // Half an hour into a forty-minute walk: far too late to turn round.
      departedAt: new Date(Date.parse(BOARD_NOW) - 30 * 60_000).toISOString(),
      arrivesAt: new Date(Date.parse(BOARD_NOW) + 10 * 60_000).toISOString(),
      recallable: false,
    },
  ],
};

// --- factions, messages and notifications (board request) ---

const ALLY_ID = 'ally-user';
const ALLY_BASE = 'ally-base';

/**
 * A faction with somebody in it, seen from a leader's seat.
 *
 * Two members rather than one, and one of them a fixture that does not play, because that is the
 * seeded world every player meets first: the screen has to be right when the person beside you is
 * a hardcoded neighbour.
 */
export const factionScreen: FactionResponse = {
  faction: {
    id: 'faction-1',
    name: 'The Ninth Circle',
    badge: {
      shape: 'shield',
      ground: 'soot',
      field: 'chevron',
      fieldColor: 'oxblood',
      prop: 'skull',
      ink: 'brass',
    },
    blurb: 'Five streets, one arrangement. Whoever comes for one of us finds all of us.',
    foundedAt: NOW,
  },
  rank: 'leader',
  members: [
    {
      userId: 'me-user',
      baseId: base.id,
      username: 'Nikos',
      districtName: base.name,
      districtId: base.districtId,
      rank: 'leader',
      joinedAt: NOW,
      level: base.level,
      infamy: 100,
      armySize: 26,
      supplyUsed: 32,
      isBot: false,
    },
    {
      userId: ALLY_ID,
      baseId: ALLY_BASE,
      username: 'Sable_Ninth',
      districtName: 'The Ninth Street Irregulars',
      districtId: 'ashen-terraces',
      rank: 'chief',
      joinedAt: NOW,
      level: 6,
      infamy: 480,
      armySize: 38,
      supplyUsed: 60,
      isBot: true,
    },
  ],
  invites: [],
  pending: [],
  battles: [
    {
      battleId: 'ally-battle-1',
      memberUserId: ALLY_ID,
      memberName: 'Sable_Ninth',
      districtName: 'The Ninth Street Irregulars',
      targetName: 'The Tideline Market',
      districtLabel: 'neon-docks',
      scheduledFor: '2026-08-14T03:30:00.000Z',
      side: 'attacker',
      committed: 24,
      yourContribution: 0,
      canReinforce: true,
    },
  ],
  armies: [
    {
      memberUserId: ALLY_ID,
      memberName: 'Sable_Ninth',
      army: { ironsides: 8, snipers: 6, stitchers: 4, razors: 20 },
      size: 38,
    },
  ],
  serverNow: NOW,
};

/** Nobody at a table yet: the invitation you are holding, and the form to found your own. */
export const factionNone: FactionResponse = {
  faction: null,
  rank: null,
  members: [],
  invites: [
    {
      id: 'invite-1',
      factionId: 'faction-1',
      factionName: 'The Ninth Circle',
      factionBadge: {
        shape: 'shield',
        ground: 'soot',
        field: 'chevron',
        fieldColor: 'oxblood',
        prop: 'skull',
        ink: 'brass',
      },
      invitedBy: 'Sable_Ninth',
      invitedUserId: 'me-user',
      sentAt: NOW,
    },
  ],
  pending: [],
  battles: [],
  armies: [],
  serverNow: NOW,
};

/** One read, one unread, and a sent row that has been opened by one of its two recipients. */
export const messagesScreen: MessagesResponse = {
  inbox: [
    {
      id: 'msg-1',
      threadId: 'thread-1',
      senderUserId: ALLY_ID,
      senderName: 'Sable_Ninth',
      senderFaction: 'The Ninth Circle',
      audience: 'faction',
      addressedTo: 'The Ninth Circle',
      subject: 'The Tideline Market, oh-three-thirty',
      body: 'Bringing eight Ironsides and the snipers. If anybody has bodies spare, the market is\nwide open on the north side.',
      sentAt: NOW,
      readAt: null,
      invite: null,
    },
    {
      id: 'msg-2',
      threadId: 'thread-2',
      senderUserId: 'other-user',
      senderName: 'Vex_Combine',
      senderFaction: null,
      audience: 'player',
      addressedTo: 'Nikos',
      subject: 'You are on the wrong street',
      body: 'Consider this the only warning you get.',
      sentAt: '2026-08-12T20:00:00.000Z',
      readAt: '2026-08-12T20:30:00.000Z',
      invite: null,
    },
    /* An invitation, which is an ordinary message with a card on it (board request). */
    {
      id: 'msg-3',
      threadId: 'thread-4',
      senderUserId: ALLY_ID,
      senderName: 'Sable_Ninth',
      senderFaction: 'The Ninth Circle',
      audience: 'player',
      addressedTo: 'Nikos',
      subject: 'An invitation to The Ninth Circle',
      body: 'Sable_Ninth has asked you to join The Ninth Circle.',
      sentAt: NOW,
      readAt: null,
      invite: {
        inviteId: 'invite-1',
        factionId: 'faction-1',
        factionName: 'The Ninth Circle',
        badge: {
          shape: 'shield',
          ground: 'soot',
          field: 'chevron',
          fieldColor: 'oxblood',
          prop: 'skull',
          ink: 'brass',
        },
        open: true,
      },
    },
  ],
  sent: [
    {
      threadId: 'thread-3',
      audience: 'faction',
      addressedTo: 'The Ninth Circle',
      subject: 'Docks tonight',
      body: 'Eight Ironsides to the waterfront.',
      sentAt: NOW,
      recipients: 2,
      readBy: 1,
    },
  ],
  unread: 1,
  hasFaction: true,
  serverNow: NOW,
};

/** A bell with something in it, including one already read, so both weights are drawn. */
export const notificationsScreen: NotificationsResponse = {
  notifications: [
    {
      id: 'note-1',
      kind: 'battle_report',
      title: 'A fight was won',
      body: 'The Tideline Market is settled.',
      link: '/game/battles',
      createdAt: NOW,
      readAt: null,
    },
    {
      id: 'note-2',
      kind: 'reinforcement_arrived',
      title: 'Sable_Ninth is sending help',
      body: 'Units are on the road to a fight of yours.',
      link: '/game/battles',
      createdAt: '2026-08-13T11:00:00.000Z',
      readAt: null,
    },
    {
      id: 'note-3',
      kind: 'building_done',
      title: 'The Quarters is finished',
      body: 'Standing at level 4.',
      link: '/game/base',
      createdAt: '2026-08-13T09:00:00.000Z',
      readAt: '2026-08-13T09:05:00.000Z',
    },
  ],
  unread: 2,
  settings: { muted: ['training_done'] },
  serverNow: NOW,
};
