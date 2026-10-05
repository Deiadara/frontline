import { describe, expect, it } from 'vitest';
import { TRAP_CATALOG } from '../battle/traps.js';
import { BATTLE_BOOSTS } from '../battle/boosts.js';
import { noCrewEffects } from '../crew/effects.js';
import { PERK_CATALOG, describePerkBonus } from '../crew/perks.js';
import { findUnit } from '../units/catalog.js';
import { OFFICER_MARKS, markIndex, type OfficerMark } from '../crew/marks.js';
import { OFFICER_ROLES } from '../roles.js';
import { TECH_DISTRICT_OFFERS, isAreaUnlocked, noUnlocks } from '../progression/unlocks.js';
import { ResearchStateSchema } from './state.js';
import {
  HEAD_MARK_THRESHOLDS,
  PAYOUT_FAMILIES,
  REIMAGINING_RESEARCH_ID,
  RESEARCH_ITEMS,
  RESEARCH_TRACK_BLURBS,
  RESEARCH_TRACK_STEPS,
  TRACK_MARKS,
  describeResearchItemRefusal,
  describeResearchPayout,
  findResearchItem,
  hardestRequiredMark,
  isReimaginingResearched,
  itemsInTrack,
  labLevelForStep,
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
  trackProgress,
} from './tracks.js';

/**
 * §C, asserted against the brief rather than against the catalogue.
 *
 * Almost every number below is written out rather than recomputed from the function under test.
 * A test that derives `requiredTrackMark(4)` by calling `requiredTrackMark(4)` passes whatever the
 * ladder is, which is the one thing the maintainer asked to be able to check.
 */

/** Nobody in either chair: the state every crew starts in. */
const EMPTY = { trackMark: null, headMark: null };
/** A Lab at its top, so the tier gate (P7-C) opens every rung and the chair gates are what is tested. */
const FULL_LAB = 20;

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
      // `tech_one_time_pads` was here: retired with the Whispers rework, dropped from saves by 0109.
      // `tech_false_traffic` was here: the Consigliere's, dropped from saves by 0135 (2026-10-01).
      // The Chief Medic's, the Fabricator's and the Head of Security's rungs that were here went
      // with the chair rework, dropped from saves by 0142 (2026-10-04).
      'tech_sorted_salvage',
      'tech_alloy_reclamation',
      // ...and the rungs that moved to a surviving track kept their ids.
      'tech_batch_runs',
      'tech_reimagining',
      'tech_carry_both',
      'tech_drill_yard',
    ];
    for (const id of stored) expect(findResearchItem(id), id).toBeDefined();

    /*
     * What each of these pays was re-dealt on 2026-09-04, on purpose: the maintainer asked for rewards a
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

  // Traps and the boosts the Lab proposed open off their blueprint alone (maintainer, 2026-10-01),
  // so no rung may still promise one.
  it("opens no trap and no battle boost: those are the blueprints' now", () => {
    for (const spec of RESEARCH_ITEMS) {
      const line = describeResearchPayout(spec);
      for (const trap of TRAP_CATALOG) expect(line, spec.id).not.toContain(trap.name);
      for (const boost of BATTLE_BOOSTS) expect(line, spec.id).not.toContain(boost.name);
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
      expect(
        researchItemRefusal(spec.id, finishedBelow(track, step), fresh, FULL_LAB),
        spec.id,
      ).toBeNull();
    }
    const fourth = itemsInTrack(track)[3];
    if (!fourth) throw new Error('missing rung');
    expect(researchItemRefusal(fourth.id, finishedBelow(track, 4), fresh, FULL_LAB)).toBe(
      'track_mark_too_low',
    );
  });

  /** §C2e: the Head's own bar, after the 3rd, 5th and 7th. */
  it('asks the Researcher for a mark from the fourth rung', () => {
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
  const track = 'veteran';
  const first = itemsInTrack(track)[0];
  if (!first) throw new Error('need a rung');

  it('refuses everything without a Researcher', () => {
    for (const spec of RESEARCH_ITEMS) {
      expect(
        researchItemRefusal(spec.id, finishedBelow(spec.track, spec.step), EMPTY, FULL_LAB),
        spec.id,
      ).toBe('no_researcher');
    }
  });

  it('refuses a track whose own chair is empty, even with a perfect Head', () => {
    expect(researchItemRefusal(first.id, [], { trackMark: null, headMark: 'S+' }, FULL_LAB)).toBe(
      'no_track_officer',
    );
  });

  it('refuses a rung whose predecessor is unfinished', () => {
    const third = itemsInTrack(track)[2];
    if (!third) throw new Error('need a rung');
    expect(researchItemRefusal(third.id, [], PERFECT, FULL_LAB)).toBe('needs_previous_step');
    expect(researchItemRefusal(third.id, finishedBelow(track, 3), PERFECT, FULL_LAB)).toBeNull();
  });

  it('refuses what is already done, and what does not exist', () => {
    expect(researchItemRefusal(first.id, [first.id], PERFECT, FULL_LAB)).toBe('already_known');
    expect(researchItemRefusal('tech_nothing_at_all', [], PERFECT, FULL_LAB)).toBe('unknown_item');
  });

  it('names the Head threshold rather than the track one when the Head is what is short', () => {
    const fourth = itemsInTrack(track)[3];
    if (!fourth) throw new Error('need a rung');
    const done = finishedBelow(track, 4);
    expect(
      researchItemRefusal(fourth.id, done, { trackMark: 'S+', headMark: 'F-' }, FULL_LAB),
    ).toBe('head_mark_too_low');
    expect(
      researchItemRefusal(fourth.id, done, { trackMark: 'S+', headMark: 'E' }, FULL_LAB),
    ).toBeNull();
  });
});

/** Maintainer ruling P7-C (2026-10-02): a tier of programmes every two Lab levels. */
describe('the Lab opens a tier every two levels', () => {
  const track = 'veteran';
  it('asks a Lab at twice the rung, the tenth at 20 and the ninth at 18', () => {
    expect(labLevelForStep(10)).toBe(20);
    expect(labLevelForStep(9)).toBe(18);
    expect(labLevelForStep(1)).toBe(2);
    for (const spec of itemsInTrack(track)) {
      const done = finishedBelow(track, spec.step);
      const at = labLevelForStep(spec.step);
      expect(researchItemRefusal(spec.id, done, PERFECT, at - 1), spec.id).toBe('lab_too_low');
      expect(researchItemRefusal(spec.id, done, PERFECT, at), spec.id).toBeNull();
    }
  });

  it('says which Lab level in the refusal', () => {
    const fifth = itemsInTrack(track)[4]!;
    expect(describeResearchItemRefusal('lab_too_low', fifth)).toBe('Needs the Lab at 10');
  });

  // No officer cuts a programme's price since 2026-10-04: the Lab's is the only cut.
  it("takes the Lab's cut off the price, and nothing else", () => {
    const spec = itemsInTrack(track)[5]!;
    const cut = researchItemPrice(spec, 30);
    for (const [key, amount] of Object.entries(spec.cost)) {
      const paid = cut[key as keyof typeof cut] ?? 0;
      expect(paid, key).toBe(Math.max(1, Math.round((amount ?? 0) * 0.7)));
    }
    expect(researchItemPrice(spec)).toEqual(spec.cost);
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
    /*
     * A rung that pays nothing but a door is its own kind, one per door: two rungs opening two
     * different things are not a slider. The Master of Whispers' track is eight such rungs out of
     * ten since the maintainer took the intel percentages off it (2026-09-28: "generally from this
     * tree remove the +% intel"), and it is the least slider-like track in the Lab.
     */
    const kindOf = (spec: (typeof RESEARCH_ITEMS)[number]): string =>
      spec.payout.bonus?.kind ?? `opens ${spec.payout.unlocks}`;
    const kinds = new Set(RESEARCH_ITEMS.map((spec) => spec.payout.bonus?.kind).filter(Boolean));
    expect(kinds.size).toBeGreaterThan(30);
    for (const role of OFFICER_ROLES) {
      const own = new Set(itemsInTrack(role).map(kindOf));
      expect(own.size, role).toBeGreaterThanOrEqual(4);
    }
  });

  /** ...and a door with no bonus says what it opens, or it would be a rung that pays nothing. */
  it('names what every bonus-less rung opens', () => {
    for (const spec of RESEARCH_ITEMS) {
      if (spec.payout.bonus !== undefined) continue;
      expect(spec.payout.unlocks.length, spec.id).toBeGreaterThan(10);
      expect(payoutFamily(spec.payout), spec.id).toBe('unlock');
    }
  });

  it('names units, structures and attributes that exist', () => {
    for (const spec of RESEARCH_ITEMS) {
      const bonus = spec.payout.bonus;
      if (bonus?.kind === 'unit_kind') expect(findUnit(bonus.unitId), spec.id).toBeDefined();
      expect(describeResearchPayout(spec), spec.id).not.toMatch(/undefined/);
    }
  });

  it('keeps the doors for the deep rungs', () => {
    // A second crew out, another fight called: the grants a crew plans around, and none of them
    // on a rung a fresh recruit can reach. Two since research stopped paying officer slots
    // (maintainer, 2026-10-01).
    const doors = RESEARCH_ITEMS.filter((spec) =>
      ['mission_slots', 'declarations'].includes(spec.payout.bonus?.kind ?? ''),
    );
    expect(doors.length).toBeGreaterThanOrEqual(2);
    for (const spec of doors) expect(spec.step, spec.id).toBeGreaterThanOrEqual(6);
    expect(doors.some((spec) => spec.payout.bonus?.kind === 'mission_slots')).toBe(true);
  });

  it('folds into one crew fold, skipping ids it does not know', () => {
    const map = findResearchItem('tech_the_whole_city');
    const chair = findResearchItem('tech_succession_planning');
    const fire = findResearchItem('tech_fire_discipline');
    if (!map || !chair || !fire) throw new Error('missing rungs');
    const folded = researchEffects([map.id, chair.id, fire.id, 'tech_not_a_thing']);
    expect(folded.missionSlotsFlat).toBe(1);
    expect(folded.officerGroupFlat.social).toBe(3);
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

  /*
   * An unlock is printed inside a sentence ("Opens X, and -5% market prices"), so a full stop at
   * its end read "...what others post., and" on the Lab card of the Trader's first rung.
   */
  it('prints every unlock as a clause, with no full stop inside the line', () => {
    for (const spec of RESEARCH_ITEMS) {
      if (spec.payout.unlocks !== undefined)
        expect(spec.payout.unlocks, spec.id).not.toMatch(/\.$/);
    }
    expect(describeResearchPayout(findResearchItem(TECH_DISTRICT_OFFERS)!)).toBe(
      'Opens the district offers board, to post what you will trade and take what others post, and -5 points off market prices (tapers, no hard stop)',
    );
  });

  /*
   * A teaching perk says "every other officer" because it never lifts its carrier. A Lab rung is
   * not a person and lifts every officer, the one who ran it included (`liftedOfficerSheet`, and
   * `crew.test.ts` measures it on a crew of one), so the perk's wording was wrong on the Lab card.
   */
  it('says a Lab lesson reaches every officer, not every other one', () => {
    const lessons = RESEARCH_ITEMS.filter(
      (spec) => spec.payout.bonus?.kind === 'officer_attribute',
    );
    expect(lessons.map((spec) => spec.id)).toEqual([
      'tech_field_promotions',
      'tech_the_reading_year',
    ]);
    for (const spec of lessons)
      expect(describeResearchPayout(spec), spec.id).not.toContain('other');
    expect(describeResearchPayout(findResearchItem('tech_the_reading_year')!)).toBe(
      '+5 Encyclopedia to every officer',
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
      if (rungs.length === 0) throw new Error('missing rung');
      // A door at either end has no amount to compare (the Master of Whispers' track, both ends).
      const first = rungs[0]?.payout.bonus;
      const last = rungs[rungs.length - 1]?.payout.bonus;
      if (!first || !last) continue;
      if (first.kind === last.kind && 'percent' in first && 'percent' in last) {
        expect(last.percent, role).toBeGreaterThan(first.percent);
      }
    }
  });

  /**
   * ...and on every rung between them, not only the two ends.
   *
   * The check above compares rung 1 with rung 10 and skips the track entirely when those two pay
   * into different channels, which is most of the catalogue. That left the middle of a track
   * unguarded, and the Salvager's did go wrong there: rung 5 was repointed onto scrap yield at 8%
   * when rung 4 below it already paid 10%, so a dearer, slower rung offered a fifth less than the
   * one the player had just finished. A deeper rung costs more (`researchItemCost`) and takes
   * longer (`researchItemMinutes`) whatever it pays, so the payout has to climb with it.
   *
   * Same *channel*, not same kind: `{ resource: 'scrap' }` and `{ resource: 'caps' }` are two
   * ladders that happen to share a word, and comparing them would be arithmetic on unlike things.
   */
  it('climbs on every channel a track pays into twice, not just the two ends', () => {
    // Only the string-valued discriminators, so a channel key is a key and never `[object Object]`.
    const channelOf = (bonus: Record<string, unknown>): string =>
      ['kind', 'resource', 'building', 'tier', 'unitId', 'group', 'attribute', 'stat']
        .map((field) => bonus[field])
        .filter((value): value is string => typeof value === 'string')
        .join(':');
    const magnitudeOf = (bonus: Record<string, unknown>): number | null => {
      for (const field of ['percent', 'flat', 'perHour', 'minutes', 'levels']) {
        const value = bonus[field];
        if (typeof value === 'number') return value;
      }
      return null;
    };

    for (const role of OFFICER_ROLES) {
      const ladders = new Map<string, { step: number; id: string; paid: number }[]>();
      for (const rung of itemsInTrack(role)) {
        // A rung's second bonus (`also`) is on the same ladder as anything else on that channel.
        for (const paidOut of [rung.payout.bonus, rung.payout.also]) {
          if (paidOut === undefined) continue;
          const bonus = paidOut as unknown as Record<string, unknown>;
          const paid = magnitudeOf(bonus);
          if (paid === null) continue;
          const channel = channelOf(bonus);
          ladders.set(channel, [
            ...(ladders.get(channel) ?? []),
            { step: rung.step, id: rung.id, paid },
          ]);
        }
      }
      for (const [channel, rungs] of ladders) {
        for (let index = 1; index < rungs.length; index += 1) {
          const below = rungs[index - 1]!;
          const above = rungs[index]!;
          expect(
            above.paid,
            `${role}/${channel}: ${above.id} (rung ${above.step}) pays ${above.paid} against ${below.id} (rung ${below.step}) paying ${below.paid}`,
          ).toBeGreaterThan(below.paid);
        }
      }
    }
  });
});

/**
 * The two rungs that opened unled runs (maintainer, 2026-09-10), after every run needed a leader
 * (maintainer, 2026-09-28). They stay on the track with the ids crews researched them under, and
 * neither promises an unled run any more.
 */
describe('the two rungs that used to open an unled run', () => {
  it(`keeps both on the Right Hand's track under their old ids, and neither offers one`, () => {
    const rungs = itemsInTrack('right_hand');
    const orders = rungs.find((spec) => spec.id === 'tech_unled_runs');
    const before = rungs.find((spec) => spec.id === 'tech_unled_runs_free');
    if (!orders || !before) throw new Error('the two rungs are no longer on the Right Hand track');
    expect(orders.step).toBe(2);
    expect(before.step).toBe(6);
    expect(orders.payout.unlocks).toBeUndefined();
    expect(before.payout.unlocks).toBe(
      'a five minute gap between automated parties, down from fifteen',
    );
    for (const rung of rungs) expect(rung.payout.unlocks ?? '', rung.id).not.toMatch(/unled/i);
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

  // The bench is a tab of its own beside Blueprints (`ResearchPage.tsx`, `SECTIONS`). The card sent
  // players to the Blueprints tab, which has no bench on it (wiring audit, 2026-10-01).
  it('sends a player to the tab the bench is actually on', () => {
    const spec = findResearchItem(REIMAGINING_RESEARCH_ID);
    if (!spec) throw new Error('no Reimagining rung');
    const card = describeResearchPayout(spec);
    expect(card).toContain('its own tab in the Lab');
    expect(card).not.toContain('Blueprints page');
  });
});

/**
 * The nine rungs the maintainer repaid on 2026-10-01: seven lost the trap or boost they opened
 * ("have the traps just be unlocked by blueprints ... add just some universal bonuses in their
 * place") and two lost an officer slot ("Remove the +1 at the bar mechanic"). Each pays a bonus
 * that always pays: no chair, no blueprint, no fight it has to be.
 */
describe('the nine rungs repaid on 2026-10-01', () => {
  /** Channels that pay every crew all the time, with no condition to meet first. */
  const UNIVERSAL = new Set([
    'unit_vitality',
    'unit_morale',
    'unit_offense',
    'unit_armor',
    'vehicle_parts',
    'production',
    'officer_group',
  ]);
  // Watch Schedules was the seventh, keeping its spy points; it lost them later the same day and
  // is held below, with the other five spy rungs.
  // The six rungs that were here sat on the Head of Security's and the Fabricator's tracks, which
  // went with the chair rework (2026-10-04); the two below are what is left of the nine.
  const OPENED_A_DOOR: Record<string, string> = {};

  it.each(Object.entries(OPENED_A_DOOR))(
    '%s keeps its own bonus, opens nothing, and pays a universal one beside it',
    (id, kept) => {
      const spec = findResearchItem(id);
      if (!spec) throw new Error(`no ${id}`);
      expect(spec.payout.bonus?.kind).toBe(kept);
      expect(spec.payout.unlocks).toBeUndefined();
      const also = spec.payout.also;
      expect(also && UNIVERSAL.has(also.kind), `${id} pays ${also?.kind}`).toBe(true);
      // Folded, not only declared: the second bonus reaches the crew.
      const folded = researchEffects([id]);
      expect(folded).not.toEqual(researchEffects([]));
      expect(describeResearchPayout(spec)).not.toMatch(/^Opens /);
    },
  );

  it.each(['tech_the_growth_curve', 'tech_succession_planning'])(
    '%s pays a universal bonus where the officer slot was',
    (id) => {
      const spec = findResearchItem(id);
      if (!spec?.payout.bonus) throw new Error(`no bonus on ${id}`);
      expect(UNIVERSAL.has(spec.payout.bonus.kind), spec.payout.bonus.kind).toBe(true);
      expect(describeResearchPayout(spec)).not.toContain('at the Bar');
    },
  );

  it('pays the second bonus through the fold, at its own number', () => {
    expect(researchEffects(['tech_the_growth_curve']).productionPercent).toBe(15);
    expect(researchEffects(['tech_succession_planning']).officerGroupFlat.social).toBe(3);
  });
});

/**
 * The six rungs that paid spying (maintainer, 2026-10-01): "spy bonuses from the officer should
 * only come based on his grade", and the same rule for defence. Three paid spy points and three
 * paid points against spies; each pays a bonus that always pays in their place, priced like a
 * neighbour on the same step. Written out rather than read back, so a payout moved under the test
 * is a failure and not a new expectation.
 */
describe('the six spy rungs repaid on 2026-10-01', () => {
  const REPAID: Record<string, { step: number; card: string }> = {
    tech_field_debriefs: { step: 6, card: '+7% experience' },
    tech_underground_routes: { step: 5, card: '-8 points off the road (tapers, no hard stop)' },
    tech_citation_index: { step: 6, card: '+10 points off the research clock' },
  };

  it.each(Object.entries(REPAID))('%s pays no spying, and pays %o', (id, { step, card }) => {
    const spec = findResearchItem(id);
    if (!spec) throw new Error(`no ${id}`);
    expect(spec.step).toBe(step);
    expect(describeResearchPayout(spec)).toBe(card);
    const folded = researchEffects([id]);
    expect(folded.intelYieldPercent).toBe(0);
    expect(folded.intelResistancePercent).toBe(0);
    expect(folded).not.toEqual(researchEffects([]));
  });

  it('pays the new bonuses through the fold, at their own numbers', () => {
    expect(researchEffects(['tech_field_debriefs']).xpGainPercent).toBe(7);
    expect(researchEffects(['tech_underground_routes']).travelSpeedPercent).toBe(8);
    expect(researchEffects(['tech_citation_index']).researchSpeedPercent).toBe(10);
  });

  it('leaves no rung anywhere in the Lab paying spy points or points against spies', () => {
    const all = researchEffects(RESEARCH_ITEMS.map((spec) => spec.id));
    expect(all.intelYieldPercent).toBe(0);
    expect(all.intelResistancePercent).toBe(0);
    for (const spec of RESEARCH_ITEMS) {
      for (const paid of [spec.payout.bonus, spec.payout.also]) {
        expect(paid?.kind, spec.id).not.toBe('intel');
        expect(paid?.kind, spec.id).not.toBe('intel_resistance');
      }
    }
  });
});

describe('§C3: points, not marks', () => {
  /** Anchors written out: 10 is the measured mark floor, 100 the trainable ceiling. */
  // The Researcher's passive (maintainer, 2026-10-04): a straight line to 50% at a perfect sheet.
  it('turns the Researcher points into a percentage off the clock', () => {
    expect(researchTimeCutPercent(10)).toBe(0);
    expect(researchTimeCutPercent(0)).toBe(0);
    expect(researchTimeCutPercent(19)).toBeCloseTo(5, 10);
    expect(researchTimeCutPercent(55)).toBeCloseTo(25, 10);
    expect(researchTimeCutPercent(100)).toBe(50);
    expect(researchTimeCutPercent(140)).toBe(50);
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
    const track = 'cartographer';
    expect(trackProgress([], track)).toBe(0);
    expect(trackProgress(finishedBelow(track, 5), track)).toBe(4);
    // Another track's ids do not count towards this one.
    expect(trackProgress(finishedBelow('trader', 8), track)).toBe(0);
  });
});

/**
 * The rung that lets a recovered unit carry its share home (maintainer, 2026-09-18).
 *
 * A haul is carried by the units that survived the fight. A unit the Infirmary brings back was
 * dead when the packs were counted, so it carries nothing, and this is the one thing that changes
 * that. Asserted as a switch on the fold rather than as a number, because the consumer is a
 * yes-or-no and reads it that way.
 */
// On the Veteran's track since the Chief Medic's chair left the game (2026-10-04), its id kept.
describe('§C: the Veteran rung that brings the pack back', () => {
  const rung = itemsInTrack('veteran')[3];
  if (!rung) throw new Error('the Veteran track has no fourth rung');

  it('is the fourth rung of the Veteran track, priced and gated off that depth', () => {
    expect(rung.id).toBe('tech_carry_both');
    expect(rung.name).toBe('Carry Both');
    expect(rung.track).toBe('veteran');
    expect(rung.step).toBe(4);
    // Written out rather than recomputed: a rung that moved up or down the track would change all
    // four of these at once, which is exactly what this is here to catch.
    expect(rung.cost).toEqual({ caps: 3900, scrap: 2250, highQualityMetal: 30 });
    expect(rung.minutes).toBe(120);
    expect(rung.requiresMark).toBe('E-');
    expect(rung.requiresHeadMark).toBe('E');
    expect(findResearchItem('tech_carry_both')).toBe(rung);
  });

  it('is off until the rung is finished, and on once it is', () => {
    expect(noCrewEffects().recoveredCarryLoot).toBe(false);
    expect(researchEffects([]).recoveredCarryLoot).toBe(false);
    // ...and no other rung in the catalogue turns it on by itself.
    const others = RESEARCH_ITEMS.filter((spec) => spec.id !== rung.id).map((spec) => spec.id);
    expect(researchEffects(others).recoveredCarryLoot).toBe(false);
    expect(researchEffects([rung.id]).recoveredCarryLoot).toBe(true);
    // Held once, not twice: a switch is ored wherever it is folded.
    expect(researchEffects([rung.id, rung.id]).recoveredCarryLoot).toBe(true);
  });

  it('folds like the other switch rung on the tree, and changes nothing else', () => {
    // `carriers_fight` is the sibling: a permission a rung grants, ored into the same struct.
    const sibling = RESEARCH_ITEMS.find((spec) => spec.payout.bonus?.kind === 'carriers_fight');
    if (!sibling) throw new Error('expected a carriers_fight rung');
    expect(researchEffects([sibling.id])).toEqual({ ...noCrewEffects(), carriersFight: true });
    expect(researchEffects([rung.id])).toEqual({ ...noCrewEffects(), recoveredCarryLoot: true });
    expect(researchEffects([rung.id, sibling.id])).toEqual({
      ...noCrewEffects(),
      carriersFight: true,
      recoveredCarryLoot: true,
    });
  });

  it('says what it does in words, and is filed under what it changes', () => {
    expect(describeResearchPayout(rung)).toBe(
      'the ones the medics get back carry their share of the haul home',
    );
    expect(payoutFamily(rung.payout)).toBe('yield');
  });
});

/**
 * §I3: the rung that opens the district offers board (maintainer, 2026-09-19).
 *
 * This is a **cross-module pin**, and it is the only thing standing between a rename and a door
 * that never opens again. `progression/unlocks.ts` gates the board on a string, and the string is
 * derived from a rung's display name by `idOf`. Nothing in either module refers to the other at
 * compile time, so renaming `Getting On The Board` type-checks, lints, builds, and quietly leaves
 * every crew in the game unable to reach the board for the rest of the world's life.
 *
 * The failure is silent in the worst way: a locked screen still draws its sign, the sign still
 * reads "finish the first programme on the Trader track", and the player finishes it and nothing
 * happens.
 */
describe('the rung that opens the district offers board', () => {
  const rung = findResearchItem(TECH_DISTRICT_OFFERS);

  it('exists under the id the door is gated on', () => {
    expect(rung, `no rung has the id ${TECH_DISTRICT_OFFERS}`).toBeDefined();
  });

  it('is the first rung of the Trader track, which is where the door says to look', () => {
    expect(rung?.track).toBe('trader');
    expect(rung?.step).toBe(1);
  });

  it('is what the door actually reads, and nothing else opens it', () => {
    const facts = { ...noUnlocks(), level: 99, notoriety: 9 };
    expect(isAreaUnlocked('offers', facts)).toBe(false);
    // Every other rung in the catalogue, all at once, still leaves it shut.
    const others = RESEARCH_ITEMS.filter((spec) => spec.id !== TECH_DISTRICT_OFFERS).map(
      (spec) => spec.id,
    );
    expect(isAreaUnlocked('offers', { ...facts, technologies: others })).toBe(false);
    expect(isAreaUnlocked('offers', { ...facts, technologies: [TECH_DISTRICT_OFFERS] })).toBe(true);
  });

  it('is filed as an unlock, because opening a screen is what it is for', () => {
    expect(rung?.payout.unlocks).toBeDefined();
    if (rung) expect(payoutFamily(rung.payout)).toBe('unlock');
  });
});

/**
 * The Master of Whispers' track, as the maintainer's ledger of 2026-09-28 wrote it.
 *
 * Every figure written out: this track is the one priced by hand rather than by
 * `researchItemCost`, so nothing else in this file would notice a price or a clock drifting.
 */
describe("the Master of Whispers' track, off the ledger", () => {
  const LEDGER = [
    ['tech_written_reports', 'Written Reports', { caps: 600, planks: 200 }, 45, null],
    ['tech_paid_informants', 'Paid Informants', { caps: 2000 }, 70, null],
    [
      'tech_traffic_analysis',
      'Traffic Analysis',
      { caps: 2650, scrap: 1000, supplies: 500 },
      130,
      null,
    ],
    [
      'tech_second_source',
      'Second Source',
      { caps: 3900, supplies: 2000, highQualityMetal: 30 },
      200,
      'E',
    ],
    [
      'tech_two_sets_of_eyes',
      'Two Sets of Eyes',
      { caps: 5250, supplies: 2500, highQualityMetal: 70 },
      280,
      'E',
    ],
    [
      'tech_counting_the_empty_beds',
      'Counting the Empty Beds',
      { caps: 6750, supplies: 1500, highQualityMetal: 130 },
      350,
      'D+',
    ],
    [
      'tech_sleeper_lists',
      'Sleeper Lists',
      { caps: 7000, scrap: 3000, highQualityMetal: 180 },
      450,
      'C-',
    ],
    [
      'tech_shared_knowledge',
      'Shared Knowledge',
      { caps: 10000, supplies: 2000, scrap: 5400 },
      600,
      'B',
    ],
    ['tech_turned_runners', 'Turned Runners', { caps: 12000, scrap: 2200 }, 800, 'B+'],
    [
      'tech_the_whole_wire',
      'The Whole Wire',
      { caps: 15000, scrap: 3000, highQualityMetal: 500 },
      1000,
      'A',
    ],
  ] as const;

  it('carries the ledger rung for rung: id, name, price, clock and the Researcher mark', () => {
    const track = itemsInTrack('master_of_whispers');
    expect(track.map((spec) => spec.id)).toEqual(LEDGER.map(([id]) => id));
    for (const [index, [id, name, cost, minutes, head]] of LEDGER.entries()) {
      const spec = track[index]!;
      expect(spec.name, id).toBe(name);
      expect(spec.cost, id).toEqual(cost);
      expect(spec.minutes, id).toBe(minutes);
      expect(spec.requiresHeadMark, id).toBe(head);
      // The track officer's own ladder is the ordinary one: the ledger moved no track mark.
      expect(spec.requiresMark, id).toBe(TRACK_MARKS[index]);
    }
  });

  it('keeps the blurbs the maintainer wrote, word for word', () => {
    const blurb = (id: string) => findResearchItem(id)?.description;
    expect(blurb('tech_written_reports')).toBe(
      'Making the spies try to remember what they saw did not make a lot of sense, so we gave them a paper to write it down.',
    );
    expect(blurb('tech_traffic_analysis')).toBe(
      "Just because you figured it out doesn't mean you should shout it on the way back.",
    );
    expect(blurb('tech_two_sets_of_eyes')).toBe('Pay twice the caps, get twice the spying groups!');
    expect(blurb('tech_shared_knowledge')).toBe(
      'Everyone would benefit from a lesson or two, especially from someone that has "Master" in their title',
    );
    expect(blurb('tech_turned_runners')).toBe(
      'Their courier still runs their route. He stops here first.',
    );
  });

  it('pays no intel on any rung: the chair is where intel comes from now', () => {
    for (const spec of itemsInTrack('master_of_whispers')) {
      expect(spec.payout.bonus?.kind, spec.id).not.toBe('intel');
    }
  });

  it('folds a second spy party and the lesson, filed under the chair', () => {
    const folded = researchEffects(['tech_two_sets_of_eyes', 'tech_shared_knowledge']);
    expect(folded.spyPartiesFlat).toBe(1);
    expect(folded.chairTeaches).toEqual([
      {
        role: 'master_of_whispers',
        attributes: { stealth: 5, deception: 3, cryptography: 3 },
      },
    ]);
    // Neither lands on the ordinary per-attribute channel, which would lift the teacher too.
    expect(folded.officerAttributeFlat).toEqual({});
    expect(describeResearchPayout(findResearchItem('tech_two_sets_of_eyes')!)).toBe(
      '+1 spying party out at once',
    );
    expect(describeResearchPayout(findResearchItem('tech_shared_knowledge')!)).toBe(
      '+5 Stealth, +3 Deception and +3 Cryptography on every other officer seated and working, while somebody works this chair',
    );
  });
});

/**
 * Spy points and medic points are not percentages, and the cards stopped saying they were (bug pass,
 * 2026-09-29). The spy contest adds both intel channels to a chair's fit as points
 * (`spying/spying.ts`), and the medics' points go through a curve before they are a share of the
 * dead (`casualtyRecoveryShare`). A "+8% intel" card promised something on top of the chair.
 *
 * No rung pays spy points since 2026-10-01, nor medic points since 2026-10-04, so their wording
 * is held on the perks, which share the rungs' describer and still pay all three.
 */
describe('the rungs and perks that pay points, worded as points', () => {
  const WORDING = {
    intel: 'spy points',
    intel_resistance: 'spy points against enemy spies',
    casualty_recovery: 'medic points',
  } as const;
  const pointsOf = (bonus: { kind: string } | undefined) =>
    bonus !== undefined && bonus.kind in WORDING
      ? (bonus as { kind: keyof typeof WORDING; percent: number })
      : null;

  it('names the points on every such rung, and never a percentage', () => {
    // The medic rungs sat on the Wetware Chief's and the Chief Medic's tracks, which went on
    // 2026-10-04; the perks below still pay medic points, and the Infirmary.
    const paying = RESEARCH_ITEMS.filter((spec) => pointsOf(spec.payout.bonus) !== null);
    for (const spec of paying) {
      const bonus = pointsOf(spec.payout.bonus)!;
      const card = describeResearchPayout(spec);
      expect(card, spec.id).toContain(`+${bonus.percent} ${WORDING[bonus.kind]}`);
      expect(card, spec.id).not.toContain(`${bonus.percent}%`);
    }
  });

  it('names the points on every such perk, both spy kinds included', () => {
    const paying = PERK_CATALOG.filter((perk) => pointsOf(perk.bonus) !== null);
    for (const kind of ['intel', 'intel_resistance', 'casualty_recovery'] as const) {
      expect(
        paying.some((perk) => perk.bonus.kind === kind),
        kind,
      ).toBe(true);
    }
    for (const perk of paying) {
      const bonus = pointsOf(perk.bonus)!;
      const card = describePerkBonus(perk.bonus);
      expect(card, perk.id).toContain(`+${bonus.percent} ${WORDING[bonus.kind]}`);
      expect(card, perk.id).not.toContain(`${bonus.percent}%`);
    }
  });
});
