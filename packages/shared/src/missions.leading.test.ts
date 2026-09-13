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
  battleTierFor,
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
  it('tiers a battle off its difficulty and distance unless authored', () => {
    expect(battleTierFor({ kind: 'standard', difficulty: 'hard', travelBand: 'close' })).toBeNull();
    expect(battleTierFor({ kind: 'battle', difficulty: 'easy', travelBand: 'furthest' })).toBe(
      'skirmish',
    );
    expect(battleTierFor({ kind: 'battle', difficulty: 'hard', travelBand: 'further' })).toBe(
      'fight',
    );
    expect(battleTierFor({ kind: 'battle', difficulty: 'hard', travelBand: 'furthest' })).toBe(
      'siege',
    );
    expect(
      battleTierFor({
        kind: 'battle',
        difficulty: 'easy',
        travelBand: 'close',
        battleTier: 'siege',
      }),
    ).toBe('siege');
  });

  it('measures a force by what it hits with and what it can take', () => {
    const razor = findUnit('razors')!;
    expect(fieldStrength({ razors: 1 })).toBe(razor.stats.offense + razor.stats.vitality / 5);
    expect(fieldStrength({ razors: 4 })).toBe(4 * fieldStrength({ razors: 1 }));
    expect(fieldStrength({})).toBe(0);
    expect(fieldStrength({ not_a_unit: 9 })).toBe(0);
  });

  it('fields more every level, from the tier’s figure at level one', () => {
    expect(enemyStrength('fight', 1)).toBe(BATTLE_TIER_STRENGTH.fight);
    expect(enemyStrength('fight', 11)).toBeGreaterThan(enemyStrength('fight', 1));
    expect(enemyStrength('siege', 1)).toBeGreaterThan(enemyStrength('fight', 1));
    expect(enemyStrength('fight', 1)).toBeGreaterThan(enemyStrength('skirmish', 1));
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
