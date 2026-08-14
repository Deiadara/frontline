import {
  BAR_HIRES_PER_DAY,
  MODIFICATIONS,
  populationCapacity,
  addResources,
  alignedAttributes,
  MAX_PAIRINGS,
  MAX_ROLE_FACTS,
  makePairing,
  OFFICER_ROLES,
  RESEARCH_COST_CAPS,
  RESEARCH_MINUTES,
  researchCompletesAt,
  roleFullyResearched,
  alignmentBand,
  alignmentBonusAttributes,
  alignmentSkillBonus,
  CITY_DISTRICTS,
  createCommander,
  findMissionTemplate,
  makeAttributes,
  OVERSEER_PRESETS,
  STARTING_RESOURCES,
  assigneeBonusPercent,
  MAX_ASSIGNEES_PER_OFFICER,
  assigneeCapPerOfficer,
  assigneePool,
  startingAssignees,
  startingEconomy,
  startingProgression,
  startingResearch,
  templateTimings,
  threatensToLeave,
  type AuthResponse,
  type BarOfficer,
  type BarRecruit,
  type AssigneeOfficer,
  type AssigneesResponse,
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
  name: 'The Ninth Street Crew',
  districtId: 'neon-docks',
  level: 1,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  assignees: startingAssignees(),
  buildings: [
    { id: 'b1', kind: 'nexus', level: 1, modifications: [] },
    { id: 'b2', kind: 'generator', level: 1, modifications: [] },
  ],
  buildQueue: [],
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
 * The Bar at its widest (GDD §H).
 *
 * Deliberately the fat case, per MOU-207: the starting state of this screen is an empty crew and
 * eight identical-looking cards, and that has never caught a layout bug. This is a late-game crew
 * — the longest officer names the generator can produce, a four-digit wage, every §H5 band
 * including the walkout warning and the skill-bonus line, and recruits covering all three card
 * states (interested, gated, already hired).
 */
function barRecruit(id: string, name: string, overrides: Partial<BarRecruit> = {}): BarRecruit {
  return {
    id,
    name,
    attributes: makeAttributes(18, { stealth: 34, cunning: 31, hacking: 29, medicine: 9 }),
    traits: ['gutter_born'],
    ambition: 'notoriety',
    moralCompass: 'ruthless',
    requirement: { minInfamy: 0 },
    assessment: { meetsRequirement: true, stance: 2, interested: true, blockers: [] },
    askingWage: 48,
    hired: false,
    ...overrides,
  };
}

function barOfficer(
  id: string,
  name: string,
  role: BarOfficer['commander']['role'],
  alignment: number,
  weeklyWage: number,
  overrides: Partial<BarOfficer['commander']> = {},
): BarOfficer {
  const commander: Commander = {
    ...createCommander(id, name, role, { stealth: 41, cunning: 37, hacking: 33 }, ['gutter_born'], {
      ambition: 'revenge',
      moralCompass: 'ruthless',
      now: NOW,
    }),
    alignment,
    ...overrides,
  };
  return {
    commander,
    effectiveAttributes: alignedAttributes(commander.attributes, alignment),
    band: alignmentBand(alignment),
    threateningToLeave: threatensToLeave(alignment),
    skillBonus: alignmentSkillBonus(alignment),
    bonusAttributes:
      alignmentSkillBonus(alignment) > 0 ? alignmentBonusAttributes(commander.attributes) : [],
    weeklyWage,
  };
}

export const bar: BarResponse = {
  day: '2026-08-12',
  serverNow: NOW,
  recruits: [
    barRecruit('bar-1', 'Dorotea "The Undergrid Ghost"'),
    barRecruit('bar-2', 'Emeric Voskuijlen', { askingWage: 1240, traits: [] }),
    barRecruit('bar-3', 'Kestrel Salvatierra', {
      requirement: { minInfamy: 60 },
      assessment: { meetsRequirement: false, stance: 1, interested: false, blockers: ['infamy'] },
      askingWage: null,
    }),
    barRecruit('bar-4', 'Rashid Okonkwo', {
      ambition: 'knowledge',
      moralCompass: 'idealist',
      assessment: {
        meetsRequirement: false,
        stance: -2,
        interested: false,
        blockers: ['infamy', 'reputation'],
      },
      askingWage: null,
      requirement: { minInfamy: 45 },
    }),
    barRecruit('bar-5', 'Ilse Abara', { hired: true, askingWage: 96 }),
    barRecruit('bar-6', 'Juno Petrosyan', { askingWage: 61, traits: ['silver_tongue'] }),
    // §B7 — a flaw on the card, so the layout guards cover the state a player must be able to read.
    barRecruit('bar-7', 'Casimir Adeyemi-Lindqvist', { askingWage: 74, traits: ['marked_face'] }),
  ],
  officers: [
    barOfficer('off-1', 'The Ghost of Sector Nine', 'head_spy', 100, 1240, {
      level: 9,
      unspentPoints: 4,
    }),
    barOfficer('off-2', 'Odile Marchetti', 'finance_officer', 52, 340),
    barOfficer('off-3', 'Bruno Lindqvist', 'raid_boss', 8, 88, { level: 3 }),
  ],
  slotsUsed: 3,
  slotsTotal: 13,
  infamy: 100,
  reputation: 'Feared',
  caps: 125000,
  filledRoles: ['head_spy', 'finance_officer', 'raid_boss'],
  /** §H2b — this crew has not signed anybody today, so the offer buttons are live. */
  hiresLeftToday: BAR_HIRES_PER_DAY,
};

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
    startedAt,
    travelMinutes,
    durationMinutes,
    status: 'active',
    // §G6 — these fixtures send delegations, not officer-led runs.
    officerId: null,
    outcome: null,
    rewards: {},
    resolvedAt: null,
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
 * the board only just launched — so its countdown reads `25:5x:xx`, the widest string the timer
 * column can ever hold — and a returned mission paying all five resources at once, which is the
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

/**
 * What `POST /missions` answers with — a different shape from the board (§G6 launch path).
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

/** The base after that payout is banked — `caps 768`, `scrap 535`. */
export const paidBase: Base = {
  ...base,
  resources: addResources(STARTING_RESOURCES, SETTLED_REWARD),
};

export const paidMe: MeResponse = { user, overseer, base: paidBase };

/**
 * The state change `missionsResponse` cannot express: one crew still out on the first read, home
 * and paid on the next.
 *
 * Every mission in that fixture is *born* either active or already resolved, so the settle path —
 * the one moment the whole feature turns on — was never exercised in a browser, and a payout that
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
    activeLimit: 4,
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
 * §B (`communication`, `marksmanship`, `intimidation`), every listed role already at
 * `MAX_ROLE_FACTS` so the `3 / 3 leads` counter is at its widest, the pairing cap filled so that
 * list wraps as far as it ever will, and a six-figure cap balance in the header.
 *
 * The facts below are chosen for *string width*, not for accuracy against the server's hidden
 * requirement table — a fixture has no business encoding that, and this file is inside the W1 leak
 * guard's scan (§B8a).
 */
const WIDE_ATTRIBUTES = [
  'communication',
  'marksmanship',
  'intimidation',
  'fabrication',
  'cybernetics',
  'scholarship',
  'negotiation',
  'demolition',
  'navigation',
  'engineering',
  'mentoring',
  'appraisal',
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
  // §A1 — a crew with no Lead Engineer, so every modification reports the same blocker. The
  // structures themselves are unbuilt in this fixture, which is the blocker the player sees first.
  canModify: false,
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
 * Every other research fixture is *born* either active or already idle, so the settle path — the
 * one moment the whole feature turns on — would never be exercised in a browser, and facts that
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
 * The §G screen (GDD §G).
 *
 * The per-officer numbers are *derived* with the shared §G7/§G3 helpers rather than hand-typed.
 * That is right for a layout fixture — what these specs assert is geometry, and the arithmetic
 * itself is pinned by hard-coded percentages in `packages/shared/src/assignees/assignees.test.ts`.
 * Typing them again here would only risk a fixture that disagrees with the server and a screenshot
 * of a screen nobody is served.
 */
function assigneeOfficer(
  officerId: string,
  name: string,
  role: AssigneeOfficer['role'],
  assignees: number,
  level: number,
): AssigneeOfficer {
  const cap = assigneeCapPerOfficer(level);
  return {
    officerId,
    name,
    role,
    assignees,
    bonusPercent: assigneeBonusPercent(assignees),
    nextBonusPercent: assignees < cap ? assigneeBonusPercent(assignees + 1) : null,
  };
}

function assigneesAt(
  level: number,
  placed: readonly [string, string, AssigneeOfficer['role'], number][],
): AssigneesResponse {
  const officers = placed.map(([id, name, role, count]) =>
    assigneeOfficer(id, name, role, count, level),
  );
  const total = officers.reduce((sum, officer) => sum + officer.assignees, 0);
  return {
    level,
    pool: assigneePool(level),
    placed: total,
    unplaced: assigneePool(level) - total,
    capPerOfficer: assigneeCapPerOfficer(level),
    housing: { used: officers.length + total, capacity: populationCapacity(base.buildings) },
    maxBonusPercent: assigneeBonusPercent(assigneeCapPerOfficer(level)),
    canReskill: officers.some((officer) => officer.role === 'professor'),
    officers,
  };
}

/** A level-1 crew: nobody hired, so nobody to assign anyone to. The empty state. */
export const assigneesStart: AssigneesResponse = assigneesAt(1, []);

/**
 * The widest this screen ever gets, and the state every layout guard has to survive.
 *
 * Level 48 is where §G3a's `floor(level / 2)` finally reaches the end of the extended §G7 table, so
 * the cap is 24 — the most pips a row can ever draw — and one officer sits at it, showing the 75%
 * ceiling and the `at cap` label. The others cover a decimal bonus (14.5%) and the longest officer
 * name and role label on the board, which is what actually threatens the column.
 *
 * This tracks the table: extending `ASSIGNEE_BONUS_PERCENT` again moves the widest row, so the
 * level here must move with it (`2 * MAX_ASSIGNEES_PER_OFFICER`) or the guard stops covering the
 * case it claims to.
 */
export const assigneesFat: AssigneesResponse = assigneesAt(2 * MAX_ASSIGNEES_PER_OFFICER, [
  ['off-1', 'The Ghost of Sector Nine', 'instructor_of_the_young', MAX_ASSIGNEES_PER_OFFICER],
  ['off-2', 'Wilhelmina Okonkwo-Restrepo', 'head_of_research', 3],
  ['off-3', 'Vela', 'professor', 7],
]);
