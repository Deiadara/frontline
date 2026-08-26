import { z } from 'zod';
import { ATTRIBUTE_GROUPS, type AttributeGroup } from '../attributes.js';
import { RESOURCE_KEYS, type PartialResources, type ResourceKey } from '../resources.js';
import { envLabel, type EnvLabel, type EnvLabelId } from './labels.js';

/**
 * The things inside a district that are worth taking (GDD §A4).
 *
 * A district is not a single objective. It is a handful of **locations**: a gas station, a
 * graveyard, a planetarium, somebody's lair: each held by exactly one party, each takeable on its
 * own, and each worth something for as long as you keep it. Take every location in a district and
 * the district is yours, which pays again.
 *
 * ## This is the build
 *
 * There is no tech tree here and there is not meant to be one. What a crew *is*: fast, rich,
 * feared, well-read, able to field an Abomination: is the set of locations it holds, and the map
 * is the character sheet. That is the board-game shape the design is after: you do not research
 * cheaper trades, you take the Downtown Market off whoever has it, and you keep it or you do not.
 *
 * Three consequences run through everything below.
 *
 *   * **Every location does exactly one thing, and says so.** A location whose reward cannot be
 *     stated in a sentence is a location a player cannot plan around.
 *   * **Levels are the investment, and capture is the risk.** A location is captured at level 1
 *     and can be worked up to {@link MAX_LOCATION_LEVEL} for resources, and the day somebody
 *     takes it off you it goes back to 1 for them. Nobody inherits your work.
 *   * **Ground is not neutral.** Every kind carries environment labels (`labels.ts`) that decide
 *     which units are worth bringing, so taking a smuggler's tunnel is a different problem from
 *     taking a rail yard whatever the two are worth.
 *
 * Everything here is hard-authored. Nothing about the city is generated: the point of a map is
 * that players learn it, and you cannot learn a map that is different every time.
 */

export const LOCATION_KINDS = [
  // --- industry and supply ---
  'scrap_press',
  'chemical_plant',
  'power_station',
  'water_works',
  'foundry',
  'gas_station',
  'nuclear_plant',
  'soup_kitchen',
  'refugee_camp',
  // --- money and trade ---
  'market',
  'downtown_market',
  'pawn_shop',
  'bone_market',
  'revolutionist_statue',
  // --- ground and defence ---
  'high_ground',
  'barricade',
  'watchtower',
  'sewer_junction',
  'smugglers_tunnel',
  // --- war ---
  'armory',
  'war_machine_graveyard',
  'construction_site',
  'fight_pit',
  'gym',
  'doghouse',
  'rail_yard',
  'tram_depot',
  // --- knowledge and signal ---
  'university',
  'planetarium',
  'satellite_uplink',
  'broadcast_tower',
  'broadcast_station',
  'pirate_radio',
  // --- flesh ---
  'gene_clinic',
  'hospital',
  'black_clinic',
  'mad_scientist_lair',
  // --- people ---
  'tavern',
  'cinema',
  'arcade',
  'skate_ground',
  'chapel',
  'graveyard',
] as const;
export const LocationKindSchema = z.enum(LOCATION_KINDS);
export type LocationKind = z.infer<typeof LocationKindSchema>;

/**
 * What holding a location is worth.
 *
 * A closed union, and every member is read by something: the same rule the building catalogue
 * lives by. A bonus that cannot be spelled as one of these does not get written, because a number
 * on a screen that never moves is worse than no number.
 *
 * Note what is *not* here: unit unlocks. A location that gates a unit does so through the unit's
 * own requirement list (`{ kind: 'location', locationKind }`), so the gate is authored once, on the
 * thing it gates. `unitsUnlockedByLocation` reads it back for display.
 */
export type HoldBonus =
  | { kind: 'resource'; resource: ResourceKey; perHour: number }
  | { kind: 'power_supply'; amount: number }
  | { kind: 'defense_percent'; percent: number }
  | { kind: 'research_speed'; percent: number }
  | { kind: 'build_speed'; percent: number }
  | { kind: 'training_speed'; percent: number }
  | { kind: 'training_cost'; percent: number }
  | { kind: 'unit_offense'; percent: number }
  | { kind: 'unit_vitality'; percent: number }
  | { kind: 'unit_morale'; flat: number }
  | { kind: 'unit_speed'; percent: number }
  | { kind: 'unit_stealth'; percent: number }
  | { kind: 'loot_capacity'; percent: number }
  | { kind: 'intimidation'; flat: number }
  | { kind: 'travel_speed'; percent: number }
  /** Reveals this many of the nearest districts without having to walk into them. */
  | { kind: 'vision'; districts: number }
  /** A percentage more infamy off everything that earns any (§D8). */
  | { kind: 'infamy_gain'; percent: number }
  /** One resource goes further than it should: the same barrel does more work. */
  | { kind: 'resource_yield'; resource: ResourceKey; percent: number }
  /** Every crew that is out comes home sooner (§E). */
  | { kind: 'mission_speed'; percent: number }
  /** Off every price the traders quote. */
  | { kind: 'market_discount'; percent: number }
  /** Off what the black market charges in infamy. */
  | { kind: 'black_market_discount'; percent: number }
  /** Off what the workshop charges to refit a unit. */
  | { kind: 'refit_discount'; percent: number }
  /** Off what the garage charges to build and upgrade vehicles. */
  | { kind: 'vehicle_parts'; percent: number }
  /** Extra §F2 training sessions a day, on top of what the crew is entitled to. */
  | { kind: 'training_sessions'; flat: number }
  /** Syringes a crew can hand out before a fight. One is one unit brought back to strength. */
  | { kind: 'battle_stims'; flat: number }
  /** A share of what dies comes back as caps rather than as nothing. */
  | { kind: 'salvage_refund'; percent: number }
  /** What a scout brings home, and what the city tells you without being asked. */
  | { kind: 'intel'; percent: number }
  /** Flat points on every officer's attributes in one group, training the crew cannot buy. */
  | { kind: 'officer_group'; group: AttributeGroup; flat: number }
  /**
   * §A1: beds, on top of the flat {@link POPULATION_PER_LOCATION} every held location gives.
   *
   * For the handful of locations that are somewhere people actually live or eat. A camp at the
   * green belt fence houses hundreds; a Cinema houses nobody, however much they like it there.
   */
  | { kind: 'population'; flat: number };

/**
 * How far a location can be worked up, and what each level is worth.
 *
 * Captured at 1 and upgraded three times, which is the shape the board asked for: a location is a
 * post on a board, and the interesting question about a post is whether it is worth pouring
 * anything into when somebody could take it tomorrow. `LEVEL_SCALE` is what the pouring buys:
 * level 4 is two and a half times level 1, so a fully worked Gas Station beats two fresh ones and
 * losing it hurts accordingly.
 */
export const MAX_LOCATION_LEVEL = 4;

export const LEVEL_SCALE: readonly number[] = [1, 1.5, 2, 2.5];

/** What the first, second and third upgrade cost, as multiples of the kind's own base price. */
export const UPGRADE_COST_SCALE: readonly number[] = [1, 2.2, 4.5];

export interface LocationSpec {
  label: string;
  /** One line for the map tooltip: what the location *is*. */
  blurb: string;
  /** What holding it buys, in the player's words. Derived text would read like a spreadsheet. */
  reward: string;
  /**
   * Everything holding it is worth, at level 1. A list rather than a single bonus, because half
   * the interesting locations do two things: a Gas Station is oil *and* the scrap off the forecourt,
   * and folding that into one channel would make them all read the same.
   */
  bonuses: readonly HoldBonus[];
  /**
   * How hard it is to take, on the same 1..10 scale district difficulty uses. Multiplied by the
   * holder's own strength and by any fortification when the skirmish is resolved.
   */
  baseDefense: number;
  /** What the ground is like, before the sky gets a say (`labels.ts`). */
  labels: readonly EnvLabel[];
  /** What the first upgrade costs. The second and third scale by {@link UPGRADE_COST_SCALE}. */
  upgradeCost: PartialResources;
  /**
   * What each upgrade actually *is*, in three short lines: one for level 2, 3 and 4.
   *
   * Authored rather than generated, and it is the difference between a build order and a place:
   * "+50% oil" is a number going up, and "you get the underground tanks pumping again" is a thing
   * that happened to a petrol station you own.
   */
  upgrades: readonly [string, string, string];
  /** A one-off infamy payment the moment it changes hands. Almost nothing has one. */
  captureInfamy?: number;
}

/** Terser than repeating `envLabel` forty times below. */
const L = (id: EnvLabelId, tier: number): EnvLabel => envLabel(id, tier);

export const LOCATION_CATALOG: Record<LocationKind, LocationSpec> = {
  // ------------------------------------------------------------ industry and supply
  scrap_press: {
    label: 'Scrap Press',
    blurb: 'Baling presses and a sorting floor that has not stopped since before the war.',
    reward: 'Scrap, steadily, for as long as you hold it.',
    bonuses: [
      { kind: 'resource', resource: 'scrap', perHour: 24 },
      // §D5b: a press takes wrecks apart, and a wreck is not all metal. Mirrors the Scrapyard
      // building, which yields both for the same reason.
      { kind: 'resource', resource: 'planks', perHour: 18 },
    ],
    baseDefense: 2,
    labels: [L('noisy', 3), L('crammed', 2)],
    upgradeCost: { caps: 320, scrap: 180, planks: 90 },
    upgrades: [
      'The second baler comes back online and the sorting floor stops backing up.',
      'A magnetic separator over the belt, so nobody is picking metal out by hand.',
      'Night shift. The presses run until somebody stops them, and nobody does.',
    ],
  },
  chemical_plant: {
    label: 'Chemical Plant',
    blurb: 'Cracking towers and a tank farm. Everything downwind of it tastes of it.',
    reward: 'Oil, cracked on site.',
    bonuses: [{ kind: 'resource', resource: 'oil', perHour: 14 }],
    baseDefense: 4,
    labels: [L('toxic', 3), L('crammed', 2), L('noisy', 2)],
    upgradeCost: { caps: 420, scrap: 140, highQualityMetal: 10, planks: 70 },
    upgrades: [
      'The third cracking tower is repacked and lit.',
      'Feedstock lines rerouted off the ruined header. Nothing is being flared off any more.',
      'Catalyst recovery, so the expensive part of the process stops leaving in the smoke.',
    ],
  },
  power_station: {
    label: 'Power Station',
    blurb: 'A substation off the old grid, still fed by something nobody has switched off.',
    reward: 'Power for your own district, without burning a drop of oil for it.',
    bonuses: [{ kind: 'power_supply', amount: 40 }],
    baseDefense: 5,
    labels: [L('noisy', 2), L('crammed', 1)],
    upgradeCost: { caps: 500, scrap: 200, highQualityMetal: 15, planks: 80 },
    upgrades: [
      'The dead transformer bank is rewound and brought back under load.',
      'Switchgear replaced, so a fault stops taking the whole yard down with it.',
      'A second feeder tapped off the trunk. Twice the supply and half the outages.',
    ],
  },
  water_works: {
    label: 'Water Works',
    blurb: 'Intake screens, settling beds and a pumphouse under a corrugated roof.',
    reward: 'Food, because clean water is most of what growing it takes.',
    bonuses: [{ kind: 'resource', resource: 'food', perHour: 26 }],
    baseDefense: 3,
    labels: [L('wet', 2), L('crammed', 1), L('noisy', 1)],
    upgradeCost: { caps: 300, scrap: 150, planks: 90 },
    upgrades: [
      'Better plumbing: the leaking main under the yard is dug up and replaced.',
      'The settling beds are dredged and the intake screens stop clogging weekly.',
      'A chlorination house at the outfall. Nothing that leaves here makes anybody ill.',
    ],
  },
  foundry: {
    label: 'Foundry',
    blurb: 'Two cupola furnaces and a pour floor, running whenever there is fuel for it.',
    reward: 'High-quality metal. Nothing else in the city makes it in quantity.',
    bonuses: [{ kind: 'resource', resource: 'highQualityMetal', perHour: 3 }],
    baseDefense: 4,
    labels: [L('hot', 2), L('noisy', 3), L('crammed', 2)],
    upgradeCost: { caps: 600, scrap: 260, oil: 120, planks: 100 },
    upgrades: [
      'The second cupola is relined and lit for the first time in a decade.',
      'A proper sand plant, so a bad mould stops costing a whole pour.',
      'Induction holding furnace. The metal comes out the same every single time.',
    ],
  },
  gas_station: {
    label: 'Gas Station',
    blurb:
      'Four pumps under a sagging canopy, a shop with nothing in it, and tanks underneath that turned out to be mostly full.',
    reward:
      'Oil out of the ground, and the scrap off everything anybody abandoned on the forecourt.',
    bonuses: [
      { kind: 'resource', resource: 'oil', perHour: 18 },
      { kind: 'resource', resource: 'scrap', perHour: 8 },
    ],
    baseDefense: 2,
    labels: [L('open', 2), L('toxic', 1)],
    upgradeCost: { caps: 260, scrap: 120, planks: 70 },
    upgrades: [
      'The underground tanks are pumped out properly instead of siphoned by hand.',
      'A filtration rig in the back bay, so what comes up is worth selling.',
      'The forecourt is fenced, lit and manned. Nothing walks off it any more.',
    ],
  },
  nuclear_plant: {
    label: 'Abandoned Nuclear Plant',
    blurb:
      'Two cooling towers, a turbine hall with the roof half off, and a reactor building nobody has opened on purpose.',
    reward:
      'High-quality metal out of the turbine hall, and enough power on tap that every barrel of oil you burn goes further.',
    bonuses: [
      { kind: 'resource', resource: 'highQualityMetal', perHour: 5 },
      { kind: 'resource_yield', resource: 'oil', percent: 12 },
    ],
    baseDefense: 7,
    labels: [L('toxic', 4), L('dark', 3), L('crammed', 2), L('eerie', 2)],
    upgradeCost: { caps: 900, scrap: 300, highQualityMetal: 40, planks: 110 },
    upgrades: [
      'The turbine hall is shored and lit, so the salvage crews stop working blind.',
      'One coolant loop is brought back under control. The building stops getting worse.',
      'A working shift room behind shielding. People can be in there for a whole day.',
    ],
  },
  soup_kitchen: {
    label: 'Soup Kitchen',
    blurb: 'Trestle tables, a queue that starts before dawn, and two women who never sit down.',
    reward: 'Food off the ration line, and a crew that has eaten fights like one.',
    bonuses: [
      { kind: 'resource', resource: 'food', perHour: 14 },
      { kind: 'unit_morale', flat: 6 },
      { kind: 'population', flat: 15 },
    ],
    baseDefense: 1,
    labels: [L('crammed', 3), L('noisy', 2)],
    upgradeCost: { caps: 200, food: 120, planks: 90 },
    upgrades: [
      'A second serving line, so the queue clears before the food does.',
      'Cold store out the back. Nothing is thrown away at the end of a day any more.',
      'Bread ovens. People come here who did not have to, which is worth more than the bread.',
    ],
  },

  refugee_camp: {
    label: 'Fence Camp',
    blurb:
      'Two thousand people along the green belt fence, in whatever they could carry, because the food is on the other side of it.',
    reward:
      'More people than any building in your district could house, and every one of them looking for a reason to be useful.',
    bonuses: [
      { kind: 'population', flat: 50 },
      { kind: 'resource', resource: 'caps', perHour: 6 },
    ],
    baseDefense: 1,
    labels: [L('crammed', 3), L('open', 2), L('noisy', 2), L('cold', 1)],
    upgradeCost: { caps: 240, food: 200, planks: 220 },
    upgrades: [
      'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
      'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
      'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
    ],
  },

  // ------------------------------------------------------------ money and trade
  market: {
    label: 'Market',
    blurb: 'Awnings, arguments, and a hundred people moving goods nobody has papers for.',
    reward: 'A cut of everything that changes hands.',
    bonuses: [{ kind: 'resource', resource: 'caps', perHour: 30 }],
    baseDefense: 3,
    labels: [L('crammed', 2), L('noisy', 3)],
    upgradeCost: { caps: 380, planks: 180 },
    upgrades: [
      'The pitches are numbered and rented instead of fought over.',
      'A covered row along the north side, so the market keeps trading in the rain.',
      'Your own weigh house at the gate. Nothing crosses it uncounted.',
    ],
  },
  downtown_market: {
    label: 'Downtown Market',
    blurb:
      'The old exchange floor, still trading, with the board on the wall repainted every morning by somebody who knows.',
    reward: 'Every trade in the city is quoted to you at a better number than to anybody else.',
    bonuses: [
      { kind: 'market_discount', percent: 10 },
      { kind: 'resource', resource: 'caps', perHour: 12 },
    ],
    baseDefense: 4,
    labels: [L('crammed', 2), L('noisy', 3), L('open', 1)],
    upgradeCost: { caps: 550, planks: 220 },
    upgrades: [
      'Your people are on the floor at open, which is where the day’s price is decided.',
      'A seat on the board. The number goes up when you say it does.',
      'The clearing book runs through your hands. Everyone else trades on your terms.',
    ],
  },
  pawn_shop: {
    label: 'Pawn Shop',
    blurb: 'A barred window, a long counter, and a back room with better stock.',
    reward: 'A smaller cut, and a fence who moves what a raid brings back.',
    bonuses: [{ kind: 'loot_capacity', percent: 15 }],
    baseDefense: 1,
    labels: [L('crammed', 3), L('dark', 1)],
    upgradeCost: { caps: 240, planks: 100 },
    upgrades: [
      'The back room is cleared and shelved. Twice the stock, half the arguments.',
      'A second counter for people who would rather not queue where they can be seen.',
      'A yard behind with a gate on it. Whole truckloads, not armfuls.',
    ],
  },
  bone_market: {
    label: 'The Bone Market',
    blurb:
      'Where the city sells what is left of people and machines. Brisk, unsentimental, and open every day of the year.',
    reward: 'What you lose in a fight comes back as caps instead of coming back as nothing.',
    bonuses: [{ kind: 'salvage_refund', percent: 12 }],
    baseDefense: 3,
    labels: [L('eerie', 2), L('crammed', 2), L('noisy', 1)],
    upgradeCost: { caps: 460, scrap: 120, planks: 140 },
    upgrades: [
      'Your own recovery crew works the field before anybody else gets there.',
      'A rendering shed, so what comes back is sorted rather than sold in a heap.',
      'Standing contracts with three districts. Nothing you lose is lost entirely.',
    ],
  },
  revolutionist_statue: {
    label: 'Statue of the Revolutionist',
    blurb:
      'Nine metres of bronze with one arm raised, and a plinth the Combine has repeatedly failed to have removed.',
    reward:
      'Standing under it costs you less with the people who deal in the dark, and taking it is a statement the whole city hears.',
    bonuses: [
      { kind: 'black_market_discount', percent: 15 },
      { kind: 'intimidation', flat: 6 },
    ],
    baseDefense: 5,
    labels: [L('open', 3), L('elevated', 2)],
    upgradeCost: { caps: 400, scrap: 100, planks: 70 },
    upgrades: [
      'The plinth is cleaned and the inscription re-cut. People start meeting here again.',
      'Floodlights. It is the first thing anybody sees coming into the district.',
      'A standing crowd, most nights. What is said under it is repeated everywhere.',
    ],
    /** §D8: the one location whose *capture* is the event, not its output. */
    captureInfamy: 6,
  },

  // ------------------------------------------------------------ ground and defence
  high_ground: {
    label: 'High Ground',
    blurb: 'A roofline, a water tower, a spoil heap. Whatever counts as looking down around here.',
    reward: 'Everything you hold in this city is harder to take off you.',
    bonuses: [{ kind: 'defense_percent', percent: 12 }],
    baseDefense: 4,
    labels: [L('open', 3), L('elevated', 3), L('windy', 1)],
    upgradeCost: { caps: 340, scrap: 200, planks: 180 },
    upgrades: [
      'Sandbagged firing positions instead of whatever people were crouching behind.',
      'A cut stair up the back, so the position can be reinforced under fire.',
      'Overhead cover and a ready magazine. It stops being a vantage and becomes a work.',
    ],
  },
  barricade: {
    label: 'Barricade',
    blurb: 'Sea containers, rubble and rebar, arranged by somebody who had thought about it.',
    reward: 'A harder approach to everything behind it.',
    bonuses: [{ kind: 'defense_percent', percent: 8 }],
    baseDefense: 5,
    labels: [L('crammed', 2), L('open', 1)],
    upgradeCost: { caps: 300, scrap: 260, planks: 280 },
    upgrades: [
      'The gaps are filled and the whole line is tied together with rebar.',
      'A second course of containers, offset, so nothing has a straight run at it.',
      'Firing slits, a sally port, and a roof over the fighting step.',
    ],
  },
  watchtower: {
    label: 'Watchtower',
    blurb:
      'A lattice mast with a cabin on top, a working pair of glasses, and a line of sight over four districts.',
    reward: 'Everything your scouts do, they do better: everywhere in the city, not just here.',
    bonuses: [
      { kind: 'intel', percent: 20 },
      { kind: 'vision', districts: 1 },
    ],
    baseDefense: 5,
    labels: [L('elevated', 4), L('open', 2), L('windy', 2), L('crammed', 1)],
    upgradeCost: { caps: 420, scrap: 180, highQualityMetal: 10, planks: 200 },
    upgrades: [
      'The cabin is glazed and manned around the clock instead of at somebody’s convenience.',
      'Optics off a dead Combine spotter post, and somebody who knows how to use them.',
      'A relay to your own district, so what is seen here is known there within the minute.',
    ],
  },
  sewer_junction: {
    label: 'Sewer Junction',
    blurb: 'A brick chamber where six storm drains meet. It goes everywhere.',
    reward: 'Your people can get places without being seen getting there.',
    bonuses: [{ kind: 'unit_stealth', percent: 15 }],
    baseDefense: 2,
    labels: [L('crammed', 4), L('dark', 3), L('wet', 2), L('toxic', 1)],
    upgradeCost: { caps: 220, scrap: 140, planks: 90 },
    upgrades: [
      'The collapsed eastern run is dug out. Two more ways in and out.',
      'Duckboards and lamps the whole length, so a crew moves at walking pace.',
      'A mapped network with marked exits in six districts. Nobody goes the wrong way.',
    ],
  },
  smugglers_tunnel: {
    label: "Smuggler's Tunnel",
    blurb:
      'Cut by hand under the old customs line, shored with railway sleepers, and in continuous use since before anybody now alive.',
    reward: 'Every crew you send anywhere is back sooner. There is a shorter way and you own it.',
    bonuses: [{ kind: 'mission_speed', percent: 12 }],
    baseDefense: 4,
    labels: [L('crammed', 4), L('dark', 4), L('eerie', 1)],
    upgradeCost: { caps: 480, scrap: 200, planks: 240 },
    upgrades: [
      'The flooded section is pumped and the shoring replaced. It is safe at a run.',
      'A second shaft at the far end, so traffic stops meeting itself in the middle.',
      'Trolley rails the whole length. What used to be a night is now an hour.',
    ],
  },

  // ------------------------------------------------------------ war
  armory: {
    label: 'Armory',
    blurb: 'Racks, a workbench, and a door that took three people to open the first time.',
    reward: 'Cheaper units, and a bench that will fit anything you can find a part for.',
    bonuses: [
      { kind: 'training_cost', percent: 12 },
      { kind: 'refit_discount', percent: 20 },
    ],
    baseDefense: 6,
    labels: [L('crammed', 3), L('dark', 2)],
    upgradeCost: { caps: 520, scrap: 220, highQualityMetal: 20, planks: 130 },
    upgrades: [
      'The armourer’s bench is set up properly and somebody is on it every day.',
      'Pattern jigs, so a refit is repeatable instead of one man’s good afternoon.',
      'A proving butt out the back. Nothing leaves here that has not been fired.',
    ],
  },
  war_machine_graveyard: {
    label: 'War Machine Graveyard',
    blurb: 'A field of dead armour, half of it sunk, some of it not as dead as it looks.',
    reward: 'Hulls, plate and running gear, and troops that come back from more than they should.',
    bonuses: [{ kind: 'unit_vitality', percent: 10 }],
    baseDefense: 6,
    labels: [L('open', 3), L('eerie', 2), L('toxic', 1)],
    upgradeCost: { caps: 560, scrap: 320, oil: 100, planks: 120 },
    upgrades: [
      'A gantry crane over the north field. Whole hulls instead of what could be carried.',
      'The sunk row is dug out and drained: the best of it was always at the bottom.',
      'A cutting shop on site, so what leaves is stock rather than wreckage.',
    ],
  },
  construction_site: {
    label: 'Construction Site',
    blurb:
      'A tower crane, a poured raft the size of a city block, and thirty years of nobody finishing it.',
    reward:
      'Lifting gear nothing else in the city has. Some things can only be assembled standing up.',
    bonuses: [
      { kind: 'build_speed', percent: 10 },
      // §D5b: the one place on the map with a timber yard already on it. It paid no resource at
      // all before, which made it the only location whose whole worth was a percentage.
      { kind: 'resource', resource: 'planks', perHour: 22 },
    ],
    baseDefense: 6,
    labels: [L('open', 3), L('elevated', 2), L('noisy', 2), L('windy', 1)],
    upgradeCost: { caps: 700, scrap: 340, highQualityMetal: 30, planks: 380 },
    upgrades: [
      'The tower crane is recommissioned and passes a load test at full radius.',
      'A second crane on the east raft, so two things can be built at once.',
      'The site is decked, lit and enclosed. It becomes a yard rather than a hole.',
    ],
  },
  fight_pit: {
    label: 'Fight Pit',
    blurb: 'A sunk ring, a standing crowd, and a bookmaker who knows everyone.',
    reward: 'Your people are harder to frighten, and better for the practice.',
    bonuses: [{ kind: 'unit_morale', flat: 8 }],
    baseDefense: 2,
    labels: [L('crammed', 3), L('noisy', 4)],
    upgradeCost: { caps: 300, food: 80, planks: 160 },
    upgrades: [
      'Tiered benches and a bell. Twice the crowd and four times the noise.',
      'A card every night instead of whenever somebody feels like it.',
      'A trainer on the payroll who used to be somebody. People come to lose to him.',
    ],
  },
  gym: {
    label: 'The Gym',
    blurb:
      'Chalk, cast iron and a single working fan. Everything in here has been repaired more than once.',
    reward: 'One more session in the day than the day has room for.',
    bonuses: [{ kind: 'training_sessions', flat: 1 }],
    baseDefense: 2,
    labels: [L('crammed', 3), L('noisy', 2), L('hot', 1)],
    upgradeCost: { caps: 380, scrap: 80, planks: 120 },
    upgrades: [
      'The upstairs room is cleared out, which doubles the floor.',
      'Proper plates and a rack that is not welded together. Nobody is waiting.',
      'Somebody good is running the sessions, and the sessions are worth turning up to.',
    ],
  },
  doghouse: {
    label: 'The Doghouse',
    blurb:
      'Kennels under the flyover, a surgery at the back, and forty animals that go quiet when the right person walks in.',
    reward: 'Working dogs, augmented, and handlers who have done this before.',
    bonuses: [{ kind: 'intimidation', flat: 6 }],
    baseDefense: 3,
    labels: [L('noisy', 3), L('crammed', 2)],
    upgradeCost: { caps: 420, food: 160, highQualityMetal: 10, planks: 130 },
    upgrades: [
      'The surgery gets a clean room, and the survival rate stops being a talking point.',
      'A run and a scent yard, so the animals are trained rather than merely kept.',
      'A breeding line of your own. What comes out of here is better than what went in.',
    ],
  },
  rail_yard: {
    label: 'Rail Yard',
    blurb: 'Sidings, a turntable, and rolling stock that will move if pushed hard enough.',
    reward:
      'Bogies, axles and drive parts by the wagonload: everything the garage has been improvising.',
    bonuses: [
      { kind: 'vehicle_parts', percent: 20 },
      { kind: 'travel_speed', percent: 10 },
    ],
    baseDefense: 4,
    labels: [L('open', 3), L('noisy', 2), L('windy', 1)],
    upgradeCost: { caps: 480, scrap: 280, planks: 200 },
    upgrades: [
      'The turntable is freed off, so stock stops having to be dragged out backwards.',
      'A lifting shop over the pit road. Bogies come out whole instead of in pieces.',
      'Two sidings cleared and a locomotive that runs. The yard starts feeding itself.',
    ],
  },
  tram_depot: {
    label: 'Tram Depot',
    blurb:
      'Eight roads under one roof, half the fleet still on them, and overhead line that is live in places.',
    reward: 'The city gets smaller. Everything you send anywhere leaves sooner and arrives faster.',
    bonuses: [{ kind: 'travel_speed', percent: 18 }],
    baseDefense: 3,
    labels: [L('crammed', 2), L('noisy', 2), L('dark', 1)],
    upgradeCost: { caps: 400, scrap: 220, oil: 60, planks: 150 },
    upgrades: [
      'Two cars are made roadworthy and the depot road is cleared to the street.',
      'The overhead is repaired as far as the junction. No more towing.',
      'A running timetable on three routes. Your people stop walking anywhere.',
    ],
  },

  // ------------------------------------------------------------ knowledge and signal
  university: {
    label: 'University',
    blurb: 'Lecture halls turned workshops, and a library nobody got round to burning.',
    reward: 'Every research project finishes sooner.',
    bonuses: [{ kind: 'research_speed', percent: 12 }],
    baseDefense: 3,
    labels: [L('crammed', 2), L('dark', 1)],
    upgradeCost: { caps: 460, highQualityMetal: 10, planks: 180 },
    upgrades: [
      'The east reading room is reopened and catalogued.',
      'Power to the workshops, so the equipment in them stops being furniture.',
      'Three of the old faculty come back. That is the upgrade; the rooms were never the problem.',
    ],
  },
  planetarium: {
    label: 'Planetarium',
    blurb:
      'A dome, a projector the size of a car, and a hundred and eighty seats nobody has sat in for years.',
    reward:
      'A room built for thinking in, and an optical bench worth more than the building around it.',
    bonuses: [
      { kind: 'research_speed', percent: 18 },
      { kind: 'intel', percent: 6 },
    ],
    baseDefense: 3,
    labels: [L('dark', 4), L('crammed', 1), L('eerie', 1)],
    upgradeCost: { caps: 620, highQualityMetal: 25, planks: 90 },
    upgrades: [
      'The projector is rebuilt and the dome is dark again for the first time in years.',
      'The optical bench is stripped and repurposed. It is the best glass in the district.',
      'Sessions every night. Your researchers start solving things in the dark.',
    ],
  },
  satellite_uplink: {
    label: 'Satellite Uplink',
    blurb: 'A dish on a mast, aligned by hand, talking to something still in orbit.',
    reward: 'You can see into districts without walking into them first.',
    bonuses: [{ kind: 'vision', districts: 2 }],
    baseDefense: 5,
    labels: [L('open', 2), L('elevated', 3), L('windy', 2)],
    upgradeCost: { caps: 560, highQualityMetal: 30, planks: 70 },
    upgrades: [
      'The dish is re-aimed properly and the signal stops dropping out at dusk.',
      'A second receiver, so two birds can be tracked instead of one.',
      'Decryption on site. What comes down is read here rather than carried somewhere.',
    ],
  },
  broadcast_tower: {
    label: 'Broadcast Tower',
    blurb: 'A mast with a working transmitter, and whoever holds it decides what the city hears.',
    reward: 'Your name arrives before your people do.',
    bonuses: [{ kind: 'intimidation', flat: 10 }],
    baseDefense: 5,
    labels: [L('elevated', 3), L('open', 2), L('windy', 2)],
    upgradeCost: { caps: 480, highQualityMetal: 20, planks: 80 },
    upgrades: [
      'Output doubled. The signal reaches the upper levels for the first time.',
      'A standby set, so being knocked off air stops being a thing that happens.',
      'Your own hour, every evening, and the city has started planning around it.',
    ],
  },
  broadcast_station: {
    label: 'Broadcast Station',
    blurb:
      'Two studios, a records library, and a switchboard that still connects to places nobody can name.',
    reward: 'Everyone on your books gets better at the half of the job that is talking to people.',
    bonuses: [{ kind: 'officer_group', group: 'social', flat: 5 }],
    baseDefense: 4,
    labels: [L('crammed', 2), L('dark', 1)],
    upgradeCost: { caps: 540, planks: 110 },
    upgrades: [
      'Studio two is brought back, so training stops competing with transmission.',
      'The records library is catalogued. Nine thousand hours of how people talked.',
      'A standing school. Your officers are taught here, and it shows in a room.',
    ],
  },
  pirate_radio: {
    label: 'Pirate Radio',
    blurb:
      'A transmitter in a loft, a wire aerial over four roofs, and an operator who moves it every few weeks.',
    reward: 'You hear what the city is saying, and some of what it would rather not.',
    bonuses: [
      { kind: 'intel', percent: 12 },
      { kind: 'intimidation', flat: 3 },
    ],
    baseDefense: 2,
    labels: [L('crammed', 3), L('elevated', 1), L('dark', 2)],
    upgradeCost: { caps: 280, scrap: 60, planks: 70 },
    upgrades: [
      'A directional aerial. Twice the reach and half the chance of being found.',
      'A second set in another building, so being raided stops meaning being off air.',
      'Listeners in six districts calling things in. The station stops being the source.',
    ],
  },

  // ------------------------------------------------------------ flesh
  gene_clinic: {
    label: 'Gene Clinic',
    blurb: 'Sealed theatres, cold storage, and a waiting room nobody waits in.',
    reward: 'Work can be done on people here that cannot be done anywhere else.',
    bonuses: [{ kind: 'unit_vitality', percent: 8 }],
    baseDefense: 6,
    labels: [L('crammed', 3), L('cold', 1), L('eerie', 1)],
    upgradeCost: { caps: 640, highQualityMetal: 30, planks: 80 },
    upgrades: [
      'Theatre two is recommissioned and the cold store is stocked properly.',
      'A sequencer that works, which changes what can be attempted here at all.',
      'Three surgeons on rotation. The theatre stops being idle six days a week.',
    ],
  },
  hospital: {
    label: 'Hospital',
    blurb: 'Four working theatres, a generator, and staff who stayed when the funding did not.',
    reward: 'What comes back from a fight comes back in better shape.',
    bonuses: [{ kind: 'unit_vitality', percent: 12 }],
    baseDefense: 3,
    labels: [L('crammed', 2), L('noisy', 1)],
    upgradeCost: { caps: 500, food: 100, planks: 160 },
    upgrades: [
      'The generator is overhauled, so a theatre stops going dark mid-operation.',
      'A blood bank. The thing they most often ran out of stops running out.',
      'A trauma bay at the door. The ones who used to die on the step do not.',
    ],
  },
  black_clinic: {
    label: 'Black Clinic',
    blurb:
      'A basement with good lighting, a locked cabinet, and a doctor who lost their licence for reasons nobody discusses.',
    reward:
      'Syringes. Handed out before a fight, they bring somebody back to strength who had no right to be.',
    bonuses: [{ kind: 'battle_stims', flat: 2 }],
    baseDefense: 4,
    labels: [L('crammed', 3), L('dark', 2), L('toxic', 1)],
    upgradeCost: { caps: 520, food: 60, highQualityMetal: 10, planks: 90 },
    upgrades: [
      'A second bench and a chemist on it. Output goes from a trickle to a supply.',
      'Cold storage, so a batch stops going off before it is used.',
      'A formula that does not take as much out of the person it goes into.',
    ],
  },
  mad_scientist_lair: {
    label: "Mad Scientist's Lair",
    blurb:
      'Down a service stair behind a laundry: tanks, a generator, an operating table, and forty years of notes in one handwriting.',
    reward:
      'Everything needed to make something that should not exist, and the notes explaining how.',
    bonuses: [
      { kind: 'research_speed', percent: 8 },
      { kind: 'unit_offense', percent: 6 },
    ],
    baseDefense: 7,
    labels: [L('crammed', 3), L('toxic', 3), L('dark', 3), L('eerie', 3)],
    upgradeCost: { caps: 800, highQualityMetal: 45, oil: 100, planks: 100 },
    upgrades: [
      'The tanks are drained, cleaned and refilled. Whatever was in them is gone.',
      'Power off your own grid rather than the generator, so nothing is interrupted again.',
      'The notes are transcribed and understood. That is the upgrade, and it is the frightening one.',
    ],
  },

  // ------------------------------------------------------------ people
  tavern: {
    label: 'Downtown Tavern',
    blurb:
      'Low ceiling, long bar, and a corner table that has been the same three people’s corner table for twenty years.',
    reward: 'A room where the city’s hardest people drink, and somebody who can introduce you.',
    bonuses: [{ kind: 'unit_morale', flat: 5 }],
    baseDefense: 3,
    labels: [L('crammed', 4), L('noisy', 4), L('dark', 2)],
    upgradeCost: { caps: 360, food: 80, planks: 140 },
    upgrades: [
      'The cellar is restocked and the back room is yours whenever you want it.',
      'A door policy. The people worth meeting stop being drowned out by the people who are not.',
      'You are the house. Every introduction in this room goes through you now.',
    ],
  },
  cinema: {
    label: 'Cinema',
    blurb:
      'Eight hundred seats, a projector somebody has kept running out of stubbornness, and four reels left.',
    reward: 'Two hours somewhere else. A crew that gets that fights differently the next day.',
    bonuses: [{ kind: 'unit_morale', flat: 12 }],
    baseDefense: 2,
    labels: [L('dark', 4), L('crammed', 2)],
    upgradeCost: { caps: 340, planks: 120 },
    upgrades: [
      'The projector is rebuilt and the sound comes back. It stops being a silent film.',
      'The balcony is reopened, which is another three hundred seats a night.',
      'A print run traded in from three districts. Something different every week.',
    ],
  },
  arcade: {
    label: 'The Arcade',
    blurb: 'Forty cabinets, nine of them working, and a change machine that has never been robbed.',
    reward: 'Reflex work disguised as an evening off. The drills go quicker.',
    bonuses: [{ kind: 'training_speed', percent: 12 }],
    baseDefense: 1,
    labels: [L('crammed', 3), L('noisy', 3), L('dark', 2)],
    upgradeCost: { caps: 260, scrap: 60, planks: 90 },
    upgrades: [
      'Half the dead cabinets are cannibalised into working ones.',
      'A back room wired for two-player rigs. People start practising on purpose.',
      'A ladder, a board, and a prize. It stops being a distraction and becomes training.',
    ],
  },
  skate_ground: {
    label: 'Skate Ground',
    blurb: 'A drained reservoir the kids took over, and then the couriers after them.',
    reward: 'Everything you field moves faster.',
    bonuses: [{ kind: 'unit_speed', percent: 12 }],
    baseDefense: 1,
    labels: [L('open', 3), L('noisy', 1)],
    upgradeCost: { caps: 220, scrap: 90, planks: 140 },
    upgrades: [
      'The cracked half is resurfaced, which doubles the usable ground.',
      'Lights on poles. The couriers train after dark, which is when they work.',
      'A run built out to the street, so the practice is the route rather than a shape.',
    ],
  },
  chapel: {
    label: 'The Chapel',
    blurb:
      'Twelve pews, a working bell, and a man who has buried more of this district than anybody would like to count.',
    reward: 'Everyone on your books holds together better under things that break people.',
    bonuses: [{ kind: 'officer_group', group: 'mental', flat: 5 }],
    baseDefense: 2,
    labels: [L('eerie', 2), L('dark', 2), L('crammed', 1), L('cold', 1)],
    upgradeCost: { caps: 380, planks: 160 },
    upgrades: [
      'The roof is made good and the bell rings on the hour again.',
      'A vestry for people who want to talk without a congregation listening.',
      'Somebody is here at any hour, and the district has noticed.',
    ],
  },
  graveyard: {
    label: 'Graveyard',
    blurb:
      'Terraced plots up the cut, the older half subsided, and a lodge at the gate with a light on.',
    reward:
      'Holding this ground says something the city does not forget, and what is buried here was buried with its rings on.',
    bonuses: [
      { kind: 'infamy_gain', percent: 15 },
      { kind: 'resource', resource: 'caps', perHour: 10 },
    ],
    baseDefense: 3,
    labels: [L('eerie', 4), L('dark', 2), L('open', 2), L('cold', 1)],
    upgradeCost: { caps: 300, scrap: 60, planks: 80 },
    upgrades: [
      'The lodge is manned and the gates are shut at night. It becomes yours visibly.',
      'The subsided terrace is worked properly instead of dug at by whoever turns up.',
      'The register is found. You know who is here, and so does everyone you tell.',
    ],
  },
};

/** A location's level, brought inside `1..MAX_LOCATION_LEVEL`. Everything reads through this. */
export function clampLevel(level: number): number {
  return Math.min(MAX_LOCATION_LEVEL, Math.max(1, Math.trunc(level)));
}

/**
 * One bonus as it stands at a level.
 *
 * Rounded, and rounded *outward from zero on the magnitude* rather than truncated, so a small
 * bonus at level 1 still moves at level 2: a 3% discount that scales to 4.5 and truncates back to
 * 4 is an upgrade a player paid for and cannot see.
 */
export function scaledBonus(bonus: HoldBonus, level: number): HoldBonus {
  const at = clampLevel(level);
  const scale = LEVEL_SCALE[at - 1] as number;
  const grow = (value: number): number => Math.round(value * scale);
  /**
   * The same, for channels counted in whole small things: sessions, syringes, districts seen.
   *
   * `round(1 × 1.5)` and `round(1 × 2)` are both 2, so a Gym at level 3 paid exactly what it paid
   * at level 2 and the player had bought nothing. Floored at one step per level, so every upgrade
   * of every kind is worth *something*, which is the promise the upgrade button makes.
   */
  const step = (value: number): number =>
    value <= 0 ? value : Math.max(grow(value), value + (at - 1));

  switch (bonus.kind) {
    case 'resource':
      return { ...bonus, perHour: grow(bonus.perHour) };
    case 'power_supply':
      return { ...bonus, amount: grow(bonus.amount) };
    case 'vision':
      return { ...bonus, districts: step(bonus.districts) };
    case 'training_sessions':
    case 'battle_stims':
      return { ...bonus, flat: step(bonus.flat) };
    case 'unit_morale':
    case 'intimidation':
    case 'officer_group':
    case 'population':
      return { ...bonus, flat: grow(bonus.flat) };
    default:
      return { ...bonus, percent: grow(bonus.percent) };
  }
}

/** Everything a location is worth at a level. */
export function bonusesAt(kind: LocationKind, level: number): HoldBonus[] {
  return LOCATION_CATALOG[kind].bonuses.map((bonus) => scaledBonus(bonus, level));
}

/**
 * What it costs to take a location from `level` to the next one, or `null` at the ceiling.
 *
 * Scaled off the kind's own first-upgrade price rather than a global table, because the locations
 * are not interchangeable: a Cinema is a projector and a Nuclear Plant is a coolant loop, and
 * charging the same for both would make half the map not worth touching.
 */
export function upgradeCost(kind: LocationKind, level: number): PartialResources | null {
  const from = clampLevel(level);
  if (from >= MAX_LOCATION_LEVEL) return null;
  const scale = UPGRADE_COST_SCALE[from - 1] as number;
  const base = LOCATION_CATALOG[kind].upgradeCost;
  const cost: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const amount = base[key];
    if (amount !== undefined && amount > 0) cost[key] = Math.round(amount * scale);
  }
  return cost;
}

/** What the next level actually *is*, in the player's words, or `null` at the ceiling. */
export function upgradeNote(kind: LocationKind, level: number): string | null {
  const from = clampLevel(level);
  if (from >= MAX_LOCATION_LEVEL) return null;
  return LOCATION_CATALOG[kind].upgrades[from - 1] as string;
}

/**
 * How hard a location is to dig into (§A4).
 *
 * Deliberately inverted against intuition, and the board asked for it that way: an *easy* location
 * to fortify pays the most per level. The rubble-and-rebar barricade you can add to all afternoon
 * is worth more per level than the spire you can barely drill into: the hard ones are already
 * defensible, so what you can add to them is marginal.
 */
export const FORTIFY_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const FortifyDifficultySchema = z.enum(FORTIFY_DIFFICULTIES);
export type FortifyDifficulty = z.infer<typeof FortifyDifficultySchema>;

/** Defence percentage each fortification level is worth, by how hard the ground is to work. */
export const FORTIFY_DIFFICULTY_LABELS: Record<FortifyDifficulty, string> = {
  easy: 'Easy to fortify',
  medium: 'Medium to fortify',
  hard: 'Hard to fortify',
};

/** One authored location on the map. */
export const LocationSchema = z.object({
  id: z.string().min(1),
  districtId: z.string().min(1),
  name: z.string().min(1),
  kind: LocationKindSchema,
  fortifyDifficulty: FortifyDifficultySchema,
});
export type Location = z.infer<typeof LocationSchema>;

/** The zero of {@link TerritoryEffects}: also the answer for a crew holding nothing. */
export interface TerritoryEffects {
  /** Added to whatever the district's own structures produce. */
  perHour: PartialResources;
  powerSupply: number;
  defensePercent: number;
  researchSpeedPercent: number;
  buildSpeedPercent: number;
  trainingSpeedPercent: number;
  trainingCostPercent: number;
  unitOffensePercent: number;
  unitVitalityPercent: number;
  unitMoraleFlat: number;
  unitSpeedPercent: number;
  unitStealthPercent: number;
  lootCapacityPercent: number;
  intimidationFlat: number;
  travelSpeedPercent: number;
  /** How many of the nearest districts are visible without scouting them.  */
  visionRange: number;
  /** §D8: a percentage more infamy off everything that earns any. */
  infamyGainPercent: number;
  /** Per resource: the same amount does this much more work than it should. */
  resourceYieldPercent: PartialResources;
  /** §E: every crew that is out is home sooner. */
  missionSpeedPercent: number;
  marketDiscountPercent: number;
  blackMarketDiscountPercent: number;
  refitDiscountPercent: number;
  vehiclePartsPercent: number;
  /** §F2: extra sessions in the day. */
  extraTrainingSessions: number;
  /** Adrenaline syringes on hand before a fight. */
  battleStims: number;
  /** A share of what dies comes back as caps. */
  salvageRefundPercent: number;
  /**
   * What a scout brings back, and what the city tells you unasked.
   *
   * Lives here rather than in `CrewEffects` because ground and people push it *equally*: a
   * Watchtower and a Head Spy with a Logic of 80 are two ways of buying the same thing, and the
   * whole design of `crew/effects.ts` is that they should land in one channel.
   */
  intelYieldPercent: number;
  /** Flat points on every officer's attributes in a group. What the Chapel and the Station give. */
  officerGroupFlat: Partial<Record<AttributeGroup, number>>;
  /**
   * §A1: beds the map adds to the district's own.
   *
   * `POPULATION_PER_LOCATION` for every location held, plus whatever the locations that house
   * people give on top. Folded in `territoryEffectsFor`, because the flat-per-location part is a
   * fact about *how many* you hold rather than about any one of them.
   */
  populationBonus: number;
}

export function noTerritoryEffects(): TerritoryEffects {
  return {
    perHour: {},
    powerSupply: 0,
    defensePercent: 0,
    researchSpeedPercent: 0,
    buildSpeedPercent: 0,
    trainingSpeedPercent: 0,
    trainingCostPercent: 0,
    unitOffensePercent: 0,
    unitVitalityPercent: 0,
    unitMoraleFlat: 0,
    unitSpeedPercent: 0,
    unitStealthPercent: 0,
    lootCapacityPercent: 0,
    intimidationFlat: 0,
    travelSpeedPercent: 0,
    visionRange: 0,
    infamyGainPercent: 0,
    resourceYieldPercent: {},
    missionSpeedPercent: 0,
    marketDiscountPercent: 0,
    blackMarketDiscountPercent: 0,
    refitDiscountPercent: 0,
    vehiclePartsPercent: 0,
    extraTrainingSessions: 0,
    battleStims: 0,
    salvageRefundPercent: 0,
    intelYieldPercent: 0,
    officerGroupFlat: {},
    populationBonus: 0,
  };
}

/** Folds one bonus into a running total. Mutates `into`. It is the accumulator of a reduce. */
export function applyHoldBonus(into: TerritoryEffects, bonus: HoldBonus): TerritoryEffects {
  switch (bonus.kind) {
    case 'resource':
      into.perHour = {
        ...into.perHour,
        [bonus.resource]: (into.perHour[bonus.resource] ?? 0) + bonus.perHour,
      };
      return into;
    case 'power_supply':
      into.powerSupply += bonus.amount;
      return into;
    case 'defense_percent':
      into.defensePercent += bonus.percent;
      return into;
    case 'research_speed':
      into.researchSpeedPercent += bonus.percent;
      return into;
    case 'build_speed':
      into.buildSpeedPercent += bonus.percent;
      return into;
    case 'training_speed':
      into.trainingSpeedPercent += bonus.percent;
      return into;
    case 'training_cost':
      into.trainingCostPercent += bonus.percent;
      return into;
    case 'unit_offense':
      into.unitOffensePercent += bonus.percent;
      return into;
    case 'unit_vitality':
      into.unitVitalityPercent += bonus.percent;
      return into;
    case 'unit_morale':
      into.unitMoraleFlat += bonus.flat;
      return into;
    case 'unit_speed':
      into.unitSpeedPercent += bonus.percent;
      return into;
    case 'unit_stealth':
      into.unitStealthPercent += bonus.percent;
      return into;
    case 'loot_capacity':
      into.lootCapacityPercent += bonus.percent;
      return into;
    case 'intimidation':
      into.intimidationFlat += bonus.flat;
      return into;
    case 'travel_speed':
      into.travelSpeedPercent += bonus.percent;
      return into;
    case 'vision':
      into.visionRange = Math.max(into.visionRange, bonus.districts);
      return into;
    case 'infamy_gain':
      into.infamyGainPercent += bonus.percent;
      return into;
    case 'resource_yield':
      into.resourceYieldPercent = {
        ...into.resourceYieldPercent,
        [bonus.resource]: (into.resourceYieldPercent[bonus.resource] ?? 0) + bonus.percent,
      };
      return into;
    case 'mission_speed':
      into.missionSpeedPercent += bonus.percent;
      return into;
    case 'market_discount':
      into.marketDiscountPercent += bonus.percent;
      return into;
    case 'black_market_discount':
      into.blackMarketDiscountPercent += bonus.percent;
      return into;
    case 'refit_discount':
      into.refitDiscountPercent += bonus.percent;
      return into;
    case 'vehicle_parts':
      into.vehiclePartsPercent += bonus.percent;
      return into;
    case 'training_sessions':
      into.extraTrainingSessions += bonus.flat;
      return into;
    case 'battle_stims':
      into.battleStims += bonus.flat;
      return into;
    case 'salvage_refund':
      into.salvageRefundPercent += bonus.percent;
      return into;
    case 'intel':
      into.intelYieldPercent += bonus.percent;
      return into;
    case 'population':
      into.populationBonus += bonus.flat;
      return into;
    case 'officer_group':
      into.officerGroupFlat = {
        ...into.officerGroupFlat,
        [bonus.group]: (into.officerGroupFlat[bonus.group] ?? 0) + bonus.flat,
      };
      return into;
  }
}

/** Short resource names for the one-line bonus text. Kept here so this module stands alone. */
const RESOURCE_LABELS: Record<ResourceKey, string> = {
  caps: 'caps',
  food: 'food',
  oil: 'oil',
  scrap: 'scrap',
  planks: 'planks',
  highQualityMetal: 'HQ metal',
};

const GROUP_LABELS: Record<AttributeGroup, string> = {
  physical: 'physical',
  mental: 'mental',
  social: 'social',
  technical: 'technical',
};

/** A bonus in one line, for a location card. Authored `reward` says *why*; this says how much. */
export function describeHoldBonus(bonus: HoldBonus): string {
  switch (bonus.kind) {
    case 'resource':
      return `+${bonus.perHour} ${RESOURCE_LABELS[bonus.resource]}/h`;
    case 'power_supply':
      return `+${bonus.amount} power`;
    case 'defense_percent':
      return `+${bonus.percent}% defence`;
    case 'research_speed':
      return `-${bonus.percent}% research time`;
    case 'build_speed':
      return `-${bonus.percent}% build time`;
    case 'training_speed':
      return `-${bonus.percent}% training time`;
    case 'training_cost':
      return `-${bonus.percent}% training cost`;
    case 'unit_offense':
      return `+${bonus.percent}% unit offense`;
    case 'unit_vitality':
      return `+${bonus.percent}% unit vitality`;
    case 'unit_morale':
      return `+${bonus.flat} unit morale`;
    case 'unit_speed':
      return `+${bonus.percent}% unit speed`;
    case 'unit_stealth':
      return `+${bonus.percent}% unit stealth`;
    case 'loot_capacity':
      return `+${bonus.percent}% loot capacity`;
    case 'intimidation':
      return `+${bonus.flat} intimidation`;
    case 'travel_speed':
      return `+${bonus.percent}% travel speed`;
    case 'vision':
      return `sees ${bonus.districts} district${bonus.districts === 1 ? '' : 's'}`;
    case 'infamy_gain':
      return `+${bonus.percent}% infamy earned`;
    case 'resource_yield':
      return `${RESOURCE_LABELS[bonus.resource]} goes ${bonus.percent}% further`;
    case 'mission_speed':
      return `-${bonus.percent}% mission time`;
    case 'market_discount':
      return `-${bonus.percent}% market prices`;
    case 'black_market_discount':
      return `-${bonus.percent}% black-market infamy`;
    case 'refit_discount':
      return `-${bonus.percent}% refit cost`;
    case 'vehicle_parts':
      return `-${bonus.percent}% vehicle cost`;
    case 'training_sessions':
      return `+${bonus.flat} training session${bonus.flat === 1 ? '' : 's'}/day`;
    case 'battle_stims':
      return `+${bonus.flat} battle stim${bonus.flat === 1 ? '' : 's'}`;
    case 'salvage_refund':
      return `${bonus.percent}% of losses refunded`;
    case 'intel':
      return `+${bonus.percent}% intel`;
    case 'officer_group':
      return `+${bonus.flat} to officer ${GROUP_LABELS[bonus.group]} skills`;
    case 'population':
      return `+${bonus.flat} population`;
  }
}

/** Guards the label tables against a resource or a group being added and silently going unnamed. */
for (const key of RESOURCE_KEYS) {
  if (!RESOURCE_LABELS[key]) throw new Error(`no location-bonus label for the ${key} resource`);
}
for (const group of ATTRIBUTE_GROUPS) {
  if (!GROUP_LABELS[group]) throw new Error(`no location-bonus label for the ${group} group`);
}

/**
 * Guards the catalogue at module load: every kind is authored, pays something, and says what its
 * three upgrades are. A location that pays nothing is a location nobody has a reason to take.
 */
for (const kind of LOCATION_KINDS) {
  const spec = LOCATION_CATALOG[kind];
  if (!spec) throw new Error(`${kind} has no entry in the location catalogue`);
  if (spec.bonuses.length === 0) throw new Error(`${kind} is worth nothing to hold`);
  if (spec.upgrades.length !== MAX_LOCATION_LEVEL - 1) {
    throw new Error(`${kind} needs ${MAX_LOCATION_LEVEL - 1} upgrade notes`);
  }
  if (Object.keys(spec.upgradeCost).length === 0) {
    throw new Error(`${kind} has no upgrade price, so it can never be worked up`);
  }
  if (spec.labels.length === 0) {
    throw new Error(`${kind} has no environment labels: every ground fights like something`);
  }
}
