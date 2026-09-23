import {
  CITY_DISTRICTS,
  bestFitParty,
  dealBattleTier,
  MISC_AREA_ID,
  ORDER_SEQUENCES,
  areaIsOpen,
  automationPowers,
  bestLeader,
  composeProfile,
  findDistrict,
  isResting,
  leaningsFor,
  missionBoardKey,
  missionForceRefusal,
  missionOffers,
  nextJobKind,
  officerIsInjured,
  templateTimings,
  unledRule,
  type Army,
  type Automation,
  type AutomationKind,
  type Base,
  type MissionTemplate,
  type ResourceKey,
} from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import type { Repositories } from '../db/repos/index.js';
import { areaStatesFor } from '../missions/board.js';
import { launchMission } from '../missions/launch.js';
import { standingEffectsFor } from '../crew/standing.js';
import { officerDuty } from '../crew/duty.js';
import { removeForce } from '../battle/forces.js';
import { tallyAutomatedParty } from '../feats/tally.js';

/**
 * What a slot does when its turn comes (§C2b).
 *
 * A runner is looked up by `Automation.kind`, so the Right Hand learning to do a second thing is
 * a new entry in {@link AUTOMATION_RUNNERS} and nothing else: no schema change, no new table, no
 * change to the ladder, the cooldown or the screen's frame. That is what the maintainer meant by
 * composable, and it is why nothing in `automations/automations.ts` mentions a mission.
 *
 * A runner returns the stall reason, or `null` when it sent somebody. A stall is not an error: a
 * standing order that cannot be filled today waits, and the screen says why.
 */
export interface AutomationRunner {
  /** Sends a party if it can. Returns why not, or null on success. Writes through `repos`. */
  run: (
    repos: Repositories,
    base: Base,
    automation: Automation,
    now: Date,
    /** Admin mode: the party runs on the five second clock, as a manual launch would. */
    admin: boolean,
  ) => string | null;
}

/** A job the Right Hand could take, with the number it is being judged on. */
interface Candidate {
  areaId: string;
  boardKey: string;
  template: MissionTemplate;
  /** What it pays per minute in whatever is being optimised for, or overall when nothing is. */
  rate: number;
}

/**
 * Every job on every board this crew could take right now, of the kind it owes next.
 *
 * "Any open board" is the maintainer's answer: a slot rolls across every area currently offering
 * work rather than one the player pinned, so it stalls only when the whole city has nothing of
 * the right kind. `areaStatesFor` is the same reader the board screen uses, so the Right Hand
 * cannot see an area a player could not.
 */
function candidates(
  repos: Repositories,
  base: Base,
  wants: 'mission' | 'battle',
  now: Date,
  optimiseFor: ResourceKey | null,
): Candidate[] {
  const states = areaStatesFor(repos, base);
  const active = repos.missions.listActiveByBaseId(base.id);
  const busyAreas = new Set(active.map((one) => one.mission.areaId));
  const found: Candidate[] = [];

  /*
   * The misc board first, always. `areaStatesFor` only knows districts, and the misc board is
   * not one: it is the board every crew has from its first minute, and the one a fresh crew with
   * nothing scouted is otherwise left without. Then every district the screen would draw, by the
   * screen's own rule (`areaIsOpen`): contested, scouted, not held whole.
   */
  const open = [
    MISC_AREA_ID,
    ...CITY_DISTRICTS.filter((district) => {
      const state = states.get(district.id);
      return state !== undefined && areaIsOpen(district, state);
    }).map((district) => district.id),
  ];
  for (const areaId of open) {
    if (busyAreas.has(areaId)) continue;
    // The board's own three, off the same key the screen and the launch read.
    const boardKey = missionBoardKey(areaId, now);
    for (const template of missionOffers(areaId, boardKey)) {
      const isBattle = template.kind === 'battle';
      if ((wants === 'battle') !== isBattle) continue;
      found.push({ areaId, boardKey, template, rate: rateOf(template, optimiseFor) });
    }
  }
  return found;
}

/**
 * What a job is worth per minute, in one resource or overall.
 *
 * The maintainer's rule for the eighth rung, stated exactly: "if something takes 3 mins and gives
 * 100 and another 5 mins and gives 300 you take the 5 min one, regardless of the rest". So it is
 * a rate, not a total, and the other resources are not weighed against the chosen one at all.
 *
 * With nothing chosen it is the sum of the spoils over the minutes, which is the same comparison
 * with every resource counted once. Crude on purpose: a weighting table would be a second balance
 * sheet nobody asked for and nobody could see.
 */
function rateOf(template: MissionTemplate, optimiseFor: ResourceKey | null): number {
  const minutes = templateTimings(template).totalMinutes;
  if (minutes <= 0) return 0;
  const spoils = template.spoils;
  const total =
    optimiseFor === null
      ? Object.values(spoils).reduce<number>((sum, amount) => sum + (amount ?? 0), 0)
      : (spoils[optimiseFor] ?? 0);
  return total / minutes;
}

/** The force this slot is committing, or null when what it was told to send is not at home. */
function forceFor(base: Base, automation: Automation, template: MissionTemplate): Army | null {
  if (automation.unitSlots === null) {
    // The third rung: exactly this party or nothing, which is the maintainer's rule for it.
    const asked = automation.force;
    if (Object.keys(asked).length === 0) return null;
    for (const [unitId, count] of Object.entries(asked)) {
      if ((base.army[unitId] ?? 0) < count) return null;
    }
    return missionForceRefusal(asked, base.army, template.kind) === null ? asked : null;
  }

  // The fifth rung: the size, in unit slots, filled most suitable unit first (`bestFitParty`).
  const picked = bestFitParty(base.army, automation.unitSlots, template.kind);
  if (!picked) return null;
  return missionForceRefusal(picked, base.army, template.kind) === null ? picked : null;
}

/** The officer this slot sends, or undefined for nobody. `null` back means "told to, cannot". */
function leaderFor(
  repos: Repositories,
  base: Base,
  automation: Automation,
  template: MissionTemplate,
  now: Date,
): { kind: 'officer'; id: string; attributes: Base['commanders'][number]['attributes'] } | null {
  /*
   * Hurt means hurt *now*. `injuredUntil` is stamped when an officer is laid up and is never
   * cleared when it passes, so a bare truthiness check here refused every officer who had ever
   * been hurt, for ever. The same check every other dispatch uses.
   */
  const free = base.commanders.filter(
    (one) =>
      officerDuty(repos, base, one, now) === null && !officerIsInjured(one.injuredUntil, now),
  );
  if (automation.officerId !== null) {
    const named = free.find((one) => one.id === automation.officerId);
    if (!named) return null;
    return { kind: 'officer', id: named.id, attributes: named.attributes };
  }
  // Choosing for itself: the best fit for this job's profile, which is what the board's own
  // "best leader" control already does for a player.
  const best = bestLeader(free, offerProfile(template));
  if (!best) return null;
  return { kind: 'officer', id: best.id, attributes: best.attributes };
}

/** The job's leaning profile, which is what a leader is scored against on the board screen too. */
function offerProfile(template: MissionTemplate): ReturnType<typeof composeProfile> {
  return composeProfile(leaningsFor(template));
}

const missionsRunner: AutomationRunner = {
  run(repos, base, automation, now, admin) {
    const wants = nextJobKind(automation);
    const pool = candidates(repos, base, wants, now, automation.optimiseFor);
    if (pool.length === 0) return `No open board has ${wants === 'battle' ? 'a fight' : 'work'}`;

    /*
     * Which job: the best rate when a resource has been chosen, and otherwise at random.
     *
     * Random is the third rung's rule and it stays the default for every slot that has not been
     * told what to chase, because a slot that always took the richest job would quietly become
     * the only sensible way to play the board.
     */
    const chosen =
      automation.optimiseFor === null
        ? pool[Math.floor(Math.random() * pool.length)]
        : pool.reduce((best, one) => (one.rate > best.rate ? one : best));
    if (!chosen) return 'No open board has work';

    const force = forceFor(base, automation, chosen.template);
    if (!force) {
      return automation.unitSlots === null
        ? 'The party you named is not at home'
        : `Not enough units at home to fill ${String(automation.unitSlots)}`;
    }
    const leader = leaderFor(repos, base, automation, chosen.template, now);
    if (!leader) {
      return automation.officerId === null
        ? 'No officer is free to lead'
        : 'The officer you named is not free';
    }

    const effects = standingEffectsFor(repos, base, now);
    const stored = launchMission({
      id: randomUUID(),
      base,
      template: chosen.template,
      areaId: chosen.areaId,
      boardKey: chosen.boardKey,
      battleTier:
        chosen.template.kind === 'battle'
          ? dealBattleTier(chosen.areaId, chosen.boardKey, chosen.template.id, base.level)
          : null,
      force,
      now,
      leader,
      unled: unledRule(base.research.technologies),
      // The same flag the manual route passes, so an automated party and a manual one on the same
      // job run on the same clock. Without it, admin mode's five second missions were five seconds
      // by hand and the full real length by standing order, which made the Console useless for
      // watching an automation work and was a real inconsistency in a mode the board tests in.
      admin,
      missionSpeedPercent: effects.missionSpeedPercent,
      missionSpoilsPercent: effects.missionSpoilsPercent,
      unitSpeedPercent: effects.unitSpeedPercent,
      anyRide: effects.anyRide,
    });

    // The row and the roster move together, exactly as the manual launch does it: a crew that is
    // out is a crew that is not at home to defend the district.
    repos.missions.insert(stored);
    repos.bases.updateArmy(base.id, removeForce(base.army, force), base.trainingQueue);
    tallyAutomatedParty(repos, base.id);
    repos.automations.put({
      ...automation,
      missionId: stored.mission.id,
      restingSince: null,
      stalled: null,
      // The sequence advances on the *send*, so a mixed order does not repeat a kind when a job
      // it could not fill is retried a minute later.
      step: (automation.step + 1) % ORDER_SEQUENCES[automation.order].length,
    });
    return null;
  },
};

export const AUTOMATION_RUNNERS: Readonly<Record<AutomationKind, AutomationRunner>> = {
  missions: missionsRunner,
};

/**
 * One pass over every standing order in the world, on the world clock.
 *
 * Runs inside `settleWorld` **after** the crews coming home, so a party that walked in on this
 * very tick starts its slot's cooldown on this tick rather than a second later.
 */
export function settleAutomations(repos: Repositories, now: Date, admin = false): number {
  let sent = 0;
  for (const automation of repos.automations.enabled()) {
    const base = repos.bases.findById(automation.baseId);
    if (!base) continue;

    const powers = automationPowers(base.research.technologies);
    // The ladder is read every tick rather than trusted from when the slot was written: research
    // can be cancelled, and a slot that outlived its rung must stop rather than keep running.
    if (!powers.unlocked || automation.slot >= powers.slots) continue;

    /*
     * Still out? Then the only question is whether it has come home since we last looked.
     *
     * The rest starts from when the party **actually** walked in (`resolvedAt`), not from the
     * tick that noticed. A slot switched off while its party was out is not walked by this loop,
     * so nobody notices the landing until it is switched back on; resting from that moment would
     * charge a whole second gap for a party that came home long ago, which is not the rule the
     * maintainer set ("from the moment the previous returns"). Having stamped it, fall through:
     * if that gap is already over, this tick is the one that sends the next party.
     */
    let slot = automation;
    if (slot.missionId !== null) {
      const running = repos.missions.findById(slot.missionId);
      if (running && running.mission.status === 'active') continue;
      slot = {
        ...slot,
        missionId: null,
        restingSince: running?.mission.resolvedAt ?? now.toISOString(),
      };
      repos.automations.put(slot);
    }

    // The real gap, in admin mode too (maintainer, 2026-09-23): see `automationCooldownMs`.
    if (isResting(slot, powers.cooldownMs, now)) continue;

    const stall = AUTOMATION_RUNNERS[slot.kind].run(repos, base, slot, now, admin);
    if (stall === null) {
      sent += 1;
    } else if (stall !== slot.stalled) {
      // Written only when it changes, so a slot stalled for an hour is one write and not 3,600.
      repos.automations.put({ ...slot, stalled: stall });
    }
  }
  return sent;
}

/**
 * The gap between parties is never flattened.
 *
 * Admin mode shortens every clock in the game to `ADMIN_ACTION_SECONDS`, and the first build of
 * this shortened the gap with them: a party walked in and the next left five seconds later, which
 * on the dev server read as the cooldown not existing at all (maintainer, 2026-09-23). The gap is
 * the one number on this bench that is a *rule* rather than a wait, so what the Console shows is
 * what a player gets: fifteen minutes, or five past the sixth rung. Missions themselves stay
 * flattened to a minute, so a whole cycle on the bench is a minute out and the real rest.
 */
export function automationCooldownMs(realMs: number): number {
  return realMs;
}

/** Named for the screen: the district a board belongs to, or the miscellaneous one. */
export function boardName(areaId: string): string {
  return areaId === MISC_AREA_ID ? 'Miscellaneous' : (findDistrict(areaId)?.name ?? areaId);
}
