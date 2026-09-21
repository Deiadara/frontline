/**
 * §A4: holding intimidating ground makes your line harder to intimidate.
 *
 * `intimidationFlat` was summed out of the hold bonuses and read by nothing for the whole life of
 * the channel, which made the Broadcast Tower, whose only bonus is intimidation, worth nothing to
 * hold. `intimidate` in the engine is its consumer now, so this pins the wiring: the number has to reach
 * the sheet, and it has to stop at the sheet's ceiling like every other bonus.
 */
import { describe, expect, it } from 'vitest';
import { noTerritoryEffects } from '../city/index.js';
import { UNIT_CATALOG, UNIT_MODIFICATIONS, findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';

const CONTEXT = { defending: false, outnumbered: false } as const;

/**
 * The hundred-point ceiling holds on the battlefield, not only on the sheet.
 *
 * `upgradedStats` clamps a fitted sheet, and `upgrades.test.ts` pins that. This is the other
 * half of the maintainer's rule (2026-09-15, "max is 100 for a stat, same for anything in the
 * game"): the ground, the sky, the officer and the fight's own context all add to a sheet *after*
 * the cards, and each of those additions is its own line in `effectiveStats`. A clamp missing from
 * one line is a bar drawn past the end of its track and a share above one handed to the engine,
 * and nothing about the sheet-level guard would notice.
 *
 * So: every unit, every card fitted, every unit-affecting territory figure pushed to an absurd
 * value, defending and outnumbered, on the most defensible ground the catalogue allows. The worst
 * case rather than a realistic one, because a realistic one passes the day somebody widens a bonus.
 */
describe('the hundred-point ceiling on the battlefield', () => {
  const RATINGS = [
    'armor',
    'speed',
    'range',
    'evasion',
    'penetration',
    'stealth',
    'intimidation',
    'morale',
  ] as const;

  const hostile = {
    ...noTerritoryEffects(),
    unitArmorPercent: 500,
    unitMoraleFlat: 500,
    unitSpeedPercent: 500,
    unitStealthPercent: 500,
    intimidationFlat: 500,
    unitEvasionFlat: 500,
    unitOffensePercent: 500,
    unitVitalityPercent: 500,
  };
  const worst = { ...bareBattlefield(), baseDefense: 10 };
  const everything = UNIT_MODIFICATIONS.map((spec) => spec.id);

  it('keeps every rating inside 0..100 under every bonus at once', () => {
    const over: string[] = [];
    let touched = 0;
    for (const unit of Object.values(UNIT_CATALOG)) {
      const seen = effectiveStats(
        unit,
        worst,
        { defending: true, outnumbered: true },
        hostile,
        everything,
      );
      for (const key of RATINGS) {
        if (seen[key] > 100 || seen[key] < 0) over.push(`${unit.id}.${key} = ${seen[key]}`);
        if (seen[key] === 100) touched += 1;
      }
    }
    expect(over, over.join('\n')).toEqual([]);
    // A guard on the guard: the bonuses above are meant to slam ratings into the ceiling, and if
    // none did then the clamp was never exercised and this test proved nothing about it.
    expect(touched).toBeGreaterThan(20);
  });

  it('still lets damage and hit points run past a hundred', () => {
    const razors = findUnit('razors')!;
    const seen = effectiveStats(razors, worst, { defending: true, outnumbered: true }, hostile, []);
    expect(seen.offense).toBeGreaterThan(100);
    expect(seen.vitality).toBeGreaterThan(100);
  });
});

describe('the ground you hold lends its menace', () => {
  const razors = findUnit('razors');
  if (!razors) throw new Error('fixture: no razors in the catalogue');

  it('adds the held ground intimidation to the unit', () => {
    const bare = effectiveStats(razors, bareBattlefield(), CONTEXT, noTerritoryEffects());
    const held = effectiveStats(razors, bareBattlefield(), CONTEXT, {
      ...noTerritoryEffects(),
      intimidationFlat: 20,
    });
    expect(held.intimidation).toBe(bare.intimidation + 20);
  });

  it('stops at the sheet ceiling rather than running past it', () => {
    const held = effectiveStats(razors, bareBattlefield(), CONTEXT, {
      ...noTerritoryEffects(),
      intimidationFlat: 500,
    });
    expect(held.intimidation).toBe(100);
  });
});
