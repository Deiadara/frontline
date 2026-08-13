import {
  MISSION_MORALE_DELTA,
  addResources,
  adjustMeter,
  findMissionTemplate,
  isMissionDue,
  missionRewards,
  missionTimings,
  type Base,
  type LevelUp,
  type Mission,
  type MissionOutcome,
} from '@frontline/shared';
import { createRng } from '../characters/rng.js';
import type { Repositories } from '../db/repos/index.js';
import type { StoredMission } from '../db/repos/missions.js';
import { awardPlayerXp, levelUpFrom } from '../progression/award.js';

/**
 * The roll, taken from the seed frozen at launch.
 *
 * This is the whole authoritative-timer argument in one line: the outcome is a pure function of
 * the stored row, so it does not matter *when* the server gets around to asking. A player who
 * closes the tab, sleeps the machine for a week and comes back gets the same answer they would
 * have got watching the countdown tick to zero.
 */
export function rollMissionOutcome(stored: StoredMission): MissionOutcome {
  return createRng(stored.seed)() < stored.successChance ? 'success' : 'failure';
}

export interface MissionSettlement {
  base: Base;
  /** The missions that came home on this call, in launch order. */
  resolved: Mission[];
  /**
   * Set when the awards *this call* banked crossed a level, so whichever route settled them can
   * announce it (MOU-227). Aggregated across the crews, never one of them.
   */
  levelUp?: LevelUp | undefined;
}

/**
 * Banks every mission whose clock has run out since the base was last read (GDD §E2, §E5).
 *
 * Mission timers run on the real-world clock, so like payroll (`economy/settle.ts`) they settle
 * lazily on the read paths rather than from a scheduler: there is no background job to keep
 * alive, and a base nobody looks at owes exactly the same payout whenever it is next opened.
 * Writes only happen when a mission actually came home.
 */
export function resolveDueMissions(repos: Repositories, base: Base, now: Date): MissionSettlement {
  const due = repos.missions
    .listActiveByBaseId(base.id)
    .filter((stored) => isMissionDue(stored.mission, now));
  if (due.length === 0) return { base, resolved: [] };

  const resolvedAt = now.toISOString();
  const settlements = due.map((stored) => {
    const outcome = rollMissionOutcome(stored);
    // A template retired from the board after this run launched: bring the crew home empty
    // rather than stranding them on the timers page forever.
    const template = findMissionTemplate(stored.mission.templateId);
    // Priced off the clock frozen on the row, not the template's current timings: a retune that
    // lands mid-flight must not re-price a crew that is already out.
    const rewards = template
      ? missionRewards(template, outcome, missionTimings(stored.mission).totalMinutes)
      : {};
    return {
      mission: {
        ...stored.mission,
        status: 'resolved',
        outcome,
        rewards,
        resolvedAt,
      } satisfies Mission,
      outcome,
      rewards,
      moraleDelta: template ? MISSION_MORALE_DELTA[template.kind][outcome] : 0,
    };
  });

  // Missions are closed out before the payout lands on purpose. Both writes are synchronous and
  // only a real sqlite failure can split them, but if one does, the failure mode that leaves a
  // player short is far better than the one that pays every mission twice on the next read.
  for (const { mission, outcome, rewards } of settlements) {
    repos.missions.markResolved(mission.id, { outcome, rewards, resolvedAt });
  }

  const settled: Base = {
    ...base,
    resources: settlements.reduce((acc, s) => addResources(acc, s.rewards), base.resources),
    economy: {
      ...base.economy,
      morale: settlements.reduce((acc, s) => adjustMeter(acc, s.moraleDelta), base.economy.morale),
    },
  };
  repos.bases.updateResources(settled.id, settled.resources);
  repos.bases.updateEconomy(settled.id, settled.economy);

  // INTERFACES R7 — §I1 makes a mission completing an XP source. W6 owns the whole XP side, so this
  // only names what happened: one award per crew that came home, success or failure, priced by
  // `PLAYER_XP_AWARDS` and levelled by W6's engine. Threaded through `awardPlayerXp` so a
  // multi-mission settlement banks every award and the base handed back carries the level it
  // ended on, rather than a pre-award copy the caller would then serve as current.
  //
  // The awards are kept, not just the base, because several of them are one announcement: two crews
  // that cross two thresholds owe the player `levelsGained: 2`, not the last award's 1.
  let progressed = settled;
  const awards = settlements.map(() => {
    const awarded = awardPlayerXp(repos, progressed, 'missionCompleted');
    progressed = awarded.base;
    return awarded.award;
  });

  return {
    base: progressed,
    resolved: settlements.map((s) => s.mission),
    levelUp: levelUpFrom(awards),
  };
}
