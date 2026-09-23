import { z } from 'zod';
import { UNIT_RULES, UNIT_RULE_IDS, type UnitRuleId, type UnitRuleSpec } from './rules.js';
import {
  BUILDING_KINDS,
  findModification,
  findVehicle,
  type BuildingKind,
  type ColumnUnit,
  type RiderGroup,
} from '../building/index.js';
import { ENV_LABEL_IDS, type EnvLabelId } from '../city/labels.js';
import { LOCATION_KINDS, type LocationKind } from '../city/locations.js';
import type { PartialResources } from '../resources.js';
import { effectiveSpeed } from '../time/speed.js';
import { UNIT_MODIFIERS, type UnitModifierId, type UnitStats } from './stats.js';
import type { UnitTier } from './tiers.js';
import { upgradedStats, type FittedUpgrades } from './upgrades.js';

// Re-exported so every existing `from './catalog.js'` import keeps working: the tiers moved to a
// leaf module only to break an import cycle, which is not a fact callers should have to know.
export { UNIT_TIERS, UnitTierSchema, UNIT_TIER_LABELS, type UnitTier } from './tiers.js';

/**
 * The battle units (GDD §A5).
 *
 * Five tiers, and what separates them is not only power. It is **what you had to do with the
 * world to get them**. Rabble needs a Gauntlet, or in one case nothing at all. Specialists need
 * something researched or a specific augment fitted. Heavy units need a clinic you took off
 * somebody. Legendary units need a location on the map *and* a structure at the top of its tree: the
 * Colossus is built out of a war machine graveyard because that is where the hulls are.
 *
 * That is the whole design intent of the requirement list below: a unit roster is a readout of a
 * campaign, not a shopping list.
 *
 * ## What these numbers are balanced *against*
 *
 * The requirement list, not the price and not the slots. If a roster is a readout of a campaign,
 * then the thing that has to be true of it is that **a unit you had to work harder for is worth
 * more**, and that is a claim about `requires` rather than about `cost`. It is measurable: give
 * every clause a weight (a building level counts its level, a location counts 12, a fitted
 * modification counts 8), play the roster against itself at equal unit slots across nine kinds of
 * ground, and ask how well the ranking by gate depth predicts the ranking by result. The same
 * weights price a kill in `economy/infamy.test.ts`, which is not a coincidence: it is one idea.
 *
 * That correlation was **0.56** before this pass and is **0.83** after it, with the count of
 * "a gate at least ten deeper that loses anyway" down from 37 to 11. Three things did most of it,
 * and none of them was nudging a stat:
 *
 * - Two sheets were priced in unit slots rather than in numbers (`anodics`, `cyber_dogs`). See both.
 * - One sheet promised a mechanic the engine could not read (`stitchers`, now `mends`).
 * - One stat had no counter at all. Armour has had `penetration` on every sheet since the first
 *   draft; evasion had nothing, so the two most evasive units in the game were simply better than
 *   everything against everything. `tracking` is the missing half, and it is deliberately a
 *   modifier rather than a stat: plate is ordinary, and reading somebody's movement is not.
 *
 * Unique units are **not** in that round robin and must not be put in it. A 24-slot budget buys
 * four Cartographers and a fight between four Cartographers is not a fight anybody can have; every
 * conclusion drawn from one is an artefact. They are measured the way the game asks about them
 * instead: one of it plus an escort, against the same slots of escort alone.
 */

/**
 * One condition on fielding a unit. **All** of a unit's clauses must hold.
 *
 * Four kinds, and between them they cover everything the design asks for: "enough Gauntlet
 * levels", "a strong enough Generator", "researched it in the Lab" and "a certain augment fitted"
 * are all `building` or `modification`; "there is a factory in another district that makes them"
 * is `location`; and §B6's Road Reavers need a machine the Garage can actually turn out, which is
 * `vehicle`.
 *
 * `vehicle` is deliberately about what the Garage *can build* rather than about what is parked in
 * it. A unit gate that emptied itself the moment a bike was sent out on a mission would be a unit
 * you could train on Tuesday and not on Wednesday, for reasons nothing on the screen explains.
 */
export type UnitRequirement =
  | { kind: 'building'; building: BuildingKind; level: number }
  | { kind: 'modification'; modificationId: string }
  | { kind: 'location'; locationKind: LocationKind }
  | { kind: 'vehicle'; vehicleId: string };

export interface UnitSpec {
  id: string;
  name: string;
  tier: UnitTier;
  blurb: string;
  /** The structure that runs the work. Most units are trained; a few are *made*. */
  trainedAt: BuildingKind;
  /** Legendary units are one of a kind. You hold one or none. */
  unique: boolean;
  /**
   * Whether this unit can fight at all (§A5, §E).
   *
   * `false` for the scavenger tier, and it is a hard rule rather than a very low offense: a
   * Scavenger is never put in a battle line, never draws fire, and contributes nothing to either
   * side of an exchange. What they are for is carrying: they go on a standard mission alone, or
   * alongside fighters on a battle mission to bring the haul home. Defaulted true, because every
   * unit written before the tier existed was a fighter.
   */
  combat?: boolean;
  /**
   * Whether the enemy has to deal with this stack before anything behind it (§A5).
   *
   * A targeting rule, not a stat, which is why it is a flag here rather than a row in
   * `UNIT_MODIFIERS`: every entry in that table is percentage points on a number, and this one
   * changes *who gets shot at*. The engine reads it in `battle/engine.ts`.
   *
   * What it buys is a sheet that is worth fielding while being bad at the thing the engine scores
   * units on. Targeting picks by damage-per-point-of-enemy-health, so a wall with no damage and a
   * lot of health is the least attractive target on the field: without this, a shield line is
   * walked past and the people behind it are shot instead, which is the exact opposite of what a
   * shield line is.
   */
  taunts?: boolean;
  /**
   * Whether this unit patches the line back together between volleys (§A5).
   *
   * The second flag on this interface, and it is here for the same reason as `taunts`: it is not
   * points on a number, it is a rule about what happens to somebody *else*. A medic undoes part of
   * a round's damage before it is counted, so the people it saves are still standing when the
   * morale phase asks how the line is doing. The engine reads it in `battle/engine.ts`.
   *
   * A medic never works on itself: `mend` skips the mending stacks, which is what keeps this an
   * argument for bringing one **alongside** a line rather than a way for a field hospital with no
   * fighters in it to outlast an army. That asymmetry is the unit: a Stitcher that could keep
   * itself alive would be a cheap Warden, and a Stitcher standing behind Wardens is a Stitcher.
   */
  mends?: boolean;
  /**
   * Whether this one is simply too big to get into anything the Garage builds (§C3).
   *
   * The first **negative** rule on a sheet, and the reason `UnitRuleSpec.tone` exists. A Colossus
   * is a war-machine hull on legs; there is no seat in the city it fits in, so it walks at its own
   * 15 whatever is in the yard, and `columnSpeed` holds the whole column to it. Bringing one is a
   * decision about the road as well as about the fight.
   */
  no_ride?: boolean;
  /**
   * Whether this stack gets its shot away before either line is in position.
   *
   * The second opening in the game and deliberately not the first. `ambush` is a *modifier*: it is
   * the attacker's alone, it is bought with stealth, and a Cartographer looking the right way can
   * cancel it outright. This is a rule on the sheet, so it is worth the same to a defender standing
   * on its own doorstep as to a raiding party, and nothing on the other side turns it off. What it
   * costs is that it is smaller: {@link FIRST_STRIKE_SHARE} against the ambush's 0.6, because a
   * volley nobody can prevent has to be worth less than one somebody can.
   */
  strikes_first?: boolean;
  /**
   * Whether this stack stays in the line after the men beside it have gone.
   *
   * Morale is the fastest way to lose a fight in this engine: one stack breaks, the cascade term
   * pushes the next one over, and a force that was winning on casualties walks off the ground. A
   * stalwart sheet is the answer to that and it is deliberately not "high morale", which is a
   * number the same cascade eats. It cannot rout while over half its units are standing, full
   * stop, and once it is under half it breaks like anything else: the rule buys a line that holds
   * long enough to be worth rallying behind, never a stack that cannot be beaten.
   */
  stalwart?: boolean;
  /**
   * Whether this stack takes the defender's works apart rather than shooting over them.
   *
   * Fortification is the one defensive number nothing on an attacking sheet could touch. Armour has
   * `penetration`, evasion has `tracking`, and a level-10 barricade behind a Gate had no counter
   * except bringing more people. A sapper cuts the ground's own contribution for the whole
   * attacking side, so bringing two of them is a plan rather than a rounding error, and
   * {@link MAX_SAPPER_CUT} keeps the works worth building.
   */
  sapper?: boolean;
  /**
   * Whether this unit fights better for every other one of itself in the line.
   *
   * The one bonus a player buys by *massing a single sheet*, which is a decision the roster had no
   * way to reward: combat width punishes stacking, tier bonuses reward fielding a class, and
   * nothing at all rewarded fielding forty of one thing.
   *
   * Per other unit of the same unit, on a curve that converges rather than a line that stops:
   * see {@link packBonusPercent}. Every extra body is worth something and each is worth less
   * than the last, so it is a reason to commit and never a reason to bring literally everything.
   */
  pack?: boolean;
  /**
   * Whether this unit makes the ground it fights on unbearable to be next to (maintainer,
   * 2026-09-19).
   *
   * The Anodics, and the one sheet in the game whose *environment* is the weapon. They already
   * fight better in a racket (`affinities.noisy: 11`); this is the other half, which is that
   * they bring one. See {@link loudGround}: the enemy's stacks are built against a copy of the
   * battlefield with `noisy` on it, so what the din costs is decided by each enemy sheet's own
   * armour, morale and affinities rather than by a flat number here.
   *
   * Scoped to the fight and to the other side. Nothing is written to the location, and the loud
   * side reads the ground unchanged.
   */
  loud?: boolean;
  /**
   * Whether this stack spends the fight inside the other side's augmentations (maintainer,
   * 2026-09-18).
   *
   * The first sheet whose contribution is **not damage**. A Netrunner used to be a 460-offense
   * energy gun with Armour Piercing bolted on, which made it a Sniper with a different picture:
   * the blurb said "hijack enemy augmentations mid-fight" and the numbers said "shoots people".
   * It does 20 now, and what it is worth is this.
   *
   * Read **per round**, off the stacks still standing, and applied before anybody fires: the
   * enemy line's armour and its damage both come off by {@link jamPercent}. That is two effects
   * from one rule on purpose, and it is what makes a jammer worth a slot beside a line rather
   * than instead of one: it is worth nothing on its own (nobody to make more dangerous, nobody to
   * protect) and it makes everything standing next to it hit harder and take less.
   *
   * Killing them turns it off, which is the counterplay. There is no saving throw and no armour
   * against it, which is why the ceiling is low.
   */
  jammer?: boolean;
  /**
   * Whether this unit can be planted on ground the crew does not hold (maintainer, 2026-09-18).
   *
   * The Sleepers, and the rule their blurb has promised since the roster was written: "Planted
   * long ago, and useful exactly once. They are already inside." See `sleepers.ts` for what a
   * cell is, and why it is the only way in the game to have force somewhere before you have said
   * you want it.
   *
   * A flag rather than an id checked at the doors, for the reason every other rule on this
   * interface is one: the door that forgets is the one that ships.
   */
  sleeper?: boolean;
  /**
   * Never in a spy report. A spy counting a garrison walks straight past this sheet, whatever
   * the tier and whatever the rung; it is only ever met, in a battle report, once it has struck.
   * The card says so ({@link UNIT_RULES.unspyable}), because a player paying ten thousand caps
   * for Total Intelligence is owed the reason it came back one body short.
   */
  unspyable?: boolean;
  /**
   * Who fields this sheet, when it is not the player (maintainer, 2026-09-19).
   *
   * The Combine's own units: the conscripts, the grey infantry, the enforcers, the suppressors
   * and the three people who run the city from behind them. They are met, never held. No door in
   * the game trains one, no roster lists one, no console grants one, and the balance sheet does
   * not price one, which is what {@link PLAYER_UNITS} and {@link isPlayerUnit} exist to say in
   * one place. `cost`, `requires` and `trainSeconds` are still on the sheet because the type is
   * shared with the roster, and they are the empty values: a Combine sheet with a price on it
   * would be a promise somebody could try to collect.
   *
   * Absent on everything a player can train. A second faction is a second literal here and a
   * second garrison table in `city/control.ts`; nothing else in the game reads the word.
   */
  faction?: 'combine';
  requires: readonly UnitRequirement[];
  cost: PartialResources;
  trainSeconds: number;
  /**
   * What one of these costs against the district's unit slots, and against a vehicle's seats.
   *
   * A Colossus is not one soldier. One currency, spent in two places: the beds
   * (`building/unit-slots.ts`) and the machines that carry a column (`building/vehicles.ts`), so a
   * sheet that takes three slots at home takes three off a truck's thirty.
   */
  unitSlots: number;
  stats: UnitStats;
  modifiers: readonly UnitModifierId[];
  /**
   * Percentage points **per tier** added to what an environment label is already worth to this
   * unit (`city/labels.ts`).
   *
   * Almost every unit leaves this empty and is answered by the label's own stat rule: a
   * Juggernaut cooks in the heat because it is wearing ninety-five points of armour, not because
   * somebody typed a row for it. What goes here is the handful of cases a sheet genuinely cannot
   * express: Anodics fight *better* in a room full of noise, and no combination of their eleven
   * numbers says so.
   */
  affinities?: Partial<Record<EnvLabelId, number>>;
  /**
   * Labels whose baseline simply does not apply. The affinity, if any, still does.
   *
   * For the things that are not really people: a machine is not frightened by an eerie room and a
   * creature that breathes chlorine is not troubled by a chlorine leak. Immunity rather than a
   * large positive affinity, because "immune" is a fact a player can rely on and "+13 per tier
   * which happens to cancel out at this armour value" is a coincidence that breaks on a rebalance.
   */
  immuneTo?: readonly EnvLabelId[];
}

export { UNIT_RULES, UNIT_RULE_IDS };
export type { UnitRuleId, UnitRuleSpec };

/** The rules this unit carries, in table order. Empty for most of the roster. */
export function unitRules(
  unit: UnitSpec,
): { id: UnitRuleId; label: string; description: string; tone: 'positive' | 'negative' }[] {
  return UNIT_RULE_IDS.filter((id) => unit[id] === true).map((id) => ({
    id,
    ...UNIT_RULES[id],
    tone: (UNIT_RULES[id] as UnitRuleSpec).tone ?? 'positive',
  }));
}

/** The middle of the road. Every unit below states only what makes it different from this. */
const BASE_STATS: UnitStats = {
  speed: 40,
  vitality: 100,
  morale: 50,
  armor: 10,
  damageType: 'ballistic',
  resistances: {},
  penetration: 5,
  range: 30,
  offense: 175,
  evasion: 10,
  stealth: 20,
  lootCapacity: 20,
  intimidation: 10,
};

const sheet = (over: Partial<UnitStats>): UnitStats => ({ ...BASE_STATS, ...over });

const gauntlet = (level: number): UnitRequirement => ({
  kind: 'building',
  building: 'gauntlet',
  level,
});
const structure = (building: BuildingKind, level: number): UnitRequirement => ({
  kind: 'building',
  building,
  level,
});
const fitted = (modificationId: string): UnitRequirement => ({
  kind: 'modification',
  modificationId,
});
const holds = (locationKind: LocationKind): UnitRequirement => ({ kind: 'location', locationKind });
/** §B6: the Garage can turn this machine out, which is a different claim from owning one. */
const canBuild = (vehicleId: string): UnitRequirement => ({ kind: 'vehicle', vehicleId });

export const UNIT_CATALOG: readonly UnitSpec[] = [
  // ---------------------------------------------------------------- rabble
  {
    id: 'razors',
    name: 'Razors',
    tier: 'rabble',
    blurb: 'Light blade-wielding urban fighters. Cheap, willing, and not expected back.',
    trainedAt: 'gauntlet',
    unique: false,
    /**
     * The Gauntlet at its first level, and nothing else: the cheapest gate on any fighter.
     *
     * This doc block said "nothing at all: the only unit in the game with no requirement" until
     * 2026-09-18, and the clause under it said `gauntlet(1)`. The two had disagreed since the
     * Gauntlet moved behind Nexus 3 and Quarters 2 on 2026-09-01, which turned the sentence into
     * a promise the opening did not keep: a new crew could train nothing at all, and the eight
     * Razors it is handed were the only bodies it would see for hours.
     *
     * What actually keeps the first session moving is the carrier bench at the bottom of this
     * file. Scavengers answer to the Nexus a new district already has, so there is always
     * somebody to put on the street, and the Razor stays what it reads as: the first thing the
     * barracks gives you for building one.
     */
    requires: [gauntlet(1)],
    cost: { caps: 40, supplies: 10 },
    trainSeconds: 45,
    unitSlots: 1,
    stats: sheet({
      speed: 45,
      vitality: 75,
      morale: 40,
      armor: 5,
      resistances: { energy: 15, explosive: -35 },
      damageType: 'blade',
      penetration: 8,
      range: 5,
      offense: 160,
      evasion: 15,
      stealth: 30,
      lootCapacity: 25,
      intimidation: 8,
    }),
    modifiers: ['urban_bonus', 'close_quarters'],
  },
  {
    id: 'anodics',
    name: 'Anodics',
    tier: 'rabble',
    blurb:
      'Overqualified, over-medicated and unaccountably hard to put down. Somebody who read every book in the district, shaved most of it off, and came down here with a bottle of speed and a plan.',
    trainedAt: 'gauntlet',
    unique: false,
    /*
     * They are the noise. `loud` puts `noisy` on the ground the other side is standing on, which
     * is the same label their own `affinities.noisy: 11` already rewards them for: this sheet
     * wants a room it cannot hear itself think in, so it brings one.
     */
    loud: true,
    requires: [structure('scrapyard', 2)],
    /**
     * The cheapest thing in the game that can take a hit.
     *
     * Rabble tier and priced like it, but with a Warden's constitution and a middling everything
     * else: the first unit worth fielding in numbers once there is a Gauntlet to train them in.
     * (Razors remain the one thing a crew with no barracks can put on the street; that is their
     * whole job, and nothing else is allowed to take it.)
     *
     * What Anodics are *for* is the ground, not the sheet: a room, a tunnel, a factory floor with a
     * press running. Fight them in a yard and they are worse than Razors.
     *
     * **Two unit slots, and the sheet is the thing that stayed.** At one they were the single largest
     * distortion in the roster: a gate-2 unit taking 76% of its matchups and beating the Twins, the
     * Cyberhounds and every specialist in the game, which put eight of the roster's gate inversions
     * behind this one row. The cause was the count, not the numbers: at one slot a budget bought
     * twenty-four of them, and twenty-four units with a Warden's constitution is a wall that also
     * shoots. Three fixes were measured and this is the one that left the unit recognisable: gutting
     * the sheet to 115 offense and 100 vitality moved the roster's gate-to-strength correlation from
     * 0.64 only to 0.67, while pricing the count properly took it to 0.80 with the sheet almost
     * exactly as authored.
     */
    cost: { caps: 55, supplies: 15, scrap: 10 },
    trainSeconds: 60,
    unitSlots: 2,
    stats: sheet({
      speed: 40,
      vitality: 140,
      morale: 66,
      armor: 15,
      resistances: { chemical: 30, ballistic: -30 },
      damageType: 'blunt',
      penetration: 10,
      range: 12,
      offense: 190,
      evasion: 8,
      stealth: 8,
      lootCapacity: 18,
      intimidation: 22,
    }),
    modifiers: ['close_quarters', 'last_stand'],
    /**
     * The one unit whose whole identity is a label.
     *
     * **Noisy** is the headline and it is not a metaphor: they are running on something that turns
     * a room full of machinery into a reason to keep going, and a press hall or a full tavern is
     * where they are worth twice what they cost. **Crammed** doubles down on the close-quarters
     * modifier they already carry. **Open** is the bill for both: in a yard with sightlines they
     * are a slow target with a bottle.
     *
     * **Eerie** is the quiet one: they are far too wired to be unnerved by anything, which is not
     * courage and does not need to be.
     */
    affinities: { noisy: 11, crammed: 7, eerie: 5, open: -5 },
  },
  {
    id: 'sparks',
    name: 'Sparks',
    tier: 'rabble',
    blurb: 'Young recruits with jury-rigged weapons. Hit hard once, then hope.',
    trainedAt: 'gauntlet',
    unique: false,
    /*
     * They are only dangerous in a crowd, which is the whole sheet (maintainer, 2026-09-19).
     *
     * A Spark is one big hit and 55 hit points: on its own it is the most fragile thing anybody
     * fields, and the blurb already says so. `pack` is what makes that a shape rather than a
     * weakness, and it moved here off the Condemned, who are three unit slots of heavy rabble
     * and did not need a fourth reason to be good.
     */
    pack: true,
    requires: [structure('generator', 2)],
    cost: { caps: 45, supplies: 5, scrap: 20 },
    trainSeconds: 50,
    unitSlots: 1,
    stats: sheet({
      speed: 40,
      vitality: 55,
      morale: 30,
      armor: 3,
      damageType: 'blunt',
      // Fifty-five hit points and no plate at all.
      resistances: { energy: 15, explosive: -40, blunt: -25 },
      penetration: 18,
      range: 45,
      offense: 280,
      evasion: 8,
      stealth: 15,
      lootCapacity: 15,
      intimidation: 6,
    }),
    modifiers: ['urban_bonus'],
  },
  {
    id: 'scrapers',
    name: 'Scrapers',
    tier: 'rabble',
    blurb: 'Scavengers turned fighters. Light armour, quick hands, gone before the answer comes.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(2)],
    cost: { caps: 50, supplies: 10, scrap: 25 },
    trainSeconds: 55,
    unitSlots: 1,
    stats: sheet({
      speed: 50,
      vitality: 78,
      morale: 45,
      armor: 6,
      resistances: { chemical: 15, blade: -30 },
      damageType: 'blade',
      penetration: 10,
      range: 10,
      offense: 165,
      evasion: 25,
      stealth: 40,
      lootCapacity: 60,
      intimidation: 5,
    }),
    modifiers: ['urban_bonus', 'ambush'],
  },

  // --------------------------------------------------------------- regulars
  {
    id: 'breakers',
    name: 'Breakers',
    tier: 'heavy',
    blurb: 'Door-kicking close-quarters specialists. Whatever is behind it, they go through it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(4)],
    cost: { caps: 120, supplies: 20, scrap: 60, oil: 15 },
    trainSeconds: 150,
    unitSlots: 2,
    stats: sheet({
      speed: 40,
      vitality: 122,
      morale: 60,
      armor: 24,
      resistances: { explosive: 35, energy: -25 },
      damageType: 'blade',
      penetration: 12,
      range: 15,
      offense: 225,
      evasion: 8,
      stealth: 10,
      lootCapacity: 30,
      intimidation: 30,
    }),
    modifiers: ['close_quarters', 'breaching'],
  },
  {
    id: 'wardens',
    name: 'Wardens',
    tier: 'heavy',
    blurb: 'Defensive specialists. Considerably better at holding a location than at taking one.',
    trainedAt: 'gauntlet',
    unique: false,
    // Riot shields and a standing order. The job is to be the thing that is still there.
    stalwart: true,
    requires: [gauntlet(5)],
    cost: { caps: 130, supplies: 20, scrap: 80 },
    trainSeconds: 160,
    unitSlots: 2,
    stats: sheet({
      speed: 28,
      vitality: 168,
      morale: 70,
      armor: 40,
      damageType: 'blunt',
      resistances: { blade: 25, explosive: -20 },
      penetration: 6,
      range: 40,
      offense: 172,
      evasion: 5,
      stealth: 8,
      lootCapacity: 20,
      intimidation: 20,
    }),
    modifiers: ['dug_in', 'last_stand'],
  },
  {
    id: 'ghosts',
    name: 'Ghosts',
    tier: 'specialist',
    blurb: 'Lightly armed and hard to pin down. Fighting them is easy. Finding them is the job.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(6)],
    cost: { caps: 160, supplies: 25, oil: 20 },
    trainSeconds: 180,
    unitSlots: 2,
    stats: sheet({
      speed: 50,
      vitality: 115,
      morale: 55,
      armor: 15,
      // Built to not be where the swing lands, and ruined when it is.
      resistances: { energy: 20, ballistic: -25, blunt: -20 },
      damageType: 'blade',
      penetration: 25,
      range: 15,
      offense: 310,
      evasion: 35,
      stealth: 85,
      lootCapacity: 25,
      intimidation: 5,
    }),
    modifiers: ['night_operations', 'ambush'],
    affinities: { dark: 8, foggy: 4, noisy: -7 },
  },
  {
    id: 'road_reavers',
    name: 'Road Reavers',
    tier: 'wonder',
    blurb: 'Motorcycle raiders. Fast, loud, aggressive, and halfway home with your fuel.',
    trainedAt: 'garage',
    unique: false,
    requires: [gauntlet(7), structure('garage', 4), canBuild('motorcycle')],
    cost: { caps: 180, supplies: 25, scrap: 90, oil: 60 },
    trainSeconds: 200,
    unitSlots: 2,
    stats: sheet({
      speed: 65,
      vitality: 115,
      morale: 55,
      armor: 18,
      damageType: 'ballistic',
      resistances: { blade: 35, explosive: -25 },
      penetration: 14,
      range: 35,
      offense: 250,
      evasion: 30,
      stealth: 10,
      lootCapacity: 70,
      intimidation: 35,
    }),
    modifiers: ['open_field', 'urban_bonus'],
    // Motorcycles. Wet, snow and a corridor are all the same answer.
    // They are the noise. Somewhere already loud is somewhere nobody hears them coming until
    // the engines are the only thing anybody can hear.
    affinities: { wet: -6, snowy: -7, crammed: -7, open: 6, noisy: 8 },
  },
  /**
   * The wall, and the only unit in the game that is not trying to win the fight.
   *
   * Its damage is the lowest of anything that fights at all: 45 against a Razor's 160, which is
   * roughly one Razor's worth of harm from three units. Everything it has is on the other side of
   * the ledger, 520 hit points and 70 points of plate, and `bulwark` adds seventy percent of that
   * again while it is holding ground. It cannot take a location. It can make one cost more than it
   * is worth.
   *
   * `taunts` is what makes any of that matter, and without it the sheet is worthless rather than
   * defensive. Targeting is by damage per point of enemy health (`threatWeight`), so a unit built
   * with no damage and a great deal of health is the *least* attractive target on the field: the
   * enemy would walk past the shield wall and shoot the Snipers behind it, which is precisely the
   * arrangement a shield wall exists to prevent.
   */
  {
    id: 'ironsides',
    name: 'Ironsides',
    tier: 'heavy',
    blurb: 'A shield wall of salvaged plate. It will not beat you. It will not move, either.',
    trainedAt: 'gauntlet',
    unique: false,
    taunts: true,
    requires: [structure('scrapyard', 5), structure('gate', 6)],
    cost: { caps: 200, supplies: 30, scrap: 140, highQualityMetal: 10 },
    trainSeconds: 240,
    unitSlots: 3,
    stats: sheet({
      speed: 22,
      vitality: 470,
      morale: 85,
      armor: 64,
      damageType: 'blunt',
      // A shield wall is the answer to being hit with things.
      resistances: { ballistic: 35, blade: 35, explosive: -30, blunt: 35 },
      penetration: 5,
      range: 10,
      offense: 45,
      evasion: 3,
      stealth: 5,
      lootCapacity: 25,
      // Deliberately unimpressive, and it is the number that makes the sheet *bad at attacking*.
      // Measured, not guessed: at 40 a stack of these took every equal-slot fight it started,
      // because this engine settles a stalemate by who breaks first and a wall never breaks. It
      // was winning by outlasting rather than by killing, which is the opposite of the brief. At
      // 25 the same stack loses the fights it starts and holds the ones it is given.
      intimidation: 25,
    }),
    modifiers: ['bulwark', 'dug_in'],
    // Salvaged plate, worn all day. The cold is somebody else's problem.
    affinities: { cold: 5, hot: -5, snowy: -4 },
  },
  {
    id: 'ash_walkers',
    name: 'Ash Walkers',
    tier: 'rabble',
    blurb: 'Chem-suited troops who go where the air is wrong and come back out of it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(6), structure('greenhouse', 5)],
    cost: { caps: 190, supplies: 30, scrap: 70, oil: 40 },
    trainSeconds: 220,
    unitSlots: 2,
    stats: sheet({
      speed: 35,
      vitality: 170,
      morale: 65,
      armor: 42,
      damageType: 'chemical',
      /*
       * A sealed suit is not armour (maintainer, 2026-09-19).
       *
       * They lost `picker` and what replaced it is the honest reading of what they are wearing.
       * Chem gear is a barrier against *air*: it stops what the ash belt does to lungs and it
       * does nothing whatever about a blade, a bullet or a blast. The three ordinary lethal
       * types all get through it, which is what "weaknesses in more stuff that could affect
       * people with no armour at all" means on this sheet: the forty-two points of armour on the
       * line above are the plate, and none of it is on the suit.
       */
      resistances: { chemical: 90, blade: -25, ballistic: -20, explosive: -25 },
      penetration: 8,
      range: 25,
      offense: 275,
      evasion: 8,
      stealth: 15,
      lootCapacity: 30,
      intimidation: 25,
    }),
    // `urban_bonus` on a sheet that also carries `tunnel_rat`: below the street and on it are
    // the two places these people know, which is the same claim their blurb already makes.
    modifiers: ['tunnel_rat', 'urban_bonus'],
    // Chem suits. The whole unit exists for the air being wrong, so the one label that
    // decides most of a chemical plant does not touch them.
    immuneTo: ['toxic'],
    // ...and the one place the suit is a liability rather than a shield: a visor, a filter and
    // your own breathing in your ears is no way to be somewhere that is already wrong.
    // A visor and a filter is no way to hear anything coming: the suit that makes the air
    // survivable is the reason a racket is worse for them than for anybody else.
    affinities: { hot: -4, noisy: -8 },
  },

  // ------------------------------------------------------------ specialists
  {
    id: 'snipers',
    name: 'Snipers',
    tier: 'specialist',
    blurb: 'Long range, one shot, one kill. Everything else is spent waiting for it.',
    trainedAt: 'gauntlet',
    unique: false,
    // A rifle at 95 range is already firing while everybody else is still crossing the yard.
    strikes_first: true,
    requires: [structure('gate', 7), fitted('gauntlet_live_fire_range')],
    cost: { caps: 260, supplies: 40, scrap: 60, highQualityMetal: 12 },
    trainSeconds: 300,
    unitSlots: 2,
    stats: sheet({
      speed: 30,
      vitality: 85,
      morale: 60,
      armor: 8,
      damageType: 'ballistic',
      resistances: { explosive: 15, chemical: -35 },
      penetration: 60,
      range: 95,
      offense: 350,
      evasion: 12,
      stealth: 60,
      lootCapacity: 10,
      intimidation: 25,
    }),
    /*
     * No `tracking`, and the reason is the rule directly above it in `matchup.test.ts`.
     *
     * A Sniper is countered by something fast enough to close on it, which in this roster is
     * something evasive. Handing them the answer to evasion hands them the answer to their own
     * counter: with it, a Sniper beat a Road Reaver in both directions and the whole range/speed
     * axis collapsed. Reach is the Sniper's edge and it is supposed to end when the enemy arrives.
     */
    modifiers: ['rooftop', 'open_field'],
    // A rifle is a promise about a sightline, and fog, wind and a low ceiling all break it.
    affinities: { elevated: 7, foggy: -7, windy: -5 },
  },
  {
    id: 'stitchers',
    name: 'Stitchers',
    tier: 'specialist',
    blurb: 'Field medics. Contribute nothing to a fight and decide how many walk out of it.',
    trainedAt: 'gauntlet',
    unique: false,
    /**
     * The one unit in the game that is worth nothing on its own and changes every fight it is in.
     *
     * `mends` is what the blurb has always claimed and the engine could not read: for four
     * revisions this sheet was 60 offense and a middling unit, which is to say a bad Razor, and it
     * won 0 of 290 matchups because losing every straight fight was the entire mechanic. It still
     * loses every straight fight. What is different is that it now costs the other side something
     * to *cause* the casualties it is standing there to undo.
     */
    mends: true,
    requires: [gauntlet(7), structure('infirmary', 5)],
    cost: { caps: 220, supplies: 60 },
    trainSeconds: 280,
    /**
     * One, and the rest of this sheet, is what makes the mechanic playable rather than merely
     * present. Measured, at 42 slots of defenders against 16 Breakers across nine grounds:
     *
     * - At two slots the flag alone was still a losing trade. Four medics cost four Wardens and the
     *   line came out 2.9 units *worse*, because a fight here is decided by breaking the other
     *   side's morale and four fewer Wardens is four fewer people shooting.
     * - The medics were also dying first. Targeting is damage per point of enemy health
     *   (`threatWeight`), so a 100-vitality bag of bandages standing beside 185-vitality armour is
     *   the most attractive thing on the field, and by the last round of a six-round fight the
     *   hospital was gone. Evasion is the answer that fixes both halves at once: it is a miss
     *   chance, so it lowers what they take *and* what they are worth shooting at.
     *
     * At one slot with 45 evasion behind 120 vitality, two medics are worth +0.4 units and ten are
     * worth +4.6, while holding the ground still dips in the middle of that range. That dip is the
     * design: medics are a real choice and not a free one. A stronger sheet was measured too (55
     * evasion, 130 vitality) and rejected for being strictly better at every count, which is a unit
     * with no decision in it.
     */
    unitSlots: 1,
    stats: sheet({
      speed: 35,
      vitality: 120,
      morale: 70,
      armor: 20,
      // A medic is the softest thing on the field and everybody knows it.
      resistances: { chemical: 50, blade: -30, blunt: -30 },
      damageType: 'blade',
      penetration: 2,
      range: 10,
      offense: 60,
      evasion: 45,
      stealth: 25,
      lootCapacity: 20,
      intimidation: 2,
    }),
    modifiers: ['dug_in'],
    // Medics are not fighting; what stops them is not being able to find anybody.
    affinities: { dark: -6, foggy: -5, eerie: -5 },
  },
  {
    id: 'demolishers',
    name: 'Demolishers',
    tier: 'specialist',
    blurb:
      'Explosive ordnance experts. Uninterested in your people; very interested in your walls.',
    trainedAt: 'gauntlet',
    unique: false,
    // Charges cut for the wall rather than the man behind it.
    sapper: true,
    requires: [structure('scrapyard', 6), structure('generator', 8)],
    cost: { caps: 280, supplies: 40, scrap: 120, oil: 80, highQualityMetal: 15 },
    trainSeconds: 330,
    unitSlots: 3,
    stats: sheet({
      speed: 28,
      vitality: 180,
      morale: 55,
      armor: 32,
      resistances: { explosive: 45, energy: -25 },
      damageType: 'explosive',
      penetration: 20,
      range: 40,
      offense: 420,
      evasion: 6,
      stealth: 10,
      lootCapacity: 25,
      intimidation: 45,
    }),
    modifiers: ['breaching', 'armor_piercing'],
  },
  {
    id: 'kite_crews',
    name: 'Kite Crews',
    tier: 'wonder',
    blurb: 'Drone operators working off rooftops. They see the fight before anybody is in it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [structure('lab', 5), structure('generator', 8)],
    cost: { caps: 280, supplies: 40, scrap: 40, highQualityMetal: 18 },
    trainSeconds: 310,
    unitSlots: 2,
    stats: sheet({
      speed: 85,
      vitality: 135,
      morale: 55,
      armor: 16,
      resistances: { blade: 25, energy: -40 },
      damageType: 'energy',
      penetration: 12,
      range: 75,
      offense: 290,
      evasion: 22,
      stealth: 50,
      lootCapacity: 12,
      intimidation: 10,
    }),
    modifiers: ['rooftop', 'open_field', 'tracking'],
    // Drones. Weather is the whole of their problem and the ground is none of it.
    affinities: { windy: -9, foggy: -6, elevated: 6 },
  },
  {
    id: 'netrunners',
    name: 'Netrunners',
    tier: 'specialist',
    blurb: 'Combat hackers who hijack enemy augmentations mid-fight. Nobody enjoys meeting them.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(9), structure('lab', 8), fitted('lab_quantum_modeling')],
    cost: { caps: 360, supplies: 55, highQualityMetal: 30 },
    trainSeconds: 380,
    unitSlots: 3,
    stats: sheet({
      speed: 40,
      vitality: 150,
      morale: 65,
      armor: 20,
      resistances: { energy: 40, explosive: -20 },
      damageType: 'energy',
      penetration: 35,
      range: 55,
      // Twenty, and the blurb is finally the sheet (maintainer, 2026-09-18). They were a
      // 460-offense energy gun with Armour Piercing on it, which is a Sniper wearing a hacker's
      // description. What they are worth is `jammer`, below: they barely shoot.
      offense: 20,
      evasion: 20,
      stealth: 55,
      lootCapacity: 10,
      intimidation: 20,
    }),
    // `armor_piercing` is gone with the damage that made it mean anything: 30% more of twenty is
    // six.
    modifiers: ['night_operations', 'tracking'],
    jammer: true,
    // They work off other people's augmentations, and a wet street does nothing to that.
    affinities: { crammed: 5, eerie: -4 },
  },
  {
    id: 'sleepers',
    name: 'Sleepers',
    tier: 'specialist',
    blurb: 'Planted long ago, and useful exactly once. They are already inside.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [structure('nexus', 9), fitted('nexus_encrypted_core')],
    cost: { caps: 340, supplies: 50, oil: 30 },
    trainSeconds: 360,
    unitSlots: 2,
    stats: sheet({
      speed: 40,
      vitality: 125,
      morale: 75,
      armor: 14,
      resistances: { energy: 15, explosive: -30 },
      damageType: 'blade',
      penetration: 45,
      range: 10,
      offense: 360,
      evasion: 25,
      stealth: 95,
      lootCapacity: 15,
      intimidation: 10,
    }),
    modifiers: ['ambush', 'urban_bonus'],
    // §A4: the one sheet that can be somewhere before you have said you want it.
    sleeper: true,
  },
  {
    id: 'cyber_dogs',
    name: 'Cyberhounds',
    tier: 'wonder',
    blurb:
      'Augmented working dogs off the kennels under the flyover. They find what is hiding and they do not need to see it to do it.',
    trainedAt: 'infirmary',
    unique: false,
    // They hunt as one animal, and a big pack is not a bigger dog.
    pack: true,
    requires: [structure('infirmary', 6), holds('doghouse')],
    cost: { caps: 190, supplies: 90, highQualityMetal: 15 },
    trainSeconds: 420,
    /**
     * Two, because one was the best buy in the game by a factor of two and nothing on the sheet
     * said so.
     *
     * Measured as power per unit slot (`sqrt(offense x effective hit points) / unitSlots`, the
     * ratio a fixed army cap actually spends against): the Cyberhounds came out at 179 against a
     * roster median of 78. That is not a strong unit, it is a mispriced one, and it showed up as a
     * gate-18 unit beating the Hollow Men, the Twins and two legendaries. The sheet is untouched:
     * a hound is still fast, still hunts by nose, and still hits like a hound. What changed is that
     * it comes with a handler.
     */
    unitSlots: 2,
    stats: sheet({
      speed: 90,
      vitality: 90,
      morale: 72,
      armor: 8,
      resistances: { explosive: 15, chemical: -45 },
      damageType: 'energy',
      penetration: 30,
      range: 4,
      offense: 290,
      evasion: 38,
      stealth: 55,
      lootCapacity: 0,
      intimidation: 45,
    }),
    modifiers: ['ambush', 'night_operations'],
    /**
     * They hunt by nose, so the two labels that blind everybody else are the two they are best in.
     * What stops them is noise, a press hall is a dog with no ears, and anything that makes the
     * handler's job harder makes theirs impossible.
     */
    affinities: { dark: 7, foggy: 9, noisy: -7 },
  },
  {
    id: 'juggernauts',
    name: 'Juggernauts',
    tier: 'heavy',
    blurb:
      'Fully augmented heavy assault units. Barely human any more, and no longer bothered by it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [structure('generator', 10), structure('infirmary', 9), holds('gene_clinic')],
    cost: { caps: 700, supplies: 105, scrap: 300, oil: 200, highQualityMetal: 90 },
    trainSeconds: 900,
    unitSlots: 6,
    stats: sheet({
      speed: 25,
      vitality: 365,
      morale: 85,
      armor: 68,
      damageType: 'explosive',
      // Ninety-five points of plate does not care about a pipe.
      resistances: { ballistic: 40, blade: 50, energy: -35, blunt: 25 },
      penetration: 18,
      range: 45,
      offense: 355,
      evasion: 2,
      stealth: 2,
      lootCapacity: 50,
      intimidation: 75,
    }),
    modifiers: ['armor_piercing', 'last_stand'],
  },
  {
    id: 'hollow_men',
    name: 'Hollow Men',
    // §D12i: a wonder of engineering rather than a heavy. What is on this sheet is not a big
    // soldier, it is a person a gene clinic and a Lab at 13 turned into something else, which is
    // the same class of work as a Cyberhound or a Twin. It also moves the unit out of the reach of
    // `boost_plated_overnight`, which buys the heavy line defence: shock troops with the fear cut
    // out are not what a night of welding plate helps.
    tier: 'wonder',
    blurb: 'Shock troops with the fear surgically removed. It took the rest of it with it.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [structure('infirmary', 10), structure('lab', 13), holds('gene_clinic')],
    cost: { caps: 650, supplies: 200, highQualityMetal: 70 },
    trainSeconds: 840,
    unitSlots: 5,
    stats: sheet({
      speed: 45,
      vitality: 225,
      morale: 100,
      armor: 45,
      damageType: 'blunt',
      resistances: { chemical: 35, energy: -45 },
      penetration: 30,
      range: 15,
      offense: 345,
      evasion: 12,
      stealth: 20,
      lootCapacity: 30,
      intimidation: 70,
    }),
    modifiers: ['close_quarters', 'terror'],
    // The fear was removed surgically. So was most of the rest of it.
    immuneTo: ['eerie'],
  },
  {
    id: 'the_condemned',
    name: 'The Condemned',
    tier: 'rabble',
    blurb: 'Death row, handed one last chance and a blade. Nothing left to threaten them with.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [structure('quarters', 12), holds('fight_pit')],
    cost: { caps: 300, supplies: 120 },
    trainSeconds: 600,
    unitSlots: 3,
    stats: sheet({
      speed: 40,
      vitality: 120,
      morale: 100,
      armor: 12,
      resistances: { energy: 20, ballistic: -25 },
      damageType: 'blade',
      penetration: 35,
      range: 10,
      offense: 255,
      evasion: 10,
      stealth: 15,
      lootCapacity: 25,
      intimidation: 60,
    }),
    modifiers: ['last_stand', 'close_quarters'],
    // Nothing left to threaten them with, which covers every room in the city.
    affinities: { eerie: 8, crammed: 5 },
  },

  // -------------------------------------------------------------- legendary
  {
    id: 'the_specter',
    name: 'The Specter',
    tier: 'legendary',
    blurb:
      'Experimental full-spectrum cloak. Invisible until it strikes, and then briefly visible.',
    trainedAt: 'lab',
    unique: true,
    requires: [structure('lab', 15), fitted('lab_shielded_datacore'), holds('satellite_uplink')],
    cost: { caps: 1500, supplies: 225, oil: 300, highQualityMetal: 250 },
    trainSeconds: 3600,
    unitSlots: 8,
    stats: sheet({
      speed: 80,
      vitality: 300,
      morale: 90,
      armor: 35,
      resistances: { ballistic: 45, chemical: -30 },
      damageType: 'energy',
      penetration: 80,
      range: 40,
      offense: 475,
      evasion: 60,
      stealth: 100,
      lootCapacity: 20,
      intimidation: 80,
    }),
    modifiers: ['ambush', 'night_operations'],
    unspyable: true,
    /*
     * A full-spectrum cloak defeats eyes. It does nothing at all about ears, and that is what the
     * `noisy` affinity is: this sheet used to say the same thing twice, once here and once as a
     * vulnerability to sonic damage, which stopped meaning anything when the only unit that dealt
     * sonic left the roster. **The Specter now carries no resistances at all**, which makes it the
     * one legendary with no written weakness. Worth an answer eventually; it is not a regression,
     * because nothing has been able to exploit the old one since the Bell-Ringers went.
     */
    affinities: { dark: 10, eerie: 8, noisy: -8 },
  },
  {
    id: 'the_abomination',
    name: 'The Abomination',
    tier: 'legendary',
    blurb: 'A failed experiment that became a weapon. Unstable, devastating, and not steerable.',
    trainedAt: 'lab',
    unique: true,
    requires: [structure('lab', 16), structure('infirmary', 9), holds('mad_scientist_lair')],
    cost: { caps: 1400, supplies: 400, highQualityMetal: 200 },
    trainSeconds: 4200,
    unitSlots: 10,
    stats: sheet({
      speed: 40,
      vitality: 700,
      morale: 100,
      armor: 55,
      damageType: 'chemical',
      resistances: { chemical: 100, ballistic: 30, explosive: -25 },
      penetration: 50,
      range: 15,
      offense: 500,
      evasion: 5,
      stealth: 0,
      lootCapacity: 0,
      intimidation: 100,
    }),
    modifiers: ['terror', 'close_quarters'],
    // It breathes chlorine by preference and nothing about a room has ever unsettled it.
    immuneTo: ['toxic', 'eerie'],
    affinities: { cold: 4, crammed: 4 },
  },
  {
    id: 'the_colossus',
    name: 'The Colossus',
    tier: 'legendary',
    blurb: 'A single massive machine that functions like a walking fortress. It arrives slowly.',
    trainedAt: 'garage',
    unique: true,
    // It does not go round the barricade. It goes through, and takes the barricade with it.
    sapper: true,
    /**
     * A crane, and there are two in the city.
     *
     * Some things can only be assembled standing up, which is what a Construction Site is for. The
     * The CCS has one and so do The Annexes: deliberately, because for a while the Spire had
     * the only one, and the Spire is the *end* of the game: a legendary unit gated on the last
     * district anybody takes is a legendary unit nobody ever fields. Sigma is difficulty 6, which
     * puts the Colossus in the same band as the Specter and the Juggernaut.
     */
    requires: [structure('garage', 10), structure('generator', 14), holds('construction_site')],
    cost: { caps: 2200, supplies: 330, scrap: 900, oil: 600, highQualityMetal: 400 },
    trainSeconds: 5400,
    unitSlots: 12,
    // §C3: the blurb has said "it arrives slowly" since the first draft and nothing enforced it, so
    // a Colossus in a Heli Porter crossed the city at 95. It rides in nothing now, and the column
    // it is in arrives when it does.
    no_ride: true,
    stats: sheet({
      speed: 15,
      vitality: 1000,
      morale: 95,
      armor: 95,
      damageType: 'explosive',
      // You may hit it with whatever you have brought.
      resistances: { ballistic: 70, blade: 80, explosive: 40, energy: -30, blunt: 40 },
      penetration: 25,
      range: 60,
      offense: 490,
      evasion: 0,
      stealth: 0,
      lootCapacity: 120,
      intimidation: 95,
    }),
    modifiers: ['breaching', 'armor_piercing'],
    // A walking fortress is a machine: it is not frightened and it does not breathe. What it is,
    // is enormous: it cannot get into half the ground on the map and it cooks in its own plate.
    immuneTo: ['eerie', 'toxic'],
    affinities: { crammed: -8, hot: -5, wet: -4 },
  },
  {
    id: 'the_saint',
    name: 'The Saint',
    tier: 'legendary',
    blurb: 'A legendary fighter whose presence alone steadies everyone who can see them.',
    trainedAt: 'gauntlet',
    unique: true,
    // Nobody runs while he is preaching, and he does not stop until they carry him off.
    stalwart: true,
    requires: [structure('quarters', 12), structure('infirmary', 10), holds('tavern')],
    cost: { caps: 1200, supplies: 300, highQualityMetal: 120 },
    trainSeconds: 3000,
    unitSlots: 6,
    stats: sheet({
      speed: 45,
      vitality: 265,
      morale: 100,
      armor: 30,
      resistances: { blade: 45, chemical: -25 },
      damageType: 'blunt',
      penetration: 20,
      range: 20,
      offense: 275,
      evasion: 25,
      stealth: 20,
      lootCapacity: 20,
      intimidation: 40,
    }),
    modifiers: ['last_stand', 'dug_in'],
  },
  {
    id: 'the_cartographer',
    name: 'The Cartographer',
    tier: 'legendary',
    blurb: 'Has walked every street in this city and remembers which ones are still there.',
    trainedAt: 'lab',
    unique: true,
    requires: [structure('lab', 12), holds('rail_yard'), holds('satellite_uplink')],
    cost: { caps: 1000, supplies: 150, oil: 150, highQualityMetal: 100 },
    trainSeconds: 2700,
    unitSlots: 5,
    stats: sheet({
      speed: 88,
      vitality: 270,
      morale: 90,
      armor: 28,
      damageType: 'ballistic',
      resistances: { explosive: 40, blade: -20 },
      penetration: 15,
      range: 35,
      offense: 300,
      /*
       * Under `EVASIVE_THRESHOLD`, and that is a rule rather than a tuning choice: this sheet
       * carries `tracking`, and a unit that both dodges and answers dodging is the hole `tracking`
       * was added to close. What the Cartographer is hard to do is *find*, which is `stealth: 70`
       * and already the best in the game bar the Sleepers.
       */
      evasion: 25,
      stealth: 70,
      lootCapacity: 40,
      intimidation: 20,
    }),
    modifiers: ['urban_bonus', 'night_operations', 'tracking'],
  },
  /**
   * A specialist, sitting in the legendary block, and both halves of that are deliberate.
   *
   * The tier is what the game reads: `UNIT_TIERS` decides where it appears and `unitsInTier` who
   * it is priced against. It came down a tier because a machine you can only ever own one of is a
   * trophy, and this is meant to be the thing you put at the front of a line that has to hold,
   * which is a job you want to be able to do twice. Coming down the ladder costs it `unique`:
   * one-of-a-kind is what `legendary` *means* here, and `units.test.ts` holds the two together.
   *
   * The array position is untouched on purpose. A unit's art seed is its index in this array, so
   * moving it into the specialist block above would renumber every unit after it for the sake of
   * reading order in one file.
   */
  {
    id: 'the_twins',
    name: 'Twins',
    tier: 'wonder',
    blurb: 'One body, two minds, and neither of them sleeps. Nothing has ever got behind it.',
    trainedAt: 'lab',
    unique: false,
    /**
     * Built rather than hired, and built by somebody who should not have been allowed to.
     *
     * The Lab high enough to attempt it, and the two places in the city where that kind of work is
     * actually done: a Mad Scientist's Lair for the design and a Gene Clinic for the half of it
     * that is still meat. Two locations rather than one because it is the only legendary in the
     * game with no weapon on its sheet, and a unit that survives everything has to cost something
     * on the map rather than only in the stockpile.
     */
    requires: [structure('lab', 12), holds('mad_scientist_lair'), holds('gene_clinic')],
    cost: { caps: 460, supplies: 75, scrap: 190, oil: 90, highQualityMetal: 70 },
    trainSeconds: 520,
    unitSlots: 4,
    /*
     * Brought down the ladder with the tier, not carried down it.
     *
     * The sheet was legendary scale, 420 vitality behind 78 armour, against a specialist band that
     * tops out at 80 and 25. Left alone it beat every other unit in the game at equal unit slots, which
     * `balance.test.ts` is there to forbid: a roster is a web and this was the top of a ladder.
     * What it keeps is the shape rather than the numbers, because the shape is the unit: heavy for
     * its tier, slow, almost impossible to move, and carrying almost no way to hurt anyone.
     */
    stats: sheet({
      speed: 30,
      vitality: 190,
      morale: 100,
      armor: 38,
      damageType: 'chemical',
      resistances: { ballistic: 25, blade: 20, energy: -25 },
      penetration: 18,
      range: 10,
      offense: 170,
      evasion: 5,
      stealth: 0,
      lootCapacity: 60,
      intimidation: 60,
    }),
    // Two heads facing opposite ways is the whole design: it cannot be flanked and it cannot be
    // startled, so it is the thing you put at the front of a line that has to hold.
    modifiers: ['last_stand', 'night_operations'],
    // A machine with a face on each side. The dark is not a problem it has, and neither is fear.
    immuneTo: ['eerie', 'dark'],
    affinities: { crammed: -6, open: 4 },
  },

  // --------------------------------------------------------------- support
  //
  // Last in the file and first in the game, which is a seam rather than an ordering: the art
  // manifest derives a unit's seed from its **index in this array**, so a unit inserted anywhere
  // but the end renumbers every asset after it and orphans art that has already been made. New
  // units go here. Where they appear on screen is `UNIT_TIERS`, which puts support at the top.
  //
  // People who carry things. They are not soldiers and the game never pretends otherwise: they
  // cannot be deployed to a fight, they cannot hold ground, and on a battle mission they walk in
  // behind the people who can. What they are is the cheapest loot capacity in the game and the
  // only unit the Nexus itself signs, which makes a standard mission something a crew can run on
  // day one without spending a single unit it might have wanted for a fight.
  {
    id: 'scavengers',
    name: 'Scavengers',
    tier: 'carrier',
    blurb:
      'They know which floors still hold weight and which pipes still have copper in them. Hand them a bag and point at a building.',
    trainedAt: 'nexus',
    unique: false,
    combat: false,
    /**
     * The Nexus a new district is already standing, which makes this the one unit a crew has on
     * its first second (maintainer, 2026-09-18).
     *
     * It was `gauntlet(1)`, and that was the whole of the opening problem. The Gauntlet needs
     * Nexus 3 and Quarters 2, the Nexus needs 512 caps to reach level 2, and nothing a new
     * district produces is caps: a crew arrived with eight Razors, no way to replace one, and the
     * only faucet that would have paid for the barracks was missions, which need bodies. The
     * carrier bench is what breaks that circle, so it cannot be behind the building the circle is
     * about.
     */
    requires: [structure('nexus', 1)],
    cost: { caps: 25, supplies: 15 },
    trainSeconds: 30,
    unitSlots: 1,
    stats: sheet({
      // A little under average on the road, which is the trade: the biggest bag in the game on
      // the slowest legs that still count as quick.
      speed: 30,
      vitality: 60,
      morale: 45,
      armor: 0,
      damageType: 'blunt',
      /*
       * Nothing on at all, and the sheet says so in more than one place now (2026-09-19).
       *
       * Zero armour above, and everything ordinary gets through: a bullet, a blade and a blast
       * all land harder on somebody in work clothes with a bag. The rag over the face is the
       * only thing they have and it is the only resistance left.
       */
      resistances: { chemical: 20, ballistic: -25, blade: -20, explosive: -30 },
      penetration: 0,
      range: 0,
      // Not zero, because a zero would divide badly in more than one place downstream, and not
      // meaningful either: `combat: false` is what actually keeps them out of a fight.
      offense: 5,
      evasion: 20,
      stealth: 45,
      // Ten slots, which is the maintainer's figure. Twice a Razor's and half again a Scraper's.
      lootCapacity: 10,
      intimidation: 0,
    }),
    /*
     * `urban_bonus` on a sheet that cannot fight, and it is deliberate rather than an oversight.
     *
     * It is worth nothing to most crews: a modifier is percentage points of offense, a Scavenger
     * carries five of those, and `combat: false` keeps them out of the line entirely. It comes
     * live for a crew that has bought `carriers_fight` (`standsInLine`), which is the one case
     * where these people are standing in a street with something in their hands, and in that
     * case knowing the street is exactly what they have over a soldier.
     */
    modifiers: ['urban_bonus'],
    // The same street sense, from the other side: somewhere that feels wrong is somewhere they
    // have the sense to be slow in, and they are not paid enough for it.
    affinities: { eerie: -9 },
  },
  {
    id: 'haulers',
    name: 'Haulers',
    tier: 'carrier',
    blurb:
      'Barrow, harness and a back that has done this for twenty years. Slow, patient, and they never come home light.',
    trainedAt: 'nexus',
    unique: false,
    /*
     * §A5: the carrier's reading of Collective (maintainer, 2026-09-19).
     *
     * Not offense: a Hauler cannot fight and the rule pays them in the only currency they have,
     * which is how much comes back on the truck (`carriedBy` in `raid.ts`). It is the same curve
     * a massing fighter gets, so the card's one sentence is true of both.
     *
     * It also replaces what `Haul Rigging` used to buy them. That rung granted the Haulers the
     * old `picker` mark and had to be repointed when the mark was removed; this puts the "more
     * of them is worth more" idea back on the sheet, where a player can see it.
     */
    pack: true,
    combat: false,
    /**
     * Nexus 15, and the Nexus alone: the deep end of the same bench (maintainer, 2026-09-18).
     *
     * Both carriers answer to the building that signs them and to nothing else, which is what
     * makes the pair read as one line of progress rather than two unrelated gates. Fifteen is the
     * maintainer's figure and it is a long way up: a crew running barrows instead of bags has a
     * district behind it, and by then thirty loot slots for two beds is worth the wait.
     */
    requires: [structure('nexus', 15)],
    cost: { caps: 60, supplies: 20, planks: 30 },
    trainSeconds: 90,
    unitSlots: 2,
    stats: sheet({
      speed: 22,
      vitality: 75,
      morale: 50,
      armor: 2,
      damageType: 'blunt',
      resistances: { energy: 20, explosive: -30 },
      penetration: 0,
      range: 0,
      offense: 5,
      evasion: 8,
      stealth: 25,
      lootCapacity: 30,
      intimidation: 0,
    }),
    modifiers: [],
  },

  /**
   * Appended, and it has to be: a unit's art seed is its index in this array, so a legendary filed
   * up in the legendary block would renumber every unit between there and here.
   *
   * A duellist rather than a brawler, and the sheet says so: the highest offense and evasion on the
   * roster against almost no armour and a unit that a solid hit takes apart. Everything about it is
   * the first exchange. `close_quarters` because the thing was made for a ballroom and fights like
   * it, `terror` because people who have seen it work do not stay to see it twice.
   */
  {
    id: 'the_crimson_dancer',
    name: 'The Crimson Dancer',
    tier: 'legendary',
    blurb: 'Went into the Fight Pit a dancer and came out on blades. Still counts the beats.',
    trainedAt: 'gauntlet',
    unique: true,
    // She is across the ground and among them before the line has finished forming.
    strikes_first: true,
    /**
     * Three clauses, as every legendary needs, and each one a different half of what it is: the
     * Gauntlet at the top for the fighter, a Lab deep enough to have built the legs, and the Fight
     * Pit, which is where it learned what they were for.
     */
    requires: [structure('lab', 12), structure('quarters', 15), holds('fight_pit')],
    cost: { caps: 1400, supplies: 260, oil: 180, highQualityMetal: 200 },
    trainSeconds: 3300,
    unitSlots: 6,
    stats: sheet({
      speed: 92,
      vitality: 250,
      morale: 95,
      armor: 18,
      damageType: 'blade',
      // Blade limbs, so it goes through armour rather than around it, and it has nothing to
      // answer an explosion with: the frame is a dancer's, and it is meant to be brittle.
      resistances: { blade: 30, explosive: -35 },
      penetration: 70,
      range: 10,
      offense: 490,
      evasion: 88,
      stealth: 45,
      lootCapacity: 15,
      intimidation: 85,
    }),
    modifiers: ['close_quarters', 'terror'],
    // A hall with a floor to work on. Mud and a crowd both take the footing away.
    affinities: { open: 6, crammed: -6, wet: -5 },
  },

  /**
   * Appended for the same reason the Dancer is: a unit's art seed is its index in this array.
   *
   * The gap in the roster this fills is *reach on a unit that can take a hit*. Everything tanky was
   * melee, at 10 to 15, and everything with range was made of paper: a Sniper reaches 95 behind 45
   * vitality and 8 armour. A slug gun is 30, which is further than anything can walk in the time it
   * takes to fire twice and nowhere near far enough to sit at the back, so it holds a line and
   * shoots off it. `dug_in` because that is the job, `armor_piercing` because a slug is what you
   * load when the other side turned up in plate.
   */
  {
    id: 'sluggers',
    name: 'Sluggers',
    tier: 'heavy',
    blurb: 'Scrap plate and a short slug gun. Stands where it is put and makes the room expensive.',
    trainedAt: 'gauntlet',
    unique: false,
    requires: [gauntlet(6), structure('scrapyard', 4)],
    cost: { caps: 210, supplies: 30, scrap: 110, highQualityMetal: 8 },
    trainSeconds: 230,
    unitSlots: 2,
    stats: sheet({
      speed: 30,
      vitality: 135,
      morale: 70,
      armor: 30,
      resistances: { ballistic: 35, explosive: -25 },
      damageType: 'ballistic',
      penetration: 24,
      range: 30,
      offense: 180,
      evasion: 8,
      stealth: 10,
      lootCapacity: 25,
      intimidation: 35,
    }),
    modifiers: ['dug_in', 'armor_piercing'],
    // A slug spreads. Ground that keeps the other side in front of you is worth more than ground
    // that lets them come round.
    affinities: { crammed: 5, open: -4 },
  },

  /**
   * Appended, like the two above it: a unit's art seed is its index in this array.
   *
   * The top of the damage scale, and the sheet is built so that being the top of it is survivable
   * for everyone else. 700 is two thirds again what the Abomination hits for, on 200 hit points and
   * 8 points of plate: anything that lands on this connects, and one Colossus round is most of it.
   * What it trades that for is not being *there* when the shot arrives, which is what 92 evasion
   * buys under the miss rule (`battle/matchup.ts`): forty-six attacks in a hundred go past.
   *
   * That makes it the one unit whose worth depends on what is shooting at it rather than on how
   * much of it there is, which is the point of a legendary. A wall of Wardens plinks off it all
   * day; one lucky Demolisher round ends it.
   */
  {
    id: 'the_loose_end',
    name: 'The Loose End',
    tier: 'legendary',
    blurb: 'Walked out of a contract nobody walks out of. The chain-blade was the severance.',
    trainedAt: 'gauntlet',
    unique: true,
    /**
     * A Gauntlet at the top, a Garage that can keep a powered blade fed, and a rail yard, which is
     * where somebody who has to keep moving ends up and where the contract finally lapsed.
     */
    requires: [structure('garage', 9), structure('generator', 16), holds('rail_yard')],
    cost: { caps: 1600, supplies: 240, oil: 220, highQualityMetal: 260 },
    trainSeconds: 3600,
    unitSlots: 7,
    stats: sheet({
      speed: 95,
      vitality: 200,
      morale: 90,
      armor: 8,
      damageType: 'blade',
      // A powered edge answers plate and nothing answers a blast: there is no armour to hide in
      // and the whole sheet is built on not being hit.
      resistances: { explosive: -40, ballistic: 15 },
      penetration: 85,
      range: 15,
      offense: 700,
      evasion: 92,
      stealth: 60,
      lootCapacity: 20,
      intimidation: 80,
    }),
    modifiers: ['close_quarters', 'ambush'],
    // Room to move is the whole sheet. Shoulder to shoulder, evasion is worth nothing.
    affinities: { open: 8, crammed: -10 },
  },

  // ------------------------------------------------------------------ the Combine (2026-09-19)
  //
  // The regime's own units, after the carriers for the same reason the carriers are after the
  // legendaries: the art manifest seeds off the index in this array, so anything new goes last.
  // None of these is trainable: see `UnitSpec.faction`. Their sheets are written against the
  // player's roster they are meant to be met by, and the ladder runs up the districts they hold:
  // the Levy on the Docks, the Greycoats behind them, the Enforcers in the Annexes, the
  // Suppressors on the Blacksite, and the three legendaries where `city/combine.ts` puts them.
  {
    id: 'civic_levy',
    name: 'Civic Levy',
    tier: 'rabble',
    blurb:
      'Conscripts with a fortnight of drill and a surplus blade each. They are the Combine on every street corner because there are so many of them, and no other reason.',
    trainedAt: 'gauntlet',
    unique: false,
    faction: 'combine',
    requires: [],
    cost: {},
    trainSeconds: 0,
    unitSlots: 1,
    stats: sheet({
      speed: 40,
      vitality: 68,
      morale: 30,
      armor: 4,
      damageType: 'blade',
      resistances: { energy: 10, explosive: -30 },
      penetration: 6,
      range: 5,
      offense: 132,
      evasion: 8,
      stealth: 10,
      intimidation: 6,
    }),
    modifiers: ['urban_bonus'],
    /*
     * A fortnight of drill and no kit. Everything that makes a street hard to stand in makes it
     * harder for them than for anybody who was trained for it: the dark, the noise, the cold and
     * the wet all come off a conscript first. The one thing they are used to is the street itself,
     * which is where they were conscripted from.
     */
    affinities: { dark: -8, noisy: -6, cold: -5, wet: -4, eerie: -7 },
  },
  {
    id: 'greycoat',
    name: 'Greycoat',
    tier: 'rabble',
    blurb:
      'Low-ranking government infantry, named for the coat. A rifle, a helmet, a number, and orders to hold whatever they were stood on.',
    trainedAt: 'gauntlet',
    unique: false,
    faction: 'combine',
    requires: [],
    cost: {},
    trainSeconds: 0,
    unitSlots: 1,
    stats: sheet({
      speed: 38,
      vitality: 80,
      morale: 45,
      armor: 12,
      damageType: 'ballistic',
      resistances: { blade: 10, chemical: -20 },
      penetration: 12,
      range: 40,
      offense: 122,
      evasion: 8,
      stealth: 12,
      intimidation: 12,
    }),
    modifiers: ['dug_in'],
    /*
     * Issued one good coat and told to stand there, which is exactly what they are worth: the
     * wool is the best thing about them in the cold and the worst in the heat, and a line trained
     * to hold a position does not like being unable to see the position.
     */
    affinities: { cold: 6, wet: 4, hot: -6, foggy: -5, dark: -4 },
  },
  {
    id: 'street_enforcers',
    name: 'Street Enforcers',
    tier: 'specialist',
    blurb:
      'Police infantry with more plate than the Greycoats and less patience. Used for raids and for standing on streets, and the shock batons are not for show.',
    trainedAt: 'gauntlet',
    unique: false,
    faction: 'combine',
    requires: [],
    cost: {},
    trainSeconds: 0,
    unitSlots: 2,
    stats: sheet({
      speed: 42,
      vitality: 126,
      morale: 60,
      armor: 30,
      damageType: 'energy',
      resistances: { ballistic: 20, blade: 20, chemical: -25, energy: -15 },
      penetration: 30,
      range: 25,
      offense: 262,
      evasion: 10,
      stealth: 10,
      intimidation: 30,
    }),
    modifiers: ['urban_bonus', 'close_quarters'],
    /*
     * Sealed plate and a full visor: they work in a crammed doorway and in a toxic room where
     * anybody without a mask cannot, and the same suit is an oven in the heat and a liability on
     * open ground where the thing coming at them has range.
     */
    affinities: { crammed: 7, toxic: 8, noisy: 4, hot: -8, open: -6 },
  },
  {
    id: 'suppressor',
    name: 'Suppressor',
    tier: 'heavy',
    blurb:
      'Automatic weapons on a tripod and a crew that has been told the street is closed. Area denial: nothing crosses the ground in front of one and lives.',
    trainedAt: 'gauntlet',
    unique: false,
    faction: 'combine',
    requires: [],
    cost: {},
    trainSeconds: 0,
    unitSlots: 4,
    stats: sheet({
      speed: 24,
      vitality: 245,
      morale: 75,
      armor: 45,
      damageType: 'ballistic',
      resistances: { blade: 30, energy: 10, explosive: -15 },
      penetration: 35,
      range: 60,
      offense: 372,
      evasion: 3,
      stealth: 4,
      intimidation: 45,
    }),
    modifiers: ['open_field', 'dug_in'],
    /*
     * A belt-fed gun on a tripod owns whatever it can see, and that is the whole of it: fog, dark
     * and a crammed room take its range away and leave a crew of two standing behind a heavy
     * object. Elevated ground is what a position like this is chosen for.
     */
    affinities: { open: 9, elevated: 8, foggy: -9, dark: -7, crammed: -8 },
  },
  {
    id: 'syndic',
    name: 'Syndic',
    tier: 'legendary',
    blurb:
      'The government liaison embedded with the industrial facilities and the private troops that guard them. Knows every yard in the Annexes and everybody who works in one, and the people around her are paid better and shoot straighter for it.',
    trainedAt: 'gauntlet',
    unique: true,
    faction: 'combine',
    requires: [],
    cost: {},
    trainSeconds: 0,
    unitSlots: 5,
    stats: sheet({
      speed: 35,
      vitality: 240,
      morale: 90,
      armor: 35,
      damageType: 'ballistic',
      resistances: { blade: 20, chemical: -20 },
      penetration: 40,
      range: 45,
      offense: 220,
      evasion: 15,
      stealth: 30,
      intimidation: 50,
    }),
    modifiers: ['dug_in', 'last_stand'],
    /*
     * Somebody who has never been shot at and has never needed to be. She is worth what she knows,
     * and what she knows is the yards: inside one she is at home, and anywhere the work is done in
     * the dark by people she has not met she is a suit in a field.
     */
    affinities: { crammed: 5, toxic: 4, dark: -6, eerie: -8, wet: -4 },
  },
  {
    id: 'executioner',
    name: 'Executioner',
    tier: 'legendary',
    blurb:
      'The anti-personnel specialist the Blacksite sends when arrests are no longer required. Works up close, and finishes what anybody else on the field has started.',
    trainedAt: 'gauntlet',
    unique: true,
    faction: 'combine',
    requires: [],
    cost: {},
    trainSeconds: 0,
    unitSlots: 6,
    stats: sheet({
      speed: 44,
      vitality: 320,
      morale: 95,
      armor: 42,
      damageType: 'blade',
      resistances: { ballistic: 25, energy: -20 },
      penetration: 45,
      range: 5,
      offense: 380,
      evasion: 20,
      stealth: 25,
      intimidation: 70,
    }),
    modifiers: ['close_quarters', 'terror'],
    /*
     * Sent where arrests have stopped being required, which is indoors, at night, in places
     * people would rather not be. Open ground is the one shape that does not suit him: it gives
     * whatever he is walking towards time to see him coming.
     */
    affinities: { dark: 9, eerie: 8, crammed: 7, open: -7, foggy: -3 },
  },
  {
    id: 'directive_xero',
    name: 'Directive Xero',
    tier: 'legendary',
    blurb:
      'The Combine, in one person, in the Chosen Chapel at the top of the city. Nobody who stands with him is frightened of anything, and some of the people who came for him stay.',
    trainedAt: 'gauntlet',
    unique: true,
    faction: 'combine',
    // Nobody runs while he is in the room, and he does not stop until they carry him out.
    stalwart: true,
    requires: [],
    cost: {},
    trainSeconds: 0,
    unitSlots: 10,
    stats: sheet({
      speed: 30,
      vitality: 520,
      morale: 100,
      armor: 60,
      damageType: 'energy',
      resistances: { ballistic: 35, blade: 35, chemical: 20, explosive: -15 },
      penetration: 50,
      range: 40,
      offense: 400,
      evasion: 10,
      stealth: 15,
      intimidation: 90,
    }),
    modifiers: ['last_stand', 'dug_in'],
    /*
     * He does not go anywhere. Everything he is worth is in the room he is standing in, which is
     * a lit hall at the top of a tower: elevated, indoors, and never dark. Weather he has never
     * been out in is weather he is no good in.
     */
    affinities: { elevated: 8, crammed: 5, snowy: -6, wet: -5, windy: -4 },
  },
];

const BY_ID = new Map(UNIT_CATALOG.map((unit) => [unit.id, unit]));

/**
 * Whether this unit can be put in a battle line at all (§A5).
 *
 * The one question every force-picker, deploy route and battle setup asks before it accepts a
 * unit id. Written as a helper rather than read off `spec.combat` at each site so the default for
 * a unit that predates the field lives in exactly one place.
 */
export function isCombatUnit(unit: UnitSpec | string | undefined): boolean {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  return spec ? spec.combat !== false : false;
}

/** The other half: people who carry, and who may only ever go on a mission. */
export function isSupportUnit(unit: UnitSpec | string | undefined): boolean {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  return spec ? spec.combat === false : false;
}

export function findUnit(unitId: string): UnitSpec | undefined {
  return BY_ID.get(unitId);
}

export function isUnitId(value: string): boolean {
  return BY_ID.has(value);
}

/**
 * What one unit type is worth to a column on the road: `columnSpeed`'s third argument (§C3).
 *
 * `building/` sits below `units/` in the import graph and cannot read a sheet, so the lookup lives
 * here and every caller passes `(unitId) => unitColumnSpeed(unitId, bonus)`. The cap at 100 is
 * `effectiveSpeed`.
 *
 * The three things that move a unit's speed all belong here, and the road reads the same figure
 * the fight does (`battle/effects.ts`): whatever the workshop bolted on (`fitted`, folded through
 * `upgradedStats` exactly as the engine folds it), then the crew's `unitSpeedPercent` channel and
 * any flat points on top. A Neural Lace is twelve points of speed on a sheet; a road that read the
 * printed number instead had the same unit crossing the city slower than it crosses a battlefield.
 *
 * A unit id with no sheet behind it walks at the roster's middle rather than at nothing. A unit the
 * catalogue has forgotten is a unit that still has legs, and answering 0 would quietly hold an
 * entire column at a standstill over a renamed row.
 */
export function unitColumnSpeed(
  unitId: string,
  bonus: {
    percent?: number;
    flat?: number;
    fitted?: FittedUpgrades;
    /**
     * The crew's `any_ride` holding: the too-big rule is waived and everything gets a seat.
     *
     * A flag on the bonus rather than a second function, because the road already asks this one
     * question through one call. Without it a Colossus holds a whole column to fifteen and there is
     * no number anywhere that changes that: `columnSpeed` reads `rides` as a yes or a no.
     */
    anyRide?: boolean;
  } = {},
): ColumnUnit {
  const unit = findUnit(unitId);
  const printed = unit?.stats ?? BASE_STATS;
  const fitted = bonus.fitted ?? [];
  const sheet = fitted.length === 0 ? printed : upgradedStats(printed, fitted);
  return {
    speed: effectiveSpeed(sheet.speed, bonus),
    rides: bonus.anyRide === true || unit?.no_ride !== true,
    // What one of these takes off a machine's seats, in the same unit slots the district bills it
    // a bed in. A forgotten sheet still has to sit somewhere: one slot, as `ridingUnitSlots`.
    unitSlots: unit?.unitSlots ?? 1,
  };
}

/**
 * How many unit slots of a force can actually take a seat: what `loadable` spends (§C3).
 *
 * **Unit slots, not a head count.** A seat is measured in the same currency the district's beds
 * are, so an Ironside at two slots fills two of a machine's and a Colossus would fill twelve. That
 * is the one rule this number exists to keep: the deploy window caps a batch by unit slots, and a
 * settle that counted heads here seated a Cheese Wagon with thirty Ironsides the window would only
 * let fifteen of into it.
 *
 * A sheet carrying `no_ride` fills no seat whatever is in the yard, so counting it keeps a machine
 * "on the road" that nobody was ever in. The settle spends that count, and an empty truck it
 * believed was carrying somebody is a truck it wrecks on a bad day and pays the enemy its whole
 * capacity in infamy for.
 */
export function ridingGroups(
  force: Readonly<Record<string, number>>,
  anyRide = false,
): RiderGroup[] {
  const groups: RiderGroup[] = [];
  for (const [unitId, count] of Object.entries(force)) {
    const unit = findUnit(unitId);
    if (!anyRide && unit?.no_ride === true) continue;
    if ((count ?? 0) <= 0) continue;
    groups.push({ unitSlots: unit?.unitSlots ?? 1, count });
  }
  return groups;
}

export function ridingUnitSlots(force: Readonly<Record<string, number>>, anyRide = false): number {
  return Object.entries(force).reduce((total, [unitId, count]) => {
    const unit = findUnit(unitId);
    if (!anyRide && unit?.no_ride === true) return total;
    // A unit the catalogue has forgotten still has to sit somewhere, and one slot is the floor
    // every other reader of a missing sheet uses (`unitColumnSpeed` walks it, it does not vanish).
    return total + (unit?.unitSlots ?? 1) * count;
  }, 0);
}

export const UNIT_IDS: readonly string[] = UNIT_CATALOG.map((unit) => unit.id);

/** Validated against the catalogue rather than declared as an enum of literals: one list. */
export const UnitIdSchema = z.string().refine(isUnitId, { message: 'unknown unit' });

/** A sheet the Combine fields and nobody trains. See `UnitSpec.faction`. */
export function isCombineUnit(unit: UnitSpec | string | undefined): boolean {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  return spec?.faction === 'combine';
}

/** ...and its complement: a sheet a player can hold. */
export function isPlayerUnit(unit: UnitSpec | string | undefined): boolean {
  const spec = typeof unit === 'string' ? findUnit(unit) : unit;
  return spec !== undefined && spec.faction === undefined;
}

/**
 * The roster a player can hold, which is the catalogue less the Combine's own sheets.
 *
 * Every screen that lists units to a player reads this one and not {@link UNIT_CATALOG}: the
 * roster, the training bench, the census, the Scrapyard's rail, the sandbox seed and the balance
 * sheet. The full catalogue is for the things that meet a Combine unit rather than offer one, the
 * engine and the garrisons, and for `findUnit`, which has to resolve an enemy's id as readily as
 * your own.
 */
export const PLAYER_UNITS: readonly UnitSpec[] = UNIT_CATALOG.filter((unit) => isPlayerUnit(unit));

/** The Combine's own sheets, in catalogue order. */
export const COMBINE_UNITS: readonly UnitSpec[] = UNIT_CATALOG.filter((unit) =>
  isCombineUnit(unit),
);

/** The player's units in a tier. A Combine sheet is never in a tier a screen draws. */
export function unitsInTier(tier: UnitTier): UnitSpec[] {
  return PLAYER_UNITS.filter((unit) => unit.tier === tier);
}

/** Which units holding a location of this kind would open up: read back off the requirements. */
export function unitsUnlockedByLocation(locationKind: LocationKind): UnitSpec[] {
  return UNIT_CATALOG.filter((unit) =>
    unit.requires.some((need) => need.kind === 'location' && need.locationKind === locationKind),
  );
}

/**
 * The other direction: the ground that turns this unit out, if any does.
 *
 * The Doghouse to the Cyberhounds. Read off the same one authored list `unitsUnlockedByLocation`
 * reads, so the gate and the place a unit comes from cannot drift apart. Most units answer with
 * nothing: they come out of a building at home and no location on the map is their home.
 *
 * A list rather than one kind because a unit is allowed more than one location clause, and the
 * caller decides what to do with two (`homeTrainingBonus` takes the best held).
 */
export function locationsTraining(unit: UnitSpec): LocationKind[] {
  return unit.requires.flatMap((need) => (need.kind === 'location' ? [need.locationKind] : []));
}

/**
 * §B6: the ten the Gauntlet unlocks, and nothing else.
 *
 * The maintainer named these by hand, so the list is transcribed by hand and then *asserted* against the
 * catalogue at module load. The alternative, deriving the list from the requirements, would make
 * the assertion tautological: it would agree with whatever the catalogue happened to say, which is
 * exactly the mistake it exists to catch. Two independent statements, checked against each other.
 *
 * It was twelve until 2026-09-18, when the two carriers came off it and were re-gated on the
 * Nexus that signs them. Neither one fights, so neither belongs to a barracks, and the Gauntlet
 * clause on the cheap one was the reason a new crew could train nothing at all.
 */
export const GAUNTLET_UNLOCKED_UNITS: readonly string[] = [
  'razors',
  'scrapers',
  'ash_walkers',
  'netrunners',
  'stitchers',
  'ghosts',
  'road_reavers',
  'breakers',
  'wardens',
  'sluggers',
];

/** The Gauntlet level `unitId` needs, or `null` when the Gauntlet is not one of its gates. */
export function gauntletLevelFor(unitId: string): number | null {
  const unit = findUnit(unitId);
  if (!unit) return null;
  for (const need of unit.requires) {
    if (need.kind === 'building' && need.building === 'gauntlet') return need.level;
  }
  return null;
}

/**
 * Guards the catalogue at module load.
 *
 * A requirement naming a modification or a location kind that does not exist is a unit nobody can
 * ever field, and the only symptom would be a permanently greyed row. Cheaper to trip here.
 */
for (const unit of UNIT_CATALOG) {
  if (!BUILDING_KINDS.includes(unit.trainedAt)) {
    throw new Error(`${unit.id} is trained at ${unit.trainedAt}, which is not a structure`);
  }
  if (unit.tier === 'legendary' && !unit.unique) {
    throw new Error(`${unit.id} is legendary but not unique`);
  }
  for (const need of unit.requires) {
    if (need.kind === 'modification' && !findModification(need.modificationId)) {
      throw new Error(`${unit.id} needs ${need.modificationId}, which is not a modification`);
    }
    if (need.kind === 'location' && !LOCATION_KINDS.includes(need.locationKind)) {
      throw new Error(`${unit.id} needs a ${need.locationKind}, which is not a location kind`);
    }
    if (need.kind === 'building' && !BUILDING_KINDS.includes(need.building)) {
      throw new Error(`${unit.id} needs a ${need.building}, which is not a structure`);
    }
  }
  for (const modifier of unit.modifiers) {
    if (!UNIT_MODIFIERS[modifier]) {
      throw new Error(`${unit.id} carries ${modifier}, which is not a modifier`);
    }
  }
  for (const id of Object.keys(unit.affinities ?? {})) {
    if (!ENV_LABEL_IDS.includes(id as EnvLabelId)) {
      throw new Error(`${unit.id} has an affinity for ${id}, which is not an environment label`);
    }
  }
  for (const id of unit.immuneTo ?? []) {
    if (!ENV_LABEL_IDS.includes(id)) {
      throw new Error(`${unit.id} is immune to ${id}, which is not an environment label`);
    }
  }
  if (unit.requires.length === 0 && unit.id !== 'razors' && unit.faction === undefined) {
    // §B6: no unit may end up with no gate at all. Razors are the exception the opening move
    // depends on and they still carry one, so in practice this is a blanket rule. The Combine's
    // sheets are the other way round: no gate because no door, and the same check demands they
    // carry nothing that could ever read as one.
    throw new Error(`${unit.id} has no requirement at all`);
  }
  if (unit.faction !== undefined) {
    if (unit.requires.length > 0 || Object.keys(unit.cost).length > 0 || unit.trainSeconds > 0) {
      throw new Error(`${unit.id} is the Combine's and must carry no gate, price or clock`);
    }
  }
  for (const need of unit.requires) {
    if (need.kind === 'vehicle' && !findVehicle(need.vehicleId)) {
      throw new Error(
        `${unit.id} needs a ${need.vehicleId}, which is not a machine the Garage builds`,
      );
    }
  }
}

if (BY_ID.size !== UNIT_CATALOG.length) throw new Error('two units share an id');

/**
 * §B6, both halves: the Gauntlet gates exactly the ten the maintainer named, and every one of them
 * carries a level.
 *
 * The second half is the one worth spelling out. "Unlocked by the Gauntlet" is meaningless without
 * a level, and a clause of `gauntlet(0)` would satisfy the first check while gating nothing.
 */
for (const unitId of GAUNTLET_UNLOCKED_UNITS) {
  const level = gauntletLevelFor(unitId);
  if (level === null)
    throw new Error(`${unitId} is on the Gauntlet's list with no Gauntlet clause`);
  if (level < 1) throw new Error(`${unitId} is gated on Gauntlet ${level}, which gates nothing`);
}
for (const unit of UNIT_CATALOG) {
  if (gauntletLevelFor(unit.id) !== null && !GAUNTLET_UNLOCKED_UNITS.includes(unit.id)) {
    throw new Error(`${unit.id} is gated on the Gauntlet but is not on the board's list`);
  }
}
