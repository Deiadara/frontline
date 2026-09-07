import { describe, expect, it } from 'vitest';
import { TRAP_CATALOG } from '../battle/traps.js';
import { BATTLE_BOOSTS } from '../battle/boosts.js';
import { noCrewEffects } from '../crew/effects.js';
import { findUnit } from '../units/catalog.js';
import { OFFICER_MARKS, markIndex, type OfficerMark } from '../crew/marks.js';
import { OFFICER_ROLES } from '../roles.js';
import { ResearchStateSchema } from './state.js';
import {
  HEAD_MARK_THRESHOLDS,
  MAX_RESEARCH_COST_CUT,
  MAX_RESEARCH_TIME_CUT,
  PAYOUT_FAMILIES,
  REIMAGINING_RESEARCH_ID,
  RESEARCH_ITEMS,
  RESEARCH_TRACK_BLURBS,
  RESEARCH_TRACK_STEPS,
  TRACK_MARKS,
  describeResearchPayout,
  findResearchItem,
  hardestRequiredMark,
  isReimaginingResearched,
  itemsInTrack,
  payoutFamily,
  requiredHeadMark,
  requiredTrackMark,
  researchEffects,
  researchItemCost,
  researchItemMinutes,
  researchItemRefusal,
  researchItemPrice,
  researchTimeCutPercent,
  researchUnlocks,
  trackCostCutPercent,
  trackProgress,
} from './tracks.js';

/**
 * §C, asserted against the brief rather than against the catalogue.
 *
 * Almost every number below is written out rather than recomputed from the function under test.
 * A test that derives `requiredTrackMark(4)` by calling `requiredTrackMark(4)` passes whatever the
 * ladder is, which is the one thing the board asked to be able to check.
 */

/** Nobody in either chair: the state every crew starts in. */
const EMPTY = { trackMark: null, headMark: null };

/** A chair pair good enough for anything: used where the test is about a different gate. */
const PERFECT: { trackMark: OfficerMark; headMark: OfficerMark } = {
  trackMark: 'S+',
  headMark: 'S+',
};

/** Everything up to but not including `step` on `track`, as a finished list. */
function finishedBelow(track: (typeof OFFICER_ROLES)[number], step: number): string[] {
  return itemsInTrack(track)
    .filter((spec) => spec.step < step)
    .map((spec) => spec.id);
}

describe('§C1: the shape of the tree', () => {
  it('is one track per officer role, ten rungs each', () => {
    expect(RESEARCH_TRACK_STEPS).toBe(10);
    expect(RESEARCH_ITEMS).toHaveLength(OFFICER_ROLES.length * 10);
    for (const role of OFFICER_ROLES) {
      expect(
        itemsInTrack(role).map((spec) => spec.step),
        role,
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(RESEARCH_TRACK_BLURBS[role].length, role).toBeGreaterThan(10);
    }
  });

  it('gives every rung an id of its own', () => {
    const ids = RESEARCH_ITEMS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(findResearchItem(id)?.id).toBe(id);
  });

  /**
   * The fifteen ids a save may already be holding.
   *
   * `research_json.technologies` is a list of strings and nothing filters it, so an id that stopped
   * existing would not fail a parse: it would pay out nothing, silently, for a crew that had bought
   * it. Written out rather than read from anywhere, because the point is that these exact strings
   * survive the rewrite.
   */
  it('keeps every id the old Lab tree could have written to a save', () => {
    const stored = [
      'tech_shift_rotation',
      'tech_line_balancing',
      'tech_critical_path',
      'tech_traffic_analysis',
      'tech_one_time_pads',
      'tech_false_traffic',
      'tech_field_triage',
      'tech_blood_bank',
      'tech_trauma_theatre',
      'tech_sorted_salvage',
      'tech_alloy_reclamation',
      'tech_standard_parts',
      'tech_pressure_plates',
      'tech_shaped_charges',
      'tech_demolition_doctrine',
    ];
    for (const id of stored) expect(findResearchItem(id), id).toBeDefined();

    /*
     * What each of these pays was re-dealt on 2026-09-04, on purpose: the board asked for rewards a
     * crew is planned around rather than a percentage per rung. A save that paid for Field Triage
     * still holds Field Triage; what it is worth is whatever the catalogue says today, the same way
     * every other retune has landed.
     */
    // ...and a state written before any of this parses, keeping what it held. The retired `facts`
    // key is stripped rather than refused, so a row migration 0077 has not reached still reads.
    expect(ResearchStateSchema.parse({ active: null, facts: [], technologies: stored })).toEqual({
      active: null,
      technologies: stored,
    });
    expect(ResearchStateSchema.parse({ active: null, facts: [] }).technologies).toEqual([]);
  });

  it('still answers the two catalogues that gate on a research id', () => {
    for (const trap of TRAP_CATALOG) {
      expect(findResearchItem(trap.requiresTech), trap.id).toBeDefined();
    }
    for (const boost of BATTLE_BOOSTS) {
      if (boost.unlock.kind !== 'tech') continue;
      expect(findResearchItem(boost.unlock.techId), boost.id).toBeDefined();
    }
  });
});

describe('§C2: the gating curve', () => {
  it('runs F- F F+ E- E+ D C B A S, and nothing asks for S+', () => {
    expect(TRACK_MARKS).toEqual(['F-', 'F', 'F+', 'E-', 'E+', 'D', 'C', 'B', 'A', 'S']);
    expect(hardestRequiredMark()).toBe('S');
    expect(OFFICER_MARKS[OFFICER_MARKS.length - 1]).toBe('S+');
    for (const spec of RESEARCH_ITEMS) {
      expect(spec.requiresMark, spec.id).not.toBe('S+');
      expect(spec.requiresHeadMark, spec.id).not.toBe('S+');
    }
  });

  /** §C2b and §C2c: gentle early, harder late, and a curve rather than a straight line. */
  it('climbs by widening steps', () => {
    const gaps = TRACK_MARKS.slice(1).map(
      (mark, index) => markIndex(mark) - markIndex(TRACK_MARKS[index] as OfficerMark),
    );
    expect(gaps).toEqual([1, 1, 1, 2, 2, 3, 3, 3, 3]);
    // Convex: no step is easier than the one before it, and the last is three times the first.
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1] as number);
    }
    expect(gaps.at(-1)).toBeGreaterThan(gaps[0] as number);
    // Not linear: an even ladder over 19 bands would put every gap at 2.
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('opens the first three rungs to a fresh recruit, and stops there', () => {
    // A recruit lands around F+ (`crew/marks.ts`), which is index 2.
    const fresh = { trackMark: 'F+' as const, headMark: 'S+' as const };
    const track = OFFICER_ROLES[0];
    if (!track) throw new Error('need a role');
    for (const step of [1, 2, 3]) {
      const spec = itemsInTrack(track)[step - 1];
      if (!spec) throw new Error('missing rung');
      expect(researchItemRefusal(spec.id, finishedBelow(track, step), fresh), spec.id).toBeNull();
    }
    const fourth = itemsInTrack(track)[3];
    if (!fourth) throw new Error('missing rung');
    expect(researchItemRefusal(fourth.id, finishedBelow(track, 4), fresh)).toBe(
      'track_mark_too_low',
    );
  });

  /** §C2e: the Head's own bar, after the 3rd, 5th and 7th. */
  it('asks the Head of Research for a mark from the fourth rung', () => {
    expect(HEAD_MARK_THRESHOLDS.map((entry) => entry.afterStep)).toEqual([3, 5, 7]);
    expect([1, 2, 3].map(requiredHeadMark)).toEqual([null, null, null]);
    expect([4, 5, 6, 7, 8, 9, 10].map(requiredHeadMark)).toEqual([
      'E',
      'E',
      'D+',
      'D+',
      'B+',
      'B+',
      'B+',
    ]);
  });

  /**
   * §C1d, as a property rather than as a sentiment.
   *
   * Whichever of the two marks is higher is the one actually shutting a rung. If the Head were
   * always the higher, the track's own officer would be decoration; if never, the Head's threshold
   * would be. So both have to bind somewhere, and this pins exactly where.
   */
  it('makes the Head the binding gate at 4, 6 and 8 and the specialist everywhere above', () => {
    const bindsOnHead: number[] = [];
    const bindsOnTrack: number[] = [];
    for (let step = 4; step <= 10; step += 1) {
      const head = requiredHeadMark(step);
      if (head === null) throw new Error('expected a head threshold');
      const gap = markIndex(head) - markIndex(requiredTrackMark(step));
      (gap > 0 ? bindsOnHead : bindsOnTrack).push(step);
      expect(gap, `step ${step}`).not.toBe(0);
    }
    expect(bindsOnHead).toEqual([4, 6, 8]);
    expect(bindsOnTrack).toEqual([5, 7, 9, 10]);
  });
});

describe('§C1b/§C1c: who has to be in a chair', () => {
  const track = 'chief_medic';
  const first = itemsInTrack(track)[0];
  if (!first) throw new Error('need a rung');

  it('refuses everything without a Head of Research', () => {
    for (const spec of RESEARCH_ITEMS) {
      expect(
        researchItemRefusal(spec.id, finishedBelow(spec.track, spec.step), EMPTY),
        spec.id,
      ).toBe('no_head_of_research');
    }
  });

  it('refuses a track whose own chair is empty, even with a perfect Head', () => {
    expect(researchItemRefusal(first.id, [], { trackMark: null, headMark: 'S+' })).toBe(
      'no_track_officer',
    );
  });

  it('refuses a rung whose predecessor is unfinished', () => {
    const third = itemsInTrack(track)[2];
    if (!third) throw new Error('need a rung');
    expect(researchItemRefusal(third.id, [], PERFECT)).toBe('needs_previous_step');
    expect(researchItemRefusal(third.id, finishedBelow(track, 3), PERFECT)).toBeNull();
  });

  it('refuses what is already done, and what does not exist', () => {
    expect(researchItemRefusal(first.id, [first.id], PERFECT)).toBe('already_known');
    expect(researchItemRefusal('tech_nothing_at_all', [], PERFECT)).toBe('unknown_item');
  });

  it('names the Head threshold rather than the track one when the Head is what is short', () => {
    const fourth = itemsInTrack(track)[3];
    if (!fourth) throw new Error('need a rung');
    const done = finishedBelow(track, 4);
    expect(researchItemRefusal(fourth.id, done, { trackMark: 'S+', headMark: 'F-' })).toBe(
      'head_mark_too_low',
    );
    expect(researchItemRefusal(fourth.id, done, { trackMark: 'S+', headMark: 'E' })).toBeNull();
  });
});

describe('§C4a: what a rung pays', () => {
  it('lands every one of the 190 in one of the eight kinds', () => {
    expect(PAYOUT_FAMILIES).toHaveLength(8);
    for (const spec of RESEARCH_ITEMS) {
      expect(PAYOUT_FAMILIES, spec.id).toContain(payoutFamily(spec.payout));
    }
  });

  it('is not a slider: the rewards come in many kinds, and every track mixes them', () => {
    const kinds = new Set(RESEARCH_ITEMS.map((spec) => spec.payout.bonus.kind));
    expect(kinds.size).toBeGreaterThan(30);
    for (const role of OFFICER_ROLES) {
      const own = new Set(itemsInTrack(role).map((spec) => spec.payout.bonus.kind));
      expect(own.size, role).toBeGreaterThanOrEqual(4);
    }
  });

  it('names units, structures and attributes that exist', () => {
    for (const spec of RESEARCH_ITEMS) {
      const bonus = spec.payout.bonus;
      if (bonus.kind === 'unit_kind') expect(findUnit(bonus.unitId), spec.id).toBeDefined();
      expect(describeResearchPayout(spec), spec.id).not.toMatch(/undefined/);
    }
  });

  it('keeps the doors for the deep rungs', () => {
    // A second crew out, another chair, another fight called: the grants a crew plans around,
    // and none of them on a rung a fresh recruit can reach.
    const doors = RESEARCH_ITEMS.filter((spec) =>
      ['mission_slots', 'recruit_slots', 'declarations'].includes(spec.payout.bonus.kind),
    );
    expect(doors.length).toBeGreaterThanOrEqual(5);
    for (const spec of doors) expect(spec.step, spec.id).toBeGreaterThanOrEqual(6);
    expect(doors.some((spec) => spec.payout.bonus.kind === 'mission_slots')).toBe(true);
  });

  it('folds into one crew fold, skipping ids it does not know', () => {
    const map = findResearchItem('tech_the_whole_city');
    const chair = findResearchItem('tech_succession_planning');
    const fire = findResearchItem('tech_fire_discipline');
    if (!map || !chair || !fire) throw new Error('missing rungs');
    const folded = researchEffects([map.id, chair.id, fire.id, 'tech_not_a_thing']);
    expect(folded.missionSlotsFlat).toBe(1);
    expect(folded.recruitSlotsFlat).toBe(1);
    expect(folded.unitTierPercent.rabble?.offense).toBe(6);
    expect(researchEffects([])).toEqual(noCrewEffects());
  });

  it('writes its effect in words, never as a field name', () => {
    for (const spec of RESEARCH_ITEMS) {
      const line = describeResearchPayout(spec);
      expect(line, spec.id).not.toMatch(/[a-z][A-Z]/);
      expect(line.length, spec.id).toBeGreaterThan(5);
      if (spec.payout.unlocks !== undefined) expect(line).toContain(spec.payout.unlocks);
    }
    expect(describeResearchPayout(findResearchItem('tech_the_whole_city')!)).toBe(
      '+1 crew out on a job at once',
    );
  });

  it('opens something on the rungs that say they do, and nowhere else', () => {
    const opening = RESEARCH_ITEMS.filter((spec) => spec.payout.unlocks !== undefined);
    expect(opening.length).toBeGreaterThan(3);
    expect(researchUnlocks(opening.map((spec) => spec.id))).toHaveLength(opening.length);
    expect(researchUnlocks(['tech_shift_rotation'])).toEqual([]);
  });

  it('pays more at the top of a track than at the foot, on the kinds that repeat', () => {
    // The same kind twice in one track pays at least as much the second time: the top of a track
    // is the reason to climb it.
    for (const role of OFFICER_ROLES) {
      const rungs = itemsInTrack(role);
      const first = rungs[0]?.payout.bonus;
      const last = rungs[rungs.length - 1]?.payout.bonus;
      if (!first || !last) throw new Error('missing rung');
      if (first.kind === last.kind && 'percent' in first && 'percent' in last) {
        expect(last.percent, role).toBeGreaterThan(first.percent);
      }
    }
  });
});

describe('§G1: Reimagining', () => {
  it('is a research item, on a track, with a name a player reads', () => {
    const spec = findResearchItem(REIMAGINING_RESEARCH_ID);
    expect(spec).toBeDefined();
    expect(spec?.name).toBe('Reimagining');
    expect(RESEARCH_ITEMS).toContain(spec);
  });

  it('answers the one question the Blueprints page asks', () => {
    expect(isReimaginingResearched([])).toBe(false);
    expect(isReimaginingResearched(['tech_shift_rotation'])).toBe(false);
    expect(isReimaginingResearched([REIMAGINING_RESEARCH_ID])).toBe(true);
  });
});

describe('§C3: points, not marks', () => {
  /** Anchors written out: 10 is the measured mark floor, 100 the trainable ceiling. */
  it('turns the Head of Research points into a percentage off the clock', () => {
    expect(MAX_RESEARCH_TIME_CUT).toBe(45);
    expect(researchTimeCutPercent(10)).toBe(0);
    expect(researchTimeCutPercent(0)).toBe(0);
    expect(researchTimeCutPercent(20)).toBeCloseTo(5, 10);
    expect(researchTimeCutPercent(55)).toBeCloseTo(22.5, 10);
    expect(researchTimeCutPercent(100)).toBe(45);
    expect(researchTimeCutPercent(140)).toBe(45);
  });

  it('turns the track officer points into a percentage off the price', () => {
    expect(MAX_RESEARCH_COST_CUT).toBe(30);
    expect(trackCostCutPercent(10)).toBe(0);
    expect(trackCostCutPercent(40)).toBeCloseTo(10, 10);
    expect(trackCostCutPercent(100)).toBe(30);
  });

  /**
   * §C3b, and the reason neither cut is rounded before it is used.
   *
   * A role's weakest weighted attribute is worth a thirteenth of a point on the score, so a single
   * point of training moves the cut by about four hundredths of a percentage point. The figure a
   * player reads is rounded; the arithmetic behind it is not, and this is the assertion that keeps
   * it that way.
   */
  it('moves on a fraction of a point, so training is never wasted', () => {
    const step = 1 / 13;
    expect(researchTimeCutPercent(30 + step)).toBeGreaterThan(researchTimeCutPercent(30));
    expect(trackCostCutPercent(30 + step)).toBeGreaterThan(trackCostCutPercent(30));
    // ...and the two are not the same lever wearing two names.
    expect(researchTimeCutPercent(60)).not.toBeCloseTo(trackCostCutPercent(60), 3);
  });

  it('takes the track officer cut off the real price', () => {
    const spec = RESEARCH_ITEMS[0];
    if (!spec) throw new Error('need a rung');
    expect(researchItemPrice(spec, 0)).toEqual(spec.cost);
    const cut = researchItemPrice(spec, 30);
    expect(cut.caps).toBeLessThan(spec.cost.caps ?? 0);
    expect(cut.caps).toBe(Math.max(1, Math.floor((spec.cost.caps ?? 0) * 0.7)));
  });
});

describe('the ladder of prices and clocks', () => {
  it('gets dearer and longer with depth, and asks for high quality metal from the fourth rung', () => {
    for (let step = 2; step <= 10; step += 1) {
      expect(researchItemCost(step).caps).toBeGreaterThan(researchItemCost(step - 1).caps ?? 0);
      expect(researchItemMinutes(step)).toBeGreaterThan(researchItemMinutes(step - 1));
    }
    expect(researchItemCost(1)).toEqual({ caps: 600, scrap: 400 });
    expect(researchItemCost(3).highQualityMetal).toBeUndefined();
    expect(researchItemCost(4).highQualityMetal).toBe(30);
    expect(researchItemMinutes(1)).toBe(45);
    expect(researchItemMinutes(10)).toBe(270);
  });

  it('counts a track from what the crew has finished on it', () => {
    const track = 'scout';
    expect(trackProgress([], track)).toBe(0);
    expect(trackProgress(finishedBelow(track, 5), track)).toBe(4);
    // Another track's ids do not count towards this one.
    expect(trackProgress(finishedBelow('trader', 8), track)).toBe(0);
  });
});
