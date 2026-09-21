import { describe, expect, it } from 'vitest';
import { bareBattlefield } from './battlefield.js';
import { simulate } from './engine.js';
import { findingsFor } from './report.js';

/**
 * What a report is allowed to tell you (`report.ts`).
 *
 * The findings are content, not plumbing: each one is a sentence a player reads instead of a
 * multiplier, and each carries a visibility that decides whether the other side hears it too.
 */
/**
 * The medics, in the one place their work is measurable.
 *
 * Every other mechanic in the game leaves a mark on the casualty list. `mends` leaves an *absence*
 * on it, which is exactly the thing a report cannot show by printing numbers: a player whose
 * Stitchers saved forty units reads a shorter list and concludes the medics did nothing.
 */
describe('a report says what the field hospital did', () => {
  const fight = (army: Record<string, number>) =>
    simulate({
      seed: 'support-finding',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: { breakers: 16 }, defending: false },
      defender: { name: 'D', army, defending: true },
    });

  it('says nothing at all when nobody brought one', () => {
    const findings = findingsFor(fight({ wardens: 20 }));
    expect(findings.filter((finding) => finding.kind === 'support')).toEqual([]);
  });

  it('reports the hospital to the side that paid for it, and only that side', () => {
    const findings = findingsFor(fight({ wardens: 20, stitchers: 12 }));
    const support = findings.filter((finding) => finding.kind === 'support');
    expect(support).toHaveLength(1);
    expect(support[0]!.side).toBe('defender');
    // Never `shared`: what the other side's medics managed is not visible from across a street,
    // and telling the attacker would hand them the counter for nothing.
    expect(support[0]!.visibility).toBe('own');
    expect(support[0]!.text).toContain('Stitchers');
  });
});

/**
 * ...and what the jammers did, which the casualty list hides even harder than the medics'
 * (maintainer, 2026-09-18: "add an info for the jam in the report").
 *
 * A Netrunner deals twenty damage. A player reading a report saw a unit that killed nobody and
 * concluded it had done nothing, when it may have been taking forty per cent off the other
 * side's armour *and* their damage for the whole fight. There is no absence to read here and no
 * number on the list: without a finding the mechanic is invisible.
 */
describe('a report says what the jammers did', () => {
  /** Room for everybody, so combat width is not quietly answering a different question. */
  const ROOMY = { ...bareBattlefield(), frontage: 10_000 };

  const findings = (army: Record<string, number>, enemy: Record<string, number>) =>
    findingsFor(
      simulate({
        seed: 'report-jam',
        attacker: { name: 'A', army, defending: false },
        defender: { name: 'D', army: enemy, defending: true },
        battlefield: ROOMY,
      }),
    );

  const ours = (army: Record<string, number>, enemy: Record<string, number>) =>
    findings(army, enemy).find((f) => f.side === 'attacker' && f.kind === 'support')?.text ?? '';

  it('says nothing at all when nobody brought one', () => {
    expect(ours({ razors: 200 }, { razors: 10 })).toBe('');
  });

  it('names the unit and the figure when they held', () => {
    const text = ours({ razors: 200, netrunners: 30 }, { razors: 10 });
    expect(text).toContain('Netrunners');
    expect(text, 'the finding quotes no figure').toMatch(/\d+% off their armour and their damage/);
    expect(text).toContain('the whole way');
  });

  /**
   * Killed and routed are different endings and a player would act on them differently: one says
   * bring more of them, the other says bring something to steady them. The first draft reported a
   * stack that broke with every unit standing as "the last of them went down".
   */
  it('says they were run off rather than killed, when that is what happened', () => {
    const text = ours({ razors: 60, netrunners: 20 }, { juggernauts: 12 });
    expect(text).toContain('broke and ran');
    expect(text, 'a stack that ran is not a stack that died').not.toContain('went down');
  });

  /**
   * The other side is told, and told **without a number**.
   *
   * `implied` is the report's third visibility and this is what it is for: a crew that has just
   * been jammed knows their shots landed soft, and handing them the percentage would hand them
   * the counter-list for a unit they have not scouted.
   */
  it('tells the other side they were jammed, and not how hard', () => {
    const theirs = findings({ razors: 200, netrunners: 30 }, { razors: 10 }).find(
      (f) => f.side === 'defender' && f.kind === 'support',
    );
    expect(theirs?.visibility).toBe('implied');
    expect(theirs?.text).toMatch(/augmentations/);
    expect(theirs?.text ?? '', 'the victim was handed a figure').not.toMatch(/\d/);
  });
});
