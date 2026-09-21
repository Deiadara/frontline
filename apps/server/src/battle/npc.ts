import {
  combineGarrison,
  combineSlotBudget,
  looterGarrison,
  mulberry32,
  seedFrom,
  type Army,
  type District,
  type LocationHolder,
} from '@frontline/shared';

/**
 * What the Combine and the looters move up when somebody calls them out (GDD §A3, §A4).
 *
 * The board's rule is that **every participant**, player or NPC, sends units towards a declared
 * fight, and a defender who does nothing about a day's notice is not a defender, they are a static
 * difficulty number. So an NPC musters too.
 *
 * Two properties are load-bearing:
 *
 * - **Deterministic.** Drawn off the battle's own seed, so the reinforcement is fixed the moment the
 *   fight is declared and cannot be re-rolled by anybody reading the board twice. It is also the
 *   same for every observer, which is what lets a scout's count mean something.
 * - **Decided at declaration, not at resolution.** It exists from the moment the call is made, so it
 *   is a thing an attacker can scout and plan against over the sixteen hours they have: rather than
 *   an ambush that materialises on the mark, which would make scouting pointless.
 *
 * The composition is `startingGarrison`'s, read off the same tables (`city/combine.ts`): the
 * Combine fields the district's own regiment, the looters field numbers. Shared rather than
 * copied since 2026-09-19, so the ladder of who stands where has one author.
 */

/** Units per point of district difficulty. Tuned against what a first real assault brings. */
export const NPC_MUSTER_PER_DIFFICULTY = 1.6;

/**
 * What a Combine muster is worth against the garrison already standing there, as a share of the
 * district's own slot budget (`combineSlotBudget`).
 *
 * Half, so answering a declaration is a real reinforcement without being a second garrison: a
 * crew that scouts a plot and brings enough for what it saw should find the fight harder than
 * the plot, and not twice as hard.
 */
export const NPC_MUSTER_SHARE = 0.5;

/** ...and the spread the roll moves it over, so the same district is not the same fight twice. */
export const NPC_MUSTER_VARIANCE = 0.4;

export function npcMuster(holder: LocationHolder, district: District, seed: string): Army {
  if (holder.kind !== 'government' && holder.kind !== 'looters') return {};

  const next = mulberry32(seedFrom(`${seed}:muster`));
  const swing = 1 + (next() * 2 - 1) * NPC_MUSTER_VARIANCE;
  const strength = Math.max(2, Math.round(district.difficulty * NPC_MUSTER_PER_DIFFICULTY * swing));

  // The same faces `startingGarrison` stands on the ground (`city/combine.ts`), scaled by the
  // district: a muster is the district's own regiment turning out, not a different army. The
  // leaders are never in it: he stands on his one plot and nowhere else.
  // A muster is a *share* of what the district can turn out, in the same unit slots the garrison
  // is sized in (`combineSlotBudget`): a head count here would have the same bug the garrison had,
  // where twenty Suppressors and twenty Levy were called the same reinforcement.
  if (holder.kind === 'government') {
    return combineGarrison(
      district.difficulty,
      Math.max(2, Math.round(combineSlotBudget(district.difficulty, 0) * NPC_MUSTER_SHARE * swing)),
    );
  }
  return looterGarrison(strength);
}
