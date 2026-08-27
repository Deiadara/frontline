import {
  BLACK_MARKET_REFUSALS,
  MISSION_FORCE_REFUSALS,
  SUPPLY_REFUSALS,
  UPGRADE_REFUSALS as UNIT_UPGRADE_REFUSALS,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { DECLARE_REFUSALS } from '../battle/declare.js';
import { DEPLOY_REFUSALS } from '../battle/deploy.js';
import { HIRE_REFUSALS } from '../bar/hire.js';
import { BUILD_REFUSALS } from '../district/build.js';
import { CITY_REFUSALS } from '../city/actions.js';
import { UPGRADE_REFUSALS } from '../city/upgrade.js';
import { RESEARCH_REFUSALS } from '../research/start.js';
import { TRAINING_REFUSALS } from '../units/training.js';
import { WAIVED_REFUSALS, adminWaives } from './mode.js';

/**
 * The testing build's waiver list, checked against the refusals that actually exist.
 *
 * `WAIVED` is prose in a `Set`: it says which gates the bench opens, and nothing type-checks it
 * against the unions it is quoting. So it rots in both directions. A refusal that is renamed or
 * deleted leaves a dead string behind that reads as a live exemption, and a refusal *added* by a
 * new feature is closed by default and silently un-waivable, which is only correct if somebody
 * decided it should be.
 *
 * Both have happened. `'reputation'` outlived the mechanic that produced it by a whole rework, and
 * the payroll book, the recruit level gate and the walkout standoff all arrived without anyone
 * classifying them, so the bench could not sign a good officer at all.
 *
 * Only the first direction can be asserted mechanically, and it is the one worth having: every
 * string in the list must be a refusal something can still return.
 */

const LIVE_REFUSALS: readonly string[] = [
  ...DECLARE_REFUSALS,
  ...DEPLOY_REFUSALS,
  ...RESEARCH_REFUSALS,
  ...Object.keys(UPGRADE_REFUSALS),
  ...CITY_REFUSALS,
  ...TRAINING_REFUSALS,
  ...HIRE_REFUSALS,
  ...BUILD_REFUSALS,
  ...MISSION_FORCE_REFUSALS,
  ...SUPPLY_REFUSALS,
  ...BLACK_MARKET_REFUSALS,
  ...UNIT_UPGRADE_REFUSALS,
];

describe('the testing build waives gates that exist (admin/mode.ts)', () => {
  it('names no refusal that nothing can return any more', () => {
    const live = new Set(LIVE_REFUSALS);
    const dead = [...WAIVED_REFUSALS].filter((reason) => !live.has(reason));
    expect(dead, `waived refusals nothing produces: ${dead.join(', ')}`).toEqual([]);
  });

  /** And the two halves agree: what is in the list is waived, what is not is not. */
  it('waives exactly what the list names, and only under the testing build', () => {
    for (const reason of WAIVED_REFUSALS) {
      expect(adminWaives(reason, true), reason).toBe(true);
      expect(adminWaives(reason, false), reason).toBe(false);
    }
    // A rule about what a unit *is* rather than about how far along a crew is: waiving it would
    // put a porter in a battle line and produce a save that means nothing.
    expect(adminWaives('not_a_fighting_force', true)).toBe(false);
    expect(adminWaives('role_taken', true)).toBe(false);
  });
});
