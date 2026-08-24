import {
  ALIGNMENT_MAX,
  ALIGNMENT_MIN,
  alignmentTarget,
  reputationStance,
  reputationOf,
  settleAlignment,
  type Base,
  type Commander,
  type ReputationLabel,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { crewEffectsFor } from '../crew/standing.js';

/**
 * The §H5 alignment meter, kept current.
 *
 * Like payroll (§H7) and the §D8 reputation drift, alignment settles on the real-world clock and
 * is therefore applied lazily on the read path rather than from a scheduler: under an unchanging
 * reputation word an officer who was left alone for a week has drifted exactly as far as one who
 * was watched the whole time, because the decay composes over any split of the interval. Across a
 * *change* of word it is the anchor that decides which stance the elapsed time is credited to;
 * `ALIGNMENT_ANCHOR_MAX_AGE_MS` below is what keeps that honest.
 */

function clampAlignment(value: number): number {
  return Math.min(ALIGNMENT_MAX, Math.max(ALIGNMENT_MIN, value));
}

/**
 * §H5: where one officer's opinion of the crew has got to by `now`.
 *
 * What they are drifting *towards* is what they make of your reputation word (§H4), so a crew
 * whose reputation turns hostile to a given officer's ambitions watches that officer's alignment
 * fall from wherever it stood, and, past §H5's threshold, start threatening to leave.
 */
export function alignmentAt(
  officer: Commander,
  reputation: ReputationLabel,
  now: Date,
  holdPercent = 0,
): number {
  const target = alignmentTarget(reputationStance(officer, reputation));
  const elapsed = now.getTime() - new Date(officer.alignmentUpdatedAt).getTime();
  return clampAlignment(settleAlignment(officer.alignment, target, elapsed, holdPercent));
}

/**
 * How stale an officer's alignment anchor may get before a read is worth a write.
 *
 * Sizing it: a meter can be the whole `ALIGNMENT_MIN`..`ALIGNMENT_MAX` range from its target: an
 * officer who has settled near 0 under a word their disposition hates, the moment that word turns
 * to one it loves, and over a minute of a three-day half-life that is 0.016 alignment points, two
 * orders below the meter's own rounding. So the granularity costs nothing a player can see and
 * buys one write per minute per roster. What it does *not* bound is the misattribution below: that
 * window is the gap between two Bar reads, which this constant does not cap.
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
  const reputation = reputationOf(base.economy, now);
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
    alignment: alignmentAt(officer, reputation, now, hold),
    alignmentUpdatedAt: now.toISOString(),
  }));

  repos.bases.updateCommanders(base.id, settled);
  return { ...base, commanders: settled };
}
