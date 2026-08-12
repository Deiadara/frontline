import { findDistrict } from '../city.js';
import type { BattleEngine, BattleInput, BattleResult } from './types.js';

// TODO: replace RandomBattleEngine with a real deterministic combat model (see docs/ARCHITECTURE.md).
// It must weigh overseer skills, building levels (walls/barracks), district difficulty and
// commander bonuses, and be seedable so battles are replayable from the persisted Battle row.

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
    const attackerWins = this.random() < 0.5;

    const log = [
      `Strike team deployed from base ${input.attackerBaseId} under a dead satellite window.`,
      `Netrunners spoof the sentry grid at ${target}; drones circle blind for 41 seconds.`,
      attackerWins
        ? `Breach charges crack the ferrocrete line — defenders of ${target} scatter into the undergrid.`
        : `Counter-ICE flares white-hot; the assault on ${target} collapses at the perimeter wall.`,
      attackerWins
        ? 'Salvage crews strip the site before corporate response teams arrive. Victory.'
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
