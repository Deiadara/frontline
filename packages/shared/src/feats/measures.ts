import { z } from 'zod';

/**
 * Feats: the things a crew is asked to do, and what the game is willing to count (maintainer request,
 * 2026-09-13).
 *
 * ## Why a closed vocabulary of measures
 *
 * A feat is a threshold on a number. The temptation is to let each feat carry a predicate over the
 * whole game state, which reads well for the first ten and then means five hundred
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
  'buildings_maxed',
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
  'battles_won_outnumbered',
  'fights_won_at_tier',
  'battles_won_overwhelmed',
  'battles_won_flawless',
  'battles_won_lopsided',
  'battles_won_jamming',
  'battles_won_planted',
  'battles_won_loud',
  'districts_raided',
  'raids_repelled',
  'trap_kills',
  'runners_caught',
  'bodies_deployed',
  'supply_deployed',
  'kills',
  // The Combine (maintainer, 2026-09-19): a section of its own on the board.
  'combine_kills',
  'combine_kills_of',
  'combine_leaders_slain',
  'combine_locations_taken',
  'combine_fights_won',
  'combine_fights_won_flawless',
  'combine_fights_won_shadowed',
  'units_turned',
  'units_routed',
  'combine_districts_held',
  'chapel_held',
  'units_trained',
  'drills_paired',
  'overseer_taken',
  'buildings_raised',
  'officers_hired',
  'pages_found',
  'masterpieces_reimagined',
  'automated_parties',
  'bench_trades',
  'bench_experience',
  'vehicles_built',
  'resources_earned',
  'infamy_earned',
  'market_sales',
  'market_buys',
  'contraband_taken',
  'scouting_runs',
  'spy_reports',
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
 * is here rather than on each feat: five hundred feats would otherwise repeat twenty
 * words, and the day one of them is reworded the other five saying the same thing would not be.
 */
export const FEAT_MEASURE_SPECS: Readonly<Record<FeatMeasure, FeatMeasureSpec>> = {
  level: { source: 'crew', scoped: false, unit: 'levels' },
  infamy_held: { source: 'crew', scoped: false, unit: 'infamy' },
  notoriety: { source: 'crew', scoped: false, unit: 'rungs' },
  research_done: { source: 'crew', scoped: false, unit: 'programmes' },
  building_level: { source: 'crew', scoped: true, unit: 'levels' },
  buildings_total: { source: 'crew', scoped: false, unit: 'levels' },
  /**
   * Structures standing at their own ceiling, which is not the same number for all of them
   * (`building/kinds.ts`: the Garage and the Infirmary stop at 10, everything else at 20).
   *
   * A crew measure, because a structure can be dismantled and because the question is "is your
   * district finished", which has to be able to stop being true.
   */
  buildings_maxed: { source: 'crew', scoped: false, unit: 'structures' },
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
  /**
   * The seven ways a win is worth telling somebody about. See `feats/battle.ts` for what each one
   * asks and why the line is drawn where it is; the counters themselves are ordinary tallies, one
   * per fight that qualified, so a ladder on one of them climbs like any other.
   */
  battles_won_outnumbered: { source: 'tally', scoped: false, unit: 'wins' },
  /**
   * Battle jobs won, by the tier the board dealt them at (`BATTLE_TIERS`), so the top of the
   * ladder can be a feat: a Fight V held, a Siege held. Scoped by the tier id.
   */
  fights_won_at_tier: { source: 'tally', scoped: true, unit: 'wins' },
  battles_won_overwhelmed: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_flawless: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_lopsided: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_jamming: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_planted: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_loud: { source: 'tally', scoped: false, unit: 'wins' },
  /** Break-ins on a lived-in district: one counts for whoever forced it, the other for whoever did not let them. */
  districts_raided: { source: 'tally', scoped: false, unit: 'raids' },
  raids_repelled: { source: 'tally', scoped: false, unit: 'raids' },
  /** What a trap took off a column before anybody was in contact, counted for whoever laid it. */
  trap_kills: { source: 'tally', scoped: false, unit: 'kills' },
  /** Beaten runners a ring stopped on the way out, counted for the side that set it. */
  runners_caught: { source: 'tally', scoped: false, unit: 'runners' },
  bodies_deployed: { source: 'tally', scoped: false, unit: 'units' },
  supply_deployed: { source: 'tally', scoped: false, unit: 'unit slots' },
  kills: { source: 'tally', scoped: false, unit: 'kills' },
  /**
   * The Combine's own ledger (maintainer, 2026-09-19). Tallied at the settle of any fight where
   * the defender was the regime (`apps/server/src/battle/resolve.ts`, `tallyCombineFight`).
   * `combine_kills_of` is scoped by the Combine unit's id and `combine_leaders_slain` by the
   * leader's; a leader dies once per world, so that ladder is a set of three standalones.
   */
  combine_kills: { source: 'tally', scoped: false, unit: 'kills' },
  combine_kills_of: { source: 'tally', scoped: true, unit: 'kills' },
  combine_leaders_slain: { source: 'tally', scoped: true, unit: 'leaders' },
  combine_locations_taken: { source: 'tally', scoped: false, unit: 'holdings' },
  combine_fights_won: { source: 'tally', scoped: false, unit: 'wins' },
  combine_fights_won_flawless: { source: 'tally', scoped: false, unit: 'wins' },
  /** Won in a district whose Combine legendary was still standing at the time. */
  combine_fights_won_shadowed: { source: 'tally', scoped: false, unit: 'wins' },
  /** Units of yours that changed sides under Directive Xero and never came back. */
  units_turned: { source: 'tally', scoped: false, unit: 'units' },
  /**
   * Enemy units this crew made break and run rather than killed, in a declared fight or off a
   * battle job. Counted at the settle off the engine's own `fled`, which is what the half-infamy
   * for a rout (`infamyForFled`) is paid on, so the feat and the ledger read one number.
   */
  units_routed: { source: 'tally', scoped: false, unit: 'units' },
  /** Crew measures: districts that were the Combine's held whole, and the Chapel itself. */
  combine_districts_held: { source: 'crew', scoped: false, unit: 'districts' },
  chapel_held: { source: 'crew', scoped: false, unit: 'chapels' },
  units_trained: { source: 'tally', scoped: false, unit: 'units' },
  /** Drills started while somebody else was already on the floor: the second bench, used. */
  drills_paired: { source: 'tally', scoped: false, unit: 'drills' },
  /**
   * The moment an account picks the person the district answers to, counted once and for ever.
   *
   * Singular where every other tally is plural, because the thing it counts happens exactly once:
   * `POST /overseer` refuses a second character and migration 0074 puts a unique index under that
   * refusal, so `overseers_taken` would be a name promising a number that can only ever be one.
   *
   * A tally and not a crew measure, although "do you have an Overseer" is plainly a fact about the
   * crew right now. The crew half of the snapshot is built from the `bases` row alone
   * (`feats/snapshot.ts`), and the character hangs off the *account*; the only reader that has both
   * is `feats/project.ts`, which exists to answer questions about the Overseer's skills rather
   * than about whether there is one. A counter written at the door is one line at the one place
   * that knows.
   */
  overseer_taken: { source: 'tally', scoped: false, unit: 'overseers' },
  buildings_raised: { source: 'tally', scoped: false, unit: 'levels' },
  officers_hired: { source: 'tally', scoped: false, unit: 'officers' },
  pages_found: { source: 'tally', scoped: false, unit: 'pages' },
  /**
   * Masterpiece pages that came back off the Reimagining bench, counted where the bench hands
   * them over.
   *
   * Its own counter rather than a slice of `pages_found`, because the two ask different questions:
   * `pages_found` is how much paper a crew has gathered from anywhere, and this is how often the
   * one door whose payout the player can steer paid out at the top tier. The odds run from 0.5% on
   * three Basic sheets to 80% on three Masterpiece ones (`blueprints/reimagine-odds.ts`), so the
   * number says what a crew has been putting in the sockets as much as what it got out.
   */
  masterpieces_reimagined: { source: 'tally', scoped: false, unit: 'masterpieces' },
  /**
   * Parties the Right Hand sent out on a standing order (`automations/runners.ts`), counted at
   * the send. Its own counter rather than a slice of `missions_done`, because the question is
   * not how many jobs came home but how much of the board the crew has handed to the chair.
   */
  automated_parties: { source: 'tally', scoped: false, unit: 'parties' },
  /** Every press of the Reimagining lever that took three pages, whatever came out. */
  bench_trades: { source: 'tally', scoped: false, unit: 'trades' },
  /**
   * Presses that paid experience rather than a page: the bench run with nothing left in the game
   * to find (`REIMAGINING_COMPLETE_XP`). Its own counter because it is the one thing on this
   * screen a finished collection can still do, and a feat on it is the only way the screen says so.
   */
  bench_experience: { source: 'tally', scoped: false, unit: 'payouts' },
  vehicles_built: { source: 'tally', scoped: false, unit: 'machines' },
  resources_earned: { source: 'tally', scoped: true, unit: 'earned' },
  infamy_earned: { source: 'tally', scoped: false, unit: 'infamy' },
  market_sales: { source: 'tally', scoped: false, unit: 'deals' },
  market_buys: { source: 'tally', scoped: false, unit: 'deals' },
  contraband_taken: { source: 'tally', scoped: false, unit: 'takes' },
  scouting_runs: { source: 'tally', scoped: false, unit: 'runs' },
  spy_reports: { source: 'tally', scoped: false, unit: 'reports' },
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
 * feat nobody can finish. `apps/server/src/feats/tallies.test.ts` pins both directions.
 *
 * That sentence named `feats.tallies.test.ts` for a long time and no such file existed, so the gate
 * it describes was guarding nothing at all: a measure could be authored with no writer and the feat
 * built on it would sit at zero for ever, on the one screen that tells a player what to do. Written
 * on 2026-09-18, after nine tally measures landed in a single change.
 */
export const FEAT_TALLY_MEASURES: readonly FeatMeasure[] = FEAT_MEASURES.filter(
  (measure) => FEAT_MEASURE_SPECS[measure].source === 'tally',
);
