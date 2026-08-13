import { describe, expect, it } from 'vitest';
import { CITY_DISTRICTS, findDistrict, garrisonOf } from '../city.js';
import { GOVERNMENT } from '../factions.js';
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

  it('names the Combine garrison holding a government site (§A3)', () => {
    const spire = findDistrict('combine-spire');
    if (!spire) throw new Error('fixture error: the city map has no Combine spire');

    const log = new RandomBattleEngine(() => 0)
      .simulate({ ...attacker, targetDistrictId: spire.id })
      .log.join(' ');

    expect(log).toContain(garrisonOf(spire));
    expect(log).toContain(GOVERNMENT.adjective);
  });

  it('does not narrate independent ground as the government', () => {
    const independent = CITY_DISTRICTS.find(
      (d) => d.faction === 'independent' && d.kind === 'raid',
    );
    if (!independent) throw new Error('fixture error: the city map has no independent raid site');

    for (const random of [() => 0, () => 0.99]) {
      const log = new RandomBattleEngine(random)
        .simulate({ ...attacker, targetDistrictId: independent.id })
        .log.join(' ');

      expect(log).not.toContain(GOVERNMENT.adjective);
      expect(log).toContain(garrisonOf(independent));
    }
  });

  it('keeps the victory line grammatical on both kinds of ground', () => {
    // Dropping the Combine's name out of the line also drops its plural subject, so the verb has
    // to move with the branch — checking only that the adjective is absent passes over "arrive".
    const spire = findDistrict('combine-spire');
    const independent = CITY_DISTRICTS.find(
      (d) => d.faction === 'independent' && d.kind === 'raid',
    );
    if (!spire || !independent)
      throw new Error('fixture error: the city map is missing a district');

    const victoryLine = (targetDistrictId: string) =>
      new RandomBattleEngine(() => 0)
        .simulate({ ...attacker, targetDistrictId })
        .log.find((line) => line.startsWith('Salvage crews'));

    expect(victoryLine(spire.id)).toContain(`${GOVERNMENT.adjective} response teams arrive.`);
    expect(victoryLine(independent.id)).toContain('before anyone else arrives.');
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
