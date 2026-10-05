import { describe, expect, it } from 'vitest';
import { RESEARCH_ITEMS, findResearchItem, researchEffects } from '../research/tracks.js';
import { leading, noCrewEffects } from './effects.js';
import { raidBossBodyTimes } from './passives.js';
import {
  NO_SHEET_BONUS,
  chairLeadsFor,
  leadingAs,
  officerSheetBonusFor,
  partyOffenseFor,
  scopesOf,
  type ChairLead,
} from './leading.js';

/**
 * The chairs' own fighting rungs (maintainer, 2026-09-28): the Raid Boss's pay him alone, the
 * Field Commander's pay the party, and neither pays while anybody else leads.
 */

const RAID_BOSS_RUNGS = [
  'tech_point_man',
  'tech_plate_carrier',
  'tech_loudest_in_the_room',
  'tech_hard_to_kill',
  'tech_second_wind',
  'tech_hits_like_a_truck',
] as const;
const FIELD_COMMANDER_RUNGS = [
  'tech_marching_orders',
  'tech_hold_the_line',
  'tech_field_marshal',
] as const;

const everything = researchEffects([...RAID_BOSS_RUNGS, ...FIELD_COMMANDER_RUNGS]);

describe('the two tracks carry the rungs, filed under their chairs', () => {
  it('has every rung, on the track its chair owns, at the step the brief put it', () => {
    for (const [index, id] of RAID_BOSS_RUNGS.entries()) {
      const rung = findResearchItem(id);
      expect(rung?.track, id).toBe('raid_boss');
      expect(rung?.step, id).toBe(index + 1);
    }
    const steps = FIELD_COMMANDER_RUNGS.map((id) => findResearchItem(id));
    expect(steps.map((rung) => rung?.track)).toEqual([
      'field_commander',
      'field_commander',
      'field_commander',
    ]);
    // Early for a mission, the middle for a fight, the top for a stronger one.
    expect(steps.map((rung) => rung?.step)).toEqual([2, 6, 10]);
  });

  it('files a leading rung under its track, and drops one folded with no track', () => {
    expect(everything.chairLeads).toHaveLength(9);
    expect(everything.chairLeads.filter((lead) => lead.role === 'raid_boss')).toHaveLength(6);
    expect(everything.chairLeads.filter((lead) => lead.role === 'field_commander')).toHaveLength(3);
    // Every other channel is untouched by the nine: they are worth nothing until somebody leads.
    expect({ ...everything, chairLeads: [] }).toEqual(noCrewEffects());
  });

  it('keeps the Raid Boss about himself and the Field Commander about the line', () => {
    for (const lead of everything.chairLeads) {
      if (lead.role === 'raid_boss')
        expect(lead.bonus.kind, lead.bonus.kind).not.toBe('leader_party');
      else expect(lead.bonus.kind).toBe('leader_party');
    }
    // Nobody else's track pays while its officer leads: the nine are the whole list.
    const leading = RESEARCH_ITEMS.filter((spec) =>
      ['leader_self', 'leader_taunt', 'leader_party'].includes(spec.payout.bonus?.kind ?? ''),
    );
    expect(leading.map((spec) => spec.id).sort()).toEqual(
      [...RAID_BOSS_RUNGS, ...FIELD_COMMANDER_RUNGS].sort(),
    );
  });
});

describe('what pays, for whom, and when', () => {
  it('spends a mission rung on a battle job only, and a fight rung in any fight', () => {
    expect(scopesOf('mission')).toEqual(['mission', 'fight']);
    expect(scopesOf('battle')).toEqual(['fight']);
    const onJob = chairLeadsFor(everything, 'raid_boss', 'mission');
    const inBattle = chairLeadsFor(everything, 'raid_boss', 'battle');
    expect(onJob).toHaveLength(6);
    expect(inBattle).toHaveLength(4);
    expect(inBattle.every((bonus) => bonus.scope === 'fight')).toBe(true);
  });

  it('pays nothing to another chair, or to the Overseer', () => {
    expect(chairLeadsFor(everything, 'field_commander', 'mission')).toHaveLength(3);
    expect(chairLeadsFor(everything, 'professor', 'mission')).toEqual([]);
    expect(chairLeadsFor(everything, null, 'mission')).toEqual([]);
    expect(officerSheetBonusFor(everything, null, 'battle')).toEqual({
      offensePercent: 0,
      vitalityPercent: 0,
      armorFlat: 0,
      targetSharePercent: 0,
      offenseTimes: 1,
      vitalityTimes: 1,
    });
    // ...and a chairless leader spends the crew's channels alone: `leading`, nothing of a track's.
    expect(leadingAs(everything, null, 'mission')).toEqual(leading(everything));
  });

  it("puts the Raid Boss's rungs on his own sheet, by scope", () => {
    expect(officerSheetBonusFor(everything, 'raid_boss', 'mission')).toEqual({
      // Point Man (25, mission) and Hits Like a Truck (30, fight) both pay on a job.
      offensePercent: 55,
      // Hard to Kill (30, fight) and Second Wind (100, mission).
      vitalityPercent: 130,
      armorFlat: 15,
      targetSharePercent: 100,
      // No Raid Boss's points on this book, so his passive multiplies by one (2026-10-04).
      offenseTimes: 1,
      vitalityTimes: 1,
    });
    expect(officerSheetBonusFor(everything, 'raid_boss', 'battle')).toEqual({
      offensePercent: 30,
      vitalityPercent: 30,
      armorFlat: 15,
      targetSharePercent: 100,
      offenseTimes: 1,
      vitalityTimes: 1,
    });
    // ...and nothing on the line: his track is about him.
    expect(partyOffenseFor(everything, 'raid_boss', 'mission')).toBe(0);
  });

  it("puts the Field Commander's rungs on every unit, on top of the crew's leading channels", () => {
    const book = { ...everything, leadOffensePercent: 4, unitOffensePercent: 3 };
    // Marching Orders (5, mission), Hold the Line (8, fight), Field Marshal (12, fight).
    expect(partyOffenseFor(book, 'field_commander', 'mission')).toBe(25);
    expect(partyOffenseFor(book, 'field_commander', 'battle')).toBe(20);
    expect(leadingAs(book, 'field_commander', 'mission').unitOffensePercent).toBe(3 + 4 + 25);
    expect(leadingAs(book, 'field_commander', 'battle').unitOffensePercent).toBe(3 + 4 + 20);
    // A chair with no rungs of its own still spends the crew's `lead_*` channels.
    expect(leadingAs(book, 'professor', 'battle').unitOffensePercent).toBe(3 + 4);
    // ...and his own sheet is nobody's business: the track is about the army.
    expect(officerSheetBonusFor(book, 'field_commander', 'mission').offensePercent).toBe(0);
  });

  // The Raid Boss's passive (maintainer, 2026-10-04): one at the floor, five at a perfect sheet, in
  // every fight he is in, off his own seat points on the fold.
  it("multiplies the Raid Boss's damage and hit points by his grade, and nobody else's", () => {
    const withBoss = (points: number) => ({
      ...noCrewEffects(),
      chairPoints: { raid_boss: points },
    });
    expect(raidBossBodyTimes(10)).toBe(1);
    expect(raidBossBodyTimes(100)).toBe(5);
    expect(raidBossBodyTimes(55)).toBeCloseTo(3, 10);
    for (const context of ['mission', 'battle'] as const) {
      expect(officerSheetBonusFor(withBoss(100), 'raid_boss', context)).toEqual({
        ...NO_SHEET_BONUS,
        offenseTimes: 5,
        vitalityTimes: 5,
      });
    }
    // No Raid Boss working, no multiplier.
    expect(officerSheetBonusFor(noCrewEffects(), 'raid_boss', 'battle')).toEqual(NO_SHEET_BONUS);
    for (const role of ['field_commander', 'professor', null] as const) {
      expect(officerSheetBonusFor(withBoss(100), role, 'battle')).toEqual(NO_SHEET_BONUS);
    }
  });

  it('sums two rungs on one channel rather than taking the last one read', () => {
    const leads: ChairLead[] = [
      { role: 'raid_boss', bonus: { kind: 'leader_self', scope: 'fight', stat: 'armor', flat: 5 } },
      { role: 'raid_boss', bonus: { kind: 'leader_self', scope: 'fight', stat: 'armor', flat: 7 } },
      { role: 'raid_boss', bonus: { kind: 'leader_taunt', scope: 'fight', percent: 50 } },
      { role: 'raid_boss', bonus: { kind: 'leader_taunt', scope: 'mission', percent: 50 } },
    ];
    const bonus = officerSheetBonusFor(
      { chairLeads: leads, chairPoints: {} },
      'raid_boss',
      'battle',
    );
    expect(bonus.armorFlat).toBe(12);
    expect(bonus.targetSharePercent).toBe(50);
    expect(
      officerSheetBonusFor({ chairLeads: leads, chairPoints: {} }, 'raid_boss', 'mission')
        .targetSharePercent,
    ).toBe(100);
  });
});
