import { missionSpeedCut } from '../economy/soft-bounds.js';
import { CHAIR_PASSIVE_CAP } from '../crew/passives.js';
import { z } from 'zod';
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_LABELS,
  type AttributeGroup,
  type AttributeName,
} from '../attributes.js';
import { RESOURCE_KEYS, type PartialResources, type ResourceKey } from '../resources.js';
import {
  UNIT_TIER_LABELS,
  UNIT_TIER_STAT_LABELS,
  tierStatAmount,
  type UnitTier,
  type UnitTierStat,
} from '../units/tiers.js';
import {
  DAMAGE_TYPE_LABELS,
  UNIT_MODIFIERS,
  type CombatContext,
  type DamageType,
  type UnitModifierId,
} from '../units/stats.js';
import { ENV_LABEL_CATALOG, MAX_LABEL_TIER, type EnvLabel, type EnvLabelId } from './labels.js';
import { ITEM_RARITY_LABELS, type ItemRarity } from '../items/rarity.js';
import { UNIT_RULES, type GrantableUnitMark, type UnitRuleId } from '../units/rules.js';
import { timeSavingPercent, musterSpeedAfterTaper } from '../time/speed.js';

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
 *   * **Levels are the investment, and capture is the risk.** A location can be worked up to
 *     {@link MAX_LOCATION_LEVEL} for resources, and the day somebody takes it off you they get it
 *     at the level you left it at. The risk is not that your work is destroyed, it is that you
 *     hand it over: the better you have made a location, the more it is worth to somebody else.
 *   * **Ground is not neutral.** Every location carries its own environment labels (`labels.ts`)
 *     that decide which units are worth bringing, so taking a smuggler's tunnel is a different
 *     problem from taking a rail yard whatever the two are worth.
 *
 * Everything here is hard-authored. Nothing about the city is generated: the point of a map is
 * that players learn it, and you cannot learn a map that is different every time.
 */

/**
 * The map markers and portraits a location can wear, by art key.
 *
 * These were the location kinds until the maintainer removed types (2026-10-14). What a kind used
 * to supply (words, pay, ground, contexts, defence, price, upgrade notes) is now written on every
 * location in the atlas, and the only thing left keyed this way is the picture.
 */
export const LOCATION_ICONS = [
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
  'revolutionary_statue',
  /*
   * Appended rather than filed under "industry and supply", where it belongs by sense.
   * `art/manifest.ts` seeds `icon-location-*` off each icon's index here, so an icon inserted in
   * the middle re-rolls every icon after it. Read the list by meaning, not by position.
   */
  'glasshouse',
  // The Combine's seat, appended for the same reason (maintainer, 2026-09-19).
  'combine_chapel',
  // Terminus's railway, appended for the same reason (maintainer, 2026-09-24). By sense it belongs
  // under "ground and defence": a platform is a piece of the map, not a workshop.
  'rail_station',
  // Arca's tombs, appended for the same reason (maintainer, 2026-10-06). By sense it sits
  // beside the Graveyard: it is the ground the Death Cloaks are raised on.
  'mausoleum',
  /*
   * The rest of Arca's icons (maintainer, 2026-10-06 and 2026-10-07), appended in the order
   * the city was authored. By sense: a workshop and the stores belong under industry, a shrine and
   * a stage under people, a bounty wall under war, a trophy hall under money, a laboratory under
   * knowledge.
   */
  'workshop',
  'shrine',
  'bounty_wall',
  'stage',
  'trophy_hall',
  'laboratory',
  'stores',
] as const;
export const LocationIconSchema = z.enum(LOCATION_ICONS);
export type LocationIcon = z.infer<typeof LocationIconSchema>;

/**
 * What holding a location is worth.
 *
 * A closed union, and every member is read by something: the same rule the building catalogue
 * lives by. A bonus that cannot be spelled as one of these does not get written, because a number
 * on a screen that never moves is worse than no number.
 *
 * Note what is *not* here: unit unlocks. A location that gates a unit does so through the unit's
 * own requirement list (`{ kind: 'location', locationIds }`), so the gate is authored once, on the
 * thing it gates. `unitsUnlockedByLocation` reads it back for display.
 */
/**
 * What every bonus may carry on top of its kind (maintainer, 2026-10-06).
 *
 * `ladder` is the figure at each of the five levels, written out, for a location whose pay the
 * maintainer set level by level ("30% rising to 100%"); `scaledBonus` reads it instead of the
 * scale. `whenDistrictWhole` marks a bonus paid only while the district is held whole, by the
 * holder or their faction: the Saint's Inn's second helping of beds. `level` is stamped by
 * `scaledBonus` on the kinds whose effect the server reads by level rather than by a figure (the
 * Scriptorium's odds, the Chop Shop's rarities, a unit's door).
 */
export interface HoldBonusTuning {
  ladder?: readonly number[];
  whenDistrictWhole?: true;
  level?: number;
  /**
   * The level the ground has to be worked up to before this bonus pays at all (maintainer,
   * 2026-10-09: Box Nine's SAFE DISTANCE and the Mess Room's DRUNK arrive at level 5). Below it
   * the bonus is not on the card and not in the fold (`bonusesAt`).
   */
  fromLevel?: number;
}

/**
 * The stats a flat point bonus can land on. Range and penetration had no channel before; vitality
 * arrived with Trackside Kitchens (maintainer, 2026-10-09), points on the sheet before any
 * percentage, the way Faith and a door add theirs.
 */
export const FLAT_UNIT_STATS = [
  'armor',
  'offense',
  'vitality',
  'range',
  'evasion',
  'speed',
  'stealth',
  'penetration',
] as const;
export type FlatUnitStat = (typeof FLAT_UNIT_STATS)[number];

export type HoldBonus = HoldBonusCore & HoldBonusTuning;

export type HoldBonusCore =
  | { kind: 'resource'; resource: ResourceKey; perHour: number }
  | { kind: 'defense_percent'; percent: number }
  | { kind: 'research_speed'; percent: number }
  | { kind: 'build_speed'; percent: number }
  | { kind: 'muster_speed'; percent: number }
  /** Off every muster, or off one tier's when `tier` is set: Bloodstone's Hiring Hall and the rabble. */
  | { kind: 'muster_cost'; percent: number; tier?: UnitTier }
  | { kind: 'unit_offense'; percent: number }
  | { kind: 'unit_vitality'; percent: number }
  | { kind: 'unit_armor'; percent: number }
  /**
   * The same three unit stats, but only for one tier of unit.
   *
   * A tier-scoped bonus is a different *kind* of decision from a flat one: `+4% offense` makes
   * whatever you already field a little better, while `+8% armour on Heavy` is a reason to field
   * Heavies. It is scoped rather than global so the strong version can be worth more than the
   * weak one without being strictly better than it.
   */
  | { kind: 'unit_tier'; tier: UnitTier; stat: UnitTierStat; percent: number }
  /**
   * Points of morale on every unit, or on one tier of them when `tier` is set (the Martyr's
   * Plinth, maintainer 2026-10-06: "unit morale to rabble only").
   */
  | { kind: 'unit_morale'; flat: number; tier?: UnitTier }
  | { kind: 'unit_speed'; percent: number }
  | { kind: 'unit_stealth'; percent: number }
  | { kind: 'loot_capacity'; percent: number }
  | { kind: 'intimidation'; flat: number }
  | { kind: 'travel_speed'; percent: number }
  /** A percentage more infamy off everything that earns any (§D8). */
  | { kind: 'infamy_gain'; percent: number }
  /** One resource goes further than it should: the same barrel does more work. */
  | { kind: 'resource_yield'; resource: ResourceKey; percent: number }
  /**
   * Every crew that is out comes home sooner (§E). `inDistrict` narrows it to jobs on the board of
   * the district the ground paying it stands in (the Printworks' tunnels, Arca 2026-10-07).
   * A by-city scope existed until the Blockhouse's "twenty per cent off every job in this city"
   * became a level of ANTI-COMBINE (maintainer, 2026-10-07); nothing paid it after that.
   */
  | { kind: 'mission_speed'; percent: number; inDistrict?: true; inCity?: true }
  /**
   * More pay off every run. `inCity` narrows it to jobs worked in the city the ground paying it
   * stands in (Coldwater Halt held whole, maintainer 2026-10-09: "+5% resources from all missions in
   * this city"). Lands in `missionSpoilsPercentByCity`, spent through `missionCityPercentIn`.
   */
  | { kind: 'mission_spoils'; percent: number; inCity?: true }
  /**
   * Off the road legs of every job worked in the city the ground paying it stands in, and not off
   * the time on site (the Bricked Arches, maintainer 2026-10-09). Lands in
   * `missionTravelPercentByCity` and is summed into the road's own cuts at launch, so it bends
   * with them (`travelSpeedCut`).
   */
  | { kind: 'mission_travel'; percent: number }
  /** Off every price the traders quote. */
  | { kind: 'market_discount'; percent: number }
  /**
   * The Broker hands back this much more worth on every trade (the Halt Market, maintainer
   * 2026-10-09). A share of what he pays rather than points off his cut, so it lands after the
   * discount curve and the Trader, in `brokerRate`.
   */
  | { kind: 'broker_rate'; percent: number }
  /** Off what the black market charges in infamy. */
  | { kind: 'black_market_discount'; percent: number }
  /** Off what the workshop charges to refit a unit. */
  | { kind: 'refit_discount'; percent: number }
  /** Off what the garage charges to build and upgrade vehicles. */
  | { kind: 'vehicle_parts'; percent: number }
  /**
   * Off the scrap line of a vehicle's price alone (the Fuelling Point, maintainer 2026-10-09).
   * A plain share of what is left after the parts cut, not more points on that curve, so it is
   * worth the same five per cent to a crew with a Rail Yard as to one without.
   */
  | { kind: 'vehicle_scrap'; percent: number }
  /** Off the oil the Generator's paid burn costs (Shaft Nine, maintainer 2026-10-09). */
  | { kind: 'boost_oil'; percent: number }
  /** Off what the supply run charges, after every other cut (the Long Bond, 2026-10-09). */
  | { kind: 'supply_discount'; percent: number }
  /** Damage and vitality on every unit of one tier (the Marshalling Yards held whole, 2026-10-09). */
  | { kind: 'tier_strength'; tier: UnitTier; percent: number }
  /**
   * Every vehicle's own pace, so a column carried by machines moves faster (the Coaling Stage,
   * maintainer 2026-10-09). Read through `machineSpeed` everywhere a column's pace is worked out.
   */
  | { kind: 'vehicle_speed'; percent: number }
  /**
   * More unit slots on every vehicle, each machine's seats rounded up (the Hump, maintainer
   * 2026-10-09). Read through `vehicleSeats` everywhere a seat is counted.
   */
  | { kind: 'vehicle_capacity'; percent: number }
  /** Damage and vitality on units fighting as a gate's garrison (Ironmouth held whole, 2026-10-09). */
  | { kind: 'gate_fight'; percent: number }
  /**
   * The Cold Store (maintainer, 2026-10-09): for every one of your Stitchers in a fight, every
   * other unit on your side gets `flat` vitality, one a level and not doubled at the top, so a
   * level-2 store and three Stitchers is +6. Added to the finished sheet in `buildStacks`.
   */
  | { kind: 'stitcher_vitality'; flat: number }
  /**
   * The Crate Ring (maintainer, 2026-10-09): the Geppetto's door, named in his requirements, and
   * the level his robots fight at (`units/ad-hoc-army.ts`). The level is stamped; nothing else.
   */
  | { kind: 'ad_hoc_army' }
  /** Damage on every unit that deals this type (the Ground Array's Energy, 2026-10-09). */
  | { kind: 'damage_type_offense'; damageType: DamageType; percent: number }
  /** One tier musters this much faster and cheaper (Telemetry Hill held whole, 2026-10-09). */
  | { kind: 'tier_muster'; tier: UnitTier; percent: number }
  /**
   * The Technicians' Bunkroom (2026-10-09): the chance in percent that a finished drill pays one
   * point more in the attribute it trained, rolled once per session off its id.
   */
  | { kind: 'drill_bonus'; percent: number }
  /**
   * Percent on damage or vitality for the units a scope names (the Viaduct, 2026-10-13): the units
   * with TAUNT (the Arch Battery), or the units with range above a figure (the Parapet). Lands in
   * `unitStatPercents`, read in `effectiveStats` beside the tier and kind percentages.
   */
  | {
      kind: 'unit_stat_percent';
      stat: 'offense' | 'vitality';
      percent: number;
      rule?: 'taunts';
      rangeAbove?: number;
      /** Range at this figure or more (the Tower Box, 2026-10-14), where `rangeAbove` is strictly over. */
      rangeAtLeast?: number;
    }
  /**
   * Lampman's Row (maintainer, 2026-10-09): a switch the holder throws between the lamps lit and
   * the lamps out. Lit, the district's Dark and Foggy come down a tier per level; out, they go up
   * as far. At level 5 it reaches every location in the city, four tiers. The state lives on the
   * control row and the labels are worked out in `city/ground-labels.ts`; nothing is folded.
   */
  | { kind: 'lamps_switch' }
  /**
   * Player XP for every press at the Scrapyard that builds something: a structure card, a unit
   * card or a trap (the Spoil Heap, maintainer 2026-10-09). Paid through `awardPlayerXp`.
   */
  | { kind: 'scrapyard_xp'; flat: number }
  /** Extra §F2 training sessions a day, on top of what the crew is entitled to. */
  | { kind: 'training_sessions'; flat: number }
  /** Syringes a crew can hand out before a fight. One is one unit brought back to strength. */
  | { kind: 'battle_stims'; flat: number }
  /** A share of what dies comes back as caps rather than as nothing. */
  | { kind: 'salvage_refund'; percent: number }
  /** Points on every spy job this crew sends: what the runners come home with. */
  | { kind: 'intel'; percent: number }
  /** Flat points on every officer's attributes in one group, training the crew cannot buy. */
  | { kind: 'officer_group'; group: AttributeGroup; flat: number }
  /**
   * The same on one named skill of every officer (maintainer, 2026-10-06: the Bulb-String Loft's
   * Communication and Signals, the Wake House's Empathy and Resolve). Not the perk kind
   * `officer_attribute`, which skips the officer carrying it: ground lifts everyone.
   */
  | { kind: 'officer_skill'; attribute: AttributeName; flat: number }
  /**
   * §A1: beds, on top of the flat {@link UNIT_SLOTS_PER_LOCATION} every held location gives.
   *
   * For the handful of locations that are somewhere people actually live or eat. A camp at the
   * green belt fence houses hundreds; a Cinema houses nobody, however much they like it there.
   */
  | { kind: 'unit_slots'; flat: number }
  /*
   * The rules (maintainer brief, 2026-09-09).
   *
   * Everything above this line is a figure going up or a price coming down, and a catalogue of
   * nothing but those reads as one slider with forty labels on it. Each of these changes what
   * *happens* instead: what a porter is allowed to do, what the sky is worth, which sheet the
   * enemy has to deal with first. They carry no percentage on purpose, so a card cannot quote one.
   */
  /**
   * The porters take a place in the line, at their own full sheet (maintainer, 2026-09-27).
   *
   * `combat: false` is otherwise absolute: a Scavenger is never in a battle line, never draws fire
   * and contributes nothing (`units/catalog.ts`). This suspends that for the crew that holds it,
   * which is a different thing from a damage bonus: it changes what a *unit* is for. A crew with
   * this can send forty porters on a raid and have them be forty units rather than forty
   * bystanders. They were halved on top of that until 2026-09-27; a porter's own weak numbers are
   * what stop the cheapest sheet in the game becoming the best one.
   */
  | { kind: 'carriers_fight' }
  /**
   * One named unit picks up a mark it was not written with (`units/rules.ts`).
   *
   * The narrowest of these and the one that reads most like a decision: it does nothing at all
   * unless you field that unit, and it changes what fielding it means rather than how much of it
   * you get. A rung that makes your Wardens open fire is a reason to build a crew around Wardens.
   */
  | { kind: 'unit_mark'; unitId: string; mark: GrantableUnitMark }
  /**
   * A modifier handed to one unit, drawn in gold where `golden` says so (Arch Nineteen's Terror for
   * the Hollow Men at level 5, 2026-10-13). Lands in `unitModifiers`; `markedUnit` puts it on the
   * sheet the engine and the card both read.
   */
  | { kind: 'unit_modifier'; unitId: string; modifier: UnitModifierId; golden?: true }
  /**
   * Vitality percent on each unit for every modification fitted to it (the Sappers' Store,
   * 2026-10-13). Lands in `modificationVitalityPercent`.
   */
  | { kind: 'modification_vitality'; percent: number }
  /**
   * More damage from every unit of yours against units of one tier (the Holding Pens' Rabble,
   * 2026-10-13). Lands in `offenseVsTierPercent`, spent per shot in the engine's `fireRound`.
   */
  | { kind: 'offense_vs_tier'; tier: UnitTier; percent: number }
  /**
   * The Transit Clinic (2026-10-14): every body of yours that dies in a fight heals your most
   * damaged living body by this share of the dead one's vitality. Lands in `deathHealPercent`,
   * spent in the engine's `transitClinic`.
   */
  | { kind: 'death_heal'; percent: number }
  /**
   * More infamy off fights alone: declared fights and battle missions (the Last Platform held
   * whole, 2026-10-14). Lands in `battleInfamyPercent`, beside `infamy_gain`, which pays on all.
   */
  | { kind: 'battle_infamy'; percent: number }
  /**
   * Ground labels the crew's units are immune to in a fight (the Frontier Chapel's Eerie,
   * 2026-10-14). Lands in `labelImmunities`, which the standing fold adds to `ignoredLabels`.
   */
  | { kind: 'ignore_label'; label: EnvLabelId }
  /** Off every location upgrade's bill (the Records Office, 2026-10-14). */
  | { kind: 'location_upgrade_discount'; percent: number }
  /**
   * The Reactor Shed (2026-10-14): the holder names one unit type to carry RADIOACTIVE, locked for
   * `REACTOR_LOCK_MS` once named. The choice lives on the control row; the fold lists the shed in
   * `reactorSheds` and the standing fold turns its choice into a granted mark.
   */
  | { kind: 'reactor_choice' }
  /**
   * The Cold Sidings (2026-10-14): this much of one resource for every body of yours that dies in
   * a fight, credited after it. Lands in `deathSalvagePerBody`.
   */
  | { kind: 'death_salvage'; resource: ResourceKey; perBody: number }
  /**
   * Nobody runs because somebody else did.
   *
   * The morale cascade is how a fight in this engine is actually lost: one stack breaks, the next
   * one is shaken by it, and a force that was ahead on casualties walks off the ground in two
   * rounds (`battle/morale.ts`). This cuts the cascade term out of the crew's own morale phase, so
   * a line still breaks from its own losses and from what is opposite it, and never from the panic
   * beside it. A percentage of morale could not say that: it would slow every collapse rather than
   * stopping the one that spreads.
   */
  | { kind: 'steady_nerve' }
  /**
   * A platform on Terminus's line (maintainer, 2026-09-24).
   *
   * Hold the Station in two districts, yourself or through a mate at your table (maintainer,
   * 2026-10-13), and you may **choose** to put a unit move or a battle column
   * on the train between them: {@link railLinkMinutes} on the rails, set by the level of the
   * Station the train leaves from, whatever the map says the distance is, plus the walk from where
   * the units are to the platform at each end. Any two Stations you hold are linked, not only
   * neighbouring ones, because a train runs the whole line.
   *
   * Carries no percentage, and could not. `travel_speed` is a fraction of a clock and this
   * *replaces* the clock for the middle leg, so a Rail Yard cannot make a linked run faster; only
   * working the departure platform up does. It is also the one travel rule in the game a player turns on and
   * off per journey, because riding is not always what you want: `vehicles` and the Colossus
   * cannot board, so a column that takes the train leaves them behind.
   *
   * Missions and spy jobs do not ride it. Those are crews sent out to work the ground rather than
   * to arrive somewhere, and a mission board that priced half its jobs off a railway would be
   * pricing the wrong thing.
   */
  | { kind: 'rail_link' }
  /**
   * A Mausoleum, Arca's city special (maintainer, 2026-10-06). One in every contested
   * district there. Holding any one lets the crew muster the Death Cloaks; every one held is
   * counted, because their `faith` rule pays per Mausoleum and so does their muster cap.
   */
  | { kind: 'faith' }
  /*
   * Arca's own channels (maintainer, 2026-10-06 and 2026-10-07). Each is a figure or a rule
   * one location in the city pays and nothing else did before it; the folded field each lands in
   * is named beside it, and the lane that spends the field is named in `docs/DISTRICTS.md`.
   */
  /**
   * Flat points on one unit stat, for every unit or for the ones a scope names: a tier (the
   * Casting Pit's armour on Heavies), a damage type (the Hammer Yard's blunt units), or the units
   * carrying the GUARD rule (the Cloister Wall). Lands in `unitStatFlats`.
   */
  | {
      kind: 'unit_stat_flat';
      stat: FlatUnitStat;
      flat: number;
      tier?: UnitTier;
      damageType?: DamageType;
      rule?: 'guard';
      /** One unit by id: Box Nine's Snipers, the Mess Room's Breakers (2026-10-09). */
      unitId?: string;
    }
  /** Loot slots on every carrier, flat: the Straw Sack's bags. Lands in `carrierLootFlat`. */
  | { kind: 'carrier_loot_flat'; flat: number }
  /**
   * A switch the holder throws (the Tolling Tower): on, every location in the district is Noisy
   * and the holder's own units ignore Noisy everywhere. Whether it is on lives on the control row.
   */
  | { kind: 'noise_switch' }
  /** A blueprint page a day, of a blueprint not yet finished, at odds set by the level. */
  /**
   * Blueprint pages a day, of blueprints not yet finished and pages not yet held. One a day at the
   * odds of the level (the Scriptorium), or, where the ladders are set, `counts` pages a day at the
   * odds of row `odds` of `RARITY_ODDS_BY_LEVEL` (the Seized Goods Office, maintainer 2026-10-09).
   */
  | { kind: 'daily_page'; counts?: readonly number[]; odds?: readonly number[] }
  /** Units pinned on a wall fight the holder at a discount. `pins` is how many the wall holds. */
  | { kind: 'pamphlets'; pins: number }
  /** A chance, each day, of one battle stim in the stash. */
  | { kind: 'daily_stim'; percent: number }
  /** Points on the Infirmary's recovery of the crew's own casualties. */
  | { kind: 'casualty_recovery'; percent: number }
  /**
   * The ground a unit is mustered on, by unit rather than by kind of place (the Saint's Shrine,
   * the Watch Cell, the Crimson Stage, the Reliquary Lab). The location's level is the unit's
   * door level, which `units/catalog.ts` spells out as `doorSteps`.
   */
  | { kind: 'unit_door'; unitId: string }
  /** Off every drill's clock. */
  | { kind: 'training_time'; percent: number }
  /**
   * The Bounty Wall: each battle job dealt on this district's board has `chancePercent` of being
   * golden, and a golden job pays `rewardPercent` more.
   */
  | { kind: 'golden_jobs'; chancePercent: number; rewardPercent: number }
  /** Components a day, at rarities set by the level. */
  /**
   * Components a day. Their rarity is rolled off the level (`RARITY_ODDS_BY_LEVEL`, the Chop Shop),
   * or fixed per level where `rarities` names one for each of the five (the Wagon Breakers,
   * maintainer 2026-10-09).
   */
  | { kind: 'daily_component'; count: number; rarities?: readonly ItemRarity[] }
  /** The Trophy Hall: a daily pay per unit type killed while it is held. */
  | { kind: 'trophies' }
  /** Points spies must beat to read this crew. */
  | { kind: 'spy_defence'; percent: number }
  /** More XP off every run. */
  | { kind: 'mission_xp'; percent: number }
  /** Bigger stores, every shelf but caps. */
  | { kind: 'storage'; percent: number }
  /** Each modification fitted on a producing structure makes it produce this much more. */
  | { kind: 'modification_output'; percent: number }
  /** Units sent into a faction mate's fight fight harder. */
  | { kind: 'ally_fight'; percent: number }
  /** More caps off every run. */
  | { kind: 'mission_caps'; percent: number }
  /** Player XP for each unit slot of the crew's own dead. */
  | { kind: 'xp_per_loss'; perSlot: number }
  /** Armour per modification fitted on a unit, stacking inside the cap. */
  | { kind: 'modification_armor'; flat: number }
  /** A bigger payroll book. */
  | { kind: 'payroll'; percent: number }
  /** While the named legend is alive in the force, every unit in it gets this. */
  | {
      kind: 'legend_aura';
      unitId: string;
      stat: 'offense_vitality' | 'penetration';
      amount: number;
    }
  /** One level of ANTI-COMBINE on every unit: +10% offense and vitality against the Combine. */
  | { kind: 'anti_combine' }
  /** Enemy units that were intimidated pay this much more infamy when they die. */
  | { kind: 'intimidated_infamy'; percent: number };

/**
 * How far a location can be worked up, and what each level is worth.
 *
 * Five levels (maintainer, 2026-10-06), down from ten. A location is a post on a board, and the
 * interesting question about a post is whether it is worth pouring anything into when somebody
 * could take it tomorrow: a capture keeps the level, so the work is not destroyed, it changes
 * hands. Ten levels made that ladder a slow walk through steps nobody could feel; five keeps every
 * upgrade a decision, and every one of them visible on the card.
 *
 * ## Why these two curves
 *
 * `LEVEL_SCALE` is linear and whole, with the last level a double step (maintainer, 2026-10-09:
 * "the final level is a double step"): a location at level 5 is worth six times what it was on the
 * day it was taken. Every curve below is read off {@link LEVEL_STEPS}. Linear rather than compounding
 * because the same multiplier lands on resource rates *and* on percentages: a 25% defence bonus
 * compounded five times is a location nobody can retake. A kind whose top would be too strong at
 * five times carries its own `levelScale` in the catalogue; a location whose pay the maintainer
 * set level by level carries a `ladder` on the bonus instead.
 *
 * `UPGRADE_COST_SCALE` is the old ladder read at every second step: the upgrade to level n costs
 * what the upgrade to level 2n cost before, so the last one is still 33.7x the base and the whole
 * climb about 64x, against the old climb's 110x. The clock compresses the same way
 * (`UPGRADE_SECONDS_SCALE`, `city/upgrade.ts`). The late levels stay a long investment, and taking
 * a worked location off somebody stays the cheaper way to own one, which is the point: the map is
 * meant to be fought over rather than farmed.
 */
export const MAX_LOCATION_LEVEL = 5;

/**
 * Steps above level 1 at each level: one a level, and two for the last (maintainer, 2026-10-09:
 * "levels 1 to 4 step evenly, level 5 adds two steps"). Every per-level curve on a location is a
 * line through these, so the double final step is one table.
 */
export const LEVEL_STEPS: readonly number[] = [0, 1, 2, 3, 5];

/** The steps above level 1 a location at this level has taken. */
export function levelSteps(level: number): number {
  return LEVEL_STEPS[clampLevel(level) - 1] as number;
}

/**
 * Terminus's line: how long the middle leg of a linked journey takes, in minutes, by the level of
 * the Station the train **leaves** from (maintainer, 2026-10-09).
 *
 * A rule rather than a slider (maintainer, 2026-09-24). It replaces the road between two held
 * Stations instead of discounting it, so no road bonus touches it. Directional: from a level 2
 * platform to a level 1 one is 13 minutes, and the way back is 15. The walk to the platform at
 * each end is charged on top, at the ordinary road rate, which is what keeps a Station worth taking
 * in the district you actually work in.
 */
export const RAIL_LINK_MINUTES: readonly number[] = LEVEL_STEPS.map((step) => 15 - 2 * step);

/** The rails from a Station at this level to any other Station the crew holds. */
export function railLinkMinutes(departureLevel: number): number {
  return RAIL_LINK_MINUTES[clampLevel(departureLevel) - 1] as number;
}

/**
 * What a Station's ticket office pays in caps an hour at each level, from its level 1 figure
 * (maintainer, 2026-10-09). Half the opening figure again per step, so 20 runs 20, 30, 40, 50, 70.
 * The growth rule is this one line; a flat ten a step would be `start + 10 * step`.
 */
export function stationCapsLadder(start: number): number[] {
  return LEVEL_STEPS.map((step) => Math.round(start * (1 + 0.5 * step)));
}

/**
 * What a Station pays: the line, and caps off the ticket office. Every Station on the map carries
 * this as its own list (`atlas.ts`), because the caps are set by the district it stands in.
 */
export function stationBonuses(capsAtLevelOne: number): HoldBonus[] {
  return [
    { kind: 'rail_link' },
    {
      kind: 'resource',
      resource: 'caps',
      perHour: capsAtLevelOne,
      ladder: stationCapsLadder(capsAtLevelOne),
    },
  ];
}

/**
 * Whether a location is a Station: it carries the line (`rail_link`). The rails, the railway feats
 * and the boarding screen all ask this one question.
 */
export function isStation(location: Pick<Location, 'bonuses'>): boolean {
  return location.bonuses.some((bonus) => bonus.kind === 'rail_link');
}

export const LEVEL_SCALE: readonly number[] = LEVEL_STEPS.map((step) => 1 + step);

/**
 * Lampman's Row (maintainer, 2026-10-09): how far the lamps reach at a level. Levels 1 to 4 move
 * Dark and Foggy that many tiers on every location in the district; level 5 moves them the whole
 * scale, four tiers, on every location in the city.
 */
export function lampsReach(level: number): { tiers: number; wholeCity: boolean } {
  const at = clampLevel(level);
  return at >= MAX_LOCATION_LEVEL
    ? { tiers: MAX_LABEL_TIER, wholeCity: true }
    : { tiers: at, wholeCity: false };
}

/** The labels the lamps move. */
export const LAMP_LABELS: readonly EnvLabelId[] = ['dark', 'foggy'];

/** How long after a throw of the lamps they may be thrown again. */
export const LAMPS_COOLDOWN_MS = 6 * 3_600_000;

/** How long a Reactor Shed's choice of unit is locked once made (maintainer, 2026-10-14). */
export const REACTOR_LOCK_MS = 12 * 3_600_000;

/** When the shed's choice may next be changed, or null when it may be changed now. */
export function reactorChangesAt(chosenAt: string | null, now: Date): string | null {
  if (chosenAt === null) return null;
  const at = Date.parse(chosenAt) + REACTOR_LOCK_MS;
  return at > now.getTime() ? new Date(at).toISOString() : null;
}

/**
 * The maintainer's rule for a figure given as "X scaling up to Y" (2026-10-09): six even steps
 * from X to Y, levels 1 to 4 on the first four and level 5 on the last. 10 to 20 is 10, 12, 14,
 * 16, 20; 5 to 10 is 5, 6, 7, 8, 10. Goes on a bonus as its `ladder`.
 */
export function fiveLevelLadder(from: number, to: number): number[] {
  const step = (to - from) / 5;
  const at = (index: number): number => Math.round((from + step * index) * 100) / 100;
  return [at(0), at(1), at(2), at(3), at(5)];
}

/**
 * The gentler ladder for the locations whose figure is a share of a fight (maintainer, 2026-10-06:
 * "decide for each one individually so it is not too OP"): three quarters of the figure a step,
 * so 1, 1.75, 2.5, 3.25 and 4.75 with the double last step. A Hospital's 12% vitality is 57% at 5.
 */
export const COMBAT_LEVEL_SCALE: readonly number[] = LEVEL_STEPS.map((step) => 1 + 0.75 * step);

/**
 * A fifth of the figure a step, for points on an officer's sheet: the Choir's "+5, scaled up to
 * 10" (maintainer, 2026-10-07), so a 5 climbs 5, 6, 7, 8 and 10 with the double last step. It was
 * a quarter a step, 5, 6, 8, 9, 11, until the maintainer ruled that every +5 officer lift is the
 * same ladder (2026-10-11).
 */
export const OFFICER_LEVEL_SCALE: readonly number[] = LEVEL_STEPS.map((step) => 1 + 0.2 * step);

/**
 * What each upgrade costs, as a multiple of the location's own base price: one per upgrade, the climb
 * from 1 to 2 through the climb from 4 to 5, read by the level being left (`upgradeCost`).
 */
export const UPGRADE_COST_SCALE: readonly number[] = [4.5, 8.8, 17.2, 33.7];

/**
 * What every location upgrade is made of, as a ratio against its planks (maintainer, 2026-09-22).
 *
 * One mix for every kind in the catalogue. It used to be authored per kind as a resource bundle,
 * mostly caps with some scrap and timber, and the trouble with that was what it said about the
 * city: a level was something you *bought*, and the number that stopped you was the one resource
 * no structure produces. Working a location up is building work, so it is paid for in building
 * materials, and the shape of the bill is the same wherever you are doing it.
 *
 * Read as percentages of the order it is 50% planks, 5% high-quality metal, 15% scrap, 20% oil
 * and 10% caps, which is the 10 : 1 : 3 : 4 : 2 below. Anchored on planks because planks are the
 * half: an order reading `100 planks, 10 HQ metal, 30 scrap, 40 oil, 20 caps` is one number and
 * four consequences of it.
 *
 * Supplies are deliberately absent. They fed nine of the old bundles and they are food, which is
 * what a crew eats rather than what a roof is made of.
 */
export const UPGRADE_MIX: Readonly<
  Record<'planks' | 'highQualityMetal' | 'scrap' | 'oil' | 'caps', number>
> = {
  planks: 1,
  highQualityMetal: 0.1,
  scrap: 0.3,
  oil: 0.4,
  caps: 0.2,
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
/** The share of a location's officer group lift that is paid (maintainer, 2026-10-05). */
export const GROUND_OFFICER_LIFT_SHARE = 0.5;

export function scaledBonus(
  bonus: HoldBonus,
  level: number,
  /** The location's own ladder, where it sets one (`Location.levelScale`). */
  levelScale: readonly number[] = LEVEL_SCALE,
): HoldBonus {
  const at = clampLevel(level);
  /*
   * A ladder written out beats every curve (maintainer, 2026-10-06): "30% rising to 100%" is
   * five figures, and no multiplier lands on them exactly. The figure replaces whatever the scale
   * would have made of it; `level` is stamped for the bonus kinds the server reads by level alone.
   */
  if (bonus.ladder !== undefined) {
    const figure = bonus.ladder[at - 1] ?? bonus.ladder[bonus.ladder.length - 1] ?? 0;
    return { ...withLadderFigure(bonus, figure), level: at };
  }
  const scale = levelScale[at - 1] as number;
  const grow = (value: number): number => Math.round(value * scale);
  const officer = (value: number): number =>
    Math.max(1, Math.round(value * (OFFICER_LEVEL_SCALE[at - 1] as number)));
  /**
   * The same, for channels counted in whole small things: sessions and syringes.
   *
   * `round(1 × 1.5)` and `round(1 × 2)` are both 2, so a Gym at level 3 paid exactly what it paid
   * at level 2 and the player had bought nothing. Floored at one step per level, so every upgrade
   * of every kind is worth *something*, which is the promise the upgrade button makes.
   */
  const step = (value: number): number =>
    value <= 0 ? value : Math.max(grow(value), value + levelSteps(at));

  switch (bonus.kind) {
    case 'resource':
      return { ...bonus, perHour: grow(bonus.perHour) };
    case 'training_sessions':
    case 'battle_stims':
      return { ...bonus, flat: step(bonus.flat) };
    case 'unit_morale':
    case 'intimidation':
    case 'unit_slots':
      return { ...bonus, flat: grow(bonus.flat) };
    // Whole, unlike the group lift: five on one skill is what the card promises and the ground
    // pays outside the lift cap, so a level buys more of it and nothing halves it. On the
    // officers' own ladder, which doubles over the five levels (maintainer, 2026-10-07).
    case 'officer_skill':
      return { ...bonus, flat: officer(bonus.flat) };
    /*
     * Half, floored, and at least one (maintainer, 2026-10-05), then one more a level. The
     * ground's group lift sits outside the officers' lift cap (`liftedOfficerSheet`), so it is
     * paid in full at every level; at its old size a Chapel at 10 lifted every mental skill of
     * every officer by 28. A Chapel now: +2, +3, +4, +5, +7 at level 5 (the last step double).
     */
    case 'officer_group':
      return {
        ...bonus,
        flat: Math.max(1, Math.floor(bonus.flat * GROUND_OFFICER_LIFT_SHARE)) + levelSteps(at),
      };
    case 'death_salvage':
      return { ...bonus, perBody: grow(bonus.perBody) };
    // One a level, the top not doubled (maintainer, 2026-10-09: "up to +5").
    case 'stitcher_vitality':
      return { ...bonus, flat: bonus.flat * at };
    case 'unit_stat_flat':
    case 'carrier_loot_flat':
    case 'modification_armor':
    case 'scrapyard_xp':
      return { ...bonus, flat: grow(bonus.flat) };
    case 'pamphlets':
      // One pin a level: the wall holds as many pamphlets as it has been worked up.
      return { ...bonus, pins: at, level: at };
    case 'daily_component':
      return { ...bonus, count: grow(bonus.count), level: at };
    // The line is a rule, but a Station's level sets how long the rails out of it take.
    case 'daily_page':
    case 'trophies':
    case 'unit_door':
    case 'rail_link':
    case 'lamps_switch':
    case 'ad_hoc_army':
      return { ...bonus, level: at };
    case 'xp_per_loss':
      return { ...bonus, perSlot: grow(bonus.perSlot) };
    case 'legend_aura':
      return { ...bonus, amount: grow(bonus.amount) };
    case 'golden_jobs':
      return {
        ...bonus,
        chancePercent: Math.min(100, grow(bonus.chancePercent)),
        rewardPercent: grow(bonus.rewardPercent),
      };
    /*
     * The rules do not scale, and that is the point of them.
     *
     * A level buys more of a quantity; there is no more of "the porters may fight". Working one of
     * these up is worth whatever else the place pays, which is the honest reading and also the only
     * one: half a rule is not a thing a card can say.
     */
    case 'carriers_fight':
    case 'steady_nerve':
    case 'unit_mark':
    case 'unit_modifier':
    case 'ignore_label':
    case 'reactor_choice':
    case 'faith':
    case 'noise_switch':
    case 'anti_combine':
      return bonus;
    default:
      return { ...bonus, percent: grow(bonus.percent) };
  }
}

/** The bonus with one figure replaced by a ladder's entry: whichever field carries its size. */
function withLadderFigure(bonus: HoldBonus, figure: number): HoldBonus {
  switch (bonus.kind) {
    case 'resource':
      return { ...bonus, perHour: figure };
    case 'training_sessions':
    case 'battle_stims':
    case 'unit_morale':
    case 'intimidation':
    case 'unit_slots':
    case 'officer_skill':
    case 'officer_group':
    case 'unit_stat_flat':
    case 'carrier_loot_flat':
    case 'modification_armor':
    case 'scrapyard_xp':
    case 'stitcher_vitality':
      return { ...bonus, flat: figure };
    case 'pamphlets':
      return { ...bonus, pins: figure };
    case 'death_salvage':
      return { ...bonus, perBody: figure };
    case 'daily_component':
      return { ...bonus, count: figure };
    case 'xp_per_loss':
      return { ...bonus, perSlot: figure };
    case 'legend_aura':
      return { ...bonus, amount: figure };
    case 'golden_jobs':
      // One ladder, two figures: the chance climbs 20 to 100 and the bounty 10 to 50 together.
      return { ...bonus, chancePercent: figure, rewardPercent: figure / 2 };
    case 'carriers_fight':
    case 'steady_nerve':
    case 'unit_mark':
    case 'unit_modifier':
    case 'ignore_label':
    case 'reactor_choice':
    case 'rail_link':
    case 'faith':
    case 'noise_switch':
    case 'daily_page':
    case 'trophies':
    case 'unit_door':
    case 'anti_combine':
    case 'lamps_switch':
    case 'ad_hoc_army':
      return bonus;
    default:
      return { ...bonus, percent: figure };
  }
}

/**
 * Everything a location is worth at a level, on its own ladder (`levelScale`, else
 * {@link LEVEL_SCALE}).
 */
export function bonusesAt(
  location: Pick<Location, 'bonuses' | 'levelScale'>,
  level: number,
): HoldBonus[] {
  const scale = location.levelScale ?? LEVEL_SCALE;
  const worked = clampLevel(level);
  // A ladder may say nothing at a level (the Exercise Yard's fifth session arrives at level 5
  // alone): a bonus worth nothing is not on the card and not in the fold.
  return location.bonuses
    .filter((bonus) => (bonus.fromLevel ?? 1) <= worked)
    .map((bonus) => scaledBonus(bonus, level, scale))
    .filter(paysSomething);
}

function paysSomething(bonus: HoldBonus): boolean {
  if ('flat' in bonus) return bonus.flat !== 0;
  if ('percent' in bonus) return bonus.percent !== 0;
  if ('perHour' in bonus) return bonus.perHour !== 0;
  if ('count' in bonus) return bonus.count !== 0;
  return true;
}

/**
 * What it costs to take a location from `level` to the next one, or `null` at the ceiling.
 *
 * Scaled off the location's own first-upgrade price rather than a global table, because the locations
 * are not interchangeable: a Cinema is a projector and a Nuclear Plant is a coolant loop, and
 * charging the same for both would make half the map not worth touching.
 */
/** A tenth dearer than the catalogue's figures, as every structure is (2026-10-04). */
export const LOCATION_UPGRADE_PRICE_RISE = 1.1;

export function upgradeCost(
  location: Pick<Location, 'upgradeCost'>,
  level: number,
  /** The Engineer's passive (`passives.ts`, maintainer 2026-10-04): up to half off every line. */
  engineerPercent = 0,
  /** The Records Office (`location_upgrade_discount`, 2026-10-14): off the bill after the Engineer. */
  discountPercent = 0,
): PartialResources | null {
  const from = clampLevel(level);
  if (from >= MAX_LOCATION_LEVEL) return null;
  const scale = UPGRADE_COST_SCALE[from - 1] as number;
  const engineer =
    1 - Math.max(0, Math.min(CHAIR_PASSIVE_CAP.building_cost, engineerPercent)) / 100;
  const records = 1 - Math.max(0, Math.min(100, discountPercent)) / 100;
  const planks = location.upgradeCost * scale * LOCATION_UPGRADE_PRICE_RISE * engineer * records;
  const cost: PartialResources = {};
  for (const [key, share] of Object.entries(UPGRADE_MIX)) {
    // Floored at one. The scarce channel is a tenth of the timber, so the cheapest location's first
    // level would round its high-quality metal to 8 and a hypothetical cheaper one to nothing,
    // and a material the order does not mention is a material the order does not teach.
    cost[key as keyof PartialResources] = Math.max(1, Math.round(planks * share));
  }
  return cost;
}

/**
 * The last level, for every kind, in the player's words.
 *
 * Shared rather than authored per location: see {@link Location.upgrades} for why. The line
 * is about the *holding* rather than the machinery, which is the only way one sentence can be
 * honest about a Gas Station and a Planetarium at the same time.
 */
export const LATE_UPGRADE_NOTES: readonly [string] = [
  'It runs whether anybody is watching or not. This is as far as this ground goes.',
];

/**
 * How many of the notes on a spec are place-specific: levels 2, 3 and 4.
 *
 * Widened to `number` rather than left as the literal `3`, so the guard at the bottom of this file
 * is a runtime check rather than a comparison TypeScript folds away to `never`.
 */
export const AUTHORED_UPGRADE_NOTES: number = 3;

/** What the next level actually *is*, in the player's words, or `null` at the ceiling. */
export function upgradeNote(location: Pick<Location, 'upgrades'>, level: number): string | null {
  const from = clampLevel(level);
  if (from >= MAX_LOCATION_LEVEL) return null;
  const authored = location.upgrades[from - 1];
  return authored ?? (LATE_UPGRADE_NOTES[from - 1 - AUTHORED_UPGRADE_NOTES] as string);
}

/**
 * One authored location on the map, carrying everything it is (maintainer, 2026-10-14: location
 * types removed, so nothing here falls back on a shared kind).
 *
 * The array fields are typed rather than parsed: a location is authored in the atlas and never
 * read off a wire, so the schema is here to shape the object, not to validate a stranger's.
 */
export const LocationSchema = z.object({
  id: z.string().min(1),
  districtId: z.string().min(1),
  name: z.string().min(1),
  /** The art key for its map marker and portrait (`LOCATION_ICONS`). Says nothing about play. */
  icon: LocationIconSchema,
  /** One line for the map tooltip: what this place *is*. */
  blurb: z.string().min(1),
  /** What holding it buys, in the player's words. Derived text would read like a spreadsheet. */
  reward: z.string().min(1),
  /**
   * Everything holding it is worth, at level 1. A list rather than a single bonus, because half
   * the interesting locations do two things: a Gas Station is oil *and* the scrap off the forecourt.
   */
  bonuses: z.custom<readonly HoldBonus[]>((value) => Array.isArray(value)),
  /** What the ground is like, before the sky gets a say (`labels.ts`). */
  labels: z.custom<readonly EnvLabel[]>((value) => Array.isArray(value)),
  /**
   * Which `CombatContext`s hold here, hand-authored rather than derived from the blurb: a context
   * is a promise to the player that a modifier on a unit sheet will fire.
   */
  contexts: z.custom<readonly CombatContext[]>((value) => Array.isArray(value)),
  /**
   * How hard it is to take, on the same 1..10 scale district difficulty uses. Multiplied by the
   * holder's own strength when the skirmish is resolved.
   */
  baseDefense: z.number().min(0),
  /**
   * Planks for the first upgrade, and through {@link UPGRADE_MIX} the whole of its bill. Every
   * later level scales by {@link UPGRADE_COST_SCALE} and {@link LOCATION_UPGRADE_PRICE_RISE}.
   */
  upgradeCost: z.number().int().positive(),
  /**
   * What the first three upgrades actually *are*, in three short lines: level 2, 3 and 4. The last
   * level reads {@link LATE_UPGRADE_NOTES} instead, one line true of any ground held a long time.
   */
  upgrades: z.custom<readonly [string, string, string]>(
    (value) => Array.isArray(value) && value.length === 3,
  ),
  /** Its own ladder over the five levels where {@link LEVEL_SCALE} would make its top too strong. */
  levelScale: z.custom<readonly number[]>((value) => Array.isArray(value)).optional(),
  /** A one-off infamy payment the moment it changes hands. Almost nothing has one. */
  captureInfamy: z.number().optional(),
});
export type Location = z.infer<typeof LocationSchema>;

/** The zero of {@link TerritoryEffects}: also the answer for a crew holding nothing. */
export interface TerritoryEffects {
  /** Added to whatever the district's own structures produce. */
  perHour: PartialResources;
  defensePercent: number;
  /**
   * The share of a holder's toughness that is a gate's: the home Gate, a gate raised on a district
   * held whole, and the perks that make either stronger (maintainer, 2026-09-26).
   *
   * Apart from `defensePercent` because some attackers do not meet it. A Breaching unit's hits land
   * as if it were not there, and a Wall Breaker in the attacking line takes it off the whole fight.
   * The two are curved together (`heldDefense`), so moving the gate here changed no total.
   */
  gatePercent: number;
  researchSpeedPercent: number;
  buildSpeedPercent: number;
  musterSpeedPercent: number;
  musterCostPercent: number;
  /** Off one tier's musters only. See the `muster_cost` bonus's `tier`. */
  musterCostByTier: Partial<Record<UnitTier, number>>;
  unitOffensePercent: number;
  unitVitalityPercent: number;
  /**
   * Added to every unit's armour rating, in points of the 0..100 scale rather than a multiplier.
   *
   * Armour is the one defensive stat that had no channel at all: the map and the crew could buy
   * vitality and offense and nothing could buy the number that decides how much of a hit gets
   * through. Flat because armour is a rating and a percentage of a rating of 8 is nothing.
   */
  unitArmorPercent: number;
  /** Per tier, the three unit stats a bonus can be scoped to. See the `unit_tier` bonus. */
  unitTierPercent: Partial<Record<UnitTier, Partial<Record<UnitTierStat, number>>>>;
  unitMoraleFlat: number;
  /** Morale on one tier only, beside `unitMoraleFlat`. See the `unit_morale` bonus's `tier`. */
  unitTierMoraleFlat: Partial<Record<UnitTier, number>>;
  unitSpeedPercent: number;
  unitStealthPercent: number;
  lootCapacityPercent: number;
  intimidationFlat: number;
  travelSpeedPercent: number;
  /** §D8: a percentage more infamy off everything that earns any. */
  infamyGainPercent: number;
  /** Per resource: the same amount does this much more work than it should. */
  resourceYieldPercent: PartialResources;
  /** §E: every crew that is out is home sooner. */
  missionSpeedPercent: number;
  /** §E: added to a run's pay premium at launch, so every job on the board is worth more. */
  missionSpoilsPercent: number;
  /** §E: the same, on jobs worked in one city only, by city id. See `inCity` on the bonus. */
  missionSpoilsPercentByCity: Record<string, number>;
  /** §E: points off a job's road legs, on jobs in one city only, by city id. See `mission_travel`. */
  /** Mission speed on every job in one city, by city id. See `mission_speed` with `inCity`. */
  missionSpeedPercentByCity: Record<string, number>;
  missionTravelPercentByCity: Record<string, number>;
  marketDiscountPercent: number;
  /** More worth back from the Broker on every trade. See the `broker_rate` bonus. */
  brokerRatePercent: number;
  blackMarketDiscountPercent: number;
  refitDiscountPercent: number;
  vehiclePartsPercent: number;
  /** Off the scrap in a vehicle's price, after the parts cut. See the `vehicle_scrap` bonus. */
  vehicleScrapPercent: number;
  /** Off the oil the Generator's burn costs. See the `boost_oil` bonus. */
  buildBoostOilPercent: number;
  /** Off what the supply run charges. See the `supply_discount` bonus. */
  supplyDiscountPercent: number;
  /** More seats on every vehicle. See the `vehicle_capacity` bonus. */
  vehicleCapacityPercent: number;
  /** More pace on every vehicle. See the `vehicle_speed` bonus. */
  vehicleSpeedPercent: number;
  /** Damage and vitality for units defending at a gate. See the `gate_fight` bonus. */
  gateFightPercent: number;
  /** Vitality every non-Stitcher unit gets per Stitcher in its line. See `stitcher_vitality`. */
  stitcherVitality: number;
  /** The Crate Ring level the Geppetto's robots fight at, 0 when not held. See `ad_hoc_army`. */
  adHocArmyLevel: number;
  /** Damage percent by the damage type a unit deals. See `damage_type_offense`. */
  unitDamageTypeOffense: Partial<Record<DamageType, number>>;
  /** Muster speed percent on one tier's units only. See `tier_muster`. */
  musterSpeedByTier: Partial<Record<UnitTier, number>>;
  /** Chance in percent of a point more off a finished drill. See `drill_bonus`. */
  drillBonusPercent: number;
  /** Scoped damage and vitality percentages. See `unit_stat_percent`. */
  unitStatPercents: UnitStatPercent[];
  /** Player XP for every build pressed at the Scrapyard. See the `scrapyard_xp` bonus. */
  scrapyardXp: number;
  /** §F2: extra sessions in the day. */
  extraTrainingSessions: number;
  /** Adrenaline syringes on hand before a fight. */
  battleStims: number;
  /** A share of what dies comes back as caps. */
  salvageRefundPercent: number;
  /**
   * Points on every spy job this crew sends, read one point a percent (`spying/spying.ts`).
   *
   * Lives here rather than in `CrewEffects` because ground and people push it *equally*: a
   * Watchtower and a Master of Whispers with a Logic of 80 are two ways of buying the same thing, and the
   * whole design of `crew/effects.ts` is that they should land in one channel.
   */
  intelYieldPercent: number;
  /** Flat points on every officer's attributes in a group. What the Chapel and the Station give. */
  officerGroupFlat: Partial<Record<AttributeGroup, number>>;
  /** Flat points on one named skill of every officer. What the Bulb-String Loft gives. */
  officerSkillFlat: Partial<Record<AttributeName, number>>;
  /**
   * §A1: beds the map adds to the district's own.
   *
   * `UNIT_SLOTS_PER_LOCATION` for every location held, plus whatever the locations that house
   * people give on top. Folded in `territoryEffectsFor`, because the flat-per-location part is a
   * fact about *how many* you hold rather than about any one of them.
   */
  unitSlotBonus: number;
  /** Whether the porters may stand in the line. See the `carriers_fight` bonus. */
  carriersFight: boolean;
  /**
   * Marks granted to units that were not written with them, by unit id.
   *
   * A plain record rather than a `Partial<Record<UnitRuleId, ...>>` keyed the other way round,
   * because the engine's question is "what does *this* unit carry", asked once per roster row.
   */
  unitMarks: Record<string, readonly UnitRuleId[]>;
  /** Modifiers handed to units by id, gold or not. See `unit_modifier`. */
  unitModifiers: Record<string, readonly GrantedModifier[]>;
  /** Vitality percent per modification fitted. See `modification_vitality`. */
  modificationVitalityPercent: number;
  /** Damage percent against units of a tier, by the target's tier. See `offense_vs_tier`. */
  offenseVsTierPercent: Partial<Record<UnitTier, number>>;
  /** Share of a dead body's vitality that heals the most hurt one. See `death_heal`. */
  deathHealPercent: number;
  /** More infamy off fights alone. See `battle_infamy`. */
  battleInfamyPercent: number;
  /** Ground labels the crew's units are immune to. See `ignore_label`. */
  labelImmunities: EnvLabelId[];
  /** ...and the held place that grants each, by name, for the unit card's hover (2026-10-15). */
  labelImmunitySources: Partial<Record<EnvLabelId, string>>;
  /** Off every location upgrade's bill. See `location_upgrade_discount`. */
  locationUpgradeDiscountPercent: number;
  /** The Reactor Sheds held, by location id. See `reactor_choice`. */
  reactorSheds: string[];
  /** Resources a dead body of yours is worth after a fight. See `death_salvage`. */
  deathSalvagePerBody: PartialResources;
  /** Whether a stack that broke can shake the ones beside it. See the `steady_nerve` bonus. */
  steadyNerve: boolean;
  /**
   * Whether this crew holds a Station: a platform on Terminus's line.
   *
   * A boolean on the *crew's* effects and a count of platforms nowhere, because one Station is
   * worth nothing on its own. What a journey actually needs is a Station at **both** ends, which
   * is a question about two districts rather than about a crew, so it is asked of the control map
   * where the journey is priced (`city/rails.ts`) and never of this total.
   */
  railLink: boolean;
  /**
   * How many Mausoleums this crew holds: a count, unlike the switches above, because the Death
   * Cloaks' `faith` rule and their muster cap both pay per tomb (`units/catalog.ts`).
   */
  mausoleums: number;
  /*
   * Arca's channels (maintainer, 2026-10-06 and 2026-10-07). Each is filled here by one
   * `HoldBonus` kind of the same name and spent by one reader, named on the kind.
   */
  /** Flat points on a unit stat, each with the scope it was authored with. See `unit_stat_flat`. */
  unitStatFlats: UnitStatFlat[];
  /** Loot slots on every carrier, flat. */
  carrierLootFlat: number;
  /** The Tolling Towers this crew holds, by location id; whether each is on is on its control row. */
  noiseSwitches: string[];
  /** Pages owed each day, one entry a page: the odds row it is drawn at, and which ground pays it. */
  dailyPages: DailyPage[];
  /** §E: the same, on jobs in one district only, by district id. See `inDistrict` on the bonus. */
  missionSpeedPercentByDistrict: Record<string, number>;
  /** The chance, each day, of a stim in the stash. */
  dailyStimPercent: number;
  /** Points on the Infirmary's recovery of the crew's own casualties. */
  casualtyRecoveryPercent: number;
  /** The highest level of a door this crew holds for each unit it opens. See `unit_door`. */
  doorLevels: Record<string, number>;
  /** Off every drill's clock. */
  trainingTimePercent: number;
  /** The Bounty Wall's odds, by district id. */
  goldenJobsByDistrict: Record<string, { chancePercent: number; rewardPercent: number }>;
  /**
   * Components a day from each holding that pays them: how many, at the level that sets their
   * rarity, or at the rarity the ground fixes for its level; and which location, for the notice.
   */
  dailyComponents: DailyComponents[];
  /** Points spies must beat to read this crew. The home Gate adds its own in `standingEffectsFor`. */
  intelResistancePercent: number;
  /** More XP off every run. */
  missionXpPercent: number;
  /** The ground's share of the stores, beside the crew's own `storageCapacityPercent`. */
  storageGroundPercent: number;
  /** Each modification on a producing structure is worth this much more of its output. */
  modificationOutputPercent: number;
  /** Units sent into a faction mate's fight fight this much harder. */
  allyFightPercent: number;
  /** More caps off every run. */
  missionCapsPercent: number;
  /** Player XP per unit slot of the crew's own dead. */
  xpPerSlotLost: number;
  /** Armour per modification fitted on a unit. */
  modificationArmorFlat: number;
  /** A bigger payroll book. */
  payrollPercent: number;
  /** Auras legends cast over the force they fight in. */
  legendAuras: LegendAura[];
  /** Levels of ANTI-COMBINE, one per final district held: +10% each against the Combine. */
  antiCombineLevels: number;
  /** Enemy units that were intimidated pay this much more infamy when they die. */
  intimidatedInfamyPercent: number;
}

/** One flat point bonus on a unit stat, with the scope it was authored with. */
/** One scoped percentage, folded. See the `unit_stat_percent` bonus. */
export interface UnitStatPercent {
  stat: 'offense' | 'vitality';
  percent: number;
  rule?: 'taunts';
  rangeAbove?: number;
  rangeAtLeast?: number;
}

/** A modifier a location hands to a unit, folded. See the `unit_modifier` bonus. */
export interface GrantedModifier {
  modifier: UnitModifierId;
  golden?: true;
}

export interface UnitStatFlat {
  stat: FlatUnitStat;
  flat: number;
  tier?: UnitTier;
  damageType?: DamageType;
  rule?: 'guard';
  unitId?: string;
  /** The plot paying it, for the battle report's reasons and the unit card (2026-10-13). */
  source?: string;
}

/** One page a day owed, folded. See the `daily_page` bonus. */
export interface DailyPage {
  /** The row of `RARITY_ODDS_BY_LEVEL` its rarity is drawn at. */
  level: number;
  locationId?: string;
}

/** The pages a `daily_page` bonus owes at the level it was stamped with. */
function dailyPagesOf(
  bonus: { counts?: readonly number[]; odds?: readonly number[]; level?: number },
  locationId?: string,
): DailyPage[] {
  const at = bonus.level ?? 1;
  const count = bonus.counts?.[at - 1] ?? 1;
  const level = bonus.odds?.[at - 1] ?? at;
  return Array.from({ length: count }, () => ({
    level,
    ...(locationId === undefined ? {} : { locationId }),
  }));
}

/** One holding's daily components, folded. See the `daily_component` bonus. */
export interface DailyComponents {
  count: number;
  level: number;
  /** The rarity the ground fixes at this level; absent means rolled off the level. */
  rarity?: ItemRarity;
  locationId?: string;
}

/** The rarity a `daily_component` bonus fixes at the level it was stamped with, if it fixes one. */
function fixedRarity(bonus: { rarities?: readonly ItemRarity[]; level?: number }): {
  rarity?: ItemRarity;
} {
  const rarity = bonus.rarities?.[(bonus.level ?? 1) - 1];
  return rarity === undefined ? {} : { rarity };
}

/** What a legend gives the force around it while alive. */
export interface LegendAura {
  unitId: string;
  stat: 'offense_vitality' | 'penetration';
  amount: number;
}

export function noTerritoryEffects(): TerritoryEffects {
  return {
    perHour: {},
    defensePercent: 0,
    gatePercent: 0,
    researchSpeedPercent: 0,
    buildSpeedPercent: 0,
    musterSpeedPercent: 0,
    musterCostPercent: 0,
    musterCostByTier: {},
    unitOffensePercent: 0,
    unitVitalityPercent: 0,
    unitArmorPercent: 0,
    unitTierPercent: {},
    unitMoraleFlat: 0,
    unitSpeedPercent: 0,
    unitStealthPercent: 0,
    lootCapacityPercent: 0,
    intimidationFlat: 0,
    travelSpeedPercent: 0,
    infamyGainPercent: 0,
    resourceYieldPercent: {},
    missionSpeedPercent: 0,
    missionSpoilsPercent: 0,
    missionSpoilsPercentByCity: {},
    missionTravelPercentByCity: {},
    missionSpeedPercentByCity: {},
    marketDiscountPercent: 0,
    brokerRatePercent: 0,
    blackMarketDiscountPercent: 0,
    refitDiscountPercent: 0,
    vehiclePartsPercent: 0,
    vehicleScrapPercent: 0,
    buildBoostOilPercent: 0,
    supplyDiscountPercent: 0,
    vehicleCapacityPercent: 0,
    vehicleSpeedPercent: 0,
    gateFightPercent: 0,
    stitcherVitality: 0,
    adHocArmyLevel: 0,
    unitDamageTypeOffense: {},
    musterSpeedByTier: {},
    drillBonusPercent: 0,
    unitStatPercents: [],
    scrapyardXp: 0,
    extraTrainingSessions: 0,
    battleStims: 0,
    salvageRefundPercent: 0,
    intelYieldPercent: 0,
    officerGroupFlat: {},
    officerSkillFlat: {},
    unitTierMoraleFlat: {},
    unitSlotBonus: 0,
    carriersFight: false,
    unitMarks: {},
    unitModifiers: {},
    modificationVitalityPercent: 0,
    offenseVsTierPercent: {},
    deathHealPercent: 0,
    battleInfamyPercent: 0,
    labelImmunities: [],
    labelImmunitySources: {},
    locationUpgradeDiscountPercent: 0,
    reactorSheds: [],
    deathSalvagePerBody: {},
    steadyNerve: false,
    railLink: false,
    mausoleums: 0,
    unitStatFlats: [],
    carrierLootFlat: 0,
    noiseSwitches: [],
    dailyPages: [],
    missionSpeedPercentByDistrict: {},
    dailyStimPercent: 0,
    casualtyRecoveryPercent: 0,
    doorLevels: {},
    trainingTimePercent: 0,
    goldenJobsByDistrict: {},
    dailyComponents: [],
    intelResistancePercent: 0,
    missionXpPercent: 0,
    storageGroundPercent: 0,
    modificationOutputPercent: 0,
    allyFightPercent: 0,
    missionCapsPercent: 0,
    xpPerSlotLost: 0,
    modificationArmorFlat: 0,
    payrollPercent: 0,
    legendAuras: [],
    antiCombineLevels: 0,
    intimidatedInfamyPercent: 0,
  };
}

/** Where a bonus is paid from, for the kinds that pay somewhere in particular. */
export interface BonusGround {
  districtId?: string | undefined;
  locationId?: string | undefined;
  /** The city that district is in, for the city-scoped kinds. */
  cityId?: string | undefined;
  /** The plot's name, carried on a flat stat bonus so a report can say where it came from. */
  locationName?: string | undefined;
}

/**
 * Folds one bonus into a running total. Mutates `into`. It is the accumulator of a reduce.
 *
 * `districtId` is the district of the ground paying it, which only a district-scoped bonus reads
 * (the Printworks' tunnels, a Bounty Wall's golden jobs), and `cityId` its city, which only a
 * city-scoped one reads (Coldwater Halt's mission pay). One with no ground to belong to pays
 * nothing rather than paying everywhere. Reduce through a lambda: handed over point-free, the
 * reduce's index would arrive as the ground.
 */
export function applyHoldBonus(
  into: TerritoryEffects,
  bonus: HoldBonus,
  ground: BonusGround = {},
): TerritoryEffects {
  const { districtId, locationId, cityId, locationName } = ground;
  switch (bonus.kind) {
    case 'resource':
      into.perHour = {
        ...into.perHour,
        [bonus.resource]: (into.perHour[bonus.resource] ?? 0) + bonus.perHour,
      };
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
    case 'muster_speed':
      into.musterSpeedPercent += bonus.percent;
      return into;
    case 'muster_cost':
      if (bonus.tier === undefined) into.musterCostPercent += bonus.percent;
      else
        into.musterCostByTier[bonus.tier] =
          (into.musterCostByTier[bonus.tier] ?? 0) + bonus.percent;
      return into;
    case 'unit_offense':
      into.unitOffensePercent += bonus.percent;
      return into;
    case 'unit_vitality':
      into.unitVitalityPercent += bonus.percent;
      return into;
    case 'unit_armor':
      into.unitArmorPercent += bonus.percent;
      return into;
    case 'unit_tier': {
      const tier = into.unitTierPercent[bonus.tier] ?? {};
      into.unitTierPercent = {
        ...into.unitTierPercent,
        [bonus.tier]: { ...tier, [bonus.stat]: (tier[bonus.stat] ?? 0) + bonus.percent },
      };
      return into;
    }
    case 'unit_morale':
      if (bonus.tier === undefined) into.unitMoraleFlat += bonus.flat;
      else
        into.unitTierMoraleFlat = {
          ...into.unitTierMoraleFlat,
          [bonus.tier]: (into.unitTierMoraleFlat[bonus.tier] ?? 0) + bonus.flat,
        };
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
      // The Gantry Walk (2026-10-13): the whole clock of every job in this city.
      if (bonus.inCity) {
        if (cityId !== undefined) {
          into.missionSpeedPercentByCity = {
            ...into.missionSpeedPercentByCity,
            [cityId]: (into.missionSpeedPercentByCity[cityId] ?? 0) + bonus.percent,
          };
        }
      } else if (bonus.inDistrict) {
        if (districtId !== undefined) {
          into.missionSpeedPercentByDistrict = {
            ...into.missionSpeedPercentByDistrict,
            [districtId]: (into.missionSpeedPercentByDistrict[districtId] ?? 0) + bonus.percent,
          };
        }
      } else {
        into.missionSpeedPercent += bonus.percent;
      }
      return into;
    case 'mission_spoils':
      if (bonus.inCity) {
        if (cityId !== undefined) {
          into.missionSpoilsPercentByCity = {
            ...into.missionSpoilsPercentByCity,
            [cityId]: (into.missionSpoilsPercentByCity[cityId] ?? 0) + bonus.percent,
          };
        }
      } else {
        into.missionSpoilsPercent += bonus.percent;
      }
      return into;
    case 'market_discount':
      into.marketDiscountPercent += bonus.percent;
      return into;
    case 'broker_rate':
      into.brokerRatePercent += bonus.percent;
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
    case 'vehicle_scrap':
      into.vehicleScrapPercent += bonus.percent;
      return into;
    case 'boost_oil':
      into.buildBoostOilPercent += bonus.percent;
      return into;
    case 'supply_discount':
      into.supplyDiscountPercent += bonus.percent;
      return into;
    case 'tier_strength': {
      const tier = into.unitTierPercent[bonus.tier] ?? {};
      into.unitTierPercent = {
        ...into.unitTierPercent,
        [bonus.tier]: {
          ...tier,
          offense: (tier.offense ?? 0) + bonus.percent,
          vitality: (tier.vitality ?? 0) + bonus.percent,
        },
      };
      return into;
    }
    case 'vehicle_capacity':
      into.vehicleCapacityPercent += bonus.percent;
      return into;
    case 'vehicle_speed':
      into.vehicleSpeedPercent += bonus.percent;
      return into;
    case 'gate_fight':
      into.gateFightPercent += bonus.percent;
      return into;
    case 'stitcher_vitality':
      into.stitcherVitality += bonus.flat;
      return into;
    case 'ad_hoc_army':
      into.adHocArmyLevel = Math.max(into.adHocArmyLevel, bonus.level ?? 1);
      return into;
    case 'damage_type_offense':
      into.unitDamageTypeOffense = {
        ...into.unitDamageTypeOffense,
        [bonus.damageType]: (into.unitDamageTypeOffense[bonus.damageType] ?? 0) + bonus.percent,
      };
      return into;
    case 'tier_muster':
      into.musterCostByTier = {
        ...into.musterCostByTier,
        [bonus.tier]: (into.musterCostByTier[bonus.tier] ?? 0) + bonus.percent,
      };
      into.musterSpeedByTier = {
        ...into.musterSpeedByTier,
        [bonus.tier]: (into.musterSpeedByTier[bonus.tier] ?? 0) + bonus.percent,
      };
      return into;
    case 'drill_bonus':
      into.drillBonusPercent += bonus.percent;
      return into;
    case 'unit_stat_percent': {
      const {
        kind: _kind,
        ladder: _ladder,
        whenDistrictWhole: _whole,
        level: _level,
        fromLevel: _from,
        ...scoped
      } = bonus;
      into.unitStatPercents = [...into.unitStatPercents, scoped];
      return into;
    }
    // On the control row and in the labels (`city/ground-labels.ts`), not in a crew's totals.
    case 'lamps_switch':
      return into;
    case 'scrapyard_xp':
      into.scrapyardXp += bonus.flat;
      return into;
    case 'mission_travel':
      if (cityId !== undefined) {
        into.missionTravelPercentByCity = {
          ...into.missionTravelPercentByCity,
          [cityId]: (into.missionTravelPercentByCity[cityId] ?? 0) + bonus.percent,
        };
      }
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
    case 'unit_slots':
      into.unitSlotBonus += bonus.flat;
      return into;
    case 'officer_group':
      into.officerGroupFlat = {
        ...into.officerGroupFlat,
        [bonus.group]: (into.officerGroupFlat[bonus.group] ?? 0) + bonus.flat,
      };
      return into;
    case 'officer_skill':
      into.officerSkillFlat = {
        ...into.officerSkillFlat,
        [bonus.attribute]: (into.officerSkillFlat[bonus.attribute] ?? 0) + bonus.flat,
      };
      return into;
    // The three switches are ORs rather than counters. Holding a second Tram Depot does not make
    // the porters fight twice, and a channel that counted would invite somebody to read it as a
    // magnitude later.
    case 'carriers_fight':
      into.carriersFight = true;
      return into;
    case 'steady_nerve':
      into.steadyNerve = true;
      return into;
    case 'unit_modifier': {
      const held = into.unitModifiers[bonus.unitId] ?? [];
      if (held.some((one) => one.modifier === bonus.modifier)) return into;
      const granted: GrantedModifier = {
        modifier: bonus.modifier,
        ...(bonus.golden ? { golden: true as const } : {}),
      };
      into.unitModifiers = { ...into.unitModifiers, [bonus.unitId]: [...held, granted] };
      return into;
    }
    case 'modification_vitality':
      into.modificationVitalityPercent += bonus.percent;
      return into;
    case 'death_heal':
      into.deathHealPercent += bonus.percent;
      return into;
    case 'battle_infamy':
      into.battleInfamyPercent += bonus.percent;
      return into;
    case 'location_upgrade_discount':
      into.locationUpgradeDiscountPercent += bonus.percent;
      return into;
    case 'reactor_choice':
      if (locationId !== undefined && !into.reactorSheds.includes(locationId)) {
        into.reactorSheds = [...into.reactorSheds, locationId];
      }
      return into;
    case 'ignore_label':
      if (!into.labelImmunities.includes(bonus.label)) {
        into.labelImmunities = [...into.labelImmunities, bonus.label];
      }
      if (locationName !== undefined && into.labelImmunitySources[bonus.label] === undefined) {
        into.labelImmunitySources = { ...into.labelImmunitySources, [bonus.label]: locationName };
      }
      return into;
    case 'death_salvage':
      into.deathSalvagePerBody = {
        ...into.deathSalvagePerBody,
        [bonus.resource]: (into.deathSalvagePerBody[bonus.resource] ?? 0) + bonus.perBody,
      };
      return into;
    case 'offense_vs_tier':
      into.offenseVsTierPercent = {
        ...into.offenseVsTierPercent,
        [bonus.tier]: (into.offenseVsTierPercent[bonus.tier] ?? 0) + bonus.percent,
      };
      return into;
    case 'unit_mark': {
      const held = into.unitMarks[bonus.unitId] ?? [];
      // Deduplicated: two holdings granting the same mark grant it once, and a mark the sheet
      // already carries is not a second copy of anything.
      into.unitMarks = held.includes(bonus.mark)
        ? into.unitMarks
        : { ...into.unitMarks, [bonus.unitId]: [...held, bonus.mark] };
      return into;
    }
    case 'rail_link':
      into.railLink = true;
      return into;
    // Counted, not switched: the second tomb is worth exactly as much as the first.
    case 'faith':
      into.mausoleums += 1;
      return into;
    case 'unit_stat_flat': {
      const {
        kind: _kind,
        ladder: _ladder,
        whenDistrictWhole: _whole,
        level: _level,
        fromLevel: _from,
        ...scoped
      } = bonus;
      into.unitStatFlats = [
        ...into.unitStatFlats,
        { ...scoped, ...(locationName === undefined ? {} : { source: locationName }) },
      ];
      return into;
    }
    case 'carrier_loot_flat':
      into.carrierLootFlat += bonus.flat;
      return into;
    case 'noise_switch':
      if (locationId !== undefined) into.noiseSwitches = [...into.noiseSwitches, locationId];
      return into;
    case 'daily_page':
      into.dailyPages = [...into.dailyPages, ...dailyPagesOf(bonus, locationId)];
      return into;
    // On the control row, not in a crew's totals: the wall's capacity is its level
    // (`pamphletCapacity`) and the pins are on the row. A `pamphletPins` channel nothing read
    // was folded here until 2026-10-13.
    case 'pamphlets':
      return into;
    case 'daily_stim':
      into.dailyStimPercent += bonus.percent;
      return into;
    case 'casualty_recovery':
      into.casualtyRecoveryPercent += bonus.percent;
      return into;
    case 'unit_door':
      into.doorLevels = {
        ...into.doorLevels,
        [bonus.unitId]: Math.max(into.doorLevels[bonus.unitId] ?? 0, bonus.level ?? 1),
      };
      return into;
    case 'training_time':
      into.trainingTimePercent += bonus.percent;
      return into;
    case 'golden_jobs':
      if (districtId !== undefined) {
        const held = into.goldenJobsByDistrict[districtId] ?? {
          chancePercent: 0,
          rewardPercent: 0,
        };
        into.goldenJobsByDistrict = {
          ...into.goldenJobsByDistrict,
          [districtId]: {
            chancePercent: Math.min(100, held.chancePercent + bonus.chancePercent),
            rewardPercent: held.rewardPercent + bonus.rewardPercent,
          },
        };
      }
      return into;
    case 'daily_component':
      into.dailyComponents = [
        ...into.dailyComponents,
        {
          count: bonus.count,
          level: bonus.level ?? 1,
          ...(locationId === undefined ? {} : { locationId }),
          ...fixedRarity(bonus),
        },
      ];
      return into;
    // The hall's pay reads the control rows it is tallied on (`trophiesHeld`); a level channel
    // nothing read was folded here until 2026-10-13.
    case 'trophies':
      return into;
    case 'spy_defence':
      into.intelResistancePercent += bonus.percent;
      return into;
    case 'mission_xp':
      into.missionXpPercent += bonus.percent;
      return into;
    case 'storage':
      into.storageGroundPercent += bonus.percent;
      return into;
    case 'modification_output':
      into.modificationOutputPercent += bonus.percent;
      return into;
    case 'ally_fight':
      into.allyFightPercent += bonus.percent;
      return into;
    case 'mission_caps':
      into.missionCapsPercent += bonus.percent;
      return into;
    case 'xp_per_loss':
      into.xpPerSlotLost += bonus.perSlot;
      return into;
    case 'modification_armor':
      into.modificationArmorFlat += bonus.flat;
      return into;
    case 'payroll':
      into.payrollPercent += bonus.percent;
      return into;
    case 'legend_aura':
      into.legendAuras = [
        ...into.legendAuras,
        { unitId: bonus.unitId, stat: bonus.stat, amount: bonus.amount },
      ];
      return into;
    case 'anti_combine':
      into.antiCombineLevels += 1;
      return into;
    case 'intimidated_infamy':
      into.intimidatedInfamyPercent += bonus.percent;
      return into;
  }
}

/** Short resource names for the one-line bonus text. Kept here so this module stands alone. */
const RESOURCE_LABELS: Record<ResourceKey, string> = {
  caps: 'caps',
  supplies: 'supplies',
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

/**
 * What the cards on the two curved channels add (`heldDefense`, `cohesionWidening`): the more of it
 * a crew stacks, the less each point is worth, and there is no point where it stops paying.
 */
export const TAPERS = '(tapers, no hard stop)';

/** A bonus in one line, for a location card. Authored `reward` says *why*; this says how much. */
/**
 * A unit's name for a card, looked up by whoever has the catalogue. This module cannot read
 * `units/catalog.ts` (it reads this one), so a caller with the names passes them in; without one
 * the id is spelt out, which a test can read and a player should never meet.
 */
export type UnitNamer = (unitId: string) => string;
const spellOut: UnitNamer = (unitId) =>
  unitId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export function describeHoldBonus(bonus: HoldBonus, unitName: UnitNamer = spellOut): string {
  const whole = bonus.whenDistrictWhole ? ' while the whole district is held' : '';
  switch (bonus.kind) {
    case 'resource':
      return `+${bonus.perHour} ${RESOURCE_LABELS[bonus.resource]}/h`;
    // Held ground bends rather than stops (`heldDefense`, maintainer 2026-10-01), and the card
    // says so, since a player stacking defence is owed the shape of what they are buying.
    case 'defense_percent':
      return `+${bonus.percent}% defence ${TAPERS}`;
    // Research and build speed are points added to the Lab's cards or the Generator's and the
    // crew's, and the sum is curved (`researchTimeCut`, `buildTimeCut`), so the card says points,
    // as the crew page does (P7-A, 2026-10-02). Muster speed is still a divisor after its taper.
    case 'research_speed':
      return `+${bonus.percent} points off the research clock`;
    case 'build_speed':
      return `+${bonus.percent} points off the build clock`;
    case 'muster_speed':
      return `-${timeSavingPercent(musterSpeedAfterTaper(bonus.percent))}% muster time`;
    case 'muster_cost':
      return bonus.tier === undefined
        ? `-${bonus.percent}% muster cost`
        : `-${bonus.percent}% muster cost on ${UNIT_TIER_LABELS[bonus.tier]} units`;
    case 'unit_offense':
      return `+${bonus.percent}% unit offense`;
    case 'unit_vitality':
      return `+${bonus.percent}% unit vitality`;
    case 'unit_morale':
      return bonus.tier === undefined
        ? `+${bonus.flat} unit morale`
        : `+${bonus.flat} morale for ${UNIT_TIER_LABELS[bonus.tier]} units`;
    case 'unit_speed':
      return `+${bonus.percent}% unit speed`;
    case 'unit_stealth':
      return `+${bonus.percent}% unit stealth`;
    case 'loot_capacity':
      return `+${bonus.percent}% loot capacity`;
    case 'intimidation':
      return `+${bonus.flat} intimidation`;
    case 'travel_speed':
      // A cut off the clock, not a rise in speed: the road is `roadMinutes`, where the ground's
      // percent multiplies what the column's own speed left. Said the way the vehicle discount is.
      return `-${bonus.percent} points off the road ${TAPERS}`;
    case 'infamy_gain':
      return `+${bonus.percent}% infamy earned`;
    case 'resource_yield':
      return `${RESOURCE_LABELS[bonus.resource]} goes ${bonus.percent}% further`;
    case 'mission_speed':
      // The saving the clock gives for this card alone, through the curve (`missionSpeedCut`).
      return `-${timeSavingPercent(missionSpeedCut(bonus.percent))}% mission time${bonus.inDistrict ? ' in this district' : bonus.inCity ? ' in this city' : ''} ${TAPERS}`;
    // Points into the market's curve (`effectiveMarketDiscount`), not a percent off the till: a
    // level 10 Downtown Market printed "-55%" over a till charging 28.7% less (bug pass, 2026-10-05).
    case 'market_discount':
      return `-${bonus.percent} points off market prices ${TAPERS}`;
    case 'broker_rate':
      return `+${bonus.percent}% better rate at the Broker`;
    case 'black_market_discount':
      return `-${bonus.percent} points off black-market infamy ${TAPERS}`;
    case 'refit_discount':
      return `-${bonus.percent} points off unit modification cost ${TAPERS}`;
    case 'vehicle_parts':
      return `-${bonus.percent} points off vehicle cost ${TAPERS}`;
    case 'vehicle_scrap':
      return `-${bonus.percent}% scrap in vehicle cost`;
    case 'boost_oil':
      return `-${bonus.percent}% oil on the Generator's burn`;
    case 'supply_discount':
      return `-${bonus.percent}% on resources bought on the supply run`;
    case 'tier_strength':
      return `+${bonus.percent}% damage and vitality for ${UNIT_TIER_LABELS[bonus.tier]} units`;
    case 'vehicle_capacity':
      return `+${bonus.percent}% unit slots on every vehicle, rounded up`;
    case 'vehicle_speed':
      return `+${bonus.percent}% speed on every vehicle`;
    case 'gate_fight':
      return `+${bonus.percent}% damage and vitality for units defending at a gate`;
    case 'stitcher_vitality':
      return `+${bonus.flat} vitality on every other unit in the fight for each of your Stitchers`;
    case 'damage_type_offense':
      return `+${bonus.percent}% damage for your ${DAMAGE_TYPE_LABELS[bonus.damageType]} units`;
    case 'tier_muster':
      return `${UNIT_TIER_LABELS[bonus.tier]} units muster ${bonus.percent}% faster and cost ${bonus.percent}% less`;
    case 'unit_stat_percent': {
      const stat = bonus.stat === 'offense' ? 'damage' : 'vitality';
      const who =
        bonus.rule === 'taunts'
          ? 'units with Taunt'
          : bonus.rangeAbove !== undefined
            ? `units with range above ${bonus.rangeAbove}`
            : bonus.rangeAtLeast !== undefined
              ? `units with range ${bonus.rangeAtLeast} or more`
              : 'every unit';
      return `+${bonus.percent}% ${stat} for ${who}`;
    }
    case 'drill_bonus':
      return `${bonus.percent}% chance a finished drill gives one more point in its attribute`;
    case 'ad_hoc_army':
      return (bonus.level ?? 1) >= 5
        ? 'Opens The Geppetto; his robots fight at this level, two made a round'
        : 'Opens The Geppetto; his robots fight at this level';
    case 'lamps_switch': {
      const reach = lampsReach(bonus.level ?? 1);
      return `Lamps: lit, Dark and Foggy fall ${reach.tiers} tier${reach.tiers === 1 ? '' : 's'} on every location in the ${reach.wholeCity ? 'city' : 'district'}; out, they rise as far`;
    }
    case 'scrapyard_xp':
      return `+${bonus.flat} player XP for everything built at the Scrapyard`;
    case 'mission_travel':
      return `-${bonus.percent}% mission travel time in this city ${TAPERS}`;
    case 'training_sessions':
      return `+${bonus.flat} training session${bonus.flat === 1 ? '' : 's'}/day`;
    case 'battle_stims':
      return `+${bonus.flat} battle stim${bonus.flat === 1 ? '' : 's'}`;
    // Points into a sum that bends towards 100% (`salvageRefundCut`, 2026-10-05).
    case 'salvage_refund':
      return `${bonus.percent}% of losses refunded ${TAPERS}`;
    // Points on the spy contest's scale, not a percentage (bug pass, 2026-09-29).
    case 'intel':
      return `+${bonus.percent} spy points`;
    case 'mission_spoils':
      return `+${bonus.percent}% mission pay${bonus.inCity ? ' on jobs in this city' : ''}`;
    case 'unit_armor':
      return `+${bonus.percent} unit armour`;
    case 'unit_tier':
      return `${tierStatAmount(bonus.stat, bonus.percent)} ${UNIT_TIER_LABELS[bonus.tier]} ${UNIT_TIER_STAT_LABELS[bonus.stat]}`;
    case 'officer_group':
      return `+${bonus.flat} to officer ${GROUP_LABELS[bonus.group]} skills`;
    case 'officer_skill':
      return `+${bonus.flat} ${ATTRIBUTE_LABELS[bonus.attribute]} on every officer`;
    case 'unit_slots':
      // The housing budget is called unit slots on every screen (maintainer request, 2026-09-15).
      // The channel keeps its internal name; only what a player reads changed.
      return `+${bonus.flat} unit slots${whole}`;
    case 'carriers_fight':
      return 'porters fight';
    case 'unit_mark':
      return `${UNIT_RULES[bonus.mark].label} for ${unitName(bonus.unitId)}`;
    case 'unit_modifier':
      return `${bonus.golden ? 'golden ' : ''}${UNIT_MODIFIERS[bonus.modifier].label} for ${unitName(bonus.unitId)}`;
    case 'modification_vitality':
      return `+${bonus.percent}% vitality on each unit for every modification fitted to it`;
    case 'offense_vs_tier':
      return `+${bonus.percent}% damage against ${UNIT_TIER_LABELS[bonus.tier]} units`;
    case 'battle_infamy':
      return `+${bonus.percent}% infamy from fights`;
    case 'location_upgrade_discount':
      return `-${bonus.percent}% on every location upgrade`;
    case 'reactor_choice':
      return 'choose one unit type to carry Radioactive, locked for 12 hours once chosen';
    case 'ignore_label':
      return `your units are immune to ${ENV_LABEL_CATALOG[bonus.label].name} ground in a fight`;
    case 'death_heal':
      return `each of your units that dies in a fight heals your most hurt one by ${bonus.percent}% of its vitality`;
    case 'death_salvage':
      return `+${bonus.perBody} ${RESOURCE_LABELS[bonus.resource]} for each of your units that dies in a fight`;
    case 'steady_nerve':
      return 'a stack that breaks shakes nobody';
    case 'rail_link':
      return `On the line: ${railLinkMinutes(bonus.level ?? 1)} min from here to any Station you hold`;
    case 'faith':
      return 'Death Cloaks mustered here, and +30 damage and vitality on each for every Mausoleum you hold';
    case 'unit_stat_flat': {
      const who =
        bonus.unitId !== undefined
          ? unitName(bonus.unitId)
          : bonus.rule === 'guard'
            ? 'every unit with GUARD'
            : bonus.tier !== undefined
              ? `every ${UNIT_TIER_LABELS[bonus.tier]} unit`
              : bonus.damageType !== undefined
                ? `every ${DAMAGE_TYPE_LABELS[bonus.damageType]} unit`
                : 'every unit';
      return `+${bonus.flat} ${FLAT_STAT_LABELS[bonus.stat]} on ${who}`;
    }
    case 'carrier_loot_flat':
      return `+${bonus.flat} loot slots on every carrier`;
    case 'noise_switch':
      return 'a switch: on, every location here is Noisy and your units ignore Noisy everywhere';
    case 'daily_page': {
      const count = dailyPagesOf(bonus).length;
      return `${count} blueprint page${count === 1 ? '' : 's'} a day, of a blueprint you have not finished${bonus.odds ? ', better odds of a rare one at higher levels' : ''}`;
    }
    case 'pamphlets':
      return `${bonus.pins} pamphlet${bonus.pins === 1 ? '' : 's'}: a pinned unit fights you at -5% damage and vitality`;
    case 'daily_stim':
      return `${bonus.percent}% chance of a battle stim each day`;
    // Medic points into the recovery curve (`casualtyRecoveryShare`), as the crew page prints
    // them: twelve points is a tenth of the dead back, not twelve per cent (bug pass, 2026-10-11).
    case 'casualty_recovery':
      return `+${bonus.percent} medic points ${TAPERS}`;
    case 'unit_door':
      return `${unitName(bonus.unitId)} mustered here, stronger at every level`;
    case 'training_time':
      return `-${bonus.percent}% training time`;
    case 'golden_jobs':
      return `${bonus.chancePercent}% of fight jobs here are golden, paying +${bonus.rewardPercent}%`;
    case 'daily_component': {
      const rarity = fixedRarity(bonus).rarity;
      const grade = rarity === undefined ? '' : `${ITEM_RARITY_LABELS[rarity].toLowerCase()} `;
      return `${bonus.count} ${grade}component${bonus.count === 1 ? '' : 's'} a day, delivered at the day's turn`;
    }
    case 'trophies':
      return 'a daily pay for every kind of unit you have killed while holding it';
    case 'spy_defence':
      return `+${bonus.percent} defensive spy points`;
    case 'mission_xp':
      return `+${bonus.percent}% mission XP`;
    case 'storage':
      return `+${bonus.percent}% storage, every shelf but caps`;
    case 'modification_output':
      return `+${bonus.percent}% output per modification on a producing structure`;
    case 'ally_fight':
      return `+${bonus.percent}% damage and vitality for units sent into a faction mate's fight`;
    case 'mission_caps':
      return `+${bonus.percent}% mission caps`;
    case 'xp_per_loss':
      return `+${bonus.perSlot} XP for every unit slot of your own dead`;
    case 'modification_armor':
      return `+${bonus.flat} armour per modification a unit wears`;
    case 'payroll':
      return `+${bonus.percent}% payroll`;
    case 'legend_aura':
      return bonus.stat === 'penetration'
        ? `+${bonus.amount} penetration on units fighting beside ${unitName(bonus.unitId)}`
        : `+${bonus.amount}% damage and vitality on units fighting beside ${unitName(bonus.unitId)}`;
    case 'anti_combine':
      // Declared battles only (maintainer, 2026-10-11): a battle job on the board is not one.
      return 'ANTI-COMBINE: +10% damage and vitality against the Combine in declared battles';
    case 'intimidated_infamy':
      return `+${bonus.percent}% infamy for enemy units that were intimidated`;
  }
}

/** What each flat stat is called on a card. */
export const FLAT_STAT_LABELS: Record<FlatUnitStat, string> = {
  armor: 'armour',
  offense: 'damage',
  vitality: 'vitality',
  range: 'range',
  evasion: 'evasion',
  speed: 'speed',
  stealth: 'stealth',
  penetration: 'penetration',
};

/** Guards the label tables against a resource or a group being added and silently going unnamed. */
for (const key of RESOURCE_KEYS) {
  if (!RESOURCE_LABELS[key]) throw new Error(`no location-bonus label for the ${key} resource`);
}
for (const group of ATTRIBUTE_GROUPS) {
  if (!GROUP_LABELS[group]) throw new Error(`no location-bonus label for the ${group} group`);
}

/**
 * Guards the catalogue at module load: every kind is authored, pays something, and says what its
 * three place-specific upgrades are. A location that pays nothing is a location nobody has a
 * reason to take. The rest of the ladder comes from {@link LATE_UPGRADE_NOTES}, and the two counts
 * are asserted to cover every step so no level can ever come up without a sentence.
 */
if (AUTHORED_UPGRADE_NOTES + LATE_UPGRADE_NOTES.length !== MAX_LOCATION_LEVEL - 1) {
  throw new Error(`the upgrade notes do not cover ${MAX_LOCATION_LEVEL - 1} steps`);
}
if (LEVEL_SCALE.length !== MAX_LOCATION_LEVEL) throw new Error('LEVEL_SCALE is the wrong length');
if (RAIL_LINK_MINUTES.length !== MAX_LOCATION_LEVEL) {
  throw new Error('RAIL_LINK_MINUTES is the wrong length');
}
if (UPGRADE_COST_SCALE.length !== MAX_LOCATION_LEVEL - 1) {
  throw new Error('UPGRADE_COST_SCALE is the wrong length');
}
