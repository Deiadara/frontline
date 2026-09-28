import { MAX_ATTRIBUTE, makeAttributes, type Attributes } from '@frontline/shared';

/**
 * A leader for tests whose subject is not the dice (maintainer, 2026-09-28: every run has one).
 *
 * Every attribute at the ceiling grades as S+ on any job, which is five or more marks over every
 * grade below S-, so a plain run under this leader cannot fail (`GRADED_CERTAIN_MARGIN`). The
 * Overseer rather than an officer, because the Overseer is always on the bench and needs no row
 * on the books to lead.
 */
export function sureLeader(): { kind: 'overseer'; id: string; attributes: Attributes } {
  return { kind: 'overseer', id: 'overseer-test', attributes: makeAttributes(MAX_ATTRIBUTE) };
}
