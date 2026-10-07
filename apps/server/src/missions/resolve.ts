import {
  pageWonFrom,
  mergeFleets,
  earnedInfamy,
  gainInfamy,
  missionInfamyForBattle,
  unitSlotsUsed,
  MISSION_INFAMY_DELTA,
  boostedXp,
  missionXpEarned,
  RESOURCE_KG,
  carriedHome,
  missionCarry,
  scaledSpoils,
  withMissionCaps,
  findMissionTemplate,
  isMissionDue,
  missionCompletesAt,
  missionRewards,
  BLUEPRINT_CATEGORIES,
  guaranteedSalvage,
  pricedTotalMinutes,
  type BattleOfficer,
  type CrewEffects,
  type OfficerRole,
  type Base,
  type Overseer,
  type Mission,
  type MissionOutcome,
  addItems,
  infirmaryRecoveryPercent,
  fightCategory,
  leadingAs,
  officerSheetBonusFor,
  rollSalvage,
} from '@frontline/shared';
import { forceSize, mergeArmies } from '../battle/forces.js';

/**
 * Components a won Mayhem brings home whatever the dice say (maintainer, 2026-09-23, when the top
 * fight was the Siege; it moved to Mayhem with the grades on 2026-09-28).
 */
export const MAYHEM_GUARANTEED_PARTS = 3;
import { createRng } from '../characters/rng.js';
import {
  liftedOfficerSheet,
  liftedOverseerSheet,
  officerLiftRoom,
  standingEffectsFor,
  type LiftRoom,
} from '../crew/standing.js';
import { overseerOf } from '../crew/training.js';
import { refundFor } from '../battle/resolve.js';
import { musterRatesFor } from '../units/muster.js';
import { fightMissionBattle, missionInfamySurcharge } from './battle.js';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';
import { creditBaseInTurn } from '../district/stores.js';
import { settleBase } from '../district/settle.js';
import { reportTickFailure } from '../world/guard.js';
import { tellPagesFound } from '../social/pages.js';
import type { StoredMission } from '../db/repos/missions.js';
import { awardPlayerXp, missionXpBonusPercent, professorXpPercent } from '../progression/award.js';
import {
  tallyInfamyEarned,
  tallyUnitsRouted,
  tallyMissionHome,
  tallyCasualtiesRecovered,
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
 * §D1: the sheet whoever led the run brings to the fight, or nobody on a row from before every run
 * needed a leader.
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
  crew: CrewEffects | null,
  room: LiftRoom,
): BattleOfficer | undefined {
  // The lifted sheet, the one the quote and the frozen odds were read off (`benchFor`).
  if (stored.mission.overseerLed) {
    return overseer
      ? {
          officerId: overseer.id,
          name: overseer.name,
          attributes: liftedOverseerSheet(overseer.attributes, room),
        }
      : undefined;
  }
  const officer = base.commanders.find((held) => held.id === stored.mission.officerId);
  if (!officer) return undefined;
  // The chair's own rungs on the officer's sheet (`crew/leading.ts`): a battle job is a mission
  // and a fight, so both scopes pay here.
  const sheetBonus = crew ? officerSheetBonusFor(crew, officer.role, 'mission') : undefined;
  return {
    officerId: officer.id,
    name: officer.name,
    attributes: liftedOfficerSheet(officer, room).attributes,
    ...(sheetBonus ? { sheetBonus } : {}),
  };
}

/** The chair the named officer sits in, for the rungs that pay while that chair leads. */
function chairLeading(stored: StoredMission, base: Base): OfficerRole | null {
  if (stored.mission.overseerLed || stored.mission.officerId === null) return null;
  return base.commanders.find((held) => held.id === stored.mission.officerId)?.role ?? null;
}

export interface MissionSettlement {
  base: Base;
  /** The missions that came home on this call, in the order they walked in. */
  resolved: Mission[];
}

/**
 * The crew's own clocks run to `now`, then whoever is due walks in. Every door that brings a crew
 * home goes through here: the world clock and the missions screen.
 *
 * A returning haul is measured against the stores and a returning party merges into the roster,
 * and both were read raw (audit, 2026-09-28): a warehouse finished since the owner last looked was
 * not standing when the haul landed, so the room it adds was thrown away as waste.
 */
export function settleAndResolveMissions(
  repos: Repositories,
  base: Base,
  now: Date,
): MissionSettlement {
  try {
    return repos.tx(() => resolveDueMissions(repos, settleBase(repos, base, now).base, now));
  } catch (error) {
    /*
     * One run this build cannot settle must not lock the crew out of its own screens (maintainer,
     * 2026-10-02). The world clock already skips a bad row; the read paths settled every due run
     * in one go and threw on the first bad one, so every read of that crew failed until the row was
     * fixed by hand. Here the runs go one at a time, in the order they came home, and the one that
     * throws is reported and left where it is.
     */
    reportTickFailure({ stage: 'missions on read', item: base.id, error });
    let current = repos.tx(() => settleBase(repos, base, now).base);
    const resolved: Mission[] = [];
    for (const stored of dueInOrder(repos, current, now)) {
      try {
        const one = repos.tx(() => resolveDueMissions(repos, current, now, stored.mission.id));
        current = one.base;
        resolved.push(...one.resolved);
      } catch (failure) {
        reportTickFailure({ stage: 'missions on read', item: stored.mission.id, error: failure });
      }
    }
    return { base: current, resolved };
  }
}

/** The runs due by `now`, in the order they walked in. */
function dueInOrder(repos: Repositories, base: Base, now: Date): StoredMission[] {
  return repos.missions
    .listActiveByBaseId(base.id)
    .filter((stored) => isMissionDue(stored.mission, now))
    .sort(
      (a, b) => missionCompletesAt(a.mission).getTime() - missionCompletesAt(b.mission).getTime(),
    );
}

/**
 * Banks every mission whose clock has run out since the base was last read (GDD §E2, §E5).
 *
 * Mission timers run on the real-world clock, so like payroll (`economy/settle.ts`) they settle
 * lazily on the read paths rather than from a scheduler: there is no background job to keep
 * alive, and a base nobody looks at owes exactly the same payout whenever it is next opened.
 * Writes only happen when a mission actually came home.
 */
export function resolveDueMissions(
  repos: Repositories,
  base: Base,
  now: Date,
  /** One run only, for the read paths' one-at-a-time fallback. Every due run when absent. */
  onlyId?: string,
): MissionSettlement {
  /*
   * In the order they walked in, not the order they left (audit, 2026-09-28): the credits below
   * take store room in this order (`creditBaseInTurn`), so a long run launched first and home last
   * used to take the room ahead of a short one that was back hours earlier.
   */
  const due = dueInOrder(repos, base, now).filter(
    (stored) => onlyId === undefined || stored.mission.id === onlyId,
  );
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
  const room = fights ? officerLiftRoom(repos, base, now) : null;

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
     * The grade is the row's: dealt on the card and frozen when the crew left, so nothing that
     * happens on the road changes what is waiting or what it pays. A row from before grades carries
     * null and reads as the job's lowest.
     */
    const grade = stored.mission.grade ?? template?.grades[0] ?? 'F-';
    const thisFights = !recalled && template !== undefined && template.kind === 'battle';
    const battle =
      template && thisFights
        ? fightMissionBattle({
            seed: stored.seed,
            jobName: template.name,
            force: stored.mission.force,
            vehicles: stored.mission.vehicles,
            grade,
            leader: room ? leaderOf(stored, base, overseer, crew, room) : undefined,
            anyRide,
            // The crew's brackets as they stand at the mark, the same read `missionCarry` gets.
            loadouts: base.unitLoadouts,
            ...(crew
              ? {
                  // §D5: `leadingAs()` only when an officer leads, which is the rule the launch
                  // and the leader list already state (`missions/leaders.ts`): the crew's `lead_*`
                  // channels, and the rungs of whichever chair the officer sits in.
                  territory:
                    !stored.mission.overseerLed && stored.mission.officerId !== null
                      ? leadingAs(crew, chairLeading(stored, base), 'mission')
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
        ? // Cap Counter's cut, off the fold at the return like the bag below: not frozen at the
          // launch, so a counter hired while the crew is out counts what they bring in.
          withMissionCaps(
            // The Bounty Wall's gold on the area's premium (`golden.ts`), frozen at the launch,
            // over the whole bundle the way the card quoted it.
            scaledSpoils(
              scaledSpoils(
                missionRewards(template, outcome, pricedMinutes, grade),
                stored.mission.payPercent,
              ),
              stored.mission.goldenPercent ?? 0,
            ),
            crewCarry?.missionCapsPercent ?? 0,
          )
        : {};
    // Off the crew's loadouts as they stand at the mark, the same way the roster folds them. Kept
    // on the run, so the report says what they could lift then rather than today.
    const carryCapacity = missionCarry(
      // The ones still standing, not the ones who set out: see `MissionBattle.carrying`. A job
      // with no fight in it kills nobody, so the force that went is the force that carries.
      battle?.carrying ?? stored.mission.force,
      base.unitLoadouts,
      // §A4: the Pawn Shop, the raid modifications and `sig_scavenger_king` all pay into the same
      // channel, and it reached the raid path only. A crew that bought a bigger bag carried the
      // catalogue figure home off every job they ran.
      crewCarry?.lootCapacityPercent ?? 0,
      crewCarry ?? undefined,
      crewCarry?.carrierLootFlat ?? 0,
    );
    const rewards = carriedHome(paid, carryCapacity, RESOURCE_KG);

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
    const rolled =
      recalled || !reported ? {} : rollSalvage(pricedMinutes, outcome === 'success', rng);
    /*
     * The top fight's guarantee (maintainer, 2026-09-23): a won Mayhem always brings components home,
     * on top of whatever the dice said, and always a page (below). Off the same stream, one draw
     * further along, so the run is as reproducible as any other.
     */
    const mayhemWon =
      thisFights && fightCategory(grade) === 'mayhem' && outcome === 'success' && reported;
    const found = mayhemWon
      ? addItems(rolled, guaranteedSalvage(MAYHEM_GUARANTEED_PARTS, rng))
      : rolled;
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
        : mayhemWon
          ? // A Mayhem pays a page whether or not the run carried one: the category comes off
            // the seed, the sheet off the same draw every other page comes off.
            pageWonFrom(
              BLUEPRINT_CATEGORIES[stored.seed % BLUEPRINT_CATEGORIES.length] ?? 'unit',
              `${String(stored.seed)}:siege`,
            )
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
        carryCapacity,
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
      /** Enemy units the crew made run, for the `units_routed` ladder. Zero on plain work. */
      routed: battle && reported ? forceSize(battle.fledEnemy) : 0,
      /** The crew's dead the medics brought round, for the `casualties_recovered` ladder. */
      recovered: battle && reported ? battle.recovered : 0,
      // ...plus Reliquary's two surcharges on the dead, which a declared fight paid and a job
      // did not: the Fight Pit's on the enemy's intimidated and SPECTACLE's on the Dancer's kills.
      infamyDelta:
        template && reported
          ? Math.round(
              earnedInfamy(
                MISSION_INFAMY_DELTA[template.kind][outcome] +
                  (battle
                    ? missionInfamyForBattle(battle.killed, battle.fledEnemy) +
                      missionInfamySurcharge(battle, crew?.intimidatedInfamyPercent ?? 0)
                    : 0),
                crew?.infamyGainPercent ?? 0,
              ),
            )
          : 0,
      /*
       * The Gravefields (`xpPerSlotLost`): player XP per unit slot of the crew's own dead, the way
       * the declared-fight settle pays it (maintainer: "each unit that dies in battle"). Off `lost`
       * rather than the raw dead, since somebody the medics brought round did not die; and gated on
       * `reported` like every other payout here, because a run nobody came home from banks nothing.
       */
      xpForTheDead:
        battle && reported && crew
          ? Math.round(crew.xpPerSlotLost * unitSlotsUsed(battle.lost))
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
      // Gated on `reported` like every other payout on this object (bug pass, 2026-09-23). The
      // spec's rule is that a run nobody came home from "banks nothing: no pay, no salvage, no page,
      // no XP, no infamy", and the Bone Market's caps-for-bodies was the one line that ignored it.
      refund:
        battle && reported && crew
          ? refundFor(battle.lost, crew.salvageRefundPercent, musterRatesFor(repos, base, now))
          : {},
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
       * this row. A recalled crew never reached the site and learned nothing: it pays no XP (bug
       * pass, 2026-09-27). It used to pay the failure's share of the *whole run's* figure, so
       * launching the longest card and turning round a second later farmed XP at the write limit.
       */
      // The figure frozen at launch, through the one function the report prints it with.
      xp: missionXpEarned({
        xp: stored.mission.xp,
        outcome,
        recalledAt: stored.mission.recalledAt,
        reported,
      }),
    };
  });

  /*
   * Into the stores, one run at a time, up to their ceiling (maintainer ruling, 2026-09-28).
   *
   * Mission pay used to be the exception that could leave a stockpile over its top. It lands like
   * every other credit now, and what does not fit is thrown away at the gate. The player was shown
   * how much of the haul the stores had room for when they sent the crew; the report says what was
   * lost, per run, against the run that found the stores full. The pay and the Bone Market's caps
   * are two credits rather than one so each run's `wasted` is its pay's alone.
   */
  const banked = creditBaseInTurn(
    repos,
    base,
    settlements.flatMap((s) => [s.rewards, s.refund]),
    now,
  );
  const paidIn = (at: number) => banked.credits[at * 2];
  // The run's Bone Market refund, the second of its two credits.
  const refundedIn = (at: number) => banked.credits[at * 2 + 1];
  const wastedBy = (at: number) => paidIn(at)?.wasted ?? {};
  // What the award below will bank for each run, kept on the row so the report prints it rather
  // than the figure before the district's and the crew's bonus. One sum for every run in this
  // settle: nothing between here and the award moves the buildings or the people.
  const xpBonus = missionXpBonusPercent(repos, base, now);
  const professor = professorXpPercent(repos, base, now);
  const xpPaidBy = (at: number) => boostedXp(settlements[at]?.xp ?? 0, xpBonus);

  // Missions are closed out before the payout lands on purpose. Both writes are synchronous and
  // only a real sqlite failure can split them, but if one does, the failure mode that leaves a
  // player short is far better than the one that pays every mission twice on the next read.
  for (const [at, { mission, outcome, rewards, spoils }] of settlements.entries()) {
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
      wasted: wastedBy(at),
      xpPaid: xpPaidBy(at),
      infamyPaid: settlements[at]?.infamyDelta ?? 0,
      refund: settlements[at]?.refund ?? {},
      ...(mission.carryCapacity === undefined ? {} : { carryCapacity: mission.carryCapacity }),
    });
  }

  const settled: Base = {
    ...base,
    army: settlements.reduce((army, s) => mergeArmies(army, s.returning), base.army),
    fleet: settlements.reduce((fleet, s) => mergeFleets(fleet, s.returningVehicles), base.fleet),
    resources: banked.resources,
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
  repos.bases.updateArmy(settled.id, settled.army, settled.musterQueue);
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
   * What landed in the stores, not what the template quoted: a haul trimmed by what the crew could
   * carry, and then by what the stores had room for, counts as what reached the stockpile, which is
   * what "caps ever earned" has to mean for the number to match the stockpile it went into.
   */
  for (const [at, settlement] of settlements.entries()) {
    const template = findMissionTemplate(settlement.mission.templateId);
    /*
     * A run the crew was turned round on is not a run.
     *
     * This matters more than it looks. A launch charges nothing and a recall costs only the
     * minutes already walked, so counting a recalled mission would make
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
        grade: settlement.mission.grade ?? template?.grades[0] ?? 'F-',
        // The odds the run went out with, frozen at launch: what the long-odds feat reads.
        chance: due[at]?.successChance,
      });
    }
    tallyUnitsRouted(repos, base.id, settlement.routed);
    tallyCasualtiesRecovered(repos, base.id, settlement.recovered);
    tallyResourcesEarned(repos, base.id, paidIn(at)?.landed ?? {});
    // The refund too, as the fight settle counts its own (bug pass, 2026-10-06): the feat counted a
    // mission's pay and left its Bone Market caps out.
    tallyResourcesEarned(repos, base.id, refundedIn(at)?.landed ?? {});
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
    // At the settle's instant, the one `xpPaid` on the run was priced at (bug pass, 2026-10-06):
    // the banked figure was read at the wall clock and could differ from the one the report shows.
    progressed = awardPlayerXp(
      repos,
      progressed,
      'missionCompleted',
      professor,
      settlement.xp,
      now,
    ).base;
    // The Gravefields' figure as its own award, so the run's own stays what the card quoted.
    if (settlement.xpForTheDead > 0) {
      progressed = awardPlayerXp(
        repos,
        progressed,
        'missionCompleted',
        0,
        settlement.xpForTheDead,
        now,
      ).base;
    }
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
      at: missionCompletesAt(settled.mission),
    });
  }

  // §F1e: the sheet itself, named. `mission_home` says a crew is back and which job it was; this
  // says what came home in the inventory and points at the document the page belongs to. Diffed
  // run by run, so each page is dated at the return of the crew that carried it.
  let held = base.inventory;
  for (const run of settlements) {
    const after = addItems(held, run.found);
    tellPagesFound(repos, {
      userId: base.ownerId,
      before: held,
      after,
      source: { kind: 'mission' },
      at: missionCompletesAt(run.mission),
    });
    held = after;
  }

  /*
   * The level-up, if this settlement crossed one, is **not** returned.
   *
   * It used to be, and the world clock is why that was not enough: the tick calls this function
   * every second and throws the answer away, so a threshold crossed at 03:00 reached nobody.
   * `awardPlayerXp` banks every crossing into the durable marker instead (migration 0083) and the
   * responses that announce drain it with `takeLevelUp`, so this function has nothing left to say
   * about it and two sources cannot disagree.
   */
  return {
    base: progressed,
    resolved: settlements.map((s, at) => ({
      ...s.mission,
      wasted: wastedBy(at),
      xpPaid: xpPaidBy(at),
      infamyPaid: s.infamyDelta,
      refund: s.refund,
    })),
  };
}
