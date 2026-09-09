import { z } from 'zod';
import { RARITY_ORDER, type ItemRarity } from '../items/rarity.js';
/**
 * Blueprints and their pages (GDD §D, blueprints patch).
 *
 * A blueprint used to be one item you either held or did not, which made it a switch with a name
 * on it. It is a **document made of pages** now, and each page is a separate, named, findable
 * thing: the Colossus Blueprint is eight pages, and holding six of them is a real position to be
 * in rather than a rounding error on the way to holding one item.
 *
 * ## What a page count means
 *
 * Pages are the cost of knowing how, so the count tracks how much the thing at the end of it
 * changes a crew, not how expensive it is to build. Two or three pages is a thing a district
 * reaches in its first fortnight (a scrap motorcycle, a stove flue in the Quarters). Eight is the
 * Colossus, which is one unit and also an entire campaign.
 *
 * The bands, and every entry below sits in one of them:
 *
 * - **2 to 3**: the first machine in a class, the shallow structure retrofits, the two-step
 *   consumables, the specialists a Gauntlet already trains.
 * - **4 to 5**: engineered units, mid-yard machines, the structures a district lives out of.
 * - **6 to 8**: the uniques and the Rotorcraft. One of a kind, and the page you are missing is
 *   the reason you do not have one.
 *
 * ## This module is a leaf
 *
 * It names its targets by id as plain strings and imports nothing from the rest of the domain
 * except `items/rarity.ts`, which is a scale and four words and imports nothing itself.
 * `items/catalog.ts` turns every page into an item so a page can sit in a satchel and survive a
 * save, and `items` is below `units`, `building` and `battle` in the import graph. A blueprint
 * catalogue that reached back up into the unit catalogue would close that loop at module-load
 * time. The lookups that need both halves live in `requirements.ts`, which nothing below it
 * imports, and `blueprints.test.ts` checks that every target id here names something real.
 */

export const BLUEPRINT_CATEGORIES = ['unit', 'upgrade', 'consumable'] as const;
export const BlueprintCategorySchema = z.enum(BLUEPRINT_CATEGORIES);
export type BlueprintCategory = z.infer<typeof BlueprintCategorySchema>;

export const BLUEPRINT_CATEGORY_LABELS: Readonly<Record<BlueprintCategory, string>> = {
  unit: 'Unit blueprints',
  upgrade: 'Upgrade blueprints',
  consumable: 'Consumable blueprints',
};

/** What each section of the Blueprints page is, in one line under its heading. */
export const BLUEPRINT_CATEGORY_BLURBS: Readonly<Record<BlueprintCategory, string>> = {
  unit: 'Bodies and machines. Vehicles count as units: somebody still has to be taught to make one.',
  upgrade: 'What a structure or a squad becomes once the yard has the drawings for it.',
  consumable: 'Made for one night and gone by morning.',
};

/**
 * What a blueprint gates.
 *
 * `building` is the coarse one on purpose. A structure offers five modifications and the advanced
 * half of them are the same class of work, so the retrofit blueprint is per structure rather than
 * per modification: eleven documents instead of thirty-two, and a player who has read the Garage
 * retrofit can fit any of the Garage's serious add-ons. See `advancedModificationBlueprint`.
 */
export const BLUEPRINT_TARGET_KINDS = [
  'unit',
  'vehicle',
  'unit_upgrade',
  'building',
  'battle_boost',
  'trap',
] as const;
export type BlueprintTargetKind = (typeof BLUEPRINT_TARGET_KINDS)[number];

export interface BlueprintTarget {
  kind: BlueprintTargetKind;
  /** The id in that kind's own catalogue. Checked by `blueprints.test.ts`, not by the type. */
  id: string;
}

export interface BlueprintPage {
  id: string;
  /** What is actually on the page. Unique across the whole catalogue. */
  name: string;
  /**
   * What the sheet looks like, in one line, for the hover.
   *
   * Written as the object rather than as the mechanic: a cutaway with the coolant runs inked in
   * blue, a parts list with a coffee ring across the middle of it. Two pages of one document have
   * to read as two different pieces of paper, which is the whole reason a page has a name.
   */
  description: string;
  /**
   * Only where this sheet is not worth what the rest of the document is worth.
   *
   * Defaults to the document's rarity. Authored one step up on the page that is the reason nobody
   * has the thing, and one step down on the sheet anybody could redraw from memory. More than one
   * step from the document is a content error and `pages.test.ts` fails on it.
   */
  rarity?: ItemRarity;
}

export interface BlueprintSpec {
  id: string;
  /** "Colossus Blueprint". The name a player says out loud. */
  name: string;
  category: BlueprintCategory;
  /**
   * How scarce the finished document is, and the colour it is drawn in everywhere it appears.
   *
   * Authored per document off what it unlocks rather than read off the page count. The two mostly
   * agree, and where they do not the thing at the end of it wins: a Heli Porter is four pages and
   * a working turbine helicopter, which is not an uncommon object however short the manual is.
   */
  rarity: ItemRarity;
  /** One line: what having it lets you do. Also the document's description everywhere it shows. */
  blurb: string;
  /**
   * Everything this one document unlocks, and it is a list because §D12b needs it to be: Road
   * Reavers ride the motorbike the Garage builds, so they read the same blueprint rather than a
   * second one with the same drawings in it.
   */
  targets: readonly BlueprintTarget[];
  pages: readonly BlueprintPage[];
}

export const BLUEPRINTS = [
  // ---------------------------------------------------------------- unit: trained bodies (§D12a)
  {
    id: 'bp_snipers',
    name: 'Sniper Blueprint',
    category: 'unit',
    rarity: 'uncommon',
    blurb: 'A long barrel, a cold room to zero it in, and the tables to read wind off.',
    targets: [{ kind: 'unit', id: 'snipers' }],
    pages: [
      {
        id: 'pg_snipers_barrel_liners',
        name: 'Barrel Liners',
        description:
          'A bore in section with the rifling twist inked twice, because the first hand had it backwards.',
        rarity: 'rare',
      },
      {
        id: 'pg_snipers_range_cards',
        name: 'Range Cards',
        description:
          'Ruled columns of holdover and drift, filled in pencil, a third of them crossed out again.',
      },
      {
        id: 'pg_snipers_ghillie_patterns',
        name: 'Ghillie Patterns',
        description:
          'Cut shapes for hessian and net, traced round a coat that was already falling apart.',
      },
    ],
  },
  {
    id: 'bp_demolishers',
    name: 'Demolisher Blueprint',
    category: 'unit',
    rarity: 'uncommon',
    blurb: 'Where to put the charge so the wall falls the way you wanted it to.',
    targets: [{ kind: 'unit', id: 'demolishers' }],
    pages: [
      {
        id: 'pg_demolishers_charge_moulds',
        name: 'Charge Moulds',
        description:
          'Cone and slab moulds drawn full size, with the sand mix noted along the bottom edge.',
      },
      {
        id: 'pg_demolishers_fuse_timings',
        name: 'Fuse Timings',
        description:
          'Burn rates per metre of cord, and a warning about damp cord that somebody underlined.',
        rarity: 'rare',
      },
      {
        id: 'pg_demolishers_breaching_frames',
        name: 'Breaching Frames',
        description:
          'Timber frames for a doorway that is not a doorway yet, with the cuts numbered.',
      },
    ],
  },
  {
    id: 'bp_kite_crews',
    name: 'Kite Crew Blueprint',
    category: 'unit',
    rarity: 'uncommon',
    blurb: 'Spars, sail and a winch. Somebody goes up and everybody else finds out what is coming.',
    targets: [{ kind: 'unit', id: 'kite_crews' }],
    pages: [
      {
        id: 'pg_kite_crews_spar_frames',
        name: 'Spar Frames',
        description:
          'Spar lengths and lashing points, in a hand that assumed the reader owns a knife.',
      },
      {
        id: 'pg_kite_crews_sail_cutting',
        name: 'Sail Cutting',
        description:
          'The sail flattened into panels, seam allowance shaded, one panel drawn twice.',
      },
      {
        id: 'pg_kite_crews_winch_gearing',
        name: 'Winch Gearing',
        description:
          'Gear teeth counted out on a drum, with the brake pawl sketched in the margin.',
        rarity: 'rare',
      },
      {
        id: 'pg_kite_crews_launch_rails',
        name: 'Launch Rails',
        description: 'A rail and its footing, and a note on which roofs will take the load.',
      },
    ],
  },
  {
    id: 'bp_cyberhounds',
    name: 'Cyberhound Blueprint',
    category: 'unit',
    rarity: 'rare',
    blurb: 'Four legs, a rebuilt jaw and a nose that was never a nose.',
    targets: [{ kind: 'unit', id: 'cyber_dogs' }],
    pages: [
      {
        id: 'pg_cyberhounds_limb_actuators',
        name: 'Limb Actuators',
        description:
          'Four legs in exploded view, the same actuator drawn four times with different wear on it.',
      },
      {
        id: 'pg_cyberhounds_scent_board',
        name: 'Scent Board',
        description:
          'A sensor board and its trace, under a short list of what it was taught to find.',
      },
      {
        id: 'pg_cyberhounds_jaw_servos',
        name: 'Jaw Servos',
        description: 'A jaw opened out flat, bite force pencilled beside each tooth position.',
      },
      {
        id: 'pg_cyberhounds_kennel_wiring',
        name: 'Kennel Wiring',
        description: 'Charging rails and a floor drain, with DO NOT STAND HERE lettered across it.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_the_twins',
    name: 'Twins Blueprint',
    category: 'unit',
    rarity: 'rare',
    blurb: 'Two rigs cut from one drawing. Neither of them works on its own.',
    targets: [{ kind: 'unit', id: 'the_twins' }],
    pages: [
      {
        id: 'pg_the_twins_paired_harness',
        name: 'Paired Harness',
        description:
          'One harness drawn twice and mirrored, with the shared buckle circled on both.',
      },
      {
        id: 'pg_the_twins_mirror_sights',
        name: 'Mirror Sights',
        description:
          'Two sight lines crossing at a marked distance, and the correction if only one of them fires.',
      },
      {
        id: 'pg_the_twins_split_loader',
        name: 'Split Loader',
        description:
          'A feed that goes two ways, and a drawing of the jam it makes when it goes one.',
      },
      {
        id: 'pg_the_twins_matched_frames',
        name: 'Matched Frames',
        description:
          'Frame tolerances to a tenth, under a line saying neither of them works alone.',
      },
      {
        id: 'pg_the_twins_signal_cord',
        name: 'Signal Cord',
        description: 'A cord run between two rigs, and what each number of tugs on it means.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_ironsides',
    name: 'Ironside Blueprint',
    category: 'unit',
    rarity: 'uncommon',
    blurb: 'Plate cut to a schedule somebody worked out under fire, and never changed since.',
    targets: [{ kind: 'unit', id: 'ironsides' }],
    pages: [
      {
        id: 'pg_ironsides_plate_schedule',
        name: 'Plate Schedule',
        description:
          'Plate thickness by body zone, in a schedule nobody has dared change since it was written.',
        rarity: 'rare',
      },
      {
        id: 'pg_ironsides_shoulder_anchors',
        name: 'Shoulder Anchors',
        description: 'Where the whole weight hangs from, with the bolt pattern circled twice.',
      },
      {
        id: 'pg_ironsides_visor_slits',
        name: 'Visor Slits',
        description:
          'Slit widths against what you can still see through them. Narrower than anyone likes.',
      },
      {
        id: 'pg_ironsides_boot_weights',
        name: 'Boot Weights',
        description: 'Lead in the soles, in grams, so the wearer stops going over backwards.',
      },
    ],
  },
  {
    id: 'bp_juggernauts',
    name: 'Juggernaut Blueprint',
    category: 'unit',
    rarity: 'rare',
    blurb: 'An exoframe with a person somewhere inside it, and a cooling loop that has to hold.',
    targets: [{ kind: 'unit', id: 'juggernauts' }],
    pages: [
      {
        id: 'pg_juggernauts_exoframe_legs',
        name: 'Exoframe Legs',
        description:
          'A leg in three positions, with the knee drawn again underneath at twice the size.',
      },
      {
        id: 'pg_juggernauts_power_spine',
        name: 'Power Spine',
        description:
          'The spine as a wiring run, every tap numbered, one of them scratched out entirely.',
      },
      {
        id: 'pg_juggernauts_slab_armour',
        name: 'Slab Armour',
        description:
          'Slabs laid out with the cut order on them, so nothing warps before it is hung.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_juggernauts_coolant_loop',
        name: 'Coolant Loop',
        description:
          'The loop that has to hold, inked in blue, with its working pressure underlined.',
      },
      {
        id: 'pg_juggernauts_gun_mount',
        name: 'Hand Cannon Mount',
        description:
          'A mount and the recoil path through it, ending at the shoulder that takes it.',
      },
    ],
  },
  {
    id: 'bp_hollow_men',
    name: 'Hollow Man Blueprint',
    category: 'unit',
    rarity: 'rare',
    blurb: 'A shell that walks, weighted at the ankles so it does not fall over when it is shot.',
    targets: [{ kind: 'unit', id: 'hollow_men' }],
    pages: [
      {
        id: 'pg_hollow_men_empty_shell',
        name: 'Empty Shell',
        description:
          'A shell in section with nothing inside it, which is the drawing and the point.',
      },
      {
        id: 'pg_hollow_men_gait_governor',
        name: 'Gait Governor',
        description: 'A governor and its stops, so the thing walks rather than runs at people.',
      },
      {
        id: 'pg_hollow_men_voice_box',
        name: 'Voice Box',
        description: 'A speaker cavity, and beside it the eleven words it is allowed to make.',
      },
      {
        id: 'pg_hollow_men_ballast_core',
        name: 'Ballast Core',
        description:
          'Weight at the ankles, worked out from how far it can lean before it goes over.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_hollow_men_standing_order',
        name: 'Standing Order',
        description:
          'Not a drawing. One paragraph on what it does when nobody is telling it anything.',
      },
    ],
  },

  // ------------------------------------------------------------------- unit: the uniques (§D12d)
  {
    id: 'bp_the_specter',
    name: 'Specter Blueprint',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Six pages on not being seen, and the last one is mostly about the cold.',
    targets: [{ kind: 'unit', id: 'the_specter' }],
    pages: [
      {
        id: 'pg_the_specter_shroud_weave',
        name: 'Shroud Weave',
        description:
          'A weave in close-up, thread count in the corner, drawn so it vanishes at arm length.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_silent_boots',
        name: 'Silent Boots',
        description: 'A sole cut in five layers, with the one layer that does the work shaded.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_cold_optics',
        name: 'Cold Optics',
        description: 'Optics that read heat, and the housing that stops them giving any off.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_ghost_wiring',
        name: 'Ghost Wiring',
        description: 'A wiring run with no loom, taped flat, every joint drawn on its own.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_scent_null',
        name: 'Scent Null',
        description:
          'A sealed bag and a chemical list, half of it in a shorthand nobody else uses.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_last_page',
        name: 'The Last Page',
        description:
          'Mostly about the cold. No drawing on it at all, and it is the page nobody has.',
      },
    ],
  },
  {
    id: 'bp_the_crimson_dancer',
    name: 'Crimson Dancer Blueprint',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Edge geometry and footwork, written by somebody who thought of it as choreography.',
    targets: [{ kind: 'unit', id: 'the_crimson_dancer' }],
    pages: [
      {
        id: 'pg_crimson_dancer_edge_geometry',
        name: 'Edge Geometry',
        description: 'Blade sections at five points along the edge, each one at a different angle.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_balance_rig',
        name: 'Balance Rig',
        description: 'A rig for finding the point it turns about, sketched from three sides.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_red_lacquer',
        name: 'Red Lacquer',
        description: 'A lacquer recipe and a drying schedule. The colour swatch has gone brown.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_footwork_chart',
        name: 'Footwork Chart',
        description:
          'Footprints on a grid with numbers beside them, read as a dance and meant as one.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_pulse_lace',
        name: 'Pulse Lace',
        description: 'Lacing that tightens on a pulse, drawn at the wrist and again at the ankle.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_curtain_call',
        name: 'Curtain Call',
        description: 'The last figure of the sequence, drawn once and never explained.',
      },
    ],
  },
  {
    id: 'bp_the_loose_end',
    name: 'Loose End Blueprint',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Seven pages, none of them signed, and one of them is a list of ways to burn the rest.',
    targets: [{ kind: 'unit', id: 'the_loose_end' }],
    pages: [
      {
        id: 'pg_loose_end_frayed_schematic',
        name: 'Frayed Schematic',
        description: 'A schematic torn across one corner, so the part it names is missing.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_dead_drop_keys',
        name: 'Dead Drop Keys',
        description: 'Key blanks and the cuts for them, with no lock named anywhere on the sheet.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_untraceable_frame',
        name: 'Untraceable Frame',
        description:
          'A frame with the serial positions marked, and every one of them struck through.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_burn_sequence',
        name: 'Burn Sequence',
        description: 'The order in which to burn the other six pages, illustrated, with timings.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_spare_face',
        name: 'Spare Face',
        description:
          'A face in three views, unsigned, with the measurements of somebody real on it.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_cutout_ledger',
        name: 'Cutout Ledger',
        description:
          'A ledger of go-betweens, names blacked out, the columns still perfectly legible.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_final_knot',
        name: 'Final Knot',
        description: 'One knot, drawn large, and the only page that says what any of it is for.',
      },
    ],
  },
  {
    id: 'bp_the_abomination',
    name: 'Abomination Blueprint',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Grafting tables and a growth log. The handwriting gets worse towards the end.',
    targets: [{ kind: 'unit', id: 'the_abomination' }],
    pages: [
      {
        id: 'pg_abomination_grafting_tables',
        name: 'Grafting Tables',
        description: 'Tables of what takes and what does not, with the failures listed first.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_bone_lattice',
        name: 'Bone Lattice',
        description: 'A lattice drawn over a skeleton nobody can name the species of.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_feeding_rig',
        name: 'Feeding Rig',
        description: 'A rig, a hopper and a schedule. The quantities go up every week.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_nerve_braid',
        name: 'Nerve Braid',
        description: 'Nerve runs braided into one cable, under a note saying the order matters.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_containment_straps',
        name: 'Containment Straps',
        description:
          'Strap widths and anchor points, revised three times, heavier at each revision.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_growth_log',
        name: 'Growth Log',
        description: 'A log rather than a drawing. Dates, weights, and a gap of eleven days.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_waking_order',
        name: 'Waking Order',
        description: 'The order to wake it in. The handwriting on this one has gone entirely.',
      },
    ],
  },
  {
    id: 'bp_the_colossus',
    name: 'Colossus Blueprint',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Eight pages and a hull nobody in this city could cast today. You are assembling it.',
    targets: [{ kind: 'unit', id: 'the_colossus' }],
    pages: [
      {
        id: 'pg_colossus_hull_sections',
        name: 'Hull Sections',
        description:
          'Hull stations drawn one over another, at a casting size nobody here can pour.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_leg_actuators',
        name: 'Leg Actuators',
        description: 'One actuator at full stroke, with the loads it sees at each end of it.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_spine_frame',
        name: 'Spine Frame',
        description: 'The frame everything else hangs from, drawn in one continuous line.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_reactor_housing',
        name: 'Reactor Housing',
        description: 'The housing, its shielding, and the clearance nobody is allowed inside of.',
      },
      {
        id: 'pg_colossus_arm_assemblies',
        name: 'Arm Assemblies',
        description: 'Two arms drawn as one and mirrored, with the differences called out in red.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_sighting_gear',
        name: 'Sighting Gear',
        description: 'Optics and their mount, on a sightline that clears the shoulder by a hand.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_armour_schedule',
        name: 'Armour Schedule',
        description:
          'Plate by station and the weight it adds, totalled at the bottom in a shaky hand.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_ignition_sequence',
        name: 'Ignition Sequence',
        description:
          'Eleven steps in order, and a line saying there is no stopping after the fourth.',
      },
    ],
  },

  // -------------------------------------------------------------- unit: what the Garage builds
  // §D12c: every machine, including the scrap motorcycle, which §D12b also hands to Road Reavers.
  {
    id: 'bp_motorcycle',
    // Named after the machine as the Garage lists it, not after the class: a player holding the
    // document and looking at "The Scrappy" on the yard should read the same word in both places.
    name: 'Scrappy Blueprint',
    category: 'unit',
    rarity: 'common',
    blurb: 'A frame jig and a rebuilt engine. Also the only thing a Road Reaver ever needed.',
    targets: [
      { kind: 'vehicle', id: 'motorcycle' },
      { kind: 'unit', id: 'road_reavers' },
    ],
    pages: [
      {
        id: 'pg_motorcycle_frame_jig',
        name: 'Frame Jig',
        description: 'A jig laid out on a bench, tube lengths written along each member of it.',
      },
      {
        id: 'pg_motorcycle_engine_rebuild',
        name: 'Engine Rebuild',
        description:
          'An engine opened across both halves of the sheet, oily thumbprint in the corner.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    // The ids keep the old machine's name (`building/vehicles.ts` says why); the words are the
    // Offie's. Pages already sitting in satchels keep counting towards the document.
    id: 'bp_dirt_runner',
    name: 'Offie Blueprint',
    category: 'unit',
    rarity: 'common',
    blurb:
      'Bed plating, a bull bar and a lift kit, for a pickup that has to arrive with everybody.',
    targets: [{ kind: 'vehicle', id: 'dirt_runner' }],
    pages: [
      {
        id: 'pg_dirt_runner_knobbled_tyres',
        name: 'Bed Plating',
        description:
          'The bed plated over sheet by sheet, with the weld run marked as a single pass.',
      },
      {
        id: 'pg_dirt_runner_welded_frame',
        name: 'Bull Bar',
        description: 'A bar bent from one tube, radii called out where it goes round the lamps.',
      },
      {
        id: 'pg_dirt_runner_long_forks',
        name: 'Lift Kit',
        description: 'Spacer stacks and the ride height they buy, with the tyre that then fits.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_scrap_car',
    name: 'Scar Blueprint',
    category: 'unit',
    rarity: 'common',
    blurb: 'Three donor bodies into one car, and where to cut each of them.',
    targets: [{ kind: 'vehicle', id: 'scrap_car' }],
    pages: [
      {
        id: 'pg_scrap_car_donor_panels',
        name: 'Donor Panels',
        description: 'Three cars in outline with the cut lines drawn straight across them.',
      },
      {
        id: 'pg_scrap_car_engine_mounts',
        name: 'Engine Mounts',
        description:
          'Mounts for an engine that was never meant to sit here, drawn in two versions.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_scrap_car_bench_seating',
        name: 'Bench Seating',
        description:
          'A bench across the back, with how many it seats and how many it really seats.',
      },
    ],
  },
  {
    // Ids kept, words the Cheese Wagon's: see `bp_dirt_runner` above.
    id: 'bp_armoured_car',
    name: 'Cheese Wagon Blueprint',
    category: 'unit',
    rarity: 'uncommon',
    blurb:
      'Hull plate, window mesh, a plough and a roof rack, for a school bus that stops for nobody.',
    targets: [{ kind: 'vehicle', id: 'armoured_car' }],
    pages: [
      {
        id: 'pg_armoured_car_sill_plating',
        name: 'Hull Plating',
        description: 'Plate wrapped round a bus panel by panel, with the door left as a door.',
      },
      {
        id: 'pg_armoured_car_glass_substitute',
        name: 'Window Mesh',
        description:
          'Mesh gauge against what still gets through it, and a sample stapled to the corner.',
      },
      {
        id: 'pg_armoured_car_runflat_hubs',
        name: 'Ram Plough',
        description: 'A plough on the nose, drawn with the frame behind it that makes it any use.',
        rarity: 'rare',
      },
      {
        id: 'pg_armoured_car_firing_ports',
        name: 'Roof Rack',
        description: 'A rack, its rails, and the load at which the roof stops being a roof.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_gas_balloon',
    name: 'Gas Balloon Blueprint',
    category: 'unit',
    rarity: 'rare',
    blurb: 'Envelope panels and a page on the gas that nobody will put a source on.',
    targets: [{ kind: 'vehicle', id: 'gas_balloon' }],
    pages: [
      {
        id: 'pg_gas_balloon_envelope_panels',
        name: 'Envelope Panels',
        description:
          'Gores flattened out seam by seam, at a size that runs off the edge of the sheet.',
      },
      {
        id: 'pg_gas_balloon_gas_handling',
        name: 'Gas Handling',
        description: 'How to fill it. Where the gas comes from is not on this page or any other.',
      },
      {
        id: 'pg_gas_balloon_basket_weave',
        name: 'Basket Weave',
        description: 'A weave pattern and the load the cane takes, sketched from underneath.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_gas_balloon_ballast_sacks',
        name: 'Ballast Sacks',
        description: 'Sacks, their fill and where they hang, so it comes down where you meant.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_gas_balloon_burner_head',
        name: 'Burner Head',
        description:
          'A burner in section, flame path shaded, clearance to the envelope inked in red.',
      },
    ],
  },
  {
    id: 'bp_rotorcraft',
    name: 'Rotorcraft Blueprint',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Rotor geometry, in a hand that assumed the reader already knew how to fly.',
    targets: [{ kind: 'vehicle', id: 'rotorcraft' }],
    pages: [
      {
        id: 'pg_rotorcraft_rotor_geometry',
        name: 'Rotor Geometry',
        description: 'Blade twist and chord along the span, in a hand that assumed you could fly.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_swashplate',
        name: 'Swashplate',
        description: 'The swashplate from above and from the side, every linkage numbered.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_tail_boom',
        name: 'Tail Boom',
        description: 'A boom, its drive shaft, and the bearing spacing that stops it whipping.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_gearbox_tolerances',
        name: 'Gearbox Tolerances',
        description:
          'Tolerances to the hundredth, over a line saying this is the page that kills people.',
      },
      {
        id: 'pg_rotorcraft_blade_balancing',
        name: 'Blade Balancing',
        description:
          'A balancing rig and its weights, with what vibration is left plotted as a curve.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_fuel_governor',
        name: 'Fuel Governor',
        description: 'A governor drawn open, with the fuel it wants at each collective setting.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_flight_notes',
        name: 'Flight Notes',
        description: 'Not engineering. Four paragraphs on what it does before it is ready to fly.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_heli_porter',
    name: 'Heli Porter Blueprint',
    category: 'unit',
    rarity: 'exotic',
    blurb:
      'A factory manual, complete, with corrections pencilled in the margins where the factory was wrong.',
    targets: [{ kind: 'vehicle', id: 'heli_porter' }],
    pages: [
      {
        id: 'pg_heli_porter_main_gearbox',
        name: 'Main Gearbox',
        description: 'A factory plate of the main gearbox, with the factory corrected in pencil.',
        rarity: 'rare',
      },
      {
        id: 'pg_heli_porter_rotor_head',
        name: 'Rotor Head',
        description: 'The head exploded across a double page, every shim listed by part number.',
        rarity: 'rare',
      },
      {
        id: 'pg_heli_porter_cabin_frame',
        name: 'Cabin Frame',
        description: 'A frame in station lines, doors and load hooks drawn in their real places.',
        rarity: 'rare',
      },
      {
        id: 'pg_heli_porter_twin_turbines',
        name: 'Twin Turbines',
        description: 'Both turbines, their starts, and the one order they will start in.',
      },
    ],
  },

  // --------------------------------------------------------- upgrade: what the workshop fits
  // §D12g. The gate is unchanged in shape: tier one of a line is open to anybody and the two above
  // it want the line's document. What changed is that the document is now four pages, not one item.
  {
    id: 'bp_composite_armour',
    name: 'Composite Armour Blueprint',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Lamination schedules for plate that is mostly air.',
    targets: [
      { kind: 'unit_upgrade', id: 'armour_2' },
      { kind: 'unit_upgrade', id: 'armour_3' },
    ],
    pages: [
      {
        id: 'pg_composite_armour_lamination',
        name: 'Lamination Schedule',
        description:
          'Layer by layer, with the cure temperature written along the top of the sheet.',
        rarity: 'rare',
      },
      {
        id: 'pg_composite_armour_backing_weave',
        name: 'Backing Weave',
        description: 'The weave behind the plate, drawn so close in that it reads as a pattern.',
      },
      {
        id: 'pg_composite_armour_edge_binding',
        name: 'Edge Binding',
        description:
          'How the edge is bound so the whole thing does not come apart on the first hit.',
      },
    ],
  },
  {
    id: 'bp_munitions',
    name: 'Munitions Blueprint',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Load tables. The margins argue with the tables.',
    targets: [
      { kind: 'unit_upgrade', id: 'weapons_2' },
      { kind: 'unit_upgrade', id: 'weapons_3' },
    ],
    pages: [
      {
        id: 'pg_munitions_load_tables',
        name: 'Load Tables',
        description: 'Charge weights by cartridge, with margin notes arguing against the tables.',
      },
      {
        id: 'pg_munitions_primer_mixes',
        name: 'Primer Mixes',
        description: 'Mixes by mass, in a hand that gets smaller and more careful down the page.',
        rarity: 'rare',
      },
      {
        id: 'pg_munitions_barrel_wear',
        name: 'Barrel Wear Charts',
        description:
          'Wear against rounds fired, plotted, with the point marked where it stops grouping.',
      },
    ],
  },
  {
    id: 'bp_cybernetics',
    name: 'Cybernetics Blueprint',
    category: 'upgrade',
    rarity: 'rare',
    blurb: 'Surgical plates and a wiring diagram, annotated by somebody who stopped writing.',
    targets: [
      { kind: 'unit_upgrade', id: 'cybernetics_2' },
      { kind: 'unit_upgrade', id: 'cybernetics_3' },
    ],
    pages: [
      {
        id: 'pg_cybernetics_socket_templates',
        name: 'Socket Templates',
        description: 'Socket outlines at full size, meant to be cut out and laid on the skin.',
      },
      {
        id: 'pg_cybernetics_nerve_mapping',
        name: 'Nerve Mapping',
        description: 'A nerve map with the useful branches inked and the rest of it left grey.',
      },
      {
        id: 'pg_cybernetics_anaesthetic_notes',
        name: 'Anaesthetic Notes',
        description: 'Doses by weight, and one line on what happens when you get it wrong.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_cybernetics_rejection_ward',
        name: 'Rejection Ward',
        description:
          'A ward plan for afterwards, with more beds on it than anyone expects to need.',
        rarity: 'uncommon',
      },
    ],
  },

  // ---------------------------------------------------- upgrade: what a structure becomes (§D12f)
  // One retrofit document per structure, and it covers that structure's advanced modifications.
  // Page counts follow how much of a district lives out of the building: the Nexus, the Lab, the
  // Gauntlet and the Garage carry four, the Quarters and the Greenhouse two.
  {
    id: 'bp_nexus_retrofit',
    name: 'Nexus Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'rare',
    blurb: 'Cable runs and cipher racks. Everything the district knows goes through this room.',
    targets: [{ kind: 'building', id: 'nexus' }],
    pages: [
      {
        id: 'pg_nexus_cable_runs',
        name: 'Cable Runs',
        description:
          'Every run in the building on one sheet, coloured by circuit, the colours faded.',
      },
      {
        id: 'pg_nexus_cipher_racks',
        name: 'Cipher Racks',
        description: 'Rack elevations and the cooling they want, with the door drawn locked.',
      },
      {
        id: 'pg_nexus_floor_plan',
        name: 'Floor Plan',
        description: 'The room from above, with the one wall marked that must not be moved.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_nexus_aerial_mast',
        name: 'Aerial Mast',
        description: 'A mast, its guys, and the height it has to reach to be worth putting up.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_quarters_retrofit',
    name: 'Quarters Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'Bunk framing and a flue that draws. People sleep or they do not.',
    targets: [{ kind: 'building', id: 'quarters' }],
    pages: [
      {
        id: 'pg_quarters_bunk_framing',
        name: 'Bunk Framing',
        description: 'Three high, timber sizes given, and how much room is left to sit up in.',
      },
      {
        id: 'pg_quarters_stove_flue',
        name: 'Stove Flue',
        description: 'A flue that draws, in section, with the one bend it will tolerate.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_greenhouse_retrofit',
    name: 'Greenhouse Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'Glazing bars and an irrigation loop that does not need anybody standing over it.',
    targets: [{ kind: 'building', id: 'greenhouse' }],
    pages: [
      {
        id: 'pg_greenhouse_glazing_bars',
        name: 'Glazing Bars',
        description:
          'Bar sections and the panes they take, allowing for glass that is never square.',
      },
      {
        id: 'pg_greenhouse_irrigation_loop',
        name: 'Irrigation Loop',
        description: 'A loop off a header tank, so nobody has to stand there with a watering can.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_generator_retrofit',
    name: 'Generator Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Winding diagrams and a governor linkage, for the machine everything else is plugged into.',
    targets: [{ kind: 'building', id: 'generator' }],
    pages: [
      {
        id: 'pg_generator_winding_diagram',
        name: 'Winding Diagram',
        description: 'Windings counted out turn by turn, with the wire gauge noted in the corner.',
        rarity: 'rare',
      },
      {
        id: 'pg_generator_governor_linkage',
        name: 'Governor Linkage',
        description: 'The linkage that holds the speed, in three positions, with the stops set.',
      },
      {
        id: 'pg_generator_exhaust_scrubber',
        name: 'Exhaust Scrubber',
        description: 'A scrubber, its packing, and how often somebody has to go and change it.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_scrapyard_retrofit',
    name: 'Scrapyard Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'A sorting line and press tooling. The yard stops being a heap and becomes a shop.',
    targets: [{ kind: 'building', id: 'scrapyard' }],
    pages: [
      {
        id: 'pg_scrapyard_sorting_line',
        name: 'Sorting Line',
        description: 'The line drawn as a row of hands, with what each pair takes off the belt.',
      },
      {
        id: 'pg_scrapyard_press_tooling',
        name: 'Press Tooling',
        description: 'Tooling for the press in hardened steel, drawn with the tonnage it needs.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_scrapyard_crane_gantry',
        name: 'Crane Gantry',
        description: 'A gantry across the yard, and the footings that stop it walking under load.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_apothecary_retrofit',
    name: 'Apothecary Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'A still column and dosage tables somebody died working out.',
    targets: [{ kind: 'building', id: 'apothecary' }],
    pages: [
      {
        id: 'pg_apothecary_still_column',
        name: 'Still Column',
        description: 'A column in section, plate by plate, with which cut to take and when.',
        rarity: 'rare',
      },
      {
        id: 'pg_apothecary_dosage_tables',
        name: 'Dosage Tables',
        description: 'Doses by body weight, worked out the hard way, with the names left off.',
      },
      {
        id: 'pg_apothecary_cold_store',
        name: 'Cold Store',
        description: 'An insulated room and its ice budget, for the things that will not keep.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_gate_retrofit',
    name: 'Gate Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Counterweights and bar sockets. It has to shut faster than anybody can run.',
    targets: [{ kind: 'building', id: 'gate' }],
    pages: [
      {
        id: 'pg_gate_counterweights',
        name: 'Counterweights',
        description: 'Weights against the leaf, so it shuts faster than anybody outside can run.',
      },
      {
        id: 'pg_gate_murder_holes',
        name: 'Murder Holes',
        description:
          'Holes in the soffit, spaced to cover the whole gateway and nothing beyond it.',
        rarity: 'rare',
      },
      {
        id: 'pg_gate_bar_sockets',
        name: 'Bar Sockets',
        description: 'Sockets sunk into the jamb, and the depth that makes them worth having.',
      },
    ],
  },
  {
    id: 'bp_lab_retrofit',
    name: 'Lab Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'rare',
    blurb: 'Bench layout, an extraction hood and a room clean enough to be worth the trouble.',
    targets: [{ kind: 'building', id: 'lab' }],
    pages: [
      {
        id: 'pg_lab_bench_layout',
        name: 'Bench Layout',
        description: 'Benches, services and walking room, in that order of importance.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_lab_extraction_hood',
        name: 'Extraction Hood',
        description:
          'A hood, its duct, and the face velocity that makes it a hood and not a shelf.',
      },
      {
        id: 'pg_lab_reference_shelf',
        name: 'Reference Shelf',
        description: 'Shelving, and a list of what should be on it that is mostly not.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_lab_clean_room',
        name: 'Clean Room',
        description:
          'A room clean enough to be worth the trouble, and the airlock that makes it one.',
      },
    ],
  },
  {
    id: 'bp_gauntlet_retrofit',
    name: 'Gauntlet Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Obstacle frames, drainage under the sand, and a board everyone can read their score off.',
    targets: [{ kind: 'building', id: 'gauntlet' }],
    pages: [
      {
        id: 'pg_gauntlet_obstacle_frames',
        name: 'Obstacle Frames',
        description: 'Frames at their real heights, with the landing marked on the far side.',
      },
      {
        id: 'pg_gauntlet_pit_drainage',
        name: 'Sand Pit Drainage',
        description: 'What goes under the sand, which is the only reason the pit works in the wet.',
      },
      {
        id: 'pg_gauntlet_scoring_board',
        name: 'Scoring Board',
        description: 'A board readable from the rail, with the letter heights that prove it.',
        rarity: 'common',
      },
      {
        id: 'pg_gauntlet_armoury_racks',
        name: 'Armoury Racks',
        description: 'Racks by weapon length, with the lock on the door and who holds the key.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_infirmary_retrofit',
    name: 'Infirmary Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Ward layout and a sterile line people actually keep to.',
    targets: [{ kind: 'building', id: 'infirmary' }],
    pages: [
      {
        id: 'pg_infirmary_ward_layout',
        name: 'Ward Layout',
        description: 'Beds, spacing, and the door width a loaded stretcher actually needs.',
      },
      {
        id: 'pg_infirmary_sterile_line',
        name: 'Sterile Line',
        description:
          'A line on the floor and the rules for crossing it, which people keep to or do not.',
        rarity: 'rare',
      },
      {
        id: 'pg_infirmary_triage_board',
        name: 'Triage Board',
        description: 'A board, four columns, and the order the columns are worked through in.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_garage_retrofit',
    name: 'Garage Retrofit Blueprint',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Pit layout, hoist ratings and a parts wall with everything where it should be.',
    targets: [{ kind: 'building', id: 'garage' }],
    pages: [
      {
        id: 'pg_garage_pit_layout',
        name: 'Pit Layout',
        description:
          'A pit with steps at both ends, drawn by somebody who has been trapped in one.',
      },
      {
        id: 'pg_garage_hoist_rating',
        name: 'Hoist Rating',
        description: 'Ratings against what the district actually drives, two of them crossed out.',
        rarity: 'rare',
      },
      {
        id: 'pg_garage_fuel_bay',
        name: 'Fuel Bay',
        description: 'A bay, a bund, and the distance to the nearest thing that makes a spark.',
      },
      {
        id: 'pg_garage_parts_wall',
        name: 'Parts Wall',
        description: 'A wall of shadows, every tool outlined, so a missing one is obvious.',
        rarity: 'common',
      },
    ],
  },

  // ------------------------------------------------------ consumable: made for one night (§D12e)
  {
    id: 'bp_overnight_plating',
    name: 'Overnight Plating Blueprint',
    category: 'consumable',
    rarity: 'common',
    blurb: 'A cut list and a weld sequence, for the night before rather than the month before.',
    targets: [{ kind: 'battle_boost', id: 'boost_plated_overnight' }],
    pages: [
      {
        id: 'pg_overnight_plating_cut_list',
        name: 'Cut List',
        description: 'Sizes and quantities for one night, and nothing at all about where it goes.',
      },
      {
        id: 'pg_overnight_plating_weld_sequence',
        name: 'Weld Sequence',
        description: 'The order to run the welds in, so it is still straight in the morning.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_shaped_charges',
    name: 'Shaped Charge Blueprint',
    category: 'consumable',
    rarity: 'uncommon',
    blurb: 'Cone geometry and a standoff table. Cut for this wall, this week.',
    targets: [{ kind: 'battle_boost', id: 'boost_shaped_for_this' }],
    pages: [
      {
        id: 'pg_shaped_charges_cone_geometry',
        name: 'Cone Geometry',
        description: 'Cone angles against standoff, plotted, with the useful band shaded in.',
        rarity: 'rare',
      },
      {
        id: 'pg_shaped_charges_standoff_table',
        name: 'Standoff Table',
        description: 'Distances in a table, cut for this wall and this week and nothing else.',
      },
      {
        id: 'pg_shaped_charges_tamping_notes',
        name: 'Tamping Notes',
        description: 'What to pack behind it, and what happens when there is nothing behind it.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_approach_plans',
    name: 'Approach Plans Blueprint',
    category: 'consumable',
    rarity: 'common',
    blurb: 'Somebody surveyed the doors and wrote down which way the specialists go in.',
    targets: [{ kind: 'battle_boost', id: 'boost_the_right_doors' }],
    pages: [
      {
        id: 'pg_approach_plans_door_survey',
        name: 'Door Survey',
        description: 'Every door on the frontage, measured, with which way each of them opens.',
      },
      {
        id: 'pg_approach_plans_timing_sheet',
        name: 'Timing Sheet',
        description: 'Times down the left, rooms across the top, filled in for one night only.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_refined_accelerant',
    name: 'Refined Accelerant Blueprint',
    category: 'consumable',
    rarity: 'rare',
    blurb: 'Fuel nobody should be able to make, and four pages on how not to be standing near it.',
    targets: [{ kind: 'battle_boost', id: 'boost_the_colossus_walks' }],
    pages: [
      {
        id: 'pg_refined_accelerant_cracking_column',
        name: 'Cracking Column',
        description: 'A column nobody should be able to build, drawn as though anybody could.',
      },
      {
        id: 'pg_refined_accelerant_additive_mix',
        name: 'Additive Mix',
        description: 'Proportions to three places, with a line under the one not to exceed.',
      },
      {
        id: 'pg_refined_accelerant_handling_rules',
        name: 'Handling Rules',
        description: 'Four rules, lettered large, and none of them about the fuel itself.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_refined_accelerant_burn_rate',
        name: 'Burn Rate Chart',
        description: 'Burn rate against temperature, with the runaway drawn as a dotted line.',
      },
    ],
  },

  /*
   * The three traps (§I4).
   *
   * A trap is a consumable in the same sense a shaped charge is: cut for one night, gone by
   * morning. Their page counts run 2, 3, 4 against the §D3 bands, in the order the Security
   * Officer's track opens them, so the cheap one is a thing a district reaches early and the
   * frontage collapse is a fortnight of collecting.
   */
  {
    id: 'bp_pressure_plates',
    name: 'Pressure Plate Blueprint',
    category: 'consumable',
    rarity: 'common',
    blurb: 'Which boards to lift, what to put under them, and how much weight sets it off.',
    targets: [{ kind: 'trap', id: 'trap_pressure_plates' }],
    pages: [
      {
        id: 'pg_pressure_plates_board_spans',
        name: 'Board Spans',
        description: 'Which boards to lift, how far they span, and how far they can be trusted.',
      },
      {
        id: 'pg_pressure_plates_trigger_weights',
        name: 'Trigger Weights',
        description:
          'Weights against what sets it off, found with a sack of scrap and a stopwatch.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_buried_shell',
    name: 'Buried Shell Blueprint',
    category: 'consumable',
    rarity: 'uncommon',
    blurb: 'How to move a cracked chemical round, how deep to put it, and where the wire runs.',
    targets: [{ kind: 'trap', id: 'trap_gas_shell' }],
    pages: [
      {
        id: 'pg_buried_shell_round_handling',
        name: 'Round Handling',
        description: 'How to carry a cracked round, in six drawings, none of them reassuring.',
        rarity: 'rare',
      },
      {
        id: 'pg_buried_shell_burial_depth',
        name: 'Burial Depth',
        description: 'Depth against what comes back up, with the soil types listed down the side.',
      },
      {
        id: 'pg_buried_shell_trip_wiring',
        name: 'Trip Wiring',
        description: 'Wire runs, anchor points, and the slack that keeps it quiet in the rain.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_prepared_collapse',
    name: 'Prepared Collapse Blueprint',
    category: 'consumable',
    rarity: 'rare',
    blurb: 'A survey of what is holding the frontage up, and the order in which to stop it.',
    targets: [{ kind: 'trap', id: 'trap_collapse' }],
    pages: [
      {
        id: 'pg_prepared_collapse_load_path',
        name: 'Load Path Survey',
        description: 'What holds the frontage up, traced back to the ground, floor by floor.',
      },
      {
        id: 'pg_prepared_collapse_cut_sequence',
        name: 'Cut Sequence',
        description: 'The order in which to stop it holding, numbered, with the last cut circled.',
      },
      {
        id: 'pg_prepared_collapse_holding_charge',
        name: 'Holding Charge',
        description: 'One charge, where it sits, and the moment it becomes the only thing holding.',
      },
      {
        id: 'pg_prepared_collapse_fall_line',
        name: 'Fall Line',
        description: 'Where it lands, drawn on a street plan, with a house inside the arc.',
        rarity: 'uncommon',
      },
    ],
  },
] as const satisfies readonly BlueprintSpec[];

export type BlueprintId = (typeof BLUEPRINTS)[number]['id'];
export type BlueprintPageId = (typeof BLUEPRINTS)[number]['pages'][number]['id'];

export const BLUEPRINT_IDS: readonly BlueprintId[] = BLUEPRINTS.map((spec) => spec.id);
/** The page ids as a schema, so a stored mission's won page validates against the catalogue. */
export const BlueprintPageIdSchema = z.enum(
  BLUEPRINTS.flatMap((spec) => spec.pages.map((page) => page.id)) as [string, ...string[]],
);

export const BLUEPRINT_PAGE_IDS: readonly BlueprintPageId[] = BLUEPRINTS.flatMap((spec) =>
  spec.pages.map((page) => page.id),
);

const BY_ID = new Map<string, BlueprintSpec>(BLUEPRINTS.map((spec) => [spec.id, spec]));
const BY_PAGE_ID = new Map<string, BlueprintSpec>(
  BLUEPRINTS.flatMap((spec) => spec.pages.map((page) => [page.id, spec] as const)),
);
const PAGE_BY_ID = new Map<string, BlueprintPage>(
  BLUEPRINTS.flatMap((spec) => spec.pages.map((page) => [page.id, page] as const)),
);

export function findBlueprint(id: string): BlueprintSpec | undefined {
  return BY_ID.get(id);
}

/** The document a page belongs to. A page names exactly one. */
export function blueprintOfPage(pageId: string): BlueprintSpec | undefined {
  return BY_PAGE_ID.get(pageId);
}

export function findBlueprintPage(pageId: string): BlueprintPage | undefined {
  return PAGE_BY_ID.get(pageId);
}

/**
 * What one sheet is worth on the rarity scale.
 *
 * The document's rarity unless the page says otherwise, which is the whole of the rule and the
 * reason it is a function rather than a field every page has to fill in. `items/catalog.ts` reads
 * it to price the page as an item and the Blueprints screen reads it to colour the row, so the two
 * cannot drift.
 */
export function pageRarity(blueprint: BlueprintSpec, page: BlueprintPage): ItemRarity {
  return page.rarity ?? blueprint.rarity;
}

/** The catalogue in one category, in catalogue order: one section of the Blueprints page. */
export function blueprintsOfCategory(category: BlueprintCategory): readonly BlueprintSpec[] {
  return BLUEPRINTS.filter((spec) => spec.category === category);
}

/**
 * Guards at load, because both of these are silent bugs rather than crashes.
 *
 * A duplicate page id would make two documents share a page, so collecting one would fill a square
 * on the other. A page count outside 2..8 is §D3 being broken by a content edit.
 */
const MIN_PAGES = 2;
const MAX_PAGES = 8;
const seenPages = new Set<string>();
for (const spec of BLUEPRINTS) {
  if (spec.pages.length < MIN_PAGES || spec.pages.length > MAX_PAGES) {
    throw new Error(
      `${spec.id} has ${spec.pages.length} pages, outside ${MIN_PAGES}..${MAX_PAGES}`,
    );
  }
  for (const page of spec.pages) {
    if (seenPages.has(page.id)) throw new Error(`page ${page.id} appears in two blueprints`);
    seenPages.add(page.id);
    // A page two tiers off its document is a content slip rather than a design choice: it prices
    // the page wrong on the barrow and paints the row a colour the document never wears.
    const step = Math.abs(RARITY_ORDER[pageRarity(spec, page)] - RARITY_ORDER[spec.rarity]);
    if (step > 1) {
      throw new Error(`page ${page.id} is ${step} rarity tiers from ${spec.id}, which allows one`);
    }
  }
}
