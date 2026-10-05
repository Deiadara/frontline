import {
  BLUEPRINTS,
  DEFAULT_BADGE,
  FEATS,
  FEAT_MEASURE_SPECS,
  MAX_ATTRIBUTE,
  featMeasureKey,
  findDistrict,
  levelCeilingFor,
  type BuildingKind,
  findOverseerPreset,
  makeAttributes,
  overseerFromPreset,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type LocationHolder,
  unitSlotsUsed,
} from '@frontline/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { snapshotFor } from './project.js';

/**
 * Every feat in the catalogue has to be *measurable*.
 *
 * This is the failure mode the whole feats feature is most exposed to and the one hardest to
 * notice. A feat is a threshold on a named number; if nothing ever produces that number under that
 * exact key, the feat sits at zero for the life of the account with every other test green. There
 * are two hundred of them, and nobody is going to spot the one whose scope was spelled
 * `high_quality_metal` where the game says `highQualityMetal`.
 *
 * The two halves of the vocabulary fail differently, so they are checked differently:
 *
 *   * **crew** measures are read off the state on every request, so the snapshot must contain the
 *     key. A missing key here is a permanently dead feat, and that is what the first test pins.
 *   * **tally** measures are counters that only exist once something has bumped them, so a missing
 *     key is the ordinary state of a new crew and proves nothing. What can be checked is that the
 *     catalogue never asks for a tally under a scope the tally vocabulary cannot produce, which is
 *     the spelling half of the same bug.
 */

let db: AppDatabase;
let repos: Repositories;

const T0 = new Date('2026-09-13T12:00:00.000Z');
const OWNER = 'owner-1';

function makeBase(): Base {
  const now = T0.toISOString();
  return {
    id: 'base-1',
    ownerId: OWNER,
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 20,
    isBot: false,
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, planks: 0, highQualityMetal: 0 },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'b-nexus', kind: 'nexus', level: 3, modifications: [] }],
    buildQueue: [],
    army: {},
    musterQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repos = createRepositories(db);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'one', 'x', ?)`,
  ).run(OWNER, T0.toISOString());
  repos.bases.insert(makeBase());
});

describe('the numbers a feat can be measured on', () => {
  /**
   * The load-bearing one.
   *
   * Deliberately run against a *bare* crew rather than a fully kitted one. A crew that holds one
   * of everything would produce a key for everything and hide exactly the defect this is for: the
   * snapshot has to enumerate the whole vocabulary, including the scopes nothing has touched yet,
   * because a feat's progress bar has to read `0 / 3,000,000` and not go missing.
   */
  it('produces a reading for every crew-measured feat, on a crew that has done nothing', () => {
    const snapshot = snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!);
    const missing = FEATS.filter(
      (feat) =>
        FEAT_MEASURE_SPECS[feat.measure].source === 'crew' &&
        snapshot[featMeasureKey(feat.measure, feat.scope)] === undefined,
    ).map((feat) => `${feat.id} wants ${featMeasureKey(feat.measure, feat.scope)}`);

    expect(missing, missing.join('\n')).toEqual([]);
  });

  /**
   * A scope is only ever a thing the game already names.
   *
   * `catalog.test.ts` checks this against the shared vocabularies, which is the same check from
   * the other side. It is repeated here against the *snapshot's* own key space because the two
   * could agree that `oil` is a resource and still disagree about what the key is called, and a
   * key mismatch is invisible to both halves on their own.
   */
  it('spells every scope the way the reader spells it', () => {
    const snapshot = snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!);
    const known = new Set(Object.keys(snapshot));
    const scoped = FEATS.filter(
      (feat) => feat.scope !== undefined && FEAT_MEASURE_SPECS[feat.measure].source === 'crew',
    );
    // A guard on the guard: if the catalogue ever stopped scoping crew measures this test would
    // pass by having nothing to check.
    expect(scoped.length).toBeGreaterThan(10);
    for (const feat of scoped) {
      expect(known.has(featMeasureKey(feat.measure, feat.scope)), feat.id).toBe(true);
    }
  });

  /**
   * The deck measures count, rather than merely existing.
   *
   * The test above proves the snapshot carries a key for every crew measure, which is enough to
   * catch a feat nobody can ever make progress on and is not enough to catch one that reads the
   * wrong thing. A producer wired to `buildings.length` would satisfy it and still be wrong on
   * every crew that owns a building.
   *
   * Three fittings of one family in one structure is deliberately the fixture: it is one number
   * for `modifications_fitted` and a different number for `modification_sets`, so a producer that
   * confused the two cannot pass, and a fourth card of another family breaks the set without
   * changing the count of cards, which separates them again in the other direction.
   */
  it('counts what is fitted, and separately what is a set', () => {
    const base = repos.bases.findByOwnerId(OWNER)!;
    const fitted = () =>
      snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)['modifications_fitted'];
    const sets = () => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)['modification_sets'];

    expect(fitted()).toBe(0);
    expect(sets()).toBe(0);

    // A structure at twenty, which is what three open slots costs.
    const yard = (modifications: string[]) => {
      repos.bases.updateBuildings(base.id, [
        { id: 'b-yard', kind: 'scrapyard', level: 20, modifications },
      ]);
    };

    yard(['scrapyard_precision_fabricators']);
    expect(fitted()).toBe(1);
    // One card is not a set however committed it looks: the slots have to be full.
    expect(sets()).toBe(0);

    yard([
      'scrapyard_precision_fabricators',
      'scrapyard_magnetic_sorting_line',
      'scrapyard_press_automation',
    ]);
    expect(fitted()).toBe(3);
    expect(sets()).toBe(1);

    // Same three slots, one of them spent on another family. The fittings do not move; the set is
    // gone, because a set is a structure built around one idea and this one is built around two.
    yard([
      'scrapyard_precision_fabricators',
      'scrapyard_magnetic_sorting_line',
      'scrapyard_salvage_drones',
    ]);
    expect(fitted()).toBe(3);
    expect(sets()).toBe(0);
  });

  /**
   * A structure is finished against **its own** ceiling, which is not one number.
   *
   * The Garage stops at 10 and the Nexus at 20 (`building/kinds.ts`), so a reader holding one flat
   * `BUILDING_MAX_LEVEL` reports a Garage that can never be built any higher as unfinished for
   * ever, and the last rung of the ladder, which asks for all eleven, is a feat nobody can collect.
   * The fixture is exactly that pair: a Garage at its own ceiling and a Nexus at the Garage's,
   * which is one for this measure under the right rule and zero or two under either wrong one.
   */
  it('counts the structures with nowhere left to build, each against its own ceiling', () => {
    const base = repos.bases.findByOwnerId(OWNER)!;
    const read = () => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)['buildings_maxed'];
    const stand = (buildings: { id: string; kind: BuildingKind; level: number }[]) => {
      repos.bases.updateBuildings(
        base.id,
        buildings.map((one) => ({ ...one, modifications: [], damage: 0 })),
      );
    };

    expect(levelCeilingFor('garage'), 'the fixture assumes the Garage stops first').toBeLessThan(
      levelCeilingFor('nexus'),
    );

    stand([
      { id: 'b-garage', kind: 'garage', level: levelCeilingFor('garage') },
      { id: 'b-nexus', kind: 'nexus', level: levelCeilingFor('garage') },
    ]);
    expect(read(), 'the Nexus has eleven levels left in it').toBe(1);

    stand([
      { id: 'b-garage', kind: 'garage', level: levelCeilingFor('garage') },
      { id: 'b-nexus', kind: 'nexus', level: levelCeilingFor('nexus') },
    ]);
    expect(read()).toBe(2);

    // And it goes back down, which is what makes it a crew measure: a structure can be dismantled.
    stand([{ id: 'b-nexus', kind: 'nexus', level: levelCeilingFor('nexus') }]);
    expect(read()).toBe(1);
  });

  /**
   * `blueprints_unlocked` is documents assembled, not paper on a shelf.
   *
   * It once counted every inventory item of `kind: 'blueprint'`, which took in six pre-war
   * collectibles that opened nothing; 440 infamy at the fence claimed the first rung with no page
   * ever found. Those were retired on 2026-09-28 and the fence now sells real documents, which do
   * count: a document bought whole is as unlocked as one assembled. A loose page does not.
   */
  it('counts the documents a crew has unlocked, bought or assembled, and not its pages', () => {
    const base = repos.bases.findByOwnerId(OWNER)!;
    const read = () => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)['blueprints_unlocked'];

    expect(read()).toBe(0);

    const assembled = BLUEPRINTS[0];
    const page = assembled.pages[0].id;
    repos.bases.updateHoldings(base.id, base.resources, { [page]: 1 });
    expect(read(), 'a page is not an unlocked document').toBe(0);

    repos.bases.updateHoldings(base.id, base.resources, {
      [page]: 1,
      [assembled.id]: 1,
      bp_fence_rotor_drop_rig: 1,
    });
    expect(read()).toBe(2);
  });

  /**
   * The unit bench's two measures count what is in the brackets, and only what the catalogue knows.
   *
   * One fixture separates them: three cards fitted, one of them a masterpiece, is 3 for one measure
   * and 1 for the other, so a producer that confused the two cannot pass. A retired refit id in a
   * bracket counts for nothing, which is what it pays.
   */
  it('counts the cards in unit brackets, and separately the masterpieces among them', () => {
    const base = repos.bases.findByOwnerId(OWNER)!;
    const read = (key: string) => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)[key];

    expect(read('unit_modifications_fitted')).toBe(0);
    expect(read('masterpieces_fitted')).toBe(0);

    repos.bases.updateUnitLoadouts(base.id, {
      razors: ['taped_grips', 'hardshell_exoframe', null],
      sparks: ['filed_sights'],
    });
    expect(read('unit_modifications_fitted')).toBe(3);
    expect(read('masterpieces_fitted')).toBe(1);

    // Burned off again: a crew measure goes down, a tally would not have.
    repos.bases.updateUnitLoadouts(base.id, { razors: ['taped_grips', null, null] });
    expect(read('unit_modifications_fitted')).toBe(1);
    expect(read('masterpieces_fitted')).toBe(0);
  });

  // Bug pass, 2026-10-02: the gate is the district's own door, so units stood there are at home.
  it('counts the army at the gate with the army at home', () => {
    const base = repos.bases.findByOwnerId(OWNER)!;
    const read = (key: string) => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)[key];
    repos.bases.updateArmy(base.id, { razors: 3 }, []);
    repos.bases.updateGateArmy(base.id, { razors: 2, sparks: 4 });

    expect(read('army_units')).toBe(9);
    expect(read('unit_kinds_held')).toBe(2);
    expect(read('army_unit_slots')).toBe(unitSlotsUsed({ razors: 5, sparks: 4 }));
  });

  // P3-D, 2026-10-02: a recruit at a table with a long record starts at nought.
  it("reads the faction ladder off the member's own share, not the table's record", () => {
    const read = (key: string) => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)[key];
    db.prepare(
      `INSERT INTO users (id, username, password_hash, created_at) VALUES ('veteran', 'two', 'x', ?)`,
    ).run(T0.toISOString());
    repos.factions.insert({
      id: 'the-table',
      name: 'The Table',
      badge: DEFAULT_BADGE,
      blurb: '',
      foundedAt: T0.toISOString(),
    });
    for (const [userId, rank] of [
      ['veteran', 'leader'],
      [OWNER, 'member'],
    ] as const) {
      repos.factions.addMember({
        userId,
        factionId: 'the-table',
        rank,
        joinedAt: T0.toISOString(),
      });
    }
    repos.factions.addInfamyEarned('veteran', 300_000);
    expect(read('faction_infamy')).toBe(0);

    repos.factions.addInfamyEarned(OWNER, 450);
    expect(read('faction_infamy')).toBe(450);
  });

  // P8-C, 2026-10-02: the best-worked holding, and nothing for ground somebody else holds.
  it('reads the highest level among the locations the crew holds', () => {
    const base = repos.bases.findByOwnerId(OWNER)!;
    const read = (key: string) => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)[key];
    const [first, second, third] = [...repos.city.controls().values()];
    if (!first || !second || !third) throw new Error('fixture: too few control rows');
    const mine = { kind: 'crew', baseId: base.id } as const;
    repos.city.put({ ...first, holder: mine, level: 3 });
    repos.city.put({ ...second, holder: mine, level: 6 });
    repos.city.put({ ...third, holder: { kind: 'crew', baseId: 'somebody-else' }, level: 9 });

    expect(read('location_level_held')).toBe(6);
  });

  // P2-A, 2026-10-02: the slot ladder and "kinds held" count every unit on the books; "Twenty at
  // Home" (`army_units`) stays at home and the gate.
  it('counts a garrison on held ground for slots and kinds, but not as units at home', () => {
    const base = repos.bases.findByOwnerId(OWNER)!;
    const read = (key: string) => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)[key];
    repos.bases.updateArmy(base.id, { razors: 3 }, []);
    const [held] = [...repos.city.controls().values()];
    if (!held) throw new Error('fixture: no control rows');
    repos.city.put({
      ...held,
      holder: { kind: 'crew', baseId: base.id },
      garrison: { wardens: 4 },
    });

    expect(read('army_units')).toBe(3);
    expect(read('unit_kinds_held')).toBe(2);
    expect(read('army_unit_slots')).toBe(unitSlotsUsed({ razors: 3, wardens: 4 }));
  });

  /**
   * The Overseer thresholds come off the catalogue, so a new one is wired by writing the feat.
   *
   * `overseer_skills_at` is the only measure whose scope is an open-ended number rather than a
   * member of a fixed vocabulary, which makes it the one that can be asked a question the reader
   * was never told about. Adding the `70` feat was exactly that, so this pins the derivation
   * rather than the two values that happen to exist today.
   */
  it('answers every Overseer threshold the catalogue asks about, with a count that moves', () => {
    const asked = FEATS.filter((feat) => feat.measure === 'overseer_skills_at');
    expect(asked.length).toBeGreaterThan(1);
    const keys = asked.map((feat) => featMeasureKey(feat.measure, feat.scope));

    // No Overseer yet: every threshold is asked and every answer is nothing. This is the control
    // for the count below, and the half that catches a key that is filled in but never read.
    const nobody = snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!);
    for (const key of keys) expect(nobody[key], key).toBe(0);
    expect(nobody[featMeasureKey('overseer_best_skill')]).toBe(0);

    /*
     * Exactly two skills at the ceiling and the rest at nothing, so the answer to every threshold
     * the catalogue could ask (they are all between 1 and the ceiling) is the literal 2. The
     * previous version of this only asked that the key exist, and `snapshotFor` fills exactly the
     * keys the same catalogue names, so it could not fail: a reader hard-coded to zero was green.
     */
    const preset = findOverseerPreset('enforcer');
    if (!preset) throw new Error('fixture: no enforcer preset');
    const sheet = { ...makeAttributes(0), cryptography: MAX_ATTRIBUTE, stamina: MAX_ATTRIBUTE };
    const overseer = { ...overseerFromPreset(preset, 'ov-1'), attributes: sheet };
    repos.overseers.insert({
      overseer,
      userId: OWNER,
      presetId: preset.presetId,
      createdAt: T0.toISOString(),
    });
    repos.users.setOverseerId(OWNER, overseer.id);

    const somebody = snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!);
    for (const key of keys) expect(somebody[key], key).toBe(2);
    expect(somebody[featMeasureKey('overseer_best_skill')]).toBe(MAX_ATTRIBUTE);
  });
});

/**
 * The two Combine measures that are read rather than counted (`city/combine.ts`).
 *
 * Both come off the control map, and each fixture is built to separate the measure from the one it
 * could be confused with: a whole district that was never the regime's for `combine_districts_held`,
 * and a Spire held everywhere except the Chapel for `chapel_held`. A producer wired to
 * `districts_held_whole`, or to "holds anything in the CCS", passes the existence test above and
 * fails here.
 */
describe('the Combine measures', () => {
  const read = (key: string) => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)[key];
  /** Rewrites who stands on each location, garrison cleared, everything else as it was. */
  const give = (locationIds: readonly string[], holder: LocationHolder) => {
    const controls = repos.city.controls();
    for (const locationId of locationIds) {
      const control = controls.get(locationId);
      if (!control) throw new Error(`fixture: no control row for ${locationId}`);
      repos.city.put({ ...control, holder, garrison: {} });
    }
  };
  const mine: LocationHolder = { kind: 'crew', baseId: 'base-1' };

  it('counts a whole district only where the regime held it', () => {
    const docks = findDistrict('neon-docks');
    const row = findDistrict('chrome-row');
    if (!docks || !row) throw new Error('fixture: the Docks and Chrome Row are on the map');
    // The pair the test turns on: one of the six the Combine holds, one it never did.
    expect(docks.allegiance).toBe('government');
    expect(row.allegiance).toBe('independent');
    const plots = (district: typeof docks) => district.locations.map((location) => location.id);

    expect(read('combine_districts_held')).toBe(0);

    give(plots(row), mine);
    expect(read('districts_held_whole')).toBe(1);
    expect(read('combine_districts_held'), 'Chrome Row was never the Combine’s').toBe(0);

    // All but one plot of the Docks: a district is held whole or not at all.
    give(plots(docks).slice(1), mine);
    expect(read('combine_districts_held'), 'three plots of four is not the district').toBe(0);

    give(plots(docks).slice(0, 1), mine);
    expect(read('combine_districts_held')).toBe(1);
    expect(read('districts_held_whole')).toBe(2);

    // And it falls when the regime walks back into one plot, which is what makes it a crew measure.
    give(plots(docks).slice(0, 1), { kind: 'government' });
    expect(read('combine_districts_held')).toBe(0);
  });

  it('reads the Chapel off its own row, whoever holds the rest of the Spire', () => {
    const spire = findDistrict('ccs');
    if (!spire) throw new Error('fixture: the CCS is on the map');
    const chapel = 'ccs-chapel';
    const rest = spire.locations.map((location) => location.id).filter((id) => id !== chapel);
    expect(spire.locations.map((location) => location.id)).toContain(chapel);
    expect(rest.length, 'the Spire has more than the Chapel on it').toBeGreaterThan(0);

    expect(read('chapel_held')).toBe(0);

    give(rest, mine);
    expect(read('chapel_held'), 'the rest of the Spire is not the Chapel').toBe(0);

    give([chapel], mine);
    expect(read('chapel_held')).toBe(1);

    // Somebody else's now: held, and not by this crew.
    give([chapel], { kind: 'looters' });
    expect(read('chapel_held')).toBe(0);
  });
});

/**
 * The frontier measures (2026-09-24), which are the five that had to decide what city they meant.
 *
 * Until Terminus opened, `locations_held`, `combine_districts_held` and `chapel_held` were all
 * read off Ashfall's own arrays, so a crew that had taken half the second city was told it held
 * nothing, had taken nothing off the regime and was standing on no chapel. Nothing failed: the
 * catalogue's ceilings were derived from the same Ashfall arrays, so the board agreed with itself
 * and disagreed with the map.
 *
 * Every fixture here puts the crew's ground in the **other** city, because that is the case the
 * old readers answered zero for, and each one also holds a piece of ground at home, so a reader
 * that swapped the two cities over cannot pass either.
 */
describe('the second city', () => {
  const read = (key: string) => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)[key];
  const give = (locationIds: readonly string[], holder: LocationHolder) => {
    const controls = repos.city.controls();
    for (const locationId of locationIds) {
      const control = controls.get(locationId);
      if (!control) throw new Error(`fixture: no control row for ${locationId}`);
      repos.city.put({ ...control, holder, garrison: {} });
    }
  };
  const mine: LocationHolder = { kind: 'crew', baseId: 'base-1' };
  /** A district by id, or a failure that names it: these are fixtures, not optional ground. */
  const district = (districtId: string) => {
    const found = findDistrict(districtId);
    if (!found) throw new Error(`fixture: ${districtId} is not on the map`);
    return found;
  };
  const places = (districtId: string) => district(districtId).locations.map((one) => one.id);
  const firstOfKind = (districtId: string, kind: string) => {
    const found = district(districtId).locations.find((one) => one.kind === kind);
    if (!found) throw new Error(`fixture: ${districtId} has no ${kind}`);
    return found.id;
  };

  it('counts a holding in the other city, and knows it is not at home', () => {
    // Kettle Row is in Ashfall, and the crew never moves house: a foothold abroad is ground taken.
    expect(findDistrict('kettle-row')?.cityId).toBe('ashfall');
    expect(district('coldwater-halt').cityId).toBe('terminus');

    expect(read('locations_held')).toBe(0);
    expect(read('locations_held_abroad')).toBe(0);
    expect(read('cities_held')).toBe(0);

    give([firstOfKind('coldwater-halt', 'market')], mine);
    expect(read('locations_held'), 'a holding is a holding wherever it stands').toBe(1);
    expect(read('locations_held_abroad')).toBe(1);
    expect(read('cities_held'), 'ground in one city, and it is not the one they live in').toBe(1);

    give([places('chrome-row')[0]!], mine);
    expect(read('locations_held')).toBe(2);
    expect(read('locations_held_abroad'), 'the second one is at home').toBe(1);
    expect(read('cities_held')).toBe(2);

    // And it falls, which is what makes these crew measures: ground abroad can be taken back.
    give([firstOfKind('coldwater-halt', 'market')], { kind: 'looters' });
    expect(read('locations_held_abroad')).toBe(0);
    expect(read('cities_held')).toBe(1);
  });

  /**
   * The railway is one location kind, and holding a platform is the whole of owning a line.
   *
   * The fixture holds a Station and a warehouse in the same city, which is the pair that separates
   * `rail_stations_held` from `locations_held`: a reader wired to "anything in Terminus" counts
   * two and a reader wired to the kind counts one.
   */
  it('counts the Stations a crew holds, and not the rest of the city', () => {
    expect(read('rail_stations_held')).toBe(0);

    give([firstOfKind('coldwater-halt', 'rail_station')], mine);
    expect(read('rail_stations_held')).toBe(1);

    give([firstOfKind('bonded-row', 'downtown_market')], mine);
    expect(read('rail_stations_held'), 'a warehouse is not a platform').toBe(1);
    expect(read('locations_held')).toBe(2);

    // Two is the number the train needs: `railwayOffer` refuses anything under it.
    give([firstOfKind('bonded-row', 'rail_station')], mine);
    expect(read('rail_stations_held')).toBe(2);
  });

  it('counts a whole district abroad separately from one at home', () => {
    expect(read('districts_held_whole_abroad')).toBe(0);

    give(places('coldwater-halt'), mine);
    expect(read('districts_held_whole'), 'the whole of a Terminus district').toBe(1);
    expect(read('districts_held_whole_abroad')).toBe(1);

    give(places('chrome-row'), mine);
    expect(read('districts_held_whole')).toBe(2);
    expect(read('districts_held_whole_abroad'), 'Chrome Row is home ground').toBe(1);
  });

  /**
   * The regime is one opponent with ground in two cities.
   *
   * The Blockhouse is Combine ground in Terminus and Chrome Row is independent ground in Ashfall,
   * so a reader that counted Ashfall alone answers zero here and a reader that counted every
   * district held whole answers two.
   */
  it('counts the regime’s ground wherever the regime holds it', () => {
    expect(district('blockhouse').allegiance).toBe('government');
    expect(district('chrome-row').allegiance).toBe('independent');

    give(places('chrome-row'), mine);
    expect(read('combine_districts_held'), 'Chrome Row was never theirs').toBe(0);

    give(places('blockhouse'), mine);
    expect(read('districts_held_whole')).toBe(2);
    expect(read('combine_districts_held')).toBe(1);
  });

  /**
   * Two chapels, a city apart, on a measure that was written when there was one.
   *
   * `chapel_held` read Ashfall's locations, so holding the Frontier Chapel inside Control counted
   * for nothing while the feat's own sentence said "the regime's headquarters". The ladder in the
   * catalogue now ends on both, and this is the reader that has to be able to reach two.
   */
  it('reads both of the regime’s chapels', () => {
    const chosen = firstOfKind('ccs', 'combine_chapel');
    const frontier = firstOfKind('blockhouse', 'combine_chapel');

    expect(read('chapel_held')).toBe(0);

    give([frontier], mine);
    expect(read('chapel_held'), 'the Frontier Chapel is a chapel').toBe(1);

    give([chosen], mine);
    expect(read('chapel_held')).toBe(2);

    give([frontier], { kind: 'government' });
    expect(read('chapel_held')).toBe(1);
  });
});
