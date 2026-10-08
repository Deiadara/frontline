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
import { DAMAGE_TYPE_LABELS, type DamageType } from '../units/stats.js';
import { envLabel, type EnvLabel, type EnvLabelId } from './labels.js';
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
  'revolutionary_statue',
  /*
   * Appended rather than filed under "industry and supply", where it belongs by sense.
   * `art/manifest.ts` seeds `icon-location-*` off each kind's index here, so a kind inserted in
   * the middle re-rolls the icon of every kind after it. Read the list by meaning, not by position.
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
   * The rest of Arca's kinds (maintainer, 2026-10-06 and 2026-10-07), appended in the order
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
}

/** The stats a flat point bonus can land on. Range and penetration had no channel before. */
export const FLAT_UNIT_STATS = [
  'armor',
  'offense',
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
  | { kind: 'mission_speed'; percent: number; inDistrict?: true }
  | { kind: 'mission_spoils'; percent: number }
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
   * Anything gets a seat, including the things there is no seat for.
   *
   * Waives `no_ride` (`units/catalog.ts`), which is the rule that holds a whole column to a
   * Colossus's fifteen. There is no percentage that says this: the column moves at its slowest
   * group, so the answer to a walking legend is not a faster road, it is a way to put it on
   * something.
   */
  | { kind: 'any_ride' }
  /**
   * One named unit picks up a mark it was not written with (`units/rules.ts`).
   *
   * The narrowest of these and the one that reads most like a decision: it does nothing at all
   * unless you field that unit, and it changes what fielding it means rather than how much of it
   * you get. A rung that makes your Wardens open fire is a reason to build a crew around Wardens.
   */
  | { kind: 'unit_mark'; unitId: string; mark: GrantableUnitMark }
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
   * Hold the Station in two districts and you may **choose** to put a unit move or a battle column
   * on the train between them: fifteen minutes flat on the rails, whatever the map says the
   * distance is, plus the walk from where the units are to the platform at each end. Any two
   * Stations you hold are linked, not only neighbouring ones, because a train runs the whole line.
   *
   * Carries no percentage, and could not. `travel_speed` is a fraction of a clock and this
   * *replaces* the clock for the middle leg, so a Rail Yard cannot make a linked run faster and
   * nothing can make it slower. It is also the one travel rule in the game a player turns on and
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
    }
  /** Loot slots on every carrier, flat: the Straw Sack's bags. Lands in `carrierLootFlat`. */
  | { kind: 'carrier_loot_flat'; flat: number }
  /**
   * A switch the holder throws (the Tolling Tower): on, every location in the district is Noisy
   * and the holder's own units ignore Noisy everywhere. Whether it is on lives on the control row.
   */
  | { kind: 'noise_switch' }
  /** A blueprint page a day, of a blueprint not yet finished, at odds set by the level. */
  | { kind: 'daily_page' }
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
  | { kind: 'daily_component'; count: number }
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
 * `LEVEL_SCALE` is linear and whole: a location at level 5 is worth five times what it was on the
 * day it was taken, a little under the 5.5x the old level 10 paid. Linear rather than compounding
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
 * Terminus's line: how long the middle leg of a linked journey takes, in minutes.
 *
 * Flat, and a rule rather than a slider (maintainer, 2026-09-24). It replaces the road between two
 * held Stations instead of discounting it, so nothing speeds it up and nothing slows it down. The
 * walk to the platform at each end is charged on top, at the ordinary road rate, which is what
 * keeps a Station worth taking in the district you actually work in.
 */
export const RAIL_LINK_MINUTES = 15;

export const LEVEL_SCALE: readonly number[] = [1, 2, 3, 4, 5];

/**
 * The gentler ladder for the kinds whose figure is a share of a fight (maintainer, 2026-10-06:
 * "decide for each one individually so it is not too OP"). A Hospital's 12% vitality at five
 * times is 60%; at this it is 48%, which is where the old level 8 stood.
 */
export const COMBAT_LEVEL_SCALE: readonly number[] = [1, 1.75, 2.5, 3.25, 4];

/**
 * Doubling over the ladder, for points on an officer's sheet: the Choir's "+5, scaled up to 10"
 * (maintainer, 2026-10-07), and every other ground skill lift with it.
 */
export const OFFICER_LEVEL_SCALE: readonly number[] = [1, 1.25, 1.5, 1.75, 2];

/** What each upgrade costs, as a multiple of the kind's own base price: one per step, 1 to 5. */
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
  /**
   * Planks for the first upgrade, and through {@link UPGRADE_MIX} the whole of its bill.
   *
   * One number rather than a bundle, because the bundle's *shape* is now the same everywhere and
   * only its size is a property of the place. A Pawn Shop opens at 80 and a Construction Site at
   * 460, which is the spread the hand-written bundles already had; every later level scales by
   * {@link UPGRADE_COST_SCALE} and {@link LOCATION_UPGRADE_PRICE_RISE}, so the last upgrade runs
   * from about 2,970 planks to about 17,050.
   */
  upgradeCost: number;
  /**
   * What the first three upgrades actually *are*, in three short lines: level 2, 3 and 4.
   *
   * Authored rather than generated, and it is the difference between a build order and a place:
   * "+50% oil" is a number going up, and "you get the underground tanks pumping again" is a thing
   * that happened to a petrol station you own.
   *
   * Three, not four. The last level reads {@link LATE_UPGRADE_NOTES} instead, one line that is
   * true of any ground somebody has held a long time. The place-specific writing stays where a
   * player meets it, on the three upgrades every location sees first.
   */
  upgrades: readonly [string, string, string];
  /** A one-off infamy payment the moment it changes hands. Almost nothing has one. */
  captureInfamy?: number;
  /**
   * This kind's own ladder over the five levels, where {@link LEVEL_SCALE} would make its top
   * too strong: the combat kinds read {@link COMBAT_LEVEL_SCALE}.
   */
  levelScale?: readonly number[];
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
    upgradeCost: 160,
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
    upgradeCost: 170,
    upgrades: [
      'The third cracking tower is repacked and lit.',
      'Feedstock lines rerouted off the ruined header. Nothing is being flared off any more.',
      'Catalyst recovery, so the expensive part of the process stops leaving in the smoke.',
    ],
  },
  power_station: {
    label: 'Substation',
    blurb:
      'A Combine switching yard off the old trunk, with a bunded tank farm behind it for the standby sets.',
    // §A1 took the district grid out of the game, and a location that fed it would now feed
    // nothing. Re-pointed at the fuel bunkers behind the yard rather than dropped: this was one of
    // the strongest holds on the map, and a place worth taking that pays nothing is a dead marker.
    reward: 'Fuel by the drum, off the standby tanks nobody has come back to meter.',
    bonuses: [{ kind: 'resource', resource: 'oil', perHour: 20 }],
    baseDefense: 5,
    labels: [L('noisy', 2), L('crammed', 1)],
    upgradeCost: 230,
    upgrades: [
      'The cracked tank at the north end is patched and brought back into service.',
      'Valve gear replaced, so one leak stops taking the whole bund out of use with it.',
      'A second draw line off the spur. Twice the throughput and half the spills.',
    ],
  },
  water_works: {
    label: 'Water Works',
    blurb: 'Intake screens, settling beds and a pumphouse under a corrugated roof.',
    reward: 'Supplies, because clean water is most of what growing it takes.',
    bonuses: [{ kind: 'resource', resource: 'supplies', perHour: 26 }],
    baseDefense: 3,
    labels: [L('wet', 2), L('crammed', 1), L('noisy', 1)],
    upgradeCost: 150,
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
    upgradeCost: 290,
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
    upgradeCost: 120,
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
      'High-quality metal out of the turbine hall, and a fuelling crew who make every barrel of oil you burn go further.',
    bonuses: [
      { kind: 'resource', resource: 'highQualityMetal', perHour: 5 },
      { kind: 'resource_yield', resource: 'oil', percent: 12 },
    ],
    baseDefense: 7,
    labels: [L('toxic', 4), L('dark', 3), L('crammed', 2), L('eerie', 2)],
    upgradeCost: 400,
    upgrades: [
      'The turbine hall is shored and lit, so the salvage crews stop working blind.',
      'One coolant loop is brought back under control. The building stops getting worse.',
      'A working shift room behind shielding. People can be in there for a whole day.',
    ],
  },
  soup_kitchen: {
    label: 'Soup Kitchen',
    blurb: 'Trestle tables, a queue that starts before dawn, and two women who never sit down.',
    reward: 'Supplies off the ration line, and a crew that has eaten fights like one.',
    bonuses: [
      { kind: 'resource', resource: 'supplies', perHour: 14 },
      { kind: 'unit_morale', flat: 6 },
      { kind: 'unit_slots', flat: 15 },
    ],
    baseDefense: 1,
    labels: [L('crammed', 3), L('noisy', 2)],
    upgradeCost: 100,
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
      { kind: 'unit_slots', flat: 50 },
      { kind: 'resource', resource: 'caps', perHour: 6 },
    ],
    baseDefense: 1,
    labels: [L('crammed', 3), L('open', 2), L('noisy', 2), L('cold', 1)],
    upgradeCost: 170,
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
    upgradeCost: 130,
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
    upgradeCost: 170,
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
    upgradeCost: 80,
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
    upgradeCost: 180,
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
    upgradeCost: 130,
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
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 4,
    labels: [L('open', 3), L('elevated', 3), L('windy', 1)],
    upgradeCost: 210,
    upgrades: [
      'Sandbagged firing positions instead of whatever people were crouching behind.',
      'A cut stair up the back, so the position can be reinforced under fire.',
      'Overhead cover and a ready magazine. It stops being a vantage and becomes a work.',
    ],
  },
  barricade: {
    label: 'Barricade',
    blurb: 'Sea containers, rubble and rebar, arranged by somebody who had thought about it.',
    reward: 'A harder approach to everything behind it, held by people who will not leave it.',
    bonuses: [
      { kind: 'defense_percent', percent: 8 },
      /*
       * The line learns the wall (`unit_mark`, `city/locations.ts`).
       *
       * Ironsides already taunt, which is the sheet that most wants `stalwart` and least deserves
       * it for free: a shield line that pulls three quarters of the fire and then runs is the exact
       * failure the taunt was written to fix. Granted rather than written onto the sheet, so it is
       * ground somebody has to hold instead of a unit that got quietly better.
       */
      { kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' },
    ],
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 5,
    labels: [L('crammed', 2), L('open', 1)],
    upgradeCost: 260,
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
    reward: 'Everything your spies do, they do better: everywhere in the city, not just here.',
    bonuses: [
      /*
       * 38: the tower's own 20, plus the sight of one district and the second scouting party it
       * paid until scouting left the game (2026-09-29), each converted at what `perkWorth` prices
       * one whole thing on a `wide` channel, nine points. It scales on `LEVEL_SCALE` like every
       * percentage, so the tower is still the best intel ground in the city at every level.
       */
      { kind: 'intel', percent: 38 },
    ],
    baseDefense: 5,
    labels: [L('elevated', 4), L('open', 2), L('windy', 2), L('crammed', 1)],
    upgradeCost: 240,
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
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 2,
    labels: [L('crammed', 4), L('dark', 3), L('wet', 2), L('toxic', 1)],
    upgradeCost: 130,
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
    upgradeCost: 250,
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
      // 1 on `LEVEL_SCALE`: 1 at level 1, 3 at 4, 6 at 10. It was 12, so 66 at 10, the outlier
      // among the general muster cuts (maintainer, 2026-10-01).
      { kind: 'muster_cost', percent: 1 },
      { kind: 'refit_discount', percent: 20 },
    ],
    baseDefense: 6,
    labels: [L('crammed', 3), L('dark', 2)],
    upgradeCost: 270,
    upgrades: [
      'The armourer’s bench is set up properly and somebody is on it every day.',
      'Pattern jigs, so a unit modification is repeatable instead of one man’s good afternoon.',
      'A proving butt out the back. Nothing leaves here that has not been fired.',
    ],
  },
  war_machine_graveyard: {
    label: 'War Machine Graveyard',
    blurb: 'A field of dead armour, half of it sunk, some of it not as dead as it looks.',
    reward:
      'Hulls, plate and running gear, a gantry that will lift anything, and troops that come back from more than they should.',
    bonuses: [
      { kind: 'unit_vitality', percent: 10 },
      /*
       * The crane, and the only answer in the game to a legend that walks.
       *
       * `no_ride` holds a whole column to a Colossus's 15 (`columnSpeed`), and no percentage
       * touches it: the column moves at its slowest group, so a faster road for everybody else buys
       * nothing at all. Priced at nothing extra because it is worth nothing to a crew that does not
       * field one, which is most of them, and a great deal to the one crew that does.
       */
      { kind: 'any_ride' },
    ],
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 6,
    labels: [L('open', 3), L('eerie', 2), L('toxic', 1)],
    upgradeCost: 300,
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
    upgradeCost: 460,
    upgrades: [
      'The tower crane is recommissioned and passes a load test at full radius.',
      'A second crane on the east raft, so two things can be built at once.',
      'The site is decked, lit and enclosed. It becomes a yard rather than a hole.',
    ],
  },
  fight_pit: {
    label: 'Fight Pit',
    blurb: 'A sunk ring, a standing crowd, and a bookmaker who knows everyone.',
    reward: 'Every enemy you frighten before the first shot is worth twice the name when it dies.',
    /*
     * Double infamy for the intimidated, and nothing else (maintainer, 2026-10-06). The morale
     * and the porters' line went with the rework; the pit stopped being anybody's door the same
     * day, when the Condemned moved to the Watch Cell and the Crimson Dancer to her Stage.
     */
    bonuses: [{ kind: 'intimidated_infamy', percent: 100 }],
    baseDefense: 2,
    labels: [L('crammed', 3), L('noisy', 4)],
    upgradeCost: 130,
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
    upgradeCost: 140,
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
    upgradeCost: 180,
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
    upgradeCost: 270,
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
    /*
     * One channel since 2026-10-07 (maintainer: "nerf the bonuses and make them percentage based
     * for now"). The depot paid 18% and four flat minutes, and the flat half was there because a
     * percentage is worth what the clock is worth: four minutes bit on the ten-minute hop next
     * door and were a rounding error on a march. Flat minutes also survived the crossing, where
     * they were never meant to matter. The four are 4 more points on the travel channel instead,
     * which bends with everything else through `travelSpeedCut`.
     */
    bonuses: [{ kind: 'travel_speed', percent: 22 }],
    baseDefense: 3,
    labels: [L('crammed', 2), L('noisy', 2), L('dark', 1)],
    upgradeCost: 230,
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
    upgradeCost: 160,
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
    upgradeCost: 190,
    upgrades: [
      'The projector is rebuilt and the dome is dark again for the first time in years.',
      'The optical bench is stripped and repurposed. It is the best glass in the district.',
      'Sessions every night. Your researchers start solving things in the dark.',
    ],
  },
  satellite_uplink: {
    label: 'Satellite Uplink',
    blurb: 'A dish on a mast, aligned by hand, talking to something still in orbit.',
    reward: 'What goes over the air in this city, your spies have already read.',
    // Two districts of sight until the whole city became visible (2026-09-29), converted at nine
    // points of intel a district, the rate `perkWorth` prices one whole thing on a `wide` channel.
    bonuses: [{ kind: 'intel', percent: 18 }],
    baseDefense: 5,
    labels: [L('open', 2), L('elevated', 3), L('windy', 2)],
    upgradeCost: 180,
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
    upgradeCost: 150,
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
    upgradeCost: 130,
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
    upgradeCost: 100,
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
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 6,
    labels: [L('crammed', 3), L('cold', 1), L('eerie', 1)],
    upgradeCost: 200,
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
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 3,
    labels: [L('crammed', 2), L('noisy', 1)],
    upgradeCost: 170,
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
    upgradeCost: 150,
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
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 7,
    labels: [L('crammed', 3), L('toxic', 3), L('dark', 3), L('eerie', 3)],
    upgradeCost: 290,
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
    upgradeCost: 130,
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
    upgradeCost: 100,
    upgrades: [
      'The projector is rebuilt and the sound comes back. It stops being a silent film.',
      'The balcony is reopened, which is another three hundred seats a night.',
      'A print run traded in from three districts. Something different every week.',
    ],
  },
  arcade: {
    label: 'The Arcade',
    blurb: 'Forty cabinets, nine of them working, and a change machine that has never been robbed.',
    reward: 'Reflex work disguised as an evening off. Recruits come off the bench quicker.',
    bonuses: [{ kind: 'muster_speed', percent: 12 }],
    baseDefense: 1,
    labels: [L('crammed', 3), L('noisy', 3), L('dark', 2)],
    upgradeCost: 100,
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
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 1,
    labels: [L('open', 3), L('noisy', 1)],
    upgradeCost: 130,
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
    reward:
      'Everyone on your books holds together better under things that break people, and nobody runs because the person beside them did.',
    bonuses: [
      { kind: 'officer_group', group: 'mental', flat: 5 },
      /*
       * The cascade, cut (`steady_nerve`).
       *
       * A collapse in this engine spreads: one stack breaks, the next is shaken by it, and a force
       * ahead on casualties walks off in two rounds (`battle/morale.ts`). This removes that term
       * and nothing else, so a line still breaks from its own losses and from what is opposite it.
       * Deliberately the whole of the bonus rather than a share: half a cascade is a slower
       * collapse, and what a chapel buys is that the panic does not travel.
       */
      { kind: 'steady_nerve' },
    ],
    baseDefense: 2,
    labels: [L('eerie', 2), L('dark', 2), L('crammed', 1), L('cold', 1)],
    upgradeCost: 120,
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
    upgradeCost: 100,
    upgrades: [
      'The lodge is manned and the gates are shut at night. It becomes yours visibly.',
      'The subsided terrace is worked properly instead of dug at by whoever turns up.',
      'The register is found. You know who is here, and so does everyone you tell.',
    ],
  },
  revolutionary_statue: {
    label: 'Statue in a Plaza',
    blurb:
      'The one in the middle of the district: a long coat, a raised fist, and a plinth every road in Chrome Row runs past.',
    reward:
      'It is what they are fighting for. A crew that holds it walks into a fight harder to frighten.',
    bonuses: [{ kind: 'unit_morale', flat: 10 }],
    baseDefense: 4,
    labels: [L('open', 4), L('elevated', 2)],
    upgradeCost: 120,
    upgrades: [
      'The plinth is scrubbed and the name re-cut. People stop to read it again.',
      'Floodlit. The first thing anybody sees coming into the district, and it is yours.',
      'A crowd under it most nights. What is said there is repeated in every district.',
    ],
  },

  // ------------------------------------------------------------ industry and supply, again
  glasshouse: {
    label: 'Hydroponics',
    blurb:
      'Glass houses on a steel frame, beds under grow-lamps, and pumps that never stop. Hot and wet in there whatever the weather is doing outside.',
    reward: 'Supplies straight off the beds, picked before they ever see a market.',
    /*
     * Between the Water Works (26) and the Soup Kitchen (14). The intake is what growing takes and
     * the kitchen is what is left after the Combine has weighed it; this is the growing itself,
     * so it pays less than the water it depends on and more than the ration line.
     */
    bonuses: [{ kind: 'resource', resource: 'supplies', perHour: 22 }],
    baseDefense: 3,
    // Hot and Wet by nature (maintainer, 2026-09-15): a glass house is a warm, dripping room in any
    // weather. Crammed because the aisles between the beds are one unit wide.
    labels: [L('hot', 3), L('wet', 2), L('crammed', 1)],
    upgradeCost: 160,
    upgrades: [
      'The broken panes are glazed and the lamps rewired. Nothing freezes in the night beds any more.',
      'A second pump on the intake line, so every bed is wet on the hour instead of when somebody remembers.',
      'Racks up the walls. Three tiers of beds under the same glass, and three harvests where there was one.',
    ],
  },

  /**
   * The Chosen Chapel: where the Combine commands the city from (maintainer, 2026-09-19).
   *
   * The hardest ground in the game before anybody is standing on it. `baseDefense` 9 against a
   * ceiling of 7 everywhere else, and it is meant to read that way on the map: this is the one
   * location whose capture is the end of the campaign rather than a step in it, and Directive
   * Zero is stood in it (`city/combine.ts`).
   *
   * What holding it pays is deliberately the two things the Combine had and the player did not:
   * the city's fear, and the nerve that comes from having taken the room it was run from. Neither
   * is the CCS unified bonus (a market discount) and neither repeats another CCS location, which
   * `city.test.ts` holds.
   */
  combine_chapel: {
    label: 'The Chosen Chapel',
    blurb:
      'A chapel in name. Glass, steel and a long table under the vault, and the room the whole city is run from. The pews were taken out a long time ago.',
    reward:
      'Your name walks in ahead of your people, and nobody you send out is frightened of anything that lives here.',
    bonuses: [
      { kind: 'intimidation', flat: 12 },
      { kind: 'unit_morale', flat: 8 },
    ],
    levelScale: COMBAT_LEVEL_SCALE,
    baseDefense: 9,
    labels: [L('elevated', 3), L('crammed', 2), L('dark', 1)],
    upgradeCost: 420,
    upgrades: [
      'The long table is yours, and the people who used to sit at it know it.',
      'The vault is lit again. Whoever looks up at the spire sees a different flag on it.',
      'Orders go out from here, and the city does what it always did with orders from here.',
    ],
    /** §D8: taking the room the Combine ran the city from is the event of the whole game. */
    captureInfamy: 40,
  },
  // ------------------------------------------------------------ the railway
  rail_station: {
    label: 'Station',
    blurb:
      'A platform, a lamp and a board with the times chalked on it. Whoever holds it decides who the train stops for.',
    reward: 'Linked to any other Station you hold, at fifteen minutes flat.',
    bonuses: [
      { kind: 'rail_link' },
      // A platform is also somewhere people wait, and waiting rooms fill up. Small, because the
      // reason to take a Station is the line and not the beds.
      { kind: 'unit_slots', flat: 2 },
    ],
    baseDefense: 4,
    labels: [L('open', 3), L('windy', 2), L('noisy', 1)],
    upgradeCost: 240,
    upgrades: [
      'The points either side are yours, so nothing comes through that you did not let through.',
      'The water column and the coal stage work again. A train can be held here as long as you like.',
      'The board is rewritten in your hand. The timetable is whatever you say it is.',
    ],
  },
  mausoleum: {
    label: 'Mausoleum',
    blurb:
      'A family tomb the size of a chapel, white stone gone grey, a red lamp kept burning inside it and people living among the dead who do not mind the company.',
    reward:
      'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
    bonuses: [
      { kind: 'faith' },
      // People live in the tombs, and a level opens more of the vaults to live in. Small, because
      // the reason to take a Mausoleum is the Death Cloaks and not the beds.
      { kind: 'unit_slots', flat: 6 },
    ],
    baseDefense: 3,
    labels: [L('eerie', 3), L('dark', 2), L('cold', 1), L('crammed', 1)],
    upgradeCost: 180,
    upgrades: [
      'The lamp is relit and the doors rehung. The families inside answer to you now.',
      'The lower vaults are opened up. There is room in the dark for a great many more.',
      'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
    ],
  },
  /*
   * Arca's own kinds (maintainer, 2026-10-06 and 2026-10-07). Each exists because one place
   * in the city pays something no kind in the catalogue did: a sack-maker's loft, a saint's
   * shrine, a bounty wall. Their catalogue pay is a placeholder a card never prints, because
   * every location of these kinds carries its own authored list (`LocationSchema.bonuses`); what
   * the entry decides is the icon, the ground, the defence and the price of working it up.
   */
  workshop: {
    label: 'Workshop',
    blurb: 'Benches, a forge hearth and a loft above it, and nothing in it that is not for sale.',
    reward: 'Whatever this workshop makes, your people carry it.',
    bonuses: [{ kind: 'carrier_loot_flat', flat: 5 }],
    baseDefense: 3,
    labels: [L('noisy', 2), L('crammed', 2), L('hot', 1)],
    upgradeCost: 160,
    upgrades: [
      'The loft is cleared and a second bench goes in. Twice the hands.',
      'A hearth that stays lit. The work stops waiting for the morning.',
      'A master takes the floor, and the apprentices start finishing what they begin.',
    ],
  },
  shrine: {
    label: 'Shrine',
    blurb: 'A relic under glass, a crimson cloth over it, and a queue up the hill to see it.',
    reward: 'A saint answers to whoever keeps the shrine.',
    bonuses: [{ kind: 'unit_door', unitId: 'the_saint' }],
    baseDefense: 5,
    labels: [L('elevated', 2), L('open', 1), L('eerie', 1)],
    upgradeCost: 320,
    upgrades: [
      'The reliquary is reset and the lamps relit. Pilgrims come up the hill again.',
      'A guard on the stair, and the saint sleeps lighter.',
      'The shrine is dressed in your colours. What the saint does, he does in your name.',
    ],
  },
  bounty_wall: {
    label: 'Bounty Wall',
    blurb: 'A wall of posted contracts, a clerk with a ledger, and crews reading it before dawn.',
    reward: 'The best contracts in the district come to you first.',
    bonuses: [{ kind: 'golden_jobs', chancePercent: 20, rewardPercent: 10 }],
    baseDefense: 3,
    labels: [L('crammed', 3), L('noisy', 2)],
    upgradeCost: 200,
    upgrades: [
      'The clerk keeps your book first. Contracts reach you before they are posted.',
      'A runner on the wall day and night. Nothing is posted that you have not seen.',
      'The wall is yours: every contract in the quarter clears through your clerk.',
    ],
  },
  stage: {
    label: 'Stage',
    blurb: 'Red lamps over a floor worn smooth, and a crowd that comes to watch somebody dance.',
    reward: 'The Crimson Dancer answers to whoever keeps the stage.',
    bonuses: [{ kind: 'unit_door', unitId: 'the_crimson_dancer' }],
    baseDefense: 2,
    labels: [L('dark', 3), L('crammed', 3), L('noisy', 2)],
    upgradeCost: 300,
    upgrades: [
      'The boards are relaid and the lamps rewired. She dances every night now.',
      'A band, a bar and a door policy. The crowd is yours as much as the stage is.',
      'The stage is dressed in your colours, and she dances for nobody else.',
    ],
  },
  trophy_hall: {
    label: 'Trophy Hall',
    blurb:
      'A long hall with every wall hung with what was taken off the dead, and a keeper who writes it all down.',
    reward: 'Every kind of enemy you have put on the wall pays you, every day.',
    bonuses: [{ kind: 'trophies' }],
    baseDefense: 4,
    labels: [L('eerie', 2), L('dark', 2), L('crammed', 1)],
    upgradeCost: 260,
    upgrades: [
      'The hall is lit and the keeper paid. The wall starts filling.',
      'A second hall is opened. There is room for everything you will take.',
      'People come to see the wall, and pay at the door.',
    ],
  },
  laboratory: {
    label: 'Laboratory',
    blurb: 'Saints under glass, a centrifuge, and a theatre where the Combine does its quiet work.',
    reward: 'What is grown here fights for whoever keeps it.',
    bonuses: [{ kind: 'unit_door', unitId: 'juggernauts' }],
    baseDefense: 6,
    labels: [L('crammed', 3), L('cold', 2), L('eerie', 2), L('dark', 1)],
    upgradeCost: 400,
    upgrades: [
      'The theatre is scrubbed and the cold store restocked. The work starts again.',
      'A second theatre, and the sisters stop having to choose.',
      'The laboratory answers to you alone, and what it makes is made to your order.',
    ],
  },
  stores: {
    label: 'Stores',
    blurb:
      'Vaults under the floor, dry and deep, with room for a siege and a ledger for every sack.',
    reward: 'Everything you keep, you keep more of.',
    bonuses: [{ kind: 'storage', percent: 10 }],
    baseDefense: 4,
    labels: [L('dark', 3), L('cold', 2), L('crammed', 2)],
    upgradeCost: 220,
    upgrades: [
      'The lower vaults are pumped and shelved. Twice the room.',
      'A hoist and a tally board. Nothing is lost between the door and the shelf.',
      'The stores are yours end to end, and the ledger says so.',
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
/** The share of a location's officer group lift that is paid (maintainer, 2026-10-05). */
export const GROUND_OFFICER_LIFT_SHARE = 0.5;

export function scaledBonus(
  bonus: HoldBonus,
  level: number,
  /** The kind's own ladder, where the catalogue sets one (`LocationSpec.levelScale`). */
  levelScale: readonly number[] = LEVEL_SCALE,
): HoldBonus {
  const at = clampLevel(level);
  /*
   * A ladder written out beats every curve (maintainer, 2026-10-06): "30% rising to 100%" is
   * five figures, and no multiplier lands on them exactly. The figure replaces whatever the kind
   * would have scaled; `level` is stamped for the kinds the server reads by level alone.
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
    value <= 0 ? value : Math.max(grow(value), value + (at - 1));

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
     * every officer by 28. A Chapel now: +2, +3, +4, +5, +6 at level 5.
     */
    case 'officer_group':
      return {
        ...bonus,
        flat: Math.max(1, Math.floor(bonus.flat * GROUND_OFFICER_LIFT_SHARE)) + (at - 1),
      };
    case 'unit_stat_flat':
    case 'carrier_loot_flat':
    case 'modification_armor':
      return { ...bonus, flat: grow(bonus.flat) };
    case 'pamphlets':
      // One pin a level: the wall holds as many pamphlets as it has been worked up.
      return { ...bonus, pins: at, level: at };
    case 'daily_component':
      return { ...bonus, count: grow(bonus.count), level: at };
    case 'daily_page':
    case 'trophies':
    case 'unit_door':
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
    case 'any_ride':
    case 'steady_nerve':
    case 'unit_mark':
    case 'rail_link':
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
      return { ...bonus, flat: figure };
    case 'pamphlets':
      return { ...bonus, pins: figure };
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
    case 'any_ride':
    case 'steady_nerve':
    case 'unit_mark':
    case 'rail_link':
    case 'faith':
    case 'noise_switch':
    case 'daily_page':
    case 'trophies':
    case 'unit_door':
    case 'anti_combine':
      return bonus;
    default:
      return { ...bonus, percent: figure };
  }
}

/**
 * What a location pays before any level: its own authored list when it has one, else its kind's.
 *
 * Authored payouts arrived with Arca (maintainer, 2026-10-06), where a Market pays forty
 * caps rather than thirty and a Fence Camp houses people and pays nothing: the same kind of
 * place, with its icon, its ground and its gating, worth a different figure on a different map.
 */
export function baseBonusesOf(location: Pick<Location, 'kind' | 'bonuses'>): readonly HoldBonus[] {
  return location.bonuses ?? LOCATION_CATALOG[location.kind].bonuses;
}

/**
 * Everything a location is worth at a level. Takes the location, or a bare kind for the kind's
 * own list: a test asking what a Market pays has no particular Market in mind.
 */
export function bonusesAt(
  at: LocationKind | Pick<Location, 'kind' | 'bonuses'>,
  level: number,
): HoldBonus[] {
  const kind = typeof at === 'string' ? at : at.kind;
  const base = typeof at === 'string' ? LOCATION_CATALOG[at].bonuses : baseBonusesOf(at);
  const scale = LOCATION_CATALOG[kind].levelScale ?? LEVEL_SCALE;
  // A ladder may say nothing at a level (the Exercise Yard's fifth session arrives at level 5
  // alone): a bonus worth nothing is not on the card and not in the fold.
  return base.map((bonus) => scaledBonus(bonus, level, scale)).filter(paysSomething);
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
 * Scaled off the kind's own first-upgrade price rather than a global table, because the locations
 * are not interchangeable: a Cinema is a projector and a Nuclear Plant is a coolant loop, and
 * charging the same for both would make half the map not worth touching.
 */
/** A tenth dearer than the catalogue's figures, as every structure is (2026-10-04). */
export const LOCATION_UPGRADE_PRICE_RISE = 1.1;

export function upgradeCost(
  kind: LocationKind,
  level: number,
  /** The Engineer's passive (`passives.ts`, maintainer 2026-10-04): up to half off every line. */
  engineerPercent = 0,
): PartialResources | null {
  const from = clampLevel(level);
  if (from >= MAX_LOCATION_LEVEL) return null;
  const scale = UPGRADE_COST_SCALE[from - 1] as number;
  const engineer =
    1 - Math.max(0, Math.min(CHAIR_PASSIVE_CAP.building_cost, engineerPercent)) / 100;
  const planks =
    LOCATION_CATALOG[kind].upgradeCost * scale * LOCATION_UPGRADE_PRICE_RISE * engineer;
  const cost: PartialResources = {};
  for (const [key, share] of Object.entries(UPGRADE_MIX)) {
    // Floored at one. The scarce channel is a tenth of the timber, so the cheapest kind's first
    // level would round its high-quality metal to 8 and a hypothetical cheaper one to nothing,
    // and a material the order does not mention is a material the order does not teach.
    cost[key as keyof PartialResources] = Math.max(1, Math.round(planks * share));
  }
  return cost;
}

/**
 * The last level, for every kind, in the player's words.
 *
 * Shared rather than authored per location: see {@link LocationSpec.upgrades} for why. The line
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
export function upgradeNote(kind: LocationKind, level: number): string | null {
  const from = clampLevel(level);
  if (from >= MAX_LOCATION_LEVEL) return null;
  const authored = LOCATION_CATALOG[kind].upgrades[from - 1];
  return authored ?? (LATE_UPGRADE_NOTES[from - 1 - AUTHORED_UPGRADE_NOTES] as string);
}

/** One authored location on the map. */
export const LocationSchema = z.object({
  id: z.string().min(1),
  districtId: z.string().min(1),
  name: z.string().min(1),
  kind: LocationKindSchema,
  /**
   * What *this* place is, when the kind's own line will not do.
   *
   * Two rail yards used to read identically, because the sheet printed the kind's blurb and
   * nothing else. Optional, and the sheet falls back to the kind's line, so a location authored
   * without one is not a location with a hole in it (maintainer request, 2026-09-15).
   */
  blurb: z.string().min(1).optional(),
  /**
   * What *this* place pays, when the kind's own list will not do. See {@link baseBonusesOf}.
   *
   * Typed as the bonus union rather than parsed: a location is authored in the atlas and never
   * read off a wire, so the schema is here to shape the object, not to validate a stranger's.
   */
  bonuses: z.custom<readonly HoldBonus[]>((value) => Array.isArray(value)).optional(),
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
  /** Whether `no_ride` is waived, so everything gets a seat. See the `any_ride` bonus. */
  anyRide: boolean;
  /**
   * Marks granted to units that were not written with them, by unit id.
   *
   * A plain record rather than a `Partial<Record<UnitRuleId, ...>>` keyed the other way round,
   * because the engine's question is "what does *this* unit carry", asked once per roster row.
   */
  unitMarks: Record<string, readonly UnitRuleId[]>;
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
  /** Scriptoria held, by level: one page a day each. */
  dailyPages: number[];
  /** The most pamphlets a wall this crew holds carries. The pins themselves are on the control row. */
  pamphletPins: number;
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
  /** Chop Shops held: how many components a day each, at the level that sets their rarity. */
  dailyComponents: { count: number; level: number }[];
  /** The highest Trophy Hall level held, or 0. */
  trophyHallLevel: number;
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
export interface UnitStatFlat {
  stat: FlatUnitStat;
  flat: number;
  tier?: UnitTier;
  damageType?: DamageType;
  rule?: 'guard';
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
    marketDiscountPercent: 0,
    blackMarketDiscountPercent: 0,
    refitDiscountPercent: 0,
    vehiclePartsPercent: 0,
    extraTrainingSessions: 0,
    battleStims: 0,
    salvageRefundPercent: 0,
    intelYieldPercent: 0,
    officerGroupFlat: {},
    officerSkillFlat: {},
    unitTierMoraleFlat: {},
    unitSlotBonus: 0,
    carriersFight: false,
    anyRide: false,
    unitMarks: {},
    steadyNerve: false,
    railLink: false,
    mausoleums: 0,
    unitStatFlats: [],
    carrierLootFlat: 0,
    noiseSwitches: [],
    dailyPages: [],
    pamphletPins: 0,
    missionSpeedPercentByDistrict: {},
    dailyStimPercent: 0,
    casualtyRecoveryPercent: 0,
    doorLevels: {},
    trainingTimePercent: 0,
    goldenJobsByDistrict: {},
    dailyComponents: [],
    trophyHallLevel: 0,
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
}

/**
 * Folds one bonus into a running total. Mutates `into`. It is the accumulator of a reduce.
 *
 * `districtId` is the district of the ground paying it, which only a district-scoped bonus reads
 * (the Printworks' tunnels, a Bounty Wall's golden jobs). One with no district to belong to pays
 * nothing rather than paying everywhere. Reduce through a lambda: handed over point-free, the
 * reduce's index would arrive as the ground.
 */
export function applyHoldBonus(
  into: TerritoryEffects,
  bonus: HoldBonus,
  ground: BonusGround = {},
): TerritoryEffects {
  const { districtId, locationId } = ground;
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
      if (bonus.inDistrict) {
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
      into.missionSpoilsPercent += bonus.percent;
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
    case 'any_ride':
      into.anyRide = true;
      return into;
    case 'steady_nerve':
      into.steadyNerve = true;
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
        ...scoped
      } = bonus;
      into.unitStatFlats = [...into.unitStatFlats, scoped];
      return into;
    }
    case 'carrier_loot_flat':
      into.carrierLootFlat += bonus.flat;
      return into;
    case 'noise_switch':
      if (locationId !== undefined) into.noiseSwitches = [...into.noiseSwitches, locationId];
      return into;
    case 'daily_page':
      into.dailyPages = [...into.dailyPages, bonus.level ?? 1];
      return into;
    case 'pamphlets':
      into.pamphletPins = Math.max(into.pamphletPins, bonus.pins);
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
        { count: bonus.count, level: bonus.level ?? 1 },
      ];
      return into;
    case 'trophies':
      into.trophyHallLevel = Math.max(into.trophyHallLevel, bonus.level ?? 1);
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
      return `-${timeSavingPercent(missionSpeedCut(bonus.percent))}% mission time${bonus.inDistrict ? ' in this district' : ''} ${TAPERS}`;
    // Points into the market's curve (`effectiveMarketDiscount`), not a percent off the till: a
    // level 10 Downtown Market printed "-55%" over a till charging 28.7% less (bug pass, 2026-10-05).
    case 'market_discount':
      return `-${bonus.percent} points off market prices ${TAPERS}`;
    case 'black_market_discount':
      return `-${bonus.percent} points off black-market infamy ${TAPERS}`;
    case 'refit_discount':
      return `-${bonus.percent} points off unit modification cost ${TAPERS}`;
    case 'vehicle_parts':
      return `-${bonus.percent} points off vehicle cost ${TAPERS}`;
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
      return `+${bonus.percent}% mission pay`;
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
    case 'any_ride':
      return 'anything can be put on a machine';
    case 'unit_mark':
      return `${UNIT_RULES[bonus.mark].label} for one unit`;
    case 'steady_nerve':
      return 'a stack that breaks shakes nobody';
    case 'rail_link':
      return `On the line: ${RAIL_LINK_MINUTES} min to any Station you hold`;
    case 'faith':
      return 'Death Cloaks mustered here, and +30 damage and vitality on each for every Mausoleum you hold';
    case 'unit_stat_flat': {
      const who =
        bonus.rule === 'guard'
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
    case 'daily_page':
      return 'a blueprint page a day, of a blueprint you have not finished';
    case 'pamphlets':
      return `${bonus.pins} pamphlet${bonus.pins === 1 ? '' : 's'}: a pinned unit fights you at -5% damage and vitality`;
    case 'daily_stim':
      return `${bonus.percent}% chance of a battle stim each day`;
    case 'casualty_recovery':
      return `+${bonus.percent}% casualty recovery`;
    case 'unit_door':
      return `${unitName(bonus.unitId)} mustered here, stronger at every level`;
    case 'training_time':
      return `-${bonus.percent}% training time`;
    case 'golden_jobs':
      return `${bonus.chancePercent}% of fight jobs here are golden, paying +${bonus.rewardPercent}%`;
    case 'daily_component':
      return `${bonus.count} component${bonus.count === 1 ? '' : 's'} a day`;
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
      return 'ANTI-COMBINE: +10% damage and vitality against the Combine';
    case 'intimidated_infamy':
      return `+${bonus.percent}% infamy for enemy units that were intimidated`;
  }
}

/** What each flat stat is called on a card. */
const FLAT_STAT_LABELS: Record<FlatUnitStat, string> = {
  armor: 'armour',
  offense: 'damage',
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
if (UPGRADE_COST_SCALE.length !== MAX_LOCATION_LEVEL - 1) {
  throw new Error('UPGRADE_COST_SCALE is the wrong length');
}
for (const kind of LOCATION_KINDS) {
  const spec = LOCATION_CATALOG[kind];
  if (!spec) throw new Error(`${kind} has no entry in the location catalogue`);
  if (spec.bonuses.length === 0) throw new Error(`${kind} is worth nothing to hold`);
  if (spec.upgrades.length !== AUTHORED_UPGRADE_NOTES) {
    throw new Error(`${kind} needs ${AUTHORED_UPGRADE_NOTES} upgrade notes`);
  }
  if (!Number.isInteger(spec.upgradeCost) || spec.upgradeCost <= 0) {
    throw new Error(`${kind} has no upgrade price, so it can never be worked up`);
  }
  if (spec.labels.length === 0) {
    throw new Error(`${kind} has no environment labels: every ground fights like something`);
  }
}
