import {
  mergeFleets,
  gainInfamy,
  MISSION_INFAMY_DELTA,
  FAILED_MISSION_XP_SHARE,
  PLAYER_XP_AWARDS,
  RESOURCE_KG,
  carriedHome,
  missionCarry,
  scaledSpoils,
  addResources,
  findMissionTemplate,
  isMissionDue,
  missionRewards,
  missionTimings,
  type Base,
  type LevelUp,
  type Mission,
  type MissionOutcome,
  addItems,
  rollSalvage,
} from '@frontline/shared';
import { mergeArmies } from '../battle/forces.js';
import { createRng } from '../characters/rng.js';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';
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
    /*
     * Paid, then loaded onto the crew that went (§E, §A5).
     *
     * Three things in order, and the order matters. The template's own mix is scaled by the clock
     * frozen on the row; the ground's premium goes on top of it, so a job in a hard district is
     * worth more than the same job in an easy one; and then the whole thing is trimmed to what the
     * crew can physically lift. That last step is the reason the support tier exists: send two
     * Razors after a Refinery Assault's alloy and most of it stays on the floor.
     */
    // Priced off the premium frozen on the row, not off today's: a crew already out keeps the
    // terms it went under, and a level gained mid-flight cannot re-price it either way.
    //
    // A failure pays nothing, and that is `FAILURE_REWARD_SHARE`'s business rather than a second
    // condition here: `missionRewards` already returns an empty bundle for one, and a guard on
    // `outcome` beside it would be the same rule written twice and free to drift.
    const paid =
      template && !recalled
        ? scaledSpoils(
            missionRewards(template, outcome, missionTimings(stored.mission).totalMinutes),
            stored.mission.payPercent,
          )
        : {};
    const rewards = carriedHome(paid, missionCarry(stored.mission.force), RESOURCE_KG);

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
        spoils: paid,
        resolvedAt,
      } satisfies Mission,
      outcome,
      rewards,
      spoils: paid,
      found,
      // §D7/§A3: a blow that lands on the state is heard on the street. Keyed off the same
      // retired-template fallback as the rest: a run whose template is gone comes home silent.
      infamyDelta: template ? MISSION_INFAMY_DELTA[template.stance][outcome] : 0,
      /*
       * And the people walk back through the gate (§A5).
       *
       * Everyone, whatever happened out there. A mission is not a battle and does not resolve as
       * one: what a failed run costs is the clock and the pay, not the crew. Losing units on a
       * failed battle mission would need the engine and a garrison to fight, and a mission has
       * neither; the risk §E5 prices is the empty bag.
       */
      returning: stored.mission.force,
      /*
       * §C3: and so do the machines, every time.
       *
       * A vehicle is destroyed when everybody riding it dies, and nobody dies on a mission (see
       * the note just above): what a failed run costs is the clock and the pay. So the yard gets
       * them back on a clean run and on a disaster alike, and a recalled crew brings them home
       * having never reached the site.
       */
      returningVehicles: stored.mission.vehicles,
      /*
       * §I1: what the crew learned out there.
       *
       * A clean run pays the figure the card quoted; one that came home empty pays
       * `FAILED_MISSION_XP_SHARE` of it, which is the board's rule and the reason a bad day is a
       * setback rather than a wasted one. A retired template pays nothing, like everything else on
       * this row. A recalled crew never reached the site, so it settles as a failure and pays the
       * failure's share.
       */
      xp: Math.round(
        // The figure frozen at launch. A row written before missions priced their own XP carries
        // zero, which falls back to the table entry the settler used to pay.
        (stored.mission.xp > 0 ? stored.mission.xp : PLAYER_XP_AWARDS.missionCompleted) *
          (outcome === 'success' ? 1 : FAILED_MISSION_XP_SHARE),
      ),
    };
  });

  // Missions are closed out before the payout lands on purpose. Both writes are synchronous and
  // only a real sqlite failure can split them, but if one does, the failure mode that leaves a
  // player short is far better than the one that pays every mission twice on the next read.
  for (const { mission, outcome, rewards, spoils } of settlements) {
    repos.missions.markResolved(mission.id, { outcome, rewards, spoils, resolvedAt });
  }

  const settled: Base = {
    ...base,
    army: settlements.reduce((army, s) => mergeArmies(army, s.returning), base.army),
    fleet: settlements.reduce((fleet, s) => mergeFleets(fleet, s.returningVehicles), base.fleet),
    resources: settlements.reduce((acc, s) => addResources(acc, s.rewards), base.resources),
    // What they found goes into the satchel alongside the pay. Folded across every crew that came
    // home on this call, so two runs that both turned up a servo hand over two.
    inventory: settlements.reduce((held, s) => addItems(held, s.found), base.inventory),
    economy: {
      ...base.economy,
      // §D7: through `gainInfamy`, the same seam the battle settler banks through.
      //
      // It was `adjustMeter`, left over from when infamy was a 0..100 meter, and that clamped it at
      // a hundred: a crew already at the old ceiling banked *nothing* from a mission, silently, and
      // the loop the board rebuilt the whole mechanic for stopped paying out on the one screen that
      // runs every day. Nothing but spending takes a name back, which is why a negative delta is
      // worth zero rather than a deduction.
      infamy: settlements.reduce((acc, s) => gainInfamy(acc, s.infamyDelta), base.economy.infamy),
    },
  };
  // Stockpile and satchel in one statement, because a mission pays into both and a crash between
  // two writes would bank the caps and lose the parts.
  repos.bases.updateHoldings(settled.id, settled.resources, settled.inventory);
  repos.bases.updateEconomy(settled.id, settled.economy);
  // The crews are home. Written whenever anything came back, which is every settlement that got
  // this far: a run with an empty force is a pre-areas row and merges to the same army.
  repos.bases.updateArmy(settled.id, settled.army, settled.trainingQueue);
  // And the yard. Separate from the roster because a vehicle is not a unit and lives in its own
  // column; written unconditionally for the same reason the army is, so a run that took nothing
  // writes the fleet back unchanged rather than branching.
  repos.bases.updateFleet(settled.id, settled.fleet);

  // INTERFACES R7: §I1 makes a mission completing an XP source. W6 owns the whole XP side, so this
  // only names what happened: one award per crew that came home, success or failure, priced by
  // `PLAYER_XP_AWARDS` and levelled by W6's engine. Threaded through `awardPlayerXp` so a
  // multi-mission settlement banks every award and the base handed back carries the level it
  // ended on, rather than a pre-award copy the caller would then serve as current.
  //
  // The awards are kept, not just the base, because several of them are one announcement: two crews
  // that cross two thresholds owe the player `levelsGained: 2`, not the last award's 1.
  let progressed = settled;
  const awards = settlements.map((settlement) => {
    // Priced per run rather than off the table: a day-long expedition is worth more than a scrap
    // run, a battle more than a standard job of the same length, and a run that came home empty
    // still pays a fifth. `missionXp` owns all three; this only banks what it said.
    const awarded = awardPlayerXp(repos, progressed, 'missionCompleted', 0, settlement.xp);
    progressed = awarded.base;
    return awarded.award;
  });

  // §H6 used to pay the officer who led each run their own character XP here. Officers have no
  // level any more (see `commander.ts`): a run pays the crew, and who led it decides how well it
  // went rather than what it does to them.
  // The receipts. One per run that landed, so a player who was on another screen finds out that
  // the crew is back and what they brought, rather than noticing the roster changed.
  for (const settled of settlements) {
    notifyBase(repos, base.id, {
      kind: 'mission_home',
      title: 'A crew is home',
      body: findMissionTemplate(settled.mission.templateId)?.name ?? 'The job is finished.',
      link: '/game/missions',
      subjectId: settled.mission.id,
      now,
    });
  }

  return {
    base: progressed,
    resolved: settlements.map((s) => s.mission),
    levelUp: levelUpFrom(awards),
  };
}
