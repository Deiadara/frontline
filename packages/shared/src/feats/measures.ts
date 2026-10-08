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
  // Maintainer, 2026-09-30: the book grows by purchase with no top, so how wide it is is a ladder.
  'payroll_capacity',
  'officer_best_mark',
  'overseer_skills_at',
  'overseer_best_skill',
  'overseer_grade',
  'districts_held_whole',
  'locations_held',
  // The second city (maintainer, 2026-09-24): what a crew has done somewhere it does not live.
  'locations_held_abroad',
  'districts_held_whole_abroad',
  'cities_held',
  'rail_stations_held',
  // Arca (opened 2026-10-07): the tombs, which are the city's one trait as the line is Terminus's.
  'mausoleums_held',
  // P8-C (2026-10-02): the best-worked holding this crew stands on.
  'location_level_held',
  'faction_infamy',
  'faction_seats',
  'blueprints_unlocked',
  'resources_held',
  'inventory_kinds',

  // --- what the crew has ever done ---
  'missions_done',
  'missions_won',
  'missions_in_area',
  'mission_districts',
  'missions_on_combine_ground',
  'missions_of_kind',
  'battles_fought',
  'battles_won',
  'battles_attacked_won',
  'battles_defended_won',
  'battles_won_outnumbered',
  'fights_won_in_category',
  'jobs_won_at_letter',
  'jobs_won_long_odds',
  'battles_won_overwhelmed',
  'battles_won_flawless',
  'battles_won_lopsided',
  'battles_won_jamming',
  'battles_won_planted',
  'battles_won_loud',
  'battles_won_abroad',
  'rail_journeys',
  'districts_raided',
  'raids_repelled',
  'trap_kills',
  'gate_levels_broken',
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
  // The week (maintainer, 2026-09-24): the NPC army erodes, and Monday morning puts it back.
  'districts_emptied',
  'plots_held_through_regrowth',
  'units_mustered',
  'units_mustered_of',
  'drills_third_in_line',
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
  'spy_reports',
  'spy_jobs_returned',
  'spy_jobs_unnoticed',
  'courier_reports',
  'locations_captured',
  'gates_breached',
  'traps_built',
  // P11-B (2026-10-02): a trap that went off under a fight, and a name burned on one.
  'traps_sprung',
  'names_burned',
  // The Stackhouse (2026-10-05): bets put down, and bets that came in.
  'stackhouse_bets',
  'stackhouse_wins',
  // P14-B (2026-10-02): the medics' work.
  'casualties_recovered',
  // P8-C (2026-10-02): working up held ground, and raising a captured gate.
  'location_levels_raised',
  'gate_levels_raised',
  'addons_built',
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
  /**
   * The payroll book's ceiling right now, in caps (`economy/payroll.ts`): the Nexus, the
   * expansions bought, the Quarters and the payroll cards. A crew measure, because demolishing the
   * Nexus or pulling a card shrinks it and the question is "how wide is your book".
   */
  payroll_capacity: { source: 'crew', scoped: false, unit: 'caps' },
  officer_best_mark: { source: 'crew', scoped: false, unit: 'marks' },
  overseer_skills_at: { source: 'crew', scoped: true, unit: 'skills' },
  overseer_best_skill: { source: 'crew', scoped: false, unit: 'points' },
  /**
   * The Overseer's own grade, as an index on the mark ladder (2026-10-04): read on the seat
   * `ROLE_IMPORTANCE.overseer` and the sheet the Right Hand lifts, the one the crew screen shows.
   */
  overseer_grade: { source: 'crew', scoped: false, unit: 'marks' },
  districts_held_whole: { source: 'crew', scoped: false, unit: 'districts' },
  locations_held: { source: 'crew', scoped: false, unit: 'holdings' },
  /**
   * The frontier measures (maintainer, 2026-09-24): "feats for doing stuff in another city".
   *
   * All four are read off the control map rather than tallied, for the reason every holding
   * measure is: ground abroad is ground somebody can take back, and a crew that was thrown out of
   * Terminus last week should not still be wearing the feat for being there.
   *
   * **Abroad** is measured against the city the crew's own district sits in (`cityOf`), not
   * against a column on the crew row. A crew gets its foothold in a second city by marching across
   * and taking ground, and it keeps living where it lived, so "abroad" has to be derived from the
   * map on every read or it is a fact that goes stale the first time a district is moved.
   *
   * `cities_held` counts cities the crew holds at least one location in, home only when something
   * there is held. It is not
   * the same question as `locations_held_abroad > 0`: a crew that has taken a platform in Terminus
   * and nothing at all in Ashfall is abroad but is only in one city.
   */
  locations_held_abroad: { source: 'crew', scoped: false, unit: 'holdings' },
  districts_held_whole_abroad: { source: 'crew', scoped: false, unit: 'districts' },
  cities_held: { source: 'crew', scoped: false, unit: 'cities' },
  /**
   * Stations held, which is the whole of the railway a crew can own (`city/rails.ts`).
   *
   * Seven of Terminus's eight contested districts hold one `rail_station` and Telemetry Hill holds
   * none, so the ceiling is seven and two is the number that matters: a train needs a platform at
   * both ends, and one Station is a building rather than a railway.
   */
  rail_stations_held: { source: 'crew', scoped: false, unit: 'platforms' },
  /**
   * Mausoleums held, which is the whole of Arca's one trait (`DISTRICTS.md`, "The Mausoleums").
   *
   * One in each of the city's eight contested districts, so the ceiling is eight. One is the
   * number that matters: it opens the Death Cloaks, and every one after it puts thirty damage and
   * thirty vitality on each of them and lets the crew keep fifty more.
   */
  mausoleums_held: { source: 'crew', scoped: false, unit: 'tombs' },
  /** The highest level among the locations this crew holds right now. */
  location_level_held: { source: 'crew', scoped: false, unit: 'levels' },
  faction_infamy: { source: 'crew', scoped: false, unit: 'infamy' },
  faction_seats: { source: 'crew', scoped: false, unit: 'seats' },
  blueprints_unlocked: { source: 'crew', scoped: false, unit: 'blueprints' },
  resources_held: { source: 'crew', scoped: true, unit: 'held' },
  inventory_kinds: { source: 'crew', scoped: false, unit: 'kinds' },

  missions_done: { source: 'tally', scoped: false, unit: 'missions' },
  missions_won: { source: 'tally', scoped: false, unit: 'missions' },
  missions_in_area: { source: 'tally', scoped: true, unit: 'missions' },
  /*
   * Two readings of the same tallies, so a feat about the board does not have to name a district
   * (maintainer, 2026-10-07: "make sure generally the feats can be done by people spawned in any
   * city"). A board belongs to the crew's own city and opens only on a district it holds whole, so
   * a feat naming Steelbelt was work half the players could never reach. Derived in the snapshot
   * off the `missions_in_area` family rather than tallied again, which means they count the runs
   * already in the table.
   */
  mission_districts: { source: 'crew', scoped: false, unit: 'districts' },
  missions_on_combine_ground: { source: 'crew', scoped: false, unit: 'missions' },
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
   * Battle jobs won, by what the grade they were dealt at makes them (`fightCategory`), so the top
   * of the ladder can be a feat: a Siege held, a Mayhem held. Scoped by the category id.
   */
  fights_won_in_category: { source: 'tally', scoped: true, unit: 'wins' },
  /**
   * Jobs of either kind landed, by the letter of the grade they were dealt at (2026-09-28). Scoped
   * by the letter alone, `C` for C-, C and C+, so a feat asks for the rung rather than a mark.
   */
  jobs_won_at_letter: { source: 'tally', scoped: true, unit: 'missions' },
  /**
   * Plain jobs landed on odds under `LONG_ODDS_CHANCE`, read off the chance the run went out with
   * (2026-09-28). Fights are left out: they do not roll a chance, they fight.
   */
  jobs_won_long_odds: { source: 'tally', scoped: false, unit: 'missions' },
  battles_won_overwhelmed: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_flawless: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_lopsided: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_jamming: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_planted: { source: 'tally', scoped: false, unit: 'wins' },
  battles_won_loud: { source: 'tally', scoped: false, unit: 'wins' },
  /**
   * Declared fights won in a city the crew does not live in (2026-09-24).
   *
   * A tally and not a crew measure, because it is the one half of the frontier that is about
   * having gone rather than about still being there: a crew that marched on Terminus, won and was
   * pushed back out has still won a fight abroad. `tally.ts` decides what counts as abroad off the
   * district the fight was in and the district the crew lives in, so the settle site only has to
   * say where it happened.
   */
  battles_won_abroad: { source: 'tally', scoped: false, unit: 'wins' },
  /**
   * Journeys put on Terminus's railway: a unit move or a battle column that chose the train
   * (`city/rails.ts`). Missions and spy jobs never ride, and neither do vehicles or the
   * Colossus, so this counts only the moves the offer was actually taken on.
   */
  rail_journeys: { source: 'tally', scoped: false, unit: 'journeys' },
  /** Break-ins on a lived-in district: one counts for whoever forced it, the other for whoever did not let them. */
  districts_raided: { source: 'tally', scoped: false, unit: 'raids' },
  raids_repelled: { source: 'tally', scoped: false, unit: 'raids' },
  /** What a trap took off a column before anybody was in contact, counted for whoever laid it. */
  trap_kills: { source: 'tally', scoped: false, unit: 'kills' },
  /**
   * Levels a Wall Breaker took off the gates behind a defence (maintainer, 2026-09-26), counted for
   * the crew that called the fight. `battle/wall-breaker.ts` in the server does the lowering.
   */
  gate_levels_broken: { source: 'tally', scoped: false, unit: 'levels' },
  /** Beaten runners a ring stopped on the way out, counted for the side that set it. */
  runners_caught: { source: 'tally', scoped: false, unit: 'runners' },
  bodies_deployed: { source: 'tally', scoped: false, unit: 'units' },
  supply_deployed: { source: 'tally', scoped: false, unit: 'unit slots' },
  kills: { source: 'tally', scoped: false, unit: 'kills' },
  /**
   * The Combine's own ledger (maintainer, 2026-09-19). Tallied at the settle of any fight where
   * the defender was the regime (`apps/server/src/battle/resolve.ts`, `tallyCombineFight`).
   * `combine_kills_of` is scoped by the Combine unit's id and `combine_leaders_slain` by the
   * leader's. A killed leader comes back at the Sunday reset wherever no player holds the plot he
   * stood on (2026-09-24), so the counter can climb past one; the three feats on it are
   * standalones at a target of one all the same, because the first kill is the whole of what there
   * is to reward.
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
  /**
   * The weekly cycle, which is two mechanics and therefore two counters (2026-09-24).
   *
   * **`districts_emptied`**: a district with nothing of the regime's or the squatters' left standing
   * anywhere in it, counted for the crew whose fight took the last of them off. The erosion that
   * makes it possible is `spendGarrisons` in `apps/server/src/battle/resolve.ts`: a gate or district
   * fight is paid for out of the control rows that turned up to it, so a week of assaults really
   * does run a district's garrison down to nothing. A crew's own plot in the district is neither
   * counted nor a blocker, because that garrison is not theirs to strip, and a legendary is never in
   * a gate fight (`withoutTheLeader`), so his district cannot be stripped from the door: his plot
   * has to be taken.
   *
   * **`plots_held_through_regrowth`**: one for every plot a crew still held when the Monday sweep
   * rebuilt everything nobody holds (`apps/server/src/city/regrowth.ts`). Counted in plot-weeks, so
   * it climbs with how much ground you hold *and* how long you keep it, which is the whole of what
   * regrowth added: clearing ground stopped being the same thing as owning it.
   *
   * Both are tallies rather than crew measures. Neither is a fact about the map now: a district the
   * regime has walked back into was still stripped, and a plot lost on Tuesday was still held
   * through Monday. Asking "is this true of you right now" would take both back.
   */
  districts_emptied: { source: 'tally', scoped: false, unit: 'districts' },
  plots_held_through_regrowth: { source: 'tally', scoped: false, unit: 'holdings' },
  units_mustered: { source: 'tally', scoped: false, unit: 'units' },
  /** The same count, by the unit's id: `units_mustered_of:death_cloaks` is the Cloaks raised. */
  units_mustered_of: { source: 'tally', scoped: true, unit: 'units' },
  /** Drills queued with two already on the list: the Professor's third place, used. */
  drills_third_in_line: { source: 'tally', scoped: false, unit: 'drills' },
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
  /** A spy report that stood and named somebody: see `settleSpying`. */
  spy_reports: { source: 'tally', scoped: false, unit: 'reports' },
  /**
   * Every spy job that came home with a report, stood or failed; a job turned round in its first
   * tenth writes none and is not counted. The ladder that replaced the scouting runs (maintainer,
   * 2026-09-29: "repoint to spying"). Distinct from `spy_reports`, which counts only what was learnt.
   */
  spy_jobs_returned: { source: 'tally', scoped: false, unit: 'jobs' },
  /**
   * Jobs home on somebody's ground without them knowing who came (maintainer, 2026-09-28): the
   * thing Traffic Analysis and a better chair buy. Only a crew-held target counts, since looter and
   * Combine ground has nobody to find anybody out.
   */
  spy_jobs_unnoticed: { source: 'tally', scoped: false, unit: 'jobs' },
  /** The reports Turned Runners brings in, one a day at most (`spying/courier.ts`). */
  courier_reports: { source: 'tally', scoped: false, unit: 'reports' },
  locations_captured: { source: 'tally', scoped: false, unit: 'holdings' },
  gates_breached: { source: 'tally', scoped: false, unit: 'gates' },
  traps_built: { source: 'tally', scoped: false, unit: 'traps' },
  /** A trap of this crew's that went off under a fight, killing or not (`springAnyTrap`). */
  traps_sprung: { source: 'tally', scoped: false, unit: 'traps' },
  /** A name bought with infamy on a fight's own screen (`/battles/boost`). Crates do not count. */
  names_burned: { source: 'tally', scoped: false, unit: 'names' },
  /** A bet put down at the Stackhouse (`blackmarket/stackhouse.ts`). */
  stackhouse_bets: { source: 'tally', scoped: false, unit: 'bets' },
  /** A Stackhouse bet that came in: the side backed won the fight. */
  stackhouse_wins: { source: 'tally', scoped: false, unit: 'bets' },
  /** The crew's dead brought round after a won fight, declared or a battle job. */
  casualties_recovered: { source: 'tally', scoped: false, unit: 'units' },
  /** A level of work on held ground landing, for whoever holds it when it lands. */
  location_levels_raised: { source: 'tally', scoped: false, unit: 'levels' },
  /** A level on a captured gate landing, for whoever holds the district whole when it lands. */
  gate_levels_raised: { source: 'tally', scoped: false, unit: 'levels' },
  addons_built: { source: 'tally', scoped: false, unit: 'fittings' },
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
