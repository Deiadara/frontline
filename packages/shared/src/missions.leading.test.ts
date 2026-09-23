import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_NAMES, type Attributes } from './attributes.js';
import { findUnit } from './units/index.js';
import { MISSION_TEMPLATES } from './missions.js';
import {
  BATTLE_TIER_STRENGTH,
  CHANCE_TONES,
  LEADER_NEUTRAL_FIT,
  LEANING_PROFILES,
  MAX_LEADER_EDGE,
  MISSION_LEANINGS,
  MISSION_LEANING_REASONS,
  RESEARCH_UNLED_FREE,
  RESEARCH_UNLED_PENALISED,
  UNLED_PENALTY,
  battleOdds,
  BATTLE_TIERS,
  BATTLE_TIER_REWARD,
  SIEGE_SHARE,
  SIEGE_UNLOCK_LEVEL,
  battleTierOdds,
  dealBattleTier,
  type BattleTier,
  bestLeader,
  chanceTone,
  composeProfile,
  enemyStrength,
  fieldStrength,
  leaderEdge,
  leaderFit,
  leaningsFor,
  missionOdds,
  unledRule,
} from './missions.leading.js';

const sheet = (value: number, over: Partial<Attributes> = {}): Attributes =>
  Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, over[name] ?? value])) as Attributes;

describe('leanings and their profiles', () => {
  it('gives every leaning exactly one irreplaceable attribute, the way a chair has', () => {
    for (const leaning of MISSION_LEANINGS) {
      const irreplaceable = Object.values(LEANING_PROFILES[leaning]).filter(
        (importance) => importance === 'irreplaceable',
      );
      expect(irreplaceable, leaning).toHaveLength(1);
    }
  });

  /**
   * Every leaning is something some job on the board actually asks for.
   *
   * `wire` and `medic` shipped with full profiles, labels and reasons and **no job in the game**
   * asking for either, so the Signals officer and the Chief Medic could never be the right person
   * to lead a run: two eighths of the leader-fit system was content nothing could reach. The
   * same rule the feats catalogue holds itself to, one screen over: a mechanic with nothing behind
   * it is invisible to the player and silent to every gate.
   *
   * Measured through `leaningsFor` rather than off the authored field, because most jobs carry no
   * `leanings` at all and are read off their kind and their distance.
   */
  it('has a job somewhere that asks for each leaning', () => {
    const asked = new Set(MISSION_TEMPLATES.flatMap((template) => leaningsFor(template)));
    const orphans = MISSION_LEANINGS.filter((leaning) => !asked.has(leaning));
    expect(orphans, 'leanings no job on the board ever asks for').toEqual([]);
  });

  it('composes two leanings by keeping the higher importance where they overlap', () => {
    // `composure` is essential to quiet work and merely useful in a fight.
    const profile = composeProfile(['fight', 'stealth']);
    expect(profile.composure).toBe('essential');
    expect(profile.leadership).toBe('irreplaceable');
    expect(profile.stealth).toBe('irreplaceable');
    expect(composeProfile([])).toEqual({});
  });

  it('reads a job off its card unless the template says otherwise', () => {
    expect(leaningsFor({ kind: 'battle', travelBand: 'close' })).toEqual(['fight']);
    expect(leaningsFor({ kind: 'battle', travelBand: 'furthest' })).toEqual(['fight', 'road']);
    expect(leaningsFor({ kind: 'standard', travelBand: 'close' })).toEqual(['haul', 'salvage']);
    expect(leaningsFor({ kind: 'standard', travelBand: 'furthest' })).toEqual([
      'haul',
      'salvage',
      'road',
    ]);
    // An authored list is believed whole, not added to: the far band does not creep back in.
    expect(leaningsFor({ kind: 'battle', travelBand: 'furthest', leanings: ['wire'] })).toEqual([
      'wire',
    ]);
  });

  /*
   * The maintainer kept its shape when `stance` was deleted (2026-09-12).
   *
   * Thirteen jobs used to get `stealth` or `talk` from which way they pointed at the Combine, and
   * they now carry those leanings in writing. This is the pin on that migration: if somebody drops
   * an authored list while tidying, the board silently loses a leaning and no other test notices,
   * because every remaining assertion is about the *rule* rather than about the content.
   */
  it('keeps quiet work quiet and talking jobs talkative, in writing', () => {
    const leaningsOf = (id: string) => {
      const template = MISSION_TEMPLATES.find((candidate) => candidate.id === id);
      if (!template) throw new Error(`no such mission template: ${id}`);
      return leaningsFor(template);
    };
    for (const id of ['fuel-siphon', 'cable-strip', 'archive-lift', 'rail-cut']) {
      expect(leaningsOf(id)).toContain('stealth');
    }
    for (const id of ['courier-contract', 'curfew-sweep', 'census-sweep', 'gate-duty']) {
      expect(leaningsOf(id)).toContain('talk');
    }
    expect(leaningsOf('blacksite-probe')).toEqual(['haul', 'salvage', 'stealth', 'road']);
    expect(leaningsOf('spire-courier')).toEqual(['haul', 'salvage', 'talk', 'road']);
  });

  it('gives every leaning a sentence saying what it wants and why', () => {
    for (const leaning of MISSION_LEANINGS) {
      const reason = MISSION_LEANING_REASONS[leaning];
      expect(reason.length).toBeGreaterThan(40);
      // The hover has to name attributes a player can go and look at, or it is atmosphere. Every
      // sentence mentions at least one of the attributes its own profile actually reads.
      const named = Object.keys(LEANING_PROFILES[leaning]).filter((attribute) =>
        reason.toLowerCase().includes(attribute.toLowerCase()),
      );
      expect(named.length).toBeGreaterThan(0);
    }
  });
});

describe('a leader’s fit and edge', () => {
  const profile = composeProfile(['fight']);

  it('runs from nothing to everything, and only reads what the job leans on', () => {
    expect(leaderFit(sheet(0), profile).fit).toBe(0);
    expect(leaderFit(sheet(100), profile).fit).toBe(1);
    // Everything the fight ignores at 100, everything it reads at 0: still nothing.
    const irrelevant = sheet(100, {
      leadership: 0,
      strategy: 0,
      toughness: 0,
      reflexes: 0,
      intimidation: 0,
      composure: 0,
    });
    expect(leaderFit(irrelevant, profile).fit).toBe(0);
  });

  it('weighs the irreplaceable attribute more than a useful one', () => {
    const leader = leaderFit(sheet(0, { leadership: 60 }), profile).fit;
    const reflexes = leaderFit(sheet(0, { reflexes: 60 }), profile).fit;
    expect(leader).toBeGreaterThan(reflexes);
  });

  it('moves the odds symmetrically about the neutral fit and never past the cap', () => {
    expect(leaderEdge(LEADER_NEUTRAL_FIT)).toBe(0);
    expect(leaderEdge(1)).toBeCloseTo(MAX_LEADER_EDGE, 9);
    expect(leaderEdge(0)).toBeCloseTo(-MAX_LEADER_EDGE, 9);
    expect(leaderEdge(2)).toBeCloseTo(MAX_LEADER_EDGE, 9);
    expect(leaderEdge(0.5)).toBeGreaterThan(0);
    expect(leaderEdge(0.1)).toBeLessThan(0);
  });
});

describe('the odds a run goes out with', () => {
  const profile = composeProfile(['haul']);

  it('adds a good leader and subtracts a bad one, inside 0 and 1', () => {
    const good = missionOdds({ authored: 0.6, leader: sheet(90), profile, unled: 'forbidden' });
    const bad = missionOdds({ authored: 0.6, leader: sheet(2), profile, unled: 'forbidden' });
    expect(good.allowed).toBe(true);
    expect(good.chance).toBeGreaterThan(0.6);
    expect(bad.chance).toBeLessThan(0.6);
    expect(missionOdds({ authored: 0.95, leader: sheet(100), profile, unled: 'free' }).chance).toBe(
      1,
    );
  });

  it('refuses an unled run until research allows it, then penalises, then does not', () => {
    const forbidden = missionOdds({ authored: 0.6, leader: null, profile, unled: 'forbidden' });
    expect(forbidden.allowed).toBe(false);
    expect(forbidden.refusal).toBe('needs_leader');
    expect(forbidden.chance).toBe(0);
    const penalised = missionOdds({ authored: 0.6, leader: null, profile, unled: 'penalised' });
    expect(penalised.allowed).toBe(true);
    expect(penalised.chance).toBeCloseTo(0.6 - UNLED_PENALTY, 9);
    expect(penalised.edge).toBeCloseTo(-UNLED_PENALTY, 9);
    const free = missionOdds({ authored: 0.6, leader: null, profile, unled: 'free' });
    expect(free.chance).toBe(0.6);
    expect(free.edge).toBe(0);
  });

  it('reads the rule off the research the crew holds', () => {
    expect(unledRule([])).toBe('forbidden');
    expect(unledRule([RESEARCH_UNLED_PENALISED])).toBe('penalised');
    expect(unledRule([RESEARCH_UNLED_PENALISED, RESEARCH_UNLED_FREE])).toBe('free');
    // The second rung on its own opens nothing: it lifts the first one's cost, and there is no
    // cost to lift until the crew has written the orders down.
    expect(unledRule([RESEARCH_UNLED_FREE])).toBe('forbidden');
  });

  it('picks the best fit for the job, and nobody from nobody', () => {
    const candidates = [
      { id: 'a', attributes: sheet(20) },
      { id: 'b', attributes: sheet(20, { logistics: 90 }) },
      { id: 'c', attributes: sheet(20, { leadership: 90 }) },
    ];
    expect(bestLeader(candidates, profile)?.id).toBe('b');
    expect(bestLeader(candidates, composeProfile(['fight']))?.id).toBe('c');
    expect(bestLeader([], profile)).toBeNull();
    // A tie goes to the first named.
    expect(bestLeader([candidates[0]!, { id: 'd', attributes: sheet(20) }], profile)?.id).toBe('a');
  });
});

describe('the gauge', () => {
  it('has five bands of twenty points, red to blue', () => {
    expect(chanceTone(0)).toBe('red');
    expect(chanceTone(0.19)).toBe('red');
    expect(chanceTone(0.2)).toBe('orange');
    expect(chanceTone(0.4)).toBe('yellow');
    expect(chanceTone(0.6)).toBe('green');
    expect(chanceTone(0.8)).toBe('blue');
    expect(chanceTone(1)).toBe('blue');
    expect(CHANCE_TONES).toEqual(['red', 'orange', 'yellow', 'green', 'blue']);
  });
});

describe('battles', () => {
  /**
   * The deal, by level (maintainer, 2026-09-23): each tier peaks where the maintainer put it, the
   * shares always sum to one, from 70 the table is fixed, and the Siege takes its sliver off Fight
   * V and nothing else from 90.
   */
  it('deals each tier most often at the level the maintainer named', () => {
    const top = (level: number): BattleTier =>
      BATTLE_TIERS.reduce((best, tier) =>
        battleTierOdds(level)[tier] > battleTierOdds(level)[best] ? tier : best,
      );
    expect(top(1)).toBe('fight_1');
    expect(top(10)).toBe('fight_2');
    expect(top(25)).toBe('fight_3');
    expect(top(40)).toBe('fight_4');
    expect(top(70)).toBe('fight_5');
    for (const level of [1, 7, 10, 18, 25, 33, 40, 48, 55, 63, 70, 85, 90, 120]) {
      const sum = BATTLE_TIERS.reduce((total, tier) => total + battleTierOdds(level)[tier], 0);
      expect(sum, `level ${String(level)}`).toBeCloseTo(1, 10);
    }
  });

  it('lets a heavier fight through rarely below its level, and never a Siege before ninety', () => {
    // A Fight V at 38: possible, and rare. At 60: a real share, under the half it is at 70.
    expect(battleTierOdds(38).fight_5).toBeGreaterThan(0);
    expect(battleTierOdds(38).fight_5).toBeLessThan(0.05);
    expect(battleTierOdds(60).fight_5).toBeGreaterThan(0.3);
    expect(battleTierOdds(60).fight_5).toBeLessThan(0.5);
    // Fixed from seventy: 2 / 6 / 12 / 30 / 50, and the same at eighty.
    expect(battleTierOdds(70)).toEqual({
      fight_1: 0.02,
      fight_2: 0.06,
      fight_3: 0.12,
      fight_4: 0.3,
      fight_5: 0.5,
      siege: 0,
    });
    expect(battleTierOdds(80)).toEqual(battleTierOdds(70));
    // Ninety: the Siege takes five points off Fight V and nothing off anything else.
    expect(battleTierOdds(SIEGE_UNLOCK_LEVEL).siege).toBeCloseTo(SIEGE_SHARE, 10);
    expect(battleTierOdds(SIEGE_UNLOCK_LEVEL).fight_5).toBeCloseTo(0.5 - SIEGE_SHARE, 10);
    expect(battleTierOdds(SIEGE_UNLOCK_LEVEL).fight_4).toBe(0.3);
    for (const level of [1, 40, 89]) expect(battleTierOdds(level).siege).toBe(0);
  });

  it('deals the same card the same tier, and the deal follows the odds', () => {
    expect(dealBattleTier('misc', '2026-09-23', 'convoy-ambush', 12)).toBe(
      dealBattleTier('misc', '2026-09-23', 'convoy-ambush', 12),
    );
    // Over many boards at one level, every tier the odds allow turns up about as often as they
    // say, and a tier the odds forbid never does.
    const level = 25;
    const counts: Record<string, number> = {};
    const boards = 4_000;
    for (let day = 0; day < boards; day += 1) {
      const tier = dealBattleTier('kettle-row', `day-${String(day)}`, 'convoy-ambush', level);
      counts[tier] = (counts[tier] ?? 0) + 1;
    }
    for (const tier of BATTLE_TIERS) {
      const share = (counts[tier] ?? 0) / boards;
      expect(Math.abs(share - battleTierOdds(level)[tier]), tier).toBeLessThan(0.03);
    }
    expect(counts.siege ?? 0).toBe(0);
  });

  it('measures a force by what it hits with and what it can take', () => {
    const razor = findUnit('razors')!;
    expect(fieldStrength({ razors: 1 })).toBe(razor.stats.offense + razor.stats.vitality / 5);
    expect(fieldStrength({ razors: 4 })).toBe(4 * fieldStrength({ razors: 1 }));
    expect(fieldStrength({})).toBe(0);
    expect(fieldStrength({ not_a_unit: 9 })).toBe(0);
  });

  it('fields more every level, from the tier’s figure at level one', () => {
    expect(enemyStrength('fight_3', 1)).toBe(BATTLE_TIER_STRENGTH.fight_3);
    expect(enemyStrength('fight_3', 11)).toBeGreaterThan(enemyStrength('fight_3', 1));
    // Every rung heavier than the one under it, the Siege on top.
    for (let index = 1; index < BATTLE_TIERS.length; index += 1) {
      expect(enemyStrength(BATTLE_TIERS[index]!, 1)).toBeGreaterThan(
        enemyStrength(BATTLE_TIERS[index - 1]!, 1),
      );
      expect(BATTLE_TIER_REWARD[BATTLE_TIERS[index]!]).toBeGreaterThan(
        BATTLE_TIER_REWARD[BATTLE_TIERS[index - 1]!],
      );
    }
  });

  it('bands the fight off the ratio, the leader folded in as a share of the force', () => {
    expect(battleOdds({ ours: 600, theirs: 1000, edge: 0 })).toBe('low');
    expect(battleOdds({ ours: 900, theirs: 1000, edge: 0 })).toBe('moderate');
    expect(battleOdds({ ours: 1200, theirs: 1000, edge: 0 })).toBe('good');
    expect(battleOdds({ ours: 1600, theirs: 1000, edge: 0 })).toBe('very_high');
    // A strong leader lifts a moderate fight to a good one; a weak one drops it.
    expect(battleOdds({ ours: 900, theirs: 1000, edge: 0.2 })).toBe('good');
    expect(battleOdds({ ours: 720, theirs: 1000, edge: -0.1 })).toBe('low');
    expect(battleOdds({ ours: 0, theirs: 0, edge: 0 })).toBe('very_high');
  });
});
