import { describe, expect, it } from 'vitest';
import { CHANNEL_LABELS } from '../crew/effects.js';
import { describeAddonEffect, describeSetBonus } from './addons.js';
import { OFFICER_FOR_EFFECT } from './requirements.js';
import { MODIFICATIONS, findModification, type ModificationEffect } from './modifications.js';

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
   * A muster card's number is speed, which the clock is divided by (`musterSecondsFor`), and it
   * printed as time off: Night Course's 16 read "+16% off how long training takes" and is 13.8% off
   * on its own (maintainer, 2026-10-01). It prints that cut now, as the Gauntlet's line does.
   */
  it('prints a muster card as the time it takes off on its own, not its speed as time', () => {
    const night = MODIFICATIONS.find((spec) => spec.name === 'Night Course')!;
    expect(night.effect).toBe('muster_time_reduction');
    expect(night.magnitude).toBe(16);
    expect(describeAddonEffect(night)).toBe('-14% muster time (tapers)');
    const lines = linesFor('muster_time_reduction');
    expect(lines.length).toBeGreaterThan(1);
    for (const [index, line] of lines.entries()) {
      expect(line, line).toMatch(/^-\d+% muster time \(tapers\)$/);
      expect(line, line).not.toContain('off how long');
      const speed = MODIFICATIONS.filter((spec) => spec.effect === 'muster_time_reduction')[index]!
        .magnitude;
      // The cut, rounded, and never the speed renamed: 1 - 1 / (1 + speed / 100).
      const cut = Math.round((1 - 1 / (1 + speed / 100)) * 100);
      expect(Number(line.slice(1, line.indexOf('%'))), line).toBe(cut);
    }
    expect(describeSetBonus('automation')).toMatch(/^-\d+% muster time \(tapers\)$/);
  });
});
