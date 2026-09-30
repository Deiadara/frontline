import {
  concurrentMissionSlots,
  unitsBeyondNotoriety,
  cityOfDistrict,
  districtsOfCity,
  bestFitParty,
  MISC_AREA_ID,
  ORDER_SEQUENCES,
  areaIsOpen,
  automationPowers,
  bestLeader,
  composeProfile,
  findUnit,
  leading,
  isResting,
  AUTOMATION_FAST_COOLDOWN_MS,
  leaningsFor,
  missionBoardKey,
  missionForceRefusal,
  missionOffers,
  nextJobKind,
  officerIsInjured,
  templateTimings,
  bareBattlefield,
  carriedHome,
  missionCarry,
  missionRewards,
  simulate,
  RESOURCE_KG,
  type Army,
  type BattleOfficer,
  type Grade,
  type Commander,
  type CrewEffects,
  type LineRules,
  type PartialResources,
  type Automation,
  type AutomationKind,
  type Base,
  type MissionTemplate,
  type ResourceKey,
  LEADER_HOLD_MESSAGES,
  NO_RIGHT_HAND_TEXT,
  missionSpeedPercentIn,
} from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import type { Repositories } from '../db/repos/index.js';
import { areaStatesFor } from '../missions/board.js';
import { launchMission } from '../missions/launch.js';
import { rampFor } from '../missions/pricing.js';
import {
  liftedOfficerSheet,
  officerLiftRoom,
  standingEffectsFor,
  type LiftRoom,
} from '../crew/standing.js';
import { officerAsLeader } from '../missions/leaders.js';
import { officerDuty } from '../crew/duty.js';
import { removeForce } from '../battle/forces.js';
import { enemyForce } from '../missions/enemy.js';
import { fightChanceFor, rankFightLeaders } from '../missions/fight-leaders.js';
import { tallyAutomatedParty } from '../feats/tally.js';
import { settleBase } from '../district/settle.js';
import { settleEach } from '../world/guard.js';
import { placeLocked } from '../battle/lock.js';
import { workingOfficer } from '../crew/roster.js';

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

/** A job the Right Hand could take. */
interface Candidate {
  areaId: string;
  boardKey: string;
  template: MissionTemplate;
  /** The grade the board dealt it at: the odds, the clock, the pay and what a fight fields. */
  grade: Grade;
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
): Candidate[] {
  const states = areaStatesFor(repos, base);
  const active = repos.missions.listActiveByBaseId(base.id);
  const busyAreas = new Set(active.map((one) => one.mission.areaId));
  const found: Candidate[] = [];

  /*
   * The misc board first, always. `areaStatesFor` only knows districts, and the misc board is
   * not one: it is the board every crew has from its first minute, and the one a fresh crew that
   * holds nothing is otherwise left without. Then every district the screen would draw, by the
   * screen's own rule (`areaIsOpen`): contested, with at least one location held by this crew. A
   * district the crew has lost its last place in drops out on the next tick, the way it drops off
   * the screen.
   */
  /*
   * The city this crew is standing in, not the first one.
   *
   * This walked `CITY_DISTRICTS`, so the Right Hand ran an Ashfall board whoever it was working
   * for: a Terminus crew's automation would have found nothing open and sat idle, and the one
   * screen that tells them why is the board it was not reading. The same rule the board itself
   * uses (`areaIsOpen`) decides what is offered; only the set it is applied to changed.
   *
   * **The crew's own city, and not every board they could reach** (maintainer, 2026-09-24). By
   * hand a crew may take work in any city it holds ground in, so the two doors deliberately differ.
   * A standing order is a thing you set once and stop watching, and one that could quietly send
   * your people two hours across the frontier while you were not looking is a different promise
   * from the one the button makes. Working a second city stays something you do on purpose.
   */
  const open = [
    MISC_AREA_ID,
    ...districtsOfCity(cityOfDistrict(base.districtId))
      .filter((district) => {
        const state = states.get(district.id);
        return state !== undefined && areaIsOpen(district, state);
      })
      .map((district) => district.id),
  ];
  for (const areaId of open) {
    if (busyAreas.has(areaId)) continue;
    // The board's own three, off the same key the screen and the launch read.
    const boardKey = missionBoardKey(areaId, now);
    for (const job of missionOffers(areaId, boardKey, base.level)) {
      if ((wants === 'battle') !== (job.template.kind === 'battle')) continue;
      found.push({ areaId, boardKey, template: job.template, grade: job.grade });
    }
  }
  return found;
}

/**
 * What a job pays this party per minute, in one resource or overall.
 *
 * The maintainer's rule for the eighth rung, stated exactly: "if something takes 3 mins and gives
 * 100 and another 5 mins and gives 300 you take the 5 min one, regardless of the rest". So it is
 * a rate, not a total, and the other resources are not weighed against the chosen one at all.
 *
 * "Gives" is what comes home, and this used to read the template's spoil weights instead (bug
 * pass, 2026-09-25). What the settle banks (`missions/resolve.ts`) is those weights put through
 * the reward curve (`rewardScale`, which is not linear in the minutes) and the grade, then
 * trimmed to what the party can carry. Ranked on the weights, a slot asked for scrap took a worse
 * job than the best on offer 70% of the time and gave up a quarter of the rate, mostly by picking
 * a haul its party could not lift.
 *
 * The chance the run works is left out: it is not in the rule, and measured it moves the pick far
 * less than the carry and the curve do.
 *
 * With nothing chosen it is the sum of what comes home over the minutes, every resource counted
 * once. Crude on purpose: a weighting table would be a second balance sheet nobody asked for.
 */
function rateOf(candidate: Candidate, carry: number, optimiseFor: ResourceKey | null): number {
  const minutes = templateTimings(candidate.template, candidate.grade).totalMinutes;
  if (minutes <= 0) return 0;
  const home: PartialResources = carriedHome(
    missionRewards(candidate.template, 'success', minutes, candidate.grade),
    carry,
    RESOURCE_KG,
  );
  const total =
    optimiseFor === null
      ? Object.values(home).reduce<number>((sum, amount) => sum + (amount ?? 0), 0)
      : (home[optimiseFor] ?? 0);
  return total / minutes;
}

/**
 * How many practice fights a fighter gets before the Right Hand ranks it.
 *
 * Eight: the ranking only has to order a couple of dozen sheets, and on the fight-job enemies the
 * orders stop moving well before that. A whole ranking is under two hundred engine runs, a few
 * milliseconds, and it is only made when a party is actually about to leave for a fight.
 */
export const FIGHT_RANK_SAMPLES = 8;

/** What a practice fight's survivors are worth beside the win: enough to break a tie, never a loss. */
const RANK_SURVIVOR_WEIGHT = 0.5;

/**
 * Each fighter at home, scored by how it does alone at this size against this job's enemy.
 *
 * The Right Hand's "best units" for a fight (bug pass, 2026-09-25). The catalogue's own order,
 * offense plus a fifth of vitality per slot, put Sparks first at every size and grade, and on the
 * enemies fight jobs actually field it lost fights a different party of the same size won: twelve
 * Sparks never took a Fight II at level 8 where two Juggernauts took 85%, and six Sparks never took
 * a Fight I where one Juggernaut always did. The engine is the only thing that knows what wins, so
 * the engine is asked.
 *
 * The enemy is `enemyForce` for the job's grade, drawn on **practice** seeds rather than the run's
 * own, so the Right Hand learns what this grade tends to field and never sees
 * the one fight it is about to have. Everything else is what the real fight gets: the crew's
 * loadouts, its book and its leader (`fightMissionBattle`).
 */
function fightRanking(args: {
  base: Base;
  army: Army;
  unitSlots: number;
  grade: Grade;
  practice: string;
  leader: BattleOfficer | undefined;
  effects: CrewEffects;
}): (unitId: string) => number {
  const field = bareBattlefield('practice');
  const scores = new Map<string, number>();
  for (const [unitId, count] of Object.entries(args.army)) {
    const unit = findUnit(unitId);
    if (!unit || count <= 0 || unit.combat === false) continue;
    const party = { [unitId]: Math.min(count, Math.floor(args.unitSlots / unit.unitSlots)) };
    if ((party[unitId] ?? 0) <= 0) continue;
    let score = 0;
    for (let sample = 0; sample < FIGHT_RANK_SAMPLES; sample += 1) {
      const seed = `${args.practice}:${sample}`;
      const fought = simulate({
        seed,
        battlefield: field,
        attacker: {
          name: 'Your crew',
          army: party,
          defending: false,
          territory: args.effects,
          upgrades: args.base.unitLoadouts,
          cohesionPercent: args.effects.cohesionPercent,
          ...(args.leader ? { officer: args.leader } : {}),
        },
        defender: {
          name: 'Whoever was waiting',
          army: enemyForce(args.grade, seed),
          defending: true,
        },
      });
      const ours = fought.attacker.stacks.find((stack) => stack.unit.id === unitId);
      const kept = ours && ours.started > 0 ? ours.alive / ours.started : 0;
      score += (fought.winner === 'attacker' ? 1 : 0) + RANK_SURVIVOR_WEIGHT * kept;
    }
    scores.set(unitId, score / FIGHT_RANK_SAMPLES);
  }
  return (unitId) => scores.get(unitId) ?? 0;
}

/** The force this slot is committing, or null when what it was told to send is not at home. */
function forceFor(
  base: Base,
  automation: Automation,
  template: MissionTemplate,
  /** The crew's line rules, so a porter under `carriers_fight` counts as somebody who can fight. */
  rules: LineRules,
  /** How to order a fight's units, when there is a fight and a size to fill. */
  rank?: (army: Army, unitSlots: number) => (unitId: string) => number,
): Army | null {
  /*
   * §D7's ceiling, on this door too (bug pass, 2026-09-23).
   *
   * A standing order was the fourth way onto a field and the only one that did not ask what the
   * crew's name is worth: `POST /missions` checks `unitsBeyondNotoriety` and refuses with "they
   * will not take a contract from a name that small", and this did not, so a crew at Nobody could
   * field a Colossus by writing an order instead of pressing send. Both branches needed it, and
   * the fitted branch needed it most: `bestFitParty` ranks by offense per slot, so it actively
   * *prefers* the heavy sheets the gate exists to withhold.
   */
  const fieldable = (party: Army): Army | null =>
    unitsBeyondNotoriety(party, base.economy.notoriety).length === 0 ? party : null;

  if (automation.unitSlots === null) {
    // The third rung: exactly this party or nothing, which is the maintainer's rule for it.
    const asked = automation.force;
    if (Object.keys(asked).length === 0) return null;
    for (const [unitId, count] of Object.entries(asked)) {
      /*
       * The id has to name a sheet before it is looked up on the roster (bug pass, 2026-09-24).
       *
       * `base.army` is a plain object, so `army.constructor` is a function rather than
       * `undefined`, `NaN < count` is false, and a party of nobody read as a party that was at
       * home. `POST /automations` refuses such a key now, and this is the second lock, the same
       * pair `battle/deploy.ts` settled on: a handler that reads a key off an object should be
       * the one deciding which keys it will read. A row written before that door was shut still
       * has to stall rather than send.
       */
      if (findUnit(unitId) === undefined) return null;
      if ((base.army[unitId] ?? 0) < count) return null;
    }
    return missionForceRefusal(asked, base.army, template.kind, rules) === null
      ? fieldable(asked)
      : null;
  }

  /*
   * The fifth rung: the size, in unit slots, filled most suitable unit first (`bestFitParty`).
   *
   * Fitted out of what the crew may *field*, not out of everything on the books, so a slot whose
   * best party would be refused fills with the next best one instead of stalling. A crew whose
   * whole roster is above its rank still stalls, which is correct: there is nothing to send.
   */
  const fieldableArmy = Object.fromEntries(
    Object.entries(base.army).filter(
      ([unitId, count]) =>
        unitsBeyondNotoriety({ [unitId]: count }, base.economy.notoriety).length === 0,
    ),
  ) as Army;
  // Filled once by the catalogue's own order first: it is free, and a yard that cannot fill the
  // size at all is refused here without a single practice fight being run for it.
  const plain = bestFitParty(fieldableArmy, automation.unitSlots, template.kind);
  if (!plain) return null;
  const picked =
    template.kind === 'battle' && rank
      ? bestFitParty(
          fieldableArmy,
          automation.unitSlots,
          template.kind,
          rank(fieldableArmy, automation.unitSlots),
        )
      : plain;
  if (!picked) return null;
  return missionForceRefusal(picked, base.army, template.kind, rules) === null
    ? fieldable(picked)
    : null;
}

/** An officer as the launch takes one. */
type Leader = { kind: 'officer'; id: string; attributes: Base['commanders'][number]['attributes'] };

/**
 * Who leads this run: an officer, or a stall with the reason.
 *
 * Every run has a leader (maintainer, 2026-09-28), so a slot with nobody free stalls rather than
 * sending a party unled. A slot that **named** its officer sends that officer or nobody, which is
 * the third rung's promise; one choosing for itself takes the best free fit for the job, which is
 * what the board's own "best leader" control does for a player. The Overseer is the player, not a
 * standing order's to send.
 */
function leaderFor(
  repos: Repositories,
  base: Base,
  automation: Automation,
  template: MissionTemplate,
  now: Date,
  room: LiftRoom,
): { leader: Leader } | { stall: string } {
  /*
   * Hurt means hurt *now*. `injuredUntil` is stamped when an officer is laid up and is never
   * cleared when it passes, so a bare truthiness check here refused every officer who had ever
   * been hurt, for ever. The same check every other dispatch uses.
   */
  const free = freeOfficers(repos, base, now);
  if (automation.officerId !== null) {
    const named = free.find((one) => one.id === automation.officerId);
    return named
      ? { leader: asLeader(named, room) }
      : { stall: namedOfficerStall(repos, base, automation.officerId, now) };
  }
  /*
   * A fight's leader is settled once the party is known (`fightLeaderFor`), because who wins a
   * fight depends on who is standing in it; here the first free officer stands in until then,
   * so a slot with nobody free stalls before a party is filled.
   */
  const best = template.kind === 'battle' ? free[0] : bestLeader(free, offerProfile(template));
  return best ? { leader: asLeader(best, room) } : { stall: 'No officer is free to lead' };
}

/**
 * Why the officer a slot named cannot go, in the words the launch refuses them with.
 *
 * It said "not free" whatever the reason, and one of the reasons does not pass: an officer with no
 * chair leads nothing until they are given one, so a slot naming somebody on the bench stalled
 * every tick with nothing on the screen saying what to fix.
 */
function namedOfficerStall(repos: Repositories, base: Base, officerId: string, now: Date): string {
  const officer = base.commanders.find((one) => one.id === officerId);
  if (!officer) return 'The officer you named is no longer on your books';
  const duty = officerDuty(repos, base, officer, now);
  return duty
    ? `${officer.name} ${LEADER_HOLD_MESSAGES[duty.held]}`
    : 'The officer you named is not free';
}

/** Officers with nothing holding them now. The same check every other dispatch uses. */
function freeOfficers(repos: Repositories, base: Base, now: Date): Commander[] {
  return base.commanders.filter(
    (one) =>
      officerDuty(repos, base, one, now) === null && !officerIsInjured(one.injuredUntil, now),
  );
}

// On the lifted sheet, as a hand-sent run is (`benchFor`), so a standing order picks, quotes and
// fights with the same officer the player would have seen on the board.
const asLeader = (one: Commander, room: LiftRoom): Leader => ({
  kind: 'officer',
  id: one.id,
  attributes: liftedOfficerSheet(one, room).attributes,
});

/**
 * Who leads a fight: whoever wins it with this party (`missions/fight-leaders.ts`, maintainer
 * 2026-09-28). The board's own "most suitable leader" for a fight is the same ranking, so a
 * standing order sends the officer the player would have picked.
 */
function fightLeaderFor(
  base: Base,
  candidate: Candidate,
  force: Army,
  effects: CrewEffects,
  free: readonly Commander[],
  room: LiftRoom,
): Leader | null {
  if (free.length === 0) return null;
  const [best] = rankFightLeaders({
    base,
    template: candidate.template,
    grade: candidate.grade,
    force,
    vehicles: {},
    candidates: free.map((one) => officerAsLeader(one, room)),
    effects,
    practice: `practice-leader:${base.id}:${candidate.boardKey}:${candidate.template.id}`,
  });
  const chosen = best ? free.find((one) => one.id === best.id) : undefined;
  return chosen ? asLeader(chosen, room) : null;
}

/** The job's leaning profile, which is what a leader is scored against on the board screen too. */
function offerProfile(template: MissionTemplate): ReturnType<typeof composeProfile> {
  return composeProfile(leaningsFor(template));
}

const missionsRunner: AutomationRunner = {
  run(repos, base, automation, now, admin) {
    const wants = nextJobKind(automation);
    const pool = candidates(repos, base, wants, now);
    if (pool.length === 0) {
      // Said with the rule: the misc board deals both kinds, so nothing on offer means a crew is
      // already on it and no district is open to this one, which is a fix the player can make.
      return `No open board has ${wants === 'battle' ? 'a fight' : 'work'}. A district hires only crews that hold a place in it`;
    }

    /*
     * Cheapest refusal first. Who leads depends on the job's profile, and every job on the pool
     * is asked the same question of the same officers, so a slot whose named officer is out
     * stalls here without filling a party or pricing a board (bug pass, 2026-09-25).
     */
    const effects = standingEffectsFor(repos, base, now);
    const room = officerLiftRoom(repos, base, now);
    /*
     * The party each candidate would get, and what it would carry. A fight's party depends on
     * the grade, so the engine's ranking is made once per grade and shared by every job at it.
     */
    const rankings = new Map<string, (unitId: string) => number>();
    const partyFor = (candidate: Candidate, leader: Leader): Army | null =>
      forceFor(base, automation, candidate.template, effects, (army, unitSlots) => {
        const key = candidate.grade;
        let ranking = rankings.get(key);
        if (!ranking) {
          ranking = fightRanking({
            base,
            army,
            unitSlots,
            grade: candidate.grade,
            practice: `practice:${base.id}:${candidate.boardKey}:${key}`,
            leader: { officerId: leader.id, name: 'Leader', attributes: leader.attributes },
            effects: leading(effects),
          });
          rankings.set(key, ranking);
        }
        return ranking;
      });

    /*
     * Which job: the best rate when a resource has been chosen, and otherwise at random.
     *
     * Random is the third rung's rule and it stays the default for every slot that has not been
     * told what to chase, because a slot that always took the richest job would quietly become
     * the only sensible way to play the board. The rate is what the job pays *this* party per
     * minute (`rateOf`), so the party is filled before the job is chosen, and a job the slot
     * cannot fill is never the one it picks while another could be sent.
     */
    // A named officer is the same answer for every job, so a slot whose officer is out stalls
    // here, before a single party is filled or a board priced.
    if (automation.officerId !== null) {
      const named = leaderFor(repos, base, automation, pool[0]!.template, now, room);
      if ('stall' in named) return named.stall;
    }
    let leaderStall: string | null = null;
    const scored = pool.flatMap((candidate) => {
      const lead = leaderFor(repos, base, automation, candidate.template, now, room);
      if ('stall' in lead) {
        leaderStall = lead.stall;
        return [];
      }
      const force = partyFor(candidate, lead.leader);
      if (!force) return [];
      // A fight's leader, now that there is a party to lead: the engine's pick over the free
      // officers, unless the order named one.
      const leader =
        candidate.template.kind === 'battle' && automation.officerId === null
          ? (fightLeaderFor(
              base,
              candidate,
              force,
              effects,
              freeOfficers(repos, base, now),
              room,
            ) ?? lead.leader)
          : lead.leader;
      const carry = missionCarry(force, base.unitLoadouts, effects.lootCapacityPercent, effects);
      const rate = rateOf(candidate, carry, automation.optimiseFor);
      return [{ candidate, force, leader, rate }];
    });
    if (scored.length === 0) {
      if (leaderStall !== null) return leaderStall;
      return automation.unitSlots === null
        ? 'The party you named is not at home'
        : `Not enough units at home to fill ${String(automation.unitSlots)}`;
    }
    const picked =
      automation.optimiseFor === null
        ? scored[Math.floor(Math.random() * scored.length)]
        : scored.reduce((best, one) => (one.rate > best.rate ? one : best));
    if (!picked) return 'No open board has work';
    const { candidate: chosen, force, leader } = picked;
    const officer = base.commanders.find((one) => one.id === leader.id);

    const stored = launchMission({
      id: randomUUID(),
      base,
      template: chosen.template,
      areaId: chosen.areaId,
      grade: chosen.grade,
      // A fight's chance is frozen off the practice fights, exactly as the hand-sent launch does it.
      ...(chosen.template.kind === 'battle' && officer
        ? {
            fightChance: fightChanceFor({
              base,
              template: chosen.template,
              grade: chosen.grade,
              force,
              vehicles: {},
              leader: officerAsLeader(officer, room),
              effects,
            }),
          }
        : {}),
      force,
      now,
      leader,
      // The same flag the manual route passes, so an automated party and a manual one on the same
      // job run on the same clock. Without it, admin mode's five second missions were five seconds
      // by hand and the full real length by standing order, which made the Console useless for
      // watching an automation work and was a real inconsistency in a mode the board tests in.
      admin,
      missionSpeedPercent: missionSpeedPercentIn(effects, chosen.areaId),
      // An officer at the head of the party pays their leading perks here as they do on a
      // hand-sent run (`routes/missions.ts`): the arrival cut on the running clock, the loot cut
      // on the take. Both were missing, so a led standing order ran on the unled clock and pay.
      leadSpeedPercent: effects.leadArrivalPercent,
      missionSpoilsPercent: effects.missionSpoilsPercent + effects.leadLootPercent,
      unitSpeedPercent: effects.unitSpeedPercent,
      // §C3: the same road cuts the manual launch reads (maintainer, 2026-09-23). A standing
      // order's party walks the same streets as a hand-sent one.
      travelSpeedPercent: effects.travelSpeedPercent,
      roadMinutesOff: effects.roadMinutesOff,
      anyRide: effects.anyRide,
      // The opening band, for the same reason `admin` is here: a standing order and a hand-sent
      // party on the same job must run on the same clock and be paid the same premium.
      ramp: rampFor(repos, base),
    });

    /*
     * The row and the roster move together, in **one transaction**, exactly as the manual launch
     * does it (`routes/missions.ts`: "a split between these two would let the same people do
     * both"). This comment already claimed that and the code did not do it (bug pass,
     * 2026-09-23): `settleAutomations` runs inside `settleWorld`, which opens no transaction of
     * its own, so a failure between the insert and the roster write left the party on a mission
     * row *and* still at home, defending the district and deploying to fights while it was
     * supposedly away. The slot's own bookkeeping is in here for the same reason: losing the
     * `missionId` write orphans the slot and it fires again on the next tick.
     */
    repos.tx(() => {
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
    });
    return null;
  },
};

export const AUTOMATION_RUNNERS: Readonly<Record<AutomationKind, AutomationRunner>> = {
  missions: missionsRunner,
};

/**
 * How long a stalled slot waits before it asks again (bug pass, 2026-09-25).
 *
 * A stall was retried on every tick of the world clock, which is every second: the board read,
 * the party filled and the officers checked, about a millisecond a slot, for a slot that nearly
 * always gives the same answer it gave a second ago. Harmless for one crew and a whole tick for a
 * thousand. Thirty seconds is short against a fifteen or five minute gap and long against the
 * clock. An edit to the order is not made to wait: the key below is the order's own settings, so a
 * player who fixes what it stalled on is answered on the next tick.
 */
export const STALL_RETRY_MS = 30_000;

/** When each stalled slot may next be asked, keyed by what it was told to do. In memory only. */
const stalledUntil = new Map<string, { settings: string; at: number }>();

function settingsOf(automation: Automation): string {
  const { order, force, officerId, unitSlots, optimiseFor, step, missionId, restingSince } =
    automation;
  return JSON.stringify([
    order,
    force,
    officerId,
    unitSlots,
    optimiseFor,
    step,
    missionId,
    restingSince,
  ]);
}

/**
 * One pass over every standing order in the world, on the world clock.
 *
 * Runs inside `settleWorld` **after** the crews coming home, so a party that walked in on this
 * very tick starts its slot's cooldown on this tick rather than a second later.
 */
export function settleAutomations(repos: Repositories, now: Date, admin = false): number {
  let sent = 0;
  // One slot at a time, each caught (`world/guard.ts`): one crew's broken order is reported and
  // retried, and every other crew's standing orders still run on this tick.
  settleEach(
    repos,
    'automations',
    repos.automations.enabled(),
    (automation) => automation.id,
    (automation) => {
      // A stalled slot has no party out and no rest running, so it can be passed over before its
      // crew is read at all: most of what a stalled slot cost was that read, every second.
      const waited = stalledUntil.get(automation.id);
      if (waited && waited.settings === settingsOf(automation) && now.getTime() < waited.at) {
        return;
      }
      /*
       * The same for a slot resting on the shortest gap any rung gives: whatever the crew has
       * researched, it cannot send yet, and the crew read (a full base, sixteen JSON columns) was
       * most of the cost of every resting slot every second (hardening pass, 2026-09-27).
       */
      if (
        automation.missionId === null &&
        isResting(automation, AUTOMATION_FAST_COOLDOWN_MS, now)
      ) {
        return;
      }
      const raw = repos.bases.findById(automation.baseId);
      if (!raw) return;

      const powers = automationPowers(raw.research.technologies);
      // The ladder is read every tick rather than trusted from when the slot was written: research
      // can be cancelled, and a slot that outlived its rung must stop rather than keep running.
      if (!powers.unlocked || automation.slot >= powers.slots) return;

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
        if (running && running.mission.status === 'active') return;
        slot = {
          ...slot,
          missionId: null,
          restingSince: running?.mission.resolvedAt ?? now.toISOString(),
        };
        repos.automations.put(slot);
      }

      // The real gap, in admin mode too (maintainer, 2026-09-23): see `automationCooldownMs`.
      if (isResting(slot, powers.cooldownMs, now)) return;

      /*
       * The crew's clocks to `now` before anybody is picked (audit, 2026-09-28): the party is
       * filled from the roster and led off the sheets, and both were the rows as the owner last
       * read them, so units finished on the bench since stayed at home. Here and not above, so a
       * slot with a party out or a gap still running costs no settle on every tick. The two gates
       * above read the raw technologies, and that is safe: a rung only ever adds a slot or
       * shortens the gap, so a stale row can hold a slot back a tick, never send one early.
       */
      const base = settleBase(repos, raw, now).base;

      const settings = settingsOf(slot);
      const stallFor = (reason: string): void => {
        stalledUntil.set(slot.id, { settings, at: now.getTime() + STALL_RETRY_MS });
        // Written only when it changes, so a slot stalled for an hour is one write and not 3,600.
        if (reason !== slot.stalled) repos.automations.put({ ...slot, stalled: reason });
      };

      /*
       * The orders are the Right Hand's work (maintainer, 2026-09-29): with nobody fit in the chair,
       * nothing goes. A party already out still comes home above; only the next one waits. Read
       * off the settled base, so an injury that healed a second ago counts as healed.
       */
      if (workingOfficer(base.commanders, 'right_hand', now) === undefined) {
        stallFor(NO_RIGHT_HAND_TEXT);
        return;
      }

      /*
       * §E's ceiling on crews out at once, on this door too (bug pass, 2026-09-23).
       *
       * `POST /missions` refuses with `MISSIONS_AT_CAPACITY` past it and this did not, so two
       * standing orders on a level-1 crew put three parties on the road against a limit of two, and
       * the missions screen drew `activeLimit: 2` beside them. Read inside the loop rather than
       * once above it, so the second slot sees what the first one just sent.
       *
       * A stall rather than a silent skip: the slot has a real reason it did not fire and the
       * screen has a place to say it. `missions` is the only kind with a ceiling, so the check is
       * scoped to it; a battle order is a declaration and has its own.
       */
      if (slot.kind === 'missions') {
        const out = repos.missions.countActiveByBaseId(base.id);
        const ceiling =
          concurrentMissionSlots(base.level) +
          standingEffectsFor(repos, base, now).missionSlotsFlat;
        const full = `Every crew is out: ${out} of ${ceiling}`;
        if (out >= ceiling) {
          stallFor(full);
          return;
        }
        // The party leaves from home, and nothing leaves home in the last hour before a raid on
        // it (`battle/lock.ts`, maintainer 2026-09-28), by standing order or by hand.
        if (placeLocked(repos, base, { kind: 'district' }, now)) {
          stallFor('A raid lands on your district within the hour. Nobody leaves home');
          return;
        }
      }

      const stall = AUTOMATION_RUNNERS[slot.kind].run(repos, base, slot, now, admin);
      if (stall === null) {
        stalledUntil.delete(slot.id);
        sent += 1;
      } else {
        stallFor(stall);
      }
    },
  );
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
