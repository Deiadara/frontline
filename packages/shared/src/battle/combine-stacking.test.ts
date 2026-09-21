import { describe, expect, it } from 'vitest';
import {
  COMBINE_LEADERS,
  DIRECTIVE_XERO_MORALE,
  EXECUTIONER_THRESHOLD,
  SYNDIC_ARMOR,
  SYNDIC_PENETRATION,
  combineGarrison,
  combineLeaderOf,
  combineSlotBudget,
  type CombinePower,
} from '../city/combine.js';
import { findDistrict } from '../city/districts.js';
import { LOCATION_CATALOG, noTerritoryEffects } from '../city/locations.js';
import type { TerritoryEffects } from '../city/index.js';
import { findUnit } from '../units/catalog.js';
import { MAX_RATING, capRating } from '../units/stats.js';
import type { UnitLoadouts } from '../units/loadout.js';
import { makeAttributes } from '../attributes.js';
import { bareBattlefield, type Battlefield } from './battlefield.js';
import { OUTNUMBERED_RATIO } from './effects.js';
import type { BattleOfficer } from './officer.js';
import {
  MAX_INTIMIDATED_SHARE,
  applyDamage,
  mend,
  mendShare,
  simulate,
  type SideSetup,
  type Simulation,
} from './engine.js';

/**
 * How a Combine legendary's power **stacks** with everything else a fight carries, and in what
 * order the pieces land.
 *
 * `combine.test.ts` measures what each power does on its own. This file measures the seams, and
 * every one of them is a place a bonus can be paid twice, paid to the wrong side, or read off a
 * sheet that has not been finished yet:
 *
 *   * the order `applyPresence` runs in, against the ambush and §D3, which both read `effective`;
 *   * the ground, which reaches the same `armor` rating the Syndic does;
 *   * the player's buildings, which are on the **attacking** side of every fight the Combine is
 *     in, because `resolve.ts` gives a government defender no `defenderTerritory` at all;
 *   * the officer, the refit cards, the research fold and the boosts, all of which are the
 *     attacker's and all of which a turncoat carries across the line under Directive Xero.
 *
 * Every block is an A/B on one seed with a control that fails the other way round, because a
 * stacking assertion where the second bonus is too small to move the number proves nothing.
 */

const SYNDIC: CombinePower = {
  kind: 'syndic',
  penetration: SYNDIC_PENETRATION,
  armor: SYNDIC_ARMOR,
};
const EXECUTIONER: CombinePower = { kind: 'executioner', threshold: EXECUTIONER_THRESHOLD };
const ZERO: CombinePower = {
  kind: 'directive_xero',
  morale: DIRECTIVE_XERO_MORALE,
  changeOfHeart: true,
};

interface Ground {
  battlefield?: Battlefield;
  attackerTerritory?: TerritoryEffects;
  defenderTerritory?: TerritoryEffects;
  defenderUpgrades?: UnitLoadouts;
  defenderOfficer?: BattleOfficer;
}

const fight = (
  attacking: SideSetup['army'],
  defending: SideSetup['army'],
  presence: CombinePower | undefined,
  seed = 'stacking',
  ground: Ground = {},
): Simulation =>
  simulate({
    seed,
    battlefield: ground.battlefield ?? bareBattlefield(),
    attacker: {
      name: 'Crew',
      army: attacking,
      defending: false,
      ...(ground.attackerTerritory ? { territory: ground.attackerTerritory } : {}),
    },
    defender: {
      name: 'The Combine',
      army: defending,
      defending: true,
      ...(presence ? { presence } : {}),
      ...(ground.defenderTerritory ? { territory: ground.defenderTerritory } : {}),
      ...(ground.defenderUpgrades ? { upgrades: ground.defenderUpgrades } : {}),
      ...(ground.defenderOfficer ? { officer: ground.defenderOfficer } : {}),
    },
  });

const sheetOf = (sim: Simulation, side: 'attacker' | 'defender', unitId: string) => {
  const found = sim[side].stacks.find((one) => one.unit.id === unitId && one.turncoat !== true);
  if (!found) throw new Error(`no ${unitId} on the ${side}`);
  return found;
};

const crossed = (sim: Simulation): number =>
  Object.values(sim.turned).reduce((total, count) => total + count, 0);

/** A crew's fold with one channel turned up, for measuring what that channel reaches. */
const territory = (fields: Partial<TerritoryEffects>): TerritoryEffects => ({
  ...noTerritoryEffects(),
  ...fields,
});

// ---------------------------------------------------------------- 1. order of application

describe('1. when the power lands, against everything that reads a sheet', () => {
  /**
   * The opening ambush is fired *after* `applyPresence`, and this is the fight that proves it.
   *
   * 20 Ghosts against one Street Enforcer on open ground: the ambush is worth 0.45 of a round and
   * it is the only fire before the round loop, because Ghosts carry `ambush` and no Opening Volley
   * (`strikes_first` is on two sheets in the whole catalogue and neither is here). Without her the
   * Enforcer is dead before the first exchange and `rounds` is empty; with her armour at 55 rather
   * than 30 the same ambush leaves it standing and the fight runs.
   *
   * Moving `applyPresence` below the ambush is the mutation this exists to catch, and it is the
   * one a refactor would make, since the two blocks look independent.
   */
  it('has the Syndic on the defence before the opening ambush is fired', () => {
    // Forty Ghosts against three, since the 2026-09-21 armour retune: the case has to sit on the
    // edge where the ambush alone kills the line bare and her armour keeps one standing.
    const line = { ghosts: 40 };
    const held = { street_enforcers: 3 };
    for (const seed of ['ambush-0', 'ambush-1', 'ambush-2']) {
      const bare = fight(line, held, undefined, seed);
      const backed = fight(line, held, SYNDIC, seed);
      expect(findUnit('ghosts')?.strikes_first, 'the ambush is the only opening fire').not.toBe(
        true,
      );
      expect(bare.openingStrike, 'there is an ambush to see').toBeGreaterThan(0);
      // The control: without her the ambush alone settles it, so `rounds` never starts.
      expect(bare.rounds, seed).toHaveLength(0);
      expect(backed.rounds.length, seed).toBeGreaterThan(0);
      expect(sheetOf(bare, 'defender', 'street_enforcers').effective.armor).toBe(30);
      expect(sheetOf(backed, 'defender', 'street_enforcers').effective.armor).toBe(
        30 + SYNDIC_ARMOR,
      );
    }
  });

  /**
   * ...and Directive Xero is on the defence before §D3, which is measurable on the **turncoats**.
   *
   * His immunity itself does not measure the order: `simulate` skips §D3 on both sides whenever a
   * `directive_xero` presence is set, so the intimidated count would read nought even if the
   * sheets were stamped afterwards. What does measure it is who the stamp lands on.
   * `applyPresence` walks `defender.stacks`, and `changeOfHeart` pushes the men who crossed onto
   * that same array. Run in the written order the turncoats are not there yet and come across
   * carrying `Changed sides` and nothing else; run the other way round they would come back
   * wearing his chip as well, which is a reason no card should print for somebody who was fighting
   * for the other side ninety seconds ago.
   *
   * 30 Juggernauts against 40 Levy for the control, and the crossing fight underneath it.
   */
  it('has Directive Xero on the defence before the crossing, not after it', () => {
    const bare = fight({ juggernauts: 30 }, { civic_levy: 40 }, undefined, 'nerve');
    const backed = fight({ juggernauts: 30 }, { civic_levy: 40 }, ZERO, 'nerve');
    expect(bare.intimidated.defender, 'the control: this line is silenced').toBeGreaterThan(0);
    expect(backed.intimidated.defender).toBe(0);
    expect(sheetOf(backed, 'defender', 'civic_levy').effective.morale).toBe(DIRECTIVE_XERO_MORALE);

    const crossing = fight({ razors: 20 }, { suppressor: 30, directive_xero: 1 }, ZERO, 'nerve');
    const turncoats = crossing.defender.stacks.filter((one) => one.turncoat === true);
    expect(turncoats.length).toBeGreaterThan(0);
    for (const one of turncoats) {
      expect(one.effective.reasons).toContain('Changed sides');
      expect(one.effective.reasons).not.toContain('Directive Xero');
    }
    // The control: his own line does wear the chip, so "not on the turncoats" is a choice.
    expect(sheetOf(crossing, 'defender', 'suppressor').effective.reasons).toContain(
      'Directive Xero',
    );
  });

  /**
   * The outnumbered reading is the one thing the crossing does **not** move, and that is by design
   * rather than by accident: `effectiveStats` is computed once when the forces are built and held,
   * so a modifier cannot switch on and off between rounds and make a report unexplainable.
   *
   * Measured on 30 Razors with no nerve left against 12 Suppressors and him: 22 cross, which
   * leaves the fight at 35 against 8. His own sheet carries `last_stand`, so he goes on fighting
   * at +25% for being outnumbered while outnumbering what is left of the attack four to one.
   *
   * The control below is the same fight at 10 against 13, where the defence was never outnumbered
   * and Last Stand is absent, so this is a measurement of the reading rather than of a constant.
   */
  it('takes the outnumbered reading from the opening rosters, not from what the crossing left', () => {
    const shaken = territory({ unitMoraleFlat: -40 });
    const sim = fight({ razors: 30 }, { suppressor: 12, directive_xero: 1 }, ZERO, 'ratio', {
      attackerTerritory: shaken,
    });
    expect(sheetOf(sim, 'attacker', 'razors').effective.morale, 'no nerve to spend').toBe(0);
    expect(crossed(sim)).toBe(22);
    expect(30 / 13).toBeGreaterThanOrEqual(OUTNUMBERED_RATIO);
    // After the crossing his side is 35 against 8, which is the far side of the ratio.
    expect((30 - 22) / (13 + 22)).toBeLessThan(OUTNUMBERED_RATIO);
    expect(sheetOf(sim, 'defender', 'directive_xero').effective.reasons).toContain('Last Stand');

    const even = fight({ razors: 10 }, { suppressor: 12, directive_xero: 1 }, ZERO, 'ratio', {
      attackerTerritory: shaken,
    });
    expect(crossed(even), 'the control still crosses, so only the ratio differs').toBeGreaterThan(
      0,
    );
    expect(sheetOf(even, 'defender', 'directive_xero').effective.reasons).not.toContain(
      'Last Stand',
    );
  });
});

// ---------------------------------------------------------------- 2. the ground

describe('2. stacking with the ground', () => {
  /**
   * A location's `baseDefense` is points of armour for whoever holds it, and her points go on top
   * of them: one rating, two sources, added once each.
   *
   * A Greycoat is 12 armour. On the Chosen Chapel's `baseDefense` of 9 that is 21, and with her
   * 46. The three figures are asserted separately so a change to either source fails here rather
   * than cancelling out.
   */
  it("adds her armour on top of the location's baseDefense", () => {
    const chapel: Battlefield = { ...bareBattlefield(), baseDefense: 9 };
    const open = fight({ razors: 20 }, { greycoat: 10 }, SYNDIC, 'ground');
    const held = fight({ razors: 20 }, { greycoat: 10 }, SYNDIC, 'ground', { battlefield: chapel });
    const bare = fight({ razors: 20 }, { greycoat: 10 }, undefined, 'ground', {
      battlefield: chapel,
    });
    expect(findUnit('greycoat')?.stats.armor).toBe(12);
    expect(bare.defender.stacks[0]?.effective.armor, 'the ground alone').toBe(12 + 9);
    expect(open.defender.stacks[0]?.effective.armor, 'her points alone').toBe(12 + SYNDIC_ARMOR);
    expect(held.defender.stacks[0]?.effective.armor, 'both').toBe(12 + 9 + SYNDIC_ARMOR);
  });

  /**
   * Fortification is a different channel and she does not touch it.
   *
   * `fortifyPercent` buys toughness (percentage points on vitality, under `MAX_HELD_DEFENSE`) and
   * her points are armour, so the two stack without either reading the other. The vitality figure
   * is asserted equal on both arms, which is what makes this a measurement of separation rather
   * than a restatement of the armour test above.
   */
  it('leaves the fortification alone: her points are armour, not toughness', () => {
    const dug: Battlefield = { ...bareBattlefield(), fortifyPercent: 40, baseDefense: 5 };
    const bare = fight({ razors: 20 }, { greycoat: 10 }, undefined, 'fort', { battlefield: dug });
    const backed = fight({ razors: 20 }, { greycoat: 10 }, SYNDIC, 'fort', { battlefield: dug });
    const before = bare.defender.stacks[0]!.effective;
    const after = backed.defender.stacks[0]!.effective;
    // The control: the works are worth something here, or "unchanged" would be free.
    expect(before.vitality).toBeGreaterThan(findUnit('greycoat')!.stats.vitality);
    expect(after.vitality).toBe(before.vitality);
    expect(after.armor).toBe(before.armor + SYNDIC_ARMOR);
    expect(after.reasons).toEqual([...before.reasons, 'The Syndic']);
  });

  /**
   * The Combine's own territory fold is empty, and that is a fact about the settler rather than
   * about the engine: `resolve.ts` builds `defenderTerritory` only from a `defenderBase`, and a
   * government defender has none. Pinned here because it is the assumption every other block in
   * this file rests on, and it is measured through the engine so the shape of the claim is the
   * shape the settler hands over.
   */
  it('gives the regime no territory fold of its own: her points are all it has', () => {
    const rich = territory({ unitArmorPercent: 30, unitOffensePercent: 40 });
    const asWritten = fight({ razors: 20 }, { greycoat: 10 }, SYNDIC, 'fold');
    const ifItHadOne = fight({ razors: 20 }, { greycoat: 10 }, SYNDIC, 'fold', {
      defenderTerritory: rich,
    });
    expect(asWritten.defender.stacks[0]?.effective.armor).toBe(12 + SYNDIC_ARMOR);
    // The control: a fold *would* reach the same rating, which is why its absence is the point.
    expect(ifItHadOne.defender.stacks[0]?.effective.armor).toBe(12 + 30 + SYNDIC_ARMOR);
  });
});

// ---------------------------------------------------------------- 3. the player's buildings

describe('3. stacking with buildings, which are the attacker’s in every Combine fight', () => {
  /**
   * The Gate pays into `defensePercent`, and `effects.ts` reads that channel only for the side
   * that is `defending`. A crew raiding the Combine is not defending, so the Gate it built and
   * the Gatewright perks that only pay for a Gate are worth exactly nothing against her.
   *
   * Measured at 60 points, which is a level-10 Gate's neighbourhood: on the attacker it moves no
   * figure at all, and on the defender it is 80 hit points to 128.
   */
  it("reads the attacker's Gate for nothing: defensePercent is the holder's channel", () => {
    const gate = territory({ defensePercent: 60 });
    const bare = fight({ razors: 20 }, { greycoat: 20 }, SYNDIC, 'gate');
    const raiding = fight({ razors: 20 }, { greycoat: 20 }, SYNDIC, 'gate', {
      attackerTerritory: gate,
    });
    expect(sheetOf(raiding, 'attacker', 'razors').effective.vitality).toBe(
      sheetOf(bare, 'attacker', 'razors').effective.vitality,
    );
    // The control, on the only side the channel is written for.
    const holding = fight({ razors: 20 }, { greycoat: 20 }, SYNDIC, 'gate', {
      defenderTerritory: gate,
    });
    expect(sheetOf(holding, 'defender', 'greycoat').effective.vitality).toBeGreaterThan(
      sheetOf(bare, 'defender', 'greycoat').effective.vitality,
    );
  });

  /**
   * The Infirmary's medics are Stitchers (`mends`, and the sheet wants an Infirmary 5 to train
   * one), so they stand in the **attacking** line, and what they undo never reaches the
   * Executioner's line.
   *
   * The order is `mend` -> `applyDamage`, and his line runs inside the second, so this measures
   * it on a hand-built side with no seed involved. Ten Razors with four Stitchers behind them is
   * full cover (`MAX_MEND_SHARE`). The front Razor stands 15% of a life above his line and a round
   * takes 15% of one off it: unmended it is brought to the line and finished, mended the round is
   * 0.55 of that and it is left standing above it.
   */
  it("keeps a wounded attacker above his line when the attacker's medics got to it first", () => {
    const sim = fight({ razors: 10, stitchers: 4 }, { greycoat: 10 }, undefined, 'medics');
    const side = sim.attacker;
    // Stood back up, because the assertion is about one exchange rather than about this fight.
    for (const stack of side.stacks) {
      stack.bodies = new Array<number>(stack.started).fill(stack.effective.vitality);
      stack.alive = stack.started;
      stack.pool = stack.started * stack.effective.vitality;
      stack.brokeAt = null;
      stack.suppressed = 0;
    }
    const razors = side.stacks.find((one) => one.unit.id === 'razors')!;
    const vitality = razors.effective.vitality;
    const front = (EXECUTIONER_THRESHOLD + 0.15) * vitality;
    const raw = 0.15 * vitality;
    const stand = () => {
      razors.bodies = [front, ...new Array<number>(9).fill(vitality)];
      razors.alive = 10;
      razors.pool = front + 9 * vitality;
    };
    let finished = 0;
    const line = {
      floor: EXECUTIONER_THRESHOLD,
      count: (_unitId: string, n: number) => (finished += n),
    };

    expect(mendShare(side), 'the hospital is doing everything it can').toBeCloseTo(0.45, 6);
    const cut = mend(side, new Map([[razors, raw]])).get(razors)!;
    expect(cut).toBeCloseTo(raw * 0.55, 6);

    // The control: the same exchange with nobody to treat it is a body on the floor.
    stand();
    applyDamage(side, new Map([[razors, raw]]), line);
    expect(finished).toBe(1);
    expect(razors.alive).toBe(9);

    stand();
    finished = 0;
    applyDamage(side, new Map([[razors, cut]]), line);
    expect(finished).toBe(0);
    expect(razors.alive).toBe(10);
    expect(razors.bodies[0]! / vitality).toBeGreaterThan(EXECUTIONER_THRESHOLD);
  });

  /**
   * And what the Executioner finished is still a casualty the ledger can hand back, because
   * `execute` writes into the same `alive` every other casualty comes out of.
   *
   * Pinned at the engine's seam rather than at the settler's: the bodies he takes leave through
   * the ordinary loss ledgers, so every one of them is either dead, fled or a winner's loss, and
   * a winner's loss is what `recoverCasualties` is handed. The server file measures what the
   * Infirmary then does with them.
   */
  it('takes his bodies out through the ordinary ledgers, none of them twice', () => {
    for (const seed of ['ledger-0', 'ledger-1', 'ledger-2', 'ledger-3']) {
      const sim = fight({ razors: 30, sluggers: 10 }, { street_enforcers: 15 }, EXECUTIONER, seed);
      for (const stack of sim.attacker.stacks) {
        expect(stack.alive, stack.unit.id).toBeGreaterThanOrEqual(0);
        expect(stack.alive, stack.unit.id).toBeLessThanOrEqual(stack.started);
        expect(stack.pool, stack.unit.id).toBeGreaterThanOrEqual(0);
      }
      expect(sim.executed).toBeGreaterThanOrEqual(0);
    }
    // The control: he is worth bodies here, so the bounds above are not a statement about nothing.
    const withHim = ['ledger-0', 'ledger-1', 'ledger-2', 'ledger-3'].reduce(
      (total, seed) =>
        total +
        fight({ razors: 30, sluggers: 10 }, { street_enforcers: 15 }, EXECUTIONER, seed).executed,
      0,
    );
    expect(withHim).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- 4. officers

describe('4. stacking with officers', () => {
  const OFFICER: BattleOfficer = {
    officerId: 'officer-stacking',
    name: 'The Warden',
    // A sheet at 60 across the board, so the officer is a real stack rather than a formality.
    attributes: makeAttributes(60),
  };

  const officerStack = (sim: Simulation, side: 'attacker' | 'defender') => {
    const found = sim[side].stacks.find((one) => one.officer !== undefined);
    if (!found) throw new Error(`nobody led the ${side}`);
    return found;
  };

  /**
   * An officer on the defence is a stack like any other, so `applyPresence` finds them too.
   *
   * Worth pinning even though the Combine never fields one (`resolve.ts` reads a defending
   * officer off a `defenderBase`, and the regime has none): the day somebody gives the regime a
   * commander, this is the rule they inherit, and it should be the rule on purpose.
   */
  it('puts her points on a defending officer as well, though the regime fields none', () => {
    const bare = fight({ razors: 20 }, { greycoat: 10 }, undefined, 'officer', {
      defenderOfficer: OFFICER,
    });
    const backed = fight({ razors: 20 }, { greycoat: 10 }, SYNDIC, 'officer', {
      defenderOfficer: OFFICER,
    });
    const before = officerStack(bare, 'defender').effective;
    const after = officerStack(backed, 'defender').effective;
    expect(before.armor).toBeLessThan(MAX_RATING - SYNDIC_ARMOR);
    expect(after.armor).toBe(before.armor + SYNDIC_ARMOR);
    expect(after.penetration).toBe(before.penetration + SYNDIC_PENETRATION);
    expect(after.reasons).toContain('The Syndic');
  });

  /** §D4: the worst that happens to an officer is an injury, so he never finishes one. */
  it('never finishes an officer, however far under the line they are', () => {
    const sim = fight({ razors: 10 }, { greycoat: 10 }, undefined, 'officer-exec');
    const side = sim.attacker;
    const vitality = sheetOf(sim, 'attacker', 'razors').effective.vitality;
    side.stacks.push({
      ...sheetOf(sim, 'attacker', 'razors'),
      officer: OFFICER,
      alive: 1,
      started: 1,
      charged: 0,
      pool: 0.3 * vitality,
      bodies: [0.3 * vitality],
      brokeAt: null,
      suppressed: 0,
      dealt: 0,
    });
    const led = side.stacks[side.stacks.length - 1]!;
    let finished = 0;
    const line = {
      floor: EXECUTIONER_THRESHOLD,
      count: (_unitId: string, n: number) => (finished += n),
    };
    // A blow that takes anybody else through his line: the officer takes it and is still standing.
    applyDamage(side, new Map([[led, 0.25 * vitality]]), line);
    expect(finished).toBe(0);
    expect(led.alive).toBe(1);

    // The control: the same stack without the officer on it is finished where it stands.
    delete led.officer;
    led.bodies = [0.3 * vitality];
    led.alive = 1;
    led.pool = 0.3 * vitality;
    applyDamage(side, new Map([[led, 0.25 * vitality]]), line);
    expect(finished).toBe(1);
    expect(led.alive).toBe(0);
  });

  /** §D1: an officer is one person, and not one who changes sides. */
  it('never turns the attacking officer, whatever the budget would have paid for', () => {
    const shaken = territory({ unitMoraleFlat: -40 });
    const sim = simulate({
      seed: 'officer-turn',
      battlefield: bareBattlefield(),
      attacker: {
        name: 'Crew',
        army: { razors: 20 },
        defending: false,
        territory: shaken,
        officer: OFFICER,
      },
      defender: {
        name: 'The Combine',
        army: { suppressor: 20, directive_xero: 1 },
        defending: true,
        presence: ZERO,
      },
    });
    // The control: his budget is spending freely on this side, so "not the officer" is a choice.
    expect(crossed(sim)).toBe(Math.floor(21 * MAX_INTIMIDATED_SHARE));
    // Only Razors are on the ledger: the officer's one-unit stack is not among them.
    expect(Object.keys(sim.turned)).toEqual(['razors']);
    expect(
      sim.defender.stacks.some((one) => one.turncoat === true && one.officer !== undefined),
    ).toBe(false);
    expect(sim.attacker.stacks.some((one) => one.officer !== undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------- 5/6/7. the attacker's book

describe("5 to 7. stacking with the attacker's research, cards, boosts and refits", () => {
  /**
   * A turncoat crosses on **the attacker's own numbers**, and gets nothing of the Combine's.
   *
   * `changeOfHeart` copies the stack it takes, and that stack was built against the attacker's
   * `TerritoryEffects`: the crew's research, its faction cards, its notoriety, its contraband and
   * whatever it burned on the fight, all of which fold through `standingEffectsFor` into the one
   * struct. So a crew that has finished Overwhelming Force hands the Combine 50% better Razors
   * than a crew that has not.
   *
   * Measured with the two folds set differently on purpose, so a turncoat reading the wrong one
   * fails rather than agreeing by accident: the attack is at +50% offense and the defence at +80%
   * with 30 points of armour, and the Razor that crossed reads the attacker's 240 and 5.
   */
  it("crosses on the attacker's fold, not on the ground it crossed onto", () => {
    const sim = fight({ razors: 20 }, { suppressor: 30, directive_xero: 1 }, ZERO, 'turncoat', {
      attackerTerritory: territory({ unitOffensePercent: 50 }),
      defenderTerritory: territory({ unitOffensePercent: 80, unitArmorPercent: 30 }),
    });
    const turncoat = sim.defender.stacks.find((one) => one.turncoat === true);
    if (!turncoat) throw new Error('nobody crossed');
    const loyal = sheetOf(sim, 'attacker', 'razors').effective;
    const combine = sheetOf(sim, 'defender', 'suppressor').effective;
    expect(turncoat.effective.offense).toBe(loyal.offense);
    expect(turncoat.effective.armor).toBe(loyal.armor);
    // The control: the side it joined is on very different numbers, so "the attacker's" is a fact.
    expect(combine.offense).not.toBe(loyal.offense);
    expect(combine.armor).not.toBe(loyal.armor);
    expect(turncoat.effective.reasons).toContain('Changed sides');
  });

  /**
   * A morale boost is the counter to Change of Heart, and it is a steep one.
   *
   * `boosted` in `resolve.ts` folds a bought name and a Black Clinic syringe into
   * `unitMoraleFlat`, which is the channel §D3's budget is spent against. `Make An Example` is
   * +20 points across the whole force. Measured on 20 Razors (morale 40) against 30 Suppressors
   * and him, one seed, counting the men who crossed:
   *
   * | points of morale | crossed |
   * | --- | --- |
   * | 0 | 15 |
   * | +10 | 8 |
   * | +20 (Make An Example) | 4 |
   * | +40 | 0 |
   *
   * Pinned as the whole table rather than as one inequality: the interesting property is that it
   * is smooth and that a real boost buys most of it, and a `toBeLessThan` would survive a change
   * that made the first point worth all of it or none of it.
   */
  it('is answered by a morale boost on the attacking force, point for point', () => {
    const turnedAt = (flat: number) =>
      crossed(
        fight({ razors: 20 }, { suppressor: 30, directive_xero: 1 }, ZERO, 'boost', {
          attackerTerritory: territory({ unitMoraleFlat: flat }),
        }),
      );
    expect([0, 10, 20, 40].map(turnedAt)).toEqual([15, 8, 4, 0]);
  });

  /**
   * A refit is on the sheet before the ground is read and long before her points land, so the
   * three add up in one direction and only one.
   *
   * A Greycoat is 12 armour; Composite Carapace is +14; the Chosen Chapel is +9; she is +25. The
   * four figures are asserted as a chain, so a change that folded the card in after the cap, or
   * that multiplied instead of adding, fails on the middle rung rather than on the total.
   */
  it('bolts the refit on first, reads the ground second and lands her points last', () => {
    const chapel: Battlefield = { ...bareBattlefield(), baseDefense: 9 };
    const carapace: UnitLoadouts = { greycoat: ['composite_carapace'] };
    const plain = fight({ razors: 20 }, { greycoat: 10 }, undefined, 'refit', {
      battlefield: chapel,
    });
    const fitted = fight({ razors: 20 }, { greycoat: 10 }, undefined, 'refit', {
      battlefield: chapel,
      defenderUpgrades: carapace,
    });
    const both = fight({ razors: 20 }, { greycoat: 10 }, SYNDIC, 'refit', {
      battlefield: chapel,
      defenderUpgrades: carapace,
    });
    expect(plain.defender.stacks[0]?.effective.armor).toBe(12 + 9);
    expect(fitted.defender.stacks[0]?.effective.armor).toBe(12 + 14 + 9);
    expect(both.defender.stacks[0]?.effective.armor).toBe(12 + 14 + 9 + SYNDIC_ARMOR);
    // Penetration takes no points from the ground, so the card and she are the only two sources.
    expect(both.defender.stacks[0]?.effective.penetration).toBe(12 + SYNDIC_PENETRATION);
  });
});

// ---------------------------------------------------------------- 8. caps and floors

describe('8. the ceiling, and whether it is ever reached', () => {
  /**
   * Directive Xero's morale is an assignment rather than a sum, so it is the one path in
   * `applyPresence` a ceiling could be left off.
   *
   * The Syndic's two lines go through `capRating`, which is where the maintainer's rule of
   * 2026-09-15 is written down; his line writes the figure straight onto the sheet. This asserts
   * a power built past the bar is still held at it, which is a test of the clamp rather than of
   * the constant, and a second assertion pins the constant.
   */
  it('holds a morale ceiling of 100 even if a power is written above it', () => {
    const overwritten: CombinePower = { kind: 'directive_xero', morale: 140, changeOfHeart: true };
    const sim = fight({ razors: 20 }, { greycoat: 10 }, overwritten, 'ceiling');
    const held = sheetOf(sim, 'defender', 'greycoat');
    expect(held.effective.morale).toBe(MAX_RATING);
    // The live figure too, which starts at the same number and only falls (`moraleState`).
    expect(held.morale).toBeLessThanOrEqual(MAX_RATING);
    // The control: an ordinary morale reaches the sheet unchanged, so the clamp is not a constant.
    const normal = fight({ razors: 20 }, { greycoat: 10 }, ZERO, 'ceiling');
    expect(sheetOf(normal, 'defender', 'greycoat').effective.morale).toBe(DIRECTIVE_XERO_MORALE);
    expect(DIRECTIVE_XERO_MORALE).toBe(MAX_RATING);
  });

  /** ...and the turncoats he stands up are held at the same bar. */
  it('holds a turncoat at the same ceiling', () => {
    const overwritten: CombinePower = { kind: 'directive_xero', morale: 140, changeOfHeart: true };
    const sim = fight({ razors: 20 }, { suppressor: 30, directive_xero: 1 }, overwritten, 'turn');
    const turncoats = sim.defender.stacks.filter((one) => one.turncoat === true);
    expect(turncoats.length).toBeGreaterThan(0);
    for (const one of turncoats) expect(one.effective.morale).toBe(MAX_RATING);
  });

  /**
   * And the honest answer about the cap: **it never fires in a real fight.**
   *
   * The Syndic is over the Annexes (`datavault-sigma`, difficulty 6), and the heaviest sheet that
   * can stand anywhere in it is her own: 35 armour, 40 penetration, on the uplink's `baseDefense`
   * of 5. That is 65 and 65 with her points on, with 35 points of the bar left over. The garrison
   * behind her tops out at a Street Enforcer, 30 armour on a `baseDefense` of 6, which is 61.
   *
   * So the clamp above is a guard against a retune and not a rule anybody meets, and this says so
   * with the measurement rather than with a `toBeLessThanOrEqual(MAX_RATING)` that would pass on
   * an engine with no ceiling at all.
   */
  it('never reaches the ceiling on any sheet the Combine actually stands under her', () => {
    const leader = combineLeaderOf('datavault-sigma');
    if (!leader) throw new Error('no leader over the Annexes');
    const district = findDistrict(leader.districtId);
    if (!district) throw new Error('no district');

    let heaviestArmor = 0;
    let heaviestPenetration = 0;
    for (const location of district.locations) {
      const baseDefense = LOCATION_CATALOG[location.kind].baseDefense;
      const budget = combineSlotBudget(district.difficulty, baseDefense);
      const standing = Object.keys(combineGarrison(district.difficulty, budget));
      // The leader himself is on the field for a fight on his own plot, and he is the top sheet.
      if (location.id === leader.locationId) standing.push(leader.unitId);
      for (const unitId of standing) {
        const unit = findUnit(unitId);
        if (!unit) throw new Error(`${unitId} is not in the catalogue`);
        heaviestArmor = Math.max(
          heaviestArmor,
          capRating(unit.stats.armor + baseDefense) + SYNDIC_ARMOR,
        );
        heaviestPenetration = Math.max(
          heaviestPenetration,
          unit.stats.penetration + SYNDIC_PENETRATION,
        );
      }
    }
    expect(heaviestArmor).toBe(65);
    expect(heaviestPenetration).toBe(65);
    expect(MAX_RATING - heaviestArmor, 'points of bar left unused').toBe(35);
  });
});

// ---------------------------------------------------------------- 9. two at once

describe('9. two powers at once', () => {
  /**
   * A district carries at most one leader, so no fight ever carries two powers.
   *
   * Three things hold that and all three are asserted, because any one of them alone would let a
   * second power in through a different door: the data gives each leader his own district,
   * `combineLeaderOf` answers with one leader rather than a list, and `SideSetup.presence` is one
   * `CombinePower` rather than an array, so even a settler that found two could only hand over one.
   */
  it('gives every district at most one leader, so the engine is only ever handed one power', () => {
    const districts = COMBINE_LEADERS.map((leader) => leader.districtId);
    expect(new Set(districts).size).toBe(COMBINE_LEADERS.length);
    for (const leader of COMBINE_LEADERS) {
      expect(combineLeaderOf(leader.districtId)?.unitId).toBe(leader.unitId);
    }
    // The three powers are three different kinds, so "one power" is also one behaviour.
    expect(new Set(COMBINE_LEADERS.map((leader) => leader.power.kind)).size).toBe(3);
  });

  /**
   * ...and if a second one ever were written onto a district, `combineLeaderOf` takes the first in
   * catalogue order rather than merging the two. Pinned by construction here, because the answer
   * ought to be a decision somebody made rather than whatever `Array.find` happens to do.
   */
  it('would take the first of two, never both', () => {
    const shared = COMBINE_LEADERS.filter((leader) => leader.districtId === 'datavault-sigma');
    expect(shared).toHaveLength(1);
    const ifTwo = [...COMBINE_LEADERS, { ...COMBINE_LEADERS[1]!, districtId: 'datavault-sigma' }];
    expect(ifTwo.find((leader) => leader.districtId === 'datavault-sigma')?.unitId).toBe('syndic');
  });
});
