import { randomUUID } from 'node:crypto';
import {
  findDistrict,
  scoutMinutesFor,
  scoutRunMinutes,
  travelMinutesBetween,
  type Base,
  type Commander,
  type ScoutRefusal,
  type ScoutingRun,
} from '@frontline/shared';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';

/**
 * Sending somebody to look at a district, and having them come back (§A4, board rework).
 *
 * The old scout was `markScouted` on a button press. What replaced it is the smallest journey the
 * game has: one officer, out and back, no units and no fight. See the note in
 * `shared/scouting/scouting.ts` for why it cannot fail and why the time is priced the way it is.
 *
 * ## Who goes
 *
 * The officer in the **Scout's chair** by default, because that is what the chair is for. Any
 * officer may be sent, and a crew that has not filled the chair is meant to feel that in the
 * clock rather than be refused: sending the Finance Officer to case the Undergrid is a slow night,
 * not an impossible one.
 */

const MINUTE_MS = 60_000;

export interface ScoutPlan {
  officer: Commander;
  minutes: number;
  returnsAt: Date;
}

/**
 * Who the crew would send, given a choice and no instruction.
 *
 * The Scout if there is one, then whoever reads the ground fastest. Falling back to the best sheet
 * rather than to the first name on the roster matters: an accidental default that sends the worst
 * person on the books is a trap, and the player who has not thought about it is exactly the one
 * this decides for.
 */
export function defaultScout(base: Base): Commander | undefined {
  const seated = base.commanders.find((officer) => officer.role === 'scout');
  if (seated) return seated;
  // Fewest minutes on the ground first, ties by id so the answer never depends on roster order.
  return [...base.commanders].sort(
    (a, b) =>
      scoutMinutesFor(a.attributes) - scoutMinutesFor(b.attributes) || a.id.localeCompare(b.id),
  )[0];
}

/** What a run to `districtId` would cost this crew with this officer, before it is committed to. */
export function planScout(
  repos: Repositories,
  base: Base,
  districtId: string,
  officer: Commander,
  now: Date,
): ScoutPlan | null {
  const from = findDistrict(base.districtId);
  const to = findDistrict(districtId);
  if (!from || !to) return null;
  // The same travel channel a column reads, so a Rail Yard shortens a scouting run exactly as much
  // as it shortens a march. One map, one clock.
  const speed = standingEffectsFor(repos, base).travelSpeedPercent;
  const minutes = scoutRunMinutes(travelMinutesBetween(from, to, speed), officer.attributes);
  return { officer, minutes, returnsAt: new Date(now.getTime() + minutes * MINUTE_MS) };
}

export type SendScoutResult =
  { kind: 'refused'; reason: ScoutRefusal } | { kind: 'sent'; run: ScoutingRun; plan: ScoutPlan };

/**
 * Puts an officer on the road.
 *
 * One run at a time per crew, which is the rule that gives the fog its shape: a player with three
 * districts to open has to choose an order, and the order is a real decision because the far one
 * costs most of an evening.
 */
export function sendScout(
  repos: Repositories,
  input: { base: Base; districtId: string; officerId?: string; now: Date },
): SendScoutResult {
  const { base, districtId, now } = input;

  if (districtId === base.districtId) return { kind: 'refused', reason: 'own_district' };
  if (repos.city.scouted(base.id).has(districtId)) {
    return { kind: 'refused', reason: 'already_scouted' };
  }
  if (repos.scouting.activeFor(base.id).length > 0) {
    return { kind: 'refused', reason: 'already_out' };
  }

  const officer =
    input.officerId === undefined
      ? defaultScout(base)
      : base.commanders.find((held) => held.id === input.officerId);
  if (!officer) return { kind: 'refused', reason: 'no_officer' };

  const plan = planScout(repos, base, districtId, officer, now);
  if (!plan) return { kind: 'refused', reason: 'no_officer' };

  const run: ScoutingRun = {
    id: randomUUID(),
    baseId: base.id,
    districtId,
    officerId: officer.id,
    departedAt: now.toISOString(),
    returnsAt: plan.returnsAt.toISOString(),
  };
  repos.scouting.insert(run);
  return { kind: 'sent', run, plan };
}

/**
 * Brings home every scout whose run has ended, wherever they are.
 *
 * Global rather than per crew, and driven by the world clock, for the reason `live/clock.ts` gives
 * about missions: what a finished run *writes* is a receipt, and a receipt is only worth having
 * when it arrives. A player who sent somebody out at nine and closed the tab should find the
 * ground open and the bell rung, not find both the moment they next open the city screen.
 */
export function settleScouting(repos: Repositories, now: Date): number {
  const due = repos.scouting.due(now.toISOString());
  for (const run of due) {
    // The ground is open from the moment they are home, and the run is marked in the same breath:
    // `due` filters on `settled_at`, so a second pass finds nothing and cannot open it twice.
    repos.city.markScouted(run.baseId, run.districtId, now.toISOString());
    repos.scouting.markSettled(run.id, now.toISOString());
    notifyBase(repos, run.baseId, {
      kind: 'scout_home',
      title: 'Your scout is back',
      body: `${findDistrict(run.districtId)?.name ?? run.districtId} is on your map.`,
      link: '/game/city',
      subjectId: run.districtId,
      now,
    });
  }
  return due.length;
}
