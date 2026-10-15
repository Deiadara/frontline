import { describe, expect, it } from 'vitest';
import { CHANNEL_LABELS } from '../crew/effects.js';
import { describeAddonEffect, describeSetBonus } from './addons.js';
import { OFFICER_FOR_EFFECT } from './requirements.js';
import { MODIFICATIONS, findModification, type ModificationEffect } from './modifications.js';
import { UNIT_MODIFICATIONS } from '../units/modifications.js';
import { UNIT_STAT_LABELS } from '../units/stats.js';

/**
 * What a structure card says it pays, against the channel that pays it (wiring audit, 2026-10-01).
 *
 * Every card was measured on its consumer and every one pays its printed number. Three lines named
 * the wrong thing: the number arrived, somewhere other than where the card said.
 */

const linesFor = (effect: ModificationEffect): string[] =>
  MODIFICATIONS.filter((spec) => spec.effect === effect).map((spec) => describeAddonEffect(spec));

describe('a structure card names the channel that pays it', () => {
  /*
   * `defense_percent` goes through `gateDefensePercent` into `gatePercent`, the Gate's own term:
   * paid in a fight at the crew's gate while it stands, dropped by a breach, and skipped by a
   * Wall Breaker. "Holding your ground" is `defensePercent`, which pays in every fight the crew
   * defends. The card wore that channel's name.
   */
  it('calls the armour cards Gate defence, which tapers, and not holding your ground', () => {
    const lines = linesFor('defense_percent');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of [...lines, describeSetBonus('armour')]) {
      expect(line).toContain('Gate defense');
      expect(line).toContain('tapers');
      expect(line.toLowerCase()).not.toContain(CHANNEL_LABELS.defensePercent.label.toLowerCase());
    }
  });

  /*
   * `faction_xp_percent` is added to every award of the crew's own experience (`awardPlayerXp`).
   * A faction has no experience to raise.
   */
  it('calls the experience cards experience, not faction experience', () => {
    const lines = linesFor('faction_xp_percent');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/% experience$/);
      expect(line).not.toMatch(/faction/i);
    }
  });

  /*
   * `raid_loot_percent` is folded into `lootCapacityPercent`, the size of the bag, and the bag is
   * read on a won raid and on every job's haul home (`missions/resolve.ts`) alike.
   */
  it('calls the haul cards loot capacity, which a job carries home too', () => {
    const lines = linesFor('raid_loot_percent');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/% loot capacity$/);
      expect(line).not.toMatch(/raid/i);
    }
  });

  /*
   * Encrypted Core says spies work blind (maintainer, 2026-10-01: "make it anti-spy"). It pays
   * `counter_intel_points`, points a spy has to beat in `crewCounter`, so its line is points with
   * no percent sign, and it asks the chair that defends a crew's ground against spies.
   */
  /*
   * A unit card's line printed the catalogue's field names (2026-10-11): "+5 lootCapacity" and
   * "+16 offense" on the Units page hover, while the Scrapyard bench called the same numbers Loot
   * and Damage. The line uses the sheet's own labels now, so the two screens agree.
   */
  it("names a unit card's ratings as the sheet does, never by field name", () => {
    const loot = UNIT_MODIFICATIONS.find((spec) => typeof spec.effect.lootCapacity === 'number')!;
    expect(describeAddonEffect(loot)).toContain(`+${loot.effect.lootCapacity} loot`);
    expect(describeAddonEffect(loot)).not.toContain('lootCapacity');
    for (const spec of UNIT_MODIFICATIONS) {
      const line = describeAddonEffect(spec);
      for (const stat of Object.keys(spec.effect)) {
        if (stat in UNIT_STAT_LABELS) {
          expect(line, spec.id).toContain(
            UNIT_STAT_LABELS[stat as keyof typeof UNIT_STAT_LABELS].toLowerCase(),
          );
          if (stat !== stat.toLowerCase()) expect(line, spec.id).not.toContain(stat);
        }
      }
    }
  });

  it('prints the counter-intelligence card in points, against spies', () => {
    const core = findModification('nexus_encrypted_core')!;
    expect(core.effect).toBe('counter_intel_points');
    expect(describeAddonEffect(core)).toBe(`+${core.magnitude} points against spies`);
    expect(OFFICER_FOR_EFFECT.counter_intel_points).toBe('master_of_whispers');
  });

  /*
   * Two blurbs read as a trade the card does not pay (2026-10-01): Quiet Wing promised a quicker
   * recovery and pays payroll room, Standpipe Run promised fewer sick and pays unit slots.
   */
  it('words the payroll and housing blurbs as what the cards pay', () => {
    const quiet = findModification('infirmary_quiet_wing')!;
    const standpipe = findModification('quarters_standpipe_run')!;
    expect(quiet.effect).toBe('payroll_percent');
    expect(quiet.description).toMatch(/sign for less/);
    expect(standpipe.effect).toBe('housing_percent');
    expect(standpipe.description).toMatch(/lived in/);
    expect(standpipe.description).not.toMatch(/\bill\b/);
  });

  /*
   * A card that feeds a curve prints its raw points (maintainer, 2026-10-15): the bench adds the
   * card's speed to everybody else's and tapers the sum, so a share of the curve on its own (Night
   * Course's 16 read as 14% off) is not what a muster spends. The Units page prints the spent cut.
   */
  it('prints a card that feeds a curve as the raw points it adds', () => {
    const night = MODIFICATIONS.find((spec) => spec.name === 'Night Course')!;
    expect(night.effect).toBe('muster_time_reduction');
    expect(night.magnitude).toBe(16);
    expect(describeAddonEffect(night)).toBe('+16 points of muster speed (tapers)');
    for (const effect of [
      'muster_time_reduction',
      'muster_supplies_reduction',
      'defense_percent',
    ] as const) {
      const lines = linesFor(effect);
      expect(lines.length, effect).toBeGreaterThan(0);
      for (const line of lines) expect(line, line).toMatch(/^\+\d+(\.\d+)? points .* \(tapers\)$/);
    }
    expect(describeSetBonus('automation')).toMatch(/^\+\d+ points of muster speed \(tapers\)$/);
  });
});
