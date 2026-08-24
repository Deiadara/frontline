import {
  mulberry32,
  seedFrom,
  type Army,
  type District,
  type LocationHolder,
} from '@frontline/shared';

/**
 * What the Combine and the looters move up when somebody calls them out (GDD §A3, §A4).
 *
 * The board's rule is that **every participant** — player or NPC — sends units towards a declared
 * fight, and a defender who does nothing about a day's notice is not a defender, they are a static
 * difficulty number. So an NPC musters too.
 *
 * Two properties are load-bearing:
 *
 * - **Deterministic.** Drawn off the battle's own seed, so the reinforcement is fixed the moment the
 *   fight is declared and cannot be re-rolled by anybody reading the board twice. It is also the
 *   same for every observer, which is what lets a scout's count mean something.
 * - **Decided at declaration, not at resolution.** It exists from the moment the call is made, so it
 *   is a thing an attacker can scout and plan against over the sixteen hours they have — rather than
 *   an ambush that materialises on the mark, which would make scouting pointless.
 *
 * The composition is the same split `startingGarrison` uses: the Combine fields a line, the looters
 * field numbers. Written once here rather than derived from that function because the two answer
 * different questions — that one is "who lives here", this one is "who came running".
 */

/** Bodies per point of district difficulty. Tuned against what a first real assault brings. */
export const NPC_MUSTER_PER_DIFFICULTY = 1.6;

/** ...and the spread the roll moves it over, so the same district is not the same fight twice. */
export const NPC_MUSTER_VARIANCE = 0.4;

export function npcMuster(holder: LocationHolder, district: District, seed: string): Army {
  if (holder.kind !== 'government' && holder.kind !== 'looters') return {};

  const next = mulberry32(seedFrom(`${seed}:muster`));
  const swing = 1 + (next() * 2 - 1) * NPC_MUSTER_VARIANCE;
  const strength = Math.max(2, Math.round(district.difficulty * NPC_MUSTER_PER_DIFFICULTY * swing));

  if (holder.kind === 'government') {
    const wardens = Math.max(1, Math.round(strength * 0.6));
    return { wardens, snipers: Math.max(1, strength - wardens) };
  }
  const razors = Math.max(1, Math.round(strength * 0.7));
  return { razors, scrapers: Math.max(1, strength - razors) };
}
