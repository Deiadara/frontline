import { z } from 'zod';
import {
  ATTRIBUTE_NAMES,
  MAX_ATTRIBUTE,
  type AttributeName,
  type Attributes,
} from './attributes.js';
import { IMPORTANCE_WEIGHT, bandFor, type AttributeImportance } from './crew/importance.js';
import type { MissionTemplate } from './missions.js';
import { findUnit, type Army } from './units/index.js';

/**
 * Who leads a run, and what it does to the odds (maintainer, 2026-09-10).
 *
 * Every run has somebody in charge. The Overseer is the first such person a crew has, and any
 * officer on the books can lead instead. What the leader is good at moves the odds of the job,
 * and each job cares about different things: a raid wants somebody who can hold a line, a quiet
 * salvage crawl wants somebody who can keep their head and their footing, a hard road wants a
 * navigator with the stamina to walk it. So a job carries **leanings**, each leaning is a small
 * profile of attributes with an importance on each, and the profiles compose: a job that is a
 * fight at the end of a long road wants both.
 *
 * The scoring is the crew screen's own fit-points system (`crew/importance.ts`) turned on a job
 * instead of a chair: the same four importances, the same weights, the same bonus bands, so a
 * player who has learned what "irreplaceable" means on a chair reads a job the same way. It is a
 * separate table, though: a chair is a standing post and a job is an afternoon, and the two must
 * be able to drift apart without either breaking.
 *
 * ## Going without a leader
 *
 * Nobody goes out unled until the crew has researched how to: a first rung lets a crew of units
 * run a job on their own at `UNLED_PENALTY` off the odds (on top of missing whatever a good
 * leader would have added), a later rung on the same track takes the penalty away. The Overseer
 * counts as a leader from the first day, which is what makes the rule a gate rather than a wall.
 *
 * ## Battles
 *
 * A battle job is not a roll against a number: the crew fights a force it cannot see, with the
 * real engine, and comes home with whoever stood or ran. What the screen can say beforehand is a
 * band, read off how the force sent compares with what the job's tier fields at the crew's
 * level: low, moderate, good, very high. The composition behind the band is the job's secret.
 */

// --- leanings ---

export const MISSION_LEANINGS = [
  'fight',
  'stealth',
  'haul',
  'road',
  'talk',
  'salvage',
  'wire',
  'medic',
] as const;
export const MissionLeaningSchema = z.enum(MISSION_LEANINGS);
export type MissionLeaning = z.infer<typeof MissionLeaningSchema>;

export const MISSION_LEANING_LABELS: Readonly<Record<MissionLeaning, string>> = {
  fight: 'A fight',
  stealth: 'Quiet work',
  haul: 'A haul',
  road: 'A long road',
  talk: 'Talking',
  salvage: 'Salvage',
  wire: 'The wire',
  medic: 'Casualties',
};

/** What a job cares about: an importance on each attribute it reads, nothing on the rest. */
/**
 * Why a leaning wants what it wants (maintainer request, 2026-09-12).
 *
 * The board used to badge a job with who it was *for* (Combine, anti-Combine), which nothing in
 * the game ever read back: no officer cared, no screen tallied it. What a player actually needs
 * off a job is which of their people it leans on, and the profiles below already say so in
 * attributes. This is the same fact in a sentence, so the chip can explain itself on hover
 * instead of being a word to memorise.
 */
export const MISSION_LEANING_REASONS: Readonly<Record<MissionLeaning, string>> = {
  fight:
    'Somebody has to hold a line. Leadership keeps the crew in it and toughness keeps them standing; a leader who can read the ground picks the moment.',
  stealth:
    'Nobody is meant to know it happened. Stealth gets them in and composure stops a surprise turning into a firefight.',
  haul: 'The job pays in weight. Logistics decides how much comes back and organisation decides whether it is packed before anybody notices.',
  road: 'The distance is the job. Navigation finds the way through and stamina is what is left when they get there.',
  talk: 'Somebody is going to have to be talked round. Negotiation sets the price and charisma is why they listen at all.',
  salvage:
    'Worth is in the wreck. A salvager knows what is worth cutting out, and an engineer knows how to cut it out whole.',
  wire: 'It is a lock made of signal. Signals gets a way in and cryptography is what turns noise into an answer.',
  medic:
    'People are going to get hurt. Medicine is the difference between a casualty and a corpse.',
};

export type MissionProfile = Partial<Record<AttributeName, AttributeImportance>>;

/**
 * One leaning's profile. Exactly one irreplaceable attribute each, the way a chair has, so the
 * "most suitable" question always has a first thing to look at.
 */
export const LEANING_PROFILES: Readonly<Record<MissionLeaning, MissionProfile>> = {
  fight: {
    leadership: 'irreplaceable',
    strategy: 'essential',
    toughness: 'essential',
    reflexes: 'useful',
    intimidation: 'useful',
    composure: 'useful',
  },
  stealth: {
    stealth: 'irreplaceable',
    composure: 'essential',
    dexterity: 'useful',
    intuition: 'useful',
    deception: 'useful',
  },
  haul: {
    logistics: 'irreplaceable',
    organization: 'essential',
    strength: 'useful',
    stamina: 'useful',
    navigation: 'useful',
  },
  road: {
    navigation: 'irreplaceable',
    stamina: 'essential',
    speed: 'useful',
    resolve: 'useful',
  },
  talk: {
    negotiation: 'irreplaceable',
    charisma: 'essential',
    communication: 'useful',
    empathy: 'useful',
    deception: 'useful',
  },
  salvage: {
    salvage: 'irreplaceable',
    engineering: 'essential',
    craft: 'useful',
    analysis: 'useful',
  },
  wire: {
    signals: 'irreplaceable',
    cryptography: 'essential',
    logic: 'useful',
    analysis: 'useful',
  },
  medic: {
    medicine: 'irreplaceable',
    composure: 'useful',
    empathy: 'useful',
  },
};

const IMPORTANCE_RANK: Readonly<Record<AttributeImportance, number>> = IMPORTANCE_WEIGHT;

/** Several leanings as one profile: where two name the same attribute, the higher importance holds. */
export function composeProfile(leanings: readonly MissionLeaning[]): MissionProfile {
  const profile: MissionProfile = {};
  for (const leaning of leanings) {
    for (const [name, importance] of Object.entries(LEANING_PROFILES[leaning]) as [
      AttributeName,
      AttributeImportance,
    ][]) {
      const current = profile[name];
      if (current === undefined || IMPORTANCE_RANK[importance] > IMPORTANCE_RANK[current]) {
        profile[name] = importance;
      }
    }
  }
  return profile;
}

/**
 * What a job leans on, authored on the template or worked out from its shape.
 *
 * The default is the honest reading of the card: a battle is a fight, standard work is a haul and
 * some salvage, and the far band is a road whoever leads it. A template that says otherwise is
 * believed, and thirteen of them do.
 *
 * A third clause used to read the job's `stance`, adding stealth to standard work aimed at the
 * Combine and talk to anything done for it. That field is gone and the thirteen jobs it spoke for
 * now carry those leanings in writing, so the board a player sees is unchanged while the rule is
 * one a player can actually check: what a job wants is on the card, not in who it annoys.
 */
export function leaningsFor(
  template: Pick<MissionTemplate, 'kind' | 'travelBand'> & {
    leanings?: readonly MissionLeaning[] | undefined;
  },
): readonly MissionLeaning[] {
  if (template.leanings !== undefined && template.leanings.length > 0) return template.leanings;
  const leanings: MissionLeaning[] = template.kind === 'battle' ? ['fight'] : ['haul', 'salvage'];
  if (template.travelBand === 'furthest') leanings.push('road');
  return leanings;
}

// --- the leader's fit ---

export interface LeaderFit {
  /** Weighted attributes plus the band bonuses, the crew screen's own arithmetic. */
  readonly score: number;
  /** The same sum for a sheet at 100 in everything the job reads. */
  readonly max: number;
  /** `score / max`, 0 to 1. */
  readonly fit: number;
}

export function leaderFit(attributes: Attributes, profile: MissionProfile): LeaderFit {
  let score = 0;
  let max = 0;
  for (const name of ATTRIBUTE_NAMES) {
    const importance = profile[name];
    if (importance === undefined) continue;
    const value = Math.max(0, Math.min(MAX_ATTRIBUTE, attributes[name]));
    score += value * IMPORTANCE_WEIGHT[importance] + bandFor(value).bonus[importance];
    max += MAX_ATTRIBUTE * IMPORTANCE_WEIGHT[importance] + bandFor(MAX_ATTRIBUTE).bonus[importance];
  }
  return { score, max, fit: max === 0 ? 0 : score / max };
}

/**
 * The fit at which a leader neither helps nor hurts: a fresh recruit's sheet, at the
 * recruitment mean the Overseer's old edge was neutral at. Below it the odds go down.
 */
export const LEADER_NEUTRAL_FIT = 0.15;
/** The most a perfect leader adds to the odds, and the most a hopeless one takes off. */
export const MAX_LEADER_EDGE = 0.25;

/** A signed move on the odds, symmetric about the neutral fit, never past `MAX_LEADER_EDGE` either way. */
export function leaderEdge(fit: number): number {
  const clamped = Math.max(0, Math.min(1, fit));
  if (clamped >= LEADER_NEUTRAL_FIT) {
    return ((clamped - LEADER_NEUTRAL_FIT) / (1 - LEADER_NEUTRAL_FIT)) * MAX_LEADER_EDGE;
  }
  return ((clamped - LEADER_NEUTRAL_FIT) / LEADER_NEUTRAL_FIT) * MAX_LEADER_EDGE;
}

// --- going without one ---

/** What comes off the odds when a crew runs a job with nobody leading it, once that is allowed. */
export const UNLED_PENALTY = 0.1;

/** The two rungs on the research tree that open unled runs: penalised first, then free. */
export const RESEARCH_UNLED_PENALISED = 'tech_unled_runs';
export const RESEARCH_UNLED_FREE = 'tech_unled_runs_free';

export const UNLED_RULES = ['forbidden', 'penalised', 'free'] as const;
export const UnledRuleSchema = z.enum(UNLED_RULES);
export type UnledRule = z.infer<typeof UnledRuleSchema>;

/**
 * What a crew may do with nobody at the head of a run, off what it has finished.
 *
 * The first rung is the gate and the second only lifts what the first charges, so the second on
 * its own opens nothing. The track already refuses a rung whose predecessor is unfinished
 * (`researchItemRefusal`), which makes that state unreachable in play; spelling it here as well
 * means the rule survives a hand-edited save, an admin grant, or a retune that moves either rung,
 * rather than depending on a guarantee made in another module.
 */
export function unledRule(known: readonly string[]): UnledRule {
  if (!known.includes(RESEARCH_UNLED_PENALISED)) return 'forbidden';
  return known.includes(RESEARCH_UNLED_FREE) ? 'free' : 'penalised';
}

export type LeadRefusal = 'needs_leader';

// --- who is not free today ---

/**
 * What is holding a leader, when something is (maintainer, 2026-09-10).
 *
 * One reason, not a set: the four are alternatives in practice and a picker has one line to say
 * why. A person can only be in one place, so the first thing that holds them is the thing that
 * holds them, and the order the server asks in is the order in `officerDuty`.
 *
 * The four are the four doors a crew can send somebody through, plus the bed: leading a run,
 * leading a declared fight, out scouting, laid up. Each of the three dispatch routes refuses all
 * four, which is what makes this one enum rather than three private ones. The Overseer can only
 * ever be held by `run`: they are not on the books, so no fight and no scouting party can name
 * them, and §D4's injuries are an officer's.
 */
// `scouting` was a hold until 2026-09-22; a scout party takes nobody with it now.
export const LEADER_HOLDS = ['run', 'fight', 'injury'] as const;
export const LeaderHoldSchema = z.enum(LEADER_HOLDS);
export type LeaderHold = z.infer<typeof LeaderHoldSchema>;

/**
 * The reason in a sentence about a named person, which is how a route refuses one:
 * `${name} ${LEADER_HOLD_MESSAGES[held]}`. One table, so the launch, the fight and the scouting
 * party cannot describe the same officer three different ways.
 */
export const LEADER_HOLD_MESSAGES: Readonly<Record<LeaderHold, string>> = {
  run: 'is out leading a run',
  fight: 'is at a fight',
  injury: 'is still laid up',
};

/** The same four with no verb to hang on, for a label beside a name in a list. */
export const LEADER_HOLD_LABELS: Readonly<Record<LeaderHold, string>> = {
  run: 'out leading a run',
  fight: 'at a fight',
  injury: 'laid up',
};

export interface MissionOdds {
  /** Whether the run may go out at all under these terms. */
  readonly allowed: boolean;
  readonly refusal: LeadRefusal | null;
  /** The chance the run launches with, 0 to 1. Zero on a refused run. */
  readonly chance: number;
  /** What the leader moved the authored figure by, signed; the penalty on an unled run. */
  readonly edge: number;
}

/**
 * The odds a run goes out with: one function the card, the gauge and the launch all read.
 *
 * `authored` is the job's chance at this crew's level (`scaledSuccessChance`) before anybody is
 * considered. A leader moves it by their edge on the job's profile; no leader is refused, or
 * penalised, or free, by the crew's research.
 */
export function missionOdds(args: {
  authored: number;
  leader: Attributes | null;
  profile: MissionProfile;
  unled: UnledRule;
}): MissionOdds {
  const clamp = (chance: number) => Math.min(1, Math.max(0, chance));
  if (args.leader !== null) {
    const edge = leaderEdge(leaderFit(args.leader, args.profile).fit);
    return { allowed: true, refusal: null, chance: clamp(args.authored + edge), edge };
  }
  if (args.unled === 'forbidden')
    return { allowed: false, refusal: 'needs_leader', chance: 0, edge: 0 };
  const edge = args.unled === 'penalised' ? -UNLED_PENALTY : 0;
  return { allowed: true, refusal: null, chance: clamp(args.authored + edge), edge };
}

/** The best fit for a job among the leaders free to take it; ties go to the first named. */
export function bestLeader<T extends { id: string; attributes: Attributes }>(
  candidates: readonly T[],
  profile: MissionProfile,
): T | null {
  let best: T | null = null;
  let bestFit = -1;
  for (const candidate of candidates) {
    const { fit } = leaderFit(candidate.attributes, profile);
    if (fit > bestFit) {
      best = candidate;
      bestFit = fit;
    }
  }
  return best;
}

// --- the gauge ---

export const CHANCE_TONES = ['red', 'orange', 'yellow', 'green', 'blue'] as const;
export type ChanceTone = (typeof CHANCE_TONES)[number];

/** Five bands of twenty points: where the needle sits on the gauge. */
export function chanceTone(chance: number): ChanceTone {
  const clamped = Math.min(1, Math.max(0, chance));
  return CHANCE_TONES[Math.min(4, Math.floor(clamped * 5))] ?? 'red';
}

// --- battles ---

export const BATTLE_TIERS = ['skirmish', 'fight', 'siege'] as const;
export const BattleTierSchema = z.enum(BATTLE_TIERS);
export type BattleTier = z.infer<typeof BattleTierSchema>;

export const BATTLE_TIER_LABELS: Readonly<Record<BattleTier, string>> = {
  skirmish: 'A skirmish',
  fight: 'A fight',
  siege: 'A siege',
};

/** A battle job's tier, authored or read off its difficulty and distance. */
export function battleTierFor(
  template: Pick<MissionTemplate, 'kind' | 'difficulty' | 'travelBand'> & {
    battleTier?: BattleTier | undefined;
  },
): BattleTier | null {
  if (template.kind !== 'battle') return null;
  if (template.battleTier !== undefined) return template.battleTier;
  if (template.difficulty === 'easy') return 'skirmish';
  return template.travelBand === 'furthest' ? 'siege' : 'fight';
}

/**
 * A coarse yardstick for a force: what it hits with and what it can take, per unit.
 *
 * Only for the band on the card. The fight itself is the engine's, and the engine reads every
 * stat; this reads the two open figures a unit card prints large, which is what a player has in
 * front of them when they choose.
 */
export function fieldStrength(army: Army): number {
  return Object.entries(army).reduce((total, [unitId, count]) => {
    const unit = findUnit(unitId);
    if (!unit || count <= 0) return total;
    return total + count * (unit.stats.offense + unit.stats.vitality / 5);
  }, 0);
}

/**
 * What a tier fields, in the yardstick above, for a crew at level 1. A Razor is worth about 175
 * on it, so a skirmish is eight of them, a fight twenty and a siege forty-five.
 */
export const BATTLE_TIER_STRENGTH: Readonly<Record<BattleTier, number>> = {
  skirmish: 1_400,
  fight: 3_500,
  siege: 7_900,
};
/** How much harder every level makes the same job, the way the odds already scale. */
export const BATTLE_STRENGTH_PER_LEVEL = 0.04;

export function enemyStrength(tier: BattleTier, level: number): number {
  const at = Math.max(1, Math.trunc(level));
  return Math.round(BATTLE_TIER_STRENGTH[tier] * (1 + BATTLE_STRENGTH_PER_LEVEL * (at - 1)));
}

export const BATTLE_ODDS = ['low', 'moderate', 'good', 'very_high'] as const;
export const BattleOddsSchema = z.enum(BATTLE_ODDS);
export type BattleOdds = z.infer<typeof BattleOddsSchema>;

export const BATTLE_ODDS_LABELS: Readonly<Record<BattleOdds, string>> = {
  low: 'Low chance',
  moderate: 'Moderate chance',
  good: 'Good chance',
  very_high: 'Very high chance',
};

/**
 * The band, off the ratio of the force sent to what the job fields, with the leader's edge on
 * the fight's profile folded in as a share of the force. No number is ever printed for a battle.
 */
export function battleOdds(args: { ours: number; theirs: number; edge: number }): BattleOdds {
  if (args.theirs <= 0) return 'very_high';
  const ratio = (args.ours * (1 + args.edge)) / args.theirs;
  if (ratio < 0.7) return 'low';
  if (ratio < 1.0) return 'moderate';
  if (ratio < 1.5) return 'good';
  return 'very_high';
}
