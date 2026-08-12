import { describe, expect, it } from 'vitest';
import { CITY_DISTRICTS, findDistrict } from '../city.js';
import { RandomBattleEngine, defaultBattleEngine } from './engine.js';
import { BattleResultSchema } from './types.js';

const raidDistrict = CITY_DISTRICTS.find((d) => d.kind === 'raid');
if (!raidDistrict) throw new Error('fixture error: city map has no raid district');

/** Bases are created with `randomUUID()`, so the fixture id must be UUID-shaped. */
const attacker = {
  attackerBaseId: 'b5601950-0e4d-4862-af9a-dbf0ede0b4c0',
  attackerBaseName: 'Ashfall Foundry',
};
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('RandomBattleEngine', () => {
  it('pays out the target district rewards when the attacker wins', () => {
    const engine = new RandomBattleEngine(() => 0); // 0 < 0.5 -> attacker wins
    const result = engine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });

    expect(result.winner).toBe('attacker');
    expect(result.rewards).toEqual(raidDistrict.rewards);
    expect(result.log.length).toBeGreaterThan(0);
  });

  it('pays nothing when the defender wins', () => {
    const engine = new RandomBattleEngine(() => 0.99); // 0.99 >= 0.5 -> defender wins
    const result = engine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });

    expect(result.winner).toBe('defender');
    expect(result.rewards).toEqual({});
  });

  it('handles unknown districts without throwing', () => {
    const engine = new RandomBattleEngine(() => 0);
    const result = engine.simulate({ ...attacker, targetDistrictId: 'nowhere' });

    expect(findDistrict('nowhere')).toBeUndefined();
    expect(result.rewards).toEqual({});
  });

  it('produces results that satisfy BattleResultSchema', () => {
    const result = defaultBattleEngine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });
    expect(() => BattleResultSchema.parse(result)).not.toThrow();
  });

  it('narrates the attacking base by name', () => {
    const engine = new RandomBattleEngine(() => 0);
    const result = engine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });

    expect(result.log[0]).toContain(attacker.attackerBaseName);
  });

  it('never leaks a raw id into the narration log', () => {
    for (const random of [() => 0, () => 0.99]) {
      for (const targetDistrictId of [raidDistrict.id, 'nowhere']) {
        const log = new RandomBattleEngine(random).simulate({ ...attacker, targetDistrictId }).log;

        for (const line of log) {
          expect(line).not.toMatch(UUID_RE);
          expect(line).not.toContain(attacker.attackerBaseId);
          expect(line).not.toContain(targetDistrictId);
        }
      }
    }
  });
});
