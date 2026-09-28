import {
  buildingLevel,
  type Base,
  type BuildQueue,
  type Building,
  type CapturedGate,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { gateFor } from '../city/gates.js';

/**
 * What a Wall Breaker leaves behind (maintainer, 2026-09-26). See `UnitSpec.wall_breaker`.
 *
 * The engine takes the gates' toughness off the fight (`breaksWalls` in `battle/engine.ts`). This
 * is the part that writes: the gate the fight was at comes down one level, win or lose, and never
 * below one. That is the same gate the fight reads, and only at that gate (maintainer, 2026-09-28):
 * the defending crew's home Gate in a fight at its own gate, or the gate raised on a district held
 * whole in a fight at that district's gate. A Colossus at a location lowers nothing.
 *
 * An upgrade in flight comes down with it. Both kinds store the level they are going *to*, so a
 * gate knocked from five to four while it was being raised to six would otherwise finish at six,
 * which is the Colossus's damage undone by a clock. The work already paid for still lands, one
 * level lower.
 */

/** The lowest a gate is taken to. A level-one gate is left as it is. */
export const WALL_BREAKER_GATE_FLOOR = 1;

export interface GateLowered {
  which: 'home' | 'district';
  from: number;
  to: number;
}

/** One level off, never under the floor. */
function lowered(level: number): number {
  return Math.max(WALL_BREAKER_GATE_FLOOR, level - 1);
}

/** The home Gate a level down, and any queued Gate build with it. Null when nothing changes. */
export function lowerHomeGate(
  buildings: readonly Building[],
  queue: BuildQueue,
): { buildings: Building[]; queue: BuildQueue; from: number; to: number } | null {
  const from = buildingLevel(buildings, 'gate');
  const to = lowered(from);
  // `>=` rather than `===`: a crew with no Gate reads level 0, and the floor would raise it.
  if (to >= from) return null;
  return {
    buildings: buildings.map((one) => (one.kind === 'gate' ? { ...one, level: to } : one)),
    queue: queue.map((entry) =>
      entry.kind === 'gate' ? { ...entry, level: Math.max(to + 1, entry.level - 1) } : entry,
    ),
    from,
    to,
  };
}

/** A district's raised gate a level down, and its upgrade with it. Null when nothing changes. */
export function lowerDistrictGate(gate: CapturedGate): CapturedGate | null {
  const to = lowered(gate.level);
  if (to >= gate.level) return null;
  return {
    ...gate,
    level: to,
    upgradingTo: gate.upgradingTo === null ? null : Math.max(to + 1, gate.upgradingTo - 1),
  };
}

/**
 * Takes a level off each gate that stood behind this defence, and says what moved.
 *
 * `defender` is read fresh by the caller after the fight's own writes, so a raid that also damaged
 * the district is lowered from where the raid left it rather than from a snapshot taken before.
 */
export function lowerGatesInPlay(
  repos: Repositories,
  defender: Base | undefined,
  districtGateStood: { districtId: string } | null,
): GateLowered[] {
  const moved: GateLowered[] = [];
  if (defender) {
    const home = lowerHomeGate(defender.buildings, defender.buildQueue);
    if (home) {
      repos.bases.updateDistrict(defender.id, home.buildings, home.queue);
      moved.push({ which: 'home', from: home.from, to: home.to });
    }
  }
  if (districtGateStood) {
    const gate = gateFor(repos, districtGateStood.districtId);
    const next = lowerDistrictGate(gate);
    if (next) {
      repos.capturedGates.put(next);
      moved.push({ which: 'district', from: gate.level, to: next.level });
    }
  }
  return moved;
}

/** The report's line for each gate that came down, in the player's words. */
export function gateLoweredLine(lowered: GateLowered): string {
  const whose = lowered.which === 'home' ? 'The Gate' : 'The district gate';
  return `${whose} came down a level under the Colossus, from ${lowered.from} to ${lowered.to}.`;
}
