import {
  MISSION_MORALE_DELTA,
  addResources,
  adjustMeter,
  findMissionTemplate,
  isMissionDue,
  missionRewards,
  type Base,
  type Mission,
  type MissionOutcome,
} from '@frontline/shared';
import { createRng } from '../characters/rng.js';
import type { Repositories } from '../db/repos/index.js';
import type { StoredMission } from '../db/repos/missions.js';

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
    const rewards = template ? missionRewards(template, outcome) : {};
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
  return { base: settled, resolved: settlements.map((s) => s.mission) };
}
