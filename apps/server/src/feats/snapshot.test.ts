import {
  BLUEPRINTS,
  FEATS,
  FEAT_MEASURE_SPECS,
  ITEM_CATALOG,
  MAX_ATTRIBUTE,
  featMeasureKey,
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
  type ItemId,
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
    trainingQueue: [],
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
   * It counted every inventory item of `kind: 'blueprint'`, and six of the seventy-four such items
   * are pre-war collectibles the item catalogue itself describes as "Nothing the Lab can use". Four
   * of those are on the Black Market for infamy, so 440 infamy claimed the first rung of the
   * blueprint ladder with no page ever found and no document ever assembled.
   */
  it('counts the documents a crew has unlocked, and not the pre-war collectibles', () => {
    const base = repos.bases.findByOwnerId(OWNER)!;
    const read = () => snapshotFor(repos, repos.bases.findByOwnerId(OWNER)!)['blueprints_unlocked'];

    expect(read()).toBe(0);

    // Two of the collectibles. Both are `kind: 'blueprint'`, both are bought rather than assembled,
    // and the catalogue's own `usedFor` says the Lab can do nothing with either.
    const paper: ItemId[] = ['blueprint_cybernetics', 'blueprint_munitions'];
    for (const id of paper) expect(ITEM_CATALOG[id].kind).toBe('blueprint');
    const collectibles = Object.fromEntries(paper.map((id) => [id, 1]));
    repos.bases.updateHoldings(base.id, base.resources, collectibles);
    expect(read(), 'a collectible is not an unlocked document').toBe(0);

    // And one document the crew really did assemble, alongside the paper it bought.
    const document = BLUEPRINTS[0];
    repos.bases.updateHoldings(base.id, base.resources, {
      ...collectibles,
      [document.id]: 1,
    });
    expect(read()).toBe(1);
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
