import { z } from 'zod';
import { describeHoldBonus, type HoldBonus } from '../city/locations.js';

/**
 * Perks: the discrete things an officer brings to the crew (GDD §B7).
 *
 * This replaces the trait system, and the change is what a keyword *means*. A trait moved a couple
 * of the officer's own attributes, which made it a footnote on a sheet the player was already
 * reading: "Wired Reflexes, +8 reflexes" told you slightly more about a number that was already
 * printed two lines below. A perk moves the **crew's** numbers instead, so hiring somebody is a
 * decision about what your whole operation gets better at rather than about their personal sheet.
 *
 * ## They land in the same struct as everything else
 *
 * A perk carries a {@link PerkBonus}, which is a `HoldBonus` minus the one kind that makes no sense
 * off the map. That is the whole integration: `crew/effects.ts` folds them into `CrewEffects` with
 * the fold the city already uses, and the battle engine, the market, the training queue and the
 * settle loop read them without a single new parameter threaded anywhere. A parallel bonus system
 * would have had to be plumbed into each of those by hand, and the plumbing is exactly where a
 * bonus quietly stops applying.
 *
 * ## Nought to three, and they add up
 *
 * An officer rolls between zero and three. They **sum** across the roster rather than taking a
 * best-of the way attributes do, because a perk is a thing a person brought with them rather than
 * a rating the crew has: two officers who both know a foundry manager are two foundry managers.
 * That is also what makes filling nineteen chairs worth the wage bill.
 *
 * Magnitudes are deliberately small, mostly two to six. A full roster is around thirty perks spread
 * over thirty-odd channels, so a channel usually sees one or two of them; the numbers are sized so
 * that is a noticeable edge rather than a doubling.
 *
 * ## All upside, on purpose
 *
 * Every perk is a bonus. The judgement at the Bar is not "is this keyword bad" but "is *this* the
 * bonus my crew needs, at this wage, in this chair" - and with a hundred of them and three slots,
 * the answer is usually no. Scarcity does the work a flaw used to do, without the feel-bad of
 * hiring somebody who makes your crew worse.
 */

/**
 * The channels only *people* push, which the map has no way to grant.
 *
 * These stay off `HoldBonus` on purpose. A channel belongs on the map's vocabulary when ground and
 * people buy the same thing (which is why `intelYieldPercent` lives there), and nowhere on it when
 * they do not: no location negotiates a wage or widens a payroll book.
 */
export type CrewOnlyBonus =
  | { kind: 'production'; percent: number }
  | { kind: 'storage_capacity'; percent: number }
  | { kind: 'build_cost'; percent: number }
  | { kind: 'wage_discount'; percent: number }
  | { kind: 'payroll_step_discount'; percent: number }
  | { kind: 'recruit_pool'; percent: number }
  | { kind: 'intel_resistance'; percent: number }
  | { kind: 'casualty_recovery'; percent: number }
  | { kind: 'cohesion'; percent: number };

/**
 * What a perk can do: every `HoldBonus` except `location`, plus the crew-only channels above.
 *
 * `location` is excluded because it gates a unit behind holding a place, which is a fact about the
 * map rather than about a person.
 */
export type PerkBonus = Exclude<HoldBonus, { kind: 'location' }> | CrewOnlyBonus;

/** Where a perk shows up, for grouping and colour. Nothing branches on it mechanically. */
export const PERK_CATEGORIES = ['economy', 'military', 'logistics', 'people', 'intel'] as const;
export const PerkCategorySchema = z.enum(PERK_CATEGORIES);
export type PerkCategory = z.infer<typeof PerkCategorySchema>;

export const PERK_CATEGORY_LABELS: Record<PerkCategory, string> = {
  economy: 'Economy',
  military: 'Military',
  logistics: 'Logistics',
  people: 'People',
  intel: 'Intel',
};

export interface Perk {
  id: string;
  name: string;
  /** One line, in the player's language. What they did before they worked for you. */
  description: string;
  category: PerkCategory;
  bonus: PerkBonus;
}

/** Shorthand so a hundred entries read as a table rather than as a hundred object literals. */
function perk(
  id: string,
  name: string,
  category: PerkCategory,
  description: string,
  bonus: PerkBonus,
): Perk {
  return { id, name, description, category, bonus };
}

const CATALOG: Perk[] = [
  // --- Economy: what the district makes, holds and pays -------------------------------------
  perk('skim_route', 'Skim Route', 'economy', 'Knows which ledgers nobody audits twice.', {
    kind: 'resource',
    resource: 'caps',
    perHour: 4,
  }),
  perk('ration_scheme', 'Ration Scheme', 'economy', 'Fed a block of two thousand on paperwork.', {
    kind: 'resource',
    resource: 'supplies',
    perHour: 3,
  }),
  perk(
    'tapped_line',
    'Tapped Line',
    'economy',
    'There is a pipe under the district. There is now.',
    {
      kind: 'resource',
      resource: 'oil',
      perHour: 3,
    },
  ),
  perk(
    'wreck_claim',
    'Wreck Claim',
    'economy',
    'Holds paper on four crash sites nobody else wants.',
    {
      kind: 'resource',
      resource: 'scrap',
      perHour: 4,
    },
  ),
  perk('timber_contact', 'Timber Contact', 'economy', 'A cousin on the lumber docks, and a debt.', {
    kind: 'resource',
    resource: 'planks',
    perHour: 3,
  }),
  perk('foundry_friend', 'Foundry Friend', 'economy', 'Signs out alloy that was never signed in.', {
    kind: 'resource',
    resource: 'highQualityMetal',
    perHour: 1,
  }),
  perk('cap_counter', 'Cap Counter', 'economy', 'Counts twice and finds more the second time.', {
    kind: 'resource_yield',
    resource: 'caps',
    percent: 5,
  }),
  perk(
    'lean_kitchen',
    'Lean Kitchen',
    'economy',
    'Nothing goes in the bin that could go in a pot.',
    {
      kind: 'resource_yield',
      resource: 'supplies',
      percent: 5,
    },
  ),
  perk('clean_burn', 'Clean Burn', 'economy', 'Retunes every intake until the smoke runs clear.', {
    kind: 'resource_yield',
    resource: 'oil',
    percent: 5,
  }),
  perk('sorted_heap', 'Sorted Heap', 'economy', 'A scrapyard is only a heap if nobody sorted it.', {
    kind: 'resource_yield',
    resource: 'scrap',
    percent: 5,
  }),
  perk('dry_stack', 'Dry Stack', 'economy', 'Stacks so the rain runs off instead of in.', {
    kind: 'resource_yield',
    resource: 'planks',
    percent: 5,
  }),
  perk('assay_eye', 'Assay Eye', 'economy', 'Can tell good alloy from plated slag by the ring.', {
    kind: 'resource_yield',
    resource: 'highQualityMetal',
    percent: 5,
  }),
  perk(
    'shift_pattern',
    'Shift Pattern',
    'economy',
    'Redrew the rota. Nobody has noticed they work less.',
    {
      kind: 'production',
      percent: 4,
    },
  ),
  perk(
    'night_shift',
    'Night Shift',
    'economy',
    'The machines do not sleep, so neither does the roster.',
    {
      kind: 'production',
      percent: 6,
    },
  ),
  perk('found_room', 'Found Room', 'economy', 'There was a whole floor nobody had on the plans.', {
    kind: 'storage_capacity',
    percent: 6,
  }),
  perk('deep_cellar', 'Deep Cellar', 'economy', 'Dug down instead of out, and told no one.', {
    kind: 'storage_capacity',
    percent: 9,
  }),
  perk('bulk_buyer', 'Bulk Buyer', 'economy', 'Never bought one of anything in their life.', {
    kind: 'market_discount',
    percent: 4,
  }),
  perk('haggler', 'Haggler', 'economy', 'Enjoys this part more than is decent.', {
    kind: 'market_discount',
    percent: 6,
  }),
  perk(
    'back_door_price',
    'Back Door Price',
    'economy',
    'Knows which stall keeps the real ledger.',
    {
      kind: 'black_market_discount',
      percent: 6,
    },
  ),
  perk(
    'fence_contact',
    'Fence Contact',
    'economy',
    'Has moved worse things than this, for worse people.',
    {
      kind: 'black_market_discount',
      percent: 9,
    },
  ),
  perk('parts_bin', 'Parts Bin', 'economy', 'Every job leaves something. They keep it.', {
    kind: 'refit_discount',
    percent: 6,
  }),
  perk(
    'chassis_hoard',
    'Chassis Hoard',
    'economy',
    'Three of everything, in a lock-up off the strip.',
    {
      kind: 'vehicle_parts',
      percent: 8,
    },
  ),
  perk('scrap_tithe', 'Scrap Tithe', 'economy', 'What dies still owes the crew something.', {
    kind: 'salvage_refund',
    percent: 5,
  }),
  perk(
    'battlefield_broker',
    'Battlefield Broker',
    'economy',
    'Sells the wreck before the smoke clears.',
    {
      kind: 'salvage_refund',
      percent: 8,
    },
  ),
  perk('grid_tap', 'Grid Tap', 'economy', 'The meter runs backwards on a good week.', {
    kind: 'power_supply',
    amount: 4,
  }),
  perk('load_balancer', 'Load Balancer', 'economy', 'Nothing browns out while they are on shift.', {
    kind: 'power_supply',
    amount: 7,
  }),

  // --- Military: what the units do when it starts --------------------------------------------
  perk('drill_sergeant', 'Drill Sergeant', 'military', 'Shouts in a way that survives contact.', {
    kind: 'unit_offense',
    percent: 4,
  }),
  perk(
    'gun_doctor',
    'Gun Doctor',
    'military',
    'Every weapon in the armoury is zeroed. Every one.',
    {
      kind: 'unit_offense',
      percent: 6,
    },
  ),
  perk(
    'field_medic',
    'Field Medic',
    'military',
    'Has carried people further than seems possible.',
    {
      kind: 'unit_vitality',
      percent: 5,
    },
  ),
  perk('trauma_kit', 'Trauma Kit', 'military', 'Packs for the wound people actually get.', {
    kind: 'unit_vitality',
    percent: 8,
  }),
  perk(
    'plate_layer',
    'Plate Layer',
    'military',
    'Welds where the hits land, not where the plans say.',
    {
      kind: 'unit_armor',
      percent: 3,
    },
  ),
  perk('spall_liner', 'Spall Liner', 'military', 'The second layer is the one that matters.', {
    kind: 'unit_armor',
    percent: 5,
  }),
  perk(
    'road_captain',
    'Road Captain',
    'military',
    'Gets a column moving before the argument ends.',
    {
      kind: 'unit_speed',
      percent: 5,
    },
  ),
  perk(
    'quiet_boots',
    'Quiet Boots',
    'military',
    'Taught the whole crew to walk like they meant it.',
    {
      kind: 'unit_stealth',
      percent: 7,
    },
  ),
  perk('old_colours', 'Old Colours', 'military', 'Carries a banner from a war that went badly.', {
    kind: 'unit_morale',
    flat: 4,
  }),
  perk(
    'sworn_word',
    'Sworn Word',
    'military',
    'Has never left anybody on the ground. Everybody knows.',
    {
      kind: 'unit_morale',
      flat: 7,
    },
  ),
  perk(
    'face_paint',
    'Face Paint',
    'military',
    'Knows exactly how frightening a crew needs to look.',
    {
      kind: 'intimidation',
      flat: 6,
    },
  ),
  perk('reputation', 'Reputation', 'military', 'Three districts stand down on the name alone.', {
    kind: 'intimidation',
    flat: 10,
  }),
  perk('stim_chemist', 'Stim Chemist', 'military', 'Cooks the good stuff, and knows the dose.', {
    kind: 'battle_stims',
    flat: 1,
  }),
  perk(
    'wall_builder',
    'Wall Builder',
    'military',
    'Builds it thick, low and where the road bends.',
    {
      kind: 'defense_percent',
      percent: 6,
    },
  ),
  perk('siege_reader', 'Siege Reader', 'military', 'Has been on the wrong side of one. Learned.', {
    kind: 'defense_percent',
    percent: 9,
  }),
  perk('stretcher_run', 'Stretcher Run', 'military', 'The wounded come back. Most of them.', {
    kind: 'casualty_recovery',
    percent: 8,
  }),
  perk(
    'battlefield_surgeon',
    'Battlefield Surgeon',
    'military',
    'Operates where they fell, in the dark.',
    {
      kind: 'casualty_recovery',
      percent: 12,
    },
  ),
  perk(
    'signal_discipline',
    'Signal Discipline',
    'military',
    'Everybody hears the same order at once.',
    {
      kind: 'cohesion',
      percent: 6,
    },
  ),
  perk(
    'line_officer',
    'Line Officer',
    'military',
    'Gets more of a big crew into the fight at all.',
    {
      kind: 'cohesion',
      percent: 9,
    },
  ),
  perk('pack_mule', 'Pack Mule', 'military', 'Nobody comes home from a job empty-handed.', {
    kind: 'loot_capacity',
    percent: 8,
  }),
  perk('crane_rig', 'Crane Rig', 'military', 'Built a hoist onto a truck. It works.', {
    kind: 'loot_capacity',
    percent: 12,
  }),

  // --- Military, one tier at a time -----------------------------------------------------------
  perk('mob_handler', 'Mob Handler', 'military', 'Can point a mob and have it stay pointed.', {
    kind: 'unit_tier',
    tier: 'rabble',
    stat: 'offense',
    percent: 6,
  }),
  perk('street_shields', 'Street Shields', 'military', 'Bin lids and rebar, and it holds.', {
    kind: 'unit_tier',
    tier: 'rabble',
    stat: 'armor',
    percent: 4,
  }),
  perk('warm_bodies', 'Warm Bodies', 'military', 'Feeds them properly for once.', {
    kind: 'unit_tier',
    tier: 'rabble',
    stat: 'vitality',
    percent: 8,
  }),
  perk(
    'specialist_handler',
    'Specialist Handler',
    'military',
    'Talks to the odd ones like people.',
    {
      kind: 'unit_tier',
      tier: 'specialist',
      stat: 'offense',
      percent: 6,
    },
  ),
  perk(
    'tailored_kit',
    'Tailored Kit',
    'military',
    'Fits the armour to the person, not the size chart.',
    {
      kind: 'unit_tier',
      tier: 'specialist',
      stat: 'armor',
      percent: 4,
    },
  ),
  perk('quiet_extraction', 'Quiet Extraction', 'military', 'Plans the way out before the way in.', {
    kind: 'unit_tier',
    tier: 'specialist',
    stat: 'vitality',
    percent: 7,
  }),
  perk(
    'heavy_gunner',
    'Heavy Gunner',
    'military',
    'Believes there is no such thing as too much gun.',
    {
      kind: 'unit_tier',
      tier: 'heavy',
      stat: 'offense',
      percent: 5,
    },
  ),
  perk('ironmonger', 'Ironmonger', 'military', 'Lays plate on anything that will hold still.', {
    kind: 'unit_tier',
    tier: 'heavy',
    stat: 'armor',
    percent: 3,
  }),
  perk(
    'load_bearer',
    'Load Bearer',
    'military',
    'Rebuilds the frames so they carry their own weight.',
    {
      kind: 'unit_tier',
      tier: 'heavy',
      stat: 'vitality',
      percent: 6,
    },
  ),
  perk(
    'machinist',
    'Machinist',
    'military',
    'The strange ones run better after a night with them.',
    {
      kind: 'unit_tier',
      tier: 'wonder',
      stat: 'offense',
      percent: 6,
    },
  ),
  perk('field_fabricator', 'Field Fabricator', 'military', 'Prints the part that was never made.', {
    kind: 'unit_tier',
    tier: 'wonder',
    stat: 'armor',
    percent: 4,
  }),
  perk(
    'prototype_nurse',
    'Prototype Nurse',
    'military',
    'Keeps the one-offs alive past their first outing.',
    {
      kind: 'unit_tier',
      tier: 'wonder',
      stat: 'vitality',
      percent: 7,
    },
  ),
  perk(
    'legend_keeper',
    'Legend Keeper',
    'military',
    'Knows how the story goes, and tells it right.',
    {
      kind: 'unit_tier',
      tier: 'legendary',
      stat: 'offense',
      percent: 5,
    },
  ),
  perk('relic_smith', 'Relic Smith', 'military', 'Repairs what nobody else will touch.', {
    kind: 'unit_tier',
    tier: 'legendary',
    stat: 'armor',
    percent: 3,
  }),
  perk('bodyguard', 'Bodyguard', 'military', 'Stands where the shot was going.', {
    kind: 'unit_tier',
    tier: 'legendary',
    stat: 'vitality',
    percent: 6,
  }),
  perk('teamster', 'Teamster', 'military', 'The haulers get through. That is the whole job.', {
    kind: 'unit_tier',
    tier: 'carrier',
    stat: 'vitality',
    percent: 8,
  }),
  perk('outrider', 'Outrider', 'military', 'Rides ahead and finds the roadblock first.', {
    kind: 'unit_tier',
    tier: 'carrier',
    stat: 'armor',
    percent: 5,
  }),

  // --- Logistics: builds, training, roads, jobs -----------------------------------------------
  perk('site_foreman', 'Site Foreman', 'logistics', 'A build with them on it does not stop.', {
    kind: 'build_speed',
    percent: 6,
  }),
  perk(
    'scaffold_hand',
    'Scaffold Hand',
    'logistics',
    'Up it before the delivery has finished unloading.',
    {
      kind: 'build_speed',
      percent: 9,
    },
  ),
  perk(
    'materials_clerk',
    'Materials Clerk',
    'logistics',
    'Orders exactly enough, which nobody else manages.',
    {
      kind: 'build_cost',
      percent: 5,
    },
  ),
  perk(
    'salvage_architect',
    'Salvage Architect',
    'logistics',
    'Builds out of what the last building left.',
    {
      kind: 'build_cost',
      percent: 8,
    },
  ),
  perk(
    'training_officer',
    'Training Officer',
    'logistics',
    'Turns a week of drill into three days.',
    {
      kind: 'training_speed',
      percent: 6,
    },
  ),
  perk('hard_school', 'Hard School', 'logistics', 'Unkind, quick, and it works.', {
    kind: 'training_speed',
    percent: 9,
  }),
  perk('range_master', 'Range Master', 'logistics', 'Wastes nothing, least of all ammunition.', {
    kind: 'training_cost',
    percent: 5,
  }),
  perk(
    'surplus_dealer',
    'Surplus Dealer',
    'logistics',
    'Kits a recruit out of a budget that is not ours.',
    {
      kind: 'training_cost',
      percent: 8,
    },
  ),
  perk('extra_hour', 'Extra Hour', 'logistics', 'Finds a session in the day nobody else could.', {
    kind: 'training_sessions',
    flat: 1,
  }),
  perk('route_planner', 'Route Planner', 'logistics', 'Knows which roads are open at which hour.', {
    kind: 'travel_speed',
    percent: 6,
  }),
  perk('tunnel_rat', 'Tunnel Rat', 'logistics', 'There is always a way under.', {
    kind: 'travel_speed',
    percent: 9,
  }),
  perk('job_fixer', 'Job Fixer', 'logistics', 'Crews come home early when they set the schedule.', {
    kind: 'mission_speed',
    percent: 6,
  }),
  perk(
    'night_run',
    'Night Run',
    'logistics',
    'Moves while the city is asleep and the checkpoints are bored.',
    {
      kind: 'mission_speed',
      percent: 9,
    },
  ),
  perk(
    'contract_lawyer',
    'Contract Lawyer',
    'logistics',
    'Reads the small print, then rewrites it.',
    {
      kind: 'mission_spoils',
      percent: 4,
    },
  ),
  perk('hard_bargain', 'Hard Bargain', 'logistics', 'Names a price and then says nothing at all.', {
    kind: 'mission_spoils',
    percent: 6,
  }),
  perk('bonded_courier', 'Bonded Courier', 'logistics', 'Paid on delivery, and always delivers.', {
    kind: 'mission_spoils',
    percent: 8,
  }),
  perk(
    'name_in_the_papers',
    'Name In The Papers',
    'logistics',
    'Makes sure the right people hear about it.',
    {
      kind: 'infamy_gain',
      percent: 6,
    },
  ),
  perk(
    'legend_builder',
    'Legend Builder',
    'logistics',
    'The story is always a little better than the job.',
    {
      kind: 'infamy_gain',
      percent: 9,
    },
  ),

  // --- People: officers, wages, hiring ---------------------------------------------------------
  perk(
    'payroll_clerk',
    'Payroll Clerk',
    'people',
    'Finds two per cent in the book every single week.',
    {
      kind: 'wage_discount',
      percent: 3,
    },
  ),
  perk('good_name', 'Good Name', 'people', 'People take less to work for them. They always have.', {
    kind: 'wage_discount',
    percent: 5,
  }),
  perk('union_rep', 'Union Rep', 'people', 'Everybody signs, and everybody signs for less.', {
    kind: 'wage_discount',
    percent: 7,
  }),
  perk(
    'ledger_hand',
    'Ledger Hand',
    'people',
    'Widening the book costs less with them holding the pen.',
    {
      kind: 'payroll_step_discount',
      percent: 5,
    },
  ),
  perk('bank_contact', 'Bank Contact', 'people', 'Knows somebody who lends at a laughable rate.', {
    kind: 'payroll_step_discount',
    percent: 8,
  }),
  perk(
    'bar_regular',
    'Bar Regular',
    'people',
    'Everybody worth hiring drinks with them eventually.',
    {
      kind: 'recruit_pool',
      percent: 8,
    },
  ),
  perk('talent_scout', 'Talent Scout', 'people', 'Spots the one worth hiring across a full room.', {
    kind: 'recruit_pool',
    percent: 12,
  }),
  perk('bunk_builder', 'Bunk Builder', 'people', 'Fits four where the plans allowed two.', {
    kind: 'population',
    flat: 3,
  }),
  perk('block_landlord', 'Block Landlord', 'people', 'Holds paper on the tenement next door.', {
    kind: 'population',
    flat: 5,
  }),
  perk(
    'hard_trainer',
    'Hard Trainer',
    'people',
    'Everybody on the books is stronger for knowing them.',
    {
      kind: 'officer_group',
      group: 'physical',
      flat: 3,
    },
  ),
  perk(
    'reading_circle',
    'Reading Circle',
    'people',
    'Runs a class on the nights nothing is happening.',
    {
      kind: 'officer_group',
      group: 'mental',
      flat: 3,
    },
  ),
  perk('house_host', 'House Host', 'people', 'The crew talks to each other because of them.', {
    kind: 'officer_group',
    group: 'social',
    flat: 3,
  }),
  perk(
    'workshop_teacher',
    'Workshop Teacher',
    'people',
    'Shows the others how, instead of doing it for them.',
    {
      kind: 'officer_group',
      group: 'technical',
      flat: 3,
    },
  ),
  perk('old_instructor', 'Old Instructor', 'people', 'Taught half the district something useful.', {
    kind: 'officer_group',
    group: 'physical',
    flat: 5,
  }),
  perk(
    'war_college',
    'War College',
    'people',
    'Studied it properly, and will not shut up about it.',
    {
      kind: 'officer_group',
      group: 'mental',
      flat: 5,
    },
  ),
  perk('the_connector', 'The Connector', 'people', 'Knows everyone, introduces everyone.', {
    kind: 'officer_group',
    group: 'social',
    flat: 5,
  }),
  perk(
    'master_wright',
    'Master Wright',
    'people',
    'Served an apprenticeship somewhere that still means something.',
    {
      kind: 'officer_group',
      group: 'technical',
      flat: 5,
    },
  ),

  // --- Intel: what you know, and what they do not -----------------------------------------------
  perk(
    'street_ears',
    'Street Ears',
    'intel',
    'Pays six children a pittance and knows everything.',
    {
      kind: 'intel',
      percent: 8,
    },
  ),
  perk('wire_tap', 'Wire Tap', 'intel', 'Has been listening to the Combine for a year.', {
    kind: 'intel',
    percent: 12,
  }),
  perk(
    'counter_signals',
    'Counter Signals',
    'intel',
    'Feeds the watchers something plausible and wrong.',
    {
      kind: 'intel_resistance',
      percent: 10,
    },
  ),
  perk('paper_shredder', 'Paper Shredder', 'intel', 'Nothing written down survives the week.', {
    kind: 'intel_resistance',
    percent: 15,
  }),
  perk('rooftop_map', 'Rooftop Map', 'intel', 'Has walked the skyline end to end.', {
    kind: 'vision',
    districts: 1,
  }),
  perk('lab_discipline', 'Lab Discipline', 'intel', 'Runs the bench like a shift, not a hobby.', {
    kind: 'research_speed',
    percent: 6,
  }),
  perk('archive_key', 'Archive Key', 'intel', 'Still has the pass to a library that burned.', {
    kind: 'research_speed',
    percent: 9,
  }),
  perk('cipher_desk', 'Cipher Desk', 'intel', 'Reads the traffic faster than it is sent.', {
    kind: 'intel',
    percent: 15,
  }),
  perk('survey_hand', 'Survey Hand', 'intel', 'Maps a district in a night and gets it right.', {
    kind: 'vision',
    districts: 2,
  }),
];

export const PERK_CATALOG: readonly Perk[] = CATALOG;
export const PERK_IDS: readonly string[] = CATALOG.map((entry) => entry.id);

const BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

export type PerkId = string;

/**
 * A perk id, validated against the catalogue.
 *
 * A refined string rather than a `z.enum` over a literal union, because the ids are derived *from*
 * the catalogue: an enum would need the hundred ids written out a second time, and the two copies
 * would drift the first time somebody added a perk. `content.integrity.test.ts` pins that every id
 * is unique, which is the property the enum would otherwise have given for free.
 */
export const PerkIdSchema = z.string().refine((id) => BY_ID.has(id), 'Unknown perk');

export function isPerkId(id: string): boolean {
  return BY_ID.has(id);
}

export function findPerk(id: string): Perk | undefined {
  return BY_ID.get(id);
}

/** How many an officer can carry. Zero is a real and common outcome, not a failure to roll. */
export const MAX_OFFICER_PERKS = 3;

export const PerksSchema = z.array(PerkIdSchema).max(MAX_OFFICER_PERKS);
export type Perks = z.infer<typeof PerksSchema>;

/** The perks a set of ids resolves to, dropping any the catalogue no longer carries. */
export function perksOf(ids: readonly string[]): Perk[] {
  return ids.map(findPerk).filter((entry): entry is Perk => entry !== undefined);
}

/**
 * What a perk is worth, in one line, for the chip's hover.
 *
 * Delegates to `describeHoldBonus` for everything the map can also grant, so a perk and a captured
 * location that pay the same bonus read as the same sentence. Only the crew-only kinds, which that
 * function has never heard of, are worded here.
 */
export function describePerkBonus(bonus: PerkBonus): string {
  switch (bonus.kind) {
    case 'production':
      return `+${bonus.percent}% production`;
    case 'storage_capacity':
      return `+${bonus.percent}% storage`;
    case 'build_cost':
      return `-${bonus.percent}% build cost`;
    case 'wage_discount':
      return `-${bonus.percent}% wages`;
    case 'payroll_step_discount':
      return `-${bonus.percent}% to widen payroll`;
    case 'recruit_pool':
      return `+${bonus.percent}% recruits at the Bar`;
    case 'intel_resistance':
      return `+${bonus.percent}% counter-intel`;
    case 'casualty_recovery':
      return `+${bonus.percent}% wounded recovered`;
    case 'cohesion':
      return `+${bonus.percent}% cohesion`;
    default:
      return describeHoldBonus(bonus);
  }
}
