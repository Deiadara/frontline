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

/**
 * The §H5 alignment meter, kept current.
 *
 * Like payroll (§H7) and the §D8 reputation drift, alignment settles on the real-world clock and
 * is therefore applied lazily on the read path rather than from a scheduler — an officer who was
 * left alone for a week has drifted exactly as far as one who was watched the whole time.
 */

function clampAlignment(value: number): number {
  return Math.min(ALIGNMENT_MAX, Math.max(ALIGNMENT_MIN, value));
}

/**
 * §H5 — where one officer's opinion of the crew has got to by `now`.
 *
 * What they are drifting *towards* is what they make of your reputation word (§H4), so a crew
 * whose reputation turns hostile to a given officer's ambitions watches that officer's alignment
 * fall from wherever it stood — and, past §H5's threshold, start threatening to leave.
 */
export function alignmentAt(officer: Commander, reputation: ReputationLabel, now: Date): number {
  const target = alignmentTarget(reputationStance(officer, reputation));
  const elapsed = now.getTime() - new Date(officer.alignmentUpdatedAt).getTime();
  return clampAlignment(settleAlignment(officer.alignment, target, elapsed));
}

/**
 * Settles every officer on the base and persists the result when anything actually moved.
 *
 * The write is skipped for an unchanged roster so that opening the Bar twice in a second is not
 * two writes, and so a base with no officers never touches the database at all.
 */
export function settleOfficerAlignment(repos: Repositories, base: Base, now: Date): Base {
  const reputation = reputationOf(base.economy, now);
  const settled = base.commanders.map((officer) => ({
    ...officer,
    alignment: alignmentAt(officer, reputation, now),
    alignmentUpdatedAt: now.toISOString(),
  }));

  const moved = settled.some(
    (officer, index) => officer.alignment !== base.commanders[index]?.alignment,
  );
  if (!moved) return base;

  repos.bases.updateCommanders(base.id, settled);
  return { ...base, commanders: settled };
}
