import { findDistrict, garrisonOf } from '../city.js';
import { GOVERNMENT } from '../factions.js';
import type { BattleEngine, BattleInput, BattleResult } from './types.js';

// TODO: replace RandomBattleEngine with a real deterministic combat model (see docs/ARCHITECTURE.md).
// It must weigh overseer attributes, building levels (walls/barracks), district difficulty and
// commander bonuses, and be seedable so battles are replayable from the persisted Battle row.
// TODO-LATER: the moment this reads a *low* attribute, decide MOU-189 — recruitment's weakness
// injection currently lands inside the natural tail of the roll, so a designed flaw is not
// mechanically visible. Retune it or drop it then, with this engine as the consumer.

/**
 * Placeholder engine: a 50/50 coin flip REGARDLESS of inputs.
 * On an attacker win it pays out the target district's `rewards`.
 */
export class RandomBattleEngine implements BattleEngine {
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  simulate(input: BattleInput): BattleResult {
    const district = findDistrict(input.targetDistrictId);
    const target = district?.name ?? 'an uncharted sector';
    // §A3 — who is actually standing there. On Combine ground the narration names the government's
    // own composition, which is the whole point of having one antagonist: the player learns what a
    // state site fields by reading the log, not a wiki.
    const garrison = district ? garrisonOf(district) : 'nobody the strike team recognises';
    const holdsTheState = district?.faction === 'government';
    const attackerWins = this.random() < 0.5;

    const log = [
      `Strike team deployed from ${input.attackerBaseName} under a dead satellite window.`,
      `Contact at ${target}: ${garrison}. Netrunners spoof the sentry grid; drones circle blind for 41 seconds.`,
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
      rewards: attackerWins ? (district?.rewards ?? {}) : {},
    };
  }
}

/** Default engine instance the server should inject unless configured otherwise. */
export const defaultBattleEngine: BattleEngine = new RandomBattleEngine();
