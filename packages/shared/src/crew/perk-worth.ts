import { findPerk, type PerkBonus } from './perks.js';

/**
 * What a perk is worth, as opposed to how big its number is (maintainer, 2026-09-16).
 *
 * The Bar priced an officer off `ratingAboveAverage(attributes)` and off nothing else, which reads
 * the one half of a person that **can be changed**. Attributes are trainable: an hour on the floor
 * moves them, and a crew that drills every day closes the gap between a good sheet and an ordinary
 * one in a fortnight. Perks cannot be trained, bought or swapped. They are what an officer *is*,
 * permanently, and they were free.
 *
 * So a sheet at 62 carrying `battlefield_surgeon` (+12% of your dead walk back, in every fight you
 * ever have) cost the same as a sheet at 62 carrying `arc_warden` (+18% Anodic damage, which is
 * worth nothing at all until you field Anodics and nothing again the day you stop). The second
 * number is bigger. The first officer is better, and the room charged the same for both.
 *
 * ## Breadth, not magnitude
 *
 * The score below is `magnitude x breadth`, and breadth is the half that matters. It asks one
 * question of a bonus: **how often does this pay?**
 *
 *   * `everywhere` is a bonus that pays on every fight, every hour or every purchase, whatever the
 *     crew is doing and whatever it fields.
 *   * `wide` pays constantly but into one system, so a crew that is not doing that thing this week
 *     gets nothing from it.
 *   * `tier` pays only for one of six unit tiers, `named` only for one unit in thirty-one.
 *   * `conditional` pays only when something is true that the holder does not control: an ally
 *     turned up, the fight is at a Gate, this crew holds the whole district.
 *   * `rule` is a switch rather than a dial. It has no magnitude to scale, so it is priced at its
 *     weight alone: what it is worth is that it is *true*, not that it is large.
 *
 * The weights are deliberately coarse. This decides a price and a rarity band, not a simulation,
 * and a table of sixty hand-tuned coefficients would be sixty numbers nobody could defend.
 */

/** How often a bonus pays, as a share of "on everything, always". */
export const PERK_BREADTH = {
  everywhere: 1,
  wide: 0.7,
  tier: 0.4,
  conditional: 0.35,
  named: 0.15,
  /** Switches: no number to scale, so this is the whole of what they are worth. See `RULE_WORTH`. */
  rule: 1,
} as const;
export type PerkBreadth = keyof typeof PERK_BREADTH;

/**
 * Which band each bonus kind sits in.
 *
 * Written out rather than derived from the union's shape, because the shape does not know the
 * answer: `unit_kind` and `unit_offense` are both `{ percent }` and one of them is thirty-one times
 * narrower than the other. Every kind in `PerkBonus` appears here, and `perkBreadth` falls back to
 * `wide` for anything added tomorrow, which is the middle of the range rather than the top.
 */
export const PERK_BREADTH_BY_KIND: Readonly<Record<string, PerkBreadth>> = {
  // Paid on everything the crew does, whatever it is doing.
  casualty_recovery: 'everywhere',
  xp_gain: 'everywhere',
  infamy_gain: 'everywhere',
  cohesion: 'everywhere',
  unit_offense: 'everywhere',
  unit_vitality: 'everywhere',
  unit_armor: 'everywhere',
  unit_morale: 'everywhere',
  unit_speed: 'everywhere',
  unit_stealth: 'everywhere',
  intimidation: 'everywhere',
  defense_percent: 'everywhere',
  loot_capacity: 'everywhere',
  officer_group: 'everywhere',
  officer_attribute: 'everywhere',
  officer_threshold: 'everywhere',
  unit_slots: 'everywhere',

  // Constant, but into one system: worth nothing on a week spent doing something else.
  production: 'wide',
  resource: 'wide',
  resource_yield: 'wide',
  storage_capacity: 'wide',
  build_speed: 'wide',
  build_cost: 'wide',
  building_cost: 'wide',
  research_speed: 'wide',
  training_speed: 'wide',
  training_cost: 'wide',
  training_sessions: 'wide',
  travel_speed: 'wide',
  mission_speed: 'wide',
  mission_spoils: 'wide',
  market_discount: 'wide',
  black_market_discount: 'wide',
  refit_discount: 'wide',
  salvage_refund: 'wide',
  vehicle_parts: 'wide',
  wage_discount: 'wide',
  payroll_step_discount: 'wide',
  recruit_pool: 'wide',
  intel: 'wide',
  intel_resistance: 'wide',
  vision: 'wide',
  scout_parties: 'wide',
  battle_stims: 'wide',
  road_shortcut: 'wide',
  building_credit: 'wide',

  // One of six tiers, or one of thirty-one units.
  unit_tier: 'tier',
  unit_kind: 'named',
  unit_mark: 'named',

  // Only when something the holder does not control is true.
  allied_offense: 'conditional',
  gate_defense: 'conditional',
  whole_district: 'conditional',
  lead_offense: 'conditional',
  lead_evasion: 'conditional',
  lead_armor: 'conditional',
  lead_morale: 'conditional',
  lead_loot: 'conditional',
  lead_arrival: 'conditional',

  // Switches.
  carriers_fight: 'rule',
  steady_nerve: 'rule',
  any_ride: 'rule',
};

/**
 * What a switch is worth, in the same points a percentage is measured in.
 *
 * Ten, because the three of them change what a force *can do* rather than how well it does it:
 * porters that fight, a line that ignores the panic beside it, everybody on a seat. Priced at a
 * good ordinary percentage rather than at a great one, since none of them is worth anything to a
 * crew that was not going to be in that situation anyway.
 */
export const RULE_WORTH = 10;

/**
 * Kinds whose number is a **count of whole things**, not a percentage.
 *
 * The distinction is the difference between a perk that is worth almost nothing and one that is
 * worth a lot. `{ flat: 1 }` on `training_sessions` is *a whole extra hour on the floor, every
 * day, for ever*; on `unit_morale` it is one point of a hundred. Scored on the same scale, the
 * first came out at 0.7 and sat at the bottom of the catalogue next to the genuinely marginal
 * perks, which is exactly the misreading this module exists to stop.
 *
 * `COUNT_WORTH` is what one whole thing is worth in percentage-points, and it is deliberately
 * generous: these are the bonuses that add a *slot* rather than widen one, and a slot is the sort
 * of thing a crew reorganises around.
 */
const COUNT_KINDS = new Set([
  'vision',
  'scout_parties',
  'training_sessions',
  'battle_stims',
  'unit_slots',
  'building_credit',
]);
const COUNT_WORTH = 9;

/** The size of a bonus, before breadth: whatever number it carries, in its own units. */
function magnitudeOf(bonus: PerkBonus): number {
  const held = bonus as unknown as Record<string, unknown>;
  for (const key of ['percent', 'flat', 'perHour', 'districts', 'minutes', 'levels'] as const) {
    const value = held[key];
    if (typeof value !== 'number') continue;
    return COUNT_KINDS.has(bonus.kind) ? Math.abs(value) * COUNT_WORTH : Math.abs(value);
  }
  // A switch, or a shape with no number in it. `perkWorth` prices those off `RULE_WORTH`.
  return RULE_WORTH;
}

export function perkBreadth(bonus: PerkBonus): PerkBreadth {
  return PERK_BREADTH_BY_KIND[bonus.kind] ?? 'wide';
}

/**
 * One perk's worth, in points.
 *
 * The same scale a percentage is written in, so the numbers stay readable: a perk scoring 12 is
 * "about as good as twelve per cent of something that always matters".
 */
export function bonusWorth(bonus: PerkBonus): number {
  const breadth = perkBreadth(bonus);
  const raw = breadth === 'rule' ? RULE_WORTH : magnitudeOf(bonus) * PERK_BREADTH[breadth];
  return Math.min(MAX_PERK_WORTH, raw);
}

/**
 * The most any single tag may be worth, however large its own number is.
 *
 * Two perks carry counts that score far above the rest (`block_landlord` at +5 unit slots came out
 * at 45, three times a strong combat tag), and priced straight through they asked more for one
 * officer than an end-game payroll book holds in total. A ceiling is the honest fix rather than
 * hand-tuning those two: what the score is *for* is ranking tags against each other, and past a
 * point "this is one of the best tags in the game" is the whole of the information.
 */
export const MAX_PERK_WORTH = 20;

/** ...by id, dropping any the catalogue no longer carries. A retired id is worth nothing. */
export function perkWorth(perkId: string): number {
  const perk = findPerk(perkId);
  return perk ? bonusWorth(perk.bonus) : 0;
}

/** Everything a person carries, added up. This is the half of an officer nobody can train. */
export function perksWorth(perkIds: readonly string[]): number {
  return perkIds.reduce((total, id) => total + perkWorth(id), 0);
}

/**
 * How a roll is meant to draw its tags (maintainer, 2026-09-16).
 *
 * "Better officers do not necessarily have better stats, they have better labels as well, and that
 * matters a lot because tags do not change and attributes can be trained." Until now the Bar drew
 * perks **uniformly**: a green sheet was exactly as likely to walk in carrying "a share of your dead
 * walk back from every fight you ever have" as it was to carry "Anodics cost a little less". The
 * first of those is one of the best things in the game and the second is a footnote, and the room
 * treated them as the same event.
 *
 * So a draw is shaped by what the tag is worth. `plain` makes the broad ones scarce, which is what
 * makes them worth something when they do turn up; `rich` is the draw the Bar's standout seats use,
 * where the good tags are the *likely* ones. Neither is a gate: a green sheet carrying a great tag
 * is precisely the recruit the maintainer described, and it still happens, about a tenth as often as
 * the dull version.
 */
export type PerkDraw = 'plain' | 'rich';

/**
 * How heavily a tag is drawn under each shape. Never zero, so no tag is unreachable at any seat.
 *
 * The curve is `1 / (1 + worth)` against `1 + worth`, which over the live spread (0.7 to the
 * ceiling of 20) makes the best tag about twelve times rarer than the dullest on a plain draw and
 * about twelve times commoner on a rich one. Anything steeper and the top of the catalogue is
 * content nobody sees; anything flatter and this is the uniform draw with extra arithmetic.
 */
export function perkDrawWeight(perkId: string, draw: PerkDraw): number {
  const worth = perkWorth(perkId);
  return draw === 'rich' ? 1 + worth : 1 / (1 + worth);
}
