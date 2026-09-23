import {
  OFFICER_INJURY_HOURS,
  createCommander,
  makeAttributes,
  officerIsInjured,
  officerRecoveryAt,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { seatedRoles, workingOfficer, workingRoles } from './roster.js';

/**
 * An injured officer is **out**, entirely, for twelve hours (maintainer, 2026-09-23).
 *
 * The sheet fold already dropped them before best-of, so their ratings and their perks were
 * already off. What was still running was everything their *chair* unlocks: a Consigliere in a
 * hospital bed still countered spies, a Master of Whispers still ran the network, a Fabricator
 * still cut cards and a Head of Research still read the market. One function decides it now
 * (`workingOfficers`), and this file is what holds the two questions apart: which chairs are
 * **taken**, which the Bar asks so it can refuse to seat two people in one, and which chairs are
 * **working**, which everything else asks.
 */

const NOW = new Date('2026-09-23T20:00:00.000Z');

const hurt = (role: Parameters<typeof createCommander>[2], until: string) => ({
  ...createCommander(`off-${String(role)}`, 'Somebody', role, makeAttributes(50), []),
  injuredUntil: until,
});

describe('how long an injury lasts', () => {
  it('is twelve hours, and the recovery mark is that far out', () => {
    expect(OFFICER_INJURY_HOURS).toBe(12);
    const until = officerRecoveryAt(NOW);
    expect(Date.parse(until) - NOW.getTime()).toBe(12 * 3_600_000);
  });

  it('counts somebody hurt until the mark passes, and fit the moment it does', () => {
    const until = officerRecoveryAt(NOW);
    expect(officerIsInjured(until, NOW)).toBe(true);
    expect(officerIsInjured(until, new Date(Date.parse(until) - 1))).toBe(true);
    expect(officerIsInjured(until, new Date(Date.parse(until)))).toBe(false);
    expect(officerIsInjured(until, new Date(Date.parse(until) + 60_000))).toBe(false);
    // Never hurt is never hurt, whatever the clock says.
    expect(officerIsInjured(null, NOW)).toBe(false);
  });
});

describe('a chair that is taken and a chair that is working', () => {
  const until = officerRecoveryAt(NOW);
  const bench = [
    hurt('consigliere', until),
    createCommander('off-fab', 'Fabricator', 'fabricator', makeAttributes(50), []),
  ];

  it('still counts an injured officer as filling their seat', () => {
    /*
     * The Bar asks this one, and it has to keep answering yes: a chair does not come free because
     * the person in it is hurt, and offering to seat a second Consigliere would be offering to do
     * something the crew screen then refuses.
     */
    expect(seatedRoles(bench)).toContain('consigliere');
    expect(seatedRoles(bench)).toContain('fabricator');
  });

  it('does not count them as working while they are out', () => {
    expect(workingRoles(bench, NOW)).not.toContain('consigliere');
    expect(workingRoles(bench, NOW)).toContain('fabricator');
    expect(workingOfficer(bench, 'consigliere', NOW)).toBeUndefined();
    expect(workingOfficer(bench, 'fabricator', NOW)?.role).toBe('fabricator');
  });

  it('puts them back to work the moment the twelve hours are up', () => {
    const better = new Date(Date.parse(until) + 1000);
    expect(workingRoles(bench, better)).toContain('consigliere');
    expect(workingOfficer(bench, 'consigliere', better)?.role).toBe('consigliere');
  });

  it('is measured on a bench where the two answers really do differ', () => {
    // Without this the test above could pass on a bench where nobody is hurt at all.
    expect(seatedRoles(bench).length).toBeGreaterThan(workingRoles(bench, NOW).length);
  });
});
