import { z } from 'zod';
import { MAX_ATTRIBUTE, type AttributeName, type Attributes } from '../attributes.js';
import type { UnitSpec, UnitStats } from '../units/index.js';

/**
 * An officer on the field (GDD §D, buildings-and-combat patch).
 *
 * Officers were a crew sheet and a book of perks: nineteen people whose thirty-five ratings were
 * cashed as district-wide percentages and never as a body standing anywhere. This is the other
 * half. One officer may lead a battle or a mission, and when they do their own sheet is folded
 * into eleven combat numbers and they fight in the line like anything else in the roster.
 *
 * ## The mapping is a table, not a formula
 *
 * {@link OFFICER_STAT_FORMULAS} is the design surface: a weighted sum of named attributes per
 * battle stat, transcribed from the board's table. Two properties are load-bearing and both are
 * pinned by `officer.test.ts`:
 *
 * - **Every capped stat reaches its cap.** The weights of each 0..100 stat sum to exactly 1.0, so
 *   an officer with a full sheet reads 100 in it. A stat whose weights summed to 0.85 would be a
 *   ceiling nobody could touch, which is a different (and worse) game than the one the table
 *   describes.
 * - **Armour and Range are the deliberate exceptions.** Their formulas would reach 100 and are
 *   held at {@link OFFICER_ARMOR_CAP} and {@link OFFICER_RANGE_CAP}. An officer is a person, not a
 *   Juggernaut, and they are not carrying a crew-served weapon.
 *
 * ## And the result is a unit
 *
 * {@link officerUnit} builds a one-body `UnitSpec` so the engine needs no second code path: the
 * officer is allocated fire, takes damage, breaks or holds, and is read by the same matchup table
 * as everybody else. Two rules make them not-quite-a-unit and both live in `engine.ts`: they are
 * half as likely to be shot at while anybody else is standing (§D3), and they are excluded from
 * every casualty ledger because they never die (§D4).
 */

/** Points of armour an officer can reach, whatever their Toughness. A person, not a wall. */
export const OFFICER_ARMOR_CAP = 30;

/** ...and points of range. An officer carries a sidearm, not a crew-served weapon. */
export const OFFICER_RANGE_CAP = 20;

/** How a fractional result is turned into the integer `UnitStatsSchema` demands. */
export type OfficerRounding = 'ceil' | 'round';

export interface OfficerStatFormula {
  /** Attribute weights. The sum times {@link MAX_ATTRIBUTE} is the formula's ceiling. */
  weights: Partial<Record<AttributeName, number>>;
  /** The 0..100 clamp, or `null` for the two open figures (damage and hit points). */
  cap: number | null;
  rounding: OfficerRounding;
  /** A hard minimum applied after rounding. Only vitality has one: see the table. */
  floor?: number;
}

/** The battle stats an officer's sheet decides. The rest are constants: see {@link officerUnit}. */
export const OFFICER_STAT_KEYS = [
  'offense',
  'vitality',
  'speed',
  'armor',
  'range',
  'stealth',
  'morale',
  'penetration',
  'evasion',
  'intimidation',
] as const;
export type OfficerStatKey = (typeof OFFICER_STAT_KEYS)[number];

/**
 * The board's table, transcribed weight for weight.
 *
 * Read it as "how much of which attribute". `offense` and `vitality` are on the open scale the
 * roster's damage and hit points use, so their weights are greater than one and they carry no cap;
 * every other row is a 0..100 rating whose weights sum to exactly 1.0.
 */
export const OFFICER_STAT_FORMULAS: Readonly<Record<OfficerStatKey, OfficerStatFormula>> = {
  /** `ceil(Strength * 1.5 + Dexterity)`. Open scale: a full sheet reads 250. */
  offense: { weights: { strength: 1.5, dexterity: 1 }, cap: null, rounding: 'ceil' },
  /**
   * `Toughness * 2 + Stamina * 0.5`. Open scale: a full sheet reads 250.
   *
   * Floored at 1 because `UnitStatsSchema.vitality` is a positive integer and a sheet of zeroes is
   * a legal `Attributes`. A one-hit-point officer is a schema guard rather than a design: the
   * recruitment mean of 15 already produces 38.
   */
  vitality: { weights: { toughness: 2, stamina: 0.5 }, cap: null, rounding: 'round', floor: 1 },
  speed: { weights: { speed: 0.75, stamina: 0.25 }, cap: 100, rounding: 'round' },
  /** Toughness, held at {@link OFFICER_ARMOR_CAP}. One of the two deliberate exceptions. */
  armor: { weights: { toughness: 1 }, cap: OFFICER_ARMOR_CAP, rounding: 'round' },
  /** ...and the other, held at {@link OFFICER_RANGE_CAP}. */
  range: {
    weights: { dexterity: 0.75, improvisation: 0.25 },
    cap: OFFICER_RANGE_CAP,
    rounding: 'round',
  },
  stealth: {
    weights: { stealth: 0.65, improvisation: 0.15, deception: 0.1, reflexes: 0.1 },
    cap: 100,
    rounding: 'round',
  },
  morale: {
    weights: { resolve: 0.5, composure: 0.25, leadership: 0.25 },
    cap: 100,
    rounding: 'round',
  },
  penetration: {
    weights: { intuition: 0.15, strength: 0.5, logic: 0.15, strategy: 0.1, analysis: 0.1 },
    cap: 100,
    rounding: 'round',
  },
  evasion: {
    weights: { reflexes: 0.6, intuition: 0.1, composure: 0.3 },
    cap: 100,
    rounding: 'round',
  },
  intimidation: { weights: { intimidation: 0.75, authority: 0.25 }, cap: 100, rounding: 'round' },
};

/**
 * The two stats deliberately held below the rating they could reach.
 *
 * Named rather than inferred, so the "every capped stat reaches its cap" test has something to
 * exempt them *by name*. Inferring the exceptions from the numbers would make the test agree with
 * whatever the table happened to say, which is the one thing it exists not to do.
 */
export const OFFICER_HELD_BACK_STATS: readonly OfficerStatKey[] = ['armor', 'range'];

/** What a formula produces at {@link MAX_ATTRIBUTE} across the board, before its cap is applied. */
export function officerStatCeiling(stat: OfficerStatKey): number {
  const { weights } = OFFICER_STAT_FORMULAS[stat];
  const sum = Object.values(weights).reduce((total, weight) => total + (weight ?? 0), 0);
  return sum * MAX_ATTRIBUTE;
}

/** One stat, from a sheet. Rounded and clamped, because `UnitStatsSchema` takes integers only. */
export function officerStat(stat: OfficerStatKey, attributes: Attributes): number {
  const formula = OFFICER_STAT_FORMULAS[stat];
  let raw = 0;
  for (const [name, weight] of Object.entries(formula.weights)) {
    raw += attributes[name as AttributeName] * (weight ?? 0);
  }
  const whole = formula.rounding === 'ceil' ? Math.ceil(raw) : Math.round(raw);
  const capped = formula.cap === null ? whole : Math.min(formula.cap, whole);
  return Math.max(formula.floor ?? 0, capped);
}

/**
 * An officer's sheet as eleven combat numbers.
 *
 * The three fields the table does not mention are constants and say why here rather than in ten
 * call sites: an officer hits with a sidearm (`ballistic`, the roster's own default), resists
 * nothing in particular, and carries nothing home. Loot is a truck's job and the officer is not
 * counted in the force that fills one.
 */
export function officerBattleStats(attributes: Attributes): UnitStats {
  return {
    speed: officerStat('speed', attributes),
    vitality: officerStat('vitality', attributes),
    morale: officerStat('morale', attributes),
    armor: officerStat('armor', attributes),
    damageType: 'ballistic',
    resistances: {},
    penetration: officerStat('penetration', attributes),
    range: officerStat('range', attributes),
    offense: officerStat('offense', attributes),
    evasion: officerStat('evasion', attributes),
    stealth: officerStat('stealth', attributes),
    lootCapacity: 0,
    intimidation: officerStat('intimidation', attributes),
  };
}

/** The officer a side sent, as the engine is handed them. */
export interface BattleOfficer {
  officerId: string;
  name: string;
  attributes: Attributes;
}

/**
 * The prefix on a synthesised officer's unit id.
 *
 * Deliberately a string `findUnit` can never resolve, so an officer id that leaks into a casualty
 * map or a roster write is inert rather than silently crediting somebody a unit. Every ledger in
 * the engine skips officer stacks; this is the second lock on the same door.
 */
export const OFFICER_UNIT_PREFIX = 'officer:';

export function isOfficerUnitId(unitId: string): boolean {
  return unitId.startsWith(OFFICER_UNIT_PREFIX);
}

/**
 * The officer as a one-body unit.
 *
 * `specialist` rather than `legendary`, so a tier-scoped bonus a crew bought for its specialists
 * reaches the person leading them, and so an officer never lands in the report's legend paragraph,
 * which is about one-of-a-kind machines. No modifiers: an officer brings perks (§D5), and a
 * modifier is a thing a *sheet* carries.
 */
export function officerUnit(officer: BattleOfficer): UnitSpec {
  return {
    id: `${OFFICER_UNIT_PREFIX}${officer.officerId}`,
    name: officer.name,
    tier: 'specialist',
    blurb: 'Leading from the line.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [],
    cost: {},
    trainSeconds: 0,
    supply: 0,
    stats: officerBattleStats(officer.attributes),
    modifiers: [],
  };
}

/**
 * The share of incoming fire an officer draws, against a unit of equal threat (§D3).
 *
 * Half, and only while somebody else on their side is still standing. A crew that sends its Head
 * of Security in alone does not get to hide them behind nobody.
 */
export const OFFICER_TARGET_SHARE = 0.5;

// --- injury (§D4) ---

/** How long an injured officer's services and bonuses are off. The board's number. */
export const OFFICER_INJURY_HOURS = 24;

/** Injury odds at an even fight, before the day's margin moves them. */
export const OFFICER_INJURY_BASE_CHANCE = 0.45;

/** How far a decisive result moves them, per point of margin. */
export const OFFICER_INJURY_MARGIN_WEIGHT = 0.45;

export const MIN_OFFICER_INJURY_CHANCE = 0.02;
export const MAX_OFFICER_INJURY_CHANCE = 0.9;

/**
 * How decisively a side came out, −1 (wiped by an untouched enemy) to +1 (untouched, enemy wiped).
 *
 * The difference of the two surviving shares rather than one side's casualties, because injury is
 * about how the fight *went*, not about how big it was: a crew that lost a third of its people
 * while wiping the other side had a good day, and a crew that lost a third against an enemy who
 * lost nothing did not.
 */
export function battleMargin(ownSurvivingShare: number, enemySurvivingShare: number): number {
  const margin = ownSurvivingShare - enemySurvivingShare;
  return Math.min(1, Math.max(-1, margin));
}

/**
 * The chance the officer leading this side comes home hurt, given the margin.
 *
 * Falls as the win gets more decisive and rises as the loss does, which is the board's rule in one
 * line. Never zero and never certain: a stray round is always possible, and an officer who is
 * guaranteed to be hurt by a bad day is an officer nobody sends twice.
 */
export function officerInjuryChance(margin: number): number {
  const raw = OFFICER_INJURY_BASE_CHANCE - OFFICER_INJURY_MARGIN_WEIGHT * margin;
  return Math.min(MAX_OFFICER_INJURY_CHANCE, Math.max(MIN_OFFICER_INJURY_CHANCE, raw));
}

/**
 * Whether the officer comes home injured.
 *
 * Two ways in, and the first is not a roll. An officer whose body was taken off the field *would
 * have died*, and the board's rule is that the worst thing that happens to them is a stretcher, so
 * that case is settled rather than chanced. Everybody else rolls against the margin.
 */
export function officerInjured(fell: boolean, margin: number, roll: number): boolean {
  return fell || roll < officerInjuryChance(margin);
}

/** When an officer hurt now is back on their feet. */
export function officerRecoveryAt(now: Date): string {
  return new Date(now.getTime() + OFFICER_INJURY_HOURS * 3_600_000).toISOString();
}

/**
 * Whether this officer is currently out (§D4).
 *
 * A lazily settled timestamp, like every other clock in the game: nothing has to run for an
 * officer to come back, and a crew nobody has looked at for a week is exactly as recovered as one
 * that was watched.
 */
export function officerIsInjured(injuredUntil: string | null | undefined, now: Date): boolean {
  return injuredUntil != null && Date.parse(injuredUntil) > now.getTime();
}

/** Seconds until they are back, floored at zero. What a countdown reads off. */
export function officerRecoverySeconds(injuredUntil: string | null | undefined, now: Date): number {
  if (injuredUntil == null) return 0;
  return Math.max(0, Math.round((Date.parse(injuredUntil) - now.getTime()) / 1000));
}

/** What one side's officer did, and what it cost them. Null on a side nobody led. */
export const OfficerOutcomeSchema = z.object({
  officerId: z.string().min(1),
  name: z.string(),
  /** Taken off the field. They do not die: this is what {@link officerInjured} settles on. */
  fell: z.boolean(),
  /** Damage they put out across the fight, rounded. */
  damage: z.number().nonnegative(),
});
export type OfficerOutcome = z.infer<typeof OfficerOutcomeSchema>;

/** What the report says about the officer who led, once injury has been settled. */
export const OfficerReportSchema = OfficerOutcomeSchema.extend({
  /** §D4: they came home hurt, and this side gets no report because of it. */
  injured: z.boolean(),
});
export type OfficerReport = z.infer<typeof OfficerReportSchema>;
