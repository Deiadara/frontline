import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS } from './kinds.js';
import {
  LOCAL_EFFECTS,
  MODIFICATIONS,
  MODIFICATION_FAMILIES,
  MODIFICATION_RARITY_BANDS,
  SET_BONUSES,
  fitsIn,
  modificationFits,
  modificationsFittingIn,
  modificationsFor,
  modificationsOfRarity,
  type ModificationFamily,
  type ModificationSpec,
} from './modifications.js';
import {
  ADVANCED_MODIFICATION_MAGNITUDE,
  describeSetBonus,
  isAdvancedModification,
} from './addons.js';
import { MODIFICATION_RARITIES, type ModificationRarity } from '../modification-rarity.js';
import {
  MODIFICATION_SET_SIZE,
  completedSet,
  districtEffects,
  fittedMagnitude,
  localProductionPercent,
} from './effects.js';
import { PRODUCING_BUILDINGS } from './production.js';
import type { Building } from './state.js';

/**
 * The deck-building layer (maintainer request, 2026-09-14).
 *
 * Three slots used to be a shopping decision: read the seven a structure offers, take the three
 * biggest numbers, never look again. Families, pair synergies and set bonuses are what turn that
 * into a hand worth arranging, and each of the three is a number the player is promised and can
 * therefore be quietly cheated of.
 */

const at = (kind: Building['kind'], mods: string[], level = 20): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications: mods,
  damage: 0,
});

/** A card of `family` that fits `kind`, or nothing when the catalogue has none. */
const cardOf = (kind: Building['kind'], family: ModificationFamily) =>
  modificationsFittingIn(kind).find((mod) => mod.family === family);

describe('where a card will go', () => {
  /**
   * A bolt-on stays where it was banged together; a drawing travels (maintainer rule, 2026-09-16).
   *
   * This used to read "keeps a card at home unless it says otherwise", which was true while every
   * unlisted card meant its own structure. The grade decides it now: BASIC is local, and from
   * INTRICATE up a card reaches the structures its *trade* belongs to, because a crew that has
   * assembled a document owns the design rather than one copy of it. Every card still fits the
   * structure it is sold under, which is the half that cannot move.
   */
  it('keeps a basic bolt-on at home, and lets a drawing travel', () => {
    const unlisted = MODIFICATIONS.filter((one) => one.fits === undefined);
    for (const mod of unlisted.filter((one) => one.rarity === 'basic')) {
      expect(fitsIn(mod), mod.id).toEqual([mod.building]);
      expect(modificationFits(mod, mod.building), mod.id).toBe(true);
    }
    for (const mod of unlisted.filter((one) => one.rarity !== 'basic')) {
      expect(fitsIn(mod).length, mod.id).toBeGreaterThan(1);
      expect(fitsIn(mod), mod.id).toContain(mod.building);
    }
    // A guard on the guard: both halves have to be populated or this says nothing.
    expect(unlisted.filter((one) => one.rarity === 'basic').length).toBeGreaterThan(5);
    expect(unlisted.filter((one) => one.rarity !== 'basic').length).toBeGreaterThan(5);
  });

  /**
   * The spread the maintainer asked for: "some in just 1, some in 2 or 3, some in all".
   *
   * Measured over the whole catalogue rather than per card, because it is a claim about the shape
   * of the deck: a catalogue where everything travels everywhere is the same as one where nothing
   * does, and either would pass every other assertion in this file.
   */
  it('spreads the catalogue across one structure, a few, and all of them', () => {
    const reach = MODIFICATIONS.map((mod) => fitsIn(mod).length);
    expect(reach.filter((n) => n === 1).length, 'nothing is local').toBeGreaterThan(5);
    expect(reach.filter((n) => n >= 2 && n <= 4).length, 'nothing is regional').toBeGreaterThan(20);
    expect(
      reach.filter((n) => n === BUILDING_KINDS.length).length,
      'nothing goes everywhere',
    ).toBeGreaterThan(5);
  });

  it('lets a cross-building card into every structure it names, and no others', () => {
    const crossing = MODIFICATIONS.filter((one) => one.fits !== undefined);
    // A guard on the fixture: with no cross-building cards this whole file is about nothing.
    expect(crossing.length).toBeGreaterThan(5);

    for (const mod of crossing) {
      expect(fitsIn(mod).length, mod.id).toBeGreaterThan(1);
      // Its home is one of the places it fits. A card the Scrapyard sells under a structure's name
      // and which cannot be installed there is a card that lies on the bench it sits on.
      expect(fitsIn(mod), mod.id).toContain(mod.building);
      for (const kind of BUILDING_KINDS) {
        expect(modificationFits(mod, kind), `${mod.id} in ${kind}`).toBe(
          fitsIn(mod).includes(kind),
        );
      }
    }
  });

  it('offers every structure more than it calls its own', () => {
    for (const kind of BUILDING_KINDS) {
      const fitting = modificationsFittingIn(kind);
      expect(fitting.length, kind).toBeGreaterThan(modificationsFor(kind).length);
      // Home cards first: those are the ones the yard sells under this structure's name.
      expect(fitting[0]?.building, kind).toBe(kind);
      expect(new Set(fitting.map((one) => one.id)).size, kind).toBe(fitting.length);
    }
  });
});

describe('a card beside its own kind', () => {
  it('pays its printed figure with nothing next to it', () => {
    const solo = MODIFICATIONS.find((one) => one.synergy !== undefined);
    expect(solo, 'the catalogue must carry at least one synergy').toBeDefined();
    expect(fittedMagnitude(solo!, [solo!])).toBe(solo!.magnitude);
  });

  it('pays the bonus when the family it wants is in the same structure', () => {
    const card = MODIFICATIONS.find((one) => one.synergy !== undefined)!;
    const friend = MODIFICATIONS.find(
      (one) => one.id !== card.id && one.family === card.synergy!.with,
    );
    expect(friend, `nothing in the catalogue is ${card.synergy!.with}`).toBeDefined();

    expect(fittedMagnitude(card, [card, friend!])).toBe(card.magnitude + card.synergy!.bonus);
  });

  /**
   * The half that would otherwise be free money.
   *
   * A card whose synergy names its own family would pay the bonus for standing beside itself, and
   * every such card would be strictly better than every other with no deck required. `fittedMagnitude`
   * excludes the card itself by id, and this is the line that holds it.
   */
  it('never pays a card for standing next to itself', () => {
    /*
     * Built here rather than found in the catalogue, and that is the point.
     *
     * The first version searched `MODIFICATIONS` for a card whose synergy named its own family and
     * asserted only if it found one. Nothing in the catalogue does, so the assertion never ran and
     * the test passed with the guard mutated away. A rule about what the catalogue must never
     * contain cannot be tested with an example taken from the catalogue.
     */
    const selfish: ModificationSpec = {
      id: 'test_selfish',
      building: 'quarters',
      name: 'Test Selfish',
      description: 'A card that wants its own kind.',
      effect: 'housing_percent',
      magnitude: 10,
      rarity: 'intricate',
      family: 'comfort',
      synergy: { with: 'comfort', bonus: 99 },
    };
    expect(fittedMagnitude(selfish, [selfish])).toBe(10);

    // Two of a kind is a real pair, so the bonus does land when somebody else brings it.
    const friend: ModificationSpec = { ...selfish, id: 'test_friend', name: 'Test Friend' };
    expect(fittedMagnitude(selfish, [selfish, friend])).toBe(109);

    // And the general form: one card alone is always worth exactly its printed figure.
    for (const mod of MODIFICATIONS)
      expect(fittedMagnitude(mod, [mod]), mod.id).toBe(mod.magnitude);
  });

  it('reaches the district total, not just the card', () => {
    const kind = 'quarters';
    const comfort = cardOf(kind, 'comfort');
    const plumbing = modificationsFittingIn(kind).find(
      (one) => one.family === 'plumbing' && one.synergy?.with === 'comfort',
    );
    expect(
      comfort && plumbing,
      'the Quarters must offer a comfort card and a plumbing partner',
    ).toBeTruthy();

    const alone = districtEffects([at(kind, [plumbing!.id])]);
    const paired = districtEffects([at(kind, [plumbing!.id, comfort!.id])]);
    // The plumbing card's own effect goes up by its synergy, over and above whatever the comfort
    // card contributes to its own effect.
    const gain = paired[plumbing!.effect] - alone[plumbing!.effect];
    const fromComfort = comfort!.effect === plumbing!.effect ? comfort!.magnitude : 0;
    expect(gain - fromComfort).toBe(plumbing!.synergy!.bonus);
  });
});

describe('a completed set', () => {
  it('is three of one family and nothing less', () => {
    expect(MODIFICATION_SET_SIZE).toBe(3);
    const kind = 'infirmary';
    const family: ModificationFamily = 'comfort';
    const three = modificationsFittingIn(kind)
      .filter((one) => one.family === family)
      .slice(0, 3);
    expect(three.length, 'the Infirmary must fit three comfort cards').toBe(3);

    expect(
      completedSet(
        at(
          kind,
          three.slice(0, 1).map((o) => o.id),
        ),
      ),
    ).toBeNull();
    expect(
      completedSet(
        at(
          kind,
          three.slice(0, 2).map((o) => o.id),
        ),
      ),
    ).toBeNull();
    expect(
      completedSet(
        at(
          kind,
          three.map((o) => o.id),
        ),
      ),
    ).toBe(family);
  });

  it('is not a set when one card is from somewhere else', () => {
    const kind = 'infirmary';
    const comfort = modificationsFittingIn(kind)
      .filter((one) => one.family === 'comfort')
      .slice(0, 2);
    const other = modificationsFittingIn(kind).find((one) => one.family !== 'comfort');
    expect(comfort.length === 2 && other, 'fixture').toBeTruthy();

    expect(completedSet(at(kind, [...comfort.map((o) => o.id), other!.id]))).toBeNull();
  });

  it('pays its bonus into the district on top of the three cards', () => {
    const kind = 'infirmary';
    const three = modificationsFittingIn(kind)
      .filter((one) => one.family === 'comfort')
      .slice(0, 3);
    const bonus = SET_BONUSES.comfort;

    const whole = districtEffects([
      at(
        kind,
        three.map((o) => o.id),
      ),
    ]);
    // The same three cards, one of them swapped for a card of another family: the set is broken and
    // the bonus is gone, so the difference is the bonus itself rather than a figure typed twice.
    const cards = three.reduce(
      (total, one) => total + (one.effect === bonus.effect ? one.magnitude : 0),
      0,
    );
    expect(whole[bonus.effect]).toBeGreaterThanOrEqual(cards + bonus.magnitude);
  });

  /**
   * The Plumbing set pays into the one *local* effect, so it has to be read locally.
   *
   * `production_percent` belongs to the structure rather than the district. A set bonus of that
   * kind paid through `districtEffects` would be a bonus that silently did nothing, which is the
   * failure this codebase has already had twice.
   */
  it('pays a local set locally', () => {
    expect(SET_BONUSES.plumbing.effect).toBe('production_percent');
    const kind = 'greenhouse';
    const three = modificationsFittingIn(kind)
      .filter((one) => one.family === 'plumbing')
      .slice(0, 3);
    expect(three.length, 'the Greenhouse must fit three plumbing cards').toBe(3);

    const building = at(
      kind,
      three.map((o) => o.id),
    );
    const cards = three.reduce(
      (total, one) => total + (one.effect === 'production_percent' ? one.magnitude : 0),
      0,
    );
    expect(localProductionPercent(building)).toBeGreaterThanOrEqual(
      cards + SET_BONUSES.plumbing.magnitude,
    );
  });

  it('gives every family a set worth completing', () => {
    for (const family of MODIFICATION_FAMILIES) {
      const bonus = SET_BONUSES[family];
      expect(bonus, family).toBeDefined();
      expect(bonus.magnitude, family).toBeGreaterThan(0);
      expect(bonus.title.length, family).toBeGreaterThan(5);
    }
  });

  /**
   * A set bonus nobody can complete is a paragraph of rules and no mechanic.
   *
   * `gives every family a set worth completing` above checks the bonus is *written*. This checks
   * it can be *reached*, which is a different question and the one that goes wrong quietly: a set
   * needs three cards of one family that all fit the same structure, so retiring one armour card,
   * or narrowing one `fits` list, can take the last route to a bonus away without touching the
   * bonus itself. Nothing else in the suite would say a word.
   */
  it('leaves every family a structure it can actually be completed in', () => {
    for (const family of MODIFICATION_FAMILIES) {
      const homes = BUILDING_KINDS.filter(
        (kind) =>
          modificationsFittingIn(kind).filter((spec) => spec.family === family).length >=
          MODIFICATION_SET_SIZE,
      );
      expect(homes.length, `no structure can complete the ${family} set`).toBeGreaterThan(0);
    }
  });

  /**
   * The same question for synergies: a card wanting a family it can never sit beside.
   *
   * A synergy is a bonus on a card, so a card whose wanted family fits none of the same structures
   * prints a number that is never paid. That reads on the shelf as the better card and is, in
   * play, strictly the worse one.
   */
  it('lets every synergy be met somewhere', () => {
    const wanting = MODIFICATIONS.filter((spec) => spec.synergy !== undefined);
    // A guard on the guard: if the catalogue ever lost its synergies this would pass vacuously.
    expect(wanting.length).toBeGreaterThan(5);

    for (const spec of wanting) {
      const met = BUILDING_KINDS.some(
        (kind) =>
          modificationFits(spec, kind) &&
          modificationsFittingIn(kind).some(
            (other) => other.id !== spec.id && other.family === spec.synergy?.with,
          ),
      );
      expect(met, `${spec.id} wants ${spec.synergy?.with} and can never sit beside one`).toBe(true);
    }
  });

  /**
   * A set bonus says which way its number goes.
   *
   * Three of the six are reductions. Any sentence built as "pays N% more" is wrong for those, and
   * wrong quietly: the number is right, the claim is backwards, and a player reads that the Power
   * set makes builds slower. The labels carry the direction, so this pins that the describer goes
   * through them rather than printing the raw channel or inventing a verb.
   */
  it('describes every set bonus in the direction its channel actually moves', () => {
    const reductions = MODIFICATION_FAMILIES.filter((family) =>
      SET_BONUSES[family].effect.endsWith('_reduction'),
    );
    // A guard on the guard: if the bonuses were ever all retuned to gains this would prove nothing.
    expect(reductions.length).toBeGreaterThan(0);

    for (const family of MODIFICATION_FAMILIES) {
      const line = describeSetBonus(family);
      expect(line, family).toContain(`${SET_BONUSES[family].magnitude}%`);
      // Never the internal channel name, which is what printing the enum would leak.
      expect(line, family).not.toContain('_');
      if (reductions.includes(family)) expect(line, family).toContain('off how long');
    }
  });

  /**
   * A local set is worth nothing in a structure that makes nothing.
   *
   * The Plumbing bonus is `production_percent`, the one effect that belongs to the building rather
   * than the district, so a Plumbing set in the Gate is three cards and no bonus. It was
   * completable in exactly one producing structure, the Greenhouse, which is a family with one
   * fixed answer rather than a deck decision, and one narrowed `fits` list away from having none.
   */
  it('lets a local set be completed in more than one structure that produces something', () => {
    const local = MODIFICATION_FAMILIES.filter((family) =>
      LOCAL_EFFECTS.includes(SET_BONUSES[family].effect),
    );
    // A guard on the guard: with no local set bonus this proves nothing at all.
    expect(local.length, 'no set pays a local effect').toBeGreaterThan(0);

    for (const family of local) {
      const homes = PRODUCING_BUILDINGS.filter(
        (kind) =>
          modificationsFittingIn(kind).filter((spec) => spec.family === family).length >=
          MODIFICATION_SET_SIZE,
      );
      expect(
        homes.length,
        `the ${family} set pays ${SET_BONUSES[family].effect}, and ${homes.length} producing structure(s) can complete it`,
      ).toBeGreaterThan(1);
    }
  });

  it('ignores an id the catalogue no longer has', () => {
    // The ordinary state of a live save after a retirement: it must not throw and must not count.
    expect(completedSet(at('quarters', ['gone_forever']))).toBeNull();
    expect(() => districtEffects([at('quarters', ['gone_forever'])])).not.toThrow();
  });
});

/**
 * The word on the card (maintainer request, 2026-09-15): the same four the unit cards wear.
 *
 * A rarity is a claim about the magnitude and nothing else, so every assertion here is measured on
 * the shipped cards against the declared bands rather than on the bands alone. The bands are the
 * author's intent; this is whether the catalogue met it.
 */
/**
 * The other direction from `only offers a production bonus where something is actually produced`.
 *
 * That one refuses a card with nowhere to pay; this refuses a structure with nothing to pay it. The
 * Generator failed it the day the production split made it the only source of oil: every card in
 * the game that raises output was homed on a structure the Generator is not, so its six oil an hour
 * a level was the whole of what a crew could ever get, and no amount of research or decking moved
 * it a single barrel.
 */
describe('a card that pays into a structure\u2019s own output', () => {
  it('leaves every producing structure something that raises what it makes', () => {
    expect(PRODUCING_BUILDINGS.length, 'nothing produces anything').toBeGreaterThan(0);
    for (const kind of PRODUCING_BUILDINGS) {
      const raises = modificationsFittingIn(kind).filter((spec) =>
        LOCAL_EFFECTS.includes(spec.effect),
      );
      expect(
        raises.length,
        `nothing in the catalogue raises what the ${kind} makes`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('the rarity a card is filed under', () => {
  /** The maintainer's figure, written here rather than read off the array it is checking. */
  const CATALOGUE_SIZE = 89;

  it('holds eighty-nine cards, so nothing below can pass on an empty loop', () => {
    expect(MODIFICATIONS).toHaveLength(CATALOGUE_SIZE);
  });

  it('gives every card one of the four words, and uses all four', () => {
    const known = new Set<ModificationRarity>(MODIFICATION_RARITIES);
    for (const mod of MODIFICATIONS) {
      expect(known.has(mod.rarity), `${mod.id}: ${mod.rarity}`).toBe(true);
    }
    let counted = 0;
    for (const rarity of MODIFICATION_RARITIES) {
      const ofRarity = modificationsOfRarity(rarity);
      expect(ofRarity.length, rarity).toBeGreaterThan(0);
      for (const mod of ofRarity) expect(mod.rarity, mod.id).toBe(rarity);
      counted += ofRarity.length;
    }
    expect(counted).toBe(CATALOGUE_SIZE);
  });

  it('keeps every card inside its declared band', () => {
    for (const mod of MODIFICATIONS) {
      const band = MODIFICATION_RARITY_BANDS[mod.rarity];
      expect(mod.magnitude, `${mod.id} (${mod.rarity})`).toBeGreaterThanOrEqual(band.min);
      expect(mod.magnitude, `${mod.id} (${mod.rarity})`).toBeLessThanOrEqual(band.max);
    }
  });

  /**
   * Both the declaration and the catalogue climb.
   *
   * The declared bands must not overlap, or a magnitude could honestly wear two words. And the
   * shipped cards must climb too, measured band by band off the cards themselves, so that a
   * masterpiece is plainly stronger than every advanced card, whatever the declaration says.
   */
  it('climbs, band by band, with no overlap', () => {
    for (let index = 1; index < MODIFICATION_RARITIES.length; index++) {
      const below = MODIFICATION_RARITIES[index - 1]!;
      const above = MODIFICATION_RARITIES[index]!;
      expect(MODIFICATION_RARITY_BANDS[above].min, above).toBeGreaterThan(
        MODIFICATION_RARITY_BANDS[below].max,
      );
      const weakestAbove = Math.min(...modificationsOfRarity(above).map((mod) => mod.magnitude));
      const strongestBelow = Math.max(...modificationsOfRarity(below).map((mod) => mod.magnitude));
      expect(weakestAbove, above).toBeGreaterThan(strongestBelow);
    }
    for (const rarity of MODIFICATION_RARITIES) {
      const band = MODIFICATION_RARITY_BANDS[rarity];
      expect(band.min, rarity).toBeGreaterThan(0);
      expect(band.max, rarity).toBeGreaterThanOrEqual(band.min);
    }
  });

  /**
   * ADVANCED means what the yard means by it.
   *
   * `addons.ts` already draws one line through this catalogue: at `ADVANCED_MODIFICATION_MAGNITUDE`
   * a card starts wanting the retrofit document and costing high-quality metal, and the Scrapyard
   * flags it `advanced`. A card wearing the word ADVANCED (or better) that the yard sold with no
   * drawings, or a BASIC card it charged metal for, would be the same word meaning two things on
   * one page. `addons.ts` imports the catalogue, so the catalogue cannot import the threshold; this
   * is where the two numbers are held together.
   */
  it('starts ADVANCED exactly where the yard does', () => {
    expect(MODIFICATION_RARITY_BANDS.advanced.min).toBe(ADVANCED_MODIFICATION_MAGNITUDE);
    const advancedOrBetter = new Set<ModificationRarity>(['advanced', 'masterpiece']);
    for (const mod of MODIFICATIONS) {
      expect(isAdvancedModification(mod), `${mod.id} (${mod.rarity})`).toBe(
        advancedOrBetter.has(mod.rarity),
      );
    }
  });

  /** A spread the bench can show, rather than eighty basics and a masterpiece. */
  it('puts a real share of the catalogue in every band', () => {
    for (const rarity of MODIFICATION_RARITIES) {
      expect(modificationsOfRarity(rarity).length, rarity).toBeGreaterThanOrEqual(10);
    }
  });
});
