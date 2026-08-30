import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_NAMES, makeAttributes } from '../attributes.js';
import {
  MAX_RESEARCH_LEADERSHIP_XP,
  TRAINING_STEP,
  canDevelop,
  developAttribute,
  factionXpFromLeadership,
} from './effects.js';
import { consultOnAssignment, factKey, makePairing, pairingsIn, roleFactsIn } from './facts.js';
import {
  RESEARCH_MINUTES,
  isResearchDue,
  researchProgressAt,
  researchRemainingMs,
  type ActiveResearch,
} from './projects.js';
import { recordFacts, startingResearch } from './state.js';

/**
 * The public half of research (§B9, §F2, §F3). What is asserted server-side instead, on purpose:
 * anything that has to be judged against the hidden requirement table lives in
 * `apps/server/src/research/discovery.leak.test.ts`, which is the only place allowed to read it.
 */

const NOW = new Date('2026-08-13T09:00:00.000Z');

describe('facts are canonical, so a fact has exactly one identity', () => {
  it('orders a pairing the same way whichever way round it is built', () => {
    const forwards = makePairing('stealth', 'analysis');
    const backwards = makePairing('analysis', 'stealth');
    expect(forwards).toEqual(backwards);
    expect(factKey(forwards)).toBe(factKey(backwards));
    // Canonical order is `ATTRIBUTE_NAMES` position: `stealth` is physical, `analysis` mental.
    expect(forwards.attributes).toEqual(['stealth', 'analysis']);
  });

  it('never files the same fact twice, whichever spelling arrives', () => {
    const state = recordFacts(startingResearch(), [
      { kind: 'role_attribute', role: 'scout', attribute: 'speed' },
      makePairing('speed', 'dexterity'),
    ]);
    const again = recordFacts(state, [
      { kind: 'role_attribute', role: 'scout', attribute: 'speed' },
      makePairing('dexterity', 'speed'),
    ]);
    expect(again.facts).toHaveLength(2);
    expect(again, 'an all-duplicate batch must not allocate a new state').toBe(state);
  });

  it('keeps roles apart and sorts what it hands back', () => {
    const state = recordFacts(startingResearch(), [
      { kind: 'role_attribute', role: 'scout', attribute: 'navigation' },
      { kind: 'role_attribute', role: 'scout', attribute: 'speed' },
      { kind: 'role_attribute', role: 'trader', attribute: 'negotiation' },
      makePairing('logic', 'stealth'),
    ]);
    // Canonical order, not insertion order: `speed` precedes `navigation` in `ATTRIBUTE_NAMES`.
    expect(roleFactsIn(state.facts, 'scout')).toEqual(['speed', 'navigation']);
    expect(roleFactsIn(state.facts, 'trader')).toEqual(['negotiation']);
    expect(roleFactsIn(state.facts, 'chief_medic')).toEqual([]);
    expect(pairingsIn(state.facts)).toHaveLength(1);
  });
});

describe('the consultation reads the sheet it is given (§B9)', () => {
  const facts = [
    { kind: 'role_attribute', role: 'scout', attribute: 'speed' },
    { kind: 'role_attribute', role: 'scout', attribute: 'navigation' },
    { kind: 'role_attribute', role: 'trader', attribute: 'negotiation' },
  ] as const;

  it('answers only for the role asked about, in canonical order', () => {
    const sheet = makeAttributes(15, { speed: 33, navigation: 9, negotiation: 40 });
    expect(consultOnAssignment(sheet, 'scout', facts)).toEqual([
      { attribute: 'speed', value: 33, tier: 'strong' },
      { attribute: 'navigation', value: 9, tier: 'weak' },
    ]);
  });

  it('says nothing at all about a role research has not touched', () => {
    expect(consultOnAssignment(makeAttributes(40), 'raid_boss', facts)).toEqual([]);
  });
});

describe('§F2: developing an attribute', () => {
  it('moves one attribute by one step and leaves the rest alone', () => {
    const before = makeAttributes(20);
    const after = developAttribute(before, 'improvisation');
    expect(after.improvisation).toBe(20 + TRAINING_STEP);
    expect({ ...after, improvisation: 20 }).toEqual(before);
  });

  it('covers every attribute: §B6 has no per-role subset', () => {
    const sheet = makeAttributes(20);
    for (const name of ATTRIBUTE_NAMES) {
      expect(canDevelop(sheet, name)).toBe(true);
      expect(developAttribute(sheet, name)[name]).toBe(21);
    }
  });
});

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

describe('a project runs on the clock frozen onto its row', () => {
  const active: ActiveResearch = {
    id: 'r-1',
    project: { kind: 'training', attribute: 'improvisation' },
    startedAt: NOW.toISOString(),
    durationMinutes: RESEARCH_MINUTES.training,
  };
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

  it('counts down, never below zero, and is due exactly on the boundary', () => {
    expect(isResearchDue(active, NOW)).toBe(false);
    expect(isResearchDue(active, at(RESEARCH_MINUTES.training - 1))).toBe(false);
    expect(isResearchDue(active, at(RESEARCH_MINUTES.training))).toBe(true);
    expect(researchRemainingMs(active, at(RESEARCH_MINUTES.training * 10))).toBe(0);
  });

  it('reports progress clamped to 0..1', () => {
    expect(researchProgressAt(active, NOW)).toBe(0);
    expect(researchProgressAt(active, at(RESEARCH_MINUTES.training / 2))).toBeCloseTo(0.5, 10);
    expect(researchProgressAt(active, at(RESEARCH_MINUTES.training * 3))).toBe(1);
    expect(researchProgressAt(active, at(-100))).toBe(0);
  });

  it('ignores a retune of the catalogue: the row keeps its own duration', () => {
    const legacy: ActiveResearch = { ...active, durationMinutes: 5 };
    expect(isResearchDue(legacy, at(5))).toBe(true);
    expect(isResearchDue(active, at(5))).toBe(false);
  });
});
