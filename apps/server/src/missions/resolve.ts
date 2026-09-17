import {
  pageWonFrom,
  mergeFleets,
  earnedInfamy,
  gainInfamy,
  missionInfamyForKills,
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
  battleTierFor,
  pricedTotalMinutes,
  type BattleOfficer,
  type Base,
  type Overseer,
  type Mission,
  type MissionOutcome,
  addItems,
  infirmaryRecoveryPercent,
  leading,
  rollSalvage,
} from '@frontline/shared';
import { forceSize, mergeArmies } from '../battle/forces.js';
import { createRng } from '../characters/rng.js';
import { standingEffectsFor } from '../crew/standing.js';
import { overseerOf } from '../crew/training.js';
import { refundFor } from '../battle/resolve.js';
import { fightMissionBattle } from './battle.js';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';
import { tellPagesFound } from '../social/pages.js';
import type { StoredMission } from '../db/repos/missions.js';
import { awardPlayerXp } from '../progression/award.js';
import {
  tallyInfamyEarned,
  tallyMissionHome,
  tallyPagesIn,
  tallyResourcesEarned,
} from '../feats/tally.js';

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

/**
 * §D1: the sheet whoever led the run brings to the fight, or nobody for an unled crew.
 *
 * The engine takes one officer per side and folds their attributes into eleven combat numbers
 * (`battle/officer.ts`), which is exactly what "what the leader is worth" means once a battle job
 * is a real fight. The Overseer reaches it the same way an officer does.
 *
 * What a mission does **not** do is §D4's stretcher: an officer who falls here is not laid up.
 * That roll needs the day's margin and a stream the battle settler owns, and a mission has
 * neither. A leader is out for the length of the run and free the moment the crew is home.
 */
function leaderOf(
  stored: StoredMission,
  base: Base,
  overseer: Overseer | undefined,
): BattleOfficer | undefined {
  if (stored.mission.overseerLed) {
    return overseer
      ? { officerId: overseer.id, name: overseer.name, attributes: overseer.attributes }
      : undefined;
  }
  const officer = base.commanders.find((held) => held.id === stored.mission.officerId);
  return officer
    ? { officerId: officer.id, name: officer.name, attributes: officer.attributes }
    : undefined;
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
  /*
   * What a battle job needs and a scrap run does not, read once for the whole settlement.
   *
   * Both are folds over the crew as it stands now rather than as it stood at launch, and both are
   * behind the `fights` guard because a settlement with no battle in it should not pay for either:
   * `standingEffectsFor` walks every holding and every sheet the crew owns.
   */
  const fights = due.some(
    (stored) =>
      stored.mission.recalledAt === null &&
      findMissionTemplate(stored.mission.templateId)?.kind === 'battle',
  );
  /*
   * The crew's whole book rather than one flag off it.
   *
   * Everything a declared battle reads is on here: the perks, the held ground, cohesion, the marks,
   * the salvage refund, the infamy multiplier and the medicine. A battle job read `anyRide` and
   * nothing else, and fought without any of the rest.
   */
  const crew = fights ? standingEffectsFor(repos, base, now) : null;
  const anyRide = crew?.anyRide ?? false;
  /*
   * ...and the same fold for the bag, which every job needs rather than only the ones that fight.
   *
   * Reused when the battle branch already paid for it, computed here when it did not, so a
   * settlement of three scrap runs walks the holdings once instead of three times or never.
   */
  const crewCarry = crew ?? standingEffectsFor(repos, base, now);
  const overseer = fights ? overseerOf(repos, base) : undefined;

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
    // A template retired from the board after this run launched: bring the crew home empty
    // rather than stranding them on the timers page forever.
    const template = findMissionTemplate(stored.mission.templateId);

    /*
     * A battle job fights instead of rolling (`missions/battle.ts`).
     *
     * The tier is read off the template rather than frozen on the row, which is the one place this
     * departs from the freeze-at-launch rule and does so knowingly: `battleTierFor` is authored
     * content, the row has nowhere to keep it, and a retune that moved a job from a fight to a
     * siege mid-flight is a balance change landing on one crew rather than a re-price of a
     * promise. Same for the level: the figure the tier fields scales on the crew's level, and the
     * crew's level is what it is when the fight happens.
     */
    const tier = recalled || !template ? null : battleTierFor(template);
    const battle =
      template && tier !== null
        ? fightMissionBattle({
            seed: stored.seed,
            jobName: template.name,
            force: stored.mission.force,
            vehicles: stored.mission.vehicles,
            tier,
            level: base.level,
            leader: leaderOf(stored, base, overseer),
            anyRide,
            // The crew's brackets as they stand at the mark, the same read `missionCarry` gets.
            loadouts: base.unitLoadouts,
            ...(crew
              ? {
                  // §D5: `leading()` only when an officer leads, which is the rule the launch and
                  // the leader list already state (`missions/leaders.ts`).
                  territory:
                    !stored.mission.overseerLed && stored.mission.officerId !== null
                      ? leading(crew)
                      : crew,
                  recoveryPercent:
                    crew.casualtyRecoveryPercent + infirmaryRecoveryPercent(base.buildings),
                }
              : {}),
          })
        : null;
    const outcome = recalled
      ? ('failure' as const)
      : (battle?.outcome ?? rollMissionOutcome(stored));
    /*
     * Whether anybody came back to tell it.
     *
     * A crew that was wiped out banks nothing: no pay, no salvage, no page, no XP, and no report.
     * A run that fielded nobody at all is a row written before missions took units, and it reports
     * the way it always did.
     */
    const reported =
      battle === null || forceSize(stored.mission.force) === 0 ? true : forceSize(battle.home) > 0;
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
    //
    // Priced off `pricedTotalMinutes`, which is the card's own clock without the machines: §X4
    // put the figure on the row and froze the XP against it, and this was still reading the
    // *ridden* clock, so a crew that used the Garage came home with about 12% less pay and
    // salvage than the card quoted, which is exactly the bug X4 was written to close.
    const pricedMinutes = pricedTotalMinutes(stored.mission);
    const paid =
      template && !recalled && reported
        ? scaledSpoils(missionRewards(template, outcome, pricedMinutes), stored.mission.payPercent)
        : {};
    // Off the crew's loadouts as they stand at the mark, the same way the roster folds them.
    const rewards = carriedHome(
      paid,
      missionCarry(
        stored.mission.force,
        base.unitLoadouts,
        // §A4: the Pawn Shop, the raid modifications and `sig_scavenger_king` all pay into the same
        // channel, and it reached the raid path only. A crew that bought a bigger bag carried the
        // catalogue figure home off every job they ran.
        crewCarry?.lootCapacityPercent ?? 0,
        crewCarry ?? undefined,
      ),
      RESOURCE_KG,
    );

    /*
     * What they found, as opposed to what they were paid.
     *
     * Drawn from the *same* seed the outcome came from, one draw further along the stream, so a
     * mission's finds are as reproducible as whether it worked: two reads of the same finished
     * run cannot disagree about what is in the inventory. A recalled crew found nothing, because
     * they never got anywhere.
     */
    const rng = createRng(stored.seed);
    rng(); // The outcome's own draw, consumed so the finds do not reuse it.
    const found =
      recalled || !reported ? {} : rollSalvage(pricedMinutes, outcome === 'success', rng);
    /*
     * §F1e/§F1f: the page, decided on arrival rather than when the card was drawn.
     *
     * Only a run that was carrying one and actually worked. Which page it is comes off the
     * mission's own seed, so two reads of a finished run cannot disagree about what is in the
     * inventory, and a card that promised "a Unit Blueprint's Page" cannot be read to predict which.
     * Duplicates are deliberate (§F1d): a spare page is what Reimagining spends.
     */
    const pageWon =
      stored.mission.pagePrize !== null && outcome === 'success' && !recalled && reported
        ? pageWonFrom(stored.mission.pagePrize, stored.seed)
        : null;

    return {
      mission: {
        ...stored.mission,
        status: 'resolved',
        outcome,
        rewards,
        spoils: paid,
        resolvedAt,
        pageWon,
        lost: battle?.lost ?? {},
        reported,
        // What they turned up, named by the report rather than only added to the inventory.
        found: pageWon === null ? found : { ...found, [pageWon]: (found[pageWon] ?? 0) + 1 },
      } satisfies Mission,
      outcome,
      rewards,
      spoils: paid,
      found: pageWon === null ? found : { ...found, [pageWon]: (found[pageWon] ?? 0) + 1 },
      /*
       * §D7: a battle job pays for what it killed, half a point a unit slot rounded up, won or
       * lost; standard work pays the table, which is nothing. Keyed off the same retired-template
       * fallback as the rest, and off `reported`: a crew nobody came home from banks nothing,
       * the name included, because there is nobody left to tell the street what they did.
       */
      /*
       * ...scaled by `infamyGainPercent`, whose own line is "a percentage more infamy off
       * everything that earns any" (§D8). It reached the declared-battle settler and not this one,
       * so the Graveyard and `sig_name_maker` paid on a raid and nothing on a job.
       */
      infamyDelta:
        template && reported
          ? Math.round(
              earnedInfamy(
                MISSION_INFAMY_DELTA[template.kind][outcome] +
                  (battle ? missionInfamyForKills(battle.killed) : 0),
                crew?.infamyGainPercent ?? 0,
              ),
            )
          : 0,
      /*
       * And the people walk back through the gate (§A5).
       *
       * Everyone, on a standard run: what a failed scrap run costs is the clock and the pay, not
       * the crew. A battle job is the exception the board added on 2026-09-10, and it is the whole
       * of §E5's "risks your people": whoever the engine did not kill comes home, including
       * everybody who broke and ran, because nothing pursues them.
       */
      returning: battle?.home ?? stored.mission.force,
      /*
       * §A4: the Bone Market pays for the people who did not come back, off a job as well as a raid.
       *
       * `salvageRefundPercent` reached the declared-battle settler only, so a crew holding the one
       * location whose whole line is "what you lose in a fight comes back as caps" got nothing for
       * the losses on the one mission kind that has any. Empty when the crew holds no refund, which
       * is the common case and costs nothing.
       */
      refund: battle ? refundFor(battle.lost, crew?.salvageRefundPercent ?? 0) : {},
      /*
       * §C3: and so do the machines, every time.
       *
       * A vehicle is destroyed when everybody riding it dies, which on a standard run is nobody:
       * what a failed scrap run costs is the clock and the pay, so the yard gets them all back on
       * a clean run and on a disaster alike, and a recalled crew brings them home having never
       * reached the site. A battle job settles them the way the battle settler does.
       */
      returningVehicles: battle?.vehicles ?? stored.mission.vehicles,
      /*
       * §I1: what the crew learned out there.
       *
       * A clean run pays the figure the card quoted; one that came home empty pays
       * `FAILED_MISSION_XP_SHARE` of it, which is the maintainer's rule and the reason a bad day is a
       * setback rather than a wasted one. A retired template pays nothing, like everything else on
       * this row. A recalled crew never reached the site, so it settles as a failure and pays the
       * failure's share.
       */
      xp: reported
        ? Math.round(
            // The figure frozen at launch. A row written before missions priced their own XP
            // carries zero, which falls back to the table entry the settler used to pay.
            (stored.mission.xp > 0 ? stored.mission.xp : PLAYER_XP_AWARDS.missionCompleted) *
              (outcome === 'success' ? 1 : FAILED_MISSION_XP_SHARE),
          )
        : 0,
    };
  });

  // Missions are closed out before the payout lands on purpose. Both writes are synchronous and
  // only a real sqlite failure can split them, but if one does, the failure mode that leaves a
  // player short is far better than the one that pays every mission twice on the next read.
  for (const { mission, outcome, rewards, spoils } of settlements) {
    repos.missions.markResolved(mission.id, {
      outcome,
      rewards,
      spoils,
      resolvedAt,
      pageWon: mission.pageWon,
      found: mission.found,
      // Both only ever move on a battle job, and both have to survive the read: `lost` is what the
      // report draws the casualty list from, and `reported` is why there is no report to draw.
      lost: mission.lost,
      reported: mission.reported,
    });
  }

  const settled: Base = {
    ...base,
    army: settlements.reduce((army, s) => mergeArmies(army, s.returning), base.army),
    fleet: settlements.reduce((fleet, s) => mergeFleets(fleet, s.returningVehicles), base.fleet),
    resources: settlements.reduce(
      (acc, s) => addResources(addResources(acc, s.rewards), s.refund),
      base.resources,
    ),
    // What they found goes into the inventory alongside the pay. Folded across every crew that came
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
  // Stockpile and inventory in one statement, because a mission pays into both and a crash between
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

  /*
   * Feats: what this settlement is worth to the lifetime counters (maintainer request, 2026-09-13).
   *
   * After the writes above and before the receipts, so a crash between them loses a counter rather
   * than a payout. One pass per run that came home, because a settlement can resolve several at
   * once and each is a separate job on the board.
   *
   * `s.rewards` is what was actually banked, not what the template quoted: a haul trimmed by what
   * the crew could carry counts as what came through the gate, which is what "caps ever earned"
   * has to mean for the number to match the stockpile it went into.
   */
  for (const settlement of settlements) {
    const template = findMissionTemplate(settlement.mission.templateId);
    /*
     * A run the crew was turned round on is not a run.
     *
     * This matters more than it looks. Cancelling inside the window refunds ninety per cent and
     * costs only the minutes already walked, so counting a recalled mission would make
     * launch-and-cancel the fastest way to finish every mission ladder in the catalogue, including
     * the per-district ones. The pay, the salvage and the page already treat a recall as having
     * never happened (see `recalled` above); the counters have to agree with them.
     *
     * The other tallies below are safe without this check because they are paid off what actually
     * arrived, and a recalled crew arrives with nothing.
     */
    if (settlement.mission.recalledAt === null) {
      tallyMissionHome(repos, base.id, {
        areaId: settlement.mission.areaId,
        kind: template?.kind ?? 'standard',
        succeeded: settlement.outcome === 'success',
      });
    }
    tallyResourcesEarned(repos, base.id, settlement.rewards);
    tallyInfamyEarned(repos, base.id, settlement.infamyDelta);
    // Pages only. `found` is the whole inventory haul, so it carries salvaged components too, and
    // counting those as pages would finish the blueprint chain off scrap servos.
    tallyPagesIn(repos, base.id, settlement.found);
  }

  // INTERFACES R7: §I1 makes a mission completing an XP source. W6 owns the whole XP side, so this
  // only names what happened: one award per crew that came home, success or failure, priced by
  // `PLAYER_XP_AWARDS` and levelled by W6's engine. Threaded through `awardPlayerXp` so a
  // multi-mission settlement banks every award and the base handed back carries the level it
  // ended on, rather than a pre-award copy the caller would then serve as current.
  //
  // Threaded rather than looped over a stale copy: two crews that cross two thresholds owe the
  // player `levelsGained: 2`, and `awardPlayerXp` accumulates that into the durable marker.
  let progressed = settled;
  for (const settlement of settlements) {
    // Priced per run rather than off the table: a day-long expedition is worth more than a scrap
    // run, a battle more than a standard job of the same length, and a run that came home empty
    // still pays a fifth. `missionXp` owns all three; this only banks what it said.
    progressed = awardPlayerXp(repos, progressed, 'missionCompleted', 0, settlement.xp).base;
  }

  // §H6 used to pay the officer who led each run their own character XP here. Officers have no
  // level any more (see `commander.ts`): a run pays the crew, and who led it decides how well it
  // went rather than what it does to them.
  // The receipts. One per run that landed, so a player who was on another screen finds out that
  // the crew is back and what they brought, rather than noticing the roster changed.
  for (const settled of settlements) {
    // A battle job that nobody walked away from is still a receipt, and it is the one receipt a
    // player must not miss. It says the only thing there is to say: the report is what the
    // survivors tell you, and there are none.
    const name = findMissionTemplate(settled.mission.templateId)?.name;
    notifyBase(repos, base.id, {
      kind: 'mission_home',
      title: settled.mission.reported ? 'A crew is home' : 'Nobody came back',
      body: settled.mission.reported
        ? (name ?? 'The job is finished.')
        : `Nobody came back from ${name ?? 'the job'}`,
      link: '/game/missions',
      subjectId: settled.mission.id,
      now,
    });
  }

  // §F1e: the sheet itself, named. `mission_home` says a crew is back and which job it was; this
  // says what came home in the inventory and points at the document the page belongs to. Diffed
  // against the inventory as it stood, so every crew that landed on this call is covered at once.
  tellPagesFound(repos, {
    userId: base.ownerId,
    before: base.inventory,
    after: settled.inventory,
    source: { kind: 'mission' },
    now,
  });

  /*
   * The level-up, if this settlement crossed one, is **not** returned.
   *
   * It used to be, and the world clock is why that was not enough: the tick calls this function
   * every second and throws the answer away, so a threshold crossed at 03:00 reached nobody.
   * `awardPlayerXp` banks every crossing into the durable marker instead (migration 0083) and the
   * responses that announce drain it with `takeLevelUp`, so this function has nothing left to say
   * about it and two sources cannot disagree.
   */
  return { base: progressed, resolved: settlements.map((s) => s.mission) };
}
