import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import { CITY_DISTRICTS, findDistrict, garrisonOf } from '../city.js';
import { GOVERNMENT } from '../factions.js';
import {
  AttritionBattleEngine,
  assaultRating,
  attackerWinChance,
  defaultBattleEngine,
} from './engine.js';
import { BattleResultSchema } from './types.js';

const raidDistrict = CITY_DISTRICTS.find((d) => d.kind === 'raid');
if (!raidDistrict) throw new Error('fixture error: city map has no raid district');

/** Bases are created with `randomUUID()`, so the fixture id must be UUID-shaped. */
const attacker = {
  attackerBaseId: 'b5601950-0e4d-4862-af9a-dbf0ede0b4c0',
  attackerBaseName: 'Ashfall Foundry',
  attackerAttributes: makeAttributes(20),
  /** Bare ground and no haulage — the baseline every case below varies one thing off. */
  defenderDefense: 0,
  attackerLootBonus: 0,
  seed: 'fixture-seed',
};
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Distinct battle seeds. Sampling the real generator, not a hand-picked pair that flatters it. */
function seeds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `seed-${i}`);
}

/** Share of seeded raids this sheet takes on this ground. */
function winRate(attributes: ReturnType<typeof makeAttributes>, targetDistrictId: string): number {
  const engine = new AttritionBattleEngine();
  const sample = seeds(400);
  const won = sample.filter(
    (seed) =>
      engine.simulate({ ...attacker, attackerAttributes: attributes, seed, targetDistrictId })
        .winner === 'attacker',
  ).length;
  return won / sample.length;
}

const raids = CITY_DISTRICTS.filter((d) => d.kind === 'raid');
const byDifficulty = [...raids].sort((a, b) => a.difficulty - b.difficulty);
const lowestDifficultyRaid = () => byDifficulty[0]!;
const highestDifficultyRaid = () => byDifficulty[byDifficulty.length - 1]!;

describe('AttritionBattleEngine', () => {
  it('pays out the target district rewards when the attacker wins', () => {
    const engine = new AttritionBattleEngine(() => 0); // below MIN_WIN_CHANCE -> attacker wins
    const result = engine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });

    expect(result.winner).toBe('attacker');
    expect(result.rewards).toEqual(raidDistrict.rewards);
    expect(result.log.length).toBeGreaterThan(0);
  });

  it('pays nothing when the defender wins', () => {
    const engine = new AttritionBattleEngine(() => 0.99); // above MAX_WIN_CHANCE -> defender wins
    const result = engine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });

    expect(result.winner).toBe('defender');
    expect(result.rewards).toEqual({});
  });

  it('handles unknown districts without throwing', () => {
    const engine = new AttritionBattleEngine(() => 0);
    const result = engine.simulate({ ...attacker, targetDistrictId: 'nowhere' });

    expect(findDistrict('nowhere')).toBeUndefined();
    expect(result.rewards).toEqual({});
  });

  it('produces results that satisfy BattleResultSchema', () => {
    const result = defaultBattleEngine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });
    expect(() => BattleResultSchema.parse(result)).not.toThrow();
  });

  it('narrates the attacking base by name', () => {
    const engine = new AttritionBattleEngine(() => 0);
    const result = engine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });

    expect(result.log[0]).toContain(attacker.attackerBaseName);
  });

  it('names the Combine garrison holding a government site (§A3)', () => {
    const spire = findDistrict('combine-spire');
    if (!spire) throw new Error('fixture error: the city map has no Combine spire');

    const log = new AttritionBattleEngine(() => 0)
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
      const log = new AttritionBattleEngine(random)
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
      new AttritionBattleEngine(() => 0)
        .simulate({ ...attacker, targetDistrictId })
        .log.find((line) => line.startsWith('Salvage crews'));

    expect(victoryLine(spire.id)).toContain(`${GOVERNMENT.adjective} response teams arrive.`);
    expect(victoryLine(independent.id)).toContain('before anyone else arrives.');
  });

  it('resolves the same battle the same way every time', () => {
    const engine = new AttritionBattleEngine();
    const once = engine.simulate({ ...attacker, targetDistrictId: raidDistrict.id });

    for (let i = 0; i < 20; i += 1) {
      expect(engine.simulate({ ...attacker, targetDistrictId: raidDistrict.id })).toEqual(once);
    }
  });

  it('is not a constant — the seed is what moves the outcome', () => {
    const engine = new AttritionBattleEngine();
    const winners = new Set(
      seeds(200).map(
        (seed) => engine.simulate({ ...attacker, seed, targetDistrictId: raidDistrict.id }).winner,
      ),
    );

    expect(winners).toEqual(new Set(['attacker', 'defender']));
  });

  /**
   * The whole point of replacing the coin flip. Stated in both directions on purpose: a model that
   * only ever paid *out* for a good sheet would pass a one-sided version of this while a model that
   * ignored difficulty entirely passed the other.
   */
  it('rewards a better sheet and punishes harder ground', () => {
    const green = makeAttributes(10);
    const veteran = makeAttributes(60);

    expect(winRate(veteran, raidDistrict.id)).toBeGreaterThan(winRate(green, raidDistrict.id));

    const easiest = lowestDifficultyRaid();
    const hardest = highestDifficultyRaid();
    expect(hardest.difficulty).toBeGreaterThan(easiest.difficulty);
    expect(winRate(veteran, easiest.id)).toBeGreaterThan(winRate(veteran, hardest.id));
  });

  it('never makes a raid a certainty or a foregone loss', () => {
    const hopeless = attackerWinChance(makeAttributes(0), 10);
    const overwhelming = attackerWinChance(makeAttributes(100), 1);

    expect(hopeless).toBeGreaterThan(0);
    expect(overwhelming).toBeLessThan(1);

    // And the clamp is reachable from both ends, so neither bound is dead code.
    expect(hopeless).toBeLessThan(0.5);
    expect(overwhelming).toBeGreaterThan(0.5);
  });

  it('never leaks a raw id into the narration log', () => {
    for (const random of [() => 0, () => 0.99]) {
      for (const targetDistrictId of [raidDistrict.id, 'nowhere']) {
        const log = new AttritionBattleEngine(random).simulate({
          ...attacker,
          targetDistrictId,
        }).log;

        for (const line of log) {
          expect(line).not.toMatch(UUID_RE);
          expect(line).not.toContain(attacker.attackerBaseId);
          expect(line).not.toContain(targetDistrictId);
        }
      }
    }
  });
});

describe('the combat model', () => {
  it('rates a flat sheet at its own value — the weights are a weighting, not a sum', () => {
    // Independent anchor: 0.5 + 0.3 + 0.2 = 1, so a crew rated N everywhere assaults at N.
    for (const value of [0, 20, 55, 100]) {
      expect(assaultRating(makeAttributes(value))).toBeCloseTo(value, 10);
    }
  });

  it('reads tactics, leadership and hacking — and nothing else', () => {
    const flat = makeAttributes(0);
    expect(assaultRating(flat)).toBe(0);

    expect(assaultRating(makeAttributes(0, { tactics: 100 }))).toBeCloseTo(50, 10);
    expect(assaultRating(makeAttributes(0, { leadership: 100 }))).toBeCloseTo(30, 10);
    expect(assaultRating(makeAttributes(0, { hacking: 100 }))).toBeCloseTo(20, 10);

    // A raid is not led with a wrench: an attribute outside the three moves nothing.
    expect(assaultRating(makeAttributes(0, { engineering: 100 }))).toBe(0);
  });

  it('is an even fight when the sheet exactly matches the ground', () => {
    // difficulty 5 -> resistance 40, so a crew rated 40 across the three is a coin flip.
    expect(attackerWinChance(makeAttributes(40), 5)).toBeCloseTo(0.5, 10);
  });
});
