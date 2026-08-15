import { noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import { findUnit, type Army, type UnitSpec } from '../units/index.js';
import { bareBattlefield, type Battlefield } from './battlefield.js';
import { effectiveStats, OUTNUMBERED_RATIO, type Effective } from './effects.js';
import { exchange, threatWeight } from './matchup.js';
import {
  moraleDelta,
  moraleState,
  PURSUIT_LOSS,
  type MoraleShock,
  type MoraleState,
} from './morale.js';
import { drawLuck } from './luck.js';
import { mulberry32, seedFrom } from './rng.js';

/**
 * The fight itself.
 *
 * One commitment, one resolution, one report — the player sets a force and reads what happened,
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
 *   array — the single most common way a round loop develops a silent bias.
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
 * report reads follows from that — but it is also not a free dial. Too high and the loser is wiped
 * in one round before it fires back, which makes winning nearly free; too low and morale decides
 * the fight before casualties matter, which makes it a coin flip. Both failure modes were measured
 * on the way to 0.2, at which a 4:1 runs two rounds and a near-even fight runs six or seven.
 */
export const ROUND_DAMAGE_SCALE = 0.2;

/**
 * How much massing bodies is worth beyond the bodies themselves — Lanchester's square law, weighted
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
 * Combat width (`battlefield.ts`). Bodies past the frontage are queuing, not fighting: they cannot
 * shoot, though they are still there to absorb losses and to rotate forward as the front rank
 * falls. That asymmetry is the point — an overstacked force is not *weaker*, it is slower, and it
 * pays for the ground it could not deploy on.
 *
 * Without this the answer to every fight is "bring more", which is the failure mode combat width
 * was invented to fix.
 */
export function engagedBodies(side: SideState, frontage: number): number {
  return Math.min(fighting(side), Math.max(1, frontage));
}

/**
 * How much a side's fire is worth this round, as a fraction of what its whole strength would be.
 *
 * Applied to each stack's contribution rather than to the side's total, so a force that is over the
 * frontage loses output evenly across its stacks instead of arbitrarily silencing whichever
 * happened to be last in the array.
 */
export function frontageShare(side: SideState, frontage: number): number {
  const standing = fighting(side);
  return standing <= 0 ? 0 : engagedBodies(side, frontage) / standing;
}

/**
 * What an ambush is worth: one opening exchange before the defender is in position.
 *
 * The `ambush` sheet was, until now, a second `urban_bonus` with a different name — same context,
 * same arithmetic, no reason to prefer one over the other. This is what it was always supposed to
 * mean, and it is the only combat use `stealth` has: a stack gets its opening strike in proportion
 * to how much of the force can hide and how badly the other side can see.
 *
 * Deliberately a *fraction* of a round rather than a whole one. A free round is a coin flip decided
 * before the fight starts, which is the thing every design note on first-strike mechanics warns
 * about.
 */
export const AMBUSH_ROUND_SHARE = 0.6;

/** Per-round swing, the Grepolis "luck" idea at a tighter spread so it averages out over a fight. */
export const ROUND_LUCK = 0.12;

/** ...and a single roll for the whole fight, which does not average out. This one is the story. */
export const BATTLE_LUCK = 0.1;

export interface Stack {
  unit: UnitSpec;
  effective: Effective;
  /** Bodies still standing. */
  alive: number;
  /** Health pool, `alive × vitality` at full strength. */
  pool: number;
  morale: number;
  /** The round it broke, or null while it is still fighting. */
  brokeAt: number | null;
  /** Bodies that started the fight — the denominator for every casualty figure. */
  started: number;
}

export interface SideSetup {
  name: string;
  army: Army;
  defending: boolean;
  territory?: TerritoryEffects;
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
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export const bodies = (side: SideState): number =>
  side.stacks.reduce((total, stack) => total + stack.alive, 0);

/** Bodies still willing to fight — a broken stack is on the field but not in the battle. */
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

/** The share of a side that can concentrate its fire, 0..1 — see {@link CONCENTRATION_EDGE}. */
function rangedShare(side: SideState): number {
  let weighted = 0;
  let total = 0;
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null) continue;
    weighted += stack.alive * (stack.effective.range / 100);
    total += stack.alive;
  }
  return total === 0 ? 0 : weighted / total;
}

/** Average intimidation across a side's live bodies — what the other side has to look at. */
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

function buildStacks(
  army: Army,
  battlefield: Battlefield,
  defending: boolean,
  outnumbered: boolean,
  territory: TerritoryEffects,
): Stack[] {
  const stacks: Stack[] = [];
  for (const [unitId, count] of Object.entries(army)) {
    const unit = findUnit(unitId);
    if (!unit || count <= 0) continue;
    const effective = effectiveStats(unit, battlefield, { defending, outnumbered }, territory);
    stacks.push({
      unit,
      effective,
      alive: count,
      pool: count * effective.vitality,
      morale: effective.morale,
      brokeAt: null,
      started: count,
    });
  }
  return stacks;
}

/**
 * How one stack splits its fire across the enemy's stacks.
 *
 * Weighted by {@link threatWeight}, so the counter system decides targeting rather than a rule
 * saying it should. Fire is *split* rather than focused on the single best target, because a stack
 * of forty is forty people making their own decisions — total focus would make every fight a
 * sequence of clean executions and would reward a single hard counter far past what it is worth.
 */
function allocate(attacker: Stack, enemies: readonly Stack[]): { target: Stack; share: number }[] {
  const live = enemies.filter((enemy) => enemy.alive > 0 && enemy.pool > 0);
  if (live.length === 0) return [];

  const weights = live.map((enemy) =>
    Math.max(
      0,
      threatWeight(attacker.effective, attacker.unit.modifiers, enemy.effective, enemy.morale),
    ),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return live.map((target) => ({ target, share: 1 / live.length }));
  return live.map((target, index) => ({ target, share: weights[index]! / total }));
}

/** Damage each stack on `side` deals this round, as a map from enemy stack index to damage. */
function fireRound(
  side: SideState,
  enemy: SideState,
  concentration: number,
  swing: number,
  frontage: number,
  only?: (stack: Stack) => boolean,
): Map<Stack, number> {
  const incoming = new Map<Stack, number>();
  const deployed = frontageShare(side, frontage);
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null || stack.alive <= 0) continue;
    if (only && !only(stack)) continue;
    for (const { target, share } of allocate(stack, enemy.stacks)) {
      const { perBody } = exchange(
        stack.effective,
        stack.unit.modifiers,
        target.effective,
        target.morale,
        side.luck,
      );
      const damage =
        perBody * stack.alive * deployed * share * ROUND_DAMAGE_SCALE * concentration * swing;
      incoming.set(target, (incoming.get(target) ?? 0) + damage);
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
function moralePhase(
  side: SideState,
  enemy: SideState,
  lost: Map<Stack, number>,
  enemyLost: number,
  battlefield: Battlefield,
  round: number,
  cascadeFrom: number,
): Stack[] {
  const ownBodies = Math.max(1, bodies(side));
  const shockBase: Omit<MoraleShock, 'casualtyFraction'> = {
    enemyCasualtyFraction: enemyLost,
    enemyIntimidation: intimidation(enemy),
    outnumberedRatio: bodies(enemy) / ownBodies,
    alliesBroken: cascadeFrom,
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
    if (moraleState(stack.morale) === 'routed') {
      stack.brokeAt = round;
      broke.push(stack);
    }
  }
  return broke;
}

/**
 * A broken stack is run down while it disengages.
 *
 * The health pool is scaled by the share of bodies that got clear, **not** rebuilt from the
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
  /** True when nobody broke and the round cap decided it. */
  decidedOnPower: boolean;
  /** What the attacker's opening strike was worth, as a share of a round. 0 when there was none. */
  openingStrike: number;
  /** The day's luck each side drew, −5.0 … +5.0. */
  luck: { attacker: number; defender: number };
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

  // Counted off units that actually exist, not off the raw record: `buildStacks` skips an id it
  // cannot resolve, so counting the record could tell a side it was outnumbered by bodies that
  // never reached the field.
  const roster = (army: Army): number =>
    Object.entries(army).reduce(
      (total, [unitId, count]) => (findUnit(unitId) && count > 0 ? total + count : total),
      0,
    );
  const attackerCount = roster(input.attacker.army);
  const defenderCount = roster(input.defender.army);

  const build = (setup: SideSetup, otherCount: number, ownCount: number): SideState => ({
    name: setup.name,
    defending: setup.defending,
    swing: 1 + (next() * 2 - 1) * BATTLE_LUCK,
    // Filled in below: every force is registered before any luck is drawn.
    luck: 0,
    stacks: buildStacks(
      setup.army,
      battlefield,
      setup.defending,
      ownCount > 0 && otherCount / ownCount >= OUTNUMBERED_RATIO,
      setup.territory ?? noTerritoryEffects(),
    ),
  });

  const attacker = build(input.attacker, defenderCount, attackerCount);
  const defender = build(input.defender, attackerCount, defenderCount);

  // Both forces are on the field; now the day decides. Drawn here rather than inside `build` so
  // that neither side's luck can depend on how the other side's roster happened to be shaped.
  attacker.luck = drawLuck(next);
  defender.luck = drawLuck(next);
  const rounds: RoundRecord[] = [];

  // The opening strike, before either side is in position. Only the attacker can take one — an
  // ambush is something you set, and the side standing on the ground it already holds is not
  // setting it. This is also the only place `stealth` matters once a fight has started.
  const ambush = ambushShare(attacker, defender, battlefield.frontage);
  // Carried into the first round's morale rather than discarded. The opening volley was applied to
  // health and then dropped on the floor: bodies fell and nothing was shaken by it, so an ambush
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
    const ontoDefender = fireRound(
      attacker,
      defender,
      attackerConcentration,
      attackerSwing,
      battlefield.frontage,
    );
    const ontoAttacker = fireRound(
      defender,
      attacker,
      defenderConcentration,
      defenderSwing,
      battlefield.frontage,
    );
    const defenderLost = mergeLosses(
      applyDamage(defender, ontoDefender),
      round === 1 ? ambushed : undefined,
    );
    const attackerLost = applyDamage(attacker, ontoAttacker);

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
      battlefield,
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
  // on who is left standing — handing it to the defender by default made a mirror unwinnable.
  const decidedOnPower = attackerStanding === 0 || defenderStanding === 0 ? false : true;
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
    battlefield,
    openingStrike: ambush,
    luck: { attacker: attacker.luck, defender: defender.luck },
  };
}

/**
 * How much of an opening strike a side gets, as a share of one round's fire.
 *
 * Two things have to be true for it to be worth anything: some of the force has to be built to set
 * an ambush, and it has to be able to hide from the people it is ambushing. Neither alone is enough,
 * which is why this is a product — Ghosts on open ground against a Cartographer get very little, and
 * Ghosts in a sewer against Sparks get most of it.
 *
 * Returns 0 when nothing on the side carries the sheet, so the common case costs nothing and adds
 * no draw to the stream.
 */
export function ambushShare(side: SideState, enemy: SideState, frontage: number): number {
  let hidden = 0;
  let stealth = 0;
  for (const stack of side.stacks) {
    if (stack.brokeAt !== null || stack.alive <= 0) continue;
    if (!stack.unit.modifiers.includes('ambush')) continue;
    hidden += stack.alive;
    stealth += stack.alive * stack.effective.stealth;
  }
  if (hidden <= 0) return 0;

  const engaged = Math.max(1, engagedBodies(side, frontage));
  const share = Math.min(1, hidden / engaged);
  const spotted = watchfulness(enemy);
  const edge = clamp(stealth / hidden - spotted, 0, 100) / 100;
  return AMBUSH_ROUND_SHARE * share * edge;
}

/** How hard a side is to sneak up on — its own stealth is what it knows to look for. */
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
 * The numbers advantage, weighted by how much of the side can bring it to bear.
 *
 * A shield wall gets nothing for being twice as many; a firing line gets most of the square law.
 * Clamped so a large enough force can never simply delete a small one before it acts.
 */
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

export function concentrationFor(side: SideState, enemy: SideState, frontage: number): number {
  const own = engagedBodies(side, frontage);
  const other = engagedBodies(enemy, frontage);
  if (own <= 0 || other <= 0) return 1;
  const edge = CONCENTRATION_EDGE * rangedShare(side);
  return clamp((own / other) ** edge, 1 / MAX_CONCENTRATION, MAX_CONCENTRATION);
}

export type { MoraleState };
