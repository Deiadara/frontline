import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import { noTerritoryEffects, type CombinePower } from '../city/index.js';
import { NO_SHEET_BONUS, officerSheetBonusFor } from '../crew/leading.js';
import { mulberry32, seedFrom } from '../rng.js';
import { UNIT_CATALOG, findUnit, type Army } from '../units/index.js';
import { bareBattlefield, type Battlefield } from './battlefield.js';
import { effectiveStats, outnumberedWeight } from './effects.js';
import {
  AMBUSH_CEILING,
  AMBUSH_KNEE,
  JAM_SHARE_CEILING,
  MAX_JAM,
  ambushShare,
  jamPercent,
  outnumberedBy,
  simulate,
  type SideState,
} from './engine.js';
import { MAX_RESISTANCE, MIN_RESISTANCE, damageTypeMultiplier } from './matchup.js';
import { TacticalSkirmishEngine, type SkirmishInput } from './skirmish.js';
import { springTrap, TRAP_CATALOG } from './traps.js';

/**
 * The combat engine under seeded sweeps (definitive bug pass, 2026-10-05, pass 2).
 *
 * Every property here is measured over many seeds and asserted as a direction and a hit rate,
 * never off one fight: a fight turns on single bodies near parity, so a fixture pinned on one
 * seed is pinned on a coin. Each block names the ruling it holds.
 */

const fighters = UNIT_CATALOG.filter((unit) => unit.combat !== false);
const total = (army: Army): number => Object.values(army).reduce((sum, n) => sum + n, 0);
const OPEN = bareBattlefield();
const TUNNEL: Battlefield = {
  ...bareBattlefield('a tunnel'),
  contexts: ['underground', 'dark'],
  frontage: 10,
};

function winRate(attacker: Army, defender: Army, ground: Battlefield, seeds: number): number {
  let wins = 0;
  for (let i = 0; i < seeds; i += 1) {
    const fight = simulate({
      seed: `sweep-${i}`,
      battlefield: ground,
      attacker: { name: 'A', army: attacker, defending: false },
      defender: { name: 'D', army: defender, defending: true },
    });
    if (fight.winner === 'attacker') wins += 1;
  }
  return wins / seeds;
}

describe('the ledger a fight hands the settle', () => {
  /*
   * Random forces of every fighting sheet, porters mixed in, on three grounds, with officers
   * (Raid Boss multipliers included), all three Combine powers, the wire and a ring. What comes
   * out has to be whole units, conserve what was sent, and replay byte for byte.
   */
  const CASES = 600;
  const engine = new TacticalSkirmishEngine();
  const grounds = [
    OPEN,
    TUNNEL,
    { ...bareBattlefield('a stairwell'), contexts: ['urban', 'indoor'], frontage: 14 },
  ] as Battlefield[];
  const powers: (CombinePower | undefined)[] = [
    undefined,
    { kind: 'syndic', penetration: 25, armor: 25 },
    { kind: 'executioner', threshold: 0.3 },
    { kind: 'directive_xero', morale: 100, changeOfHeart: true },
  ];

  function caseFor(index: number): SkirmishInput {
    const next = mulberry32(seedFrom(`ledger-${index}`));
    const pick = (n: number) => Math.floor(next() * n);
    const army = (): Army => {
      const force: Army = {};
      for (let kinds = 1 + pick(4); kinds > 0; kinds -= 1) {
        const unit = fighters[pick(fighters.length)]!;
        force[unit.id] = unit.unique ? 1 : 1 + pick(next() < 0.3 ? 3 : 40);
      }
      if (next() < 0.15) force.scavengers = 1 + pick(10);
      return force;
    };
    const ground = () => ({
      ...noTerritoryEffects(),
      unitOffensePercent: pick(60) - 10,
      unitVitalityPercent: pick(60),
      unitMoraleFlat: pick(30),
      defensePercent: pick(120),
      gatePercent: next() < 0.3 ? pick(150) : 0,
      intimidationFlat: pick(20),
      steadyNerve: next() < 0.2,
      carriersFight: next() < 0.1,
    });
    const officer = (id: string) => ({
      officerId: id,
      name: id,
      attributes: makeAttributes(5 + pick(95)),
      sheetBonus: {
        ...NO_SHEET_BONUS,
        offenseTimes: 1 + next() * 4,
        vitalityTimes: 1 + next() * 4,
        armorFlat: pick(30),
        targetSharePercent: pick(200),
      },
    });
    const presence = powers[pick(powers.length)];
    return {
      seed: `ledger-fight-${index}`,
      attackerName: 'A',
      defenderName: 'D',
      locationName: 'somewhere',
      attacking: army(),
      defending: next() < 0.05 ? {} : army(),
      battlefield: grounds[pick(grounds.length)]!,
      attackerTerritory: ground(),
      defenderTerritory: ground(),
      attackerCohesionPercent: pick(120),
      defenderCohesionPercent: pick(120),
      ...(next() < 0.5 ? { attackerOfficer: officer('lead-a') } : {}),
      ...(next() < 0.5 ? { defenderOfficer: officer('lead-d') } : {}),
      ...(presence ? { defenderPresence: presence } : {}),
      ...(next() < 0.2 ? { attackerSlowed: { speedCut: 15, moraleCut: 2, rounds: 2 } } : {}),
      defenderPerimeter: next() < 0.3 ? { razors: 1 + pick(20) } : {},
    };
  }

  /** The line each side actually stood, porters out unless its ground puts them in. */
  const inLine = (army: Army, carriersFight: boolean): Army =>
    Object.fromEntries(
      Object.entries(army).filter(
        ([id, n]) => n > 0 && (findUnit(id)!.combat !== false || carriersFight),
      ),
    );

  it('is whole units that add up to what was sent, and replays from its seed', () => {
    const problems: string[] = [];
    const seen = { turned: 0, executed: 0, ring: 0, attackerWins: 0 };
    const finite = (value: unknown, path: string): void => {
      if (typeof value === 'number' && !Number.isFinite(value)) problems.push(`${path}=${value}`);
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) finite(inner, `${path}.${key}`);
      }
    };
    for (let c = 0; c < CASES; c += 1) {
      const input = caseFor(c);
      const out = engine.resolve(input);
      if (JSON.stringify(out) !== JSON.stringify(engine.resolve(input))) {
        problems.push(`${c}: a second run differs`);
      }
      finite(out, `${c}`);
      const ledgers = {
        fled: out.fled,
        killed: out.killed,
        winnerLosses: out.winnerLosses,
        turned: out.turned,
        executedForce: out.executedForce,
        perimeterCaught: out.perimeterCaught,
        perimeterLosses: out.perimeterLosses,
      };
      for (const [name, ledger] of Object.entries(ledgers)) {
        for (const [id, n] of Object.entries(ledger)) {
          if (!Number.isInteger(n) || n < 0) problems.push(`${c}: ${name}.${id} = ${n}`);
          if (!findUnit(id)) problems.push(`${c}: ${name} names ${id}, which is not a unit`);
        }
      }
      const attacking = inLine(input.attacking, input.attackerTerritory!.carriersFight);
      const defending = inLine(input.defending, input.defenderTerritory!.carriersFight);
      const attackerWon = out.winner === 'attacker';
      const loser = attackerWon ? defending : attacking;
      const winner = attackerWon ? attacking : defending;
      // Only the attacker ever crosses over, so only the attacker's books carry `turned`.
      const turnedFrom = (side: 'loser' | 'winner', id: string) =>
        (side === 'loser') === !attackerWon ? (out.turned[id] ?? 0) : 0;
      for (const id of new Set([...Object.keys(loser), ...Object.keys(out.fled)])) {
        const accounted = (out.fled[id] ?? 0) + (out.killed[id] ?? 0);
        const owed = (loser[id] ?? 0) - turnedFrom('loser', id);
        if (accounted !== owed)
          problems.push(`${c}: loser ${id} owed ${owed}, ledger ${accounted}`);
      }
      for (const [id, n] of Object.entries(out.winnerLosses)) {
        if (n > (winner[id] ?? 0) - turnedFrom('winner', id)) {
          problems.push(`${c}: winner lost ${n} ${id} of ${winner[id] ?? 0}`);
        }
      }
      for (const [id, n] of Object.entries(out.perimeterLosses)) {
        if (n > (input.defenderPerimeter?.[id] ?? 0)) problems.push(`${c}: ring lost ${n} ${id}`);
      }
      for (const [id, n] of Object.entries(out.turned)) {
        if (n > (attacking[id] ?? 0)) problems.push(`${c}: ${n} ${id} turned of ${attacking[id]}`);
      }
      if (total(out.executedForce) !== out.executed) problems.push(`${c}: executed disagrees`);
      if (total(out.turned) > 0) seen.turned += 1;
      if (out.executed > 0) seen.executed += 1;
      if (total(out.perimeterLosses) + total(out.perimeterCaught) > 0) seen.ring += 1;
      if (attackerWon) seen.attackerWins += 1;
    }
    expect(problems.slice(0, 20), problems.slice(0, 20).join('\n')).toEqual([]);
    // The control: the sweep reached every branch it claims to cover, and both sides win.
    expect(seen.turned).toBeGreaterThan(20);
    expect(seen.executed).toBeGreaterThan(20);
    expect(seen.ring).toBeGreaterThan(10);
    expect(seen.attackerWins).toBeGreaterThan(CASES * 0.25);
    expect(seen.attackerWins).toBeLessThan(CASES * 0.75);
  });
});

describe('more of one unit never wins less (maintainer, 2026-09-29)', () => {
  /*
   * Every ordinary fighting sheet, massed alone against forty Razors, counted up a unit at a time
   * across the band where the fight is contested. Netrunners are left out: a line of nothing but
   * jammers deals almost no damage and loses at every size, which is the sheet working.
   *
   * What this does not claim, and must not be widened to claim without reading the 2026-10-05
   * report: that adding more of a *minority* sheet inside a mixed line is monotone. It is not,
   * yet, on narrow ground (the casualty shock counts whole bodies).
   */
  const SEEDS = 160;
  const ordinary = fighters.filter((unit) => !unit.unique && unit.id !== 'netrunners');

  function sweep(ground: Battlefield, attacking: boolean): string[] {
    const broken: string[] = [];
    for (const unit of ordinary) {
      const parity = Math.round(40 / unit.unitSlots);
      const counts = Array.from(
        { length: Math.max(6, Math.ceil(parity * 0.7)) },
        (_, i) => Math.max(1, Math.round(parity * 0.65)) + i,
      );
      let previous = -1;
      const readings: string[] = [];
      for (const count of counts) {
        const mine: Army = { [unit.id]: count };
        const rate = attacking
          ? winRate(mine, { razors: 40 }, ground, SEEDS)
          : 1 - winRate({ razors: 40 }, mine, ground, SEEDS);
        readings.push(`${count}:${Math.round(rate * 100)}`);
        if (rate < previous - 0.05) broken.push(`${unit.id} ${readings.join(' ')}`);
        previous = Math.max(previous, rate);
      }
    }
    return broken;
  }

  it('attacking on open ground', () => {
    const broken = sweep(OPEN, true);
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('holding on open ground', () => {
    const broken = sweep(OPEN, false);
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('attacking in a ten-wide tunnel, where the frontage binds', () => {
    const broken = sweep(TUNNEL, true);
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('reaches a force that plainly wins, so a flat line cannot pass it', () => {
    expect(winRate({ razors: 46 }, { razors: 40 }, OPEN, SEEDS)).toBeGreaterThan(0.95);
    expect(winRate({ juggernauts: 7 }, { razors: 40 }, TUNNEL, SEEDS)).toBeGreaterThan(0.95);
  });
});

describe('a stronger sheet beats the same sheet at equal unit slots', () => {
  /*
   * The mirror of every fighting sheet at about forty slots, one side carrying a bonus on a
   * channel every unit reads. Measured 2026-10-05 at 200 seeds: the bare mirror sits at 41% to
   * 50%, and +15% damage or +15% hit points takes it to 86% or more for all twenty-six.
   */
  const SEEDS = 120;
  const mirror = (unitId: string, patch: Partial<ReturnType<typeof noTerritoryEffects>>) => {
    const unit = findUnit(unitId)!;
    const army = { [unitId]: Math.max(2, Math.round(40 / unit.unitSlots)) };
    let wins = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      const fight = simulate({
        seed: `mirror-${i}`,
        battlefield: OPEN,
        attacker: {
          name: 'A',
          army,
          defending: false,
          territory: { ...noTerritoryEffects(), ...patch },
        },
        defender: { name: 'D', army, defending: false },
      });
      if (fight.winner === 'attacker') wins += 1;
    }
    return wins / SEEDS;
  };

  it('on damage and on hit points, for every ordinary fighting sheet', () => {
    const weak: string[] = [];
    for (const unit of fighters.filter((spec) => !spec.unique)) {
      const bare = mirror(unit.id, {});
      const harder = mirror(unit.id, { unitOffensePercent: 15 });
      const tougher = mirror(unit.id, { unitVitalityPercent: 15 });
      if (bare < 0.3 || bare > 0.7) weak.push(`${unit.id}: the bare mirror reads ${bare}`);
      if (harder < 0.8) weak.push(`${unit.id}: +15% damage wins only ${harder}`);
      if (tougher < 0.8) weak.push(`${unit.id}: +15% hit points wins only ${tougher}`);
    }
    expect(weak, weak.join('\n')).toEqual([]);
  });
});

describe('the rulings, at their numbers', () => {
  const built = (army: Army, enemy: Army): { side: SideState; enemy: SideState } => {
    // `simulate` builds both lines; a zero-round fight is not possible, so read the opening
    // state back by restoring what the fight spent.
    const fight = simulate({
      seed: 'built',
      attacker: { name: 'A', army, defending: false },
      defender: { name: 'D', army: enemy, defending: true },
    });
    for (const stack of [...fight.attacker.stacks, ...fight.defender.stacks]) {
      stack.alive = stack.started;
      stack.brokeAt = null;
    }
    return { side: fight.attacker, enemy: fight.defender };
  };

  it('Last Stand ramps from nothing at even odds to all of it at two to one (P10-A)', () => {
    const wardens = findUnit('wardens')!;
    const at = (ratio: number) =>
      effectiveStats(
        wardens,
        OPEN,
        { defending: false, outnumbered: outnumberedWeight(ratio * 40, 40) },
        noTerritoryEffects(),
      ).offense / wardens.stats.offense;
    expect(at(1)).toBeCloseTo(1, 9);
    expect(at(1.25)).toBeCloseTo(1.0625, 9);
    expect(at(1.5)).toBeCloseTo(1.125, 9);
    expect(at(2)).toBeCloseTo(1.25, 9);
    expect(at(3)).toBeCloseTo(1.25, 9);
    for (let r = 1; r < 2; r += 0.05) expect(at(r + 0.05)).toBeGreaterThan(at(r));
  });

  it('counts outnumbered in unit slots, for Last Stand and for the morale test (P10-B)', () => {
    // Eight Juggernauts (48 slots) against sixteen Razors (16): no Last Stand for the heavier side.
    const heavy = simulate({
      seed: 'slots',
      attacker: { name: 'A', army: { juggernauts: 8 }, defending: false },
      defender: { name: 'D', army: { razors: 16 }, defending: true },
    });
    expect(heavy.attacker.stacks[0]!.effective.offense).toBe(
      findUnit('juggernauts')!.stats.offense,
    );
    // Twenty Wardens (40 slots) against forty Razors (40 slots) are not outnumbered at all.
    const even = built({ wardens: 20 }, { razors: 40 });
    expect(outnumberedBy(even.side, even.enemy)).toBe(1);
    expect(even.side.stacks[0]!.effective.offense).toBe(findUnit('wardens')!.stats.offense);
    // ...and against sixty they are at one and a half to one, and pay half of Last Stand.
    const short = built({ wardens: 20 }, { razors: 60 });
    expect(outnumberedBy(short.side, short.enemy)).toBe(1.5);
    expect(short.side.stacks[0]!.effective.offense).toBeCloseTo(172 * 1.125, 9);
  });

  it('bends the ambush past 0.6 of a round and never reaches a whole one (P10-E)', () => {
    const blind = built({ the_specter: 1 }, { the_abomination: 1 });
    const share = ambushShare(blind.side, blind.enemy);
    expect(share).toBeGreaterThan(AMBUSH_KNEE);
    expect(share).toBeLessThan(AMBUSH_CEILING);
    expect(share).toBeCloseTo(0.7995, 3);
    // An ordinary ambush is under the knee and paid exactly.
    const plain = built({ scrapers: 30 }, { razors: 30 });
    expect(ambushShare(plain.side, plain.enemy)).toBeCloseTo(0.1, 9);
  });

  it('holds the jam under its soft ceiling, however many jammers', () => {
    let previous = 0;
    for (const netrunners of [1, 2, 4, 8, 16, 40]) {
      const line = built({ netrunners, razors: 36 }, { razors: 10 });
      const jam = jamPercent(line.side);
      expect(jam).toBeGreaterThan(previous);
      expect(jam).toBeLessThan(MAX_JAM * JAM_SHARE_CEILING);
      previous = jam;
    }
  });

  it('never makes a sheet immune, and never doubles what it dreads', () => {
    for (const target of UNIT_CATALOG) {
      for (const shooter of UNIT_CATALOG) {
        const into = (unit: typeof target) =>
          effectiveStats(unit, OPEN, { defending: false, outnumbered: 0 }, noTerritoryEffects());
        const multiplier = damageTypeMultiplier(into(shooter), into(target));
        const written = target.stats.resistances[shooter.stats.damageType] ?? 0;
        expect(multiplier).toBeGreaterThanOrEqual(1 - MAX_RESISTANCE / 100);
        expect(multiplier).toBeLessThanOrEqual(1 - MIN_RESISTANCE / 100);
        if (written > 0) expect(multiplier).toBeLessThan(1);
        if (written < 0) expect(multiplier).toBeGreaterThan(1);
      }
    }
  });

  it('lets a trap stop a column of one (P11-A)', () => {
    for (const trap of TRAP_CATALOG.filter((spec) => spec.effect.kind === 'bite')) {
      expect(springTrap({ razors: 1 }, trap)).toMatchObject({ wipedOut: true, survivors: {} });
    }
  });
});

describe('the Raid Boss: his own damage and hit points, and nobody else', () => {
  const lead = (times: number) => ({
    officerId: 'boss',
    name: 'Boss',
    attributes: makeAttributes(50),
    sheetBonus: { ...NO_SHEET_BONUS, offenseTimes: times, vitalityTimes: times },
  });
  const fight = (times: number) =>
    simulate({
      seed: 'raid-boss',
      attacker: {
        name: 'A',
        army: { razors: 20, wardens: 5 },
        defending: false,
        officer: lead(times),
      },
      defender: {
        name: 'D',
        army: { razors: 22 },
        defending: true,
        officer: { officerId: 'other', name: 'Other', attributes: makeAttributes(50) },
      },
    });

  it('multiplies his stack alone, on his side and on theirs', () => {
    const plain = fight(1);
    const boss = fight(5);
    const sheets = (side: SideState) =>
      side.stacks.map((stack) => [
        stack.unit.id,
        stack.effective.offense,
        stack.effective.vitality,
      ]);
    const mine = (side: SideState) => sheets(side).filter(([id]) => id !== 'officer:boss');
    expect(mine(boss.attacker)).toEqual(mine(plain.attacker));
    expect(sheets(boss.defender)).toEqual(sheets(plain.defender));
    const his = (side: SideState) =>
      side.stacks.find((stack) => stack.officer?.officerId === 'boss')!;
    expect(his(boss.attacker).effective.offense).toBe(his(plain.attacker).effective.offense * 5);
    expect(his(boss.attacker).effective.vitality).toBe(his(plain.attacker).effective.vitality * 5);
  });

  it('is one at the floor of the grades, five at a perfect sheet, and only in his chair', () => {
    const at = (points: number, role: 'raid_boss' | 'field_commander') =>
      officerSheetBonusFor(
        { chairLeads: [], chairPoints: { raid_boss: points, field_commander: points } },
        role,
        'battle',
      );
    expect(at(10, 'raid_boss').offenseTimes).toBe(1);
    expect(at(55, 'raid_boss').offenseTimes).toBe(3);
    expect(at(100, 'raid_boss')).toMatchObject({ offenseTimes: 5, vitalityTimes: 5 });
    expect(at(100, 'field_commander')).toMatchObject({ offenseTimes: 1, vitalityTimes: 1 });
  });
});
