import {
  ATTRIBUTE_NAMES,
  OFFICER_ROLES,
  makeAttributes,
  type AttributeName,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { ROLE_REQUIREMENTS, roleFit, weightedAttributesOf } from './requirements.js';

describe('ROLE_REQUIREMENTS', () => {
  it('covers all 19 roles and only real attributes', () => {
    expect(Object.keys(ROLE_REQUIREMENTS).sort()).toEqual([...OFFICER_ROLES].sort());
    for (const role of OFFICER_ROLES) {
      const { primary, weights } = ROLE_REQUIREMENTS[role];
      expect(ATTRIBUTE_NAMES).toContain(primary);
      expect(Object.keys(weights).length).toBeGreaterThanOrEqual(3);
      for (const [name, weight] of Object.entries(weights)) {
        expect(ATTRIBUTE_NAMES).toContain(name);
        expect(weight).toBeGreaterThan(0);
      }
    }
  });

  // B3/B5: "enough that all 19 roles have something that is genuinely theirs". Two roles sharing
  // a headline attribute would make one of them indistinguishable from the other at a glance.
  it('gives every role a primary attribute no other role claims', () => {
    const primaries = OFFICER_ROLES.map((role) => ROLE_REQUIREMENTS[role].primary);
    expect(new Set(primaries).size).toBe(OFFICER_ROLES.length);
  });

  it('weights the primary above everything else it asks for', () => {
    for (const role of OFFICER_ROLES) {
      const { primary, weights } = ROLE_REQUIREMENTS[role];
      const primaryWeight = weights[primary];
      expect(primaryWeight).toBeDefined();
      for (const [name, weight] of Object.entries(weights)) {
        if (name !== primary) expect(weight).toBeLessThan(primaryWeight as number);
      }
      expect(weightedAttributesOf(role)[0]).toBe(primary);
    }
  });
});

describe('roleFit', () => {
  it('stays on the 0..100 attribute scale', () => {
    for (const role of OFFICER_ROLES) {
      expect(roleFit(makeAttributes(0), role)).toBe(0);
      expect(roleFit(makeAttributes(100), role)).toBe(100);
      expect(roleFit(makeAttributes(37), role)).toBeCloseTo(37);
    }
  });

  it('rewards the attributes a role actually asks for and ignores the rest', () => {
    const irrelevant = ATTRIBUTE_NAMES.filter(
      (name) => !(name in ROLE_REQUIREMENTS.head_spy.weights),
    );
    const flat = makeAttributes(20);
    const spyish = makeAttributes(20, { stealth: 90, deception: 90 });
    const wasted = makeAttributes(20, Object.fromEntries(irrelevant.map((n) => [n, 90])));

    expect(roleFit(spyish, 'head_spy')).toBeGreaterThan(roleFit(flat, 'head_spy'));
    expect(roleFit(wasted, 'head_spy')).toBe(roleFit(flat, 'head_spy'));
  });

  // C2: the same character can be slotted anywhere — well or badly. A sheet built for one role
  // must not accidentally be the best sheet for every role.
  it('separates roles: a role-shaped sheet fits that role best', () => {
    for (const role of OFFICER_ROLES) {
      const shaped = makeAttributes(
        10,
        Object.fromEntries(weightedAttributesOf(role).map((name: AttributeName) => [name, 80])),
      );
      const others = OFFICER_ROLES.filter((other) => other !== role);
      for (const other of others) {
        expect(roleFit(shaped, role)).toBeGreaterThan(roleFit(shaped, other));
      }
    }
  });
});
