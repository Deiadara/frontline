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
 * Stitchers saved forty bodies reads a shorter list and concludes the medics did nothing.
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
