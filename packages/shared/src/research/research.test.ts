import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import { MAX_RESEARCH_LEADERSHIP_XP, factionXpFromLeadership } from './effects.js';
import {
  isResearchDue,
  researchProgressAt,
  researchRemainingMs,
  type ActiveResearch,
} from './projects.js';
import { startingResearch } from './state.js';

/**
 * The public half of research (§C, §F3). Anything that has to be judged against the hidden
 * requirement table is asserted server-side instead, which is the only place allowed to read it.
 */

const NOW = new Date('2026-08-13T09:00:00.000Z');

/** The one duration this file's clock assertions run on. Any positive number would do. */
const RUNS_FOR = 90;

describe('§F3: Charisma turns a result into allegiance XP', () => {
  it('runs from nothing to the cap, and is monotone in between', () => {
    expect(factionXpFromLeadership(makeAttributes(0))).toBe(0);
    expect(factionXpFromLeadership(makeAttributes(100))).toBe(MAX_RESEARCH_LEADERSHIP_XP);
    const readings = [0, 25, 50, 75, 100].map((charisma) =>
      factionXpFromLeadership(makeAttributes(10, { charisma })),
    );
    expect(readings).toEqual([...readings].sort((a, b) => a - b));
  });
});

describe('a crew that has never researched anything', () => {
  it('has nothing running and nothing finished', () => {
    expect(startingResearch()).toEqual({ active: null, technologies: [] });
  });
});

describe('a project runs on the clock frozen onto its row', () => {
  const active: ActiveResearch = {
    id: 'r-1',
    project: { kind: 'technology', techId: 'tech_field_dressing' },
    startedAt: NOW.toISOString(),
    durationMinutes: RUNS_FOR,
  };
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

  it('counts down, never below zero, and is due exactly on the boundary', () => {
    expect(isResearchDue(active, NOW)).toBe(false);
    expect(isResearchDue(active, at(RUNS_FOR - 1))).toBe(false);
    expect(isResearchDue(active, at(RUNS_FOR))).toBe(true);
    expect(researchRemainingMs(active, at(RUNS_FOR * 10))).toBe(0);
  });

  it('reports progress clamped to 0..1', () => {
    expect(researchProgressAt(active, NOW)).toBe(0);
    expect(researchProgressAt(active, at(RUNS_FOR / 2))).toBeCloseTo(0.5, 10);
    expect(researchProgressAt(active, at(RUNS_FOR * 3))).toBe(1);
    expect(researchProgressAt(active, at(-100))).toBe(0);
  });

  it('ignores a retune of the catalogue: the row keeps its own duration', () => {
    const legacy: ActiveResearch = { ...active, durationMinutes: 5 };
    expect(isResearchDue(legacy, at(5))).toBe(true);
    expect(isResearchDue(active, at(5))).toBe(false);
  });
});
