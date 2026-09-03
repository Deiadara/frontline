import { z } from 'zod';
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
 * It names its targets by id as plain strings and imports nothing from the rest of the domain.
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
}

export interface BlueprintSpec {
  id: string;
  /** "Colossus Blueprint". The name a player says out loud. */
  name: string;
  category: BlueprintCategory;
  /** One line: what having it lets you do. */
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
    blurb: 'A long barrel, a cold room to zero it in, and the tables to read wind off.',
    targets: [{ kind: 'unit', id: 'snipers' }],
    pages: [
      { id: 'pg_snipers_barrel_liners', name: 'Barrel Liners' },
      { id: 'pg_snipers_range_cards', name: 'Range Cards' },
      { id: 'pg_snipers_ghillie_patterns', name: 'Ghillie Patterns' },
    ],
  },
  {
    id: 'bp_demolishers',
    name: 'Demolisher Blueprint',
    category: 'unit',
    blurb: 'Where to put the charge so the wall falls the way you wanted it to.',
    targets: [{ kind: 'unit', id: 'demolishers' }],
    pages: [
      { id: 'pg_demolishers_charge_moulds', name: 'Charge Moulds' },
      { id: 'pg_demolishers_fuse_timings', name: 'Fuse Timings' },
      { id: 'pg_demolishers_breaching_frames', name: 'Breaching Frames' },
    ],
  },
  {
    id: 'bp_kite_crews',
    name: 'Kite Crew Blueprint',
    category: 'unit',
    blurb: 'Spars, sail and a winch. Somebody goes up and everybody else finds out what is coming.',
    targets: [{ kind: 'unit', id: 'kite_crews' }],
    pages: [
      { id: 'pg_kite_crews_spar_frames', name: 'Spar Frames' },
      { id: 'pg_kite_crews_sail_cutting', name: 'Sail Cutting' },
      { id: 'pg_kite_crews_winch_gearing', name: 'Winch Gearing' },
      { id: 'pg_kite_crews_launch_rails', name: 'Launch Rails' },
    ],
  },
  {
    id: 'bp_cyberhounds',
    name: 'Cyberhound Blueprint',
    category: 'unit',
    blurb: 'Four legs, a rebuilt jaw and a nose that was never a nose.',
    targets: [{ kind: 'unit', id: 'cyber_dogs' }],
    pages: [
      { id: 'pg_cyberhounds_limb_actuators', name: 'Limb Actuators' },
      { id: 'pg_cyberhounds_scent_board', name: 'Scent Board' },
      { id: 'pg_cyberhounds_jaw_servos', name: 'Jaw Servos' },
      { id: 'pg_cyberhounds_kennel_wiring', name: 'Kennel Wiring' },
    ],
  },
  {
    id: 'bp_the_twins',
    name: 'Twins Blueprint',
    category: 'unit',
    blurb: 'Two rigs cut from one drawing. Neither of them works on its own.',
    targets: [{ kind: 'unit', id: 'the_twins' }],
    pages: [
      { id: 'pg_the_twins_paired_harness', name: 'Paired Harness' },
      { id: 'pg_the_twins_mirror_sights', name: 'Mirror Sights' },
      { id: 'pg_the_twins_split_loader', name: 'Split Loader' },
      { id: 'pg_the_twins_matched_frames', name: 'Matched Frames' },
      { id: 'pg_the_twins_signal_cord', name: 'Signal Cord' },
    ],
  },
  {
    id: 'bp_ironsides',
    name: 'Ironside Blueprint',
    category: 'unit',
    blurb: 'Plate cut to a schedule somebody worked out under fire, and never changed since.',
    targets: [{ kind: 'unit', id: 'ironsides' }],
    pages: [
      { id: 'pg_ironsides_plate_schedule', name: 'Plate Schedule' },
      { id: 'pg_ironsides_shoulder_anchors', name: 'Shoulder Anchors' },
      { id: 'pg_ironsides_visor_slits', name: 'Visor Slits' },
      { id: 'pg_ironsides_boot_weights', name: 'Boot Weights' },
    ],
  },
  {
    id: 'bp_juggernauts',
    name: 'Juggernaut Blueprint',
    category: 'unit',
    blurb: 'An exoframe with a person somewhere inside it, and a cooling loop that has to hold.',
    targets: [{ kind: 'unit', id: 'juggernauts' }],
    pages: [
      { id: 'pg_juggernauts_exoframe_legs', name: 'Exoframe Legs' },
      { id: 'pg_juggernauts_power_spine', name: 'Power Spine' },
      { id: 'pg_juggernauts_slab_armour', name: 'Slab Armour' },
      { id: 'pg_juggernauts_coolant_loop', name: 'Coolant Loop' },
      { id: 'pg_juggernauts_gun_mount', name: 'Hand Cannon Mount' },
    ],
  },
  {
    id: 'bp_hollow_men',
    name: 'Hollow Man Blueprint',
    category: 'unit',
    blurb: 'A shell that walks, weighted at the ankles so it does not fall over when it is shot.',
    targets: [{ kind: 'unit', id: 'hollow_men' }],
    pages: [
      { id: 'pg_hollow_men_empty_shell', name: 'Empty Shell' },
      { id: 'pg_hollow_men_gait_governor', name: 'Gait Governor' },
      { id: 'pg_hollow_men_voice_box', name: 'Voice Box' },
      { id: 'pg_hollow_men_ballast_core', name: 'Ballast Core' },
      { id: 'pg_hollow_men_standing_order', name: 'Standing Order' },
    ],
  },

  // ------------------------------------------------------------------- unit: the uniques (§D12d)
  {
    id: 'bp_the_specter',
    name: 'Specter Blueprint',
    category: 'unit',
    blurb: 'Six pages on not being seen, and the last one is mostly about the cold.',
    targets: [{ kind: 'unit', id: 'the_specter' }],
    pages: [
      { id: 'pg_the_specter_shroud_weave', name: 'Shroud Weave' },
      { id: 'pg_the_specter_silent_boots', name: 'Silent Boots' },
      { id: 'pg_the_specter_cold_optics', name: 'Cold Optics' },
      { id: 'pg_the_specter_ghost_wiring', name: 'Ghost Wiring' },
      { id: 'pg_the_specter_scent_null', name: 'Scent Null' },
      { id: 'pg_the_specter_last_page', name: 'The Last Page' },
    ],
  },
  {
    id: 'bp_the_crimson_dancer',
    name: 'Crimson Dancer Blueprint',
    category: 'unit',
    blurb: 'Edge geometry and footwork, written by somebody who thought of it as choreography.',
    targets: [{ kind: 'unit', id: 'the_crimson_dancer' }],
    pages: [
      { id: 'pg_crimson_dancer_edge_geometry', name: 'Edge Geometry' },
      { id: 'pg_crimson_dancer_balance_rig', name: 'Balance Rig' },
      { id: 'pg_crimson_dancer_red_lacquer', name: 'Red Lacquer' },
      { id: 'pg_crimson_dancer_footwork_chart', name: 'Footwork Chart' },
      { id: 'pg_crimson_dancer_pulse_lace', name: 'Pulse Lace' },
      { id: 'pg_crimson_dancer_curtain_call', name: 'Curtain Call' },
    ],
  },
  {
    id: 'bp_the_loose_end',
    name: 'Loose End Blueprint',
    category: 'unit',
    blurb: 'Seven pages, none of them signed, and one of them is a list of ways to burn the rest.',
    targets: [{ kind: 'unit', id: 'the_loose_end' }],
    pages: [
      { id: 'pg_loose_end_frayed_schematic', name: 'Frayed Schematic' },
      { id: 'pg_loose_end_dead_drop_keys', name: 'Dead Drop Keys' },
      { id: 'pg_loose_end_untraceable_frame', name: 'Untraceable Frame' },
      { id: 'pg_loose_end_burn_sequence', name: 'Burn Sequence' },
      { id: 'pg_loose_end_spare_face', name: 'Spare Face' },
      { id: 'pg_loose_end_cutout_ledger', name: 'Cutout Ledger' },
      { id: 'pg_loose_end_final_knot', name: 'Final Knot' },
    ],
  },
  {
    id: 'bp_the_abomination',
    name: 'Abomination Blueprint',
    category: 'unit',
    blurb: 'Grafting tables and a growth log. The handwriting gets worse towards the end.',
    targets: [{ kind: 'unit', id: 'the_abomination' }],
    pages: [
      { id: 'pg_abomination_grafting_tables', name: 'Grafting Tables' },
      { id: 'pg_abomination_bone_lattice', name: 'Bone Lattice' },
      { id: 'pg_abomination_feeding_rig', name: 'Feeding Rig' },
      { id: 'pg_abomination_nerve_braid', name: 'Nerve Braid' },
      { id: 'pg_abomination_containment_straps', name: 'Containment Straps' },
      { id: 'pg_abomination_growth_log', name: 'Growth Log' },
      { id: 'pg_abomination_waking_order', name: 'Waking Order' },
    ],
  },
  {
    id: 'bp_the_colossus',
    name: 'Colossus Blueprint',
    category: 'unit',
    blurb: 'Eight pages and a hull nobody in this city could cast today. You are assembling it.',
    targets: [{ kind: 'unit', id: 'the_colossus' }],
    pages: [
      { id: 'pg_colossus_hull_sections', name: 'Hull Sections' },
      { id: 'pg_colossus_leg_actuators', name: 'Leg Actuators' },
      { id: 'pg_colossus_spine_frame', name: 'Spine Frame' },
      { id: 'pg_colossus_reactor_housing', name: 'Reactor Housing' },
      { id: 'pg_colossus_arm_assemblies', name: 'Arm Assemblies' },
      { id: 'pg_colossus_sighting_gear', name: 'Sighting Gear' },
      { id: 'pg_colossus_armour_schedule', name: 'Armour Schedule' },
      { id: 'pg_colossus_ignition_sequence', name: 'Ignition Sequence' },
    ],
  },

  // -------------------------------------------------------------- unit: what the Garage builds
  // §D12c: every machine, including the scrap motorcycle, which §D12b also hands to Road Reavers.
  {
    id: 'bp_motorcycle',
    name: 'Motorbike Blueprint',
    category: 'unit',
    blurb: 'A frame jig and a rebuilt engine. Also the only thing a Road Reaver ever needed.',
    targets: [
      { kind: 'vehicle', id: 'motorcycle' },
      { kind: 'unit', id: 'road_reavers' },
    ],
    pages: [
      { id: 'pg_motorcycle_frame_jig', name: 'Frame Jig' },
      { id: 'pg_motorcycle_engine_rebuild', name: 'Engine Rebuild' },
    ],
  },
  {
    id: 'bp_dirt_runner',
    name: 'Dirt Runner Blueprint',
    category: 'unit',
    blurb: 'Long forks and knobbled rubber, for where the road stopped being a road.',
    targets: [{ kind: 'vehicle', id: 'dirt_runner' }],
    pages: [
      { id: 'pg_dirt_runner_knobbled_tyres', name: 'Knobbled Tyres' },
      { id: 'pg_dirt_runner_welded_frame', name: 'Welded Frame' },
      { id: 'pg_dirt_runner_long_forks', name: 'Long Travel Forks' },
    ],
  },
  {
    id: 'bp_scrap_car',
    name: 'Scar Blueprint',
    category: 'unit',
    blurb: 'Three donor bodies into one car, and where to cut each of them.',
    targets: [{ kind: 'vehicle', id: 'scrap_car' }],
    pages: [
      { id: 'pg_scrap_car_donor_panels', name: 'Donor Panels' },
      { id: 'pg_scrap_car_engine_mounts', name: 'Engine Mounts' },
      { id: 'pg_scrap_car_bench_seating', name: 'Bench Seating' },
    ],
  },
  {
    id: 'bp_flatbed',
    name: 'Flatbed Blueprint',
    category: 'unit',
    blurb: 'A deck, a rail and enough axle under it to carry twenty people sitting down.',
    targets: [{ kind: 'vehicle', id: 'flatbed' }],
    pages: [
      { id: 'pg_flatbed_deck_timbers', name: 'Deck Timbers' },
      { id: 'pg_flatbed_rail_brackets', name: 'Rail Brackets' },
      { id: 'pg_flatbed_axle_pairing', name: 'Axle Pairing' },
      { id: 'pg_flatbed_tarpaulin_cut', name: 'Tarpaulin Cut' },
    ],
  },
  {
    id: 'bp_armoured_car',
    name: 'Armoured Car Blueprint',
    category: 'unit',
    blurb: 'Plated to the sills, with ports to shoot back out of.',
    targets: [{ kind: 'vehicle', id: 'armoured_car' }],
    pages: [
      { id: 'pg_armoured_car_sill_plating', name: 'Sill Plating' },
      { id: 'pg_armoured_car_glass_substitute', name: 'Glass Substitute' },
      { id: 'pg_armoured_car_runflat_hubs', name: 'Run Flat Hubs' },
      { id: 'pg_armoured_car_firing_ports', name: 'Firing Ports' },
    ],
  },
  {
    id: 'bp_gas_balloon',
    name: 'Gas Balloon Blueprint',
    category: 'unit',
    blurb: 'Envelope panels and a page on the gas that nobody will put a source on.',
    targets: [{ kind: 'vehicle', id: 'gas_balloon' }],
    pages: [
      { id: 'pg_gas_balloon_envelope_panels', name: 'Envelope Panels' },
      { id: 'pg_gas_balloon_gas_handling', name: 'Gas Handling' },
      { id: 'pg_gas_balloon_basket_weave', name: 'Basket Weave' },
      { id: 'pg_gas_balloon_ballast_sacks', name: 'Ballast Sacks' },
      { id: 'pg_gas_balloon_burner_head', name: 'Burner Head' },
    ],
  },
  {
    id: 'bp_war_hauler',
    name: 'War Hauler Blueprint',
    category: 'unit',
    blurb: 'Six axles, an armoured cab and a ramp. The whole crew in one thing, at once.',
    targets: [{ kind: 'vehicle', id: 'war_hauler' }],
    pages: [
      { id: 'pg_war_hauler_chassis_rails', name: 'Chassis Rails' },
      { id: 'pg_war_hauler_axle_layout', name: 'Six Axle Layout' },
      { id: 'pg_war_hauler_cab_armour', name: 'Cab Armour' },
      { id: 'pg_war_hauler_transmission_notes', name: 'Transmission Notes' },
      { id: 'pg_war_hauler_fuel_bladders', name: 'Fuel Bladders' },
      { id: 'pg_war_hauler_loading_ramp', name: 'Loading Ramp' },
    ],
  },
  {
    id: 'bp_rotorcraft',
    name: 'Rotorcraft Blueprint',
    category: 'unit',
    blurb: 'Rotor geometry, in a hand that assumed the reader already knew how to fly.',
    targets: [{ kind: 'vehicle', id: 'rotorcraft' }],
    pages: [
      { id: 'pg_rotorcraft_rotor_geometry', name: 'Rotor Geometry' },
      { id: 'pg_rotorcraft_swashplate', name: 'Swashplate' },
      { id: 'pg_rotorcraft_tail_boom', name: 'Tail Boom' },
      { id: 'pg_rotorcraft_gearbox_tolerances', name: 'Gearbox Tolerances' },
      { id: 'pg_rotorcraft_blade_balancing', name: 'Blade Balancing' },
      { id: 'pg_rotorcraft_fuel_governor', name: 'Fuel Governor' },
      { id: 'pg_rotorcraft_flight_notes', name: 'Flight Notes' },
    ],
  },

  // --------------------------------------------------------- upgrade: what the workshop fits
  // §D12g. The gate is unchanged in shape: tier one of a line is open to anybody and the two above
  // it want the line's document. What changed is that the document is now four pages, not one item.
  {
    id: 'bp_composite_armour',
    name: 'Composite Armour Blueprint',
    category: 'upgrade',
    blurb: 'Lamination schedules for plate that is mostly air.',
    targets: [
      { kind: 'unit_upgrade', id: 'armour_2' },
      { kind: 'unit_upgrade', id: 'armour_3' },
    ],
    pages: [
      { id: 'pg_composite_armour_lamination', name: 'Lamination Schedule' },
      { id: 'pg_composite_armour_backing_weave', name: 'Backing Weave' },
      { id: 'pg_composite_armour_edge_binding', name: 'Edge Binding' },
    ],
  },
  {
    id: 'bp_munitions',
    name: 'Munitions Blueprint',
    category: 'upgrade',
    blurb: 'Load tables. The margins argue with the tables.',
    targets: [
      { kind: 'unit_upgrade', id: 'weapons_2' },
      { kind: 'unit_upgrade', id: 'weapons_3' },
    ],
    pages: [
      { id: 'pg_munitions_load_tables', name: 'Load Tables' },
      { id: 'pg_munitions_primer_mixes', name: 'Primer Mixes' },
      { id: 'pg_munitions_barrel_wear', name: 'Barrel Wear Charts' },
    ],
  },
  {
    id: 'bp_cybernetics',
    name: 'Cybernetics Blueprint',
    category: 'upgrade',
    blurb: 'Surgical plates and a wiring diagram, annotated by somebody who stopped writing.',
    targets: [
      { kind: 'unit_upgrade', id: 'cybernetics_2' },
      { kind: 'unit_upgrade', id: 'cybernetics_3' },
    ],
    pages: [
      { id: 'pg_cybernetics_socket_templates', name: 'Socket Templates' },
      { id: 'pg_cybernetics_nerve_mapping', name: 'Nerve Mapping' },
      { id: 'pg_cybernetics_anaesthetic_notes', name: 'Anaesthetic Notes' },
      { id: 'pg_cybernetics_rejection_ward', name: 'Rejection Ward' },
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
    blurb: 'Cable runs and cipher racks. Everything the district knows goes through this room.',
    targets: [{ kind: 'building', id: 'nexus' }],
    pages: [
      { id: 'pg_nexus_cable_runs', name: 'Cable Runs' },
      { id: 'pg_nexus_cipher_racks', name: 'Cipher Racks' },
      { id: 'pg_nexus_floor_plan', name: 'Floor Plan' },
      { id: 'pg_nexus_aerial_mast', name: 'Aerial Mast' },
    ],
  },
  {
    id: 'bp_quarters_retrofit',
    name: 'Quarters Retrofit Blueprint',
    category: 'upgrade',
    blurb: 'Bunk framing and a flue that draws. People sleep or they do not.',
    targets: [{ kind: 'building', id: 'quarters' }],
    pages: [
      { id: 'pg_quarters_bunk_framing', name: 'Bunk Framing' },
      { id: 'pg_quarters_stove_flue', name: 'Stove Flue' },
    ],
  },
  {
    id: 'bp_greenhouse_retrofit',
    name: 'Greenhouse Retrofit Blueprint',
    category: 'upgrade',
    blurb: 'Glazing bars and an irrigation loop that does not need anybody standing over it.',
    targets: [{ kind: 'building', id: 'greenhouse' }],
    pages: [
      { id: 'pg_greenhouse_glazing_bars', name: 'Glazing Bars' },
      { id: 'pg_greenhouse_irrigation_loop', name: 'Irrigation Loop' },
    ],
  },
  {
    id: 'bp_generator_retrofit',
    name: 'Generator Retrofit Blueprint',
    category: 'upgrade',
    blurb:
      'Winding diagrams and a governor linkage, for the machine everything else is plugged into.',
    targets: [{ kind: 'building', id: 'generator' }],
    pages: [
      { id: 'pg_generator_winding_diagram', name: 'Winding Diagram' },
      { id: 'pg_generator_governor_linkage', name: 'Governor Linkage' },
      { id: 'pg_generator_exhaust_scrubber', name: 'Exhaust Scrubber' },
    ],
  },
  {
    id: 'bp_scrapyard_retrofit',
    name: 'Scrapyard Retrofit Blueprint',
    category: 'upgrade',
    blurb: 'A sorting line and press tooling. The yard stops being a heap and becomes a shop.',
    targets: [{ kind: 'building', id: 'scrapyard' }],
    pages: [
      { id: 'pg_scrapyard_sorting_line', name: 'Sorting Line' },
      { id: 'pg_scrapyard_press_tooling', name: 'Press Tooling' },
      { id: 'pg_scrapyard_crane_gantry', name: 'Crane Gantry' },
    ],
  },
  {
    id: 'bp_apothecary_retrofit',
    name: 'Apothecary Retrofit Blueprint',
    category: 'upgrade',
    blurb: 'A still column and dosage tables somebody died working out.',
    targets: [{ kind: 'building', id: 'apothecary' }],
    pages: [
      { id: 'pg_apothecary_still_column', name: 'Still Column' },
      { id: 'pg_apothecary_dosage_tables', name: 'Dosage Tables' },
      { id: 'pg_apothecary_cold_store', name: 'Cold Store' },
    ],
  },
  {
    id: 'bp_gate_retrofit',
    name: 'Gate Retrofit Blueprint',
    category: 'upgrade',
    blurb: 'Counterweights and bar sockets. It has to shut faster than anybody can run.',
    targets: [{ kind: 'building', id: 'gate' }],
    pages: [
      { id: 'pg_gate_counterweights', name: 'Counterweights' },
      { id: 'pg_gate_murder_holes', name: 'Murder Holes' },
      { id: 'pg_gate_bar_sockets', name: 'Bar Sockets' },
    ],
  },
  {
    id: 'bp_lab_retrofit',
    name: 'Lab Retrofit Blueprint',
    category: 'upgrade',
    blurb: 'Bench layout, an extraction hood and a room clean enough to be worth the trouble.',
    targets: [{ kind: 'building', id: 'lab' }],
    pages: [
      { id: 'pg_lab_bench_layout', name: 'Bench Layout' },
      { id: 'pg_lab_extraction_hood', name: 'Extraction Hood' },
      { id: 'pg_lab_reference_shelf', name: 'Reference Shelf' },
      { id: 'pg_lab_clean_room', name: 'Clean Room' },
    ],
  },
  {
    id: 'bp_gauntlet_retrofit',
    name: 'Gauntlet Retrofit Blueprint',
    category: 'upgrade',
    blurb:
      'Obstacle frames, drainage under the sand, and a board everyone can read their score off.',
    targets: [{ kind: 'building', id: 'gauntlet' }],
    pages: [
      { id: 'pg_gauntlet_obstacle_frames', name: 'Obstacle Frames' },
      { id: 'pg_gauntlet_pit_drainage', name: 'Sand Pit Drainage' },
      { id: 'pg_gauntlet_scoring_board', name: 'Scoring Board' },
      { id: 'pg_gauntlet_armoury_racks', name: 'Armoury Racks' },
    ],
  },
  {
    id: 'bp_infirmary_retrofit',
    name: 'Infirmary Retrofit Blueprint',
    category: 'upgrade',
    blurb: 'Ward layout and a sterile line people actually keep to.',
    targets: [{ kind: 'building', id: 'infirmary' }],
    pages: [
      { id: 'pg_infirmary_ward_layout', name: 'Ward Layout' },
      { id: 'pg_infirmary_sterile_line', name: 'Sterile Line' },
      { id: 'pg_infirmary_triage_board', name: 'Triage Board' },
    ],
  },
  {
    id: 'bp_garage_retrofit',
    name: 'Garage Retrofit Blueprint',
    category: 'upgrade',
    blurb: 'Pit layout, hoist ratings and a parts wall with everything where it should be.',
    targets: [{ kind: 'building', id: 'garage' }],
    pages: [
      { id: 'pg_garage_pit_layout', name: 'Pit Layout' },
      { id: 'pg_garage_hoist_rating', name: 'Hoist Rating' },
      { id: 'pg_garage_fuel_bay', name: 'Fuel Bay' },
      { id: 'pg_garage_parts_wall', name: 'Parts Wall' },
    ],
  },

  // ------------------------------------------------------ consumable: made for one night (§D12e)
  {
    id: 'bp_overnight_plating',
    name: 'Overnight Plating Blueprint',
    category: 'consumable',
    blurb: 'A cut list and a weld sequence, for the night before rather than the month before.',
    targets: [{ kind: 'battle_boost', id: 'boost_plated_overnight' }],
    pages: [
      { id: 'pg_overnight_plating_cut_list', name: 'Cut List' },
      { id: 'pg_overnight_plating_weld_sequence', name: 'Weld Sequence' },
    ],
  },
  {
    id: 'bp_shaped_charges',
    name: 'Shaped Charge Blueprint',
    category: 'consumable',
    blurb: 'Cone geometry and a standoff table. Cut for this wall, this week.',
    targets: [{ kind: 'battle_boost', id: 'boost_shaped_for_this' }],
    pages: [
      { id: 'pg_shaped_charges_cone_geometry', name: 'Cone Geometry' },
      { id: 'pg_shaped_charges_standoff_table', name: 'Standoff Table' },
      { id: 'pg_shaped_charges_tamping_notes', name: 'Tamping Notes' },
    ],
  },
  {
    id: 'bp_approach_plans',
    name: 'Approach Plans Blueprint',
    category: 'consumable',
    blurb: 'Somebody surveyed the doors and wrote down which way the specialists go in.',
    targets: [{ kind: 'battle_boost', id: 'boost_the_right_doors' }],
    pages: [
      { id: 'pg_approach_plans_door_survey', name: 'Door Survey' },
      { id: 'pg_approach_plans_timing_sheet', name: 'Timing Sheet' },
    ],
  },
  {
    id: 'bp_refined_accelerant',
    name: 'Refined Accelerant Blueprint',
    category: 'consumable',
    blurb: 'Fuel nobody should be able to make, and four pages on how not to be standing near it.',
    targets: [{ kind: 'battle_boost', id: 'boost_the_colossus_walks' }],
    pages: [
      { id: 'pg_refined_accelerant_cracking_column', name: 'Cracking Column' },
      { id: 'pg_refined_accelerant_additive_mix', name: 'Additive Mix' },
      { id: 'pg_refined_accelerant_handling_rules', name: 'Handling Rules' },
      { id: 'pg_refined_accelerant_burn_rate', name: 'Burn Rate Chart' },
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
  }
}
