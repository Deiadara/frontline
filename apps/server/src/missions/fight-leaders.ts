import {
  infirmaryRecoveryPercent,
  leadingAs,
  officerSheetBonusFor,
  seedFrom,
  type Army,
  type Base,
  type BattleOfficer,
  type CrewEffects,
  type Fleet,
  type Grade,
  type MissionTemplate,
  type OfficerRole,
} from '@frontline/shared';
import { fightMissionBattle } from './battle.js';
import type { BenchMember } from './leaders.js';

/**
 * Who should lead a fight: whoever wins it (maintainer, 2026-09-28).
 *
 * A plain job grades its leader on the attributes the job leans on, and that is the whole of its
 * odds. A fight used to be graded the same way, on `fight` and whatever else the card carried,
 * and none of it was what the engine reads: an officer in a fight is eleven combat numbers off
 * the attribute table (`battle/officer.ts`), their chair's rungs on that sheet and on the line
 * (`crew/leading.ts`), and the crew's own book. "Take everything into account" is a sentence
 * about the engine, so the engine is asked, the way the Right Hand already asks it which units
 * to send (`automations/runners.ts`, `fightRanking`).
 *
 * Each candidate leads the same force against the job's grade over a handful of practice
 * fights, on practice seeds rather than the run's own, so the ranking learns what the grade
 * tends to field and never the one fight that is about to happen. The score is wins first and
 * survivors second, the same shape the unit ranking uses: enough to break a tie between two
 * leaders who both win, never enough to prefer a loss.
 */

/**
 * Practice fights per candidate. Six: a bench is a dozen people at most, so a whole quote is
 * under a hundred engine runs, and the order stops moving well before that on fight-job enemies.
 */
export const LEADER_RANK_SAMPLES = 6;

/** What survivors are worth beside the win: a tie-breaker, never a loss's worth. */
const LEADER_SURVIVOR_WEIGHT = 0.5;

export interface FightLeaderRating {
  id: string;
  /** Practice fights won, out of {@link FightLeaderRating.fights}. */
  wins: number;
  fights: number;
  /** Share of the force that walked home, averaged over the practice fights. */
  kept: number;
  /** Wins plus half the survivors, per fight: what the ranking is ordered on. */
  score: number;
}

export interface RankFightLeadersArgs {
  base: Base;
  template: MissionTemplate;
  grade: Grade;
  force: Army;
  vehicles: Fleet;
  candidates: readonly BenchMember[];
  /** The crew's standing book, before anybody is named to lead it. */
  effects: CrewEffects;
  /**
   * The seed the practice fights run on. The same inputs give the same order, so a quote asked
   * twice while a player fills the force does not shuffle under them.
   */
  practice: string;
}

/**
 * The chair whose rungs this leader spends: an officer's role, or none for the Overseer and for
 * an officer with no chair.
 */
export function chairOf(base: Base, leader: Pick<BenchMember, 'id' | 'kind'>): OfficerRole | null {
  if (leader.kind !== 'officer') return null;
  return base.commanders.find((held) => held.id === leader.id)?.role ?? null;
}

/** The leader as the engine takes them, with their chair's rungs on their sheet. */
export function combatantFor(
  base: Base,
  leader: BenchMember,
  effects: CrewEffects,
  context: 'mission' | 'battle',
): BattleOfficer {
  const role = chairOf(base, leader);
  return {
    officerId: leader.id,
    name: leader.name,
    attributes: leader.attributes,
    sheetBonus: officerSheetBonusFor(effects, role, context),
  };
}

/**
 * The book a run fights on under this leader.
 *
 * An officer spends the crew's `lead_*` channels and their chair's rungs (`leadingAs`); the
 * Overseer spends neither, which is the rule the launch and the settle already state: the
 * leading channels pay for an officer *of the crew* going, and the Overseer is the crew.
 */
export function bookUnder(
  base: Base,
  leader: Pick<BenchMember, 'id' | 'kind'>,
  effects: CrewEffects,
  context: 'mission' | 'battle',
): CrewEffects {
  return leader.kind === 'officer' ? leadingAs(effects, chairOf(base, leader), context) : effects;
}

export function rankFightLeaders(args: RankFightLeadersArgs): FightLeaderRating[] {
  const sent = Object.values(args.force).reduce((total, count) => total + count, 0);
  const rated = args.candidates.map((candidate): FightLeaderRating => {
    let wins = 0;
    let kept = 0;
    for (let sample = 0; sample < LEADER_RANK_SAMPLES; sample += 1) {
      const fought = fightMissionBattle({
        seed: seedFrom(`${args.practice}:${sample}`),
        jobName: args.template.name,
        force: args.force,
        vehicles: args.vehicles,
        grade: args.grade,
        leader: combatantFor(args.base, candidate, args.effects, 'mission'),
        anyRide: args.effects.anyRide,
        loadouts: args.base.unitLoadouts,
        territory: bookUnder(args.base, candidate, args.effects, 'mission'),
        // The medics, as the real fight has them: recovery comes after the outcome, so it moves
        // `kept` rather than `wins`, and a leader who wins more gets more of it back.
        recoveryPercent:
          args.effects.casualtyRecoveryPercent + infirmaryRecoveryPercent(args.base.buildings),
      });
      if (fought.outcome === 'success') wins += 1;
      const home = Object.values(fought.home).reduce((total, count) => total + count, 0);
      kept += sent > 0 ? home / sent : 0;
    }
    const share = kept / LEADER_RANK_SAMPLES;
    return {
      id: candidate.id,
      wins,
      fights: LEADER_RANK_SAMPLES,
      kept: share,
      score: wins / LEADER_RANK_SAMPLES + LEADER_SURVIVOR_WEIGHT * share,
    };
  });
  // Best first; a tie keeps the bench's own order, which puts the Overseer ahead of a stranger
  // who fights exactly as well.
  return rated
    .map((rating, index) => ({ rating, index }))
    .sort((a, b) => b.rating.score - a.rating.score || a.index - b.index)
    .map(({ rating }) => rating);
}

/**
 * The chance a fight launches with: the share of practice fights this one leader won with this
 * force, on the seed the send window quotes.
 *
 * Both launch doors freeze this onto the run, the hand-sent one and the standing order. The
 * standing order used to leave it out, so its fight ran on the attribute grade and a party the
 * player would have sent at 80% went out at whatever the grade said (audit, 2026-09-28).
 */
export function fightChanceFor(
  args: Omit<RankFightLeadersArgs, 'candidates' | 'practice'> & { leader: BenchMember },
): number | undefined {
  const { leader, ...rest } = args;
  const [rating] = rankFightLeaders({
    ...rest,
    candidates: [leader],
    practice: `practice-leader:${args.base.id}:${args.template.id}:${args.grade}`,
  });
  return rating ? rating.wins / rating.fights : undefined;
}
