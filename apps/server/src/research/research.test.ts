import {
  findModification,
  MISC_AREA_ID,
  OFFICER_ROLES,
  CROSS_REFERENCE_IMPROVISATION,
  EXTRA_FACT_COMMUNICATION,
  MAX_ATTRIBUTE,
  MAX_PAIRINGS,
  MAX_ROLE_FACTS,
  MISSION_EDGE_ATTRIBUTES,
  MAX_MISSION_EDGE,
  OVERSEER_PRESETS,
  RESEARCH_COST_CAPS,
  RESEARCH_MINUTES,
  addonsOf,
  createCommander,
  developAttribute,
  findMissionTemplate,
  makeAttributes,
  modifiedSuccessChance,
  factionXpFromLeadership,
  overseerMissionEdge,
  pairingsIn,
  researchCompletesAt,
  roleFactsIn,
  startingEconomy,
  startingProgression,
  startingResearch,
  unlocksCrossReference,
  type ActiveResearch,
  type Addons,
  type Base,
  type Commander,
  type Overseer,
  type OverseerPreset,
  type ResearchProject,
  type ResearchResponse,
  type ResearchState,
  startingTraining,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { launchMission } from '../missions/launch.js';
import { settleResearch } from './settle.js';
import { startResearch } from './start.js';
import { modificationBlocker } from '../district/modifications.js';

const NOW = new Date('2026-08-13T09:00:00.000Z');
const MINUTE_MS = 60_000;

const [firstPreset] = OVERSEER_PRESETS;
if (!firstPreset) throw new Error('expected an overseer preset');
const PRESET: OverseerPreset = firstPreset;

function makeOverseer(overrides: Partial<Overseer> = {}): Overseer {
  return {
    id: 'ov-1',
    name: PRESET.name,
    archetype: PRESET.archetype,
    portraitId: PRESET.portraitId,
    bio: PRESET.bio,
    attributes: PRESET.attributes,
    perks: PRESET.perks,
    ...overrides,
  };
}

/**
 * What an investigation actually takes once `professor('…', 10, …)` is on the books.
 *
 * §F2 cuts a project's clock by the crew's Analysis, Improvisation and Encyclopedia, so the
 * catalogue number is no longer the number that lands on the row. Written out rather than
 * recomputed from the same functions the code under test uses: an expectation derived from the
 * implementation agrees with it however badly either one is broken.
 *
 * 45 catalogue minutes, a little over 6% off, is 42. It has moved twice and both times for a
 * content reason rather than a tuning one. It went 42 to 43 when §C2 landed, because a Professor's
 * seat puts Improvisation to work and does **not** put Analysis to work, so their Analysis 15
 * started counting at the off-duty share. It is back to 42 now that Encyclopedia has replaced
 * Demolition and drives research alongside those two: the crew reads a third thing, so a project
 * takes a minute less.
 */
const INVESTIGATION_MINUTES = 42;

/** A Professor whose sheet is set exactly where the §F3/§F4 gates are being probed. */
function professor(id: string, improvisation: number, communication: number): Commander {
  return createCommander(id, 'Ada Vasquez', 'professor', { improvisation, communication });
}

function makeBase(overrides: Partial<Base> = {}): Base {
  return {
    id: 'base-1',
    ownerId: 'user-1',
    name: 'Test Hold',
    districtId: 'neon-docks',
    level: 1,
    isBot: false,
    resources: {
      caps: 5000,
      supplies: 100,
      oil: 100,
      scrap: 100,
      highQualityMetal: 10,
      planks: 100,
    },
    economy: startingEconomy(NOW.toISOString()),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining('2026-08-16T00:00:00.000Z'),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

/** A repository double: research writes through four calls and the tests assert on what landed. */
function fakeRepos(): {
  repos: Parameters<typeof settleResearch>[0];
  written: {
    research?: ResearchState;
    caps?: number;
    morale?: number;
    attributes?: unknown;
    commanders?: Commander[];
    level?: number;
    xpIntoLevel?: number;
    addons?: Addons;
  };
} {
  const written: {
    research?: ResearchState;
    caps?: number;
    morale?: number;
    attributes?: unknown;
    commanders?: Commander[];
    level?: number;
    xpIntoLevel?: number;
    addons?: Addons;
  } = {};
  const repos = {
    bases: {
      updateResearch: (_id: string, research: ResearchState) => {
        written.research = research;
      },
      updateResources: (_id: string, resources: { caps: number }) => {
        written.caps = resources.caps;
      },
      updateEconomy: (_id: string, economy: { morale: number }) => {
        written.morale = economy.morale;
      },
      // §G6/§H6: settling an investigation pays its lead officer, so the double has to accept
      // the write. Captured rather than ignored: the character-XP tests below read it back.
      updateCommanders: (_id: string, commanders: Commander[]) => {
        written.commanders = commanders;
      },
      // §I1: a finished project now pays the *player* as well as its lead, and `awardPlayerXp`
      // is the only writer of `Base.level`. Captured, so the level-up tests below can read it.
      updateProgression: (_id: string, level: number, progression: { xpIntoLevel: number }) => {
        written.level = level;
        written.xpIntoLevel = progression.xpIntoLevel;
      },
      // §B9: modification work ends with a blueprint on the shelf, which is a fifth write.
      updateAddons: (_id: string, addons: Addons) => {
        written.addons = addons;
      },
      updateDistrict: () => undefined,
    },
    overseers: {
      updateAttributes: (_id: string, attributes: unknown) => {
        written.attributes = attributes;
      },
    },
    // §F2: a project's clock is now cut by the crew's Analysis and Improvisation as well as by
    // the Lab. These doubles answer "no ground, nobody" so the tests below stay about the Lab and
    // the officer; the crew's cut has its own test.
    city: { controls: () => new Map() },
    users: { findById: () => undefined },
  } as unknown as Parameters<typeof settleResearch>[0];
  return { repos, written };
}

/** Starts `project` and runs the clock past its end, returning what the settlement produced. */
function runToCompletion(base: Base, overseer: Overseer, project: ResearchProject) {
  const { repos } = fakeRepos();
  const started = startResearch(repos, { base, overseer, project, id: 'r-1', now: NOW });
  if (started.kind !== 'started') throw new Error(`refused: ${started.reason}`);
  const after = new Date(NOW.getTime() + started.active.durationMinutes * MINUTE_MS);
  return settleResearch(repos, started.base, overseer, after);
}

/**
 * §B9: a finished modification project puts a **blueprint** on the shelf and nothing in a wall.
 *
 * This is the seam between the Lab and the Scrapyard, and it is the one place the two could come
 * apart silently: a project that still bolted the thing in would leave the yard with nothing to
 * build and §E's slots with nothing to empty, and every other research assertion in this file
 * would stay green.
 */
describe('§B9: modification work ends with a blueprint', () => {
  const engineer = () => createCommander('eng-1', 'Wren', 'lead_engineer');
  const project: ResearchProject = {
    kind: 'modification',
    modificationId: 'lab_quantum_modeling',
  };

  it('records the drawing and leaves the structure untouched', () => {
    const { repos, written } = fakeRepos();
    const base = makeBase({
      commanders: [engineer()],
      buildings: [{ id: 'b-lab', kind: 'lab', level: 20, modifications: [], damage: 0 }],
      resources: {
        caps: 99_999,
        supplies: 99_999,
        oil: 99_999,
        scrap: 99_999,
        highQualityMetal: 99_999,
        planks: 99_999,
      },
    });
    const overseer = makeOverseer();
    const started = startResearch(repos, { base, overseer, project, id: 'r-1', now: NOW });
    if (started.kind !== 'started') throw new Error(`refused: ${started.reason}`);

    const after = new Date(NOW.getTime() + RESEARCH_MINUTES.modification * MINUTE_MS);
    const settled = settleResearch(repos, started.base, overseer, after);

    expect(addonsOf(settled.base).researched).toEqual(['lab_quantum_modeling']);
    expect(written.addons?.researched).toEqual(['lab_quantum_modeling']);
    // Nothing is bolted on: the Scrapyard builds it and the Lab's own dialog fits it.
    expect(settled.base.buildings.flatMap((building) => building.modifications)).toEqual([]);
  });

  /**
   * A drawing the crew already owns cannot be bought twice.
   *
   * `settleResearch` will not bank a second copy, so a project that starts anyway buys an occupied
   * Lab, the fee, and nothing at all at the end of it. `modificationBlocker` used to answer "no
   * blocker" for an already-drawn modification, which the display path never reached (it
   * short-circuits on `installed`) and which the gate read as permission.
   */
  it('refuses a second project for a drawing the crew already holds', () => {
    const { repos } = fakeRepos();
    const stocked = {
      caps: 99_999,
      supplies: 99_999,
      oil: 99_999,
      scrap: 99_999,
      highQualityMetal: 99_999,
      planks: 99_999,
    };
    const base = makeBase({
      commanders: [engineer()],
      buildings: [{ id: 'b-lab', kind: 'lab', level: 20, modifications: [], damage: 0 }],
      resources: stocked,
    });
    const overseer = makeOverseer();
    const first = startResearch(repos, { base, overseer, project, id: 'r-1', now: NOW });
    if (first.kind !== 'started') throw new Error(`refused: ${first.reason}`);
    const after = new Date(NOW.getTime() + RESEARCH_MINUTES.modification * MINUTE_MS);
    const owned = settleResearch(repos, first.base, overseer, after).base;
    expect(addonsOf(owned).researched).toEqual(['lab_quantum_modeling']);

    // They take it out of the wall again, which is allowed and does not un-own the paper.
    const again = startResearch(repos, {
      base: { ...owned, resources: stocked },
      overseer,
      project,
      id: 'r-2',
      now: after,
    });
    expect(again).toEqual({ kind: 'refused', reason: 'nothing_to_learn' });
    expect(modificationBlocker(owned, findModification('lab_quantum_modeling')!)).toBe(
      'already_drawn',
    );
  });
});

describe('starting a project (§B9, §F2, §F4)', () => {
  const lead = professor('prof-1', 10, 10);
  const base = makeBase({ commanders: [lead] });
  const overseer = makeOverseer();
  const investigate: ResearchProject = {
    kind: 'investigation',
    role: 'head_spy',
    leadOfficerId: lead.id,
    crossReference: false,
  };

  it('charges caps and freezes the clock onto the row', () => {
    const { repos, written } = fakeRepos();
    const result = startResearch(repos, {
      base,
      overseer,
      project: investigate,
      id: 'r',
      now: NOW,
    });

    expect(result.kind).toBe('started');
    if (result.kind !== 'started') return;
    expect(result.base.resources.caps).toBe(5000 - RESEARCH_COST_CAPS.investigation);
    expect(written.caps).toBe(result.base.resources.caps);
    expect(result.active.durationMinutes).toBe(INVESTIGATION_MINUTES);
    expect(researchCompletesAt(result.active).getTime()).toBe(
      NOW.getTime() + INVESTIGATION_MINUTES * MINUTE_MS,
    );
    expect(written.research?.active?.id).toBe('r');
  });

  it('refuses a second project while one is running', () => {
    const busy = makeBase({
      commanders: [lead],
      research: {
        active: {
          id: 'r-0',
          project: investigate,
          startedAt: NOW.toISOString(),
          durationMinutes: 45,
        },
        facts: [],
        technologies: [],
      },
    });
    const { repos } = fakeRepos();
    expect(
      startResearch(repos, { base: busy, overseer, project: investigate, id: 'r', now: NOW }),
    ).toEqual({ kind: 'refused', reason: 'already_running' });
  });

  it('§B9/§C4: only a Professor or Head of Research can lead an investigation', () => {
    const { repos } = fakeRepos();
    const wrongRole = createCommander('spy-1', 'Nyx', 'head_spy');
    const withSpy = makeBase({ commanders: [wrongRole] });
    expect(
      startResearch(repos, {
        base: withSpy,
        overseer,
        project: { ...investigate, leadOfficerId: wrongRole.id },
        id: 'r',
        now: NOW,
      }),
    ).toEqual({ kind: 'refused', reason: 'no_lead' });

    // ...and a lead who is not on the books at all is the same refusal, not a crash.
    expect(
      startResearch(repos, {
        base,
        overseer,
        project: { ...investigate, leadOfficerId: 'nobody' },
        id: 'r',
        now: NOW,
      }),
    ).toEqual({ kind: 'refused', reason: 'no_lead' });
  });

  it('§F4: the cross-reference option is refused, not silently dropped, when locked', () => {
    const { repos } = fakeRepos();
    const dull = professor('dull', CROSS_REFERENCE_IMPROVISATION - 1, 10);
    const bright = professor('bright', CROSS_REFERENCE_IMPROVISATION, 10);
    expect(unlocksCrossReference(dull.attributes)).toBe(false);
    expect(unlocksCrossReference(bright.attributes)).toBe(true);

    const withBoth = makeBase({ commanders: [dull, bright] });
    expect(
      startResearch(repos, {
        base: withBoth,
        overseer,
        project: { ...investigate, leadOfficerId: dull.id, crossReference: true },
        id: 'r',
        now: NOW,
      }),
    ).toEqual({ kind: 'refused', reason: 'option_locked' });

    // The same request from someone imaginative enough goes through, so the refusal above is the
    // gate doing its job, not the request being malformed.
    const allowed = startResearch(repos, {
      base: withBoth,
      overseer,
      project: { ...investigate, leadOfficerId: bright.id, crossReference: true },
      id: 'r',
      now: NOW,
    });
    expect(allowed.kind).toBe('started');
  });

  it('refuses a role with nothing left to learn, and never charges for it', () => {
    const { repos, written } = fakeRepos();
    let state = makeBase({ commanders: [lead] });
    for (let i = 0; i < MAX_ROLE_FACTS; i += 1) {
      state = runToCompletion(state, overseer, investigate).base;
    }
    expect(roleFactsIn(state.research.facts, 'head_spy')).toHaveLength(MAX_ROLE_FACTS);

    const exhausted = { ...state, resources: { ...state.resources, caps: 5000 } };
    expect(
      startResearch(repos, { base: exhausted, overseer, project: investigate, id: 'r', now: NOW }),
    ).toEqual({ kind: 'refused', reason: 'nothing_to_learn' });
    expect(written.caps, 'a refused project must not take the money').toBeUndefined();
  });

  it('refuses when the caps are not there', () => {
    const { repos } = fakeRepos();
    const broke = makeBase({
      commanders: [lead],
      resources: { ...base.resources, caps: RESEARCH_COST_CAPS.investigation - 1 },
    });
    expect(
      startResearch(repos, { base: broke, overseer, project: investigate, id: 'r', now: NOW }),
    ).toEqual({ kind: 'refused', reason: 'cannot_afford' });
  });
});

describe('settling a project (§B9, §F2, §F3)', () => {
  const overseer = makeOverseer();
  const investigate = (leadOfficerId: string, crossReference = false): ResearchProject => ({
    kind: 'investigation',
    role: 'head_spy',
    leadOfficerId,
    crossReference,
  });

  it('pays nothing out before the clock is up', () => {
    const lead = professor('p', 10, 10);
    const { repos } = fakeRepos();
    const started = startResearch(repos, {
      base: makeBase({ commanders: [lead] }),
      overseer,
      project: investigate(lead.id),
      id: 'r',
      now: NOW,
    });
    if (started.kind !== 'started') throw new Error('expected a start');

    const early = new Date(NOW.getTime() + (INVESTIGATION_MINUTES - 1) * MINUTE_MS);
    const settlement = settleResearch(repos, started.base, overseer, early);
    expect(settlement.discovered).toEqual([]);
    expect(settlement.base.research.active, 'the project is still running').not.toBeNull();
  });

  it('yields one fact, clears the slot, and cannot pay out twice', () => {
    const lead = professor('p', 10, 10);
    const settlement = runToCompletion(
      makeBase({ commanders: [lead] }),
      overseer,
      investigate('p'),
    );

    expect(settlement.discovered).toHaveLength(1);
    expect(settlement.discovered[0]).toMatchObject({ kind: 'role_attribute', role: 'head_spy' });
    expect(settlement.base.research.active).toBeNull();
    expect(settlement.base.research.facts).toHaveLength(1);

    // Settling the very same base again finds nothing active and mints nothing.
    const { repos } = fakeRepos();
    const again = settleResearch(repos, settlement.base, overseer, new Date(NOW.getTime() + 1e9));
    expect(again.discovered).toEqual([]);
    expect(again.base.research.facts).toHaveLength(1);
  });

  it('§F3: a communicative lead gets a second fact out of the same project', () => {
    const quiet = professor('quiet', 10, EXTRA_FACT_COMMUNICATION - 1);
    const talker = professor('talk', 10, EXTRA_FACT_COMMUNICATION);
    const withBoth = makeBase({ commanders: [quiet, talker] });

    expect(runToCompletion(withBoth, overseer, investigate('quiet')).discovered).toHaveLength(1);
    expect(runToCompletion(withBoth, overseer, investigate('talk')).discovered).toHaveLength(2);
  });

  it('§F4: the cross-reference adds a pairing on top of the role fact', () => {
    const bright = professor('bright', CROSS_REFERENCE_IMPROVISATION, 10);
    const settlement = runToCompletion(
      makeBase({ commanders: [bright] }),
      overseer,
      investigate('bright', true),
    );
    expect(settlement.discovered).toHaveLength(2);
    expect(pairingsIn(settlement.discovered)).toHaveLength(1);
  });

  it('§F3: Charisma is worth allegiance XP on a finished project, and a dour Overseer is not', () => {
    const charismatic = makeAttributes(10, { charisma: MAX_ATTRIBUTE });
    const dour = makeAttributes(10, { charisma: 0 });
    expect(factionXpFromLeadership(dour)).toBe(0);
    expect(factionXpFromLeadership(charismatic)).toBeGreaterThan(0);
  });

  it('lands the project even if the lead was fired mid-flight, without their bonus', () => {
    const talker = professor('talk', 10, EXTRA_FACT_COMMUNICATION);
    const { repos } = fakeRepos();
    const started = startResearch(repos, {
      base: makeBase({ commanders: [talker] }),
      overseer,
      project: investigate('talk'),
      id: 'r',
      now: NOW,
    });
    if (started.kind !== 'started') throw new Error('expected a start');

    const withoutLead = { ...started.base, commanders: [] };
    const after = new Date(NOW.getTime() + RESEARCH_MINUTES.investigation * MINUTE_MS);
    const settlement = settleResearch(repos, withoutLead, overseer, after);
    expect(settlement.discovered, 'the work was still done').toHaveLength(1);
  });

  it('§F2: training develops the Overseer and persists the new sheet', () => {
    const before = makeOverseer({ attributes: makeAttributes(12) });
    const { repos, written } = fakeRepos();
    const base = makeBase();
    const started = startResearch(repos, {
      base,
      overseer: before,
      project: { kind: 'training', attribute: 'improvisation' },
      id: 'r',
      now: NOW,
    });
    if (started.kind !== 'started') throw new Error('expected a start');

    const after = new Date(NOW.getTime() + RESEARCH_MINUTES.training * MINUTE_MS);
    const settlement = settleResearch(repos, started.base, before, after);
    expect(settlement.overseer.attributes.improvisation).toBe(13);
    expect(written.attributes).toEqual(settlement.overseer.attributes);
    // Nothing else on the sheet moved, and no fact was minted by a training project.
    expect(settlement.discovered).toEqual([]);
    expect({ ...settlement.overseer.attributes, improvisation: 12 }).toEqual(before.attributes);
  });

  it('§F2: every attribute is trainable, and training stops at the ceiling', () => {
    const { repos } = fakeRepos();
    const maxed = makeOverseer({ attributes: makeAttributes(MAX_ATTRIBUTE) });
    expect(
      startResearch(repos, {
        base: makeBase(),
        overseer: maxed,
        project: { kind: 'training', attribute: 'chemistry' },
        id: 'r',
        now: NOW,
      }),
    ).toEqual({ kind: 'refused', reason: 'nothing_to_learn' });
    expect(developAttribute(maxed.attributes, 'chemistry').chemistry).toBe(MAX_ATTRIBUTE);
  });

  it('never files the same fact twice, however long a crew grinds', () => {
    const bright = professor('b', CROSS_REFERENCE_IMPROVISATION, EXTRA_FACT_COMMUNICATION);
    let state = makeBase({ commanders: [bright] });
    for (let run = 0; run < 40; run += 1) {
      const { repos } = fakeRepos();
      const project = investigate('b', true);
      const started = startResearch(repos, {
        base: { ...state, resources: { ...state.resources, caps: 5000 } },
        overseer,
        project,
        id: `r-${run}`,
        now: NOW,
      });
      if (started.kind !== 'started') break;
      state = settleResearch(
        repos,
        started.base,
        overseer,
        new Date(NOW.getTime() + RESEARCH_MINUTES.investigation * MINUTE_MS),
      ).base;
    }
    const keys = state.research.facts.map((fact) => JSON.stringify(fact));
    expect(new Set(keys).size).toBe(keys.length);
    expect(roleFactsIn(state.research.facts, 'head_spy')).toHaveLength(MAX_ROLE_FACTS);
    expect(pairingsIn(state.research.facts).length).toBeLessThanOrEqual(MAX_PAIRINGS);
  });
});

describe('§F5: the Overseer modifies a run that risks people', () => {
  const battle = findMissionTemplate('foundry-raid');
  const standard = findMissionTemplate('scrap-run');
  if (!battle || !standard) throw new Error('expected both mission kinds on the board');

  it('is exactly the board’s worked example: Speed and Stealth, on a raid', () => {
    expect(MISSION_EDGE_ATTRIBUTES.battle).toEqual(['speed', 'stealth']);
    expect(MISSION_EDGE_ATTRIBUTES.standard).toEqual([]);
  });

  it('raises the chance for a fast, quiet Overseer and lowers it for a slow, loud one', () => {
    const sharp = makeAttributes(10, { speed: MAX_ATTRIBUTE, stealth: MAX_ATTRIBUTE });
    const clumsy = makeAttributes(10, { speed: 0, stealth: 0 });

    expect(overseerMissionEdge(sharp, 'battle')).toBeCloseTo(MAX_MISSION_EDGE, 10);
    expect(overseerMissionEdge(clumsy, 'battle')).toBeLessThan(0);
    expect(modifiedSuccessChance(battle.successChance, sharp, 'battle')).toBeGreaterThan(
      battle.successChance,
    );
    expect(modifiedSuccessChance(battle.successChance, clumsy, 'battle')).toBeLessThan(
      battle.successChance,
    );
  });

  it('leaves a standard run and an average Overseer alone', () => {
    const sharp = makeAttributes(10, { speed: MAX_ATTRIBUTE, stealth: MAX_ATTRIBUTE });
    expect(modifiedSuccessChance(standard.successChance, sharp, 'standard')).toBe(
      standard.successChance,
    );
    // Zero at the recruitment mean, so the board's authored chances still mean what they say.
    expect(overseerMissionEdge(makeAttributes(15), 'battle')).toBe(0);
  });

  it('never leaves 0..1, whatever the sheet says', () => {
    const sharp = makeAttributes(MAX_ATTRIBUTE);
    const clumsy = makeAttributes(0);
    for (const chance of [0, 0.02, 0.5, 0.99, 1]) {
      expect(modifiedSuccessChance(chance, sharp, 'battle')).toBeLessThanOrEqual(1);
      expect(modifiedSuccessChance(chance, clumsy, 'battle')).toBeGreaterThanOrEqual(0);
    }
  });

  it('freezes the modified chance onto the row at launch', () => {
    const base = makeBase();
    const sharp = makeOverseer({
      attributes: makeAttributes(10, { speed: MAX_ATTRIBUTE, stealth: MAX_ATTRIBUTE }),
    });
    const args = { areaId: MISC_AREA_ID, force: { razors: 1 } };
    const stored = launchMission({
      id: 'm',
      base,
      template: battle,
      now: NOW,
      overseer: sharp,
      ...args,
    });
    expect(stored.successChance).toBe(
      modifiedSuccessChance(battle.successChance, sharp.attributes, 'battle'),
    );
    // No Overseer means the template's authored chance, untouched: the pre-§F5 behaviour.
    expect(
      launchMission({ id: 'm', base, template: battle, now: NOW, ...args }).successChance,
    ).toBe(battle.successChance);
  });
});

describe('GET /research and POST /research', () => {
  const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

  afterEach(async () => {
    for (const { app, db } of instances.splice(0)) {
      await app.close();
      db.close();
    }
  });

  async function makeApp(): Promise<FastifyInstance> {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });
    return app;
  }

  async function makePlayer(app: FastifyInstance, username: string): Promise<string> {
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'hunter2pass' },
    });
    expect(register.statusCode).toBe(201);
    const token = register.json<{ token: string }>().token;
    const overseer = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: { authorization: `Bearer ${token}` },
      payload: { presetId: 'technocrat' },
    });
    expect(overseer.statusCode).toBe(201);
    return token;
  }

  const read = async (app: FastifyInstance, token: string): Promise<ResearchResponse> => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/research',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    return res.json<ResearchResponse>();
  };

  it('serves an empty, well-formed page to a crew that has never researched', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'researcher');
    const body = await read(app, token);

    expect(body.facts).toEqual([]);
    expect(body.active).toBeNull();
    expect(body.completesAt).toBeNull();
    expect(body.leads, 'a fresh crew has no Professor').toEqual([]);
    expect(body.openRoles.length).toBeGreaterThan(0);
    expect(body.costs).toEqual(RESEARCH_COST_CAPS);
    expect(body.overseerAttributes.improvisation).toBeGreaterThan(0);
  });

  it('refuses a project the crew has nobody to run', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'nolead');
    const res = await app.inject({
      method: 'POST',
      url: '/api/research',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        kind: 'investigation',
        role: 'head_spy',
        leadOfficerId: 'nobody',
        crossReference: false,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NO_RESEARCH_LEAD');
  });

  it('§F2: a training project runs end to end and moves the Overseer sheet on the read path', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'trainee');
    const before = await read(app, token);
    const target = 'encyclopedia';

    const started = await app.inject({
      method: 'POST',
      url: '/api/research',
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: 'training', attribute: target },
    });
    expect(started.statusCode).toBe(200);
    const active = started.json<{ active: ActiveResearch }>().active;

    // Mid-flight the page shows it running and the sheet is untouched.
    const during = await read(app, token);
    expect(during.active?.id).toBe(active.id);
    expect(during.overseerAttributes[target]).toBe(before.overseerAttributes[target]);
    expect(during.justDiscovered).toEqual([]);

    // Rewind the start so the clock has run out, then read again: the settle path is the only
    // thing that can bank it, and this is the read that has to prove it did.
    const past = new Date(NOW.getTime() - RESEARCH_MINUTES.training * MINUTE_MS * 2).toISOString();
    app.repos.bases.updateResearch(app.repos.bases.findByOwnerId(userIdOf(app, token))!.id, {
      active: { ...active, startedAt: past },
      facts: [],
      technologies: [],
    });

    const after = await read(app, token);
    expect(after.active, 'the slot is free again').toBeNull();
    expect(after.overseerAttributes[target]).toBe(before.overseerAttributes[target] + 1);
  });

  it('§B9: an investigation lands facts on the wire, and only discovered ones', async () => {
    const app = await makeApp();
    const token = await makePlayer(app, 'digger');
    const baseId = app.repos.bases.findByOwnerId(userIdOf(app, token))!.id;

    // Hire a Professor the direct way: the Bar's roster is a different feature's gate.
    const lead = professor('prof-1', CROSS_REFERENCE_IMPROVISATION, EXTRA_FACT_COMMUNICATION);
    app.repos.bases.updateCommanders(baseId, [lead]);

    const withLead = await read(app, token);
    expect(withLead.leads).toEqual([
      { officerId: 'prof-1', name: lead.name, role: 'professor', crossReference: true },
    ]);

    const started = await app.inject({
      method: 'POST',
      url: '/api/research',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        kind: 'investigation',
        role: 'head_spy',
        leadOfficerId: 'prof-1',
        crossReference: true,
      },
    });
    expect(started.statusCode).toBe(200);

    const active = started.json<{ active: ActiveResearch }>().active;
    const past = new Date(
      Date.now() - RESEARCH_MINUTES.investigation * MINUTE_MS * 2,
    ).toISOString();
    app.repos.bases.updateResearch(baseId, {
      active: { ...active, startedAt: past },
      facts: [],
      technologies: [],
    });

    const settled = await read(app, token);
    // Two role facts (Communication) plus a pairing (Imagination): §F3 and §F4 on one run.
    expect(settled.justDiscovered).toHaveLength(3);
    expect(settled.facts).toEqual(settled.justDiscovered);
    expect(roleFactsIn(settled.facts, 'head_spy')).toHaveLength(2);
    expect(pairingsIn(settled.facts)).toHaveLength(1);

    // The response-body half of INTERFACES R4, over the real route: nothing but facts.
    //
    // The §A1 modification catalogue is lifted out first. It is authored English about *buildings*,
    // byte-identical for every crew and derived from nothing a crew has learnt, so it cannot carry
    // role knowledge, but a substring scan over English collides with it on sight ("graFFITi"
    // contains "fit"). Excluding it keeps this scan meaningful instead of forcing the prose to
    // avoid seven letter sequences; the test below is the catalogue's own guard.
    const { modifications: _catalogue, ...roleReachable } = settled;
    const serialized = JSON.stringify(roleReachable);
    for (const banned of ['affinity', 'weight', 'fit', 'suitability', 'star', 'score', 'rank']) {
      expect(serialized.toLowerCase(), `the research response mentions "${banned}"`).not.toContain(
        banned,
      );
    }
  });

  it('§A1: the modification catalogue names no role, and is the same for every crew', async () => {
    const app = await makeApp();
    const novice = await read(app, await makePlayer(app, 'mod_novice'));

    // Structural, not lexical. Scanning the prose for the nineteen role words is what the rest of
    // this suite does and it cannot work here: the board's own "Precision Fabricators" contains
    // `fabricator`, and it is a machine tool, not the officer post. What matters is not which
    // English words appear. It is that no *field* is keyed by a role and that nothing in the
    // catalogue moves with what a crew has learnt. Both are checked directly.
    const ROLE_VALUES = new Set<string>(OFFICER_ROLES);
    for (const option of novice.modifications) {
      // Every key is from the fixed DTO, and none of them is `role`.
      expect(Object.keys(option).sort()).toEqual([
        'blocker',
        'building',
        'description',
        'effect',
        'id',
        'installed',
        'magnitude',
        'name',
      ]);
      // And no value *is* a role id, which is the shape a leak would actually take.
      for (const value of Object.values(option)) {
        expect(ROLE_VALUES.has(String(value)), `${option.id} carries a role id`).toBe(false);
      }
    }

    // It does not move with what a crew knows: a fresh account and one that has researched see
    // the same sixty-five entries, differing only in the two per-crew fields.
    const veteran = await makePlayer(app, 'mod_veteran');
    const veteranId = userIdOf(app, veteran);
    const baseId = app.repos.bases.findByOwnerId(veteranId)!.id;
    app.repos.bases.updateResearch(baseId, {
      active: null,
      facts: [{ kind: 'role_attribute', role: 'head_spy', attribute: 'stealth' }],
      technologies: [],
    });

    const shape = (options: typeof novice.modifications) =>
      options.map(({ blocker: _b, installed: _i, ...rest }) => rest);
    expect(shape((await read(app, veteran)).modifications)).toEqual(shape(novice.modifications));
  });

  function userIdOf(app: FastifyInstance, token: string): string {
    return app.jwt.decode<{ sub: string }>(token)!.sub;
  }
});

/**
 * The third clock, and the third call site.
 *
 * `PLAYER_XP_AWARDS` calls research "the longest single commitment in the game", and it paid a flat
 * 150 whether the project ran forty-five minutes or three hours. Asserted as the ratio between two
 * kinds rather than as a figure, because the settlement also adds the lead's charisma on top and
 * that is a different rule this test has no business pinning.
 */
describe('a project pays XP off its own clock (§I1)', () => {
  const lead = professor('prof-xp', 10, 10);
  const overseer = makeOverseer();

  const xpFor = (project: ResearchProject) => {
    const settled = runToCompletion(makeBase({ commanders: [lead] }), overseer, project);
    expect(settled.awards).toHaveLength(1);
    return settled.awards[0]!.xpGained;
  };

  it('pays a three-hour modification more than a forty-five-minute investigation', () => {
    const quick = xpFor({
      kind: 'investigation',
      role: 'head_spy',
      leadOfficerId: lead.id,
      crossReference: false,
    });
    const long = xpFor({ kind: 'training', attribute: 'logic' });

    expect(RESEARCH_MINUTES.training).toBeGreaterThan(RESEARCH_MINUTES.investigation);
    expect(long).toBeGreaterThan(quick);
    // The curve, not a step: twice the clock is roughly 2^0.8 of the pay.
    expect(long / quick).toBeCloseTo(
      (RESEARCH_MINUTES.training / RESEARCH_MINUTES.investigation) ** 0.8,
      1,
    );
  });
});
