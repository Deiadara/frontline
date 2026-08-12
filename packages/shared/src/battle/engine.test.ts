import { describe, expect, it } from 'vitest';
import { CITY_DISTRICTS, findDistrict } from '../city.js';
import { RandomBattleEngine, defaultBattleEngine } from './engine.js';
import { BattleResultSchema } from './types.js';

const raidDistrict = CITY_DISTRICTS.find((d) => d.kind === 'raid');
if (!raidDistrict) throw new Error('fixture error: city map has no raid district');

describe('RandomBattleEngine', () => {
  it('pays out the target district rewards when the attacker wins', () => {
    const engine = new RandomBattleEngine(() => 0); // 0 < 0.5 -> attacker wins
    const result = engine.simulate({ attackerBaseId: 'base-1', targetDistrictId: raidDistrict.id });

    expect(result.winner).toBe('attacker');
    expect(result.rewards).toEqual(raidDistrict.rewards);
    expect(result.log.length).toBeGreaterThan(0);
  });

  it('pays nothing when the defender wins', () => {
    const engine = new RandomBattleEngine(() => 0.99); // 0.99 >= 0.5 -> defender wins
    const result = engine.simulate({ attackerBaseId: 'base-1', targetDistrictId: raidDistrict.id });

    expect(result.winner).toBe('defender');
    expect(result.rewards).toEqual({});
  });

  it('handles unknown districts without throwing', () => {
    const engine = new RandomBattleEngine(() => 0);
    const result = engine.simulate({ attackerBaseId: 'base-1', targetDistrictId: 'nowhere' });

    expect(findDistrict('nowhere')).toBeUndefined();
    expect(result.rewards).toEqual({});
  });

  it('produces results that satisfy BattleResultSchema', () => {
    const result = defaultBattleEngine.simulate({
      attackerBaseId: 'base-1',
      targetDistrictId: raidDistrict.id,
    });
    expect(() => BattleResultSchema.parse(result)).not.toThrow();
  });
});
