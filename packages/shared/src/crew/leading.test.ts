import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import { PERK_CATALOG, describePerkBonus, findPerk, type PerkBonus } from './perks.js';
import { crewEffects, leading, noCrewEffects, type CrewMember } from './effects.js';

/**
 * §D5: the perks that only pay while an officer is leading.
 *
 * Two properties, and the second is the one that makes them a decision rather than a number.
 *
 * - **Folded always.** `crewEffects` puts them in the struct whoever is on the books, because
 *   folding is cheap and the alternative is a second pass with its own bugs.
 * - **Spent never, until somebody goes.** `leading` is the only thing that moves them onto the
 *   channels the engine and the clock read, and it is called by the settler and the mission
 *   launcher, which are the two places that know whether an officer actually left the district.
 */

const bearer = (perks: readonly string[]): CrewMember => ({
  attributes: makeAttributes(0),
  role: null,
  perks: [...perks],
});

const LEAD_KINDS: readonly PerkBonus['kind'][] = [
  'lead_offense',
  'lead_evasion',
  'lead_armor',
  'lead_morale',
  'lead_loot',
  'lead_arrival',
];

describe('leading perks (§D5)', () => {
  it('has one perk in the catalogue for every leading channel', () => {
    for (const kind of LEAD_KINDS) {
      expect(
        PERK_CATALOG.some((perk) => perk.bonus.kind === kind),
        kind,
      ).toBe(true);
    }
  });

  it('folds them into the crew struct without spending them', () => {
    const folded = crewEffects([bearer(['front_rank', 'read_the_room', 'short_way'])]);
    expect(folded.leadOffensePercent).toBeGreaterThan(0);
    expect(folded.leadEvasionFlat).toBeGreaterThan(0);
    expect(folded.leadArrivalPercent).toBeGreaterThan(0);
    // ...and nothing has landed on the channels a fight actually reads.
    const bare = noCrewEffects();
    expect(folded.unitOffensePercent).toBe(bare.unitOffensePercent);
    expect(folded.unitEvasionFlat).toBe(bare.unitEvasionFlat);
    expect(folded.travelSpeedPercent).toBe(bare.travelSpeedPercent);
  });

  it('spends them onto the channels the engine reads, once somebody is leading', () => {
    const folded = crewEffects([
      bearer(['front_rank', 'read_the_room', 'plate_hoarder']),
      bearer(['holds_the_line', 'short_way']),
    ]);
    const led = leading(folded);
    expect(led.unitOffensePercent).toBe(folded.unitOffensePercent + folded.leadOffensePercent);
    expect(led.unitEvasionFlat).toBe(folded.unitEvasionFlat + folded.leadEvasionFlat);
    expect(led.unitArmorPercent).toBe(folded.unitArmorPercent + folded.leadArmorFlat);
    expect(led.unitMoraleFlat).toBe(folded.unitMoraleFlat + folded.leadMoraleFlat);
    expect(led.travelSpeedPercent).toBe(folded.travelSpeedPercent + folded.leadArrivalPercent);
    expect(led.missionSpeedPercent).toBe(folded.missionSpeedPercent + folded.leadArrivalPercent);
  });

  it('leaves the loot channel alone, because a haul is not a bigger truck', () => {
    const folded = crewEffects([bearer(['picks_the_crate'])]);
    expect(folded.leadLootPercent).toBeGreaterThan(0);
    // Spent by the settler against the haul itself. Folding it into carry capacity would turn
    // "more loot" into "room for more loot", which is a different and mostly worthless promise.
    expect(leading(folded).lootCapacityPercent).toBe(folded.lootCapacityPercent);
  });

  it('changes nothing at all for a crew that carries none of them', () => {
    const folded = crewEffects([bearer(['skim_route'])]);
    expect(leading(folded)).toEqual(folded);
  });

  it('says *while leading* on every one of them, so the condition is on the chip', () => {
    for (const perk of PERK_CATALOG) {
      if (!LEAD_KINDS.includes(perk.bonus.kind)) continue;
      expect(describePerkBonus(perk.bonus), perk.id).toContain('while leading');
    }
  });

  it('carries a real magnitude on each of the six', () => {
    for (const id of [
      'front_rank',
      'read_the_room',
      'plate_hoarder',
      'holds_the_line',
      'picks_the_crate',
      'short_way',
    ]) {
      const bonus = findPerk(id)?.bonus;
      expect(bonus, id).toBeDefined();
      const magnitude =
        bonus && 'percent' in bonus ? bonus.percent : ((bonus as never)['flat'] ?? 0);
      expect(magnitude, id).toBeGreaterThan(0);
    }
  });
});
