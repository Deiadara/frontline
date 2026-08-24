import {
  gainInfamy,
  MISSION_INFAMY_DELTA,
  MISSION_MORALE_DELTA,
  addResources,
  adjustMeter,
  findMissionTemplate,
  isMissionDue,
  missionRewards,
  missionTimings,
  recordMissionOutcome,
  type Base,
  type LevelUp,
  type Mission,
  type MissionOutcome,
  type ReputationTally,
  addItems,
  rollSalvage,
} from '@frontline/shared';
import { awardCharacterXp } from '../characters/award.js';
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
    /*
     * A recalled crew never reached the site.
     *
     * So there is no roll to make and nothing to pay: they turned around somewhere on the road and
     * walked back. It settles as a failure rather than as a third outcome, because everything
     * downstream, morale, infamy, the §D8 tally, the officer's XP, already knows what to do with
     * a failure, and "went out, achieved nothing, came home" is what a failure *is*. What it is
     * not is a way to dodge the consequences of having gone.
     */
    const recalled = stored.mission.recalledAt !== null;
    const outcome = recalled ? ('failure' as const) : rollMissionOutcome(stored);
    // A template retired from the board after this run launched: bring the crew home empty
    // rather than stranding them on the timers page forever.
    const template = findMissionTemplate(stored.mission.templateId);
    // Priced off the clock frozen on the row, not the template's current timings: a retune that
    // lands mid-flight must not re-price a crew that is already out.
    const rewards =
      template && !recalled
        ? missionRewards(template, outcome, missionTimings(stored.mission).totalMinutes)
        : {};

    /*
     * What they found, as opposed to what they were paid.
     *
     * Drawn from the *same* seed the outcome came from, one draw further along the stream, so a
     * mission's finds are as reproducible as whether it worked: two reads of the same finished
     * run cannot disagree about what is in the satchel. A recalled crew found nothing, because
     * they never got anywhere.
     */
    const rng = createRng(stored.seed);
    rng(); // The outcome's own draw, consumed so the finds do not reuse it.
    const found = recalled
      ? {}
      : rollSalvage(missionTimings(stored.mission).totalMinutes, outcome === 'success', rng);
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
      found,
      moraleDelta: template ? MISSION_MORALE_DELTA[template.kind][outcome] : 0,
      // §D7/§A3: a blow that lands on the state is heard on the street. Keyed off the same
      // retired-template fallback as the rest: a run whose template is gone comes home silent.
      infamyDelta: template ? MISSION_INFAMY_DELTA[template.stance][outcome] : 0,
      // §A3/§D8, which way the job pointed at the Combine. A run whose template has since been
      // retired comes home politically silent for the same reason it comes home empty: there is
      // nothing left on the board to say what it was.
      stance: template?.stance ?? 'unaligned',
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
    // What they found goes into the satchel alongside the pay. Folded across every crew that came
    // home on this call, so two runs that both turned up a servo hand over two.
    inventory: settlements.reduce((held, s) => addItems(held, s.found), base.inventory),
    economy: {
      ...base.economy,
      morale: settlements.reduce((acc, s) => adjustMeter(acc, s.moraleDelta), base.economy.morale),
      // §D7: through `gainInfamy`, the same seam the battle settler banks through.
      //
      // It was `adjustMeter`, left over from when infamy was a 0..100 meter, and that clamped it at
      // a hundred: a crew already at the old ceiling banked *nothing* from a mission, silently, and
      // the loop the board rebuilt the whole mechanic for stopped paying out on the one screen that
      // runs every day. Nothing but spending takes a name back, which is why a negative delta is
      // worth zero rather than a deduction.
      infamy: settlements.reduce((acc, s) => gainInfamy(acc, s.infamyDelta), base.economy.infamy),
      // §D8: missions are the second live writer of the one reputation tally (the first is
      // POST /battle). Folded in launch order through the shared recorder so the §D8 drift is
      // applied exactly once, by the same function, however many crews came home on this call.
      reputationTally: settlements.reduce<ReputationTally>(
        (tally, s) => recordMissionOutcome(tally, s.stance, s.outcome, now),
        base.economy.reputationTally,
      ),
    },
  };
  // Stockpile and satchel in one statement, because a mission pays into both and a crash between
  // two writes would bank the caps and lose the parts.
  repos.bases.updateHoldings(settled.id, settled.resources, settled.inventory);
  repos.bases.updateEconomy(settled.id, settled.economy);

  // INTERFACES R7: §I1 makes a mission completing an XP source. W6 owns the whole XP side, so this
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

  // INTERFACES R2: §H6 pays the *officer* who led each run, for the time it kept them engaged.
  // Priced off the clock frozen on the row, like the rewards above, so a retune cannot re-pay a
  // character for a run that has already happened. Folded in one call because two runs led by the
  // same officer are one sheet, and paying them separately would drop a level between the two.
  progressed = awardCharacterXp(
    repos,
    progressed,
    settlements.map((s) => ({
      officerId: s.mission.officerId,
      minutesEngaged: missionTimings(s.mission).totalMinutes,
    })),
  );

  return {
    base: progressed,
    resolved: settlements.map((s) => s.mission),
    levelUp: levelUpFrom(awards),
  };
}
