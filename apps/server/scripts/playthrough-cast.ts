/**
 * The people in the playthrough and what the scenes learn about the world as they go.
 */
import type { Player } from './playthrough-harness.js';

export type Label = 'A' | 'B' | 'C' | 'D' | 'E';

export interface Cast {
  players: Map<Label, Player>;
  /** Missions a response has already reported as resolved: one may never be reported twice. */
  resolvedMissions: Set<string>;
  /** Ids a later scene needs from an earlier one (a faction, a battle, an offer). */
  facts: Map<string, string>;
}

export function newCast(): Cast {
  return { players: new Map(), resolvedMissions: new Set(), facts: new Map() };
}

export function player(cast: Cast, label: Label): Player {
  const found = cast.players.get(label);
  if (!found) throw new Error(`player ${label} was never set up (an earlier scene failed)`);
  return found;
}

export function fact(cast: Cast, key: string): string {
  const found = cast.facts.get(key);
  if (found === undefined) throw new Error(`no ${key} was recorded (an earlier scene failed)`);
  return found;
}
