import { z } from 'zod';
import { RARITY_ORDER, type ItemRarity } from '../items/rarity.js';
import { type BlueprintMotif } from './motifs.js';
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
 * `items/catalog.ts` turns every page into an item so a page can sit in an inventory and survive a
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
  unit: 'Units and machines. Vehicles count as units: somebody still has to be taught to make one.',
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
   * What the sheet draws, chosen by hand off the name and the line under it (§D8).
   *
   * Not derivable. Nothing about "a page of the Sniper Blueprint" says the Barrel Liners sheet
   * shows a rifled bore in section and the Range Cards sheet shows a ruled card, and that is
   * exactly the difference a player uses to tell two sheets apart in an inventory row at 36px.
   * `motifs.test.ts` holds the rules: a page never repeats another page of its own document and
   * never draws its document's cover.
   */
  motif: BlueprintMotif;
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
  /** What the cover draws: the thing at the end of the document. No two documents share one. */
  motif: BlueprintMotif;
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
  // ---------------------------------------------------------------- unit: trained units (§D12a)
  {
    id: 'bp_snipers',
    name: 'Sniper Blueprint',
    motif: 'rifle',
    category: 'unit',
    rarity: 'uncommon',
    blurb: 'A long barrel, a cold room to zero it in, and the tables to read wind off.',
    targets: [{ kind: 'unit', id: 'snipers' }],
    pages: [
      {
        id: 'pg_snipers_barrel_liners',
        name: 'Barrel Liners',
        motif: 'bore',
        description:
          'A bore in section with the rifling twist inked twice, because the first hand had it backwards.',
        rarity: 'rare',
      },
      {
        id: 'pg_snipers_range_cards',
        name: 'Range Cards',
        motif: 'card',
        description:
          'Ruled columns of holdover and drift, filled in pencil, a third of them crossed out again.',
      },
      {
        id: 'pg_snipers_ghillie_patterns',
        name: 'Ghillie Patterns',
        motif: 'net',
        description:
          'Cut shapes for hessian and net, traced round a coat that was already falling apart.',
      },
    ],
  },
  {
    id: 'bp_demolishers',
    name: 'Demolisher Blueprint',
    motif: 'breach',
    category: 'unit',
    rarity: 'uncommon',
    blurb: 'Where to put the charge so the wall falls the way you wanted it to.',
    targets: [{ kind: 'unit', id: 'demolishers' }],
    pages: [
      {
        id: 'pg_demolishers_charge_moulds',
        name: 'Charge Moulds',
        motif: 'mould',
        description:
          'Cone and slab moulds drawn full size, with the sand mix noted along the bottom edge.',
      },
      {
        id: 'pg_demolishers_fuse_timings',
        name: 'Fuse Timings',
        motif: 'fuse',
        description:
          'Burn rates per metre of cord, and a warning about damp cord that somebody underlined.',
        rarity: 'rare',
      },
      {
        id: 'pg_demolishers_breaching_frames',
        name: 'Breaching Frames',
        motif: 'frame',
        description:
          'Timber frames for a doorway that is not a doorway yet, with the cuts numbered.',
      },
    ],
  },
  {
    id: 'bp_kite_crews',
    name: 'Kite Crew Blueprint',
    motif: 'kite',
    category: 'unit',
    rarity: 'uncommon',
    blurb: 'Spars, sail and a winch. Somebody goes up and everybody else finds out what is coming.',
    targets: [{ kind: 'unit', id: 'kite_crews' }],
    pages: [
      {
        id: 'pg_kite_crews_spar_frames',
        name: 'Spar Frames',
        motif: 'frame',
        description:
          'Spar lengths and lashing points, in a hand that assumed the reader owns a knife.',
      },
      {
        id: 'pg_kite_crews_sail_cutting',
        name: 'Sail Cutting',
        motif: 'pattern',
        description:
          'The sail flattened into panels, seam allowance shaded, one panel drawn twice.',
      },
      {
        id: 'pg_kite_crews_winch_gearing',
        name: 'Winch Gearing',
        motif: 'winch',
        description:
          'Gear teeth counted out on a drum, with the brake pawl sketched in the margin.',
        rarity: 'rare',
      },
      {
        id: 'pg_kite_crews_launch_rails',
        name: 'Launch Rails',
        motif: 'section',
        description: 'A rail and its footing, and a note on which roofs will take the load.',
      },
    ],
  },
  {
    id: 'bp_cyberhounds',
    name: 'Cyberhound Blueprint',
    motif: 'hound',
    category: 'unit',
    rarity: 'rare',
    blurb: 'Four legs, a rebuilt jaw and a nose that was never a nose.',
    targets: [{ kind: 'unit', id: 'cyber_dogs' }],
    pages: [
      {
        id: 'pg_cyberhounds_limb_actuators',
        name: 'Limb Actuators',
        motif: 'piston',
        description:
          'Four legs in exploded view, the same actuator drawn four times with different wear on it.',
      },
      {
        id: 'pg_cyberhounds_scent_board',
        name: 'Scent Board',
        motif: 'circuit',
        description:
          'A sensor board and its trace, under a short list of what it was taught to find.',
      },
      {
        id: 'pg_cyberhounds_jaw_servos',
        name: 'Jaw Servos',
        motif: 'exploded',
        description: 'A jaw opened out flat, bite force pencilled beside each tooth position.',
      },
      {
        id: 'pg_cyberhounds_kennel_wiring',
        name: 'Kennel Wiring',
        motif: 'plan',
        description: 'Charging rails and a floor drain, with DO NOT STAND HERE lettered across it.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_the_twins',
    name: 'Twins Blueprint',
    motif: 'twin_figures',
    category: 'unit',
    rarity: 'rare',
    blurb: 'Two rigs cut from one drawing. Neither of them works on its own.',
    targets: [{ kind: 'unit', id: 'the_twins' }],
    pages: [
      {
        id: 'pg_the_twins_paired_harness',
        name: 'Paired Harness',
        motif: 'mirrored_pair',
        description:
          'One harness drawn twice and mirrored, with the shared buckle circled on both.',
      },
      {
        id: 'pg_the_twins_mirror_sights',
        name: 'Mirror Sights',
        motif: 'optics',
        description:
          'Two sight lines crossing at a marked distance, and the correction if only one of them fires.',
      },
      {
        id: 'pg_the_twins_split_loader',
        name: 'Split Loader',
        motif: 'manifold',
        description:
          'A feed that goes two ways, and a drawing of the jam it makes when it goes one.',
      },
      {
        id: 'pg_the_twins_matched_frames',
        name: 'Matched Frames',
        motif: 'dimension',
        description:
          'Frame tolerances to a tenth, under a line saying neither of them works alone.',
      },
      {
        id: 'pg_the_twins_signal_cord',
        name: 'Signal Cord',
        motif: 'line_run',
        description: 'A cord run between two rigs, and what each number of tugs on it means.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_ironsides',
    name: 'Ironside Blueprint',
    motif: 'cuirass',
    category: 'unit',
    rarity: 'uncommon',
    blurb: 'Plate cut to a schedule somebody worked out under fire, and never changed since.',
    targets: [{ kind: 'unit', id: 'ironsides' }],
    pages: [
      {
        id: 'pg_ironsides_plate_schedule',
        name: 'Plate Schedule',
        motif: 'table',
        description:
          'Plate thickness by body zone, in a schedule nobody has dared change since it was written.',
        rarity: 'rare',
      },
      {
        id: 'pg_ironsides_shoulder_anchors',
        name: 'Shoulder Anchors',
        motif: 'bolts',
        description: 'Where the whole weight hangs from, with the bolt pattern circled twice.',
      },
      {
        id: 'pg_ironsides_visor_slits',
        name: 'Visor Slits',
        motif: 'dimension',
        description:
          'Slit widths against what you can still see through them. Narrower than anyone likes.',
      },
      {
        id: 'pg_ironsides_boot_weights',
        name: 'Boot Weights',
        motif: 'boot',
        description: 'Lead in the soles, in grams, so the wearer stops going over backwards.',
      },
    ],
  },
  {
    id: 'bp_juggernauts',
    name: 'Juggernaut Blueprint',
    motif: 'exoframe',
    category: 'unit',
    rarity: 'rare',
    blurb: 'An exoframe with a person somewhere inside it, and a cooling loop that has to hold.',
    targets: [{ kind: 'unit', id: 'juggernauts' }],
    pages: [
      {
        id: 'pg_juggernauts_exoframe_legs',
        name: 'Exoframe Legs',
        motif: 'piston',
        description:
          'A leg in three positions, with the knee drawn again underneath at twice the size.',
      },
      {
        id: 'pg_juggernauts_power_spine',
        name: 'Power Spine',
        motif: 'cable_run',
        description:
          'The spine as a wiring run, every tap numbered, one of them scratched out entirely.',
      },
      {
        id: 'pg_juggernauts_slab_armour',
        name: 'Slab Armour',
        motif: 'cut_list',
        description:
          'Slabs laid out with the cut order on them, so nothing warps before it is hung.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_juggernauts_coolant_loop',
        name: 'Coolant Loop',
        motif: 'loop',
        description:
          'The loop that has to hold, inked in blue, with its working pressure underlined.',
      },
      {
        id: 'pg_juggernauts_gun_mount',
        name: 'Hand Cannon Mount',
        motif: 'mount',
        description:
          'A mount and the recoil path through it, ending at the shoulder that takes it.',
      },
    ],
  },
  {
    id: 'bp_hollow_men',
    name: 'Hollow Man Blueprint',
    motif: 'husk',
    category: 'unit',
    rarity: 'rare',
    blurb: 'A shell that walks, weighted at the ankles so it does not fall over when it is shot.',
    targets: [{ kind: 'unit', id: 'hollow_men' }],
    pages: [
      {
        id: 'pg_hollow_men_empty_shell',
        name: 'Empty Shell',
        motif: 'section',
        description:
          'A shell in section with nothing inside it, which is the drawing and the point.',
      },
      {
        id: 'pg_hollow_men_gait_governor',
        name: 'Gait Governor',
        motif: 'governor',
        description: 'A governor and its stops, so the thing walks rather than runs at people.',
      },
      {
        id: 'pg_hollow_men_voice_box',
        name: 'Voice Box',
        motif: 'speaker',
        description: 'A speaker cavity, and beside it the eleven words it is allowed to make.',
      },
      {
        id: 'pg_hollow_men_ballast_core',
        name: 'Ballast Core',
        motif: 'ballast',
        description:
          'Weight at the ankles, worked out from how far it can lean before it goes over.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_hollow_men_standing_order',
        name: 'Standing Order',
        motif: 'list',
        description:
          'Not a drawing. One paragraph on what it does when nobody is telling it anything.',
      },
    ],
  },

  // ------------------------------------------------------------------- unit: the uniques (§D12d)
  {
    id: 'bp_the_specter',
    name: 'Specter Blueprint',
    motif: 'shroud',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Six pages on not being seen, and the last one is mostly about the cold.',
    targets: [{ kind: 'unit', id: 'the_specter' }],
    pages: [
      {
        id: 'pg_the_specter_shroud_weave',
        name: 'Shroud Weave',
        motif: 'weave',
        description:
          'A weave in close-up, thread count in the corner, drawn so it vanishes at arm length.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_silent_boots',
        name: 'Silent Boots',
        motif: 'boot',
        description: 'A sole cut in five layers, with the one layer that does the work shaded.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_cold_optics',
        name: 'Cold Optics',
        motif: 'optics',
        description: 'Optics that read heat, and the housing that stops them giving any off.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_ghost_wiring',
        name: 'Ghost Wiring',
        motif: 'cable_run',
        description: 'A wiring run with no loom, taped flat, every joint drawn on its own.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_scent_null',
        name: 'Scent Null',
        motif: 'list',
        description:
          'A sealed bag and a chemical list, half of it in a shorthand nobody else uses.',
        rarity: 'rare',
      },
      {
        id: 'pg_the_specter_last_page',
        name: 'The Last Page',
        motif: 'prose',
        description:
          'Mostly about the cold. No drawing on it at all, and it is the page nobody has.',
      },
    ],
  },
  {
    id: 'bp_the_crimson_dancer',
    name: 'Crimson Dancer Blueprint',
    motif: 'blade',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Edge geometry and footwork, written by somebody who thought of it as choreography.',
    targets: [{ kind: 'unit', id: 'the_crimson_dancer' }],
    pages: [
      {
        id: 'pg_crimson_dancer_edge_geometry',
        name: 'Edge Geometry',
        motif: 'section',
        description: 'Blade sections at five points along the edge, each one at a different angle.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_balance_rig',
        name: 'Balance Rig',
        motif: 'balance',
        description: 'A rig for finding the point it turns about, sketched from three sides.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_red_lacquer',
        name: 'Red Lacquer',
        motif: 'table',
        description: 'A lacquer recipe and a drying schedule. The colour swatch has gone brown.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_footwork_chart',
        name: 'Footwork Chart',
        motif: 'footprints',
        description:
          'Footprints on a grid with numbers beside them, read as a dance and meant as one.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_pulse_lace',
        name: 'Pulse Lace',
        motif: 'lace',
        description: 'Lacing that tightens on a pulse, drawn at the wrist and again at the ankle.',
        rarity: 'rare',
      },
      {
        id: 'pg_crimson_dancer_curtain_call',
        name: 'Curtain Call',
        motif: 'figure',
        description: 'The last figure of the sequence, drawn once and never explained.',
      },
    ],
  },
  {
    id: 'bp_the_loose_end',
    name: 'Loose End Blueprint',
    motif: 'frayed_end',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Seven pages, none of them signed, and one of them is a list of ways to burn the rest.',
    targets: [{ kind: 'unit', id: 'the_loose_end' }],
    pages: [
      {
        id: 'pg_loose_end_frayed_schematic',
        name: 'Frayed Schematic',
        motif: 'elevation',
        description: 'A schematic torn across one corner, so the part it names is missing.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_dead_drop_keys',
        name: 'Dead Drop Keys',
        motif: 'key',
        description: 'Key blanks and the cuts for them, with no lock named anywhere on the sheet.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_untraceable_frame',
        name: 'Untraceable Frame',
        motif: 'frame',
        description:
          'A frame with the serial positions marked, and every one of them struck through.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_burn_sequence',
        name: 'Burn Sequence',
        motif: 'list',
        description: 'The order in which to burn the other six pages, illustrated, with timings.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_spare_face',
        name: 'Spare Face',
        motif: 'face',
        description:
          'A face in three views, unsigned, with the measurements of somebody real on it.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_cutout_ledger',
        name: 'Cutout Ledger',
        motif: 'table',
        description:
          'A ledger of go-betweens, names blacked out, the columns still perfectly legible.',
        rarity: 'rare',
      },
      {
        id: 'pg_loose_end_final_knot',
        name: 'Final Knot',
        motif: 'knot',
        description: 'One knot, drawn large, and the only page that says what any of it is for.',
      },
    ],
  },
  {
    id: 'bp_the_abomination',
    name: 'Abomination Blueprint',
    motif: 'graft_body',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Grafting tables and a growth log. The handwriting gets worse towards the end.',
    targets: [{ kind: 'unit', id: 'the_abomination' }],
    pages: [
      {
        id: 'pg_abomination_grafting_tables',
        name: 'Grafting Tables',
        motif: 'table',
        description: 'Tables of what takes and what does not, with the failures listed first.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_bone_lattice',
        name: 'Bone Lattice',
        motif: 'weave',
        description: 'A lattice drawn over a skeleton nobody can name the species of.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_feeding_rig',
        name: 'Feeding Rig',
        motif: 'hopper',
        description: 'A rig, a hopper and a schedule. The quantities go up every week.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_nerve_braid',
        name: 'Nerve Braid',
        motif: 'braid',
        description: 'Nerve runs braided into one cable, under a note saying the order matters.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_containment_straps',
        name: 'Containment Straps',
        motif: 'strap',
        description:
          'Strap widths and anchor points, revised three times, heavier at each revision.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_growth_log',
        name: 'Growth Log',
        motif: 'chart',
        description: 'A log rather than a drawing. Dates, weights, and a gap of eleven days.',
        rarity: 'rare',
      },
      {
        id: 'pg_abomination_waking_order',
        name: 'Waking Order',
        motif: 'list',
        description: 'The order to wake it in. The handwriting on this one has gone entirely.',
      },
    ],
  },
  {
    id: 'bp_the_colossus',
    name: 'Colossus Blueprint',
    motif: 'walking_hull',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Eight pages and a hull nobody in this city could cast today. You are assembling it.',
    targets: [{ kind: 'unit', id: 'the_colossus' }],
    pages: [
      {
        id: 'pg_colossus_hull_sections',
        name: 'Hull Sections',
        motif: 'section',
        description:
          'Hull stations drawn one over another, at a casting size nobody here can pour.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_leg_actuators',
        name: 'Leg Actuators',
        motif: 'piston',
        description: 'One actuator at full stroke, with the loads it sees at each end of it.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_spine_frame',
        name: 'Spine Frame',
        motif: 'frame',
        description: 'The frame everything else hangs from, drawn in one continuous line.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_reactor_housing',
        name: 'Reactor Housing',
        motif: 'core_vessel',
        description: 'The housing, its shielding, and the clearance nobody is allowed inside of.',
      },
      {
        id: 'pg_colossus_arm_assemblies',
        name: 'Arm Assemblies',
        motif: 'mirrored_pair',
        description: 'Two arms drawn as one and mirrored, with the differences called out in red.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_sighting_gear',
        name: 'Sighting Gear',
        motif: 'optics',
        description: 'Optics and their mount, on a sightline that clears the shoulder by a hand.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_armour_schedule',
        name: 'Armour Schedule',
        motif: 'table',
        description:
          'Plate by station and the weight it adds, totalled at the bottom in a shaky hand.',
        rarity: 'rare',
      },
      {
        id: 'pg_colossus_ignition_sequence',
        name: 'Ignition Sequence',
        motif: 'list',
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
    motif: 'motorcycle',
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
        motif: 'frame',
        description: 'A jig laid out on a bench, tube lengths written along each member of it.',
      },
      {
        id: 'pg_motorcycle_engine_rebuild',
        name: 'Engine Rebuild',
        motif: 'engine',
        description:
          'An engine opened across both halves of the sheet, oily thumbprint in the corner.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    // The ids keep the old machine's name (`building/vehicles.ts` says why); the words are the
    // Offie's. Pages already sitting in inventories keep counting towards the document.
    id: 'bp_dirt_runner',
    name: 'Offie Blueprint',
    motif: 'pickup',
    category: 'unit',
    rarity: 'common',
    blurb:
      'Bed plating, a bull bar and a lift kit, for a pickup that has to arrive with everybody.',
    targets: [{ kind: 'vehicle', id: 'dirt_runner' }],
    pages: [
      {
        id: 'pg_dirt_runner_knobbled_tyres',
        name: 'Bed Plating',
        motif: 'plating',
        description:
          'The bed plated over sheet by sheet, with the weld run marked as a single pass.',
      },
      {
        id: 'pg_dirt_runner_welded_frame',
        name: 'Bull Bar',
        motif: 'frame',
        description: 'A bar bent from one tube, radii called out where it goes round the lamps.',
      },
      {
        id: 'pg_dirt_runner_long_forks',
        name: 'Lift Kit',
        motif: 'spring',
        description: 'Spacer stacks and the ride height they buy, with the tyre that then fits.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_scrap_car',
    name: 'Scar Blueprint',
    motif: 'car',
    category: 'unit',
    rarity: 'common',
    blurb: 'Three donor bodies into one car, and where to cut each of them.',
    targets: [{ kind: 'vehicle', id: 'scrap_car' }],
    pages: [
      {
        id: 'pg_scrap_car_donor_panels',
        name: 'Donor Panels',
        motif: 'cut_list',
        description: 'Three cars in outline with the cut lines drawn straight across them.',
      },
      {
        id: 'pg_scrap_car_engine_mounts',
        name: 'Engine Mounts',
        motif: 'mount',
        description:
          'Mounts for an engine that was never meant to sit here, drawn in two versions.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_scrap_car_bench_seating',
        name: 'Bench Seating',
        motif: 'seat',
        description:
          'A bench across the back, with how many it seats and how many it really seats.',
      },
    ],
  },
  {
    // Ids kept, words the Cheese Wagon's: see `bp_dirt_runner` above.
    id: 'bp_armoured_car',
    name: 'Cheese Wagon Blueprint',
    motif: 'bus',
    category: 'unit',
    rarity: 'uncommon',
    blurb:
      'Hull plate, window mesh, a plough and a roof rack, for a school bus that stops for nobody.',
    targets: [{ kind: 'vehicle', id: 'armoured_car' }],
    pages: [
      {
        id: 'pg_armoured_car_sill_plating',
        name: 'Hull Plating',
        motif: 'plating',
        description: 'Plate wrapped round a bus panel by panel, with the door left as a door.',
      },
      {
        id: 'pg_armoured_car_glass_substitute',
        name: 'Window Mesh',
        motif: 'weave',
        description:
          'Mesh gauge against what still gets through it, and a sample stapled to the corner.',
      },
      {
        id: 'pg_armoured_car_runflat_hubs',
        name: 'Ram Plough',
        motif: 'plough',
        description: 'A plough on the nose, drawn with the frame behind it that makes it any use.',
        rarity: 'rare',
      },
      {
        id: 'pg_armoured_car_firing_ports',
        name: 'Roof Rack',
        motif: 'rack',
        description: 'A rack, its rails, and the load at which the roof stops being a roof.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_gas_balloon',
    name: 'Gas Balloon Blueprint',
    motif: 'balloon',
    category: 'unit',
    rarity: 'rare',
    blurb: 'Envelope panels and a page on the gas that nobody will put a source on.',
    targets: [{ kind: 'vehicle', id: 'gas_balloon' }],
    pages: [
      {
        id: 'pg_gas_balloon_envelope_panels',
        name: 'Envelope Panels',
        motif: 'pattern',
        description:
          'Gores flattened out seam by seam, at a size that runs off the edge of the sheet.',
      },
      {
        id: 'pg_gas_balloon_gas_handling',
        name: 'Gas Handling',
        motif: 'vessel',
        description: 'How to fill it. Where the gas comes from is not on this page or any other.',
      },
      {
        id: 'pg_gas_balloon_basket_weave',
        name: 'Basket Weave',
        motif: 'weave',
        description: 'A weave pattern and the load the cane takes, sketched from underneath.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_gas_balloon_ballast_sacks',
        name: 'Ballast Sacks',
        motif: 'ballast',
        description: 'Sacks, their fill and where they hang, so it comes down where you meant.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_gas_balloon_burner_head',
        name: 'Burner Head',
        motif: 'burner',
        description:
          'A burner in section, flame path shaded, clearance to the envelope inked in red.',
      },
    ],
  },
  {
    id: 'bp_rotorcraft',
    name: 'Rotorcraft Blueprint',
    motif: 'rotor_head',
    category: 'unit',
    rarity: 'exotic',
    blurb: 'Rotor geometry, in a hand that assumed the reader already knew how to fly.',
    targets: [{ kind: 'vehicle', id: 'rotorcraft' }],
    pages: [
      {
        id: 'pg_rotorcraft_rotor_geometry',
        name: 'Rotor Geometry',
        motif: 'chart',
        description: 'Blade twist and chord along the span, in a hand that assumed you could fly.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_swashplate',
        name: 'Swashplate',
        motif: 'swashplate',
        description: 'The swashplate from above and from the side, every linkage numbered.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_tail_boom',
        name: 'Tail Boom',
        motif: 'shaft',
        description: 'A boom, its drive shaft, and the bearing spacing that stops it whipping.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_gearbox_tolerances',
        name: 'Gearbox Tolerances',
        motif: 'dimension',
        description:
          'Tolerances to the hundredth, over a line saying this is the page that kills people.',
      },
      {
        id: 'pg_rotorcraft_blade_balancing',
        name: 'Blade Balancing',
        motif: 'balance',
        description:
          'A balancing rig and its weights, with what vibration is left plotted as a curve.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_fuel_governor',
        name: 'Fuel Governor',
        motif: 'governor',
        description: 'A governor drawn open, with the fuel it wants at each collective setting.',
        rarity: 'rare',
      },
      {
        id: 'pg_rotorcraft_flight_notes',
        name: 'Flight Notes',
        motif: 'prose',
        description: 'Not engineering. Four paragraphs on what it does before it is ready to fly.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_heli_porter',
    name: 'Heli Porter Blueprint',
    motif: 'helicopter',
    category: 'unit',
    rarity: 'exotic',
    blurb:
      'A factory manual, complete, with corrections pencilled in the margins where the factory was wrong.',
    targets: [{ kind: 'vehicle', id: 'heli_porter' }],
    pages: [
      {
        id: 'pg_heli_porter_main_gearbox',
        name: 'Main Gearbox',
        motif: 'gear_train',
        description: 'A factory plate of the main gearbox, with the factory corrected in pencil.',
        rarity: 'rare',
      },
      {
        id: 'pg_heli_porter_rotor_head',
        name: 'Rotor Head',
        motif: 'exploded',
        description: 'The head exploded across a double page, every shim listed by part number.',
        rarity: 'rare',
      },
      {
        id: 'pg_heli_porter_cabin_frame',
        name: 'Cabin Frame',
        motif: 'frame',
        description: 'A frame in station lines, doors and load hooks drawn in their real places.',
        rarity: 'rare',
      },
      {
        id: 'pg_heli_porter_twin_turbines',
        name: 'Twin Turbines',
        motif: 'turbine',
        description: 'Both turbines, their starts, and the one order they will start in.',
      },
      // Seven pages, up from four (maintainer, 2026-09-10): the strongest machine in the yard was the
      // quickest document to assemble, three pages fewer than the Rotorcraft it outranks. Pages
      // drop uniformly over the category, so the page count is the gate.
      {
        id: 'pg_heli_porter_tail_drive',
        name: 'Tail Drive',
        motif: 'shaft',
        description:
          'The tail drive shaft in sections, and the bearing that goes first if it goes.',
        rarity: 'rare',
      },
      {
        id: 'pg_heli_porter_hydraulics',
        name: 'Hydraulics',
        motif: 'manifold',
        description: 'Two hydraulic circuits, one drawn in red for the day the other one fails.',
        rarity: 'rare',
      },
      {
        id: 'pg_heli_porter_load_floor',
        name: 'Load Floor',
        motif: 'plan',
        description:
          'The cabin floor with its tie-downs, and thirty seats pencilled over the cargo plan.',
      },
    ],
  },

  // ------------------------------------------------- upgrade: what the Scrapyard fits to a squad
  // §D12g, second model (`units/modifications.ts`, 2026-09-15): thirty cards with no ladder, and
  // twenty-seven of them want drawings. One document per card on the `unit_upgrade` target kind.
  // The four line documents of the tiered refits (Composite Armour, Munitions, Cybernetics,
  // Discipline, thirteen pages between them) went with the refits: their targets no longer exist.
  // Page counts follow the card's rarity against the §D bands in the module doc: two for a BASIC
  // card, three for INTRICATE, four for ADVANCED, five or six for MASTERPIECE. The ids carry `mod_`
  // so a card's document can never share an id with a boost's: `bp_shaped_charges` names the
  // Shaped Charge boost, and the card that used to share its name is Breaching Charges now for
  // the same reason.
  {
    id: 'bp_mod_filed_sights',
    name: 'Filed Sights Blueprint',
    motif: 'elevation',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'Where to take metal off a front post, and how to know when to stop.',
    targets: [{ kind: 'unit_upgrade', id: 'filed_sights' }],
    pages: [
      {
        id: 'pg_mod_filed_sights_sight_picture',
        name: 'Sight Picture',
        motif: 'dimension',
        description:
          'Post and notch drawn ten times life size, with the line of the eye ruled through both.',
      },
      {
        id: 'pg_mod_filed_sights_filing_order',
        name: 'Filing Order',
        motif: 'tools',
        description:
          'Which face of the post goes first, and the needle files laid out in the order they are picked up.',
      },
    ],
  },
  {
    id: 'bp_mod_rag_wraps',
    name: 'Rag Wraps Blueprint',
    motif: 'weave',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'What to wrap, what to leave bare, and the knots that hold through a night of rain.',
    targets: [{ kind: 'unit_upgrade', id: 'rag_wraps' }],
    pages: [
      {
        id: 'pg_mod_rag_wraps_wrapping_runs',
        name: 'Wrapping Runs',
        motif: 'strap',
        description:
          'A buckle and a barrel each wound in strip, with arrows showing which way the cloth lays.',
      },
      {
        id: 'pg_mod_rag_wraps_tie_offs',
        name: 'Tie-Offs',
        motif: 'knot',
        description:
          'Three knots, drawn large, and a note that the third one is the one that comes undone.',
      },
    ],
  },
  {
    id: 'bp_mod_whistle_code',
    name: 'Whistle Code Blueprint',
    motif: 'speaker',
    category: 'upgrade',
    rarity: 'common',
    blurb:
      'Six notes, what each one means, and how to be heard over a fight without being understood by it.',
    targets: [{ kind: 'unit_upgrade', id: 'whistle_code' }],
    pages: [
      {
        id: 'pg_mod_whistle_code_six_notes',
        name: 'The Six Notes',
        motif: 'list',
        description:
          'Six notes numbered down the sheet, each with the order it stands for written beside it in capitals.',
      },
      {
        id: 'pg_mod_whistle_code_whistle_bore',
        name: 'Whistle Bore',
        motif: 'section',
        description:
          'A whistle cut through along its length, pea and window drawn in, the pitch pencilled beside it.',
      },
    ],
  },
  {
    id: 'bp_mod_hook_and_line',
    name: 'Hook and Line Blueprint',
    motif: 'knot',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'A grapple bent out of rebar, forty metres of rope, and the throws that land it.',
    targets: [{ kind: 'unit_upgrade', id: 'hook_and_line' }],
    pages: [
      {
        id: 'pg_mod_hook_and_line_grapple_bending',
        name: 'Grapple Bending',
        motif: 'dimension',
        description:
          'Four rebar tines bent round a jig and welded to a ring, with the bend radius dimensioned twice.',
      },
      {
        id: 'pg_mod_hook_and_line_throwing_lines',
        name: 'Throwing Lines',
        motif: 'line_run',
        description:
          'The arc of a throw drawn against a three-storey wall, and the slack to leave coiled at the feet.',
      },
    ],
  },
  {
    id: 'bp_mod_knuckle_guards',
    name: 'Knuckle Guards Blueprint',
    motif: 'cut_list',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'Plate over the knuckles, cut from what the yard has, shaped to a fist that is closed.',
    targets: [{ kind: 'unit_upgrade', id: 'knuckle_guards' }],
    pages: [
      {
        id: 'pg_mod_knuckle_guards_finger_templates',
        name: 'Finger Templates',
        motif: 'pattern',
        description:
          'Four finger plates drawn flat to cut, traced round a hand with the fingers already curled.',
      },
      {
        id: 'pg_mod_knuckle_guards_rivet_pattern',
        name: 'Rivet Pattern',
        motif: 'bolts',
        description:
          'The rivet pattern through the palm plate, so the guard is still where it was when the hand lands.',
      },
    ],
  },
  {
    id: 'bp_mod_ear_defenders',
    name: 'Ear Defenders Blueprint',
    motif: 'mould',
    category: 'upgrade',
    rarity: 'common',
    blurb:
      'Plugs cast to the ear that wears them, and the check that they are in before the shooting starts.',
    targets: [{ kind: 'unit_upgrade', id: 'ear_defenders' }],
    pages: [
      {
        id: 'pg_mod_ear_defenders_ear_casts',
        name: 'Ear Casts',
        motif: 'face',
        description:
          'An ear in three views with the canal shaded, and the wax pressed into it drawn alongside.',
      },
      {
        id: 'pg_mod_ear_defenders_issue_roll',
        name: 'Issue Roll',
        motif: 'table',
        description:
          'A ruled table of names against plug pairs, ticked at the door on the way out each night.',
      },
    ],
  },
  {
    id: 'bp_mod_ablative_layers',
    name: 'Ablative Layers Blueprint',
    motif: 'exploded',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Plate that leaves in pieces so the person under it does not. Replaced after every fight, by design.',
    targets: [{ kind: 'unit_upgrade', id: 'ablative_layers' }],
    pages: [
      {
        id: 'pg_mod_ablative_layers_layer_stack',
        name: 'Layer Stack',
        motif: 'laminate',
        description: 'Five layers in section, each one meant to come off before the one behind it.',
      },
      {
        id: 'pg_mod_ablative_layers_shear_pins',
        name: 'Shear Pins',
        motif: 'bolts',
        description:
          'The pin pattern holding each tile, sized to let go under a hit rather than hold through one.',
        rarity: 'rare',
      },
      {
        id: 'pg_mod_ablative_layers_replacement_count',
        name: 'Replacement Count',
        motif: 'table',
        description:
          'Tiles gone against fights fought, kept per squad, with the bill from the yard along the bottom.',
      },
    ],
  },
  {
    id: 'bp_mod_recoil_dampers',
    name: 'Recoil Dampers Blueprint',
    motif: 'spring',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Springs, a gas port and the fitting that makes the second shot land where the first one did.',
    targets: [{ kind: 'unit_upgrade', id: 'recoil_dampers' }],
    pages: [
      {
        id: 'pg_mod_recoil_dampers_spring_rates',
        name: 'Spring Rates',
        motif: 'chart',
        description:
          'Compression against load plotted for a dozen springs, with two circled and the rest crossed out.',
      },
      {
        id: 'pg_mod_recoil_dampers_gas_port_drilling',
        name: 'Gas Port Drilling',
        motif: 'bore',
        description:
          'A barrel in section with the port drilled at the angle that bleeds enough and no more.',
        rarity: 'rare',
      },
      {
        id: 'pg_mod_recoil_dampers_buffer_assembly',
        name: 'Buffer Assembly',
        motif: 'exploded',
        description:
          'Buffer, spring and guide rod pulled apart along one axis, numbered in the order they go back.',
      },
    ],
  },
  {
    id: 'bp_mod_twitch_loop',
    name: 'Twitch Loop Blueprint',
    motif: 'circuit',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'A wire from the eye to the hand with nothing in between. The thinking was the slow part.',
    targets: [{ kind: 'unit_upgrade', id: 'twitch_loop' }],
    pages: [
      {
        id: 'pg_mod_twitch_loop_shunt_placement',
        name: 'Shunt Placement',
        motif: 'implant',
        description:
          'A shunt set into the forearm, with the two nerves it bridges inked and the rest left grey.',
        rarity: 'rare',
      },
      {
        id: 'pg_mod_twitch_loop_loop_timing',
        name: 'Loop Timing',
        motif: 'chart',
        description:
          'Reaction against loop gain, plotted, with the band where the hand starts moving first shaded.',
      },
      {
        id: 'pg_mod_twitch_loop_tremor_notes',
        name: 'Tremor Notes',
        motif: 'prose',
        description:
          'Handwriting on what the hand does at rest afterwards, and how long that takes to stop.',
      },
    ],
  },
  {
    id: 'bp_mod_smoke_discipline',
    name: 'Smoke Discipline Blueprint',
    motif: 'prose',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Nothing lit, nothing cooked, nothing said on the approach. Written down so it can be read out.',
    targets: [{ kind: 'unit_upgrade', id: 'smoke_discipline' }],
    pages: [
      {
        id: 'pg_mod_smoke_discipline_approach_orders',
        name: 'Approach Orders',
        motif: 'list',
        description:
          'What stops at the last cover, numbered: the smokes, the stove, the talk, and then the walking pace.',
      },
      {
        id: 'pg_mod_smoke_discipline_wind_cards',
        name: 'Wind Cards',
        motif: 'card',
        description:
          'A ruled card of wind against how far it carries, for smell as much as smoke, one row struck out.',
      },
      {
        id: 'pg_mod_smoke_discipline_halt_plan',
        name: 'Halt Plan',
        motif: 'plan',
        description:
          'A courtyard from above with the door swing that hides a section, and the last place anybody smokes marked.',
      },
    ],
  },
  {
    id: 'bp_mod_drill_book',
    name: 'Drill Book Blueprint',
    motif: 'list',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Forty pages of standing still, read aloud every morning until nobody needs it read.',
    targets: [{ kind: 'unit_upgrade', id: 'drill_book' }],
    pages: [
      {
        id: 'pg_mod_drill_book_parade_grid',
        name: 'Parade Grid',
        motif: 'footprints',
        description:
          'Footprints on a numbered grid, every movement of the morning drill in the order it is called.',
        rarity: 'common',
      },
      {
        id: 'pg_mod_drill_book_reading_order',
        name: 'Reading Order',
        motif: 'board',
        description:
          'The forty pages ruled into a week, morning by morning, with the ones to repeat marked twice.',
      },
      {
        id: 'pg_mod_drill_book_voice_of_command',
        name: 'Voice of Command',
        motif: 'speaker',
        description:
          'How a sergeant carries across a yard: the chest as a cavity in section, and where the breath goes.',
      },
    ],
  },
  {
    id: 'bp_mod_hardened_optics',
    name: 'Hardened Optics Blueprint',
    motif: 'optics',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Sealed glass, a coating that will not fog or flare, and the housing that keeps the two aligned.',
    targets: [{ kind: 'unit_upgrade', id: 'hardened_optics' }],
    pages: [
      {
        id: 'pg_mod_hardened_optics_coating_bath',
        name: 'Coating Bath',
        motif: 'vessel',
        description:
          'A drum with a level line for the coating bath, and the dwell time written on the side of it.',
        rarity: 'rare',
      },
      {
        id: 'pg_mod_hardened_optics_seal_section',
        name: 'Seal Section',
        motif: 'section',
        description:
          'A cut through the housing showing both seals and the dry nitrogen that sits between them.',
      },
      {
        id: 'pg_mod_hardened_optics_collimation',
        name: 'Collimation',
        motif: 'dimension',
        description:
          'A dimension run down the optical axis, witness lines at each lens, tolerance in thousandths.',
      },
    ],
  },
  {
    id: 'bp_mod_counterweight_harness',
    name: 'Counterweight Harness Blueprint',
    motif: 'ballast',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Load on the hips instead of the shoulders. Twice the bag comes home at the same walking pace.',
    targets: [{ kind: 'unit_upgrade', id: 'counterweight_harness' }],
    pages: [
      {
        id: 'pg_mod_counterweight_harness_hip_frame',
        name: 'Hip Frame',
        motif: 'frame',
        description:
          'A frame that sits on the pelvis, members numbered, with the load path drawn down into the legs.',
      },
      {
        id: 'pg_mod_counterweight_harness_balance_points',
        name: 'Balance Points',
        motif: 'balance',
        description:
          'A carrier as a beam on a fulcrum, with where the bag hangs against where the weight hangs.',
      },
      {
        id: 'pg_mod_counterweight_harness_bag_lashings',
        name: 'Bag Lashings',
        motif: 'lace',
        description:
          'Lacing through an eyelet run down the bag, tightened in the order that keeps it off the spine.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_mod_bone_lattice',
    name: 'Bone Lattice Blueprint',
    motif: 'frame',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Pins and mesh through the long bones, so the frame stops being the first thing that fails.',
    targets: [{ kind: 'unit_upgrade', id: 'bone_lattice' }],
    pages: [
      {
        id: 'pg_mod_bone_lattice_pin_sites',
        name: 'Pin Sites',
        motif: 'figure',
        description:
          'A body in elevation with every pin site marked, and the femur circled as the one to do first.',
      },
      {
        id: 'pg_mod_bone_lattice_mesh_weave',
        name: 'Mesh Weave',
        motif: 'weave',
        description:
          'The mesh drawn close enough to read as a pattern, with the wire gauge in the corner.',
      },
      {
        id: 'pg_mod_bone_lattice_setting_time',
        name: 'Setting Time',
        motif: 'bed',
        description:
          'A ward bed with a chart on the end, six weeks of it, and the day the patient may stand.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_mod_trophy_rack',
    name: 'Trophy Rack Blueprint',
    motif: 'rack',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Plate, teeth and body markings off everybody they have beaten, hung where it will be seen.',
    targets: [{ kind: 'unit_upgrade', id: 'trophy_rack' }],
    pages: [
      {
        id: 'pg_mod_trophy_rack_mounting_frame',
        name: 'Mounting Frame',
        motif: 'mount',
        description:
          'A bracket on the back plate taking a trophy, with the load path drawn so it does not swing.',
      },
      {
        id: 'pg_mod_trophy_rack_markings_key',
        name: 'Markings Key',
        motif: 'card',
        description:
          'A ruled card of markings worth taking and what each is worth, one row struck out as no longer around.',
      },
      {
        id: 'pg_mod_trophy_rack_display_order',
        name: 'Display Order',
        motif: 'elevation',
        description:
          'The rack in elevation with a centre line, the biggest piece on it and the rest ranked outward.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_mod_composite_carapace',
    name: 'Composite Carapace Blueprint',
    motif: 'pattern',
    category: 'upgrade',
    rarity: 'rare',
    blurb:
      'Panels cut to one body, the layup that makes them hard, and the hinges that let it come off.',
    targets: [{ kind: 'unit_upgrade', id: 'composite_carapace' }],
    pages: [
      {
        id: 'pg_mod_composite_carapace_body_casts',
        name: 'Body Casts',
        motif: 'figure',
        description:
          'A body in elevation on a ground line, with the plaster cast lines drawn where each panel will bear.',
      },
      {
        id: 'pg_mod_composite_carapace_layup_schedule',
        name: 'Layup Schedule',
        motif: 'laminate',
        description:
          'Cloth, resin and plate in section, layer by layer, with the cure oven temperature along the top.',
        rarity: 'exotic',
      },
      {
        id: 'pg_mod_composite_carapace_hinge_lines',
        name: 'Hinge Lines',
        motif: 'door',
        description:
          'Where the shell opens, drawn as a door leaf with its swing, so a medic can get in.',
      },
      {
        id: 'pg_mod_composite_carapace_weight_budget',
        name: 'Weight Budget',
        motif: 'table',
        description:
          'A ruled table of every panel against its weight, totalled, and the total circled twice.',
      },
    ],
  },
  {
    id: 'bp_mod_ranging_gear',
    name: 'Ranging Gear Blueprint',
    motif: 'gear_train',
    category: 'upgrade',
    rarity: 'rare',
    blurb:
      'A drum, a wire and a cam cut by hand that solves the drop. Arguments about elevation end.',
    targets: [{ kind: 'unit_upgrade', id: 'ranging_gear' }],
    pages: [
      {
        id: 'pg_mod_ranging_gear_cam_profile',
        name: 'Cam Profile',
        motif: 'chart',
        description:
          'The cam drawn as the curve it follows, drop against range, with the hand cuts visible in it.',
        rarity: 'exotic',
      },
      {
        id: 'pg_mod_ranging_gear_drum_graduations',
        name: 'Drum Graduations',
        motif: 'dimension',
        description:
          'A drum unrolled flat, its graduations dimensioned from a zero mark, each one a range.',
      },
      {
        id: 'pg_mod_ranging_gear_wire_tension',
        name: 'Wire Tension',
        motif: 'spring',
        description:
          'The return spring that keeps the wire honest, with its rate and the spacer that sets it.',
      },
      {
        id: 'pg_mod_ranging_gear_zeroing_card',
        name: 'Zeroing Card',
        motif: 'card',
        description:
          'A ruled card of shots against range on the day it was zeroed, one row struck out as a flinch.',
      },
    ],
  },
  {
    id: 'bp_mod_dry_joints',
    name: 'Dry Joints Blueprint',
    motif: 'boot',
    category: 'upgrade',
    rarity: 'rare',
    blurb:
      'Graphite and rubber through every hinge and sole. Gravel underfoot stops being a warning.',
    targets: [{ kind: 'unit_upgrade', id: 'dry_joints' }],
    pages: [
      {
        id: 'pg_mod_dry_joints_graphite_packing',
        name: 'Graphite Packing',
        motif: 'section',
        description:
          'A hinge cut through, with the graphite packed into the gap and the rubber lip that keeps it there.',
      },
      {
        id: 'pg_mod_dry_joints_silent_soles',
        name: 'Silent Soles',
        motif: 'footprints',
        description:
          'Footprints on a numbered grid, the loud ones marked in red, before and after the new soles.',
      },
      {
        id: 'pg_mod_dry_joints_servo_damping',
        name: 'Servo Damping',
        motif: 'governor',
        description:
          'The speed linkage on each servo with its stops moved in, so nothing slams at the end of travel.',
        rarity: 'exotic',
      },
      {
        id: 'pg_mod_dry_joints_valve_bleed',
        name: 'Valve Bleed',
        motif: 'manifold',
        description:
          'A block with two circuits through it, one bled slow so the pressure comes up without a click.',
      },
    ],
  },
  {
    id: 'bp_mod_adrenal_regulator',
    name: 'Adrenal Regulator Blueprint',
    motif: 'governor',
    category: 'upgrade',
    rarity: 'rare',
    blurb:
      'A pump under the collarbone, the dose it meters, and what to watch for once it is done metering.',
    targets: [{ kind: 'unit_upgrade', id: 'adrenal_regulator' }],
    pages: [
      {
        id: 'pg_mod_adrenal_regulator_pump_housing',
        name: 'Pump Housing',
        motif: 'vessel',
        description:
          'The reservoir as a drum with a level line, the size of a thumb, drawn at full size beside the sheet.',
      },
      {
        id: 'pg_mod_adrenal_regulator_dose_curve',
        name: 'Dose Curve',
        motif: 'chart',
        description:
          'Dose against fear, plotted, with the band where the hands stop shaking and before they start again.',
        rarity: 'exotic',
      },
      {
        id: 'pg_mod_adrenal_regulator_valve_timing',
        name: 'Valve Timing',
        motif: 'loop',
        description:
          'The pipe loop off the reservoir and back, with the valve that opens on a pulse rate rather than an order.',
      },
      {
        id: 'pg_mod_adrenal_regulator_aftercare',
        name: 'Aftercare',
        motif: 'prose',
        description:
          'Handwriting on what the week after looks like, and the line about the bill that somebody underlined.',
      },
    ],
  },
  {
    id: 'bp_mod_breaching_charges',
    name: 'Breaching Charges Blueprint',
    motif: 'fuse',
    category: 'upgrade',
    rarity: 'rare',
    blurb:
      'Cone liners carried into a fight rather than laid the night before, and the packing that makes them cut.',
    targets: [{ kind: 'unit_upgrade', id: 'breaching_charges' }],
    pages: [
      {
        id: 'pg_mod_breaching_charges_liner_spinning',
        name: 'Liner Spinning',
        motif: 'press',
        description:
          'A press with the spinning tool under it, turning copper sheet into a cone with a wall of one thickness.',
      },
      {
        id: 'pg_mod_breaching_charges_packing_weights',
        name: 'Packing Weights',
        motif: 'balance',
        description:
          'A beam on a fulcrum with the charge in the pan, and the grain weight for each liner size beside it.',
        rarity: 'exotic',
      },
      {
        id: 'pg_mod_breaching_charges_standoff_sleeves',
        name: 'Standoff Sleeves',
        motif: 'section',
        description:
          'A charge cut through with its sleeve on, the gap that lets the jet form drawn to scale.',
      },
      {
        id: 'pg_mod_breaching_charges_handling_rules',
        name: 'Handling Rules',
        motif: 'list',
        description:
          'Numbered items down a sheet, all of them about hands, the last one about how many you have left.',
      },
    ],
  },
  {
    id: 'bp_mod_rescue_rig',
    name: 'Rescue Rig Blueprint',
    motif: 'winch',
    category: 'upgrade',
    rarity: 'rare',
    blurb:
      'Winch, sled and a harness that will hold a body. What went out comes back, and sometimes who went out.',
    targets: [{ kind: 'unit_upgrade', id: 'rescue_rig' }],
    pages: [
      {
        id: 'pg_mod_rescue_rig_winch_gearing',
        name: 'Winch Gearing',
        motif: 'gear_train',
        description:
          'Two meshed wheels with the ratio that lets one person pull two up a bank, and the pawl that holds it.',
      },
      {
        id: 'pg_mod_rescue_rig_sled_frame',
        name: 'Sled Frame',
        motif: 'frame',
        description:
          'A sled frame with its members numbered, wide enough for a stretcher and low enough to drag.',
      },
      {
        id: 'pg_mod_rescue_rig_body_harness',
        name: 'Body Harness',
        motif: 'strap',
        description:
          'A harness strap over its anchor, rated in the margin for a body and a half, in case.',
        rarity: 'exotic',
      },
      {
        id: 'pg_mod_rescue_rig_recovery_drill',
        name: 'Recovery Drill',
        motif: 'footprints',
        description:
          'Footprints on a numbered grid: who goes to the casualty, who holds the line, who works the winch.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_mod_monofilament_edge',
    name: 'Monofilament Edge Blueprint',
    motif: 'line_run',
    category: 'upgrade',
    rarity: 'rare',
    blurb:
      'An edge one molecule wide, and the handle that keeps it away from the hand that holds it.',
    targets: [{ kind: 'unit_upgrade', id: 'monofilament_edge' }],
    pages: [
      {
        id: 'pg_mod_monofilament_edge_filament_draw',
        name: 'Filament Draw',
        motif: 'press',
        description:
          'A press with the drawing die under it, pulling the filament down through eleven passes.',
        rarity: 'exotic',
      },
      {
        id: 'pg_mod_monofilament_edge_handle_keep',
        name: 'Handle Keep',
        motif: 'mount',
        description:
          'A bracket receiving the filament, with the load path drawn so the edge never turns toward the wrist.',
      },
      {
        id: 'pg_mod_monofilament_edge_edge_testing',
        name: 'Edge Testing',
        motif: 'table',
        description:
          'A ruled table of what it went through and how far, plate at the bottom, with a note about the bench.',
      },
      {
        id: 'pg_mod_monofilament_edge_injury_log',
        name: 'Injury Log',
        motif: 'prose',
        description:
          'Handwriting, no drawing, on every cut in the workshop, and the rule about holding it twice.',
      },
    ],
  },
  {
    id: 'bp_mod_hardshell_exoframe',
    name: 'Hardshell Exoframe Blueprint',
    motif: 'piston',
    category: 'upgrade',
    rarity: 'exotic',
    blurb:
      'A powered shell with its own cooling and its own opinion about doorways. Three streets hear it coming.',
    targets: [{ kind: 'unit_upgrade', id: 'hardshell_exoframe' }],
    pages: [
      {
        id: 'pg_mod_hardshell_exoframe_frame_members',
        name: 'Frame Members',
        motif: 'frame',
        description:
          'The frame with every member numbered, sized round a body, and the doorway width written beside it.',
      },
      {
        id: 'pg_mod_hardshell_exoframe_actuator_manifold',
        name: 'Actuator Manifold',
        motif: 'manifold',
        description:
          'A block with two circuits through it, one for each leg, and the cross-feed that keeps them level.',
      },
      {
        id: 'pg_mod_hardshell_exoframe_cooling_loop',
        name: 'Cooling Loop',
        motif: 'loop',
        description:
          'The coolant loop off its tank and round the back plate, with where it ices in the cold marked.',
      },
      {
        id: 'pg_mod_hardshell_exoframe_power_plant',
        name: 'Power Plant',
        motif: 'engine',
        description:
          'The engine opened across the sheet, small enough to carry and loud enough to hear three streets off.',
      },
      {
        id: 'pg_mod_hardshell_exoframe_shell_plating',
        name: 'Shell Plating',
        motif: 'plating',
        description:
          'A plate with rivets round its edge, one of forty, with the order they go on drawn in the corner.',
        rarity: 'rare',
      },
      {
        id: 'pg_mod_hardshell_exoframe_egress_drill',
        name: 'Egress Drill',
        motif: 'list',
        description:
          'Numbered items down a sheet for getting out of it in under a minute, the last one about the latch.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_mod_synaptic_lace',
    name: 'Synaptic Lace Blueprint',
    motif: 'lace',
    category: 'upgrade',
    rarity: 'exotic',
    blurb:
      'Six weeks of growing a net through a brain, and what to do about the parts of the person it displaces.',
    targets: [{ kind: 'unit_upgrade', id: 'synaptic_lace' }],
    pages: [
      {
        id: 'pg_mod_synaptic_lace_lace_pattern',
        name: 'Lace Pattern',
        motif: 'net',
        description:
          'A net drawn with its fringe, the pattern the filament grows along, fine enough to read as grey.',
      },
      {
        id: 'pg_mod_synaptic_lace_growth_schedule',
        name: 'Growth Schedule',
        motif: 'board',
        description:
          'Six weeks ruled into columns, each with what should be working by then and what will not be yet.',
      },
      {
        id: 'pg_mod_synaptic_lace_cortex_map',
        name: 'Cortex Map',
        motif: 'circuit',
        description:
          'A trace running between two pads, drawn on a brain, with the regions it crosses named and shaded.',
      },
      {
        id: 'pg_mod_synaptic_lace_induction_coil',
        name: 'Induction Coil',
        motif: 'coil',
        description:
          'Windings on a former the width of a finger, the coil that keeps the lace from cooking what it sits in.',
      },
      {
        id: 'pg_mod_synaptic_lace_what_comes_back',
        name: 'What Comes Back',
        motif: 'prose',
        description:
          'Handwriting, no drawing, listing what came back after six weeks and what did not, in two columns.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_mod_guided_rounds',
    name: 'Guided Rounds Blueprint',
    motif: 'cartridge',
    category: 'upgrade',
    rarity: 'exotic',
    blurb:
      'A round that turns in the last half second, the fins that turn it, and what each one costs to make.',
    targets: [{ kind: 'unit_upgrade', id: 'guided_rounds' }],
    pages: [
      {
        id: 'pg_mod_guided_rounds_fin_deployment',
        name: 'Fin Deployment',
        motif: 'exploded',
        description:
          'The round pulled apart along its axis: body, fins folded, fins out, and the pin that lets them go.',
      },
      {
        id: 'pg_mod_guided_rounds_seeker_head',
        name: 'Seeker Head',
        motif: 'optics',
        description:
          'A lens stack in its housing the width of a thumbnail, looking down the bore before the round leaves it.',
      },
      {
        id: 'pg_mod_guided_rounds_steering_coil',
        name: 'Steering Coil',
        motif: 'coil',
        description:
          'Windings on a former inside the round, and the current that pushes the fins one way or the other.',
      },
      {
        id: 'pg_mod_guided_rounds_trajectory_tables',
        name: 'Trajectory Tables',
        motif: 'table',
        description:
          'A ruled table of how far a round will steer at each range, with the row for point blank left empty.',
      },
      {
        id: 'pg_mod_guided_rounds_per_shot_cost',
        name: 'Per-Shot Cost',
        motif: 'card',
        description:
          'A ruled card of every part in one round against its caps value, totalled, one row struck out as unaffordable.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_mod_ghost_protocol',
    name: 'Ghost Protocol Blueprint',
    motif: 'hood',
    category: 'upgrade',
    rarity: 'exotic',
    blurb:
      'Heat, sound and signal, each killed by a different hand, so that afterwards nobody can prove you were there.',
    targets: [{ kind: 'unit_upgrade', id: 'ghost_protocol' }],
    pages: [
      {
        id: 'pg_mod_ghost_protocol_heat_shroud',
        name: 'Heat Shroud',
        motif: 'flue',
        description:
          'A flue with one bend, in section, drawing body heat down and out at the boot rather than off the head.',
      },
      {
        id: 'pg_mod_ghost_protocol_footfall_damping',
        name: 'Footfall Damping',
        motif: 'footprints',
        description:
          'Footprints on a numbered grid with the sound of each in the margin, before and after the padding.',
      },
      {
        id: 'pg_mod_ghost_protocol_signal_blackout',
        name: 'Signal Blackout',
        motif: 'mast',
        description:
          'A mast on its guys, drawn crossed out, and the note about what a handset still says when it is off.',
      },
      {
        id: 'pg_mod_ghost_protocol_lens_baffles',
        name: 'Lens Baffles',
        motif: 'optics',
        description:
          'A lens stack in its housing with the baffles that stop a scope glinting back at whoever is looking for one.',
      },
      {
        id: 'pg_mod_ghost_protocol_approach_timing',
        name: 'Approach Timing',
        motif: 'chart',
        description:
          'The curve of a patrol against the hour, plotted, with the gap a section walks through shaded in.',
      },
      {
        id: 'pg_mod_ghost_protocol_combine_practice',
        name: 'Combine Practice',
        motif: 'prose',
        description:
          'Handwriting in a hand that was trained for it, on how this was done before, and who is still alive to ask.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_mod_colours_of_the_line',
    name: 'Colours of the Line Blueprint',
    motif: 'mast',
    category: 'upgrade',
    rarity: 'exotic',
    blurb:
      'A standard, the pole it hangs from, and who carries it. A line that can see it does not break.',
    targets: [{ kind: 'unit_upgrade', id: 'colours_of_the_line' }],
    pages: [
      {
        id: 'pg_mod_colours_of_the_line_standard_panel',
        name: 'Standard Panel',
        motif: 'pattern',
        description:
          'The standard flattened out to cut, in two colours, with the device drawn once and traced for the other side.',
      },
      {
        id: 'pg_mod_colours_of_the_line_pole_ferrule',
        name: 'Pole Ferrule',
        motif: 'mount',
        description:
          'A bracket on the bearer harness receiving the pole, with the load path drawn against a wind.',
      },
      {
        id: 'pg_mod_colours_of_the_line_bearer_roll',
        name: 'Bearer Roll',
        motif: 'list',
        description:
          'Numbered items down a sheet, names, every bearer the line has had and how each one stopped.',
        rarity: 'rare',
      },
      {
        id: 'pg_mod_colours_of_the_line_battle_honours',
        name: 'Battle Honours',
        motif: 'board',
        description:
          'A project ruled into columns, one for each fight the standard was carried in, and the ones it was not.',
      },
      {
        id: 'pg_mod_colours_of_the_line_rally_signals',
        name: 'Rally Signals',
        motif: 'speaker',
        description:
          'The horn cavity in section, and the two calls it makes: one for stand, one for come back to the colours.',
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
    motif: 'switchboard',
    category: 'upgrade',
    rarity: 'rare',
    blurb: 'Cable runs and cipher racks. Everything the district knows goes through this room.',
    targets: [{ kind: 'building', id: 'nexus' }],
    pages: [
      {
        id: 'pg_nexus_cable_runs',
        name: 'Cable Runs',
        motif: 'cable_run',
        description:
          'Every run in the building on one sheet, coloured by circuit, the colours faded.',
      },
      {
        id: 'pg_nexus_cipher_racks',
        name: 'Cipher Racks',
        motif: 'rack',
        description: 'Rack elevations and the cooling they want, with the door drawn locked.',
      },
      {
        id: 'pg_nexus_floor_plan',
        name: 'Floor Plan',
        motif: 'plan',
        description: 'The room from above, with the one wall marked that must not be moved.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_nexus_aerial_mast',
        name: 'Aerial Mast',
        motif: 'mast',
        description: 'A mast, its guys, and the height it has to reach to be worth putting up.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_quarters_retrofit',
    name: 'Quarters Retrofit Blueprint',
    motif: 'hut',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'Bunk framing and a flue that draws. People sleep or they do not.',
    targets: [{ kind: 'building', id: 'quarters' }],
    pages: [
      {
        id: 'pg_quarters_bunk_framing',
        name: 'Bunk Framing',
        motif: 'bunk',
        description: 'Three high, timber sizes given, and how much room is left to sit up in.',
      },
      {
        id: 'pg_quarters_stove_flue',
        name: 'Stove Flue',
        motif: 'flue',
        description: 'A flue that draws, in section, with the one bend it will tolerate.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_greenhouse_retrofit',
    name: 'Greenhouse Retrofit Blueprint',
    motif: 'greenhouse',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'Glazing bars and an irrigation loop that does not need anybody standing over it.',
    targets: [{ kind: 'building', id: 'greenhouse' }],
    pages: [
      {
        id: 'pg_greenhouse_glazing_bars',
        name: 'Glazing Bars',
        motif: 'section',
        description:
          'Bar sections and the panes they take, allowing for glass that is never square.',
      },
      {
        id: 'pg_greenhouse_irrigation_loop',
        name: 'Irrigation Loop',
        motif: 'loop',
        description: 'A loop off a header tank, so nobody has to stand there with a watering can.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_generator_retrofit',
    name: 'Generator Retrofit Blueprint',
    motif: 'generator_set',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Winding diagrams and a governor linkage, for the machine everything else is plugged into.',
    targets: [{ kind: 'building', id: 'generator' }],
    pages: [
      {
        id: 'pg_generator_winding_diagram',
        name: 'Winding Diagram',
        motif: 'coil',
        description: 'Windings counted out turn by turn, with the wire gauge noted in the corner.',
        rarity: 'rare',
      },
      {
        id: 'pg_generator_governor_linkage',
        name: 'Governor Linkage',
        motif: 'governor',
        description: 'The linkage that holds the speed, in three positions, with the stops set.',
      },
      {
        id: 'pg_generator_exhaust_scrubber',
        name: 'Exhaust Scrubber',
        motif: 'column',
        description: 'A scrubber, its packing, and how often somebody has to go and change it.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_scrapyard_retrofit',
    name: 'Scrapyard Retrofit Blueprint',
    motif: 'scrap_heap',
    category: 'upgrade',
    rarity: 'common',
    blurb: 'A sorting line and press tooling. The yard stops being a heap and becomes a shop.',
    targets: [{ kind: 'building', id: 'scrapyard' }],
    pages: [
      {
        id: 'pg_scrapyard_sorting_line',
        name: 'Sorting Line',
        motif: 'belt',
        description: 'The line drawn as a row of hands, with what each pair takes off the belt.',
      },
      {
        id: 'pg_scrapyard_press_tooling',
        name: 'Press Tooling',
        motif: 'press',
        description: 'Tooling for the press in hardened steel, drawn with the tonnage it needs.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_scrapyard_crane_gantry',
        name: 'Crane Gantry',
        motif: 'crane',
        description: 'A gantry across the yard, and the footings that stop it walking under load.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_apothecary_retrofit',
    name: 'Apothecary Retrofit Blueprint',
    motif: 'retort',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'A still column and dosage tables somebody died working out.',
    targets: [{ kind: 'building', id: 'apothecary' }],
    pages: [
      {
        id: 'pg_apothecary_still_column',
        name: 'Still Column',
        motif: 'column',
        description: 'A column in section, plate by plate, with which cut to take and when.',
        rarity: 'rare',
      },
      {
        id: 'pg_apothecary_dosage_tables',
        name: 'Dosage Tables',
        motif: 'table',
        description: 'Doses by body weight, worked out the hard way, with the names left off.',
      },
      {
        id: 'pg_apothecary_cold_store',
        name: 'Cold Store',
        motif: 'plan',
        description: 'An insulated room and its ice budget, for the things that will not keep.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_gate_retrofit',
    name: 'Gate Retrofit Blueprint',
    motif: 'gate',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Counterweights and bar sockets. It has to shut faster than anybody can run.',
    targets: [{ kind: 'building', id: 'gate' }],
    pages: [
      {
        id: 'pg_gate_counterweights',
        name: 'Counterweights',
        motif: 'ballast',
        description: 'Weights against the leaf, so it shuts faster than anybody outside can run.',
      },
      {
        id: 'pg_gate_murder_holes',
        name: 'Murder Holes',
        motif: 'plan',
        description:
          'Holes in the soffit, spaced to cover the whole gateway and nothing beyond it.',
        rarity: 'rare',
      },
      {
        id: 'pg_gate_bar_sockets',
        name: 'Bar Sockets',
        motif: 'mount',
        description: 'Sockets sunk into the jamb, and the depth that makes them worth having.',
      },
    ],
  },
  {
    id: 'bp_lab_retrofit',
    name: 'Lab Retrofit Blueprint',
    motif: 'microscope',
    category: 'upgrade',
    rarity: 'rare',
    blurb: 'Bench layout, an extraction hood and a room clean enough to be worth the trouble.',
    targets: [{ kind: 'building', id: 'lab' }],
    pages: [
      {
        id: 'pg_lab_bench_layout',
        name: 'Bench Layout',
        motif: 'plan',
        description: 'Benches, services and walking room, in that order of importance.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_lab_extraction_hood',
        name: 'Extraction Hood',
        motif: 'hood',
        description:
          'A hood, its duct, and the face velocity that makes it a hood and not a shelf.',
      },
      {
        id: 'pg_lab_reference_shelf',
        name: 'Reference Shelf',
        motif: 'rack',
        description: 'Shelving, and a list of what should be on it that is mostly not.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_lab_clean_room',
        name: 'Clean Room',
        motif: 'door',
        description:
          'A room clean enough to be worth the trouble, and the airlock that makes it one.',
      },
    ],
  },
  {
    id: 'bp_gauntlet_retrofit',
    name: 'Gauntlet Retrofit Blueprint',
    motif: 'hurdles',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb:
      'Obstacle frames, drainage under the sand, and a board everyone can read their score off.',
    targets: [{ kind: 'building', id: 'gauntlet' }],
    pages: [
      {
        id: 'pg_gauntlet_obstacle_frames',
        name: 'Obstacle Frames',
        motif: 'frame',
        description: 'Frames at their real heights, with the landing marked on the far side.',
      },
      {
        id: 'pg_gauntlet_pit_drainage',
        name: 'Sand Pit Drainage',
        motif: 'section',
        description: 'What goes under the sand, which is the only reason the pit works in the wet.',
      },
      {
        id: 'pg_gauntlet_scoring_board',
        name: 'Scoring Board',
        motif: 'board',
        description: 'A board readable from the rail, with the letter heights that prove it.',
        rarity: 'common',
      },
      {
        id: 'pg_gauntlet_armoury_racks',
        name: 'Armoury Racks',
        motif: 'rack',
        description: 'Racks by weapon length, with the lock on the door and who holds the key.',
        rarity: 'rare',
      },
    ],
  },
  {
    id: 'bp_infirmary_retrofit',
    name: 'Infirmary Retrofit Blueprint',
    motif: 'bed',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Ward layout and a sterile line people actually keep to.',
    targets: [{ kind: 'building', id: 'infirmary' }],
    pages: [
      {
        id: 'pg_infirmary_ward_layout',
        name: 'Ward Layout',
        motif: 'plan',
        description: 'Beds, spacing, and the door width a loaded stretcher actually needs.',
      },
      {
        id: 'pg_infirmary_sterile_line',
        name: 'Sterile Line',
        motif: 'list',
        description:
          'A line on the floor and the rules for crossing it, which people keep to or do not.',
        rarity: 'rare',
      },
      {
        id: 'pg_infirmary_triage_board',
        name: 'Triage Board',
        motif: 'board',
        description: 'A board, four columns, and the order the columns are worked through in.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_garage_retrofit',
    name: 'Garage Retrofit Blueprint',
    motif: 'hoist',
    category: 'upgrade',
    rarity: 'uncommon',
    blurb: 'Pit layout, hoist ratings and a parts wall with everything where it should be.',
    targets: [{ kind: 'building', id: 'garage' }],
    pages: [
      {
        id: 'pg_garage_pit_layout',
        name: 'Pit Layout',
        motif: 'section',
        description:
          'A pit with steps at both ends, drawn by somebody who has been trapped in one.',
      },
      {
        id: 'pg_garage_hoist_rating',
        name: 'Hoist Rating',
        motif: 'table',
        description: 'Ratings against what the district actually drives, two of them crossed out.',
        rarity: 'rare',
      },
      {
        id: 'pg_garage_fuel_bay',
        name: 'Fuel Bay',
        motif: 'vessel',
        description: 'A bay, a bund, and the distance to the nearest thing that makes a spark.',
      },
      {
        id: 'pg_garage_parts_wall',
        name: 'Parts Wall',
        motif: 'tools',
        description: 'A wall of shadows, every tool outlined, so a missing one is obvious.',
        rarity: 'common',
      },
    ],
  },

  // ------------------------------------------------------ consumable: made for one night (§D12e)
  {
    id: 'bp_overnight_plating',
    name: 'Overnight Plating Blueprint',
    motif: 'plating',
    category: 'consumable',
    rarity: 'common',
    blurb: 'A cut list and a weld sequence, for the night before rather than the month before.',
    targets: [{ kind: 'battle_boost', id: 'boost_plated_overnight' }],
    pages: [
      {
        id: 'pg_overnight_plating_cut_list',
        name: 'Cut List',
        motif: 'cut_list',
        description: 'Sizes and quantities for one night, and nothing at all about where it goes.',
      },
      {
        id: 'pg_overnight_plating_weld_sequence',
        name: 'Weld Sequence',
        motif: 'list',
        description: 'The order to run the welds in, so it is still straight in the morning.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_shaped_charges',
    name: 'Shaped Charge Blueprint',
    motif: 'charge',
    category: 'consumable',
    rarity: 'uncommon',
    blurb: 'Cone geometry and a standoff table. Cut for this wall, this week.',
    targets: [{ kind: 'battle_boost', id: 'boost_shaped_for_this' }],
    pages: [
      {
        id: 'pg_shaped_charges_cone_geometry',
        name: 'Cone Geometry',
        motif: 'chart',
        description: 'Cone angles against standoff, plotted, with the useful band shaded in.',
        rarity: 'rare',
      },
      {
        id: 'pg_shaped_charges_standoff_table',
        name: 'Standoff Table',
        motif: 'table',
        description: 'Distances in a table, cut for this wall and this week and nothing else.',
      },
      {
        id: 'pg_shaped_charges_tamping_notes',
        name: 'Tamping Notes',
        motif: 'section',
        description: 'What to pack behind it, and what happens when there is nothing behind it.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_approach_plans',
    name: 'Approach Plans Blueprint',
    motif: 'frontage',
    category: 'consumable',
    rarity: 'common',
    blurb: 'Somebody surveyed the doors and wrote down which way the specialists go in.',
    targets: [{ kind: 'battle_boost', id: 'boost_the_right_doors' }],
    pages: [
      {
        id: 'pg_approach_plans_door_survey',
        name: 'Door Survey',
        motif: 'door',
        description: 'Every door on the frontage, measured, with which way each of them opens.',
      },
      {
        id: 'pg_approach_plans_timing_sheet',
        name: 'Timing Sheet',
        motif: 'table',
        description: 'Times down the left, rooms across the top, filled in for one night only.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_refined_accelerant',
    name: 'Refined Accelerant Blueprint',
    motif: 'can',
    category: 'consumable',
    rarity: 'rare',
    blurb: 'Fuel nobody should be able to make, and four pages on how not to be standing near it.',
    targets: [{ kind: 'battle_boost', id: 'boost_the_colossus_walks' }],
    pages: [
      {
        id: 'pg_refined_accelerant_cracking_column',
        name: 'Cracking Column',
        motif: 'column',
        description: 'A column nobody should be able to build, drawn as though anybody could.',
      },
      {
        id: 'pg_refined_accelerant_additive_mix',
        name: 'Additive Mix',
        motif: 'table',
        description: 'Proportions to three places, with a line under the one not to exceed.',
      },
      {
        id: 'pg_refined_accelerant_handling_rules',
        name: 'Handling Rules',
        motif: 'list',
        description: 'Four rules, lettered large, and none of them about the fuel itself.',
        rarity: 'uncommon',
      },
      {
        id: 'pg_refined_accelerant_burn_rate',
        name: 'Burn Rate Chart',
        motif: 'chart',
        description: 'Burn rate against temperature, with the runaway drawn as a dotted line.',
      },
    ],
  },

  /*
   * The six traps (§I4).
   *
   * A trap is a consumable in the same sense a shaped charge is: cut for one night, gone by
   * morning. Their page counts run 2 or 3 against the §D3 bands, except the frontage collapse at
   * 4, and they are written in the order the Head of Security's track opens them: the cheap ones
   * are a thing a district reaches early and the last two are a fortnight of collecting.
   */
  {
    id: 'bp_pressure_plates',
    name: 'Pressure Plate Blueprint',
    motif: 'pressure_plate',
    category: 'consumable',
    rarity: 'common',
    blurb: 'Which boards to lift, what to put under them, and how much weight sets it off.',
    targets: [{ kind: 'trap', id: 'trap_pressure_plates' }],
    pages: [
      {
        id: 'pg_pressure_plates_board_spans',
        name: 'Board Spans',
        motif: 'dimension',
        description: 'Which boards to lift, how far they span, and how far they can be trusted.',
      },
      {
        id: 'pg_pressure_plates_trigger_weights',
        name: 'Trigger Weights',
        motif: 'balance',
        description:
          'Weights against what sets it off, found with a sack of scrap and a stopwatch.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_buried_shell',
    name: 'Buried Shell Blueprint',
    motif: 'buried_shell',
    category: 'consumable',
    rarity: 'uncommon',
    blurb: 'How to move a cracked chemical round, how deep to put it, and where the wire runs.',
    targets: [{ kind: 'trap', id: 'trap_gas_shell' }],
    pages: [
      {
        id: 'pg_buried_shell_round_handling',
        name: 'Round Handling',
        motif: 'shell',
        description: 'How to carry a cracked round, in six drawings, none of them reassuring.',
        rarity: 'rare',
      },
      {
        id: 'pg_buried_shell_burial_depth',
        name: 'Burial Depth',
        motif: 'section',
        description: 'Depth against what comes back up, with the soil types listed down the side.',
      },
      {
        id: 'pg_buried_shell_trip_wiring',
        name: 'Trip Wiring',
        motif: 'line_run',
        description: 'Wire runs, anchor points, and the slack that keeps it quiet in the rain.',
        rarity: 'common',
      },
    ],
  },
  {
    id: 'bp_prepared_collapse',
    name: 'Prepared Collapse Blueprint',
    motif: 'collapse',
    category: 'consumable',
    rarity: 'rare',
    blurb: 'A survey of what is holding the frontage up, and the order in which to stop it.',
    targets: [{ kind: 'trap', id: 'trap_collapse' }],
    pages: [
      {
        id: 'pg_prepared_collapse_load_path',
        name: 'Load Path Survey',
        motif: 'elevation',
        description: 'What holds the frontage up, traced back to the ground, floor by floor.',
      },
      {
        id: 'pg_prepared_collapse_cut_sequence',
        name: 'Cut Sequence',
        motif: 'list',
        description: 'The order in which to stop it holding, numbered, with the last cut circled.',
      },
      {
        id: 'pg_prepared_collapse_holding_charge',
        name: 'Holding Charge',
        motif: 'charge',
        description: 'One charge, where it sits, and the moment it becomes the only thing holding.',
      },
      {
        id: 'pg_prepared_collapse_fall_line',
        name: 'Fall Line',
        motif: 'plan',
        description: 'Where it lands, drawn on a street plan, with a house inside the arc.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_razor_wire',
    name: 'Razor Wire Blueprint',
    motif: 'braid',
    category: 'consumable',
    rarity: 'common',
    blurb: 'How to draw tape off a reel without losing a hand, and where to peg it down.',
    targets: [{ kind: 'trap', id: 'trap_razor_wire' }],
    pages: [
      {
        id: 'pg_razor_wire_tape_drawing',
        name: 'Tape Drawing',
        motif: 'press',
        description: 'Rollers and a die that turn flat strip into something nobody climbs over.',
      },
      {
        id: 'pg_razor_wire_picket_lines',
        name: 'Picket Lines',
        motif: 'line_run',
        description: 'Peg spacings for a belt of it, with the gap a runner is meant to find.',
        rarity: 'uncommon',
      },
    ],
  },
  {
    id: 'bp_fuel_fougasse',
    name: 'Fuel Fougasse Blueprint',
    motif: 'vessel',
    category: 'consumable',
    rarity: 'uncommon',
    blurb: 'A drum on its side in a pit, the angle it is dug at, and the charge behind it.',
    targets: [{ kind: 'trap', id: 'trap_fuel_fougasse' }],
    pages: [
      {
        id: 'pg_fuel_fougasse_pit_angles',
        name: 'Pit Angles',
        motif: 'dimension',
        description:
          'The slope a drum is laid on and how wide the spread comes out at forty paces.',
      },
      {
        id: 'pg_fuel_fougasse_thickened_mix',
        name: 'Thickened Mix',
        motif: 'mortar_pestle',
        description: 'Oil, rubber crumb and soap flake, worked until it stops running off a wall.',
        rarity: 'rare',
      },
      {
        id: 'pg_fuel_fougasse_scatter_charge',
        name: 'Scatter Charge',
        motif: 'charge',
        description: 'A small charge behind the drum, sized to throw it rather than open it.',
      },
    ],
  },
  {
    id: 'bp_flooded_cellar',
    name: 'Flooded Cellar Blueprint',
    motif: 'cable_run',
    category: 'consumable',
    rarity: 'rare',
    blurb: 'Which cellar to fill, where the water goes when it is let go, and what is in it.',
    targets: [{ kind: 'trap', id: 'trap_flooded_cellar' }],
    pages: [
      {
        id: 'pg_flooded_cellar_sluice_gates',
        name: 'Sluice Gates',
        motif: 'door',
        description: 'Plate gates in the culvert, held on a pin somebody upstairs can pull.',
      },
      {
        id: 'pg_flooded_cellar_standing_water',
        name: 'Standing Water',
        motif: 'section',
        description:
          'A cut through the basement showing how deep it goes and how fast it gets there.',
        rarity: 'exotic',
      },
      {
        id: 'pg_flooded_cellar_bus_bars',
        name: 'Bus Bars',
        motif: 'circuit',
        description:
          'Bars dropped in at the far wall, and the note about which way the current runs.',
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
