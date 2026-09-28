import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_NAMES, type Attributes } from './attributes.js';
import { findUnit } from './units/index.js';
import { MISSION_TEMPLATES } from './missions.js';
import {
  CHANCE_TONES,
  LEADER_NEUTRAL_FIT,
  LEANING_PROFILES,
  MAX_LEADER_EDGE,
  MISSION_LEANINGS,
  MISSION_LEANING_REASONS,
  battleOdds,
  bestLeader,
  chanceTone,
  composeProfile,
  fieldStrength,
  leaderEdge,
  leaderFit,
  leaderGradeIndex,
  leaderMark,
  leaningsFor,
  missionOdds,
} from './missions.leading.js';
import { OFFICER_MARK_BAND, OFFICER_MARK_FLOOR } from './crew/marks.js';

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

  it('reads what a job leans on off the job, one to three, and a fight on `fight` alone', () => {
    for (const template of MISSION_TEMPLATES) {
      const leanings = leaningsFor(template);
      expect(leanings.length, template.id).toBeGreaterThan(0);
      expect(leanings.length, template.id).toBeLessThanOrEqual(3);
      expect(leanings.includes('fight'), template.id).toBe(template.kind === 'battle');
      // A fight leans on the fight and nothing else (maintainer, 2026-09-28): its leader is
      // settled by fighting it, and a second tag would grade the bench on a sheet the engine
      // never reads.
      if (template.kind === 'battle') expect(leanings, template.id).toEqual(['fight']);
    }
  });

  /**
   * Every attribute on the sheet is read by some job (maintainer, 2026-09-28: "I want a lot of
   * officers to be useful"). An attribute no leaning names is a stat that never moves a job's odds,
   * so an officer built on it is dead weight on the missions screen.
   */
  it('reads every attribute somewhere', () => {
    const read = new Set(
      MISSION_LEANINGS.flatMap((leaning) => Object.keys(LEANING_PROFILES[leaning])),
    );
    const unread = ATTRIBUTE_NAMES.filter((name) => !read.has(name));
    expect(unread, 'attributes no job ever asks for').toEqual([]);
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
  /** A sheet whose haul reading sits in the middle of the band at this index. */
  const gradedAt = (index: number): Attributes =>
    sheet(OFFICER_MARK_FLOOR + (index + 0.5) * OFFICER_MARK_BAND);

  it('grades a leader for the job off what the job reads, not off their best track', () => {
    // Middle of the B+ band on everything the job reads: B+ exactly.
    expect(leaderGradeIndex(gradedAt(14), profile)).toBeCloseTo(14, 9);
    expect(leaderMark(gradedAt(14), profile)).toBe('B+');
    // A brilliant medic is nobody on a haul.
    const medic = sheet(OFFICER_MARK_FLOOR, { medicine: 100 });
    expect(leaderMark(medic, profile)).toBe('F-');
    expect(leaderMark(medic, composeProfile(['medic']))).not.toBe('F-');
  });

  it('lands the maintainer’s anchors: level 75%, three short about 30%, three over 95%, five over certain', () => {
    const at = (leader: number, job: 'B+' | 'C+' | 'A+') =>
      missionOdds({ grade: job, leader: gradedAt(leader), profile }).chance;
    expect(at(14, 'B+')).toBeCloseTo(0.75, 2);
    expect(at(11, 'B+')).toBeCloseTo(0.3, 2);
    expect(at(17, 'B+')).toBeCloseTo(0.95, 2);
    expect(missionOdds({ grade: 'C+', leader: gradedAt(19), profile }).chance).toBe(1);
    // Far below is next to nothing and still not nothing.
    const hopeless = at(1, 'B+');
    expect(hopeless).toBeGreaterThan(0);
    expect(hopeless).toBeLessThan(0.01);
  });

  it('climbs with the leader and falls with the job, all the way along', () => {
    for (let leader = 0; leader < 20; leader += 1) {
      const lower = missionOdds({ grade: 'C', leader: gradedAt(leader), profile }).chance;
      const higher = missionOdds({ grade: 'C', leader: gradedAt(leader + 1), profile }).chance;
      expect(higher, `leader ${String(leader)}`).toBeGreaterThanOrEqual(lower);
    }
    const easy = missionOdds({ grade: 'D', leader: gradedAt(10), profile }).chance;
    const hard = missionOdds({ grade: 'B', leader: gradedAt(10), profile }).chance;
    expect(easy).toBeGreaterThan(hard);
  });

  it('sends nobody unled', () => {
    const unled = missionOdds({ grade: 'F-', leader: null, profile });
    expect(unled.allowed).toBe(false);
    expect(unled.refusal).toBe('needs_leader');
    expect(unled.chance).toBe(0);
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

  it('picks the leader with the best odds, where the fit points and the grade disagree', () => {
    // The fit adds band bonuses the odds do not read: a 50 in medicine crosses a band a 49 does
    // not, so `leaderFit` prefers the first sheet while the second grades higher for the job.
    const medic = composeProfile(['medic']);
    const banded = { id: 'banded', attributes: sheet(24, { medicine: 50 }) };
    const graded = { id: 'graded', attributes: sheet(26, { medicine: 49 }) };
    expect(leaderFit(banded.attributes, medic).fit).toBeGreaterThan(
      leaderFit(graded.attributes, medic).fit,
    );
    const odds = (one: typeof banded) =>
      missionOdds({ grade: 'D', leader: one.attributes, profile: medic }).chance;
    expect(odds(graded)).toBeGreaterThan(odds(banded));
    expect(bestLeader([banded, graded], medic)?.id).toBe('graded');
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
  it('measures a force by what it hits with and what it can take', () => {
    const razor = findUnit('razors')!;
    expect(fieldStrength({ razors: 1 })).toBe(razor.stats.offense + razor.stats.vitality / 5);
    expect(fieldStrength({ razors: 4 })).toBe(4 * fieldStrength({ razors: 1 }));
    expect(fieldStrength({})).toBe(0);
    expect(fieldStrength({ not_a_unit: 9 })).toBe(0);
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
