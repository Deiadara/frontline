import {
  ALIGNMENT_MAX,
  ALIGNMENT_MIN,
  alignmentTarget,
  contractStance,
  settleAlignment,
  type Base,
  type Commander,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { crewEffectsFor } from '../crew/standing.js';

/**
 * The §H5 alignment meter, kept current.
 *
 * Alignment settles on the real-world clock and is therefore applied lazily on the read path
 * rather than from a scheduler: an officer who was left alone for a week has drifted exactly as
 * far as one who was watched the whole time, because the decay composes over any split of the
 * interval.
 *
 * What they drift *towards* is what they made of their own contract (`contractStance`), which is
 * fixed the moment they sign and does not move again. That is a simplification the reputation
 * rework bought outright: the target used to change whenever the crew's reputation word did, which
 * is why there was an anchor-staleness problem to manage at all.
 */

function clampAlignment(value: number): number {
  return Math.min(ALIGNMENT_MAX, Math.max(ALIGNMENT_MIN, value));
}

/**
 * §H5: where one officer's opinion of the crew has got to by `now`.
 *
 * They drift towards what they made of the deal they signed: somebody who got their asking price
 * settles high, somebody ground down to their floor settles low and, past §H5's threshold, starts
 * threatening to leave. The two numbers that decide it are the fee in the payroll book and what
 * that person was asking, both of which the player chose.
 */
export function alignmentAt(
  officer: Commander,
  agreedFee: number,
  now: Date,
  holdPercent = 0,
): number {
  const target = alignmentTarget(contractStance(agreedFee, officer.askingWage));
  const elapsed = now.getTime() - new Date(officer.alignmentUpdatedAt).getTime();
  return clampAlignment(settleAlignment(officer.alignment, target, elapsed, holdPercent));
}

/**
 * How stale an officer's alignment anchor may get before a read is worth a write.
 *
 * A minute. The target is fixed at signing now, so the anchor cannot be credited to the wrong
 * stance the way it could when a reputation word could change under it; what is left is only
 * arithmetic hygiene, and a minute of a three-day half-life is two orders below the meter's own
 * rounding. It buys one write per minute per roster.
 */
const ALIGNMENT_ANCHOR_MAX_AGE_MS = 60 * 1000;

/**
 * Settles every officer on the base and persists the result when an anchor has gone stale.
 *
 * The gate is the *age of the anchor*, not whether the value moved. Those come apart for an
 * officer already sitting at their target: every stance-0 officer, permanently, since
 * `alignmentTarget(0)` is `ALIGNMENT_START`. Skipping their write leaves `alignmentUpdatedAt`
 * pinned to hire time, and the next reputation word that gives them a non-zero stance is then
 * credited with the whole accumulated tenure in a single read: a stance-0 officer of 21 days jumps
 * 50 -> 74.8 one second after the word turns to a +1 (99.6 for a +2), and the window grows without
 * bound over their tenure. Refreshing the anchor on any read older than the granularity holds that
 * to one granularity of drift instead.
 *
 * Bounded, not eliminated: alignment settles only on the Bar read path (`routes/bar.ts`), so the
 * misattributed window is the gap between two reads. Closing it entirely means recording the word
 * an officer was drifting under and settling when *it* changes, which is a schema change.
 *
 * A base with no officers still never touches the database, and settling the same roster twice
 * inside the granularity is still one write.
 */
export function settleOfficerAlignment(repos: Repositories, base: Base, now: Date): Base {
  const stale = base.commanders.some(
    (officer) =>
      now.getTime() - new Date(officer.alignmentUpdatedAt).getTime() >= ALIGNMENT_ANCHOR_MAX_AGE_MS,
  );
  if (!stale) return base;

  // §F2: Communication, Empathy and Authority slow a walkout. Read off the crew as it stands,
  // which includes the officer doing the drifting: a room that talks to each other holds together.
  const hold = crewEffectsFor(repos, base).alignmentHoldPercent;
  const settled = base.commanders.map((officer) => ({
    ...officer,
    alignment: alignmentAt(officer, base.economy.payroll.commitments[officer.id] ?? 0, now, hold),
    alignmentUpdatedAt: now.toISOString(),
  }));

  repos.bases.updateCommanders(base.id, settled);
  return { ...base, commanders: settled };
}
