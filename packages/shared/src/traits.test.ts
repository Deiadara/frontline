import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_NAMES, MAX_ATTRIBUTE, makeAttributes } from './attributes.js';
import {
  TRAIT_BOONS,
  TRAIT_CATALOG,
  TRAIT_FLAWS,
  TRAIT_IDS,
  applyTraitBonuses,
  findTrait,
  isFlaw,
} from './traits.js';

describe('the trait catalogue (§B7)', () => {
  it('has an entry for every id, and no entry without one', () => {
    expect(Object.keys(TRAIT_CATALOG).sort()).toEqual([...TRAIT_IDS].sort());
    for (const id of TRAIT_IDS) expect(TRAIT_CATALOG[id].id).toBe(id);
  });

  it('names only real attributes in every bonus', () => {
    for (const id of TRAIT_IDS) {
      for (const name of Object.keys(TRAIT_CATALOG[id].bonus)) {
        expect(ATTRIBUTE_NAMES, `${id} moves an attribute that does not exist`).toContain(name);
      }
    }
  });

  it('gives every trait a name and a description worth reading', () => {
    for (const id of TRAIT_IDS) {
      const { name, description } = TRAIT_CATALOG[id];
      expect(name.length, id).toBeGreaterThan(0);
      expect(description.length, id).toBeGreaterThan(10);
    }
  });

  it('moves at least one attribute — a trait that does nothing is not a trait', () => {
    for (const id of TRAIT_IDS) {
      const amounts = Object.values(TRAIT_CATALOG[id].bonus);
      expect(amounts.length, id).toBeGreaterThan(0);
      expect(
        amounts.every((amount) => amount !== 0),
        id,
      ).toBe(true);
    }
  });

  /**
   * The whole point of splitting the catalogue: a boon is *only* upside and a flaw is *only*
   * downside. A trait with one of each would make `kind` a lie and the UI colour meaningless.
   */
  it('keeps every bonus’s sign consistent with its kind', () => {
    for (const id of TRAIT_IDS) {
      const { kind, bonus } = TRAIT_CATALOG[id];
      const amounts = Object.values(bonus);
      if (kind === 'boon')
        expect(
          amounts.every((a) => a > 0),
          id,
        ).toBe(true);
      else
        expect(
          amounts.every((a) => a < 0),
          id,
        ).toBe(true);
    }
  });

  it('partitions cleanly into boons and flaws', () => {
    expect([...TRAIT_BOONS, ...TRAIT_FLAWS].sort()).toEqual([...TRAIT_IDS].sort());
    expect(TRAIT_BOONS.filter((id) => TRAIT_FLAWS.includes(id))).toEqual([]);
    for (const id of TRAIT_FLAWS) expect(isFlaw(id)).toBe(true);
    for (const id of TRAIT_BOONS) expect(isFlaw(id)).toBe(false);
  });

  /**
   * Recruits draw uniformly from `TRAIT_IDS`, so the pool's composition *is* the flaw rate. Stated
   * as a bound rather than an exact ratio, so adding traits does not fail this — but tipping the
   * pool into mostly-downside would, because that is a balance change, not a content addition.
   */
  it('keeps flaws a minority of the pool', () => {
    expect(TRAIT_FLAWS.length).toBeGreaterThan(0);
    expect(TRAIT_FLAWS.length).toBeLessThan(TRAIT_BOONS.length);
  });

  it('finds a trait by id and refuses anything else', () => {
    expect(findTrait('gutter_born')?.name).toBe('Gutter Born');
    expect(findTrait('glass_jaw')?.kind).toBe('flaw');
    expect(findTrait('not_a_trait')).toBeUndefined();
  });
});

describe('applying traits to a sheet', () => {
  it('raises for a boon and lowers for a flaw', () => {
    const flat = makeAttributes(40);

    const boosted = applyTraitBonuses(flat, ['unbreakable']);
    expect(boosted.toughness).toBe(48);
    expect(boosted.composure).toBe(45);

    const hurt = applyTraitBonuses(flat, ['glass_jaw']);
    expect(hurt.toughness).toBe(31);
    expect(hurt.endurance).toBe(35);
  });

  it('leaves every attribute the trait does not name alone', () => {
    const flat = makeAttributes(40);
    const applied = applyTraitBonuses(flat, ['deadeye']);
    const moved = Object.keys(TRAIT_CATALOG.deadeye.bonus);

    for (const name of ATTRIBUTE_NAMES) {
      if (moved.includes(name)) continue;
      expect(applied[name], name).toBe(40);
    }
  });

  it('clamps at both ends of the 0..100 scale', () => {
    expect(applyTraitBonuses(makeAttributes(2), ['glass_jaw']).toughness).toBe(0);
    expect(applyTraitBonuses(makeAttributes(MAX_ATTRIBUTE), ['unbreakable']).toughness).toBe(
      MAX_ATTRIBUTE,
    );
  });

  it('is a no-op with no traits', () => {
    const flat = makeAttributes(33);
    expect(applyTraitBonuses(flat, [])).toEqual(flat);
  });

  it('stacks a boon and a flaw that pull on the same attribute', () => {
    // `unbreakable` is +8 toughness, `glass_jaw` is -9: together the character is slightly worse
    // off, and order must not matter.
    const flat = makeAttributes(40);
    expect(applyTraitBonuses(flat, ['unbreakable', 'glass_jaw']).toughness).toBe(39);
    expect(applyTraitBonuses(flat, ['glass_jaw', 'unbreakable']).toughness).toBe(39);
  });
});
