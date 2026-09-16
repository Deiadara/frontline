import { z } from 'zod';

/**
 * Feats: the things a crew is asked to do, and what the game is willing to count (maintainer request,
 * 2026-09-13).
 *
 * ## Why a closed vocabulary of measures
 *
 * A feat is a threshold on a number. The temptation is to let each feat carry a predicate over the
 * whole game state, which reads well for the first ten and then means two hundred
 * functions nobody can price, nobody can show a progress bar for, and nobody can test except by
 * playing. Instead every feat names one measure out of the list below and a target, so:
 *
 *   * a progress bar is `value / target` for free, on every feat, with no per-feat code;
 *   * the catalogue is data, so the whole of it can be checked for balance in one test;
 *   * the server's job is one flat record of numbers, which is cheap to build and cheap to cache.
 *
 * ## Where a measure's number comes from
 *
 * Two sources, and the difference is load-bearing.
 *
 * **`crew`** measures are read off state the game already keeps: the level on the row, the
 * buildings standing in the district, the officers on the books. They are free, they are exact,
 * and they can go **down** (an army dies, a stockpile is spent). A feat on one of these is asking
 * "is this true of you right now".
 *
 * **`tally`** measures are counters the server increments when something happens, because the game
 * kept no record of it. They only ever go up. A feat on one of these is asking "have you ever".
 * The maintainer asked for exactly this distinction in one of its examples: "Get X total caps (not
 * currently, total even counting spent)". `resources_held` is the wallet; `resources_earned` is
 * the lifetime figure, and they are different measures on purpose.
 *
 * Two of these could have been derived instead of counted. Missions run and battles won are both
 * recoverable by scanning the `missions` and `scheduled_battles` tables, which are never pruned.
 * They are tallies anyway: the crew file already pays to scan up to two thousand battle rows to
 * print a win/loss record, and a feats screen asking a dozen such questions on every poll would be
 * the slowest thing in the server. A counter is one integer read.
 *
 * ## Scope
 *
 * Some measures are a family rather than a number: missions run *in a district*, levels of *one
 * building*, a *particular* resource. Those carry a scope, and the snapshot keys them as
 * `measure:scope`. A measure that takes a scope must always be given one, and a measure that does
 * not take one must never be: {@link featMeasureKey} is the only place that shape is decided, and
 * `catalog.test.ts` holds every feat to it.
 */

export const FEAT_MEASURE_SOURCES = ['crew', 'tally'] as const;
export type FeatMeasureSource = (typeof FEAT_MEASURE_SOURCES)[number];

export const FEAT_MEASURES = [
  // --- what is true of the crew right now ---
  'level',
  'infamy_held',
  'notoriety',
  'research_done',
  'building_level',
  'buildings_total',
  'modifications_fitted',
  'modification_sets',
  'unit_modifications_fitted',
  'masterpieces_fitted',
  'army_units',
  'army_unit_slots',
  'unit_kinds_held',
  'fleet_size',
  'officers_held',
  'officer_best_mark',
  'overseer_skills_at',
  'overseer_best_skill',
  'districts_held_whole',
  'locations_held',
  'districts_scouted',
  'faction_infamy',
  'faction_seats',
  'blueprints_unlocked',
  'resources_held',
  'inventory_kinds',

  // --- what the crew has ever done ---
  'missions_done',
  'missions_won',
  'missions_in_area',
  'missions_of_kind',
  'battles_fought',
  'battles_won',
  'battles_attacked_won',
  'battles_defended_won',
  'bodies_deployed',
  'supply_deployed',
  'kills',
  'units_trained',
  'buildings_raised',
  'officers_hired',
  'pages_found',
  'vehicles_built',
  'resources_earned',
  'infamy_earned',
  'market_sales',
  'market_buys',
  'contraband_taken',
  'scouting_runs',
  'locations_captured',
  'gates_captured',
  'traps_built',
  'addons_built',
  'messages_sent',
] as const;

export const FeatMeasureSchema = z.enum(FEAT_MEASURES);
export type FeatMeasure = z.infer<typeof FeatMeasureSchema>;

export interface FeatMeasureSpec {
  /** Where the number comes from. See the note at the top. */
  readonly source: FeatMeasureSource;
  /** Whether this measure names a family and therefore needs a scope. */
  readonly scoped: boolean;
  /** What the screen calls the quantity, in the player's words, for the progress line. */
  readonly unit: string;
}

/**
 * Every measure, its source and its unit.
 *
 * The unit is the word after the number on a progress line ("14 / 25 missions"), which is why it
 * is here rather than on each feat: two hundred feats would otherwise repeat twenty
 * words, and the day one of them is reworded the other five saying the same thing would not be.
 */
export const FEAT_MEASURE_SPECS: Readonly<Record<FeatMeasure, FeatMeasureSpec>> = {
  level: { source: 'crew', scoped: false, unit: 'levels' },
  infamy_held: { source: 'crew', scoped: false, unit: 'infamy' },
  notoriety: { source: 'crew', scoped: false, unit: 'rungs' },
  research_done: { source: 'crew', scoped: false, unit: 'programmes' },
  building_level: { source: 'crew', scoped: true, unit: 'levels' },
  buildings_total: { source: 'crew', scoped: false, unit: 'levels' },
  modifications_fitted: { source: 'crew', scoped: false, unit: 'fittings' },
  modification_sets: { source: 'crew', scoped: false, unit: 'sets' },
  /**
   * Unit modification cards in a unit's brackets (`units/loadout.ts`), and the MASTERPIECE ones
   * among them. Crew measures, because a burn takes a card out: "have you ever" would stay lit over
   * an empty bracket.
   */
  unit_modifications_fitted: { source: 'crew', scoped: false, unit: 'cards' },
  masterpieces_fitted: { source: 'crew', scoped: false, unit: 'masterpieces' },
  army_units: { source: 'crew', scoped: false, unit: 'units' },
  army_unit_slots: { source: 'crew', scoped: false, unit: 'unit slots' },
  unit_kinds_held: { source: 'crew', scoped: false, unit: 'kinds' },
  fleet_size: { source: 'crew', scoped: false, unit: 'machines' },
  officers_held: { source: 'crew', scoped: false, unit: 'officers' },
  officer_best_mark: { source: 'crew', scoped: false, unit: 'marks' },
  overseer_skills_at: { source: 'crew', scoped: true, unit: 'skills' },
  overseer_best_skill: { source: 'crew', scoped: false, unit: 'points' },
  districts_held_whole: { source: 'crew', scoped: false, unit: 'districts' },
  locations_held: { source: 'crew', scoped: false, unit: 'holdings' },
  districts_scouted: { source: 'crew', scoped: false, unit: 'districts' },
  faction_infamy: { source: 'crew', scoped: false, unit: 'infamy' },
  faction_seats: { source: 'crew', scoped: false, unit: 'seats' },
  blueprints_unlocked: { source: 'crew', scoped: false, unit: 'blueprints' },
  resources_held: { source: 'crew', scoped: true, unit: 'held' },
  inventory_kinds: { source: 'crew', scoped: false, unit: 'kinds' },

  missions_done: { source: 'tally', scoped: false, unit: 'missions' },
  missions_won: { source: 'tally', scoped: false, unit: 'missions' },
  missions_in_area: { source: 'tally', scoped: true, unit: 'missions' },
  missions_of_kind: { source: 'tally', scoped: true, unit: 'missions' },
  battles_fought: { source: 'tally', scoped: false, unit: 'fights' },
  battles_won: { source: 'tally', scoped: false, unit: 'wins' },
  battles_attacked_won: { source: 'tally', scoped: false, unit: 'wins' },
  battles_defended_won: { source: 'tally', scoped: false, unit: 'holds' },
  bodies_deployed: { source: 'tally', scoped: false, unit: 'units' },
  supply_deployed: { source: 'tally', scoped: false, unit: 'unit slots' },
  kills: { source: 'tally', scoped: false, unit: 'kills' },
  units_trained: { source: 'tally', scoped: false, unit: 'units' },
  buildings_raised: { source: 'tally', scoped: false, unit: 'levels' },
  officers_hired: { source: 'tally', scoped: false, unit: 'officers' },
  pages_found: { source: 'tally', scoped: false, unit: 'pages' },
  vehicles_built: { source: 'tally', scoped: false, unit: 'machines' },
  resources_earned: { source: 'tally', scoped: true, unit: 'earned' },
  infamy_earned: { source: 'tally', scoped: false, unit: 'infamy' },
  market_sales: { source: 'tally', scoped: false, unit: 'deals' },
  market_buys: { source: 'tally', scoped: false, unit: 'deals' },
  contraband_taken: { source: 'tally', scoped: false, unit: 'takes' },
  scouting_runs: { source: 'tally', scoped: false, unit: 'runs' },
  locations_captured: { source: 'tally', scoped: false, unit: 'holdings' },
  gates_captured: { source: 'tally', scoped: false, unit: 'gates' },
  traps_built: { source: 'tally', scoped: false, unit: 'traps' },
  addons_built: { source: 'tally', scoped: false, unit: 'fittings' },
  messages_sent: { source: 'tally', scoped: false, unit: 'letters' },
};

/**
 * The key a measure reads under in a snapshot.
 *
 * One function, because the server writes these keys and the evaluator reads them, and the two
 * spelling it themselves is the bug where a feat sits at zero forever while everything else about
 * it is right.
 */
export function featMeasureKey(measure: FeatMeasure, scope?: string): string {
  return scope === undefined ? measure : `${measure}:${scope}`;
}

/**
 * Every number a feat might want, flat.
 *
 * Deliberately not a nested object shaped like the game. It is assembled once per read and then
 * only ever looked up by key, so the shape that matters is the one the lookup wants.
 */
export type FeatSnapshot = Readonly<Record<string, number>>;

export function featValue(snapshot: FeatSnapshot, measure: FeatMeasure, scope?: string): number {
  return snapshot[featMeasureKey(measure, scope)] ?? 0;
}

/**
 * The tally keys the server increments, which are the snapshot keys of every `tally` measure.
 *
 * Exported so the server's counter table and this vocabulary cannot drift: a tally written under a
 * name no measure reads is a counter nothing will ever ask for, and a measure with no writer is a
 * feat nobody can finish. `feats.tallies.test.ts` pins both directions.
 */
export const FEAT_TALLY_MEASURES: readonly FeatMeasure[] = FEAT_MEASURES.filter(
  (measure) => FEAT_MEASURE_SPECS[measure].source === 'tally',
);
