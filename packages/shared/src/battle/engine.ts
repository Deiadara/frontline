import {
  envLabel,
  labelEffectPercent,
  labelText,
  noTerritoryEffects,
  type CombinePower,
  type TerritoryEffects,
} from '../city/index.js';
import {
  capRating,
  findUnit,
  findUnitModification,
  isCombatUnit,
  fittedFor,
  upgradedStats,
  UNIT_RULES,
  type Army,
  type FittedUpgrades,
  type UnitLoadouts,
  type UnitSpec,
  type UnitStats,
} from '../units/index.js';
import { bareBattlefield, type Battlefield } from './battlefield.js';
import { bareLineRules, fightingSlots, markedUnit, standsInLine, type LineRules } from './line.js';
import { packBonusPercent } from '../units/collective.js';
import { effectiveStats, OUTNUMBERED_RATIO, type Effective } from './effects.js';
// Kept exported from here because every caller in the game imports the engine's own names for
// these, and they are the engine's rules: the module split is about the import graph, not about
// where they belong.
export { bareLineRules, fightingSlots, markedUnit, standsInLine, type LineRules };
// Collective moved to a leaf so `raid.ts` can spend the same curve on carry without a cycle.
// Re-exported here because every caller of the offense half already imports it from the engine.
export { MAX_PACK_BONUS, PACK_HALF, packBonusPercent } from '../units/collective.js';
import { exchange, threatWeight } from './matchup.js';
import {
  moraleDelta,
  moraleState,
  PURSUIT_LOSS,
  type MoraleShock,
  type MoraleState,
} from './morale.js';
import { drawLuck } from './luck.js';
import {
  OFFICER_TARGET_SHARE,
  officerUnit,
  type BattleOfficer,
  type OfficerOutcome,
} from './officer.js';
import { mulberry32, seedFrom } from '../rng.js';

/**
 * The fight itself.
 *
 * One commitment, one resolution, one report: the player sets a force and reads what happened,
 * the way Grepolis and Tribal Wars work. Underneath it is a **round simulation** rather than a
 * single formula, which is the split most auto-resolvers land on: a formula can tell you that you
 * lost and a simulation can tell you *that the Snipers never got a shot off*, and the second is
 * what makes a defeat worth reading and a roster worth thinking about.
 *
 * Four properties are load-bearing and each is pinned by a test:
 *
 * - **Deterministic.** Every draw comes from one seeded stream, so a fight replays from the string
 *   on its battle row for as long as the code is unchanged.
 * - **Simultaneous.** Both sides fire from the same snapshot, so nothing wins by being first in an
 *   array: the single most common way a round loop develops a silent bias.
 * - **Calibrated.** With counters, morale and terrain neutral it reproduces the industry reference
 *   curve in `attrition.ts`. That is what keeps tuning honest.
 * - **Bounded.** It always terminates, and it always terminates with somebody holding the ground.
 */

/** A fight is decided on the day. Past this, the stronger remaining force takes it. */
export const MAX_ROUNDS = 12;

/**
 * Fraction of a defender's health pool one round of a matched attacker's offense removes.
 *
 * Tuned by measurement, not derived. It sets how long a fight runs, and everything about how a
 * report reads follows from that, but it is also not a free dial. Too high and the loser is wiped
 * in one round before it fires back, which makes winning nearly free; too low and morale decides
 * the fight before casualties matter, which makes it a coin flip. Both failure modes were measured
 * on the way to a 4:1 running two rounds and a near-even fight running six or seven.
 *
 * **It has to move whenever damage and hit points are rescaled against each other**, because a
 * round removes `offense / vitality` of a pool and nothing else here reads either number in
 * absolute terms. Damage went to a 0..700 scale and hit points to 0..1000, which is three times
 * the damage per point of health the roster used to carry, so this is a third of the 0.2 it was
 * tuned to. Same fights, same lengths, bigger figures on the sheet.
 */
export const ROUND_DAMAGE_SCALE = 0.2 / 3;

/**
 * How much massing units is worth beyond the units themselves: Lanchester's square law, weighted
 * by how much of the force can actually concentrate its fire.
 *
 * Ranged units get the full edge and melee gets none, which is Lanchester's original observation:
 * aimed fire from a distance can be concentrated on one target, and men with blades can only fight
 * the man in front of them. It is also what makes the reference curve's `^1.5` come out of a round
 * loop that is otherwise linear.
 */
export const CONCENTRATION_EDGE = 0.28;

/** Concentration never turns a numbers advantage into a rout on its own. */
export const MAX_CONCENTRATION = 1.6;

/**
 * The share of a side that is actually in contact, given the ground's frontage.
 *
 * Combat width (`battlefield.ts`). Units past the frontage are queuing, not fighting: they cannot
 * shoot, though they are still there to absorb losses and to rotate forward as the front rank
 * falls. The rotation needs no code of its own and never did: this is recomputed every round off
 * who is *still fighting*, so as the front rank falls the queue behind it becomes the front rank
 * and the side goes on firing at the width of the ground. Measured on open ground (frontage 48),
 * 300 Razors against 60 won every seed and walked away with 287 of them.
 *
 * Which is worth knowing when tuning: depth is already staying power, so "bring five times as
 * many" is free. The cap holds a deep side's *output* at the width of the ground while its pool
 * goes on growing without limit. An attempt to price that was tried and reverted; the note below
 * this one says what happened and why the fire is the wrong lever.
 */
export function engagedUnits(side: SideState, frontage: number): number {
  return Math.min(fighting(side), Math.max(1, effectiveFrontage(side, frontage)));
}

/**
 * The most a crew's own co-ordination can widen the ground it is fighting on.
 *
 * Capped at half again, because a corridor is a corridor. Cohesion is a real answer to combat width
 * and it is deliberately not a complete one: a crew that solves overstacking by hiring an organiser
 * would put the mechanic back where it was before frontage existed.
 */
export const MAX_COHESION_WIDTH = 1.5;

/** This side's usable frontage: the ground's, widened by what the crew can co-ordinate. */
export function effectiveFrontage(side: SideState, frontage: number): number {
  return frontage * Math.min(MAX_COHESION_WIDTH, 1 + Math.max(0, side.cohesionPercent) / 100);
}

/**
 * An overstack penalty was tried here and reverted (maintainer, 2026-09-18). Do not re-add it
 * without reading this.
 *
 * The idea was Hearts of Iron IV's: combat width caps output, so add a price for exceeding it.
 * What shipped took a share of the attacker's fire, 15 points per frontage-worth of excess to a
 * ceiling of 45, charged to the attacker alone so that a choke point would favour whoever held it.
 * Measured afterwards, it failed in both directions at once.
 *
 * **It did not make depth cost anything.** 300 attackers against 60 on open ground won all 60
 * seeds either way, losing 5.9 men with the penalty and 13 without. At 3000 against 60 the penalty
 * cost 1.4 men. Soak scales with the pool and has no ceiling, the fire cut has one, and a fight
 * ends on a morale cascade in two or three rounds before a fire cut can compound.
 *
 * **And it made even fights unwinnable.** Identical armies on identical ground, attacker wins out
 * of 60: 48 v 48 went 30, 96 v 96 went 9, and **150 v 150 and 300 v 300 both went 0**. On ground
 * narrower than the roster, no unit could win an even attack at all. Cohesion, the advertised
 * counter, does not reach it: past four times the width the penalty is pinned at its ceiling and
 * widening the ground by half cannot bring it back under.
 *
 * A symmetric version was measured too and is not the answer either: it restores fairness
 * (150 v 150 back to 14 of 60) and leaves depth exactly as free, while giving up the one thing the
 * attacker-only version bought, since a choke stops favouring its holder (40 v 40 in a corridor
 * went from 0 of 60 to 32).
 *
 * If depth is to cost something, the lever is not the fire. It is the soak, or a cap that grows
 * with the excess rather than stopping at a constant.
 */

/**
 * How much a side's fire is worth this round, as a fraction of what its whole strength would be.
 *
 * Applied to each stack's contribution rather than to the side's total, so a force that is over the
 * frontage loses output evenly across its stacks instead of arbitrarily silencing whichever
 * happened to be last in the array.
 */
export function frontageShare(side: SideState, frontage: number): number {
  const standing = fighting(side);
  return standing <= 0 ? 0 : engagedUnits(side, frontage) / standing;
}

/**
 * What an ambush is worth: one opening exchange before the defender is in position.
 *
 * The `ambush` sheet was, until now, a second `urban_bonus` with a different name: same context,
 * same arithmetic, no reason to prefer one over the other. This is what it was always supposed to
 * mean, and it is the only combat use `stealth` has: a stack gets its opening strike in proportion
 * to how much of the force can hide and how badly the other side can see.
 *
 * Deliberately a *fraction* of a round rather than a whole one. A free round is a coin flip decided
 * before the fight starts, which is the thing every design note on first-strike mechanics warns
 * about.
 */
export const AMBUSH_ROUND_SHARE = 0.6;

/**
 * What an Opening Volley is worth, as a share of one round's fire (`UnitSpec.strikes_first`).
 *
 * Deliberately smaller than {@link AMBUSH_ROUND_SHARE}. An ambush is the attacker's alone, it is
 * paid for in stealth, and a side that can see gets most of it back; this one is on the sheet, both
 * sides get it, and nothing the enemy brings turns it off. A volley that cannot be prevented has to
 * be worth less than one that can, or the counterplay stops being worth buying.
 *
 * Sized against the strongest thing on the same surface. `bulwark` is +70% toughness on one sheet
 * and `tracking` is +45% damage against an evasive target, both of which are worth more than a
 * third of a round to the stacks that carry them; this is under both and it is unconditional.
 */
export const FIRST_STRIKE_SHARE = 0.35;

/**
 * The share of an attacking line that has to be sappers before the works come down as far as they
 * are going to (`UnitSpec.sapper`).
 *
 * A quarter, which is {@link MEND_FULL_COVER}'s ratio and for the same reason: how much a
 * speciality is worth depends on how big the line it is working for is, so this is a ratio and not
 * a rate. Four Demolishers in a raiding party of sixteen bring the whole wall down as far as it
 * goes; four in a party of a hundred bring a sixth of it.
 */
export const SAPPER_FULL_SHARE = 0.25;

/**
 * The most of a defender's fortification a sapping line can take away, as a percentage of it.
 *
 * Forty per cent of the works, never the works themselves. Fortification is the whole return on a
 * barricade and a Gate, and a sheet that could cancel it would make every defensive structure in
 * the game a purchase you regret the first time somebody brings the right unit. What this buys is
 * that a dug-in defender is a problem with an answer, which is what `penetration` is to armour and
 * `tracking` is to evasion.
 */
export const MAX_SAPPER_CUT = 40;

/**
 * The share of a line that has to be jammers before the jam is as deep as it goes
 * (`UnitSpec.jammer`).
 *
 * A quarter, which is {@link SAPPER_FULL_SHARE}'s ratio and {@link MEND_FULL_COVER}'s, and for
 * the same reason: what a speciality is worth depends on the size of the line it is working for.
 * Four Netrunners in a party of sixteen jam the other side as hard as they are going to; four in
 * a party of a hundred manage a sixth of it.
 */
export const JAM_FULL_SHARE = 0.25;

/**
 * The most a jamming line takes off the other side, in percentage points of armour and of damage.
 *
 * **Measured, not reasoned to.** The first draft was 25, chosen against {@link MAX_SAPPER_CUT}
 * on the argument that a jam buys two things at once (the enemy's armour *and* their damage) so
 * a point of it should be worth about two of a sapper's. That argument was wrong, and the way it
 * was wrong is worth keeping: 25 made a Netrunner a bad trade at every size. Equal slots a side,
 * one army spending some of them on Netrunners and the other spending all of them on the line,
 * over 200 seeds each way round, against a mirror baseline that sits at 49/51:
 *
 * | jam | 2 Netrunners in 60 slots of Snipers | 2 in 80 slots of Breakers |
 * | --- | --- | --- |
 * | 25 | 22% / 17% | 40% / 47% |
 * | 40 | **50% / 49%** | **56% / 59%** |
 * | 50 | 76% / 73% | 68% / 71% |
 * | 70 | 99% / 99% | 85% / 88% |
 *
 * Forty, where a small detachment pays for the slots it takes off the line and nothing more.
 * Over-investing still loses: four of them read 40/42 and six read 9/14, which is the shape this
 * should have. A jammer is somebody you bring a couple of, beside a line, and never the line.
 *
 * There is no counter to it on any sheet: no armour, no resistance, no saving roll. The only
 * answer is to kill them, and {@link jamPercent} is read fresh every round so killing them works
 * on the next one.
 */
export const MAX_JAM = 40;

/**
 * The hard ceiling on a jam once the ground has had its say.
 *
 * {@link MAX_JAM} is what a full jamming line is worth *in nominal conditions*. The ground moves
 * it (see {@link jamCondition}), and a Netrunner in a crammed unlit basement with the Lab's
 * programmes behind it can be worth half again what the sheet says. This is the stop on that: the
 * jam answers to no stat on the receiving sheet, so an uncapped multiplier would eventually be a
 * unit that turns the other side's armour off. Sixty, which is half again the nominal maximum: a
 * speciality is allowed to be the answer to something and never allowed to be the end of it.
 */
export const MAX_JAM_CEILING = 60;

/** Per-round swing, the Grepolis "luck" idea at a tighter spread so it averages out over a fight. */
export const ROUND_LUCK = 0.12;

/** ...and a single roll for the whole fight, which does not average out. This one is the story. */
export const BATTLE_LUCK = 0.1;

export interface Stack {
  unit: UnitSpec;
  effective: Effective;
  /** Units still standing. */
  alive: number;
  /** Health pool, `alive × vitality` at full strength. */
  pool: number;
  morale: number;
  /** The round it broke, or null while it is still fighting. */
  brokeAt: number | null;
  /** Units that started the fight: the denominator for every casualty figure. */
  started: number;
  /**
   * This stack's offense on its own sheet, refits folded in and the ground left out.
   *
   * The denominator {@link jamPercent} measures a situation against: `effective.offense` over
   * this is exactly what the ground, the weather and the crew's percentages did to the unit, and
   * nothing else. Stored rather than recomputed because the fitted list is only in hand while
   * the stack is being built.
   *
   * It has to be the *upgraded* sheet, not the catalogue's, and that is the whole reason this
   * field exists. The workshop's refits are flat points of offense (Guided Rounds is +72), which
   * is a rounding error on a Sniper's 350 and a **4.6x multiplier** on a Netrunner's 20. Read
   * against the catalogue figure, the cheapest scope in the game took a jamming line from 40% to
   * the hard ceiling on its own, and the three refits that fit the sheet were indistinguishable
   * from one another. Read against the upgraded sheet the refit cancels, which is the honest
   * answer: a better gunsight makes a unit shoot better, and how well it is *jamming* is a
   * question about where it is standing.
   *
   * The whole sheet rather than the one figure, because `noiseOnEnemy` needs the rest of it:
   * what a racket costs a unit is decided by its armour and its morale as well
   * (`labelEffectPercent`), and those have to be the fitted numbers for the same reason the
   * offense does.
   */
  sheet: UnitStats;
  /**
   * How many tiers of `noisy` this stack puts on the enemies it is fighting, or 0 (`UnitSpec.loud`).
   *
   * On the stack rather than read off the unit, because a refit can deepen it: the Stereo Rig
   * takes the Anodics from Noisy II to Noisy IV, and a refit is a fact about *these* Anodics
   * rather than about the sheet. See {@link noiseOnEnemy}.
   */
  loudTier: number;
  /**
   * Units too intimidated to fight, set once before the first shot and never revisited (§D3).
   *
   * See {@link intimidate}. They are still *present*: they stand in the line, they take their share of
   * incoming fire, they count for frontage and for the roster that walks home. What they do not do
   * is shoot. That is the whole of the mechanic, and it is deliberately not a morale penalty or a
   * damage multiplier: those already exist and this is meant to read as men who would not advance.
   */
  suppressed: number;
  /**
   * Damage this stack has put out across the whole fight, opening strike included.
   *
   * Accumulated rather than derived, because there is nowhere to derive it from: fire is split
   * across every enemy stack and applied from a shared snapshot, so by the time the round is over
   * the only record of who did what is the one kept while it was happening. It is what
   * `battle/analysis.ts` reads to say which of your units actually earned their unit slots.
   */
  dealt: number;
  /**
   * §D1: this stack is the officer leading the side, not a unit off the roster.
   *
   * One unit, and three rules follow from the flag. They draw {@link OFFICER_TARGET_SHARE} of the
   * fire an equally threatening unit would (§D3); they are skipped by every casualty ledger, so no
   * synthesised id ever reaches an `Army` map the server writes back to a roster; and falling here
   * means injured rather than dead (§D4, settled by `officerInjured`).
   */
  officer?: BattleOfficer;
  /**
   * A stack of the *attacker's* units fighting for the defender under Directive Xero
   * (`changeOfHeart`). Three rules follow from the flag: it is not the winner's to recover, it is
   * not the loser's to rout, and whatever is left of it at the end is reported in
   * `Simulation.turnedAlive` for the settle to stand on the ground it fought for.
   */
  turncoat?: boolean;
}

export interface SideSetup {
  name: string;
  army: Army;
  defending: boolean;
  territory?: TerritoryEffects;
  /**
   * What this side has bolted to each unit, three slots apiece (`units/loadout.ts`).
   *
   * Per unit rather than per side: two crews with the same nine upgrades built can field very
   * different Razors, and folding one flat list onto every sheet would throw that away.
   */
  upgrades?: UnitLoadouts;
  /** §A5 teamwork: how much of a force too big for the ground can be brought to bear anyway. */
  cohesionPercent?: number;
  /**
   * §D1: the one officer leading this side, or absent. Leading is optional and never more than one.
   *
   * Handed over as a sheet rather than as stats, so the attribute table in `battle/officer.ts` is
   * the only place a sheet is ever turned into combat numbers.
   */
  officer?: BattleOfficer;
  /**
   * The Combine legendary this side fights under (`city/combine.ts`, maintainer 2026-09-19).
   *
   * The leader's *power*, not the leader: he is a unit in `army` on the one plot he stands on,
   * and this is the shadow he casts over every Combine defence in his district while he lives.
   * Three powers, and each is applied at the one place in the fight it belongs to:
   *
   *   * `syndic` in {@link applyPresence}, as flat points on the Combine's own sheets and nothing
   *     on the attacker's, because it is a fact about the units as they stand on this ground.
   *   * `executioner` after every {@link applyDamage} on the enemy, because it is a fact about
   *     what an exchange leaves behind ({@link execute}).
   *   * `directive_xero` where §D3 settles who is intimidated, because it *is* §D3 with the sign turned
   *     round ({@link changeOfHeart}).
   */
  presence?: CombinePower;
}

export interface SideState {
  name: string;
  stacks: Stack[];
  defending: boolean;
  /** The battle-wide damage swing (`BATTLE_LUCK`). Not the same thing as {@link SideState.luck}. */
  swing: number;
  /**
   * The day's luck, −5.0 … +5.0 in tenths (`luck.ts`).
   *
   * Drawn *after* both forces are built, so it cannot be planned around. Distinct from `swing`,
   * which is a damage multiplier: this one moves critical strikes and who gets away, and nothing
   * else.
   */
  luck: number;
  /**
   * §A5: the teamwork channel (`crew/effects.ts`), as a percentage on this side's usable frontage.
   *
   * The only bonus in the game whose worth depends on how many people you brought: it does nothing
   * at all to a force that already fits on the ground, and it is the difference between a hundred
   * and a hundred *fighting* when the ground is a corridor.
   */
  cohesionPercent: number;
  /**
   * Whether a stack breaking on this side can shake the ones beside it (`steady_nerve`).
   *
   * On the side rather than on the sheet, because that is what it is: the cascade is a fact about a
   * line watching itself come apart, and a rule that made one stack immune while the stack next to
   * it caught the panic would be describing something else. Lifted off `TerritoryEffects` in
   * `simulate`, beside `cohesionPercent`, which reaches the engine the same way and for the same
   * reason.
   */
  steadyNerve: boolean;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * Units still willing to fight: a broken stack is on the field but not in the battle.
 *
 * There used to be a `standingUnits` beside this that counted the routed too. Its last two callers
 * were the outnumbered ratio in `moralePhase`, and both of them were the 2026-09-17 bug: nothing
 * in the engine wants that reading, so the function went with the fix rather than sitting here
 * inviting the next one.
 */
export const fighting = (side: SideState): number =>
  side.stacks.reduce((total, stack) => total + (stack.brokeAt === null ? stack.alive : 0), 0);

/**
 * A side's standing, used to break a fight that runs out of rounds and to feed the reference curve.
 *
 * The geometric mean of what it can deal and what it can take. Either alone is a bad summary: raw
 * offense says a stack of Snipers beats a shield wall, raw health says the shield wall beats
 * everything, and the geometric mean is the smallest thing that says neither.
 */
export function sidePower(side: SideState): number {
  let offense = 0;
  let durability = 0;
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null) continue;
    offense += stack.alive * stack.effective.offense;
    durability += stack.pool;
  }
  return Math.sqrt(Math.max(0, offense) * Math.max(0, durability));
}

/** The share of a side that can concentrate its fire, 0..1: see {@link CONCENTRATION_EDGE}. */
function rangedShare(side: SideState): number {
  let weighted = 0;
  let total = 0;
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null) continue;
    // Clamped, because this function promises a share. `upgradedStats` holds range to 100 so a
    // sheet cannot arrive above it, and this is the engine refusing to produce a fraction greater
    // than one whatever it is handed: they are different statements and both are worth making.
    weighted += stack.alive * (Math.min(100, Math.max(0, stack.effective.range)) / 100);
    total += stack.alive;
  }
  return total === 0 ? 0 : weighted / total;
}

/** Average intimidation across a side's live units: what the other side has to look at. */
function intimidation(side: SideState): number {
  let weighted = 0;
  let total = 0;
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null) continue;
    weighted += stack.alive * stack.effective.intimidation;
    total += stack.alive;
  }
  return total === 0 ? 0 : weighted / total;
}

/**
 * §D3: the men who will not advance, decided before a shot is fired.
 *
 * A side's total nerve is the morale of every unit in it; the pressure against it is the
 * intimidation of every unit opposite. Where the pressure is the greater, the difference is spent
 * buying silence, cheapest first: the steadiest troops hold, and it is the ones who were already
 * wavering who put their heads down.
 *
 * Worked example, which is the board's own. One side fields two units at 10 morale and one at 20,
 * so its nerve is 40. The other side fields one unit at 60 intimidation. The excess is 20, and 20
 * buys exactly the two units at 10: they do not fire. The unit at 20 would cost the whole
 * remaining budget and there is none left, so it fights.
 *
 * Three things this is not, each of them a thing it was tempting to make it:
 *
 *   * Not a *rate*. Both quantities are sums over units, so a big army has proportionally more
 *     nerve and a big army projects proportionally more menace. Averaging either would make one
 *     terrifying unit intimidate a legion.
 *   * Not per round. It is settled once, from the opening rosters, so it cannot spiral: a side
 *     that loses units does not become progressively easier to intimidate by the same enemy.
 *   * Not symmetric-in-sequence. Both sides are measured against the *starting* numbers before
 *     either is silenced, so the order the two are computed in cannot change the answer.
 *
 * Units are silenced whole. Fractional suppression would be a damage multiplier wearing a
 * costume, and the maintainer asked for men who do not attack.
 */
export function nerve(side: SideState): number {
  return side.stacks.reduce(
    (total, stack) => total + stack.alive * Math.max(0, stack.effective.morale),
    0,
  );
}

/** The menace a side projects: the intimidation of every unit in it. See {@link intimidate}. */
export function menace(side: SideState): number {
  return side.stacks.reduce(
    (total, stack) => total + stack.alive * Math.max(0, stack.effective.intimidation),
    0,
  );
}

/**
 * Silences the shakiest units on `side`, given the menace opposite it.
 *
 * Returns how many units were silenced, which is what the report needs to explain the round to a
 * player who is wondering why half their line did nothing.
 */
/**
 * The most of a line §D3 can silence, however loud the other side is.
 *
 * Three quarters, and the number is chosen against the doc above rather than picked round: its
 * worked example silences two units of three, so anything under 0.67 would have made the design's
 * own illustration impossible. At 0.75 that example still lands and a quarter of every line always
 * shoots back, which is what "the steadiest troops hold" has to mean to be worth writing down.
 */
export const MAX_INTIMIDATED_SHARE = 0.75;

/**
 * Who §D3 silences on `side` against this much menace, and how many of each, before it is done.
 *
 * The plan and the doing are split because two callers want the plan and only one wants the
 * doing: {@link intimidate} silences the units it names, and {@link changeOfHeart} moves them across the
 * line instead. Both read the same ceiling and the same cheapest-first order, so what Directive
 * Xero takes is exactly what any other menace would have silenced, no more.
 */
function intimidatePlan(side: SideState, against: number): Map<Stack, number> {
  const plan = new Map<Stack, number>();
  let budget = against - nerve(side);
  if (budget <= 0) return plan;

  // Cheapest nerve first. A unit with no morale at all costs nothing to silence, so it is taken
  // before anything that has to be paid for, and the loop cannot stall on it.
  const order = [...side.stacks]
    .filter((stack) => stack.alive > 0)
    .sort((a, b) => a.effective.morale - b.effective.morale);

  /*
   * §D3's ceiling: however loud the other side is, some of this one shoots back (2026-09-17).
   *
   * Both quantities are sums over units, so the comparison scales with the *difference* in size
   * rather than the ratio, and past about three to one the budget stops being a budget. Measured
   * on the shipped sheets, a force of 745 against 220 with a +30 intimidation bonus silenced 220 of
   * 220: the whole defending army, for the whole fight, settled from the opening rosters before a
   * shot, with nothing the defender could do about it after the fact.
   *
   * That is the shape every other ceiling in this engine exists to prevent. `MAX_MEND_SHARE` says
   * a hospital may not cancel a round; `MAX_HELD_DEFENSE` says no amount of building makes a
   * district untakeable; `MAX_CONCENTRATION` says a numbers edge may not compound into
   * annihilation. This was the one lever with no such line, and the doc above already promises the
   * behaviour a ceiling gives: "the steadiest troops hold".
   *
   * Counted over the units standing rather than per stack, so which stacks a force is written in
   * cannot change how much of it can be silenced.
   */
  const ceiling = Math.floor(
    order.reduce((total, stack) => total + stack.alive, 0) * MAX_INTIMIDATED_SHARE,
  );

  let silenced = 0;
  for (const stack of order) {
    if (budget <= 0 || silenced >= ceiling) break;
    const each = Math.max(0, stack.effective.morale);
    const affordable = each === 0 ? stack.alive : Math.floor(budget / each);
    const take = Math.min(stack.alive, affordable, ceiling - silenced);
    if (take <= 0) continue;
    plan.set(stack, take);
    budget -= take * each;
    silenced += take;
  }
  return plan;
}

export function intimidate(side: SideState, against: number): number {
  let silenced = 0;
  for (const [stack, take] of intimidatePlan(side, against)) {
    stack.suppressed = take;
    silenced += take;
  }
  return silenced;
}

/**
 * Directive Xero's Change of Heart (`city/combine.ts`, maintainer 2026-09-19).
 *
 * The units §D3 would have intimidated on `side` do not stand in their own line with their heads down.
 * They walk across it. Each is taken off its stack (alive, started and pool alike, so nothing
 * downstream counts it as a casualty of the side it left) and stood on `to` as a stack of its own,
 * flagged `turncoat`, at the morale ceiling he gives everybody else. It keeps its own sheet: the
 * Syndic's points are not his to give, and a turned Razor is still a Razor.
 *
 * Returns how many crossed, which is the figure the report prints where it would have printed
 * the intimidated. `ledger` is the by-unit count the settle takes them off the attacker's books with;
 * they are his for good, whichever way the fight goes.
 */
function changeOfHeart(
  side: SideState,
  to: SideState,
  against: number,
  morale: number,
  ledger: Army,
): number {
  let turned = 0;
  // Held inside the bar here rather than trusted from the caller, for the reason `applyPresence`
  // gives: this figure comes off the power's own field and a turncoat's morale is a 0..100 rating
  // like everybody else's.
  const standAt = capRating(morale);
  for (const [stack, take] of intimidatePlan(side, against)) {
    if (stack.officer) continue; // §D1: an officer is one person, and not one who changes sides.
    const vitality = stack.effective.vitality;
    // The whole bodies leave first; the wounded one at the front stays with its own side.
    const whole = Math.min(take, Math.max(0, Math.floor(stack.pool / vitality)));
    if (whole <= 0) continue;
    stack.alive -= whole;
    stack.started -= whole;
    stack.pool -= whole * vitality;
    to.stacks.push({
      ...stack,
      effective: {
        ...stack.effective,
        morale: standAt,
        reasons: [...stack.effective.reasons, 'Changed sides'],
      },
      alive: whole,
      started: whole,
      pool: whole * vitality,
      morale: standAt,
      brokeAt: null,
      suppressed: 0,
      dealt: 0,
      turncoat: true,
    });
    ledger[stack.unit.id] = (ledger[stack.unit.id] ?? 0) + whole;
    turned += whole;
  }
  return turned;
}

/**
 * The leader's power on the **defence's** sheets (`SideSetup.presence`), applied once, before §D3.
 *
 * Syndic: flat points on the Combine's own penetration and armour, and nothing at all on the
 * attacker's sheet (maintainer, 2026-09-20). The opening power also carried +20 morale and took 20
 * armour off everything sent against the ground; both are gone, and the second is why this takes
 * one side rather than two. Directive Xero: the Combine's line at the morale ceiling.
 * The Executioner changes no sheet; he is applied per exchange in {@link execute}. A reason is
 * pushed on every sheet touched, so the report can say why a Greycoat held where a Greycoat
 * would not have.
 *
 * `capRating` rather than a local `Math.min(100, ...)`: the maintainer's rule of 2026-09-15 is a
 * hard 100 on every rating whatever adds to it, and `units/stats.ts` is the one place that rule
 * is written down.
 */
function applyPresence(defender: SideState, presence: CombinePower | undefined): void {
  if (!presence) return;
  if (presence.kind === 'syndic') {
    for (const stack of defender.stacks) {
      stack.effective.penetration = capRating(stack.effective.penetration + presence.penetration);
      stack.effective.armor = capRating(stack.effective.armor + presence.armor);
      stack.effective.reasons = [...stack.effective.reasons, 'The Syndic'];
    }
  }
  if (presence.kind === 'directive_xero') {
    // Through `capRating` like the Syndic's two lines above, and for the same rule. His figure is
    // an assignment rather than a sum, which is exactly why the ceiling is easy to leave off it:
    // a power written at 140 would have stood a line 40 points past the end of the morale bar,
    // and §D3, `moraleState` and the report all read that number as a 0..100 rating.
    const morale = capRating(presence.morale);
    for (const stack of defender.stacks) {
      stack.effective.morale = morale;
      stack.effective.reasons = [...stack.effective.reasons, 'Directive Xero'];
      stack.morale = morale;
    }
  }
}

/**
 * The Executioner (`city/combine.ts`): what an exchange leaves under his threshold does not live.
 *
 * A stack is whole bodies plus one wounded unit at the front (`pool` against `vitality`). After
 * every exchange on `side`, a wounded front unit under `threshold` of a life is finished: the
 * pool loses the remainder and the stack loses the body. At most one per stack per exchange, on
 * the wounded unit only, which is what "falls below the line from an attack" means in a model
 * that has no second wounded unit to look at. Global: every stack opposite him, whether or not it
 * is trading shots with the stack he stands in, because he is a rule about the field and not a
 * matchup.
 *
 * Returns the loss fraction per stack the way {@link applyDamage} does, so the round folds it
 * into the same morale reading as the fire that did the wounding. `count` takes the bodies for
 * the report, **by unit id**: who he finished matters as much as how many, because a body he
 * finished is not one an Infirmary gets to hand back (`Simulation.executedForce`).
 */
export function execute(
  side: SideState,
  presence: CombinePower | undefined,
  count: (unitId: string, finished: number) => void,
): Map<Stack, number> {
  const lost = new Map<Stack, number>();
  if (presence?.kind !== 'executioner') return lost;
  for (const stack of side.stacks) {
    if (stack.alive <= 0 || stack.officer) continue; // §D4: an officer falls injured, not finished.
    const vitality = stack.effective.vitality;
    const wounded = stack.pool - (stack.alive - 1) * vitality;
    if (wounded <= 0 || wounded >= vitality * presence.threshold) continue;
    const before = stack.alive;
    stack.pool -= wounded;
    stack.alive -= 1;
    if (stack.suppressed > 0) {
      stack.suppressed = Math.min(
        stack.alive,
        Math.round((stack.suppressed * stack.alive) / before),
      );
    }
    count(stack.unit.id, 1);
    lost.set(stack, 1 / before);
  }
  return lost;
}

/** Of the turncoats on `side`, what is still standing, by unit id (`Simulation.turnedAlive`). */
function turncoatsStanding(side: SideState): Army {
  const standing: Army = {};
  for (const stack of side.stacks) {
    if (stack.turncoat !== true || stack.alive <= 0) continue;
    standing[stack.unit.id] = (standing[stack.unit.id] ?? 0) + stack.alive;
  }
  return standing;
}

/**
 * What a porter standing in the line is worth, against what it would be as a fighter.
 *
 * Half, and the half is what stops `carriers_fight` making the cheapest sheet in the game the best
 * one: a Scavenger costs a fraction of a Razor and there is no slot ceiling on porters worth
 * speaking of. Applied to damage and to hit points both, so a crew that turns its porters out gets
 * units on the ground rather than a second army.
 */
export const CARRIER_STRENGTH = 0.5;

/**
 * How much of the defender's fortification this attacking force takes down, as a percentage of it.
 *
 * Read off the raw roster rather than off the built stacks, which matters: `simulate` builds the
 * two sides in sequence, and a cut computed from one side's finished stacks would depend on which
 * of them happened to be built first. Porters are skipped for the same reason they are skipped
 * everywhere else, they are not on the line.
 */
export function sapperCutPercent(army: Army, rules: LineRules = bareLineRules()): number {
  let sappers = 0;
  let line = 0;
  for (const [unitId, count] of Object.entries(army)) {
    const found = findUnit(unitId);
    if (!found || (count ?? 0) <= 0 || !standsInLine(found, rules)) continue;
    const unit = markedUnit(found, rules);
    line += count ?? 0;
    if (unit.sapper === true) sappers += count ?? 0;
  }
  if (sappers <= 0 || line <= 0) return 0;
  return MAX_SAPPER_CUT * Math.min(1, sappers / (line * SAPPER_FULL_SHARE));
}

/**
 * How hard this side is jamming the other **this round**, in percentage points.
 *
 * Read off the stacks still standing rather than off the roster, which is the whole difference
 * between this and {@link sapperCutPercent}: a wall stays down once it is down, and a hijacked
 * augmentation comes back the moment the person holding it is dead. A side that has lost its
 * Netrunners is jamming nobody by the next round, and a side whose Netrunners have broken and run
 * (`brokeAt`) is not jamming either, because they are not there.
 *
 * The share is of the line, not of the roster: the units standing in this fight. Suppressed units
 * still count, on both sides of the ratio, because a intimidated jammer is still inside the enemy's
 * systems even if it is not shooting, and `suppressed` is about fire.
 */
export function jamPercent(side: SideState): number {
  let jammers = 0;
  let condition = 0;
  let line = 0;
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null || stack.alive <= 0) continue;
    line += stack.alive;
    if (stack.unit.jammer !== true) continue;
    jammers += stack.alive;
    condition += stack.alive * jamCondition(stack);
  }
  if (jammers <= 0 || line <= 0) return 0;
  const share = Math.min(1, jammers / (line * JAM_FULL_SHARE));
  // The mean across the jamming stacks, weighted by how many of each are standing, so two
  // different jamming sheets on one side average rather than the last one read winning.
  return Math.min(MAX_JAM_CEILING, MAX_JAM * share * (condition / jammers));
}

/**
 * The jam as it stood when the lines formed, before anybody had been shot off it.
 *
 * `jamPercent` reads the stacks *now*, which is what a round wants and the wrong question for a
 * report or a feat: both are asking what this crew brought, not what was left of it at the end.
 * Built by handing `jamPercent` a copy of the side with everybody back on their feet rather than
 * by keeping a second copy of the arithmetic, so the figure a player is shown and the figure a
 * feat is paid on are the one the rounds were actually fought at.
 */
export function openingJam(side: SideState): number {
  return jamPercent({
    ...side,
    stacks: side.stacks.map((stack) => ({ ...stack, alive: stack.started, brokeAt: null })),
  });
}

/**
 * How well this jamming stack is doing where it is standing, as a multiplier on its jam
 * (maintainer, 2026-09-18).
 *
 * "Make sure the eerie and crammed bonuses apply to the Netrunners' tag too, not just their
 * attack and defence, as this is their main form of hitting the enemy."
 *
 * A jammer's offense is twenty. Every percentage the game spends on making a unit hit harder was
 * therefore landing on a number that does not matter, which would have made a Netrunner the one
 * sheet in the roster that a crammed room, an unlit night or a finished Lab programme did
 * nothing for. So the jam is scaled by exactly the factor those things moved its offense by:
 * `effective.offense` over {@link Stack.sheetOffense}, which is one ratio carrying the ground's
 * labels, this unit's affinities to them (`crammed: 5`, `eerie: -4`), the weather, its Night
 * Operations and the crew's percentage channels. Nothing has to be listed here, and nothing
 * added to any of those tables tomorrow will be forgotten.
 *
 * Two things are deliberately **not** in it. `tracking` and the other `vs_` modifiers are
 * decided against a particular target inside `matchup.ts`, and a jam is laid on the whole enemy
 * line at once, so there is no one target to read them against. The workshop's refits are
 * excluded by the denominator rather than by a rule here: see {@link Stack.sheetOffense} for the
 * measurement that made that necessary.
 */
function jamCondition(stack: Stack): number {
  // A sheet with no offense at all has no ratio to take. Nominal is the honest reading of that,
  // and no jammer in the catalogue is in that position today.
  const sheet = stack.sheet.offense;
  return sheet > 0 ? Math.max(0, stack.effective.offense / sheet) : 1;
}

/**
 * How loud a side with the Anodics in it makes the round, in tiers of `noisy`.
 *
 * Two, which is what a stormy sky puts on every location in the city (`WEATHER_LABELS.stormy`
 * carries `noisy 2`). The right size for a comparison: the Anodics turn the fight around them
 * into the sort of racket the weather manages on a bad day, and the label's own machinery decides
 * what that is worth to each sheet on the other side.
 */
export const LOUD_NOISE_TIER = 2;

/**
 * A per-round effect one side lays on the enemy stacks it is **actually fighting**.
 *
 * The general mechanic, and it is general on purpose (maintainer, 2026-09-19: "make it so that
 * the engine can apply effects for a round only if certain units participate, because I want to
 * make this a mechanic for other units too"). `loud` is the first user of it and is not meant to
 * be the last, so what follows is written as machinery rather than as the Anodics' rule.
 *
 * ## What "actually fighting" means here
 *
 * Every stack spreads its fire across every live enemy stack (`allocate`), weighted by threat, so
 * there is no binary "these two are engaged" in this engine and inventing one would be a second
 * targeting model running beside the first. What there *is* is a share: how much of a stack's
 * attention lands on each enemy.
 *
 * So exposure is the fraction of the fire coming at an enemy stack that is coming from the units
 * producing the effect. A stack the Anodics are pouring everything into is deep in the noise; a
 * stack off fighting the rest of the line barely hears it; a stack nobody is shooting at, or one
 * facing a side whose Anodics are dead, suppressed or broken, hears nothing at all. That is the
 * scoping the maintainer asked for, expressed in the terms the engine already has.
 *
 * ## Why it is not the battlefield
 *
 * It used to be: the label went onto the copy of the battlefield the enemy's stacks were built
 * against, once, for the whole fight. That is wrong in exactly the way the maintainer named. It
 * reached a stack that never traded a shot with an Anodic, it went on reaching it after every
 * Anodic was dead, and it could not vary round to round as the fight moved.
 */
export interface FieldEffect {
  /** Percentage points off the stack's offense, for this round only. */
  readonly percent: number;
  /** What did it, for the report and for anybody debugging a number. */
  readonly reason: string;
}

/**
 * How many tiers of `noisy` a loud unit puts out with these refits fitted.
 *
 * The base is {@link LOUD_NOISE_TIER} and a card may raise it: `UnitModificationSpec.noiseTier`
 * is the ceiling that card sets, not an amount added, so fitting two of them is the deeper of the
 * two rather than the sum. That matches how the tier reads on the field (see `loudestTier`): two
 * sets of speakers in one room is one loud room.
 */
export function loudTierFor(fitted: FittedUpgrades): number {
  return fitted.reduce(
    (tier, card) => Math.max(tier, findUnitModification(card)?.noiseTier ?? 0),
    LOUD_NOISE_TIER,
  );
}

/**
 * Whether a stack is in the fight this round at all: alive, unbroken, and not wholly intimidated.
 *
 * One predicate, used by everything in this section, and that is deliberate rather than tidy.
 * The liveness test was written twice for a while, once in `fieldExposure` and once in the walk
 * that takes the tier, and the two covered each other so completely that deleting either one
 * changed no behaviour and broke no test. A rule nothing can be shown to depend on is a rule
 * nobody can be sure is still there.
 */
function inTheFight(stack: Stack): boolean {
  if (stack.brokeAt !== null || stack.alive <= 0) return false;
  return Math.max(0, stack.alive - stack.suppressed) > 0;
}

/** What one stack of a producing unit is worth as a round effect, or 0 if it produces none. */
function fieldTierOf(stack: Stack): number {
  return stack.unit.loud === true ? stack.loudTier : 0;
}

/**
 * How much of the fire landing on each enemy stack comes from units producing a field effect.
 *
 * Returns the *exposure* (0..1) per enemy stack, keyed the way `fireRound` keys its own maps. The
 * weights are the same ones the damage loop spends (`firing x share`), so a stack's exposure and
 * the damage it is taking come out of one model rather than two that agree by inspection.
 */
export function fieldExposure(side: SideState, enemy: SideState): Map<Stack, number> {
  const from = new Map<Stack, number>();
  const all = new Map<Stack, number>();
  let producing = false;

  for (const stack of side.stacks) {
    if (!inTheFight(stack)) continue;
    const firing = Math.max(0, stack.alive - stack.suppressed);
    const tier = fieldTierOf(stack);
    if (tier > 0) producing = true;
    for (const { target, share } of allocate(stack, enemy.stacks)) {
      const weight = firing * share;
      all.set(target, (all.get(target) ?? 0) + weight);
      if (tier > 0) from.set(target, (from.get(target) ?? 0) + weight);
    }
  }

  const exposure = new Map<Stack, number>();
  // Nothing on this side is producing, which is almost every fight: no allocation, no map walk.
  if (!producing) return exposure;
  for (const [target, total] of all) {
    if (total <= 0) continue;
    const mine = from.get(target) ?? 0;
    if (mine <= 0) continue;
    exposure.set(target, Math.min(1, mine / total));
  }
  return exposure;
}

/**
 * The deepest racket any *live* producing stack on this side is making, in tiers.
 *
 * The maximum rather than a sum: two stacks of Anodics in one line are not twice as loud as one,
 * they are the same room. What a refit buys is depth (`Stack.loudTier`), and the loudest thing
 * on the field is what everybody hears.
 */
function loudestTier(side: SideState): number {
  let tier = 0;
  for (const stack of side.stacks) {
    if (!inTheFight(stack)) continue;
    tier = Math.max(tier, fieldTierOf(stack));
  }
  return tier;
}

/**
 * This round's noise, as percentage points off each enemy stack's offense.
 *
 * Two readings multiplied: what `noisy` at this tier is worth to *that sheet*
 * (`labelEffectPercent`, so a Cyber Dog on -7 a tier suffers and a Colossus barely notices), and
 * how much of the fight that sheet is having with the units making the noise.
 *
 * Only the negative half is taken. A sheet that *likes* noise, which is the Anodics' own
 * `affinities.noisy: 11`, must not be handed a bonus by an enemy turning up with speakers: a
 * field effect is something done *to* the other side, and one that healed half the roster would
 * be a weapon nobody would bring.
 */
export function noiseOnEnemy(side: SideState, enemy: SideState): Map<Stack, FieldEffect> {
  const tier = loudestTier(side);
  const out = new Map<Stack, FieldEffect>();
  if (tier <= 0) return out;
  const label = envLabel('noisy', tier);
  for (const [target, exposure] of fieldExposure(side, enemy)) {
    const worth = labelEffectPercent(target.sheet, target.unit, label);
    if (worth >= 0) continue;
    // `-worth` rather than `Math.abs(worth)`: the guard above has already established the sign,
    // and an abs here would quietly turn a *liked* label into a penalty of the same size if that
    // guard ever went. Measured: the Anodics read +26 at Noisy II, so the masking version would
    // have hit an enemy Anodic for 26 points for enjoying itself.
    const percent = -worth * exposure;
    if (percent <= 0) continue;
    out.set(target, { percent, reason: `${labelText(label)} (${Math.round(exposure * 100)}%)` });
  }
  return out;
}

/** The ground as the defender actually finds it, once the attacker's sappers have been at it. */ /** The ground as the defender actually finds it, once the attacker's sappers have been at it. */
export function sappedGround(
  battlefield: Battlefield,
  attacking: Army,
  rules: LineRules = bareLineRules(),
): Battlefield {
  const cut = sapperCutPercent(attacking, rules);
  if (cut <= 0) return battlefield;
  return { ...battlefield, fortifyPercent: battlefield.fortifyPercent * (1 - cut / 100) };
}

/** Whether this stack keeps standing at a morale that would rout anybody else (`stalwart`). */
export function holdsTheLine(stack: Stack): boolean {
  return stack.unit.stalwart === true && stack.alive * 2 > stack.started;
}

/** Whether anything on this side gets a shot away before the lines form (`strikes_first`). */
export function opensFire(side: SideState): boolean {
  return side.stacks.some(
    (stack) => stack.unit.strikes_first === true && stack.alive > 0 && stack.brokeAt === null,
  );
}

function buildStacks(
  army: Army,
  battlefield: Battlefield,
  defending: boolean,
  outnumbered: boolean,
  territory: TerritoryEffects,
  upgrades: UnitLoadouts,
  /** §D1: the officer leading, appended as a one-unit stack after the roster. */
  officer?: BattleOfficer,
): Stack[] {
  const stacks: Stack[] = [];
  for (const [unitId, count] of Object.entries(army)) {
    const found = findUnit(unitId);
    /*
     * The porters are not in the line, and the rule lives **here** rather than at the doors.
     *
     * `combat: false` is a hard rule: a Scavenger is never put in a battle line, never draws fire
     * and contributes nothing to either side of an exchange. Three server doors already refuse to
     * *send* one (`isFightingForce`, and `isCombatUnit` in `deploy.ts`), and every one of them
     * guards a force the attacker chose. Nothing guarded the side that does not choose: a defender
     * fights with whatever is standing in their district, so a raided crew put its porters in the
     * rank and buried them. Measured before this line existed: 25 Breakers against a crew holding
     * 20 Razors, 40 Scavengers and 30 Haulers killed 24 of the Scavengers and 23 of the Haulers.
     *
     * At the engine there is no door to forget. A force that is *only* porters simply has no line,
     * which is the correct reading of the rule rather than a special case: there is nobody there to
     * fight, so the other side walks in.
     */
    if (!found || count <= 0 || !standsInLine(found, territory)) continue;
    const unit = markedUnit(found, territory);
    const fitted = fittedFor(upgrades, unitId);
    const fittedSheet = upgradedStats(unit.stats, fitted);
    const bare = effectiveStats(unit, battlefield, { defending, outnumbered }, territory, fitted);
    /*
     * `pack` is the one bonus that cannot be worked out from a sheet (`UnitSpec.pack`).
     *
     * `effectiveStats` is handed one unit and the ground it is standing on; it has no idea how many
     * of them turned up, and giving it the count would make every other caller invent one. So it is
     * folded here, where the roster row is, and it lands on the same `Effective` struct as
     * everything else so the report can name it beside the terrain reasons.
     */
    /*
     * §A5: the *fighter's* reading of Collective, and only a fighter's.
     *
     * A carrier with the mark spends it on carry instead (`carriedBy` in `raid.ts`), which is
     * the maintainer's rule: "instead of their combat stats, their loot increases". Without this
     * clause a crew holding `carriers_fight` would collect both halves off one tag, which is a
     * rule that reads as one thing on the card and pays twice in the fight.
     */
    const packed = unit.pack === true && isCombatUnit(unit) ? packBonusPercent(count) : 0;
    // A porter turned out under `carriers_fight` fights at half of what it is. Applied to the two
    // figures the exchange reads, and after the pack bonus, so the halving is of the finished
    // number rather than of the sheet: there is no order of these two that is not this one.
    const turnedOut = isCombatUnit(unit) ? 1 : CARRIER_STRENGTH;
    const effective =
      packed > 0 || turnedOut < 1
        ? {
            ...bare,
            offense: bare.offense * (1 + packed / 100) * turnedOut,
            vitality: bare.vitality * turnedOut,
            reasons: [
              ...bare.reasons,
              ...(packed > 0 ? [UNIT_RULES.pack.label] : []),
              ...(turnedOut < 1 ? ['Turned out to fight'] : []),
            ],
          }
        : bare;
    stacks.push({
      unit,
      effective,
      alive: count,
      pool: count * effective.vitality,
      morale: effective.morale,
      brokeAt: null,
      started: count,
      suppressed: 0,
      dealt: 0,
      // The sheet as the workshop left it, before the ground is read: see `Stack.sheet`.
      sheet: fittedSheet,
      // §A5: how loud this particular stack is, refits included (`UnitSpec.loud`).
      loudTier: unit.loud === true ? loudTierFor(fitted) : 0,
    });
  }

  /*
   * And the officer, last, so a side's own roster keeps the order it was written in.
   *
   * Built through `effectiveStats` like everything else: the ground, the weather, the crew's own
   * offense channel and a tier bonus for specialists all reach them, which is what "fights as a
   * normal unit" has to mean if it means anything. Fitted upgrades do not, because the id is not a
   * roster id and nothing is bolted to a person.
   */
  if (officer) {
    const unit = officerUnit(officer);
    const effective = effectiveStats(unit, battlefield, { defending, outnumbered }, territory);
    stacks.push({
      unit,
      effective,
      alive: 1,
      pool: effective.vitality,
      morale: effective.morale,
      brokeAt: null,
      started: 1,
      suppressed: 0,
      dealt: 0,
      // Nothing is bolted to a person, so an officer's sheet is its own (see the note above).
      sheet: unit.stats,
      // An officer is a person, not a PA system.
      loudTier: 0,
      officer,
    });
  }
  return stacks;
}

/** The officer's stack on this side, or undefined when nobody led. */
export function officerStackOf(side: SideState): Stack | undefined {
  return side.stacks.find((stack) => stack.officer !== undefined);
}

/**
 * What the officer on this side did, for the settler that has to decide about a stretcher (§D4).
 *
 * `fell` is the whole question: a unit taken off the field is somebody who *would have died*, and
 * the maintainer's rule is that the worst thing that happens to an officer is an injury.
 */
export function officerOutcomeOf(side: SideState): OfficerOutcome | null {
  const stack = officerStackOf(side);
  if (!stack?.officer) return null;
  return {
    officerId: stack.officer.officerId,
    name: stack.officer.name,
    fell: stack.alive <= 0,
    damage: Math.round(stack.dealt),
  };
}

/**
 * The share of a stack's fire a taunting enemy pulls onto itself while it is standing.
 *
 * Not all of it, deliberately. "Attack them first" is the promise, and a floor of three quarters
 * keeps it: the wall is what the enemy is dealing with, and the quarter that leaks past is forty
 * people making their own decisions under fire, which is the same reason `allocate` splits at all.
 * Total focus would make a single Ironside a wall of invulnerability for everything behind it, and
 * a taunt that cannot be played around is not a tactic, it is a tax.
 */
export const TAUNT_PULL = 0.75;

/**
 * How one stack splits its fire across the enemy's stacks.
 *
 * Weighted by {@link threatWeight}, so the counter system decides targeting rather than a rule
 * saying it should. Fire is *split* rather than focused on the single best target, because a stack
 * of forty is forty people making their own decisions: total focus would make every fight a
 * sequence of clean executions and would reward a single hard counter far past what it is worth.
 *
 * **A taunting stack breaks that split** (`UnitSpec.taunts`). It takes {@link TAUNT_PULL} of the
 * incoming fire off the top and the rest of the enemy line divides what is left, which is what
 * makes a shield wall a shield wall: threat weight is damage per point of enemy health, so a unit
 * built to have no damage and a lot of health is otherwise the *least* attractive thing on the
 * field and gets ignored while the people behind it are shot.
 */
export function allocate(
  attacker: Stack,
  enemies: readonly Stack[],
): { target: Stack; share: number }[] {
  /*
   * A stack that has broken is out of the fight, on both sides of the exchange.
   *
   * The maintainer's rule, 2026-09-16: "if a stack died or fled they no longer count for the
   * fight, only the perimeter if they fled and nothing if they died". It already did not *shoot*
   * (`fireRound` skips it), and `fighting` already excluded it from every reading the engine takes
   * of a side's strength. It was still a **target**, and that is the half that was wrong twice
   * over: the line kept spending its fire on people who had stopped fighting, and a routing stack
   * stood between the enemy and the units still holding, soaking rounds it had no business
   * soaking. A crew whose flank broke was therefore better protected than one whose flank held.
   *
   * What happens to the broken is decided elsewhere and is unchanged: `pursue` runs them down as
   * they disengage, and `routSurvivors` rolls flee-or-die on whoever is left when the fight ends.
   * Only the exchange of fire stops.
   */
  const live = enemies.filter(
    (enemy) => enemy.alive > 0 && enemy.pool > 0 && enemy.brokeAt === null,
  );
  if (live.length === 0) return [];

  /*
   * §D3: an officer is half as likely to be shot at, while there is anybody else to shoot at.
   *
   * A weight, not a rule of its own, so it composes with everything targeting already does: a
   * taunting shield line still pulls its share off the top, and an officer standing behind one is
   * half of what is left rather than half of the whole fight. The condition is the board's, and it
   * is the reason this is not simply a stat: a crew that sends an officer in alone has nobody for
   * them to hide behind, and the discount is off.
   */
  const cover = live.some((enemy) => enemy.officer === undefined);
  const weigh = (of: readonly Stack[]): number[] =>
    of.map((enemy) =>
      Math.max(
        0,
        threatWeight(attacker.effective, attacker.unit.modifiers, enemy.effective, enemy.morale) *
          enemy.alive *
          (cover && enemy.officer !== undefined ? OFFICER_TARGET_SHARE : 1),
      ),
    );
  /** Threat weights, normalised to shares of `budget`. Falls back to an even split at zero. */
  const spread = (of: readonly Stack[], budget: number): { target: Stack; share: number }[] => {
    const weights = weigh(of);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return of.map((target) => ({ target, share: budget / of.length }));
    return of.map((target, index) => ({ target, share: (budget * weights[index]!) / total }));
  };

  const taunting = live.filter((enemy) => enemy.unit.taunts === true);
  // Nothing taunting, or *everything* taunting, is the same question as before: one split.
  if (taunting.length === 0 || taunting.length === live.length) return spread(live, 1);

  const behind = live.filter((enemy) => enemy.unit.taunts !== true);
  return [...spread(taunting, TAUNT_PULL), ...spread(behind, 1 - TAUNT_PULL)];
}

/**
 * Medics per fighting unit at which a field hospital is doing everything it can.
 *
 * One in four. Past that the extra medics are standing behind people who are already being treated,
 * which is why this is a ratio and not a rate: how much a hospital is worth depends on how many
 * casualties there are to work on, and casualties come from the size of the line rather than from
 * the size of the hospital.
 *
 * It was an absolute figure in hit points first (`MEND_PER_MEDIC`), and that was measurably the
 * wrong model. In every fight short of a bloodbath the {@link MAX_MEND_SHARE} ceiling bound before
 * the rate did, so two medics and twelve medics did exactly the same thing: sweeping the rate from
 * 55 to 800 moved not one figure in the trial table. A support unit whose second copy is worth
 * nothing is a support unit with one correct quantity, which is not a decision.
 */
export const MEND_FULL_COVER = 0.25;

/**
 * The most of one round's incoming damage a field hospital can undo, at full cover.
 *
 * Strictly under 1 on purpose, and not by a little: a side whose medics could cancel a whole round
 * would end every fight on the round cap with both lines intact, which is the failure mode of every
 * healing mechanic that was written without one of these. Under a ceiling, medics change *how many
 * walk out*, which is what the sheet promises, and never who holds the ground.
 */
export const MAX_MEND_SHARE = 0.45;

/**
 * The share of incoming damage this side's medics undo, 0..{@link MAX_MEND_SHARE}.
 *
 * Linear in cover up to the full ratio and flat after it. Broken medics do not work, and the
 * denominator is the line they are treating rather than the whole force, so a hospital does not get
 * credit for covering itself.
 *
 * **A broken stack is not in the denominator either**, and that half was missing (2026-09-17). The
 * 2026-09-16 rule is that a stack which died or fled no longer counts for the fight, and `allocate`
 * already stops firing at one: a routed stack takes no damage, so there is nothing on it for the
 * medics to undo. Counting it anyway diluted the hospital exactly as the line collapsed, which is
 * backwards. Measured on a side of 20 Wardens, 20 Razors and 5 Stitchers: routing the Razors left
 * the mend share pinned at 0.225 when the five medics now cover the twenty who are left in full.
 */
export function mendShare(side: SideState): number {
  let medics = 0;
  let line = 0;
  for (const stack of side.stacks) {
    if (stack.alive <= 0 || stack.brokeAt !== null) continue;
    if (stack.unit.mends === true) medics += stack.alive;
    else line += stack.alive;
  }
  if (medics <= 0 || line <= 0) return 0;
  return MAX_MEND_SHARE * Math.min(1, medics / (line * MEND_FULL_COVER));
}

/**
 * Casualties the medics caught, taken off the round's damage before anybody counts it.
 *
 * Applied to `incoming` rather than after the fact, so the saved units are still standing when
 * `moralePhase` asks the line how it is doing. Healing that only moved a number after the morale
 * check would be healing nobody in the line could feel.
 *
 * Two rules, both load-bearing:
 *
 * - **Medics do not mend medics.** See `UnitSpec.mends`. A stack that carries the flag is skipped
 *   as a recipient, so a force of nothing but Stitchers gets nothing at all.
 * - **Split by what each stack is actually bleeding.** The medics go where the casualties are, so
 *   a focused stack is the one that gets the attention, which is also the stack whose morale was
 *   about to break.
 *
 * The opening ambush is deliberately not mended. An ambush lands before anybody is in position and
 * the medics are somebody, so a force that is walked into is the one case where bringing a hospital
 * does not help, and that is a real answer to a line built around one.
 */
export function mend(side: SideState, incoming: Map<Stack, number>): Map<Stack, number> {
  const kept = 1 - mendShare(side);
  if (kept >= 1) return incoming;

  const out = new Map(incoming);
  for (const [stack, damage] of incoming) {
    if (stack.unit.mends === true || damage <= 0) continue;
    out.set(stack, damage * kept);
  }
  return out;
}

/** Damage each stack on `side` deals this round, as a map from enemy stack index to damage. */
function fireRound(
  side: SideState,
  enemy: SideState,
  concentration: number,
  swing: number,
  frontage: number,
  only?: (stack: Stack) => boolean,
  /**
   * §E: this round's electronic warfare, in percentage points (`UnitSpec.jammer`).
   *
   * Two numbers because a jam cuts two things and the two land on opposite sides of this call:
   * `onShooter` is what the *enemy's* jammers are doing to the people firing here, and comes off
   * their offense; `onTarget` is what this side's jammers are doing to the people being fired at,
   * and comes off their armour. Passed in rather than read from the sides, because `jamPercent`
   * has to be taken once per round from a snapshot: read inside the loop it would fall as this
   * round's casualties landed, and both sides have to fire into the same moment.
   */
  jam: { onShooter: number; onTarget: number } = { onShooter: 0, onTarget: 0 },
  /**
   * §A5: what the *other* side's field effects are doing to the people firing here, per stack.
   *
   * Keyed by shooter rather than a single figure, which is the whole difference between this and
   * the jam above it: a jam is laid on the enemy line at once and this is laid only on the
   * stacks actually fighting whatever is producing it (`noiseOnEnemy`). A stack with no entry is
   * a stack that is not in it, and pays nothing.
   */
  field: ReadonlyMap<Stack, FieldEffect> = new Map(),
): Map<Stack, number> {
  const incoming = new Map<Stack, number>();
  const deployed = frontageShare(side, frontage);
  /*
   * The jam, folded onto copies of the two sheets rather than onto the stacks.
   *
   * Nothing is mutated: `stack.effective` is what the unit is, and a jam is what is being done to
   * it this round. Writing it onto the stack would carry into the next round, into the morale
   * phase and into the report, and it would have to be undone, which is a thing to forget.
   *
   * `allocate` below still picks targets off the *unjammed* sheets. That is deliberate and it is
   * not a rounding error hidden in a comment: the jam is the same percentage against every stack
   * on the enemy side, so it scales every candidate's attractiveness by the same factor and
   * cannot change their order. Targeting would answer the same question either way, and threading
   * a second set of sheets through it would be work for no difference.
   */
  const jammed = (effective: Effective, armorOff: number, offenseOff: number): Effective =>
    armorOff <= 0 && offenseOff <= 0
      ? effective
      : {
          ...effective,
          armor: effective.armor * (1 - armorOff / 100),
          offense: effective.offense * (1 - offenseOff / 100),
        };
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null || stack.alive <= 0) continue;
    if (only && !only(stack)) continue;
    /*
     * §D3: the intimidated do not shoot, but they are still here.
     *
     * Taken off the *firing* count only. They keep their place in `frontageShare`, they soak their
     * share of what is incoming, and they walk home if the side wins. Removing them from `alive`
     * instead would have made intimidation quietly lethal, which is not what it is for.
     */
    const firing = Math.max(0, stack.alive - stack.suppressed);
    if (firing <= 0) continue;
    for (const { target, share } of allocate(stack, enemy.stacks)) {
      const { perBody } = exchange(
        // The jam and the field effect are both percentage points off this shooter's damage, so
        // they compose the way two reductions compose everywhere else in this engine.
        jammed(stack.effective, 0, jam.onShooter + (field.get(stack)?.percent ?? 0)),
        stack.unit.modifiers,
        jammed(target.effective, jam.onTarget, 0),
        target.morale,
        side.luck,
      );
      const damage =
        perBody * firing * deployed * share * ROUND_DAMAGE_SCALE * concentration * swing;
      incoming.set(target, (incoming.get(target) ?? 0) + damage);
      stack.dealt += damage;
    }
  }
  return incoming;
}

/** Applies a round's damage and reports what each stack lost, as a fraction of what it had. */
function applyDamage(side: SideState, incoming: Map<Stack, number>): Map<Stack, number> {
  const lost = new Map<Stack, number>();
  for (const stack of side.stacks) {
    const damage = incoming.get(stack) ?? 0;
    if (damage <= 0 || stack.alive <= 0) continue;
    const before = stack.alive;
    stack.pool = Math.max(0, stack.pool - damage);
    stack.alive = Math.min(before, Math.ceil(stack.pool / stack.effective.vitality));
    // §D3: the intimidated stand in the line and take their share of what lands on it, so the men who
    // fall come from the whole stack rather than from the shooters first. Held constant, the
    // silenced count ate the firing count as the stack thinned: ten units with six intimidated lost
    // five and had nobody left shooting, when three of the five who fell should have been intimidated.
    if (stack.suppressed > 0) {
      stack.suppressed = Math.min(
        stack.alive,
        Math.round((stack.suppressed * stack.alive) / before),
      );
    }
    lost.set(stack, before === 0 ? 0 : (before - stack.alive) / before);
  }
  return lost;
}

/**
 * The morale phase. Returns the stacks that broke this round.
 *
 * Cascade is computed off the *previous* round's breaks rather than this one's, so a collapse
 * spreads over rounds instead of taking a whole side apart in a single pass. That one detail is
 * the difference between a fight that turns and a fight that detonates.
 */
/**
 * How badly `side` is outnumbered by `enemy`, as a ratio of the men still in the fight.
 *
 * Counted off who is still fighting rather than off who is still on the field (2026-09-17). This
 * was `standingUnits` on both halves, which counts the routed: a line felt outnumbered by men who
 * had already run, and felt *less* outnumbered because its own routed stacks were still in the
 * count. It is the same 2026-09-16 rule `allocate` applies, and every other reading the engine
 * takes of a side's strength (`fighting`, `sidePower`, `rangedShare`, `intimidation`) already
 * skipped them. This was the one that did not.
 *
 * Its own function rather than two lines in `moralePhase`, because "how outnumbered am I" is a
 * question worth being able to ask, and a private expression inside a loop is a rule nothing can
 * put a number on.
 */
export function outnumberedBy(side: SideState, enemy: SideState): number {
  return fighting(enemy) / Math.max(1, fighting(side));
}

function moralePhase(
  side: SideState,
  enemy: SideState,
  lost: Map<Stack, number>,
  enemyLost: number,
  battlefield: Battlefield,
  round: number,
  cascadeFrom: number,
): Stack[] {
  const shockBase: Omit<MoraleShock, 'casualtyFraction'> = {
    enemyCasualtyFraction: enemyLost,
    enemyIntimidation: intimidation(enemy),
    outnumberedRatio: outnumberedBy(side, enemy),
    // `steady_nerve` cuts exactly this term and nothing else: the line still breaks from its own
    // losses, from being outnumbered and from what is opposite it, and never from the panic beside
    // it. See `SideState.steadyNerve`.
    alliesBroken: side.steadyNerve ? 0 : cascadeFrom,
    resolvePercent: side.defending ? battlefield.fortifyPercent : 0,
  };

  const broke: Stack[] = [];
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null || stack.alive <= 0) continue;
    stack.morale = clamp(
      stack.morale +
        moraleDelta({ ...shockBase, casualtyFraction: lost.get(stack) ?? 0 }, stack.morale),
      0,
      100,
    );
    // `stalwart` is checked after the morale is written, not instead of it: the stack still loses
    // its nerve on the ledger, it simply does not leave. That is what makes the rule bite exactly
    // once, when the losses finally take it under half and it breaks in the same round it would
    // have broken in without the check.
    if (moraleState(stack.morale) === 'routed' && !holdsTheLine(stack)) {
      stack.brokeAt = round;
      broke.push(stack);
    }
  }
  return broke;
}

/**
 * A broken stack is run down while it disengages.
 *
 * The health pool is scaled by the share of units that got clear, **not** rebuilt from the
 * survivors at full vitality. Rebuilding it was a real bug: a stack at 40% health that routed came
 * out of the pursuit at full health of a smaller number, which made losing your nerve the most
 * reliable way to survive a fight.
 */
export function pursue(broke: readonly Stack[]): void {
  for (const stack of broke) {
    const before = stack.alive;
    if (before <= 0) continue;
    const after = Math.max(0, Math.round(before * (1 - PURSUIT_LOSS)));
    stack.pool = stack.pool * (after / before);
    stack.alive = after;
    // The run-down takes the intimidated with the rest, the same way `applyDamage` does.
    if (stack.suppressed > 0) {
      stack.suppressed = Math.min(after, Math.round((stack.suppressed * after) / before));
    }
  }
}

export interface RoundRecord {
  round: number;
  attackerLost: number;
  defenderLost: number;
  attackerBroke: string[];
  defenderBroke: string[];
}

export interface Simulation {
  attacker: SideState;
  defender: SideState;
  rounds: RoundRecord[];
  winner: 'attacker' | 'defender';
  /** True when nobody broke and the round cap decided it. Kept as the narrower `settledBy`. */
  decidedOnPower: boolean;
  /**
   * How the fight ended: somebody was left standing, the round cap ran out, or both sides fell.
   *
   * The third was invisible before (2026-09-17). `decidedOnPower` is false for it, correctly, since
   * the line it drives says "neither side broke", and both sides had; so a fight where everyone
   * went down and the winner was picked on residual power was reported as an ordinary win.
   */
  settledBy: 'standing' | 'cap' | 'collapse';
  /** What the attacker's opening strike was worth, as a share of a round. 0 when there was none. */
  openingStrike: number;
  /**
   * The attacker's units that changed sides under Directive Xero, by unit id (`changeOfHeart`).
   * Empty in every fight he is not over. They fought on the defender's side from the first round
   * and whatever is left of them is in the defender's stacks, not the attacker's.
   */
  turned: Army;
  /** Units the Executioner finished after an exchange ({@link execute}). Zero without him. */
  executed: number;
  /**
   * The same bodies, by unit id, so the settle can tell them apart from the rest of the dead.
   *
   * His card says they were finished where they stood, and an Infirmary that hands them back
   * makes that false: `recoverCasualties` works off the winner's losses, an attacker who wins
   * carries every executed body inside those losses, and 129 of 447 winner losses across 400
   * winning attacks on the Blacksite were his (measured 2026-09-21). Sums to {@link executed}.
   */
  executedForce: Army;
  /** Of `turned`, the ones still standing when the fight ended, by unit id. */
  turnedAlive: Army;
  /** The day's luck each side drew, −5.0 … +5.0. */
  luck: { attacker: number; defender: number };
  /**
   * §D3: units on each side too intimidated to fire, settled before the first shot. See {@link intimidate}.
   *
   * Reported rather than kept private, because a mechanic the player cannot see reads as a bug: a
   * line that did a third of the damage it should have, with every unit still standing and no
   * casualties to explain it, is indistinguishable from a broken engine. The report is what turns
   * it into a thing that happened.
   */
  intimidated: { attacker: number; defender: number };
  battlefield: Battlefield;
}

export interface SimulateInput {
  seed: string;
  battlefield?: Battlefield;
  attacker: SideSetup;
  defender: SideSetup;
}

/**
 * Runs the fight.
 *
 * The loop is deliberately flat and readable: fire, apply, morale, pursue, check. Every rule that
 * could have been an `if` in here lives in one of the modules beside this one instead, so this
 * function stays something a person can hold in their head while balancing.
 */
export function simulate(input: SimulateInput): Simulation {
  const next = mulberry32(seedFrom(input.seed));
  const battlefield = input.battlefield ?? bareBattlefield();

  // Counted off the line that actually forms, not off the raw record: `buildStacks` skips an id it
  // cannot resolve and leaves the porters out, so counting the record could tell a side it was
  // outnumbered by units that never reached the field. Forty Scavengers behind twenty Razors were
  // handing every Warden and Juggernaut sent against them a last stand it had not earned.
  const roster = (army: Army, rules: LineRules): number =>
    Object.entries(army).reduce((total, [unitId, count]) => {
      const unit = findUnit(unitId);
      return unit && count > 0 && standsInLine(unit, rules) ? total + count : total;
    }, 0);
  const rulesFor = (setup: SideSetup): LineRules => setup.territory ?? bareLineRules();
  const attackerCount = roster(input.attacker.army, rulesFor(input.attacker));
  const defenderCount = roster(input.defender.army, rulesFor(input.defender));

  /*
   * §A4: the works, once the attacker's sappers have been at them (`UnitSpec.sapper`).
   *
   * Cut here rather than inside `effectiveStats` because it is a fact about the ground and about
   * the force that came for it, not about any one defending unit: every stack behind the barricade
   * finds the same barricade. The defender is built against this and so is the defender's morale
   * phase, which reads `fortifyPercent` as the resolve that holding built ground buys.
   */
  const defenderGround = sappedGround(battlefield, input.attacker.army, rulesFor(input.attacker));

  const build = (
    setup: SideSetup,
    otherCount: number,
    ownCount: number,
    ground: Battlefield,
  ): SideState => ({
    name: setup.name,
    defending: setup.defending,
    swing: 1 + (next() * 2 - 1) * BATTLE_LUCK,
    // Filled in below: every force is registered before any luck is drawn.
    luck: 0,
    cohesionPercent: setup.cohesionPercent ?? 0,
    steadyNerve: setup.territory?.steadyNerve ?? false,
    stacks: buildStacks(
      setup.army,
      ground,
      setup.defending,
      ownCount > 0 && otherCount / ownCount >= OUTNUMBERED_RATIO,
      setup.territory ?? noTerritoryEffects(),
      setup.upgrades ?? {},
      setup.officer,
    ),
  });

  /*
   * §A5: the racket is **not** folded in here (`UnitSpec.loud`).
   *
   * It was, for one revision, as a label on the copy of the battlefield each side was built
   * against. That is wrong in three ways the maintainer named on 2026-09-19: it reached a stack
   * that never traded a shot with an Anodic, it went on reaching it after every Anodic was dead,
   * and being baked into `effective` at build time it could not vary as the fight moved. It is a
   * per-round effect on whoever is actually fighting them now: see `noiseOnEnemy`.
   */
  const attacker = build(input.attacker, defenderCount, attackerCount, battlefield);
  const defender = build(input.defender, attackerCount, defenderCount, defenderGround);

  // Both forces are on the field; now the day decides. Drawn here rather than inside `build` so
  // that neither side's luck can depend on how the other side's roster happened to be shaped.
  attacker.luck = drawLuck(next);
  defender.luck = drawLuck(next);
  const rounds: RoundRecord[] = [];

  /*
   * The Combine's leader, on the sheets (`SideSetup.presence`, `city/combine.ts`).
   *
   * Applied after both forces are built and before anything reads them: the Syndic's points and
   * Directive Xero's morale both have to be in `effective` before §D3 measures nerve. It reaches
   * the defence and nothing else, twice over: the Combine never attacks, so `SkirmishInput` only
   * carries a presence for the defence, and no power of the three touches the other side's sheet.
   */
  const presence = input.defender.presence;
  applyPresence(defender, presence);
  // The Combine's two ledgers. Filled in by `changeOfHeart` and `execute` below.
  const turnedUnits: Army = {};
  const executedForce: Army = {};
  let executedUnits = 0;
  /** One place both of the Executioner's ledgers are written, so they cannot drift apart. */
  const finish = (unitId: string, bodies: number): void => {
    executedForce[unitId] = (executedForce[unitId] ?? 0) + bodies;
    executedUnits += bodies;
  };

  /*
   * §D3: who is too intimidated to fight, settled before anything is fired.
   *
   * Both budgets are computed before either is spent, so the two sides are measured against each
   * other's *opening* rosters. Doing it in sequence would let the first side's silencing shrink the
   * second side's menace, and the answer would then depend on which of them we happened to look at
   * first, which is not a property a battle should have.
   */
  const onAttacker = menace(defender);
  const onDefender = menace(attacker);
  /*
   * Directive Xero (`changeOfHeart`): §D3 with the sign turned round.
   *
   * His side is not intimidated at all: its sheets are at the morale ceiling (`applyPresence`), and the
   * budget is not spent against it even so, because "immune" has to mean immune and not merely
   * expensive. The attackers §D3 *would* have silenced are not silenced either. They cross the
   * line. Both are decided from the same opening rosters as the ordinary case, so the order the
   * two sides are looked at in still cannot change the answer.
   */
  const zero = presence?.kind === 'directive_xero' ? presence : undefined;
  /*
   * Under Directive Xero the attacker's intimidated count is **zero**, not the number who crossed.
   *
   * They are the same men either way, and the report draws both figures: a "Too intimidated to fire"
   * row off `intimidated` and a "changed sides" line off `turned`. Counting the crossing under
   * `intimidated` as well told a player that thirty of their twenty units were affected, and the first
   * of those rows was the false one: nobody put their head down, they picked up their weapons and
   * walked. `changeOfHeart` still returns the count, which is what `turnedUnits` carries out.
   */
  if (zero) changeOfHeart(attacker, defender, onAttacker, zero.morale, turnedUnits);
  const attackerIntimidated = zero ? 0 : intimidate(attacker, onAttacker);
  const defenderIntimidated = zero ? 0 : intimidate(defender, onDefender);

  // The opening strike, before either side is in position. Only the attacker can take one: an
  // ambush is something you set, and the side standing on the ground it already holds is not
  // setting it. This is also the only location `stealth` matters once a fight has started.
  const ambush = ambushShare(attacker, defender);
  // Carried into the first round's morale rather than discarded. The opening volley was applied to
  // health and then dropped on the floor: units fell and nothing was shaken by it, so an ambush
  // was worth strictly less than the damage it dealt.
  const ambushed =
    ambush > 0
      ? applyDamage(
          defender,
          fireRound(attacker, defender, 1, ambush, battlefield.frontage, (stack) =>
            stack.unit.modifiers.includes('ambush'),
          ),
        )
      : new Map<Stack, number>();

  /*
   * The Opening Volley (`UnitSpec.strikes_first`), after the ambush and before the exchange.
   *
   * Both sides' volleys are *computed* before either is applied, for the reason the round loop
   * gives: fire from a shared snapshot, or whichever side is written first shoots at units that
   * are already down. Taken after the ambush on purpose, so a force that is walked into is already
   * short of people when it gets its own shot away, which is the one thing that makes bringing an
   * ambush worth more than bringing this.
   */
  const openingOnDefender = opensFire(attacker)
    ? fireRound(
        attacker,
        defender,
        1,
        FIRST_STRIKE_SHARE,
        battlefield.frontage,
        (stack) => stack.unit.strikes_first === true,
      )
    : new Map<Stack, number>();
  const openingOnAttacker = opensFire(defender)
    ? fireRound(
        defender,
        attacker,
        1,
        FIRST_STRIKE_SHARE,
        battlefield.frontage,
        (stack) => stack.unit.strikes_first === true,
      )
    : new Map<Stack, number>();
  const openedDefender = applyDamage(defender, openingOnDefender);
  // The Executioner reads the opening volley like any other exchange: see `execute`.
  const openedByVolley = applyDamage(attacker, openingOnAttacker);
  const openedAttacker = mergeLosses(execute(attacker, presence, finish), openedByVolley);

  let attackerCascade = 0;
  let defenderCascade = 0;
  let round = 0;

  while (round < MAX_ROUNDS && fighting(attacker) > 0 && fighting(defender) > 0) {
    round += 1;

    const attackerConcentration = concentrationFor(attacker, defender, battlefield.frontage);
    const defenderConcentration = concentrationFor(defender, attacker, battlefield.frontage);
    const attackerSwing = attacker.swing * (1 + (next() * 2 - 1) * ROUND_LUCK);
    const defenderSwing = defender.swing * (1 + (next() * 2 - 1) * ROUND_LUCK);

    // Both sides fire from the same snapshot, then both take it. Sequential rounds hand the side
    // that happens to go first a free volley against a stack that is already dead.
    //
    // Each side's own medics take their share off what is landing on them, before it lands: see
    // `mend`. Wrapped here rather than inside `fireRound` because it is the *receiving* side's
    // sheet that decides it, and `fireRound` only knows who is shooting.
    /*
     * §E: the jam, taken once, before either side fires (`UnitSpec.jammer`).
     *
     * Here rather than inside `fireRound` because both calls below read the same moment: a
     * Netrunner that dies to the attacker's volley was still jamming when the defender's went
     * out. Read fresh each round off the stacks still standing, so killing them turns it off on
     * the next one, which is the whole of the counterplay.
     */
    const jamOnDefender = jamPercent(attacker);
    const jamOnAttacker = jamPercent(defender);

    /*
     * §A5: this round's field effects, taken from the same snapshot as the jam.
     *
     * `noiseOnDefender` is what the attacker's loud units are doing to the defenders they are
     * fighting, so it comes off the *defenders'* damage when they fire, which is why it is
     * passed to the second call below and not the first.
     */
    const noiseOnDefender = noiseOnEnemy(attacker, defender);
    const noiseOnAttacker = noiseOnEnemy(defender, attacker);

    const ontoDefender = mend(
      defender,
      fireRound(
        attacker,
        defender,
        attackerConcentration,
        attackerSwing,
        battlefield.frontage,
        undefined,
        { onShooter: jamOnAttacker, onTarget: jamOnDefender },
        noiseOnAttacker,
      ),
    );
    const ontoAttacker = mend(
      attacker,
      fireRound(
        defender,
        attacker,
        defenderConcentration,
        defenderSwing,
        battlefield.frontage,
        undefined,
        { onShooter: jamOnDefender, onTarget: jamOnAttacker },
        noiseOnDefender,
      ),
    );
    // Round one carries whatever happened before it: the ambush and either side's opening volley.
    // `mergeLosses` composes fractions of different starting numbers, so chaining is exact.
    const defenderLost = mergeLosses(
      mergeLosses(applyDamage(defender, ontoDefender), round === 1 ? ambushed : undefined),
      round === 1 ? openedDefender : undefined,
    );
    // The Executioner, after the exchange has landed (`execute`): what the round left at the
    // front of every attacking stack, and whether it is still standing.
    // In its own statement, before `execute` is called: what he reads has to be what the
    // exchange left, and a call inside the argument list would run before the damage landed.
    const hitAttacker = applyDamage(attacker, ontoAttacker);
    const attackerLost = mergeLosses(
      mergeLosses(execute(attacker, presence, finish), hitAttacker),
      round === 1 ? openedAttacker : undefined,
    );

    // Averaged over the stacks that took anything, so "how the other side is doing" is a figure
    // about the enemy force rather than about whichever of its stacks happened to be focused.
    const attackerLossShare = meanLoss(attackerLost);
    const defenderLossShare = meanLoss(defenderLost);
    const brokeAttacker = moralePhase(
      attacker,
      defender,
      attackerLost,
      defenderLossShare,
      battlefield,
      round,
      attackerCascade,
    );
    const brokeDefender = moralePhase(
      defender,
      attacker,
      defenderLost,
      attackerLossShare,
      defenderGround,
      round,
      defenderCascade,
    );
    pursue(brokeAttacker);
    pursue(brokeDefender);
    attackerCascade = brokeAttacker.length;
    defenderCascade = brokeDefender.length;

    rounds.push({
      round,
      attackerLost: [...attackerLost.values()].reduce((a, b) => a + b, 0),
      defenderLost: [...defenderLost.values()].reduce((a, b) => a + b, 0),
      attackerBroke: brokeAttacker.map((stack) => stack.unit.name),
      defenderBroke: brokeDefender.map((stack) => stack.unit.name),
    });
  }

  const attackerStanding = fighting(attacker);
  const defenderStanding = fighting(defender);
  // Three endings, and the third is the one the first draft got wrong. One side still fighting
  // takes the ground. *Neither* side still fighting is a mutual collapse, and it has to be settled
  // on who is left standing: handing it to the defender by default made a mirror unwinnable.
  /*
   * How the fight was settled, when it was not settled by somebody still standing.
   *
   * `cap` is the round limit running out with both lines intact. `collapse` is both sides going
   * down together, which is also decided on residual power and used to be reported as nothing at
   * all: a mutual wipeout read as a clean win, with no line explaining how the winner was picked.
   */
  const settledBy: 'standing' | 'cap' | 'collapse' =
    attackerStanding > 0 && defenderStanding > 0
      ? 'cap'
      : attackerStanding === 0 && defenderStanding === 0
        ? 'collapse'
        : 'standing';
  const decidedOnPower = settledBy === 'cap';
  const winner =
    attackerStanding > 0 && defenderStanding === 0
      ? 'attacker'
      : defenderStanding > 0 && attackerStanding === 0
        ? 'defender'
        : residualPower(attacker) > residualPower(defender)
          ? 'attacker'
          : 'defender';

  return {
    attacker,
    defender,
    rounds,
    winner,
    decidedOnPower,
    settledBy,
    battlefield,
    openingStrike: ambush,
    turned: turnedUnits,
    executed: executedUnits,
    executedForce,
    turnedAlive: turncoatsStanding(defender),
    luck: { attacker: attacker.luck, defender: defender.luck },
    intimidated: { attacker: attackerIntimidated, defender: defenderIntimidated },
  };
}

/**
 * How much of an opening strike a side gets, as a share of one round's fire.
 *
 * Two things have to be true for it to be worth anything: some of the force has to be built to set
 * an ambush, and it has to be able to hide from the people it is ambushing. Neither alone is enough,
 * which is why this is a product: Ghosts on open ground against a Cartographer get very little, and
 * Ghosts in a sewer against Sparks get most of it.
 *
 * Returns 0 when nothing on the side carries the sheet, so the common case costs nothing and adds
 * no draw to the stream.
 */
export function ambushShare(side: SideState, enemy: SideState): number {
  let hidden = 0;
  let stealth = 0;
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null || stack.alive <= 0) continue;
    if (!stack.unit.modifiers.includes('ambush')) continue;
    hidden += stack.alive;
    stealth += stack.alive * stack.effective.stealth;
  }
  if (hidden <= 0) return 0;

  /*
   * How big a share of the force can hide is **not** a term here (2026-09-17 consistency pass).
   *
   * It used to be, as `min(1, hidden / engagedUnits(side, frontage))`, and it was counted twice:
   * the volley is fired through `fireRound`'s `only` filter, which already restricts it to the
   * stacks carrying the sheet, so six Ghosts in a force of thirty were scaled to a fifth and then
   * fired a fifth of a round. Measured at the shipped numbers: `AMBUSH_ROUND_SHARE` is 0.6 and the
   * mechanic delivered 0.09, so a maxed stealth bonus moved the outcome of none of 150 seeded
   * fights and the whole opening strike was worth two points of damage out of six hundred.
   *
   * `FIRST_STRIKE_SHARE`, the sibling mechanic on the same `fireRound(..., only)` call, passes its
   * constant bare for exactly this reason, and its own doc says an ambush is meant to be worth
   * *more* than it. This is that, now.
   */
  const spotted = watchfulness(enemy);
  const edge = clamp(stealth / hidden - spotted, 0, 100) / 100;
  return AMBUSH_ROUND_SHARE * edge;
}

/** How hard a side is to sneak up on: its own stealth is what it knows to look for. */
function watchfulness(side: SideState): number {
  let weighted = 0;
  let total = 0;
  for (const stack of side.stacks) {
    if (stack.alive <= 0) continue;
    weighted += stack.alive * stack.effective.stealth;
    total += stack.alive;
  }
  return total === 0 ? 0 : weighted / total;
}

/**
 * Two rounds' worth of losses on one stack, combined the way the survivors experienced them.
 *
 * Fractions of *different* starting numbers, so they do not add: losing a fifth and then a fifth of
 * what is left is 36% gone, not 40%. Only used to fold the opening strike into round one.
 */
export function mergeLosses(
  round: Map<Stack, number>,
  earlier: Map<Stack, number> | undefined,
): Map<Stack, number> {
  if (earlier === undefined) return round;
  const merged = new Map(round);
  for (const [stack, before] of earlier) {
    const after = merged.get(stack) ?? 0;
    merged.set(stack, 1 - (1 - before) * (1 - after));
  }
  return merged;
}

/** The mean loss across the stacks that took any, 0 when none did. */
function meanLoss(lost: Map<Stack, number>): number {
  if (lost.size === 0) return 0;
  let total = 0;
  for (const fraction of lost.values()) total += fraction;
  return total / lost.size;
}

/**
 * Power counting broken stacks too, at {@link BROKEN_WEIGHT}.
 *
 * Only used to settle a fight nobody won outright. A stack that has broken is not fighting, but it
 * is still a hundred people standing on the ground, and "who has more left" is the only honest way
 * to call a mutual collapse.
 */
export const BROKEN_WEIGHT = 0.25;

export function residualPower(side: SideState): number {
  let offense = 0;
  let durability = 0;
  for (const stack of side.stacks) {
    const weight = stack.brokeAt === null ? 1 : BROKEN_WEIGHT;
    offense += stack.alive * stack.effective.offense * weight;
    durability += stack.pool * weight;
  }
  return Math.sqrt(Math.max(0, offense) * Math.max(0, durability));
}

/**
 * The numbers advantage, weighted by how much of the side can bring it to bear.
 *
 * This doc had come adrift and was sitting above `mergeLosses`, which is a paragraph about
 * something else entirely and already had one of its own; the function it describes had none.
 *
 * A shield wall gets nothing for being twice as many, because {@link rangedShare} is what buys the
 * exponent and a melee line has none of it. A firing line gets a *fraction* of Lanchester's square
 * law rather than most of it, which is what this used to claim: the square law says the per-unit
 * multiplier scales as n, so a force at two-to-one would fire at twice the rate, and
 * {@link CONCENTRATION_EDGE} at 0.28 gives it 2^0.28, which is 1.21. About a fifth of the way.
 *
 * That is deliberate and the clamp is the reason. Under the real square law a small edge compounds
 * into annihilation, and this engine already has a morale cascade doing that job; stacking an
 * undamped concentration term on top of it would let a large enough force simply delete a small one
 * before it acts.
 */
export function concentrationFor(side: SideState, enemy: SideState, frontage: number): number {
  const own = engagedUnits(side, frontage);
  const other = engagedUnits(enemy, frontage);
  if (own <= 0 || other <= 0) return 1;
  const edge = CONCENTRATION_EDGE * rangedShare(side);
  return clamp((own / other) ** edge, 1 / MAX_CONCENTRATION, MAX_CONCENTRATION);
}

export type { MoraleState };
