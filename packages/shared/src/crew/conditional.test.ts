import { describe, expect, it } from 'vitest';
import { effectiveStats } from '../battle/effects.js';
import { bareBattlefield } from '../battle/battlefield.js';
import { UNIT_CATALOG, findUnit } from '../units/catalog.js';
import { noCrewEffects, applyPerkBonus, CONDITIONAL_CHANNELS } from './effects.js';
import { PERK_CATALOG, describePerkBonus, type Perk } from './perks.js';

/**
 * §B7: the perks that pay only when something is true.
 *
 * The board's complaint about the old book was that a bonus lands on the card carrying it, so it
 * may as well be a bigger number on that card. These are the answer: every one reaches other
 * people, a named unit, one structure, or a situation the player has to arrange. The tests here
 * are about the *fold and the reach*; whether each condition is checked in the right place is
 * pinned on the server, next to the system that knows the condition.
 */

const withBonus = (kind: string) => {
  const perk = PERK_CATALOG.find((entry) => entry.bonus.kind === kind);
  if (!perk) throw new Error(`no perk in the book with a ${kind} bonus`);
  const effects = noCrewEffects();
  applyPerkBonus(effects, perk.bonus);
  return { perk, effects };
};

describe('every conditional channel has a perk behind it', () => {
  /**
   * The guard that stops a channel being decoration.
   *
   * A channel with no perk paying into it is a field on a struct and nothing else, and the game
   * has shipped exactly that before: `officerGroupFlat` was folded by eight perks and read by
   * nobody, so hiring any of them moved no number anywhere.
   */
  it.each(CONDITIONAL_CHANNELS)('%s', (channel) => {
    const total = noCrewEffects();
    for (const perk of PERK_CATALOG) applyPerkBonus(total, perk.bonus);
    expect(total[channel]).toBeGreaterThan(0);
  });

  it('has a perk for the per-structure and per-unit channels too', () => {
    const total = noCrewEffects();
    for (const perk of PERK_CATALOG) applyPerkBonus(total, perk.bonus);
    expect(Object.keys(total.buildingCostPercent).length).toBeGreaterThan(0);
    expect(Object.keys(total.unitKindPercent).length).toBeGreaterThan(0);
    expect(Object.keys(total.officerAttributeFlat).length).toBeGreaterThan(0);
    expect(Object.keys(total.officerAttributeAtLeast).length).toBeGreaterThan(0);
  });
});

describe('a bonus scoped to one named unit', () => {
  const { perk } = withBonus('unit_kind');
  if (perk.bonus.kind !== 'unit_kind') throw new Error('wrong bonus');
  const { unitId, stat, percent } = perk.bonus;

  const statsFor = (kindPercent: Record<string, Partial<Record<string, number>>>) => {
    const unit = findUnit(unitId)!;
    return effectiveStats(
      unit,
      bareBattlefield(),
      { defending: false, outnumbered: 0 },
      { ...noCrewEffects(), unitKindPercent: kindPercent },
    );
  };

  it('makes that unit better at the stat it names', () => {
    const plain = statsFor({});
    const helped = statsFor({ [unitId]: { [stat]: percent } });
    expect(helped[stat]).toBeGreaterThan(plain[stat]);
  });

  /** The whole point of the scope: a different unit is untouched. */
  it('does nothing for any other unit', () => {
    const other = PERK_CATALOG.map((entry) => entry.bonus).find(
      (bonus) => bonus.kind === 'unit_kind' && bonus.unitId !== unitId,
    );
    if (!other || other.kind !== 'unit_kind') throw new Error('need a second unit_kind perk');

    const unit = findUnit(unitId)!;
    const plain = effectiveStats(
      unit,
      bareBattlefield(),
      { defending: false, outnumbered: 0 },
      {
        ...noCrewEffects(),
      },
    );
    const elsewhere = effectiveStats(
      unit,
      bareBattlefield(),
      { defending: false, outnumbered: 0 },
      { ...noCrewEffects(), unitKindPercent: { [other.unitId]: { [other.stat]: other.percent } } },
    );
    expect(elsewhere[stat]).toBe(plain[stat]);
  });
});

describe('the fold', () => {
  it('adds two perks on the same structure rather than taking the better', () => {
    const effects = noCrewEffects();
    applyPerkBonus(effects, { kind: 'building_cost', building: 'lab', percent: 10 });
    applyPerkBonus(effects, { kind: 'building_cost', building: 'lab', percent: 15 });
    expect(effects.buildingCostPercent.lab).toBe(25);
    expect(effects.buildingCostPercent.gate).toBeUndefined();
  });

  /**
   * Two specialists on one attribute keep the kinder bar.
   *
   * Buying the same perk twice must not raise the price of the first copy: a crew that hires two
   * Master's Tables should find the pair easier to satisfy than one of them, not harder.
   */
  it('keeps the lower bar when two threshold perks name the same attribute', () => {
    const effects = noCrewEffects();
    applyPerkBonus(effects, {
      kind: 'officer_threshold',
      attribute: 'logic',
      flat: 4,
      threshold: 60,
    });
    applyPerkBonus(effects, {
      kind: 'officer_threshold',
      attribute: 'logic',
      flat: 5,
      threshold: 45,
    });
    expect(effects.officerAttributeAtLeast.logic).toEqual({ flat: 9, threshold: 45 });
  });
});

/**
 * The card has to say the unit the engine pays in (wiring audit, 2026-10-01).
 *
 * A tier's and a named unit's armour are added to the rating as points, and the cards printed
 * them as percentages: `+20% Ironsides armour` was twenty points on a sheet of 64. Measured off
 * `effectiveStats` rather than read off the stat's name, so a stat that changes unit in the engine
 * without changing on the card fails here.
 */
describe('a scoped unit bonus is written in the unit the engine pays', () => {
  const scoped = PERK_CATALOG.filter(
    (entry) => entry.bonus.kind === 'unit_kind' || entry.bonus.kind === 'unit_tier',
  );

  const measured = (perk: Perk): number => {
    const bonus = perk.bonus;
    if (bonus.kind !== 'unit_kind' && bonus.kind !== 'unit_tier') throw new Error('not scoped');
    const unit =
      bonus.kind === 'unit_kind'
        ? findUnit(bonus.unitId)!
        : UNIT_CATALOG.find((one) => one.tier === bonus.tier)!;
    const fight = (effects: ReturnType<typeof noCrewEffects>) =>
      effectiveStats(unit, bareBattlefield(), { defending: false, outnumbered: 0 }, effects);
    return (
      fight(applyPerkBonus(noCrewEffects(), bonus))[bonus.stat] - fight(noCrewEffects())[bonus.stat]
    );
  };

  it('covers both scopes and all three stats', () => {
    const kinds = new Set(scoped.map((entry) => `${entry.bonus.kind}`));
    const stats = new Set(scoped.map((entry) => ('stat' in entry.bonus ? entry.bonus.stat : '')));
    expect([...kinds].sort()).toEqual(['unit_kind', 'unit_tier']);
    expect([...stats].sort()).toEqual(['armor', 'offense', 'vitality']);
  });

  it.each(scoped.map((entry) => [entry.id, entry] as const))('%s', (_, perk) => {
    const amount = 'percent' in perk.bonus ? perk.bonus.percent : 0;
    const flat = Math.abs(measured(perk) - amount) < 1e-9;
    expect(describePerkBonus(perk.bonus).startsWith(flat ? `+${amount} ` : `+${amount}% `)).toBe(
      true,
    );
  });
});
