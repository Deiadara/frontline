import { randomUUID } from 'node:crypto';
import { tallyScoutingRun } from '../feats/tally.js';
import {
  SCOUTING_RESEARCH_ID,
  findDistrict,
  officerBattleStats,
  scoutRecallable,
  scoutRecalledReturnsAt,
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
 * Sending somebody to look at a district, and having them come back (§A4, maintainer rework).
 *
 * The old scout was `markScouted` on a button press. What replaced it is the smallest journey the
 * game has: one officer, out and back, no units and no fight. See the note in
 * `shared/scouting/scouting.ts` for why it cannot fail and why the time is priced the way it is.
 *
 * ## Who goes
 *
 * Nobody, since 2026-09-22. A run is a **scout party**: the Master of Whispers' people, sent from
 * their chair, which has to be filled and has to have finished its first rung (`SCOUTING_RESEARCH_ID`).
 * The clock is priced off their sheet exactly as it was priced off the Scout's, but the officer
 * never leaves and is never held; the Scout's chair itself is gone. That makes the Master of
 * Whispers the early hire that opens the map, which is what the maintainer asked the chair to be.
 */

const MINUTE_MS = 60_000;

export interface ScoutPlan {
  officer: Commander;
  minutes: number;
  /** The walk out on its own: frozen onto the run, because a recall is measured against it. */
  travelMinutes: number;
  returnsAt: Date;
}

/**
 * Whose sheet a party is priced off, and whether one can go at all (2026-09-22).
 *
 * The Master of Whispers, seated, with the first rung of their track finished. Nobody walks: the
 * party is the chair's people, so the officer is not held and not written onto the run, but the
 * clock is read off their sheet exactly as it was read off the Scout's. A crew with nobody in the
 * chair, or with the chair filled and the rung unresearched, is told which of the two it is.
 */
export function scoutParty(base: Base): Commander | undefined {
  return base.commanders.find((officer) => officer.role === 'master_of_whispers');
}

export function scoutBlocker(
  base: Base,
): Extract<ScoutRefusal, 'no_whispers' | 'not_researched'> | null {
  if (scoutParty(base) === undefined) return 'no_whispers';
  if (!base.research.technologies.includes(SCOUTING_RESEARCH_ID)) return 'not_researched';
  return null;
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
  /*
   * The same arithmetic a column reads, so a Rail Yard shortens a scouting run exactly as much as
   * it shortens a march. One map, one clock.
   *
   * A scouting run is a column of one, so the pace is the officer's own speed off their sheet
   * rather than the crew's ordinary walking pace of nothing: sending the Head of Finance to case
   * the Undergrid is a slow night, and sending somebody quick is not. The ground's reduction
   * stacks on top of that, the way it does for a march.
   */
  const speed = officerBattleStats(officer.attributes).speed;
  const effects = standingEffectsFor(repos, base);
  const travelMinutes = travelMinutesBetween(from, to, {
    speed,
    reductionPercent: effects.travelSpeedPercent,
    flatMinutesOff: effects.roadMinutesOff,
  });
  const minutes = scoutRunMinutes(travelMinutes, officer.attributes);
  return {
    officer,
    minutes,
    travelMinutes,
    returnsAt: new Date(now.getTime() + minutes * MINUTE_MS),
  };
}

export type SendScoutResult =
  | {
      kind: 'refused';
      reason: ScoutRefusal;
      /**
       * The refusal in this officer's own case, where there is one worth saying.
       *
       * `officer_busy` covers three different jobs and a fixed "they are already out" told a
       * player nothing about which of them to go and undo. When the hold is known the route says
       * it in the same words the launch and the fight use (`LEADER_HOLD_MESSAGES`), so one person
       * held one way reads the same at every door.
       */
      message?: string;
    }
  | { kind: 'sent'; run: ScoutingRun; plan: ScoutPlan };

/**
 * Puts an officer on the road.
 *
 * One run at a time per crew, which is the rule that gives the fog its shape: a player with three
 * districts to open has to choose an order, and the order is a real decision because the far one
 * costs most of an evening.
 */
export function sendScout(
  repos: Repositories,
  input: { base: Base; districtId: string; now: Date },
): SendScoutResult {
  const { base, districtId, now } = input;

  if (districtId === base.districtId) return { kind: 'refused', reason: 'own_district' };
  if (repos.city.scouted(base.id).has(districtId)) {
    return { kind: 'refused', reason: 'already_scouted' };
  }
  /*
   * One party out, plus whatever the crew's holdings buy (`scout_parties` in `city/locations.ts`).
   *
   * The limit is a count of officers on the road rather than a price, which is what made it worth a
   * rule: a crew that has taken the ground for it answers two questions tonight instead of one, and
   * the one-job rule below still stops the same officer being in both parties.
   */
  const parties = 1 + Math.max(0, standingEffectsFor(repos, base).scoutPartiesFlat);
  if (repos.scouting.activeFor(base.id).length >= parties) {
    return { kind: 'refused', reason: 'already_out' };
  }

  const blocked = scoutBlocker(base);
  if (blocked !== null) return { kind: 'refused', reason: blocked };
  const whispers = scoutParty(base)!;
  // No duty check and no hold: the officer stays in the chair. See `scoutParty`.
  const plan = planScout(repos, base, districtId, whispers, now);
  if (!plan) return { kind: 'refused', reason: 'no_whispers' };

  const run: ScoutingRun = {
    id: randomUUID(),
    baseId: base.id,
    districtId,
    officerId: null,
    departedAt: now.toISOString(),
    returnsAt: plan.returnsAt.toISOString(),
    // The leg the recall window is measured against, frozen here with the mark.
    travelMinutes: plan.travelMinutes,
    recalledAt: null,
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
export type RecallScoutResult =
  | { kind: 'refused'; reason: 'nobody_out' | 'window_closed' }
  | { kind: 'recalled'; run: ScoutingRun };

/**
 * Turn the scout round (maintainer request, 2026-09-12; `time/cancel.ts`): inside the first tenth of
 * the way out. They walk home the distance they have covered, and the ground does not open.
 */
export function recallScout(repos: Repositories, base: Base, now: Date): RecallScoutResult {
  const run = repos.scouting.activeFor(base.id).find((active) => active.recalledAt === null);
  if (!run) return { kind: 'refused', reason: 'nobody_out' };
  if (!scoutRecallable(run, now)) return { kind: 'refused', reason: 'window_closed' };
  const returnsAt = scoutRecalledReturnsAt(run, now).toISOString();
  repos.scouting.markRecalled(run.id, now.toISOString(), returnsAt);
  return { kind: 'recalled', run: { ...run, recalledAt: now.toISOString(), returnsAt } };
}

export function settleScouting(repos: Repositories, now: Date): number {
  const due = repos.scouting.due(now.toISOString());
  for (const run of due) {
    // A scout turned round never got there: they are home, and the ground stays shut.
    if (run.recalledAt !== null) {
      repos.scouting.markSettled(run.id, now.toISOString());
      continue;
    }
    // The ground is open from the moment they are home, and the run is marked in the same breath:
    // `due` filters on `settled_at`, so a second pass finds nothing and cannot open it twice.
    repos.city.markScouted(run.baseId, run.districtId, now.toISOString());
    repos.scouting.markSettled(run.id, now.toISOString());
    // Feats: a run that got there and opened the ground. A recall is handled above and is
    // deliberately not counted: the ladder is about the ground seen, not about the officer sent.
    tallyScoutingRun(repos, run.baseId);
    notifyBase(repos, run.baseId, {
      kind: 'scout_home',
      title: 'Your scout party is back',
      body: `${findDistrict(run.districtId)?.name ?? run.districtId} is on your map.`,
      // The district itself: `/game/city` matches no route and fell through to the map.
      link: `/game/city/${run.districtId}`,
      subjectId: run.districtId,
      now,
    });
  }
  return due.length;
}
