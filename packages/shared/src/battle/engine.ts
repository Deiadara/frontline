import type { Attributes } from '../attributes.js';
import { findDistrict, garrisonOf } from '../city.js';
import { GOVERNMENT } from '../factions.js';
import type { PartialResources } from '../resources.js';
import { seededRoll } from './rng.js';
import type { BattleEngine, BattleInput, BattleResult } from './types.js';

// TODO-LATER: the model below reads only *high* attributes, so MOU-189's weakness injection is
// still not mechanically visible — a designed flaw sits inside the natural tail of the roll.
// Retune it or drop it with this engine as the consumer.
// TODO-LATER: §A5 defending *commander* bonuses. The defending district's structures now count —
// `defenderDefense` carries the Gate — but nothing reads the officers standing behind it.

/**
 * What a raid is actually led with (§B). Tactics carries the plan, leadership holds the crew
 * together under fire, and hacking is the sentry grid the narration already describes going down.
 * The weights sum to 1, so an assault rating is on the same 0..100 scale as the sheet it reads.
 */
const ASSAULT_WEIGHTS: Readonly<Partial<Record<keyof Attributes, number>>> = {
  tactics: 0.5,
  leadership: 0.3,
  hacking: 0.2,
};

/** Spreads district difficulty (1..10) across the 0..100 scale the attribute sheet uses. */
const RESISTANCE_PER_DIFFICULTY = 8;

/** An even fight, before either side's numbers are counted. */
const EVEN_ODDS = 0.5;

/** How much one point of edge over the defence is worth. 25 points of edge ≈ +25pp. */
const CHANCE_PER_POINT = 0.01;

/**
 * No raid is ever a certainty or a foregone loss — a walkover is not a decision, and a target the
 * player cannot ever take reads as a broken map rather than a hard one.
 */
const MIN_WIN_CHANCE = 0.05;
const MAX_WIN_CHANCE = 0.95;

/** An uncharted sector is the hardest thing on the board, and it pays nothing. */
const UNCHARTED_DIFFICULTY = 10;

/**
 * A won raid's haul, with the attacker's own haulage modifications applied.
 *
 * Rounded up rather than down: a 10% bonus on a 5-unit line is worth *something*, and a player who
 * fitted Salvage Drones and then watched the numbers not move would be right to call it broken.
 */
function haul(rewards: PartialResources, bonusPercent: number): PartialResources {
  if (bonusPercent <= 0) return rewards;
  return Object.fromEntries(
    Object.entries(rewards).map(([key, amount]) => [
      key,
      Math.ceil((amount ?? 0) * (1 + bonusPercent / 100)),
    ]),
  );
}

/** The weighted sheet an assault is resolved on, 0..100. */
export function assaultRating(attributes: Attributes): number {
  return Object.entries(ASSAULT_WEIGHTS).reduce(
    (total, [name, weight]) => total + attributes[name as keyof Attributes] * weight,
    0,
  );
}

/**
 * What the ground itself is worth to whoever is holding it, on the assault-rating scale.
 *
 * `defense` is what the defender *built* there — `districtDefense`, which is the Gate's whole job
 * (§A1). It is a separate argument rather than folded into the difficulty because the two are
 * different claims: difficulty is a property of the map and never changes, while defence is a
 * choice somebody made and can be raised between one raid and the next.
 */
export function districtResistance(difficulty: number, defense = 0): number {
  return difficulty * RESISTANCE_PER_DIFFICULTY + Math.max(0, defense);
}

/**
 * The attacker's odds — the whole combat model in one line, so a tuning argument is a conversation
 * about three constants rather than an archaeology dig through the narration.
 */
export function attackerWinChance(attributes: Attributes, difficulty: number, defense = 0): number {
  const edge = assaultRating(attributes) - districtResistance(difficulty, defense);
  const chance = EVEN_ODDS + edge * CHANCE_PER_POINT;
  return Math.min(MAX_WIN_CHANCE, Math.max(MIN_WIN_CHANCE, chance));
}

/**
 * The live combat model: attacker sheet against district difficulty, resolved by one seeded draw.
 *
 * Deterministic by construction — same input, same seed, same outcome — so a persisted battle row
 * replays exactly. `roll` is the seam that makes that true and is the only thing a test needs to
 * override to pin an outcome.
 */
export class AttritionBattleEngine implements BattleEngine {
  private readonly roll: (seed: string) => number;

  constructor(roll: (seed: string) => number = seededRoll) {
    this.roll = roll;
  }

  simulate(input: BattleInput): BattleResult {
    const district = findDistrict(input.targetDistrictId);
    const target = district?.name ?? 'an uncharted sector';
    // §A3 — who is actually standing there. On Combine ground the narration names the government's
    // own composition, which is the whole point of having one antagonist: the player learns what a
    // state site fields by reading the log, not a wiki.
    const garrison = district ? garrisonOf(district) : 'nobody the strike team recognises';
    const holdsTheState = district?.faction === 'government';

    const difficulty = district?.difficulty ?? UNCHARTED_DIFFICULTY;
    const attackerWins =
      this.roll(input.seed) <
      attackerWinChance(input.attackerAttributes, difficulty, input.defenderDefense);

    const log = [
      `Strike team deployed from ${input.attackerBaseName} under a dead satellite window.`,
      `Contact at ${target}: ${garrison}. Netrunners spoof the sentry grid; drones circle blind for 41 seconds.`,
      // Only said when there is something to say. A fortified target is the one thing about a raid
      // the player can change between attempts, so it earns its own line in the log.
      ...(input.defenderDefense > 0
        ? [
            `The approach is gated and held — ${target} has been worked on since anyone last looked.`,
          ]
        : []),
      attackerWins
        ? `Breach charges crack the ferrocrete line — defenders of ${target} scatter into the undergrid.`
        : `Counter-ICE flares white-hot; the assault on ${target} collapses at the perimeter wall.`,
      attackerWins
        ? `Salvage crews strip the site before ${holdsTheState ? `${GOVERNMENT.adjective} response teams arrive` : 'anyone else arrives'}. Victory.`
        : 'Survivors limp home through the acid rain. The district holds.',
    ];

    return {
      winner: attackerWins ? 'attacker' : 'defender',
      log,
      rewards: attackerWins ? haul(district?.rewards ?? {}, input.attackerLootBonus) : {},
    };
  }
}

/** Default engine instance the server should inject unless configured otherwise. */
export const defaultBattleEngine: BattleEngine = new AttritionBattleEngine();
