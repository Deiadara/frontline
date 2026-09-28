import { z } from 'zod';
import {
  ATTRIBUTE_NAMES,
  MAX_ATTRIBUTE,
  type AttributeName,
  type Attributes,
} from './attributes.js';
import { IMPORTANCE_WEIGHT, bandFor, type AttributeImportance } from './crew/importance.js';
import type { MissionTemplate } from './missions.js';
import {
  OFFICER_MARKS,
  OFFICER_MARK_BAND,
  OFFICER_MARK_FLOOR,
  type OfficerMark,
} from './crew/marks.js';
import { gradeIndex, gradedChance, type Grade } from './missions.grade.js';
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
 * ## Every run has a leader
 *
 * The Overseer counts as one from the first day, and a run with nobody at its head does not go
 * (maintainer, 2026-09-28). A plain job's odds are the leader's grade for the job against the
 * job's own grade (`missionOdds`), so who leads is the whole question.
 *
 * ## Battles
 *
 * A battle job is not a roll against a number: the crew fights a force it cannot see, with the
 * real engine, and comes home with whoever stood or ran. What the screen can say beforehand is a
 * band, read off how the force sent compares with what the job's grade fields
 * (`GRADE_ENEMY_STRENGTH`): low, moderate, good, very high. The composition behind the band is the job's secret.
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
  // Ten more on 2026-09-28 (maintainer: more kinds of job, so more kinds of officer are useful).
  // Between them every attribute on the sheet is read by at least one job.
  'breach',
  'intel',
  'muscle',
  'escort',
  'con',
  'chrome',
  'climb',
  'parley',
  'repair',
  'plan',
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
  breach: 'Breaching',
  intel: 'Intel',
  muscle: 'Muscle',
  escort: 'Escort',
  con: 'A con',
  chrome: 'Chrome work',
  climb: 'A climb',
  parley: 'A parley',
  repair: 'Repairs',
  plan: 'A plan',
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
  breach:
    'Something has to come down. Chemistry makes the charge and engineering says where it goes.',
  intel: 'The answer is in the paperwork. Analysis finds it and intuition knows where to look.',
  muscle: 'Somebody needs leaning on. Intimidation does the talking and authority makes it stick.',
  escort:
    'Something has to arrive in one piece. Reflexes catch the trouble and toughness takes the rest.',
  con: 'Nobody can know who you are. Deception holds the story and improvisation saves it.',
  chrome:
    'The job is in somebody’s wiring. Cybernetics knows the hardware and medicine keeps them alive.',
  climb: 'The way in is up. Dexterity finds the holds and strength stays on them.',
  parley: 'Two sides are one word from shooting. Diplomacy keeps the room and empathy reads it.',
  repair:
    'Something is broken and has to work by morning. Craft fixes it and engineering knows why.',
  plan: 'It only works if it runs to the minute. Strategy draws it up and organisation keeps it.',
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
  breach: {
    chemistry: 'irreplaceable',
    engineering: 'essential',
    composure: 'useful',
    strength: 'useful',
  },
  intel: {
    analysis: 'irreplaceable',
    intuition: 'essential',
    encyclopedia: 'useful',
    logic: 'useful',
  },
  muscle: {
    intimidation: 'irreplaceable',
    authority: 'essential',
    strength: 'useful',
    resolve: 'useful',
  },
  escort: {
    reflexes: 'irreplaceable',
    toughness: 'essential',
    communication: 'useful',
    speed: 'useful',
  },
  con: {
    deception: 'irreplaceable',
    improvisation: 'essential',
    charisma: 'useful',
    craft: 'useful',
  },
  chrome: {
    cybernetics: 'irreplaceable',
    medicine: 'essential',
    craft: 'useful',
    analysis: 'useful',
  },
  climb: {
    dexterity: 'irreplaceable',
    strength: 'essential',
    speed: 'useful',
    composure: 'useful',
  },
  parley: {
    diplomacy: 'irreplaceable',
    empathy: 'essential',
    communication: 'useful',
    authority: 'useful',
  },
  repair: {
    craft: 'irreplaceable',
    engineering: 'essential',
    improvisation: 'useful',
    organization: 'useful',
  },
  plan: {
    strategy: 'irreplaceable',
    organization: 'essential',
    logic: 'useful',
    authority: 'useful',
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
 * What a job leans on. Authored on every template since the catalogue was regraded (2026-09-28);
 * the default reading off kind and distance went with it, because 300 jobs read off three facts
 * would have leaned on the same three things.
 */
export function leaningsFor(
  template: Pick<MissionTemplate, 'leanings'>,
): readonly MissionLeaning[] {
  return template.leanings;
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

// --- nobody goes unled ---

/*
 * Every run has a leader (maintainer, 2026-09-28). There used to be two research rungs that let a
 * crew run a job with nobody at its head, first at a penalty and then without one; the grade
 * system reads the leader's grade for the job, and a run with nobody to grade has nothing to read.
 * The Overseer leads from the first day, so the rule costs a new crew nothing.
 */

export type LeadRefusal = 'needs_leader';

// --- who is not free today ---

/**
 * What is holding a leader, when something is (maintainer, 2026-09-10).
 *
 * One reason, not a set: a picker has one line to say why. The first thing that holds them is the
 * thing that holds them, and the order the server asks in is the order in `officerDuty`.
 *
 * Leading a run, leading a declared fight, laid up, and on the bench. Every dispatch door refuses
 * all of them, which is what makes this one enum rather than a private one per door. The Overseer
 * can only ever be held by `run`: they are not on the books, so no fight can name them, §D4's
 * injuries are an officer's, and the player has no chair to be out of.
 */
// `scouting` was a hold until 2026-09-22; a scout party takes nobody with it now. `bench` is
// 2026-09-28: an officer with no chair leads nothing until they are given one.
export const LEADER_HOLDS = ['run', 'fight', 'injury', 'bench'] as const;
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
  bench: 'is on the bench. Give them a chair first',
};

/** The same four with no verb to hang on, for a label beside a name in a list. */
export const LEADER_HOLD_LABELS: Readonly<Record<LeaderHold, string>> = {
  run: 'out leading a run',
  fight: 'at a fight',
  injury: 'laid up',
  bench: 'on the bench',
};

export interface MissionOdds {
  /** Whether the run may go out at all: it needs a leader. */
  readonly allowed: boolean;
  readonly refusal: LeadRefusal | null;
  /** The chance the run launches with, 0 to 1. Zero on a refused run. */
  readonly chance: number;
  /** The leader's grade for this job, or null with nobody leading. */
  readonly leaderMark: OfficerMark | null;
  /** How many marks the leader's grade is over the job's (under is negative), fractional. */
  readonly margin: number;
}

/**
 * A leader's grade for a job, as a fractional index on the mark ladder (maintainer, 2026-09-28).
 *
 * The same reading a role mark is (`crew/marks.ts`): the attributes the job leans on, averaged by
 * how much it leans on each, put on the scale a role score is. Not the leader's mark on any track
 * they hold; a brilliant medic is an F on a climb.
 *
 * Centred on the band, so a leader whose score sits in the middle of the B+ band reads as B+
 * exactly and the even case in `gradedChance` is the middle of the band, not its floor.
 */
export function leaderGradeIndex(attributes: Attributes, profile: MissionProfile): number {
  let total = 0;
  let weight = 0;
  for (const name of ATTRIBUTE_NAMES) {
    const importance = profile[name];
    if (importance === undefined) continue;
    const value = Math.max(0, Math.min(MAX_ATTRIBUTE, attributes[name]));
    total += value * IMPORTANCE_WEIGHT[importance];
    weight += IMPORTANCE_WEIGHT[importance];
  }
  const points = weight === 0 ? OFFICER_MARK_FLOOR : total / weight;
  return (points - OFFICER_MARK_FLOOR) / OFFICER_MARK_BAND - 0.5;
}

/** The same, as the mark a card prints. */
export function leaderMark(attributes: Attributes, profile: MissionProfile): OfficerMark {
  const index = Math.round(leaderGradeIndex(attributes, profile));
  return OFFICER_MARKS[Math.min(OFFICER_MARKS.length - 1, Math.max(0, index))]!;
}

/**
 * The odds a run goes out with: one function the card, the gauge and the launch all read.
 *
 * The leader's grade for the job against the job's own grade (`gradedChance`). No leader is a
 * refusal: every run has one.
 */
export function missionOdds(args: {
  grade: Grade;
  leader: Attributes | null;
  profile: MissionProfile;
}): MissionOdds {
  if (args.leader === null) {
    return { allowed: false, refusal: 'needs_leader', chance: 0, leaderMark: null, margin: 0 };
  }
  const margin = leaderGradeIndex(args.leader, args.profile) - gradeIndex(args.grade);
  return {
    allowed: true,
    refusal: null,
    chance: gradedChance(margin),
    leaderMark: leaderMark(args.leader, args.profile),
    margin,
  };
}

/**
 * The best leader for a job among those free to take it; ties go to the first named.
 *
 * Ranked on the leader's grade for the job (`leaderGradeIndex`), which is what the odds read and
 * what the picker prints beside each name. It ranked on `leaderFit`, whose band bonuses the odds
 * never see, so about one pick in fifty was somebody the picker itself graded lower, and the
 * "most suitable leader" button and the Right Hand's own choice lowered the odds they were
 * meant to raise.
 */
export function bestLeader<T extends { id: string; attributes: Attributes }>(
  candidates: readonly T[],
  profile: MissionProfile,
): T | null {
  let best: T | null = null;
  let bestGrade = -Infinity;
  for (const candidate of candidates) {
    const grade = leaderGradeIndex(candidate.attributes, profile);
    if (grade > bestGrade) {
      best = candidate;
      bestGrade = grade;
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
