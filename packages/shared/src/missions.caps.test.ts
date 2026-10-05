import { describe, expect, it } from 'vitest';
import { applyPerkBonus, noCrewEffects } from './crew/effects.js';
import { describePerkBonus, findPerk } from './crew/perks.js';
import {
  MISSION_CAPS_TILT,
  MISSION_TEMPLATES,
  capsTilted,
  missionRewards,
  spoilsValue,
} from './missions.js';
import { withMissionCaps } from './missions.areas.js';

/**
 * More of a job's pay in caps, the total unchanged (maintainer, 2026-10-01).
 *
 * "Slightly buff the caps missions give so that the loot is more or less the same as before but
 * with more caps, especially for battles." And Cap Counter, whose caps yield had almost nothing to
 * scale, now counts a job's caps instead.
 */
describe('the caps a job pays', () => {
  it('moves more of a fight into caps than of plain work', () => {
    expect(MISSION_CAPS_TILT.battle).toBeGreaterThan(MISSION_CAPS_TILT.standard);
    expect(MISSION_CAPS_TILT.standard).toBeGreaterThan(0);
  });

  it.each(MISSION_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s is worth what it was, with no smaller a share in caps',
    (_, template) => {
      const tilted = capsTilted(template.spoils, template.kind);
      expect(spoilsValue(tilted)).toBeCloseTo(spoilsValue(template.spoils), 6);
      // A job that already pays only caps has nothing to move; every other one moves some.
      const allCaps = Object.keys(template.spoils).every((key) => key === 'caps');
      if (allCaps) {
        expect(tilted).toEqual(template.spoils);
        return;
      }
      expect(tilted.caps ?? 0).toBeGreaterThan(template.spoils.caps ?? 0);
      const paid = missionRewards(template);
      const share = (paid.caps ?? 0) / spoilsValue(paid);
      const before = (template.spoils.caps ?? 0) / spoilsValue(template.spoils);
      expect(share).toBeGreaterThan(before);
    },
  );
});

describe('Cap Counter', () => {
  const perk = findPerk('cap_counter')!;

  it('pays into the caps a job brings home, and says so', () => {
    expect(perk.bonus.kind).toBe('mission_caps');
    expect(describePerkBonus(perk.bonus)).toMatch(/caps from jobs$/);
    const effects = applyPerkBonus(noCrewEffects(), perk.bonus);
    expect(effects.missionCapsPercent).toBeGreaterThan(0);
  });

  it('raises the caps and leaves the rest of the pay alone', () => {
    const paid = { caps: 200, scrap: 50 };
    const counted = withMissionCaps(paid, 8);
    expect(counted.caps).toBe(216);
    expect(counted.scrap).toBe(50);
    expect(withMissionCaps(paid, 0)).toEqual(paid);
  });
});
